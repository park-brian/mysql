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
