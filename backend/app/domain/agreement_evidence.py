"""Locate current agreement evidence without treating presence as approval."""
import re
import unicodedata
from app.domain import evidence, structure, presence
from app.domain.similarity import units as utf16, ununits

ACTOR_START = re.compile(r'^(?:[①-⑳])?[“"「]?(?:' + '|'.join(dict.fromkeys(presence.roles + ['갑', '을', '당사자일방', '클라우드서비스제공자'])) + r')[”"」]?[은는이가]')


def compact(text):
    return re.sub(r'[\s\ufeff]+', '', text or '')


def global_effect(text):
    text = compact(text)
    if re.search(r'불구하고|우선(?:적용|한다)|(?:본|이)계약.{0,20}(?:전체|전부|모든|일체|배제)', text):
        return True
    if re.search(r'^(?:다만[,，]?)?(?:이|그|해당|위)(?:의무|책임|조항|규정).*(?:면제|면책|배제|제외|축소|제한|적용하지)', text):
        return True
    penalty = re.sub(r'[“"「](갑|을|수탁자|위탁자)[”"」]', r'\1', text)
    local = re.search(r'^(?:수탁자는|을은)(?:제[0-9]+항(?:또는제[0-9]+항)*|본조)의의무를위반한경우이에따른민[·∙ㆍ]?형사상일체의책임을부담하며,(?:갑|위탁자)에게발생한모든손해를배상(?:하여야한다|해야한다|한다)[.]?$', penalty)
    return not local and bool(re.search(r'(?:모든|일체의?)(?:의무|책임)', text))


def units(documents=None):
    documents = documents or []
    out, cursors, block_cursors = [], {}, {}
    raws = [utf16(unicodedata.normalize('NFC', d.get('text') or '')) for d in documents]
    blocks = [d['extraction']['blocks'] if unicodedata.normalize('NFC', d.get('text') or '') == d.get('text')
              and structure.valid_extraction(d.get('text'), d.get('extraction')) else [] for d in documents]
    for s in evidence.sentences(documents):
        di = s['document_index']
        raw, bs = raws[di], blocks[di]
        text = utf16(s['text'])
        start = raw.find(text, cursors.get(di, 0))
        cursors[di] = start + len(text)
        bi = block_cursors.get(di, 0)
        while bi + 1 < len(bs) and bs[bi]['end'] < start:
            bi += 1
        block_cursors[di] = bi
        source = bs[bi].get('source') if bs and bs[bi]['start'] <= start <= bs[bi]['end'] else None
        row = dict(s, start=start, end=start + len(text), source=source)
        if bs and bs[bi]['start'] <= start <= bs[bi]['end'] and 'source' not in bs[bi]:
            row.pop('source')
        prev = out[-1] if out else None
        if (prev and prev['document_index'] == di and prev['section_index'] == s['section_index']
                and not evidence.heading(s['text']) and not evidence.heading(prev['text'])
                and not (source or {}).get('table') and not (prev.get('source') or {}).get('table')
                and (ACTOR_START.search(compact(prev['text'])) or re.search(r'^(?:본|이)\s*(?:계약|약정)', prev['text']))
                and not re.search(r'[.。;:]\s*$|다\s*$', prev['text'])
                and not re.search(r'^\s*(?:[①-⑳]|(?:[0-9]+|[가나다라마바사아자차카타파하])[.)]|\((?:[0-9]+|[가나다라마바사아자차카타파하])\)|[-•□※])', s['text'])
                and not ACTOR_START.search(compact(s['text'])) and start >= prev['end']):
            prev.update(text=ununits(raw[prev['start']:row['end']]), end=row['end'],
                        exception=prev['exception'] or s['exception'], unusable=prev['unusable'] or s['unusable'])
        else:
            out.append(row)
    for row in out:
        row['compact_text'] = compact(row['text'])
    return out


def scan(terms, documents=None, source_rows=None):
    rows = source_rows if source_rows is not None else evidence.sentences(documents)
    selected, sections = set(), set()
    for i, row in enumerate(rows):
        text = row.get('compact_text') or compact(row['text'])
        if any(t and compact(t) in text for t in terms):
            selected.add(i)
            if row['section']:
                sections.add((row['document_index'], row['section_index']))
    if not selected:
        return []
    for i, row in enumerate(rows):
        h = evidence.heading(row['text'])
        body = row['text'][len(h['prefix']):] if h else row['text']
        if (row['section'] and (row['document_index'], row['section_index']) in sections) or global_effect(body):
            selected.add(i)
    for i in range(1, len(rows)):
        row, prev = rows[i], rows[i - 1]
        if (i - 1 in selected and prev['document_index'] == row['document_index'] and prev['section_index'] == row['section_index']
                and (re.search(r'^(?:다만|단[,，]|그러나|이\s|그\s|해당\s|위\s)', row['text'])
                     or re.search(r'(?:이|그|해당|위)\s*(?:의무|책임|조항|규정)|그러하지|이와\s*달리', row['text']))):
            selected.add(i)
    for i in range(len(rows) - 2, -1, -1):
        row, nxt = rows[i], rows[i + 1]
        if (i + 1 in selected and row['document_index'] == nxt['document_index'] and row['section_index'] == nxt['section_index']
                and re.search(r'다음|아래|이하', row['text'])
                and (re.search(r'경우|조건|한하|한해|면제|배제|적용', row['text']) or re.search(r'(?:다음|아래)\s*각\s*[호목]', row['text']))):
            selected.add(i)
    used_docs = {rows[i]['document_index'] for i in selected}
    for i, row in enumerate(rows):
        if not row['section'] and '�' in row['text'] and row['document_index'] in used_docs:
            selected.add(i)
    return [row for i, row in enumerate(rows) if i in selected]


def scan_units(terms, documents=None):
    return scan(terms, documents, units(documents))


def is_document_title(row, documents):
    rows = units(documents)
    first = next((s for s in rows if s['document_index'] == row['document_index']), {})
    return bool(first.get('sentence_index') == row['sentence_index'] and first.get('text') == row['text'] and not row['section']
                and re.search(r'^[가-힣A-Za-z0-9 ()·ㆍ&-]{1,70}(?:계약서|약정서|합의서)$', row['text'])
                and not re.search(r'다만|단서|예외|제외|면제|면책|배제|우선|하지|책임|의무|가정|예시|검토|취소', row['text'])
                and any(s['document_index'] == row['document_index'] and s['section_index'] > 0 for s in rows))


def inspect(cp, documents):
    terms = (cp.get('triggers') or {}).get('keywords') or []
    found = []
    for row in scan_units(terms, documents):
        h = evidence.heading(row['text'])
        if h and not row['text'][len(h['prefix']):].strip():
            continue
        if not any(t and (compact(t) in compact(row['text']) or compact(t) in compact(row['section'])) for t in terms):
            continue
        text = row['text']
        actors = list(dict.fromkeys(re.findall(r'(?:^|\s)(수탁자|위탁자|임대인|임차인|매도인|매수인|당사자 일방|상대방|갑|을)(?=은|는|이|가|의|에게|\s|$)', text)))
        effect = '책임 제한·배제' if re.search(r'면제|책임.{0,15}(?:지지|부담하지|없)|배상.{0,10}(?:않|아니)', text) else '책임 규정' if re.search(r'책임|배상', text) else '기타 약정'
        found.append(dict(document=row['document'], text=text, section=row['section'], direction=row['direction'], actors=actors,
                          effect=effect, qualification=bool(re.search(r'다만|경우|한하여|조건|예외|한도', text))))
    return {'stage': 'clause_found' if found else 'not_found', 'evidence': found}
