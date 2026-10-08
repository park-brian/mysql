// Serve the executor over TCP for an external client, logging each statement and each error.
import { MySQL, SqlExecutor } from '@myjs/core'
import { serve } from '@myjs/server'
import { MapAccountStore } from '@myjs/protocol'
import { appendFileSync } from 'node:fs'
const port = Number(process.argv[2] ?? 3399)
const log = process.argv[3]
if (log) {
  for (const m of ['query', 'prepare', 'execute']) {
    const orig = SqlExecutor.prototype[m]
    SqlExecutor.prototype[m] = async function (session, sql, ...rest) {
      try { const r = await orig.call(this, session, sql, ...rest); appendFileSync(log, `ok  ${m} ${sql.replace(/\s+/g, ' ').slice(0, 400)}\n`); return r }
      catch (e) { appendFileSync(log, `ERR ${m} ${e.errno} ${String(e.message).slice(0, 200)} :: ${sql.replace(/\s+/g, ' ').slice(0, 400)}\n`); throw e }
    }
  }
}
const accounts = new MapAccountStore()
await accounts.add('root', '')
const db = await MySQL.open(':memory:', { accounts })
const server = await serve(db, { port, accounts })
console.log('serving', server.port)
