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
  ALARM_SEVERITIES: ["필수", "권장"] // 검토 제안(consider) 알람 게이트 — 참고 부재는 조용(quiet)
};

if (typeof module !== "undefined") module.exports = MatcherConfig;
