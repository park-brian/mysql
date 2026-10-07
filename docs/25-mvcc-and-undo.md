# 25 — MVCC, undo logs and transactions

> Sources: `storage/innobase/include/trx0undo.ic`
> (`trx_undo_build_roll_ptr`/`trx_undo_decode_roll_ptr`), `trx0rec.h` (undo
> record types), `data0type.h` (system column lengths), `read0types.h` (read
> views).

InnoDB never overwrites a row in place without keeping the old version. That is
what lets readers proceed without blocking writers, and it is the mechanism
behind `REPEATABLE READ`. Reproducing this behaviour is non-negotiable for us —
it is the observable semantics of a MySQL transaction.

## The two hidden columns

Every clustered index record carries, immediately after the primary key:

| Column | Bytes | Contents |
|---|---|---|
| `DB_TRX_ID` | 6 | the transaction that last modified this row |
| `DB_ROLL_PTR` | 7 | a pointer to the undo record holding the previous version |

(`DATA_TRX_ID_LEN = 6`, `DATA_ROLL_PTR_LEN = 7` in `data0type.h`.)

Secondary index records do **not** carry them. Instead, a secondary index page
holds `PAGE_MAX_TRX_ID` (doc 22) — the highest trx id that modified any record
on the page. If that value is older than the reader's snapshot, every record on
the page is visible and the reader can use the index directly; otherwise it must
go to the clustered index to check visibility. This is a neat optimisation and
one worth copying.

## The roll pointer

7 bytes on disk, decoded as a 56-bit value (`trx0undo.ic`):

```
 bit 55      : is_insert       (1 = an insert undo log)
 bits 54..48 : undo tablespace number (7 bits)
 bits 47..16 : page number     (32 bits)
 bits 15..0  : byte offset within that page
```

```c
roll_ptr = (is_insert << 55) | (id << 48) | (page_no << 16) | offset;
```

The `is_insert` bit matters: undo records for *inserts* only need to exist until
the transaction ends (nobody can have seen the row before it existed), whereas
undo records for *updates and deletes* must survive until no active read view
could still need them. InnoDB keeps them in separate logs for exactly this
reason.

## Undo record types

`trx0rec.h`:

| Value | Constant | Meaning |
|---|---|---|
| 11 | `TRX_UNDO_INSERT_REC` | an insert; undo means "delete this row" |
| 12 | `TRX_UNDO_UPD_EXIST_REC` | an update to an existing row |
| 13 | `TRX_UNDO_UPD_DEL_REC` | an update to a delete-marked row (an insert that reused a slot) |
| 14 | `TRX_UNDO_DEL_MARK_REC` | a delete-mark |

Flags OR'd into the type byte:

| Value | Constant | Meaning |
|---|---|---|
| 16 | `TRX_UNDO_CMPL_INFO_MULT` | multiplier for "which indexes need updating" info |
| 64 | `TRX_UNDO_MODIFY_BLOB` | the update touched an off-page column |
| 128 | `TRX_UNDO_UPD_EXTERN` | an externally stored field was updated |

An undo record for an update stores only the **changed** columns' old values,
plus the primary key and the previous `DB_TRX_ID`/`DB_ROLL_PTR`. Version chains
are therefore differential, not full copies — a design decision with real
consequences: rebuilding an old version means walking and applying a chain of
diffs, so long-running transactions get progressively more expensive, which is
exactly the behaviour MySQL users observe.

## The version chain

```
clustered index record  (current)
  DB_TRX_ID  = 105
  DB_ROLL_PTR ────────────► undo record (type 12)
                              old values of changed columns
                              DB_TRX_ID  = 103
                              DB_ROLL_PTR ────────► undo record
                                                      ...
                                                      DB_ROLL_PTR = NULL
```

To read a row as of a snapshot, walk the chain until you reach a version whose
`DB_TRX_ID` is visible to your read view.

## Read views

A read view is a snapshot of which transactions were active at a moment in time
(`read0types.h`):

| Field | Meaning |
|---|---|
| `m_low_limit_id` | the next trx id to be assigned; anything ≥ this is invisible |
| `m_up_limit_id` | the smallest active trx id; anything < this is visible |
| `m_ids` | the sorted list of trx ids active when the view was created |
| `m_creator_trx_id` | our own transaction |

