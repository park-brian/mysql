#!/usr/bin/env node
// M5.12's instrument: INFORMATION_SCHEMA, as 8.4.11 answers it.
//
// Two things are captured, both before any of the code they check:
//
//   **The definitions.** For each table an introspecting client reads, the
//   column metadata `SELECT *` reports (type, length, flags, decimals, and
//   whether it is a dictionary column or a computed one) and the collation
//   each column compares in. These are facts about the interface, like the
//   reserved words of D-39: names and numbers, written into
//   `packages/core/src/sql/information-schema-defs.ts`.
//
//   **A corpus.** Generated scripts of DDL — tables of every column type
//   Prisma and Drizzle write, defaults, comments, keys of every kind, foreign
//   keys with every referential action, views — each followed by Prisma's
//   own introspection queries and a `SELECT` of every table filtered to the
//   script's schema. The server's answers go to
//   `test/format/fixtures/information-schema.json`, and
//   `information-schema-vectors.test.ts` replays them through the executor.
//
// Columns whose values are statistics or clocks — sizes, row counts, times,
// cardinality — are left out of the corpus's SELECTs and named in VOLATILE,
// since they differ between two runs of the same server.
//
// Usage (8.4.11 from `tools/mysql-local.mjs` up):
//   node tools/capture-information-schema.mjs [--scripts 120] [--seed 7]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'

const ROOT = new URL('..', import.meta.url).pathname
const DEFS = join(ROOT, 'packages/core/src/sql/information-schema-defs.ts')
const FIXTURE = join(ROOT, 'test/format/fixtures/information-schema.json')
const option = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at < 0 ? fallback : Number(process.argv[at + 1])
}

export const TABLES = ['SCHEMATA', 'TABLES', 'COLUMNS', 'STATISTICS', 'KEY_COLUMN_USAGE', 'REFERENTIAL_CONSTRAINTS', 'TABLE_CONSTRAINTS', 'CHECK_CONSTRAINTS', 'VIEWS', 'ROUTINES']

/** Statistics and clocks: two runs of one server disagree on them. */
export const VOLATILE = {
  TABLES: ['VERSION', 'TABLE_ROWS', 'AVG_ROW_LENGTH', 'DATA_LENGTH', 'MAX_DATA_LENGTH', 'INDEX_LENGTH', 'DATA_FREE', 'AUTO_INCREMENT', 'CREATE_TIME', 'UPDATE_TIME', 'CHECK_TIME'],
  STATISTICS: ['CARDINALITY'],
  ROUTINES: ['CREATED', 'LAST_ALTERED'],
}

/** The schema-filter column of each table, and its order. */
const FILTER = {
  SCHEMATA: ['SCHEMA_NAME', 'SCHEMA_NAME'],
  TABLES: ['TABLE_SCHEMA', 'TABLE_NAME'],
  COLUMNS: ['TABLE_SCHEMA', 'TABLE_NAME, ORDINAL_POSITION'],
  STATISTICS: ['TABLE_SCHEMA', 'TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'],
  KEY_COLUMN_USAGE: ['TABLE_SCHEMA', 'TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION'],
  REFERENTIAL_CONSTRAINTS: ['CONSTRAINT_SCHEMA', 'TABLE_NAME, CONSTRAINT_NAME'],
  TABLE_CONSTRAINTS: ['TABLE_SCHEMA', 'TABLE_NAME, CONSTRAINT_NAME'],
  CHECK_CONSTRAINTS: ['CONSTRAINT_SCHEMA', 'CONSTRAINT_NAME'],
  VIEWS: ['TABLE_SCHEMA', 'TABLE_NAME'],
  ROUTINES: ['ROUTINE_SCHEMA', 'ROUTINE_NAME'],
}

