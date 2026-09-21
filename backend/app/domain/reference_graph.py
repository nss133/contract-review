"""Native resolution of the reference-link part of decision-evidence-v10.

Scopes, named attachments, explicit paragraph/list paths and ranges are resolved
against actual source rows. Ambiguous ranges retain their surrounding rows.
"""
import re
from app.domain import clause_semantics as Q, evidence as E, agreement_evidence as A, structure as S


def body(text):
    h=E.heading(text)
    return re.sub(r'^[①-⑳]\s*','',(text[len(h['prefix']):] if h else text).strip()).strip()


class Ref:
    def __init__(self,match=None,groups=None,at=0):
        self.groups=[match[0]]+list(match.groups()) if match else groups
        self.at=match.start() if match else at
        self.end=self.at+len(self.groups[0])
    def __getitem__(self,i):return self.groups[i] if i<len(self.groups) else None


def refs(pattern,text,flags=0):return [Ref(m) for m in re.finditer(pattern,text,flags)]


def has(pattern,text):return bool(re.search(pattern,text))


def reference_links(documents,terms):
    if not A.scan_units(terms,documents):return []
    all_rows=[]
    for row in Q.contexts(documents)['rows']:
        region=row['region'];name=documents[row['document_index']].get('name') or ''
        named=S.boundary(re.sub(r'\.(?:pdf|hwpx?|docx?|txt)$','',name,flags=re.I)) if region['kind']=='main' else None
        all_rows.append(dict(row,body=body(row['text']),annex_token=region.get('token') or (named or {}).get('token') or '',document_title=A.is_document_title(row,documents)))
    locations={};sections={};articles={};section_articles={};domains={};annexes={};titles={};list_groups={}
    def section_key(r):return (r['document_index'],r['section_index'])
    def pos(r):return locations[(r['document_index'],r['sentence_index'])]
    def add_title(title,domain):
        key=S.title_key(title)
        if key:titles.setdefault(key,set()).add(domain)
    for i,s in enumerate(all_rows):
        locations[(s['document_index'],s['sentence_index'])]=i;k=section_key(s)
        domains.setdefault(s['domain'],[]).append(s)
        if s['annex_token']:annexes.setdefault(s['annex_token'],set()).add(s['domain'])
        if s['region']['kind']!='main':add_title(s['region']['label'],s['domain'])
        else:
            add_title(documents[s['document_index']].get('name'),s['domain'])
            if s['document_title']:add_title(s['text'],s['domain'])
        sections.setdefault(k,[]).append(s)
        h=E.heading(s['text']);m=re.search(r'^\s*제\s*(\d+)\s*조(?:의\s*(\d+))?',h['prefix']) if h else None
        if m:
            articles.setdefault(s['domain']+':'+m[1]+('의'+m[2] if m[2] else ''),set()).add(k)
            section_articles[k]={'number':int(m[1]),'sub':m[2]}
        if s.get('list_id'):list_groups.setdefault(s['list_id'],[]).append(s)
    title_patterns=[(key,re.compile(r'(?<![가-힣A-Za-z0-9])'+r'\s*'.join(re.escape(ch) for ch in key)+r'(?=[」”"』]?\s*(?:의\s*)?(?:제\s*\d+\s*조|에\s*(?:따르|따른|정한)|[을를]\s*준용))')) for key in titles]
    main_domain=next((s['domain'] for s in all_rows if s['document_index']==0 and not s['annex_token']),None)
    def targets(s,number,domain=None):
        keys=articles.get((domain or s['domain'])+':'+str(number),set())
        return [r for r in sections[next(iter(keys))] if not r['boundary']] if len(keys)==1 else []
    def paragraph_group(group,n):
        starts=[r for r in group if r['paragraph_start'] and r['paragraph_number']==n]
        return [r for r in group if r['paragraph_anchor']==starts[0]['paragraph_anchor']] if len(starts)==1 else []
    def unique_domain(index,key):
        choices=index.get(key,set());return next(iter(choices)) if len(choices)==1 else None
    def resolve(s):
        text=s['body'];linked=[];missing=False
        if s['boundary']:return linked,missing
        article_refs=refs(r'제\s*(\d+)\s*조(?:의\s*(\d+))?',text)
        annex_refs=refs(r'(별첨|별표|별지|붙임|부록|첨부)\s*(?:제\s*)?([0-9]+(?:[-.][0-9]+)*|[A-Z])\s*(?:호)?',text)
        named_refs=[]
        for pattern in [r'[「“"『]([^」”"』\n]{2,100}(?:계약서|약정서|합의서|명세서|계획서))[」”"』]',r'(?:별첨|붙임|첨부|부속)\s*(?![0-9])([가-힣A-Za-z][가-힣A-Za-z0-9 ·ㆍ&()_-]{0,85}?(?:계약서|약정서|합의서|명세서|계획서))']:
            for m in re.finditer(pattern,text):named_refs.append({'at':m.start(),'end':m.end(),'key':S.title_key(m[1])})
        def named_covers(start,end):return any(r['at']<=start and r['end']>=end for r in named_refs)
        for key,pattern in title_patterns:
            for m in pattern.finditer(text):
                if not named_covers(m.start(),m.end()):named_refs.append({'at':m.start(),'end':m.end(),'key':key})
        for m in re.finditer(r'(?:본|이)\s*(?:계약서|약정서)(?=\s*(?:의\s*)?제\s*\d+\s*조)',text):
            if not named_covers(m.start(),m.end()):named_refs.append({'at':m.start(),'end':m.end(),'key':'@self'})
        for m in re.finditer(r'[가-힣A-Za-z0-9]*(?:계약서|약정서|합의서|명세서|계획서)(?=[」”"』]?\s*(?:의\s*)?(?:제\s*\d+\s*조|에\s*(?:따르|따른|정한)|[을를]\s*준용))',text):
            if not named_covers(m.start(),m.end()):missing=True
        def named_domain(m):return s['domain'] if m['key']=='@self' else unique_domain(titles,m['key'])
        def annex_domain(m):return unique_domain(annexes,m[1]+m[2])
        def reference_domain(m):
            before=text[:m.at];xs=[a for a in annex_refs if a.at<m.at and has(r'^\s*(?:의\s*)?$',before[a.end:])]
            if xs:return annex_domain(xs[-1])
            ns=[r for r in named_refs if r['end']<=m.at and has(r'^[」”"』]?\s*(?:의\s*)?$',before[r['end']:])]
            if ns:return named_domain(ns[-1])
            if has(r'본문\s*$',before):return main_domain
            return s['domain']
        def external(m):return has(r'(?:법|법률|시행령|시행규칙|규정|고시|지침|약관|정관)[」”"』]?\s*$',text[:m.at])
        for m in annex_refs:
            if external(m):missing=True;continue
            domain=annex_domain(m);group=[r for r in domains.get(domain,[]) if not r['boundary']]
            if not any(r['body'] for r in group):missing=True;continue
            linked.extend(group)
        for m in named_refs:
            if m['key']=='@self':continue
            domain=named_domain(m);group=[r for r in domains.get(domain,[]) if not r['boundary']]
            if not any(r['body'] for r in group):missing=True;continue
            numbers=[a for a in annex_refs if a.at<m['at'] and has(r'^\s*$',text[a.end:m['at']])]
            if numbers and annex_domain(numbers[-1])!=domain:missing=True;continue
            linked.extend(group)
        if has('별첨|별표|별지|붙임|부록|부속',text) and not annex_refs and not named_refs:missing=True
        if has(r'(?:계약서|약정서|합의서|명세서|계획서)[」”"』]?\s*(?:의\s*)?(?:제\s*\d+\s*조|에\s*(?:따르|따른|정한)|[을를]\s*준용)',text) and not named_refs:missing=True
        paragraph_refs=refs(r'제\s*(\d+)\s*항',text)
        item_refs=[p for p in refs(r'제\s*(\d+)\s*호',text) if not any(a.at<=p.at and a.end>=p.end for a in annex_refs)]
        letter_refs=refs(r'(?:(?<![가-힣])|(?<=호)|(?<=내지)|(?<=부터))([가나다라마바사아자차카타파하])\s*목(?=\s|부터|내지|까지|[~∼～–—-]|[은는이가의을를에과와,.;。]|$)',text)
        sub_refs=refs(r'제\s*(\d+)\s*세목',text);item_targets={}
        def preceding(matches,p):
            found=[a for a in matches if a.end<=p.at and has(r'^\s*(?:의\s*)?$',text[a.end:p.at])]
            return found[-1] if found else None
        def article_group(ref):
            if ref is None:return sections.get(section_key(s),[])
            domain=reference_domain(ref);return targets(s,ref[1]+('의'+ref[2] if ref[2] else ''),domain) if domain else []
        def item_group(p):
            para=preceding(paragraph_refs,p);article=preceding(article_refs,para or p);group=article_group(article)
            if para:group=paragraph_group(group,int(para[1]))
            elif not article and s['paragraph_number']:group=paragraph_group(group,s['paragraph_number'])
            return group
        def external_path(p):
            item=preceding(item_refs,p);para=preceding(paragraph_refs,item or p);article=preceding(article_refs,para or item or p)
            return any(external(r) for r in [p,item,para,article] if r)
        tokens=[];ranges=[];covered=set();kinds=['조','항','호','목','세목']
        for rr,kind in zip([article_refs,paragraph_refs,item_refs,letter_refs,sub_refs],kinds):
            tokens.extend({'m':m,'kind':kind,'number':Q.LETTERS.index(m[1])+1 if kind=='목' else int(m[1])} for m in rr)
        tokens.sort(key=lambda t:t['m'].at)
        def rank(t):return kinds.index(t['kind'])
        def adjacent(a,b):return has(r'^\s*(?:의\s*)?$',text[a['m'].end:b['m'].at])
        def chain_ending(i):
            path=[tokens[i]]
            while i>0 and adjacent(tokens[i-1],tokens[i]) and rank(tokens[i-1])<rank(tokens[i]):i-=1;path.insert(0,tokens[i])
            return path
        for i,t in enumerate(tokens):
            if t['m'] in covered:continue
            op=re.match(r'^\s*(부터|내지|[~∼～–—-])',text[t['m'].end:])
            if not op:continue
            right=[];j=i+1
            if j<len(tokens):
                right.append(tokens[j])
                while j+1<len(tokens) and adjacent(tokens[j],tokens[j+1]) and rank(tokens[j])<rank(tokens[j+1]):j+=1;right.append(tokens[j])
            if len(right)>1:
                left=chain_ending(i);end=right[-1];between=text[t['m'].end:right[0]['m'].at];until=re.match(r'^\s*까지',text[end['m'].end:]);finish=end['m'].end+(len(until[0]) if until else 0);raw_right=right[:]
                if left[0]['kind']!='조':
                    current=section_articles.get(section_key(s))
                    if current:left.insert(0,{'m':Ref(groups=['',str(current['number']),current['sub']],at=left[0]['m'].at),'kind':'조','number':current['number']})
                right=[x for x in left if rank(x)<rank(right[0])]+right
                valid=left[0]['kind']=='조' and right[0]['kind']=='조' and list(map(rank,left))==list(map(rank,right)) and has(r'^\s*(?:부터|내지|[~∼～])\s*$',between) and (op[1]!='부터' or bool(until)) and not has(r'^\s*(?:부터|내지|[~∼～–—-]|제\s*\d+\s*(?:조|항|호|세목))',text[finish:])
                ranges.append({'start':t,'end':end,'left':left,'right':right,'valid':valid,'finish':finish});covered.update(x['m'] for x in left+raw_right);continue
            end=tokens[i+1] if i+1<len(tokens) else None;between=text[t['m'].end:end['m'].at] if end else '';until=re.match(r'^\s*까지',text[end['m'].end:]) if end else None
            valid=bool(end and t['kind']==end['kind'] and has(r'^\s*(?:부터|내지|[~∼～])\s*$',between) and (op[1]!='부터' or until) and t['m'] not in covered and end['m'] not in covered)
            finish=end['m'].end+(len(until[0]) if until else 0) if end else t['m'].end+len(op[0])
            if has(r'^\s*(?:의\s*)?(?:제\s*\d+\s*[조항호]|[가나다라마바사아자차카타파하]\s*목|부터|내지|[~∼～–—-])',text[finish:]):valid=False
            ranges.append({'start':t,'end':end,'valid':valid,'finish':finish});covered.add(t['m'])
            if end:covered.add(end['m'])
        for m in article_refs:
            if m in covered:continue
            if external(m):missing=True;continue
            domain=reference_domain(m);to=targets(s,m[1]+('의'+m[2] if m[2] else ''),domain) if domain else []
            if not to:missing=True
            linked.extend(to)
        for p in paragraph_refs:
            if p in covered:continue
            before=[a for a in article_refs if a.at<p.at];last=before[-1] if before else None
            if last and external(last):missing=True;continue
            group=article_group(last);matches=paragraph_group(group,int(p[1]))
            if not matches or not int(p[1]):missing=True
            else:linked.extend(matches)
        for p in item_refs:
            if p in covered:continue
            para=preceding(paragraph_refs,p);last=preceding(article_refs,para or p)
            if external(p) or last and external(last):missing=True;continue
            group=article_group(last)
            if para:group=paragraph_group(group,int(para[1]))
            elif not last and s['paragraph_number']:group=paragraph_group(group,s['paragraph_number'])
            matches=[r for r in group if r.get('list_valid') and r.get('list_number')==int(p[1])]
            if len(matches)!=1:missing=True
            else:linked.append(matches[0]);item_targets[p]=matches[0]
        for p in letter_refs+sub_refs:
            if p in covered:continue
            sub=p in sub_refs;letter=preceding(letter_refs,p) if sub else p;item=preceding(item_refs,letter) if letter else None;target=item_targets.get(item)
            matches=[r for r in list_groups.get(target.get('list_id'),[]) if r.get('list_valid') and len(r.get('list_path',[]))==(3 if sub else 2) and r['list_path'][0]==target.get('list_number') and r['list_path'][1]==letter[1] and (not sub or r.get('list_subnumber')==int(p[1]))] if target else []
            if len(matches)!=1:missing=True
            else:linked.append(matches[0])
        def article_range(first,last,domain):
            if not first or not last:return False,[]
            start=int(first[1]);end=int(last[1]);lo=int(first[2] or 0);hi=int(last[2] or 0);chosen=[]
            ok=bool(domain and start>0 and end>=start and end-start<100 and not (start==end and lo>hi))
            if not ok:return False,[]
            for number in range(start,end+1):
                subs=sorted(int(a['sub'] or 0) for k,a in section_articles.items() if a['number']==number and sections[k][0]['domain']==domain)
                if (number!=start or not lo) and 0 not in subs:ok=False
                within=[b for b in subs if (number>start or b>=lo) and (number<end or b<=hi)]
                if not within or len(set(within))!=len(within) or number==start and lo not in within or number==end and hi not in within:ok=False
                for j,b in enumerate(within):
                    if j and b-within[j-1]!=1 and not (within[j-1]==0 and b==2):ok=False
                    rs=targets(s,str(number)+('의'+str(b) if b else ''),domain)
                    if not any(r['body'] for r in rs):ok=False
                    chosen.extend(rs)
            if any(pos(r)<=pos(chosen[i-1]) for i,r in enumerate(chosen) if i):ok=False
            return ok,chosen
        def path_node(path,group):
            by_kind={t['kind']:t for t in path};para=by_kind.get('항');item=by_kind.get('호');letter=by_kind.get('목');sub=by_kind.get('세목')
            if para:group=paragraph_group(group,para['number'])
            if item:group=[r for r in group if r.get('list_valid') and (r.get('list_path') or [None])[0]==item['number']]
            if letter:group=[r for r in group if len(r.get('list_path',[]))>1 and r['list_path'][1]==letter['m'][1]]
            if sub:group=[r for r in group if len(r.get('list_path',[]))>2 and r['list_path'][2]==sub['number']]
            kind=path[-1]['kind'];roots=[r for r in group if r['paragraph_start']] if kind=='항' else [r for r in group if len(r.get('list_path',[]))=={'호':1,'목':2,'세목':3}.get(kind,3)]
            return roots[0] if len(roots)==1 else None
        for interval in ranges:
            first,last=interval['start'],interval['end'];p=first['m'];start=first['number'];end=last['number'] if last else None;kind=first['kind']
            if interval.get('left'):
                left,right=interval['left'],interval['right'];ld=reference_domain(left[0]['m']);rd=reference_domain(right[0]['m']);ar_ok,ar_rows=article_range(left[0]['m'],right[0]['m'],ld)
                a=path_node(left,article_group(left[0]['m']));b=path_node(right,article_group(right[0]['m']))
                good=bool(interval['valid'] and ld==rd and ar_ok and a and b and pos(a)<=pos(b) and not external(left[0]['m']) and not external(right[0]['m']))
                per_section={}
                for r in ar_rows:per_section.setdefault(section_key(r),[]).append(r)
                for rs in per_section.values():
                    ps=[r['paragraph_number'] for r in rs if r['paragraph_start']]
                    if any(t['kind']=='항' for t in left) and (not ps or any(n!=i+1 for i,n in enumerate(ps))):good=False
                    if kind!='항':
                        if any(r.get('list_id') and not r.get('list_valid') for r in rs):good=False
                        anchors={r['paragraph_anchor'] for r in rs if r['paragraph_start']} or {None}
                        if any(not any(r['paragraph_anchor']==anchor and r.get('list_valid') and len(r.get('list_path',[]))==1 for r in rs) for anchor in anchors):good=False
                linked.extend(ar_rows)
                if not good:missing=True;linked.extend(domains.get(ld) or domains.get(s['domain']) or [])
                continue
            if external_path(p):missing=True;continue
            if kind=='조':
                domain=reference_domain(p);ok,rs=article_range(p,last['m'] if last else None,domain);linked.extend(rs)
                if not interval['valid'] or not ok:missing=True;linked.extend(domains.get(domain,[]))
                continue
            valid=bool(interval['valid'] and end is not None and start>0 and end>=start and end-start<100);group=[];found=[];list_id=None
            if kind=='항':group=article_group(preceding(article_refs,p))
            if kind=='호':group=item_group(p)
            if kind in ('목','세목'):
                letter=preceding(letter_refs,p) if kind=='세목' else None;parent=preceding(item_refs,letter or p);target=item_targets.get(parent)
                if target:group=[r for r in list_groups.get(target.get('list_id'),[]) if len(r.get('list_path',[]))==(3 if kind=='세목' else 2) and r['list_path'][0]==target.get('list_number') and (kind!='세목' or letter and r['list_path'][1]==letter[1])]
            uncertain=group if group else domains.get(s['domain'],[])
            if not valid:missing=True;linked.extend(uncertain);continue
            for n in range(start,end+1):
                matches=paragraph_group(group,n) if kind=='항' else [r for r in group if r.get('list_valid') and (r.get('list_number')==n if kind=='호' else r.get('list_subnumber')==n if kind=='세목' else n<=len(Q.LETTERS) and r.get('list_letter')==Q.LETTERS[n-1])]
                if not matches or not any(r['body'] for r in matches) or kind in ('호','목') and len(matches)!=1:valid=False
                if kind=='호' and matches:
                    if list_id and matches[0]['list_id']!=list_id:valid=False
                    list_id=matches[0]['list_id']
                found.extend(matches)
            if any(pos(r)<=pos(found[i-1]) for i,r in enumerate(found) if i):valid=False
            linked.extend(found)
            if not valid:missing=True;linked.extend(uncertain)
        if '전조' in text:
            current=section_articles.get(section_key(s));to=targets(s,current['number']-1) if current and not current['sub'] else []
            if not to or to[0]['section_index']!=s['section_index']-1:missing=True
            else:linked.extend(to)
        if '전항' in text:
            group=sections.get(section_key(s),[]);paragraph=0;counts={}
            for x in group:
                if x['paragraph_start']:
                    n=x['paragraph_number'];counts[n]=counts.get(n,0)+1
                    if x['sentence_index']<=s['sentence_index']:paragraph=n
            if paragraph<2 or counts.get(paragraph)!=1 or counts.get(paragraph-1)!=1:missing=True
            else:linked.extend(group)
        if '준용' in text and not article_refs and not annex_refs and not named_refs and not has('전항|전조',text):missing=True
        return linked,missing
    output=[]
    for s in all_rows:
        linked,missing=resolve(s)
        if not linked and not missing:continue
        seen=set();targets_out=[]
        for t in linked:
            k=(t['document_index'],t['sentence_index'])
            if k in seen:continue
            seen.add(k);targets_out.append({k:t[k] for k in ('document_index','sentence_index','section_index','domain','text')})
        output.append(dict({k:s[k] for k in ('document_index','sentence_index','section_index','domain','text')},missing=missing,targets=targets_out))
    return output
