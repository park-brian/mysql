// M2.21 / D-34 — replay the storage-encoding vectors captured from a real MySQL.
//
// Every other test in `test/format/` checks us against a document. These check
// us against a *server*, which is the only kind of check that can catch a place
// where doc 24 and MySQL disagree — or where we read doc 24 the way we already
// believed rather than the way it is written.
//
// Two corpora, both produced by `npm run capture:types`:
//
//   `storage-encodings.json` — binlog row images under `binlog_row_image=FULL`.
//   Doc 24 says the `decimal2bin` form is used identically in `.ibd` files and
//   row images, so these are the storage bytes years before `@myjs/innodb`
//   exists (D-34). The fixture records its framing, because a binlog row image
//   differs from the `.ibd` form in two documented ways.
//
//   `weight-strings.json` — `HEX(WEIGHT_STRING(s COLLATE c))`, which is exactly
//   what `Collation.sortKey()` must produce. This is the external check on the
//   UCA tables M2.20 generated, and M2.7's outstanding acceptance clause.
//   (D-34 writes `LEVELS 1`; the keyword is `LEVEL`, and the clause is
//   unnecessary — see M2.21.)
//
// It has already earned its place. The first corpus it produced disagreed with
// us on `utf8mb4_bin`: MySQL answers `0x000061` for `'a'` and we answered
// `0x61`, because `my_strnxfrm_unicode_full_bin` writes code points rather
// than copying the value. Nothing we could have checked ourselves would have
// found that — every other test compared us against our own reading of a doc.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { encodeCharset, loadCollation } from '@myjs/charsets'
import { FIELD_TYPE } from '@myjs/bytes'
import { decodeJson, decodeStorageValue, type ColumnMeta } from '@myjs/types'

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname

interface WeightVector {
  readonly collation: string
  readonly string: string
  readonly weightString: string
}

interface WeightFixture {
  readonly capturedAgainst: string
  readonly vectors: readonly WeightVector[]
}