/** Prisma 5.22's schema engine's introspection queries, as the census found them: `?` is the schema. */
export const PRISMA_QUERIES = [
  `SELECT DISTINCT BINARY table_info.table_name AS table_name, table_info.create_options AS create_options, table_info.table_comment AS table_comment
     FROM information_schema.tables AS table_info JOIN information_schema.columns AS column_info ON BINARY column_info.table_name = BINARY table_info.table_name
     WHERE table_info.table_schema = ? AND column_info.table_schema = ? AND table_info.table_type = 'BASE TABLE' ORDER BY BINARY table_info.table_name`,
  `SELECT column_name column_name, data_type data_type, column_type full_data_type, character_maximum_length character_maximum_length, numeric_precision numeric_precision,
     numeric_scale numeric_scale, datetime_precision datetime_precision, column_default column_default, is_nullable is_nullable, extra extra, table_name table_name,
     IF(column_comment = '', NULL, column_comment) AS column_comment FROM information_schema.columns WHERE table_schema = ? ORDER BY ordinal_position`,
  `SELECT kcu.constraint_name constraint_name, kcu.column_name column_name, kcu.referenced_table_name referenced_table_name, kcu.referenced_column_name referenced_column_name,
     kcu.ordinal_position ordinal_position, kcu.table_name table_name, rc.delete_rule delete_rule, rc.update_rule update_rule
     FROM information_schema.key_column_usage AS kcu INNER JOIN information_schema.referential_constraints AS rc ON BINARY kcu.constraint_name = BINARY rc.constraint_name
     WHERE BINARY kcu.table_schema = ? AND BINARY rc.constraint_schema = ? AND kcu.referenced_column_name IS NOT NULL
     ORDER BY BINARY kcu.table_schema, BINARY kcu.table_name, BINARY kcu.constraint_name, kcu.ordinal_position`,
  `SELECT table_name AS table_name, index_name AS index_name, column_name AS column_name, sub_part AS partial, seq_in_index AS seq_in_index, collation AS column_order,
     non_unique AS non_unique, index_type AS index_type FROM information_schema.statistics WHERE table_schema = ? ORDER BY BINARY table_name, BINARY index_name, seq_in_index`,
  `SELECT routine_name AS name, routine_definition AS definition FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`,
  `SELECT TABLE_NAME AS view_name, VIEW_DEFINITION AS view_sql FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = ?`,
  `SELECT tc.table_schema AS namespace, tc.table_name AS table_name, tc.constraint_name AS constraint_name, LOWER(tc.constraint_type) AS constraint_type,
     cc.check_clause AS constraint_definition FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc LEFT JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
     ON cc.constraint_schema = tc.table_schema AND cc.constraint_name = tc.constraint_name WHERE tc.table_schema = ? AND tc.constraint_type = 'CHECK'
     ORDER BY tc.table_schema, tc.table_name, tc.constraint_name`,
]

export const SCHEMA = 'myjs_is'
export const CONNECTION = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'root',
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true,
}

// --- the generator ----------------------------------------------------------------

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1103515245 + 12345) >>> 0
    return s / 2 ** 32
  }
}

/** Column types, as Prisma's and Drizzle's DDL writes them, with a default each may take. */
const TYPES = [
  ['INT', ['0', '7', '-3', 'NULL']],
  ['INT UNSIGNED', ['0', '42']],
  ['BIGINT', ['0', '9007199254740993']],
  ['TINYINT(1)', ['0', '1', 'true', 'false']],
  ['SMALLINT', ['5']],
  ['DECIMAL(65,30)', ['0.5']],
  ['DECIMAL(10,2)', ['1.25', '0']],
  ['DOUBLE', ['1.5', '0']],
  ['FLOAT', ['2.5']],
  ['VARCHAR(191)', ["'abc'", "''", "'it''s'"]],
  ['VARCHAR(255)', ["'x'"]],
  ['CHAR(36)', ["'00000000-0000-0000-0000-000000000000'"]],
  ['TEXT', []],
  ['MEDIUMTEXT', []],
  ['LONGBLOB', []],
  ['VARBINARY(16)', []],
  ['DATETIME(3)', ['CURRENT_TIMESTAMP(3)', "'2020-01-02 03:04:05.000'"]],
  ['DATETIME', ['CURRENT_TIMESTAMP', "'2020-01-02 03:04:05'"]],
  ['TIMESTAMP(6)', ['CURRENT_TIMESTAMP(6)']],
  ['DATE', ["'2020-01-02'"]],
  ['TIME(3)', ["'01:02:03.000'"]],
  ['JSON', []],
  ["ENUM('a','b','c')", ["'a'"]],
  ['VARCHAR(20) CHARACTER SET latin1', ["'l'"]],
  ['VARCHAR(20) COLLATE utf8mb4_bin', ["'b'"]],
]

const RULES = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']

