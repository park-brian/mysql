import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

async function indexHintConnection() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

const DATA = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, a: i % 8, b: (i * 11) % 17, payload: `payload${i}` }))
const ID_FIELD = ['id', 3, 11, 20483, 0, 63]

async function createHintTable(conn: mysql.Connection) {
  await conn.query('CREATE TABLE t(id INT PRIMARY KEY,a INT NOT NULL,b INT NOT NULL,payload VARCHAR(20),KEY by_a(a),KEY by_ab(a,b),KEY by_b(b)) STATS_AUTO_RECALC=0')
  await conn.query('INSERT INTO t VALUES ' + DATA.map(({ id, a, b, payload }) => `(${id},${a},${b},'${payload}')`).join(','))
  await conn.query('ANALYZE TABLE t')
}

async function checkIndexRead(conn: mysql.Connection, sql: string, rows: readonly (readonly unknown[])[], fields: unknown[][], plan: string, warnings: unknown[][] = []) {
  for (const method of ['query', 'execute'] as const) {
    const options = { sql, rowsAsArray: true }
    const [actual, metadata] = method === 'query' ? await conn.query(options) : await conn.execute(options)
    assert.deepEqual(actual, rows, `${method}: ${sql}`)
    assert.deepEqual(metadata.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]), fields, `${method}: ${sql}`)
    assert.deepEqual((await conn.query({ sql: 'SHOW WARNINGS', rowsAsArray: true }))[0], warnings, `${method}: ${sql}`)
  }
  const [explain] = await conn.query<mysql.RowDataPacket[]>(`EXPLAIN FORMAT=TREE ${sql}`)
  assert.equal(planSkeleton(explain[0]?.EXPLAIN), plan, sql)
}

