# 91 — Glossary

Terms that mean something specific in MySQL, InnoDB, or this project.

**AHI** — Adaptive Hash Index. InnoDB builds an in-memory hash index over
frequently accessed B+tree pages. Out of scope for us.

**Atomic BLOBs** — the `DYNAMIC` row format's property of storing overflowed
columns entirely off-page, with only a 20-byte reference in the row (doc 23).

**Buffer pool** — the page cache. InnoDB's is the dominant consumer of memory in
a real server; ours defaults to 16 MB in the browser (doc 41).

**Capability flags** — the `CLIENT_*` bitmask negotiated during the connection
phase. Almost every packet's layout depends on them (doc 12).

**Change buffer / insert buffer** — InnoDB's mechanism for deferring random
secondary-index writes. Deliberately not implemented (doc 21).

**Clustered index** — the B+tree keyed on the primary key whose leaves hold the
full rows. In InnoDB the table *is* its clustered index (doc 20).

**COMPACT / DYNAMIC / REDUNDANT / COMPRESSED** — the four InnoDB row formats
(doc 23).

**Covering index** — a secondary index containing every column a query needs, so
no clustered-index lookup is required.

**`DB_ROLL_PTR`** — the 7-byte hidden column pointing into the undo log
(doc 25).

**`DB_ROW_ID`** — the 6-byte hidden primary key InnoDB synthesises when a table
declares none.

**`DB_TRX_ID`** — the 6-byte hidden column naming the transaction that last
modified a row.

**Doublewrite buffer** — InnoDB's torn-page protection: every page is written
twice, once sequentially and once in place (doc 26). We use full-page WAL images
instead.

**Extent** — 64 contiguous pages (1 MiB at a 16 KiB page size), InnoDB's
allocation unit above the page (doc 21).

**FIL header / trailer** — the 38-byte header and 8-byte trailer on every InnoDB
page (doc 21).

**FSP** — File Space. `FSP_HDR` is page 0 of every tablespace.

**Gap lock** — a lock on the interval between index records, used under
`REPEATABLE READ` to prevent phantoms (doc 25).

**Heap number** — a record's position in a page's allocation heap, distinct from
its position in key order (doc 22).

**Infimum / supremum** — the two pseudo-records that bracket every INDEX page's
record chain (doc 22).

**Instant DDL** — `ADD`/`DROP COLUMN` that does not rewrite existing rows,
implemented via a version byte in the record header (doc 23).

**Isomorphic** — here: the same ESM package runs unchanged in Node, Bun, Deno
and browsers, with exactly one platform-dependent module (the VFS).

**Length-encoded integer** — the protocol's variable-width integer, 1/3/4/9
bytes (doc 11). Its `0xFB` (NULL) and `0xFE` (EOF ambiguity) cases are the two
classic parsing bugs.

**LOB** — Large OBject. The 8.0 off-page storage format
(`FIL_PAGE_TYPE_LOB_*`), which supports partial updates.

**LSN** — Log Sequence Number. A monotonically increasing byte offset into the
redo log, stamped into every page (doc 26).

**mtr / mini-transaction** — a group of redo records that must be applied
atomically, e.g. a page split (doc 26).

**MVCC** — Multi-Version Concurrency Control. Readers see a snapshot; old
versions are reconstructed from undo (doc 25).

**`NO PAD` vs `PAD SPACE`** — whether a collation ignores trailing spaces when
comparing. The `_0900_` collations are `NO PAD`; older ones are `PAD SPACE`, so
`'a' = 'a '` differs between them (doc 29).

**Next-key lock** — a record lock plus the gap before it. InnoDB's default under
`REPEATABLE READ`.

**OPFS** — Origin Private File System. The browser's real filesystem, reached
via `navigator.storage.getDirectory()` (doc 40).

**Page directory** — the sparse array of 2-byte slots at the end of an INDEX
page enabling binary search (doc 22).

**Purge** — the background removal of undo records and delete-marked rows once
no read view needs them (doc 25).

**Read view** — a transaction's snapshot: which trx ids were active at a given
moment (doc 25).

**Redo log** — InnoDB's write-ahead log (doc 26).

**Roll pointer** — see `DB_ROLL_PTR`.

**Row format** — see COMPACT / DYNAMIC / REDUNDANT / COMPRESSED.

**SDI** — Serialized Dictionary Information. A zlib-compressed JSON copy of a
table's definition stored inside its own tablespace (doc 27).

**Segment** — a logical allocation unit owning extents. Each B+tree has two: one
for leaves, one for internal pages (doc 21).

**Sequence id** — the per-packet counter in the protocol header; resets to 0 at
each new command (doc 10).

**Sort key** — a byte string derived from a value such that `memcmp` on sort
keys reproduces the collation's ordering (doc 29).

**`sql_mode`** — the session flags controlling MySQL's strictness and syntax
(`STRICT_TRANS_TABLES`, `ANSI_QUOTES`, `NO_BACKSLASH_ESCAPES`, …).

**Sync access handle** — `FileSystemSyncAccessHandle`, OPFS's synchronous I/O
interface. Available **only in dedicated Workers** (doc 40).

**Tablespace** — an InnoDB file (or set of files) containing pages. A
file-per-table tablespace is one `.ibd` (doc 21).

**Text protocol / binary protocol** — the two resultset and parameter encodings.
`COM_QUERY` uses text; prepared statements use binary (doc 15).

**Torn page** — a page half-written when a crash occurred. Detected by the
head/tail LSN mismatch or a bad checksum (docs 21, 26).

**Transportable tablespace** — the supported mechanism for moving a single table
between servers: `FLUSH TABLES ... FOR EXPORT` and
`ALTER TABLE ... IMPORT TABLESPACE`. Our file-format compatibility boundary
(docs 02, 27).

**Undo log** — the record of previous row versions, used for rollback and MVCC
(doc 25).

**VFS** — Virtual File System. The one platform-dependent module (doc 40).

**WAL** — Write-Ahead Log. The general term for what InnoDB calls the redo log.

**XDES** — Extent Descriptor. The 40-byte structure describing one extent's
state and page allocation bitmap (doc 21).
