// The digests MD5, SHA1, SHA2 and CRC32 compute, against their published test
// vectors (RFC 1321 appendix A.5, FIPS 180-4's examples, zlib's check value),
// at lengths that cross a block boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, md5, sha1, sha256, sha512 } from '@myjs/types'

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

test('MD5 matches RFC 1321', () => {
  assert.equal(md5(bytes('')), 'd41d8cd98f00b204e9800998ecf8427e')
  assert.equal(md5(bytes('abc')), '900150983cd24fb0d6963f7d28e17f72')
  assert.equal(md5(bytes('12345678901234567890123456789012345678901234567890123456789012345678901234567890')), '57edf4a22be3c955ac49da2e2107b67a')
})

test('SHA-1 and SHA-2 match FIPS 180-4', () => {
  assert.equal(sha1(bytes('abc')), 'a9993e364706816aba3e25717850c26c9cd0d89d')
  assert.equal(sha1(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')), '84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  assert.equal(sha256(bytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256(bytes('abc'), 224), '23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7')
  assert.equal(sha256(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  assert.equal(sha512(bytes('abc')), 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f')
  assert.equal(sha512(bytes('abc'), 384), 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7')
  assert.equal(sha512(bytes('')), 'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e')
})

test('CRC-32 is zlib\'s', () => {
  assert.equal(crc32(bytes('123456789')), 0xcbf43926)
  assert.equal(crc32(bytes('')), 0)
})
