// M1.7 — "one module, identical API on Node and in the browser; nothing above
// it imports node:crypto".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sha1,
  sha256,
  xor,
  xorRotating,
  constantTimeEqual,
  concat,
  fixedRandom,
  webCryptoRandom,
  generateRsaKeyPair,
  rsaDecrypt,
  rsaEncrypt,
  importPublicKeyPem,
  toPem,
  fromPem,
  utf8,
} from '@myjs/protocol'

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join('')

test('sha1 matches the known digest of "abc"', async () => {
  assert.equal(hex(await sha1(utf8('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d')
})

test('sha256 matches the known digest of "abc"', async () => {
  assert.equal(
    hex(await sha256(utf8('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

test('the digests concatenate their parts, as the scramble formulas need', async () => {
  const joined = await sha1(utf8('ab'), utf8('c'))
  assert.equal(hex(joined), 'a9993e364706816aba3e25717850c26c9cd0d89d')
})

test('xor requires equal lengths', () => {
  assert.deepEqual([...xor(new Uint8Array([0xf0, 0x0f]), new Uint8Array([0xff, 0xff]))], [0x0f, 0xf0])
  assert.throws(() => xor(new Uint8Array(2), new Uint8Array(3)), /differ/)
})

test('xorRotating repeats a short key over a longer payload', () => {
  const key = new Uint8Array([1, 2, 3])
  const data = new Uint8Array([0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual([...xorRotating(data, key)], [1, 2, 3, 1, 2, 3, 1])
  // It is an involution, which is what makes it usable in both directions.
  assert.deepEqual([...xorRotating(xorRotating(data, key), key)], [...data])
})

test('constantTimeEqual compares content and length', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true)
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false)
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false)
  assert.equal(constantTimeEqual(new Uint8Array(0), new Uint8Array(0)), true)
})

test('concat joins in order', () => {
  assert.deepEqual([...concat([new Uint8Array([1]), new Uint8Array(0), new Uint8Array([2, 3])])], [1, 2, 3])
})

test('the random source is injectable, which is what makes trace replay possible', () => {
  const fixed = fixedRandom(new Uint8Array([0xaa, 0xbb]))
  const a = fixed.getRandomValues(new Uint8Array(5))
  const b = fixed.getRandomValues(new Uint8Array(5))
  assert.deepEqual([...a], [0xaa, 0xbb, 0xaa, 0xbb, 0xaa])
  assert.deepEqual([...a], [...b], 'a fixed source repeats exactly')

  const real = webCryptoRandom.getRandomValues(new Uint8Array(20))
  assert.equal(real.length, 20)
  assert.ok(real.some((byte) => byte !== 0), 'the real source is not all zeros')
})

test('PEM round-trips', () => {
  const der = new Uint8Array(100).map((_, i) => (i * 7) & 0xff)
  const pem = toPem(der, 'PUBLIC KEY')
  assert.ok(pem.startsWith('-----BEGIN PUBLIC KEY-----'))
  assert.ok(pem.trimEnd().endsWith('-----END PUBLIC KEY-----'))
  assert.ok(pem.split('\n').every((l) => l.length <= 64))
  assert.deepEqual([...fromPem(pem)], [...der])
})

test('RSA-OAEP-SHA1 round-trips through an exported PEM', async () => {
  // The full-path branch: the server publishes a PEM, the client imports it
  // and encrypts, the server decrypts. mysql2 pins oaepHash to sha1, so a
  // SHA-256 key would simply fail to interoperate.
  const pair = await generateRsaKeyPair(2048)
  const imported = await importPublicKeyPem(pair.publicKeyPem)
  const secret = utf8('hunter2 ')
  const ciphertext = await rsaEncrypt(imported, secret)
  assert.notDeepEqual([...ciphertext], [...secret])
  const plaintext = await rsaDecrypt(pair.privateKey, ciphertext)
  assert.deepEqual([...plaintext], [...secret])
})
