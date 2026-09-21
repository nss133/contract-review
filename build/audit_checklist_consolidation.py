"""Generate the reviewed proposal inventory; never changes runtime checks or verdicts."""
from pathlib import Path
from collections import Counter
import yaml
import json
import zlib
import base64

ROOT = Path(__file__).resolve().parents[1]
# Explicit membership: similarity alone must never merge normative requirements.
GROUPS = [
    ('DAMAGE', '손해배상·면책·지연책임의 합리성', '통합',
     'CMN-05-2 CMN-11 CMN-12 CMN-14 RISK-06 SP-DEL-02',
     '귀책·범위·상한·면책·지급지연·이행지연을 조건부 세부요건으로 보존. 약정이 없는 선택특약을 일률적으로 누락 처리하지 않음.'),
    ('SECRET', '비밀정보 보호 범위·의무·존속기간', '통합',
     'CMN-15 CMN-16 NDA-01 NDA-02 NDA-03 NDA-04 NDA-05 NDA-06 NDA-07 NDA-08 NDA-09 NDA-10 NDA-21',
     '공통은 정의·기간 중심, NDA 유형에서만 보호의무·예외 세부요건 확장. 정의 존재만으로 기간·예외까지 충족시키지 않음.'),
    ('END', '계약 종료 사유·절차의 합리성', '통합',
     'CMN-08 CMN-09 SP-UNF-09 SOL-02',
     '해지권 배분·시정·통지는 각각 근거 보존. 약관/모집 위탁 조건을 분리하고 하자해제권은 별도 구제수단에 유지.'),
    ('EXIT', '종료 후 정산·반환·이관', '조건부 묶음',
     'CMN-10 NDA-12 CH-02',
     '정산, 비밀정보 파기, 고객보호는 서로 대체 불가. 적용되는 세부요건 전부를 확인해야 묶음 완료.'),
    ('SCOPE', '계약 목적·수행 범위', '통합',
     'CMN-02 ALL-CORE-01 CORE-01',
     '제휴 역할과 위탁 업무범위를 유형별 하위요건으로 보존. 목적 문장만으로 실제 수행범위까지 충족시키지 않음.'),
    ('PRICE', '대가 산정·지급·정산', '통합',
     'CMN-03 CMN-04 CH-01 INV-BEN-06 SETTLE-07',
     '산정식·지급조건·정산 근거는 별도 슬롯. 수수료/화해금 등 유형별 조건을 유지. VAT는 자동 확인 사실을 이 화면에 표시.'),
    ('TERM', '계약기간·갱신', '통합',
     'CMN-06 CMN-07',
     '최초 기간과 갱신거절 기한은 다른 사실. 기간 자동확인 결과를 갱신 공정성 판정으로 확대하지 않음.'),
    ('IP', '산출물 권리·인도·사용 가능성', '조건부 묶음',
     'CMN-17 ITDL-01 ITDL-02',
     '저작권 귀속과 소스 인도/에스크로는 대체 불가. 인도가 필요한 계약만 하위요건 활성화.'),
    ('LICENSE', '제3자 권리·라이선스 대응', '조건부 묶음',
     'CMN-18 ITDL-07',
     '침해 시 방어·책임과 오픈소스 이용조건을 구별. 손해배상 일반조항만으로 라이선스 준수 충족 불가.'),
    ('PRIVSCOPE', '개인정보 위탁 범위·목적 제한', '통합',
     'PRIV-01 PRIV-02 PRIV-04 PRIV-14',
     '위탁 문서화, 범위 특정, 목적 외 처리/제공 금지를 모두 보존. 제3자 제공과 혼합하지 않음.'),
    ('PRIVSEC', '개인정보 안전조치', '조건부 묶음',
     'PRIV-03 PRIV-06 PRIV-19',
     '안전조치 총칙으로 접근통제·신용정보 암호화까지 충족시키지 않음. 정보종류별 조건 보존.'),
    ('PRIVMON', '수탁자 교육·점검·감독', '조건부 묶음',
     'PRIV-07 PRIV-13 PRIV-20',
     '감독권, 교육, 실제 점검/안전처리 책임을 보존. 신용정보 조건은 독립 활성화.'),
    ('PRIVSUB', '개인정보 재위탁 통제', '통합',
     'PRIV-05 PRIV-15',
     '재위탁 제한과 동의 요건을 한 질문에 표시. 신용정보 재위탁(PRIV-21)은 별도 규칙 유지.'),
    ('PRIVNOTICE', '위탁 사실 공개', '통합',
     'PRIV-09 PRIV-10',
     '공개 내용과 공개 수단을 세부요건으로 유지. 홍보 통지/감독기관 통지는 별도.'),
    ('OUTSUB', '업무 재위탁 동의·보고', '조건부 묶음',
     'CORE-07 CORE-08 ITSEC-11',
     '당사자 동의와 감독 보고는 대체 불가. 업무/전산 위탁 적용조건 및 보고 주체 유지.'),
    ('OUTAUDIT', '감독·검사·시정 협조', '조건부 묶음',
     'CORE-10 CORE-13 CORE-14',
     '회사 감독권과 감독기관 검사권을 분리. 변경권고 협조도 고유 요건 유지.'),
    ('LABOR', '수탁자 인력 운영의 독립성', '통합',
     'DIS-01 DIS-02 DIS-03',
     '직접 명령, 지시 창구, 인사노무 권한을 하위 질문으로 보존. 계약 문구로 실제 운영 적법성을 확정하지 않음.'),
    ('CONTINUITY', '중단 대응·백업·업무연속성', '조건부 묶음',
     'ITCL-03 ITSEC-06 ITSEC-08',
     '비상대응과 복구/백업을 별도 확인. 클라우드의 안전성 요건을 단순 백업 유무로 축소하지 않음.'),
    ('VENDOR', '수탁자 건전성·서비스 평가', '조건부 묶음',
     'ITCL-02 ITSEC-09 ITSEC-10',
     '최초 안전성 평가와 정기 재무/품질평가 주기·대상을 유지.'),
    ('SECOPS', '보안관리·검토·점검', '조건부 묶음',
     'ITSEC-07 ITSEC-13',
     '개발단계별 관리와 보안성검토/정기점검은 별도 근거 필요. 보안약정 제목만으로 통과 불가.'),
    ('UNFAIR', '부당특약·불공정 약관', '조건부 묶음',
     'SP-UNF-01 SP-UNF-02 SP-UNF-05 SP-UNF-06',
     '하도급 특약과 약관 규율의 적용조건을 보존. 전반 점검은 구체적 위반 결과를 요약하고 같은 판정을 반복 요구하지 않음.'),
    ('DEFECT', '도급 하자·불완전이행 구제', '조건부 묶음',
     'SP-DEL-05 SP-DEL-06 SP-DEL-07 SP-DEL-08 SP-DEL-12',
     '보수·배상·해제·기간은 대체 불가. 도급/위임 성격별 분기 유지; 이행보증보험 항목은 복원하지 않음.'),
    ('SALEDEFECT', '매매 하자 구제·기간', '통합',
     'SP-DEL-09 SP-DEL-10 SP-DEL-11',
     '완전물 청구와 행사기간 보존. 도급 하자 묶음과 별도 계약 성격 분기.'),
    ('FORCE', '위험부담·불가항력 처리', '조건부 묶음',
     'SP-DEL-03 SP-DEL-03-2 SP-DEL-04',
     '무귀책 위험, 불가항력 사후처리, 채권자 귀책을 구별. 동일 결과로 일괄 판정하지 않음.'),
    ('SUBPAY', '하도급 지급기한·지연 처리', '조건부 묶음',
     'SP-PAY-01 SP-PAY-02 SP-PAY-03 SP-PAY-06',
     '기산점·간주기일·수령 후 지급·지연이자를 각각 유지. 일반 지연이자 약정과 자동 대체 불가.'),
    ('LOANINT', '대출 이자·지연손해금', '조건부 묶음',
     'FIN-LOAN-02 FIN-LOAN-03 FIN-LOAN-04',
     '약정이율/기산일/상한/연체이율을 분리. 비율 존재만으로 상한 적합성 자동판정 금지.'),
    ('SETTLESCOPE', '화해 범위·권리 포기의 합리성', '조건부 묶음',
     'SETTLE-03 SETTLE-05 SETTLE-06 RISK-SET-01',
     '정산범위·부제소·포기는 효과가 달라 각각 기록. 알려지지 않은 권리까지 포괄 포기하는 위험 유지.'),
    ('SHAPPROVE', '주식 양도 승인·효력·우선매수 절차', '조건부 묶음',
     'SH-SHARE-01 SH-SHARE-02 SH-SHARE-04 SH-SHARE-05',
     '정관 제한, 미승인 효력, 승인/우선매수 순서와 절차 보존. tag/drag는 독립 유지.'),
    ('SHCOMMIT', '핵심주주 경업·전업 의무', '통합',
     'SH-EXIT-01 SH-EXIT-02',
     '경업금지 범위·기간과 전업/겸직 의무를 구별. 퇴사 시 정산은 독립 유지.'),
    ('INVNOTICE', '투자자 공시·통지', '조건부 묶음',
     'INV-BEN-04 INV-BEN-07',
     '규약 변경 공시와 일반 통지의 대상·시점·수단 보존. 변경 결의나 반대권까지 대체하지 않음.'),
]


