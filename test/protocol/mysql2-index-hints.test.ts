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
const GROUP_DATA = DATA.map((row) => ({ ...row, a: (row.a * 7 + 3) % 8 }))
const ID_FIELD = ['id', 3, 11, 20483, 0, 63]

async function createHintTable(conn: mysql.Connection, data = DATA) {
  await conn.query('CREATE TABLE t(id INT PRIMARY KEY,a INT NOT NULL,b INT NOT NULL,payload VARCHAR(20),KEY by_a(a),KEY by_ab(a,b),KEY by_b(b)) STATS_AUTO_RECALC=0')
  await conn.query('INSERT INTO t VALUES ' + data.map(({ id, a, b, payload }) => `(${id},${a},${b},'${payload}')`).join(','))
  await conn.query('ANALYZE TABLE t')
}

async function createTypedHintTable(conn: mysql.Connection) {
  await conn.query('CREATE TABLE typed_keys(id INT PRIMARY KEY,g VARCHAR(12) COLLATE utf8mb4_0900_ai_ci,d DECIMAL(8,2),n INT,KEY by_g(g),KEY by_gd(g,d),KEY by_d(d)) STATS_AUTO_RECALC=0')
  await conn.query("INSERT INTO typed_keys VALUES (1,'é',3.20,1),(2,'a',2.40,3),(3,NULL,1.30,NULL),(4,'A',1.30,5),(5,'É',2.40,0),(6,'a ',3.20,4),(7,NULL,NULL,9),(8,'z',3.20,NULL),(9,'Ä',NULL,7),(10,'x',1.30,8)")
  await conn.query('ANALYZE TABLE typed_keys')
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
    [`${select} USE INDEX FOR ORDER BY (missing) IGNORE INDEX FOR GROUP BY (later)`, missing('later')],
    [`${select} USE INDEX FOR GROUP BY (missing) IGNORE INDEX FOR ORDER BY (later) ORDER BY x.id`, missing('later')],
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

test('plain SELECT reads honor USE, IGNORE and FORCE INDEX', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_access'
  const data = DATA
  const ids = (rows: typeof data) => rows.map(({ id }) => [id])
  const wide = (rows: typeof data) => rows.map(({ id, payload }) => [id, payload])
  const point = ids(data.filter(({ a }) => a === 2))
  const ranged = data.filter(({ a }) => a >= 2 && a < 4)
  const idField = ID_FIELD
  const wideFields = [idField, ['payload', 253, 80, 0, 0, 224]]
  const byA = data.slice().sort((left, right) => left.a - right.a)
  const byB = ids(data.slice().sort((left, right) => left.b - right.b))
  const scan = 'Table scan on t'
  const filtered = `Filter\n    ${scan}`
  const lookup = 'Covering index lookup on t using by_a'

  const read = checkIndexRead.bind(undefined, conn)
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn)
    await read('SELECT id FROM t USE INDEX FOR JOIN ()', ids(data), [idField], scan)
    await read('SELECT id FROM t USE INDEX (BY_B)', byB, [idField], 'Covering index scan on t using by_b')
    for (const hint of ['USE INDEX ()', 'USE INDEX () USE INDEX (by_a)', 'USE INDEX (by_a) IGNORE INDEX (by_a)', 'IGNORE INDEX (by_a) USE INDEX (by_a)', 'IGNORE INDEX FOR JOIN (by_a,by_ab)']) {
      await read(`SELECT id FROM t ${hint} WHERE a=2`, point, [idField], filtered)
    }
    await read('SELECT id FROM t USE INDEX (by_a) USE INDEX () WHERE a=2', point, [idField], lookup)
    await read('SELECT id,payload FROM t USE INDEX () WHERE a>=2 AND a<4', wide(ranged), wideFields, filtered)
    await read('SELECT id,payload FROM t USE INDEX (by_a) WHERE a>=2 AND a<4', wide(ranged.slice().sort((left, right) => left.a - right.a)), wideFields, 'Index range scan on t using by_a over')
    await read('SELECT id,payload FROM t IGNORE INDEX (PRIMARY) WHERE id=7', [[7, 'payload6']], wideFields, filtered)
    await read('SELECT id,payload FROM t USE INDEX (PRIMARY) WHERE id=7', [[7, 'payload6']], wideFields, 'Rows fetched before execution')

    await read('SELECT id FROM t USE INDEX FOR JOIN () USE INDEX FOR ORDER BY (by_a)', ids(data), [idField], scan)
    await read('SELECT id FROM t IGNORE INDEX FOR JOIN (by_a) USE INDEX FOR GROUP BY (by_a)', byB, [idField], 'Covering index scan on t using by_b')
    await read('SELECT id FROM t USE INDEX (by_a) USE INDEX FOR GROUP BY (by_b) WHERE a=2', point, [idField], lookup)
    await read('SELECT id,payload FROM t USE INDEX FOR JOIN (by_a) USE INDEX FOR ORDER BY (PRIMARY) WHERE id=7',
      [[7, 'payload6']], wideFields, filtered)
    await read("SELECT id FROM t USE INDEX FOR JOIN () IGNORE INDEX FOR ORDER BY (by_a) WHERE id='7x'",
      [[7]], [idField], filtered, [['Warning', 1292, "Truncated incorrect DOUBLE value: '7x'"]])
    await read('SELECT id FROM t FORCE INDEX (by_b)', byB, [idField], 'Covering index scan on t using by_b')
    await read('SELECT id,payload FROM t FORCE INDEX FOR JOIN (by_a) WHERE id=7', [[7, 'payload6']], wideFields, filtered)
    await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_b) WHERE id=7',
      [[7, 'payload6']], wideFields, 'Rows fetched before execution')
    for (const hint of ['FORCE INDEX FOR JOIN (by_a)', 'FORCE INDEX FOR ORDER BY (by_b)', 'FORCE INDEX FOR GROUP BY (by_b)']) {
      await read(`SELECT id,payload FROM t ${hint} WHERE a>=0`, wide(byA), wideFields, 'Index range scan on t using by_a over')
    }
    await read('SELECT id,payload FROM t FORCE INDEX (by_a) IGNORE INDEX (by_a) WHERE a>=0', wide(data), wideFields, filtered)
    const coveringRows = byA.map(({ id, a }) => [id, a])
    const coveringFields = [idField, ['a', 3, 11, 20489, 0, 63]]
    await read('SELECT id,a FROM t FORCE INDEX (by_a) WHERE a>=0',
      coveringRows, coveringFields, 'Filter\n    Covering index range scan on t using by_a over')
    await read('SELECT id,a FROM t FORCE INDEX (by_a,by_ab) WHERE a>=0',
      coveringRows, coveringFields, 'Filter\n    Covering index scan on t using by_a')

    const retained = { sql: 'SELECT id FROM t USE INDEX FOR JOIN () USE INDEX FOR GROUP BY (by_b) WHERE a=?', rowsAsArray: true }
    const forced = { sql: 'SELECT id FROM t FORCE INDEX (by_a) WHERE a=?', rowsAsArray: true }
    assert.deepEqual((await conn.execute(retained, [2]))[0], point)
    assert.deepEqual((await conn.execute(forced, [2]))[0], point)
    await conn.query('UPDATE t SET a=0 WHERE id=3')
    assert.deepEqual((await conn.execute(retained, [2]))[0], point.slice(1))
    assert.deepEqual((await conn.execute(forced, [2]))[0], point.slice(1))
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
      reads.length = 0
      await read('SELECT id FROM same_key FORCE INDEX (alternative) WHERE id=2', [[2]], [['id', 3, 11, 20487, 0, 63]], 'Rows fetched before execution')
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
  const wide = (rows: typeof DATA) => rows.map(({ id, payload }) => [id, payload])
  const wideFields = [ID_FIELD, ['payload', 253, 80, 0, 0, 224]]
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
    for (const preference of ['off', 'on']) {
      await conn.query(`SET optimizer_switch='prefer_ordering_index=${preference}'`)
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a',
        wide(byA), wideFields, 'Index scan on t using by_a')
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a DESC',
        wide(byA.slice().reverse()), wideFields, 'Index scan on t using by_a')
      await read('SELECT id,payload FROM t FORCE INDEX (by_ab) ORDER BY a,b',
        wide(byAb), wideFields, 'Index scan on t using by_ab')
      await read('SELECT id,a AS g FROM t FORCE INDEX FOR ORDER BY (by_ab) ORDER BY g',
        byAb.map(({ id, a }) => [id, a]), [ID_FIELD, ['g', ...aField.slice(1)]], 'Covering index scan on t using by_ab')
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a) IGNORE INDEX FOR JOIN (by_a) ORDER BY a',
        wide(byA), wideFields, 'Index scan on t using by_a')
      await read('SELECT id,a FROM t FORCE INDEX FOR JOIN (by_b) FORCE INDEX FOR ORDER BY (by_a) ORDER BY a',
        byA.map(({ id, a }) => [id, a]), [ID_FIELD, aField], 'Index scan on t using by_a')
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a,id LIMIT 4 OFFSET 7',
        wide(byA.slice(7, 11)), wideFields, 'Limit/Offset\n    Index scan on t using by_a')
      await read('SELECT id,payload FROM t FORCE INDEX (by_ab) ORDER BY a DESC,b DESC,id DESC LIMIT 4',
        wide(byAb.slice().reverse().slice(0, 4)), wideFields, 'Limit\n    Index scan on t using by_ab')
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a,id LIMIT 0 OFFSET 7',
        [], wideFields, 'Limit/Offset\n    Index scan on t using by_a')
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a,id DESC LIMIT 4',
        wide(byA.slice(0, 8).reverse().slice(0, 4)), wideFields, 'Limit\n    Sort\n        Table scan on t')
      await read('SELECT id,payload FROM t FORCE INDEX FOR ORDER BY (by_a,by_b) ORDER BY a DESC,id DESC',
        wide(byA.slice().reverse()), wideFields, 'Index scan on t using by_a')
      await read('SELECT id,payload FROM t FORCE INDEX (by_a,by_ab) ORDER BY a,b,id LIMIT 4 OFFSET 7',
        wide(byAb.slice(7, 11)), wideFields, 'Limit/Offset\n    Index scan on t using by_ab')
      await read('SELECT id,a FROM t FORCE INDEX FOR ORDER BY (by_a,by_ab) ORDER BY a LIMIT 6',
        first, [ID_FIELD, aField], `Limit\n    ${coverA}`)
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('ORDER BY hints can read secondary keys on tables with hidden clustered row IDs', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_hidden_order'
  const read = checkIndexRead.bind(undefined, conn)
  const data = Array.from({ length: 32 }, (_, i) => ({ id: (i * 13) % 32 + 1, a: i % 8, b: (i * 11) % 13, payload: 'p' + i }))
  const byA = data.slice().sort((left, right) => left.a - right.a)
  const byAId = byA.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const payloads = (rows: typeof data) => rows.map(({ payload }) => [payload])
  const payloadField = [['payload', 253, 80, 0, 0, 224]]
  const aField = [['a', 3, 11, 20489, 0, 63]]
  const cover = 'Covering index scan on t using by_a'
  const scan = 'Index scan on t using by_a'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await conn.query('CREATE TABLE t(id INT,a INT NOT NULL,b INT NOT NULL,payload VARCHAR(20),KEY by_a(a),KEY by_ab(a,b)) STATS_AUTO_RECALC=0')
    await conn.query('INSERT INTO t VALUES ' + data.map(({ id, a, b, payload }) => `(${id},${a},${b},'${payload}')`).join(','))
    for (const alter of [undefined, 'ALTER TABLE t ADD UNIQUE KEY id_key(id)']) {
      if (alter !== undefined) await conn.query(alter)
      await conn.query('ANALYZE TABLE t')
      await read('SELECT payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a',
        payloads(byA), payloadField, scan)
      await read('SELECT payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a DESC LIMIT 4 OFFSET 2',
        payloads(byA.slice().reverse().slice(2, 6)), payloadField, `Limit/Offset\n    ${scan}`)
      await read('SELECT a FROM t ORDER BY a', byA.map(({ a }) => [a]), aField, cover)
      await read('SELECT a FROM t FORCE INDEX FOR ORDER BY (by_ab) ORDER BY a',
        byA.map(({ a }) => [a]), aField, `Sort\n    ${cover}`)
      await read('SELECT payload FROM t FORCE INDEX FOR ORDER BY (by_a) ORDER BY a,id LIMIT 4 OFFSET 2',
        payloads(byAId.slice(2, 6)), payloadField, 'Limit/Offset\n    Sort\n        Table scan on t')
    }
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('GROUP BY index hints select ordered grouping or temporary aggregation', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_group'
  const read = checkIndexRead.bind(undefined, conn)
  const aField = ['a', 3, 11, 20489, 0, 63]
  const copiedA = ['a', 3, 11, 4097, 0, 63]
  const count = ['COUNT(*)', 8, 21, 129, 0, 63]
  const copiedCount = ['COUNT(*)', 8, 21, 1, 0, 63]
  const byA = DATA.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const totals = Array.from({ length: 8 }, (_, a) => [a, 8])
  const coverA = 'Covering index scan on t using by_a'
  const coverAb = 'Covering index scan on t using by_ab'
  const temporary = (input: string) => `Table scan on <temporary>\n    Aggregate using temporary table\n        ${input}`
  const streaming = (input: string) => `Group aggregate\n    ${input}`
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn)
    for (const hint of ['USE INDEX FOR GROUP BY ()', 'USE INDEX FOR GROUP BY () USE INDEX FOR GROUP BY (by_a)', 'USE INDEX FOR GROUP BY (by_a) IGNORE INDEX FOR GROUP BY (by_a)']) {
      await read(`SELECT a,COUNT(*) FROM t ${hint} GROUP BY a`, totals, [copiedA, copiedCount], temporary(coverA))
    }
    for (const hint of ['IGNORE INDEX FOR GROUP BY (by_a)', 'USE INDEX FOR GROUP BY (BY_AB)']) {
      await read(`SELECT a,COUNT(*) FROM t ${hint} GROUP BY a`, totals, [aField, count], streaming(coverAb))
    }
    await read('SELECT a AS bucket,COUNT(*) FROM t USE INDEX FOR GROUP BY (by_a) USE INDEX FOR GROUP BY () GROUP BY 1',
      totals, [['bucket', ...aField.slice(1)], count], streaming(coverA))
    const byAb = DATA.slice().sort((left, right) => left.a - right.a || left.b - right.b)
    await read('SELECT a,b,COUNT(*) FROM t USE INDEX FOR GROUP BY () GROUP BY a,b',
      byAb.map(({ a, b }) => [a, b, 1]), [copiedA, ['b', ...copiedA.slice(1)], copiedCount], temporary(coverAb))
    await read('SELECT id,COUNT(*) FROM t USE INDEX FOR GROUP BY () GROUP BY id',
      byA.map(({ id }) => [id, 1]), [['id', ...copiedA.slice(1)], copiedCount], temporary(coverA))
    await read('SELECT id,COUNT(*) FROM t USE INDEX FOR GROUP BY (PRIMARY) GROUP BY id',
      DATA.map(({ id }) => [id, 1]), [ID_FIELD, count], streaming('Covering index scan on t using PRIMARY'))
    const sums = totals.map(([a]) => [a, String(DATA.filter((row) => row.a === a).reduce((sum, row) => sum + row.id, 0))])
    await read('SELECT a,SUM(id) FROM t USE INDEX FOR GROUP BY () GROUP BY a',
      sums, [copiedA, ['SUM(id)', 246, 33, 0, 0, 63]], temporary(coverA))
    const minimums = totals.map(([a]) => [a, DATA.filter((row) => row.a === a).map((row) => row.payload).sort()[0]])
    await read('SELECT a,MIN(payload) FROM t USE INDEX FOR GROUP BY (by_ab) GROUP BY a',
      minimums, [aField, ['MIN(payload)', 253, 80, 0, 31, 224]], streaming('Index scan on t using by_ab'))
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('unscoped index hints govern both the scan and ORDER BY', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_unscoped_order'
  const read = checkIndexRead.bind(undefined, conn)
  const aField = ['a', 3, 11, 20489, 0, 63]
  const bField = ['b', 3, 11, 20489, 0, 63]
  const byA = DATA.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const first = byA.slice(0, 6).map(({ id, a }) => [id, a])
  const byId = DATA.slice(-6).reverse()
  const sortedTable = 'Limit\n    Sort\n        Table scan on t'
  const coverA = 'Covering index scan on t using by_a'
  const sortedA = `Limit\n    Sort\n        ${coverA}`
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn)
    for (const hint of ['USE INDEX ()', 'USE INDEX () USE INDEX (by_a)', 'USE INDEX (by_a) IGNORE INDEX (by_a)']) {
      await read(`SELECT id,a FROM t ${hint} ORDER BY 2,1 LIMIT 6`, first, [ID_FIELD, aField], sortedTable)
    }
    await read('SELECT id,a FROM t IGNORE INDEX (by_a) ORDER BY a,id LIMIT 6', first, [ID_FIELD, aField],
      'Limit\n    Sort\n        Covering index scan on t using by_ab')
    await read('SELECT id,a FROM t USE INDEX (by_a) USE INDEX () ORDER BY a,id LIMIT 6', first,
      [ID_FIELD, aField], `Limit\n    ${coverA}`)
    await read('SELECT id,a FROM t USE INDEX (by_b) ORDER BY a+0,id LIMIT 6', first, [ID_FIELD, aField], sortedTable)
    await read('SELECT id,a FROM t USE INDEX (by_a) ORDER BY id DESC LIMIT 6', byId.map(({ id, a }) => [id, a]),
      [ID_FIELD, aField], sortedA)
    await read('SELECT id FROM t USE INDEX (PRIMARY) ORDER BY id DESC LIMIT 6', byId.map(({ id }) => [id]),
      [ID_FIELD], 'Limit\n    Covering index scan on t using PRIMARY')
    const byB = DATA.slice().sort((left, right) => right.b - left.b || right.id - left.id)
    await read('SELECT id,b FROM t USE INDEX (by_b) ORDER BY b DESC,id DESC LIMIT 6 OFFSET 4',
      byB.slice(4, 10).map(({ id, b }) => [id, b]), [ID_FIELD, bField], 'Limit/Offset\n    Covering index scan on t using by_b')
    await conn.query("SET optimizer_switch='prefer_ordering_index=off'")
    await read('SELECT id,a FROM t IGNORE INDEX (by_a,by_ab) ORDER BY a,id LIMIT 6', first, [ID_FIELD, aField], sortedTable)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('mixed JOIN and ORDER BY hints retain independent eligibility', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_mixed_order'
  const read = checkIndexRead.bind(undefined, conn)
  const fields = [ID_FIELD, ['a', 3, 11, 20489, 0, 63]]
  const byA = DATA.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const first = byA.slice(0, 6).map(({ id, a }) => [id, a])
  const ids = DATA.slice(-6).reverse().map(({ id }) => [id])
  const coverA = 'Covering index scan on t using by_a'
  const sortedA = `Limit\n    Sort\n        ${coverA}`
  const sortedAb = 'Limit\n    Sort\n        Covering index scan on t using by_ab'
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn)
    for (const [hint, plan] of [
      ['USE INDEX (by_a) IGNORE INDEX FOR ORDER BY (by_a)', sortedA],
      ['USE INDEX FOR ORDER BY () USE INDEX FOR JOIN (by_a)', sortedA],
      ['USE INDEX (by_a) USE INDEX FOR ORDER BY (by_b)', `Limit\n    ${coverA}`],
      ['IGNORE INDEX FOR JOIN (by_a) USE INDEX FOR ORDER BY (by_a)', sortedAb],
      ['IGNORE INDEX (by_a) USE INDEX FOR ORDER BY (by_a)', sortedAb],
      ['USE INDEX (by_a) USE INDEX FOR GROUP BY (by_b)', `Limit\n    ${coverA}`],
      ['USE INDEX FOR GROUP BY (by_b) IGNORE INDEX FOR ORDER BY (by_a)', sortedA],
    ] as const) {
      await read(`SELECT id,a FROM t ${hint} ORDER BY 2,1 LIMIT 6`, first, fields, plan)
    }
    await read('SELECT id,a FROM t USE INDEX (by_a) IGNORE INDEX FOR JOIN (by_a) ORDER BY a,id',
      byA.map(({ id, a }) => [id, a]), fields, 'Sort\n    Table scan on t')
    await read('SELECT id FROM t USE INDEX FOR JOIN (by_a) USE INDEX FOR ORDER BY (PRIMARY) ORDER BY id DESC LIMIT 6',
      ids, [ID_FIELD], sortedA)
    await read('SELECT id FROM t USE INDEX FOR JOIN () USE INDEX FOR ORDER BY (PRIMARY) ORDER BY id DESC LIMIT 6',
      ids, [ID_FIELD], 'Limit\n    Index scan on t using PRIMARY')
    await read('SELECT id FROM t USE INDEX FOR JOIN (PRIMARY) USE INDEX FOR ORDER BY (PRIMARY) ORDER BY id DESC LIMIT 6',
      ids, [ID_FIELD], 'Limit\n    Covering index scan on t using PRIMARY')
    await conn.query("SET optimizer_switch='prefer_ordering_index=off'")
    await read('SELECT id,a FROM t IGNORE INDEX FOR JOIN (by_a) USE INDEX FOR ORDER BY (by_a) ORDER BY a,id LIMIT 6',
      first, fields, sortedAb)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('unscoped index hints govern both the scan and GROUP BY', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_unscoped_group'
  const read = checkIndexRead.bind(undefined, conn)
  const data = GROUP_DATA
  const aField = ['a', 3, 11, 20489, 0, 63]
  const copiedA = ['a', 3, 11, 4097, 0, 63]
  const count = ['COUNT(*)', 8, 21, 129, 0, 63]
  const copiedCount = ['COUNT(*)', 8, 21, 1, 0, 63]
  const firstSeen = data.slice(0, 8).map(({ a }) => [a, 8] as const)
  const byA = data.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const temporary = (input: string) => `Table scan on <temporary>\n    Aggregate using temporary table\n        ${input}`
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn, data)
    for (const hint of ['USE INDEX ()', 'USE INDEX (PRIMARY)', 'USE INDEX (by_b)', 'USE INDEX (by_a) IGNORE INDEX (by_a)']) {
      await read(`SELECT a,COUNT(*) FROM t ${hint} GROUP BY a`, firstSeen, [copiedA, copiedCount], temporary('Table scan on t'))
    }
    await read('SELECT a,COUNT(*) FROM t IGNORE INDEX (by_a) GROUP BY a',
      firstSeen.slice().sort((left, right) => left[0] - right[0]), [aField, count], 'Group aggregate\n    Covering index scan on t using by_ab')
    await read('SELECT id,COUNT(*) FROM t USE INDEX (by_a) GROUP BY id',
      byA.map(({ id }) => [id, 1]), [['id', ...copiedA.slice(1)], copiedCount], temporary('Covering index scan on t using by_a'))
    await read('SELECT id,COUNT(*) FROM t USE INDEX (PRIMARY) GROUP BY id',
      data.map(({ id }) => [id, 1]), [ID_FIELD, count], 'Group aggregate\n    Covering index scan on t using PRIMARY')

    await createTypedHintTable(conn)
    await read('SELECT g,COUNT(*) FROM typed_keys USE INDEX () GROUP BY g',
      [['é', 2], ['a', 3], [null, 2], ['a ', 1], ['z', 1], ['x', 1]],
      [['g', 253, 48, 32768, 0, 224], copiedCount], temporary('Table scan on typed_keys'))
    await read('SELECT g,SUM(d) FROM typed_keys IGNORE INDEX (by_g) GROUP BY g',
      [[null, '1.30'], ['Ä', '3.70'], ['a ', '3.20'], ['É', '5.60'], ['x', '1.30'], ['z', '3.20']],
      [['g', 253, 48, 16392, 0, 224], ['SUM(d)', 246, 32, 128, 2, 63]], 'Group aggregate\n    Covering index scan on typed_keys using by_gd')
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})

