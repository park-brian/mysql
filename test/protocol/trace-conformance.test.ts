// Doc 43 §3, first direction — our parsers against a real server's bytes.
//
// The fixtures under `fixtures/` were recorded by `tools/capture-traces.mjs`
// proxying the real `mysql` CLI and `mysql2` to a real MySQL 8.0.46. Nothing
// here is self-agreement: every byte was produced by MySQL or by a stock
// client, and the assertions are that our readers understand them.
//
// This is the half of trace replay that can be honest about a stub. Byte-
// identical *responses* to a real server's are a different claim — our version
// string, capability set, connection id and resultset metadata all differ by
// design — and that claim is made, against our own frozen output, in
// `self-replay.test.ts`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CLIENT,
  COM,
  PACKET,
  PacketFramer,
  capabilities,
  classify,
  parseColumnDefinition41,
  parseComQuery,
  parseComStmtExecute,
  parseComStmtPrepare,
  parseErr,
  parseHandshakeResponse,
  parseHandshakeV10,
  parseOk,
  readBinaryTime,
  FIELD_TYPE,
  SCRAMBLE_LENGTH,
} from '@myjs/protocol'
import { Reader } from '@myjs/bytes'

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname

interface Trace {
  readonly name: string
  readonly capturedAgainst: string
  readonly events: ReadonlyArray<{ direction: 'c2s' | 's2c'; bytes: number[] }>
}

function loadTrace(name: string): Trace {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Trace
}

const traceNames = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort()

/**
 * Reassemble one direction of a trace into packet payloads.
 *
 * Deliberately not `PacketFramer`: the framer validates the sequence id, and a
 * single direction of a conversation has gaps where the *other* side's packets
 * advanced the shared counter. The framer's own rules are tested against both
 * directions in `test/unit/framer.test.ts`; here we only need the payloads.
 */
function packetsOf(trace: Trace, direction: 'c2s' | 's2c'): Uint8Array[] {
  const stream: number[] = []
  for (const event of trace.events) {
    if (event.direction === direction) stream.push(...event.bytes)
  }
  const bytes = Uint8Array.from(stream)
  const packets: Uint8Array[] = []
  let offset = 0
  let partial: number[] = []
  while (offset + 4 <= bytes.length) {
    const length = bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
    if (offset + 4 + length > bytes.length) break
    const payload = bytes.subarray(offset + 4, offset + 4 + length)
    offset += 4 + length
    if (length === 0xffffff) {
      partial.push(...payload)
      continue
    }
    if (partial.length > 0) {
      partial.push(...payload)
      packets.push(Uint8Array.from(partial))
      partial = []
    } else {
      packets.push(payload)
    }
  }
  return packets
}

test('every captured fixture names the real server it came from', () => {
  assert.ok(traceNames.length >= 10, `expected a corpus, found ${traceNames.length} fixtures`)
  for (const name of traceNames) {
    const trace = loadTrace(name)
    assert.match(trace.capturedAgainst, /^mysql-server 8\.\d+\./, name)
    assert.ok(trace.events.length > 0, name)
  }
})

test("we parse a real server's HandshakeV10 in every fixture", () => {
  for (const name of traceNames) {
    const trace = loadTrace(name)
    const first = packetsOf(trace, 's2c')[0]
    assert.ok(first !== undefined, name)
    const handshake = parseHandshakeV10(first)
    assert.equal(handshake.protocolVersion, 10, name)
    assert.equal(handshake.scramble.length, SCRAMBLE_LENGTH, `${name}: the 8 + 12 split reassembles`)
    assert.match(handshake.serverVersion, /^8\./, name)
    assert.equal(handshake.authPluginName, 'caching_sha2_password', `${name}: 8.0's default plugin`)
    assert.ok(
      (handshake.capabilities & CLIENT.PROTOCOL_41) !== 0,
      `${name}: PROTOCOL_41 is always set in practice`,
    )
  }
})

test("we parse a real client's HandshakeResponse41 in every fixture", () => {
  for (const name of traceNames) {
    const trace = loadTrace(name)
    const first = packetsOf(trace, 'c2s')[0]
    assert.ok(first !== undefined, name)
    const parsed = parseHandshakeResponse(first)
    assert.equal(parsed.kind, 'handshake-response', `${name}: no TLS in these captures`)
    if (parsed.kind !== 'handshake-response') continue
    assert.ok(parsed.username.length > 0, name)
    assert.ok(
      (parsed.capabilities & CLIENT.PROTOCOL_41) !== 0,
      `${name}: a modern client always sets PROTOCOL_41`,
    )
  }
})

