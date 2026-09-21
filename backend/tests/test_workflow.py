import io
import json
import zipfile
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings
from app.repositories.database import Database
from app.auth.service import create_user

ORIGIN='http://127.0.0.1:8765'
TEXT='용역계약서\n제1조 (목적)\n본 계약은 용역 업무의 범위를 정한다.\n제2조 (대금)\n대금은 100만원이며 부가가치세는 별도로 지급한다.\n제3조 (손해배상)\n수탁자는 고의 또는 과실로 발생한 손해를 배상한다.'


@pytest.fixture
def env(tmp_path):
    settings=Settings(environment='test',database_path=str(tmp_path/'app.sqlite'))
    db=Database(settings.database_path);db.initialize()
    users={name:create_user(db,name,'workflow-test-password') for name in ('alice','bob')}
    with TestClient(create_app(settings)) as client:
        headers=login(client)
        review=client.post('/api/v1/reviews',headers=headers,json={'text':TEXT,'title':'합성 계약'}).json()['review_id']
        yield client,headers,'/api/v1/reviews/'+review,settings,users


def login(client,name='alice'):
    response=client.post('/api/v1/auth/login',headers={'Origin':ORIGIN},json={'username':name,'password':'workflow-test-password'})
    assert response.status_code==200,response.text
    return {'Origin':ORIGIN,'X-CSRF-Token':response.json()['csrf_token']}


def analyse(client,headers,url,revision=0):
    response=client.post(url+'/analyses',headers=headers,json={'revision':revision,'type_id':'procurement'})
    assert response.status_code==201,response.text
    result=response.json()
    assert result['result']['clauses'] and result['result']['items']
    return result


def review_all(client,headers,url,analysis):
    for item in analysis['result']['items']:
        if not item['required']:continue
        response=client.put(url+'/verdicts/'+item['cpId'],headers=headers,json={'analysis_id':analysis['analysis_id'],
            'revision':0,'verdict':'검토의견','comment':'합성 시험: 원문을 확인하고 수정안을 남겼습니다.','reason':'확인 필요'})
        assert response.status_code==200,response.text


def test_actual_analysis_verdict_completion_and_restart(env):
    client,headers,url,settings,_=env
    analysis=analyse(client,headers,url)
    assert any(r['quote'] for r in analysis['result']['items'])
    body={'analysis_id':analysis['analysis_id'],'revision':0,'summary':'종합 의견 😀','reviewed_original':True,'verdict_revisions':{}}
    assert client.post(url+'/complete',headers=headers,json=body).status_code==409
    review_all(client,headers,url,analysis)
    body['verdict_revisions']={v['check_id']:v['revision'] for v in client.get(url+'/state').json()['verdicts']}
    assert client.post(url+'/complete',headers=headers,json=dict(body,reviewed_original=False)).status_code==422
    done=client.post(url+'/complete',headers=headers,json=body)
    assert done.status_code==201,done.text
    done=done.json()
    assert done['snapshot']['summary']=='종합 의견 😀'
    assert client.get(url+'/state').json()['completion']['current']
    with TestClient(create_app(settings)) as reopened:
        login(reopened)
        saved=reopened.get(url+'/completions/'+done['completion_id'])
        assert saved.status_code==200
        assert saved.json()['snapshot']==done['snapshot']


def test_changes_make_opinions_stale_without_erasing_them(env):
    client,headers,url,_,_=env
    analysis=analyse(client,headers,url)
    review_all(client,headers,url,analysis)
    cp=next(r['cpId'] for r in analysis['result']['items'] if r['required'])
    assert client.patch(url,headers=headers,json={'text':TEXT+'\n제4조 (비밀유지)\n자료를 누설하지 않는다.','revision':0}).status_code==200
    newer=analyse(client,headers,url,1)
    state=client.get(url+'/state').json()
    assert all(v['needs_reconfirmation'] and v['comment'] for v in state['verdicts'])
    assert client.put(url+'/verdicts/'+cp,headers=headers,json={'analysis_id':analysis['analysis_id'],'revision':1,'verdict':'이상없음'}).status_code==409
    assert client.post(url+'/complete',headers=headers,json={'analysis_id':newer['analysis_id'],'revision':1,'reviewed_original':True,'verdict_revisions':{}}).status_code==409


