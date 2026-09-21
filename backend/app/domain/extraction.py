"""Bounded native file extraction. Original bytes are stored by the API unchanged."""
import io
import re
import struct
import zipfile
import zlib
import xml.etree.ElementTree as ET
from pathlib import Path
from app.domain.structure import from_blocks

MAX_EXPANDED = 50 * 1024 * 1024
FORMATS = ['txt', 'pdf', 'docx', 'hwpx', 'doc', 'hwp']


def local(node): return node.tag.rsplit('}', 1)[-1]
def attr(node, key, default=''):
    return next((v for k, v in node.attrib.items() if k.rsplit('}', 1)[-1] == key), default) if node is not None else default
def first(node, name):
    return next((e for e in node.iter() if local(e) == name), None) if node is not None else None
def children(node, name): return [e for e in node if local(e) == name] if node is not None else []


def xml(data):
    if re.search(br'<!\s*(?:DOCTYPE|ENTITY)', data, re.I):
        raise ValueError('외부 정의가 포함된 XML은 읽을 수 없습니다.')
    root = ET.fromstring(data)
    stack = [(root, 0)]; count = 0
    while stack:
        node, depth = stack.pop(); count += 1
        if depth > 100 or count > 150000:
            raise ValueError('문서 구조가 너무 복잡합니다. 문서를 나누어 주세요.')
        stack.extend((child, depth + 1) for child in node)
    return root


def paragraph_text(node):
    out = []
    def walk(parent):
        for child in parent:
            kind = local(child)
            if kind in ('p', 'tbl', 'tc', 'del', 'moveFrom'): continue
            if kind == 'AlternateContent':
                branch = children(child, 'Choice') or children(child, 'Fallback')
                if branch: walk(branch[0])
            elif kind == 't': out.append(''.join(child.itertext()))
            elif kind == 'tab': out.append('\t')
            elif kind in ('br', 'cr', 'lineBreak'): out.append('\n')
            else: walk(child)
    walk(node)
    return ''.join(out).rstrip('\n')


def number(value, fmt):
    if fmt in ('decimalEnclosedCircle', 'decimalEnclosedCircleChinese') or 'CIRCLED' in fmt:
        return chr(0x245f + value) if 1 <= value <= 20 else '(' + str(value) + ')'
    if fmt in ('lowerLetter', 'upperLetter'):
        return chr((96 if fmt == 'lowerLetter' else 64) + max(1, min(26, value)))
    if fmt in ('lowerRoman', 'upperRoman'):
        if not 0 < value <= 10000: raise ValueError('자동 번호 범위를 확인하세요.')
        out = ''
        for n, s in [(1000,'M'),(900,'CM'),(500,'D'),(400,'CD'),(100,'C'),(90,'XC'),(50,'L'),(40,'XL'),(10,'X'),(9,'IX'),(5,'V'),(4,'IV'),(1,'I')]:
            while value >= n: out += s; value -= n
        return out.lower() if fmt == 'lowerRoman' else out
    return '' if fmt in ('bullet','none') else str(value)


def join_prefix(prefix, text):
    if not prefix or re.search(r'^\s*(?:[①-⑳]|제\s*[0-9]+\s*조|[0-9]+\s*[.)])', text): return text
    space = '' if (re.search(r'제\s*[0-9]+$', prefix) and re.search(r'^\s*조', text)) or (prefix.endswith('조') and re.search(r'^\s*\(',text)) else ' '
    return prefix + space + text


