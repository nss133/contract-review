/* No matcher, checklist, verdict, storage or source-rendering functions are replaced. */
(()=>{
 const byId=id=>document.getElementById(id);
 const moves=[];
 let modern=false;
 document.body.classList.add('ux-preview');
 const bar=document.createElement('aside');bar.id='ux-preview-bar';bar.innerHTML='<div><strong>기능 보존형 UI 시안</strong> · v1.90.4 실제 엔진·체크리스트 문구 사용</div><div class="ux-preview-actions"><button id="ux-example" type="button">합성 계약 채우기</button><button id="ux-toggle" type="button">기존 배치로 비교</button><details><summary>기능 위치 안내</summary><div class="ux-map"><p>기존 문구와 기능을 삭제하지 않고 표시 위치와 스타일만 조정했습니다.</p><ul><li>체크리스트 제목·질문·설명·판단 포인트: 기존 카드에 그대로 유지</li><li>체크리스트·평가·지식 데이터·검수: 상단 두 번째 줄</li><li>자동판정 재실행·중지·평가·백업: 조항별 검토의 ‘자동판정·평가 도구’</li><li>근거·연결 수정·의견·리포트·가져오기/내보내기: 원래 기능 유지</li></ul><p>실제 분석·저장이 동작하는 복사본입니다. 배포본은 변경하지 않았으며, 별도 시험 브라우저에서 예시 자료로 확인하세요.</p></div></details></div>';
 document.body.prepend(bar);
 const lib=document.createElement('nav');lib.className='ux-library-nav ux-new-only';lib.setAttribute('aria-label','자료 및 검토 관리');lib.innerHTML='<span>자료·검토 관리</span>';document.querySelector('.topbar').after(lib);
 const intro=document.createElement('div');intro.className='ux-intro ux-new-only';intro.innerHTML='<div class="ux-kicker">CONTRACT REVIEW</div><h2>약정을 읽고, 판단을 남깁니다.</h2><p>체크리스트의 질문·설명·판단 포인트와 모든 검토 기능은 기존 내용 그대로입니다.</p>';byId('analyze-result').prepend(intro);
 const tools=document.createElement('details');tools.id='ux-auto-tools';tools.className='ux-new-only';tools.innerHTML='<summary><strong>자동판정·평가 도구</strong><small>재실행 · 중지 · 보류 이유 · 평가자료 · 백업/복구</small></summary>';byId('standard-auto-panel').before(tools);
 function move(node,target,before){const anchor=document.createComment('ux-original-position');node.before(anchor);moves.push({node,anchor});target.insertBefore(node,before||null);}
 function setModern(value){
   if(value===modern)return;
   if(value){
     for(const tab of ['checklist','evaluation'])move(document.querySelector('.tab[data-tab="'+tab+'"]'),lib);
     move(document.querySelector('.nav-admin'),lib);
     move(byId('standard-auto-summary'),tools.parentNode,tools);
     move(byId('standard-auto-panel'),tools);
   }else{
     for(const {node,anchor} of moves.splice(0).reverse()){anchor.replaceWith(node);}
   }
   modern=value;document.body.classList.toggle('ux-modern',modern);byId('ux-toggle').textContent=modern?'기존 배치로 비교':'새 배치로 비교';byId('ux-toggle').setAttribute('aria-pressed',String(modern));
 }
 byId('ux-toggle').addEventListener('click',()=>setModern(!modern));
 byId('ux-example').addEventListener('click',()=>{
   if(byId('btn-analyze').disabled){alert('분석이 끝난 뒤 예시를 불러올 수 있습니다.');return;}
   if(byId('contract-text').value.trim()&&!confirm('입력란의 내용을 합성 예시 계약으로 바꿀까요? 기존 검토 저장자료를 삭제하지는 않습니다.'))return;
   byId('contract-text').value=[
    '시안 체험용 IT 유지보수 용역계약서 (합성 자료)',
    '위탁자 갑 주식회사와 수탁자 을 주식회사는 다음과 같이 계약한다.',
    '제1조(목적) 본 계약은 회사 전산시스템의 유지보수 업무 위탁에 필요한 사항을 정한다.',
    '제2조(업무범위) 수탁자는 시스템 점검, 장애 대응 및 유지보수 업무를 수행한다. 세부 범위는 별첨 과업지시서에 따른다.',
    '제3조(계약기간) 계약기간은 2026년 10월 1일부터 2027년 9월 30일까지로 한다.',
    '제4조(대금) 월 계약대금은 금 오백만원(5,000,000원)이며 부가가치세는 별도로 한다. 회사는 청구서를 받은 날부터 30일 이내 지급한다.',
    '제5조(손해배상) 당사자는 귀책사유로 상대방에게 발생한 손해를 배상한다. 다만 손해배상액은 최근 3개월간 지급한 계약대금을 한도로 한다.',
    '제6조(비밀유지) 비밀정보는 업무상 취득한 기술정보, 영업정보 및 고객정보를 포함한다. 당사자는 비밀정보를 제3자에게 공개하거나 업무 목적 외로 이용할 수 없다. 비밀유지 의무는 계약 종료 후 3년간 존속한다.',
    '제7조(해지) 상대방이 계약을 위반한 경우 서면으로 시정을 요구하고 14일 이내에 시정되지 않으면 계약을 해지할 수 있다. 수탁자는 30일 전 통지하여 본 계약을 해지할 수 있다.',
    '제8조(종료 후 조치) 계약 종료 시 수탁자는 회사의 자료를 반환하거나 폐기하고 업무 인계에 협조한다.',
    '제9조(개인정보 처리) 수탁자는 위탁받은 개인정보를 위탁 목적 외로 이용하거나 제3자에게 제공할 수 없다. 회사의 사전 서면 동의 없이 재위탁할 수 없다. 수탁자는 개인정보의 안전성 확보조치를 이행하며 회사의 관리·감독 및 점검에 협조한다.',
    '제10조(권리의 양도) 당사자는 상대방의 사전 서면 동의 없이 본 계약의 권리와 의무를 제3자에게 양도할 수 없다.',
    '제11조(변경) 본 계약의 변경은 당사자 간 서면 합의에 의한다.',
    '제12조(관할) 본 계약에 관한 분쟁은 대한민국 법을 준거법으로 하며 서울중앙지방법원을 제1심 전속적 합의관할 법원으로 한다.'
   ].join('\n\n').replace(/(제\d+조\([^)]+\))\s+/g,'$1\n');
   byId('contract-text').dispatchEvent(new Event('input',{bubbles:true}));
   if(typeof refreshInputSetup==='function')refreshInputSetup();
   document.querySelector('.tab[data-tab="input"]').click();byId('contract-text').focus();
 });
 setModern(true);
})();
