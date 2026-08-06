"""실험 gold/prediction 파일에서 예측을 숨긴 오프라인 사람 라벨링 폼을 만든다."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXP = ROOT / "experiment"
OUT = EXP / "matching-labeling-form.html"


def load_documents():
    documents = []
    for gold_path in sorted((EXP / "gold").glob("*.json")):
        pred_path = EXP / "predictions" / gold_path.name
        if not pred_path.exists():
            continue
        gold = json.loads(gold_path.read_text())
        pred = json.loads(pred_path.read_text())
        eligible = {x["check_id"] for x in pred["items"] if x.get("llm_reviewed")}
        gold["labels"] = [x for x in gold["labels"] if x["check_id"] in eligible]
        if gold["labels"]:
            documents.append(gold)
    return documents


HTML = r'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>매칭 실험 블라인드 라벨링</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:#17202a;background:#f4f6f8}
*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid #d8dee5;padding:14px 24px;display:flex;gap:14px;align-items:center}
h1{font-size:18px;margin:0}.top select,.top button{height:36px;border:1px solid #aeb8c4;background:#fff;padding:0 12px;border-radius:6px}.top button{background:#176b45;color:#fff;border-color:#176b45;font-weight:700;cursor:pointer}
.progress{margin-left:auto;font-size:13px;color:#52606d}.layout{display:grid;grid-template-columns:minmax(320px,42%) 1fr;gap:16px;padding:16px;height:calc(100vh - 65px)}
.panel{background:#fff;border:1px solid #d8dee5;border-radius:6px;overflow:auto}.checks{padding:12px}.check{border:1px solid #d8dee5;border-radius:6px;margin-bottom:10px;padding:14px;cursor:pointer}.check.active{border:2px solid #176b45;padding:13px}.check.done{background:#f0f8f4}.cid{font:12px ui-monospace;color:#667}.question{font-weight:700;margin:6px 0 12px;line-height:1.5}.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fields label,.note{font-size:12px;color:#52606d}.fields select,.note textarea{display:block;width:100%;margin-top:4px;border:1px solid #b7c0ca;border-radius:4px;padding:7px;background:#fff}.note{display:block;margin-top:8px}.note textarea{height:60px;resize:vertical}.clauses{padding:14px}.clauses h2{font-size:15px;margin:0 0 12px}.clause{border-top:1px solid #e3e7eb;padding:13px 0}.clause:first-of-type{border-top:0}.clause-head{display:flex;gap:8px;align-items:center;position:sticky;top:0;background:#fff;padding:3px 0}.clause-title{font-weight:700;flex:1}.choice{font-size:12px;border:1px solid #c5ccd3;border-radius:4px;padding:5px 7px;white-space:nowrap}.choice input{vertical-align:middle}.clause-body{white-space:pre-wrap;line-height:1.55;font-size:13px;color:#344050;margin-top:8px}.empty{text-align:center;padding:80px 20px;color:#667}@media(max-width:850px){.layout{display:block;height:auto}.panel{margin-bottom:12px;max-height:none}.top{flex-wrap:wrap}.progress{margin-left:0}.clauses{max-height:none}}
</style></head><body>
<div class="top"><h1>블라인드 매칭 라벨링</h1><select id="doc"></select><button id="export">현재 문서 JSON 저장</button><span class="progress" id="progress"></span></div>
<main class="layout"><section class="panel checks" id="checks"></section><section class="panel clauses" id="clauses"></section></main>
<script>
const docs=__DATA__;let di=0,ci=0;const key="cr-matching-label-form-v1";
const docEl=document.getElementById('doc'),exportBtn=document.getElementById('export');
const checks=document.getElementById('checks'),clauses=document.getElementById('clauses'),progress=document.getElementById('progress');
function saved(){try{return JSON.parse(localStorage.getItem(key)||"{}")}catch(e){return {}}}
let edits=saved();
function value(id){return edits[docs[di].meta.document_id+"::"+id]||null}
function update(id,patch){const k=docs[di].meta.document_id+"::"+id;edits[k]=Object.assign(value(id)||{},patch);localStorage.setItem(key,JSON.stringify(edits));renderChecks();renderProgress()}
function isDone(l){const v=value(l.check_id);return v&&typeof v.applicable==="boolean"}
function renderDocs(){docEl.innerHTML=docs.map((d,i)=>`<option value="${i}">${d.meta.document_id} (${d.labels.length}건)</option>`).join("");docEl.value=di}
function renderChecks(){const d=docs[di];checks.innerHTML=d.labels.map((l,i)=>{const v=value(l.check_id)||{};return `<article class="check ${i===ci?'active':''} ${isDone(l)?'done':''}" data-i="${i}"><div class="cid">${l.check_id}</div><div class="question">${esc(l.check)}</div><div class="fields"><label>적용 여부<select data-f="applicable"><option value="">선택</option><option value="true" ${v.applicable===true?'selected':''}>적용</option><option value="false" ${v.applicable===false?'selected':''}>비적용</option></select></label><label>충족도<select data-f="completeness"><option value="">선택</option>${['complete','partial','unclear'].map(x=>`<option ${v.completeness===x?'selected':''}>${x}</option>`).join('')}</select></label><label>확신도<select data-f="confidence"><option value="">선택</option>${['high','medium','low'].map(x=>`<option ${v.confidence===x?'selected':''}>${x}</option>`).join('')}</select></label></div><label class="note">판단 메모<textarea data-f="note">${esc(v.note||'')}</textarea></label></article>`}).join('');
 checks.querySelectorAll('.check').forEach(el=>el.onclick=e=>{if(e.target.matches('select,textarea,input'))return;ci=+el.dataset.i;renderChecks();renderClauses()});
 checks.querySelectorAll('select,textarea').forEach(el=>el.onchange=()=>{const l=d.labels[+el.closest('.check').dataset.i];let x=el.value;if(el.dataset.f==='applicable')x=x===''?null:x==='true';update(l.check_id,{[el.dataset.f]:x})})}
function renderClauses(){const d=docs[di],l=d.labels[ci];if(!l){clauses.innerHTML='<div class="empty">평가 항목이 없습니다.</div>';return}const v=value(l.check_id)||{},direct=v.direct_clause_indices||[],ref=v.reference_clause_indices||[];clauses.innerHTML=`<h2>${esc(l.check)}<br><span class="cid">직접 근거와 단순 참조를 각각 선택</span></h2>`+d.clauses.map(c=>`<article class="clause"><div class="clause-head"><span class="clause-title">${c.clause_index}. ${esc(c.heading)}</span><label class="choice"><input type="checkbox" data-kind="direct" data-index="${c.clause_index}" ${direct.includes(c.clause_index)?'checked':''}> 직접 근거</label><label class="choice"><input type="checkbox" data-kind="reference" data-index="${c.clause_index}" ${ref.includes(c.clause_index)?'checked':''}> 단순 참조</label></div><div class="clause-body">${esc(c.body)}</div></article>`).join('');
 clauses.querySelectorAll('input').forEach(el=>el.onchange=()=>{let a=(el.dataset.kind==='direct'?direct:ref).slice(),n=+el.dataset.index;if(el.checked&&!a.includes(n))a.push(n);if(!el.checked)a=a.filter(x=>x!==n);update(l.check_id,{[el.dataset.kind+'_clause_indices']:a});renderClauses()})}
function renderProgress(){const d=docs[di],n=d.labels.filter(isDone).length;progress.textContent=`판정 ${n}/${d.labels.length} · 브라우저 자동저장`}
function esc(x){return String(x||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
docEl.onchange=()=>{di=+docEl.value;ci=0;renderChecks();renderClauses();renderProgress()};
exportBtn.onclick=()=>{const d=JSON.parse(JSON.stringify(docs[di]));d.labels.forEach(l=>Object.assign(l,value(l.check_id)||{}));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));a.download=d.meta.document_id+'.json';a.click();URL.revokeObjectURL(a.href)};
renderDocs();renderChecks();renderClauses();renderProgress();
</script></body></html>'''


def main():
    data = json.dumps(load_documents(), ensure_ascii=False).replace("<", "\\u003c")
    OUT.write_text(HTML.replace("__DATA__", data))
    print(OUT)


if __name__ == "__main__":
    main()
