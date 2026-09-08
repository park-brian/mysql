// M2.1, M2.4, M2.17 — the generated collation registry.
//
// Like `error-table.test.ts`, this asserts the *contract* rather than
// freshness: CI regenerates and diffs, so a test that pinned the whole table
// would only ever restate the generator. What is worth asserting here is the
// handful of facts the rest of the engine will be built on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLLATION_TABLE_SIZE,
  COLLATION_TABLE_SOURCE,
  COLLATION_TABLE_SOURCE_SHA256,
  allCollations,
  collationInfo,
  collationInfoByName,
  defaultCollationOf,
  isProhibitedConnectionCollation,
  requireCollationInfo,
  CharsetError,
} from '@myjs/charsets'
import { charsetWidths, charsetWidthTableSize, CHARSET_METRICS_SOURCE_SHA256, isProhibitedConnectionCharset } from '@myjs/protocol'

test('M2.1: every id the roadmap names resolves', () => {
  // The acceptance list from M2.1, with the facts doc 29's table gives.
  const expected: ReadonlyArray<readonly [number, string, string, number, string]> = [
    [8, 'latin1_swedish_ci', 'latin1', 1, 'PAD SPACE'],
    [33, 'utf8mb3_general_ci', 'utf8mb3', 3, 'PAD SPACE'],
    [45, 'utf8mb4_general_ci', 'utf8mb4', 4, 'PAD SPACE'],
    [46, 'utf8mb4_bin', 'utf8mb4', 4, 'PAD SPACE'],
    [63, 'binary', 'binary', 1, 'NO PAD'],
    [224, 'utf8mb4_unicode_ci', 'utf8mb4', 4, 'PAD SPACE'],
    [246, 'utf8mb4_unicode_520_ci', 'utf8mb4', 4, 'PAD SPACE'],
    [255, 'utf8mb4_0900_ai_ci', 'utf8mb4', 4, 'NO PAD'],
    [278, 'utf8mb4_0900_as_cs', 'utf8mb4', 4, 'NO PAD'],
  ]
  for (const [id, name, charset, mbmaxlen, pad] of expected) {
    const info = requireCollationInfo(id)
    assert.equal(info.name, name, `id ${id}`)
    assert.equal(info.charset, charset, `id ${id}`)
    assert.equal(info.mbmaxlen, mbmaxlen, `id ${id}`)
    assert.equal(info.padAttribute, pad, `id ${id}`)
  }
})

test('M2.1: an unknown id gets a typed error, not undefined behaviour', () => {
  assert.equal(collationInfo(9999), undefined)
  assert.throws(() => requireCollationInfo(9999), (err: unknown) => {
    assert.ok(err instanceof CharsetError)
    assert.equal((err as CharsetError).code, 'ER_UNKNOWN_COLLATION')
    return true
  })
})

test('doc 29: id 63 is not a text collation — it is how BLOB is told from TEXT', () => {
  const binary = requireCollationInfo(63)
  assert.equal(binary.charset, 'binary')
  assert.ok(binary.isBinary)
})

test('D-10: utf8mb4 defaults to utf8mb4_0900_ai_ci', () => {
  assert.equal(defaultCollationOf('utf8mb4')?.id, 255)
  assert.equal(defaultCollationOf('latin1')?.id, 8)
  assert.equal(collationInfoByName('utf8mb4_0900_ai_ci')?.id, 255)
})

test('doc 29: the 8.0 family is NO PAD and everything older is PAD SPACE', () => {
  // This is the upgrade surprise doc 29 calls out: `'a' = 'a '` flips.
  for (const info of allCollations()) {
    if (info.name.includes('_0900_') || info.name.includes('_utf8mb4_')) {
      assert.equal(info.padAttribute, 'NO PAD', info.name)
    }
  }
  assert.equal(requireCollationInfo(45).padAttribute, 'PAD SPACE')
  assert.equal(requireCollationInfo(255).padAttribute, 'NO PAD')
})

test('the table is generated, and says so', () => {
  assert.match(COLLATION_TABLE_SOURCE, /^mysql\/mysql-server@[0-9a-f]+ strings\/ctype-\*\.cc$/)
  assert.match(COLLATION_TABLE_SOURCE_SHA256, /^[0-9a-f]{64}$/)
  assert.equal(allCollations().length, COLLATION_TABLE_SIZE)
  assert.ok(COLLATION_TABLE_SIZE > 250, `expected the full compiled set, got ${COLLATION_TABLE_SIZE}`)
})

test('D-33: the protocol width table and the charset registry agree on every id', () => {
  // Two generated artefacts from one parse. If they ever disagree, one of them
  // was edited by hand, which is the failure this test exists to catch.
  assert.equal(CHARSET_METRICS_SOURCE_SHA256, COLLATION_TABLE_SOURCE_SHA256)
  assert.equal(charsetWidthTableSize(), COLLATION_TABLE_SIZE)
  for (const info of allCollations()) {
    const widths = charsetWidths(info.id)
    assert.deepEqual(
      { mbminlen: widths?.mbminlen, mbmaxlen: widths?.mbmaxlen },
      { mbminlen: info.mbminlen, mbmaxlen: info.mbmaxlen },
      `id ${info.id} (${info.name})`,
    )
    assert.equal(isProhibitedConnectionCharset(info.id), isProhibitedConnectionCollation(info.id), `id ${info.id}`)
  }
})

test('M2.17: the generated rule catches id 159, which the hand-written list missed', () => {
  // `ucs2_general_mysql500_ci` is a two-byte charset and so cannot be a
  // connection charset, but it fell outside every range of the list this
  // replaced. D-14's argument, arriving on schedule.
  assert.equal(requireCollationInfo(159).name, 'ucs2_general_mysql500_ci')
  assert.equal(requireCollationInfo(159).mbminlen, 2)
  assert.ok(isProhibitedConnectionCharset(159))
})

test('doc 12: every multibyte charset is refused as a connection charset, and no single-byte one is', () => {
  for (const info of allCollations()) {
    assert.equal(isProhibitedConnectionCharset(info.id), info.mbminlen > 1, `${info.id} ${info.name}`)
  }
  // utf8mb4 is mbminlen 1 — variable width, but ASCII-compatible, so it is fine.
  assert.equal(isProhibitedConnectionCharset(255), false)
  assert.equal(isProhibitedConnectionCharset(8), false)
})

test('an id MySQL does not define is not prohibited — it fails later, by name', () => {
  assert.equal(charsetWidths(9999), undefined)
  assert.equal(isProhibitedConnectionCharset(9999), false)
})
