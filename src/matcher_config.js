"use strict";
/* 매칭 엔진 v3 임계값·가중치 상수.
   comp_matching_auto/matcher/review_rules.py ReviewConfig 캘리브레이션 값을 출발점으로 함
   (ABS_SCORE=35, MARGIN_HIGH=5, MARGIN_LOW=2). REVIEW_FLOOR·가중치는 계약서 도메인 초기값.
   골드셋 라벨링 후 재보정 여지 — 스펙 E 참조. */

var MatcherConfig = {
  ABS_SCORE: 35,        // 절대점수 자동확정 하한(규범유형 무관 — 단독 도달 가능)
  MARGIN_HIGH: 5,       // 1·2위 점수차 고임계(자동확정)
  MARGIN_LOW: 2,        // 1·2위 점수차 중임계(규범일치 병행)
  REVIEW_FLOOR: 15,     // 검토필요 최저 점수 — 미만이면 none
  TITLE_K: 2,           // clause 표제 용어 질의 반복 횟수(TF 가중)
  TW: 0.8,              // 일반 조항 tfidf 가중
  JW: 0.2,              // 일반 조항 jaccard 가중
  TW_SHORT: 0.65,       // 짧은 조항 tfidf 가중
  JW_SHORT: 0.35,       // 짧은 조항 jaccard 가중
  SHORT_LEN: 120,       // 짧은 조항 판정 본문 길이(자)
  NORM_BONUS: 3,        // 규범유형 일치 가산
  TITLE_BONUS_MAX: 5,   // 표제 용어 겹침 가산 상한
  OVERLAP_MIN: 2,       // 노출(verify/addressed) 자격 최소 고유 핵심어 겹침 — 단일 겹침은 quiet 강등
  // 조항 귀속 게이트(11.3차): 표제가 다른 체크를 정면으로 지시하는 조항에서, 표제 근거가 없는
  // 체크가 살아남으려면 요구되는 본문 겹침 수. 미만이면 "참조 언급 수준"으로 보고 접음.
  // 실측 캘리브레이션: 오탐(제35조 매수청구권에 붙은 총회·공시 체크)은 겹침 2~3,
  // 정탐(제6조 보호조치 조항의 접근제한 체크)은 겹침 5 — 4를 경계로 둠.
  OWNED_CLAUSE_MIN_OVERLAP: 4,
  TITLE_STRONG_RATIO: 0.5, // 표제 강일치 예외: 조항 표제 핵심어 중 check와 겹친 비율 하한
  ALARM_SEVERITIES: ["필수", "권장"], // 검토 제안(consider) 알람 게이트 — 참고 부재는 조용(quiet)

  // ── 유형 감지 v2 (P3) ──────────────────────────────────────────
  DETECT_HEAD_LEN: 300,   // 표제부(제목·전문) 판정 길이(자) — 이 안의 키워드는 강신호
  DETECT_TITLE_W: 3,      // 표제부 키워드 1회당 가중(본문 1회=1)
  DETECT_DOCTITLE_W: 8,   // 문서 제목(표제 줄) 키워드 1회당 가중 — 최상위 신호(11.1차).
                          //   제목 1회만으로 DETECT_MIN_SCORE(3)를 넘어 유형이 확정되게 함
  DETECT_SPEC_CAP: 3,     // 제목 가중의 특정성 배율 상한(11.4차) — 키워드 길이/2, 최대 3배.
                          //   범용어('위탁' 2자=1.0)보다 특정어('보험대리점' 5자=2.5)를 우선
  DETECT_BODY_CAP: 5,     // 키워드당 본문 카운트 상한 — 긴 문서의 반복 언급이 점수를 지배하지 못하게
  DETECT_MIN_SCORE: 3     // 유형 확정 최저 점수 — 미달이면 미확정(공통 검토만). 표제 1회(3) 또는 본문 3회면 확정
};

if (typeof module !== "undefined") module.exports = MatcherConfig;
