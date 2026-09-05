# 42 — The public API

Two design rules, both inherited from PGlite and from the argument in
[03-architecture.md](./03-architecture.md):

1. **`execProtocol()` is the real API.** Everything else is a convenience built
   on it.
2. **Existing MySQL drivers must work unmodified.** If `mysql2` needs a patch,
   we have failed.

## Opening a database

```js
import { MySQL } from 'myjs'

const db = await MySQL.open('opfs://myapp')      // browser, persistent
const db = await MySQL.open('./data')            // node, a directory
const db = await MySQL.open(':memory:')          // either, ephemeral

const db = await MySQL.open('./data', {
  bufferPoolSize: 128 * 1024 * 1024,
  flushLogAtTrxCommit: 1,                        // 0 | 1 | 2   (doc 41)
  sqlMode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
  characterSet: 'utf8mb4',
  collation: 'utf8mb4_0900_ai_ci',
  timeZone: 'SYSTEM',
  maxAllowedPacket: 64 * 1024 * 1024,
  readOnly: false,
})
```

The URL scheme selects the VFS: `opfs://`, `file://` or a bare path, `:memory:`.
An explicit `vfs` option accepts a custom implementation.

## Queries

Deliberately shaped like `mysql2/promise`, because that is the API the ecosystem
already knows:

```js
// text protocol
const [rows, fields] = await db.query('SELECT * FROM users WHERE id > 10')

// binary protocol / prepared statement
const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email])

// non-select
const [result] = await db.execute(
  'INSERT INTO users (name) VALUES (?)', ['alice'])
result.affectedRows   // 1
result.insertId       // 42

// streaming — never materialise a large resultset
for await (const row of db.stream('SELECT * FROM big_table')) {
  process(row)
}

// multiple statements, when enabled
const results = await db.query(
  'SELECT 1; SELECT 2;', [], { multipleStatements: true })
```

## Transactions

```js
await db.transaction(async (tx) => {
  await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
  await tx.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])
})   // commits on return, rolls back on throw

// or explicitly
const tx = await db.begin({ isolation: 'REPEATABLE READ' })
try { await tx.execute(...); await tx.commit() }
catch (e) { await tx.rollback(); throw e }
```

`db.transaction()` retries automatically on `ER_LOCK_DEADLOCK` (1213) with
backoff, up to a configurable limit — the behaviour every application ends up
writing by hand.

## The protocol boundary

```js
// raw bytes in, raw bytes out
const response = await db.execProtocol(requestPacket)   // Uint8Array

// a duplex stream of MySQL packets
const stream = db.createStream()
```

Which makes driver interop a two-liner:

```js
import mysql from 'mysql2/promise'
import { MySQL } from 'myjs'

const db = await MySQL.open('opfs://myapp')
const conn = await mysql.createConnection({ stream: db.createStream() })

const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [1])
```

`mysql2` does not know there is no socket. Neither does anything built on it:

```js
// Drizzle
import { drizzle } from 'drizzle-orm/mysql2'
const orm = drizzle(conn)

// Prisma, via whichever MySQL driver adapter it ships — the adapter takes a
// connection or pool, and ours is indistinguishable from a real one
const prisma = new PrismaClient({ adapter: mysqlAdapter(conn) })
```

This is the payoff for treating the wire protocol as the primary compatibility
contract ([02-strategy.md](./02-strategy.md)): the entire ecosystem arrives at
once, and each ORM's own test suite becomes our conformance suite.

## Serving

```js
// Node: a real TCP server. `mysql -h 127.0.0.1 -P 3306` connects.
import { serve } from 'myjs/server'
const server = await serve(db, { port: 3306, host: '127.0.0.1' })

// Browser: expose the worker-owned database to other tabs
const port = db.createPort()          // a MessagePort speaking MySQL packets
```

`serve()` defaults to `127.0.0.1` and **requires** a configured user and
password before it will bind to anything else. An embedded database that
silently listens on `0.0.0.0` would be a vulnerability, not a feature
([13-authentication.md](./13-authentication.md)).

## Workers

```js
// main thread
import { MySQLWorker } from 'myjs/worker'
const db = await MySQLWorker.open('opfs://myapp')   // spawns/joins the worker
```

`MySQLWorker` implements the same interface as `MySQL`, transparently:

- spawns a dedicated Worker (required for OPFS sync access handles, doc 40);
- elects a leader across tabs via Web Locks;
- proxies every call over a `MessagePort` as MySQL packets;
- re-elects and reconnects if the leader disappears.

In Node the same class uses `worker_threads`, which keeps a busy query off the
main event loop.

## Import and export

```js
// InnoDB tablespaces — doc 27
await db.importTablespace('users', ibdBytes, cfgBytes)
const { ibd, cfg } = await db.exportTablespace('users')

// SQL dumps
await db.importSql(dumpText)                 // mysqldump output
const sql = await db.exportSql({ schema: 'myapp' })

// the native format, for backup and for seeding
const bytes = await db.dump()                // a single portable file
const db2 = await MySQL.load(bytes)
```

`dump()`/`load()` matter more than they look: they are how a browser database is
seeded from a build artefact (PGlite's `loadDataDir` pattern), which is often the
difference between "interesting demo" and "usable in production".

## Change streams

```js
// live queries — recompute when the underlying data changes
const live = db.live('SELECT * FROM todos WHERE done = 0')
live.subscribe(rows => render(rows))

// raw change data capture, shaped like binlog row events (doc 18)
for await (const change of db.changes({ tables: ['todos'] })) {
  // { type: 'insert' | 'update' | 'delete', table, before, after, lsn }
}
```

Both are projections of the WAL, which is why doc 26 insists on recording
logical information there from the start.

## Errors

```js
try {
  await db.execute('INSERT INTO users (email) VALUES (?)', ['dup@example.com'])
} catch (err) {
  err.code      // 'ER_DUP_ENTRY'
  err.errno     // 1062
  err.sqlState  // '23000'
  err.sqlMessage// "Duplicate entry 'dup@example.com' for key 'users.email'"
}
```

Exactly `mysql2`'s error shape, so existing `catch` blocks keep working.

## Introspection

```js
await db.schemas()                    // string[]
await db.tables('myapp')              // TableInfo[]
await db.columns('myapp', 'users')    // ColumnInfo[]
await db.explain('SELECT ...')        // the plan
await db.stats()                      // buffer pool, WAL, history length, sizes
```

Plus real `INFORMATION_SCHEMA` tables, because migration tools query them
directly rather than using any library API.

## TypeScript

```ts
interface User { id: number; name: string; email: string }
const [rows] = await db.execute<User[]>(
  'SELECT * FROM users WHERE id = ?', [1])
```

Row typing is caller-supplied — the same contract `mysql2` has. Inferring types
from the SQL is a separate project and should stay one.

## API design principles

1. **Familiar beats novel.** The API mirrors `mysql2/promise`, so most users
   need to learn nothing.
2. **`execProtocol` stays public and documented.** It is the extension point,
   and hiding it would force every integration to go through us.
3. **No hidden magic in the fast path.** Auto-retry happens only inside
   `db.transaction()`, where it is explicit and documented.
4. **Async at the edges only.** Every public method is `async`, but the engine
   underneath is synchronous (doc 40).
5. **Errors match MySQL's.** Same numbers, same SQL states, same shape.