def zipped(data, kind):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 5000 or sum(e.file_size for e in entries) > MAX_EXPANDED or len({e.filename for e in entries}) != len(entries):
            raise ValueError('압축 문서의 크기 또는 항목 구성을 확인하세요.')
        if any(e.flag_bits & 1 for e in entries): raise ValueError('암호를 해제한 문서를 올려 주세요.')
        def read(name): return xml(archive.read(name)) if name in archive.namelist() else None
        if kind == 'docx':
            root = read('word/document.xml')
            if root is None: raise ValueError('DOCX 본문을 찾을 수 없습니다.')
            numbering, styles = read('word/numbering.xml'), read('word/styles.xml')
            abstracts, nums, style_map, counters = {}, {}, {}, {}
            def level(e):
                return {'start': int(attr(first(e,'start'),'val','1')), 'format': attr(first(e,'numFmt'),'val','decimal'),
                        'text': attr(first(e,'lvlText'),'val','%1'), 'restart': attr(first(e,'lvlRestart'),'val',None)}
            if numbering is not None:
                for e in numbering.iter():
                    if local(e) == 'abstractNum': abstracts[attr(e,'abstractNumId')] = {int(attr(x,'ilvl','0')):level(x) for x in children(e,'lvl')}
                    if local(e) == 'num':
                        levels = dict(abstracts.get(attr(first(e,'abstractNumId'),'val'), {}))
                        for ov in children(e,'lvlOverride'):
                            index = int(attr(ov,'ilvl','0')); nested = first(ov,'lvl')
                            if nested is not None: levels[index] = level(nested)
                            start = first(ov,'startOverride')
                            if start is not None and index in levels: levels[index] = dict(levels[index], start=int(attr(start,'val','1')))
                        nums[attr(e,'numId')] = levels
            if styles is not None:
                for e in styles.iter():
                    if local(e) == 'style': style_map[attr(e,'styleId')] = {'parent':attr(first(e,'basedOn'),'val'),
                        'num':attr(first(e,'numId'),'val',None),'level':attr(first(e,'ilvl'),'val',None)}
            def prefix(p):
                prop = next(iter(children(p,'pPr')),None); sid = attr(first(prop,'pStyle'),'val'); inherited = {}; seen = set()
                while sid in style_map and sid not in seen:
                    seen.add(sid); st = style_map[sid]
                    for key in ('num','level'):
                        if inherited.get(key) is None: inherited[key] = st[key]
                    sid = st['parent']
                num_id = attr(first(prop,'numId'),'val',inherited.get('num')); il = int(attr(first(prop,'ilvl'),'val',inherited.get('level') or '0'))
                if not num_id or num_id == '0': return '', None
                levels = nums.get(num_id,{}); definition = levels.get(il)
                if not definition: return '', {'numId':num_id,'ilvl':il,'prefix':'','confirmed':False}
                cs = counters.setdefault(num_id,{}); cs[il] = cs[il]+1 if il in cs else definition['start']
                for k in list(cs):
                    restart = levels.get(k,{}).get('restart')
                    if k > il and restart != '0' and (restart is None or int(restart) == il+1): del cs[k]
                value = re.sub(r'%([0-9]+)',lambda m:number(cs.get(int(m[1])-1,levels.get(int(m[1])-1,definition)['start']),levels.get(int(m[1])-1,definition)['format']),definition['text'])
                return value, {'numId':num_id,'ilvl':il,'prefix':value,'confirmed':bool(value)}
            return walk_xml(root,kind,'word/document.xml',prefix)
        parts = sorted([e.filename for e in entries if re.fullmatch(r'Contents/section[0-9]+\.xml',e.filename)],key=lambda p:int(re.search(r'section([0-9]+)',p)[1]))
        if not parts: raise ValueError('HWPX 본문을 찾을 수 없습니다.')
        header = read('Contents/header.xml'); defs, props = {}, {}
        if header is not None:
            for e in header.iter():
                if local(e) == 'numbering': defs[attr(e,'id')] = {int(attr(x,'level','1')):{'text':''.join(x.itertext()),'start':int(attr(x,'start',attr(e,'start','1'))),'format':attr(x,'numFormat')} for x in children(e,'paraHead')}
                if local(e) == 'paraPr' and first(e,'heading') is not None:
                    h = first(e,'heading'); props[attr(e,'id')] = {'type':attr(h,'type'),'id':attr(h,'idRef'),'level':int(attr(h,'level','0'))}
        all_blocks, warnings = [], []
        for part in parts:
            counters = {}
            def prefix(p):
                spec = props.get(attr(p,'paraPrIDRef')); auto = first(p,'autoNum'); value = attr(auto,'num')
                if spec and spec['type'] == 'NUMBER':
                    il = spec['level']+1; levels = defs.get(spec['id'],{}); definition = levels.get(il)
                    if definition:
                        cs = counters.setdefault(spec['id'],{}); cs[il] = cs.get(il,definition['start']-1)+1
                        for k in list(cs):
                            if k > il: del cs[k]
                        value = re.sub(r'\^([0-9]+)',lambda m:number(cs.get(int(m[1]),levels.get(int(m[1]),definition)['start']),definition['format']),definition['text'])
                return value, dict(spec or {},prefix=value,confirmed=bool(value)) if spec or auto is not None else None
            extracted = walk_xml(read(part),kind,part,prefix)
            all_blocks.extend(extracted['blocks']); warnings.extend(extracted['warnings'])
        return from_blocks(kind,all_blocks,list(dict.fromkeys(warnings)))


