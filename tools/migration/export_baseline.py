"""Capture public release data and static inventory. Never reads browser/private data."""
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE_SHA256 = "774f97531ce146fd4a6347655cc6e9ea21f61909aa753a1e2c96513244a52824"


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


class Controls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.controls = []
        self.tabs = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag in {"button", "input", "select", "textarea"}:
            self.controls.append({"tag": tag, **attrs})
        if attrs.get("data-tab"):
            self.tabs.append(attrs["data-tab"])


def main():
    raw = (ROOT / "dist/contract-review.html").read_bytes()
    if hashlib.sha256(raw).hexdigest() != BASELINE_SHA256:
        raise SystemExit("Release differs from approved v1.90.8 baseline; do not replace fixtures silently")
    payload = json.loads(re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', raw.decode(), re.S).group(1))
    assert payload["curated_corpus"] is None
    checks = payload["common"]["checks"] + [c for t in payload["types"] for c in t["checks"]]
    assert len(checks) == 184 and len(payload["judgment_policies"]["checks"]) == 206
    write(ROOT / "backend/app/data/catalog.json", {
        "baseline_version": payload["app_version"], "baseline_engine_fingerprint": payload["engine_fingerprint"],
        "common": payload["common"], "types": payload["types"],
        "judgment_policies": payload["judgment_policies"], "checklist_revision": payload["checklist_revision"],
        "regulatory_scopes": payload["regulatory_scopes"], "tag_engine": payload["tag_engine"],
    })
    parser = Controls()
    parser.feed((ROOT / "src/template.html").read_text(encoding="utf-8"))
    sources, storage, formats = [], [], []
    for path in sorted((ROOT / "src").iterdir()):
        text = path.read_text(encoding="utf-8")
        sources.append({"path": str(path.relative_to(ROOT)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        for number, line in enumerate(text.splitlines(), 1):
            if re.search(r'localStorage\.|indexedDB\.open|createObjectStore|\b(?:DB|STORE|DB_NAME|STORE_NAME)\s*=|[\w]*KEY[\w]*\s*=', line):
                storage.append({"file": str(path.relative_to(ROOT)), "line": number, "code": line.strip()})
            for value in re.findall(r'[\'"]((?:cr-|contract-review-)[\w-]+-v\d+)[\'"]', line):
                formats.append({"format": value, "file": str(path.relative_to(ROOT)), "line": number})
    write(ROOT / "contracts/fixtures/baseline-manifest.json", {
        "commit": "4a2e5f195ae9cd23f46bd24cf3ff034453391d80", "version": "1.90.8",
        "html_sha256": BASELINE_SHA256, "engine_fingerprint": payload["engine_fingerprint"],
        "checks": len(checks), "policies": 206, "source_files": sources, "private_data": False,
    })
    write(ROOT / "contracts/fixtures/ui-inventory.json", {"controls": parser.controls, "tabs": parser.tabs})
    write(ROOT / "contracts/fixtures/storage-inventory.json", {
        "method": "static source references; dynamic keys require S0 browser coverage",
        "references": storage, "formats": formats,
        "migration_gap": "Existing knowledge/history packs do not include every localStorage/IndexedDB store",
    })
    boundaries = []
    names = {"runAnalysis": "analysis API", "applyAutoVerdictsBody": "Python judgment service",
             "saveEditedOpinion": "draft/review API", "finishReview": "completion transaction",
             "applyVerdict": "manual verdict API", "saveCorpus": "corpus repository",
             "opinionStoreLoad": "draft repository", "bindReassign": "partial reevaluation API",
             "analysisSources": "source IDs and version snapshots"}
    for number, line in enumerate((ROOT / "src/app.js").read_text(encoding="utf-8").splitlines(), 1):
        match = re.match(r'(?:async )?function (\w+)\(', line)
        if match and match.group(1) in names:
            boundaries.append({"file": "src/app.js", "line": number, "function": match.group(1), "target": names[match.group(1)]})
    write(ROOT / "contracts/fixtures/feature-boundaries.json", {
        "app_functions": boundaries,
        "worker": {"source": "src/analysis_worker.js", "frontend_transport": "src/analysis_runtime.js",
                   "warning": "Worker output alone does not include app.js final auto-verdict/storage lifecycle"},
        "features": [{"tab": tab, "status": "legacy baseline; Python migration pending"} for tab in parser.tabs],
    })
    print("Captured baseline: %d checks, %d controls, %d storage references" % (len(checks), len(parser.controls), len(storage)))


if __name__ == "__main__":
    main()