test('legacy index hints resolve on physical SELECT sources before column binding', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_admission'
  const select = 'SELECT x.id FROM t x'
  const missing = (name: string, alias = 'x') => [1176, '42000', `Key '${name}' doesn't exist in table '${alias}'`] as const
  const absent = [1146, '42S02', `Table '${schema}.absent' doesn't exist`] as const
  const conflict = [1221, 'HY000', 'Incorrect usage of USE INDEX and FORCE INDEX'] as const
  const rejected = [
    [`${select} USE INDEX (ix)`, missing('ix')],
    [`${select} IGNORE INDEX FOR ORDER BY (missing)`, missing('missing')],
    [`${select} FORCE INDEX FOR GROUP BY (hidden)`, missing('hidden')],
    [select + ' USE INDEX (`ékey`)', missing('ékey')],
    [select + ' USE INDEX (`ix_a `)', missing('ix_a ')],
    [`${select} USE INDEX (missing, later)`, missing('later')],
    [`${select} USE INDEX (missing) IGNORE INDEX (later)`, missing('later')],
    [`${select} FORCE INDEX (missing) USE INDEX (ix_a)`, missing('missing')],
    [`${select} USE INDEX FOR JOIN () FORCE INDEX FOR GROUP BY (ix_a)`, conflict],
    [`${select} USE INDEX (ix_a) FORCE INDEX (ix_ab)`, conflict],
    ['SELECT absent FROM t x USE INDEX (missing)', missing('missing')],
    [`${select} USE INDEX (missing) JOIN t y ON y.absent=x.id`, missing('missing')],
    [`${select} USE INDEX (missing) JOIN t y USE INDEX (later) ON y.id=x.id`, missing('missing')],
    [`${select} USE INDEX (missing) WHERE FALSE LIMIT 0`, missing('missing')],
    ['SELECT id FROM tmp FORCE INDEX (missing)', missing('missing', 'tmp')],
    [`${select} USE INDEX (missing) JOIN t x ON x.id=x.id`, [1066, '42000', "Not unique table/alias: 'x'"]],
    [`${select} USE INDEX (missing) JOIN absent y ON y.id=x.id`, absent],
    [`${select} USE INDEX (missing) WHERE id=(SELECT id FROM absent)`, absent],
    [`${select} USE INDEX (missing) UNION ALL SELECT id FROM absent`, absent],
    ['SELECT (SELECT id FROM t USE INDEX (missing)), (SELECT id FROM absent)', absent],
    ['WITH c AS (SELECT id FROM t USE INDEX (missing)) SELECT c.id FROM c JOIN absent ON c.id=absent.id', absent],
  ] as const
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,a INT,b INT,body VARCHAR(16),KEY ix_a(a),KEY ix_ab(a,b),KEY `Ékey`(b),KEY hidden_a(b,a) INVISIBLE,FULLTEXT KEY ft(body))')
    await conn.query("INSERT INTO t VALUES (1,1,2,'one'),(2,1,1,'two'),(3,2,2,'three')")
    await conn.query('CREATE TEMPORARY TABLE tmp(id INT PRIMARY KEY)')
    await conn.query('INSERT INTO tmp VALUES (1)')
    for (const [sql, error] of rejected) {
      const [errno, sqlState, sqlMessage] = error
      for (const method of ['query', 'execute'] as const) {
        const result = method === 'query' ? conn.query(sql) : conn.execute(sql)
        await assert.rejects(result, { errno, sqlState, sqlMessage }, `${method}: ${sql}`)
        const [warnings] = await conn.query({ sql: 'SHOW WARNINGS', rowsAsArray: true })
        assert.deepEqual(warnings, [['Error', errno, sqlMessage]], `${method}: ${sql}`)
      }
      await assert.rejects(conn.query(`EXPLAIN FORMAT=TREE ${sql}`), { errno, sqlState, sqlMessage }, sql)
    }

    const accepted = async (sql: string, expected: number[][]) => {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, `${method}: ${sql}`)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
          [['id', 3, 11, 20483, 0, 63]], `${method}: ${sql}`)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${method}: ${sql}`)
      }
    }
    for (const hint of ['USE INDEX (IX_A)', 'USE INDEX (primary)', 'USE INDEX (`Ék`)', 'USE INDEX (ft)', 'USE INDEX ()']) {
      await accepted(`${select} ${hint} WHERE x.a=1 ORDER BY x.id`, [[1], [2]])
    }
    await accepted('SELECT id FROM tmp USE INDEX (``)', [[1]])
    await conn.query("SET optimizer_switch='use_invisible_indexes=on'")
    await accepted(`${select} USE INDEX (hidden) ORDER BY id`, [[1], [2], [3]])
    const retained = { sql: `${select} USE INDEX (hidden) WHERE x.id=?`, rowsAsArray: true }
    assert.deepEqual((await conn.execute(retained, [1]))[0], [[1]])
    await conn.query("SET optimizer_switch='use_invisible_indexes=off'")
    // The open wire handle outlives the executor's shared parse cache.
    for (let i = 0; i < 32; i++) await conn.execute(`SELECT ${i}`)
    assert.deepEqual((await conn.execute(retained, [2]))[0], [[2]])
    const invisible = { errno: 1176, sqlState: '42000', sqlMessage: missing('hidden')[2] }
    await assert.rejects(conn.execute({ ...retained, sql: retained.sql + ' ' }, [2]), invisible)
    await assert.rejects(conn.query(retained, [2]), invisible)
    await conn.query('ALTER TABLE t ADD COLUMN extra INT')
    await assert.rejects(conn.execute(retained, [2]), invisible)
    await conn.query("SET optimizer_switch='use_invisible_indexes=on'")
    assert.deepEqual((await conn.execute(retained, [3]))[0], [[3]])
    await conn.query("SET optimizer_switch='use_invisible_indexes=off'")
    assert.deepEqual((await conn.execute(retained, [1]))[0], [[1]])

    const withExtra = { ...retained, sql: retained.sql.replace('x.id FROM', 'x.extra FROM') }
    await conn.query("SET optimizer_switch='use_invisible_indexes=on'")
    assert.deepEqual((await conn.execute(withExtra, [1]))[0], [[null]])
    await conn.query('ALTER TABLE t DROP COLUMN extra')
    await assert.rejects(conn.execute(withExtra, [1]), { errno: 1054, sqlState: '42S22' })
    await conn.query("SET optimizer_switch='use_invisible_indexes=off'")
    await assert.rejects(conn.execute(withExtra, [1]), invisible)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('plain SELECT reads honor unscoped and FOR JOIN USE and IGNORE INDEX', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_access'
  const data = DATA
  const ids = (rows: typeof data) => rows.map(({ id }) => [id])
  const wide = (rows: typeof data) => rows.map(({ id, payload }) => [id, payload])
  const point = ids(data.filter(({ a }) => a === 2))
  const ranged = data.filter(({ a }) => a >= 2 && a < 4)
  const idField = ID_FIELD
  const wideFields = [idField, ['payload', 253, 80, 0, 0, 224]]
  const scan = 'Table scan on t'
  const filtered = `Filter\n    ${scan}`
  const lookup = 'Covering index lookup on t using by_a'

  const read = checkIndexRead.bind(undefined, conn)
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn)
    await read('SELECT id FROM t USE INDEX FOR JOIN ()', ids(data), [idField], scan)
    await read('SELECT id FROM t USE INDEX (BY_B)', ids(data.slice().sort((left, right) => left.b - right.b)), [idField], 'Covering index scan on t using by_b')
    for (const hint of ['USE INDEX ()', 'USE INDEX () USE INDEX (by_a)', 'USE INDEX (by_a) IGNORE INDEX (by_a)', 'IGNORE INDEX (by_a) USE INDEX (by_a)', 'IGNORE INDEX FOR JOIN (by_a,by_ab)']) {
      await read(`SELECT id FROM t ${hint} WHERE a=2`, point, [idField], filtered)
    }
    await read('SELECT id FROM t USE INDEX (by_a) USE INDEX () WHERE a=2', point, [idField], lookup)
    await read('SELECT id,payload FROM t USE INDEX () WHERE a>=2 AND a<4', wide(ranged), wideFields, filtered)
    await read('SELECT id,payload FROM t USE INDEX (by_a) WHERE a>=2 AND a<4', wide(ranged.slice().sort((left, right) => left.a - right.a)), wideFields, 'Index range scan on t using by_a over')
    await read('SELECT id,payload FROM t IGNORE INDEX (PRIMARY) WHERE id=7', [[7, 'payload6']], wideFields, filtered)
    await read('SELECT id,payload FROM t USE INDEX (PRIMARY) WHERE id=7', [[7, 'payload6']], wideFields, 'Rows fetched before execution')
    const retained = { sql: 'SELECT id FROM t USE INDEX FOR JOIN () WHERE a=?', rowsAsArray: true }
    assert.deepEqual((await conn.execute(retained, [2]))[0], point)
    await conn.query('UPDATE t SET a=0 WHERE id=3')
    assert.deepEqual((await conn.execute(retained, [2]))[0], point.slice(1))
    assert.deepEqual((await conn.execute(retained, [0]))[0], ids(data.filter(({ id, a }) => id === 3 || a === 0)))

    for (const [table, clustered, rows] of [
      ['hidden', '', [[3], [2], [1], [3], [2]]],
      ['implicit_key', ',UNIQUE KEY by_id(id)', [[2], [2], [3], [1], [3]]],
      ['tmp', ',PRIMARY KEY (id)', [[2], [2], [3], [1], [3]]],
    ] as const) {
      await conn.query(`CREATE ${table === 'tmp' ? 'TEMPORARY ' : ''}TABLE ${table}(id INT NOT NULL,a INT NOT NULL,KEY by_a(a)${clustered})`)
      await conn.query(`INSERT INTO ${table} VALUES (5,3),(1,2),(4,1),(3,3),(2,2)`)
      await read(`SELECT a FROM ${table} USE INDEX ()`, rows, [['a', 3, 11, 20489, 0, 63]], `Table scan on ${table}`)
    }

    await conn.query('CREATE TABLE same_key(id INT PRIMARY KEY,UNIQUE KEY alternative(id))')
    await conn.query('INSERT INTO same_key VALUES (1),(2)')
    const catalog = db?.catalog
    const open = catalog?.table.bind(catalog)
    const reads: string[] = []
    if (catalog && open) catalog.table = (schemaName, tableName, trx) => {
      const table = open(schemaName, tableName, trx)
      if (schemaName === schema && tableName === 'same_key') {
        const scan = table.indexScan.bind(table)
        table.indexScan = (index, ...rest) => {
          reads.push(index)
          return scan(index, ...rest)
        }
      }
      return table
    }
    try {
      await read('SELECT id FROM same_key USE INDEX (alternative) WHERE id=2', [[2]], [['id', 3, 11, 20487, 0, 63]], 'Rows fetched before execution')
      if (db) assert.deepEqual(new Set(reads), new Set(['alternative']))
    } finally {
      if (catalog && open) catalog.table = open
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('ORDER BY index hints leave JOIN covering reads eligible', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_order'
  const read = checkIndexRead.bind(undefined, conn)
  const aField = ['a', 3, 11, 20489, 0, 63]
  const bField = ['b', 3, 11, 20489, 0, 63]
  const byA = DATA.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const byId = DATA.slice(-6).reverse()
  const byAb = DATA.slice().sort((left, right) => left.a - right.a || left.b - right.b || left.id - right.id)
  const first = byA.slice(0, 6).map(({ id, a }) => [id, a])
  const coverA = 'Covering index scan on t using by_a'
  const sortedA = `Limit\n    Sort\n        ${coverA}`
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn)
    for (const hint of ['USE INDEX FOR ORDER BY ()', 'IGNORE INDEX FOR ORDER BY (by_a)', 'USE INDEX FOR ORDER BY () USE INDEX FOR ORDER BY (by_a)', 'USE INDEX FOR ORDER BY (by_a) IGNORE INDEX FOR ORDER BY (by_a)']) {
      await read(`SELECT id,a FROM t ${hint} ORDER BY 2,1 LIMIT 6`, first, [ID_FIELD, aField], sortedA)
    }
    await read('SELECT id,a FROM t USE INDEX FOR ORDER BY (by_a) USE INDEX FOR ORDER BY () ORDER BY a,id LIMIT 6', first,
      [ID_FIELD, aField], `Limit\n    ${coverA}`)
    await read('SELECT id,a FROM t USE INDEX FOR ORDER BY () ORDER BY a DESC,id DESC LIMIT 6 OFFSET 4',
      byA.slice().reverse().slice(4, 10).map(({ id, a }) => [id, a]), [ID_FIELD, aField], `Limit/Offset\n    Sort\n        ${coverA}`)
    await read('SELECT id,a,b FROM t USE INDEX FOR ORDER BY (by_ab) ORDER BY a,b,id LIMIT 6',
      byAb.slice(0, 6).map(({ id, a, b }) => [id, a, b]), [ID_FIELD, aField, bField], 'Limit\n    Covering index scan on t using by_ab')
    await read('SELECT id,a FROM t USE INDEX FOR ORDER BY (PRIMARY) ORDER BY id DESC LIMIT 6', byId.map(({ id, a }) => [id, a]),
      [ID_FIELD, aField], sortedA)
    await read('SELECT id,a FROM t IGNORE INDEX FOR ORDER BY (by_b) ORDER BY id DESC LIMIT 6', byId.map(({ id, a }) => [id, a]),
      [ID_FIELD, aField], 'Limit\n    Index scan on t using PRIMARY')
    await read('SELECT id FROM t USE INDEX FOR ORDER BY (PRIMARY) ORDER BY id DESC LIMIT 6', byId.map(({ id }) => [id]),
      [ID_FIELD], 'Limit\n    Covering index scan on t using PRIMARY')
    await read("SELECT id,CAST('bad' AS SIGNED) FROM t USE INDEX FOR ORDER BY () ORDER BY a,id LIMIT 6", byA.slice(0, 6).map(({ id }) => [id, 0]),
      [ID_FIELD, ["CAST('bad' AS SIGNED)", 8, 21, 129, 0, 63]], sortedA, Array.from({ length: 6 }, () => ['Warning', 1292, "Truncated incorrect INTEGER value: 'bad'"]))
    await conn.query("SET optimizer_switch='prefer_ordering_index=off'")
    await read('SELECT id,a FROM t IGNORE INDEX FOR ORDER BY (by_a,by_ab) ORDER BY a,id LIMIT 6', first, [ID_FIELD, aField], sortedA)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