def test_same_input_reanalysis_preserves_confirmed_verdicts(env):
    client,headers,url,_,_=env
    old=analyse(client,headers,url);review_all(client,headers,url,old)
    new=analyse(client,headers,url)
    state=client.get(url+'/state').json()
    assert all(not v['needs_reconfirmation'] and v['analysis_id']==new['analysis_id'] for v in state['verdicts'])


def docx():
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:
        archive.writestr('word/document.xml','<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>용역계약서</w:t></w:r></w:p><w:p><w:r><w:t>제1조 (목적)</w:t></w:r></w:p><w:p><w:r><w:t>본 계약은 용역의 범위를 정한다.</w:t></w:r></w:p></w:body></w:document>')
    return output.getvalue()


def test_file_upload_analysis_and_original_acl(env):
    client,headers,url,_,_=env
    raw=docx()
    response=client.post(url+'/documents',headers=headers,data={'revision':'0','kind':'main'},files={'file':('계약.docx',raw)})
    assert response.status_code==201,response.text
    value=response.json();document_id=value['document']['id']
    assert '용역계약서' in value['document']['extraction']['text']
    assert client.get(url+'/documents/'+document_id+'/file').content==raw
    analyse(client,headers,url,1)
    assert client.post(url+'/documents',headers=headers,data={'revision':'0','kind':'annex'},files={'file':('별첨.txt',b'body')}).status_code==409
    login(client,'bob')
    for path in ['/state','/documents/'+document_id+'/file']:
        assert client.get(url+path).status_code==404


def test_bad_file_and_unknown_check_cannot_create_success(env):
    client,headers,url,_,_=env
    bad=client.post(url+'/documents',headers=headers,data={'revision':'0','kind':'main'},files={'file':('손상.docx',b'not a zip')})
    assert bad.status_code==422,bad.text
    assert client.get(url+'/state').json()['documents']==[]
    result=analyse(client,headers,url)
    assert client.put(url+'/verdicts/fake',headers=headers,json={'analysis_id':result['analysis_id'],'revision':0,'verdict':'이상없음'}).status_code==422
    cp=next(r['cpId'] for r in result['result']['items'] if r['required'])
    data={'analysis_id':result['analysis_id'],'revision':0,'verdict':'이상없음'}
    def save(_):return client.put(url+'/verdicts/'+cp,headers=headers,json=data).status_code
    with ThreadPoolExecutor(max_workers=10) as pool:codes=list(pool.map(save,range(10)))
    assert codes.count(200)==1 and codes.count(409)==9


def test_changed_verdict_cannot_complete_an_unseen_revision(env):
    client,headers,url,_,_=env
    analysis=analyse(client,headers,url);review_all(client,headers,url,analysis)
    values=client.get(url+'/state').json()['verdicts']
    body={'analysis_id':analysis['analysis_id'],'revision':0,'reviewed_original':True,
          'verdict_revisions':{v['check_id']:v['revision'] for v in values}}
    first=client.post(url+'/complete',headers=headers,json=body)
    assert first.status_code==201,first.text
    v=values[0]
    assert client.put(url+'/verdicts/'+v['check_id'],headers=headers,json={
        'analysis_id':analysis['analysis_id'],'revision':v['revision'],'verdict':'검토의견','comment':'동료의 새 의견'}).status_code==200
    assert not client.get(url+'/state').json()['completion']['current']
    assert client.post(url+'/complete',headers=headers,json=body).status_code==409
    assert client.get(url+'/completions/'+first.json()['completion_id']).json()['snapshot']==first.json()['snapshot']


