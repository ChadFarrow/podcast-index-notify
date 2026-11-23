// SHA-1, in plain TypeScript.
//
// Podcast Index signs each keyed request with sha1(key + secret + unixTime) as hex.
// Node 18 has no global WebCrypto (it came unflagged in Node 19), and an edge
// runtime has no node:crypto, so one small synchronous implementation serves
// every runtime with no dependency. The input is a short string; speed does not
// matter. test/sha1.test.ts checks it against node:crypto.

function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n));
}

/** SHA-1 of the UTF-8 bytes of `text`, as 40 lowercase hex characters. */
export function sha1Hex(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bitLength = msg.length * 8;

  // Pad: 0x80, zeros, then the 64-bit big-endian bit length, to a multiple of 64 bytes.
  const total = Math.ceil((msg.length + 9) / 64) * 64;
  const bytes = new Uint8Array(total);
  bytes.set(msg);
  bytes[msg.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(total - 4, bitLength >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((h) => h.toString(16).padStart(8, '0')).join('');
}
