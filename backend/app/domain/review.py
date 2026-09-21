"""Server-owned current-text matching; human verdicts remain separate from scores."""
import hashlib
import json
from pathlib import Path
from app.domain import structure, standard_auto, agreement_judgment
from app.domain.matching import Matcher

CATALOG_BYTES = (Path(__file__).resolve().parents[1] / 'data/catalog.json').read_bytes()
CATALOG = json.loads(CATALOG_BYTES)
KNOWLEDGE_HASH = hashlib.sha256(b''.join(p.read_bytes() for p in sorted((Path(__file__).resolve().parents[1]/'data').glob('*.json')))).hexdigest()
ENGINE_HASH = hashlib.sha256(b''.join(p.read_bytes() for p in sorted(Path(__file__).resolve().parent.glob('*.py')))).hexdigest()


def analyse(text, documents, options):
    matcher = Matcher()
    title = structure.extract_doc_title(text)
    types = CATALOG['types']
    ranked = matcher.detect_type(text, types, title, '')
    type_id = options.get('type_id') or matcher.pick_type(ranked)
    selected = next((d for d in types if d['meta']['type_id'] == type_id), None)
    if selected is None:
        raise ValueError('계약 유형을 선택한 뒤 다시 분석하세요.')
    stance = options.get('stance', 'party')
    available = selected['meta'].get('modules') or []
    suggested = matcher.suggest_modules(text, available, {'stance': stance, 'docTitle': title})
    active = options.get('modules')
    known = {m['id'] for m in available}
    if active is not None and not set(active) <= known:
        raise ValueError('적용 모듈을 확인하세요.')
    active = list(dict.fromkeys((active if active is not None else suggested['on']) + [m['id'] for m in available if m.get('always_on')]))
    clauses = structure.segment_contract(text)
    if len(text) + sum(len(d['extraction']['text']) for d in documents) > 500000 or len(clauses) > 300:
        raise ValueError('한 번에 분석할 본문·별첨은 50만 자, 본문은 300개 조항 이내로 나누어 주세요.')
    base = [c for d in documents if d['kind'] == 'base' for c in structure.segment_contract(d['extraction']['text'])]
    opts = {'modules': active, 'stance': stance, 'docTitle': title, 'baseClauses': base}
    docs = [dict(d, checkpoints=d['checks']) for d in (CATALOG['common'], selected)]
    result = matcher.analyze(clauses, docs, opts)
    policies = {p['id']: p for p in CATALOG.get('judgment_policies', {}).get('checks', [])}
    checkpoints = {cp['id']: cp for cp in result['checkpoints'] if cp.get('active') is not False
                   and policies.get(cp['id'], {}).get('active') is not False}
    result['results'] = [r for r in result['results'] if r['cpId'] in checkpoints]
    result['checkpoints'] = list(checkpoints.values())
    eligible = [checkpoints[r['cpId']] for r in result['results'] if not any(r.get(k) for k in ('roleGated', 'relationshipGated', 'serviceGated'))]
    annexes = [{'name': d['name'], 'clauses': structure.segment_contract(d['extraction']['text'])}
               for d in documents if d['kind'] == 'annex']
    coverage = matcher.sub_doc_coverage(eligible, annexes, matcher.build_model(docs, active, stance)) if annexes and eligible else {}
    main = next((d for d in documents if d['kind']=='main' and d['extraction']['text']==text), None)
    source_documents = [dict(name='본문', text=text, **({'extraction':main['extraction']} if main else {}))]
    source_documents += [dict(name='원계약' if d['kind']=='base' else d['name'],text=d['extraction']['text'],extraction=d['extraction']) for d in sorted(documents,key=lambda d:d['kind']!='base') if d['kind']!='main']
    prepared = agreement_judgment.prepare(source_documents)
    automatic_input = {'confirmed':True,'documents':source_documents,'scope':{'type':type_id,'stance':stance,'modules':active}}
    items = []
    for row in result['results']:
        cp = checkpoints[row['cpId']]
        excluded = any(row.get(k) for k in ('roleGated', 'relationshipGated', 'serviceGated'))
        item = dict(row, checkpoint=cp, required=not excluded, annex=coverage.get(cp['id']))
        best = row.get('best')
        item['quote'] = clauses[best['clauseIndex']]['body'] if best and 0 <= best['clauseIndex'] < len(clauses) else ''
        item['automatic'] = standard_auto.evaluate(cp,row,automatic_input,prepared=prepared)
        items.append(item)
    normalized = dict(options, type_id=type_id, modules=active, stance=stance)
    fingerprint = hashlib.sha256(json.dumps([text, documents, normalized, KNOWLEDGE_HASH, ENGINE_HASH], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {'engine_version': 'python-native-standard-auto-1', 'engine_hash': ENGINE_HASH, 'automatic_version':standard_auto.VERSION, 'knowledge_hash': KNOWLEDGE_HASH,
            'baseline_version': '1.90.8', 'fingerprint': fingerprint, 'options': normalized,
            'type_name': selected['meta']['type_name'], 'type_candidates': ranked,
            'clauses': clauses, 'items': items, 'module_suggestions': suggested,
            'documents': [{'id': d['id'], 'name': d['name'], 'kind': d['kind'], 'extraction': d['extraction']} for d in documents],
            'automatic_counts': {status:sum(i['automatic']['status']==status for i in items) for status in sorted({i['automatic']['status'] for i in items})},
            'notice': '현재 원문으로 자동판정한 결과입니다. 자동 확인 근거와 남은 항목을 검토한 뒤 원본 대조를 확인하고 완료하세요.'}
