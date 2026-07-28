✓ callcenter-outsourcing — 일반 콜센터 업무위탁 — §60(IT-*) 오탐 금지 (감지 outsourcing, consider 10건)
✓ settlement-with-stock-mention — 화해합의서(주식 언급 포함) — settlement 감지, shareholders 억제 (감지 settlement, consider 1건)
✓ mortgage-only-loan — 근저당 대출계약(질권 언급 없음) — 질권·양도담보 부재알람 금지 (감지 finance, consider 0건)
✓ pledge-missing-perfection — 질권 설정 언급만 있는 대출계약 — 대항요건(FIN-SEC-02) 누락검출 유지 (감지 finance, consider 1건)
✓ genuine-shareholders — 진성 주주간계약(화해 1회 부수언급) — shareholders 정상 감지 (감지 shareholders, consider 2건)
✓ nda-basic — 비밀유지계약 — nda 정상 감지 (감지 nda, consider 1건)
✓ gift-undetermined — 증여계약(지원 외 유형) — 유형 미확정 처리 (감지 None, consider 0건)
✓ procurement-system — 일반 시스템 구축 계약 — procurement 감지, X-EFIN 오탐 금지 (감지 procurement, consider 1건)
✓ channel-ga — GA 위탁판매 계약 — channel 감지, 모집규제 모듈 활성 (감지 channel, consider 4건)
✓ purpose-no-comment — 목적 조항 단독 계약 — 구체 항목의 목적 조항 부착 금지(weak-role) (감지 outsourcing, consider 7건)
✓ std-subcontract-service — 공정위 표준하도급(용역) — procurement 감지·X-SUB 활성·SLA 오탐 금지 (감지 procurement, consider 0건)
✓ std-lease — 주택임대차 표준계약서 — procurement 감지(임대차 커버) (감지 procurement, consider 0건)
✓ std-discretionary — 표준투자일임계약서 — investment 감지·M-MANDATE 활성 (감지 investment, consider 1건)
✓ std-nda — 중기부 표준 NDA — nda 감지·X-CROSS 오활성 금지 (감지 nda, consider 0건)
✓ std-dispatch — 근로자파견 표준안 — outsourcing 감지·M-DISPATCH 활성·X-REINS 오탐 금지 (감지 outsourcing, consider 1건)
✗ mal-ga-recruit — 사내표준 GA에이전트 위촉 — 표준서식 회귀(사내표준층) (감지 outsourcing, consider 2건)
    - 유형감지: 기대 channel ≠ 실제 outsourcing
✗ mal-ga-std-consign — 사내표준 개인보험대리점 위탁 — 표준서식 회귀(사내표준층) (감지 outsourcing, consider 17건)
    - 유형감지: 기대 channel ≠ 실제 outsourcing
✗ mal-trust — 사내표준 보험금청구권신탁 — 표준서식 회귀(사내표준층) (감지 outsourcing, consider 13건)
    - 유형감지: 기대 investment ≠ 실제 outsourcing
✓ mal-it-svc — 사내표준 IT용역위탁 — 표준서식 회귀(사내표준층) (감지 procurement, consider 2건)
✓ mal-ad-online — 사내표준 온라인 광고 — 표준서식 회귀(사내표준층) (감지 procurement, consider 10건)
✓ mal-ad-media — 사내표준 언론사 광고 — 표준서식 회귀(사내표준층) (감지 procurement, consider 1건)
✗ mal-sponsor — 사내표준 후원약정 — 표준서식 회귀(사내표준층) (감지 procurement, consider 2건)
    - 유형감지: 기대 alliance ≠ 실제 procurement
✓ mal-purchase — 사내표준 물품·용역 구매 — 표준서식 회귀(사내표준층) (감지 procurement, consider 2건)
✓ mal-edu-svc — 사내표준 교육용역 — 표준서식 회귀(사내표준층) (감지 procurement, consider 0건)
✗ mal-ga-annex — 사내표준 자립GA 부속약정 — 표준서식 회귀(사내표준층) (감지 finance, consider 16건)
    - 유형감지: 기대 channel ≠ 실제 finance
✓ mal-ga-transfer — 사내표준 GA간 영업양수도 — 표준서식 회귀(사내표준층) (감지 channel, consider 4건)
✓ mal-lease-lessor — 사내표준 임대차(임대인용) — 표준서식 회귀(사내표준층) (감지 procurement, consider 3건)
골드셋: 22/27 통과
