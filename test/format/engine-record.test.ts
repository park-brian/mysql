// M4.5 against real bytes: every storage encoding MySQL 8.4 wrote into a binlog
// row image (D-34), packed into records and read back. The codec's inputs are
// what a server produced, not what this repository imagined.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeRecord, encodeRecord, type RecordLayout } from '@myjs/engine'

const corpus = JSON.parse(readFileSync(new URL('./fixtures/storage-encodings.json', import.meta.url), 'utf8')) as {
  columns: { column: string; rows: number[][] }[]
}

test('M4.5: every captured storage encoding round-trips through a record, NULL included', () => {
  const columns = corpus.columns
  // A column is fixed-width if every value MySQL wrote for it had one length.
  const layout: RecordLayout = columns.map((c) => {
    const lengths = new Set(c.rows.map((r) => r.length))
    return lengths.size === 1 ? { nullable: true, fixed: c.rows[0]?.length as number } : { nullable: true }
  })
  const depth = Math.max(...columns.map((c) => c.rows.length))
  let checked = 0
  for (let k = 0; k <= depth; k++) {
    // Row k takes each column's k-th value, and NULL once a column runs out.
    const row = columns.map((c) => (k < c.rows.length ? Uint8Array.from(c.rows[k] as number[]) : null))
    const back = decodeRecord(layout, encodeRecord(layout, row, { maxSize: 1 << 16 }))
    assert.deepEqual(back.map((v) => (v === null ? null : [...(v as Uint8Array)])), row.map((v) => (v === null ? null : [...v])))
    checked += row.filter((v) => v !== null).length
  }
  assert.equal(checked, columns.reduce((n, c) => n + c.rows.length, 0), 'every captured value went through')
  assert.ok(columns.length >= 20)
})
