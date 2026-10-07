// `@myjs/engine` writes its client-facing errnos out rather than depending on
// `@myjs/protocol`'s generated table, as `@myjs/parser` and `@myjs/types` do;
// this keeps the copy honest.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVfs } from '@myjs/vfs'
import { errnoOf, sqlStateOf } from '@myjs/protocol'
import { declaredKeyWidth } from '@myjs/types'
import { BTree, ClusteredIndex, EngineError, SecondaryIndex, Store, encodeRecord } from '@myjs/engine'

/** The engine error `fn` throws; it must throw one. */
const caught = (fn: () => unknown): EngineError => {
  try {
    fn()
  } catch (e) {
    assert.ok(e instanceof EngineError)
    return e
  }
  assert.fail('expected an EngineError')
}

test('engine errnos and SQLSTATEs agree with the generated error table', async () => {
  const store = Store.create(await new MemoryVfs({ pageSize: 1024 }).open('d', { create: true }), { frames: 16 })
  const clustered = ClusteredIndex.create(store, [{ nullable: false, fixed: 1 }, { nullable: true }], [{ field: 0, part: { kind: 'bytes', nullable: false } }])
  clustered.insert([Uint8Array.of(1), null])
  const errors = [
    () => clustered.insert([Uint8Array.of(1), null]),
    () => SecondaryIndex.create(store, clustered, [{ field: 1, part: { kind: 'text', nullable: true, collationId: 46, width: declaredKeyWidth(46, 300) } }]),
    () => encodeRecord([{ nullable: false, fixed: 600 }], [new Uint8Array(600)], { maxSize: 100 }),
    () => store.createTree().put(new Uint8Array(BTree.maxKey(1024) + 1), new Uint8Array(0)),
  ].map(caught)
  assert.deepEqual(errors.map((e) => e.code), ['ER_DUP_ENTRY', 'ER_TOO_LONG_KEY', 'ER_TOO_BIG_ROWSIZE', 'ER_TOO_LONG_KEY'])
  for (const e of errors) {
    assert.equal(e.errno, errnoOf(e.code), e.code)
    assert.equal(e.sqlState, sqlStateOf(e.code), e.code)
  }
})
