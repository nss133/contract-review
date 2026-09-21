"""One-off, read-only patch generator for substantive checklist replacement."""
import json
import re
import sys
import difflib
import zlib
import base64
from pathlib import Path
import yaml

ROOT=Path(__file__).resolve().parents[1]
# Base controls applicability; related questions become prose, NOT executable children.
PLAN=[
 ('DAMAGE','CMN-11','CMN-05-2 CMN-11 CMN-12 CMN-14 RISK-06 SP-DEL-02','손해배상·면책·지연책임의 합리성',
  '손해배상의 귀책사유·범위와 면책·책임한도·지연책임 약정이 계약의 성격 및 회사의 지위에 비추어 합리적인가',
  '책임의 편면성, 특별·간접손해의 포함 또는 제외, 상한과 고의·중과실 예외, 위약금의 과도성과 중복 부담을 함께 살핀다. 대금 지급지연 이자와 납품·이행지연 지체상금을 구별한다. 이자·상한·지체상금 특약이 없다는 이유만으로 보완을 요구하지 않는다. 하도급 등 별도 적용 규정의 요건을 이 질문으로 대체하지 않는다.'),
 ('SECRET','CMN-15','CMN-15 CMN-16 NDA-01 NDA-02 NDA-03 NDA-04 NDA-05 NDA-06 NDA-07 NDA-08 NDA-09 NDA-10 NDA-21','비밀유지 약정의 적정성',
  '비밀정보의 범위, 사용·공개 제한과 예외 및 비밀유지 존속기간이 정보의 성격과 계약 목적에 비추어 적절한가',
  '보호할 정보를 식별할 수 있는지, 목적 외 사용·누설과 제3자·취급자 관리가 적절한지 함께 확인한다. 공지·독자개발·정당취득 정보와 법령에 따른 공개를 고려하고, 영업비밀 등 정보의 성격에 맞는 관리와 종료 후 존속 범위를 검토한다. 정의 조항이 있다는 사실만으로 약정 전체가 적절하다고 판단하지 않는다. 개인정보 처리위탁 의무는 별도로 검토한다.'),
 ('END','CMN-08','CMN-08 CMN-09','계약 해제·해지 사유와 절차',
  '계약 해제·해지 사유와 권리 배분 및 시정·통지 절차가 회사에 일방적으로 불리하지 않고 명확한가',
  '중대한 위반·도산·임의해지 등의 사유, 양 당사자의 권리 균형, 시정 기회와 통지 방법을 한 번에 검토한다. 모든 해지사유에 동일한 시정기간을 요구하지 않는다. 특정 약관 규제와 모집위탁 설명 의무는 별도 적용 항목으로 유지한다.'),
 ('PRICE','CMN-03','CMN-03 CMN-04 CH-01','대가 산정·지급·정산의 명확성',
  '대금·수수료의 금액 또는 산정 기준과 지급 시기·방법·정산 절차가 거래 구조에 맞게 명확한가',
  '금액·단가·산식의 특정, 청구·검수 등 지급기준, 지급기한·방법과 정산 주기를 함께 확인한다. 모집·판매 수수료도 같은 질문으로 검토한다. 부가세 표시는 자동 사실확인 결과로 구별하며, 하도급 지급기한이나 화해금 등 특수한 요건은 해당 항목에서 검토한다.'),
 ('TERM','CMN-06','CMN-06 CMN-07','계약기간·갱신 조건',
  '계약의 시작·종료 시점과 갱신 약정이 있는 경우 그 조건·거절 절차가 명확하고 합리적인가',
  '기간의 특정·역전 여부와 갱신조건, 거절 통지기한 및 일방적 갱신권을 함께 검토한다. 갱신 약정이 없는 확정기간 계약에 갱신 조항을 추가하도록 요구하지 않는다.'),
 ('IP','CMN-17','CMN-17 ITDL-01','산출물 권리 귀속·이용 범위',
  '계약 산출물의 권리 귀속과 회사의 이용·수정 권한이 계약 목적에 맞게 정해져 있는가',
  '산출물·저작물의 소유 및 이용권을 구별하고, 개발계약에서는 소스코드·프로그램의 저작재산권과 2차적저작물 작성 권한을 함께 살핀다. 소스 인도·에스크로와 제3자 라이선스는 권리 귀속과 다른 의무이므로 해당 항목에서 검토한다.'),
 ('PRIVSCOPE','PRIV-01','PRIV-01 PRIV-02 PRIV-04 PRIV-14','개인정보 위탁 범위·목적 제한',
  '개인정보 위탁업무의 목적·범위와 그 범위를 벗어난 처리·이용·제공 금지가 위탁 문서에 명확히 반영되어 있는가',
  '본문 또는 적용되는 위탁 특약에서 실제 위탁업무를 특정하고 목적 외 처리 및 범위 초과 이용·제3자 제공을 제한하는지 함께 확인한다. 제3자 제공 동의와 위탁은 구별하며, 보안조치·감독·재위탁은 별도 의무로 유지한다.'),
 ('PRIVSUB','PRIV-05','PRIV-05 PRIV-15','개인정보 재위탁 통제',
  '개인정보 재위탁의 제한과 위탁자 동의 절차가 위탁 문서에 명확히 정해져 있는가',
  '재위탁 허용 범위와 동의를 얻어야 하는 주체·시점을 함께 확인한다. 개인정보 재위탁 동의와 개인신용정보 재위탁의 별도 제한을 서로 대체하지 않는다.'),
 ('PRIVNOTICE','PRIV-09','PRIV-09 PRIV-10','개인정보 위탁 사실 공개',
  '위탁업무 내용과 수탁자에 대한 공개가 홈페이지 지속 게재 또는 적절한 대체 수단으로 이행되도록 정해져 있는가',
  '공개 내용과 수단·유지 책임을 함께 확인한다. 실제 홈페이지 등 외부 이행 확인이 필요한 사항은 계약 문구만으로 완료를 단정하지 않는다. 홍보·판매 위탁 통지 및 감독기관 통지는 별도 검토한다.'),
 ('LABOR','DIS-01','DIS-01 DIS-02 DIS-03','수탁자 업무·인력 운영의 독립성',
  '수탁자가 업무 수행과 인사·노무 관리를 독립적으로 담당하고 위탁자의 요청은 지정 책임자를 통해 전달되도록 정해져 있는가',
  '직접 지휘·명령 배제, 요청 창구, 인력 배치·근태·노무 권한을 함께 검토한다. 계약 문구만으로 실제 운영의 독립성까지 확인한 것으로 보지 않는다.'),
 ('SALEDEFECT','SP-DEL-09','SP-DEL-09 SP-DEL-10 SP-DEL-11','매매 목적물의 하자 구제',
  '매매 목적물의 하자에 대한 구제수단과 권리행사기간이 거래 성격에 맞게 정해져 있는가',
  '하자담보책임, 필요한 경우 교환·완전물 급부 및 권리행사기간을 함께 검토한다. 특정물·종류물의 차이를 고려하고 모든 매매에 동일한 교환 약정을 요구하지 않는다. 도급·위임의 하자·불완전이행과 구별한다.'),
 ('SHCOMMIT','SH-EXIT-01','SH-EXIT-01 SH-EXIT-02','핵심주주 경업·전업 의무',
  '주요주주의 경업·겸직 제한과 필요한 전업 의무의 범위 및 위반 시 효과가 계약 목적에 비추어 합리적인가',
  '적용 주주, 금지업무·기간·예외 및 전업 의무의 필요성과 위반 효과를 함께 검토한다. 모든 주주에게 동일한 의무를 부과하지 않으며 이탈 시 지분정산은 별도 항목에서 확인한다.'),
]

