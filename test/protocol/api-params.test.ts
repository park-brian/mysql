// M5.36 — doc 42's query API: values, parameters and transactions.
//
// What it pins: that a value given to `db.query()` is written into the SQL as
// `mysql2`'s `format` writes it, and one given to `db.execute()` is sent as
// `mysql2` sends it, so the same call through both gives back the same
// answer — strings with quotes, backslashes and control characters, numbers,
// bigints, booleans, NULL, `Date`s in each zone, bytes, arrays as IN lists
// and rows, `??` names, objects as JSON; a parameter count that does not
// match the statement is refused by the server, as it is under `mysql2`.
// Then the one place the API departs from `mysql2` on purpose: under
// NO_BACKSLASH_ESCAPES a quote is doubled rather than escaped, so a string
// with a quote and a backslash still arrives whole. And the transaction
// helpers: `transaction()` commits on return and rolls back on a throw,
// `begin()`'s `commit()` and `rollback()` end its connection, and a
// transaction that failed with 1213 runs again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL, QueryError } from '@myjs/core'

function plain(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (v instanceof Date) return `Date(${v.getTime()})`
  if (v instanceof Uint8Array) return `bytes(${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')})`
  if (Array.isArray(v)) return v.map(plain)
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]))
  return v
}

async function outcome(run: () => Promise<[unknown, unknown]>): Promise<unknown> {
  try {
    const [rows] = await run()
    if (Array.isArray(rows)) return plain(rows)
    const h = rows as Record<string, unknown>
    return { affectedRows: h['affectedRows'], insertId: h['insertId'], info: h['info'], warningStatus: h['warningStatus'] }
  } catch (e) {
    const err = e as { errno?: number; sqlMessage?: string; message: string }
    return err.errno === undefined ? { thrown: err.message } : { errno: err.errno, sqlMessage: err.sqlMessage }
  }
}

/** `values` with each `Uint8Array` as the `Buffer` `mysql2` expects. */
const forMysql2 = (values: readonly unknown[]): unknown[] =>
  values.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : Array.isArray(v) ? forMysql2(v) : v))

const CALLS: readonly (readonly [string, readonly unknown[]])[] = [
  ['SELECT ? AS a, ? AS b, ? AS c', ["it's", 'back\\slash', 'line\nbreak\ttab\0nul\x1a"q"']],
  ['SELECT ? AS n, ? AS f, ? AS neg, ? AS big', [42, 1.5, -7, 12345678901234567890n]],
  ['SELECT ? AS t, ? AS f, ? AS z', [true, false, null]],
  ['SELECT ? AS d', [new Date(2020, 1, 29, 13, 14, 15, 678)]],
  ['SELECT ? AS bytes', [new Uint8Array([0, 1, 0xfe, 0xff])]],
  ['SELECT id FROM t WHERE id IN (?) ORDER BY id', [[1, 3, 5]]],
  ['INSERT INTO t (id, s) VALUES ?', [[[10, 'ten'], [11, "el'even"]]]],
  ['SELECT ?? FROM ?? WHERE ?? = ?', [['id', 's'], 't', 'id', 10]],
  ['SELECT s FROM t WHERE s = ? AND id > ?', ["el'even", 0]],
  ["SELECT '?' AS q, `?` AS w, ? AS v FROM (SELECT 1 AS `?`) x -- ?\n", ['v']],
  ['SELECT ? AS one', [1, 2]],
  ['SELECT ? AS one, ? AS two', [1]],
  ['UPDATE t SET s = ? WHERE id = ?', ['changed', 1]],
  ['SELECT * FROM t ORDER BY id', []],
]

const EXECUTES: readonly (readonly [string, readonly unknown[]])[] = [
  ['SELECT ? AS a, ? AS b', ["it's", 'back\\slash']],
  ['SELECT ? AS n, ? AS f, ? AS t, ? AS z', [42, 1.5, true, null]],
  ['SELECT ? + 1 AS sum, CONCAT(?, ?) AS cat', [41, 'a', 'b']],
  ['SELECT ? AS d', [new Date(2020, 1, 29, 13, 14, 15, 678)]],
  ['SELECT HEX(?) AS h', [new Uint8Array([0, 1, 0xfe, 0xff])]],
  ['SELECT JSON_EXTRACT(?, "$.a") AS j, JSON_LENGTH(?) AS l', [{ a: [1, 2] }, [1, 2, 3]]],
  ['SELECT ? AS big', [12345678901234567890n]],
  ['INSERT INTO t (id, s, d) VALUES (?, ?, ?)', [20, 'twenty', new Date(2001, 0, 2, 3, 4, 5)]],
  ['SELECT id, s, d FROM t WHERE id = ?', [20]],
  ['SELECT ? AS one', [1, 2]],
  ['SELECT ? AS one, ? AS two', [1]],
  ['DELETE FROM t WHERE id >= ?', [10]],
]

