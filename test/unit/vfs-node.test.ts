// M4.26 — the Node VFS passes the suite memory passes, and `MySQL.open('./data')`
// is a database on disk: what it stores survives `end()`, survives a process
// that never called `end()`, and is refused to a second owner while open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'
import { vfsConformanceCases } from '@myjs/vfs'
import { NodeVfs } from '@myjs/vfs/node'
import { MySQL } from '@myjs/core'

const dirs: string[] = []
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'myjs-vfs-'))
  dirs.push(d)
  return d
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

for (const c of vfsConformanceCases) {
  test(`node VFS: ${c.name}`, async () => {
    await c.run(() => new NodeVfs(fresh()))
  })
}

test('M4.26: a path outside the database is refused, not normalised away', async () => {
  const vfs = new NodeVfs(fresh())
  await assert.rejects(vfs.open('/../escape', { create: true }), (e: unknown) => (e as { code?: string }).code === 'VFS_BAD_PATH')
})

async function rows(db: MySQL, sql: string): Promise<unknown> {
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '' })
  try {
    const [r] = await conn.query(sql)
    return r
  } finally {
    await conn.end()
  }
}

test('M4.26: MySQL.open(path) is a database on disk, and it is there after end() and a reopen', async () => {
  const dir = fresh()
  const db = await MySQL.open(dir)
  await rows(db, 'CREATE DATABASE app')
  await rows(db, 'CREATE TABLE app.t (id INT PRIMARY KEY, v VARCHAR(10))')
  await rows(db, "INSERT INTO app.t VALUES (1, 'one'), (2, 'two')")
  await db.end()
  assert.ok(readdirSync(dir).includes('data') && readdirSync(dir).includes('log'), 'two files on disk, not memory')

  const again = await MySQL.open(pathToFileURL(dir).href)
  assert.deepEqual(await rows(again, 'SELECT id, v FROM app.t'), [
    { id: 1, v: 'one' },
    { id: 2, v: 'two' },
  ])
  await again.end()
})

test('M4.26: a directory open in one instance is refused to another, and free again after end()', async () => {
  const dir = fresh()
  const db = await MySQL.open(dir)
  await assert.rejects(MySQL.open(dir), (e: unknown) => (e as { code?: string }).code === 'VFS_LOCKED')
  await db.end()
  const again = await MySQL.open(dir)
  await again.end()
})

test('M4.26: a process that exits without end() loses no committed row', async () => {
  // A child process commits, then exits with the database still open — no
  // checkpoint, no close. Recovery on the next open replays the log.
  const dir = fresh()
  const script = `
    import mysql from 'mysql2/promise'
    import { MySQL } from '@myjs/core'
    const db = await MySQL.open(${JSON.stringify(dir)})
    const c = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
    await c.query('CREATE DATABASE app')
    await c.query('CREATE TABLE app.t (id INT PRIMARY KEY)')
    await c.query('INSERT INTO app.t VALUES (1), (2), (3)')
    await c.query('BEGIN')
    await c.query('INSERT INTO app.t VALUES (4)')
    process.exit(0)
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  const db = await MySQL.open(dir)
  assert.deepEqual(await rows(db, 'SELECT id FROM app.t'), [{ id: 1 }, { id: 2 }, { id: 3 }], 'the committed rows, and not the open transaction')
  await db.end()
})

test('M4.26 review: a lock file whose owner is dead is taken over; one whose owner lives is not', async () => {
  const { writeFileSync, existsSync } = await import('node:fs')
  const dir = fresh()
  const file = join(dir, `.myjs-lock-${encodeURIComponent('/database')}`)
  // A pid far above any kernel's pid_max: never running.
  writeFileSync(file, '2147483646')
  const db = await MySQL.open(dir)
  await db.end()
  assert.equal(existsSync(file), false, 'released on end()')
  // The parent of this test process is alive and is not this process.
  writeFileSync(file, String(process.ppid))
  await assert.rejects(MySQL.open(dir), (e: unknown) => (e as { code?: string }).code === 'VFS_LOCKED')
  assert.equal(readFileSync(file, 'utf8'), String(process.ppid), "a live owner's lock is left exactly as it was")
})
