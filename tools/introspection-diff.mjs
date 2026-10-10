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
// into `.tmp/dk` on first use. Nothing is written into the repository.
//
// The children are spawned, never run synchronously: the server they talk to
// answers from this process's event loop.
//
//   node tools/introspection-diff.mjs [--prisma] [--drizzle] [--cases N]
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
import { serve } from '@myjs/server'
import { MapAccountStore } from '@myjs/protocol'
import { arg } from './lib/cli.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TMP = join(ROOT, '.tmp/introspection')
const PRISMA = join(ROOT, 'reference/orm/prisma/packages/cli/build/index.js')
const DK_DIR = join(ROOT, '.tmp/dk')
const DK = join(DK_DIR, 'node_modules/.bin/drizzle-kit')
const flag = (name) => process.argv.includes(`--${name}`)
const tools = flag('prisma') || flag('drizzle') ? ['prisma', 'drizzle'].filter((t) => flag(t)) : ['prisma', 'drizzle']

const corpus = JSON.parse(readFileSync(join(ROOT, 'test/format/fixtures/information-schema.json'), 'utf8'))
const cases = corpus.cases.slice(0, Number(arg('cases', String(corpus.cases.length))))
mkdirSync(TMP, { recursive: true })

if (tools.includes('prisma') && !existsSync(PRISMA)) throw new Error(`no Prisma CLI at ${PRISMA}: node tools/orm-suites.mjs --ours --suite prisma builds it`)
if (tools.includes('drizzle') && !existsSync(DK)) {
  mkdirSync(DK_DIR, { recursive: true })
  execFileSync('npm', ['init', '-y'], { cwd: DK_DIR, stdio: 'ignore' })
  execFileSync('npm', ['install', '--no-audit', '--no-fund', 'drizzle-kit@0.28.1', 'drizzle-orm@0.36.4', 'mysql2'], { cwd: DK_DIR, stdio: 'inherit' })
}

const run = (cmd, args, env = {}) =>
  new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    let out = ''
    let err = ''
    c.stdout.on('data', (d) => (out += d))
    c.stderr.on('data', (d) => (err += d))
    c.on('exit', (code) => resolve({ code, out, err }))
  })

let pulls = 0
const pull = {
  async prisma(url) {
    const schema = join(TMP, 'schema.prisma')
    execFileSync('sh', ['-c', `printf 'datasource db {\\n  provider = "mysql"\\n  url = "%s"\\n}\\n' '${url}' > '${schema}'`])
    const r = await run('node', [PRISMA, 'db', 'pull', '--print', `--schema=${schema}`], { PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' })
    return r.code === 0 ? r.out.replace(/url\s*=\s*"[^"]*"/, 'url = "…"') : `ERROR ${r.err.slice(0, 400)}`
  },
  async drizzle(url) {
    const out = join(TMP, `drizzle-${++pulls}`)
    const r = await run(DK, ['pull', '--dialect=mysql', `--url=${url}`, `--out=${out}`])
    try {
      return `${readFileSync(join(out, 'schema.ts'), 'utf8')}\n${readFileSync(join(out, 'relations.ts'), 'utf8')}`
    } catch {
      return `ERROR ${r.code} ${(r.out + r.err).slice(-400)}`
    }
  },
}

const accounts = new MapAccountStore()
await accounts.add('root', '')
const db = await MySQL.open(':memory:', { accounts })
const server = await serve(db, { port: 0, accounts })
const theirs = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root' })
const ours = await mysql.createConnection({ host: '127.0.0.1', port: server.port, user: 'root', password: '' })
const tally = Object.fromEntries(tools.map((t) => [t, { same: 0, differ: [] }]))
for (const [n, kase] of cases.entries()) {
  const ddl = kase.filter((s) => !/^\s*(SELECT|SHOW)\b/i.test(s.sql) && s.ok !== false && s.error === undefined).map((s) => s.sql)
  for (const c of [theirs, ours]) {
    await c.query('DROP DATABASE IF EXISTS introspected')
    await c.query('CREATE DATABASE introspected')
    await c.query('USE introspected')
    for (const sql of ddl) await c.query(sql).catch(() => undefined)
  }
  for (const t of tools) {
    const a = await pull[t]('mysql://root:root@127.0.0.1:3306/introspected')
    const b = await pull[t](`mysql://root@127.0.0.1:${server.port}/introspected`)
    if (a === b) tally[t].same++
    else tally[t].differ.push(n + 1)
  }
}
await theirs.query('DROP DATABASE IF EXISTS introspected')
await theirs.end()
await ours.end()
await server.close()
await db.end()
for (const t of tools) console.log(`${t}: ${tally[t].same} of ${cases.length} schemas identical${tally[t].differ.length > 0 ? `; differ: cases ${tally[t].differ.join(', ')}` : ''}`)
