"""Question-specific present-agreement recognition, independent of similarity."""
import copy
import datetime
import hashlib
import json
import re
from pathlib import Path
from app.domain import agreement_evidence as A, evidence as E, clause_semantics as Q, structure as Structure

VERSION='agreement-judgment-v3'
DATA=json.loads((Path(__file__).resolve().parents[1]/'data/judgment-rules.json').read_text())
profiles=DATA['profiles']
PRIVATE_INFO=r'개인(?:신용)?정보|개인\(신용\)정보|고객정보|고객금융정보|금융거래정보|계좌번호|비밀번호|식별정보|신용정보|정보주체'


def c(s):return re.sub('[“”"「」‘’\']','',Q.compact(s)).translate(str.maketrans('∙ㆍ•','····'))
compact=c


def match(pattern,s):return re.search(pattern,s)


def test(pattern,s):
    if not pattern:return True
    return bool(re.search(pattern['pattern'],s,re.I if 'i' in pattern['flags'] else 0))


def digest(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def compiled_profile(profile):
    terms=[c(t) for t in profile['terms']]
    return dict(profile,terms=terms,longest_terms=sorted(terms,key=len,reverse=True))


def non_contract(row):
    s=row.get('body') or ''
    return not s or any(match(p,s) for p in [
        r'^목차|^작성(?:예|요령|안내)|^(?:예시|가령|가정|견본|작성예)[):：.·-]?|^검토(?:의견|결과|메모)|^태그[:：]|^표시용해시태그',
        r'(?:작성예시|예시문구|표준문안예시|기재예시|문구예시|예를들어)',r'\.{3,}\d+$',
        r'(?:라고|다고|고)(?:예시|가정|기록|설명|소개)(?:한|한다|하였다)|(?:한|된)것으로기록|이행실적|실시완료보고',
        r'(?:한다는|해야한다는|하여야한다는)사실을?확인',r'(?:협조한|실시한|암호화한|수립한)(?:자료|기록|사실).{0,10}(?:삭제|정리|확인)',
        r'(?:내용을|문구를|법원을|기간을).{0,8}(?:기재|입력|작성)(?:하세요|바람|할것|요망)',
        r'^[가-힣A-Za-z0-9()·&-]{1,75}(?:계약서|약정서|합의서)(?:\(.*\))?$']) or bool(match(r'^[“"「][\s\S]+[”"」][.。]?$',str(row.get('text') or '').strip()))


def table_rows(rows,documents):
    groups={}
    for r in rows:
        t=(r.get('source') or {}).get('table')
        if t:groups.setdefault(str(r['document_index'])+':'+t['id'],[]).append(r)
    for group in groups.values():
        doc=documents[group[0]['document_index']];tid=group[0]['source']['table']['id']
        bs=[b for b in (doc.get('extraction') or {}).get('blocks',[]) if ((b.get('source') or {}).get('table') or {}).get('id')==tid]
        by_row={};valid=Structure.valid_extraction(doc['text'],doc.get('extraction'))
        for b in bs:
            t=b['source']['table']
            if t.get('invalid') or t.get('merged') or t.get('colspan')!=1 or t.get('rowspan')!=1 or type(t.get('row')) is not int or type(t.get('col')) is not int or t['row']<0 or t['col']<0 or not str(b['text']).strip():valid=False
            cells=by_row.setdefault(t.get('row'),{})
            if cells.get(t.get('col')):valid=False
            cells[t.get('col')]=b
        first=by_row.get(0,{})
        headers=[Structure.table_header(first[col]['text']) for col in sorted(first)]
        if 'actor' not in headers or 'action' not in headers:
            for r in group:r['unresolved_table']=True
            continue
        if any(not h for h in headers) or len(set(headers))!=len(headers):valid=False
        outputs=[]
        for i in range(1,len(by_row)):
            cells=by_row.get(i);fields={}
            if not cells or len(cells)!=len(headers):valid=False;continue
            for col,h in enumerate(headers):
                if not cells.get(col):valid=False;continue
                fields[h]=c(cells[col]['text'])
            actor=fields.get('actor') or '';action=fields.get('action') or ''
            explicit=match('^(수탁자|위탁자|갑|을|제공자|수령자|발주자|수급인)(?:은|는|이|가)',action)
            env=group[0]['aliases'].get('map') or {}
            if not actor or explicit and (env.get(explicit[1]) or explicit[1])!=(env.get(actor) or actor):valid=False
            if explicit:action=action[explicit.end():]
            obj=fields.get('object') or '';condition=fields.get('condition') or ''
            carrier=next((r for r in group if r['source']['table']['row']==i and r['source']['table']['col']==headers.index('action')),None)
            if carrier:outputs.append((carrier,actor+'는'+condition+(obj if obj and not action.startswith(obj) else '')+action))
            else:valid=False
        for r in group:r.update(table_context=True,table_valid=valid,list_header=True,unresolved_table=not valid)
        if valid:
            for row,text in outputs:row.update(list_header=False,semantic_text=text,list_intros=[r for r in group if r is not row and (r['source']['table']['row']==0 or r['source']['table']['row']==row['source']['table']['row'])])


def keyword_only(p,r):
    if (r.get('source') or {}).get('table') and r.get('table_valid') or r.get('list_valid') and r.get('list_intros'):return False
    s=re.sub(r'[.,。·/;:：()\[\]_-]','',r['body'])
    for term in p['longest_terms']:s=s.replace(term,'')
    return not s or bool(match(r'^(?:비밀유지|비밀정보보호|손해배상책임|기술적관리적보호조치|접근권한제한)$',r['body']))


def company_name(s):return re.sub('[.]$','',re.sub(r'(?:주식회사|\(주\)|㈜)','',c(s)))


def prepare(documents=None):
    documents=documents or [];contexts=Q.contexts(documents);texts=[c(d.get('text')) for d in documents];rows=[]
    for row in contexts['rows']:
        h=E.heading(row['text']);rows.append(dict(row,body=c(row['text'][len(h['prefix']):] if h else row['text']),heading=c(row['section']),document_text=texts[row['document_index']]))
    table_rows(rows,documents)
    sections={}
    for r in rows:sections.setdefault((r['document_index'],r['section_index']),[]).append(r)
    for group in sections.values():
        headers=[Structure.table_header(r['body']) for r in group if not (r.get('source') or {}).get('table') and Structure.table_header(r['body'])]
        if 'actor' in headers and 'action' in headers:
            for r in group:
                if not (r.get('source') or {}).get('table') and not match(r'^(?:수탁자|위탁자|갑|을)(?:은|는|이|가).{0,40}(?:개인정보|신용정보|고객정보)',r['body']):r['unresolved_table']=True
    examples=set()
    for r in rows:
        k=(r['document_index'],r['section_index'])
        if match(r'^(?:작성예시|작성요령|예시|예문|견본|목차)(?:\(|:|：|$)',r['body']):examples.add(k)
        r.update(group=sections[k],non_contract=bool(non_contract(r) or k in examples))
    for i in range(1,len(rows)):
        r,prev=rows[i],rows[i-1]
        if r['non_contract'] or prev['non_contract'] or (r.get('source') or {}).get('table') or (prev.get('source') or {}).get('table') or r['domain']!=prev['domain'] or r['section_index']!=prev['section_index'] or not match(r'(?:은|는|이|가|을|를|에서|의|와|과|위하여|및|또는)$',prev['body']) or match(r'^(?:제\d+조|[①-⑳]|\d+[.)]|[가-하][.)]|(?:수탁자|위탁자|갑|을|회사|각당사자)(?:은|는|이|가))',r['body']):continue
        r['semantic_text']=c(prev.get('semantic_text') or prev['body'])+c(r.get('semantic_text') or r['body'])
        r['list_intros']=(prev.get('list_intros') or [])+[prev]+(r.get('list_intros') or [])
    names={}
    for r in rows:
        env=names.setdefault(r['domain'],{'roles':{},'conflicts':[]});m=match(r'^(수탁자|위탁자)(?:상호|회사명|명칭)[:：](.+?)[.]?$',r['body'])
        if m:
            value=company_name(m[2])
            if env['roles'].get(m[1]) and env['roles'][m[1]]!=value:env['conflicts'].append(m[1])
            else:env['roles'][m[1]]=value
        if match(r'수탁자(?:란|는).{0,4}위탁자(?:를|을)(?:말한다|의미한다)',r['body']):env['conflicts'].append('수탁자')
    contradiction=any(not documents[r['document_index']].get('independent') and match(r'수탁자(?:란|는).{0,4}위탁자(?:를|을)(?:말한다|의미한다)',r['body']) for r in rows)
    by_sentence={}
    for i,r in enumerate(rows):
        r.update(party_names=names[r['domain']],row_index=i,semantic_body=c(r.get('semantic_text') or r['body']))
        if contradiction and not documents[r['document_index']].get('independent'):r['role_contradiction']=True
        by_sentence[(r['document_index'],r['sentence_index'])]=r
    return {'key':digest(texts),'rows':rows,'contract_rows':[r for r in rows if not r['non_contract']],'texts':texts,'has_private_info':bool(match(PRIVATE_INFO,'\n'.join(texts))),'documents':documents,'contexts':contexts,'by_sentence':by_sentence}


def proof(row,label):
    out={k:row[k] for k in ('document','document_index','section','section_index','sentence_index','domain','start','end','source','text') if k in row}
    out['element']=label;return out


def problem(code,reason,row=None):return dict(code=code,reason=reason,**(proof(row,reason) if row else {}))


def topic_alias(a):
    return not match(r'(?:않|아니|없|못|불필요|불가|면제|배제|삭제|허용|금지|한정|제외|예외|미정|추후|향후|나중에|다만|경우|때만|의무|할수|될수|하여야|해야|하도록|한다|선택|재량|임의|자유롭게|사후|일부|조건|범위|사전동의|사전승인)',a) and not match(r'^(?:미|비|불)(?:이행|준수|수행|암호화|실시|적용|처리|보관|설치|통지|제출)',a) and not match(r'[0-9]+(?:일|개월|년|회|%)',a)


def aliases(knowledge):
    if not isinstance(knowledge,dict):return {}
    rows=[];by_label={}
    for tid,t in (knowledge.get('tags') or {}).items():
        label=c(t.get('label'))
        if not label or match(r'결과|부서|유형|department|case_type',t.get('type') or '') or match('이상없음|수용가능|검토의견',label):continue
        for a in t.get('aliases') or []:
            a=c(a)
            if len(a)>=3 and a!=label and topic_alias(a) and not match(r'^(?:계약|업무|회사|정보|자료|의무|책임|검토|협조)$',a):
                row={'id':tid,'label':label,'alias':a,'order':len(rows)};rows.append(row);by_label.setdefault(label,[]).append(row)
    return by_label


def profile_aliases(index,profile):return sorted([row for t in dict.fromkeys(profile['terms']) for row in index.get(t,[])],key=lambda row:row['order'])


def expand(row,alias_rows):
    s=original=row['semantic_body'];tags=[]
    for a in alias_rows:
        if a['alias'] in original:
            s=s.replace(a['alias'],a['alias']+a['label']);tags.append({'tag_id':a['id'],'label':a['label'],'matched_term':a['alias']})
    return {'text':s,'tags':tags}


def company_actor(scope=None):
    p=(scope or {}).get('party')
    if isinstance(p,str):return c(p) if re.fullmatch('갑|을',c(p)) else None
    if not isinstance(p,dict):return None
    values=[p.get(k) for k in ('companyLabel','ourLabel','company_alias','our_party','label','party')]+(p.get('ourAliases') if isinstance(p.get('ourAliases'),list) else [])
    labels=list(dict.fromkeys(c(v) for v in values if isinstance(v,str) and re.fullmatch('갑|을',c(v))))
    if len(labels)!=1 or any(c(v)==labels[0] for v in (p.get('counterpartyAliases') if isinstance(p.get('counterpartyAliases'),list) else [])):return None
    return labels[0]


def wrong_actor(p,r,s):
    provider=p['id'] in ['CORE-07','CNS-PRIVSUB','PRIV-03','PRIV-06','PRIV-19','ITCL-01','ITCL-02','ITCL-05','ITCL-06','ITSEC-01','ITSEC-02','ITSEC-03','ITSEC-04','ITSEC-05','ITSEC-06','ITSEC-07','ITSEC-08','ITSEC-09','ITSEC-10','ITSEC-11']
    m=match(r'^(?:다만[,，]?)?(수탁자|위탁자|갑|을|발주자|수급인)(?:은|는|이|가)',s)
    subjects=list(re.finditer(r'(수탁자|위탁자|갑|을)(?:은|는)',s))
    if subjects:m=subjects[-1]
    if not m:
        prior=[x for x in r.get('group',[]) if x['start']<r['start'] and match(r'(?:다음|아래).{0,16}(?:각호|사항|조치|의무)',x.get('body') or '')]
        for intro in reversed((r.get('list_intros') or [])+prior):
            m=match(r'(수탁자|위탁자|갑|을)(?:은|는|이|가)',c(intro.get('semantic_text') or intro.get('body') or intro['text']))
            if m:break
    if provider and r.get('role_contradiction'):return True
    if not m:
        explicit=match(r'^([가-힣A-Za-z0-9()㈜]{1,35}(?:회사|기업|은행|보험))(?:은|는|이|가)',s);known=(r.get('party_names') or {}).get('roles',{}).get('수탁자')
        return bool(provider and explicit and known and company_name(explicit[1])!=known)
    env=(r.get('aliases') or {}).get('map') or {};who=env.get(m[1]) or m[1]
    if provider and who=='위탁자':return True
    if p['id'] in ('CORE-10','ITSEC-13') and who=='위탁자' and '협조' in s:return True
    if provider and who=='수탁자' and '수탁자' in (r.get('party_names') or {}).get('conflicts',[]):return True
    if p['id']=='PRIV-07' and who=='위탁자' and match(r'(?:점검|감독).{0,40}(?:협조|협력)',s):
        names=['수탁자']+[k for k,v in env.items() if v=='수탁자']
        return not any(match(name+r'(?:는|가|은|이).{0,20}(?:협조|협력)',s) for name in names)
    return False


def undecided(s):return bool(match(r'(?:추후|향후|나중에).{0,12}(?:협의|논의|합의|정한|결정)|미정|정하지(?:않|아니)(?:한다|한다는)|별도로정한다|할수도있|여부.{0,8}(?:협의|결정)|_{2,}|\[\s*\]|�',s))


def controlled_credit_exception(r):
    s=r['semantic_body']
    if not match(r'^(?:다만|단)[,，]?다음각호.{0,16}해당하지않는경우',s) or not match(r'(?:갑|위탁자)의(?:사전)?서면(?:승낙|동의|승인)(?:을|를)?(?:얻어|받아|받은경우에만)재위탁할수있다[.]?$',s) or match('사후|자유롭게|관계없이|불구하고',s):return None
    section=[q for q in r.get('group',[]) if not q['non_contract'] and q['domain']==r['domain']]
    at=next((i for i,q in enumerate(section) if q is r),-1)
    principle=section[at-1] if at>0 else None
    if not principle or wrong_actor({'kind':'credit_subcontract','id':'PRIV-21'},principle,principle['semantic_body']) or not match(r'재위탁(?:을)?(?:할수없다|하여서는아니된다|해서는안된다)[.]?$',principle['semantic_body']):return None
    condition=None
    for q in section[at+1:]:
        item=q['semantic_body']
        if not match(r'^(?:\d+[.)]|[①-⑳])',item):break
        if match(r'^(?:\d+[.)]|[①-⑳])(?:관련|관계)?법령에서(?:해당|그)업무의(?:재)?위탁을금지(?:하고있는|하는|한)경우[.]?$',item):condition=q
    if not condition:return None
    if any(match(r'(?:위|이|해당)(?:조건|제한|예외조건).{0,16}(?:적용하지|배제|면제|생략)|법령.{0,20}금지.{0,12}(?:관계없이|불구하고)',q['semantic_body']) for q in section):return None
    return [r,condition]


def deny(s,p):
    if p.get('kind')=='damages':return False
    for rule in DATA['deny_rules']:
        if p.get(rule['field'])==rule['value']:return bool(match(rule['pattern'],s))
    if p['id']=='PRIV-03' and match(r'(?:기술적|관리적|보호조치).{0,15}(?:불필요|필요없|조치가없다)',s):return True
    if p.get('kind')=='credit_subcontract':return bool(match(r'(?:서면|사전)?(?:동의|승낙|승인).{0,25}재위탁할수|자유롭게재위탁|위탁자.{0,10}(?:인정|승인|동의).{0,10}경우.{0,8}(?:제외|예외|그러하지)',s)) and '금융위원회' not in s
    if not any(test(g.get('object'),s) for g in p['groups']):return False
    return bool(match(r'(?:의무|책임).{0,20}(?:면제|배제|적용하지|생략|부담하지)|(?:교육|점검|시정|감독|검사|협조|제출|통지|보호조치|보안조치|암호화|하자보수|열람|예탁|분리보관|자료제공|인수인계|신원조회|백업).{0,22}(?:의무|책임).{0,10}(?:없|면제|부담하지|지지않)|(?:교육|점검|시정|감독|검사|협조|제출|통지|보호조치|보안조치|암호화|하자보수|열람|예탁|분리보관|자료제공|인수인계|신원조회|백업).{0,18}(?:거부할수|응하지않아도|실시하지않아도|생략할수|생략한다|하지않(?:는다|음|으며)|하지아니(?:한다|함))|(?:권리|청구).{0,6}(?:없|포기)',s))


def risk(p,rows,scope=None):
    out=[];actor=company_actor(scope);kind=p.get('kind')
    for r in rows:
        s=r['body']
        if kind=='damages' and match('고의|중과실',s) and match(r'(?:면책|책임.{0,10}(?:없|지지않|부담하지)|배상.{0,8}(?:않|아니))',s):
            m=match(r'(?:^|[,，])(?:다만)?(갑|을|수탁자|수급인|위탁자|발주자)(?:은|는|이|가|의)',s);who=m[1] if m else None
            if not (who and actor and who==actor):out.append(problem('B5','상대방의 고의·중과실 책임까지 배제하는 내용' if who and actor else '고의·중과실 책임 배제의 적용 주체 확인 필요',r))
        if kind=='damages' and match(r'(?:귀책사유|고의|과실).{0,10}(?:관계없이|무관하게|불문하고)|무과실',s) and match(r'(?:모든|일체의?)손해',s) and match('배상|부담',s):
            m=match(r'(?:^|[,，])(?:다만)?(갑|을|수탁자|위탁자)(?:만|은|는|이|가)',s);liable=m[1] if m else None
            if not actor or not liable or liable==actor:out.append(problem('B5','회사의 귀책 없는 전손해 부담 또는 적용 주체 확인 필요',r))
        if kind=='damages' and match(r'(?:개인정보|신용정보|비밀정보|영업비밀|하자).{0,25}(?:손해|배상|책임).{0,20}(?:배제|적용하지|부담하지|지지않)',s):out.append(problem('B5','통합 책임 질문에 포함된 해당 위반의 배상책임 배제',r))
        if kind=='termination' and match(r'(?:사유|이유).{0,5}없|임의로|언제든지',s) and match('해지|해제',s) and match('일방|갑만|을만|단독',s):
            m=match(r'(갑|을)(?:만|은|는)',s);who=m[1] if m else None
            if not actor or not who or who!=actor:out.append(problem('B5','일방의 무사유 해지권과 상대방 구속 범위 확인 필요',r))
        if kind=='price' and match('대금|금액|단가|수수료',s) and match('일방|단독|임의로|동의없이',s) and match('변경|인상|증액',s) and not match(r'변경.{0,15}(?:할수없|하지못|아니|않)|증액.{0,15}(?:할수없|하지못|아니|않)',s):out.append(problem('B5','합의 없는 대가 변경권 확인 필요',r))
        if p['id']=='CMN-21' and match('변경|수정',s) and match('일방|단독|합의없이|동의없이',s):out.append(problem('B5','일방적 계약 변경권',r))
        if kind=='connection' and re.search(r'전용회선.{0,15}(?:않|아니)|전용회선이외|대신|VPN|가상전용',s,re.I) and not match(r'(?:동등|상응|같은|동일|이상).{0,10}보안|보안.{0,12}(?:동등|상응|같은|동일|이상)',s):out.append(problem('B4','전용회선 대체수단의 동등 보안수준 확인 필요',r))
    return out


def date_value(y,m,d):
    try:return int(datetime.datetime(int(y),int(m),int(d),tzinfo=datetime.timezone.utc).timestamp()*1000)
    except ValueError:return None


def numeric_price(s):
    for name in re.finditer(r'(?:계약금액|총대금|대금|대가|수수료|보수)',s):
        tail=s[name.end():];prefix=match(r'^(?:은|는|:|：|총|일금)*',tail)[0]
        amount=match(r'^([일금영일이삼사오육칠팔구십백천만억조정]*\d[\d,]*(?:\.\d+)?)(원|만원|억원|%)',tail[len(prefix):])
        if amount:return amount
    return None


def ip_problems(rows,opts):
    ours=company_actor(opts.get('scope'));roles=(opts.get('scope') or {}).get('roles') or []
    names=['회사','본사']+([ours] if ours else [])+[r for r in roles if re.fullmatch('위탁자|수탁자|발주자|수급인',r)]
    who='(?:'+'|'.join(map(re.escape,dict.fromkeys(names)))+')';texts=[c(r.get('semantic_text') or r['body']) for r in rows];all_text='\n'.join(texts);out=[]
    use=who+r'(?:은|는|이|가|에게|에).{0,25}(?:사용|이용|수정)(?:할수|하도록|권을|을허락)|'+who+r'.{0,12}(?:사용권|이용권).{0,10}(?:갖|부여|허락|귀속)'
    own=who+r'(?:에게|에)?(?:귀속|이전|양도)(?!하지|되지|되지아니)|'+who+r'(?:의)?(?:소유|저작권|지식재산권)|(?:소유권|저작권|지식재산권).{0,8}'+who+r'(?:에게|에)있(?:음|다)'
    denied=who+r'(?:은|는|이|가|에게|에).{0,25}(?:사용|이용|수정).{0,10}(?:할수없|금지|허용하지|하지못)|'+who+r'.{0,12}(?:사용권|이용권).{0,10}(?:없|배제)'
    for r,text in zip(rows,texts):
        if match(denied,text):out.append(problem('B2','회사의 산출물 사용·이용 권한을 명시적으로 배제함',r))
    if out:return out
    if match(use,all_text) or match(own,all_text) or match(r'공동소유|공동으로귀속|각당사자.{0,15}(?:사용|이용)할수',all_text):return out
    if rows and not opts.get('source_standard'):out.append(problem('B1','산출물 권리 배분은 있으나 회사 귀속 또는 필요한 회사 사용권 미확인',rows[0]))
    return out


def value_hit(p,r):
    s=r['body'];kind=p.get('kind')
    if kind=='court':
        if not match('법원|중재',s) or not match('관할|분쟁|소송|중재',s+r['heading']):return None
        if '중재' in s and match('중재원|중재규칙|중재법|중재로|중재에의',s) and match('해결|따른다|의한다|신청|회부',s):return {'key':'arbitration','label':'중재에 의한 분쟁해결'}
        m=match(r'([가-힣]{2,15}(?:지방법원|고등법원|가정법원)(?:[가-힣]{2,8}지원)?|(?:갑|을|당사자|위탁자|수탁자|회사)의?(?:본사|본점|주된사무소|주소지|소재지).{0,14}법원)',s)
        if not m:return None
        before=s[:m.start()];after=s[m.end():]
        if not match(r'(?:관할(?:법원)?|전속관할|합의관할)(?:은|는|:|：|으로는)$',before) and not match(r'^(?:을|를|은|는)?(?:제1심의?)?(?:전속|합의)?관할(?:법원)?(?:으로|로|로서|이다)|^(?:으로|로)(?:정한다|지정한다|한다)|^(?:을|를)(?:정한다|지정한다|삼는다)|^에서.{0,12}(?:해결|소송|제소|다툰)',after) and not (m[0]==re.sub('[.]$','',s) and match('관할|분쟁',r['heading'])):return None
        return {'key':re.sub(r'^.*(?:관할법원(?:은|는|으로는)|관할(?:은|는)|소송(?:은|는)|분쟁(?:은|는))','',m[1]),'label':'분쟁해결 법원 지정'}
    if kind=='vat':
        m=re.search(r'(?:부가가치세|부가세|VAT)(?:\((?:부가가치세|부가세|VAT)\))?(?:은|는|가|를)?[:：]?(미포함|불포함|포함|별도|제외|면세|영세율)',s,re.I)
        if not m:m=match(r'(?:면세|영세율)(?:거래|적용|대상)',s)
        if not m:return None
        return {'key':'excluded' if match('미포함|불포함|별도|제외',m[1] if m.lastindex else m[0]) else 'exempt' if match('면세|영세율',m[0]) else 'included','label':'부가가치세 처리 방식'}
    if kind=='term':
        if not match('계약기간|계약의기간|유효기간|존속기간|효력|체결일|업무완료|계약종료',s+r['heading']):return None
        ds=list(re.finditer(r'(\d{4})[.년/-](\d{1,2})[.월/-](\d{1,2})(?:일|\.)?',s))
        if len(ds)>=2:
            a=date_value(*ds[0].groups());b=date_value(*ds[1].groups())
            if a is None or b is None or a>b:return {'invalid':True,'label':'계약기간 날짜의 유효성·선후관계 확인 필요'}
            return {'key':str(a)+':'+str(b),'label':'계약기간 날짜'}
        m=match(r'(?:체결일|효력발생일|계약일|시작일|착수일)(?:로)?부터([1-9]\d*)(년|개월|월|일)',s)
        if m:return {'key':'duration:'+m[1]+m[2],'label':'기준일부터의 계약기간'}
        if match(r'(?:업무|용역|과업|사업|납품|이행|검수|공사).{0,10}(?:완료|종료)(?:일|시|되는날|할때)?까지',s):return {'key':'completion','label':'업무 완료에 따른 종료 기준'}
        if match(r'(?:유효한동안|유효한것|보유하고있는한|기간의정함없이|무기한)',s):return {'key':'effective-condition','label':'효력·종료 조건'}
        m=match(r'(?:계약기간|유효기간|존속기간)(?:은|는|:|：)?([1-9]\d*)(년|개월|월|일)',s)
        return {'key':'duration:'+m[1]+m[2],'label':'계약기간'} if m else None
    if kind=='price':
        if not match('대금|금액|대가|단가|수수료|보수|계약가',s+r['heading']):return None
        m=numeric_price(s)
        if m:
            unit=m[2]
            try:
                n=float(m[1].replace(',',''))*({'만원':10000,'억원':100000000}.get(unit,1));number=str(int(n)) if n.is_integer() else str(n)
            except ValueError:number=m[1]
            return {'key':('rate:' if unit=='%' else 'amount:')+number,'label':'대금·산정 값'}
        if match(r'[₩￦][1-9][\d,]*|금[일이삼사오육칠팔구십백천만억조]+원',s):return {'key':'amount:'+s,'label':'확정 대가'}
        if match(r'(?:발주|주문|건별|개별).{0,35}(?:단가|금액|대금)|(?:단가|산식|산정기준|수수료율).{0,35}(?:따라|적용|정산|정한다|별첨|발주)|(?:매출|판매|수익|보험료).{0,25}\d+(?:\.\d+)?%',s):return {'key':'formula','label':'대가 산정·건별 정산 방식'}
        if match(r'(?:발주서|주문서|개별계약|견적서).{0,30}(?:정하|따른|기재|기준)|(?:대금|금액).{0,20}(?:발주서|주문서|개별계약|견적서).{0,20}(?:정하|따른|기재|기준)',s):return {'key':'order-defined','label':'개별 문서에 의한 대가 결정 방식'}
    return None


def price_bucket(s):
    names=re.findall(r'유지보수(?:대금|비|료)|개발(?:대금|비|료)|물품대금|용역대금|계약대금|계약금액|임대료|수수료|운송비|배송비|설치비|보증금|총대금|대금|대가',s)
    name=names[-1] if names else '대가'
    return '대가' if re.fullmatch('계약대금|계약금액|총대금|대금',name) else name


def value_rows(p,r):
    kind=p.get('kind')
    if kind not in ('vat','price'):
        one=value_hit(p,r);return [{'value':one,'row':r}] if one else []
    s=r['body'];out=[]
    if kind=='vat':
        pattern=r'(?:부가가치세|부가세|VAT)(?:\((?:부가가치세|부가세|VAT)\))?(?:은|는|가|를)?[:：]?(미포함|불포함|포함|별도|제외|면세|영세율)'
        for m in re.finditer(pattern,s,re.I):
            item=value_hit(p,dict(r,body=m[0]));tail=s[m.end():]
            if match(r'^(?:분|액|금액|표시는|표기가|이라고기재한것은).{0,15}(?:환급|반환|오기|오류)|^(?:분|액)(?:을|은|는|:)',tail):continue
            if '포함' in m[1] and match(r'^(?:하지않|하지아니|이아니|이아님)',tail):item['key']='excluded'
            item['bucket']=price_bucket(s[:m.start()]);out.append({'value':item,'row':r})
        if not out and match('면세|영세율',s):
            exempt=value_hit(p,r)
            if exempt:exempt['bucket']=price_bucket(s);out.append({'value':exempt,'row':r})
    else:
        for part in re.split(r'(?=(?:유지보수대금|개발대금|물품대금|용역대금|계약금액|계약대금|수수료)(?:은|는|:|：|\d))',s):
            item=value_hit(p,dict(r,body=part))
            if item:item['bucket']=price_bucket(part);out.append({'value':item,'row':r})
    return out


def relevant(p,r):return any(t in r['body'] or t in r['heading'] for t in p['terms'])


def scoped_qualifiers(p,prepared,hits):
    out=[];rows=prepared['rows'];used={(h['document_index'],h['section_index']) for h in hits}
    for i,r in enumerate(rows):
        if r['non_contract']:continue
        s=r['body'];prev=rows[i-1] if i else None;same=(r['document_index'],r['section_index']) in used
        adjacent=bool(same and prev and prev['document_index']==r['document_index'] and relevant(p,prev))
        linked=adjacent and match(r'^(?:다만[,，]?|단[,，]?|그러나|또한)?(?:이|그|해당|위)(?:의무|책임|조항|규정|내용)|^다만.{0,20}(?:이|그|해당|위)의무|^그러하지',s)
        if linked and match('면제|면한다|생략|적용하지|아니|않|배제|삭제',s):out.append(problem('B4','같은 약정에 대한 제한·배제',r))
        if adjacent and match(r'불구하고.{0,10}(?:위|그|이)의무.{0,10}(?:면제|배제|면한다)',s):out.append(problem('B4','직전 약정에 우선하는 면제 특약',r))
        if adjacent and s.startswith('다만') and match('그러하지(?:아니|않)',s) and not (p.get('kind')=='credit_subcontract' and '금융위원회' in s):out.append(problem('B4','직전 필수 약정을 제외하는 단서',r))
        if match(r'(?:본|이)계약의?(?:모든|전체|일체의?)(?:조항|의무|규정).{0,25}(?:배제|적용하지|면제)',s):out.append(problem('B4','계약 전체 약정의 명시적 배제',r))
        if same and match(r'^(?:다만[,，]?)?(?:수탁자(?:의)?|갑의|을의)?(?:모든|전체|일체의?)(?:조항|의무|규정).{0,25}(?:배제|적용하지|면제)',s):out.append(problem('B4','같은 조의 모든 약정을 배제하는 단서',r))
        if p.get('private') and match(r'(?:모든|전체|일체의?)보호의무.{0,20}(?:면제|배제|적용하지)',s):out.append(problem('B4','정보 보호 의무 전체를 명시적으로 배제하는 특약',r))
        if match('불구하고|배제|우선적용|대체',s):
            refs=re.findall(r'제(\d+(?:의\d+)?)조',s)
            def referenced(h):
                q=next((x for x in rows if x['document_index']==h['document_index'] and x['section_index']==h['section_index'] and E.heading(x['text'])),None)
                n=match(r'^제(\d+(?:의\d+)?)조',c(q['text'])) if q else None
                return bool(n and n[1] in refs and h['document_index']==r['document_index'])
            if refs and any(referenced(h) for h in hits) and (deny(s,p) or undecided(s)):out.append(problem('B4','확인한 조항을 변경·배제하는 참조',r))
        other=any(j!=r['document_index'] and str(d.get('text') or '').strip() for j,d in enumerate(prepared['documents']))
        if relevant(p,r) and match('별첨|부속|부록',s) and match('달리|우선|변경|대체|따른다',s) and not other and not value_hit(p,r):out.append(problem('B4','이 약정의 내용을 정하는 별첨 원문 미확보',r))
        if adjacent and match(r'^다만[,，]?(?:별첨|부속|부록).{0,20}우선',s) and not other:out.append(problem('B4','직전 약정에 우선하는 별첨 원문 미확보',r))
        if prev and same and prev['document_index']==r['document_index'] and undecided(s) and relevant(p,r):out.append(problem('B1','해당 약정 내용이 미정·공란',r))
    return out


def reference_problems(p,prepared,hits):
    rows=prepared['rows'];out=[]
    if not hits or not any(match(r'제\d+(?:조|항|호)|전조|전항|별첨|부속|별표',r['body']) and match('적용|따른|준용|면제|배제|제외|경우에만|우선',r['body']) for r in rows):return out
    from app.domain.reference_graph import reference_links
    links=reference_links(prepared['documents'],p['terms'])
    keys={(h['document_index'],h['sentence_index']) for h in hits}
    for link in links:
        r=prepared['by_sentence'].get((link['document_index'],link['sentence_index']))
        if not r or r['non_contract']:continue
        s=r['body'];restriction=match(r'(?:적용하지|적용을.{0,6}(?:배제|제외)|(?:의무|책임|조치|규정).{0,12}(?:면제|배제|제외)|선택적으로|동의하는경우에만|재량으로)',s)
        affects=any((t['document_index'],t['sentence_index']) in keys for t in link['targets'])
        if not affects and restriction and link['missing']:
            ns=re.findall(r'제(\d+)조',s)
            for h in hits:
                if h['document_index']==r['document_index']:continue
                heading=next((x for x in rows if x['document_index']==h['document_index'] and x['domain']==h['domain'] and x['section_index']==h['section_index'] and E.heading(x['text'])),None)
                n=match(r'^제(\d+)조',c(heading['text'])) if heading else None
                if n and n[1] in ns:affects=True;break
        if affects and restriction:out.append(problem('B4','확인한 약정을 제한·배제하는 역참조 또는 범위 특약',r))
        elif link['missing'] and relevant(p,r) and match(r'(?:예외|제한|변경|우선).{0,20}(?:따른|적용)|(?:범위|조건).{0,12}(?:제\d+|별첨|부속)',s):out.append(problem('B4','해당 약정의 범위·예외를 정하는 참조 원문 미확보',r))
    return out


def discretionary(s):return bool(match(r'가능한경우에만|필요한경우에만|가능한신원조회|가능한범위(?:내|안|에서|의)|선택적으로|자신의재량|수탁자의재량|수탁자가동의하는경우에만|사항중하나|(?:실시|이행|준수|수행|확보|협조|협력|암호화(?:처리)?)(?:하도록|하기위하여)노력|(?:사항|의무).{0,12}(?:이행|준수|수행)할수있|(?:보호조치|보안조치|암호화).{0,10}(?:일부만|일부실시|일부를)',s))


def local_discretion(p,s):
    parts=re.split('하고|하며|[,，;]',s)
    matching=[part for part in parts if any(test(g.get('object'),part) for g in p['groups']) or any(c(t) in part for t in p['terms'])]
    if len(parts)>1 and discretionary(parts[0]) and not match('한다|하되|한다는',parts[0]) and match('^(?:수탁자|전자금융보조업자)(?:는|가)',parts[0]):return True
    if p['id']=='ITSEC-08' and any(match(r'백업자료.{0,10}(?:보존|보관|복구)',part) and not discretionary(part) for part in re.split('하고|하며|및|[,，;]',s)):return False
    return any(discretionary(part) and not match(r'^(?:위탁자|회사|발주자|주주)(?:은|는|가).{0,20}필요한경우에만.{0,40}(?:요청|요구|점검|감사|열람|청구)할수',part) for part in matching)


def list_limitations(prepared,hits):
    out=[];rows=prepared['rows']
    def level(s):
        for i,pattern in enumerate([r'^[①-⑳]',r'^\d+[.)]',r'^[가-하][.)]',r'^\(\d+\)']):
            if match(pattern,s):return i
        return -1
    for h in hits:
        r=prepared['by_sentence'].get((h['document_index'],h['sentence_index']))
        if not r:continue
        used=list(r.get('list_intros') or []);maximum=level(r['body'])
        if maximum<0:maximum=9
        for q in reversed(rows[:r['row_index']]):
            if q['document_index']!=r['document_index'] or q['domain']!=r['domain'] or q['section_index']!=r['section_index']:break
            s=q['body'];lev=level(s);intro=match(r'(?:다음|아래).{0,20}(?:각호|각목|각세목|사항|행위|의무)',s)
            if intro and (lev<maximum or lev<0):
                used.append(q)
                if lev>=0:maximum=lev
            if not intro and lev<0 and match(r'^(?:수탁자|위탁자|갑|을)(?:은|는).{0,60}(?:한다|하여야한다)[.]?$',s):break
        for q in used:
            s=c(q.get('body') or q['text'])
            if discretionary(s) or non_contract({'body':s,'text':q['text']}):out.append(problem('B4','해당 목록의 상위 약정이 선택·노력·예시로 제한됨',q))
    return out


def evaluate(cp,documents=None,options=None,prepared=None):
    p=profiles.get(cp['id']);out={'eligible':False,'status':'no_rule','evidence':[],'blockers':[],'missing':[],'elements':[],'tag_evidence':[],'version':VERSION}
    if not p:return out
    p=compiled_profile(p);prepared=prepared if prepared is not None else prepare(documents);opts=options or {};rows=prepared['contract_rows'];hits=[];conditional_hits=[];values=[]
    alias_rows=profile_aliases(aliases(opts.get('knowledge')),p);kind=p.get('kind')
    if not rows:out.update(status='source_quality',missing=['판정할 약정 텍스트 미확보']);return out
    if p.get('private') and not prepared['has_private_info']:out.update(status='no_evidence',missing=['대상 정보에 관한 현재 약정']);return out
    groups=[{'rule':g,'hits':[]} for g in p['groups']]
    for r in rows:
        ex=expand(r,alias_rows);s=ex['text'];original=r['semantic_body'];expanded=s!=original;related=relevant(p,r) or bool(ex['tags'])
        if keyword_only(p,r):continue
        def block(code,reason):out['blockers'].append(problem(code,reason,r))
        if kind=='vat' and related and match(r'(?:포함|별도|제외)(?:여부(?![:：]?(?:포함|별도|제외))|또는|혹은|중선택)|(?:포함|별도|제외)/(?:포함|별도|제외)',s):block('B1','VAT 처리 값이 선택·미확정 상태');continue
        if kind=='vat' and related and re.search(r'(?:부가가치세|부가세|VAT)(?:은|는|의|처리는|:|：)?별도(?:로)?(?:협의|합의|결정)',s,re.I):block('B1','VAT 처리 방식이 별도 협의로 미정');continue
        if related and (undecided(s) or expanded and undecided(original)):block('B1','해당 약정의 미정·공란·판독 불가');continue
        if related and match(r'(?:조항|문구|약정)(?:을|를)?.{0,8}(?:삭제한다|폐기한다)',s):block('B2','질문에 해당하는 조항·문구를 삭제하는 내용');continue
        controlled=controlled_credit_exception(r) if kind=='credit_subcontract' else None
        if related and (deny(s,p) or expanded and deny(original,p)) and not controlled:block('B2','재위탁 제한 약정의 예외 범위 확인 필요' if kind=='credit_subcontract' else '질문이 요구하는 약정의 명시적 배제');continue
        if controlled:
            label='재위탁 예외의 서면승낙·법령상 금지업무 제외';out['elements'].append(label);conditional_hits.extend(proof(q,label) for q in controlled)
        if kind=='assignment' and related and match('동의|승인|승낙',s) and (not match('서면|전자문서|문서',s) or not match(r'사전|미리|이전|전에|(?:동의|승인|승낙)(?:를|을)?(?:없이|거쳐|얻어|받아)',s)):block('B1','양도 통제 예외의 사전 서면 동의 방식 미확인');continue
        if related and (wrong_actor(p,r,s) or expanded and wrong_actor(p,r,original)):block('B2','질문의 의무 주체와 본건 약정의 주체가 반대임');continue
        if related and any(a+'은' in s or a+'는' in s for a in r['aliases']['conflicts']):block('B3','해당 근거의 당사자 별칭 정의 충돌');continue
        if related and (local_discretion(p,s) or expanded and local_discretion(p,original)):block('B2','해당 의무를 선택·일부·노력으로 제한하는 조건');continue
        if related and match(r'(?:그|위|해당)의무대신',s):block('B4','필수 약정을 다른 조치로 대체하는 내용');continue
        if related and match(r'(?:수탁자|전자금융보조업자|클라우드(?:컴퓨팅)?서비스제공자)(?:는|가)',s) and match(r'(?:조치를취|조치를실시|조치를이행|암호화(?:처리)?|협조|협력|준수|대책을수립|전용회선을사용)(?:할수있|할수도있|하기위하여노력)|(?:보호|보안)조치.{0,25}(?:실시|이행|수행|취)할수있|분리.{0,12}(?:설치|운영).{0,4}할수있',s):block('B1','수탁자의 선택 가능한 행위만 있고 해당 의무 약정은 미확인');continue
        if kind in ('court','vat','price','term'):
            for v in value_rows(p,dict(r,body=s)):
                if v['value'].get('invalid'):block('B3',v['value']['label'])
                else:values.append(v);hits.append(proof(r,v['value']['label']))
        else:
            for g in groups:
                if r.get('list_header') and r.get('list_valid') or r.get('table_context') and r.get('list_header'):continue
                context=s
                if not test(g['rule'].get('object'),context) and (r.get('source') or {}).get('table'):context=r['heading']+s
                if not (test(g['rule'].get('object'),context) and test(g['rule'].get('action'),s) and not deny(s,p)):continue
                if p['id']=='PRIV-07' and match(r'기관경고|형사처벌|제재.{0,20}받은|감독규정',s) and not match(r'점검할수|실태를점검|점검에.{0,8}협조',s):continue
                if kind=='ip' and match('기존|기보유|계약전|종전',s) and not match('산출물|성과물|개발결과|납품물',s):continue
                if kind=='sales_supervision' and not match('모집|보험판매|판매대리|보험대리|판매업무|판매수탁',r['document_text']):continue
                if r.get('unresolved_table'):block('B1','해당 약정의 표 주체·대상·행 구조를 확인할 수 없음');continue
                g['hits'].extend(proof(intro,'목록·표의 대상 및 주체') for intro in r.get('list_intros') or [])
                g['hits'].append(proof(r,g['rule']['label']));parsed=Q.parse_all(s,r['aliases'])
                out['tag_evidence'].append({'document':r['document'],'text':r['text'],'tags':ex['tags']+[{'label':g['rule']['label'],'type':'content','check_id':p['id']}],'facts':[f['facts'] for f in parsed] if parsed else [],'method':'current_text_tag_alias' if ex['tags'] else 'structured_requirements' if parsed else 'current_clause_elements'})
    if p.get('same_section') and groups:
        common=[{(h['document_index'],h['domain'],h['section_index']) for h in g['hits']} for g in groups]
        if not set.intersection(*common):out['missing'].append('감독기관의 요구와 협조 의무의 같은 조 내 연결')
    for g in groups:
        if g['hits']:out['elements'].append(g['rule']['label']);hits.extend(g['hits'])
        else:out['missing'].append(g['rule']['label'])
    hits.extend(conditional_hits)
    if kind=='court':
        by_doc={}
        for v in values:by_doc.setdefault(v['row']['document_index'],[]).append(v)
        for vs in by_doc.values():
            if len({v['value']['key'] for v in vs})>1 and sum(bool(match('전속|제1심|관할법원',v['row']['body'])) for v in vs)>1 and not any(match('우선적용|대체|변경',v['row']['body']) for v in vs):out['blockers'].append(problem('B3','같은 분쟁의 관할 지정이 충돌함',vs[1]['row']))
    if kind in ('vat','price'):
        buckets={}
        for v in values:
            doc=prepared['documents'][v['row']['document_index']];scope=doc.get('contract_scope') or doc.get('scope_id') or ('document:'+str(v['row']['document_index']) if doc.get('independent') else 'current_contract')
            if kind=='price' and not match('^(?:amount|rate):',v['value']['key']):continue
            k=scope+':'+v['value']['bucket']+(':'+v['value']['key'].split(':')[0] if kind=='price' else '')
            buckets.setdefault(k,[]).append(v)
        for vs in buckets.values():
            if len({v['value']['key'] for v in vs})>1 and not any(match(r'변경(?:한|후|전)|증액분|감액분|우선적용|대체한다',v['row']['body']) for v in vs):out['blockers'].append(problem('B3','같은 대가의 VAT 포함·별도 표시 충돌' if kind=='vat' else '같은 대가의 금액·산정 값 충돌',vs[1]['row']))
    if kind=='term':
        by_doc={}
        for v in values:
            if match(r'^\d+:\d+$',v['value']['key']) and not match('갱신|연장',v['row']['body']):by_doc.setdefault(v['row']['document_index'],[]).append(v)
        for vs in by_doc.values():
            if len({v['value']['key'] for v in vs})>1:out['blockers'].append(problem('B3','동일 계약기간의 날짜 충돌',vs[1]['row']))
    out['blockers'].extend(risk(p,[r for r in rows if relevant(p,r)],opts.get('scope'))+scoped_qualifiers(p,prepared,hits)+reference_problems(p,prepared,hits)+list_limitations(prepared,hits))
    if kind=='ip':
        ip_rows=[r for r in rows if any(h['document_index']==r['document_index'] and (h['sentence_index']==r['sentence_index'] or h['domain']==r['domain'] and h['section_index']==r['section_index'] and match('이를|그산출물|해당산출물',r['body']) and match('사용|이용|권리',r['body'])) for h in hits)]
        out['blockers'].extend(ip_problems(ip_rows,opts))
    seen=set()
    for h in hits:
        key=(h['document_index'],h['start'],h['end'])
        if key not in seen:out['evidence'].append(h);seen.add(key)
    seen=set();blockers=[]
    for h in out['blockers']:
        key=(h.get('document_index'),h.get('start'),h['code'])
        if key not in seen:blockers.append(h);seen.add(key)
    out['blockers']=blockers
    if not hits and not out['missing']:out['missing']=['분쟁해결 지정 내용' if kind=='court' else '부가가치세 처리 값' if kind=='vat' else '질문에 해당하는 약정 내용']
    out['eligible']=bool(out['evidence'] and not out['missing'] and not out['blockers'])
    out['status']='supported' if out['eligible'] else 'related_exception' if out['blockers'] else 'no_evidence'
    out['signature']=[e['element']+':'+c(e['text']) for e in out['evidence']]
    out['recognition']={'stage':'clause_found' if out['evidence'] else 'not_found','evidence':out['evidence']}
    return out


def recognize(check_id,text):
    if check_id not in profiles:return None
    r=evaluate({'id':check_id},[{'name':'문서','text':text}],{})
    return {'key':digest(r['signature']),'element':' · '.join(r['elements']) or r['evidence'][0]['element']} if r['eligible'] else None
