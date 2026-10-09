# 42 — The public API

Two design rules, both inherited from PGlite and from the argument in
[03-architecture.md](./03-architecture.md):

1. **`execProtocol()` is the real API.** Everything else is a convenience built
   on it.
2. **Existing MySQL drivers must work unmodified.** If `mysql2` needs a patch,
   we have failed.

This document is the target surface. What 0.3 builds of it, on Node, and the
work item that builds the rest:

| API | In 0.3 | Otherwise |
|---|---|---|
| `MySQL.open(path \| ':memory:', options)`, `end()` | yes | `opfs://` is M6.1 |
| `query()`, `execute()`, `connect()`, `begin()`, `transaction()` | yes (M5.36) | |
| `execProtocol()`, `createStream()`, `createPort()`, `createConnection()` | yes (M1.24) | |
| `serve()` from `myjs/server` | yes (M1.24) | |
| real `INFORMATION_SCHEMA`, `SHOW`, `EXPLAIN` | yes (M5.13 begun) | |
| `db.stream()` | no | built after 0.3 was staged (M5.40); in 0.4 |
| `db.schemas()`, `tables()`, `columns()`, `explain()`, `stats()` | no | M5.13 |
| `MySQLWorker`, `myjs/worker` | no | M6.6 |
| `dump()`, `MySQL.load()` | no | M6.8 |
| `importTablespace()`, `exportTablespace()` | no | M7.10, M7.11 |
| `importSql()`, `exportSql()` | no | M7.12 |
| `db.live()`, `db.changes()` | no | M8.1 |

Each code block below for something 0.3 lacks says so in its first line.

## Opening a database

```js
import { MySQL } from 'myjs'

const db = await MySQL.open('./data')            // node, a directory (or file:///…)
const db = await MySQL.open(':memory:')          // either, ephemeral
const db = await MySQL.open('opfs://myapp')      // browser, persistent — not in 0.3: M6.1

const db = await MySQL.open('./data', {
  bufferPoolSize: 128 * 1024 * 1024,             // bytes; 4 MiB unless given
  flushLogAtTrxCommit: 1,                        // 0 | 1 | 2   (doc 41)
  maxAllowedPacket: 64 * 1024 * 1024,
  multipleStatements: false,                     // D-13: off unless given
  user: 'root', password: '',                    // whom query() and friends sign in as
  database: 'myapp',                             // and where they start
})
```

The URL scheme selects the VFS: `opfs://`, `file://` or a bare path, `:memory:`.
An explicit `vfs` option accepts a custom implementation, and `accounts` an
account store for the connections that sign in. A directory is locked by the
instance that opened it until `end()`.

`sqlMode`, `characterSet`, `collation`, `timeZone` and `readOnly` were drawn
here once and nothing read them; `open()` refuses each with
`ER_NOT_SUPPORTED_YET` rather than ignore it. Until they return, the session's
own `SET sql_mode = …`, `SET NAMES …` and `SET time_zone = …` do the work.

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

// streaming — never materialise a large resultset (M5.40, in 0.4)
for await (const row of db.stream('SELECT * FROM big_table')) {
  process(row)
}

