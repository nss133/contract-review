import io
import struct
import zipfile
import pytest
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
from app.domain.extraction import extract
from app.domain.structure import valid_extraction


def archive(files):
    data=io.BytesIO()
    with zipfile.ZipFile(data,'w') as output:
        for name,text in files.items():output.writestr(name,text)
    return data.getvalue()


def test_docx_numbering_deleted_text_and_table_source():
    raw=archive({'word/document.xml':'''<w:document xmlns:w="urn:word"><w:body>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>첫 항목 😀</w:t></w:r><w:del><w:r><w:t>삭제된 문장</w:t></w:r></w:del></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>수탁자</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>비밀을 유지한다.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>''',
      'word/numbering.xml':'<w:numbering xmlns:w="urn:word"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimalEnclosedCircle"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'})
    result=extract('계약.docx',raw)
    assert result['text'].startswith('① 첫 항목 😀') and '삭제된 문장' not in result['text']
    assert result['warnings']
    assert result['blocks'][1]['source']['table']['col']==0
    assert result['blocks'][2]['source']['table']['col']==1
    assert valid_extraction(result['text'],result)


def test_hwpx_numeric_section_order_and_korean_text():
    def section(text):return '<hp:sec xmlns:hp="urn:hwp"><hp:p><hp:run><hp:t>'+text+'</hp:t></hp:run></hp:p></hp:sec>'
    result=extract('계약.hwpx',archive({'Contents/section10.xml':section('열째'),'Contents/section2.xml':section('둘째')}))
    assert result['text']=='둘째\n열째\n'


def pdf_bytes():
    writer=PdfWriter();page=writer.add_blank_page(width=600,height=800)
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 50 750 Td (Contract review sample) Tj ET')
    page[NameObject('/Contents')]=writer._add_object(stream)
    output=io.BytesIO();writer.write(output);return output.getvalue()


def test_real_pdf_text_layer_and_page_location():
    result=extract('contract.pdf',pdf_bytes())
    assert 'Contract review sample' in result['text']
    assert result['blocks'][0]['source']['page']==1


def compound(kind):
    """Minimal real CFB v3 fixture with regular streams (no mini stream shortcut)."""
    end,free=0xfffffffe,0xffffffff
    if kind=='hwp':
        header=bytearray(4096);header[:17]=b'HWP Document File'
        text='제1조 (목적)\n용역계약 😀'.encode('utf-16le')
        body=(struct.pack('<I',(len(text)<<20)|67)+text).ljust(4096,b'\0')
        nodes=[('Root Entry',5,free,1,None),('FileHeader',2,2,free,bytes(header)),('BodyText',1,free,3,None),('Section0',2,free,free,body)]
    else:
        word=bytearray(4096);text='용역계약서\r제1조 (목적)\r계약 원문 😀'.encode('utf-16le');word[512:512+len(text)]=text
        struct.pack_into('<H',word,10,0x200);struct.pack_into('<II',word,38+33*8,0,21)
        table=bytearray(4096);table[0]=2;struct.pack_into('<I',table,1,16);struct.pack_into('<II',table,5,0,len(text)//2);struct.pack_into('<I',table,15,512)
        nodes=[('Root Entry',5,free,1,None),('WordDocument',2,2,free,bytes(word)),('1Table',2,free,free,bytes(table))]
    sectors=[bytearray(512)];fat=[end];directory=bytearray(512)
    for index,(name,typ,right,child,data) in enumerate(nodes):
        entry=bytearray(128);encoded=(name+'\0').encode('utf-16le');entry[:len(encoded)]=encoded;struct.pack_into('<H',entry,64,len(encoded));entry[66]=typ;entry[67]=1
        struct.pack_into('<III',entry,68,free,right,child);start=end
        if data:
            start=len(sectors);chunks=[data[i:i+512] for i in range(0,len(data),512)]
            sectors.extend(chunks);fat.extend([start+i+1 if i<len(chunks)-1 else end for i in range(len(chunks))])
        struct.pack_into('<IQ',entry,116,start,len(data) if data else 0);directory[index*128:(index+1)*128]=entry
    sectors[0]=directory;fat_sector=len(sectors);fat.append(0xfffffffd);fat.extend([free]*(128-len(fat)));sectors.append(struct.pack('<128I',*fat))
    header=bytearray(512);header[:8]=bytes.fromhex('D0CF11E0A1B11AE1');struct.pack_into('<HHHHH',header,24,0x3e,3,0xfffe,9,6)
    struct.pack_into('<IIIIIIIII',header,40,0,1,0,0,4096,end,0,end,0);struct.pack_into('<109I',header,76,fat_sector,*([free]*108))
    return bytes(header)+b''.join(sectors)


@pytest.mark.parametrize('kind',['doc','hwp'])
def test_real_ole_container_korean_and_astral_text(kind):
    result=extract('계약.'+kind,compound(kind))
    assert '제1조' in result['text'] and '😀' in result['text']
    assert valid_extraction(result['text'],result)


def test_txt_encoding_and_invalid_or_image_only_files():
    assert extract('본문.txt','한글 원문'.encode('cp949'))['text']=='한글 원문\n'
    with pytest.raises(ValueError):extract('bad.pdf',b'not pdf')
    writer=PdfWriter();writer.add_blank_page(width=10,height=10);data=io.BytesIO();writer.write(data)
    with pytest.raises(ValueError,match='본문이 없습니다'):extract('image.pdf',data.getvalue())
    with pytest.raises(ValueError,match='외부 정의'):extract('bad.docx',archive({'word/document.xml':'<!DOCTYPE foo [<!ENTITY x "payload">]><foo>&x;</foo>'}))
