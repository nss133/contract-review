"""Sentence requirement checks, ported without changing v1.90.8 policy."""
import re
from app.domain.structure import trim

PATTERNS = {
    'proviso': r'^[①-⑮\s0-9.]*\s*(다만|단,|단서)',
    'definition': r'(이?란|함은|이라\s*함은)\s.*(말한다|의미한다|말하며|의미하며)|[을를]\s*말한다\s*\.?$',
    'blank': r'_{2,}|＿{2,}|\[\s*\]|(?:^|[^0-9])년\s*월\s*일',
    'negated': r'(아니\s?한다|아니\s?된다|않는다|않기로\s*한다|할\s*수\s*없다|하지\s*못한다|하여서는\s*(?:아니\s*된다|안\s*된다)|해서는\s*안\s*된다|금지(?:한)?다|없는\s*것으로\s*한다|무효로\s*한다)\s*\.?\s*$',
    'prohibition': r'(할\s*수\s*없다|하지\s*못한다|하여서는\s*(?:아니\s*된다|안\s*된다)|해서는\s*안\s*된다|금지(?:한)?다|하지\s*아니한다)\s*\.?\s*$'
}
REQUIREMENTS = {
    'number': r'[0-9]', 'period': r'[0-9]+\s*(년|개월|월|주|일)(?!자)',
    'date': r'[0-9]{4}\s*[.\-/년]\s*[0-9]{1,2}|[0-9]{4}\s*년',
    'money': r'(?:금\s*)?[0-9,]+\s*(원|만원|백만원|천만원|억원)|KRW|USD',
    'rate': r'[0-9]+(?:\.[0-9]+)?\s*(%|퍼센트)'
}


def split_sentences(text):
    return [trim(s) for line in re.split(r'\n+', text or '') for s in re.split(r'(?<=다\.)\s+', line) if trim(s)]


def is_proviso(text): return bool(re.search(PATTERNS['proviso'], text))
def is_definition(text): return bool(re.search(PATTERNS['definition'], text))
def is_blank(text): return bool(re.search(PATTERNS['blank'], text))
def is_negated(text): return bool(re.search(PATTERNS['negated'], text))
def is_prohibition(text): return bool(re.search(PATTERNS['prohibition'], text))


def evaluate(text, spec):
    if not spec or not isinstance(spec.get('any_groups'), list) or not spec['any_groups']:
        return None
    expect = spec.get('expect') or 'statement'
    for sent in split_sentences(text):
        if is_proviso(sent) or is_blank(sent):
            continue
        if expect == 'definition':
            if not is_definition(sent): continue
        elif is_definition(sent):
            continue
        if not all(any(word and word in sent for word in group or []) for group in spec['any_groups']):
            continue
        requirement = None
        kinds = spec.get('require')
        if isinstance(kinds, list) and kinds:
            requirement = next((kind for kind in kinds if kind in REQUIREMENTS and re.search(REQUIREMENTS[kind], sent)), None)
            if not requirement: continue
        if expect == 'prohibition':
            if not is_prohibition(sent): continue
        elif expect == 'statement' and is_negated(sent):
            continue
        return {'ok': True, 'sentence': sent, 'require_hit': requirement, 'expect': expect}
    return {'ok': False}
