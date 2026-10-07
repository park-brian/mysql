# 30 — Other storage engines

> Sources: `storage/myisam/myisamdef.h`, `storage/csv/ha_tina.cc`,
> `storage/archive/`, `sql/handler.h`.

InnoDB is the engine we model. The others matter for one reason: **import**.
Old dumps, old datadirs, and log tables use them, and a migration path is worth
more than a feature.

## MyISAM

Pre-5.5 default. Non-transactional, table-level locking, no crash recovery — but
a genuinely simple format, which makes it a useful early import target.

Files: `<table>.MYD` (data), `<table>.MYI` (indexes), plus `<table>.frm`
(definition) before 8.0.

### `.MYD` — the data file

Three record formats:

| Format | When | Layout |
|---|---|---|
| **Fixed** | no variable-length columns, no NULLs beyond the bitmap | records at `row_number × record_length`; 1 header byte, then columns at fixed offsets |
| **Dynamic** | any `VARCHAR`/`BLOB` | linked blocks with a per-block header; records can be split across blocks and relocated |
| **Compressed** | after `myisampack` | read-only, Huffman-coded per column |

The fixed format is genuinely trivial: a deleted flag plus a null bitmap in the
first byte(s), then each column at a computed offset using the *MySQL row buffer*
encodings — little-endian integers, `VARCHAR` with a 1–2 byte length prefix,
`CHAR` space-padded. Note that these are the row-buffer encodings, **not**
InnoDB's transformed ones (doc 24): no byte reversal, no sign flip.

That difference is the useful lesson here: MySQL has two "storage" encodings,
and InnoDB's is a transformation of MyISAM's.

### `.MYI` — the index file

A B-tree with 1 KiB blocks by default. The file header (`myisamdef.h`) carries
the record count, the key definitions, and per-key root block pointers. Keys are
stored with prefix compression (each key stores how many leading bytes it shares
with the previous one), which is a technique worth remembering for our own
index pages — it typically saves 30–50% on string keys.

### Should we implement it?

**Read-only, and later.** A `.MYD` reader plus a `.frm` parser would let us
import a pre-8.0 database directly. It is a self-contained project with no
bearing on the engine's design, so it belongs behind the core work.

## CSV

`<table>.CSV` is a literal RFC-4180-ish CSV file; `<table>.CSM` is a small
metadata file (row count and a state byte).

Constraints: no indexes, no NULLs, every column must be `NOT NULL`. MySQL uses
it for `mysql.general_log` and `mysql.slow_log`, which is why it exists at all.

**Worth implementing**, and cheaply: it makes `CREATE TABLE ... ENGINE=CSV`
work as an import/export mechanism, and a CSV file in OPFS or on Node's
filesystem is a perfectly good table for bulk loading. Perhaps 200 lines.

## MEMORY (HEAP)

In-memory, no files, contents lost on restart. Supports both hash and B-tree
indexes; no `BLOB`/`TEXT`; fixed-length rows only.

**Worth implementing**, because temporary tables and some internal materialisation
naturally use it, and because `ENGINE=MEMORY` appears in real schemas.

## ARCHIVE

`<table>.ARZ`: append-only, zlib-compressed, `INSERT` and `SELECT` only, no
indexes except an optional `AUTO_INCREMENT` primary key. Rarely seen.

**Skip**, unless an import demands it.

## BLACKHOLE, FEDERATED, NDB, MERGE

Out of scope. `BLACKHOLE` (discards writes) is trivial and occasionally useful
for testing replication topologies; the rest are not relevant to an embedded
engine.

## The `handler` API

The abstraction that makes engines pluggable (`sql/handler.h`). The core
methods:

```cpp
int open(const char *name, int mode, uint test_if_locked);
int write_row(uchar *buf);
int update_row(const uchar *old_data, uchar *new_data);
int delete_row(const uchar *buf);
int index_read_map(uchar *buf, const uchar *key, key_part_map keypart_map,
                   enum ha_rkey_function find_flag);
int index_next(uchar *buf);
int rnd_init(bool scan);
int rnd_next(uchar *buf);
int rnd_pos(uchar *buf, uchar *pos);
void position(const uchar *record);
int info(uint flag);                      // statistics for the optimiser
```

