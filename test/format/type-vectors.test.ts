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
//   `weight-strings.json` — `HEX(WEIGHT_STRING(s LEVELS 1))`, which is exactly
//   what `Collation.sortKey()` must produce. This is the external check on the
//   UCA tables M2.20 generated, and M2.7's outstanding acceptance clause.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { encodeCharset, loadCollation } from '@myjs/charsets'

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
  }
})

interface ColumnVectors {
  readonly column: string
  readonly ddl: string
  readonly values: readonly string[]
  readonly rows: readonly (readonly number[])[]
}

interface EncodingFixture {
  readonly capturedAgainst: string
  readonly framing: string
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
  assert.ok(fixture.columns.length > 0)
  for (const c of fixture.columns) {
    assert.ok(c.ddl.length > 0, `${c.column} must record its DDL`)
    assert.ok(c.rows.length > 0, `${c.column} captured no row images`)
  }
})