for (const timezone of ['local', 'Z', '-08:00']) {
  test(`M5.36: values and parameters are sent as mysql2 sends them (timezone ${timezone})`, async () => {
    const ours = await MySQL.open(':memory:')
    const theirs = await MySQL.open(':memory:')
    const conn = await mysql.createConnection({ stream: theirs.createStream() as never, user: 'root', password: '', timezone })
    const api = await ours.connect({ timezone })
    try {
      for (const setup of ['CREATE DATABASE app', 'USE app', 'CREATE TABLE t (id INT PRIMARY KEY, s VARCHAR(20), d DATETIME(3))', "INSERT INTO t (id, s) VALUES (1, 'one'), (3, 'three'), (5, 'five')"]) {
        await api.query(setup)
        await conn.query(setup)
      }
      for (const [sql, values] of CALLS) {
        assert.deepEqual(await outcome(() => api.query(sql, values)), await outcome(() => conn.query(sql, forMysql2(values)) as Promise<[unknown, unknown]>), `query: ${sql}`)
      }
      for (const [sql, values] of EXECUTES) {
        assert.deepEqual(await outcome(() => api.execute(sql, values)), await outcome(() => conn.execute(sql, forMysql2(values) as never) as Promise<[unknown, unknown]>), `execute: ${sql}`)
      }
    } finally {
      await conn.end()
      await api.end()
      await ours.end()
      await theirs.end()
    }
  })
}

test('M5.36: under NO_BACKSLASH_ESCAPES a query value is quoted by doubling, and arrives whole', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query("SET sql_mode = 'NO_BACKSLASH_ESCAPES'")
    const [rows] = await db.query('SELECT ? AS s', ["it's a \\ back'slash"])
    assert.deepEqual(rows, [{ s: "it's a \\ back'slash" }])
    // A plain object is refused rather than guessed at.
    await assert.rejects(db.query('SELECT ?', [{ a: 1 }]), TypeError)
  } finally {
    await db.end()
  }
})

test('M5.36: transaction() commits on return and rolls back on a throw; begin() ends its connection', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE app')
    await db.query('CREATE TABLE app.t (id INT PRIMARY KEY)')
    const value = await db.transaction(async (tx) => {
      await tx.execute('INSERT INTO app.t VALUES (?)', [1])
      return 'done'
    })
    assert.equal(value, 'done')
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.execute('INSERT INTO app.t VALUES (?)', [2])
        throw new Error('no')
      }),
      /no/,
    )
    await assert.rejects(db.transaction((tx) => tx.query('INSERT INTO app.t VALUES (1)')), (e: QueryError) => e.code === 'ER_DUP_ENTRY' && e.errno === 1062 && e.sqlState === '23000')
    assert.deepEqual((await db.query('SELECT id FROM app.t'))[0], [{ id: 1 }])
    const before = db.openConnections
    const tx = await db.begin({ isolation: 'READ COMMITTED' })
    await tx.query('INSERT INTO app.t VALUES (3)')
    await tx.rollback()
    assert.equal(db.openConnections, before, 'rollback ended the connection')
    const again = await db.begin()
    await again.execute('INSERT INTO app.t VALUES (?)', [4])
    await again.commit()
    assert.deepEqual((await db.query('SELECT id FROM app.t ORDER BY id'))[0], [{ id: 1 }, { id: 4 }])
  } finally {
    await db.end()
  }
})

test('M5.36: a transaction that failed with ER_LOCK_DEADLOCK runs again, up to its retries', async () => {
  const db = await MySQL.open(':memory:')
  try {
    await db.query('CREATE DATABASE app')
    await db.query('CREATE TABLE app.t (id INT PRIMARY KEY)')
    let attempts = 0
    // The error the engine raises for a snapshot older than it keeps, made here
    // because nothing short of a long-lived reader under churn provokes it.
    const deadlock = async () => {
      throw new QueryError({ errno: 1213, sqlState: '40001', sqlMessage: 'Deadlock found when trying to get lock; try restarting transaction' } as never, '')
    }
    const value = await db.transaction(async (tx) => {
      attempts++
      await tx.execute('INSERT INTO app.t VALUES (?)', [attempts])
      if (attempts < 3) await deadlock()
      return attempts
    })
    assert.equal(value, 3)
    assert.deepEqual((await db.query('SELECT id FROM app.t'))[0], [{ id: 3 }], 'the failed attempts were rolled back')
    attempts = 0
    await assert.rejects(
      db.transaction(
        async () => {
          attempts++
          await deadlock()
        },
        { retries: 1 },
      ),
      (e: QueryError) => e.errno === 1213,
    )
    assert.equal(attempts, 2)
  } finally {
    await db.end()
  }
})

test('M5.36: connect() signs in with a password through caching_sha2_password; a wrong one is 1045', async () => {
  const { MapAccountStore } = await import('@myjs/protocol')
  const accounts = new MapAccountStore()
  await accounts.add('root', '')
  await accounts.add('app', 's3cret')
  const db = await MySQL.open(':memory:', { accounts, user: 'app', password: 's3cret' })
  try {
    assert.deepEqual((await db.query('SELECT CURRENT_USER() AS u'))[0], [{ u: 'app@localhost' }])
    await assert.rejects(db.connect({ password: 'wrong' }), (e: QueryError) => e.code === 'ER_ACCESS_DENIED_ERROR' && e.errno === 1045)
    const again = await db.connect()
    assert.deepEqual((await again.query('SELECT 1 AS x'))[0], [{ x: 1 }])
    await again.end()
  } finally {
    await db.end()
  }
})
