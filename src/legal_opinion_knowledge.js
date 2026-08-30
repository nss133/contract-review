"use strict";
/* 법률검토의견 전건 태깅자료 저장소.
   legal-opinion-tagger의 6시트 XLSX 중 중복 원문 시트를 제외한 구조화 시트를 읽어
   앱 버전과 독립된 IndexedDB에 보존한다. 자동판정 규칙은 바꾸지 않고, 향후
   유형·적용범위·체크 매핑의 shadow 분석 기반만 제공한다. */
var LegalOpinionKnowledge = (function () {
  var FORMAT = "cr-legal-opinion-knowledge-v1";
  var SCHEMA_VERSION = 1;
  var DB_NAME = "contract-review-workspace";
  var DB_VERSION = 1;
  var STORE_NAME = "knowledge";
  var RECORD_KEY = "legal-opinion-corpus";
  var REQUIRED_SHEETS = ["문서대장", "문서별태그", "태그정본", "태그별근거", "태그연결성"];

  function nowIso() { return new Date().toISOString(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function text(value) { return String(value === undefined || value === null ? "" : value).trim(); }
  function list(value) {
    return text(value).split(/\s*\|\s*/).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  function sourceList(value) {
    return text(value).split(/\s*\+\s*/).map(function (item) { return item.trim(); }).filter(Boolean);
  }
  function hashString(value) {
    var s = String(value || ""), h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function emptyKnowledge() {
    return {
      meta: { format: FORMAT, schema_version: SCHEMA_VERSION, created_at: "", updated_at: "",
        document_count: 0, revision_count: 0, tag_count: 0, evidence_count: 0,
        relation_count: 0, snapshot_count: 0 },
      snapshots: [], documents: {}, latest: {}, tags: {}, curation: { mappings: {}, decisions: {} },
      stats: { tag_documents: {}, tag_types: {}, tag_pairs: {}, db_types: {}, departments: {},
        source_counts: {}, conclusion_links: {} }
    };
  }

  function normalizeKnowledge(input) {
    var out = input && typeof input === "object" ? clone(input) : emptyKnowledge();
    if (!out.meta) out.meta = {};
    if (out.meta.format && out.meta.format !== FORMAT) throw new Error("지원하지 않는 지식팩 형식");
    if (Number(out.meta.schema_version || 0) > SCHEMA_VERSION) throw new Error("더 최신 버전에서 만든 지식팩입니다");
    out.meta.format = FORMAT;
    out.meta.schema_version = SCHEMA_VERSION;
    if (!Array.isArray(out.snapshots)) out.snapshots = [];
    ["documents", "latest", "tags"].forEach(function (key) {
      if (!out[key] || typeof out[key] !== "object" || Array.isArray(out[key])) out[key] = {};
    });
    if (!out.curation || typeof out.curation !== "object") out.curation = { mappings: {}, decisions: {} };
    if (!out.curation.mappings) out.curation.mappings = {};
    if (!out.curation.decisions) out.curation.decisions = {};
    out.stats = deriveStats(out);
    refreshMeta(out);
    return out;
  }

  function preparedKnowledge(input) {
    if (input && input.meta && input.meta.format === FORMAT &&
        Number(input.meta.schema_version) === SCHEMA_VERSION &&
        input.documents && input.latest && input.tags && input.stats && input.curation) return input;
    return normalizeKnowledge(input);
  }

  function rowsToObjects(table) {
    if (!table || !Array.isArray(table.rows) || !table.rows.length) return [];
    var headers = table.rows[0].map(text);
    return table.rows.slice(1).filter(function (row) {
      return row.some(function (cell) { return text(cell); });
    }).map(function (row) {
      var obj = {};
      headers.forEach(function (header, index) { if (header) obj[header] = row[index] === undefined ? "" : row[index]; });
      return obj;
    });
  }

  function requireColumns(tables) {
    var required = {
      "문서대장": ["문서 ID", "제목", "처리 상태", "엔진 버전"],
      "문서별태그": ["문서 ID", "태그 ID", "해시태그", "유형", "점수", "출처"],
      "태그정본": ["태그 ID", "정규 태그명", "해시태그", "유형"],
      "태그별근거": ["문서 ID", "태그 ID", "근거 출처", "근거 문장"],
      "태그연결성": ["문서 ID", "태그 A", "태그 B", "관계 유형", "연결 점수"]
    };
    REQUIRED_SHEETS.forEach(function (name) {
      if (!tables[name]) throw new Error("필수 시트가 없습니다: " + name);
      var headers = (tables[name].rows[0] || []).map(text);
      required[name].forEach(function (column) {
        if (headers.indexOf(column) === -1) throw new Error(name + " 시트에 필수 열이 없습니다: " + column);
      });
    });
  }

  function datasetFromTables(tables, sourceMeta) {
    requireColumns(tables);
    var canonical = {}, byDocument = {}, evidenceByDocument = {}, relationsByDocument = {};
    rowsToObjects(tables["태그정본"]).forEach(function (row) {
      var id = text(row["태그 ID"]);
      if (!id) return;
      canonical[id] = { id: id, label: text(row["정규 태그명"]), hashtag: text(row["해시태그"]),
        type: text(row["유형"]), aliases: list(row["별칭"]), issue_cards: list(row["연결 핵심쟁점 카드"]) };
    });
    rowsToObjects(tables["문서별태그"]).forEach(function (row) {
      var documentId = text(row["문서 ID"]), tagId = text(row["태그 ID"]);
      if (!documentId || !tagId) return;
      if (!byDocument[documentId]) byDocument[documentId] = [];
      byDocument[documentId].push({ rank: Number(row["순위"] || 0), tag_id: tagId,
        hashtag: text(row["해시태그"]), label: text(row["정규 태그명"]), status: text(row["후보 상태"]),
        type: text(row["유형"]), score: Number(row["점수"] || 0), confidence: text(row["신뢰도"]),
        sources: sourceList(row["출처"]), occurrences: Number(row["등장 횟수"] || 0) });
      if (!canonical[tagId]) canonical[tagId] = { id: tagId, label: text(row["정규 태그명"]),
        hashtag: text(row["해시태그"]), type: text(row["유형"]), aliases: [], issue_cards: [] };
    });
    rowsToObjects(tables["태그별근거"]).forEach(function (row) {
      var documentId = text(row["문서 ID"]), tagId = text(row["태그 ID"]);
      if (!documentId || !tagId) return;
      if (!evidenceByDocument[documentId]) evidenceByDocument[documentId] = [];
      evidenceByDocument[documentId].push({ tag_id: tagId, hashtag: text(row["해시태그"]),
        source: text(row["근거 출처"]), sentence: text(row["근거 문장"]), at: Number(row["원문 위치"] || 0) });
    });
    rowsToObjects(tables["태그연결성"]).forEach(function (row) {
      var documentId = text(row["문서 ID"]);
      if (!documentId) return;
      if (!relationsByDocument[documentId]) relationsByDocument[documentId] = [];
      relationsByDocument[documentId].push({ source_tag: text(row["태그 A"]), target_tag: text(row["태그 B"]),
        relation: text(row["관계 유형"]), score: Number(row["연결 점수"] || 0),
        source: text(row["공통 출처"]), issue_card: text(row["공통 핵심쟁점 카드"]) });
    });
    var documents = rowsToObjects(tables["문서대장"]).map(function (row, index) {
      var sourceId = text(row["문서 ID"]) || "ROW-" + (index + 2);
      var doc = { source_id: sourceId, source_row: Number(row["원본 행"] || 0), title: text(row["제목"]),
        date: text(row["작성일"]), processed_date: text(row["처리일"]), department: text(row["신청부서"]),
        case_type: text(row["유형"]), case_type_detail: text(row["유형2"]), review_type: text(row["검토유형"]),
        difficulty: text(row["난이도"]), security_level: text(row["보안등급"]), source_status: text(row["원본 상태"]),
        process_status: text(row["처리 상태"]), review_reason: text(row["검토 사유"]), engine_version: text(row["엔진 버전"]),
        tags: (byDocument[sourceId] || []).sort(function (a, b) { return a.rank - b.rank; }),
        evidence: evidenceByDocument[sourceId] || [], relations: relationsByDocument[sourceId] || [] };
      doc.fingerprint = hashString(JSON.stringify([doc.title, doc.date, doc.department, doc.case_type,
        doc.case_type_detail, doc.review_type, doc.engine_version, doc.tags, doc.evidence, doc.relations]));
      return doc;
    });
    return { source: sourceMeta || {}, tags: canonical, documents: documents };
  }

  function mergeDataset(current, dataset) {
    var out = normalizeKnowledge(current), added = 0, updated = 0, skipped = 0;
    Object.keys(dataset.tags || {}).forEach(function (id) {
      var incoming = dataset.tags[id];
      if (!out.tags[id]) out.tags[id] = incoming;
      else {
        out.tags[id].label = incoming.label || out.tags[id].label;
        out.tags[id].hashtag = incoming.hashtag || out.tags[id].hashtag;
        out.tags[id].type = incoming.type || out.tags[id].type;
        out.tags[id].aliases = Array.from(new Set((out.tags[id].aliases || []).concat(incoming.aliases || [])));
        out.tags[id].issue_cards = Array.from(new Set((out.tags[id].issue_cards || []).concat(incoming.issue_cards || [])));
      }
    });
    (dataset.documents || []).forEach(function (doc) {
      var latestKey = out.latest[doc.source_id], latest = latestKey && out.documents[latestKey];
      if (latest && latest.fingerprint === doc.fingerprint) { skipped++; return; }
      var recordKey = doc.source_id + "@" + doc.fingerprint;
      if (!out.documents[recordKey]) {
        doc.record_key = recordKey;
        doc.imported_at = nowIso();
        doc.revision = latest ? Number(latest.revision || 1) + 1 : 1;
        out.documents[recordKey] = doc;
        if (latest) updated++; else added++;
      } else skipped++;
      out.latest[doc.source_id] = recordKey;
    });
    var snapshotId = text(dataset.source && dataset.source.fingerprint) || hashString(JSON.stringify(dataset.source || {}) + nowIso());
    if (!out.snapshots.some(function (item) { return item.id === snapshotId; })) {
      out.snapshots.push({ id: snapshotId, imported_at: nowIso(), file_name: text(dataset.source && dataset.source.file_name),
        file_size: Number(dataset.source && dataset.source.file_size || 0), tagger_version: text(dataset.source && dataset.source.tagger_version),
        document_count: (dataset.documents || []).length, added: added, updated: updated, skipped: skipped });
    }
    out.stats = deriveStats(out);
    refreshMeta(out);
    return { knowledge: out, result: { added: added, updated: updated, skipped: skipped,
      total: (dataset.documents || []).length, snapshot_id: snapshotId } };
  }

  function mergeKnowledge(current, incoming) {
    var out = normalizeKnowledge(current), src = normalizeKnowledge(incoming);
    Object.keys(src.tags).forEach(function (id) {
      var tag = src.tags[id];
      if (!out.tags[id]) out.tags[id] = clone(tag);
      else {
        out.tags[id].aliases = Array.from(new Set((out.tags[id].aliases || []).concat(tag.aliases || [])));
        out.tags[id].issue_cards = Array.from(new Set((out.tags[id].issue_cards || []).concat(tag.issue_cards || [])));
      }
    });
    Object.keys(src.documents).forEach(function (recordKey) {
      if (!out.documents[recordKey]) out.documents[recordKey] = clone(src.documents[recordKey]);
    });
    Object.keys(src.latest).forEach(function (sourceId) {
      var incomingKey = src.latest[sourceId], currentKey = out.latest[sourceId];
      var incomingDoc = src.documents[incomingKey], currentDoc = currentKey && out.documents[currentKey];
      if (!currentDoc || Number(incomingDoc && incomingDoc.revision || 0) >= Number(currentDoc.revision || 0))
        out.latest[sourceId] = incomingKey;
    });
    var snapshotIds = {};
    out.snapshots.forEach(function (item) { snapshotIds[item.id] = true; });
    src.snapshots.forEach(function (item) { if (!snapshotIds[item.id]) out.snapshots.push(clone(item)); });
    Object.keys(src.curation.mappings || {}).forEach(function (key) {
      if (!out.curation.mappings[key]) out.curation.mappings[key] = clone(src.curation.mappings[key]);
    });
    Object.keys(src.curation.decisions || {}).forEach(function (key) {
      if (!out.curation.decisions[key]) out.curation.decisions[key] = clone(src.curation.decisions[key]);
    });
    out.stats = deriveStats(out);
    refreshMeta(out);
    return out;
  }

  function deriveStats(knowledge) {
    var stats = { tag_documents: {}, tag_types: {}, tag_pairs: {}, db_types: {}, departments: {},
      source_counts: {}, conclusion_links: {} };
    Object.keys(knowledge.latest || {}).forEach(function (sourceId) {
      var doc = knowledge.documents[knowledge.latest[sourceId]];
      if (!doc) return;
      if (doc.case_type) stats.db_types[doc.case_type] = (stats.db_types[doc.case_type] || 0) + 1;
      if (doc.department) stats.departments[doc.department] = (stats.departments[doc.department] || 0) + 1;
      var unique = [], seen = {};
      (doc.tags || []).forEach(function (tag) {
        if (!tag.tag_id || seen[tag.tag_id]) return;
        seen[tag.tag_id] = true; unique.push(tag.tag_id);
        stats.tag_documents[tag.tag_id] = (stats.tag_documents[tag.tag_id] || 0) + 1;
        stats.tag_types[tag.type || "미분류"] = (stats.tag_types[tag.type || "미분류"] || 0) + 1;
        (tag.sources || []).forEach(function (source) { stats.source_counts[source] = (stats.source_counts[source] || 0) + 1; });
      });
      unique.slice(0, 30).sort().forEach(function (left, i, arr) {
        for (var j = i + 1; j < arr.length; j++) {
          var key = left + "|" + arr[j];
          stats.tag_pairs[key] = (stats.tag_pairs[key] || 0) + 1;
        }
      });
      (doc.relations || []).forEach(function (rel) {
        if (rel.relation !== "결론") return;
        var key = rel.source_tag + "|" + rel.target_tag;
        stats.conclusion_links[key] = (stats.conclusion_links[key] || 0) + 1;
      });
    });
    return stats;
  }

  function refreshMeta(knowledge) {
    var latestKeys = Object.keys(knowledge.latest || {}), latestDocs = latestKeys.map(function (id) {
      return knowledge.documents[knowledge.latest[id]];
    }).filter(Boolean);
    knowledge.meta.created_at = knowledge.meta.created_at || nowIso();
    knowledge.meta.updated_at = nowIso();
    knowledge.meta.document_count = latestDocs.length;
    knowledge.meta.revision_count = Object.keys(knowledge.documents || {}).length;
    knowledge.meta.tag_count = Object.keys(knowledge.tags || {}).length;
    knowledge.meta.evidence_count = latestDocs.reduce(function (n, doc) { return n + (doc.evidence || []).length; }, 0);
    knowledge.meta.relation_count = latestDocs.reduce(function (n, doc) { return n + (doc.relations || []).length; }, 0);
    knowledge.meta.snapshot_count = (knowledge.snapshots || []).length;
  }

  function topEntries(map, limit) {
    return Object.keys(map || {}).map(function (key) { return { key: key, count: map[key] }; })
      .sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key, "ko"); })
      .slice(0, limit || 20);
  }

  function summary(knowledge) {
    // load/save/merge 시 이미 정규화된 대용량 말뭉치를 화면을 다시 그릴 때마다
    // 복제·전수 집계하지 않는다. 외부에서 건네온 원시 객체만 방어적으로 정규화한다.
    var k = preparedKnowledge(knowledge);
    return { meta: clone(k.meta), snapshots: k.snapshots.slice(-10).reverse(),
      top_tags: topEntries(k.stats.tag_documents, 20), top_pairs: topEntries(k.stats.tag_pairs, 20),
      tag_types: topEntries(k.stats.tag_types, 20), db_types: topEntries(k.stats.db_types, 20),
      departments: topEntries(k.stats.departments, 20), conclusion_links: topEntries(k.stats.conclusion_links, 20) };
  }

  function matchText(knowledge, input, options) {
    var k = preparedKnowledge(knowledge), raw = String(input || "").toLocaleLowerCase("ko-KR");
    var compactText = raw.replace(/\s+/g, ""), limit = Number(options && options.limit || 12);
    var excludedTypes = new Set(["신청부서", "유형", "유형2", "검토유형", "department", "case_type", "case_type_detail", "review_type"]);
    var stop = new Set(["계약", "업무", "회사", "검토", "필요", "해당", "가능", "사항", "관련", "정보", "내용", "결과", "프로세스"]);
    var matches = [];
    Object.keys(k.tags).forEach(function (tagId) {
      var tag = k.tags[tagId];
      if (excludedTypes.has(tag.type)) return;
      var terms = [tag.label].concat(tag.aliases || []).map(function (term) { return text(term); })
        .filter(function (term) { return term.length >= 2 && !stop.has(term); });
      var hit = terms.sort(function (a, b) { return b.length - a.length; }).find(function (term) {
        return compactText.indexOf(term.toLocaleLowerCase("ko-KR").replace(/\s+/g, "")) !== -1;
      });
      if (!hit) return;
      var support = Number(k.stats.tag_documents[tagId] || 0);
      matches.push({ tag_id: tagId, label: tag.label, hashtag: tag.hashtag, type: tag.type,
        matched_term: hit, support: support, score: Math.round(hit.length * 6 + Math.log2(support + 1) * 8) });
    });
    matches.sort(function (a, b) { return b.score - a.score || b.support - a.support || a.label.localeCompare(b.label, "ko"); });
    var selected = matches.slice(0, limit), selectedIds = new Set(selected.map(function (item) { return item.tag_id; }));
    var documents = [];
    Object.keys(k.latest).forEach(function (sourceId) {
      var doc = k.documents[k.latest[sourceId]];
      if (!doc) return;
      var hits = (doc.tags || []).filter(function (tag) { return selectedIds.has(tag.tag_id); })
        .map(function (tag) { return tag.tag_id; });
      if (!hits.length) return;
      documents.push({ source_id: sourceId, title: doc.title, date: doc.date, department: doc.department,
        case_type: doc.case_type, hit_count: hits.length, tag_ids: hits.slice(0, 8) });
    });
    documents.sort(function (a, b) { return b.hit_count - a.hit_count || String(b.date).localeCompare(String(a.date)); });
    return { tags: selected, documents: documents.slice(0, 10) };
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
        var index = columnIndex(cell.getAttribute("r")), type = cell.getAttribute("t") || "";
        var value = "";
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
  async function workbookTables(file, onProgress) {
    if (typeof JSZip === "undefined") throw new Error("XLSX 압축 해제 모듈이 없습니다");
    var buffer = await file.arrayBuffer();
    var fingerprint = "";
    if (typeof crypto !== "undefined" && crypto.subtle) {
      var digest = await crypto.subtle.digest("SHA-256", buffer);
      fingerprint = Array.prototype.map.call(new Uint8Array(digest), function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    } else fingerprint = hashString(file.name + "|" + file.size + "|" + file.lastModified + "|" + buffer.byteLength);
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
    var sheetDefs = Array.prototype.map.call(workbook.getElementsByTagName("sheet"), function (sheet) {
      var rid = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      return { name: sheet.getAttribute("name"), path: targets[rid] };
    });
    var tables = {};
    for (var i = 0; i < sheetDefs.length; i++) {
      var def = sheetDefs[i];
      if (REQUIRED_SHEETS.indexOf(def.name) === -1) continue;
      if (onProgress) onProgress({ completed: Object.keys(tables).length, total: REQUIRED_SHEETS.length, sheet: def.name });
      tables[def.name] = { rows: sheetRows(await entry(def.path, true), shared) };
      await new Promise(function (resolve) { setTimeout(resolve, 0); });
    }
    if (onProgress) onProgress({ completed: REQUIRED_SHEETS.length, total: REQUIRED_SHEETS.length, sheet: "완료" });
    var versionRows = tables["문서대장"] ? rowsToObjects(tables["문서대장"]) : [];
    var versions = Array.from(new Set(versionRows.map(function (row) { return text(row["엔진 버전"]); }).filter(Boolean)));
    return { tables: tables, source: { file_name: file.name, file_size: file.size,
      last_modified: file.lastModified, fingerprint: fingerprint, tagger_version: versions.join(", ") } };
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
      request.onerror = function () { reject(request.error || new Error("저장소를 열지 못했습니다")); };
    });
  }
  function transaction(mode, action) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, mode), store = tx.objectStore(STORE_NAME), result;
        try { result = action(store); } catch (error) { db.close(); reject(error); return; }
        tx.oncomplete = function () { db.close(); resolve(result && result.result); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error("저장 작업에 실패했습니다")); };
        tx.onabort = tx.onerror;
      });
    });
  }
  function load() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, "readonly"), req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        req.onsuccess = function () { db.close(); try { resolve(normalizeKnowledge(req.result || emptyKnowledge())); } catch (e) { reject(e); } };
        req.onerror = function () { db.close(); reject(req.error || new Error("지식자료를 읽지 못했습니다")); };
      });
    });
  }
  function save(knowledge) {
    var normalized = normalizeKnowledge(knowledge);
    return transaction("readwrite", function (store) { return store.put(normalized, RECORD_KEY); }).then(function () { return normalized; });
  }
  function clear() { return transaction("readwrite", function (store) { return store.delete(RECORD_KEY); }); }
  function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return Promise.resolve(false);
    return navigator.storage.persist().catch(function () { return false; });
  }
  function packJson(knowledge) { return JSON.stringify(normalizeKnowledge(knowledge), null, 2); }
  function fromPack(value) {
    var parsed = typeof value === "string" ? JSON.parse(value) : value;
    return normalizeKnowledge(parsed);
  }

  return { FORMAT: FORMAT, SCHEMA_VERSION: SCHEMA_VERSION, REQUIRED_SHEETS: REQUIRED_SHEETS,
    emptyKnowledge: emptyKnowledge, normalizeKnowledge: normalizeKnowledge, datasetFromTables: datasetFromTables,
    mergeDataset: mergeDataset, mergeKnowledge: mergeKnowledge, deriveStats: deriveStats, summary: summary, matchText: matchText, workbookTables: workbookTables,
    load: load, save: save, clear: clear, requestPersistence: requestPersistence,
    packJson: packJson, fromPack: fromPack, hashString: hashString };
})();

if (typeof module !== "undefined") module.exports = LegalOpinionKnowledge;