test('E-09 confirmed: the C client sends one 0x00 byte for an empty password', () => {
  const trace = loadTrace('handshake-empty-password.json')
  const response = parseHandshakeResponse(packetsOf(trace, 'c2s')[0] as Uint8Array)
  assert.equal(response.kind, 'handshake-response')
  if (response.kind !== 'handshake-response') return
  assert.equal(response.username, 'nopw')
  assert.deepEqual(
    [...response.authResponse],
    [0],
    'doc 13 says zero-length; the real C client sends a single NUL',
  )
})

test('E-10 confirmed: after an empty-password response the server sends OK, not 0x03', () => {
  // The packet after the client's handshake response is the final OK — there
  // is no AuthMoreData in between. This is the behaviour our own server had to
  // learn the hard way.
  const trace = loadTrace('handshake-empty-password.json')
  const s2c = packetsOf(trace, 's2c')
  const afterHandshake = s2c[1] as Uint8Array
  assert.equal(classify(afterHandshake, 'connection'), PACKET.OK)
  const ok = parseOk(afterHandshake, capabilities(CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS))
  assert.equal(ok.affectedRows, 0n)
})

test('the fast path really does send 0x03 as its own packet before the OK', () => {
  // M1.12's acceptance assertion, observed on a real server rather than
  // asserted from the specification.
  const trace = loadTrace('caching-sha2-fast.json')
  const s2c = packetsOf(trace, 's2c')
  const marker = s2c[1] as Uint8Array
  assert.deepEqual([...marker], [0x01, 0x03], 'AuthMoreData carrying fast_auth_success')
  assert.equal(classify(s2c[2] as Uint8Array, 'connection'), PACKET.OK, 'and then the OK, separately')
})

test('the full path asks for full authentication, hands over a key, then OKs', () => {
  const trace = loadTrace('caching-sha2-full-rsa.json')
  const s2c = packetsOf(trace, 's2c')
  assert.deepEqual([...(s2c[1] as Uint8Array)], [0x01, 0x04], 'perform_full_authentication')
  const key = s2c[2] as Uint8Array
  assert.equal(key[0], 0x01, 'AuthMoreData')
  assert.match(new TextDecoder().decode(key.subarray(1)), /BEGIN PUBLIC KEY/)
  assert.equal(classify(s2c[3] as Uint8Array, 'connection'), PACKET.OK, 'no 0x03 after full auth')
})

test('access denied is 1045 / 28000 on a real server too', () => {
  const trace = loadTrace('access-denied.json')
  const s2c = packetsOf(trace, 's2c')
  const err = s2c.find((p) => classify(p, 'connection') === PACKET.ERR)
  assert.ok(err !== undefined)
  const parsed = parseErr(err, capabilities(CLIENT.PROTOCOL_41))
  assert.equal(parsed.errno, 1045)
  assert.equal(parsed.sqlState, '28000')
  assert.match(parsed.message, /Access denied for user/)
})

test("we parse a real server's ColumnDefinition41 packets", () => {
  const trace = loadTrace('text-resultset-literals.json')
  const s2c = packetsOf(trace, 's2c')
  const definitions = s2c.filter((p) => {
    try {
      parseColumnDefinition41(p)
      return true
    } catch {
      return false
    }
  })
  assert.ok(definitions.length >= 4, `expected four column definitions, parsed ${definitions.length}`)
  for (const d of definitions.slice(0, 4)) {
    const parsed = parseColumnDefinition41(d)
    assert.ok(parsed.name.length > 0)
    // The 0x0c fixed-block marker is what the parser insists on, and a real
    // MySQL server never puts MariaDB's extended metadata before it.
    assert.ok(parsed.columnLength >= 0)
  }
})

