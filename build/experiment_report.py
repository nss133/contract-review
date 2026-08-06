"""규칙 Top-1 대비 qwen 재정렬의 쌍대 실험 보고서를 생성한다."""
import argparse
import csv
import json
import math
import random
from pathlib import Path


def _load_many(paths, expected_format):
    out = {}
    for path in paths:
        obj = json.loads(Path(path).read_text(encoding="utf-8"))
        if obj.get("format") != expected_format:
            raise ValueError(f"{path}: {expected_format} 형식이 아님")
        doc_id = str(obj.get("meta", {}).get("document_id", ""))
        if not doc_id or doc_id in out:
            raise ValueError(f"{path}: document_id 누락 또는 중복")
        out[doc_id] = obj
    return out


def _correct(predicted, label):
    direct = label.get("direct_clause_indices") or []
    if not direct:
        return predicted is None
    return predicted in direct


def score_documents(predictions, golds):
    rows = []
    for doc_id in sorted(set(predictions) & set(golds)):
        pred = predictions[doc_id]
        labels = {x["check_id"]: x for x in golds[doc_id].get("labels", [])}
        for item in pred.get("items", []):
            label = labels.get(item.get("check_id"))
            if not label or label.get("applicable") is None or not item.get("llm_reviewed"):
                continue
            baseline = _correct(item.get("rule_clause_index"), label)
            hybrid = _correct(item.get("hybrid_clause_index"), label)
            refs = label.get("reference_clause_indices") or []
            direct = label.get("direct_clause_indices") or []
            top3 = [candidate.get("clause_index") for candidate in item.get("candidates", [])]
            rows.append({
                "document_id": doc_id,
                "check_id": item["check_id"],
                "baseline_correct": baseline,
                "hybrid_correct": hybrid,
                "improved": (not baseline and hybrid),
                "harmed": (baseline and not hybrid),
                "gold_in_rule_top3": (not direct or any(index in top3 for index in direct)),
                "baseline_reference_false_positive": (
                    item.get("rule_clause_index") is not None
                    and not direct and item.get("rule_clause_index") in refs
                ),
                "hybrid_reference_false_positive": (
                    item.get("hybrid_clause_index") is not None
                    and not direct and item.get("hybrid_clause_index") in refs
                ),
            })
    return rows


def _mcnemar_exact(improved, harmed):
    discordant = improved + harmed
    if not discordant:
        return 1.0
    tail = sum(math.comb(discordant, k) for k in range(min(improved, harmed) + 1)) / (2 ** discordant)
    return min(1.0, 2 * tail)


def _delta(rows):
    if not rows:
        return 0.0
    return (sum(r["hybrid_correct"] for r in rows) - sum(r["baseline_correct"] for r in rows)) / len(rows)


def _cluster_bootstrap(rows, iterations=2000, seed=20260806):
    by_doc = {}
    for row in rows:
        by_doc.setdefault(row["document_id"], []).append(row)
    docs = sorted(by_doc)
    if not docs:
        return [0.0, 0.0]
    rng = random.Random(seed)
    values = []
    for _ in range(iterations):
        sample = []
        for doc in (rng.choice(docs) for _ in docs):
            sample.extend(by_doc[doc])
        values.append(_delta(sample))
    values.sort()
    return [values[int(0.025 * (iterations - 1))], values[int(0.975 * (iterations - 1))]]


def summarize(rows):
    n = len(rows)
    baseline = sum(r["baseline_correct"] for r in rows)
    hybrid = sum(r["hybrid_correct"] for r in rows)
    improved = sum(r["improved"] for r in rows)
    harmed = sum(r["harmed"] for r in rows)
    ci = _cluster_bootstrap(rows)
    return {
        "n": n,
        "documents": len({r["document_id"] for r in rows}),
        "baseline_correct": baseline,
        "hybrid_correct": hybrid,
        "baseline_accuracy": baseline / n if n else 0,
        "hybrid_accuracy": hybrid / n if n else 0,
        "delta_accuracy": (hybrid - baseline) / n if n else 0,
        "delta_accuracy_ci95_document_bootstrap": ci,
        "improved": improved,
        "harmed": harmed,
        "net_improved": improved - harmed,
        "rule_recall_at_3": sum(r["gold_in_rule_top3"] for r in rows) / n if n else 0,
        "mcnemar_exact_p": _mcnemar_exact(improved, harmed),
        "baseline_reference_false_positive": sum(r["baseline_reference_false_positive"] for r in rows),
        "hybrid_reference_false_positive": sum(r["hybrid_reference_false_positive"] for r in rows),
    }


def _pct(value):
    return f"{value * 100:.1f}%"


def render_markdown(summary):
    lo, hi = summary["delta_accuracy_ci95_document_bootstrap"]
    return "\n".join([
        "# 규칙 Top-1 vs qwen3:4b Hybrid 매칭 실험",
        "",
        f"- 문서: {summary['documents']}건",
        f"- 채점 가능한 쌍: {summary['n']}건",
        f"- 규칙 정확도: {summary['baseline_correct']}/{summary['n']} ({_pct(summary['baseline_accuracy'])})",
        f"- Hybrid 정확도: {summary['hybrid_correct']}/{summary['n']} ({_pct(summary['hybrid_accuracy'])})",
        f"- 정확도 차이: {_pct(summary['delta_accuracy'])} (문서 bootstrap 95% CI {_pct(lo)} ~ {_pct(hi)})",
        f"- 규칙 Recall@3: {_pct(summary['rule_recall_at_3'])}",
        f"- 규칙 오답 -> Hybrid 정답: {summary['improved']}건",
        f"- 규칙 정답 -> Hybrid 오답: {summary['harmed']}건",
        f"- 순개선: {summary['net_improved']}건",
        f"- McNemar exact p: {summary['mcnemar_exact_p']:.4f}",
        f"- 참조조항 오부착: 규칙 {summary['baseline_reference_false_positive']}건 / Hybrid {summary['hybrid_reference_false_positive']}건",
        "",
        "> 실제 내부 계약서 성능이 아니라 입력한 공개·변형 실험군에서의 결과임.",
    ]) + "\n"


def write_outputs(out_dir, rows, summary):
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "report.md").write_text(render_markdown(summary), encoding="utf-8")
    with (out_dir / "paired_results.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else ["document_id", "check_id"])
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", nargs="+", required=True)
    parser.add_argument("--gold", nargs="+", required=True)
    parser.add_argument("--out", default="output/experiment")
    args = parser.parse_args()
    predictions = _load_many(args.predictions, "cr-matching-predictions-v1")
    golds = _load_many(args.gold, "cr-matching-gold-v1")
    rows = score_documents(predictions, golds)
    summary = summarize(rows)
    write_outputs(Path(args.out), rows, summary)
    print(render_markdown(summary), end="")


if __name__ == "__main__":
    main()
