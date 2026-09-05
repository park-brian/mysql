# 03 — Architecture

## The shape of the thing

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Consumer code                                                            │
│  ─────────────                                                            │
│   import { MySQL } from 'myjs'      │   import mysql2 from 'mysql2'        │
│   db.query(sql, params)             │   mysql2.createConnection({ stream })│
└──────────────┬────────────────────────────────────┬───────────────────────┘
               │                                    │
     ┌─────────▼──────────┐              ┌──────────▼──────────┐
     │  Convenience API   │              │  Wire endpoint      │
     │  (rows, streams,   │              │  duplex stream of   │
     │   transactions)    │              │  MySQL packets      │
     └─────────┬──────────┘              └──────────┬──────────┘
               │                                    │
               └────────────────┬───────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │  protocol/  — server side           │   docs 10–17
              │  framing · handshake · auth ·       │
              │  COM_* dispatch · resultset writers │
              └─────────────────┬──────────────────┘
                                │  Statement + params  ⇄  Resultset
              ┌─────────────────▼──────────────────┐
              │  session/  — connection state       │
              │  current db · sql_mode · charset ·  │
              │  autocommit · prepared stmt cache · │
              │  user vars · warnings · last_insert │
              └─────────────────┬──────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │  sql/  — parser → AST → plan → exec │
              │  lexer · parser · name resolution · │
              │  type inference · optimiser ·       │
              │  volcano-style operators            │
              └─────────────────┬──────────────────┘
                                │  rows, key ranges
              ┌─────────────────▼──────────────────┐
              │  types/  — the MySQL type system    │   docs 24, 29
              │  value repr · coercion · comparison │
              │  collations · key encoding          │
              └─────────────────┬──────────────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │  engine/  — storage                 │   docs 21–26
              │  B+tree · clustered & secondary     │
              │  indexes · MVCC/undo · locks ·      │
              │  redo/WAL · buffer pool · recovery  │
              └────────┬───────────────────┬────────┘
                       │                   │
        ┌──────────────▼─────┐   ┌─────────▼───────────────┐
        │  vfs/               │   │  innodb/  (interchange) │  doc 21–24
        │  opfs · node · mem  │   │  .ibd + SDI read/write  │
        └─────────────────────┘   └─────────────────────────┘
              doc 40
```

## Packages

Even as a single repository, keep these boundaries strict — each is separately
testable and several are independently useful.

| Package | Responsibility | Depends on |
|---|---|---|
| `@myjs/bytes` | Cursor/writer over `Uint8Array`; LE/BE ints, varints, length-encoded values | — |
| `@myjs/protocol` | Packet framing, all packet types, both directions; auth plugins | `bytes`, crypto shim |
| `@myjs/charsets` | Charset ids, encoders/decoders, collation key transforms | — |
| `@myjs/types` | MySQL value model, coercion rules, comparison, index key encoding | `charsets` |
| `@myjs/parser` | Lexer + parser → AST; `sql_mode`-aware | — |
| `@myjs/vfs` | The one storage interface + OPFS / Node / memory backends | — |
| `@myjs/engine` | Pages, B+tree, MVCC, WAL, recovery, catalog | `vfs`, `types` |
| `@myjs/innodb` | Real `.ibd` and SDI codec — import/export only | `bytes`, `types` |
| `@myjs/core` | Wires it together; the `MySQL` class | all of the above |
| `@myjs/server` | Node TCP server, WebSocket bridge, worker host | `core`, `protocol` |

`@myjs/innodb` deliberately does **not** sit under `@myjs/engine`. It is a codec,
not a storage backend. Someone should be able to `npm i @myjs/innodb` purely to
parse a tablespace they found on a dead server.

## Two boundaries that carry the design

### 1. `execProtocol(bytes) → bytes`

The lowest public entry point, borrowed straight from PGlite. Everything else —
`query()`, the TCP server, the worker bridge, driver interop — is a caller of
this.

```js
const response = await db.execProtocol(requestPacket)   // Uint8Array in, out
```

Consequences that make this worth insisting on:

- **Driver interop is free.** `db.createStream()` is a trivial duplex adapter
  over `execProtocol`, and `mysql2.createConnection({ stream })` then works with
  no knowledge that there is no socket.
- **Transport is decoupled.** In-process, `MessagePort`, `WebSocket`, TCP — all
  are just different pumps around the same function.
- **The protocol layer is testable in isolation** against captured packet
  traces from a real server.
- **Cross-thread and cross-tab work is uniform.** A worker that owns the
  database exposes exactly this one method.

### 2. The VFS interface

The only platform-dependent code. Deliberately tiny — see
[40-vfs.md](./40-vfs.md) for the interface and the OPFS-specific reasoning.

## Execution contexts

```
Browser                                  Node
───────                                  ────
main thread                              main thread
  │ MessagePort (MySQL packets)            │ direct call, or worker_threads
  ▼                                        ▼
dedicated Worker  ── Web Locks ──▶       process
  │  owns the DB     leader election       │  advisory lock on the datadir
  ▼                                        ▼
OPFS sync access handles                 fs (openSync/readSync/writeSync/fsyncSync)
```

The database is owned by exactly one context at a time. Everyone else is a
client speaking the wire protocol over a port. This is not a limitation we
apologise for — it is the same model as PGlite's worker package, and it is what
makes durability reasoning tractable ([41](./41-durability-and-concurrency.md)).

## Data flow for one query

```
"SELECT name FROM t WHERE id = ?"  +  [42]
  │
  ├─ protocol:  COM_STMT_EXECUTE → stmt id, param types, binary param values
  ├─ types:     binary param bytes → internal Value (INT 42)
  ├─ parser:    (cached from COM_STMT_PREPARE) AST
  ├─ planner:   index lookup on PRIMARY, key = encode_key(INT 42)
  ├─ engine:    B+tree descend → clustered leaf record
  │             ├─ MVCC: is this version visible to my read view?  (doc 25)
  │             └─ no  → follow roll_ptr into undo, rebuild older version
  ├─ types:     stored bytes → Value, honouring column charset  (doc 24)
  └─ protocol:  column definition packets, then binary resultset rows  (doc 15)
```

Every arrow in that chain has a document behind it. That is the point of the
docs tree: the architecture is mostly *format*, and format is knowable.

## Design principles

1. **Bytes in, bytes out, at every layer boundary.** Wire packets, page images,
   index keys, undo records — all `Uint8Array`. No hidden object graphs crossing
   layers, so every layer can be fuzzed and snapshot-tested.
2. **No `Buffer`, no `node:*` above the VFS.** `Uint8Array` and `DataView` only.
   This is what "isomorphic" actually costs, and it is cheap if enforced from
   the first commit.
3. **Async at the edges, sync in the core.** OPFS sync access handles and Node's
   `readSync` are both synchronous; a synchronous core is faster and far easier
   to reason about. Async appears only where the platform forces it (acquiring
   handles, first open).
4. **The type system is not an afterthought.** MySQL's observable behaviour is
   dominated by coercion and collation. `@myjs/types` and `@myjs/charsets` are
   built and tested *before* the optimiser gets interesting.
5. **Every format constant is cited.** Constants in code carry a comment naming
   the MySQL header they came from, so they can be re-verified against a newer
   tree.
