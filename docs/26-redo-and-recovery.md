# 26 — The redo log, checkpoints and recovery

> Sources: `storage/innobase/include/log0constants.h` (block and header
> layout), `os0file.h` (`OS_FILE_LOG_BLOCK_SIZE = 512`),
> `mtr0types.h` (`mlog_id_t`), `buf0dblwr.h` (doublewrite).

The redo log is InnoDB's write-ahead log: it makes durability cheap by turning
random page writes into a sequential append. Our engine needs the same thing,
and — because OPFS gives weaker durability guarantees than a POSIX filesystem —
arguably needs it to be *more* defensive than InnoDB's.

## Files

Since **8.0.30** the redo log lives in `#innodb_redo/` as a set of files named
`#ib_redo<N>` (`LOG_FILE_BASE_NAME = "#ib_redo"`), replacing the old fixed pair
`ib_logfile0` / `ib_logfile1`. `LOG_FILE_MIN_SIZE = 64 KiB`. The change was
about resizing the log online; the block format below is unchanged.

## Blocks

The log is a stream of fixed **512-byte blocks** (`OS_FILE_LOG_BLOCK_SIZE`),
chosen to match a disk sector so a block write is atomic in practice.

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | 4 | `LOG_BLOCK_HDR_NO` | block number; the top bit (`LOG_BLOCK_FLUSH_BIT_MASK = 0x80000000`) marks the first block of a flush |
| 4 | 2 | `LOG_BLOCK_HDR_DATA_LEN` | bytes used in this block; the top bit (`LOG_BLOCK_ENCRYPT_BIT_MASK = 0x8000`) marks encryption |
| 6 | 2 | `LOG_BLOCK_FIRST_REC_GROUP` | offset of the first record group that *starts* in this block, or 0 |
| 8 | 4 | `LOG_BLOCK_EPOCH_NO` | epoch number |
| **12** | | `LOG_BLOCK_HDR_SIZE` | header ends |
| 12 … 507 | 496 | payload | `LOG_BLOCK_DATA_SIZE = 512 − 12 − 4` |
| 508 | 4 | `LOG_BLOCK_CHECKSUM` | `LOG_BLOCK_TRL_SIZE = 4` |

`LOG_BLOCK_FIRST_REC_GROUP` is the recovery entry point: records straddle block
boundaries, so on restart you scan for a block whose value is non-zero and start
parsing there. It is a small field that does a lot of work, and any WAL of ours
should have its equivalent.

`LOG_BLOCK_MAX_NO = 0x3FFFFFFF + 1` — block numbers wrap, which is why the epoch
number exists.

## File header

The first `LOG_FILE_HDR_SIZE = 4 × 512 = 2048` bytes of each redo file:

| Offset | Contents |
|---|---|
| 0 | `LOG_HEADER_FORMAT` (4 bytes) |
| 4 | `LOG_HEADER_LOG_UUID` |
| 8 | `LOG_HEADER_START_LSN` (8 bytes) |
| 16 | `LOG_HEADER_CREATOR` — a string, ≤ 31 bytes, e.g. `"MySQL 8.4.0"` |
| … | `LOG_HEADER_FLAGS`: `NO_LOGGING`(1), `CRASH_UNSAFE`(2), `NOT_INITIALIZED`(3), `FILE_FULL`(4) |
| 512 | `LOG_CHECKPOINT_1` — a checkpoint block |
| 1024 | `LOG_ENCRYPTION` |
| 1536 | `LOG_CHECKPOINT_2` — the second checkpoint block |

**Two checkpoint blocks, written alternately.** If a crash happens mid-write,
the other one is still intact. This is the cheapest possible way to make a
single mutable record crash-safe without a log-of-the-log, and we should use
exactly this trick for our own superblock. `LOG_CHECKPOINT_LSN = 8` is the LSN
offset within a checkpoint block.

