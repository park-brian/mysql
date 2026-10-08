// CREATE TEMPORARY TABLE's storage: the schemas that hold a session's
// temporary tables live in the store, and a process that ended without
// dropping them leaves them there. The next executor over the store drops
// them before it serves anyone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Catalog, Store } from '@myjs/engine'
import { MemoryVfs, type Vfs, type VfsFile } from '@myjs/vfs'
import { SqlExecutor } from '../../packages/core/src/sql/executor.ts'

const files = async (vfs: Vfs): Promise<[VfsFile, VfsFile]> => [await vfs.open('data', { create: true }), await vfs.open('log', { create: true })]

test('temporary tables a crash left behind are dropped when an executor opens the store', async () => {
  const store = Store.create(...(await files(new MemoryVfs())), { frames: 64 })
  const catalog = Catalog.open(store)
  catalog.createSchema('app')
  catalog.createSchema('#tmp#7#0')
  catalog.createTable('#tmp#7#0', { name: 't', columns: [{ name: 'a', type: { type: 3 }, nullable: true }] })
  new SqlExecutor({ catalog })
  assert.deepEqual(
    catalog.schemas().map((s) => s.name),
    ['app'],
  )
})
