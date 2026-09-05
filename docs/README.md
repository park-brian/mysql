# MySQL-in-JS — Research & Design Notes

This directory is the engineering notebook for **an isomorphic, in-process MySQL
for JavaScript**: something you `npm install` and `import`, that creates and
serves MySQL databases with no server process — SQLite's ergonomics, PGlite's
delivery model, MySQL's semantics.

Everything here was written against primary sources: the MySQL server source
tree (`mysql/mysql-server`, trunk @ `e174239c`, `MYSQL_VERSION` 26.10 with the
8.0/8.4 formats cross-checked), the protocol documentation embedded as Doxygen
pages inside `sql/protocol_classic.cc` and `sql/auth/sql_authentication.cc`, and
the InnoDB headers under `storage/innobase/include/`. Constants quoted in these
documents are copied from those headers, not from memory or from third-party
blog posts. Where a fact is version-dependent, the version is stated.

Reference trees are cloned into `reference/` (gitignored) — see
[90-references.md](./90-references.md) for exactly what and how.

## How to read this

**If you want to know what we are building and why**, read in order:

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [Goals and scope](./00-goals-and-scope.md) | The product, the compatibility contracts, explicit non-goals |
| 01 | [Prior art](./01-prior-art.md) | SQLite, PGlite, DuckDB-WASM, libSQL, absurd-sql — what each teaches us |
| 02 | [Strategy: port vs. reimplement](./02-strategy.md) | The central decision, with the licensing and threading analysis that drives it |
| 03 | [Architecture](./03-architecture.md) | Layer diagram, package boundaries, data flow |

**If you want to know how we talk to MySQL** (clients, drivers, the wire):

| # | Document | What it covers |
|---|----------|----------------|
| 10 | [Protocol overview](./10-protocol-overview.md) | Connection lifecycle, the two phases, packet framing |
| 11 | [Protocol primitives](./11-protocol-primitives.md) | int&lt;n&gt;, length-encoded integers and strings, the exact byte grammar |
| 12 | [Connection phase](./12-connection-phase.md) | HandshakeV10, HandshakeResponse41, SSLRequest, capability negotiation |
| 13 | [Authentication](./13-authentication.md) | `mysql_native_password`, `caching_sha2_password`, fast/full paths, MFA |
| 14 | [Command phase](./14-command-phase.md) | Every `COM_*`, OK/ERR/EOF packets, text resultsets |
| 15 | [Types on the wire](./15-wire-types.md) | Column definitions, text vs. binary encodings for all 30+ types |
| 16 | [Prepared statements](./16-prepared-statements.md) | `COM_STMT_*`, parameter binding, cursors, long data |
| 17 | [Protocol extras](./17-protocol-extras.md) | Compression, TLS, `LOCAL INFILE`, session tracking, query attributes |
| 18 | [Replication and the binlog](./18-binlog.md) | Event framing, row events — the basis for CDC and sync |

**If you want to know how MySQL stores bytes** (the "binary format"):

| # | Document | What it covers |
|---|----------|----------------|
| 20 | [Storage overview](./20-storage-overview.md) | The datadir, the engine zoo, which files matter |
| 21 | [InnoDB file layout](./21-innodb-file-layout.md) | Tablespaces, pages, FIL header/trailer, FSP_HDR, XDES, INODE, segments |
| 22 | [InnoDB page formats](./22-innodb-page-formats.md) | The B+tree INDEX page: header, directory, infimum/supremum, node pointers |
| 23 | [InnoDB row formats](./23-innodb-row-formats.md) | REDUNDANT, COMPACT, DYNAMIC, COMPRESSED; record headers; instant DDL |
| 24 | [Column encodings](./24-column-encodings.md) | Byte-exact storage of every MySQL type: ints, DECIMAL, temporals, ENUM, BIT, BLOB |
| 25 | [MVCC, undo and transactions](./25-mvcc-and-undo.md) | Trx ids, roll pointers, undo logs, read views, purge |
| 26 | [Redo log and recovery](./26-redo-and-recovery.md) | Log blocks, LSNs, MLOG records, checkpoints, doublewrite |
| 27 | [The data dictionary](./27-data-dictionary.md) | MySQL 8's DD in `mysql.ibd`, SDI, the legacy `.frm` |
| 28 | [JSON binary format](./28-json-binary.md) | The on-disk/on-wire JSON encoding |
| 29 | [Character sets and collations](./29-charsets-and-collations.md) | Why this decides index order, and how to get it right |
| 30 | [Other storage engines](./30-other-engines.md) | MyISAM, CSV, MEMORY, ARCHIVE and the handler API |

**If you want to know how we will build it**:

| # | Document | What it covers |
|---|----------|----------------|
| 40 | [VFS and storage abstraction](./40-vfs.md) | OPFS sync access handles, Node `fs`, memory; the one interface they share |
| 41 | [Durability and concurrency](./41-durability-and-concurrency.md) | WAL design, fsync reality, single-writer model, multi-tab leadership |
| 42 | [Public API](./42-public-api.md) | The surface we expose, and how existing drivers plug into it |
| 43 | [Testing and compatibility](./43-testing.md) | `mysql-test` reuse, differential testing, protocol conformance, fuzzing |
| 44 | [Roadmap](./44-roadmap.md) | Milestones, in dependency order |

**Appendix**: [References](./90-references.md) · [Glossary](./91-glossary.md)

## The one-paragraph summary

MySQL's "binary format" is really three separate formats that must not be
conflated: **the wire protocol** (how clients talk to a server), **the InnoDB
page/row format** (how bytes sit in `.ibd` files), and **the value encodings**
(how a `DECIMAL(14,4)` or a `DATETIME(3)` becomes bytes — which differ between
the wire and the disk). All three are documented here. Our compatibility
strategy treats the *wire protocol* as the primary contract, because that is
what every driver, ORM and tool in the JavaScript ecosystem actually speaks;
InnoDB file compatibility is a first-class but *separable* import/export
capability. [02-strategy.md](./02-strategy.md) argues this case in full.
