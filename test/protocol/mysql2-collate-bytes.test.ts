// M5.10: binary COLLATE returns bytes through the shared value reader.
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

// These prefixes were checked against all 256 native byte outcomes.
const byteRows = Array.from({ length: 256 }, (_, id) => [id, Buffer.from([id])])
const hexRows = Array.from({ length: 256 }, (_, id) => [id, id.toString(16).padStart(2, '0').toUpperCase()])
const concatRows = Array.from({ length: 256 }, (_, id) => [id, Buffer.from([id, 65])])
const zeroRows = Array.from({ length: 256 }, (_, id) => [id, 0])
const matchRows = Array.from({ length: 256 }, (_, id) => [id, 1])

async function verify(conn: mysql.Connection, fixtures: [string, unknown[][], unknown[][], unknown[]][]) {
  for (const [sql, expected, expectedFields, warnings] of fixtures) {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      const [actual, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
      assert.deepEqual(actual, expected, method + ': rows: ' + sql)
      assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
      conn.unprepare(options)
    }
  }
}

async function verifyRefusals(conn: mysql.Connection, refusals: [string, [number, string, string]][]) {
  for (const [sql, expected] of refusals) {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      await assert.rejects(() => method === 'query' ? conn.query(options) : conn.execute(options), error => {
        const e = error as { errno: number; sqlState: string; message: string }
        assert.deepEqual([e.errno, e.sqlState, e.message], expected, method + ': refusal: ' + sql)
        return true
      })
      conn.unprepare(options)
    }
  }
}

test('binary COLLATE preserves all bytes, NULLs, bounded reads and binary consumers', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT id,b COLLATE `binary` AS x FROM t WHERE id<260 ORDER BY id",[...byteRows,...[[256,Buffer.from([])],[257,Buffer.from([0,128,0,255,0])],[258,Buffer.from([195,169])],[259,Buffer.from([195,0,169])]]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,b COLLATE `binary` AS x FROM t WHERE id=260 ORDER BY id",[[260,Buffer.from([128,128,128,128,128,128,128])]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,b COLLATE `binary` AS x FROM t WHERE id=261 ORDER BY id",[[261,null]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,b COLLATE `binary` AS x FROM t WHERE id=0 ORDER BY id LIMIT 0",[],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,bn COLLATE `binary` AS x FROM t WHERE id<260 ORDER BY id",[...byteRows,...[[256,Buffer.from([])],[257,Buffer.from([0,128,0,255,0])],[258,Buffer.from([195,169])],[259,Buffer.from([195,0,169])]]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,bn COLLATE `binary` AS x FROM t WHERE id=260 ORDER BY id",[[260,Buffer.from([128,128,128,128,128,128,128])]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,bn COLLATE `binary` AS x FROM t WHERE id=261 ORDER BY id",[[261,Buffer.from([])]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,bn COLLATE `binary` AS x FROM t WHERE id=0 ORDER BY id LIMIT 0",[],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,8,128,31,63,"","","",""]],[]],
    ["SELECT id,HEX(b COLLATE `binary`) AS x FROM t WHERE id<260 ORDER BY id",[...hexRows,...[[256,""],[257,"008000FF00"],[258,"C3A9"],[259,"C300A9"]]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,64,0,31,224,"","","",""]],[]],
    ["SELECT id,HEX(b COLLATE `binary`) AS x FROM t WHERE id=260 ORDER BY id",[[260,"80808080808080"]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,64,0,31,224,"","","",""]],[]],
    ["SELECT id,HEX(b COLLATE `binary`) AS x FROM t WHERE id=261 ORDER BY id",[[261,null]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,64,0,31,224,"","","",""]],[]],
    ["SELECT id,HEX(b COLLATE `binary`) AS x FROM t WHERE id=0 ORDER BY id LIMIT 0",[],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,64,0,31,224,"","","",""]],[]],
    ["SELECT id,CONCAT(b COLLATE `binary`,X'41') AS x FROM t WHERE id<260 ORDER BY id",[...concatRows,...[[256,Buffer.from([65])],[257,Buffer.from([0,128,0,255,0,65])],[258,Buffer.from([195,169,65])],[259,Buffer.from([195,0,169,65])]]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,9,128,31,63,"","","",""]],[]],
    ["SELECT id,CONCAT(b COLLATE `binary`,X'41') AS x FROM t WHERE id=260 ORDER BY id",[[260,Buffer.from([128,128,128,128,128,128,128,65])]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,9,128,31,63,"","","",""]],[]],
    ["SELECT id,CONCAT(b COLLATE `binary`,X'41') AS x FROM t WHERE id=261 ORDER BY id",[[261,null]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,9,128,31,63,"","","",""]],[]],
    ["SELECT id,CONCAT(b COLLATE `binary`,X'41') AS x FROM t WHERE id=0 ORDER BY id LIMIT 0",[],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",253,9,128,31,63,"","","",""]],[]],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t WHERE id<260 ORDER BY id",[...zeroRows,...[[256,0],[257,0],[258,0],[259,0]]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t WHERE id=260 ORDER BY id",[[260,0]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t WHERE id=261 ORDER BY id",[[261,0]],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t WHERE id=0 ORDER BY id LIMIT 0",[],[["id",3,11,20483,0,63,"collate_bytes","t","t","id"],["x",8,10,129,0,63,"","","",""]],[]],
  ]
  try {
    await conn.query('CREATE DATABASE collate_bytes')
    await conn.query('USE collate_bytes')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(8),bn VARBINARY(8) NOT NULL)')
    const values = Array.from({ length: 256 }, (_, id) => Buffer.from([id]))
    values.push(Buffer.alloc(0), Buffer.from([0,128,0,255,0]), Buffer.from([195,169]), Buffer.from([195,0,169]), Buffer.alloc(7,128))
    for (const [id, value] of values.entries()) await conn.query('INSERT INTO t VALUES(?,?,?)', [id, value, value])
    await conn.query("INSERT INTO t VALUES(261,NULL,X'')")
    await verify(conn, fixtures)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS collate_bytes')
    await conn.end()
    await db?.end()
  }
})

