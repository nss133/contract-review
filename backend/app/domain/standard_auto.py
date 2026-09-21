"""Native standard-auto-v13 gates. Server analysis owns proofs; clients cannot issue them."""
import json
import re
import unicodedata
from pathlib import Path
from app.domain import agreement_judgment as current

VERSION='standard-auto-v13'
POLICIES={p['id']:p for p in json.loads((Path(__file__).resolve().parents[1]/'data/catalog.json').read_text())['judgment_policies']['checks']}
LABELS={'presence':'약정 존재·반영','clarity':'내용·범위의 명확성','appropriateness':'적정성·유불리','execution_excluded':'실제 이행 — 검토 제외','unclassified':'질문 변경 — 기준 재정리 필요'}
MESSAGES={'no_rule':'현재 기준은 사람의 명확성·적정성 판단 대상','disabled_check':'검토 제외·통합된 항목','input_unconfirmed':'현재 본문을 분석하면 자동판정 재실행','uncertain_mapping':'현재 적용 대상·근거 연결 확인 필요','related_exception':'해당 약정의 배제·충돌·구체적 위험 확인 필요','no_evidence':'질문에 필요한 현재 약정 내용 미확인','variant':'해당 약정의 배제·충돌·구체적 위험 확인 필요','source_quality':'해당 약정의 원문 확인 필요','supported':'질문별 약정 요건 확인'}


def policy(cp):
    row=POLICIES.get(cp.get('id'),{})
    compatible=bool(row and (cp['meaning_revision']==row.get('meaning_revision') if cp.get('meaning_revision') else row.get('question')==cp.get('check')))
    level=row['level'] if compatible else 'unclassified'
    return dict(row,level=level,label=LABELS[level],active=row.get('active') is not False,compatible=compatible)


def evaluate(cp,item,input=None,prepared=None):
    input=input or {};p=policy(cp)
    out=dict(check_id=cp['id'],eligible=False,status='no_rule',evidence=[],version=VERSION,history=[],blockers=[],missing=[],policy=p)
    def end(status):
        out.update(status=status,message=MESSAGES.get(status,status));return out
    if cp.get('active') is False or not p['active'] or cp.get('review_scope')=='execution_only':return end('disabled_check')
    if not input.get('confirmed'):return end('input_unconfirmed')
    if not p['compatible'] or p['level']!='presence':return end('no_rule')
    if item is None or any(item.get(k) for k in ('roleGated','relationshipGated','serviceGated','opinionScope')):return end('uncertain_mapping')
    result=current.evaluate(cp,input.get('documents',[]),{k:input[k] for k in ('scope','knowledge','hints','source_standard') if k in input},prepared=prepared)
    out.update(result,check_id=cp['id'],version=VERSION,policy=p,history=[])
    out['recognition']={'stage':'clause_found' if out['evidence'] else 'not_found','evidence':out['evidence']}
    out['pattern_key']=current.digest([VERSION,cp['id'],p.get('meaning_revision'),result.get('elements'),result.get('signature'),[re.sub(r'\s+',' ',unicodedata.normalize('NFC',e['text'])).strip() for e in result['evidence']]])
    out['references']=[]
    return end(result['status'])