def inventory():
    archive=ROOT/'knowledge/archive/v1.69-checks.json.zlib.b64'
    if archive.exists():
        return json.loads(zlib.decompress(base64.b64decode(archive.read_text())))
    rows = []
    for p in [ROOT/'knowledge/common.yaml', *sorted((ROOT/'knowledge/types').glob('*.yaml'))]:
        d = yaml.safe_load(p.read_text())
        rows.extend(dict(c, source=p.stem) for c in d['checks'])
    return rows


def classify(rows):
    by_id = {c['id']: c for c in rows}
    assert len(by_id) == len(rows), 'duplicate source ID'
    membership = {}
    for key, title, action, ids, safeguard in GROUPS:
        for cid in ids.split():
            assert cid in by_id, f'unknown ID: {cid}'
            assert cid not in membership, f'duplicate proposal: {cid}'
            membership[cid] = (key, title, action, safeguard)
    for c in rows:
        cid = c['id']
        if cid in membership:
            continue
        if cid == 'CMN-05':
            v = ('AUTO-VAT', '대가 내 부가세 표시 자동확인', '자동 사실확인',
                 '포함/제외/별도/미포함의 확정 표시와 출처 저장. 부정·선택·상충은 확인 필요; 세법상 적정성 판정 아님.')
        elif c.get('surface_policy') == 'aggregate_only':
            v = (cid, c.get('label', cid), '요약 유지', '이미 집계용 항목. 하위 결과를 요약하되 중복 수동 판정을 추가하지 않음.')
        else:
            v = (cid, c.get('label', cid), '독립 유지',
                 f"‘{c.get('label', c['check'])}’의 대상·효과·증빙이 인접 항목과 다름. 공통 문구/동일 조항이라는 이유만으로 충족을 승계하지 않음.")
        membership[cid] = v
    return membership


