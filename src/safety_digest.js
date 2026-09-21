"use strict";
/* 결정적 JSON + SHA-256. 지문은 변조/변경 검사용이며 조직 인증·전자서명이 아니다. */
var SafetyDigest = (function () {
  function canonical(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(function (v) { return canonical(v === undefined ? null : v); }).join(",") + "]";
    return "{" + Object.keys(x).filter(function (k) { return x[k] !== undefined; }).sort().map(function (k) {
      return JSON.stringify(k) + ":" + canonical(x[k]);
    }).join(",") + "}";
  }
  function sha256(text) {
    var bytes = new TextEncoder().encode(text), size = Math.ceil((bytes.length + 9) / 64) * 64;
    var data = new Uint8Array(size); data.set(bytes); data[bytes.length] = 128;
    var view = new DataView(data.buffer), bits = bytes.length * 8;
    view.setUint32(size - 8, Math.floor(bits / 4294967296)); view.setUint32(size - 4, bits >>> 0);
    var k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    function r(x,n) { return (x >>> n) | (x << (32-n)); }
    for (var at=0; at<size; at+=64) {
      var w=new Uint32Array(64), i;
      for(i=0;i<16;i++) w[i]=view.getUint32(at+i*4);
      for(i=16;i<64;i++) w[i]=(w[i-16]+(r(w[i-15],7)^r(w[i-15],18)^(w[i-15]>>>3))+w[i-7]+(r(w[i-2],17)^r(w[i-2],19)^(w[i-2]>>>10)))>>>0;
      var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],z=h[7];
      for(i=0;i<64;i++) {
        var t1=(z+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0;
        var t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,z].forEach(function(v,j){h[j]=(h[j]+v)>>>0;});
    }
    return h.map(function(v){return ("00000000"+v.toString(16)).slice(-8);}).join("");
  }
  return { canonical: canonical, sha256: sha256, of: function(x){return sha256(canonical(x));} };
})();
if (typeof module !== "undefined") module.exports = SafetyDigest;