`LOG_START_LSN = 16 × 512 = 8192` — the LSN where a fresh log begins.

## LSNs

The **Log Sequence Number** is a monotonically increasing byte offset into the
logical log stream. It appears:

- in `FIL_PAGE_LSN` (page header, offset 16) — the LSN that last modified the
  page;
- in the last 4 bytes of every page (the FIL trailer) — the low half, for torn
  detection;
- in checkpoints — everything before the checkpoint LSN is known to be on disk.

The invariant is the classic WAL rule: **a page may not be written to its home
location until the log record describing that write is durable.** Recovery then
means: read the checkpoint LSN, scan forward, and for each record, if
`record.lsn > page.FIL_PAGE_LSN`, apply it.

Because pages carry their own LSN, redo is **idempotent** — replaying the same
record twice is a no-op. That property is what makes crash recovery simple, and
it is worth designing for deliberately rather than discovering later.

## Record types (`mlog_id_t`)

`mtr0types.h`. The interesting thing is that InnoDB's redo is **physiological**:
mostly physical (page, offset, bytes) with some logical operations (page
reorganise, record insert relative to a cursor).

| Value | Type | |
|---|---|---|
| 1, 2, 4, 8 | `MLOG_1BYTE`, `MLOG_2BYTES`, `MLOG_4BYTES`, `MLOG_8BYTES` | write N bytes at an offset |
| 19 | `MLOG_PAGE_CREATE` | initialise a page |
| 20–25 | `MLOG_UNDO_*` | undo log operations |
| 26 | `MLOG_REC_MIN_MARK` | set the min-rec flag |
| 29 | `MLOG_INIT_FILE_PAGE` | zero a page |
| 30 | `MLOG_WRITE_STRING` | write arbitrary bytes |
| **31** | `MLOG_MULTI_REC_END` | **end of an atomic group** |
| 32 | `MLOG_DUMMY_RECORD` | padding |
| 33–35 | `MLOG_FILE_CREATE`, `MLOG_FILE_RENAME`, `MLOG_FILE_DELETE` | file operations |
| 37 | `MLOG_COMP_PAGE_CREATE` | create a COMPACT page |
| 59 | `MLOG_INIT_FILE_PAGE2` | |
| 62 | `MLOG_TABLE_DYNAMIC_META` | dynamic metadata (auto-inc counters) |
| 63, 64 | `MLOG_PAGE_CREATE_SDI`, `MLOG_COMP_PAGE_CREATE_SDI` | |
| 65 | `MLOG_FILE_EXTEND` | |
| 67–70 | `MLOG_REC_INSERT`, `MLOG_REC_CLUST_DELETE_MARK`, `MLOG_REC_DELETE`, `MLOG_REC_UPDATE_IN_PLACE` | record operations (8.0.30+ numbering) |
| 71–76 | `MLOG_LIST_END_COPY_CREATED`, `MLOG_PAGE_REORGANIZE`, `MLOG_ZIP_*`, `MLOG_LIST_END_DELETE`, `MLOG_LIST_START_DELETE` | |
| 128 | `MLOG_SINGLE_REC_FLAG` | OR'd into the type byte: this record is a complete group by itself |

The many `OBSOLETE_*_8027` entries in the header are the pre-8.0.30 numbering,
retained so a newer server can read an older log. Anyone parsing redo must
handle both numbering schemes, which is more evidence for the argument in
[02-strategy.md](./02-strategy.md) that whole-datadir compatibility is a moving
target.

## Mini-transactions

Every InnoDB page modification happens inside a **mini-transaction** (mtr): a
group of redo records that must be applied atomically. A group ends with
`MLOG_MULTI_REC_END`, or is a single record with `MLOG_SINGLE_REC_FLAG` set.
During recovery, an incomplete trailing group is discarded.

This two-level structure — user transactions above, mini-transactions below — is
the key idea to copy. A B+tree page split touches three pages and must be
all-or-nothing at the *physical* level, quite separately from whether the user
transaction commits.