def walk_xml(root, kind, part, prefix):
    blocks, warnings = [], []; tables = 0
    def walk(node, table=None, cell=None):
        nonlocal tables
        for child in node:
            tag = local(child)
            if tag in ('del','moveFrom'):
                warnings.append('변경추적 삭제 문구는 최종본에서 제외했습니다. 원본과 대조하세요.'); continue
            if tag == 'AlternateContent':
                branch = children(child,'Choice') or children(child,'Fallback')
                if branch: walk(branch[0],table,cell)
                continue
            if tag == 'tbl':
                tables += 1; walk(child,{'id':part+':table:'+str(tables),'row':-1,'col':0}); continue
            if tag == 'tr' and table is not None:
                table['row'] += 1; table['col'] = int(attr(first(child,'gridBefore'),'val','0')); walk(child,table); continue
            if tag == 'tc' and table is not None:
                span, addr = first(child,'cellSpan'), first(child,'cellAddr')
                cs = int(attr(span,'colSpan',attr(first(child,'gridSpan'),'val','1'))); rs = int(attr(span,'rowSpan','1'))
                info = {'id':table['id'],'row':int(attr(addr,'rowAddr',str(table['row']))),'col':int(attr(addr,'colAddr',str(table['col']))),
                        'colspan':cs,'rowspan':rs,'merged':first(child,'vMerge') is not None or first(child,'hMerge') is not None}
                table['col'] += cs; walk(child,table,info); continue
            if tag == 'p':
                raw = paragraph_text(child); value, numbering = prefix(child)
                if numbering and not numbering['confirmed']: warnings.append('복원하지 못한 자동 번호가 있습니다. 원본과 대조하세요.')
                source = {'part':part,'paragraph':len(blocks),'table':cell,'cell':str(cell) if cell else None}
                blocks.append({'text':join_prefix(value,raw),'source':source,'numbering':numbering})
            walk(child,table,cell)
    walk(root)
    return from_blocks(kind,blocks,list(dict.fromkeys(warnings)))


def ole_text(data, kind):
    import olefile
    blocks, warnings = [], []
    with olefile.OleFileIO(io.BytesIO(data)) as ole:
        def stream(name):
            if not ole.exists(name): raise ValueError('문서의 필수 본문 스트림이 없습니다.')
            if ole.get_size(name) > MAX_EXPANDED: raise ValueError('문서 내부 크기 제한을 초과했습니다.')
            return ole.openstream(name).read()
        if kind == 'hwp':
            header = stream('FileHeader')
            if not header.startswith(b'HWP Document File') or len(header)<40: raise ValueError('HWP 5.0 형식이 아닙니다.')
            flags = struct.unpack_from('<I',header,36)[0]
            if flags & 6: raise ValueError('암호·배포용 제한을 해제한 HWP 문서를 올려 주세요.')
            paths = sorted([p for p in ole.listdir() if len(p)==2 and p[0]=='BodyText' and re.fullmatch(r'Section[0-9]+',p[1])],key=lambda p:int(p[1][7:]))
            if not paths: raise ValueError('HWP 본문 섹션이 없습니다.')
            expanded = 0
            for path in paths:
                raw = stream(path)
                if flags & 1:
                    decoder = zlib.decompressobj(-15); raw = decoder.decompress(raw,MAX_EXPANDED+1)
                    if decoder.unconsumed_tail or not decoder.eof: raise ValueError('HWP 압축 크기 또는 구조를 확인하세요.')
                expanded += len(raw)
                if expanded > MAX_EXPANDED: raise ValueError('HWP 본문 크기 제한을 초과했습니다.')
                at=0
                while at+4 <= len(raw):
                    offset=at; head=struct.unpack_from('<I',raw,at)[0];at+=4; size=head>>20; tag=head&1023
                    if size==4095:
                        size=struct.unpack_from('<I',raw,at)[0];at+=4
                    if at+size>len(raw): raise ValueError('HWP 본문 레코드가 손상되었습니다.')
                    if tag==67:
                        segment=raw[at:at+size]; chars=[];i=0
                        while i+2<=len(segment):
                            value=struct.unpack_from('<H',segment,i)[0]
                            if value>=32: chars.append(segment[i:i+2]);i+=2
                            elif value in (10,13): chars.append(b'\n\0');i+=2
                            elif value==9: chars.append(b'\t\0');i+=16
                            elif value==18: chars.append('□'.encode('utf-16le'));i+=16;warnings.append('HWP 자동 번호 표시는 원본과 대조하세요. 복원하지 못한 번호를 □로 표시했습니다.')
                            elif value==0 or value>=24:i+=2
                            else:i+=16
                        blocks.append({'text':b''.join(chars).decode('utf-16le',errors='replace').strip(),'source':{'section':'/'.join(path),'record_offset':offset}})
                    at+=size
            warnings.append('HWP의 표 병합·들여쓰기·그림 속 문자는 원본과 대조하세요.')
        else:
            raw = stream('WordDocument')
            if len(raw)<34: raise ValueError('DOC 헤더가 손상되었습니다.')
            flags=struct.unpack_from('<H',raw,10)[0]
            if flags & 0x100: raise ValueError('암호를 해제한 DOC 문서를 올려 주세요.')
            table=stream('1Table' if flags&0x200 else '0Table')
            p=34+struct.unpack_from('<H',raw,32)[0]*2
            p+=2+struct.unpack_from('<H',raw,p)[0]*4
            start,size=struct.unpack_from('<II',raw,p+2+33*8);end=start+size;pos=start
            if not size or end>len(table): raise ValueError('DOC 본문 위치 정보를 읽을 수 없습니다. DOCX로 저장해 주세요.')
            while pos<end and table[pos]==1:pos+=3+struct.unpack_from('<H',table,pos+1)[0]
            if pos+5>end or table[pos]!=2:raise ValueError('DOC 본문 조각 정보를 찾을 수 없습니다.')
            size=struct.unpack_from('<I',table,pos+1)[0];plc=pos+5;n=(size-4)//12
            if n<=0 or n>100000 or plc+size>end:raise ValueError('DOC 본문 조각 정보가 손상되었습니다.')
            cps=struct.unpack_from('<'+'I'*(n+1),table,plc);pieces=[]
            for i in range(n):
                fc=struct.unpack_from('<I',table,plc+(n+1)*4+i*8+2)[0]; compressed=bool(fc&0x40000000);offset=fc&0x3fffffff;count=cps[i+1]-cps[i]
                if compressed:offset//=2
                length=count*(1 if compressed else 2)
                if count<0 or offset+length>len(raw):raise ValueError('DOC 본문 범위를 벗어났습니다.')
                pieces.append(raw[offset:offset+length].decode('cp1252' if compressed else 'utf-16le',errors='replace'))
            text=''.join(pieces);text=re.sub(r'\x13[^\x14\x15]*\x14','',text);text=re.sub(r'[\x13\x14\x15]','',text)
            text=text.replace('\x07','\t').replace('\r','\n').replace('\x0b','\n').replace('\x0c','\n');text=re.sub(r'[\x00-\x08\x0e-\x1f\uffff]','',text)
            blocks=[{'text':line,'source':{'paragraph':i}} for i,line in enumerate(text.split('\n'))]
            warnings.append('구형 DOC의 자동 번호와 표 구조는 원본과 대조하세요.')
    return from_blocks(kind,blocks,list(dict.fromkeys(warnings)))


