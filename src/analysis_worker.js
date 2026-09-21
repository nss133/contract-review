"use strict";
/* Embedded in a Blob worker by build_html.py. No network or browser storage. */
(function(){
  var sources=null,sourceVersion=0,combinedCache=null;
  self.onmessage=function(event){var m=event.data,p=m.input;
    function progress(step,message){self.postMessage({id:m.id,type:'progress',step:step,message:message});}
    try{
      if(m.sources){sources=m.sources;sourceVersion=m.sourceVersion;combinedCache=null;}
      if(!sources||sourceVersion!==m.sourceVersion)throw Error('참고자료 버전이 일치하지 않습니다. 다시 분석하세요.');
      var exclude=[p.hash,p.reviewId||''].join('|');
      if(!combinedCache||combinedCache.exclude!==exclude)combinedCache={exclude:exclude,value:HistoryAssist.combined(sources.legal,sources.history,sources.corpus,{excludeContractHash:p.hash,excludeReviewId:p.reviewId})};
      var knowledge=combinedCache.value;
      if(p.referenceOnly){
        progress(0,'태깅자료 참고 후보를 검색하고 있습니다. 계약 검토는 계속할 수 있습니다.');
        var tagRows={},referenceDocuments=p.safetyDocuments||[{name:'본문',text:p.text}];
        (p.checks||[]).forEach(function(cp){tagRows[cp.id]=DecisionReferences.retrieve(cp,referenceDocuments,knowledge,sourceVersion);});
        self.postMessage({id:m.id,type:'result',result:{fingerprint:CR.engine_fingerprint,tag_rows:tagRows}});return;
      }
      progress(0,'문서 구조와 적용 범위를 확인하고 있습니다');
      MatcherConfig.TAG_MATCH_MODE=['off','shadow','assist'].includes(p.tagMode)?p.tagMode:(CR.tag_match_mode||'assist');
      var clauses=segmentContract(p.text),baseClauses=segmentContract(p.baseText||'');
      progress(1,'과거 태그·검토자료에서 본건 후보를 검색하고 있습니다');
      var hints=JudgmentHints.index({knowledge:knowledge,corpus:sources.corpus,packets:sources.packets});
      var related=HistoryAssist.retrieve(knowledge,(p.options.docTitle||'')+' '+p.text,p.department||'');
      progress(2,'체크항목과 관련 계약조항을 연결하고 있습니다');
      var options=Object.assign({},p.options,{baseClauses:baseClauses,judgmentHints:hints,historyRelated:related});
      var core=ReviewCore.run(clauses,p.docs,options,p.subDocs||[]);
      // 번호·인용·별첨 누락 자동 경고는 제품에서 제외한다. 구역과 원문 위치는 유지한다.
      var integrity={items:[],assessment:{status:'disabled',label:'자동점검 제외',detail:''},structure:DocumentStructure.inspect(p.text,p.extraction,p.boundaries||[])};
      progress(3,'과거자료의 원문·판정 연결을 정리하고 있습니다');
      var connected=JudgmentSources.compile(sources.packets||[],sources.corpus,knowledge),hintRows={},currentDocuments=p.safetyDocuments||[{name:'본문',text:p.text}];
      core.result.checkpoints.forEach(function(cp){hintRows[cp.id]=JudgmentHints.retrieve(cp,currentDocuments,hints);});
      self.postMessage({id:m.id,type:'result',result:{fingerprint:CR.engine_fingerprint,clauses:clauses,baseClauses:baseClauses,core:core,
        formal:Formal.checkFormal(p.text),integrity:integrity,references:{rows:hintRows,tag_rows:{},tag_status:'unqueried',stats:connected.stats}}});
    }catch(e){self.postMessage({id:m.id,type:'error',error:e.message||String(e)});}
  };
})();
