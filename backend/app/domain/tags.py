"""Native Python contract tag profile 1.1.0 and its matching adapter.

Rule data is exported once from the frozen vendor profile; no JS is evaluated.
"""
import json
from pathlib import Path
import re
from app.domain.similarity import units, ununits
from app.domain.structure import trim

PROFILE=json.loads((Path(__file__).parents[1]/'data/domain-rules.json').read_text(encoding='utf-8'))['tags']
RULES={facet:[{**rule,'regex':re.compile(rule['pattern'].replace(r'\d','[0-9]'),re.I if 'i' in rule['flags'] else 0)} for rule in rules] for facet,rules in PROFILE['rules'].items()}
WEIGHTS={'topics':4,'actors':6,'actions':4,'objects':4,'modalities':8,'conditions':6,'provisions':12}


def ids(value):
    return [v if isinstance(v,str) else v['id'] for v in value or [] if v and (isinstance(v,str) or v.get('id'))] if isinstance(value,list) else []


def scan_sources(sources):
    store={}
    for source,raw in sources:
        text=units(raw)
        for facet,rules in RULES.items():
            for rule in rules:
                for match in rule['regex'].finditer(text):
                    key=facet+':'+rule['id']
                    tag=store.setdefault(key,{'id':rule['id'],'label':rule['label'],'facet':facet,'score':0,'sources':[],'evidence':[],'occurrences':0,'status':'direct'})
                    tag['score']=min(100,max(tag['score'],62+PROFILE['weights'][source])+min(8,tag['occurrences']*2))
                    if source not in tag['sources']: tag['sources'].append(source)
                    tag['occurrences']+=1
                    if len(tag['evidence'])<8:
                        excerpt=trim(re.sub(r'\s+',' ',text[max(0,match.start()-30):min(len(text),match.end()+45)]))
                        tag['evidence'].append({'source':source,'text':ununits(excerpt),'at':match.start(),'match':ununits(match[0])})
    tags=[{**tag,'score':min(100,tag['score']+(6 if len(tag['sources'])>1 else 0))} for tag in store.values()]
    tags.sort(key=lambda t:(-t['score'],t['facet'],t['id']))
    return {'facets':{facet:[t for t in tags if t['facet']==facet] for facet in RULES},'tags':tags}


def heading_parts(value):
    heading=trim(value or '')
    match=re.search(r'^\s*제\s*[0-9]+\s*조(?:의\s*[0-9]+)?\s*(?:\(([^)\n]+)\))?\s*',heading)
    if match: return trim(match[1] or ''),trim(heading[match.end():])
    if len(units(heading))<=80 and not re.search(r'[.!?。\n]|(?:한다|된다|아니한다|있다|없다)\s*$',heading):
        return heading,''
    return '',heading


def proposition_units(value):
    return [trim(t) for t in re.split(r'\n+|(?<=[.!?。])\s+|(?=[①-⑳])',re.sub(r'\r\n?','\n',value or '')) if trim(t)]


def extract_analysis(value=None):
    value=value or {}
    sources=[('document_title',value.get('documentTitle') or value.get('title') or ''),
             ('clause_heading',value.get('clauseHeading') or value.get('heading') or ''),
             ('clause_body',value.get('clauseBody') or value.get('body') or value.get('text') or '')]
    scanned=scan_sources([(k,v) for k,v in sources if trim(v)])
    context,remainder=heading_parts(sources[1][1])
    raw=[('clause_heading',t) for t in proposition_units(remainder)]+[('clause_body',t) for t in proposition_units(sources[2][1])]
    frames=[]
    for index,(source,text) in enumerate(raw):
        frame_scan=scan_sources([(source,' '.join(filter(None,[context,text])))])
        frames.append({'id':'frame-'+str(index+1),'source':source,'at':index,'text':text,'headingContext':context,**frame_scan})
    return {'profileVersion':PROFILE['profileVersion'],**scanned,'frames':frames}


def values(analysis=None):
    return {facet:ids(((analysis or {}).get('facets') or {}).get(facet)) for facet in RULES}


def compare_signatures(requirement=None,observed=None):
    requirement,observed=requirement or {},observed or {}
    required=requirement.get('requiredFacets') or requirement.get('required_facets') or []
    matches,missing,conflicts,score={},[],[],0
    for facet,weight in WEIGHTS.items():
        wanted,seen=ids(requirement.get(facet)),ids(observed.get(facet))
        common=[i for i in wanted if i in seen]
        matches[facet]=common
        if common: score+=weight*min(2,len(common))
        if facet in required and wanted and not common: missing.append(facet)
    for wanted in ids(requirement.get('modalities')):
        for seen in ids(observed.get('modalities')):
            if seen in PROFILE['conflicts'].get(wanted,[]):
                conflicts.append({'facet':'modalities','required':wanted,'observed':seen})
    score-=len(conflicts)*12
    return {'score':score,'matches':matches,'missing':missing,'conflicts':conflicts,'eligible':not missing and not conflicts}


