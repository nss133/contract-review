"""Clause roles, norm priority and subjects from the frozen v1.90.8 rules."""
import re
from app.domain.structure import trim

TITLE_RULES = [(r'목적','purpose'), (r'정의|용어','definition'), (r'계약\s*기간|유효\s*기간','term'), (r'완전\s*합의|완전한\s*합의','general')]
BODY_RULES = [(r'목적으로\s*한다|정함을\s*목적','purpose'), (r'[을를]\s*말한다|이라\s*한다|이라\s*함은','definition'), (r'계약\s*기간은|유효\s*기간은','term')]


def parse_title(heading):
    h = trim(heading or '')
    if h in ('(전문)', '(전체)'): return ''
    m = re.search(r'[\(（]([^\)）]*)[\)）]', h)
    return trim(m[1]) if m else ''


def clause_role(heading, body=None):
    h = trim(heading or '')
    if h in ('(전문)', '(전체)'):
        return {'role': 'preamble' if h == '(전문)' else 'entire', 'weak': True}
    title = parse_title(heading)
    for pattern, role in TITLE_RULES if title else BODY_RULES:
        if re.search(pattern, title or body or ''):
            return {'role': role, 'weak': True}
    return {'role': 'general', 'weak': False}


def norm_type(text):
    patterns = [('금지', r'아니\s*된다|하여서는\s*아니|금지|할\s*수\s*없다|하지\s*못한다|해서는\s*안'),
                ('의무', r'하여야\s*한다|해야\s*한다|의무'), ('권한', r'할\s*수\s*있다|권한'),
                ('선언', r'본다|간주|추정|정의한다|말한다')]
    return next((label for label, pattern in patterns if re.search(pattern, text or '')), None)


def clause_subjects(body, limit=None):
    stops = {'다음','이에','그에','본조','본항','전항','해당','각각','이하','위의','상기','다만','또한','기타','이때','그때','본건','이건'}
    out = []
    for m in re.finditer(r'(?:^|\n|[①-⑮]\s*|[0-9]+\.\s*)\s*([가-힣]{2,12}?)(?:은|는)\s', body or ''):
        subject = m[1]
        if subject in stops or (len(subject) <= 4 and re.search(r'(하|되|시키|받|주|지|이|가)$', subject)): continue
        if subject not in out: out.append(subject)
        if len(out) >= (limit or 3): break
    return out