function load<T>(name: string): T | null {
  const file = `${FIXTURES}${name}.json`
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('')

test('M2.21: the corpus is visible, empty or not', () => {
  // M2.22's lesson, applied to a second gate: a check that silently passes
  // because it has nothing to check is not a check. If the corpus is empty
  // this says so, loudly and with the command that fills it, rather than
  // reporting a pass that means nothing.
  //
  // It cannot *fail* on an empty corpus, because these fixtures can only come
  // from a real MySQL 8.4 and `npm test` must run with no server and no
  // Docker. The `type-vectors` CI job is what produces them.
  const present = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((f) => f.endsWith('.json')) : []
  if (present.length === 0) {
    console.log(
      '  [type-vectors] no fixtures committed yet — run `npm run capture:types` against a real MySQL 8.4,\n' +
        '                 or download the artifact from the `type-vectors` CI job, and commit them.',
    )
  }
  assert.ok(Array.isArray(present))
})

test('M2.21: our sort keys are the server’s sort keys', async () => {
  const fixture = load<WeightFixture>('weight-strings')
  if (fixture === null) return

  assert.ok(fixture.vectors.length > 0, 'a committed fixture must carry vectors')
  assert.match(fixture.capturedAgainst, /mysql-server/, 'a fixture must name the server it came from')

  const byName: Record<string, number> = {
    utf8mb4_0900_ai_ci: 255,
    utf8mb4_general_ci: 45,
    utf8mb4_bin: 46,
    latin1_swedish_ci: 8,
  }

  let checked = 0
  for (const v of fixture.vectors) {
    const id = byName[v.collation]
    if (id === undefined) continue // a collation we do not implement yet
    const collation = await loadCollation(id)
    const charset = v.collation.startsWith('latin1') ? 'latin1' : 'utf8mb4'
    const actual = hex(collation.sortKey(encodeCharset(v.string, charset)))
    assert.equal(
      actual,
      v.weightString,
      `${v.collation} sortKey(${JSON.stringify(v.string)}) disagrees with ${fixture.capturedAgainst}`,
    )
    checked++
  }
  // M2.22's lesson again: a loop that skips every vector passes. The count is
  // pinned so that dropping a collation from `byName`, or renaming one in the
  // capture tool, fails here instead of quietly checking nothing.
  assert.equal(checked, 24, 'every vector in a collation we implement must be checked')
})

interface ColumnVectors {
  readonly column: string
  readonly ddl: string
  readonly values: readonly string[]
  readonly rows: readonly (readonly number[] | null)[]
}

interface EncodingFixture {
  readonly capturedAgainst: string
  readonly framing: string
  readonly checksum: string
  readonly columns: readonly ColumnVectors[]
}

test('M2.21: the storage-encoding corpus is well formed and records its framing', () => {
  const fixture = load<EncodingFixture>('storage-encodings')
  if (fixture === null) return

  // The framing is the point of D-34, not a label: a binlog row image differs
  // from the `.ibd` form in two documented ways — integers are little-endian
  // and unflipped, and a VARCHAR keeps its length prefix. A vector that did
  // not say which form it was in would be unusable.
  assert.equal(fixture.framing, 'binlog-row-image')
  assert.match(fixture.capturedAgainst, /mysql-server/)
  // Whether the server appended a CRC32, because that is four bytes on the end
  // of every event body and stripping it is the parser's call, not the
  // reader's.
  assert.match(fixture.checksum, /^(CRC32|NONE)$/)
  assert.ok(fixture.columns.length > 0)
  for (const c of fixture.columns) {
    assert.ok(c.ddl.length > 0, `${c.column} must record its DDL`)
    // One row image per value inserted. The first corpus this test accepted
    // had three columns with none at all and the rest one event out of step,
    // because the only assertion was `length > 0` — which a parser that
    // returns the wrong bytes satisfies just as well as one that works.
    assert.equal(
      c.rows.length,
      c.values.length,
      `${c.column} inserted ${c.values.length} value(s) and captured ${c.rows.length} row image(s)`,
    )
  }
})

// --- replaying the storage corpus ------------------------------------------

/**
 * Binlog framing → the `.ibd` framing our decoders take.
 *
 * D-34 accepted binlog row images as a stand-in for `.ibd` records on the
 * strength of doc 24's claim that the `decimal2bin` form is used identically
 * in both, and named the two places that is *not* true. This is those two
 * places, written out — which is the whole reason the fixture records its
 * framing rather than just its bytes.
 */
const framings = {
  /** Identical in both forms: DECIMAL, the floats, the temporals, ENUM/SET/BIT. */
  direct: (b: Uint8Array) => b,
  /**
   * Doc 24 Rule 1, in reverse. A binlog integer is plain little-endian two's
   * complement; a stored one is big-endian with the sign bit flipped, so that
   * `memcmp` orders it. Both steps matter, and doing only one of them is doc
   * 24's own worked warning.
   */
  int: (b: Uint8Array) => {
    const be = Uint8Array.from([...b].reverse())
    be[0] = (be[0] as number) ^ 0x80
    return be
  },
  /** Unsigned integers get the byte reversal and no sign flip. */
  uint: (b: Uint8Array) => Uint8Array.from([...b].reverse()),
  /** A binlog CHAR/VARCHAR keeps a length prefix a stored one does not. */
  len1: (b: Uint8Array) => b.subarray(1),
  /** A binlog BLOB — and so a JSON column — carries a four-byte one. */
  len4: (b: Uint8Array) => b.subarray(4),
} as const

interface ColumnCase {
  readonly type: number
  readonly meta?: Omit<ColumnMeta, 'type'>
  readonly framing: keyof typeof framings
  /** One expected `StorageValue` per value the fixture inserted. */
  readonly expect: readonly unknown[]
}

const dt = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, microsecond = 0) => ({
  year,
  month,
  day,
  hour,
  minute,
  second,
  microsecond,
})

