// M1.8, M1.9 — the connection phase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer, ProtocolError } from '@myjs/bytes'
import {
  CLIENT,
  SERVER_ADVERTISED_CAPABILITIES,
  capabilities,
  writeHandshakeV10,
  parseHandshakeV10,
  parseHandshakeResponse,
  writeHandshakeResponse41,
  writeSslRequest,
  isProhibitedConnectionCharset,
  MAX_CONNECT_ATTRS_BYTES,
  MAX_CONNECT_ATTRS_COUNT,
  AUTH_PLUGIN_DATA_LEN,
  SCRAMBLE_LENGTH,
  SSL_REQUEST_LENGTH,
  CACHING_SHA2_PASSWORD,
  type HandshakeResponse41,
} from '@myjs/protocol'

const scramble = new Uint8Array(SCRAMBLE_LENGTH).map((_, i) => i + 1)

function handshakeBytes(): Uint8Array {
  const w = new Writer()
  writeHandshakeV10(w, {
    serverVersion: '8.4.0-myjs-0.1.0',
    connectionId: 7,
    scramble,
  })
  return w.toBytes()
}

test('HandshakeV10 round-trips, scramble included', () => {
  const parsed = parseHandshakeV10(handshakeBytes())
  assert.equal(parsed.protocolVersion, 10)
  assert.equal(parsed.serverVersion, '8.4.0-myjs-0.1.0')
  assert.equal(parsed.connectionId, 7)
  assert.deepEqual([...parsed.scramble], [...scramble], 'the 8 + 12 split reassembles')
  assert.equal(parsed.authPluginName, CACHING_SHA2_PASSWORD)
})

test('the scramble is split 8 + 12 with a trailing NUL', () => {
  const bytes = handshakeBytes()
  // 1 + len("8.4.0-myjs-0.1.0") + 1 = 18 bytes before the connection id.
  const part1At = 1 + '8.4.0-myjs-0.1.0'.length + 1 + 4
  assert.deepEqual([...bytes.subarray(part1At, part1At + 8)], [...scramble.subarray(0, 8)])

  // auth_plugin_data_len is 21 for a 20-byte scramble plus its NUL.
  const lenAt = part1At + 8 + 1 + 2 + 1 + 2 + 2
  assert.equal(bytes[lenAt], AUTH_PLUGIN_DATA_LEN)
  assert.equal(AUTH_PLUGIN_DATA_LEN, 21)

  const part2At = lenAt + 1 + 10
  assert.deepEqual([...bytes.subarray(part2At, part2At + 12)], [...scramble.subarray(8)])
  assert.equal(bytes[part2At + 12], 0x00, 'part 2 is 12 bytes then a NUL: 13 in all')
})

test('D-10: CLIENT_LONG_PASSWORD is set and the reserved bytes are zeroed', () => {
  const bytes = handshakeBytes()
  const parsed = parseHandshakeV10(bytes)
  assert.ok(
    (parsed.capabilities & CLIENT.LONG_PASSWORD) !== 0,
    'MariaDB overloads the absence of this flag; a MariaDB-aware client must see it set',
  )
  const lenAt = 1 + '8.4.0-myjs-0.1.0'.length + 1 + 4 + 8 + 1 + 2 + 1 + 2 + 2
  const reserved = bytes.subarray(lenAt + 1, lenAt + 11)
  assert.equal(reserved.length, 10)
  assert.ok(
    reserved.every((b) => b === 0),
    'MariaDB 10.2+ reads extended capabilities out of these bytes',
  )
})

