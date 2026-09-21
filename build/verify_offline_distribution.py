"""현재 배포 ZIP/업데이트/직접 실행본의 바이트와 소스 일치를 검증한다."""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

from build_html import JS_ORDER, WORKER_JS_ORDER

ROOT = Path(__file__).resolve().parent.parent


def verify(expected_html_hash=None):
    version = (ROOT / 'VERSION').read_text().strip()
    app = (ROOT / 'dist/contract-review.html').read_bytes()
    digest = hashlib.sha256(app).hexdigest()
    if expected_html_hash:
        assert digest == expected_html_hash, '브라우저 시험 후 HTML 변경'
    html = app.decode('utf-8')
    for name in JS_ORDER:
        assert (ROOT / 'src' / name).read_text() in html, '소스 불일치: ' + name
    assert (ROOT / 'src/style.css').read_text() in html
    assert (ROOT / 'src/ui_layout.css').read_text() in html
    assert '__APP_JS__' not in html and '__DATA_JSON__' not in html
    assert f'"app_version": "{version}"' in html
    assert '"curated_corpus": null' in html
    data = json.loads(re.search(r'<script id="cr-data"[^>]*>(.*?)</script>', html, re.S).group(1))
    assert data['app_version'] == version and data['curated_corpus'] is None
    assert len(data['judgment_policies']['checks']) == 206
    assert data['judgment_policies'] == json.loads((ROOT / 'knowledge/judgment_policies.json').read_text())
    if version.startswith('1.90.'):
        match = re.search(r'<script type="text/plain" id="analysis-worker-src">(.*?)</script>', html, re.S)
        assert match, '오프라인 분석 worker 누락'
        worker = match.group(1).replace('<\\/script', '</script')
        for name in WORKER_JS_ORDER + ['analysis_worker.js']:
            assert (ROOT / 'src' / name).read_text() in worker, 'worker 소스 불일치: ' + name
        assert (ROOT / 'vendor/contract-tag-engine.js').read_text() in worker
        material = dict(data)
        expected_fingerprint = material.pop('engine_fingerprint')
        serialized = json.dumps(material, ensure_ascii=False, sort_keys=True) + '\n' + '\n'.join(
            (ROOT / 'src' / name).read_text() for name in JS_ORDER + ['analysis_worker.js'])
        assert hashlib.sha256(serialized.encode('utf-8')).hexdigest() == expected_fingerprint, 'worker 포함 엔진 지문 불일치'
    if version.startswith(('1.88.', '1.89.', '1.90.')):
        active = data['common']['checks'] + [c for t in data['types'] for c in t['checks']]
        assert len(active) == 184 and all(c.get('active') is not False for c in active)
        supported = [p for p in data['judgment_policies']['checks']
                     if p.get('active') and p['level'] == 'presence' and p['auto_support']['status'] == 'supported']
        assert len(supported) == 62
    update_name = f'contract-review-v{version}.crupdate'
    update_bytes = (ROOT / 'dist' / update_name).read_bytes()
    update = json.loads(update_bytes)
    assert update['version'] == version and update['sha256'] == digest
    assert update['html'].encode('utf-8') == app
    archive = ROOT / 'dist' / f'contract-review-v{version}.zip'
    guide = ROOT / 'docs' / f'release-v{version.rsplit(".", 1)[0]}.md'
    patch_guide = ROOT / 'docs' / f'release-v{version}.md'
    if patch_guide.exists():
        guide = patch_guide
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert z.read('contract-review.html') == app
        assert z.read('비상용_직접실행_contract-review.html') == app
        assert z.read(update_name) == update_bytes
        assert z.read('최초설치_계약서검토_실행기.html') == (ROOT / 'src/launcher.html').read_bytes()
        guide_name = '먼저읽기_자동판정_사용안내.md' if version.startswith(('1.88.', '1.89.', '1.90.')) else '먼저읽기_누적판정_자동태깅_사용안내.md'
        assert z.read(guide_name) == guide.read_bytes()
        assert z.read('체크리스트_판정수준_206개.json') == (ROOT / 'knowledge/judgment_policies.json').read_bytes()
        if version.startswith('1.88.'):
            assert z.read('체크리스트_206개_개정기준표.json') == (ROOT / 'knowledge/checklist_inventory_v188.json').read_bytes()
            assert z.read('체크리스트_개정내역.md') == (ROOT / 'docs/v1.88-checklist-inventory.md').read_bytes()
            assert z.read('검증범위와_데이터한계.md') == (ROOT / 'docs/v1.88-evaluation-inputs.md').read_bytes()
            assert z.read('v1.88_최종검증기록.md') == (ROOT / 'docs/v1.88-validation.md').read_bytes()
            assert z.read('검증_자료기여도.json') == (ROOT / 'docs/v1.88-source-ablation.json').read_bytes()
            assert z.read('검증_성능측정.json') == (ROOT / 'docs/v1.88-runtime-benchmark.json').read_bytes()
        if version.startswith('1.89.'):
            assert z.read('체크리스트_206개_개정기준표.json') == (ROOT / 'knowledge/checklist_inventory_v188.json').read_bytes()
            assert z.read('체크리스트_개정내역.md') == (ROOT / 'docs/v1.88-checklist-inventory.md').read_bytes()
            for name in ('v1.89-validation.md', 'v1.89-runtime-benchmark.json', 'v1.89-performance-acceptance.json', 'v1.89-performance-evaluation.md'):
                assert z.read(name) == (ROOT / 'docs' / name).read_bytes()
        if version.startswith('1.90.'):
            assert z.read('체크리스트_206개_개정기준표.json') == (ROOT / 'knowledge/checklist_inventory_v188.json').read_bytes()
            assert z.read('체크리스트_개정내역.md') == (ROOT / 'docs/v1.88-checklist-inventory.md').read_bytes()
            for name in ('v1.90-validation.md', 'v1.90-performance-acceptance.json', 'v1.90-performance-acceptance.md'):
                assert z.read(name) == (ROOT / 'docs' / name).read_bytes()
        assert not any(re.search(r'internal-standards|corpus-backup|\.crhistory|\.heic|\.hwp[x]?$', n, re.I) for n in z.namelist())
        names = z.namelist()
    return {'version': version, 'html_sha256': digest,
            'zip_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'zip_bytes': archive.stat().st_size, 'modules': len(JS_ORDER), 'entries': len(names)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-html-sha256')
    args = parser.parse_args()
    print(json.dumps(verify(args.expected_html_sha256), ensure_ascii=False, indent=2))
