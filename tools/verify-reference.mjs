#!/usr/bin/env node
// Replay committed observations against the pinned reference; never recapture fixtures.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { CONNECTION, runCase } from './capture-relational.mjs'
import { runCase as runExecutionCase } from './capture-execution.mjs'
import { CONNECTION as JSON_CONNECTION } from './capture-json.mjs'

const directory = fileURLToPath(new URL('../test/format/fixtures/', import.meta.url))
const FIXTURES = ['coercion.json', 'execution.json', 'functions.json', 'json.json', 'more-functions.json', 'relational.json', 'temporal-functions.json']
const connect = (options) => mysql.createConnection({
  ...options,
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'root',
})
let connection = await connect(CONNECTION)
const clean = (outcome) => {
  const { plan, sql, serverOnly, warnings, ...answer } = outcome
  if (answer.ordered !== true && Array.isArray(answer.rows)) answer.rows = [...answer.rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  if (answer.binary !== undefined && answer.binary !== 'same' && answer.ordered !== true && Array.isArray(answer.binary.rows)) {
    answer.binary = { ...answer.binary, rows: [...answer.binary.rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }
  }
  return answer
}
try {
  const [[{ version }]] = await connection.query('SELECT VERSION() AS version')
  assert.equal(version, '8.4.11', 'use the pinned reference version')
  for (const filename of FIXTURES) {
    const fixture = JSON.parse(readFileSync(join(directory, filename), 'utf8'))
    assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0 && typeof fixture.sqlMode === 'string', `${filename}: missing cases or SQL mode`)
    assert.ok(fixture.cases.every((group) => Array.isArray(group) && group.every((item) => typeof item.sql === 'string')), `${filename}: invalid script`)
    await connection.end()
    connection = await connect(filename === 'json.json' ? JSON_CONNECTION : CONNECTION)
    await connection.query('SET SESSION sql_mode = ?', [fixture.sqlMode])
    await connection.query('SET TIMESTAMP = ?', [fixture.timestamp ?? 0])
    let statements = 0
    let warningCounts = 0
    for (const group of fixture.cases) {
      const execution = filename === 'execution.json'
      const actual = execution ? await runExecutionCase(connection, group.map((item) => item.sql)) : await runCase(connection, group, { server: true })
      assert.equal(actual.length, group.length, `${filename}: incomplete replay`)
      for (let i = 0; i < group.length; i++) {
        if (group[i].serverOnly === true) continue
        assert.deepEqual(execution ? actual[i] : clean(actual[i]), execution ? group[i] : clean(group[i]), `${filename}: ${group[i].sql}`)
        // Coercion was captured after warning counts were moved ahead of
        // execute/EXPLAIN. Older captures retain their historical timing.
        if (filename === 'coercion.json' && group[i].warnings !== undefined) {
          assert.equal(actual[i].warnings, group[i].warnings, `${filename}: warnings for ${group[i].sql}`)
          warningCounts++
        }
        statements++
      }
    }
    assert.ok(statements > 0, `${filename}: no observations compared`)
    console.log(`${filename}: ${statements} observations reproduced${warningCounts === 0 ? '' : `, including ${warningCounts} warning counts`} (plans and legacy warning counts are checked by the executor replay separately)`)
  }
} finally { await connection.end() }
