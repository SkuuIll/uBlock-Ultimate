const RUNTIME_FIELDS = new Set([
  'id', 'state', 'priority', 'metadata', 'preview', 'provenance', 'collectionId',
  'schemaVersion', 'metrics', 'fingerprintGC',
])

function sortedKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj).filter(k => !RUNTIME_FIELDS.has(k)).sort()
}

function canonicalValue(v: unknown): unknown {
    if (v === null || v === undefined) return undefined
    if (Array.isArray(v)) {
        const a = v.map(canonicalValue).filter(x => x !== undefined)
        return a.length > 0 ? a : undefined
    }
    if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const k of sortedKeys(o)) {
            const cv = canonicalValue(o[k])
            if (cv !== undefined) result[k] = cv
        }
        if (Object.keys(result).length === 0) return undefined
        return result
    }
    return v
}

function canonicalJson(rule: Record<string, unknown>): string {
    const clean = canonicalValue(rule)
    if (clean === undefined || clean === null) return '{}'
    return JSON.stringify(clean)
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n))
}

function sha256(message: string): Uint8Array {
    const utf8: number[] = []
    for (let i = 0; i < message.length; i++) {
        let c = message.charCodeAt(i)
        if (c < 0x80) {
      utf8.push(c)
        } else if (c < 0x800) {
      utf8.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
        } else if (c < 0xd800 || c >= 0xe000) {
      utf8.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
        } else {
            i++
            c = 0x10000 + (((c & 0x3ff) << 10) | (message.charCodeAt(i) & 0x3ff))
      utf8.push(
          0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f),
          0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f),
      )
        }
    }

    const bitLen = utf8.length * 8
  utf8.push(0x80)
  while ((utf8.length * 8) % 512 !== 448) utf8.push(0)
  utf8.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff)
  utf8.push(0, 0, 0, 0)

  let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a
  let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19

  const W = new Uint32Array(64)
  for (let offset = 0; offset < utf8.length; offset += 64) {
      for (let t = 0; t < 16; t++) {
          const i = offset + t * 4
          W[t] = (utf8[i] << 24) | (utf8[i + 1] << 16) | (utf8[i + 2] << 8) | utf8[i + 3]
      }
      for (let t = 16; t < 64; t++) {
          const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)
          const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)
          W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0
      }

      let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7
      for (let t = 0; t < 64; t++) {
          const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
          const ch = (e & f) ^ ((~e) & g)
          const temp1 = (h + S1 + ch + K[t] + W[t]) | 0
          const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
          const maj = (a & b) ^ (a & c) ^ (b & c)
          const temp2 = (S0 + maj) | 0

          h = g; g = f; f = e; e = (d + temp1) | 0
          d = c; c = b; b = a; a = (temp1 + temp2) | 0
      }

      H0 = (H0 + a) | 0; H1 = (H1 + b) | 0; H2 = (H2 + c) | 0; H3 = (H3 + d) | 0
      H4 = (H4 + e) | 0; H5 = (H5 + f) | 0; H6 = (H6 + g) | 0; H7 = (H7 + h) | 0
  }

  const result = new Uint8Array(32)
  for (let i = 0; i < 8; i++) {
      const h = [H0, H1, H2, H3, H4, H5, H6, H7][i]
      result[i * 4] = (h >>> 24) & 0xff
      result[i * 4 + 1] = (h >>> 16) & 0xff
      result[i * 4 + 2] = (h >>> 8) & 0xff
      result[i * 4 + 3] = h & 0xff
  }
  return result
}

export function createConfirmationHash(rule: object): string {
    const r = rule as Record<string, unknown>
    const json = canonicalJson(r)
    const syntaxVersion = (r.syntaxVersion as number) ?? 1
    const astVersion = (r.astNormalisationVersion as number) ?? 1
    const suffix = `syntax-version:${syntaxVersion};ast-normalisation-version:${astVersion}`
    const digest = sha256(json + suffix)
    const hex = Array.from(digest).map(b => b.toString(16).padStart(2, '0')).join('')
    return `preview:${hex}`
}

export * as CanonicalHash from "./canonical-hash"
