"use strict";
/* Only pure inputs cross the offline worker boundary. A worker result is a mapping
   candidate, never an authenticated automatic-verdict ticket. */
var AnalysisRuntime=(function create(){
  var worker=null,url=null,sequence=0,pending=null,sourceVersion=0,sourceState=null;
  function snapshot(value){var out=[],seen=new Set();function visit(v){
    if(!v||typeof v!=='object'){out.push(v);return;}out.push(v);if(seen.has(v))return;seen.add(v);
    var keys=Object.keys(v);out.push(keys.length);keys.forEach(function(k){out.push(k);visit(v[k]);});
  }visit(value);if(value&&typeof value==='object')out.shift();return out;}
  function same(a,b){return a.length===b.length&&a.every(function(v,i){return v===b[i];});}
  function abortError(message){var e=new Error(message||'분석을 취소했습니다.');e.name='AbortError';return e;}
  function dispose(){if(worker)worker.terminate();worker=null;if(url)URL.revokeObjectURL(url);url=null;sourceState=null;}
  function cancel(message){var p=pending;pending=null;dispose();if(p){clearTimeout(p.timeout);p.reject(abortError(message));}}
  function ensure(){if(worker)return;
    if(typeof Worker==='undefined'||typeof Blob==='undefined'||typeof URL==='undefined')throw Error('이 브라우저에서 별도 분석 작업을 시작할 수 없습니다. Worker를 허용한 브라우저에서 다시 시도하세요.');
    var source=document.getElementById('analysis-worker-src');if(!source||!source.textContent)throw Error('분석 작업 파일이 없습니다. 완전한 오프라인 배포 파일로 다시 여세요.');
    try{url=URL.createObjectURL(new Blob([source.textContent],{type:'text/javascript'}));worker=new Worker(url);}
    catch(e){dispose();throw Error('별도 분석 작업을 시작할 수 없습니다. 브라우저의 Worker/보안 설정을 확인한 뒤 다시 분석하세요. '+e.message);}
    worker.onmessage=function(event){var m=event.data,p=pending;if(!p||m.id!==p.id)return;
      if(m.type==='progress'){p.progress(m);return;}
      pending=null;clearTimeout(p.timeout);
      if(m.type==='result')p.resolve(m.result);else{dispose();p.reject(Error(m.error||'분석 작업 실패'));}
    };
    worker.onerror=function(event){var p=pending;pending=null;dispose();if(p){clearTimeout(p.timeout);p.reject(Error('분석 작업 오류: '+(event.message||'브라우저가 작업을 중단했습니다. 다시 시도하세요.')));}if(event.preventDefault)event.preventDefault();};
    worker.onmessageerror=function(){var p=pending;pending=null;dispose();if(p){clearTimeout(p.timeout);p.reject(Error('분석 결과를 읽을 수 없습니다. 다시 분석하세요.'));}};
  }
  function run(input,sources,progress){if(pending)cancel();return new Promise(function(resolve,reject){
    try{ensure();var state=snapshot(sources),changed=!sourceState||!same(sourceState,state);if(changed){sourceState=state;sourceVersion++;}
      var id=++sequence,p={id:id,resolve:resolve,reject:reject,progress:progress||function(){}};pending=p;
      p.timeout=setTimeout(function(){if(pending!==p)return;pending=null;dispose();reject(Error('분석 시간이 5분을 초과했습니다. 작업을 중단했습니다. 자료 수·문서 크기를 확인한 뒤 다시 시도하세요.'));},300000);
      var started=performance.now();worker.postMessage({id:id,input:input,sourceVersion:sourceVersion,sources:changed?sources:null});
      p.progress({id:id,type:'timing',name:'postMessage',duration:performance.now()-started});
    }catch(e){if(pending){clearTimeout(pending.timeout);pending=null;}dispose();reject(e);}
  });}
  return {run:run,cancel:cancel,snapshot:snapshot,same:same,create:create};
})();
if(typeof module!=='undefined')module.exports=AnalysisRuntime;
