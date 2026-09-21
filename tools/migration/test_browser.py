"""Playwright tests against dedicated servers and a fresh browser context."""
import hashlib
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / ".runtime/browser"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
FRONTEND = os.environ.get("CR_TEST_FRONTEND", "http://127.0.0.1:18765")


def main():
    checks, errors, external = [], [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=os.environ.get(
            "CR_CHROME_PATH", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: external.append(request.url) if request.url.startswith(("http:", "https:"))
                and not request.url.startswith(("http://127.0.0.1:18765/", "http://127.0.0.1:18766/")) else None)
        page.goto(FRONTEND)
        page.wait_for_load_state("networkidle")
        expect(page.locator("#login-form")).to_be_visible()
        expect(page.locator("#btn-analyze")).to_be_disabled()
        page.locator("#login-username").fill("browser-reviewer")
        page.locator("#login-password").fill(os.environ["CR_TEST_PASSWORD"])
        page.locator("#login-submit").click()
        expect(page.locator("#session-tools")).to_be_visible()
        expect(page.locator("#login-form")).to_be_hidden()
        expect(page.locator("#service-status")).to_contain_text("로그인했습니다")
        expect(page.locator('#input-type option[value="alliance"]')).to_have_text('제휴·업무협약')
        checks.append("real login and cookie/CSRF across separate frontend and API")
        source = "브라우저 합성 계약😀\n제1조(목적)\n합성 자료로 저장 연결을 확인한다."
        page.locator("#contract-text").fill(source)
        page.locator("#server-save-text").click()
        expect(page.locator("#service-status")).to_have_text("본문 초안을 저장했습니다.")
        review_id = page.locator("#server-review-list").input_value()
        assert review_id
        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.locator("#session-tools")).to_be_visible()
        expect(page.locator("#login-form")).to_be_hidden()
        page.locator("#server-review-list").select_option(review_id)
        expect(page.locator("#contract-text")).to_have_value(source)
        checks.append("saved original text survives reload and session restoration")
        inventory = json.loads((ROOT / "contracts/fixtures/ui-inventory.json").read_text(encoding="utf-8"))
        original_ids = {row["id"] for row in inventory["controls"] if row.get("id")}
        current_ids = set(page.locator("button[id],input[id],select[id],textarea[id]").evaluate_all("els => els.map(e => e.id)"))
        assert original_ids <= current_ids
        checks.append("all original static control IDs retained")
        assert page.locator("#analysis-worker-src").count() == 0
        assert page.locator("#cr-data").count() == 0
        checks.append("no inline knowledge or legacy worker engine shipped")
        for width in (1440, 1100, 800):
            page.set_viewport_size({"width": width, "height": 1100})
            for tab in ("input", "clauses", "report", "knowledge"):
                page.locator('[data-tab="%s"]' % tab).click()
                expect(page.locator("#pane-" + tab)).to_be_visible()
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
            page.locator('[data-tab="input"]').click()
            page.screenshot(path=str(ARTIFACTS / ("frontend-%d.png" % width)), full_page=True)
        checks.append("tabs and widths 1440/1100/800 have no horizontal overflow")
        page.locator("#session-logout").click()
        expect(page.locator("#login-form")).to_be_visible()
        expect(page.locator("#contract-text")).to_have_value("")
        assert page.locator("#server-review-list option").count() == 1
        checks.append("logout clears cached contract and user-specific list")
        assert errors == [] and external == []
        checks.append("no browser exceptions or external internet requests")
        context.close()

        # Freeze existing UI references separately; no user's browser stores are read.
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        baseline_errors = []
        page.on("pageerror", lambda error: baseline_errors.append(str(error)))
        page.goto((ROOT / "dist/contract-review.html").as_uri())
        page.wait_for_load_state("networkidle")
        page.wait_for_function("typeof runAnalysis === 'function' && typeof TemplateLibraryRuntime !== 'undefined'")
        page.evaluate("applyMotionPreference('reduce',false)")
        snapshots = ROOT / "contracts/ui-baseline"
        snapshots.mkdir(parents=True, exist_ok=True)
        manifest = []
        def capture(name):
            path = snapshots / (name + ".png")
            page.screenshot(path=str(path), full_page=True)
            manifest.append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        for width in (1440, 1100, 800):
            page.set_viewport_size({"width": width, "height": 1100})
            capture("input-%d" % width)
        page.set_viewport_size({"width": 1440, "height": 1100})
        page.locator("#contract-text").fill("합성 유지보수 용역계약서\n제1조(목적)\n시스템 유지보수 업무를 위탁한다.\n제2조(대금)\n대금은 100만원, 부가세 별도이다.\n제3조(관할)\n서울중앙지방법원을 전속적 합의관할로 한다.")
        page.locator("#btn-analyze").click()
        page.wait_for_function("state.result && document.getElementById('analysis-progress').hidden", timeout=30000)
        for width in (1440, 1100, 800):
            page.set_viewport_size({"width": width, "height": 1100})
            for tab in ("clauses", "report", "knowledge", "evaluation", "checklist", "verify"):
                page.locator('[data-tab="%s"]' % tab).click()
                capture("%s-%d" % (tab, width))
        page.locator('[data-tab="report"]').click()
        page.emulate_media(media="print")
        page.evaluate("window.dispatchEvent(new Event('beforeprint'))")
        capture("report-print")
        (snapshots / "manifest.json").write_text(json.dumps({"baseline": "1.90.8", "synthetic_only": True,
            "images": manifest, "browser_errors": baseline_errors}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert not baseline_errors
        checks.append("legacy baseline screenshots: %d" % len(manifest))
        context.close()
        browser.close()
    result = {"passed": len(checks), "checks": checks, "errors": errors, "external": external}
    (ARTIFACTS / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