Rows cross this boundary in the **MySQL row buffer format** — the fixed-layout
in-memory representation with a null bitmap, little-endian integers, and
length-prefixed `VARCHAR`s. Each engine converts to and from its own on-disk
format; `row_mysql_store_col_in_innobase_format` (doc 24) is InnoDB's half of
that conversion.

### Should we have an equivalent?

Yes — a narrow one. Ours needs to support at least four implementations:

| Implementation | Purpose |
|---|---|
| `native` | our B+tree store — the real engine |
| `memory` | temporary tables, `ENGINE=MEMORY`, small materialisations |
| `innodb-ro` | read-only access to an imported `.ibd` |
| `csv` | import/export |

A useful shape:

```js
interface StorageEngine {
  openTable(def): Table
}

interface Table {
  insert(row): void
  update(rowId, oldRow, newRow): void
  delete(rowId): void
  scan(opts): Iterator<Row>                    // full scan
  indexScan(indexName, range, opts): Iterator<Row>
  stats(): { rows, dataLength, indexLength }   // for the planner
}
```

Deliberately narrower than MySQL's `handler`, which has grown ~100 virtual
methods over twenty years of features. Keep it small enough that a new
implementation is a day's work, and the `innodb-ro` and `csv` engines stay
genuinely cheap.

## Our engines (M4.24 — D-58)

The interface as built is the shape above with what the executor turned out to
need (`@myjs/engine`'s `table.ts`):

```ts
interface StorageEngine {
  readonly name: 'native' | 'memory'
  readonly transactional: boolean     // a rollback undoes its writes
  readonly consistentReads: boolean   // a transaction reads its snapshot
  create(def, trx): TableDef          // storage made inside the DDL transaction
  open(def, hooks): Table
  drop(def, trx): void                // what can wait for purge does
  discard(def): void                  // after the DROP commits
}

interface Table {
  insert(row, trx?): RowId                          // ER_DUP_ENTRY names its index
  update(id, row, trx?): RowId | undefined          // a changed clustered key moves the row
  delete(id, trx?): boolean
  get(id, trx?, mode?): Row | undefined
  scan(range?, trx?, mode?): Iterator<[RowId, Row]>              // clustered order
  indexScan(index, range?, trx?, mode?): Iterator<[RowId, Row]>  // index order
  nextAutoIncrement(count?): bigint
  stats(): { rows, dataLength, indexLength }        // estimates, for the planner
}
```

- **Rows are field bytes in storage encoding** (D-22), and the executor converts
  values. That is the counterpart of MySQL's row buffer, with one encoding
  instead of two.
- **A `RowId` is the clustered key's bytes**, or the hidden row id's, as
  InnoDB's `position()` is.
- **Ranges are given in key values**, a prefix of the index's leading columns
  with each end inclusive or not, in index order. Each engine works out what a
  range means, so the two have to agree on it.
- **Scans must not be interleaved with writes to the same table.** An executor
  that needs both, as UPDATE does, materializes first.

**native** wraps one `ClusteredIndex` and one `SecondaryIndex` per other index.
Each row operation is one write, which is one mini-transaction, so a duplicate
in the third index leaves nothing of the row in the first two.

**memory** is not MySQL's MEMORY engine. It is an in-process engine with the
same table semantics and neither capability: a rollback does not undo it, a
view does not hide its rows, and its rows do not outlive the process. Its
definition persists in the catalog. Unlike MySQL's, it keeps BLOBs and returns
rows in key order. **It is written to be independent of native (D-58).** It
compares values, a collation's `compare` and a float's number, where native
compares encoded keys with `memcmp`. So the differential test is an instrument
for the key encoding rather than an echo of it. Ordering memory by `memcmp`
instead of the collation fails that test, and so does keying native with D-35's
old width.

**"The executor cannot tell the two apart"** is two instruments:

- **`tableConformanceCases`**, exported from `@myjs/engine/conformance` as the
  VFS suite is. It covers rows and orders, errors and the indexes they name, a
  refused row leaving nothing in any index, ranges, `DESC`, floats, CHAR
  trimming, prefixes, the hidden row id and the clustered-index rule, and
  AUTO_INCREMENT. Both engines pass it.
- **A differential property test** drives the same random inserts, updates,
  deletes and range scans into a native and a memory table. It requires the
  same result, or the same error code and message, at every step, and the same
  contents in every index after it.

Both run autocommit and single-session, the ground where the capabilities do
not show. Native's transactions are tested by name. `stats()` is an estimate
and excluded.

