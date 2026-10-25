import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import type { FieldPacket } from 'mysql2'
import { MySQL } from '@myjs/core'
import capture from './fixtures/functions/round-parameters.json' with { type: 'json' }

interface Outcome { readonly rows: unknown; readonly fields: unknown; readonly warnings: unknown }
const reference = capture as { mysqlVersion: string; observations: number; outcomes: Outcome[]; index: number[] }
const sources = ['n/3', 'IF(1,n/3,0.000000000)', 'd', 'n', 'f']
const parameterPlaces = ['?', '?+0', '-?', 'IF(1,?,4)', 'COALESCE(?,4)', 'IFNULL(?,4)', 'IF(1,4,?)', '? IS NULL']
const literalPlaces = ['4', 'NULL', 'COALESCE(NULL,4)', 'ABS(4)', 'p', 'RAND(7)*9']
const bindings = [9, 4, -1, 13, null, 0, 30]
const values = ['0', '1', '2', '3', '7', '-1', '-2', '10001', '-10001', '9007199254740993', '-9007199254740993', null]
const decimals = ['0', '1.2345', '1.2350', '-1.2350', '2.5000', '-2.5000', '9.9995', '-9.9995', '999.9500', '99.9950', '-99.9950', null]
function sqlFor(name: string, source: string, places: string): string {
  return 'SELECT ' + source + ' AS raw,' + name + '(' + source + ',' + places + ') AS v FROM a ORDER BY id'
}
const floorSources = ['n', 'CAST(n AS UNSIGNED)', 'f', ...['14,0', '15,0', '16,0', '18,0', '19,0', '17,4', '18,4', '19,4', '21,4', '22,4', '30,4'].map((shape) => 'CAST(d AS DECIMAL(' + shape + '))')]

test('prepared rounding places retain input scale through nested parameters, rebinding and writes', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? 'reference', user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root', supportBigNumbers: true, bigNumberStrings: true }
    : { stream: db.createStream(), user: 'root', supportBigNumbers: true, bigNumberStrings: true })
  const canonical = (v: unknown): unknown => JSON.parse(JSON.stringify(v))
  let observation = 0
  const fieldsOf = (fields: readonly FieldPacket[]): unknown => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
  const check = async ([rows, fields]: readonly [unknown, readonly FieldPacket[]], label: string): Promise<void> => {
    const expected = reference.outcomes[reference.index[observation++]!]!
    assert.deepEqual(canonical(rows), expected.rows, label)
    assert.deepEqual(fieldsOf(fields), expected.fields, label)
    assert.deepEqual(canonical((await conn.query('SHOW WARNINGS'))[0]), expected.warnings, label)
  }
  const run = async (sql: string): Promise<void> => {
    for (const method of ['query', 'execute'] as const) {
      const options = { sql, rowsAsArray: true }
      await check(method === 'query' ? await conn.query(options) : await conn.execute(options), method + ': ' + sql)
      conn.unprepare(options)
    }
  }
  const statements: { sql: string; statement: Awaited<ReturnType<typeof conn.prepare>> }[] = []
  try {
    assert.equal(reference.mysqlVersion, '8.4.11')
    assert.equal(reference.observations, 3962)
    await conn.query('CREATE DATABASE round_parameters')
    await conn.query('USE round_parameters')
    await conn.query('CREATE TABLE a(id INT PRIMARY KEY,n BIGINT,d DECIMAL(24,4),f DOUBLE,p INT)')
    await conn.query('INSERT INTO a VALUES ' + values.map((n, i) => '(' + (i + 1) + ',' + (n ?? 'NULL') + ',' + (decimals[i] ?? 'NULL') + ',' + (decimals[i] ?? 'NULL') + ',' + (i === 7 ? 'NULL' : bindings[i % bindings.length] ?? 'NULL') + ')').join(','))
    for (const name of ['ROUND', 'TRUNCATE']) for (const source of sources) for (const places of parameterPlaces) {
      const sql = sqlFor(name, source, places)
      await conn.query('DO 0')
      const statement = await conn.prepare({ sql, rowsAsArray: true })
      statements.push({ sql, statement })
      const prepared = statement as unknown as { statement: { columns: FieldPacket[] } }
      await check([null, prepared.statement.columns], 'prepare: ' + sql)
    }
    for (const changed of [false, true]) {
      if (changed) await conn.query('UPDATE a SET n=n+2,d=d+0.0005,f=f+0.5 WHERE id=2')
      for (const { sql, statement } of statements) for (const value of bindings) {
        const options = { sql, rowsAsArray: true }
        await check(await conn.query(options, [value]), 'query: ' + sql + ': ' + value)
        await check(await conn.execute(options, [value]), 'execute: ' + sql + ': ' + value)
        await check(await statement.execute([value]), 'retained: ' + sql + ': ' + value)
      }
      for (const name of ['ROUND', 'TRUNCATE']) for (const source of sources) for (const places of literalPlaces) await run(sqlFor(name, source, places))
    }
    for (const name of ['FLOOR', 'CEIL', 'CEILING']) for (const source of floorSources) {
      const readers = source.startsWith('CAST(d AS DECIMAL') ? ['$', '$*3', '$+0', 'CAST($ AS DECIMAL(30,9))'] : ['$']
      for (const reader of readers) await run('SELECT ' + source + ' AS raw,' + reader.replaceAll('$', name + '(' + source + ')') + ' AS v FROM a ORDER BY id')
    }
    assert.equal(observation, reference.observations)
    assert.equal(reference.index.length, observation)
  } finally {
    for (const { statement } of statements) await statement.close()
    await conn.query('DROP DATABASE IF EXISTS round_parameters')
    await conn.end(); await db?.end()
  }
})
