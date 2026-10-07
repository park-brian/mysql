// M4.7 — the slotted index page: a dense sorted directory, pure binary search.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { EngineError, indexPage as ip } from '@myjs/engine'

const PAGE = 1024
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

test('M4.7: a page agrees with a sorted map under random inserts and deletes, and stays well-formed', () => {
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.boolean(), fc.uint8Array({ minLength: 0, maxLength: 12 }), fc.uint8Array({ maxLength: 40 })), { maxLength: 200 }),
      (ops) => {
        const page = new Uint8Array(PAGE)
        ip.initIndexPage(page, 5, 0, 1)
        const model = new Map<string, string>()
        for (const [insert, key, value] of ops) {
          const { index, found } = ip.search(page, key)
          if (insert && !found && ip.fits(page, key, value)) {
            ip.insertCell(page, index, key, value)
            model.set(hex(key), hex(value))
          } else if (!insert && found) {
            ip.removeCell(page, index)
            model.delete(hex(key))
          }
          ip.validateIndexPage(page, 5)
        }
        const keys = [...model.keys()].sort()
        assert.equal(ip.cellCount(page), keys.length)
        keys.forEach((k, i) => {
          const c = ip.cell(page, i)
          assert.equal(hex(c.key), k)
          assert.equal(hex(c.value), model.get(k))
        })
      },
    ),
    { numRuns: 300 },
  )
})

test('M4.7: lookup is pure binary search — at most ⌈log2 n⌉+1 key comparisons, no linear tail', () => {
  const page = new Uint8Array(16384)
  ip.initIndexPage(page, 5, 0, 1)
  for (let i = 0; i < 1000; i++) {
    const key = Uint8Array.from([i >> 8, i & 0xff])
    ip.insertCell(page, ip.search(page, key).index, key, new Uint8Array(0))
  }
  // Count comparisons through a key whose reads are observable.
  let reads = 0
  const counting = new Proxy(Uint8Array.from([0x02, 0x9a]), {
    get(target, prop, receiver) {
      if (prop === 'length') reads++
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  const { found, index } = ip.search(page, counting as unknown as Uint8Array)
  assert.equal(found, true)
  assert.equal(index, 0x29a)
  assert.ok(reads <= 2 * (Math.ceil(Math.log2(1000)) + 2), `${reads} reads of the search key`)
})

test('M4.7: a deleted cell is garbage until an insert needs the room, then the heap is compacted', () => {
  const page = new Uint8Array(PAGE)
  ip.initIndexPage(page, 5, 0, 1)
  const big = new Uint8Array(250)
  for (const k of [1, 2, 3]) ip.insertCell(page, ip.search(page, Uint8Array.of(k)).index, Uint8Array.of(k), big)
  ip.removeCell(page, 1)
  assert.ok(ip.garbage(page) > 0)
  assert.ok(ip.freeSpace(page) < 255 && ip.fits(page, Uint8Array.of(9), big), 'fits only by reclaiming garbage')
  ip.insertCell(page, 2, Uint8Array.of(9), big)
  assert.equal(ip.garbage(page), 0)
  ip.validateIndexPage(page, 5)
  assert.deepEqual([0, 1, 2].map((i) => ip.keyAt(page, i)[0]), [1, 3, 9])
})

test('M4.7: a corrupt page is a typed error, whatever its bytes', () => {
  fc.assert(
    fc.property(fc.uint8Array({ minLength: PAGE, maxLength: PAGE }), (bytes) => {
      bytes[16] = 3
      try {
        ip.validateIndexPage(bytes, 1)
      } catch (e) {
        assert.ok(e instanceof EngineError, String(e))
      }
    }),
    { numRuns: 2000 },
  )
})

test('review: an internal page with no children, or without the empty first key, is corrupt', () => {
  const empty = new Uint8Array(PAGE)
  ip.initIndexPage(empty, 4, 1, 1)
  assert.throws(() => ip.validateIndexPage(empty, 4), /no children/)
  const keyed = new Uint8Array(PAGE)
  ip.initIndexPage(keyed, 4, 1, 1)
  ip.insertCell(keyed, 0, Uint8Array.of(5), ip.childValue(9))
  assert.throws(() => ip.validateIndexPage(keyed, 4), /empty key/)
})
