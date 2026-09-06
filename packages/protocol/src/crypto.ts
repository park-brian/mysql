// M1.7 — the crypto shim.
//
// "One module, identical API on Node and in the browser; nothing above it
// imports `node:crypto`." Everything here is WebCrypto, which Node 22 exposes
// as a global, so there is genuinely one implementation rather than two behind
// a flag.
//
// The random source is a *parameter*, not a module global. Doc 43 §3's replay
// harness is `new MySQLProtocolServer(fixedNonce, fixedUser)`: byte-exact
// trace comparison is only possible if the 20-byte scramble can be fixed, so
// injectability is a protocol requirement rather than a testing convenience.

import { MyjsError } from '@myjs/bytes'

const subtle: SubtleCrypto = globalThis.crypto.subtle

// Recent TypeScript makes typed arrays generic over their backing buffer, and
// WebCrypto's types demand `ArrayBuffer` specifically rather than
// `ArrayBufferLike`. Ours are always `ArrayBuffer`-backed — doc 40's "what we
// deliberately do not do" rules SharedArrayBuffer out of the default path — so
// this bridge is a typing concession, not a runtime one.
type Bytes = Uint8Array<ArrayBuffer>
const bridge = (b: Uint8Array): Bytes => b as Bytes

/** Where scrambles come from. Never `Math.random` (doc 13, security note 4). */
export interface RandomSource {
  getRandomValues(into: Uint8Array): Uint8Array
}

export const webCryptoRandom: RandomSource = {
  getRandomValues: (into) => globalThis.crypto.getRandomValues(bridge(into)),
}

/** A fixed source, for trace replay and golden vectors. Never for a real server. */
export function fixedRandom(bytes: Uint8Array): RandomSource {
  return {
    getRandomValues(into) {
      for (let i = 0; i < into.length; i++) into[i] = bytes[i % bytes.length] as number
      return into
    },
  }
}

export async function sha1(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-1', bridge(concat(parts))))
}

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', bridge(concat(parts))))
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Fixed-length XOR, for the native and sha2 scrambles. */
export function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) {
    throw new MyjsError('CRYPTO_LENGTH_MISMATCH', `xor operands differ: ${a.length} vs ${b.length}`)
  }
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] as number) ^ (b[i] as number)
  return out
}

/**
 * XOR with a repeating key.
 *
 * The RSA branch obscures the password with the 20-byte nonce before
 * encrypting, and the password may be longer than the nonce, so the nonce
 * repeats. `mysql2`'s `xorRotating` is the reference.
 */
export function xorRotating(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0) {
    throw new MyjsError('CRYPTO_EMPTY_KEY', 'xorRotating needs a non-empty key')
  }
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = (data[i] as number) ^ (key[i % key.length] as number)
  return out
}

/**
 * Constant-time comparison.
 *
 * Doc 13 suggests `crypto.subtle.timingSafeEqual` "where available"; WebCrypto
 * has no such method on any platform (erratum E-05), so the manual loop is the
 * implementation, full stop. It compares every byte regardless of the first
 * mismatch, and a length difference is reported without an early return that
 * would leak the length through timing on equal-length inputs.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < n; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

// --- RSA, for the TCP listener's caching_sha2_password full path (M1.14) ---

export interface RsaKeyPair {
  readonly publicKeyPem: string
  readonly privateKey: CryptoKey
  readonly publicKey: CryptoKey
}

/**
 * Generate the key pair the RSA branch needs.
 *
 * `mysql2` sets `oaepHash: 'sha1'` with `RSA_PKCS1_OAEP_PADDING`, so the hash
 * is SHA-1 and not negotiable — a client will not interoperate with SHA-256.
 * D-11 keeps this off the in-process path entirely: an in-process connection
 * is already secure, so it never reaches here.
 */
export async function generateRsaKeyPair(modulusLength = 2048): Promise<RsaKeyPair> {
  const pair = (await subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength,
      publicExponent: bridge(new Uint8Array([0x01, 0x00, 0x01])),
      hash: 'SHA-1',
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey))
  return {
    publicKeyPem: toPem(spki, 'PUBLIC KEY'),
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
  }
}

export async function rsaDecrypt(privateKey: CryptoKey, ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, bridge(ciphertext)))
}

/** Only used by the client side of our own tests; a server never encrypts here. */
export async function rsaEncrypt(publicKey: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, bridge(plaintext)))
}

export async function importPublicKeyPem(pem: string): Promise<CryptoKey> {
  return subtle.importKey('spki', bridge(fromPem(pem)), { name: 'RSA-OAEP', hash: 'SHA-1' }, true, [
    'encrypt',
  ])
}

/** PEM without `Buffer`: `btoa` is a global on both platforms. */
export function toPem(der: Uint8Array, label: string): string {
  let binary = ''
  for (const byte of der) binary += String.fromCharCode(byte)
  const base64 = btoa(binary)
  const lines = base64.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

export function fromPem(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')
  const binary = atob(body)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
