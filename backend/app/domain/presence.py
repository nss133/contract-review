"""Finite presence profiles, exported as data from the frozen baseline."""
import json
from pathlib import Path
import re

VERSION = 'presence-profiles-v1'
DATA = json.loads((Path(__file__).resolve().parents[1] / 'data/domain-rules.json').read_text(encoding='utf-8'))['presence']
roles = DATA['roles']
profiles = DATA['profiles']
SUBJECT = re.compile('^(' + '|'.join(map(re.escape, roles)) + ')(?:은|는|이|가)')


def parse(text, env=None):
    aliases = (env or {}).get('map') or {}
    text = re.sub(r'(갑|을)(?=은|는|이|가|의|에게)', lambda m: aliases.get(m[0]) or m[0], text)
    text = text.replace('클라우드서비스제공자', '클라우드컴퓨팅서비스제공자')
    match = SUBJECT.search(text)
    if not match:
        return None
    rest = text[match.end():]
    for rule in DATA['rules']:
        if (not rule.get('actors') or match[1] in rule['actors']) and re.search(rule['pattern'], rest, re.I if 'i' in rule['flags'] else 0):
            fields = dict(rule.get('fields') or {})
            if rule['topic'] == 'personnel_screening':
                fields['method'] = '신원조회' if '신원조회' in rest else '신원보증'
            if rule['topic'] == 'subtrustee_instruction':
                fields['instruction_parties'] = '위탁회사또는원수탁업자' if rest.startswith('위탁회사또는') else '위탁회사와원수탁업자'
            return {'topic': rule['topic'], 'actor': match[1], 'fields': fields}
    return None