test('D-12: we never advertise CLIENT_SSL or CLIENT_COMPRESS by default', () => {
  const caps = SERVER_ADVERTISED_CAPABILITIES
  assert.equal(caps & CLIENT.SSL, 0, 'in-process there is no channel to secure')
  assert.equal(caps & CLIENT.COMPRESS, 0, 'it costs CPU to compress a memcpy')
  assert.equal(caps & CLIENT.ZSTD_COMPRESSION_ALGORITHM, 0)
  // And the ones doc 12 says we do advertise.
  for (const flag of [
    'PROTOCOL_41',
    'PLUGIN_AUTH',
    'PLUGIN_AUTH_LENENC_CLIENT_DATA',
    'DEPRECATE_EOF',
    'CONNECT_ATTRS',
    'SESSION_TRACK',
    'QUERY_ATTRIBUTES',
  ] as const) {
    assert.ok((caps & CLIENT[flag]) !== 0, `expected ${flag} to be advertised`)
  }
})

test('a scramble of the wrong length is refused rather than truncated', () => {
  assert.throws(
    () => writeHandshakeV10(new Writer(), { serverVersion: 'x', connectionId: 1, scramble: new Uint8Array(19) }),
    ProtocolError,
  )
})

test('only the low byte of the collation id fits in HandshakeV10', () => {
  const w = new Writer()
  // 255 fits; 278 (utf8mb4_0900_as_cs) does not, and must not corrupt the
  // following fields.
  writeHandshakeV10(w, { serverVersion: 'v', connectionId: 1, scramble, characterSet: 278 })
  const parsed = parseHandshakeV10(w.view())
  assert.equal(parsed.characterSet, 278 & 0xff)
  assert.equal(parsed.connectionId, 1, 'the overflow did not shift later fields')
})

// --- HandshakeResponse41 / SSLRequest (M1.9) -----------------------------

const CLIENT_CAPS =
  CLIENT.PROTOCOL_41 |
  CLIENT.PLUGIN_AUTH |
  CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA |
  CLIENT.CONNECT_WITH_DB |
  CLIENT.CONNECT_ATTRS |
  CLIENT.RESERVED2

test('HandshakeResponse41 round-trips with attributes', () => {
  const attrs = new Map([
    ['_client_name', 'myjs-test'],
    ['_pid', '4242'],
  ])
  const w = new Writer()
  writeHandshakeResponse41(w, {
    capabilities: CLIENT_CAPS,
    username: 'alice',
    authResponse: new Uint8Array(32).fill(9),
    database: 'app',
    clientPluginName: CACHING_SHA2_PASSWORD,
    connectAttrs: attrs,
  })
  const parsed = parseHandshakeResponse(w.view()) as HandshakeResponse41
  assert.equal(parsed.kind, 'handshake-response')
  assert.equal(parsed.username, 'alice')
  assert.equal(parsed.database, 'app')
  assert.equal(parsed.clientPluginName, CACHING_SHA2_PASSWORD)
  assert.equal(parsed.authResponse.length, 32)
  assert.deepEqual([...parsed.connectAttrs], [...attrs])
})

test('an auth response longer than 255 bytes needs the lenenc capability', () => {
  // An RSA-encrypted password is 256 bytes for a 2048-bit key, so the
  // int<1>-prefixed form cannot carry it.
  const w = new Writer()
  writeHandshakeResponse41(w, {
    capabilities: CLIENT.PROTOCOL_41 | CLIENT.PLUGIN_AUTH | CLIENT.PLUGIN_AUTH_LENENC_CLIENT_DATA,
    username: 'alice',
    authResponse: new Uint8Array(256).fill(1),
  })
  const parsed = parseHandshakeResponse(w.view()) as HandshakeResponse41
  assert.equal(parsed.authResponse.length, 256)
})

test('SSLRequest is exactly 32 bytes and is told apart by length, not a header', () => {
  const w = new Writer()
  writeSslRequest(w, { capabilities: CLIENT.PROTOCOL_41 })
  assert.equal(w.length, SSL_REQUEST_LENGTH)
  const parsed = parseHandshakeResponse(w.view())
  assert.equal(parsed.kind, 'ssl-request')
})