Visibility test for a version with `trx_id`:

```js
function isVisible(trxId, view) {
  if (trxId === view.creatorTrxId) return true    // our own changes
  if (trxId < view.upLimitId)      return true    // committed before we started
  if (trxId >= view.lowLimitId)    return false   // started after us
  return !view.activeIds.includes(trxId)          // committed iff not active then
}
```

The isolation levels fall straight out of *when* the view is created:

| Level | Read view |
|---|---|
| `READ UNCOMMITTED` | none — read the latest version, dirty reads and all |
| `READ COMMITTED` | a **new view per statement** |
| `REPEATABLE READ` | **one view for the whole transaction** (MySQL's default) |
| `SERIALIZABLE` | as `REPEATABLE READ` plus implicit `LOCK IN SHARE MODE` on reads |

The MySQL-specific quirk worth reproducing precisely: under `REPEATABLE READ`,
plain `SELECT` uses the consistent snapshot, but `SELECT ... FOR UPDATE`,
`UPDATE` and `DELETE` read the **latest committed** version ("current read"),
not the snapshot. This is why an `UPDATE` inside a `REPEATABLE READ`
transaction can see rows a plain `SELECT` in the same transaction cannot — a
behaviour that surprises people but is depended upon.

## Purge

Undo records cannot be discarded while any read view might still need them. A
background purge thread tracks the oldest active read view and removes undo
records older than it, and also physically removes delete-marked records once no
view can see them.

The observable failure mode is the "history list" growing without bound when a
long-running transaction pins an old view — the classic cause of an `ibdata1`
that never shrinks. In our engine the equivalent must be visible and bounded:
report the history length, and let an application choose to fail a long
transaction rather than grow the store.

## Locking

Beyond MVCC, InnoDB has explicit row locks, and their *granularity* is a real
part of MySQL's semantics:

| Lock | Covers |
|---|---|
| **Record lock** | an index record |
| **Gap lock** | the interval *between* index records |
| **Next-key lock** | a record plus the gap before it (record lock + gap lock) |
| **Insert intention** | a gap lock signalling intent to insert |

Under `REPEATABLE READ`, InnoDB takes **next-key locks** by default, which is
how it prevents phantom reads without `SERIALIZABLE`. Under `READ COMMITTED`,
gap locks are mostly disabled.

Table-level **intention locks** (`IS`/`IX`) sit above these so that a table lock
can be granted without scanning every row lock.

### For our single-writer engine

[41-durability-and-concurrency.md](./41-durability-and-concurrency.md) argues
for one writer and many concurrent readers. That simplifies locking enormously —
there is no lock manager, no deadlock detection, no lock waits.

But we should still:

- **Implement MVCC properly.** Readers must see a stable snapshot while the
  writer works, or `REPEATABLE READ` is a lie.
- **Report the right errors anyway.** `ER_LOCK_DEADLOCK` (1213) and
  `ER_LOCK_WAIT_TIMEOUT` (1205) are load-bearing: application retry logic keys
  off them. Even with one writer, a transaction that must be aborted (e.g. a
  write conflict detected at commit under optimistic concurrency) should report
  1213, because that is the error applications already handle.
- **Keep the door open.** If multi-writer ever becomes necessary, the version
  chain and read views are already in place; only the lock manager would be new.

## Undo storage in our engine

*The proposal, kept as written. What was built is §Our undo below; it keeps
the single-writer simplification and departs from the in-memory log, for the
reason given there.*

InnoDB stores undo in dedicated tablespaces with rollback segments and a
slot-array structure. That machinery exists to support many concurrent writers.
With a single writer we can do something considerably simpler:

- **One append-only undo log per active transaction**, held in memory and
  spilled to a page file only when it exceeds a threshold.
- **Same differential record shape** (changed columns only, plus the previous
  `trx_id`/`roll_ptr`), so version-chain walking is identical.
- **Truncate on commit** once no read view needs the records — with one writer,
  that is trivially computable from the set of open read views.

This keeps MVCC semantics identical while removing the rollback-segment
allocator, the slot arrays, and the purge coordinator entirely.

## Our undo (M4.20–M4.22 — D-50 to D-54)

The code is `packages/engine/src/{undo,trx,indexes}.ts`. The design was attacked
with concrete event sequences before any of it was written, and the rules
marked *(review)* come from that attack.

### Undo per index entry

Redo is kept per page so that the B+tree stays schema-blind (doc 26). Undo is
kept **per index entry** for the same reason. A record says "index *i*: key *k*
was inserted" or "index *i*: key *k* had value *v*", and a row change writes one
record for each index entry it touches. Rollback, crash recovery and purge
therefore need no catalog: they put a value back, or remove a key, by index id.
That is what lets M4.18 finish before M4.23 exists.

The one thing that does need the schema is which overflow chains a version
owns. The index layer works that out when it makes the change, and stores it in
the record as two lists: chains to free **on purge** (the old version's, which
the new one no longer uses) and chains to free **on rollback** (the ones the new
version introduced). An update writes every off-page field afresh, so a chain
belongs to exactly one version and only one list ever frees it. Purge removing
a delete-marked row never frees what it finds in that row *(review)*.

A record stores the **old value whole**, header included. It does not store
doc 25's "changed columns only". A value is at most one leaf cell, and its
14-byte header changes on every write, so a schema-blind diff would save little
while making every chain walk and rollback harder to reason about (D-52).

| Field | |
|---|---|
| flags | bit 0 `isInsert` (nothing older; rollback removes the entry) · bit 1 `purgeRemoves` (the new value was a delete-mark) |
| index id, key | length-encoded |
| old value | length-encoded, or `0xFB` for an insert |
| free on purge, free on rollback | each a count, then 8-byte overflow references |

There is one record type, with explicit flags *(review)*, rather than
InnoDB's five types with their behaviour inferred from the type.

### DDL records (M4.23 — D-59)

A second record type, flags `0x04`, records a tree rather than an entry: two
lists of `{index id, layout?}`, the trees to drop **on rollback** and the trees
to drop **on purge**. The layout is carried for a clustered tree, so the drop
can free the overflow chains its live values own; the store keeps no schema,
and this record is what outlives the catalog row that described the tree.

- **CREATE TABLE** leaves one record per tree, "drop on rollback", in the
  mini-transaction that makes the tree. A crash between two trees leaves
  neither, and no single mini-transaction grows with the table's width.
- **DROP TABLE** leaves one record, "drop on purge". The trees stay readable
  until every view can see the DROP.

**A tree is dropped only when no undo record still names it.** Rollback runs
newest first, so a CREATE's own rows are gone before its trees. Purge runs
oldest first, so every older change to a dropped table is purged before the
DROP's record is. No newer change can exist, because writes re-check the
catalog. So rollback and purge treat a record for a tree that is missing as
`ENGINE_CORRUPT_UNDO`, never as a call to obey. `verifyStore` holds the same
invariant, and takes a pending drop's layout from its record. The crash suite
found why that has to be the record and not the catalog: a table dropped and
created again under the same name re-inserts over the dropped row's
delete-mark, and the old definition is then only in undo.

### The values

| Where | Prefix |
|---|---|
| clustered value | `flags u8` · `DB_TRX_ID u48` · `DB_ROLL_PTR u56` · then the record |
| secondary entry | `flags u8` · trx id `u48` (and nothing after) |

Flag bit 0 is the delete-mark. The roll pointer is this document's 56-bit
layout exactly: is_insert, a 7-bit undo space that is always 0, a 32-bit page
and a 16-bit offset. All zero means "no previous version".

**Secondary entries carry their own trx id.** InnoDB keeps one per page
(`PAGE_MAX_TRX_ID`). The per-entry id costs 7 bytes per entry and makes two
checks exact and local (D-51). A reader knows whether an entry's mark is
accurate for its view. Purge knows whether a mark is still the one it is
purging.

### The log, and the transaction directory

A writing transaction's undo log is an append-only byte stream over a chain of
pages in the overflow format (`[next u32][used u32][data]`). The pages come from
the transaction directory's overflow segment. A record is a `u32` length and a
body, and it may continue onto the next page. A roll pointer addresses a
record's first byte.

The **transaction directory** is a B+tree with a reserved index id. Its root is
in the superblock. It maps a big-endian 48-bit trx id to `[state u8][first page
u32]`, where the state is ACTIVE or COMMITTED. The log's tail is not stored
there. Appending touches only the tail page, which the change's mini-transaction
already holds, and opening a log finds the tail by walking the `used` counts
*(review)*. The committed entries, in key order, **are** the history list, and
their count is the history length.

### Transactions and the writer

A transaction is read-only until its first write. That write takes **the writer
slot**, assigns a trx id, creates the log and the directory entry, and all of it
happens inside the write's mini-transaction. A second transaction's write, or
locking read, is `ENGINE_WRITER_BUSY` at once (D-53). A locking read takes the
slot for the rest of its transaction *(review)*. Each write is one
mini-transaction: undo record, index change and `ROW` record together.

- **Commit** is a mini-transaction that sets the directory entry to COMMITTED
  and logs `TRX_COMMIT`. Then `flushLogAtTrxCommit` applies, then a bounded
  purge.
- **Rollback**, whole or to a savepoint, applies records newest-first. Each
  record is one mini-transaction that also truncates the log at that record, so
  a rollback interrupted by a crash resumes where it stopped and frees nothing
  twice. The last step, which drops the entry and the log, is a mini-transaction
  of its own, and recovery accepts an ACTIVE entry with an empty log
  *(review)*.
- **Re-inserting a delete-marked key is an update**, as InnoDB's
  `TRX_UNDO_UPD_DEL_REC` is *(review)*. Its undo holds the marked value, not an
  insert. Rolling it back puts the mark back, unless the transaction that made
  the mark has already been purged. In that case nothing would ever purge the
  mark again, so the entry is removed instead. No view can see the row, because
  that purge waited for every view to see the delete.
- **Recovery** rolls back every ACTIVE entry through the same per-record path,
  then treats the committed ones as history. The next trx id is the larger of
  `META`'s and the highest directory key plus one *(review)*.

### Read views

`ReadView` and `isVisible` are this document's, verbatim. REPEATABLE READ takes
its view at its first consistent read, as MySQL does. READ COMMITTED takes a new
one at each `statement()`. A view reads its creator's id through the
transaction, so a transaction that starts writing after its view sees its own
changes. A read with no transaction is autocommit: it takes a view of its own
and closes it.

A **clustered read** walks the version chain until the trx id is visible. A
delete-marked version means the row is absent, and an `isInsert` roll pointer
means there is nothing older. A **current read** takes the writer slot and
reads the latest version. With one writer, that version is committed or the
transaction's own. That is all this document's "current read" quirk needs.

A **secondary read** tests each entry, marked or not, for the prefix. If the
view can see the entry's trx id, the entry's mark is accurate as it stands. If
not, the clustered version the view sees decides: it keeps the entry only if
that version's secondary key is this entry's key. A unique check counts live
entries only.

### Purge and the history (Q-01, Q-09)

**Undo lives in pages from its first record, and Q-01 dissolves.** The
proposal above holds undo in memory and spills it past a threshold. Crash
rollback rules that out: a page the writer dirtied can be written out ("stolen")
mid-transaction, and the undo that reverses it must then be durable. Logging
undo pages through the journal makes it durable for free. The buffer pool is
the in-memory part and eviction is the spill, so there is no threshold to
choose.

Purge takes committed transactions oldest-first while every open, unexpired
view can see them. For each record:

- if `purgeRemoves` is set, remove the entry, but only if it is still
  delete-marked **and** its trx id **equals** the purging transaction's
  *(review)* — a later transaction may have taken the row back, or marked it
  again;
- free the record's free-on-purge chains.

Then purge frees the log and drops the directory entry. Each record is one
mini-transaction that truncates as it goes, as rollback does. Purge runs
bounded (four transactions) after each commit, and fully on `store.purge()`.

**`maxHistory`** (default 10,000, counted in commits) bounds the history
(Q-09). Past it, the views that cannot see the oldest committed transactions
expire. The next read under an expired view is `ER_LOCK_DEADLOCK` 1213/40001,
which ORMs already retry. **Q-02**: one writer cannot form a lock cycle, so this
engine raises 1213 for nothing else (D-54).

`store.stats()` reports the history length, the open and expired views, and
the writer. Doc 42's `db.stats()` will read it (M5.13).
