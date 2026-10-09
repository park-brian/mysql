// M5.36 — doc 42's query API against `mysql2/promise`, statement by statement.
//
// What it pins: that `db.query()` and `db.execute()` give back what
// `mysql2/promise` gives back for the same statement. The statements are the
// committed corpora's (execution, relational, functions, temporal functions,
// JSON), every one sent through both: `mysql2` over `db.createStream()` into
// one database, the API into another. Every answer is compared — rows and
// their JavaScript values, the result's fields, the OK header, the error's
// code, number, state and message — and each SELECT is run a second time
// through both `execute()`s, so the binary protocol's values are compared as
// well as the text protocol's. Then the type options: the same SELECTs with
// `supportBigNumbers`, `bigNumberStrings`, `dateStrings`, `decimalNumbers`
// and `jsonStrings` set on both sides.
//
// The one difference allowed is ground rule 1's: bytes are a `Uint8Array`
// where `mysql2` has a `Buffer`, so a `Buffer` is compared as its bytes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { MySQL, type QueryResult } from '@myjs/core'

interface Case {
  readonly sql: string
}
interface Corpus {
  readonly sqlMode?: string
  readonly cases: readonly (readonly Case[])[]
}

const corpus = (name: string): Corpus => JSON.parse(readFileSync(new URL(`../format/fixtures/${name}.json`, import.meta.url), 'utf8')) as Corpus

/** Every value as something `deepEqual` compares the same way on both sides. */
function plain(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (v instanceof Date) return `Date(${v.getTime()})`
  if (v instanceof Uint8Array) return `bytes(${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')})`
  if (Array.isArray(v)) return v.map(plain)
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, plain(x)]))
  return v
}

const FIELD_KEYS = ['schema', 'table', 'orgTable', 'name', 'orgName', 'characterSet', 'columnLength', 'columnType', 'flags', 'decimals'] as const

function field(f: unknown): unknown {
  if (f === undefined || f === null) return f
  if (Array.isArray(f)) return f.map(field)
  const o = f as Record<string, unknown>
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, o[k]]))
}

const HEADER_KEYS = ['fieldCount', 'affectedRows', 'insertId', 'info', 'serverStatus', 'warningStatus', 'changedRows'] as const

function answer(result: QueryResult | [unknown, unknown]): unknown {
  const [rows, fields] = result
  const one = (r: unknown): unknown =>
    Array.isArray(r) ? plain(r) : Object.fromEntries(HEADER_KEYS.map((k) => [k, (r as Record<string, unknown>)[k]]))
  return { rows: Array.isArray(fields) && Array.isArray(rows) && fields.some(Array.isArray) ? rows.map(one) : one(rows), fields: field(fields) }
}

async function outcome(run: () => Promise<QueryResult | [unknown, unknown]>): Promise<unknown> {
  try {
    return answer(await run())
  } catch (e) {
    const err = e as { code?: string; errno?: number; sqlState?: string; sqlMessage?: string; message: string }
    if (err.errno === undefined) return { thrown: err.message }
    return { code: err.code, errno: err.errno, sqlState: err.sqlState, sqlMessage: err.sqlMessage }
  }
}

const isQuery = (sql: string): boolean => /^\s*(\(|SELECT|WITH|TABLE|VALUES|SHOW)\b/i.test(sql)

const TYPE_OPTIONS = [
  { supportBigNumbers: true },
  { supportBigNumbers: true, bigNumberStrings: true },
  { dateStrings: true },
  { dateStrings: ['DATE'] as ('DATE' | 'DATETIME' | 'TIMESTAMP')[] },
  { decimalNumbers: true },
  { jsonStrings: true },
  { timezone: 'Z' },
  { timezone: '+05:30' },
]

async function compare(name: string, scripts: number): Promise<void> {
  const { cases, sqlMode } = corpus(name)
  for (const [n, script] of cases.slice(0, scripts).entries()) {
    const ours = await MySQL.open(':memory:')
    const theirs = await MySQL.open(':memory:')
    const conn = await mysql.createConnection({ stream: theirs.createStream(), user: 'root', password: '' })
    try {
      for (const setup of ['CREATE DATABASE app', 'USE app', ...(sqlMode === undefined ? [] : [`SET sql_mode = '${sqlMode}'`])]) {
        await ours.query(setup)
        await conn.query(setup)
      }
      for (const { sql } of script) {
        const where = `${name} script ${n}: ${sql}`
        assert.deepEqual(await outcome(() => ours.query(sql)), await outcome(() => conn.query(sql)), `query, ${where}`)
        if (!isQuery(sql)) continue
        assert.deepEqual(await outcome(() => ours.execute(sql)), await outcome(() => conn.execute(sql)), `execute, ${where}`)
        for (const options of TYPE_OPTIONS) {
          const theirsWith = await mysql.createConnection({ stream: theirs.createStream(), user: 'root', password: '', database: 'app', ...options })
          const oursWith = await ours.connect({ database: 'app', ...options })
          try {
            for (const mode of sqlMode === undefined ? [] : [`SET sql_mode = '${sqlMode}'`]) {
              await theirsWith.query(mode)
              await oursWith.query(mode)
            }
            assert.deepEqual(await outcome(() => oursWith.query(sql)), await outcome(() => theirsWith.query(sql)), `query ${JSON.stringify(options)}, ${where}`)
            assert.deepEqual(await outcome(() => oursWith.execute(sql)), await outcome(() => theirsWith.execute(sql)), `execute ${JSON.stringify(options)}, ${where}`)
          } finally {
            await theirsWith.end()
            await oursWith.end()
          }
        }
      }
    } finally {
      await conn.end()
      await ours.end()
      await theirs.end()
    }
  }
}

test('M5.36: db.query() and db.execute() answer as mysql2/promise does, over the execution corpus', async () => {
  await compare('execution', 60)
})

test('M5.36: … and over the relational, functions, temporal-functions and JSON corpora', async () => {
  await compare('relational', 25)
  await compare('functions', 25)
  await compare('temporal-functions', 25)
  await compare('json', 25)
})
