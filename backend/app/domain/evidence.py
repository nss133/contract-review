"""Evidence segmentation and polarity shared by the native review engines."""
import re
import unicodedata
import math
from app.domain.structure import trim

VERSION = 'evidence-rules-v5'


def nonempty(value):
    return isinstance(value, str) and bool(trim(value))


def _list(value):
    return isinstance(value, list) and 0 < len(value) <= 50 and all(map(nonempty, value))


def validate(rule):
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    require(isinstance(rule, dict) and all(nonempty(rule.get(k)) for k in ('id', 'check_id', 'revision')),
            '규칙 ID·체크 ID·버전 필요')
    require(all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}', rule[k]) for k in ('id', 'check_id')),
            'ID는 영문·숫자·점·하이픈·밑줄로 입력하세요')
    require(_list(rule.get('type_ids')) and _list(rule.get('party_roles')) and nonempty(rule.get('rationale')),
            '적용 유형·당사 역할·판단 기준 필요')
    obligations = rule.get('obligations')
    require(isinstance(obligations, list) and 0 < len(obligations) <= 20, '필수 요건 목록 필요')
    seen = set()
    for obligation in obligations:
        require(isinstance(obligation, dict) and nonempty(obligation.get('id')) and obligation['id'] not in seen,
                '요건 ID 중복/누락')
        seen.add(obligation['id'])
        require(all(_list(obligation.get(k)) for k in ('actors', 'actions', 'objects')), '요건별 주체·행위·대상 필요')
        require(obligation.get('polarity') in ('obligation', 'prohibition'), '의무/금지 방향 명시 필요')
        require(isinstance(obligation.get('conditions'), list) and all(map(nonempty, obligation['conditions'])),
                '조건 목록 필요 (해당 없으면 빈 배열)')
        q = obligation.get('quantity')
        if q is not None and q is not False:
            require(isinstance(q, dict) and q.get('unit') in ('일', '개월', '년', '%', '원')
                    and all(type(q.get(k)) in (int, float) and math.isfinite(q[k]) for k in ('min', 'max'))
                    and 0 <= q['min'] <= q['max'], '수치 단위·최소·최대 확인 필요')
    return rule


def actor_hit(text, actors):
    return any(re.search(r'(?:^|[\s\"\'“”‘’(])' + re.escape(actor) + r'[\"\'“”‘’)]*\s*(?:은|는|이|가)(?:\s|$)', text)
               for actor in actors)


def any_term(text, terms):
    return any(term in text for term in terms)


def direction(text):
    for label,pattern in [('prohibition',r'할\s*수\s*없|하여서는\s*아니|해서는\s*안|하지\s*못|금지|하지\s*아니'),
                          ('negative',r'하지\s*않|아니한다|면제|생략|의무(?:가|는)?\s*없|필요(?:가|는)?\s*없'),
                          ('obligation',r'하여야|해야|해야만|의무를\s*부담|하기로\s*한다'),('permission',r'할\s*수\s*있')]:
        if re.search(pattern,text):return label
    return 'unknown'


def heading(text):
    text=text or ''
    match=re.search(r'^\s*(?:제\s*[0-9]+\s*조(?:의\s*[0-9]+)?|[0-9]+[.)])\s*[（(]([^）)]+)[）)]',text)
    if match:return {'title':match[1],'prefix':match[0]}
    match=re.search(r'^\s*제\s*[0-9]+\s*조(?:의\s*[0-9]+)?\s+([^\n.。:：]{1,48})\s*$',text)
    if match and not re.search(r'한다|된다|있다|없다|하여야|해야|에 따라|에 의하',match[1]):return {'title':trim(match[1]),'prefix':match[0]}
    match=re.search(r'^\s*(?:(?:제\s*[0-9]+\s*조(?:의\s*[0-9]+)?|[0-9]+[.)])\s+)?(계약기간|계약 기간|대금 지급|대금|정산|부가세|부가가치세|해지|해제|해지 및 해제|손해배상|비밀정보|비밀유지|관할|분쟁해결|목적|운송)\s*$',text)
    return {'title':match[1],'prefix':match[0]} if match else None


def sentences(documents):
    out=[]
    for di,doc in enumerate(documents or []):
        section='';section_index=0
        for si,text in enumerate(re.split(r'\n|(?<=\S다\.)\s+',unicodedata.normalize('NFC',doc.get('text') or ''))):
            h=heading(text)
            if h:section=h['title'];section_index+=1
            if trim(text):out.append({'document':doc.get('name') or '문서 '+str(di+1),'document_index':di,'sentence_index':si,
                'section':section,'section_index':section_index,'text':trim(text),'direction':direction(text),
                'exception':bool(re.search(r'다만|단,|단서|불구하고|예외|우선\s*(적용|한다)|별도로\s*정',text)),
                'unusable':bool(re.search(r'_{2,}|\[\s*\]|�|(?:이란|라\s*함은|란).*(?:말한다|의미|뜻)|라고|라는|예시|가령|가정|노력|가급적|가능한\s*한|원칙적으로',text))})
    return out


def relevant_sentences(terms, documents):
    rows = sentences(documents)
    marked = set()
    global_pattern = r'불구하고|우선|(?:본|이)\s*계약.{0,20}(?:전체|전부|모든|일체|배제)|모든|일체|전항|전조|각\s*조|제\s*[0-9]+\s*조|준용|따른다|정한\s*바|별첨|부속|약정서'
    for row in rows:
        h = heading(row['text'])
        body = row['text'][len(h['prefix']):] if h else row['text']
        if any_term(row['text'], terms) or re.search(global_pattern, body):
            marked.add((row['document_index'], row['section_index']))
    return [r for r in rows if not r['section'] or (r['document_index'], r['section_index']) in marked]


