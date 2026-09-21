"""Current-clause support from prior opinions; prior outcomes are never copied."""
import re
import unicodedata
import math
from copy import deepcopy
from app.domain.evidence import sentences


def opinion_evidence(text):
    return [{'source': '계약검토 결과 (과거 의견, 본건 근거 아님)', 'sentence': s.strip(), 'evidence_kind': 'review_opinion'}
            for s in re.split(r'\n+|(?<=[.!?。])\s+', text or '') if s.strip()]


def human_judgment(verdict, snapshot):
    return bool(verdict and (verdict.get('origin') == 'manual' or
                ((not verdict.get('origin') or verdict.get('origin') == 'legacy') and
                 (snapshot.get('source_binding') or {}).get('kind') == 'human_confirmed_legacy_binding')))


def combined(knowledge=None, history=None, corpus=None, options=None):
    knowledge, history, corpus, opts = knowledge or {}, history or {}, corpus or {}, options or {}
    out = {'latest': {}, 'documents': {}, 'tags': deepcopy(knowledge.get('tags') or {})}
    linked = set()
    for identity, key in (knowledge.get('latest') or {}).items():
        doc = (knowledge.get('documents') or {}).get(key)
        if not doc:
            continue
        review_id = (doc.get('original') or {}).get('review_id')
        copy = dict(deepcopy(doc), source_kind='contract_review' if review_id else 'legal_review', review_id=review_id or '')
        record = (history.get('records') or {}).get((history.get('latest') or {}).get(review_id)) if review_id else None
        if record:
            seen = set()
            copy['evidence'] = []
            for e in (doc.get('evidence') or []) + opinion_evidence((record.get('result') or {}).get('review_text')):
                if e.get('sentence') not in seen:
                    copy['evidence'].append(deepcopy(e))
                    seen.add(e.get('sentence'))
        key = 'tag:' + identity
        out['latest'][key] = key
        out['documents'][key] = copy
        if review_id:
            linked.add(review_id)
    for identity, key in (history.get('latest') or {}).items():
        r = (history.get('records') or {}).get(key)
        if identity in linked or not r:
            continue
        req, res = r.get('request') or {}, r.get('result') or {}
        key = 'contract:' + identity
        out['latest'][key] = key
        out['documents'][key] = {'source_id': key, 'review_id': identity, 'source_kind': 'contract_review',
            'title': req.get('contract_name') or res.get('contract_name') or '',
            'request_title': req.get('contract_name') or res.get('contract_name') or '', 'request_context': req.get('context') or '',
            'department': req.get('department') or res.get('department') or '', 'date': res.get('created_at') or req.get('created_at') or '',
            'family_id': r.get('family_id') or '', 'tags': deepcopy(r.get('tags') or []), 'evidence': opinion_evidence(res.get('review_text')),
            'original': {'request': deepcopy(req), 'result': deepcopy(res), 'conflicts': deepcopy(r.get('conflicts') or []), 'review_id': identity},
            'evidence_limit': '과거 검토의견은 검색·쟁점 연결 보조일 뿐 본건의 직접 근거나 안전 정답이 아닙니다.'}
    records = (corpus.get('judgment_ledger') or {}).get('records') or {}
    own = records.get(opts.get('excludeContractHash')) or {}
    excluded = opts.get('excludeReviewId') or ((own.get('snapshot') or {}).get('history_reference') or {}).get('review_id')
    if excluded:
        for key in list(out['latest']):
            doc_key = out['latest'][key]
            if out['documents'][doc_key].get('review_id') == excluded:
                del out['documents'][doc_key]
                del out['latest'][key]
    by_review = {}
    for key, doc in out['documents'].items():
        if doc.get('review_id'):
            by_review.setdefault(doc['review_id'], key)
    for contract_hash, record in records.items():
        snapshot = record.get('snapshot') or {}
        meta = snapshot.get('meta') or {}
        effective_date = max(meta.get('date') or '', (snapshot.get('source_binding') or {}).get('date') or '')
        identity = (snapshot.get('history_reference') or {}).get('review_id')
        if record.get('pending') or opts.get('excludeContractHash') == contract_hash or (identity and identity == excluded):
            continue
        eligible = [(cp_id, v, (record.get('tags') or {}).get(cp_id)) for cp_id, v in (snapshot.get('verdicts') or {}).items()]
        eligible = [(cp_id, v, t) for cp_id, v, t in eligible if human_judgment(v, snapshot) and t is not None
                    and t.get('reason_kind') != 'risk_accepted' and (v.get('comment') or '').strip()]
        if not eligible:
            continue
        key = by_review.get(identity) if identity else None
        if not key:
            key = 'corpus:' + contract_hash
            out['latest'][key] = key
            out['documents'][key] = {'source_id': key, 'source_kind': 'contract_review', 'contract_hash': contract_hash,
                'review_id': identity or '', 'title': '누적 계약검토', 'tags': [], 'evidence': [], 'date': effective_date,
                'family_id': meta.get('family_id') or ''}
            if identity:
                by_review[identity] = key
        doc = out['documents'][key]
        doc.setdefault('evidence', [])
        doc.setdefault('tags', [])
        for cp_id, verdict, tag in eligible:
            text = verdict['comment'].strip()
            if not any(e.get('check_id') == cp_id and e.get('sentence') == text for e in doc['evidence']):
                item = {'source': '사용자 확정 코퍼스 의견 (본건 직접 근거 아님)', 'sentence': text, 'evidence_kind': 'judgment_opinion',
                        'check_id': cp_id, 'contract_hash': contract_hash, 'date': effective_date, 'reviewer': meta.get('reviewer') or ''}
                if 'verdict' in verdict: item['verdict'] = verdict['verdict']
                if 'reason_kind' in tag: item['reason_kind'] = tag['reason_kind']
                doc['evidence'].append(item)
            for topic in tag.get('topics') or []:
                if not any(t.get('type') == 'judgment_topic' and t.get('label') == topic for t in doc['tags']):
                    doc['tags'].append({'type': 'judgment_topic', 'label': topic})
        doc['date'] = max(doc['date'], effective_date) if doc.get('date') and effective_date else ''
    return out


