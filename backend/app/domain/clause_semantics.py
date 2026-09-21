"""Finite, full-sentence agreement grammar ported from clause-semantics-v8.

Every unconsumed qualifier prevents equivalence. Original sentences and scoped
aliases remain attached to facts; keywords alone never create a positive fact.
"""
import json
import re
import unicodedata
from pathlib import Path
from app.domain import evidence as E, tags as T, presence as Profiles, agreement_evidence as A, structure as Structure

VERSION = 'clause-semantics-v8'
DATA = json.loads((Path(__file__).resolve().parents[1]/'data/semantics-rules.json').read_text())
KNOWN_ROLES = DATA['knownRoles']
ROLE = DATA['role']
FRONT_CONDITIONS = DATA['frontConditions']
RESTRICTIONS = DATA['restrictionTargets']
QUESTION_TOPICS = DATA['questionTopics']
FRONT_PATTERN = re.compile('^('+'|'.join(FRONT_CONDITIONS)+')[,，]?('+ROLE+')(은|는|이|가)(.+)$')
SUBJECT = re.compile('^('+ROLE+')(?:은|는|이|가)')
QUOTED_ROLE = re.compile('[“"「]('+ROLE+')[”"」]')
DUTY = r'(?:하여야한다|해야한다|한다)'


def jsjson(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def compact(text):
    return re.sub(r'[\s\ufeff]+', '', unicodedata.normalize('NFC',str(text or '')))


def canonical_role(role, env=None):
    role=((env or {}).get('map') or {}).get(role) or role
    return '클라우드컴퓨팅서비스제공자' if role=='클라우드서비스제공자' else role


def aliases(documents=None):
    mapping,conflicts,definitions={},[],[]
    pattern=re.compile(r'(?<![가-힣A-Za-z0-9])('+ROLE+r')[（(]이하(?:에서)?[“"「]('+ROLE+r')[”"」](?:(?:이라|라)?(?:한다|함))?[）)]')
    plain_pattern=re.compile(r'^[“"「]?(갑|을)[”"」]?(?:은|는|이란|이라함은)[“"「]?('+'|'.join(KNOWN_ROLES)+r')[”"」]?(?:을|를)(?:말한다|의미한다)$')
    def assign(alias,target):
        if mapping.get(alias) and mapping[alias]!=target:
            if alias not in conflicts:conflicts.append(alias)
        else:mapping[alias]=target
    for doc in documents or []:
        for sentence in E.sentences([doc]):
            h=E.heading(sentence['text']);text=compact(sentence['text'][len(h['prefix']):] if h else sentence['text'])
            for m in pattern.finditer(text):
                a,b=m[1],m[2];alias=a if a in ('갑','을') else b;target=b if alias==a else a
                if alias not in ('갑','을') or target not in KNOWN_ROLES:continue
                assign(alias,target)
                definitions.append({'text':sentence['text'],'alias':alias,'role':target,'standalone':re.sub('[.。]$','',text)==m[0]})
            m=plain_pattern.search(re.sub('[.。]$','',text))
            if m:
                assign(m[1],m[2]);definitions.append({'text':sentence['text'],'alias':m[1],'role':m[2],'standalone':True})
    for alias in conflicts:mapping.pop(alias,None)
    return {'map':mapping,'conflicts':conflicts,'definitions':definitions}


def role_text(text,env=None):
    mapping=(env or {}).get('map') or {}
    text=re.sub(r'[“"「](갑|을)[”"」]',lambda m:canonical_role(m[1],env) if mapping.get(m[1]) else m[0],str(text))
    return re.sub(r'(^|[\s,(（])(갑|을)(?=은|는|이|가|의|에게|과|와|에)',lambda m:m[1]+canonical_role(m[2],env) if mapping.get(m[2]) else m[0],text)


def literal_scope(text,env=None):
    used=sorted(set(re.findall(r'(갑|을)(?=은|는|이|가|의|에게|과|와|에)',compact(role_text(text,env)))))
    return '|literal-aliases:'+jsjson([[a,((env or {}).get('map') or {}).get(a) or None] for a in used]) if used else ''


def grammar(s):
    substitutions=[(r'에대해','에대하여'),(r'를위해','를위하여'),(r'경우에는','경우'),
      (r'하여야할것이다$','하여야한다'),(r'하도록한다$','하여야한다'),
      (r'하여서는안되며$','하여서는아니되며'),(r'해서는안된다$','하여서는아니된다'),
      (r'암호화처리(?=하여야한다|해야한다|한다$)','암호화'),
      (r'기술적(?:[·ㆍ,]|및)?관리적보호조치를이행(?=하여야한다|해야한다|한다$)','기술적·관리적보호조치를실시'),
      (r'점검에협력(?=하여야한다|해야한다|한다$)','점검에협조'),(r'매년(?=[1-9][0-9]?회이상)','연'),
      (r'하여야만한다$','하여야한다'),(r'하여야할의무를부담한다$','하여야한다'),
      (r'(?:할의무를부담한다|할의무가있다|할의무를진다|하기로한다)$','해야한다'),
      (r'배상할책임(?:을진다|을부담한다|이있다)$','배상하여야한다'),
      (r'(?:하여서는안된다|해서는아니된다)$','하여서는아니된다')]
    for pattern,replacement in substitutions:s=re.sub(pattern,replacement,s)
    m=FRONT_PATTERN.search(s)
    if m:s=m[2]+m[3]+m[1]+m[4]
    if not SUBJECT.search(s):
        m=re.search(r'^(.+(?:을|를|에|에게|대하여|위하여))[,，]?('+ROLE+r')(은|는|이|가)(.+)$',s)
        if m:s=m[2]+m[3]+m[1]+m[4]
    return s


def result(topic,actor,fields,text,env=None):
    if (env or {}).get('conflicts'):return None
    facts=dict(topic=topic,actor=canonical_role(actor,env),**fields)
    mapping=(env or {}).get('map') or {}
    tag_text=re.sub('갑(?=[은는이가의])',lambda m:mapping.get('갑') or '갑',str(text))
    tag_text=re.sub('을(?=[은는이가의])',lambda m:mapping.get('을') or '을',tag_text)
    return {'facts':facts,'key':jsjson(facts),'tags':T.values(T.analyze_clause({'heading':'','body':tag_text},'')),'text':text}


def security_facts(rest):
    for row in DATA['securityRules']:
        if re.search(row['pattern'],rest):return row
    m=re.search(DATA['financialPattern'],rest)
    if m:return {'topic':'financial_monitoring','fields':{'object':'수탁자재무건전성평가·상시모니터링','action':'필요자료제공협조' if '제공에협조' in rest else '필요자료제공','minimum_per_year':int(m[1]),'modality':'obligation'}}
    return None


def scoped_restriction(s,text,env=None):
    m=re.search('^(?:다만[,，]?)?('+ROLE+')의('+'|'.join(RESTRICTIONS)+')의무는(긴급한경우|천재지변이발생한경우)(?:에는|에)?(적용하지않는다|적용하지아니한다|면제된다|에만적용한다)$',s)
    if not m:return None
    return result(RESTRICTIONS[m[2]][0],m[1],{'object':m[2],'action':m[4],'condition':m[3],'modality':'restriction','affected_topics':RESTRICTIONS[m[2]][:]},text,env)


def parse(text,env=None):
    h=E.heading(text);raw=str(text)[len(h['prefix']):] if h else str(text)
    s=re.sub('[.。]$','',re.sub('^[①-⑳]','',compact(raw)))
    if not s:return None
    s=QUOTED_ROLE.sub(r'\1',s)
    if re.search(r'[“”"「」]|�|_{2,}|\[\s*\]',s):return None
    s=grammar(s)
    restricted=scoped_restriction(s,text,env)
    if restricted:return restricted
    profile=Profiles.parse(s,env)
    if profile:return result(profile['topic'],profile['actor'],profile['fields'],text,env)
    m=re.search('^('+ROLE+')(?:이|가)개인정보(?:처리|관리)현황을점검하는경우('+ROLE+')(?:은|는)이에협조'+DUTY+'$',s)
    if m:return result('inspection',m[2],{'counterparty':canonical_role(m[1],env),'object':'개인정보','action':'점검협조','modality':'obligation'},text,env)
    subject=SUBJECT.search(s)
    if not subject:return None
    actor=subject[1];rest=original=s[subject.end():]
    security=security_facts(rest)
    if security:return result(security['topic'],actor,security['fields'],text,env)
    if re.search('^위탁업무를(?:처리할때|수행할때|처리함에있어)금융실명법등관련법령을준수'+DUTY+'$',rest):
        return result('law_compliance',actor,{'object':'위탁업무','action':'법령준수','laws':'금융실명법등관련법령','modality':'obligation'},text,env)
    m=re.search('^('+ROLE+')의(?:위탁)?업무처리현황점검[·,]자료제출요구및감사에협조'+DUTY+'$',rest)
    if m:return result('work_supervision',actor,{'counterparty':canonical_role(m[1],env),'object':'위탁업무처리현황','action':'점검·자료제출·감사협조','modality':'obligation'},text,env)
    m=re.search('^('+ROLE+')의(?:위탁)?업무처리현황을점검하고관련자료의제출을요구하며감사를실시할수있다$',rest)
    if m:return result('work_supervision_right',actor,{'counterparty':canonical_role(m[1],env),'object':'위탁업무처리현황','action':'점검·자료제출요구·감사','modality':'right'},text,env)
    if re.search('^감독당국의변경권고등조치가있는경우(?:본)?계약의?변경및시정에협조'+DUTY+'$',rest):
        return result('supervisory_correction',actor,{'object':'계약변경·시정','action':'협조','condition':'감독당국변경권고등조치','modality':'obligation'},text,env)
    for topic,pattern,obj in [
        ('cloud_importance',r'(?:클라우드이용업무의중요도평가에필요한자료(?:의)?제공에협조|클라우드이용업무의중요도평가를위하여필요한자료를제공)','클라우드이용업무중요도평가'),
        ('cloud_soundness',r'(?:클라우드컴퓨팅서비스제공자|클라우드서비스제공자)의건전성(?:·|,|및)안전성평가(?:에필요한자료(?:의)?제공에협조|를위하여필요한자료를제공)','클라우드제공자건전성·안전성평가')]:
        if re.search('^'+pattern+DUTY+'$',rest):return result(topic,actor,{'object':obj,'action':'필요자료제공협조' if '제공에협조' in rest else '필요자료제공','modality':'obligation'},text,env)
    m=re.search(r'^(?:(?:자신이|수탁자가)제공하는)?서비스의품질수준(?:에대한)?연([1-9][0-9]?)회이상평가에협조'+DUTY+'$',rest)
    if not m:m=re.search(r'^연([1-9][0-9]?)회이상실시하는(?:(?:자신이|수탁자가)제공하는)?서비스의품질수준평가에협조'+DUTY+'$',rest)
    if m:return result('service_quality',actor,{'object':'제공서비스품질수준평가','action':'협조','minimum_per_year':int(m[1]),'modality':'obligation'},text,env)
    def take(pattern):
        nonlocal rest
        m=re.search(pattern,rest)
        if m:rest=rest[:m.start()]+rest[m.end():]
        return m
    def consume(parts):
        for part in parts:
            if not take(part):return False
        return not rest
    def done(topic,fields):return result(topic,actor,fields,text,env) if not rest else None
    if take(r'재위탁(?:할수없다|하여서는아니된다|해서는안된다|하지못한다)$'):
        owner=take('('+ROLE+')의');consent=take('동의없이');prior=take('사전(?:에)?');written=take('서면(?:으로)?');take('(?:본계약상의|본계약상|위탁받은)?업무를')
        if owner and consent and prior:return done('prior_consent',{'counterparty':canonical_role(owner[1],env),'object':'업무','action':'재위탁','modality':'consent_required','prior':True,'written':bool(written)})
        return None
    rest=original
    if take('(?:받아야한다|얻어야한다|받는다)$'):
        action=take('(?:업무를)?재위탁(?:하려면|하려는경우|하기전에|에앞서|하는경우|할경우)');owner=take('('+ROLE+')의');consent=take('동의를');prior=take('사전에|미리|사전');written=take('서면으로|서면')
        if action and owner and consent and (prior or re.search('하려면|하려는경우|하기전에|앞서',action[0])):
            return done('prior_consent',{'counterparty':canonical_role(owner[1],env),'object':'업무','action':'재위탁','modality':'consent_required','prior':True,'written':bool(written)})
    rest=original
    if not take(DUTY+'$'):return None
    if take('협조$'):
        owner=take('('+ROLE+')의');obj=take('개인정보(?:처리|관리)현황(?:에대한)?점검에')
        return done('inspection',{'counterparty':canonical_role(owner[1],env),'object':'개인정보','action':'점검협조','modality':'obligation'}) if owner and obj else None
    rest=re.sub(DUTY+'$','',original)
    if take('(?:취|실시|시행)$'):
        obj=take('개인정보(?:의안전한처리를위하여|보호를위하여|에대한)?');measures=take('기술적(?:[·ㆍ,]|및)?관리적보호조치를')
        return done('protection',{'object':'개인정보','action':'기술적·관리적보호조치','modality':'obligation'}) if obj and measures else None
    rest=re.sub(DUTY+'$','',original)
    if take('암호화$'):
        return done('encryption',{'object':'제공받은개인신용정보식별정보','action':'암호화','modality':'obligation'}) if consume(['제공받은','개인신용정보의식별정보를']) else None
    rest=re.sub(DUTY+'$','',original)
    limit=take('제한$');grant=not limit and take('부여$')
    if limit or grant:
        obj=take('개인정보에대한접근권한을');scope=take('업무수행에필요한최소한(?:의)?범위에서만' if grant else '업무수행에필요한최소한(?:의)?범위로')
        if obj and scope:return done('least_access',{'object':'개인정보접근권한','action':'최소권한','modality':'obligation','purpose':'업무수행'})
    rest=original
    if consume(['개인정보에대한','(?:접근권한|접근)을','제한'+DUTY+'$']):return done('access_control',{'object':'개인정보접근','action':'접근제한','modality':'obligation'})
    return None


def parse_all(text,env=None):
    single=parse(text,env)
    if single:return [single]
    h=E.heading(text);s=compact(str(text)[len(h['prefix']):] if h else text)
    s=grammar(QUOTED_ROLE.sub(r'\1',re.sub('[.。]$','',re.sub('^[①-⑳]','',s))))
    subject=SUBJECT.search(s)
    if not subject:return None
    parts=re.split(r'((?:암호화|제한|협조|실시|시행|부여|취|수립|사용|준수|제공|운영|고지|배상|보증|제거|인도|통지|보관|예탁|운용|교부|응)(?:하(?:고|며)|하여야하며))[,，]?',s)
    if len(parts)<3 or len(parts)>11:return None
    out=[]
    for i in range(0,len(parts),2):
        clause=parts[i]+(re.sub('(?:하(?:고|며)|하여야하며)$','한다',parts[i+1]) if i+1<len(parts) and parts[i+1] else '')
        value=parse(clause if SUBJECT.search(clause) else subject[0]+clause,env)
        if not value:return None
        out.append(value)
    return out


def key(text,env=None):
    facts=parse_all(text,env)
    return 'semantic:'+jsjson(sorted(f['key'] for f in facts)) if facts else None


def keys(text,env=None):
    facts=parse_all(text,env)
    return ['semantic:'+jsjson([f['key']]) for f in facts] if facts else None


def alias_definition(text,env=None):
    return any(d.get('standalone') and d['text']==text for d in (env or {}).get('definitions',[]))


def independent_exception(check_id,text,env=None):
    topics=QUESTION_TOPICS.get(check_id)
    if not topics or not re.search(r'^\s*다만[,，]?',text):return False
    facts=parse_all(re.sub(r'^\s*다만[,，]?\s*','',str(text)),env)
    return bool(facts) and all(not any(t in topics for t in f['facts'].get('affected_topics',[f['facts']['topic']])) for f in facts)


def contexts(documents=None):
    documents=documents or []
    maps=[Structure.inspect(unicodedata.normalize('NFC',d.get('text') or ''),d.get('extraction')) for d in documents]
    cursors,groups,rows={},{},[]
    for unit in A.units(documents):
        di=unit['document_index'];mapping=maps[di];i=cursors.get(di,0)
        while i+1<len(mapping['lines']) and mapping['lines'][i+1]['offset']<=unit['start']:i+=1
        cursors[di]=i
        line=mapping['lines'][i] if mapping['lines'] else {}
        region=next((s for s in mapping['sections'] if s['id']==line.get('section')),mapping['sections'][0])
        domain=str(di)+':'+region['id']
        row=dict(unit,domain=domain,region=region,boundary=bool(line.get('boundary')))
        groups.setdefault(domain,[]).append(row);rows.append(row)
    scopes,conflicts={},[]
    for domain,group in groups.items():
        env=aliases([{'text':'\n'.join(s['text'] for s in group if not s['boundary'])}]);scopes[domain]=env
        conflicts.extend({'domain':domain,'alias':a} for a in env['conflicts'])
        for row in group:row['aliases']=env
    paragraphs={}
    for s in rows:
        k=s['domain']+':'+str(s['section_index']);h=E.heading(s['text'])
        m=re.search('^([①-⑳])',(s['text'][len(h['prefix']):] if h else s['text']).strip())
        if m:paragraphs[k]={'number':ord(m[1])-ord('①')+1,'anchor':s['sentence_index']}
        p=paragraphs.get(k,{})
        s.update(paragraph_number=p.get('number',0),paragraph_anchor=p.get('anchor'),paragraph_start=bool(m))
    annotate_tables(rows,documents);annotate_lists(rows);annotate_conditions(rows);annotate_continuations(rows)
    return {'rows':rows,'scopes':scopes,'conflicts':conflicts}


def annotate_conditions(rows):
    intro=re.compile('^('+ROLE+')(?:은|는|이|가)('+'|'.join(FRONT_CONDITIONS)+')(?:다음의|아래의)(?:의무|사항)를(?:이행|준수)'+DUTY+'[:.]?$')
    for i,root in enumerate(rows):
        if root.get('list_id') or root['boundary']:continue
        h=E.heading(root['text']);m=intro.search(re.sub('^[①-⑳]','',compact(root['text'][len(h['prefix']):] if h else root['text'])))
        if not m:continue
        entries=[];valid=True
        for s in rows[i+1:]:
            if s['domain']!=root['domain'] or s['section_index']!=root['section_index'] or s['paragraph_start'] or s['boundary'] or E.heading(s['text']):break
            if s.get('list_id'):valid=False;break
            body=re.sub('^(?:또한|아울러)[,，]?','',compact(s['text']));subject=SUBJECT.search(body)
            if subject:
                if canonical_role(subject[1],root['aliases'])!=canonical_role(m[1],root['aliases']):valid=False
                body=body[subject.end():]
            expanded=m[1]+'는'+('' if body.startswith(m[2]) else m[2])+body
            if not parse_all(expanded,s['aliases']):valid=False
            entries.append((s,expanded))
        if not entries:continue
        root.update(list_id=root['domain']+':condition:'+str(root['sentence_index']),list_header=True,list_valid=valid,list_path=[],context_kind='condition')
        for s,expanded in entries:
            s.update(list_id=root['list_id'],list_valid=valid,list_path=[],list_intros=[root],context_kind='condition')
            if valid:s['semantic_text']=expanded
    for i in range(1,len(rows)):
        s,prev=rows[i],rows[i-1]
        if prev.get('list_id') or s.get('list_id') or s['boundary'] or s['paragraph_start'] or E.heading(s['text']) or s['domain']!=prev['domain'] or s['section_index']!=prev['section_index'] or s['paragraph_anchor']!=prev['paragraph_anchor']:continue
        if not re.search(r'^다만[,，]?금융위원회가인정한경우(?:에는)?그러하지아니하다[.]?$',compact(s['text'])):continue
        fs=parse_all(prev['text'],prev['aliases'])
        if not fs or len(fs)!=1 or fs[0]['facts']['topic']!='credit_subcontract' or fs[0]['facts'].get('condition'):continue
        combined=fs[0]['facts']['actor']+'는 금융위원회가 인정한 경우를 제외하고 신용정보 처리 업무를 재위탁하여서는 아니 된다.'
        if not parse_all(combined,prev['aliases']):continue
        prev.update(semantic_text=combined,list_id=prev['domain']+':exception:'+str(prev['sentence_index']),list_valid=True,list_intros=[s],list_path=[])
        s.update(list_id=prev['list_id'],list_valid=True,list_header=True,list_path=[])


def annotate_continuations(rows):
    for i in range(1,len(rows)):
        s,prev=rows[i],rows[i-1]
        if s.get('list_id') or prev.get('list_id') or s['boundary'] or E.heading(s['text']) or s['paragraph_start'] or s['domain']!=prev['domain'] or s['section_index']!=prev['section_index'] or s['paragraph_anchor']!=prev['paragraph_anchor']:continue
        continuation=re.search(r'^(?:또한|아울러)[,，]?\s*(.+)$',s['text'])
        if not continuation:continue
        earlier=parse_all(prev.get('semantic_text') or prev['text'],prev['aliases']);body=continuation[1]
        if not earlier or any(f['facts'].get('condition') for f in earlier) or len({f['facts']['actor'] for f in earlier})!=1:continue
        pointed=re.search(r'위\s*(개인신용정보|개인정보)',body)
        if pointed:
            if not all(pointed[1] in (f['facts'].get('object') or '') and (pointed[1]!='개인정보' or '개인신용정보' not in f['facts']['object']) for f in earlier):continue
            body=re.sub(r'위\s*(개인신용정보|개인정보)',r'\1',body)
        expanded=body if re.search('^[“"「]?'+ROLE+'[”"」]?(?:은|는|이|가)',compact(body)) else earlier[0]['facts']['actor']+'는 '+body
        if not parse_all(expanded,s['aliases']):continue
        s.update(semantic_text=expanded,context_links=[prev],list_intros=(prev.get('list_intros') or [])+[prev])


def annotate_tables(rows,documents):
    tables={}
    for s in rows:
        t=(s.get('source') or {}).get('table')
        if t:tables.setdefault(str(s['document_index'])+':'+t['id'],[]).append(s)
    for table_id,group in tables.items():
        by_row={};valid=True;headers=[];outputs=[]
        for s in group:
            t=s['source']['table']
            if t.get('invalid') or t.get('merged') or t.get('colspan')!=1 or t.get('rowspan')!=1 or type(t.get('row')) is not int or type(t.get('col')) is not int or t['row']<0 or t['col']<0 or t['col']>8:valid=False
            by_row.setdefault(t.get('row'),{}).setdefault(t.get('col'),[]).append(s)
        first=by_row.get(0)
        if not first:continue
        for c in range(len(first)):
            cell=first.get(c);headers.append(Structure.table_header(cell[0]['text']) if cell and len(cell)==1 else None)
        if 'actor' not in headers or 'action' not in headers:continue
        if any(not h for h in headers) or len(set(headers))!=len(headers) or len({s['domain']+':'+str(s['section_index']) for s in group})!=1:valid=False
        extraction=documents[group[0]['document_index']].get('extraction') or {}
        if any(((b.get('source') or {}).get('table') or {}).get('id')==group[0]['source']['table']['id'] and not b['text'].strip() for b in extraction.get('blocks',[])):valid=False
        for r in range(1,len(by_row)):
            cells=by_row.get(r);fields={}
            if not cells or len(cells)!=len(headers):valid=False;continue
            for c,h in enumerate(headers):
                cell=cells.get(c)
                if not cell:valid=False;continue
                if len({s['source'].get('cell') for s in cell})!=1:valid=False
                fields[h]=' '.join(s['text'] for s in cell)
            actor=compact(fields.get('actor'));condition=compact(fields.get('condition'));obj=compact(fields.get('object'));action=compact(fields.get('action'))
            explicit=SUBJECT.search(action)
            if explicit:
                if canonical_role(explicit[1],group[0]['aliases'])!=canonical_role(actor,group[0]['aliases']):valid=False
                action=action[explicit.end():]
            if condition and action.startswith(condition):action=action[len(condition):]
            expanded=actor+'는'+condition+(obj if obj and not action.startswith(obj) else '')+action
            if not re.fullmatch(ROLE,actor) or condition and condition not in FRONT_CONDITIONS or not parse_all(expanded,group[0]['aliases']):valid=False
            carrier=cells.get(headers.index('action'))
            if carrier:outputs.append((carrier[-1],expanded))
        if not outputs:valid=False
        for s in group:s.update(list_id='table:'+table_id,list_valid=valid,list_header=True,list_path=[],list_intros=[],table_context=True)
        if valid:
            for row,expanded in outputs:
                row.update(list_header=False,semantic_text=expanded,list_intros=[s for s in group if s is not row and (s['source']['table']['row']==0 or s['source']['table']['row']==row['source']['table']['row'])])


LETTERS='가나다라마바사아자차카타파하'


def list_marker(text):
    m=re.search(r'^\s*(?:([1-9][0-9]?|[가나다라마바사아자차카타파하])\s*([.)])|\(([1-9][0-9]?|[가나다라마바사아자차카타파하])\))\s*(\S[\s\S]*)$',str(text))
    if not m:return None
    token=m[1] or m[3];letter=token in LETTERS
    return {'number':LETTERS.index(token)+1 if letter else int(token),'token':token if letter else int(token),'kind':'목' if letter else '호','style':'()' if m[3] else m[2],'body':m[4]}


def annotate_lists(rows):
    subject=re.compile('^[“"「]?('+ROLE+')[”"」]?(?:은|는|이|가)')
    action='(?:협조|실시|시행|취|수립|사용|준수|운영|제공|고지|배상|보증|제거|인도|통지|보관|보존|예탁|운용|교부|허용|제한|암호화|재위탁|변경|유출|응|인수|확보)'
    nominal=re.compile(action+'$');nominal_end=re.compile(action+'할것$')
    def header(text,parent=None):
        content=grammar(re.sub('(?:준수|이행)할것$',lambda m:m[0].replace('할것','하여야한다'),re.sub('[.。:]$','',re.sub('^[①-⑳]','',compact(text)))))
        m=subject.search(content);actor=m[1] if m else (parent or {}).get('actor')
        if not actor:return None
        if m:content=content[m.end():]
        condition=next((c for c in FRONT_CONDITIONS if content.startswith(c)),'')
        if condition:content=re.sub('^[,，]','',content[len(condition):])
        positive=re.search(r'^(?:다음|아래)각(호|목|세목)의(?:사항을|의무를)(?:모두)?(?:준수|이행)'+DUTY+'$',content)
        negative=re.search(r'^(?:다음|아래)각(호|목|세목)의행위를(?:하여서는아니된다|해서는안된다|할수없다)$',content)
        if not positive and not negative:return None
        return {'actor':actor,'condition':condition,'prohibition':bool(negative),'kind':(positive or negative)[1]}
    for i,root in enumerate(rows):
        if root['boundary'] or root.get('list_id'):continue
        h=E.heading(root['text']);spec=header(root['text'][len(h['prefix']):] if h else root['text'])
        if not spec or spec['kind']!='호':continue
        valid=True;entries=[{'row':root,'header':True,'path':[],'intros':[]}];env=root['aliases']
        def same(s):return s['domain']==root['domain'] and s['section_index']==root['section_index'] and s['paragraph_anchor']==root['paragraph_anchor'] and not s['boundary'] and not E.heading(s['text'])
        def children(at,parent,path,intros):
            nonlocal valid
            count=0;style='';next_index=at
            while next_index<len(rows):
                child=rows[next_index]
                if not same(child):break
                marker=list_marker(child['text'])
                if not marker:break
                if parent['kind']=='목' and marker['kind']=='호':break
                if parent['kind']=='세목':
                    if marker['kind']=='목' or marker['kind']=='호' and marker['style']!='()':break
                    if marker['kind']=='호' and marker['style']=='()':marker['kind']='세목'
                count+=1
                if marker['kind']!=parent['kind'] or marker['number']!=count or style and style!=marker['style']:valid=False
                style=marker['style'];entry={'row':child,'path':path+[marker['token']],'intros':intros[:],'marker':marker};nested=header(marker['body'],parent)
                entries.append(entry);next_index+=1
                if nested and ((parent['kind']=='호' and nested['kind']=='목') or (parent['kind']=='목' and nested['kind']=='세목')):
                    entry['header']=True
                    if canonical_role(nested['actor'],env)!=canonical_role(parent['actor'],env) or parent['prohibition'] and not nested['prohibition']:valid=False
                    if parent['condition'] and nested['condition'] and parent['condition']!=nested['condition']:valid=False
                    nested['condition']=nested['condition'] or parent['condition']
                    next_index=children(next_index,nested,entry['path'],intros+[child]);continue
                content=re.sub('[.。;]$','',compact(marker['body']));explicit=subject.search(content)
                if explicit:
                    if canonical_role(explicit[1],env)!=canonical_role(parent['actor'],env):valid=False
                    content=content[explicit.end():]
                if nominal_end.search(content):content=re.sub('할것$','하여야한다',content)
                elif nominal.search(content):content+='하여서는아니된다' if parent['prohibition'] else '하여야한다'
                content=grammar(content)
                if parent['condition'] and not content.startswith(parent['condition']):content=parent['condition']+content
                entry['expanded']=parent['actor']+'는'+content;parsed=parse_all(entry['expanded'],env)
                if not parsed or any(canonical_role(parent['actor'],env)!=f['facts']['actor'] or (f['facts']['modality']!='prohibition' if parent['prohibition'] else f['facts']['modality'] not in ('obligation','prohibition','consent_required')) for f in parsed):valid=False
            if not count:valid=False
            return next_index
        children(i+1,spec,[],[root])
        if len(entries)==1:continue
        list_id=root['domain']+':list:'+str(root['sentence_index'])
        for entry in entries:
            row=entry['row'];row.update(list_id=list_id,list_header=bool(entry.get('header')),list_valid=valid,list_path=entry['path'],list_intros=entry['intros'])
            marker=entry.get('marker') or {}
            if marker.get('kind')=='호':row['list_number']=marker['number']
            if marker.get('kind')=='목':row['list_letter']=marker['token']
            if marker.get('kind')=='세목':row['list_subnumber']=marker['number']
            if entry['intros']:row['list_intro']=entry['intros'][0]
            if valid and entry.get('expanded'):row['semantic_text']=entry['expanded']
