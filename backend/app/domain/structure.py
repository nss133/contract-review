"""Native Python port of segmenter.js and document_structure.js (v1.90.8).

Public coordinates count UTF-16 code units, as in the original browser.
Segmentation preserves source text; only extraction's from_blocks applies NFC.
"""
import re
import unicodedata

from app.domain.compat import utf16_offset

SPACE = r'[\s\ufeff]'
HEADING = re.compile(r'^제\s*[0-9]+\s*조(?:의\s*[0-9]+)?(?:\s|\(|\[|$)')
NUMBERED = re.compile(r'^[0-9]+\.\s+')
PARAGRAPH_REF = re.compile(r'^제\s*[0-9]+\s*조(?:의\s*[0-9]+)?\s+제\s*[0-9]+\s*항(?:\s*제\s*[0-9]+\s*호)?(?:\s|에|을|를|의|$)')
TITLE_KIND = re.compile(r'계약서|계약|약정서|약정|합의서|합의|협약서|협약|각서|확인서|동의서|승낙서|신청서|증서|의향서|양해각서|정관|규약|LOI|MOU|NDA', re.I)
TITLE_TAIL = re.compile(r'''^[\s(（"'“”‘’\[\]<>【】]*(안|초안|개정|변경|수정|재작성|사본|원본|갑|을|제?\s*[0-9]+\s*[안호부])?[\s)）"'“”‘’\[\]<>【】.]*$''')
TITLE_SKIP = re.compile(r'^(주식회사|㈜|\(주\)|[0-9]{4}[.\-년]|별지|별표|붙임|전문|목\s*차)')
ANNEX = re.compile(r'^\[?\s*(별첨|별표|별지|붙임|부록|첨부|Annex|Appendix)\s*(?:제\s*)?([0-9]+(?:[-.][0-9]+)*|[A-Z])?\s*(?:호)?\s*\]?\s*[:.\-]?\s*(.*)$', re.I)


def trim(value):
    return re.sub(r'^[\s\ufeff]+|[\s\ufeff]+$', '', value)


def extract_doc_title(text):
    for raw in re.split(r'\r?\n', text or '')[:12]:
        raw = trim(raw)
        if not raw:
            continue
        if HEADING.search(raw):
            break
        if utf16_offset(raw, len(raw)) > 80 or TITLE_SKIP.search(raw):
            continue
        if re.search(r'(은|는|이|가|와|과)\s+.*(한다|하였다|합의|체결|다음과)', raw):
            continue
        if re.fullmatch(r'[가-힣A-Za-z](?:\s+[가-힣A-Za-z]){2,}', raw):
            raw = re.sub(r'\s+', '', raw)
        title = trim(re.sub(r'''^[\s"'“”‘’「」『』<>《》【】\[\]]+|[\s"'“”‘’「」『』<>《》【】\[\]]+$''', '', raw))
        matches = list(TITLE_KIND.finditer(title))
        if matches and TITLE_TAIL.search(title[matches[-1].end():]):
            return title
    return ''


def segment_contract(text):
    clauses, current = [], None
    for line in re.split(r'\r?\n', text):
        t = trim(line)
        heading = bool(t and (HEADING.search(t) or NUMBERED.search(t)))
        if heading and PARAGRAPH_REF.search(t):
            heading = False
        if heading and not HEADING.search(t) and current and HEADING.search(current['heading']):
            heading = False
        if heading:
            if current is not None:
                clauses.append(current)
            current = {'heading': t, 'body': ''}
        elif current is not None:
            current['body'] += ('\n' if current['body'] else '') + line
        elif t:
            current = {'heading': '(전문)', 'body': line}
    if current is not None:
        clauses.append(current)
    if len(clauses) < 2:
        return [{'heading': '(전체)', 'body': text, 'index': 0}]
    return [{**c, 'index': i} for i, c in enumerate(clauses)]


def normalize(text):
    text = unicodedata.normalize('NFC', text or '')
    text = text.translate(str.maketrans('０１２３４５６７８９（［【「）］】」', '0123456789[[[[]]]]'))
    return trim(re.sub('[\u200b\ufeff]', '', text))


def boundary(text):
    text = normalize(text)
    if not text or utf16_offset(text, len(text)) > 120 or re.search(r'(?:따른다|따라|참조|첨부한다|포함한다|정한다|으로\s*한다|에\s*의|를\s*|을\s*|에서\s*|내지|\.\.{2,}|…)', text):
        return None
    m = ANNEX.search(text)
    if m:
        tail = m[3]
        if tail and (re.search(r'^(?:에|의|와|과|및|또는|제\s*[0-9]+\s*조)(?:\s|$)', tail) or re.search(r'[.!?]$', tail) or re.search(r'\b(?:shall|pursuant|refer|applies|section|article)\b', tail, re.I | re.A)):
            return None
        return {'kind': 'annex', 'token': m[1].lower() + (m[2] or ''), 'label': text, 'number': m[2] or ''}
    if re.search(r'^부\s*칙(?:\s|\[|$)', text):
        return {'kind': 'addendum', 'token': '부칙', 'label': text}
    return None


def title_key(text):
    text = re.sub(r'\.(?:pdf|hwpx?|docx?|txt)$', '', trim(unicodedata.normalize('NFC', text or '')), flags=re.I)
    if boundary(text):
        text = re.sub(r'^\s*[\[（(【「]?\s*(?:별첨|별표|별지|붙임|부록|첨부|Annex|Appendix)\s*(?:제\s*)?(?:[0-9]+(?:[-.][0-9]+)*|[A-Z])?\s*(?:호)?\s*[\]）)】」]?\s*[:.\-]?\s*', '', text, flags=re.I)
    text = re.sub(r'\s', '', re.sub(r'^[「“"『]|[」”"』]$', '', text))
    return text if re.search(r'^[가-힣A-Za-z0-9·ㆍ&()_-]{2,90}(?:계약서|약정서|합의서|명세서|계획서)$', text) else ''