test('mixed JOIN and GROUP BY hints retain the eligible scan when grouping needs a temporary table', async () => {
  const { db, conn } = await indexHintConnection()
  const schema = 'index_hint_mixed_group'
  const read = checkIndexRead.bind(undefined, conn)
  const firstSeen = GROUP_DATA.slice(0, 8).map(({ a }) => [a, 8] as const)
  const sorted = firstSeen.slice().sort((left, right) => left[0] - right[0])
  const byB = Array.from({ length: 17 }, (_, b) => [b, GROUP_DATA.filter((row) => row.b === b).length])
  const byA = GROUP_DATA.slice().sort((left, right) => left.a - right.a || left.id - right.id)
  const aField = ['a', 3, 11, 20489, 0, 63]
  const copiedA = ['a', 3, 11, 4097, 0, 63]
  const copiedCount = ['COUNT(*)', 8, 21, 1, 0, 63]
  const count = ['COUNT(*)', 8, 21, 129, 0, 63]
  const coverA = 'Covering index scan on t using by_a'
  const temporary = (input: string) => `Table scan on <temporary>\n    Aggregate using temporary table\n        ${input}`
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    await createHintTable(conn, GROUP_DATA)
    await read('SELECT a,COUNT(*) FROM t USE INDEX (by_a) IGNORE INDEX FOR GROUP BY (by_a) GROUP BY a',
      sorted, [copiedA, copiedCount], temporary(coverA))
    await read('SELECT a,COUNT(*) FROM t USE INDEX () USE INDEX FOR GROUP BY (by_a) GROUP BY a',
      firstSeen, [copiedA, copiedCount], temporary('Table scan on t'))
    await read('SELECT a,COUNT(*) FROM t USE INDEX FOR GROUP BY (by_a) USE INDEX () GROUP BY a',
      sorted, [aField, count], 'Group aggregate\n    Index scan on t using by_a')
    await read('SELECT a,COUNT(*) FROM t IGNORE INDEX FOR JOIN (by_a) USE INDEX FOR GROUP BY (by_a) GROUP BY a',
      sorted, [copiedA, copiedCount], temporary('Covering index scan on t using by_ab'))
    await read('SELECT id,COUNT(*) FROM t USE INDEX FOR JOIN (by_a) USE INDEX FOR GROUP BY (PRIMARY) GROUP BY id',
      byA.map(({ id }) => [id, 1]), [['id', ...copiedA.slice(1)], copiedCount], temporary(coverA))
    await read('SELECT id,COUNT(*) FROM t USE INDEX FOR JOIN () USE INDEX FOR GROUP BY (PRIMARY) GROUP BY id',
      GROUP_DATA.map(({ id }) => [id, 1]), [ID_FIELD, count], 'Group aggregate\n    Index scan on t using PRIMARY')

    for (const preference of ['off', 'on']) {
      await conn.query(`SET optimizer_switch='prefer_ordering_index=${preference}'`)
      await read('SELECT a,COUNT(*) FROM t FORCE INDEX (by_b) GROUP BY a',
        firstSeen, [copiedA, copiedCount], temporary('Table scan on t'))
      await read('SELECT a,COUNT(*) FROM t FORCE INDEX (by_ab) GROUP BY a',
        sorted, [aField, count], 'Group aggregate\n    Covering index scan on t using by_ab')
      await read('SELECT a,COUNT(*) FROM t FORCE INDEX FOR GROUP BY (by_b) GROUP BY a',
        sorted, [copiedA, copiedCount], temporary(coverA))
      await read('SELECT a,COUNT(*) FROM t FORCE INDEX FOR GROUP BY (by_a) IGNORE INDEX FOR JOIN (by_a) GROUP BY a',
        sorted, [copiedA, copiedCount], temporary('Covering index scan on t using by_ab'))
      await read('SELECT a,COUNT(*) FROM t FORCE INDEX FOR JOIN (by_b) FORCE INDEX FOR GROUP BY (by_a) GROUP BY a',
        sorted, [aField, count], 'Group aggregate\n    Index scan on t using by_a')
      await read('SELECT b,COUNT(*) FROM t FORCE INDEX FOR JOIN (by_a) GROUP BY b',
        byB, [['b', ...aField.slice(1)], count], 'Group aggregate\n    Index scan on t using by_b')
    }

    await createTypedHintTable(conn)
    const sums = [[null, '1.30'], ['Ä', '3.70'], ['a ', '3.20'], ['É', '5.60'], ['x', '1.30'], ['z', '3.20']]
    await read('SELECT g,SUM(d) FROM typed_keys IGNORE INDEX FOR JOIN (by_g) USE INDEX FOR GROUP BY (by_g) GROUP BY g',
      sums, [['g', 253, 48, 32768, 0, 224], ['SUM(d)', 246, 32, 0, 2, 63]], temporary('Covering index scan on typed_keys using by_gd'))
    await read('SELECT g,SUM(d) FROM typed_keys USE INDEX FOR JOIN (by_g) USE INDEX FOR GROUP BY (by_gd) GROUP BY g',
      sums, [['g', 253, 48, 16392, 0, 224], ['SUM(d)', 246, 32, 128, 2, 63]], 'Group aggregate\n    Index scan on typed_keys using by_gd')
    await read('SELECT g,SUM(d) FROM typed_keys FORCE INDEX FOR GROUP BY (by_g) GROUP BY g',
      sums, [['g', 253, 48, 32768, 0, 224], ['SUM(d)', 246, 32, 0, 2, 63]], temporary('Covering index scan on typed_keys using by_gd'))
    await read('SELECT g,SUM(d) FROM typed_keys FORCE INDEX (by_gd) GROUP BY g',
      sums, [['g', 253, 48, 16392, 0, 224], ['SUM(d)', 246, 32, 128, 2, 63]], 'Group aggregate\n    Covering index scan on typed_keys using by_gd')
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
})
