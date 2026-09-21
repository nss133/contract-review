from build.audit_checklist_consolidation import inventory, classify, render, runtime_catalog, ROOT
import json


def test_inventory_is_complete_and_reproducible():
    rows = inventory()
    classified = classify(rows)
    assert len(rows) == 238
    assert set(classified) == {c['id'] for c in rows}
    assert (ROOT/'docs/2026-09-16-checklist-consolidation-inventory.md').read_text() == render()
    assert json.loads((ROOT/'knowledge/check_groups.json').read_text()) == runtime_catalog()


def test_runtime_payment_delay_rule_excludes_delivery_penalty():
    c = next(c for c in inventory() if c['id'] == 'CMN-05-2')
    assert '지체상금' not in c['triggers']['keywords']
    assert all('지체상금' not in group for group in c['auto_clear']['any_groups'])
    assert len(c['evidence_required_groups']) == 2
    assert '미지급' in c['evidence_required_groups'][1]


def test_proposal_does_not_flatten_special_requirements():
    m = classify(inventory())
    assert m['CMN-11'][0] == m['SP-DEL-02'][0] == 'DAMAGE'
    assert m['CMN-15'][0] == m['CMN-16'][0] == 'SECRET'
    assert m['SP-PAY-06'][0] != 'DAMAGE'
    assert m['PRIV-08'][0] != 'DAMAGE'
    assert m['PRIV-21'][0] != m['PRIV-15'][0]
    assert 'SP-DEL-08-2' not in m and 'RISK-02' not in m
