# 공개 표준계약서 실험군

공식 기관이 공개한 문서를 매칭·조항 분할·LLM 교차검토 실험에 사용한다.
원문 PDF와 `pdftotext -layout`으로 추출한 텍스트를 함께 보관한다.

## 수록 파일

| ID | 파일 | 문서 성격 | 공식 출처 |
| --- | --- | --- | --- |
| GOV-SVC-2024 | `raw/local-government-service-standard.pdf` | 지방자치단체 용역 표준계약서 | [국가법령정보센터 별지 제9호서식](https://www.law.go.kr/LSW/flDownload.do?flSeq=146054401) |
| PERF-SHARE | `raw/performance-sharing-standard.pdf` | 성과공유제 표준계약서 전문 | [국가법령정보센터 별지 제1호서식](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200203&flNm=%5B%EB%B3%84%EC%A7%80+1%5D+%EC%84%B1%EA%B3%BC%EA%B3%B5%EC%9C%A0%EC%A0%9C+%ED%91%9C%EC%A4%80%EA%B3%84%EC%95%BD%EC%84%9C%28%EC%A0%84%EB%AC%B8%29&flSeq=141426447) |
| POP-TRAINEE-2025 | `raw/pop-culture-trainee-standard.pdf` | 대중문화예술분야 연습생 표준계약서 | [국가법령정보센터 별표 1](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flNm=%5B%EB%B3%84%ED%91%9C+1%5D+%EB%8C%80%EC%A4%91%EB%AC%B8%ED%99%94%EC%98%88%EC%술분야+연습생+표준계약서&flSeq=159682555) |
| WORK-ATHLETE-2024 | `raw/workplace-athlete-standard.pdf` | 직장운동경기부 선수 표준계약서 | [국가법령정보센터 별표 1](https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flNm=%5B별표+1%5D+직장운동경기부+선수+표준계약서&flSeq=153785783) |
| ESPORTS-GUIDE | `raw/esports-standard-guideline.pdf` | e스포츠 선수 표준계약서 사용지침 및 조항 예시 | [문화체육관광부 공개 PDF](https://mcst.go.kr/servlets/eduport/front/upload/UplDownloadFile?pFileName=%EC%9D%B4%EC%8A%A4%ED%8F%AC%EC%B8%A0+%EC%84%A0%EC%88%98+%ED%91%9C%EC%A4%80%EA%B3%84%EC%95%BD%EC%84%9C+%EC%82%AC%EC%9A%A9%EC%A7%80%EC%B9%A8.pdf&pPath=0405050000&pRealName=StdContract20210209060000076036.pdf) |

`ESPORTS-GUIDE`는 순수 계약서 단독본이 아니므로 정확도 골드셋에서는 별도 그룹으로 취급한다.
문서 개정 여부가 중요한 실험에서는 원문 다운로드일과 공식 페이지의 시행일을 함께 확인한다.

## 실험 입력

앱에서 `text/` 아래 `.txt` 파일을 붙여넣거나 파일 입력으로 `raw/` PDF를 선택한다.
실험 기록에는 원문을 복제하지 않고 문서 ID, 규칙 결과, LLM 결과, 사람의 정답 조항만 남긴다.
