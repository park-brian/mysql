// M5.10: ABS retains signed BIT and unsigned HEX literal metadata.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

const layouts: unknown[][][] = [[["id",3,11,20483,0,63,"abs_bits","t","t","id"],["x",5,17,129,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_bits","t","t","id"],["x",5,17,161,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_bits","t","t","id"],["x",8,4,129,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_bits","t","t","id"],["x",8,21,129,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_bits","t","t","id"],["x",8,21,161,0,63,"","","",""]]]

test('ABS BIT and HEX literals retain native signedness through 64 bits in both protocols', async () => {
  const { db, conn } = await connect()
  // Complete native groups; over-64-bit truncation and COLLATE nullability/diagnostics remain separate gaps.
  const fixtures: [string, unknown[][], number][] = [
    ["SELECT id,ABS(b'') AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0],[4,0]],0],
    ["SELECT id,ABS(b'') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],0],
    ["SELECT id,ABS(b'') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(X'') AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0],[4,0]],1],
    ["SELECT id,ABS(X'') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1],
    ["SELECT id,ABS(X'') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],1],
    ["SELECT id,ABS(X'') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1],
    ["SELECT id,ABS(b'0') AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0],[4,0]],0],
    ["SELECT id,ABS(b'0') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'0') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],0],
    ["SELECT id,ABS(b'0') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'1') AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1],[4,1]],0],
    ["SELECT id,ABS(b'1') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'1') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],0],
    ["SELECT id,ABS(b'1') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'00000001') AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1],[4,1]],0],
    ["SELECT id,ABS(b'00000001') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'00000001') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],0],
    ["SELECT id,ABS(b'00000001') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'01111111') AS x FROM t ORDER BY id",[[1,127],[2,127],[3,127],[4,127]],0],
    ["SELECT id,ABS(b'01111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'01111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,127]],0],
    ["SELECT id,ABS(b'01111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'10000000') AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],0],
    ["SELECT id,ABS(b'10000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'10000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],0],
    ["SELECT id,ABS(b'10000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'11111111') AS x FROM t ORDER BY id",[[1,255],[2,255],[3,255],[4,255]],0],
    ["SELECT id,ABS(b'11111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'11111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,255]],0],
    ["SELECT id,ABS(b'11111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(0b10000000) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],0],
    ["SELECT id,ABS(0b10000000) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(0b10000000) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],0],
    ["SELECT id,ABS(0b10000000) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(X'80') AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],1],
    ["SELECT id,ABS(X'80') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1],
    ["SELECT id,ABS(X'80') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],1],
    ["SELECT id,ABS(X'80') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1],
    ["SELECT id,ABS(0x80) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],1],
    ["SELECT id,ABS(0x80) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1],
    ["SELECT id,ABS(0x80) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],1],
    ["SELECT id,ABS(0x80) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1],
    ["SELECT id,ABS(128) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],2],
    ["SELECT id,ABS(128) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2],
    ["SELECT id,ABS(128) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],2],
    ["SELECT id,ABS(128) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2],
    ["SELECT id,ABS(b'100000000') AS x FROM t ORDER BY id",[[1,256],[2,256],[3,256],[4,256]],0],
    ["SELECT id,ABS(b'100000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'100000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,256]],0],
    ["SELECT id,ABS(b'100000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'111111111') AS x FROM t ORDER BY id",[[1,511],[2,511],[3,511],[4,511]],0],
    ["SELECT id,ABS(b'111111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'111111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,511]],0],
    ["SELECT id,ABS(b'111111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'1000000000000000') AS x FROM t ORDER BY id",[[1,32768],[2,32768],[3,32768],[4,32768]],0],
    ["SELECT id,ABS(b'1000000000000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'1000000000000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,32768]],0],
    ["SELECT id,ABS(b'1000000000000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'1111111111111111') AS x FROM t ORDER BY id",[[1,65535],[2,65535],[3,65535],[4,65535]],0],
    ["SELECT id,ABS(b'1111111111111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'1111111111111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,65535]],0],
    ["SELECT id,ABS(b'1111111111111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'10000000000000000000000000000000') AS x FROM t ORDER BY id",[[1,2147483648],[2,2147483648],[3,2147483648],[4,2147483648]],0],
    ["SELECT id,ABS(b'10000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'10000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2147483648]],0],
    ["SELECT id,ABS(b'10000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'11111111111111111111111111111111') AS x FROM t ORDER BY id",[[1,4294967295],[2,4294967295],[3,4294967295],[4,4294967295]],0],
    ["SELECT id,ABS(b'11111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'11111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,4294967295]],0],
    ["SELECT id,ABS(b'11111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'100000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id",[[1,4611686018427388000],[2,4611686018427388000],[3,4611686018427388000],[4,4611686018427388000]],0],
    ["SELECT id,ABS(b'100000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'100000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,4611686018427388000]],0],
    ["SELECT id,ABS(b'100000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id",[[1,9223372036854776000],[2,9223372036854776000],[3,9223372036854776000],[4,9223372036854776000]],0],
    ["SELECT id,ABS(b'111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,9223372036854776000]],0],
    ["SELECT id,ABS(b'111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'1000000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id",[[1,9223372036854776000],[2,9223372036854776000],[3,9223372036854776000],[4,9223372036854776000]],0],
    ["SELECT id,ABS(b'1000000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'1000000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,9223372036854776000]],0],
    ["SELECT id,ABS(b'1000000000000000000000000000000000000000000000000000000000000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(b'1111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id",[[1,18446744073709552000],[2,18446744073709552000],[3,18446744073709552000],[4,18446744073709552000]],0],
    ["SELECT id,ABS(b'1111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(b'1111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,18446744073709552000]],0],
    ["SELECT id,ABS(b'1111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(+b'10000000') AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],0],
    ["SELECT id,ABS(+b'10000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(+b'10000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],0],
    ["SELECT id,ABS(+b'10000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(-b'10000000') AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],0],
    ["SELECT id,ABS(-b'10000000') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(-b'10000000') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],0],
    ["SELECT id,ABS(-b'10000000') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(CAST(b'10000000' AS SIGNED)) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],3],
    ["SELECT id,ABS(CAST(b'10000000' AS SIGNED)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3],
    ["SELECT id,ABS(CAST(b'10000000' AS SIGNED)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],3],
    ["SELECT id,ABS(CAST(b'10000000' AS SIGNED)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3],
    ["SELECT id,ABS(CAST(b'10000000' AS UNSIGNED)) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],4],
    ["SELECT id,ABS(CAST(b'10000000' AS UNSIGNED)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4],
    ["SELECT id,ABS(CAST(b'10000000' AS UNSIGNED)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],4],
    ["SELECT id,ABS(CAST(b'10000000' AS UNSIGNED)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4],
    ["SELECT id,ABS(+X'80') AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],1],
    ["SELECT id,ABS(+X'80') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1],
    ["SELECT id,ABS(+X'80') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],1],
    ["SELECT id,ABS(+X'80') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1],
    ["SELECT id,ABS(-X'80') AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],0],
    ["SELECT id,ABS(-X'80') AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0],
    ["SELECT id,ABS(-X'80') AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],0],
    ["SELECT id,ABS(-X'80') AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0],
    ["SELECT id,ABS(CAST(X'80' AS SIGNED)) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],3],
    ["SELECT id,ABS(CAST(X'80' AS SIGNED)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3],
    ["SELECT id,ABS(CAST(X'80' AS SIGNED)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],3],
    ["SELECT id,ABS(CAST(X'80' AS SIGNED)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3],
    ["SELECT id,ABS(CAST(X'80' AS UNSIGNED)) AS x FROM t ORDER BY id",[[1,128],[2,128],[3,128],[4,128]],4],
    ["SELECT id,ABS(CAST(X'80' AS UNSIGNED)) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4],
    ["SELECT id,ABS(CAST(X'80' AS UNSIGNED)) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,128]],4],
    ["SELECT id,ABS(CAST(X'80' AS UNSIGNED)) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4],
  ]
  try {
    await conn.query('CREATE DATABASE abs_bits')
    await conn.query('USE abs_bits')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY)')
    await conn.query('INSERT INTO t VALUES(1),(2),(3),(4)')
    for (const [sql, expected, layout] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, method + ': rows: ' + sql)
        assert.deepEqual(fields(columns), layouts[layout], method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], method + ': warnings: ' + sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS abs_bits')
    await conn.end()
    await db?.end()
  }
})

test('ABS literal metadata and cached executions stay fresh across source writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], [string, unknown[][], unknown[]][]][] = [
    ["SELECT id,ABS(b'') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"abs_literal_fresh","t","t","id"],["x",5,17,129,0,63,"","","",""]],[["",[[2,0]],[{"id":2,"x":0}]],["UPDATE t SET id=12 WHERE id=2",[[3,0]],[{"id":3,"x":0}]],["DELETE FROM t WHERE id<10",[],[]]]],
    ["SELECT id,ABS(X'') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"abs_literal_fresh","t","t","id"],["x",5,17,161,0,63,"","","",""]],[["",[[2,0]],[{"id":2,"x":0}]],["UPDATE t SET id=12 WHERE id=2",[[3,0]],[{"id":3,"x":0}]],["DELETE FROM t WHERE id<10",[],[]]]],
    ["SELECT id,ABS(b'10000000') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"abs_literal_fresh","t","t","id"],["x",5,17,129,0,63,"","","",""]],[["",[[2,128]],[{"id":2,"x":128}]],["UPDATE t SET id=12 WHERE id=2",[[3,128]],[{"id":3,"x":128}]],["DELETE FROM t WHERE id<10",[],[]]]],
    ["SELECT id,ABS(X'80') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"abs_literal_fresh","t","t","id"],["x",5,17,161,0,63,"","","",""]],[["",[[2,128]],[{"id":2,"x":128}]],["UPDATE t SET id=12 WHERE id=2",[[3,128]],[{"id":3,"x":128}]],["DELETE FROM t WHERE id<10",[],[]]]],
    ["SELECT id,ABS(b'1111111111111111111111111111111111111111111111111111111111111111') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"abs_literal_fresh","t","t","id"],["x",5,17,129,0,63,"","","",""]],[["",[[2,18446744073709552000]],[{"id":2,"x":18446744073709552000}]],["UPDATE t SET id=12 WHERE id=2",[[3,18446744073709552000]],[{"id":3,"x":18446744073709552000}]],["DELETE FROM t WHERE id<10",[],[]]]],
    ["SELECT id,ABS(+b'10000000') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"abs_literal_fresh","t","t","id"],["x",5,17,129,0,63,"","","",""]],[["",[[2,128]],[{"id":2,"x":128}]],["UPDATE t SET id=12 WHERE id=2",[[3,128]],[{"id":3,"x":128}]],["DELETE FROM t WHERE id<10",[],[]]]],
  ]
  try {
    await conn.query('CREATE DATABASE abs_literal_fresh')
    await conn.query('USE abs_literal_fresh')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY)')
    for (const [sql, expectedFields, states] of fixtures) {
      await conn.query('DELETE FROM t')
      await conn.query('INSERT INTO t VALUES(1),(2),(3),(4)')
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fields(columns), expectedFields, 'PREPARE metadata: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], 'PREPARE warnings: ' + sql)
        for (const [change, arrayRows, objectRows] of states) {
          if (change !== '') await conn.query(change)
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [rows, columns] = method === 'statement' ? await statement.execute([1, 1])
              : method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
            assert.deepEqual(rows, method === 'statement' ? objectRows : arrayRows, method + ': fresh rows: ' + sql)
            assert.deepEqual(fields(columns), expectedFields, method + ': fresh fields: ' + sql)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], method + ': fresh warnings: ' + sql)
          }
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS abs_literal_fresh')
    await conn.end()
    await db?.end()
  }
})