def blocking_qualifiers(rule, documents):
    rows = sentences(documents)
    terms = [term for o in rule.get('obligations', []) for k in ('actors', 'actions', 'objects', 'conditions') for term in o.get(k, [])]
    scope_terms = [term for o in rule.get('obligations', []) for k in ('actions', 'objects') for term in o.get(k, [])]
    relevant = relevant_sentences(scope_terms, documents)
    for row in relevant:
        h = heading(row['text'])
        if re.search(r'전항|전조|제\s*[0-9]+\s*조|준용', row['text'][len(h['prefix']):] if h else row['text']):
            relevant = rows
            break
    keys = {(r['document_index'], r['sentence_index']) for r in relevant}
    out = []
    for row in rows:
        if not row['exception'] and not row['unusable']:
            continue
        text = row['text']
        if re.search(r'_{2,}|\[\s*\]|�', text):
            out.append(row)
            continue
        if ((row['document_index'], row['sentence_index']) not in keys
                and not (re.search(r'(?:이란|이라 함은|란).*(?:말한다|의미|뜻)', text) and any_term(text, terms))):
            continue
        definition = re.search(r'^["“]([^"”]{1,30})["”](?:이란|란|이라 함은)\s+.+(?:말한다|의미한다)\.$', text)
        if (row['exception'] or not definition or any_term(text, terms)
                or re.search(r'_{2,}|\[\s*\]|�|전항|전조|이 계약|본 계약|모든|일체|우선|의무|권리', text)
                or any(other is not row and definition[1] in other['text'] for other in rows)):
            out.append(row)
    return out


def evaluate(rule, documents=None, context=None):
    out = {'engine_version': VERSION, 'status': 'unknown', 'evidence': [], 'missing': [], 'conflicts': []}
    if rule is None:
        out['rule_id'] = None
    elif 'id' in rule:
        out['rule_id'] = rule['id']
    try:
        validate(rule)
    except ValueError as error:
        out['error'] = str(error)
        return out
    ctx = context or {}
    rows = sentences(documents)
    if not rows or not nonempty(ctx.get('type_id')) or not isinstance(ctx.get('party_roles'), list) or not ctx['party_roles']:
        return out
    if ctx['type_id'] not in rule['type_ids'] or not any(role in ctx['party_roles'] for role in rule['party_roles']):
        out['status'] = 'out_of_scope'
        return out
    for o in rule['obligations']:
        supported = []
        units = rows[:]
        for i, row in enumerate(rows[:-1]):
            nxt = rows[i + 1]
            if (nxt['document_index'] != row['document_index'] or nxt['sentence_index'] != row['sentence_index'] + 1
                    or not actor_hit(row['text'], o['actors']) or not any_term(row['text'], o['actions'])
                    or not any_term(row['text'], o['objects'])):
                continue
            if not any(re.search(r'^(?:이|해당)\s*' + re.escape(a) + r'(?:은|는|을|를)\s', nxt['text']) for a in o['actions']):
                continue
            joined = row['text'] + ' ' + nxt['text']
            units = [unit for unit in units if unit is not row]
            units.append(dict(row, text=joined, direction=direction(joined), exception=row['exception'] or nxt['exception'],
                              unusable=bool(row['unusable'] or nxt['unusable'] or nxt['direction'] in ('permission', 'unknown')
                                            or re.search(r'경우|때|하면|한하여|한해|조건|가능|요청', nxt['text'])),
                              linked_sentences=[row['sentence_index'], nxt['sentence_index']]))
        for row in units:
            text = row['text']
            if not (any_term(text, o['actions']) and any_term(text, o['objects'])):
                continue
            if row['exception'] or row['direction'] not in ('unknown', o['polarity']):
                out['conflicts'].append(dict(obligation=o['id'], reason='exception' if row['exception'] else 'direction', **row))
                continue
            subjects = set(['갑', '을', '위탁자', '수탁자', '임대인', '임차인', '매도인', '매수인'] + o['actors'])
            if row['unusable'] or sum(actor_hit(text, [a]) for a in subjects) > 1:
                out['conflicts'].append(dict(obligation=o['id'], reason='qualification_or_subject_ambiguity', **row))
                continue
            if not actor_hit(text, o['actors']) or row['direction'] != o['polarity'] or not all(c in text for c in o['conditions']):
                continue
            q = o.get('quantity')
            if q:
                nums = [float(n.replace(',', '')) for n in re.findall(r'([0-9][0-9,]*(?:\.[0-9]+)?)\s*' + re.escape(q['unit']), text)]
                if len(nums) != 1 or not q['min'] <= nums[0] <= q['max']:
                    out['conflicts'].append(dict(obligation=o['id'], reason='quantity_or_ambiguity', **row))
                    continue
            supported.append(dict(obligation=o['id'], **row))
        if not supported:
            out['missing'].append(dict(obligation=o['id'], actors=o['actors'], actions=o['actions'], objects=o['objects'],
                                       conditions=o['conditions'], quantity=o.get('quantity') or None, polarity=o['polarity']))
        out['evidence'].extend(supported)
    out['status'] = 'conflict' if out['conflicts'] else 'incomplete' if out['missing'] else 'supported'
    return out