def content_terms(doc):
    return terms(' '.join([doc.get('request_title') or doc.get('title') or '', doc.get('request_context') or '',
        ' '.join(e.get('sentence') or '' for e in doc.get('evidence') or []),
        ' '.join(t.get('label') or '' for t in doc.get('tags') or [] if not re.search(r'부서|유형|결론|효과|department|case_type', t.get('type') or ''))]))


def retrieve(knowledge, input, department=None, options=None):
    opts, query, out = options or {}, terms(input), []
    if not knowledge or not query:
        return out
    for key in (knowledge.get('latest') or {}).values():
        original = (knowledge.get('documents') or {}).get(key)
        if not original:
            continue
        doc = deepcopy(original)
        metadata = (opts.get('familyMap') or {}).get(doc.get('source_id'))
        if metadata:
            for field in ('family_id', 'date'):
                doc.pop(field, None)
                if field in metadata: doc[field] = metadata[field]
        if (doc.get('source_id') in (opts.get('excludeSourceIds') or []) or
                (doc.get('review_id') and doc['review_id'] in (opts.get('excludeSourceIds') or [])) or
                doc.get('family_id') in (opts.get('excludeFamilyIds') or [])):
            continue
        if opts.get('strictIsolation') and (not doc.get('family_id') or not re.search(r'^[0-9]{4}-[0-9]{2}-[0-9]{2}', doc.get('date') or '')):
            continue
        if opts.get('asOf') and (not doc.get('date') or str(doc['date'])[:10] > opts['asOf']):
            continue
        content = content_terms(original)
        hits = [word for word in query if word in set(content)]
        if len(hits) < 2:
            continue
        score = len(hits) / math.sqrt(max(1, len(query) * len(content)))
        out.append({'doc': doc, 'hits': hits, 'score': score + (min(.02, score * .05) if department and department == doc.get('department') else 0)})
    return sorted(out, key=lambda item: -item['score'])[:8]


def rank_types(ranked, related, types, classify):
    votes = {}
    for item in related:
        doc = item['doc']
        if 'contract_name' in ((doc.get('original') or {}).get('conflicts') or []):
            continue
        inferred = classify(doc.get('request_context') or '', types, doc.get('request_title') or doc.get('title') or '', '')
        if inferred and inferred[0].get('titleHit'):
            identity = inferred[0]['typeId']
            votes[identity] = votes.get(identity, 0) + item['score']
    protected = ranked and ranked[0].get('titleHit')
    out = []
    for row in ranked:
        bonus = min(2, votes.get(row['typeId'], 0)) if not protected and row['score'] > 0 and row.get('hits') else 0
        out.append(dict(row, score=row['score'] + bonus, baseScore=row['score'], historyBonus=bonus))
    return sorted(out, key=lambda row: -row['score'])


def terms(value):
    return [s for s in dict.fromkeys(re.findall(r'[가-힣a-z0-9]{2,}',unicodedata.normalize('NFC',value or '').lower())) if not re.search(r'^(계약|계약서|업무|검토|관련|사항|정보|회사|대한|위한|한다|있다)$',s)]


def clause_support(related,check,clause):
    if not related:return {'bonus':0,'terms':[],'sources':[],'evidence':[],'conflicts':[]}
    required=terms(' '.join((check.get('triggers') or {}).get('keywords') or []))
    hits=[];sources=[];evidence=[];conflicts=[]
    current=sentences([{'name':'본건','text':clause.get('body') or ''}])
    def actor(s):
        m=re.search(r'(?:^|\s|["“])(갑|을|위탁자|수탁자|임대인|임차인)["”]?\s*[은는이가]\s',s)
        return m[1] if m else None
    for item in related:
        doc=item['doc']
        for e in doc.get('evidence') or []:
            if e.get('check_id') and e['check_id']!=check['id']:continue
            for prior in sentences([{'name':doc.get('source_id'),'text':e.get('sentence') or ''}]):
                for now in current:
                    common=[word for word in required if word in now['text'] and word in prior['text']]
                    if len(common)<2:continue
                    different_actor=bool(actor(now['text']) and actor(prior['text']) and actor(now['text'])!=actor(prior['text']))
                    different_time=('사전' in now['text'] and '사후' in prior['text']) or ('사후' in now['text'] and '사전' in prior['text'])
                    opposite=now['direction']!='unknown' and prior['direction']!='unknown' and now['direction']!=prior['direction']
                    if different_actor or different_time or opposite or now['exception'] or prior['exception']:
                        conflicts.append({'source_id':doc['source_id'],'current':now['text'],'prior':prior['text'],'actor':different_actor,'timing':different_time,'direction':opposite})
                        continue
                    for word in common:
                        if word not in hits:hits.append(word)
                    if doc['source_id'] not in sources:sources.append(doc['source_id'])
                    evidence.append({'source_id':doc['source_id'],'family_id':doc.get('family_id') or '','date':doc.get('date') or '',
                        'source_kind':doc.get('source_kind') or '','evidence_kind':e.get('evidence_kind') or 'tag_reference','source_label':e.get('source') or '',
                        'sentence':prior['text'],'current':now['text'],'terms':common})
    return {'bonus':min(3,len(hits)) if evidence and not conflicts else 0,'terms':hits,'sources':sources,'evidence':evidence,'conflicts':conflicts}