def emit():
 files=[ROOT/'knowledge/common.yaml',*sorted((ROOT/'knowledge/types').glob('*.yaml'))]
 docs={p:yaml.safe_load(p.read_text()) for p in files}
 rows=[dict(c,source=p.stem) for p,d in docs.items() for c in d['checks']]
 byid={c['id']:c for c in rows};retired={id for _,_,ids,_,_,_ in PLAN for id in ids.split()}
 if not retired<=byid.keys():raise RuntimeError('Migration already applied or source missing')
 changes={};new_by_old={};newchecks={};replacements={}
 for key,base,ids,title,question,note in PLAN:
  originals=[byid[id] for id in ids.split()];c=dict(byid[base]);c.pop('source')
  for field in ['auto_clear','perspective_rule','evidence_required_groups','llm_elements','decision_question','pass_guidance','opinion_guidance']:
   c.pop(field,None)
  c.update(id='CNS-'+key,label=title,check=question,decision_question=question+'?',note=note,
    pass_guidance='위 설명의 검토 관점에 비추어 본건에서 수정이 불필요하면 선택',
    opinion_guidance='본건에서 수정·추가 확인이 필요한 내용을 의견으로 작성',auto_verdict=False,
    checklist_revision='content-v2',legacy_check_ids=ids.split())
  c['triggers']={'keywords':list(dict.fromkeys(k for o in originals for k in o.get('triggers',{}).get('keywords',[])))}
  if key=='DAMAGE':c['triggers']['keywords']=['손해배상','배상책임','손해배상의 범위','면책','책임한도','지체상금','위약금','지연이자','지연손해금']
  if key=='SECRET':c['triggers']['keywords']=['비밀유지','비밀정보','영업비밀','기밀','비공지','목적외 사용','비밀유지의무']
  # The general IP question is practical; specialized references remain guidance, not a mandatory trigger.
  c['sources']=list({json.dumps(s,ensure_ascii=False,sort_keys=True):s for o in originals for s in o.get('sources',[])}.values())
  newchecks[c['id']]=c
  for id in ids.split():new_by_old[id]=c['id']
  replacements[base]=c
 for p in files:
  old=p.read_text();parts=re.split(r'(?m)(?=^  - id: )',old);out=[parts[0]]
  for block in parts[1:]:
   cid=re.match(r'  - id: ([^\n]+)',block).group(1).strip()
   if cid in replacements:
    out.append(yaml.safe_dump([replacements[cid]],allow_unicode=True,sort_keys=False,width=120).replace('\n','\n  ').rstrip()+'\n')
    out[-1]='  '+out[-1]
   elif cid not in retired:out.append(block)
  text=''.join(out)
  if text!=old:changes[p]=(old,text)
 # Rewire structured mapping metadata without retaining child execution.
 for filename,rootkey in [('contract_actions.yaml','actions'),('tag_signatures.yaml','checks')]:
  p=ROOT/'knowledge'/filename;old=p.read_text();d=yaml.safe_load(old);mapping=d[rootkey]
  for key,base,ids,_,_,_ in PLAN:
   cid='CNS-'+key;baseval=mapping.get(base)
   if rootkey=='actions' and newchecks[cid].get('absence_check'):
    mapping[cid]=dict(baseval or {'contract_requirement':'practice','text_effect':'conditional','implementation_channel':'contract'})
    mapping[cid]['action_rationale']=newchecks[cid]['note']
   elif rootkey=='checks' and baseval:
    mapping[cid]=dict(baseval);mapping[cid]['status']='candidate'
   for id in ids.split():mapping.pop(id,None)
  changes[p]=(old,yaml.safe_dump(d,allow_unicode=True,sort_keys=False,width=120))
 p=ROOT/'knowledge/std_refs.yaml';old=p.read_text();d=yaml.safe_load(old)
 for id,new in new_by_old.items():
  if id in d:d.setdefault(new,[]).extend(d.pop(id))
 changes[p]=(old,yaml.safe_dump(d,allow_unicode=True,sort_keys=False,width=120))
 archive=ROOT/'knowledge/archive/v1.69-checks.json.zlib.b64'
 changes[archive]=(None,base64.b64encode(zlib.compress(json.dumps(rows,ensure_ascii=False).encode())).decode()+'\n')
 manifest={'version':'content-v2','before_count':len(rows),'after_count':len(rows)-len(retired)+len(PLAN),
   'replacements':[{'id':'CNS-'+key,'label':title,'legacy_ids':ids.split()} for key,_,ids,title,_,_ in PLAN]}
 changes[ROOT/'knowledge/checklist_revisions.json']=(None,json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print('*** Begin Patch')
 selected=list(changes.items())
 if len(sys.argv)>1:selected=[selected[int(sys.argv[1])]]
 for p,(old,new) in selected:
  print(('*** Add File: ' if old is None else '*** Update File: ')+str(p.relative_to(ROOT)))
  if old is not None:
   diff=list(difflib.unified_diff(old.splitlines(),new.splitlines(),n=2))[2:]
   print('\n'.join('@@' if l.startswith('@@') else l for l in diff))
  else:print('\n'.join('+'+l for l in new.splitlines()))
 print('*** End Patch')

if __name__=='__main__':emit()