/** One script: a few tables, keys and indexes, foreign keys between them, perhaps a view. */
function script(rand, n) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)]
  const statements = []
  const tables = []
  const count = 1 + Math.floor(rand() * 3)
  for (let t = 0; t < count; t++) {
    const name = pick(['User', 'post', 'Item_2', 'a', 'Category', 'tag', 'order_line']) + (t === 0 ? '' : String(t))
    if (tables.some((x) => x.name === name)) continue
    const columns = []
    const defs = []
    const idType = pick(['INT NOT NULL AUTO_INCREMENT', 'VARCHAR(191) NOT NULL', 'BIGINT NOT NULL AUTO_INCREMENT', 'CHAR(36) NOT NULL'])
    defs.push(`\`id\` ${idType}`)
    columns.push({ name: 'id', type: idType.split(' NOT')[0] })
    const width = 1 + Math.floor(rand() * 5)
    for (let c = 0; c < width; c++) {
      const [type, defaults] = pick(TYPES)
      const col = pick(['name', 'email', 'createdAt', 'updated_at', 'score', 'flag', 'data', 'Price', 'kind', 'note']) + c
      const nullable = rand() < 0.5
      let def = `\`${col}\` ${type}${nullable ? ' NULL' : ' NOT NULL'}`
      if (defaults.length > 0 && rand() < 0.5) {
        const d = pick(defaults)
        if (!(d === 'NULL' && !nullable)) def += ` DEFAULT ${d}`
        if (d.startsWith('CURRENT_TIMESTAMP') && rand() < 0.4) def += ` ON UPDATE ${d}`
      }
      if (rand() < 0.15) def += ` COMMENT 'c${c}'`
      defs.push(def)
      columns.push({ name: col, type })
    }
    defs.push('PRIMARY KEY (`id`)')
    const indexable = columns.filter((c) => !/TEXT|BLOB|JSON/.test(c.type))
    if (indexable.length > 1 && rand() < 0.5) defs.push(`UNIQUE INDEX \`${name}_${indexable[1].name}_key\` (\`${indexable[1].name}\`)`)
    if (indexable.length > 2 && rand() < 0.5) defs.push(`INDEX \`${name}_multi_idx\` (\`${indexable[2].name}\`, \`${indexable[1].name}\`${rand() < 0.3 ? ' DESC' : ''})`)
    const options = pick(['', ' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', " COMMENT='t'", ' ENGINE=InnoDB'])
    statements.push(`CREATE TABLE \`${name}\` (\n  ${defs.join(',\n  ')}\n)${options}`)
    tables.push({ name, columns, idType: idType.split(' NOT')[0] })
  }
  // Foreign keys, as Prisma adds them: one ALTER each, on a column of the referenced key's type.
  for (const child of tables.slice(1)) {
    const parent = tables[Math.floor(rand() * tables.indexOf(child))]
    const column = `${parent.name}Id`
    const nullable = rand() < 0.5
    statements.push(`ALTER TABLE \`${child.name}\` ADD COLUMN \`${column}\` ${parent.idType}${nullable ? ' NULL' : ' NOT NULL'}`)
    const onDelete = nullable ? pick(RULES) : pick(RULES.filter((r) => r !== 'SET NULL'))
    statements.push(`ALTER TABLE \`${child.name}\` ADD CONSTRAINT \`${child.name}_${column}_fkey\` FOREIGN KEY (\`${column}\`) REFERENCES \`${parent.name}\`(\`id\`) ON DELETE ${onDelete} ON UPDATE ${pick(RULES.filter((r) => r !== 'SET NULL'))}`)
  }
  if (rand() < 0.3) {
    const t = tables[0]
    statements.push(`CREATE VIEW \`${t.name}_v\` AS SELECT \`id\`, \`${t.columns.at(-1).name}\` FROM \`${t.name}\``)
  }
  if (rand() < 0.15) statements.push(`CREATE TABLE \`checked${n}\` (\`n\` INT, CONSTRAINT \`n_positive\` CHECK (\`n\` > 0))`)
  return statements
}

/** The queries each script ends with: Prisma's, and every table whole. */
export function probes(schema) {
  const out = PRISMA_QUERIES.map((sql) => ({
    sql,
    params: [...sql.matchAll(/\?/g)].map(() => schema),
  }))
  for (const t of TABLES) {
    const [where, order] = FILTER[t]
    out.push({ table: t, where, order })
  }
  return out
}