// multiple statements: the database must allow them, and the connection ask
const db = await MySQL.open(':memory:', { multipleStatements: true })
const conn = await db.connect({ multipleStatements: true })
const [results] = await conn.query('SELECT 1 AS a; SELECT 2 AS b')
// [[{ a: 1 }], [{ b: 2 }]]
```

Both switches are needed, as they are against a server: the first is the
server's permission (off by default, D-13, since it turns an injection into
arbitrary statements), the second is `mysql2`'s client flag. The shared
connection behind `db.query()` never asks.

### Whose rules the values follow (M5.36)

`mysql2`'s, version 3.24.3, checked by running the same statements through
both and comparing what comes back (`test/protocol/api-query.test.ts`,
`api-params.test.ts`). An INT is a number, a DECIMAL a string, a DATETIME a
`Date` in local time, a BIGINT a number unless `supportBigNumbers` and
`bigNumberStrings` say otherwise, JSON parsed; `dateStrings`,
`decimalNumbers`, `jsonStrings`, `timezone` and `rowsAsArray` work as they do
there, per call or per `db.connect(options)`. A connection signs in with
`mysql2`'s capability flags and its utf8mb4_unicode_ci, so FOUND_ROWS and
IGNORE_SPACE are in force as they are for an application on `mysql2`.
`query()`'s values are written into the text as `mysql2`'s `format` writes
them, and `execute()` prepares once per text and sends each value as
`mysql2` sends it. Where the API departs, it is on purpose:

- bytes are a `Uint8Array`, where `mysql2` has a `Buffer` (ground rule 1);
- under NO_BACKSLASH_ESCAPES, which the server reports in every OK, a
  `query()` value's quote is doubled, not escaped with a backslash that
  escapes nothing there;
- a plain object as a `query()` value is a `TypeError`, not a guess at a SET
  clause's `name = value` list; `execute()` sends it as JSON;
- `db.query()` and `db.execute()` share one connection. `db.begin()` and
  `db.transaction()` each take a connection of their own, since a
  transaction is a session's state.

### Streaming (M5.40)

`db.stream(sql, values?)` is an async iterator of rows, shaped as `query()`
shapes them, on a connection of its own that ends with the rows.
`connection.stream()` does the same on a connection already held, a
transaction's included, and nothing else runs on that connection meanwhile.
The rows are read as the server sends them, and the server reads them as
they are taken (D-85): a reader that stops taking stops the statement, so
the memory held is a batch, whatever the result's size. Leaving the loop
early, with `break` or a throw, closes the stream's connection, which ends
the statement and rolls back its transaction, and a `FOR UPDATE`'s hold on
the writer goes with it. A statement that fails part way throws after the
rows read before the failure, as a server sends them.

What streams is the reading. A sort, a hash join's build, a temporary
table for GROUP BY or DISTINCT, and a window's partition each read their
input whole before they hand out a row, as they do on a server, and until
M5.23 they hold it in memory. `mysql2`'s own `query().stream()` streams the
same way, over `createStream()` and `serve()` alike.

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
writing by hand. The limit is `{ retries }`, 3 unless given, and the pause
doubles from 10 ms. The callback runs again from the start on a fresh
connection. `begin()`'s `commit()` and `rollback()` end the connection it
took.

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

const db = await MySQL.open('./data')
const conn = await mysql.createConnection({ stream: db.createStream() })

const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [1])
```

`mysql2` does not know there is no socket. Neither does anything built on it:

```js
// Drizzle
import { drizzle } from 'drizzle-orm/mysql2'
const orm = drizzle(conn)

// Prisma's engines dial a URL, so give them one: serve() it (below), and
// DATABASE_URL="mysql://root@127.0.0.1:3306/app" — how its suite runs (M5.22)
```

This is the payoff for treating the wire protocol as the primary compatibility
contract ([02-strategy.md](./02-strategy.md)): the entire ecosystem arrives at
once, and each ORM's own test suite becomes our conformance suite.

## Serving

```js
// Node: a real TCP server. `mysql -h 127.0.0.1 -P 3306` connects.
import { serve } from 'myjs/server'
const server = await serve(db, { port: 3306, host: '127.0.0.1' })

// a MessagePort speaking MySQL packets: in a browser, how a worker-owned
// database reaches other tabs (M6)
const port = db.createPort()
```

`serve()` defaults to `127.0.0.1` and **requires** a configured user and
password before it will bind to anything else. An embedded database that
silently listens on `0.0.0.0` would be a vulnerability, not a feature
([13-authentication.md](./13-authentication.md)).

## Workers

```js
// not in 0.3: M6.6
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
// not in 0.3: M7.10–M7.12, and dump()/load() M6.8
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
// not in 0.3: M8.1
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
// not in 0.3: M5.13
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
from the SQL is a separate project and should stay one. `T` is unconstrained,
as it is in `mysql2`: it is what the caller says the first element is, rows or
a `ResultSetHeader`, and nothing checks it (`test/unit/api-types.test.ts` holds
this example and the driver two-liner, typechecked).

`createStream()` returns a `DriverStream`: Node's `Duplex` on Node, Deno and
Bun, Web Streams in a browser bundle, chosen by the `#host` import's
conditions (D-78), so `mysql2.createConnection({ stream })` needs no cast.

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
