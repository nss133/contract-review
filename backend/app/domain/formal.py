"""Port of the existing company-name checks; reference values are unchanged."""
import re
from app.domain.similarity import units, ununits

REP_NAMES = ['김재식', '황문규']
ADDR_CANON = '서울시 마포구 만리재로 24'


def jamo_seq(text):
    out = []
    for char in units(text):
        code = ord(char)
        value = code - 0xac00
        if not 0 <= value <= 11171:
            out.append(code)
            continue
        out.extend([value // 588, 100 + (value % 588) // 28])
        if value % 28: out.append(200 + value % 28)
    return out


def levenshtein(a,b):
    previous = list(range(len(b)+1))
    for i, ac in enumerate(a,1):
        current = [i]
        for j,bc in enumerate(b,1):
            current.append(min(previous[j]+1, current[j-1]+1, previous[j-1]+(ac!=bc)))
        previous = current
    return previous[-1]


def rep_match(candidate):
    exact, best = False, float('inf')
    for rep in REP_NAMES:
        variants = [candidate] + ([candidate[:len(rep)]] if len(candidate)>len(rep) else [])
        for variant in variants:
            exact = exact or variant == rep
            best = min(best, levenshtein(jamo_seq(variant), jamo_seq(rep)))
    return exact, best


def check_formal(text):
    text = units(text or '')
    ours = [m.start() for m in re.finditer('미래에셋생명',text)]
    def near(index): return any(abs(index-i)<=200 for i in ours)
    result=[]
    def add(identifier,title,status,detail): result.append({'id':identifier,'title':title,'status':status,'detail':ununits(detail)})
    if re.search(r'미래에셋생명보험\s*(?:㈜|주식회사|\(주\))|(?:주식회사|㈜)\s*미래에셋생명보험',text):
        status, detail = 'pass','정식 상호 확인'
    elif re.search(r'\(이하\s*"?미래에셋생명"?이?라\s*한다\)',text):
        status, detail = 'pass','정식 상호 + 별칭 선언 확인'
    else:
        bad=re.findall(r'미래에셋생명(?!보험)',text)
        if bad: status,detail='warn',"'미래에셋생명' 뒤 '보험' 누락 의심 %d곳 — 정식 상호: 미래에셋생명보험㈜/주식회사" % len(bad)
        elif '미래에셋생명보험' in text: status,detail='warn','법인 형태(㈜·주식회사) 표기 확인 필요'
        else: status,detail='pass','당사 상호 미등장'
    add('FORM-NAME','당사 상호 표기',status,detail)
    warns, exact=[],False
    for m in re.finditer(r'대\s*표\s*이\s*사',text):
        if not near(m.start()): continue
        name=re.search(r'^[ \t]*\n?[ \t]*((?:[가-힣][ \t]*){2,4})(?![가-힣])',text[m.end():m.end()+40])
        if not name: continue
        candidate=re.sub('[ \t]+','',name[1])
        matched,distance=rep_match(candidate)
        if matched: exact=True
        elif distance==1 and candidate not in warns: warns.append(candidate)
    if warns: status,detail='warn',"'"+"', '".join(warns)+"' — 정본("+'·'.join(REP_NAMES)+")과 근사 불일치, 오기 확인 요"
    elif exact: status,detail='pass','대표자 정본 확인('+'/'.join(REP_NAMES)+')'
    else: status,detail='pass','당사 대표자명 미기재(정상 — 기재 시에만 대조)'
    add('FORM-REP','대표자 이름 표기',status,detail)
    bads,old,ok=[],False,False
    for m in re.finditer(r'(?:서울[가-힣]*시\s*)?(?:마포구|영등포구)[^\n]{0,60}|만리재로[^\n]{0,40}|국제금융로[^\n]{0,40}',text):
        if not near(m.start()): continue
        norm=re.sub(r'\s+','',m[0])
        if '국제금융로' in norm: old=True
        elif re.search(r'만리재로24(?![0-9-])',norm): ok=True
        else:
            snippet=re.sub(r'\s+',' ',m[0])[:30]
            if snippet not in bads: bads.append(snippet)
    if old or bads:
        parts=[]
        if old: parts.append('구주소(국제금융로 56) 표기 — 현주소('+ADDR_CANON+')로 갱신 필요')
        if bads: parts.append("'"+"', '".join(bads)+"' — 정본: "+ADDR_CANON)
        status,detail='warn',' / '.join(parts)
    elif ok: status,detail='pass','정본 주소 확인(만리재로 24)'
    else: status,detail='pass','당사 주소 미기재(정상 — 기재 시에만 대조)'
    add('FORM-ADDR','회사 주소 표기',status,detail)
    return result