def render():
    rows = inventory()
    membership = classify(rows)
    counts = Counter(v[2] for v in membership.values())
    parents = len({v[0] for v in membership.values()})
    lines = ['# 체크리스트 전수 점검 별첨 — 2026-09-16', '',
             'v1.69 통합 구성 대응표임. 전체 원항목을 빠짐없이 한 번씩 분류함. 원본 질문·근거·적용조건·ID는 삭제하지 않음.', '',
             f'- 원항목 {len(rows)}개 / 공통 {sum(c["source"] == "common" for c in rows)}개 / 유형별 {sum(c["source"] != "common" for c in rows)}개',
             '- 분류: ' + ', '.join(f'{k} {v}개' for k, v in counts.items()),
             f'- 제안된 검토 단위 {parents}개(자동 사실확인·집계용 포함). 전체 카탈로그 기준이며 한 계약의 표시 개수·실제 절감률이 아님.',
             '- v1.69에서 30개 묶음의 상위 판정 UI·완료 집계·분리 저장을 구현함. 과거 일부 세부 판정은 전체 완료로 승격하지 않으며 원본대로 보존함.', '',
             '## 묶음별 보존할 차이·손실 방지', '',
             '| 묶음 | 제안 | 원항목 | 보존할 차이·주의사항 |', '|---|---|---|---|']
    for key, title, action, ids, safeguard in GROUPS:
        lines.append(f'| {key} · {title} | {action} | {ids} | {safeguard} |')
    lines += ['', '## 전수 항목 대응표', '',
              '독립 유지는 “더 통합할 수 없음”이 아니라 이번 1차 설계에서 효과·적용조건 차이를 우선 보존한다는 뜻임. 조건부 묶음은 동일 질문으로 법적 효과를 합치는 것이 아니라 같은 검토 카드 아래에서 별도 요건을 평가한다는 뜻임.', '',
              '| ID | 원본 질문 | 구분 / 모듈 | 처리 | 제안 단위 |', '|---|---|---|---|---|']
    for c in rows:
        key, title, action, _ = membership[c['id']]
        question = c['check'].replace('|', ' / ').replace('\n', ' ')
        lines.append(f'| {c["id"]} | {question} | {c["source"]} / {c.get("module", "공통")} | {action} | {key} · {title} |')
    lines += ['', '## 독립 유지 근거', '']
    for c in rows:
        _, _, action, reason = membership[c['id']]
        if action in ('독립 유지', '요약 유지'):
            lines.append(f'- {c["id"]}: {reason}')
    return '\n'.join(lines) + '\n'


def runtime_catalog():
    classify(inventory())
    return {'version': 'review-groups-v1', 'groups': [
        {'id': key, 'title': title, 'action': action, 'members': ids.split(), 'safeguard': safeguard}
        for key, title, action, ids, safeguard in GROUPS]}


if __name__ == '__main__':
    out = ROOT/'docs/2026-09-16-checklist-consolidation-inventory.md'
    out.write_text(render())
    (ROOT/'knowledge/check_groups.json').write_text(json.dumps(runtime_catalog(), ensure_ascii=False, indent=2)+'\n')
    print(out)
