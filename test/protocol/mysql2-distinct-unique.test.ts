// M5.49: metadata coverage cannot replace a local whole-key uniqueness proof.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const FIELDS: unknown[][][] = [[["id",8,20,20483,0,63,"unique78","pa","pa","id"]],[["id",8,20,20483,0,63,"unique78","pa","pa","id"],["name",253,48,20485,0,224,"unique78","pa","pa","name"]],[["id",8,20,20483,0,63,"unique78","pa","pa","id"],["id",8,20,20483,0,63,"unique78","pa","pa","id"]],[["id",8,20,20483,0,63,"unique78","pa","pa","id"],["CONCAT(name,'x')",253,52,0,31,224,"","","",""]],[["g",3,11,16388,0,63,"unique78","pa","pa","g"]],[["CAST(id AS SIGNED)",8,21,129,0,63,"","","",""]],[["CAST(id AS SIGNED)",8,21,1,0,63,"","","","CAST(id AS SIGNED)"]],[["x",3,11,0,0,63,"unique78","dup","dup","x"],["y",253,20,0,0,224,"unique78","dup","dup","y"]],[["id",8,20,20483,0,63,"unique78","p","pa","id"],["n",8,20,128,0,63,"","","",""]]]
const CASES: { sql: string; prepare: number; fields?: number; rows: (string | number | null)[][][] }[] = [{"sql":"SELECT DISTINCT id FROM pa ORDER BY 1","prepare":0,"fields":0,"rows":[[["9007199254740993"],["9007199254740994"],["9007199254740995"],["9007199254740996"]],[["9007199254740993"],["9007199254740994"],["9007199254740995"],["9007199254740996"]],[["9007199254740994"],["9007199254740995"],["9007199254740996"]],[["9007199254740993"],["9007199254740994"],["9007199254740995"],["9007199254740996"]]]},{"sql":"SELECT DISTINCT id,name FROM pa ORDER BY name,id LIMIT 2 OFFSET 1","prepare":1,"fields":1,"rows":[[["9007199254740994","b"],["9007199254740995","c"]],[["9007199254740995","c"],["9007199254740996","d"]],[["9007199254740995","c"],["9007199254740996","d"]],[["9007199254740994","b"],["9007199254740995","c"]]]},{"sql":"SELECT DISTINCT id,id FROM pa ORDER BY id LIMIT 1","prepare":2,"fields":2,"rows":[[["9007199254740993","9007199254740993"]],[["9007199254740993","9007199254740993"]],[["9007199254740994","9007199254740994"]],[["9007199254740993","9007199254740993"]]]},{"sql":"SELECT DISTINCT id,CONCAT(name,'x') FROM pa ORDER BY 1","prepare":3,"fields":3,"rows":[[["9007199254740993","ax"],["9007199254740994","bx"],["9007199254740995","cx"],["9007199254740996","dx"]],[["9007199254740993","zax"],["9007199254740994","bx"],["9007199254740995","cx"],["9007199254740996","dx"]],[["9007199254740994","bx"],["9007199254740995","cx"],["9007199254740996","dx"]],[["9007199254740993","ax"],["9007199254740994","bx"],["9007199254740995","cx"],["9007199254740996","dx"]]]},{"sql":"SELECT DISTINCT g FROM pa ORDER BY 1","prepare":4,"fields":4,"rows":[[[null],[1],[4]],[[null],[1],[4]],[[null],[4]],[[null],[1],[4]]]},{"sql":"SELECT DISTINCT CAST(id AS SIGNED) FROM pa ORDER BY 1","prepare":5,"fields":6,"rows":[[["9007199254740993"],["9007199254740994"],["9007199254740995"],["9007199254740996"]],[["9007199254740993"],["9007199254740994"],["9007199254740995"],["9007199254740996"]],[["9007199254740994"],["9007199254740995"],["9007199254740996"]],[["9007199254740993"],["9007199254740994"],["9007199254740995"],["9007199254740996"]]]},{"sql":"SELECT DISTINCT * FROM dup ORDER BY 1,2","prepare":7,"rows":[[[null,"null"],[1,"same"]],[[null,"null"],[1,"same"]],[[null,"null"],[1,"same"]],[[null,"null"],[1,"same"]]]},{"sql":"SELECT p.id,(SELECT DISTINCT p.id FROM ch) n FROM pa p ORDER BY 1","prepare":8,"rows":[[["9007199254740993","9007199254740993"],["9007199254740994","9007199254740994"],["9007199254740995","9007199254740995"],["9007199254740996","9007199254740996"]],[["9007199254740993","9007199254740993"],["9007199254740994","9007199254740994"],["9007199254740995","9007199254740995"],["9007199254740996","9007199254740996"]],[["9007199254740994","9007199254740994"],["9007199254740995","9007199254740995"],["9007199254740996","9007199254740996"]],[["9007199254740993","9007199254740993"],["9007199254740994","9007199254740994"],["9007199254740995","9007199254740995"],["9007199254740996","9007199254740996"]]]},{"sql":"SELECT DISTINCT id,name FROM pa WHERE id>=2 ORDER BY name,id LIMIT 2","prepare":1,"fields":1,"rows":[[["9007199254740993","a"],["9007199254740994","b"]],[["9007199254740994","b"],["9007199254740995","c"]],[["9007199254740994","b"],["9007199254740995","c"]],[["9007199254740993","a"],["9007199254740994","b"]]]},{"sql":"SELECT DISTINCT unique78.pa.id FROM pa ORDER BY 1 LIMIT 0 OFFSET 1","prepare":0,"fields":0,"rows":[[],[],[],[]]}]
const writes = ['', "UPDATE pa SET name=CONCAT('z',name) WHERE id=9007199254740993", 'DELETE FROM pa WHERE id=9007199254740993', "INSERT INTO pa VALUES(9007199254740993,1,'a') ON DUPLICATE KEY UPDATE name='a'"]
const fieldsOf = (fields: mysql.FieldPacket[]) => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])

