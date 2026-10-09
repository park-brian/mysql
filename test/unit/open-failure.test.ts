// A database that fails to open leaves no file open behind it.
//
// `MySQL.open()` opens `data` and `log`, then hands them to the store, which
// recovers. When recovery throws — a data file that is not ours — the two
// handles were left open, so the same instance could not open them again
// cleanly. A VFS that counts its handles shows it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'
import { MemoryVfs, type Vfs, type VfsFile } from '@myjs/vfs'

function counting(inner: Vfs): { vfs: Vfs; open: () => number } {
  let open = 0
  const vfs: Vfs = Object.create(inner) as Vfs
  vfs.open = async (path, opts) => {
    const file = await inner.open(path, opts)
    open++
    const wrapped: VfsFile = Object.create(file) as VfsFile
    wrapped.close = () => {
      open--
      file.close()
    }
    return wrapped
  }
  return { vfs, open: () => open }
}

test('a data file that fails recovery is closed again, with its log', async () => {
  const memory = new MemoryVfs()
  const junk = await memory.open('data', { create: true })
  junk.writePage(0, new Uint8Array(junk.pageSize).fill(0xa5))
  junk.close()
  const { vfs, open } = counting(memory)
  await assert.rejects(MySQL.open(':memory:', { vfs }))
  assert.equal(open(), 0, 'a handle was left open')
})
