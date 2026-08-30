"""legal-opinion-tagger의 검증된 계약 태그 브리지를 vendor/로 동기화한다."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT.parent / "legal-opinion-tagger" / "offline-dist"


def _sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sync(source=DEFAULT_SOURCE):
    source = Path(source)
    manifest_path = source / "contract-tag-engine.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pairs = [
        (manifest["artifact"], manifest["artifactSha256"]),
        (manifest["cjsArtifact"], manifest["cjsArtifactSha256"]),
        (manifest["taxonomy"], manifest["taxonomySha256"]),
    ]
    for name, expected in pairs:
        src = source / name
        actual = _sha256(src)
        if actual != expected:
            raise ValueError(f"{name}: manifest 해시 불일치({actual} != {expected})")
        shutil.copy2(src, ROOT / "vendor" / name)
    shutil.copy2(manifest_path, ROOT / "vendor" / manifest_path.name)
    return manifest


if __name__ == "__main__":
    print(json.dumps(sync(), ensure_ascii=False))