test('local unique projection preserves native values, fields and retained statements after writes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({ supportBigNumbers: true, bigNumberStrings: true,
    ...(db === undefined ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream(), user: 'root', password: '' }) })
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS unique78')
    await conn.query('USE unique78')
    await conn.query('DROP TABLE IF EXISTS pa,ch,dup')
    await conn.query('CREATE TABLE pa(id BIGINT PRIMARY KEY,g INT UNIQUE,name VARCHAR(12) NOT NULL UNIQUE) STATS_AUTO_RECALC=0')
    await conn.query("INSERT INTO pa VALUES(9007199254740993,1,'a'),(9007199254740994,NULL,'b'),(9007199254740995,NULL,'c'),(9007199254740996,4,'d')")
    await conn.query('CREATE TABLE ch(id INT PRIMARY KEY) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO ch VALUES(1),(2),(3)')
    await conn.query('CREATE TABLE dup(x INT,y VARCHAR(5))')
    await conn.query("INSERT INTO dup VALUES(1,'same'),(1,'same'),(NULL,'null'),(NULL,'null')")
    await conn.query('ANALYZE TABLE pa,ch,dup')
    for (const entry of CASES) {
      const options = { sql: entry.sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fieldsOf(columns), FIELDS[entry.prepare], `prepare: ${entry.sql}`)
        for (const [state, write] of writes.entries()) {
          if (write !== '') await conn.query(write)
          for (const method of ['query', 'execute', 'prepared']) {
            const [rows, fields] = method === 'prepared' ? await statement.execute([]) : method === 'query' ? await conn.query(options) : await conn.execute(options)
            const expected = entry.rows[state]!
            const prepared = expected.map((row) => Object.fromEntries(row.map((value, i) => [FIELDS[entry.prepare]![i]![0], value])))
            assert.deepEqual(rows, method === 'prepared' ? prepared : expected, `${entry.sql}/${state}/${method}`)
            // Wildcard and outer-field execution metadata have pre-existing gaps;
            // the paired audit records all ten field facts as strictly unchanged.
            if (entry.fields !== undefined) assert.deepEqual(fieldsOf(fields), FIELDS[entry.fields], `${entry.sql}: fields`)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${entry.sql}: warnings`)
          }
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS unique78')
    await conn.end()
    await db?.end()
  }
})

test('whole local unique keys avoid global row-key state while casts and nullable keys retain it', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE d')
    await conn.query('USE d')
    await conn.query('CREATE TABLE t(id BIGINT PRIMARY KEY,g INT UNIQUE) STATS_AUTO_RECALC=0')
    const start = 9007199254740993n
    await conn.query('INSERT INTO t VALUES ' + Array.from({ length: 1000 }, (_, i) => `(${start + BigInt(i)},${i === 0 ? 1 : 'NULL'})`).join(','))
    await conn.query('ANALYZE TABLE t')
    const OriginalSet = globalThis.Set
    let rowKeys = 0
    class ObservedSet<T> extends OriginalSet<T> {
      override add(value: T): this {
        if (typeof value === 'string' && /^17:n9007199254/.test(value)) rowKeys++
        return super.add(value)
      }
    }
    try {
      globalThis.Set = ObservedSet
      const [unique] = await conn.query<mysql.RowDataPacket[]>('SELECT DISTINCT id FROM t ORDER BY 1')
      assert.equal(unique.length, 1000)
      assert.equal(rowKeys, 0, 'no DISTINCT row identities allocated for a selected local PRIMARY key')
      const [computed] = await conn.query<mysql.RowDataPacket[]>('SELECT DISTINCT CAST(id AS SIGNED) FROM t ORDER BY 1')
      assert.equal(computed.length, 1000)
      assert.equal(rowKeys, 1000, 'a computed value keeps its existing global equality proof')
    } finally {
      globalThis.Set = OriginalSet
    }
    assert.deepEqual((await conn.query({ sql: 'SELECT DISTINCT g FROM t ORDER BY 1', rowsAsArray: true }))[0], [[null], [1]])
    await conn.query('CREATE TABLE u(id BIGINT PRIMARY KEY) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO u SELECT id FROM t')
    await conn.query('ANALYZE TABLE u')
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    let read = 0
    let closed = 0
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && name === 'u') {
        const scan = table.scan.bind(table)
        table.scan = function*(range, transaction, mode) {
          try { for (const row of scan(range, transaction, mode)) { read++; yield row } }
          finally { closed++ }
        }
      }
      return table
    }
    try {
      assert.deepEqual((await conn.query({ sql: 'SELECT DISTINCT id FROM u ORDER BY 1 LIMIT 1', rowsAsArray: true }))[0], [[String(start)]])
      assert.equal(read, 1)
      assert.equal(closed, 1)
    } finally {
      catalog.table = open
    }
    for await (const row of db.stream<{ id: number }>('SELECT DISTINCT id FROM d.u ORDER BY 1 FOR UPDATE')) {
      assert.equal(row.id, Number(start), 'the default client uses mysql2 numeric conversion')
      break
    }
    assert.equal(db.openConnections, 1, 'early stream return leaves only the explicit mysql2 connection')
    const writer = await db.connect()
    try {
      await writer.query('SET innodb_lock_wait_timeout=1')
      await writer.query(`UPDATE d.u SET id=${start + 4000n} WHERE id=${start}`)
    } finally { await writer.end() }
  } finally {
    await conn.end()
    await db.end()
  }
})
