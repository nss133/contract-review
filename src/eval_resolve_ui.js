"use strict";
(function(){
  var bound="",busy=false;
  function e(id){return document.getElementById('er-'+id);}
  function current(){var t=EvalTrialUI.current();if(bound&&bound!==t.id)throw Error('현재 평가의 이견을 다시 불러오세요.');return t;}
  function guard(fn){return async function(){if(busy||EvalPreparationUI.isBusy()||EvalTrialUI.isBusy())return;busy=true;try{await fn();}catch(err){e('message').textContent='보류: '+err.message;}finally{busy=false;}};}
  function show(){var t=current(),id=e('question').value;
    e('reviews').textContent=id?t.reviews.map(function(r){var l=r.labels.find(function(x){return x.id===id;});return r.reviewer+' · '+({safe:'문제없음',issue:'문제 있음',unknown:'판단불가',not_applicable:'해당 없음'}[l.truth])+'\n'+l.evidence+'\n'+l.reason;}).join('\n\n'):'미해결 이견이 없습니다.';
    e('direct').innerHTML=t.snapshot.clauses.map(function(c){return '<option value="'+c.index+'">'+esc(c.document+' · '+c.heading+' '+String(c.body||'').slice(0,90))+'</option>';}).join('');
    e('truth').value='unknown';e('reason').value='';e('evidence').value='';e('confirm').checked=false;
  }
  e('refresh').addEventListener('click',guard(function(){bound='';var t=current();bound=t.id;var gs=EvalTrial.consensus(t);e('question').innerHTML=gs.filter(function(g){return !g.agreement;}).map(function(g){return '<option value="'+esc(g.id)+'">'+esc(g.question)+'</option>';}).join('');show();e('message').textContent='조정 저장 후 이전 채점은 과거 이력입니다. 매핑·다계약 비교를 다시 실행하세요.';}));
  e('question').addEventListener('change',guard(show));
  e('save').addEventListener('click',guard(async function(){var t=current(),old=JSON.parse(JSON.stringify(t.resolutions||{}));
    EvalTrial.resolve(t,{id:e('question').value,reviewer:e('reviewer').value,truth:e('truth').value,direct:Array.from(e('direct').selectedOptions).map(function(o){return Number(o.value);}),reason:e('reason').value,evidence:e('evidence').value,source_reviewed:e('confirm').checked});
    try{await EvalPreparationUI.save();}catch(err){t.resolutions=old;throw err;}
    e('message').textContent='조정 저장됨. 원래 두 검수 결과는 보존했습니다. 이전 채점·평가묶음은 재실행·재고정하세요.';e('question').innerHTML='';e('reviews').textContent='저장 완료. 다른 이견을 확인하려면 이견 보기를 다시 누르세요.';
  }));
})();
