#!/usr/bin/env node
// M5.13 — MySQL's system variables, from a real MySQL, into `@myjs/core`.
//
// A session reads `@@name` for any of some six hundred variables, and a
// script `SET`s them; until this table the executor knew two dozen, accepted
// a `SET` of any name at all, and answered 1193 for the rest. mysqltest
// stopped at 1193 in 192 files, and at SHOW VARIABLES, which reads the same
// table, in 162 more (M5.15's tally).
//
// Why a server (D-39). What a variable *is* — its scope, whether it may be
// set, its type, its range, its default — is spread across `sys_vars.cc`'s
// constructors and the classes behind them, and the server publishes the
// answer: `performance_schema.variables_info` for the range, `@@GLOBAL.x` and
// `@@SESSION.x` for scope and type, a `SET` of a variable to its own value
// for whether it may be set, and SHOW VARIABLES for how its value is shown.
// What is committed is those facts, never source text (ground rule 7).
//
// It must run against a freshly started server: a value some earlier session
// set globally is not a default. Variables whose value describes the machine
// it runs on (paths, the host, the port) are marked, and the executor gives
// its own values for them. The `SET`s change no value, each assigning a
// variable the value it already has, but they mark it as set since the
// server started, so restart it after a capture as well as before.
//
//   node tools/capture-variables.mjs [--host 127.0.0.1 --port 3306 --user root --password root]
import { writeFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { arg } from './lib/cli.mjs'

const OUT = arg('out', new URL('../packages/core/src/sql/system-variables.ts', import.meta.url).pathname)
const c = await mysql.createConnection({ host: arg('host', '127.0.0.1'), port: Number(arg('port', '3306')), user: arg('user', 'root'), password: arg('password', 'root') })

const version = (await c.query('SELECT VERSION() AS v'))[0][0].v
// A value set since the server started is not its default.
const [changed] = await c.query("SELECT VARIABLE_NAME AS n FROM performance_schema.variables_info WHERE VARIABLE_SOURCE IN ('DYNAMIC', 'PERSISTED', 'EXPLICIT') AND VARIABLE_NAME <> 'foreign_key_checks'")
if (changed.length > 0) throw new Error(`restart the server first: ${changed.map((r) => r.n).join(', ')} were set since it started`)

/** The variables whose value is the machine's, not the server's: the executor answers them itself. */
const [started] = await c.query("SELECT VARIABLE_NAME AS n FROM performance_schema.variables_info WHERE VARIABLE_SOURCE IN ('COMMAND_LINE', 'GLOBAL')")
const datadir = (await c.query('SELECT @@datadir AS d'))[0][0].d
const hostname = (await c.query('SELECT @@hostname AS h'))[0][0].h
// And the values that differ on every server or every session: the executor
// gives its own (a uuid, the build, the connection's id, its clock).
const VOLATILE = ['server_uuid', 'build_id', 'pseudo_thread_id', 'statement_id', 'timestamp']
const local = new Set([...started.map((r) => r.n), ...VOLATILE])

const [ranges] = await c.query('SELECT VARIABLE_NAME AS n, MIN_VALUE AS lo, MAX_VALUE AS hi FROM performance_schema.variables_info')
const range = new Map(ranges.map((r) => [r.n, [r.lo, r.hi]]))
const shown = new Map()
for (const scope of ['GLOBAL', 'SESSION']) {
  const [rows] = await c.query(`SHOW ${scope} VARIABLES`)
  for (const r of rows) shown.set(`${scope}:${r.Variable_name}`, r.Value)
}
const names = [...new Set([...shown.keys()].map((k) => k.slice(k.indexOf(':') + 1)))].sort()

const errno = async (sql) => {
  try {
    await c.query(sql)
    return 0
  } catch (e) {
    return e.errno
  }
}

/** `@@scope.name` read: its value, and the type the server sends it as, or undefined for the wrong scope. */
async function read(scope, name) {
  try {
    const [[row], [field]] = await c.query({ sql: `SELECT @@${scope}.${name} AS v`, rowsAsArray: true })
    return { value: row[0], type: field.columnType }
  } catch (e) {
    if (e.errno === 1238) return undefined
    throw e
  }
}

const LONGLONG = 8
const DOUBLE = 5
const NEWDECIMAL = 246
const rows = []
for (const name of names) {
  const global = await read('GLOBAL', name)
  const session = await read('SESSION', name)
  const scope = global !== undefined && session !== undefined ? 'both' : global !== undefined ? 'global' : 'session'
  const own = session ?? global
  const at = scope === 'global' ? 'GLOBAL' : 'SESSION'
  const set = await errno(`SET @@${at}.${name} = @@${at}.${name}`)
  const readOnly = set === 1238
  // 1621: a session's copy is read-only, and only SET GLOBAL assigns it (`max_allowed_packet`).
  const globalOnly = set === 1621
  // A session's DEFAULT is the global value, except for the two that are a
  // bit in the session's options, where it clears the bit (`foreign_key_checks`).
  let zeroDefault = false
  if (scope !== 'global' && !readOnly && !globalOnly && !local.has(name) && (await errno(`SET SESSION ${name} = DEFAULT`)) === 0) {
    const after = await read('SESSION', name)
    zeroDefault = String(after.value) === '0' && String((global ?? own).value) !== '0'
    await c.query(`SET SESSION ${name} = ${typeof own.value === 'string' ? mysql.escape(own.value) : own.value === null ? 'NULL' : own.value}`).catch(() => {})
  }
  // The global value where there is one: a session's carries the capturing
  // client's own settings (`mysql2`'s IGNORE_SPACE in `sql_mode`).
  const text = shown.get(`GLOBAL:${name}`) ?? shown.get(`SESSION:${name}`) ?? ''
  const kind = own.type === LONGLONG ? (/^(ON|OFF)$/.test(text) && (own.value === 1 || own.value === 0 || own.value === '1' || own.value === '0') ? 'b' : 'i') : own.type === DOUBLE || own.type === NEWDECIMAL ? 'd' : 's'
  const machine = local.has(name) || (typeof text === 'string' && (text.includes(datadir.replace(/\/$/, '')) || (hostname !== '' && text.includes(hostname))))
  const [lo, hi] = range.get(name) ?? ['0', '0']
  rows.push({ name, scope, readOnly, globalOnly, zeroDefault, kind, text: machine ? null : text, null: own.value === null, lo, hi })
}
await c.end()

if (rows.length < 550) throw new Error(`implausible: ${rows.length} variables`)

const SCOPE = { global: 'G', session: 'S', both: 'B' }
const line = (r) => {
  const flags = `${SCOPE[r.scope]}${r.readOnly ? 'r' : r.globalOnly ? 'g' : 'w'}${r.kind}${r.null ? 'n' : ''}${r.zeroDefault ? 'z' : ''}`
  const bounds = r.kind === 'i' || r.kind === 'd' ? `\t${r.lo}\t${r.hi}` : ''
  return `${r.name}\t${flags}\t${r.text === null ? '\u0000' : r.text}${bounds}`
}
const body = rows.map(line).join('\n')
const out = `// Generated by tools/capture-variables.mjs from MySQL ${version}. Do not edit.
//
// Each line is a system variable: its name; its flags (scope G global, S
// session, B both; r read-only, g settable only by SET GLOBAL, or w
// settable; type b boolean, i integer, d double, s string; n when its
// default is NULL, z when a session's DEFAULT is 0); its default as SHOW
// VARIABLES shows it, or NUL where the value is the machine's and the
// executor gives its own; and an integer's or double's least and greatest
// value. Facts asked of the server, never its source (ground rule 7).
export const SYSTEM_VARIABLES = ${JSON.stringify(body)}
`
writeFileSync(OUT, out)
console.log(`${rows.length} variables (${rows.filter((r) => r.readOnly).length} read-only, ${rows.filter((r) => r.text === null).length} the machine's) -> ${OUT}`)