test('binary COLLATE feeds native regex positions, large subjects and canonical collation names', async () => {
  const { db, conn } = await connect()
  // Replacement and large-substring result field classes remain separate full-group gaps.
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT id,HEX(REGEXP_SUBSTR(b COLLATE `binary`,X'2E',1,1,'n')) AS x FROM t ORDER BY id",[...hexRows,...[[256,null],[257,"00"],[258,"C3"],[259,"C3"],[260,null]]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",253,64,0,31,224,"","","",""]],[]],
    ["SELECT id,REGEXP_INSTR(b COLLATE `binary`,X'2E',1,1,0,'n') AS x FROM t ORDER BY id",[...matchRows,...[[256,0],[257,1],[258,1],[259,1],[260,null]]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT id,COERCIBILITY(CONCAT(b COLLATE `binary`,X'41')) AS x FROM t ORDER BY id",[...zeroRows,...[[256,0],[257,0],[258,0],[259,0],[260,0]]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT id,REPEAT(b COLLATE `binary`,131073) AS x FROM t WHERE id=128",[[128,Buffer.alloc(131073,128)]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",250,1048584,128,31,63,"","","",""]],[]],
    ["SELECT id,HEX(RIGHT(REPEAT(b COLLATE `binary`,131073),1)) AS x FROM t WHERE id=128",[[128,"80"]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",253,8,0,31,224,"","","",""]],[]],
    ["SELECT id,LENGTH(REPEAT(b COLLATE `binary`,131073)) AS x FROM t WHERE id=128",[[128,131073]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",8,10,128,0,63,"","","",""]],[]],
    ["SELECT id,REGEXP_INSTR(CONCAT(REPEAT(b COLLATE `binary`,131072),X'9F'),X'9F') AS x FROM t WHERE id=128",[[128,131073]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",8,21,128,0,63,"","","",""]],[]],
    ["SELECT id,LENGTH(REGEXP_REPLACE(REPEAT(b COLLATE `binary`,131072),X'282E29',_binary'$1',1,0,'n')) AS x FROM t WHERE id=128",[[128,131072]],[["id",3,11,20483,0,63,"collate_byte_functions","t","t","id"],["x",8,10,128,0,63,"","","",""]],[]],
    ["SELECT 1 COLLATE utf8_bin AS x",[["1"]],[["x",253,8,128,31,224,"","","",""]],[]],
    ["SELECT DATE '2026-10-11' COLLATE utf8_bin AS x",[["2026-10-11"]],[["x",253,40,128,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(1 COLLATE utf8_bin) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
  ]
  const refusals: [string, [number, string, string]][] = [["SELECT 1 COLLATE utf8_no_such_collation AS x",[1273,"HY000","Unknown collation: 'utf8_no_such_collation'"]],["SELECT X'31' COLLATE utf8_bin AS x",[1253,"42000","COLLATION 'utf8_bin' is not valid for CHARACTER SET 'binary'"]]]
  try {
    await conn.query('CREATE DATABASE collate_byte_functions')
    await conn.query('USE collate_byte_functions')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(8))')
    for (let id = 0; id < 256; id++) await conn.query('INSERT INTO t VALUES(?,?)', [id, Buffer.from([id])])
    await conn.query("INSERT INTO t VALUES(256,X''),(257,X'008000FF00'),(258,X'C3A9'),(259,X'C300A9'),(260,NULL)")
    await verify(conn, fixtures)
    await verifyRefusals(conn, refusals)
  } finally {
    await conn.query('DROP DATABASE IF EXISTS collate_byte_functions')
    await conn.end()
    await db?.end()
  }
})

test('binary COLLATE retains native numeric, temporal, text and charset checks', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT 1 COLLATE `binary` AS x",[[Buffer.from([49])]],[["x",253,2,128,31,63,"","","",""]],[]],
    ["SELECT HEX(1 COLLATE `binary`) AS x",[["31"]],[["x",253,16,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(1 COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(1 COLLATE `binary`) AS x",[[1]],[["x",5,23,128,31,63,"","","",""]],[]],
    ["SELECT (-1) COLLATE `binary` AS x",[[Buffer.from([45,49])]],[["x",253,2,128,31,63,"","","",""]],[]],
    ["SELECT HEX((-1) COLLATE `binary`) AS x",[["2D31"]],[["x",253,16,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY((-1) COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS((-1) COLLATE `binary`) AS x",[[1]],[["x",5,23,128,31,63,"","","",""]],[]],
    ["SELECT 1.25 COLLATE `binary` AS x",[[Buffer.from([49,46,50,53])]],[["x",253,5,128,31,63,"","","",""]],[]],
    ["SELECT HEX(1.25 COLLATE `binary`) AS x",[["312E3235"]],[["x",253,40,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(1.25 COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(1.25 COLLATE `binary`) AS x",[[1.25]],[["x",5,23,128,31,63,"","","",""]],[]],
    ["SELECT (-1.25) COLLATE `binary` AS x",[[Buffer.from([45,49,46,50,53])]],[["x",253,5,128,31,63,"","","",""]],[]],
    ["SELECT HEX((-1.25) COLLATE `binary`) AS x",[["2D312E3235"]],[["x",253,40,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY((-1.25) COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS((-1.25) COLLATE `binary`) AS x",[[1.25]],[["x",5,23,128,31,63,"","","",""]],[]],
    ["SELECT (-0e0) COLLATE `binary` AS x",[[Buffer.from([45,48])]],[["x",253,22,128,31,63,"","","",""]],[]],
    ["SELECT HEX((-0e0) COLLATE `binary`) AS x",[["2D30"]],[["x",253,176,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY((-0e0) COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS((-0e0) COLLATE `binary`) AS x",[[0]],[["x",5,23,128,31,63,"","","",""]],[]],
    ["SELECT DATE '2026-10-11' COLLATE `binary` AS x",[[Buffer.from([50,48,50,54,45,49,48,45,49,49])]],[["x",253,10,128,31,63,"","","",""]],[]],
    ["SELECT HEX(DATE '2026-10-11' COLLATE `binary`) AS x",[["323032362D31302D3131"]],[["x",253,80,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(DATE '2026-10-11' COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(DATE '2026-10-11' COLLATE `binary`) AS x",[[2026]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2026-10-11'"}]],
    ["SELECT TIME '10:11:12.123456' COLLATE `binary` AS x",[[Buffer.from([49,48,58,49,49,58,49,50,46,49,50,51,52,53,54])]],[["x",253,17,128,31,63,"","","",""]],[]],
    ["SELECT HEX(TIME '10:11:12.123456' COLLATE `binary`) AS x",[["31303A31313A31322E313233343536"]],[["x",253,136,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(TIME '10:11:12.123456' COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(TIME '10:11:12.123456' COLLATE `binary`) AS x",[[10]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '10:11:12.123456'"}]],
    ["SELECT TIMESTAMP '2026-10-11 10:11:12.123456' COLLATE `binary` AS x",[[Buffer.from([50,48,50,54,45,49,48,45,49,49,32,49,48,58,49,49,58,49,50,46,49,50,51,52,53,54])]],[["x",253,26,128,31,63,"","","",""]],[]],
    ["SELECT HEX(TIMESTAMP '2026-10-11 10:11:12.123456' COLLATE `binary`) AS x",[["323032362D31302D31312031303A31313A31322E313233343536"]],[["x",253,208,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(TIMESTAMP '2026-10-11 10:11:12.123456' COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(TIMESTAMP '2026-10-11 10:11:12.123456' COLLATE `binary`) AS x",[[2026]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2026-10-11 10:11:12.123456'"}]],
    ["SELECT NULL COLLATE `binary` AS x",[[null]],[["x",253,0,128,31,63,"","","",""]],[]],
    ["SELECT HEX(NULL COLLATE `binary`) AS x",[[null]],[["x",253,0,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(NULL COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(NULL COLLATE `binary`) AS x",[[null]],[["x",5,23,128,31,63,"","","",""]],[]],
    ["SELECT 'é' COLLATE utf8mb4_bin AS x",[["é"]],[["x",253,4,128,31,224,"","","",""]],[]],
    ["SELECT HEX('é' COLLATE utf8mb4_bin) AS x",[["C3A9"]],[["x",253,32,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY('é' COLLATE utf8mb4_bin) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS('é' COLLATE utf8mb4_bin) AS x",[[0]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'é'"}]],
    ["SELECT _latin1 X'E9' COLLATE latin1_bin AS x",[["é"]],[["x",253,4,128,31,224,"","","",""]],[]],
    ["SELECT HEX(_latin1 X'E9' COLLATE latin1_bin) AS x",[["E9"]],[["x",253,8,0,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY(_latin1 X'E9' COLLATE latin1_bin) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT ABS(_latin1 X'E9' COLLATE latin1_bin) AS x",[[0]],[["x",5,23,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: 'é'"}]],
  ]
  const refusals: [string, [number, string, string]][] = [["SELECT CAST('[]' AS JSON) COLLATE `binary` AS x",[1253,"42000","COLLATION 'binary' is not valid for CHARACTER SET 'utf8mb4'"]],["SELECT HEX(CAST('[]' AS JSON) COLLATE `binary`) AS x",[1253,"42000","COLLATION 'binary' is not valid for CHARACTER SET 'utf8mb4'"]],["SELECT COERCIBILITY(CAST('[]' AS JSON) COLLATE `binary`) AS x",[1253,"42000","COLLATION 'binary' is not valid for CHARACTER SET 'utf8mb4'"]],["SELECT ABS(CAST('[]' AS JSON) COLLATE `binary`) AS x",[1253,"42000","COLLATION 'binary' is not valid for CHARACTER SET 'utf8mb4'"]]]
  try {
    await verify(conn, fixtures)
    await verifyRefusals(conn, refusals)
  } finally {
    await conn.end()
    await db?.end()
  }
})

test('binary COLLATE cached reads preserve fresh byte values across writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], [string | null, unknown[][], unknown[], unknown[]][]][] = [
    ["SELECT id,b COLLATE `binary` AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_byte_fresh","t","t","id"],["x",253,8,128,31,63,"","","",""]],[["80",[[2,Buffer.from([128])]],[{"id":2,"x":Buffer.from([128])}],[]],["00",[[2,Buffer.from([0])]],[{"id":2,"x":Buffer.from([0])}],[]],["FF",[[2,Buffer.from([255])]],[{"id":2,"x":Buffer.from([255])}],[]],["C3A9",[[2,Buffer.from([195,169])]],[{"id":2,"x":Buffer.from([195,169])}],[]],["C300A9",[[2,Buffer.from([195,0,169])]],[{"id":2,"x":Buffer.from([195,0,169])}],[]],["008000FF00",[[2,Buffer.from([0,128,0,255,0])]],[{"id":2,"x":Buffer.from([0,128,0,255,0])}],[]],["",[[2,Buffer.from([])]],[{"id":2,"x":Buffer.from([])}],[]],[null,[[2,null]],[{"id":2,"x":null}],[]]]],
    ["SELECT id,HEX(b COLLATE `binary`) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_byte_fresh","t","t","id"],["x",253,64,0,31,224,"","","",""]],[["80",[[2,"80"]],[{"id":2,"x":"80"}],[]],["00",[[2,"00"]],[{"id":2,"x":"00"}],[]],["FF",[[2,"FF"]],[{"id":2,"x":"FF"}],[]],["C3A9",[[2,"C3A9"]],[{"id":2,"x":"C3A9"}],[]],["C300A9",[[2,"C300A9"]],[{"id":2,"x":"C300A9"}],[]],["008000FF00",[[2,"008000FF00"]],[{"id":2,"x":"008000FF00"}],[]],["",[[2,""]],[{"id":2,"x":""}],[]],[null,[[2,null]],[{"id":2,"x":null}],[]]]],
    ["SELECT id,CONCAT(b COLLATE `binary`,X'41') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_byte_fresh","t","t","id"],["x",253,9,128,31,63,"","","",""]],[["80",[[2,Buffer.from([128,65])]],[{"id":2,"x":Buffer.from([128,65])}],[]],["00",[[2,Buffer.from([0,65])]],[{"id":2,"x":Buffer.from([0,65])}],[]],["FF",[[2,Buffer.from([255,65])]],[{"id":2,"x":Buffer.from([255,65])}],[]],["C3A9",[[2,Buffer.from([195,169,65])]],[{"id":2,"x":Buffer.from([195,169,65])}],[]],["C300A9",[[2,Buffer.from([195,0,169,65])]],[{"id":2,"x":Buffer.from([195,0,169,65])}],[]],["008000FF00",[[2,Buffer.from([0,128,0,255,0,65])]],[{"id":2,"x":Buffer.from([0,128,0,255,0,65])}],[]],["",[[2,Buffer.from([65])]],[{"id":2,"x":Buffer.from([65])}],[]],[null,[[2,null]],[{"id":2,"x":null}],[]]]],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_byte_fresh","t","t","id"],["x",8,10,129,0,63,"","","",""]],[["80",[[2,0]],[{"id":2,"x":0}],[]],["00",[[2,0]],[{"id":2,"x":0}],[]],["FF",[[2,0]],[{"id":2,"x":0}],[]],["C3A9",[[2,0]],[{"id":2,"x":0}],[]],["C300A9",[[2,0]],[{"id":2,"x":0}],[]],["008000FF00",[[2,0]],[{"id":2,"x":0}],[]],["",[[2,0]],[{"id":2,"x":0}],[]],[null,[[2,0]],[{"id":2,"x":0}],[]]]],
    ["SELECT id,HEX(REGEXP_SUBSTR(b COLLATE `binary`,X'2E',1,1,'n')) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_byte_fresh","t","t","id"],["x",253,64,0,31,224,"","","",""]],[["80",[[2,"80"]],[{"id":2,"x":"80"}],[]],["00",[[2,"00"]],[{"id":2,"x":"00"}],[]],["FF",[[2,"FF"]],[{"id":2,"x":"FF"}],[]],["C3A9",[[2,"C3"]],[{"id":2,"x":"C3"}],[]],["C300A9",[[2,"C3"]],[{"id":2,"x":"C3"}],[]],["008000FF00",[[2,"00"]],[{"id":2,"x":"00"}],[]],["",[[2,null]],[{"id":2,"x":null}],[]],[null,[[2,null]],[{"id":2,"x":null}],[]]]],
    ["SELECT id,REGEXP_INSTR(b COLLATE `binary`,X'2E',1,1,0,'n') AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_byte_fresh","t","t","id"],["x",8,21,128,0,63,"","","",""]],[["80",[[2,1]],[{"id":2,"x":1}],[]],["00",[[2,1]],[{"id":2,"x":1}],[]],["FF",[[2,1]],[{"id":2,"x":1}],[]],["C3A9",[[2,1]],[{"id":2,"x":1}],[]],["C300A9",[[2,1]],[{"id":2,"x":1}],[]],["008000FF00",[[2,1]],[{"id":2,"x":1}],[]],["",[[2,0]],[{"id":2,"x":0}],[]],[null,[[2,null]],[{"id":2,"x":null}],[]]]],
  ]
  try {
    await conn.query('CREATE DATABASE collate_byte_fresh')
    await conn.query('USE collate_byte_fresh')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(8))')
    for (const [sql, expectedFields, states] of fixtures) {
      await conn.query('DELETE FROM t')
      await conn.query("INSERT INTO t VALUES(1,X'31'),(2,X'80'),(3,X'32')")
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fields(columns), expectedFields, 'PREPARE metadata: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], 'PREPARE warnings: ' + sql)
        for (const [hex, arrayRows, objectRows, warnings] of states) {
          await conn.query('UPDATE t SET b=? WHERE id=2', [hex === null ? null : Buffer.from(hex, 'hex')])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [actual, columns] = method === 'statement' ? await statement.execute([1, 1])
              : method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
            assert.deepEqual(actual, method === 'statement' ? objectRows : arrayRows, method + ': fresh rows: ' + sql)
            assert.deepEqual(fields(columns), expectedFields, method + ': fresh fields: ' + sql)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': fresh warnings: ' + sql)
          }
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS collate_byte_fresh')
    await conn.end()
    await db?.end()
  }
})
