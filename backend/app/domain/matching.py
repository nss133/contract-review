"""Native v1.90.8 matcher. Each run owns its configuration and similarity model."""
import json
from pathlib import Path
import re
import unicodedata
from app.domain import clause_role as role, sentence, similarity as sim, tags
from app.domain.similarity import units, ununits

DATA=json.loads((Path(__file__).parents[1]/'data/domain-rules.json').read_text(encoding='utf-8'))['matcher']
UNSET=object()


def _strip(text): return re.sub(r'「[^」]*」','',text or '')
def _all_text(clauses): return '\n'.join((c.get('heading') or '')+' '+(c.get('body') or '') for c in clauses)
def _slice(text,start,end=None): return ununits(units(text)[start:end])


class Matcher:
    def __init__(self, config=None):
        self.config={**DATA['config'],**(config or {})}
        self.sim=sim.Similarity()

    def normalize_stance(self,stance=None): return stance if stance in ('party','beneficiary') else 'party'
    def _stance_allows(self,scope,stance): return not scope or self.normalize_stance(stance) in scope
    def module_allowed_in_stance(self,module,stance=None,context=None):
        return self._stance_allows((module or {}).get('requires_stance'),stance) or any((context or {}).get(k) for k in (module or {}).get('stance_exempt_if') or [])
    def check_allowed_in_stance(self,check,stance=None): return self._stance_allows((check or {}).get('stance_scope'),stance)
    def fund_scope_allows(self,check,kind=None): return not (check or {}).get('fund_scope') or not kind or kind in check['fund_scope']
    def service_scope_allows(self,check,nature=None): return not (check or {}).get('service_scope') or not nature or nature in check['service_scope']
    def party_role_allows(self,check,roles=None): return not (check or {}).get('party_roles') or not roles or any(r in roles for r in check['party_roles'])
    def title_hits(self,title,signals): return [s for s in signals or [] if s in (title or '')] if title else []
    def doc_title_allows(self,check,title=None): return not (check or {}).get('requires_doc_title') or any(r in (title or '') for r in check['requires_doc_title'])
    def relationship_scope_allows(self,check,relationship=None):
        kind=relationship if isinstance(relationship,str) else (relationship or {}).get('kind')
        return not (check or {}).get('relationship_scope') or (kind or 'unknown') in check['relationship_scope']

    def detect_fund_kind(self,text):
        text=_strip(text)
        pv=sum(s in text for s in DATA['PRIVATE_FUND_SIGNALS']);pb=sum(s in text for s in DATA['PUBLIC_FUND_SIGNALS'])
        return 'private' if pv>pb else 'public' if pb>pv else ''

    def detect_service_nature(self,text):
        text=_strip(text)
        completion=[s for s in DATA['COMPLETION_SIGNALS'] if s in text];mandate=[s for s in DATA['MANDATE_SIGNALS'] if s in text]
        if len(completion)>=2 and len(completion)>len(mandate): return {'nature':'completion','hits':completion}
        if len(mandate)>=2 and len(mandate)>len(completion): return {'nature':'mandate','hits':mandate}
        return {'nature':'','hits':[]}

    def detect_stance(self,text):
        text=_strip(text)
        b=[s for s in DATA['BENEFICIARY_SIGNALS'] if s in text];p=[s for s in DATA['PARTY_SIGNALS'] if s in text]
        if len(b)>=3 and len(b)>len(p): return {'stance':'beneficiary','hits':b,'confident':True}
        return {'stance':'party','hits':p,'confident':not b}

    def detect_type(self,text,types,doc_title=None,file_name=None):
        text=text or '';head=_slice(text,0,self.config['DETECT_HEAD_LEN']);title=doc_title or ''
        fname=re.sub(r'\.[A-Za-z0-9]+$','',unicodedata.normalize('NFC',file_name or ''))
        def best(hay,words): return max((w for w in words if hay and w in hay),key=lambda w:len(units(w)),default=None)
        def spec(word): return min(len(units(word))/2,self.config['DETECT_SPEC_CAP'])
        scored=[]
        for ty in types:
            words=ty['meta'].get('detect_keywords') or [];score=0;hits=[];title_hit=False
            title_kw=best(title,words)
            if title_kw: score+=self.config['DETECT_DOCTITLE_W']*spec(title_kw);title_hit=True;hits.append(title_kw)
            file_kw=best(fname,words)
            if file_kw and file_kw!=title_kw:
                score+=self.config['DETECT_FILENAME_W']*spec(file_kw);title_hit=True
                if file_kw not in hits: hits.append(file_kw)
            for word in words:
                if not word: continue
                title_n=title.count(word);head_n=max(head.count(word)-title_n,0)
                body_n=min(text.count(word)-head_n-title_n,self.config['DETECT_BODY_CAP'])
                s=head_n*self.config['DETECT_TITLE_W']+max(body_n,0)
                if s>0:
                    score+=s
                    if word not in hits:hits.append(word)
            scored.append({'typeId':ty['meta']['type_id'],'score':score,'hits':hits,'titleHit':title_hit})
        by_id={r['typeId']:r for r in scored}
        for ty in types:
            meta=ty['meta'];signals=meta.get('nature_signals');sup=meta.get('suppresses')
            if not signals or not sup or any(w in text or w in title or w in fname for w in meta.get('suppress_exempt_signals') or []):continue
            if sum(w in text for w in signals)>=2:
                for identifier in sup:
                    if identifier in by_id and (not by_id[identifier]['titleHit'] or meta.get('suppress_title_hits')):
                        by_id[identifier].update(score=0,suppressed=True)
        return sorted(scored,key=lambda r:-r['score'])

    def pick_type(self,ranked): return ranked[0]['typeId'] if ranked and ranked[0]['score']>=self.config['DETECT_MIN_SCORE'] else None

    def detect_party_roles(self,text):
        text=units(text or '');out=[]
        for name in DATA['OUR_NAMES']:
            start=0
            while True:
                at=text.find(name,start)
                if at<0:break
                start=at+len(name);left=text.rfind('\n',0,at+1)+1;right=text.find('\n',at)
                if right<0:right=len(text)
                found=[r for r in DATA['ROLE_TERMS'] if r in text[left:right]]
                if not found:found=[r for r in DATA['ROLE_TERMS'] if r in text[max(0,at-60):at+len(name)+60]]
                for r in found:
                    if r not in out:out.append(r)
        return out

    def detect_party_context(self,text):
        text=units(unicodedata.normalize('NFC',text or ''));ours=[]
        def add(alias):
            if alias and alias not in ours:ours.append(alias)
        names=sorted(DATA['OUR_NAMES'],key=lambda n:-len(n))
        for m in re.finditer('|'.join(map(re.escape,names)),text):
            before=text[max(0,m.start()-100):m.start()];after=text[m.end():]
            before=re.sub(r'(?:주식회사|㈜|\(\s*주\s*\))\s*$','',before)
            after=re.sub(r'^[ \t]*(?:주식회사|㈜|\([ \t]*주[ \t]*\))','',after)
            postfix=re.search(r'''^\s*(?:[（(]\s*)?이하\s*["'“”‘’「」]?(갑|을|병)(?=["'“”‘’「」\s)）]|이라|으로|로)''',after) or re.search(r'''^\s*[（(]\s*["'“”‘’「」]?(갑|을|병)["'“”‘’「」]?\s*[)）]''',after)
            if postfix:add(postfix[1])
            prefix=re.search(r'''(?:^|[\s,;；|/([（])["'“”‘’「」]?(갑|을|병)["'“”‘’「」]?\s*(?:\([^()\n]{1,12}\)\s*)?[:：]\s*$''',before)
            definition=re.search(r'''(?:^|[\s,;；|/([（])["'“”‘’「」]?(갑|을|병)["'“”‘’「」]?\s*(?:은|는|이란|이라\s*함은)\s*$''',before)
            if prefix and re.search(r'^(?:$|\s|[,.，;；|/()（）]|이고|이며|이다)',after):add(prefix[1])
            elif definition and re.search(r'^\s*(?:(?:을|를)\s*(?:말한다|의미한다)|(?:주식회사)?(?:이다|이고|이며)|[,.，;；|/]|$)',after):add(definition[1])
        counterparts=[a for a in ['갑','을','병'] if a not in ours and re.search(r'''["'“”‘’]?'''+a+r'''["'“”‘’]?\s*(?:[:：]|은|는|이|가|에게|의)''',text)]
        if not counterparts and len(ours)==1 and ours[0] in ('갑','을'):counterparts=['을' if ours[0]=='갑' else '갑']
        roles=self.detect_party_roles(text)
        return {'ourAliases':ours,'counterpartyAliases':counterparts,'roles':roles,'confidence':'explicit_alias' if ours else 'role_only' if roles else 'unknown'}

    def evaluate_perspective(self,check,clause,party_context=None):
        if not check or check.get('perspective_rule')!='confidentiality_duration' or not clause:return None
        text=(clause.get('heading') or '')+' '+(clause.get('body') or '')
        sentences=[s for s in re.split(r'(?<=[.!?。])\s+|\n+',text) if re.search(r'비밀|기밀|비공개|confidential',s,re.I) and re.search(r'종료|해지|만료|존속|유효|기간|무기한|영구',s)]
        result={'rule':check['perspective_rule'],'bearer':'unknown','duration':'unknown','favorable':False,'auto_pass':False}
        if not sentences:return {**result,'reason':'비밀유지 존속기간 문장의 의무주체를 확인할 수 없음'}
        ctx=party_context or {};ours=theirs=mutual=indefinite=fixed=False
        def alias_subject(s,aliases):return any(re.search(r'''(?:^|[^가-힣])["'“”‘’]?'''+re.escape(a)+r'''["'“”‘’]?(?:은|는|이|가|에게|의|\s)''',s) for a in aliases or [])
        for s in sentences:
            ours=ours or alias_subject(s,ctx.get('ourAliases'));theirs=theirs or alias_subject(s,ctx.get('counterpartyAliases'))
            mutual=mutual or bool(re.search(r'각\s*당사자|당사자들|쌍방|상호|갑\s*(?:과|및)\s*을|갑·을',s))
            fixed=fixed or bool(re.search(r'[0-9]+(?:\.[0-9]+)?\s*(?:년|개월|월|일)',s))
            indefinite=indefinite or bool(re.search(r'무기한|영구|기간의\s*정함이\s*없|계약\s*(?:종료|해지|만료)\s*후에도\s*(?:계속|영구|존속)|계속하여\s*존속',s))
        result['bearer']='mutual' if mutual or (ours and theirs) else 'company' if ours else 'counterparty' if theirs else 'unknown'
        result['duration']='fixed' if fixed else 'indefinite' if indefinite else 'unknown'
        passed=result['bearer']=='counterparty' and result['duration']=='indefinite'
        return {**result,'favorable':passed,'auto_pass':passed,'reason':'상대방만 비밀유지의무를 부담하고 종료 후에도 기간 제한 없이 존속하여 당사에 유리함' if passed else '비밀유지 존속기간의 의무주체·유불리를 사람 확인 대상으로 유지함'}

    def has_affiliate_party(self,text):
        text=units(text or '');zones=[text[:600],text[max(0,len(text)-600):]]
        pattern=r'^\s*(?:'+'|'.join(DATA['ROLE_TERMS'])+r')\s*[:：]'
        zones.extend(line for line in re.split(r'\r?\n',text) if re.search(pattern,line))
        zone='\n'.join(zones)
        for name in DATA['OUR_NAMES']:zone=zone.replace(name,'')
        return bool(re.search(r'미래에셋[가-힣A-Za-z]*(자산운용|증권|생명|화재|캐피탈|벤처투자|컨설팅|파트너스|자산관리|저축은행|금융서비스|글로벌|투자운용)',zone))

    def suggest_modules(self,text,modules,opts=None):
        opts=opts if isinstance(opts,dict) else {'stance':opts};stance=opts.get('stance');title=opts.get('docTitle') or ''
        scopes=opts.get('scopeAssessments') or {};ctx=opts.get('stanceCtx') or {'affiliate_party':self.has_affiliate_party(text)}
        text=_strip(text);on=[];ask=[]
        for module in modules:
            if module.get('always_on') or not self.module_allowed_in_stance(module,stance,ctx):continue
            if module.get('scope_rule'):
                scope=scopes.get(module['scope_rule'])
                if not scope:
                    if module.get('screening_question'):ask.append(module['id'])
                elif scope['status']=='applicable':on.append(module['id'])
                elif scope['status']=='needs_confirmation':ask.append(module['id'])
                continue
            counts=[text.count(w) for w in module.get('suggest_keywords') or [] if w];distinct=sum(n>0 for n in counts);occ=sum(counts)
            if module.get('stance_exempt_if') and not self._stance_allows(module.get('requires_stance'),stance) and any(ctx.get(k) for k in module['stance_exempt_if']):on.append(module['id']);continue
            if module.get('title_signals'):
                if self.title_hits(title,module['title_signals']):on.append(module['id']);continue
                if module.get('title_required'):
                    if occ>=1 and module.get('screening_question'):ask.append(module['id'])
                    continue
            if module.get('activation')=='strong':
                if distinct>=2:on.append(module['id'])
            elif module.get('activation')=='confirm':
                if distinct>=2 or occ>=3:on.append(module['id'])
                elif occ>=1:ask.append(module['id'])
            elif distinct>=1:on.append(module['id'])
        return {'on':on,'ask':ask}

    def active_checkpoints(self,doc,active_modules,stance=None,fund_kind=None):
        return [cp for cp in doc['checkpoints'] if cp.get('review_scope')!='execution_only' and cp.get('surface_policy') not in ('aggregate_only','anomaly_only') and self.check_allowed_in_stance(cp,stance) and self.fund_scope_allows(cp,fund_kind) and (not cp.get('module') or cp['module'] in active_modules)]

    def norm_matches(self,clause_norm,check_norm=None):return bool(clause_norm and DATA['NORM_MAP'].get(check_norm,{}).get(clause_norm))

    def check_text(self,check):
        parts=[check.get('check') or '']
        for source in check.get('sources') or []:
            if source.get('quote'):parts.append(source['quote'])
            title=role.parse_title(source.get('article') or '')
            if title:parts.append(title)
            elif source.get('clause'):parts.append(source['clause'])
        words=(check.get('triggers') or {}).get('keywords') or []
        if words:parts.append(' '.join(words))
        return self.sim.preprocess(' '.join(parts))

    def clause_query(self,clause):
        title=role.parse_title(clause.get('heading') or '')
        return self.sim.preprocess((title+' ')*self.config['TITLE_K']+(clause.get('heading') or '')+' '+(clause.get('body') or ''))

    def build_model(self,docs,active_modules,stance=None,fund_kind=None):
        checks=[{'cp':cp,'text':self.check_text(cp),'doc':doc} for doc in docs for cp in self.active_checkpoints(doc,active_modules,stance,fund_kind)]
        return {'idf':sim.build_idf([c['text'] for c in checks]),'checks':checks}

    def citation_match(self,clause_text,check):
        query=re.sub(r'\s+','',clause_text or '')
        for source in check.get('sources') or []:
            match=re.search(r'제\s*([0-9]+)\s*조(?:의\s*([0-9]+))?',source.get('article') or '')
            if not match:continue
            pattern='제'+match[1]+'조'+('의'+match[2] if match[2] else '')
            if pattern not in query:continue
            core=re.sub(r'\s+','',source.get('law') or '')
            core=re.sub(r'(등에관한규정|에관한규정|등에관한법률|에관한법률|시행세칙|시행규칙|시행령|감독규정|규정|법률|법)$','',core)
            if len(core)>=2 and (core in query or core[:4] in query):return source
        return None

    def citation_hit(self,clause_text,check):return self.citation_match(clause_text,check) is not None
    def title_bonus(self,clause,check_text):return min(sum(word in sim.keywords(check_text) for word in sim.keywords(role.parse_title(clause.get('heading'))))*2,self.config['TITLE_BONUS_MAX'])

    def overlap_features(self,clause,check):
        ck=sim.keywords(self.check_text(check));body=sim.keywords(self.sim.preprocess(clause.get('body') or ''));title=sim.keywords(self.sim.preprocess(role.parse_title(clause.get('heading'))))
        uniq=sum(k in ck for k in set(body)|set(title));title_hit=sum(k in ck for k in title)
        return {'uniq':uniq,'titleStrong':bool(title and title_hit>=1 and title_hit/len(title)>=self.config['TITLE_STRONG_RATIO'])}

    def subject_bonus(self,clause,check):
        wanted=(check or {}).get('subject_roles');subjects=role.clause_subjects(clause.get('body'))
        if not wanted or not subjects:return 0
        return self.config['SUBJECT_BONUS'] if any(a in b or b in a for a in subjects for b in wanted) else -self.config['SUBJECT_PENALTY']

    def tag_match_trace(self,clause,check):return None if self.config['TAG_MATCH_MODE']=='off' else tags.match_clause(check,clause)
    def tag_score_adjustment(self,trace):
        if not trace or self.config['TAG_MATCH_MODE']!='assist':return 0
        penalty=self.config['TAG_PENALTY_CAP']
        if trace.get('conflicts'):return -min(penalty,abs(trace.get('score') or 0) or penalty)
        if trace.get('missing'):return 0
        return max(-penalty,min(self.config['TAG_BONUS_CAP'],trace.get('score') or 0))

    def passes_overlap_gate(self,clause,check,citation=False):
        if citation:return True
        features=self.overlap_features(clause,check)
        return features['uniq']>=self.config['OVERLAP_MIN'] or features['titleStrong']

    def title_fit_ratio(self,clause,check,prepared=None):
        title=role.parse_title(clause.get('heading'))
        if not title:return 0
        ck=re.sub(r'\s+','',self.sim.preprocess(self.check_text(check)+' '+(check.get('check') or '')+' '+(check.get('label') or '')))
        parts=[p for p in re.split(r'[\s·ㆍ,()（）]+',self.sim.preprocess(title)) if len(units(p))>=2]
        total=hit=0
        for part in parts:
            core=re.sub(r'(의|을|를|이|가|은|는|에|과|와|및|등)$','',part)
            if len(units(core))<2:core=part
            length=len(units(core));total+=length
            if core in ck:hit+=length
            elif length>=6 and _slice(core,0,4) in ck:hit+=length*0.5
        return hit/total if total else 0

    def compute_clause_owners(self,clauses,checks,prepared=None):
        owners={}
        for clause in clauses or []:
            best=None;ratio=0;tie=False
            for cp in checks:
                r=self.title_fit_ratio(clause,cp)
                if r<self.config['TITLE_STRONG_RATIO']:continue
                if r>ratio:ratio=r;best=cp['id'];tie=False
                elif r==ratio and best is not None and cp['id']!=best:tie=True
            if best and not tie:owners[str(clause['index'])]=best
        return owners

    def score_clause_check(self,clause,entry,model,prepared=None):
        # Cache only within one immutable matching run; never share user text between runs.
        def vector(key,text):
            if prepared is None:return sim.tfidf_vec(text,model['idf'])
            if key not in prepared:prepared[key]=sim.tfidf_vec(text,model['idf'])
            return prepared[key]
        query=self.clause_query(clause)
        tfidf=sim.cosine(vector(('text',query),query),vector(('text',entry['text']),entry['text']))*100
        jaccard=sim.jaccard(query,entry['text'])*100
        short=len(units(clause.get('body') or ''))<self.config['SHORT_LEN']
        tw=self.config['TW_SHORT' if short else 'TW'];jw=self.config['JW_SHORT' if short else 'JW']
        nmatch=self.norm_matches(role.norm_type(clause.get('body')),entry['cp'].get('norm_type'))
        tbonus=self.title_bonus(clause,entry['text']);citation=self.citation_hit((clause.get('heading') or '')+' '+(clause.get('body') or ''),entry['cp'])
        fit=self.title_fit_ratio(clause,entry['cp']);fit_bonus=fit*self.config['CLAUSE_TITLE_BONUS_MAX'] if fit>=self.config['TITLE_STRONG_RATIO'] else 0
        tag_trace=self.tag_match_trace(clause,entry['cp']);tag_adjustment=self.tag_score_adjustment(tag_trace)
        raw=tw*tfidf+jw*jaccard+(self.config['NORM_BONUS'] if nmatch else 0)+tbonus+fit_bonus+self.subject_bonus(clause,entry['cp'])+tag_adjustment
        return {'score':max(0,min(100,raw)),'tfidf':tfidf,'jaccard':jaccard,'normMatch':nmatch,'titleBonus':tbonus,'citation':citation,
                'signals':int(tfidf>0)+int(jaccard>0),'tagTrace':tag_trace,'tagAdjustment':tag_adjustment}

    def decisive_hit(self,clause,check):
        if not clause:return None
        text=(clause.get('heading') or '')+' '+(clause.get('body') or '')
        return next((p for p in (check or {}).get('decisive_patterns') or [] if p and p in text),None)
    def auto_clear_eval(self,clause,check):
        if not clause or not (check or {}).get('auto_clear'):return None
        return sentence.evaluate((clause.get('heading') or '')+'\n'+(clause.get('body') or ''),check['auto_clear'])
    def evidence_requirements_met(self,clause,check):
        groups=(check or {}).get('evidence_required_groups');clause=clause or {};text=(clause.get('heading') or '')+' '+(clause.get('body') or '')
        return not groups or all(any(word and word in text for word in group or []) for group in groups)
    def decide_tier(self,ranked,check):
        if not ranked or ranked[0]['s']['score']<self.config['REVIEW_FLOOR']:return 'none'
        best=ranked[0];clause=best['clause'];score=best['s']['score']
        if (self.auto_clear_eval(clause,check) or {}).get('ok'):return 'confirmed'
        cited=best['s'].get('citation') is True
        if role.clause_role(clause.get('heading'),clause.get('body'))['weak'] and not cited:return 'review'
        if cited or score>=self.config['ABS_SCORE']:return 'confirmed'
        if len(ranked)>=2 and score-ranked[1]['s']['score']>=self.config['MARGIN_HIGH'] and score>=self.config['REVIEW_FLOOR']:return 'confirmed'
        return 'confirmed' if self.decisive_hit(clause,check) else 'review'

    def effective_contract_requirement(self,check):
        if not check:return 'unclassified'
        if check.get('contract_requirement') in ('express','derived','recommended','none'):return check['contract_requirement']
        by_channel={'contract':'express','cooperation_control':'derived','contract_or_internal_control':'derived','internal_control':'none','monitoring_evidence':'none','external_evidence':'none','statutory_duty':'none','standard_subdoc':'none'}
        return by_channel.get(check.get('implementation_channel')) or ('recommended' if check.get('basis')=='practice' else 'unclassified')
    def alarm_gate(self,check):return self.effective_contract_requirement(check) not in ('none','recommended') and (check or {}).get('severity') in self.config['ALARM_SEVERITIES']
    def precondition_met(self,check,text):
        groups=(check or {}).get('absence_precondition_groups');text=text or ''
        if groups:return all(any(word and word in text for word in group or []) for group in groups)
        pre=(check or {}).get('absence_precondition');return not pre or any(word in text for word in pre)
    def coverage_of(self,tier,check,text=UNSET,doc_title=UNSET):
        if doc_title is not UNSET and not self.doc_title_allows(check,doc_title):return 'quiet'
        if tier=='confirmed':return 'addressed'
        if tier=='review':return 'verify'
        if (check or {}).get('absence_check') and self.alarm_gate(check) and (text is UNSET or self.precondition_met(check,text)):return 'consider'
        return 'quiet'

    def _reasons(self,tier,ranked,check):
        if not ranked or tier=='none':return []
        best=ranked[0];clause=best['clause'];score=best['s']
        if score.get('citation'):
            source=self.citation_match((clause.get('heading') or '')+' '+(clause.get('body') or ''),check)
            match=re.search(r'제\s*[0-9]+\s*조(?:의\s*[0-9]+)?',(source or {}).get('article') or '')
            article=re.sub(r'\s+','',match[0]) if match else ''
            tag=' ('+' '.join(filter(None,[source.get('law'),article]))+')' if source else ''
            return ['명시 인용 일치'+tag]
        if tier=='confirmed':
            ac=self.auto_clear_eval(clause,check)
            if ac and ac.get('ok'):
                sent=ac.get('sentence') or ''
                return ['요건 문장 확인 (“'+(_slice(sent,0,70)+'…' if len(units(sent))>70 else sent)+'”)']
            decisive=self.decisive_hit(clause,check)
            if decisive:return ['결정 문구 일치 (“'+decisive+'”)']
            if score.get('normMatch'):return ['본문 문구·규범 일치']
            words=[k for k in sim.keywords((clause.get('heading') or '')+' '+(clause.get('body') or '')) if k in sim.keywords(self.check_text(check))][:3]
            return ['본문 문구 일치'+(' (핵심어: '+', '.join(words)+')' if words else '')]
        return ['관련 조항으로 보임 — 목적·정의 조항이라 해당 여부 확인 필요' if role.clause_role(clause.get('heading'),clause.get('body'))['weak'] else '관련 조항으로 보임 — 이 항목에 해당하는 조항인지 확인 필요']

    def sub_doc_coverage(self,checks,sub_docs,model):
        out={};prepared={}
        for check in checks or []:
            entry={'cp':check,'text':self.check_text(check),'doc':None}
            for doc in sub_docs or []:
                scored=sorted([{'clause':c,'s':self.score_clause_check(c,entry,model,prepared)} for c in doc.get('clauses') or []],key=lambda r:-r['s']['score'])
                candidates=[r for r in scored if (r['s']['citation'] or self.evidence_requirements_met(r['clause'],check)) and r['s']['score']>=self.config['REVIEW_FLOOR']]
                if self.decide_tier(candidates,check) in ('confirmed','review') and candidates:
                    best=candidates[0]
                    if self.passes_overlap_gate(best['clause'],check,best['s']['citation']):
                        out[check['id']]={'docName':doc['name'],'score':best['s']['score'],'heading':best['clause'].get('heading') or '','quote':_slice(best['clause'].get('body') or '',0,1200)}
                        break
        return out

    def detect_subdoc_refs(self,full_text,definitions):
        out=[];text=units(full_text or '')
        for definition in definitions or []:
            for signal in definition.get('ref_signals') or []:
                at=text.find(units(signal))
                if at>=0:
                    quote=ununits(text[max(0,at-40):min(len(text),at+len(units(signal))+40)])
                    out.append({'id':definition['id'],'title':definition['title'],'signal':signal,'quote':re.sub(r'\s+',' ',quote).strip(),'covers':(definition.get('covers') or [])[:]})
                    break
        return out

    def analyze(self,clauses,docs,opts=None):
        from app.domain.history import clause_support
        o=opts if isinstance(opts,dict) else {'modules':opts or []}
        active=o.get('modules') or [];stance=self.normalize_stance(o.get('stance'));base=o.get('baseClauses') or [];title=o.get('docTitle',UNSET)
        fund=o.get('fundKind',self.detect_fund_kind(_all_text(clauses)))
        model=self.build_model(docs,active,stance,fund);prepared={}
        service={'nature':o['serviceNature'],'hits':[]} if 'serviceNature' in o else self.detect_service_nature(_all_text(clauses))
        results=[];matches=[];missing=[];full=_all_text(clauses+base)
        relationship=tags.detect_data_relationship(clauses+base,'' if title is UNSET else title)
        party=o.get('partyContext') or self.detect_party_context(full)
        owners=self.compute_clause_owners(clauses,[e['cp'] for e in model['checks']])
        for entry in model['checks']:
            cp=entry['cp']
            if not self.relationship_scope_allows(cp,relationship):
                results.append({'cpId':cp['id'],'tier':'none','coverage':'quiet','best':None,'ranked':[],'inBase':None,'roleGated':False,'relationshipGated':True,'autoClear':None,'perspective':None,'serviceGated':False})
                continue
            scored=sorted([{'clause':c,'s':self.score_clause_check(c,entry,model,prepared)} for c in clauses],key=lambda r:-r['s']['score'])
            eligible=[r for r in scored if r['s']['citation'] or self.evidence_requirements_met(r['clause'],cp)]
            for r in eligible:
                r['s']['baseScore']=r['s']['score']
                r['s']['historySupport']=clause_support(o.get('historyRelated') or [],cp,r['clause']) if r['s']['score']>=self.config['REVIEW_FLOOR'] else None
                if r['s']['historySupport']:r['s']['score']+=r['s']['historySupport']['bonus']
            eligible.sort(key=lambda r:-r['s']['score'])
            candidates=[r for r in eligible if r['s']['score']>=self.config['REVIEW_FLOOR']]
            tier=self.decide_tier(candidates,cp);coverage=self.coverage_of(tier,cp,full,title);top=eligible[0] if eligible else None
            role_gated=False
            if 'partyRoles' in o and not self.party_role_allows(cp,o['partyRoles']):coverage='quiet';role_gated=True
            gate=ac=None
            if coverage in ('addressed','verify') and candidates:
                best=candidates[0]['clause'];features=self.overlap_features(best,cp);cited=candidates[0]['s']['citation']
                ac=self.auto_clear_eval(best,cp);ac_ok=bool(ac and ac.get('ok'))
                passed=self.passes_overlap_gate(best,cp,cited) or ac_ok;gate={**features,'passed':passed}
                if not passed:coverage='quiet'
                if coverage!='quiet' and not cited and not features['titleStrong'] and not ac_ok:
                    owner=owners.get(str(best['index']))
                    if owner and owner!=cp['id'] and self.title_fit_ratio(best,cp)==0 and features['uniq']<self.config['OWNED_CLAUSE_MIN_OVERLAP']:
                        coverage='quiet';gate['ownedBy']=owner
                if coverage!='quiet' and role.clause_role(best.get('heading'),best.get('body'))['weak'] and cp.get('implementation_channel')!='external_evidence' and not cited and not features['titleStrong'] and not ac_ok:
                    coverage='quiet';gate['weakRole']=True
            in_base=None
            if (coverage=='consider' or (coverage=='quiet' and cp.get('absence_check') and self.effective_contract_requirement(cp)=='recommended')) and base:
                scored_base=sorted([{'clause':c,'s':self.score_clause_check(c,entry,model,prepared)} for c in base],key=lambda r:-r['s']['score'])
                cand=[r for r in scored_base if (r['s']['citation'] or self.evidence_requirements_met(r['clause'],cp)) and r['s']['score']>=self.config['REVIEW_FLOOR']]
                if self.decide_tier(cand,cp)!='none':
                    coverage='base_covered';in_base={'clauseIndex':cand[0]['clause']['index'],'score':cand[0]['s']['score']}
            service_gated=False
            if coverage=='consider' and not self.service_scope_allows(cp,service['nature']):coverage='quiet';service_gated=True
            perspective=self.evaluate_perspective(cp,candidates[0]['clause'],party) if coverage in ('addressed','verify') and candidates else None
            reasons=self._reasons(tier,candidates or eligible,cp)
            ranked=[{'clauseIndex':r['clause']['index'],'score':r['s']['score'],'tagScore':r['s']['tagTrace']['score'] if r['s']['tagTrace'] else None,'tagAdjustment':r['s']['tagAdjustment'] or 0} for r in eligible[:3]]
            best_value={'clauseIndex':top['clause']['index'],'score':top['s']['score'],'reasons':reasons,'gate':gate,
                        'baseScore':top['s']['baseScore'],'historySupport':top['s']['historySupport'],'tagTrace':top['s']['tagTrace'],'tagAdjustment':top['s']['tagAdjustment'] or 0} if top else None
            results.append({'cpId':cp['id'],'tier':tier,'coverage':coverage,'best':best_value,'ranked':ranked,'inBase':in_base,
                            'roleGated':role_gated,'relationshipGated':False,'autoClear':ac,'perspective':perspective,'serviceGated':service_gated})
            if coverage in ('addressed','verify') and top:
                hits={k:top['s'][k] for k in ['score','tfidf','jaccard','citation','normMatch','tagTrace']}
                hits.update(tier=tier,coverage=coverage,reasons=reasons,tagAdjustment=top['s']['tagAdjustment'] or 0)
                matches.append({'cpId':cp['id'],'clauseIndex':top['clause']['index'],'hits':hits})
            if coverage=='consider':missing.append(cp)
        return {'checkpoints':[e['cp'] for e in model['checks']],'results':results,'serviceNature':service,
                'dataRelationship':relationship,'matches':matches,'missing':missing}
