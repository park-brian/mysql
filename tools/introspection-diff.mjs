#!/usr/bin/env node
// M5.12's check: do Prisma's and Drizzle's introspection reconstruct a schema
// from this executor exactly as they do from 8.4.11?
//
// For each of the information-schema corpus's DDL scripts, the schema is made
// on 8.4.11 (`tools/mysql-local.mjs start`) and on this executor served over
// TCP, and `prisma db pull --print` and `drizzle-kit pull` are run against
// each. The two outputs are compared, text for text, the connection URL
// aside. Prisma's CLI comes from the monorepo `tools/orm-suites.mjs` builds;
// drizzle-kit 0.28.1, the release beside drizzle-orm 0.36.4, is installed
// into `.tmp/dk` on first use. Reports go into the ignored `.tmp` directory.
//
// The children are spawned, never run synchronously: the server they talk to
// answers from this process's event loop.
//
//   node tools/introspection-diff.mjs [--prisma] [--drizzle] [--cases N]
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { serve } from '@myjs/server'
import { MapAccountStore } from '@myjs/protocol'
import { arg } from './lib/cli.mjs'
import { npmCommand } from './lib/npm-command.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TMP = join(ROOT, '.tmp/introspection')
const PRISMA = join(ROOT, 'reference/orm/prisma/packages/cli/build/index.js')
const DK_DIR = join(ROOT, '.tmp/dk')
const DK = join(DK_DIR, 'node_modules/drizzle-kit/bin.cjs')
const flag = (name) => process.argv.includes(`--${name}`)
const tools = flag('prisma') || flag('drizzle') ? ['prisma', 'drizzle'].filter((t) => flag(t)) : ['prisma', 'drizzle']

const corpus = JSON.parse(readFileSync(join(ROOT, 'test/format/fixtures/information-schema.json'), 'utf8'))
const count = Number(arg('cases', String(corpus.cases.length)))
if (!Number.isSafeInteger(count) || count < 1) throw new Error('--cases must be a positive integer')
const cases = corpus.cases.slice(0, count)
mkdirSync(TMP, { recursive: true })

if (tools.includes('prisma') && !existsSync(PRISMA)) throw new Error(`no Prisma CLI at ${PRISMA}: node tools/orm-suites.mjs --ours --suite prisma builds it`)
if (tools.includes('drizzle') && !existsSync(DK)) {
  mkdirSync(DK_DIR, { recursive: true })
  execFileSync(...npmCommand('npm', ['init', '-y']), { cwd: DK_DIR, stdio: 'ignore' })
  const mysql2Version = JSON.parse(readFileSync(join(ROOT, 'node_modules/mysql2/package.json'), 'utf8')).version
  execFileSync(...npmCommand('npm', ['install', '--no-audit', '--no-fund', 'drizzle-kit@0.28.1', 'drizzle-orm@0.36.4', `mysql2@${mysql2Version}`]), { cwd: DK_DIR, stdio: 'inherit' })
}

const run = (cmd, args, env = {}) =>
  new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    let out = ''
    let err = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('error', reject)
    c.on('close', (code, signal) => resolve({ code, signal, out, err }))
  })

const pull = {
  async prisma(url) {
    const schema = join(TMP, 'schema.prisma')
    writeFileSync(schema, `datasource db {\n  provider = "mysql"\n  url = ${JSON.stringify(url)}\n}\n`)
    const r = await run(process.execPath, [PRISMA, 'db', 'pull', '--print', `--schema=${schema}`], { PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' })
    const ok = r.code === 0 && r.out.trim() !== ''
    return { ok, text: ok ? r.out.replace(/url\s*=\s*"[^"]*"/, 'url = "…"') : `ERROR ${r.signal ?? r.code} ${r.err.slice(0, 400)}` }
  },
  async drizzle(url) {
    const out = mkdtempSync(join(TMP, 'drizzle-'))
    const r = await run(process.execPath, [DK, 'pull', '--dialect=mysql', `--url=${url}`, `--out=${out}`])
    try {
      if (r.code !== 0) throw new Error('pull failed')
      return { ok: true, text: `${readFileSync(join(out, 'schema.ts'), 'utf8')}\n${readFileSync(join(out, 'relations.ts'), 'utf8')}` }
    } catch {
      return { ok: false, text: `ERROR ${r.signal ?? r.code} ${(r.out + r.err).slice(-400)}` }
    }
  },
}

const accounts = new MapAccountStore()
await accounts.add('root', '')
const db = await MySQL.open(':memory:', { accounts })
let server, theirs, ours
const tally = Object.fromEntries(tools.map((t) => [t, { same: 0, differ: [] }]))
const reference = {
  host: process.env.MYSQL_HOST ?? '127.0.0.1', port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root', password: process.env.MYSQL_PASSWORD ?? 'root',
}
function urlFor(options) {
  const url = new URL('mysql://localhost/introspected')
  url.hostname = options.host
  url.port = String(options.port)
  url.username = options.user
  url.password = options.password
  return url.href
}
try {
  server = await serve(db, { port: 0, accounts })
  theirs = await mysql.createConnection(reference)
  const local = { host: '127.0.0.1', port: server.port, user: 'root', password: '' }
  ours = await mysql.createConnection(local)
  for (const [n, kase] of cases.entries()) {
    const ddl = kase.filter((s) => !/^\s*(SELECT|SHOW)\b/i.test(s.sql) && s.ok !== false && s.error === undefined).map((s) => s.sql)
    for (const c of [theirs, ours]) {
      await c.query('DROP DATABASE IF EXISTS introspected')
      await c.query('CREATE DATABASE introspected')
      await c.query('USE introspected')
      for (const sql of ddl) await c.query(sql)
    }
    for (const t of tools) {
      const a = await pull[t](urlFor(reference))
      const b = await pull[t](urlFor(local))
      if (a.ok && b.ok && a.text === b.text) tally[t].same++
      else {
        tally[t].differ.push(n + 1)
        if (!a.ok || !b.ok) console.error(`${t}, case ${n + 1}: reference ${a.text.slice(0, 400)}; ours ${b.text.slice(0, 400)}`)
      }
    }
  }
} finally {
  try {
    await theirs?.query('DROP DATABASE IF EXISTS introspected')
  } finally {
    try { await Promise.all([theirs?.end(), ours?.end()]) }
    finally { try { await server?.close() } finally { await db.end() } }
  }
}
for (const t of tools) console.log(`${t}: ${tally[t].same} of ${cases.length} schemas identical${tally[t].differ.length > 0 ? `; differ: cases ${tally[t].differ.join(', ')}` : ''}`)
if (tools.some((t) => tally[t].differ.length > 0)) process.exitCode = 1
