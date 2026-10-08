// M4.13 — the record format: page diffs, images, and the logical row images
// D-25 asks for from the log's first version.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { EngineError, applyPage, decodeGroup, diffPage, encodeGroup, groupLength, type Redo } from '@myjs/engine'

const PAGE = 512
const masked = (i: number) => i < 4 || (i >= 8 && i < 16) || i >= PAGE - 8

const pagePair = fc.tuple(fc.uint8Array({ minLength: PAGE, maxLength: PAGE }), fc.array(fc.tuple(fc.nat(PAGE - 1), fc.nat(255)), { maxLength: 40 }))

test('M4.13: a diff applied to the page it was taken from gives the new page, outside the frame bookkeeping', () => {
  fc.assert(
    fc.property(pagePair, fc.boolean(), ([before, edits], image) => {
      const after = before.slice()
      for (const [at, v] of edits) after[at] = v
      const runs = diffPage(image ? null : before, after)
      const target = before.slice()
      applyPage(target, { image, runs }, 7)
      for (let i = 0; i < PAGE; i++) {
        if (masked(i)) assert.equal(target[i], image ? 0 : before[i], `masked byte ${i} is never logged`)
        else assert.equal(target[i], after[i], `byte ${i}`)
      }
      for (const r of runs) for (let i = r.at; i < r.at + r.bytes.length; i++) assert.ok(!masked(i), `a run covers frame byte ${i}`)
    }),
  )
})

test('M4.13: an unchanged page has no runs, and nearby changes share one', () => {
  const page = new Uint8Array(PAGE).fill(5)
  assert.deepEqual(diffPage(page, page.slice()), [])
  const after = page.slice()
  after[100] = 1
  after[104] = 1
  after[200] = 1
  assert.deepEqual(
    diffPage(page, after).map((r) => [r.at, r.bytes.length]),
    [
      [100, 5],
      [200, 1],
    ],
  )
})

test('M4.13: a group round-trips, and its length is known from its first bytes', () => {
  const records: Redo[] = [
    { type: 'page', pageNo: 70000, image: true, runs: [{ at: 4, bytes: Uint8Array.of(1, 2) }, { at: 300, bytes: new Uint8Array(300).fill(9) }] },
    { type: 'meta', pageCount: 2 ** 40, nextIndexId: 3, nextTrxId: 5 },
    { type: 'row', indexId: 5, trxId: 9, before: null, after: [Uint8Array.of(1), null, new Uint8Array(70000)] },
    { type: 'row', indexId: 5, trxId: 9, before: [new Uint8Array(0), null], after: null },
  ]
  const bytes = encodeGroup(records)
  assert.equal(groupLength(bytes), bytes.length)
  assert.equal(groupLength(bytes.subarray(0, 1)), undefined, 'a cut-off prefix is not yet a length')
  assert.deepEqual(decodeGroup(bytes), records)
})

test('M4.13: any bytes decode to a group or ENGINE_CORRUPT_LOG — never a crash', () => {
  const valid = encodeGroup([{ type: 'page', pageNo: 9, image: false, runs: [{ at: 40, bytes: Uint8Array.of(7) }] }, { type: 'meta', pageCount: 64, nextIndexId: 2, nextTrxId: 5 }])
  fc.assert(
    fc.property(fc.array(fc.tuple(fc.nat(valid.length - 1), fc.nat(255)), { minLength: 1, maxLength: 4 }), (edits) => {
      const bytes = valid.slice()
      for (const [at, v] of edits) bytes[at] = v
      try {
        const n = groupLength(bytes)
        if (n !== undefined && n <= bytes.length) decodeGroup(bytes.subarray(0, n))
      } catch (e) {
        assert.ok(e instanceof EngineError && e.code === 'ENGINE_CORRUPT_LOG', String(e))
      }
    }),
  )
  assert.throws(() => decodeGroup(Uint8Array.of(2, 99, 15)), (e: EngineError) => e.code === 'ENGINE_CORRUPT_LOG')
  // A run that would write the checksum or the LSNs is refused, not applied.
  assert.throws(() => applyPage(new Uint8Array(PAGE), { image: false, runs: [{ at: 0, bytes: Uint8Array.of(1) }] }, 3), (e: EngineError) => e.code === 'ENGINE_CORRUPT_LOG')
  assert.throws(() => applyPage(new Uint8Array(PAGE), { image: false, runs: [{ at: PAGE - 9, bytes: Uint8Array.of(1, 2) }] }, 3), (e: EngineError) => e.code === 'ENGINE_CORRUPT_LOG')
})

test('a diff skipping equal words gives the runs a byte-at-a-time diff gives, aligned or not', () => {
  // The reference: the definition, one byte at a time.
  const reference = (before: Uint8Array | null, after: Uint8Array): [number, number[]][] => {
    const out: [number, number[]][] = []
    const at = (i: number) => (before === null ? 0 : (before[i] as number))
    const regions: [number, number][] = [
      [4, 8],
      [16, after.length - 8],
    ]
    for (const [from, to] of regions) {
      let i = from
      while (i < to) {
        if (after[i] === at(i)) {
          i++
          continue
        }
        const start = i
        let end = i + 1
        for (let j = end; j < to && j - end < 8; j++) if (after[j] !== at(j)) end = j + 1
        out.push([start, [...after.slice(start, end)]])
        i = end
      }
    }
    return out
  }
  fc.assert(
    fc.property(pagePair, fc.boolean(), fc.nat(3), fc.nat(3), fc.boolean(), ([base, edits], image, shiftA, shiftB, sparse) => {
      // Mostly-zero pages too, which is what an image of a fresh page is.
      const before0 = sparse ? new Uint8Array(PAGE) : base
      const after0 = before0.slice()
      for (const [at, v] of edits) after0[at] = v
      // Views at every alignment, over buffers with room on either side.
      const view = (src: Uint8Array, shift: number) => {
        const buf = new Uint8Array(PAGE + 8).fill(0xee)
        buf.set(src, shift)
        return buf.subarray(shift, shift + PAGE)
      }
      const before = view(before0, shiftA)
      const after = view(after0, shiftB)
      const got = diffPage(image ? null : before, after).map((r) => [r.at, [...r.bytes]])
      assert.deepEqual(got, reference(image ? null : before, after))
    }),
    { numRuns: 500 },
  )
})
