// M4.5 and M4.6 — records, and the overflow pages a long field moves to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { EngineError, OFF_PAGE_MIN, REF_SIZE, decodeRecord, encodeRecord, externalRefs, type FieldBytes, type RecordLayout } from '@myjs/engine'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** A layout and a row that fits it. */
const rowArb = fc
  .array(fc.record({ nullable: fc.boolean(), fixed: fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined }) }), { minLength: 1, maxLength: 12 })
  .chain((fields) => {
    const layout: RecordLayout = fields.map((f) => (f.fixed === undefined ? { nullable: f.nullable } : { nullable: f.nullable, fixed: f.fixed }))
    const values = layout.map((f) => {
      const bytes = f.fixed === undefined ? fc.uint8Array({ maxLength: 300 }) : fc.uint8Array({ minLength: f.fixed, maxLength: f.fixed })
      return f.nullable ? fc.option(bytes, { nil: null }) : bytes
    })
    return fc.tuple(fc.constant(layout), fc.tuple(...values))
  })

test('M4.5: a record round-trips over arbitrary generated schemas', () => {
  fc.assert(
    fc.property(rowArb, ([layout, row]) => {
      const encoded = encodeRecord(layout, row, { maxSize: 1 << 20 })
      const decoded = decodeRecord(layout, encoded)
      assert.deepEqual(decoded.map((v) => (v === null ? null : hex(v as Uint8Array))), row.map((v) => (v === null ? null : hex(v))))
      assert.deepEqual(externalRefs(layout, encoded), [])
    }),
    { numRuns: 1000 },
  )
})

test('M4.5: an oversized record moves its longest fields off-page, DYNAMIC-style, and still round-trips', () => {
  fc.assert(
    fc.property(rowArb, fc.integer({ min: 64, max: 400 }), ([layout, row], maxSize) => {
      const stored = new Map<string, Uint8Array>()
      const storeExternal = (bytes: Uint8Array) => {
        const ref = new Uint8Array(REF_SIZE)
        new DataView(ref.buffer).setUint32(0, stored.size + 1)
        stored.set(hex(ref), bytes)
        return ref
      }
      let encoded: Uint8Array
      try {
        encoded = encodeRecord(layout, row, { maxSize, storeExternal })
      } catch (e) {
        // Refused only when nothing over 40 bytes is left to move.
        assert.equal((e as EngineError).code, 'ER_TOO_BIG_ROWSIZE')
        return
      }
      assert.ok(encoded.length <= maxSize)
      const decoded = decodeRecord(layout, encoded).map((v) => (v === null || v instanceof Uint8Array ? v : (stored.get(hex(v.ref)) as Uint8Array)))
      assert.deepEqual(decoded.map((v) => (v === null ? null : hex(v))), row.map((v) => (v === null ? null : hex(v))))
      // Only fields over 40 bytes ever went off-page, and every reference is reported.
      for (const bytes of stored.values()) assert.ok(bytes.length > OFF_PAGE_MIN)
      assert.equal(externalRefs(layout, encoded).length, stored.size)
    }),
    { numRuns: 1000 },
  )
})

test('M4.5: a record is a null bitmap, lengths not offsets, then the fields', () => {
  const layout: RecordLayout = [{ nullable: false, fixed: 4 }, { nullable: true }, { nullable: true }, { nullable: false }]
  const row: FieldBytes[] = [Uint8Array.of(1, 2, 3, 4), null, new Uint8Array(200).fill(7), Uint8Array.of(9)]
  const r = encodeRecord(layout, row, { maxSize: 1000 })
  assert.equal(r[0], 0b01, 'the second field is NULL; the first is not nullable and has no bit')
  // 200 needs the two-byte form; 1 does not. No length for the fixed field.
  assert.deepEqual([...r.subarray(1, 4)], [0x80, 200, 1])
  assert.deepEqual([...r.subarray(4, 8)], [1, 2, 3, 4])
  assert.equal(r.length, 1 + 3 + 4 + 200 + 1)
})

test('M4.5: a record that cannot shrink enough is ER_TOO_BIG_ROWSIZE; bytes that are not a record are a typed error', () => {
  const layout: RecordLayout = Array.from({ length: 20 }, () => ({ nullable: false }))
  const row = layout.map(() => new Uint8Array(OFF_PAGE_MIN))
  assert.throws(() => encodeRecord(layout, row, { maxSize: 500, storeExternal: () => new Uint8Array(REF_SIZE) }), (e: EngineError) => e.code === 'ER_TOO_BIG_ROWSIZE')
  fc.assert(
    fc.property(rowArb, fc.uint8Array({ maxLength: 64 }), ([layout], bytes) => {
      try {
        decodeRecord(layout, bytes)
      } catch (e) {
        assert.ok(e instanceof EngineError && e.code === 'ENGINE_CORRUPT_RECORD', String(e))
      }
    }),
    { numRuns: 2000 },
  )
})
