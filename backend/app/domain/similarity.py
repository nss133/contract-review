"""Character TF-IDF/Jaccard, including the legacy UTF-16 n-gram contract."""
from collections import Counter
import json
import math
from pathlib import Path
import re
from app.domain.structure import trim

RULES = json.loads((Path(__file__).parents[1] / 'data/domain-rules.json').read_text(encoding='utf-8'))['sim']


def units(value):
    raw = (value or '').encode('utf-16-le', errors='surrogatepass')
    return ''.join(chr(raw[i] + raw[i+1] * 256) for i in range(0, len(raw), 2))


def ununits(value):
    return b''.join(ord(c).to_bytes(2, 'little') for c in value).decode('utf-16-le', errors='surrogatepass')


def js_keys(value):
    # ECMAScript own-property order places array-index strings first.
    numeric = sorted((k for k in value if re.fullmatch(r'0|[1-9][0-9]*', k) and int(k) < 4294967295), key=int)
    return numeric + [k for k in value if k not in set(numeric)]


class Similarity:
    def __init__(self):
        self.set_synonyms(RULES['synonyms'])

    def set_synonyms(self, pairs=None):
        pairs = [(str(a or ''), str(b or '')) for a, b in pairs or []]
        self.synonyms = sorted([(a,b) if len(units(a)) >= len(units(b)) else (b,a) for a,b in pairs if a and b], key=lambda p: -len(units(p[0])))

    def preprocess(self, text):
        text = (text or '').translate(str.maketrans('０１２３４５６７８９', '0123456789'))
        for term in ('일', '개월', '년', '시간'):
            # JS word boundary treats Korean as non-word. Preserve that behavior.
            text = re.sub(r'([0-9]+)\s+' + term + r'(?=[A-Za-z0-9_])', r'\1' + term, text)
        for a, b in RULES['phrase_endings']:
            text = text.replace(a, b)
        for a, b in self.synonyms:
            text = text.replace(a, b)
        text = re.sub(r'제\s*[0-9]+\s*호', ' ', text)
        for word in RULES['stopwords']:
            text = text.replace(word, ' ')
        return trim(re.sub(r'[\s\ufeff]+', ' ', text))


def char_wb(text, min_n, max_n):
    out = []
    for token in re.split(r'[\s\ufeff]+', units(text)):
        if not token: continue
        padded = ' ' + token + ' '
        for n in range(min_n, max_n + 1):
            off = 0
            out.append(ununits(padded[:n]))
            while off + n < len(padded):
                off += 1
                out.append(ununits(padded[off:off+n]))
            if off == 0: break
    return out


def build_idf(docs, min_n=None, max_n=None):
    min_n, max_n = min_n or 2, max_n or 5
    vocab = {}
    for doc in docs:
        unique = dict.fromkeys(char_wb(doc, min_n, max_n))
        for gram in js_keys(unique):
            vocab[gram] = vocab.get(gram, 0) + 1
    return {'vocab': vocab, 'idf': {g: math.log((1+len(docs))/(1+vocab[g])) + 1 for g in js_keys(vocab)},
            'N': len(docs), 'minN': min_n, 'maxN': max_n}


def tfidf_vec(text, model):
    counts = Counter(char_wb(text, model.get('minN') or 2, model.get('maxN') or 5))
    vec, norm2 = {}, 0.0
    for gram in js_keys(counts):
        if gram not in model['idf']: continue
        weight = (1 + math.log(counts[gram])) * model['idf'][gram]
        vec[gram] = weight
        norm2 += weight * weight
    norm = math.sqrt(norm2) or 1
    return {g: vec[g] / norm for g in js_keys(vec)}


def cosine(a, b):
    small, large = (a, b) if len(a) <= len(b) else (b, a)
    total = 0.0
    for gram in js_keys(small):
        if gram in large: total += small[gram] * large[gram]
    return total


def keywords(text):
    return dict.fromkeys(re.findall(r'[가-힣]{2,}', text or ''), 1)


def jaccard_sets(a, b):
    if not a or not b: return 0
    inter = sum(bool(b.get(word)) for word in a)
    return inter / (len(a) + len(b) - inter)


def jaccard(a, b):
    return jaccard_sets(keywords(a), keywords(b))