test("we parse a real server's error packet for an unknown table", () => {
  const trace = loadTrace('error-unknown-table.json')
  const s2c = packetsOf(trace, 's2c')
  const err = s2c.filter((p) => classify(p, 'command') === PACKET.ERR).at(-1)
  assert.ok(err !== undefined)
  const parsed = parseErr(err, capabilities(CLIENT.PROTOCOL_41))
  assert.equal(parsed.errno, 1146, 'ER_NO_SUCH_TABLE')
  assert.equal(parsed.sqlState, '42S02')
  assert.match(parsed.message, /doesn't exist/)
})

test("we parse a real client's COM_QUERY, including query attributes", () => {
  const trace = loadTrace('text-resultset-literals.json')
  const response = parseHandshakeResponse(packetsOf(trace, 'c2s')[0] as Uint8Array)
  assert.equal(response.kind, 'handshake-response')
  if (response.kind !== 'handshake-response') return
  const caps = capabilities(response.capabilities)

  const queries = packetsOf(trace, 'c2s')
    .filter((p) => p[0] === COM.QUERY)
    .map((p) => parseComQuery(p, caps))
  assert.ok(queries.length >= 1)
  assert.ok(
    queries.some((q) => /SELECT 1, 'two', NULL, 3\.5/.test(q.sql)),
    `parsed: ${queries.map((q) => q.sql).join(' | ')}`,
  )
})

test('E-08 confirmed: a real client sends VAR_STRING (0xfd), not doc 16s 0x0f', () => {
  const trace = loadTrace('binary-scalars-prepared.json')
  const c2s = packetsOf(trace, 'c2s')
  const response = parseHandshakeResponse(c2s[0] as Uint8Array)
  assert.equal(response.kind, 'handshake-response')
  if (response.kind !== 'handshake-response') return
  const caps = capabilities(response.capabilities)

  const prepare = c2s.find((p) => p[0] === COM.STMT_PREPARE)
  assert.ok(prepare !== undefined)
  assert.match(parseComStmtPrepare(prepare), /SELECT \? \+ 0 AS n, \? AS s/)

  const execute = c2s.find((p) => p[0] === COM.STMT_EXECUTE)
  assert.ok(execute !== undefined)
  const parsed = parseComStmtExecute(execute, caps, { paramCount: 2 })
  const params = parsed.binding?.parameters ?? []
  assert.equal(params.length, 2)
  assert.equal(params[0]?.type, FIELD_TYPE.LONGLONG)
  assert.equal(params[0]?.value, 41n)
  assert.equal(params[1]?.type, FIELD_TYPE.VAR_STRING, 'a real client sends 0xfd')
  assert.equal(params[1]?.type, 0xfd)
  assert.equal(new TextDecoder().decode(params[1]?.value as Uint8Array), 'foo')
  // And the named-parameter form, which only appears with QUERY_ATTRIBUTES.
  assert.equal(params[0]?.name, '', 'positional parameters carry an empty name')
})

test('E-07 settled: a real server encodes the all-zero TIME as a bare 0x00', () => {
  // Doc 15's third TIME dump prints `01`, which its own layout forbids. Here
  // is what MySQL 8.0.46 actually put on the wire for CAST('00:00:00' AS TIME)
  // in a binary resultset row.
  const trace = loadTrace('binary-temporals-prepared.json')
  const s2c = packetsOf(trace, 's2c')
  // The binary row is the long packet starting 0x00 that is not an OK.
  const row = s2c.find((p) => p[0] === 0x00 && p.length > 20)
  assert.ok(row !== undefined, 'expected a binary resultset row')

  const r = new Reader(row)
  r.u8() // row header
  r.u8() // null bitmap: four columns at offset 2 fits in one byte
  assert.deepEqual([...r.bytes(5)], [0x04, 0xda, 0x07, 0x0a, 0x11], 'DATE, exactly doc 15s dump')
  assert.deepEqual(
    [...r.bytes(12)],
    [0x0b, 0xda, 0x07, 0x0a, 0x11, 0x13, 0x1b, 0x1e, 0x01, 0x00, 0x00, 0x00],
    'DATETIME(6), exactly doc 15s dump',
  )
  const negative = readBinaryTime(r)
  assert.equal(negative.negative, true)
  assert.equal(negative.microsecond, 1)

  const zero = readBinaryTime(r)
  assert.deepEqual(zero, {
    negative: false,
    days: 0,
    hour: 0,
    minute: 0,
    second: 0,
    microsecond: 0,
  })
  assert.equal(r.remaining, 0, 'a length byte of 0 and nothing after it')
})
