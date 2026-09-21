"use strict";
// 원문은 폐쇄망 브라우저 IndexedDB에만 저장. 기본 코퍼스/배포물로 복제하지 않는다.
var StandardAutoArchive=(function(){
  var dbPromise=null,timer=null,enabled=false,writing=Promise.resolve(),generation=0;
  try{enabled=localStorage.getItem('cr-standard-archive-enabled')==='true';}catch(e){}
  function status(s){var el=document.getElementById('standard-auto-eval-status');if(el)el.textContent=s;}
  function open(){if(!dbPromise)dbPromise=new Promise(function(resolve,reject){var r=indexedDB.open('cr-standard-auto-evaluation',1);
    r.onupgradeneeded=function(){r.result.createObjectStore('packets',{keyPath:'id'});};r.onsuccess=function(){resolve(r.result);};r.onerror=function(){dbPromise=null;reject(r.error);};});return dbPromise;}
  async function write(p){var db=await open();return new Promise(function(resolve,reject){var tx=db.transaction('packets','readwrite');
    var store=tx.objectStore('packets'),read=store.get(p.id),changed=false;
    read.onsuccess=function(){var old=read.result;
      // 동일 원문·질문의 사용자 정답을 이후 시스템 판정으로 덮어 학습 근거를 소실시키지 않는다.
      if(old)Object.keys(p.verdicts||{}).forEach(function(id){var v=old.verdicts?.[id];
        if(p.verdicts[id]?.origin==='auto'&&v?.origin==='manual'&&v.verdict&&!v.needs_reconfirmation&&SafetyDigest.of(old.checks?.find(function(c){return c.id===id;}))===SafetyDigest.of(p.checks?.find(function(c){return c.id===id;})))p.verdicts[id]=v;
      });
      if(!old||SafetyDigest.of(old)!==SafetyDigest.of(p)){store.put(p);changed=true;}
    };
    tx.oncomplete=function(){resolve();if(changed)setTimeout(function(){notifySources(p.id);},0);};tx.onerror=function(){reject(tx.error);};tx.onabort=function(){reject(tx.error||Error('저장 취소'));};});}
  function notifySources(id){
    // 동일 탭·다른 탭 모두 변경된 ID만 재조회한다. 원문을 localStorage 이벤트에 복제하지 않는다.
    var detail={id:typeof id==='string'?id:null,revision:Date.now()};
    window.dispatchEvent(new CustomEvent('cr-evaluation-packet-changed',{detail:detail}));
    try{localStorage.setItem('cr-template-sources-changed',JSON.stringify(detail));}catch(e){}
  }
  function schedule(){if(!enabled)return;clearTimeout(timer);timer=setTimeout(function(){
    var p=SafetyRuntime.standardPacket();if(!p)return;
    writing=writing.catch(function(){}).then(function(){return write(p);}).then(function(){document.getElementById('standard-auto-archive-status').textContent='원문·판정 내부 평가자료 저장됨. 외부 전송 없음.';}).catch(function(err){document.getElementById('standard-auto-archive-status').textContent='평가자료 저장 실패: '+err.message+' — 일반 판정 저장과 별개입니다.';});
  },600);}
  function setEnabled(on){localStorage.setItem('cr-standard-archive-enabled',String(!!on));enabled=!!on;if(on)schedule();else clearTimeout(timer);}
  async function run(){var token=++generation;await writing;
    var connected=JudgmentSources.compile((await backup()).packets,loopCorpus,currentHistoryKnowledge()),packets=connected.packets,groups=DecisionEvaluation.families(packets);
    var totals={contracts:0,checked:0,candidates:0,false_safe:0,released:0,mapping_reviewed:0,mapping_correct:0,failed:0,reuse_candidates:0,hold_reasons:{},families:new Set(groups).size},conflicts=[];
    totals.source_connections=connected.stats;
    for(var packet of packets){if(token!==generation){status('점검 취소됨. 저장된 원문·판정은 유지됩니다.');return;}
      if(packet.pending||packet.judgment_link_conflict){totals.failed++;continue;}
      var replayed;try{replayed=ReviewReplay.run(packet,CR,[]);}catch(err){totals.failed++;continue;}
      totals.mapping_reviewed+=replayed.mapping.reviewed;totals.mapping_correct+=replayed.mapping.correct;
      var sourceIndex=packets.findIndex(function(p){return p.id===packet.id;}),sources=DecisionEvaluation.sources(packets,groups,sourceIndex);
      var r=StandardAuto.replay(replayed.packet,{review_packets:sources});totals.contracts++;['checked','candidates','false_safe','released'].forEach(function(k){totals[k]+=r[k];});
      r.rows.forEach(function(row){if(row.status==='clause_reused')totals.reuse_candidates++;if(!row.candidate)totals.hold_reasons[row.status]=(totals.hold_reasons[row.status]||0)+1;});
      r.rows.filter(function(row){return row.false_safe;}).forEach(function(row){conflicts.push(row.check_id);});
      status(totals.contracts+'/'+packets.length+'건 점검 중');await new Promise(function(resolve){setTimeout(resolve,0);});
    }
    // 과거 유불리 판단과 현행 약정 확인의 불일치는 평가 결과다. 현재 자동판정 설정을 일괄 중지하지 않는다.
    if(token!==generation){status('점검 취소됨. 판정·중지 설정은 변경하지 않았습니다.');return;}
    status('저장 문서 '+totals.contracts+'건 · 비교 가능한 사람 판정 '+totals.checked+'개 · 자동 후보 '+totals.candidates+'개 · 과거 보완과 충돌 '+totals.false_safe+'개 · 기존 자동처리 외 정상 후보 '+totals.released+'개. '+
      '사람 확인 근거 매핑 '+totals.mapping_correct+'/'+totals.mapping_reviewed+'개 일치 · 재실행 불가 '+totals.failed+'건. '+
      '원문과 연결해 복원한 누적 판정 '+connected.stats.hydrated_judgments+'항목. '+
      (conflicts.length?'불일치 항목은 비교 결과로 남겼으며 현재 판정·중지 설정은 변경하지 않았습니다. ':'')+'자동 추정 계열 '+totals.families+'개 · 다른 계열의 이전 날짜 자료에서 조항 판단 재사용 '+totals.reuse_candidates+'개. 보류: '+Object.keys(totals.hold_reasons).map(function(k){return (StandardAuto.labels[k]||k)+' '+totals.hold_reasons[k];}).join(' / ')+'. '+
      '저장 원문에서 조항 분할·매핑·별첨 검색을 재실행했습니다. 파일 재추출·유형 자동선택은 재실행하지 않습니다. 자동 계열 추정이므로 독립 정확도 인증이 아닙니다. 위험수용·이유 미상·원문 없는 구 집계는 채점에서 제외합니다.');
    return totals;
  }
  async function backup(){await writing;var db=await open();return new Promise(function(resolve,reject){var r=db.transaction('packets').objectStore('packets').getAll();
    r.onsuccess=function(){resolve({format:'cr-standard-evaluation-backup-v1',packets:r.result});};r.onerror=function(){reject(r.error);};});}
  async function get(id){await writing;var db=await open();return new Promise(function(resolve,reject){var r=db.transaction('packets').objectStore('packets').get(id);
    r.onsuccess=function(){resolve(r.result||null);};r.onerror=function(){reject(r.error);};});}
  async function restore(data){if(!data||data.format!=='cr-standard-evaluation-backup-v1'||!Array.isArray(data.packets)||data.packets.length>10000)throw Error('내부 평가자료 백업 형식이 아닙니다.');
    data.packets.forEach(function(p){if(!p||!Array.isArray(p.documents)||!Array.isArray(p.checks)||!Array.isArray(p.items)||!p.verdicts||typeof p.context!=='object'||
      p.id!==SafetyDigest.of([p.documents,p.context])||!p.documents.every(function(d){return d&&typeof d.text==='string'&&typeof d.name==='string';})||
      !p.checks.every(function(c){return c&&typeof c.id==='string'&&typeof c.check==='string';})||
      !p.items.every(function(i){return i&&typeof i.cpId==='string'&&typeof i.coverage==='string';})||Array.isArray(p.verdicts))throw Error('손상된 평가자료입니다.');});
    var db=await open();return new Promise(function(resolve,reject){var tx=db.transaction('packets','readwrite'),s=tx.objectStore('packets'),added=0;
      data.packets.forEach(function(p){var r=s.get(p.id);r.onsuccess=function(){if(!r.result){s.add(p);added++;}};});
      tx.oncomplete=function(){resolve(added);setTimeout(notifySources,0);};tx.onerror=function(){reject(tx.error);};tx.onabort=function(){reject(tx.error||Error('복구 취소'));};});}
  return {schedule:schedule,setEnabled:setEnabled,enabled:function(){return enabled;},run:run,backup:backup,get:get,restore:restore,cancel:function(){generation++;}};
})();
