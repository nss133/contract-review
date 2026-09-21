"""Independent static frontend build. No Python API imports or engine injection."""
import json
import shutil
from pathlib import Path
from urllib.parse import urlsplit
import argparse

FRONTEND = Path(__file__).resolve().parent


def build(api_base="/api/v1"):
    if not api_base.startswith("/"):
        url = urlsplit(api_base)
        if url.scheme not in {"http", "https"} or not url.hostname or url.query or url.fragment:
            raise ValueError("Invalid API base URL")
    elif api_base.startswith("//"):
        raise ValueError("Protocol-relative API address is not allowed")
    out = FRONTEND / "dist"
    (out / "assets").mkdir(parents=True, exist_ok=True)
    html = (FRONTEND / "src/index.html").read_text(encoding="utf-8")
    html = html.replace('__APP_VERSION__', '1.90.8').replace('__BUILD_DATE__', 'Python 전환 개발판')
    html = html.replace('<main>', '<main>\n' + (FRONTEND / "src/session.html").read_text(encoding="utf-8"), 1)
    html = html.replace('</body>', '<script type="module" src="app.mjs"></script>\n</body>')
    if '__DATA_JSON__' in html or 'analysis-worker-src' in html:
        raise AssertionError("Legacy engine must not ship in the frontend")
    (out / "index.html").write_text(html, encoding="utf-8")
    for name in ['style.css', 'ui_layout.css']:
        shutil.copyfile(FRONTEND / 'assets' / name, out / 'assets' / name)
    shutil.copyfile(FRONTEND / 'src/session.css', out / 'assets/session.css')
    for name in ['app.mjs', 'api-client.mjs', 'review-ui.mjs']:
        shutil.copyfile(FRONTEND / 'src' / name, out / name)
    (out / 'config.json').write_text(json.dumps({'apiBase': api_base, 'apiVersion': '1'}) + '\n', encoding="utf-8")
    print('Frontend built independently:', out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--api-base', default='/api/v1')
    build(parser.parse_args().api_base)
