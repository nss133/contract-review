"""Explicit document signals and human overrides; no inferred negative facts."""
import re
import unicodedata

FACTORS = ['financial_business_purpose', 'continuous_use', 'simple_backoffice_exclusion']


def hits(text, words, legal=False):
    text = text or ''
    if legal: text = unicodedata.normalize('NFC', text)
    out = []
    action = '제공|지급|수행|포함|진행|취급|권유|모집' if legal else '포함|수행|처리|제공|해당|취급'
    pattern = r'(' + action + r').{0,24}(하지\s*(않|아니)|않는다|아니다|없다)|무관'
    for word in words or []:
        if not word: continue  # Reject empty signals instead of looping forever.
        start = 0
        while True:
            index = text.find(word, start)
            if index < 0: break
            left = max(text.rfind('.', 0, index+1), text.rfind('\n', 0, index+1)) + 1
            ends = [text.find(c, index) for c in ('.', '\n')]
            right = min(e if e >= 0 else len(text) for e in ends)
            if not re.search(pattern, text[left:right]):
                if legal or word not in out: out.append(word)
                break
            start = index + len(word)
    return out


def scope_effects(alerts):
    out = {}
    for alert in alerts or []: out.update(alert.get('scope_effects') or {})
    return out


def assess_legal(text, registry=None, context=None):
    ctx, matched = context or {}, []
    sources = [('본문', unicodedata.normalize('NFC', text or '')),
               ('제목', unicodedata.normalize('NFC', ctx.get('docTitle') or '')),
               ('파일명', re.sub(r'\.[A-Za-z0-9]+$', '', unicodedata.normalize('NFC', ctx.get('fileName') or '')))]
    for rule in (registry or {}).get('rules', []):
        groups, used = {}, []
        for group, words in (rule.get('signals') or {}).items():
            group_hits = []
            for label, source in sources:
                for word in hits(source, words, legal=True):
                    item = label + ': ' + word
                    if item not in group_hits: group_hits.append(item)
                    if label not in used: used.append(label)
            groups[group] = group_hits
        if not all(groups.get(group) for group in rule.get('requires') or []): continue
        matched.append({'id': rule['id'], **({'label': rule['label']} if 'label' in rule else {}), 'severity': rule.get('severity') or '확인',
                        'route': rule.get('route') or 'legal_review', 'affects_type': rule.get('affects_type') is True,
                        'summary': rule.get('summary') or '', 'reason': rule.get('reason') or '',
                        'evidence': groups, 'input_sources': used, 'scope_effects': rule.get('scope_effects') or {},
                        'sources': rule.get('sources') or [], 'supersedes': rule.get('supersedes') or []})
    suppressed = {i for alert in matched for i in alert['supersedes']}
    return [alert for alert in matched if alert['id'] not in suppressed]


def _status(factors, context):
    financial, continuous, simple = [factors[key] for key in FACTORS]
    manual = any(f['source'] == 'manual' for f in factors.values())
    if not manual and context.get('nonApplicableContractHits'):
        return 'non_applicable', '계약의 성격상 금융업무위탁 규정은 적용하지 않고 해당 계약 유형의 체크리스트로 검토합니다.', None
    if (financial['source'] == 'manual' and financial['value'] == 'no') or (continuous['source'] == 'manual' and continuous['value'] == 'no') or (simple['source'] == 'manual' and simple['value'] == 'yes'):
        return 'non_applicable', '검토자가 규정 정의요건의 불충족 또는 단순 후선업무 제외를 확인했습니다.', None
    if not manual and (context.get('scopeEffects') or {}).get('financial_outsourcing') == 'non_applicable':
        return 'non_applicable', '행사 실행용역에 보험모집 신호가 섞였지만 이를 일반 업무위탁의 양성 근거로 쓰지 않고 별도 보험모집 준법 확인으로 분리했습니다.', 'medium'
    if financial['value'] == 'yes' and (continuous['value'] == 'no' or simple['value'] == 'yes'):
        return 'needs_confirmation', '금융업무 신호와 단발성·단순 집행용역 신호가 함께 있어 실질 확인이 필요합니다.', None
    if financial['value'] == 'yes' and continuous['value'] == 'yes' and simple['value'] != 'yes':
        return 'applicable', '금융업 영위 목적의 업무와 제3자 용역의 계속적 활용이 함께 확인됩니다.', None
    if financial['value'] != 'yes' and (continuous['value'] == 'no' or simple['value'] == 'yes'):
        return 'non_applicable', '금융업무 신호 없이 단발성 또는 단순 후선·집행용역의 성격이 확인됩니다.', None
    return 'needs_confirmation', '계약 문언만으로 금융업 목적·계속성·단순 후선업무 여부를 확정하기 어렵습니다.', None


def assess_financial_outsourcing(text, config=None, answers=None, context=None):
    config, answers, context = config or {}, answers or {}, context or {}
    title = context.get('docTitle') or ''
    file = re.sub(r'\.[A-Za-z0-9]+$', '', unicodedata.normalize('NFC', context.get('fileName') or ''))
    source = '\n'.join(filter(None, [text or '', title, file]))
    signals = config.get('signals') or {}
    found = {k: hits(source, signals.get(k)) for k in ['non_applicable_contract','financial_business','continuous_use','one_off','simple_backoffice']}
    def factor(value, evidence): return {'value': value, 'source': 'document', 'evidence': evidence[:8]}
    factors = {FACTORS[0]: factor('yes' if found['financial_business'] else 'unknown', found['financial_business']),
               FACTORS[1]: factor('yes' if found['continuous_use'] else 'no' if found['one_off'] else 'unknown', found['continuous_use'] or found['one_off']),
               FACTORS[2]: factor('yes' if found['simple_backoffice'] else 'unknown', found['simple_backoffice'])}
    for key in FACTORS:
        if answers.get(key) in ('yes','no','unknown'):
            factors[key] = {'value': answers[key], 'source': 'manual', 'evidence': []}
    status, reason, confidence = _status(factors, {**context, 'nonApplicableContractHits': found['non_applicable_contract']})
    review = [k for k in FACTORS if factors[k]['value'] == 'unknown'] if status == 'needs_confirmation' else []
    if status == 'needs_confirmation' and not review: review = [FACTORS[0], FACTORS[2]]
    return {'scope_id': 'financial_outsourcing', 'label': config.get('label') or '금융업무위탁 규정',
            'module_id': config.get('module_id') or 'X-FINOUT', 'check_source_type': config.get('check_source_type') or 'outsourcing',
            'status': status, 'confidence': confidence or ('low' if status == 'needs_confirmation' else 'high'), 'reason': reason,
            'scope_evidence': found['non_applicable_contract'], 'factors': factors, 'review_factors': review,
            'input_sources': [label for label,value in [('본문',text or ''),('제목',title),('파일명',file)] if value.strip()]}


def assess_all(text, registry=None, answers=None, context=None):
    return {key: assess_financial_outsourcing(text, config, (answers or {}).get(key), context)
            for key,config in ((registry or {}).get('scopes') or {}).items() if key == 'financial_outsourcing'}
