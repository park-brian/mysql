// Own SQL probes against pinned MySQL 8.4.11; neither names nor masks read our registry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const names = ["index_merge","index_merge_union","index_merge_sort_union","index_merge_intersection","engine_condition_pushdown","index_condition_pushdown","mrr","mrr_cost_based","block_nested_loop","batched_key_access","materialization","semijoin","loosescan","firstmatch","duplicateweedout","subquery_materialization_cost_based","use_index_extensions","condition_fanout_filter","derived_merge","use_invisible_indexes","skip_scan","hash_join","subquery_to_derived","prefer_ordering_index","hypergraph_optimizer","derived_condition_pushdown","hash_set_operations"]
const vectors: readonly (readonly (readonly [string, number, { errno: number; sqlState: string; message: string } | null])[])[] = [
  [
    ["SET optimizer_switch='default'",112721407,null],
    ["SET optimizer_switch='loosescan=off'",112717311,null],
    ["SET optimizer_switch='firstmatch=off'",112709119,null],
    ["SET optimizer_switch='firstmatch=on'",112717311,null],
    ["SET optimizer_switch='loosescan=default'",112721407,null],
    ["SET optimizer_switch='semijoin=off,firstmatch=off'",112711167,null],
    ["SET optimizer_switch='firstmatch=default,default'",112721407,null],
    ["SET optimizer_switch='default,firstmatch=off'",112713215,null],
    ["SET optimizer_switch='firstmatch=on,firstmatch=off'",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'firstmatch=off'"}],
    ["SET optimizer_switch='default,default'",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'default'"}],
    ["SET optimizer_switch='FIRSTMATCH=off'",112713215,null],
    ["SET optimizer_switch='firstmatch=OFF'",112713215,null],
    ["SET optimizer_switch=' firstmatch=off'",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of ' firstmatch=off'"}],
    ["SET optimizer_switch='firstmatch =off'",112713215,null],
    ["SET optimizer_switch='firstmatch=off '",112713215,null],
    ["SET optimizer_switch='firstmatch=off, loosescan=off'",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of ' loosescan=off'"}],
    ["SET optimizer_switch=''",112713215,null],
    ["SET optimizer_switch='firstmatch=unknown'",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'firstmatch=unknown'"}],
    ["SET optimizer_switch='unknown=off'",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'unknown=off'"}],
    ["SET optimizer_switch=NULL",112713215,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'NULL'"}],
    ["SET optimizer_switch=1",1,null],
    ["SET optimizer_switch='default'",112721407,null],
    ["SET optimizer_switch='firstmatch=off'",112713215,null],
    ["SET optimizer_switch=DEFAULT",112721407,null]
  ],
  [
    ["SET optimizer_switch=0",0,null],
    ["SET optimizer_switch=1",1,null],
    ["SET optimizer_switch=2",2,null],
    ["SET optimizer_switch=4",4,null],
    ["SET optimizer_switch=8",8,null],
    ["SET optimizer_switch=16",16,null],
    ["SET optimizer_switch=32",32,null],
    ["SET optimizer_switch=64",64,null],
    ["SET optimizer_switch=128",128,null],
    ["SET optimizer_switch=256",256,null],
    ["SET optimizer_switch=512",512,null],
    ["SET optimizer_switch=1024",1024,null],
    ["SET optimizer_switch=2048",2048,null],
    ["SET optimizer_switch=4096",4096,null],
    ["SET optimizer_switch=8192",8192,null],
    ["SET optimizer_switch=16384",16384,null],
    ["SET optimizer_switch=32768",32768,null],
    ["SET optimizer_switch=65536",65536,null],
    ["SET optimizer_switch=131072",131072,null],
    ["SET optimizer_switch=262144",262144,null],
    ["SET optimizer_switch=524288",524288,null],
    ["SET optimizer_switch=1048576",1048576,null],
    ["SET optimizer_switch=2097152",2097152,null],
    ["SET optimizer_switch=4194304",4194304,null],
    ["SET optimizer_switch=8388608",8388608,null],
    ["SET optimizer_switch=16777216",8388608,{"errno":3999,"sqlState":"42000","message":"The hypergraph optimizer does not yet support 'use in non-debug builds'"}],
    ["SET optimizer_switch=33554432",33554432,null],
    ["SET optimizer_switch=67108864",67108864,null],
    ["SET optimizer_switch=134217728",0,null],
    ["SET optimizer_switch=268435456",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '268435456'"}],
    ["SET optimizer_switch=536870912",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '536870912'"}],
    ["SET optimizer_switch=1073741824",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '1073741824'"}],
    ["SET optimizer_switch=2147483648",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '2147483648'"}],
    ["SET optimizer_switch=4294967296",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '4294967296'"}],
    ["SET optimizer_switch=-1",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '-1'"}],
    ["SET optimizer_switch=18446744073709551615",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '18446744073709551615'"}],
    ["SET optimizer_switch=1.0",0,{"errno":1232,"sqlState":"42000","message":"Incorrect argument type to variable 'optimizer_switch'"}],
    ["SET optimizer_switch=1e0",0,{"errno":1232,"sqlState":"42000","message":"Incorrect argument type to variable 'optimizer_switch'"}],
    ["SET optimizer_switch='1'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of '1'"}],
    ["SET optimizer_switch='firstmatch=1'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'firstmatch=1'"}],
    ["SET optimizer_switch='firstmatch=true'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'firstmatch=true'"}],
    ["SET optimizer_switch='firstmatch= off'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'firstmatch= off'"}],
    ["SET optimizer_switch='firstmatch=off,'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of ''"}],
    ["SET optimizer_switch=',firstmatch=off'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of ',firstmatch=off'"}],
    ["SET optimizer_switch='default=on'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'default=on'"}],
    ["SET optimizer_switch='firstmatch=off=on'",0,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of 'firstmatch=off=on'"}],
    ["SET optimizer_switch='default '",112721407,null],
    ["SET optimizer_switch=' default'",112721407,{"errno":1231,"sqlState":"42000","message":"Variable 'optimizer_switch' can't be set to the value of ' default'"}],
    ["SET optimizer_switch='default'",112721407,null],
    ["SET optimizer_switch=DEFAULT",112721407,null]
  ]
]

const flagText = (mask: number): string => names.map((name, i) => name + '=' + (Math.floor(mask / 2 ** i) % 2 === 1 ? 'on' : 'off')).join(',')

async function connected() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  return { db, conn }
}

for (const method of ['query', 'execute'] as const) test('optimizer_switch retains named flags, accepts native masks and rejects atomically through ' + method, async () => {
  const { db, conn } = await connected()
  const run = (sql: string) => method === 'query' ? conn.query(sql) : conn.execute(sql)
  try {
    for (const group of vectors) for (const [sql, mask, error] of group) {
      if (error === null) await run(sql)
      else await assert.rejects(run(sql), error)
      const read = 'SELECT @@optimizer_switch AS flags'
      const [rows, fields] = method === 'query' ? await conn.query<mysql.RowDataPacket[]>(read) : await conn.execute<mysql.RowDataPacket[]>(read)
      assert.equal(rows[0]?.flags, flagText(mask), sql)
      assert.deepEqual(fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.characterSet]), [['flags', 253, 87380, 0, 224]], sql)
      assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], sql)
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})

const scopes: readonly (readonly [string, string, number, number])[] = [["initial","a",112721407,112721407],["initial","b",112721407,112721407],["globalFirstOff","a",112721407,112713215],["globalFirstOff","b",112721407,112713215],["newConnection","a",112721407,112713215],["newConnection","b",112721407,112713215],["newConnection","c",112713215,112713215],["sessionLooseOff","a",112721407,112713215],["sessionLooseOff","b",112717311,112713215],["sessionLooseOff","c",112713215,112713215],["sessionDefault","a",112721407,112713215],["sessionDefault","b",112713215,112713215],["sessionDefault","c",112713215,112713215],["compiledDefault","a",112721407,112713215],["compiledDefault","b",112713215,112713215],["compiledDefault","c",112713215,112713215],["globalResetAndOff","a",112721407,112713215],["globalResetAndOff","b",112713215,112713215],["globalResetAndOff","c",112713215,112713215]]

test('optimizer_switch snapshots globals for new connections and uses global defaults for SESSION resets', async () => {
  const { db, conn: admin } = await connected()
  const open = () => mysql.createConnection(db === undefined
    ? { host: process.env.MYSQL_REFERENCE_HOST ?? '127.0.0.1', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  const [saved] = await admin.query<mysql.RowDataPacket[]>('SELECT @@GLOBAL.optimizer_switch AS flags')
  const connections = new Map<string, mysql.Connection>()
  const check = async (label: string) => {
    for (const [name, conn] of connections) {
      const expected = scopes.find(v => v[0] === label && v[1] === name)
      assert.ok(expected)
      const [rows, fields] = await conn.query<mysql.RowDataPacket[]>('SELECT @@SESSION.optimizer_switch AS flags,@@GLOBAL.optimizer_switch AS globalFlags')
      assert.equal(rows[0]?.flags, flagText(expected[2]), label + '/' + name)
      assert.equal(rows[0]?.globalFlags, flagText(expected[3]), label + '/' + name)
      assert.deepEqual(fields.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.characterSet]), [['flags', 253, 87380, 0, 224], ['globalFlags', 253, 87380, 0, 224]])
    }
  }
  try {
    await admin.query("SET GLOBAL optimizer_switch='default'")
    connections.set('a', await open()); connections.set('b', await open())
    const a = connections.get('a') as mysql.Connection, b = connections.get('b') as mysql.Connection
    await check('initial')
    await a.query("SET GLOBAL optimizer_switch='firstmatch=off'"); await check('globalFirstOff')
    connections.set('c', await open()); await check('newConnection')
    await b.query("SET optimizer_switch='loosescan=off'"); await check('sessionLooseOff')
    await b.query('SET optimizer_switch=DEFAULT'); await check('sessionDefault')
    await b.query("SET optimizer_switch='default'"); await check('compiledDefault')
    await a.query("SET GLOBAL optimizer_switch='default,firstmatch=off'"); await check('globalResetAndOff')
  } finally {
    await admin.query('SET GLOBAL optimizer_switch=' + mysql.escape(saved[0]?.flags))
    for (const conn of connections.values()) await conn.end()
    await admin.end(); await db?.end()
  }
})