def from_blocks(source_format, blocks, warnings=None):
    text, out, at = '', [], 0
    for i, block in enumerate(blocks or []):
        s = re.sub(r'\r\n?', '\n', unicodedata.normalize('NFC', block.get('text') or ''))
        length = utf16_offset(s, len(s))
        out.append({**block, 'id': 'b' + str(i), 'text': s, 'start': at, 'end': at + length})
        text += s + '\n'
        at += length + 1
    return {'format': 'cr-document-structure-v1', 'source_format': source_format, 'text': text, 'blocks': out, 'warnings': warnings or []}


def valid_extraction(text, extraction):
    if not isinstance(extraction, dict) or extraction.get('format') != 'cr-document-structure-v1' or extraction.get('text') != text or not isinstance(extraction.get('blocks'), list):
        return False
    raw = text.encode('utf-16-le', errors='surrogatepass')
    at = 0
    for block in extraction['blocks']:
        if not isinstance(block, dict) or not isinstance(block.get('text'), str):
            return False
        length = utf16_offset(block['text'], len(block['text']))
        end = at + length
        if type(block.get('start')) is not int or type(block.get('end')) is not int or block['start'] != at or block['end'] != end or raw[at*2:end*2].decode('utf-16-le', errors='surrogatepass') != block['text']:
            return False
        at = end + 1
    return at == len(raw) // 2


def document(name, text, extraction=None):
    value = {'name': name, 'text': text}
    if valid_extraction(text, extraction):
        value['extraction'] = extraction
    return value


def table_header(text):
    headers = {'주체': 'actor', '의무자': 'actor', '의무주체': 'actor', '대상': 'object', '대상정보': 'object', '의무': 'action', '의무내용': 'action', '약정내용': 'action', '조건': 'condition', '적용조건': 'condition'}
    return headers.get(re.sub(r'\s', '', text or ''))


def inspect(text, extraction=None, overrides=None):
    text = text or ''
    valid = valid_extraction(text, extraction)
    blocks = extraction['blocks'] if valid else []
    lines, pos, bi = [], 0, 0
    for i, t in enumerate(text.split('\n')):
        while bi + 1 < len(blocks) and blocks[bi]['end'] < pos:
            bi += 1
        b = blocks[bi] if blocks else None
        covers = bool(b and b['start'] <= pos <= b['end'])
        lines.append({'index': i, 'text': t, 'offset': pos, 'source': (b.get('source') or None) if covers else None,
                      'numbering': (b.get('numbering') or None) if b and b['start'] == pos else None,
                      'block_id': b.get('id') if covers else None})
        pos += utf16_offset(t, len(t)) + 1
    sections = [{'id': 'main', 'label': '본문', 'kind': 'main', 'start': 0, 'parent': None}]
    current, candidates, previous = sections[0], [], None
    for i, line in enumerate(lines):
        auto = boundary(line['text'])
        manual = next((o for o in overrides or [] if o.get('line') == i), None)
        ahead = [l for l in lines[i+1:i+7] if trim(l['text'])]
        toc = (ahead and boundary(ahead[0]['text'])) or (previous and boundary(previous['text']))
        ignored = line['source'] and line['source'].get('repeated_margin')
        if auto and (toc or ignored):
            auto = None
        if manual:
            if manual.get('mode') == 'continue':
                auto = None
            else:
                label = manual.get('label') or '별도 문서'
                auto = {'kind': 'excluded' if manual.get('mode') == 'skip' else 'annex', 'label': label,
                        'token': (boundary(manual.get('label') or '') or {}).get('token'), 'manual': True}
        if auto:
            current = {'id': 'section-' + str(i), 'label': auto['label'], 'token': auto.get('token') or '',
                       'kind': auto['kind'], 'start': i, 'parent': (manual or {}).get('parent') or 'main', 'manual': bool(auto.get('manual'))}
            sections.append(current)
            line['boundary'] = True
        elif i > 0 and re.search(r'(?:약정서|계약서|합의서)\s*$', trim(line['text'])) and any(re.search(r'^\s*(?:제\s*)?1\s*조', l['text']) for l in ahead):
            candidates.append({'line': i, 'label': trim(line['text'])})
        line['section'] = current['id']
        if trim(line['text']):
            previous = line
    return {'format': 'cr-document-map-v1', 'source_format': extraction.get('source_format') if valid else 'text',
            'lines': lines, 'sections': sections, 'candidates': candidates,
            'warnings': (extraction.get('warnings') or []) if valid else [], 'source_valid': bool(valid)}


def clause_starts(text, clauses):
    cursor, result = 0, []
    for i, clause in enumerate(clauses or []):
        heading = clause.get('heading')
        key = heading if heading and not re.search(r'^\((?:전문|전체)\)$', heading) else next((line for line in (clause.get('body') or '').split('\n') if line), '')
        at = text.find(key, cursor) if key else cursor
        if at < 0:
            at = cursor
        cursor = at + len(key)
        result.append({'start': utf16_offset(text, at), 'index': clause.get('index', i)})
    return result


def location(source):
    if not source:
        return '텍스트'
    values = [str(source['page']) + '쪽' if source.get('page') else '', source.get('part') or source.get('section') or '',
              '문단 ' + str(source['paragraph'] + 1) if type(source.get('paragraph')) is int else '',
              '레코드 ' + str(source['record_offset']) if type(source.get('record_offset')) is int else '',
              '표 셀 ' + str(source['cell']) if source.get('cell') else '']
    return ' · '.join(filter(None, values)) or '원본 블록'