def test_snapshot_and_original_survive_detach_and_backup(env,tmp_path):
    from app.repositories.backup import create_backup,restore_backup
    client,headers,url,settings,_=env
    raw=docx()
    uploaded=client.post(url+'/documents',headers=headers,data={'revision':'0','kind':'annex'},files={'file':('annex.docx',raw)}).json()['document']
    a=analyse(client,headers,url,1);review_all(client,headers,url,a)
    values=client.get(url+'/state').json()['verdicts']
    response=client.post(url+'/complete',headers=headers,json={'analysis_id':a['analysis_id'],'revision':1,
        'reviewed_original':True,'verdict_revisions':{v['check_id']:v['revision'] for v in values}})
    assert response.status_code==201,response.text
    done=response.json()
    assert client.delete(url+'/documents/'+uploaded['id']+'?revision=1',headers=headers).status_code==200
    create_backup(settings.database_path,tmp_path/'backup')
    restored=restore_backup(tmp_path/'backup',tmp_path/'restored.sqlite')
    with TestClient(create_app(Settings(environment='test',database_path=str(restored)))) as other:
        login(other)
        assert other.get(url+'/state').json()['documents']==[]
        assert other.get(url+'/documents/'+uploaded['id']+'/file').content==raw
        assert other.get(url+'/completions/'+done['completion_id']).json()['snapshot']==done['snapshot']


def test_server_auto_proof_manual_override_and_reanalysis(env):
    client,headers,url,_,_=env
    a=analyse(client,headers,url)
    state=client.get(url+'/state').json()
    auto=next(v for v in state['verdicts'] if v['origin']=='auto' and v['check_id']=='CMN-05')
    assert auto['check_id']=='CMN-05' and auto['revision']==0
    assert auto['proof']['eligible'] and auto['proof']['evidence']
    assert auto['proof']==next(i['automatic'] for i in a['result']['items'] if i['cpId']==auto['check_id'])
    payload={'analysis_id':a['analysis_id'],'revision':0,'verdict':'이상없음','origin':'auto'}
    assert client.put(url+'/verdicts/'+auto['check_id'],headers=headers,json=payload).status_code==422
    payload.update(origin='manual',verdict='검토의견',comment='자동 근거를 검토했으나 별도 협의 필요')
    assert client.put(url+'/verdicts/'+auto['check_id'],headers=headers,json=payload).status_code==200
    b=analyse(client,headers,url)
    value=next(v for v in client.get(url+'/state').json()['verdicts'] if v['check_id']==auto['check_id'])
    assert value['origin']=='manual' and value['comment']==payload['comment'] and not value['needs_reconfirmation']
    changed=TEXT+'\n제4조 (특약)\n부가가치세 포함 여부는 추후 협의한다.'
    assert client.patch(url,headers=headers,json={'revision':0,'text':changed}).status_code==200
    c=analyse(client,headers,url,1)
    item=next(i for i in c['result']['items'] if i['cpId']=='CMN-05')
    assert not item['automatic']['eligible'] and item['automatic']['blockers']
    value=next(v for v in client.get(url+'/state').json()['verdicts'] if v['check_id']=='CMN-05')
    assert value['origin']=='manual' and value['needs_reconfirmation'] and value['comment']==payload['comment']


def test_completion_contains_auto_proof_and_summary_changes_invalidate_current(env):
    client,headers,url,_,_=env
    a=analyse(client,headers,url)
    for item in a['result']['items']:
        if not item['required'] or item['automatic']['eligible']:continue
        response=client.put(url+'/verdicts/'+item['cpId'],headers=headers,json={'analysis_id':a['analysis_id'],
            'revision':0,'verdict':'검토의견','comment':'추가 확인'})
        assert response.status_code==200,response.text
    values=client.get(url+'/state').json()['verdicts']
    body={'analysis_id':a['analysis_id'],'revision':0,'reviewed_original':True,'summary':'완료 의견',
          'verdict_revisions':{v['check_id']:v['revision'] for v in values}}
    done=client.post(url+'/complete',headers=headers,json=body)
    assert done.status_code==201,done.text
    snapshot=done.json()['snapshot']
    assert any(v['origin']=='auto' and v['proof']['evidence'] for v in snapshot['verdicts'])
    assert client.get(url+'/state').json()['completion']['current']
    assert client.put(url+'/draft',headers=headers,json={'text':'수정한 종합 의견','revision':0}).status_code==200
    assert not client.get(url+'/state').json()['completion']['current']
    assert client.get(url+'/completions/'+done.json()['completion_id']).json()['snapshot']==snapshot
    assert client.patch(url,headers=headers,json={'revision':0,'text':TEXT+'\n부가가치세는 추후 정한다.'}).status_code==200
    stale=client.get(url+'/state').json()
    assert not any(v['origin']=='auto' for v in stale['verdicts'])
    assert client.post(url+'/complete',headers=headers,json=body).status_code==409
