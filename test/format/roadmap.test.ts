// The roadmap's "Status at a glance" is counted, not written.
//
// It said M5 was 11 of 25 when its table held 36 items, 23 of them done: a
// summary edited by hand drifts from the table it summarises (D-03's reason
// for editing the roadmap with the work). This recounts every milestone's
// work items from their tables and holds the summary to the count: done
// items, total items, and the glyph — ☑ when every item not deferred is done,
// ☐ when none has begun, ◐ otherwise.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ROADMAP = readFileSync(new URL('../../docs/44-roadmap.md', import.meta.url), 'utf8')

/** A table row's cells, a `\|` inside a cell kept as part of it. */
const cells = (line: string): string[] =>
  line
    .replace(/\\\|/g, '\u0000')
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim().replace(/\u0000/g, '|'))

/** Each milestone's work-item statuses, read from the `St` column of its table. */
function statuses(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let column = -1
  for (const line of ROADMAP.split('\n')) {
    if (!line.startsWith('|')) continue
    const row = cells(line)
    if (row[0] === '#') column = row.indexOf('St')
    const id = /^M(\d+)\.\d+$/.exec(row[0] ?? '')
    if (id === null || column < 0) continue
    const glyph = row[column] as string
    assert.match(glyph, /^[☐◐☑⊘]$/, `${row[0]} has status '${glyph}'`)
    const key = `M${id[1]}`
    out.set(key, [...(out.get(key) ?? []), glyph])
  }
  return out
}

test('Status at a glance agrees with the work-item tables', () => {
  const counted = statuses()
  const summary = new Map<string, { done: number; total: number; glyph: string }>()
  for (const line of ROADMAP.split('\n')) {
    const row = cells(line)
    const id = /^\*\*(M\d+)\*\*$/.exec(row[0] ?? '')
    if (id === null) continue
    const [done, total] = (row[3] as string).split('/').map((n) => Number(n.trim()))
    summary.set(id[1] as string, { done: done as number, total: total as number, glyph: row[4] as string })
  }
  assert.ok(summary.size >= 9, 'the summary lists every milestone')
  let done = 0
  let total = 0
  for (const [milestone, glyphs] of counted) {
    const want = summary.get(milestone)
    assert.ok(want !== undefined, `${milestone} is missing from Status at a glance`)
    const ticked = glyphs.filter((g) => g === '☑').length
    const live = glyphs.filter((g) => g !== '⊘')
    const glyph = live.every((g) => g === '☑') ? '☑' : live.every((g) => g === '☐') ? '☐' : '◐'
    assert.deepEqual(want, { done: ticked, total: glyphs.length, glyph }, milestone)
    done += ticked
    total += glyphs.length
  }
  const totals = /\| \*\*Total\*\* \| \*\*(\d+) \/ (\d+)\*\* \|/.exec(ROADMAP)
  assert.ok(totals !== null, 'the summary has a total')
  assert.deepEqual([Number(totals[1]), Number(totals[2])], [done, total], 'the total')
})
