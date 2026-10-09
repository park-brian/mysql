// Every name the function registry holds is compiled by its family.
//
// Each family exports its names and a compiler, and the registry routes by
// name. A name left in a family's set after its case was removed, or added
// without one, reaches the family's `default`, which throws an internal
// error. Calling each name with zero to three arguments must give a value or
// a SQL error (a wrong argument count, a bad argument), never that.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MySQL } from '@myjs/core'
import { functionNames } from '../../packages/core/src/sql/registry.ts'

test('every registered function is compiled by its family', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await db.connect()
  const names = [...functionNames()]
  assert.ok(names.length > 150, `only ${names.length} functions registered`)
  const faults: string[] = []
  for (const name of names) {
    for (const args of ['', "'2024-01-02'", "'2024-01-02', 1", "'a', 'b', 'c'"]) {
      try {
        await conn.query(`SELECT ${name}(${args})`)
      } catch (e) {
        const err = e as { errno?: number; message: string }
        if (err.errno === undefined || /registered but its family does not compile it/.test(err.message)) faults.push(`${name}(${args}): ${err.message}`)
      }
    }
  }
  assert.deepEqual(faults, [])
  await db.end()
})
