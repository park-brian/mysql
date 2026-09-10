# myjs — an isomorphic, in-process MySQL for JavaScript

> **Status: the wire protocol works and the type system is landing; there is
> no storage engine yet.** M0, M1 and most of M2 are complete
> (57 / 143 work items). `@myjs/protocol` speaks the MySQL wire protocol well
> enough that the real `mysql` client and an unpatched `mysql2` complete full
> sessions against it; `@myjs/charsets` and `@myjs/types` carry the generated
> collation registry, generated weight tables, and every byte-exact column
> encoding in doc 24. **`utf8mb4_0900_ai_ci`, the MySQL 8.0 default, now
> orders values** — UCA 9.0.0 level 1, generated from MySQL's own tables and
> loaded on demand so its 49 KB never reaches an initial bundle. `@myjs/types`
> now carries D-15's driver mapping and MySQL's binary JSON, and every byte
> dump in docs 15, 24 and 28 is a test case that CI checks rather than a claim
> someone maintains. Queries are still answered by a stub, because the parser
> and engine are M3–M5. Start at
> **[docs/44-roadmap.md](./docs/44-roadmap.md)** for the state
> of the project, or **[docs/README.md](./docs/README.md)** for the
> specifications.

```console
$ npm run exit-criterion
  ok   mysql -h 127.0.0.1 ... -e "SELECT 1"
  ok   caching_sha2_password full path over TCP (RSA, uncached)
  ok   caching_sha2_password fast path (cached)
  ok   a wrong password is refused with 1045
  ...
M1 exit criterion: met
```

The goal: something you `npm install` and `import` that creates and serves
MySQL databases with no server process — SQLite's ergonomics, PGlite's delivery
model, MySQL's semantics.

```js
import { MySQL } from 'myjs'

const db = await MySQL.open('opfs://app-db')   // browser: OPFS
const db = await MySQL.open('./data')          // node: filesystem
const db = await MySQL.open(':memory:')        // either

const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [1])
```

*(`db.execute()` arrives with the executor in 0.3. Today `MySQL.open()`,
`execProtocol()`, `createStream()`, `createPort()` and `serve()` are real, and
the route to running SQL is a driver — which is the point.)*

…and, because the engine speaks the real MySQL wire protocol, the whole existing
driver ecosystem works against it unchanged:

```js
import mysql from 'mysql2/promise'
const conn = await mysql.createConnection({ stream: db.createStream() })
```

## Three compatibility contracts

"MySQL compatible" means nothing unless you say at which layer. We commit to
three, in priority order:

1. **Wire protocol** — every MySQL client, ORM and tool connects and works.
   Small, fully specified, and it buys the entire ecosystem. Documented in
   [docs 10–18](./docs/README.md).
2. **SQL semantics** — the dialect, the type system, and the quirks: collation
   ordering, implicit coercion, `sql_mode`, `AUTO_INCREMENT` and `TIMESTAMP`
   behaviour. Where the real engineering is.
3. **File format** — we read and write real InnoDB `.ibd` tablespaces with SDI,
   as an *interchange* format (transportable tablespaces), not as our native
   storage. [Docs 20–30](./docs/README.md) decode it byte by byte.

## Why reimplement rather than port MySQL to WASM

PGlite compiles Postgres to WebAssembly because Postgres has a single-user mode,
almost no threading, and a BSD licence. MySQL has none of those: InnoDB starts
~20 mandatory background threads, there is no single-user mode, the build pulls
in ICU/OpenSSL/protobuf/Boost, and **MySQL is GPLv2** — so a WASM artefact of it
would make every consuming application GPL. Nobody has shipped a WASM MySQL, and
that is not an accident.

The full analysis, including the conditions under which this decision should be
revisited, is in [docs/02-strategy.md](./docs/02-strategy.md).

## The documentation

Thirty-one documents, written against the MySQL source tree
(`mysql/mysql-server` trunk `e174239c`) rather than from memory or secondary
sources. Every constant cites the header it came from.

| | |
|---|---|
| **Project** | [goals](./docs/00-goals-and-scope.md) · [prior art](./docs/01-prior-art.md) · [strategy](./docs/02-strategy.md) · [architecture](./docs/03-architecture.md) |
| **Protocol** | [overview](./docs/10-protocol-overview.md) · [primitives](./docs/11-protocol-primitives.md) · [connection](./docs/12-connection-phase.md) · [auth](./docs/13-authentication.md) · [commands](./docs/14-command-phase.md) · [wire types](./docs/15-wire-types.md) · [prepared statements](./docs/16-prepared-statements.md) · [extras](./docs/17-protocol-extras.md) · [binlog](./docs/18-binlog.md) |
| **Storage** | [overview](./docs/20-storage-overview.md) · [file layout](./docs/21-innodb-file-layout.md) · [pages](./docs/22-innodb-page-formats.md) · [rows](./docs/23-innodb-row-formats.md) · [column encodings](./docs/24-column-encodings.md) · [MVCC](./docs/25-mvcc-and-undo.md) · [redo](./docs/26-redo-and-recovery.md) · [dictionary](./docs/27-data-dictionary.md) · [JSON](./docs/28-json-binary.md) · [collations](./docs/29-charsets-and-collations.md) · [other engines](./docs/30-other-engines.md) |
| **Design** | [VFS](./docs/40-vfs.md) · [durability](./docs/41-durability-and-concurrency.md) · [API](./docs/42-public-api.md) · [testing](./docs/43-testing.md) · [roadmap](./docs/44-roadmap.md) |
| **Appendix** | [references](./docs/90-references.md) · [glossary](./docs/91-glossary.md) |

If you read only one, read
[24 — column encodings](./docs/24-column-encodings.md): it is the byte-exact
answer to "how does MySQL store a value", and it is the part that is hardest to
find written down anywhere else.

## Reference trees

`reference/` is gitignored and holds shallow clones of MySQL, `mysql2`,
`mariadb-connector-nodejs`, PGlite and SQLite. Recreate it with the commands in
[docs/90-references.md](./docs/90-references.md). Nothing from those trees is
copied into this repository — MySQL is GPLv2 and this project is MIT.

## Next

[docs/44-roadmap.md](./docs/44-roadmap.md) — the living plan. It carries the
milestones and their work items, the decision log, the open questions, and the
compatibility scoreboard, and it is updated in the same commit as the work it
describes. Its status table is the fastest way to see where the project is.

The first milestone is the wire protocol: it is fully specified, it is the
smallest thing that is independently useful (a MySQL protocol server toolkit for
JavaScript does not currently exist), and it forces the right architectural
boundary to exist before anything grows around it.
