"""공개 표준계약서에서 qwen3:4b 재정렬 예측과 블라인드 골드를 생성한다."""
import argparse
import json
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from validate import load_knowledge

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CORPUS = ROOT / "testdata" / "standard_contracts"
RUNNER = ROOT / "build" / "matching_experiment_runner.js"


def _post_review(endpoint, batch, attempts=3):
    body = json.dumps({"model": "qwen3:4b", "items": batch}, ensure_ascii=False).encode()
    request = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"})
    last_error = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            last_error = RuntimeError(f"HTTP {exc.code}: {detail}")
        except (OSError, ValueError) as exc:
            last_error = exc
        if attempt + 1 < attempts:
            time.sleep(1)
    raise last_error


def _attach(prediction, responses):
    findings = {}
    for response in responses:
        for finding in response.get("findings", []):
            findings[finding["check_id"]] = finding
    for item in prediction["items"]:
        finding = findings.get(item["check_id"])
        if not finding:
            continue
        item["llm_reviewed"] = True
        item["llm_selected_clause_index"] = finding["selected_clause_index"]
        item["llm_relation"] = finding["relation"]
        item["llm_completeness"] = finding["completeness"]
        item["hybrid_clause_index"] = (
            finding["selected_clause_index"] if finding["relation"] == "direct" else None
        )
    return len(findings)


def _carry_reviewed(prediction, previous):
    old = {item["check_id"]: item for item in previous.get("items", []) if item.get("llm_reviewed")}
    fields = ["llm_reviewed", "llm_selected_clause_index", "llm_relation",
              "llm_completeness", "hybrid_clause_index"]
    for item in prediction["items"]:
        if item["check_id"] in old:
            for field in fields:
                item[field] = old[item["check_id"]].get(field)


def prepare(corpus_dir, app_version):
    manifest = json.loads((corpus_dir / "manifest.json").read_text())
    knowledge = load_knowledge(ROOT / "knowledge")
    documents = [
        {"id": entry["id"], "text": (corpus_dir / entry["text"]).read_text()}
        for entry in manifest["documents"]
    ]
    payload = {
        "common": knowledge["common"], "types": knowledge["types"], "documents": documents,
        "generated": date.today().isoformat(), "app_version": app_version,
    }
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False)
        input_path = Path(handle.name)
    try:
        proc = subprocess.run(
            ["node", str(RUNNER), str(input_path)], cwd=ROOT, text=True,
            capture_output=True, check=True,
        )
        return json.loads(proc.stdout)
    finally:
        input_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--out", type=Path, default=ROOT / "experiment")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8765/api/llm/review")
    parser.add_argument("--skip-llm", action="store_true")
    parser.add_argument("--resume", action="store_true", help="기존 예측의 완료 항목을 유지하고 누락만 호출")
    args = parser.parse_args()
    rows = prepare(args.corpus, (ROOT / "VERSION").read_text().strip())
    pred_dir, gold_dir = args.out / "predictions", args.out / "gold"
    pred_dir.mkdir(parents=True, exist_ok=True)
    gold_dir.mkdir(parents=True, exist_ok=True)
    for row in rows:
        reviewed = 0
        failures = []
        output_path = pred_dir / f"{row['id']}.json"
        if args.resume and output_path.exists():
            _carry_reviewed(row["prediction"], json.loads(output_path.read_text()))
        if not args.skip_llm:
            responses = []
            completed = {x["check_id"] for x in row["prediction"]["items"] if x.get("llm_reviewed")}
            batches = [[x for x in batch if x["check_id"] not in completed] for batch in row["batches"]]
            batches = [batch for batch in batches if batch]
            for index, batch in enumerate(batches, start=1):
                try:
                    response = _post_review(args.endpoint, batch)
                    responses.append(response)
                    returned = {x["check_id"] for x in response.get("findings", [])}
                    for missing in (x for x in batch if x["check_id"] not in returned):
                        responses.append(_post_review(args.endpoint, [missing]))
                except Exception as exc:  # 문서별 부분 결과를 보존하고 실패율로 보고한다.
                    failures.append({"batch": index, "check_ids": [x["check_id"] for x in batch], "error": str(exc)})
                    print(f"{row['id']}: 배치 {index} 실패: {exc}")
            reviewed = _attach(row["prediction"], responses)
        row["prediction"]["meta"]["llm_batch_failures"] = failures
        reviewed = sum(1 for x in row["prediction"]["items"] if x.get("llm_reviewed"))
        output_path.write_text(
            json.dumps(row["prediction"], ensure_ascii=False, indent=2) + "\n"
        )
        (gold_dir / f"{row['id']}.json").write_text(
            json.dumps(row["gold"], ensure_ascii=False, indent=2) + "\n"
        )
        eligible = sum(len(batch) for batch in row["batches"])
        print(f"{row['id']}: LLM {reviewed}/{eligible}건 / 실패 배치 {len(failures)}개")
    print(f"예측: {pred_dir}\n블라인드 골드: {gold_dir}")


if __name__ == "__main__":
    main()