def extract(name, data):
    kind = Path(name).suffix.lower().lstrip('.')
    if kind not in FORMATS: raise ValueError('TXT·PDF·DOCX·HWPX·DOC·HWP 파일을 선택하세요.')
    if not data or len(data)>7*1024*1024: raise ValueError('파일은 7 MiB 이하로 올려 주세요.')
    if kind in ('docx','hwpx'): result=zipped(data,kind)
    elif kind in ('doc','hwp'): result=ole_text(data,kind)
    elif kind=='pdf':
        from pypdf import PdfReader
        if not data.startswith(b'%PDF-'):raise ValueError('PDF 형식이 아닙니다.')
        reader=PdfReader(io.BytesIO(data))
        if reader.is_encrypted:raise ValueError('암호를 해제한 PDF를 올려 주세요.')
        if len(reader.pages)>500:raise ValueError('PDF는 500쪽 이하로 나누어 주세요.')
        blocks=[];warnings=[];total=0
        for i,page in enumerate(reader.pages):
            text=page.extract_text() or '';total+=len(text)
            if total>2000000:raise ValueError('추출 본문 크기 제한을 초과했습니다.')
            if not text.strip():warnings.append(str(i+1)+'쪽의 텍스트층이 없습니다. 내부 OCR 또는 원본 확인이 필요합니다.')
            blocks.extend({'text':line,'source':{'page':i+1,'paragraph':j}} for j,line in enumerate(text.split('\n')))
        warnings.append('PDF의 표·단 구분 및 자동 번호는 추출 본문과 원본을 대조하세요.')
        result=from_blocks(kind,blocks,warnings)
    else:
        text=None
        for encoding in (['utf-16'] if data.startswith((b'\xff\xfe',b'\xfe\xff')) else ['utf-8-sig','cp949']):
            try:text=data.decode(encoding);break
            except UnicodeDecodeError:pass
        if text is None or '\x00' in text:raise ValueError('텍스트 인코딩을 확인하세요. UTF-8로 저장해 주세요.')
        result=from_blocks(kind,[{'text':line,'source':{'line':i+1}} for i,line in enumerate(text.splitlines())])
    if not result['text'].strip():raise ValueError('읽을 수 있는 본문이 없습니다. 이미지 문서는 내부 OCR 후 다시 올려 주세요.')
    if len(result['text'])>2000000:raise ValueError('추출 본문 크기 제한을 초과했습니다.')
    return result
