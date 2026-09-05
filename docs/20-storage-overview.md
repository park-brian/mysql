# 20 — How MySQL stores data: overview

> Sources: `storage/innobase/include/*.h` throughout. Specific headers are cited
> per fact in docs 21–27.

"The MySQL binary format" is not one thing. Before diving into pages and
records, it is worth having the map.

## The datadir

A MySQL 8.x data directory looks roughly like this:

```
data/
├── ibdata1                     system tablespace (space id 0)
├── mysql.ibd                   the data dictionary — DD tables live here
├── undo_001, undo_002          undo tablespaces
├── #innodb_redo/               redo log (8.0.30+; was ib_logfile0/1)
│   ├── #ib_redo0
│   └── #ib_redo1_tmp
├── #innodb_temp/               session temporary tablespaces
├── #ib_16384_0.dblwr           doublewrite buffer (8.0.20+; was inside ibdata1)
├── #ib_16384_1.dblwr
├── mysql/                      the mysql system schema
├── sys/                        the sys schema
├── performance_schema/
├── myapp/                      one directory per user schema
│   ├── users.ibd               one file-per-table tablespace
│   └── orders.ibd
├── binlog.000001, binlog.index
├── auto.cnf                    server UUID
└── ib_buffer_pool              buffer pool dump for warm restart
```

Everything durable that matters is InnoDB. The layout changed substantially
across versions, and the changes matter if you intend to read real files:

| Version | Change |
|---|---|
| 5.6 | file-per-table becomes the default; `.frm` files still hold table definitions |
| 5.7 | JSON type and the binary JSON format; generated columns |
| **8.0.0** | **`.frm` files removed** — the data dictionary moves into InnoDB tables in `mysql.ibd`; SDI appears in each tablespace |
| 8.0.20 | doublewrite buffer moves out of `ibdata1` into `.dblwr` files |
| 8.0.29 | instant `ADD`/`DROP COLUMN` introduces **row versions** in the record header |
| 8.0.30 | redo log moves to `#innodb_redo/` with a new file format |
| 9.0 | `VECTOR` type |

If you are writing a reader, **the version boundary you must handle is 8.0**:
before it, table definitions are in `.frm` files; after it, in SDI plus the DD
tables.

## The storage engine zoo

| Engine | Files | Status |
|---|---|---|
| **InnoDB** | `.ibd` (+ the shared spaces above) | the default since 5.5; transactional, clustered index, MVCC, crash-safe |
| MyISAM | `.MYD` data, `.MYI` index (+ `.frm` pre-8.0) | non-transactional, table locks. Still used for some system tables historically; simple format (doc 30) |
| MEMORY | none | in-memory hash/btree, lost on restart |
| CSV | `.CSV`, `.CSM` | literally a CSV file. Used for `mysql.general_log` |
| ARCHIVE | `.ARZ` | append-only, zlib compressed |
| BLACKHOLE / FEDERATED / NDB | — | out of scope |

The engine boundary is the `handler` API (`sql/handler.h`) — an abstract class
with `write_row`, `index_read`, `rnd_next`, etc. Everything above it is
engine-agnostic. This is a useful shape to borrow: our engine layer should
present a similar narrow interface so that "read from an imported `.ibd`" and
"read from the native store" are interchangeable to the executor.

## The three format layers, again

This is the distinction that keeps everything else straight:

```
┌──────────────────────────────────────────────────────────────┐
│  WIRE FORMAT           docs 10–17                             │
│  text: "2010-10-17 19:27:30"                                  │
│  binary: 07 da 07 0a 11 13 1b 1e                              │
└──────────────────────────────────────────────────────────────┘
                              ↕  Field::store / Field::val_*
┌──────────────────────────────────────────────────────────────┐
│  STORAGE VALUE FORMAT   doc 24                                │
│  DATETIME(0) → 5 bytes, BIG-endian, + 0x8000000000 offset     │
│  99 8f 2d 3b de                                               │
└──────────────────────────────────────────────────────────────┘
                              ↕  rec_convert_dtuple_to_rec
┌──────────────────────────────────────────────────────────────┐
│  RECORD FORMAT          doc 23                                │
│  [var-len array][null bitmap][5-byte header]►[col0][col1]...  │
└──────────────────────────────────────────────────────────────┘
                              ↕  page_cur_insert_rec_low
┌──────────────────────────────────────────────────────────────┐
│  PAGE FORMAT            docs 21–22                            │
│  38-byte FIL header · 56-byte page header · records ·         │
│  page directory · 8-byte FIL trailer                          │
└──────────────────────────────────────────────────────────────┘
```

Three separate encodings of the same `DATETIME`. Confusing them is the most
common mistake in third-party MySQL tooling — and the reason we keep the wire
codec and the storage codec in different modules.

Note the endianness flip: **the wire protocol is little-endian, InnoDB storage
is big-endian.** InnoDB stores values big-endian precisely so that `memcmp` on
two encoded keys gives the correct collation-free ordering — which is what makes
B+tree comparisons cheap. Signed integers additionally have their sign bit
flipped for the same reason (doc 24).

## InnoDB's shape in one paragraph

Every InnoDB table is a **B+tree keyed on its primary key**, and the leaf pages
of that tree contain the *entire row* — this is the clustered index. If no
primary key is declared, InnoDB uses the first suitable `UNIQUE NOT NULL` index,
or synthesises a hidden 6-byte `DB_ROW_ID`. Every secondary index is a separate
B+tree whose leaves store `(indexed columns, primary key)` — so a secondary
index lookup that needs other columns costs a second descent into the clustered
index. Rows carry a 6-byte `DB_TRX_ID` and a 7-byte `DB_ROLL_PTR` pointing into
the undo log, which is how MVCC reconstructs older versions. All of this is
described in docs 22–25, and **these are the semantics we replicate in our own
engine even where we do not replicate the bytes.**

Consequences a MySQL user can observe, and which we therefore must reproduce:

- The primary key is the physical order of the table.
- A wide primary key makes *every* secondary index bigger.
- `SELECT * ORDER BY pk` is free; ordering by anything else may not be.
- Secondary index lookups have a second-descent cost unless the index is
  covering.
- Inserting in non-monotonic primary key order causes page splits and
  fragmentation — the standard argument for `AUTO_INCREMENT` over random UUIDs.

## Where to go next

- [21 — file layout](./21-innodb-file-layout.md): tablespaces, pages, extents,
  segments — the space management layer.
- [22 — page formats](./22-innodb-page-formats.md): the B+tree INDEX page.
- [23 — row formats](./23-innodb-row-formats.md): the record header and the four
  row formats.
- [24 — column encodings](./24-column-encodings.md): byte-exact per-type
  storage. The densest and most immediately useful document in this tree.