## Checkpoints

A **fuzzy checkpoint**: rather than stopping the world, InnoDB tracks the oldest
modification LSN among dirty buffer-pool pages and writes a checkpoint recording
that everything before it is on disk. The page cleaner flushes dirty pages in
LSN order to advance it.

Recovery starts at the checkpoint LSN and replays forward.

## The doublewrite buffer

InnoDB pages are 16 KiB but disk sectors are 512 B or 4 KiB, so a page write is
not atomic — a crash can leave a **torn page** that redo cannot repair (redo
assumes a valid starting page image).

The fix: write every page **twice** — first sequentially into a doublewrite
area, then to its home location. On recovery, a page that fails its checksum is
restored from the doublewrite copy.

Since **8.0.20** the doublewrite lives in separate `.dblwr` files
(`#ib_16384_0.dblwr`) rather than inside `ibdata1`.

### Does this apply to us?

Yes, and the reasoning matters:

- **OPFS gives no atomicity guarantee for a 16 KiB write.** `write()` on a
  `FileSystemSyncAccessHandle` may partially complete if the tab is killed.
- **Node's `writeSync` is not atomic** across a 16 KiB span either.

So we need torn-page protection. Two options:

1. **Doublewrite**, as InnoDB does. Costs 2× write bandwidth for data pages.
2. **Full-page writes in the WAL** — the first time a page is modified after a
   checkpoint, log the whole page image. This is what PostgreSQL does
   (`full_page_writes`), and it costs log bandwidth instead of data bandwidth.

Option 2 is a better fit for us: our WAL is already sequential and already being
fsynced, and it avoids a second file to manage and recover. It also composes
naturally with the LSN-at-both-ends check from doc 21, which tells us *when* a
page needs restoring.

## Recovery outline

```
1. read both checkpoint blocks; take the one with the higher, valid LSN
2. scan log blocks forward from that LSN
     - verify each block's checksum
     - reassemble records across block boundaries using FIRST_REC_GROUP
     - group them into mini-transactions
     - discard an incomplete trailing group
3. for each page touched, read it (restoring from doublewrite / full-page
   image if its checksum or head/tail LSN check fails)
4. apply every record with lsn > page.FIL_PAGE_LSN
5. roll back transactions that were active and never committed
     - using the undo logs (doc 25)
6. write a new checkpoint
```

Step 5 is why undo is durable too: redo brings pages to the state at crash time,
including uncommitted changes, and undo removes them.

## What our WAL should look like

```
┌────────────────────────────────────────────────────┐
│ WAL segment file, 4 KiB blocks                     │
│                                                    │
│ block header:  8  lsn of first byte in block       │
│                4  bytes used                       │
│                2  offset of first record group     │
│                2  flags                            │
│                4  crc32c of the block              │
│ payload:    4076 bytes                             │
└────────────────────────────────────────────────────┘
```

Decisions, and why:

- **4 KiB blocks, not 512 B.** OPFS and modern SSDs both work in 4 KiB units;
  512 B blocks would mean 8× the header overhead for no atomicity benefit.
- **CRC32C per block**, using a table-driven implementation (or
  `crypto.subtle.digest` where a hardware path exists). Never trust a block
  without verifying it.
- **Two alternating superblocks**, exactly as InnoDB alternates
  `LOG_CHECKPOINT_1`/`LOG_CHECKPOINT_2`. Cheap, and it removes the
  chicken-and-egg problem of making the checkpoint itself atomic.
- **Full-page images after checkpoint**, instead of a doublewrite file.
- **Logical annotations alongside physical records**, so that a change stream
  (doc 18) is a projection of the WAL rather than a second write path. Decide
  this *now*: retrofitting logical information onto a physical log is painful.
- **`MLOG_MULTI_REC_END` equivalent.** Mini-transaction grouping is not
  optional; without it a page split can be half-applied.