test('multibyte connection charsets are rejected, as the specification requires', () => {
  // NUL-terminated fields would be ambiguous in ucs2/utf16/utf32.
  for (const id of [35, 54, 55, 56, 60, 61, 62, 90, 128, 140, 101, 124, 160, 183]) {
    assert.equal(isProhibitedConnectionCharset(id), true, `charset ${id} must be rejected`)
  }
  for (const id of [8, 33, 45, 46, 63, 224, 246, 255]) {
    assert.equal(isProhibitedConnectionCharset(id), false, `charset ${id} must be allowed`)
  }

  const w = new Writer()
  writeHandshakeResponse41(w, {
    capabilities: CLIENT.PROTOCOL_41 | CLIENT.PLUGIN_AUTH,
    characterSet: 54, // utf16_general_ci
    username: 'alice',
    authResponse: new Uint8Array(0),
  })
  assert.throws(() => parseHandshakeResponse(w.view()), /not supported for the connection character set/)
})

test('oversized connection attributes are rejected before authentication', () => {
  // This is unauthenticated attacker-controlled input, and the declared length
  // is attacker-chosen — so the claim alone must be refused (D-31).
  const w = new Writer()
  w.u32(CLIENT.PROTOCOL_41 | CLIENT.CONNECT_ATTRS | CLIENT.PLUGIN_AUTH)
  w.u32(1024)
  w.u8(45)
  w.zeros(23)
  w.nulString(new TextEncoder().encode('alice'))
  w.u8(0) // auth response length
  w.nulString(new TextEncoder().encode(CACHING_SHA2_PASSWORD))
  w.lenEncInt(MAX_CONNECT_ATTRS_BYTES + 1)
  assert.throws(() => parseHandshakeResponse(w.view()), /Connection attributes exceed/)
})

test('too many connection attributes are rejected', () => {
  const attrs = new Map<string, string>()
  for (let i = 0; i <= MAX_CONNECT_ATTRS_COUNT; i++) attrs.set(`k${i}`, 'v')
  const w = new Writer()
  writeHandshakeResponse41(w, {
    capabilities: CLIENT.PROTOCOL_41 | CLIENT.PLUGIN_AUTH | CLIENT.CONNECT_ATTRS,
    username: 'alice',
    authResponse: new Uint8Array(0),
    connectAttrs: attrs,
  })
  assert.throws(() => parseHandshakeResponse(w.view()), /more than 128 connection attributes/)
})

test('attributes claiming more bytes than the packet holds are rejected', () => {
  const w = new Writer()
  w.u32(CLIENT.PROTOCOL_41 | CLIENT.CONNECT_ATTRS | CLIENT.PLUGIN_AUTH)
  w.u32(1024)
  w.u8(45)
  w.zeros(23)
  w.nulString(new TextEncoder().encode('alice'))
  w.u8(0)
  w.nulString(new TextEncoder().encode(CACHING_SHA2_PASSWORD))
  w.lenEncInt(500) // but nothing follows
  assert.throws(() => parseHandshakeResponse(w.view()), /overrun the packet/)
})

test('a truncated response is a typed error, not an out-of-bounds read', () => {
  const w = new Writer()
  writeHandshakeResponse41(w, {
    capabilities: CLIENT_CAPS,
    username: 'alice',
    authResponse: new Uint8Array(32),
    database: 'app',
  })
  const full = w.toBytes()
  for (let cut = 1; cut < full.length; cut++) {
    try {
      parseHandshakeResponse(full.subarray(0, cut))
    } catch (err) {
      assert.ok(err instanceof ProtocolError, `cut at ${cut} threw ${String(err)}`)
    }
  }
})

test('capabilities() brands a raw number without changing it', () => {
  assert.equal(capabilities(CLIENT.PROTOCOL_41) + 0, CLIENT.PROTOCOL_41)
  assert.equal(capabilities(0x80000000) + 0, 0x80000000, 'the top bit survives as unsigned')
})