// --- the capture --------------------------------------------------------------------

/** A value as a client received it, or hex for bytes. */
const cell = (v) => (v === null ? null : Buffer.isBuffer(v) ? `0x${v.toString('hex')}` : String(v))

/** Run one script's statements and probes; `columns` names each table's non-volatile columns. */
export async function runScript(conn, schema, statements, columns) {
  const out = []
  await conn.query(`DROP DATABASE IF EXISTS \`${schema}\``)
  await conn.query(`CREATE DATABASE \`${schema}\``)
  await conn.query(`USE \`${schema}\``)
  for (const sql of statements) {
    try {
      await conn.query(sql)
      out.push({ sql, ok: true })
    } catch (e) {
      out.push({ sql, error: e.errno })
    }
  }
  for (const p of probes(schema)) {
    const sql = p.sql ?? `SELECT ${columns[p.table].join(', ')} FROM information_schema.${p.table} WHERE ${p.where} = ? ORDER BY ${p.order}`
    try {
      const [rows, fields] = await conn.execute({ sql, rowsAsArray: true }, p.params ?? [schema])
      out.push({
        sql,
        select: true,
        columns: fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet]),
        rows: rows.map((r) => r.map(cell)),
      })
    } catch (e) {
      out.push({ sql, select: true, error: e.errno })
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const conn = await mysql.createConnection(CONNECTION)
  const [[{ v: version }]] = await conn.query('SELECT VERSION() AS v')

  // The definitions.
  const defs = {}
  for (const t of TABLES) {
    const [, fields] = await conn.query(`SELECT * FROM information_schema.${t} LIMIT 0`)
    const [[collations]] = await conn
      .query({
        sql: `SELECT ${fields.map((f) => `COLLATION(\`${f.name}\`)`).join(', ')} FROM information_schema.${t} LIMIT 1`,
        rowsAsArray: true,
      })
      .catch(() => [[fields.map(() => null)]])
    defs[t] = fields.map((f, i) => ({
      name: f.name,
      type: f.columnType,
      length: f.columnLength,
      flags: f.flags,
      decimals: f.decimals,
      text: f.characterSet !== 63,
      // A dictionary column reports its schema; a computed one does not.
      column: f.schema === 'information_schema',
      collation: collations?.[i] ?? null,
    }))
  }
  const lines = TABLES.map((t) => `  ${t}: [\n${defs[t].map((c) => `    ${JSON.stringify(c)},`).join('\n')}\n  ],`)
  writeFileSync(
    DEFS,
    `// Generated by tools/capture-information-schema.mjs from ${version}. Do not edit.\n` +
      '//\n' +
      "// Each INFORMATION_SCHEMA table's columns as `SELECT *` reports them through a\n" +
      '// utf8mb4 connection (lengths are in its bytes), whether each is a dictionary\n' +
      '// column or a computed one, and the collation it compares in (M5.12).\n' +
      'export interface InformationSchemaColumn {\n  readonly name: string\n  readonly type: number\n  readonly length: number\n  readonly flags: number\n  readonly decimals: number\n  readonly text: boolean\n  readonly column: boolean\n  readonly collation: string | null\n}\n\n' +
      `export const INFORMATION_SCHEMA: Readonly<Record<string, readonly InformationSchemaColumn[]>> = {\n${lines.join('\n')}\n}\n`,
  )

  // The corpus.
  const columns = Object.fromEntries(TABLES.map((t) => [t, defs[t].map((c) => c.name).filter((n) => !(VOLATILE[t] ?? []).includes(n))]))
  const rand = rng(option('seed', 7))
  const cases = []
  for (let n = 0; n < option('scripts', 120); n++) cases.push(await runScript(conn, SCHEMA, script(rand, n), columns))
  await conn.query(`DROP DATABASE IF EXISTS \`${SCHEMA}\``)
  await conn.end()
  writeFileSync(FIXTURE, `${JSON.stringify({ capturedAgainst: `mysql-server ${version}`, volatile: VOLATILE, columns, cases }, null, 1)}\n`)
  const statements = cases.reduce((n, c) => n + c.length, 0)
  console.log(`${cases.length} scripts, ${statements} statements; definitions -> ${DEFS}; corpus -> ${FIXTURE}`)
}
