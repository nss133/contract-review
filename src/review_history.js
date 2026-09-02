"use strict";
/* 폐쇄망 계약검토 이력 저장소.
   - 실제 XLSX는 브라우저 안에서만 읽고 IndexedDB에 저장한다.
   - 앱 업데이트 파일에는 이력·설정·골드셋을 포함하지 않는다.
   - DB 기재값은 검색·사전채움 후보이며 법적 판정의 증거가 아니다. */
var ReviewHistory = (function () {
  var FORMAT = "cr-review-history-pack-v1";
  var SCHEMA_VERSION = 1;
  var DB_NAME = "contract-review-history";
  var DB_VERSION = 1;
  var STORE_NAME = "history";
  var RECORD_KEY = "review-history-corpus";
  var SHEET_NAME = "계약서 검토";

  var COLUMNS = [
    { index: 0, key: "screen.column_name", header: "칼럼명" },
    { index: 1, key: "status", header: "진행상태" },
    { index: 2, key: "request.author", header: "작성자" },
    { index: 3, key: "request.created_at", header: "작성일" },
    { index: 4, key: "request.department", header: "신청부서" },
    { index: 5, key: "request.applicant", header: "신청자" },
    { index: 6, key: "request.security_level", header: "보안등급" },
    { index: 7, key: "request.contract_name", header: "계약명" },
    { index: 8, key: "request.pii_outsourcing", header: "개인(신용)정보 제공 및 (재)위탁 여부" },
    { index: 9, key: "request.financial_outsourcing", header: "업무위탁 관련 확인 여부" },
    { index: 10, key: "request.contract_period", header: "계약기간" },
    { index: 11, key: "request.amount", header: "계약금액" },
    { index: 12, key: "request.type", header: "유형" },
    { index: 13, key: "request.counterparty", header: "계약상대방" },
    { index: 14, key: "request.change_kind", header: "신규/변경/연장" },
    { index: 15, key: "request.context", header: "계약배경 및 요청내용" },
    { index: 16, key: "request.contract_attachment", header: "검토대상 계약서" },
    { index: 17, key: "request.related_attachments", header: "관련 자료" },
    { index: 18, key: "result.author", header: "작성자" },
    { index: 19, key: "result.created_at", header: "작성일" },
    { index: 20, key: "result.department", header: "신청부서" },
    { index: 21, key: "result.applicant", header: "신청자" },
    { index: 22, key: "result.security_level", header: "보안등급" },
    { index: 23, key: "result.contract_name", header: "계약명" },
    { index: 24, key: "result.pii_outsourcing", header: "개인(신용)정보 제공 및 (재)위탁 여부" },
    { index: 25, key: "result.financial_outsourcing", header: "업무위탁 관련 확인 여부" },
    { index: 26, key: "result.contract_period", header: "계약기간" },
    { index: 27, key: "result.type", header: "유형" },
    { index: 28, key: "result.difficulty", header: "난이도" },
    { index: 29, key: "result.review_type", header: "검토유형" },
    { index: 30, key: "result.change_kind", header: "신규/변경/연장" },
    { index: 31, key: "result.review_text", header: "검토결과" },
    { index: 32, key: "result.attachments", header: "첨부자료" }
  ];
  var STABLE_ID_HEADERS = ["계약검토id", "계약검토번호", "검토id", "검토번호", "접수번호", "문서id", "reviewid"];
  var CONFLICT_FIELDS = ["department", "applicant", "security_level", "contract_name",
    "pii_outsourcing", "financial_outsourcing", "contract_period", "type", "change_kind"];

  function nowIso() { return new Date().toISOString(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function text(value) { return String(value === undefined || value === null ? "" : value).trim(); }
  function normalized(value) { return text(value).normalize("NFC").replace(/\s+/g, " "); }
  function compact(value) { return normalized(value).toLocaleLowerCase("ko-KR").replace(/[\s_\-()（）.·]/g, ""); }
  function hashString(value) {
    var s = String(value || ""), h1 = 2166136261, h2 = 2246822519;
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      h1 ^= code; h1 = Math.imul(h1, 16777619);
      h2 ^= code; h2 = Math.imul(h2, 3266489917);
    }
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }
  function bump(map, key) {
    key = text(key) || "미기재";
    map[key] = (map[key] || 0) + 1;
  }
  function topEntries(map, limit) {
    return Object.keys(map || {}).map(function (key) { return { key: key, count: map[key] }; })
      .sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key, "ko"); })
      .slice(0, limit || 30);
  }
  function setPath(target, path, value) {
    var parts = path.split("."), cursor = target;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cursor[parts[i]]) cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = text(value);
  }

  function emptyHistory() {
    return {
      meta: { format: FORMAT, schema_version: SCHEMA_VERSION, created_at: "", updated_at: "",
        review_count: 0, revision_count: 0, snapshot_count: 0 },
      snapshots: [], records: {}, latest: {},
      config: { type_mappings: {}, aliases: {} },
      benchmarks: { labels: {}, runs: [] },
      stats: { statuses: {}, request_types: {}, result_types: {}, departments: {}, change_kinds: {},
        difficulties: {}, review_types: {}, stable_ids: 0, provisional_ids: 0, conflict_records: 0,
        missing_contract_names: 0 }
    };
  }

  function deriveStats(history) {
    var stats = emptyHistory().stats;
    Object.keys(history.latest || {}).forEach(function (reviewId) {
      var record = history.records[history.latest[reviewId]];
      if (!record) return;
      bump(stats.statuses, record.status);
      bump(stats.request_types, record.request && record.request.type);
      bump(stats.result_types, record.result && record.result.type);
      bump(stats.departments, (record.request && record.request.department) || (record.result && record.result.department));
      bump(stats.change_kinds, (record.result && record.result.change_kind) || (record.request && record.request.change_kind));
      bump(stats.difficulties, record.result && record.result.difficulty);
      bump(stats.review_types, record.result && record.result.review_type);
      if (record.id_quality === "source") stats.stable_ids++; else stats.provisional_ids++;
      if ((record.conflicts || []).length) stats.conflict_records++;
      if (!text(record.request && record.request.contract_name) && !text(record.result && record.result.contract_name))
        stats.missing_contract_names++;
    });
    return stats;
  }
  function refreshMeta(history) {
    history.meta.created_at = history.meta.created_at || nowIso();
    history.meta.updated_at = nowIso();
    history.meta.review_count = Object.keys(history.latest || {}).length;
    history.meta.revision_count = Object.keys(history.records || {}).length;
    history.meta.snapshot_count = (history.snapshots || []).length;
    history.stats = deriveStats(history);
  }
  function normalizeHistory(input) {
    var out = input && typeof input === "object" ? clone(input) : emptyHistory();
    if (!out.meta) out.meta = {};
    if (out.meta.format && out.meta.format !== FORMAT) throw new Error("지원하지 않는 계약검토 이력팩 형식");
    if (Number(out.meta.schema_version || 0) > SCHEMA_VERSION) throw new Error("더 최신 버전에서 만든 계약검토 이력팩입니다");
    out.meta.format = FORMAT; out.meta.schema_version = SCHEMA_VERSION;
    if (!Array.isArray(out.snapshots)) out.snapshots = [];
    ["records", "latest"].forEach(function (key) {
      if (!out[key] || typeof out[key] !== "object" || Array.isArray(out[key])) out[key] = {};
    });
    if (!out.config || typeof out.config !== "object") out.config = { type_mappings: {}, aliases: {} };
    if (!out.config.type_mappings) out.config.type_mappings = {};
    if (!out.config.aliases) out.config.aliases = {};
    if (!out.benchmarks || typeof out.benchmarks !== "object") out.benchmarks = { labels: {}, runs: [] };
    if (!out.benchmarks.labels) out.benchmarks.labels = {};
    if (!Array.isArray(out.benchmarks.runs)) out.benchmarks.runs = [];
    refreshMeta(out);
    return out;
  }
  function preparedHistory(input) {
    if (input && input.meta && input.meta.format === FORMAT &&
        Number(input.meta.schema_version) === SCHEMA_VERSION && input.records && input.latest &&
        input.config && input.benchmarks && input.stats) return input;
    return normalizeHistory(input);
  }

  function headerScore(row) {
    var score = 0;
    COLUMNS.forEach(function (column) {
      if (compact(row[column.index]) === compact(column.header)) score++;
    });
    return score;
  }
  function findHeaderRow(rows) {
    var best = { index: -1, score: -1 };
    (rows || []).slice(0, 15).forEach(function (row, index) {
      var score = headerScore(row || []);
      if (score > best.score) best = { index: index, score: score };
    });
    if (best.score < 24) throw new Error("SCHEMA_HEADER_MISMATCH: 계약검토 33열 머리글을 찾지 못했습니다");
    return best;
  }
  function isScopeRow(row) {
    var values = (row || []).map(compact);
    var allCount = values.filter(function (value) { return value === "all"; }).length;
    return (values[0] === "범위" && values[1] === "완료") || allCount >= 10;
  }
  function isEmptyRow(row) {
    return !(row || []).some(function (value) { return text(value); });
  }
  function findStableIdIndex(headers) {
    for (var i = 0; i < headers.length; i++) {
      if (STABLE_ID_HEADERS.indexOf(compact(headers[i])) !== -1) return i;
    }
    return -1;
  }
  function dateLike(value) {
    var v = text(value);
    if (!v) return true;
    if (/^\d+(?:\.\d+)?$/.test(v)) return true; // Excel serial 포함
    return /^\d{4}[.\-/년]\s*\d{1,2}(?:[.\-/월]\s*\d{1,2})?/.test(v);
  }
  function identityParts(record) {
    return [record.request.created_at, record.request.contract_name, record.request.department,
      record.request.applicant, record.request.counterparty, record.result.created_at,
      record.result.contract_name, record.status].map(compact);
  }
  function conflictsFor(record) {
    var out = [];
    CONFLICT_FIELDS.forEach(function (field) {
      var left = normalized(record.request[field]), right = normalized(record.result[field]);
      if (left && right && compact(left) !== compact(right)) out.push(field);
    });
    return out;
  }
  function rowToRecord(row, rowNumber, stableIdIndex, sourceMeta) {
    var record = { status: "", request: {}, result: {}, screen: {}, source_row: rowNumber,
      source_sheet: text(sourceMeta && sourceMeta.sheet_name) || SHEET_NAME, conflicts: [], diagnostic_codes: [] };
    COLUMNS.forEach(function (column) { setPath(record, column.key, row[column.index]); });
    record.conflicts = conflictsFor(record);
    if (!dateLike(record.request.created_at)) record.diagnostic_codes.push("REQUEST_DATE_PARSE_FAIL");
    if (!dateLike(record.result.created_at)) record.diagnostic_codes.push("RESULT_DATE_PARSE_FAIL");
    if (!record.request.contract_name && !record.result.contract_name) record.diagnostic_codes.push("CONTRACT_NAME_MISSING");
    if (record.conflicts.length) record.diagnostic_codes.push("REQUEST_RESULT_CONFLICT");
    var stableId = stableIdIndex >= 0 ? text(row[stableIdIndex]) : "";
    if (stableId) {
      record.review_id = stableId;
      record.id_quality = "source";
    } else {
      record.review_id = "LOCAL-" + hashString(identityParts(record).join("|"));
      record.id_quality = "provisional";
      record.diagnostic_codes.push("STABLE_ID_MISSING");
    }
    record.fingerprint = hashString(JSON.stringify([record.status, record.request, record.result]));
    return record;
  }

  function datasetFromRows(rows, sourceMeta) {
    rows = rows || [];
    var header = findHeaderRow(rows), headers = rows[header.index] || [];
    var stableIdIndex = findStableIdIndex(headers), records = [], rowIssues = [], idCounts = {};
    var errorCounts = {}, skippedEmpty = 0, skippedScope = 0;
    function issue(row, code) {
      bump(errorCounts, code); rowIssues.push({ row: row, code: code });
    }
    rows.slice(header.index + 1).forEach(function (row, offset) {
      var rowNumber = header.index + offset + 2;
      if (isEmptyRow(row)) { skippedEmpty++; return; }
      if (isScopeRow(row)) { skippedScope++; return; }
      var record = rowToRecord(row, rowNumber, stableIdIndex, sourceMeta || {});
      idCounts[record.review_id] = (idCounts[record.review_id] || 0) + 1;
      if (idCounts[record.review_id] > 1 && record.id_quality === "provisional") {
        record.review_id += "-R" + rowNumber;
        record.diagnostic_codes.push("PROVISIONAL_ID_COLLISION");
      }
      record.diagnostic_codes.forEach(function (code) { issue(rowNumber, code); });
      records.push(record);
    });
    var source = clone(sourceMeta || {});
    source.sheet_name = source.sheet_name || SHEET_NAME;
    source.header_row = header.index + 1;
    source.header_score = header.score;
    return { source: source, records: records, diagnostics: {
      schema_version: SCHEMA_VERSION, header_row: header.index + 1, header_score: header.score,
      stable_id_column: stableIdIndex >= 0 ? text(headers[stableIdIndex]) : "",
      stable_id_available: stableIdIndex >= 0,
      processed_rows: records.length, skipped_empty_rows: skippedEmpty, skipped_scope_rows: skippedScope,
      error_counts: errorCounts, row_issues: rowIssues
    } };
  }

  function mergeDataset(current, dataset) {
    var out = normalizeHistory(current), added = 0, updated = 0, skipped = 0;
    (dataset.records || []).forEach(function (incoming) {
      var latestKey = out.latest[incoming.review_id], latest = latestKey && out.records[latestKey];
      if (latest && latest.fingerprint === incoming.fingerprint) { skipped++; return; }
      var recordKey = incoming.review_id + "@" + incoming.fingerprint;
      if (!out.records[recordKey]) {
        var record = clone(incoming);
        record.record_key = recordKey;
        record.imported_at = nowIso();
        record.revision = latest ? Number(latest.revision || 1) + 1 : 1;
        out.records[recordKey] = record;
        if (latest) updated++; else added++;
      } else skipped++;
      out.latest[incoming.review_id] = recordKey;
    });
    var source = dataset.source || {};
    var snapshotId = text(source.fingerprint) || hashString(JSON.stringify(source) + nowIso());
    if (!out.snapshots.some(function (item) { return item.id === snapshotId; })) {
      out.snapshots.push({ id: snapshotId, imported_at: nowIso(), file_name: text(source.file_name),
        file_size: Number(source.file_size || 0), sheet_name: text(source.sheet_name),
        row_count: (dataset.records || []).length, added: added, updated: updated, skipped: skipped,
        diagnostics: clone(dataset.diagnostics || {}) });
    }
    refreshMeta(out);
    return { history: out, result: { added: added, updated: updated, skipped: skipped,
      total: (dataset.records || []).length, snapshot_id: snapshotId } };
  }

  function mergeHistory(current, incoming) {
    var out = normalizeHistory(current), src = normalizeHistory(incoming);
    Object.keys(src.records).forEach(function (key) { if (!out.records[key]) out.records[key] = clone(src.records[key]); });
    Object.keys(src.latest).forEach(function (reviewId) {
      var incomingRecord = src.records[src.latest[reviewId]], currentRecord = out.records[out.latest[reviewId]];
      if (!currentRecord || Number(incomingRecord && incomingRecord.revision || 0) >= Number(currentRecord.revision || 0))
        out.latest[reviewId] = src.latest[reviewId];
    });
    var snapshots = {};
    out.snapshots.forEach(function (item) { snapshots[item.id] = true; });
    src.snapshots.forEach(function (item) { if (!snapshots[item.id]) out.snapshots.push(clone(item)); });
    Object.keys(src.config.type_mappings || {}).forEach(function (key) {
      if (!out.config.type_mappings[key]) out.config.type_mappings[key] = src.config.type_mappings[key];
    });
    Object.keys(src.benchmarks.labels || {}).forEach(function (key) {
      if (!out.benchmarks.labels[key]) out.benchmarks.labels[key] = clone(src.benchmarks.labels[key]);
    });
    refreshMeta(out);
    return out;
  }

  function latestRecord(history, reviewId) {
    var h = history || {}, key = h.latest && h.latest[reviewId];
    return key && h.records ? h.records[key] || null : null;
  }
  function summary(history) {
    // 화면을 다시 그릴 때마다 실제 검토결과가 든 전체 이력 2천 건을 복제하지 않는다.
    var h = preparedHistory(history);
    return { meta: clone(h.meta), stats: clone(h.stats), snapshots: h.snapshots.slice(-10).reverse(),
      statuses: topEntries(h.stats.statuses), request_types: topEntries(h.stats.request_types),
      result_types: topEntries(h.stats.result_types), departments: topEntries(h.stats.departments),
      change_kinds: topEntries(h.stats.change_kinds), difficulties: topEntries(h.stats.difficulties),
      review_types: topEntries(h.stats.review_types) };
  }
  function search(history, query, filters) {
    var h = history || emptyHistory(), q = compact(query), f = filters || {}, results = [];
    Object.keys(h.latest || {}).forEach(function (reviewId) {
      var record = latestRecord(h, reviewId);
      if (!record) return;
      var typeValue = text(record.result.type || record.request.type);
      if (f.type && typeValue !== f.type) return;
      var fields = [record.request.contract_name, record.result.contract_name, record.request.counterparty,
        record.request.department, record.result.department, record.request.type, record.result.type,
        record.request.change_kind, record.result.change_kind, record.request.contract_period, record.review_id];
      var score = 0;
      if (q) fields.forEach(function (value, index) {
        var c = compact(value);
        if (!c || c.indexOf(q) === -1) return;
        score += index < 2 ? (c === q ? 100 : 45) : (index === 2 ? 25 : 10);
      });
      if (q && !score) return;
      results.push({ review_id: reviewId, score: score, record: record });
    });
    results.sort(function (a, b) {
      var ad = text(a.record.result.created_at || a.record.request.created_at);
      var bd = text(b.record.result.created_at || b.record.request.created_at);
      return b.score - a.score || bd.localeCompare(ad) || a.review_id.localeCompare(b.review_id);
    });
    return results.slice(0, Number(f.limit || 50));
  }
  function setTypeMapping(history, dbType, appType) {
    var out = normalizeHistory(history);
    if (text(appType)) out.config.type_mappings[text(dbType)] = text(appType);
    else delete out.config.type_mappings[text(dbType)];
    refreshMeta(out);
    return out;
  }
  function addBenchmarkRun(history, run) {
    var out = normalizeHistory(history), item = clone(run || {});
    if (!text(item.review_id)) throw new Error("내부 평가에 계약검토 이력 ID가 필요합니다");
    item.app_version = text(item.app_version) || "version-unknown";
    item.contract_hash = text(item.contract_hash);
    item.captured_at = text(item.captured_at) || nowIso();
    item.run_id = text(item.run_id) || hashString([item.review_id, item.app_version, item.contract_hash,
      item.initial_auto_type_id, item.final_type_id].join("|"));
    var index = out.benchmarks.runs.findIndex(function (existing) { return existing.run_id === item.run_id; });
    if (index >= 0) out.benchmarks.runs[index] = item; else out.benchmarks.runs.push(item);
    if (text(item.final_type_id)) {
      out.benchmarks.labels[item.review_id] = {
        final_type_id: text(item.final_type_id), confirmed_at: item.captured_at,
        source: "completed_review", app_version: item.app_version
      };
    }
    refreshMeta(out);
    return out;
  }
  function benchmarkSummary(history) {
    var h = preparedHistory(history), byVersion = {};
    (h.benchmarks.runs || []).forEach(function (run) {
      var version = text(run.app_version) || "version-unknown";
      if (!byVersion[version]) byVersion[version] = { app_version: version, runs: 0, evaluable: 0,
        auto_agreed: 0, reviewer_changed: 0, undetermined: 0 };
      var slot = byVersion[version]; slot.runs++;
      var initial = text(run.initial_auto_type_id), finalType = text(run.final_type_id);
      if (initial && finalType) {
        slot.evaluable++;
        if (initial === finalType) slot.auto_agreed++; else slot.reviewer_changed++;
      } else slot.undetermined++;
    });
    var versions = Object.keys(byVersion).map(function (key) {
      var row = byVersion[key];
      row.auto_agreement_rate = row.evaluable ? Math.round(row.auto_agreed / row.evaluable * 1000) / 10 : null;
      return row;
    }).sort(function (a, b) { return b.app_version.localeCompare(a.app_version, undefined, { numeric: true }); });
    return { label_count: Object.keys(h.benchmarks.labels || {}).length,
      run_count: (h.benchmarks.runs || []).length, versions: versions };
  }

  function parseXml(value) {
    var doc = new DOMParser().parseFromString(value, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("XLSX XML을 읽지 못했습니다");
    return doc;
  }
  function childElements(node, localName) {
    return Array.prototype.filter.call(node.childNodes || [], function (child) { return child.nodeType === 1 && child.localName === localName; });
  }
  function columnIndex(reference) {
    var letters = String(reference || "").match(/^[A-Z]+/i);
    if (!letters) return 0;
    return letters[0].toUpperCase().split("").reduce(function (n, ch) { return n * 26 + ch.charCodeAt(0) - 64; }, 0) - 1;
  }
  function sharedStringsFromXml(xml) {
    if (!xml) return [];
    var doc = parseXml(xml);
    return Array.prototype.map.call(doc.getElementsByTagName("si"), function (si) {
      return Array.prototype.map.call(si.getElementsByTagName("t"), function (t) { return t.textContent || ""; }).join("");
    });
  }
  function sheetRows(xml, sharedStrings) {
    var doc = parseXml(xml), output = [];
    Array.prototype.forEach.call(doc.getElementsByTagName("row"), function (row) {
      var values = [];
      childElements(row, "c").forEach(function (cell) {
        var index = columnIndex(cell.getAttribute("r")), type = cell.getAttribute("t") || "", value = "";
        if (type === "inlineStr") {
          value = Array.prototype.map.call(cell.getElementsByTagName("t"), function (t) { return t.textContent || ""; }).join("");
        } else {
          var v = cell.getElementsByTagName("v")[0];
          value = v ? v.textContent || "" : "";
          if (type === "s") value = sharedStrings[Number(value)] || "";
        }
        values[index] = value;
      });
      for (var i = 0; i < values.length; i++) if (values[i] === undefined) values[i] = "";
      output.push(values);
    });
    return output;
  }
  function relationshipTarget(base, target) {
    var clean = String(target || "").replace(/^\//, "");
    if (clean.indexOf("xl/") === 0) return clean;
    return base + clean.replace(/^\.\//, "");
  }
  async function workbookRows(file, onProgress) {
    if (typeof JSZip === "undefined") throw new Error("XLSX 압축 해제 모듈이 없습니다");
    var buffer = await file.arrayBuffer(), fingerprint = "";
    if (typeof crypto !== "undefined" && crypto.subtle) {
      var digest = await crypto.subtle.digest("SHA-256", buffer);
      fingerprint = Array.prototype.map.call(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    } else fingerprint = hashString(file.name + "|" + file.size + "|" + file.lastModified + "|" + buffer.byteLength);
    if (onProgress) onProgress({ completed: 0, total: 3, step: "압축 해제" });
    var zip = await JSZip.loadAsync(buffer);
    async function entry(path, required) {
      var found = zip.file(path);
      if (!found) { if (required) throw new Error("XLSX 내부 파일이 없습니다: " + path); return ""; }
      return found.async("string");
    }
    var workbookXml = await entry("xl/workbook.xml", true);
    var relsXml = await entry("xl/_rels/workbook.xml.rels", true);
    var shared = sharedStringsFromXml(await entry("xl/sharedStrings.xml", false));
    var workbook = parseXml(workbookXml), rels = parseXml(relsXml), targets = {};
    Array.prototype.forEach.call(rels.getElementsByTagName("Relationship"), function (rel) {
      targets[rel.getAttribute("Id")] = relationshipTarget("xl/", rel.getAttribute("Target"));
    });
    var defs = Array.prototype.map.call(workbook.getElementsByTagName("sheet"), function (sheet) {
      var rid = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      return { name: sheet.getAttribute("name"), path: targets[rid] };
    });
    var selected = defs.filter(function (def) { return normalized(def.name) === SHEET_NAME; })[0] || defs[0];
    if (!selected) throw new Error("XLSX에 워크시트가 없습니다");
    if (onProgress) onProgress({ completed: 1, total: 3, step: selected.name + " 읽기" });
    var rows = sheetRows(await entry(selected.path, true), shared);
    if (onProgress) onProgress({ completed: 3, total: 3, step: "구조 확인 완료" });
    return { rows: rows, source: { file_name: file.name, file_size: file.size,
      last_modified: file.lastModified, fingerprint: fingerprint, sheet_name: selected.name } };
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB를 사용할 수 없습니다")); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("계약검토 이력 저장소를 열지 못했습니다")); };
    });
  }
  function load() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readonly"), req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        req.onsuccess = function () { db.close(); try { resolve(normalizeHistory(req.result || emptyHistory())); } catch (e) { reject(e); } };
        req.onerror = function () { db.close(); reject(req.error || new Error("계약검토 이력을 읽지 못했습니다")); };
      });
    });
  }
  function save(history) {
    var normalizedHistory = normalizeHistory(history);
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(normalizedHistory, RECORD_KEY);
        tx.oncomplete = function () { db.close(); resolve(normalizedHistory); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error("계약검토 이력 저장에 실패했습니다")); };
      });
    });
  }
  function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persist().catch(function () { return false; });
  }
  function packJson(history) { return JSON.stringify(normalizeHistory(history), null, 2); }
  function fromPack(value) { return normalizeHistory(typeof value === "string" ? JSON.parse(value) : value); }

  return { FORMAT: FORMAT, SCHEMA_VERSION: SCHEMA_VERSION, COLUMNS: COLUMNS,
    emptyHistory: emptyHistory, normalizeHistory: normalizeHistory, datasetFromRows: datasetFromRows,
    mergeDataset: mergeDataset, mergeHistory: mergeHistory, summary: summary, search: search,
    latestRecord: latestRecord, setTypeMapping: setTypeMapping,
    addBenchmarkRun: addBenchmarkRun, benchmarkSummary: benchmarkSummary, workbookRows: workbookRows,
    load: load, save: save, requestPersistence: requestPersistence,
    packJson: packJson, fromPack: fromPack, hashString: hashString };
})();

if (typeof module !== "undefined") module.exports = ReviewHistory;