def compare_frames(requirement=None,frames=None):
    candidates=[]
    for frame in frames or []:
        compact={k:frame[k] for k in ['id','source','at','text'] if k in frame}
        compact['headingContext']=frame.get('headingContext') or ''
        candidates.append({'frame':compact,**compare_signatures(requirement,frame.get('facets'))})
    candidates.sort(key=lambda c:(-int(c['eligible']),-c['score'],len(c['missing']),len(c['conflicts'])))
    if not candidates: return {**compare_signatures(requirement,{}),'eligible':False,'bestFrame':None,'candidates':[]}
    best=candidates[0]
    return {**{k:v for k,v in best.items() if k!='frame'},'bestFrame':best['frame'],'candidates':candidates[:5]}


def analyze_clause(clause=None,doc_title=None):
    clause=clause or {}
    return extract_analysis({'documentTitle':doc_title or '','clauseHeading':clause.get('heading') or '','clauseBody':clause.get('body') or ''})


def match_clause(check,clause,doc_title=None):
    signature=(check or {}).get('tag_signature')
    if not signature or signature.get('status')!='curated': return None
    analysis=analyze_clause(clause,doc_title)
    observed=values(analysis)
    aggregate=compare_signatures(signature,observed)
    comparison=compare_frames(signature,analysis['frames'])
    conflicts=comparison['conflicts'][:]
    for facet,blocked in (signature.get('avoid') or {}).items():
        hits=[tag for tag in observed.get(facet,[]) if tag in (blocked or [])]
        if hits: conflicts.append({'facet':facet,'expected':'avoid','observed':hits})
    evidence=analysis['tags']
    if comparison['bestFrame']:
        selected=next((f for f in analysis['frames'] if f['id']==comparison['bestFrame']['id']),None)
        if selected: evidence=selected['tags']
    return {'profileVersion':analysis['profileVersion'],'score':comparison['score'],'eligible':comparison['eligible'],
            'comparisonBasis':'proposition_frame','aggregateEligible':aggregate['eligible'],
            'matches':comparison['matches'],'missing':comparison['missing'],'conflicts':conflicts,
            'bestFrame':comparison['bestFrame'],'frameCandidates':comparison['candidates'],'observed':observed,
            'evidence':[{k:t[k] for k in ('facet','id','score')}|{'evidence':t['evidence'][:2]} for t in evidence[:12]]}


def detect_data_relationship(clauses,doc_title=None):
    outsourcing,third,prohibited=[],[],[]
    title=doc_title or ''
    pending=[]
    for clause in clauses or []:
        heading=clause.get('heading') or ''
        raw=('' if re.search(r'^\((?:전문|전체)\)$',heading) else heading+'\n')+(clause.get('body') or '')
        for sentence in re.split(r'(?:\n+|(?<=[.!?다]))\s+',raw):
            if trim(sentence): pending.append({'clauseIndex':clause.get('index'),'heading':heading,'text':trim(sentence)})
    def add(bucket,unit,reason):
        if len(bucket)<8:
            bucket.append({'clauseIndex':unit['clauseIndex'],'heading':unit['heading'],'reason':reason,'quote':ununits(units(unit['text'])[:180])})
    for unit in pending:
        text=unit['text']
        observed=values(analyze_clause({'heading':unit['heading'],'body':text},title))
        if not ('personal_information' in observed['topics'] or 'personal_information' in observed['objects'] or re.search(r'고객정보|개인(?:신용)?정보|신용정보',text)): continue
        if re.search(r'처리\s*업무.{0,12}위탁|개인정보\s*처리위탁|업무위탁계약|위탁업무|위탁받은\s*업무|수탁자|재수탁자',text):
            add(outsourcing,unit,'개인정보 처리위탁·수탁 관계 문언')
        provide='provide' in observed['actions'] or re.search(r'제3자.{0,16}제공|제휴사.{0,16}제공|정보.{0,12}제공',text)
        forbid='prohibition' in observed['modalities'] or re.search(r'제3자.{0,24}(?:제공|누설).{0,18}(?:아니|안\s*된다|금지|할\s*수\s*없)',text)
        if provide and forbid:
            add(prohibited,unit,'제3자 제공·누설 금지 문언')
            continue
        strong=re.search(r'제공받는\s*자|제공받는\s*자의\s*이용\s*목적|제3자\s*제공.{0,18}동의|제3자에게.{0,18}제공(?:한다|할\s*수\s*있다)|제휴사에게.{0,18}제공|자체\s*목적|독자적으로',text) or (re.search(r'수집.{0,10}이용.{0,10}제공',text) and '동의' in text)
        if provide and strong: add(third,unit,'독립적 제3자 제공·동의 문언')
    if re.search(r'개인(?:신용)?정보\s*보안관리\s*약정서|정보보안관리\s*약정서',title):
        outsourcing.insert(0,{'clauseIndex':None,'heading':title,'reason':'표준 보안관리약정서 문서명','quote':title})
    evidence={'processing_outsourcing':outsourcing,'third_party_provision':third,'third_party_provision_prohibited':prohibited}
    return {'kind':'mixed' if third and outsourcing else 'third_party_provision' if third else 'processing_outsourcing' if outsourcing else 'unknown',
            'tags':{k:bool(v) for k,v in evidence.items()},'evidence':evidence}
