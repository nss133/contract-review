"""Authenticated document → analysis → human verdict → immutable completion flow."""
import base64
import hashlib
import json
import time
import uuid
from urllib.parse import quote
from fastapi import Depends, File, Form, Request, Response, UploadFile

from app.api.schemas import AnalyseInput, SaveVerdictInput, CompleteInput
from app.execution import execute, BusyError
from app.domain.review import ENGINE_HASH
from app.repositories.database import audit


def register(app, envelope, database, principal, writer, review_access, failure):
    def conflict(row, revision):
        if row['revision'] != revision:
            raise failure(409,'revision_conflict','다른 변경이 저장되었습니다. 최신 내용을 불러온 뒤 다시 시도하세요.')

    def latest(connection, review_id):
        return connection.execute('SELECT * FROM analyses WHERE review_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',(review_id,)).fetchone()

    def current_analysis(connection, review_id, row, analysis_id):
        analysis = latest(connection,review_id)
        if not analysis or analysis['id'] != analysis_id or not valid_analysis(analysis,row):
            raise failure(409,'analysis_stale','원문 또는 분석이 변경되었습니다. 최신 분석 결과를 확인하세요.')
        return analysis

    def valid_analysis(analysis,row):
        return bool(analysis and analysis['input_revision']==row['revision'] and json.loads(analysis['result_json']).get('engine_hash')==ENGINE_HASH)

    def effective_verdicts(connection,review_id,analysis,row):
        # Human opinions always take precedence, including stale ones needing reconfirmation.
        values={r['check_id']:dict(r,origin='manual') for r in connection.execute('SELECT * FROM review_verdicts WHERE review_id=?',(review_id,))}
        valid=valid_analysis(analysis,row)
        if analysis:
            for item in json.loads(analysis['result_json'])['items']:
                automatic=item.get('automatic',{})
                if valid and item['required'] and automatic.get('eligible') and item['cpId'] not in values:
                    values[item['cpId']]={'check_id':item['cpId'],'review_id':review_id,'analysis_id':analysis['id'],
                        'verdict':'이상없음','reason':'반영되어 있음','comment':'','origin':'auto','revision':0,
                        'updated_at':analysis['created_at'],'updated_by':None,'proof':automatic}
        for v in values.values():v['needs_reconfirmation']=not valid or v['analysis_id']!=analysis['id']
        return list(values.values())

    def docs(connection, review_id):
        rows = connection.execute('SELECT id,kind,name,sha256,extraction_json FROM review_documents WHERE review_id=? AND active=1 ORDER BY created_at,id',(review_id,)).fetchall()
        return [dict(id=r['id'],kind=r['kind'],name=r['name'],sha256=r['sha256'],extraction=json.loads(r['extraction_json'])) for r in rows]

    def run(payload):
        try: return execute(payload)
        except BusyError as error: raise failure(503,'worker_busy',str(error))
        except ValueError as error: raise failure(422,'processing_failed',str(error))

    @app.post('/api/v1/reviews/{review_id}/documents',status_code=201)
    def upload(review_id: str, request: Request, file: UploadFile=File(...), kind: str=Form('main'), revision: int=Form(...),
               identity=Depends(writer), db=Depends(database)):
        if kind not in ('main','annex','base'):raise failure(422,'invalid_kind','문서의 용도를 확인하세요.')
        with db.transaction(write=False) as connection:
            row=review_access(connection,review_id,identity,edit=True);conflict(row,revision)
            if connection.execute('SELECT count(*) FROM review_documents WHERE review_id=? AND active=1',(review_id,)).fetchone()[0]>=20:
                raise failure(422,'too_many_documents','한 검토에는 문서를 20개까지 첨부할 수 있습니다.')
        content=file.file.read(7*1024*1024+1)
        name=(file.filename or 'document').replace('\\','/').split('/')[-1][:200]
        if not content or len(content)>7*1024*1024:raise failure(413,'file_too_large','파일은 7 MiB 이하로 올려 주세요.')
        extracted=run({'task':'extract','name':name,'data':base64.b64encode(content).decode('ascii')})
        document_id=str(uuid.uuid4())
        with db.transaction() as connection:
            row=review_access(connection,review_id,identity,edit=True);conflict(row,revision)
            if connection.execute('SELECT count(*) FROM review_documents WHERE review_id=? AND active=1',(review_id,)).fetchone()[0]>=20:
                raise failure(422,'too_many_documents','한 검토에는 문서를 20개까지 첨부할 수 있습니다.')
            if kind in ('main','base'):
                connection.execute('UPDATE review_documents SET active=0 WHERE review_id=? AND kind=?',(review_id,kind))
            connection.execute('INSERT INTO review_documents(id,review_id,kind,name,sha256,content,extraction_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
                               (document_id,review_id,kind,name,hashlib.sha256(content).hexdigest(),content,json.dumps(extracted,ensure_ascii=False),time.time()))
            if kind=='main':
                from app.domain.compat import legacy_hash
                connection.execute('UPDATE reviews SET text=?,title=?,legacy_hash=?,revision=revision+1 WHERE id=?',
                                   (extracted['text'],name,legacy_hash(extracted['text']),review_id))
            else:connection.execute('UPDATE reviews SET revision=revision+1 WHERE id=?',(review_id,))
            audit(connection,identity['id'],'document_uploaded',document_id)
        return envelope(request,document={'id':document_id,'name':name,'kind':kind,'extraction':extracted},revision=revision+1)

    @app.get('/api/v1/reviews/{review_id}/documents/{document_id}/file')
    def original(review_id: str, document_id: str, request: Request, identity=Depends(principal),db=Depends(database)):
        with db.transaction() as connection:
            review_access(connection,review_id,identity)
            doc=connection.execute('SELECT name,content FROM review_documents WHERE id=? AND review_id=?',(document_id,review_id)).fetchone()
            if not doc:raise failure(404,'not_found','원문 파일을 찾을 수 없습니다.')
            audit(connection,identity['id'],'document_downloaded',document_id)
        return Response(bytes(doc['content']),media_type='application/octet-stream',headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(doc['name'],safe='')})

    @app.delete('/api/v1/reviews/{review_id}/documents/{document_id}')
    def detach(review_id: str,document_id: str,revision: int,request: Request,identity=Depends(writer),db=Depends(database)):
        with db.transaction() as connection:
            row=review_access(connection,review_id,identity,edit=True);conflict(row,revision)
            changed=connection.execute('UPDATE review_documents SET active=0 WHERE review_id=? AND id=? AND active=1',(review_id,document_id)).rowcount
            if not changed:raise failure(404,'not_found','문서를 찾을 수 없습니다.')
            connection.execute('UPDATE reviews SET revision=revision+1 WHERE id=?',(review_id,))
            audit(connection,identity['id'],'document_detached',document_id)
        return envelope(request,revision=revision+1)

    @app.post('/api/v1/reviews/{review_id}/analyses',status_code=201)
    def analyse(review_id: str,body: AnalyseInput,request: Request,identity=Depends(writer),db=Depends(database)):
        with db.transaction(write=False) as connection:
            row=review_access(connection,review_id,identity,edit=True);conflict(row,body.revision)
            documents=docs(connection,review_id);text=row['text']
        result=run({'task':'analyse','text':text,'documents':documents,'options':body.model_dump(exclude={'revision'})})
        analysis_id=str(uuid.uuid4())
        with db.transaction() as connection:
            row=review_access(connection,review_id,identity,edit=True);conflict(row,body.revision)
            previous=latest(connection,review_id)
            connection.execute('INSERT INTO analyses VALUES (?,?,?,?,?,?,?)',
                (analysis_id,review_id,body.revision,result['fingerprint'],json.dumps(result,ensure_ascii=False),identity['id'],time.time()))
            if previous and previous['fingerprint']==result['fingerprint']:
                connection.execute('UPDATE review_verdicts SET analysis_id=?,revision=revision+1 WHERE review_id=? AND analysis_id=?',(analysis_id,review_id,previous['id']))
            audit(connection,identity['id'],'analysis_created',analysis_id)
        return envelope(request,analysis_id=analysis_id,input_revision=body.revision,result=result)

    @app.get('/api/v1/reviews/{review_id}/state')
    def state(review_id: str,request: Request,identity=Depends(principal),db=Depends(database)):
        with db.transaction(write=False) as connection:
            row=review_access(connection,review_id,identity);analysis=latest(connection,review_id)
            verdicts=effective_verdicts(connection,review_id,analysis,row)
            completed=connection.execute('SELECT id,analysis_id,input_revision,completed_at,completed_by,snapshot_json FROM review_completions WHERE review_id=? ORDER BY completed_at DESC,rowid DESC LIMIT 1',(review_id,)).fetchone()
            documents=docs(connection,review_id)
            draft=connection.execute('SELECT text FROM opinion_drafts WHERE review_id=? AND user_id=?',(review_id,identity['id'])).fetchone()
        valid=valid_analysis(analysis,row)
        for v in verdicts:v['needs_reconfirmation']=not valid or v['analysis_id']!=analysis['id']
        completion_value={k:completed[k] for k in completed.keys() if k!='snapshot_json'} if completed else None
        if completion_value:
            completion_value['current']=bool(valid and completed['analysis_id']==analysis['id'] and completed['input_revision']==row['revision']
                and not any(v['updated_at']>completed['completed_at'] for v in verdicts)
                and (not draft or draft['text']==json.loads(completed['snapshot_json'])['summary']))
        return envelope(request,review=dict(row),documents=documents,verdicts=verdicts,
            analysis={'id':analysis['id'],'input_revision':analysis['input_revision'],'result':json.loads(analysis['result_json']),'stale':not valid} if analysis else None,
            completion=completion_value)

    @app.put('/api/v1/reviews/{review_id}/verdicts/{check_id}')
    def verdict(review_id: str,check_id: str,body: SaveVerdictInput,request: Request,identity=Depends(writer),db=Depends(database)):
        with db.transaction() as connection:
            row=review_access(connection,review_id,identity,edit=True)
            analysis=current_analysis(connection,review_id,row,body.analysis_id)
            if not any(r['cpId']==check_id and r['required'] for r in json.loads(analysis['result_json'])['items']):
                raise failure(422,'unknown_check','현재 검토 대상 항목이 아닙니다.')
            old=connection.execute('SELECT revision FROM review_verdicts WHERE review_id=? AND check_id=?',(review_id,check_id)).fetchone()
            if body.revision!=(old['revision'] if old else 0):raise failure(409,'verdict_conflict','다른 검토자의 의견이 저장되었습니다. 최신 내용을 확인하세요.')
            connection.execute('INSERT INTO review_verdicts VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(review_id,check_id) DO UPDATE SET analysis_id=excluded.analysis_id,verdict=excluded.verdict,comment=excluded.comment,reason=excluded.reason,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
                (review_id,check_id,body.analysis_id,body.verdict,body.comment,body.reason,body.revision+1,identity['id'],time.time()))
            audit(connection,identity['id'],'verdict_saved',review_id+':'+check_id)
        return envelope(request,revision=body.revision+1)

    @app.post('/api/v1/reviews/{review_id}/complete',status_code=201)
    def complete(review_id: str,body: CompleteInput,request: Request,identity=Depends(writer),db=Depends(database)):
        with db.transaction() as connection:
            row=review_access(connection,review_id,identity,edit=True);conflict(row,body.revision)
            analysis=current_analysis(connection,review_id,row,body.analysis_id);result=json.loads(analysis['result_json'])
            verdicts=[v for v in effective_verdicts(connection,review_id,analysis,row) if not v['needs_reconfirmation']]
            required={item['cpId'] for item in result['items'] if item['required']}
            if not required or not required <= {v['check_id'] for v in verdicts}:
                raise failure(409,'review_incomplete','아직 확인하지 않은 항목이 있습니다. 모든 검토 대상의 의견을 저장하세요.')
            if body.verdict_revisions != {v['check_id']:v['revision'] for v in verdicts}:
                raise failure(409,'verdict_conflict','항목 의견이 변경되었습니다. 최신 저장본을 확인하고 완료하세요.')
            if any(v['verdict']=='검토의견' and not v['comment'].strip() for v in verdicts):
                raise failure(409,'review_incomplete','검토의견 내용을 작성하세요.')
            now=time.time();completion_id=str(uuid.uuid4())
            snapshot={'format':'contract-review-completion-v1','review':dict(row),'analysis_id':body.analysis_id,
                      'analysis':result,'documents':docs(connection,review_id),'verdicts':verdicts,'summary':body.summary,
                      'reviewed_original':True,'completed_by':identity['id'],'completed_at':now}
            connection.execute('INSERT INTO review_completions VALUES (?,?,?,?,?,?,?)',
                (completion_id,review_id,body.analysis_id,body.revision,json.dumps(snapshot,ensure_ascii=False),identity['id'],now))
            audit(connection,identity['id'],'review_completed',completion_id)
        return envelope(request,completion_id=completion_id,snapshot=snapshot)

    @app.get('/api/v1/reviews/{review_id}/completions/{completion_id}')
    def completion(review_id: str,completion_id: str,request: Request,identity=Depends(principal),db=Depends(database)):
        with db.transaction() as connection:
            review_access(connection,review_id,identity)
            saved=connection.execute('SELECT snapshot_json FROM review_completions WHERE id=? AND review_id=?',(completion_id,review_id)).fetchone()
            if not saved:raise failure(404,'not_found','완료 기록을 찾을 수 없습니다.')
            audit(connection,identity['id'],'completion_read',completion_id)
        return envelope(request,completion_id=completion_id,snapshot=json.loads(saved['snapshot_json']))