const CASES: Record<string, ColumnCase> = {
  i8: { type: FIELD_TYPE.TINY, framing: 'int', expect: [-128n, 0n, 127n] },
  u8: { type: FIELD_TYPE.TINY, meta: { unsigned: true }, framing: 'uint', expect: [0n, 255n] },
  i32: { type: FIELD_TYPE.LONG, framing: 'int', expect: [-1n, 0n, 1n, -2147483648n, 2147483647n] },
  u32: { type: FIELD_TYPE.LONG, meta: { unsigned: true }, framing: 'uint', expect: [0n, 1n, 4294967295n] },
  i64: {
    type: FIELD_TYPE.LONGLONG,
    framing: 'int',
    expect: [-9223372036854775808n, 0n, 9223372036854775807n],
  },
  // The one that matters most: doc 24's worked `DECIMAL(14,4)` example, now
  // confirmed by a server rather than by a source comment.
  dec: {
    type: FIELD_TYPE.NEWDECIMAL,
    meta: { precision: 14, scale: 4 },
    framing: 'direct',
    expect: ['1234567890.1234', '-1234567890.1234', '0.0000'],
  },
  dec_max: {
    type: FIELD_TYPE.NEWDECIMAL,
    meta: { precision: 65, scale: 30 },
    framing: 'direct',
    expect: ['1.500000000000000000000000000000'],
  },
  f32: { type: FIELD_TYPE.FLOAT, framing: 'direct', expect: [1.5, -1.5, 0] },
  f64: { type: FIELD_TYPE.DOUBLE, framing: 'direct', expect: [1.5, -1.5, 0] },
  d: {
    type: FIELD_TYPE.DATE,
    framing: 'direct',
    expect: [dt(2010, 10, 17), dt(1999, 12, 31), dt(2000, 1, 1)],
  },
  dt0: { type: FIELD_TYPE.DATETIME2, framing: 'direct', expect: [dt(2010, 10, 17, 19, 27, 30)] },
  dt6: {
    type: FIELD_TYPE.DATETIME2,
    meta: { decimals: 6 },
    framing: 'direct',
    expect: [dt(2010, 10, 17, 19, 27, 30, 1)],
  },
  // TIMESTAMP is stored UTC and converted by the session `time_zone` (doc 15),
  // so the decoder returns the neutral struct and this asserts the UTC instant
  // — which also means a container running on a non-UTC clock fails here
  // rather than silently shifting a vector.
  ts6: {
    type: FIELD_TYPE.TIMESTAMP2,
    meta: { decimals: 6 },
    framing: 'direct',
    expect: [{ epochSeconds: Date.UTC(2010, 9, 17, 19, 27, 30) / 1000, microsecond: 1 }],
  },
  t0: {
    type: FIELD_TYPE.TIME2,
    framing: 'direct',
    expect: [
      { negative: false, days: 0, hour: 19, minute: 27, second: 30, microsecond: 0 },
      { negative: true, days: 5, hour: 0, minute: 19, second: 27, microsecond: 0 },
    ],
  },
  t6: {
    type: FIELD_TYPE.TIME2,
    meta: { decimals: 6 },
    framing: 'direct',
    expect: [{ negative: true, days: 5, hour: 0, minute: 19, second: 27, microsecond: 1 }],
  },
  y: { type: FIELD_TYPE.YEAR, framing: 'direct', expect: [2010] },
  e: {
    type: FIELD_TYPE.ENUM,
    meta: { members: ['small', 'medium', 'large'] },
    framing: 'direct',
    expect: ['small', 'large'],
  },
  s: {
    type: FIELD_TYPE.SET,
    meta: { members: ['a', 'b', 'c'] },
    framing: 'direct',
    expect: [['a', 'c'], []],
  },
  b: { type: FIELD_TYPE.BIT, framing: 'direct', expect: [0b101010101n] },
  ch: { type: FIELD_TYPE.STRING, meta: { collationId: 255 }, framing: 'len1', expect: ['ab'] },
  vc: { type: FIELD_TYPE.VAR_STRING, meta: { collationId: 255 }, framing: 'len1', expect: ['ab', 'café'] },
  // Collation 63 is `binary`, which is doc 15's only way to tell VARBINARY
  // from VARCHAR — so this vector is what makes that rule externally checked.
  bin: {
    type: FIELD_TYPE.STRING,
    meta: { collationId: 63 },
    framing: 'len1',
    expect: [Uint8Array.of(0x61, 0x62)],
  },
}

test('M2.21: every captured storage vector decodes to the value that was inserted', () => {
  const fixture = load<EncodingFixture>('storage-encodings')
  if (fixture === null) return

  let checked = 0
  for (const column of fixture.columns) {
    const spec = CASES[column.column]
    if (spec === undefined) continue // handled separately, or not yet decodable
    for (const [i, row] of column.rows.entries()) {
      assert.notEqual(row, null, `${column.column}[${i}] came back NULL`)
      const bytes = framings[spec.framing](Uint8Array.from(row as readonly number[]))
      const actual = decodeStorageValue(spec.type, bytes, { type: spec.type, ...spec.meta })
      assert.deepEqual(
        actual,
        spec.expect[i],
        `${column.column} ${column.ddl} value ${column.values[i]} (${fixture.capturedAgainst})`,
      )
      checked++
    }
  }
  // Pinned, so a fixture that loses a column or a case that loses an entry
  // fails here rather than checking less and passing.
  assert.equal(checked, 45, 'every vector in a type we decode must be checked')
})

test('M2.21: the captured JSON columns are the binary JSON M2.13 reads', () => {
  // Doc 28 quotes no byte dumps at all (M2.15), so until now every JSON vector
  // was derived from its grammar by hand. These three came off a server.
  const fixture = load<EncodingFixture>('storage-encodings')
  if (fixture === null) return
  const js = fixture.columns.find((c) => c.column === 'js')
  assert.ok(js !== undefined, 'the corpus must carry a JSON column')

  const decoded = js.rows.map((r) => decodeJson(framings.len4(Uint8Array.from(r as readonly number[]))))
  // Small integers come back as `number` and only an int64 becomes a
  // `BigInt` — doc 28's inline-literal types are int16/int32, and widening them
  // all to BigInt would make every JSON row awkward to use for no gain.
  assert.deepEqual(decoded[0], { b: 1, a: [1, 2, null] })
  assert.deepEqual(decoded[1], [])
  // The reason this one is in the corpus: 2^53 + 1 is the first integer a
  // double cannot hold, so a reader that goes through `number` returns
  // 9007199254740992 and loses the row's value silently.
  assert.deepEqual(decoded[2], { n: 9007199254740993n })
})
