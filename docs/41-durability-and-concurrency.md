# 41 — Durability and concurrency

The two questions an embedded database has to answer honestly: *what survives a
crash*, and *what happens when two things touch the database at once*.

## The concurrency model: one writer, many readers

**Exactly one context owns the database file. Everyone else is a client.**

```
Browser                                  Node
───────                                  ────
tab A (main thread)                      process A ── owns the datadir
  │  MessagePort, MySQL packets            │  advisory lock held
  ▼                                        │
dedicated Worker ──── Web Lock ────▶     process B ── TCP client
  owns OPFS handles     "myjs:<path>"         speaks the wire protocol
  ▲
  │  MessagePort
tab B (main thread)
```

Justifications, in order of weight:

1. **OPFS forces it.** Sync access handles are exclusive by default;
   `readwrite-unsafe` is Chrome-only and cannot be relied upon (doc 40). A
   multi-writer browser design would be unshippable on Safari and Firefox.
2. **It matches the deployment.** One application, one database. This is not
   a multi-tenant server.
3. **It removes an entire class of bugs.** No lock manager, no deadlock
   detection, no lock escalation, no two-phase locking, no priority inversion.
   Those are where database engines go wrong, and we can simply not have them.
4. **Readers still get concurrency**, because MVCC (doc 25) means a reader never
   blocks and never blocks the writer.

What we give up: parallel write throughput. For an embedded database serving one
application, that is not the bottleneck — the bottleneck is `flush()`.

### Multi-tab leadership

```js
// Every tab races for the lock; exactly one wins and becomes the owner.
navigator.locks.request(`myjs:${path}`, { mode: 'exclusive' }, async () => {
  const db = await openDatabase(path)         // acquires OPFS handles
  broadcastAvailable()                        // via BroadcastChannel
  await untilThisTabClosesOrYields()          // hold the lock
})
```

Non-leader tabs discover the leader over `BroadcastChannel`, receive a
`MessagePort`, and speak the wire protocol across it. If the leader's tab
closes, the browser releases the Web Lock automatically, another tab wins the
race, and clients reconnect. Automatic release on context death is exactly what
makes Web Locks better than a lock file here.

## Transactions

We implement `READ COMMITTED` and `REPEATABLE READ` (MySQL's default) over MVCC,
per doc 25. With a single writer:

- **Readers** take a read view at the right moment (statement or transaction
  start) and are never blocked.
- **The writer** is serialised by construction, so write-write conflicts cannot
  occur *within* a context.
- **Across contexts**, a write arrives as a wire-protocol message and is queued
  by the owner, so it is still one writer.

### Errors we still report

Even without a lock manager, applications expect certain errors and have retry
logic keyed to them:

| Error | When we raise it |
|---|---|
| `ER_LOCK_DEADLOCK` (1213, `40001`) | a transaction must be aborted and retried — e.g. an optimistic conflict detected at commit |
| `ER_LOCK_WAIT_TIMEOUT` (1205) | a write queued behind another exceeded `innodb_lock_wait_timeout` |
| `ER_DUP_ENTRY` (1062, `23000`) | unique constraint violation |

1213 in particular is load-bearing: ORMs and application retry loops already
handle it, and reporting it means their existing recovery logic works.

## Durability

### The write path

```
     BEGIN
       │
       ├── modify pages in the buffer pool (dirty)
       ├── append WAL records for each mini-transaction
       │
     COMMIT
       │
       ├── append a commit record
       ├── flush the WAL up to that record          ◄── the durability barrier
       └── acknowledge to the client
                     ⋮  (later, asynchronously)
       └── checkpoint: flush dirty pages, advance the checkpoint LSN
```

The classic WAL rule: a page may not reach its home location before the log
record describing it is durable. Commit costs one sequential append plus one
flush; the random page writes happen later, in batches.

### `innodb_flush_log_at_trx_commit`, ours

MySQL's knob, and we should offer the same three settings under the same name,
because it is the vocabulary users already have:

| Value | Behaviour | Loss window |
|---|---|---|
| `1` (default) | flush the WAL at every commit | nothing on a crash |
| `2` | write at commit, flush once per second | up to ~1 s on an OS/browser crash |
| `0` | write and flush once per second | up to ~1 s on a process crash too |

In the browser, `2` is the honest default to *recommend*, because OPFS `flush()`
is best-effort anyway (doc 40) and paying for it at every commit buys less than
it does on Node. We default to `1` and document the trade clearly rather than
quietly choosing speed.

### Making best-effort flush safe

Since we cannot rely on the platform, the format defends itself:

1. **CRC32C on every WAL block.** A block that fails verification is treated as
   the end of the log.
2. **Monotonic LSN per block.** A gap means the tail was lost; recovery stops
   there. Silent acceptance of a stale block is the failure mode this prevents.
3. **Full-page images after checkpoint** (doc 26). The first modification of a
   page after a checkpoint logs the whole page, so a torn page is always
   recoverable from the log. This replaces InnoDB's doublewrite buffer with
   something that needs no second file.
4. **Two alternating superblocks**, as InnoDB alternates `LOG_CHECKPOINT_1` and
   `LOG_CHECKPOINT_2`. The commit point of a checkpoint is never a single
   non-atomic write.
5. **Head and tail LSN on every data page** (doc 21's best idea). Cheap, and it
   detects a torn page without consulting the log at all.

The guarantee we then document, plainly: *on Node with
`flush_log_at_trx_commit = 1`, a committed transaction survives a crash. In the
browser, a committed transaction survives a tab crash; a small window of recent
commits may be lost on an OS crash or power loss. In no case can the database
become corrupt.* That last clause is the one that actually matters, and it is
the one the checksums and LSNs buy.

## The buffer pool

A page cache in front of the VFS.

- **LRU with a young/old split**, as InnoDB does: newly read pages enter the
  "old" sublist and are only promoted on a *second* access. This is what stops a
  full table scan from evicting the working set, and it is a handful of lines.
- **Dirty page tracking in LSN order**, so a checkpoint can flush oldest-first
  and advance the checkpoint LSN monotonically.
- **A configurable size**, defaulting to something modest in the browser (16 MB)
  and larger on Node (128 MB). Browsers do not report available memory, so a
  conservative default plus an explicit knob is the only honest approach.
- **`Uint8Array` views over one large `ArrayBuffer`**, so pages are contiguous
  and allocation-free after startup.

## Backpressure and long transactions

Two failure modes to design for explicitly, because both are how embedded
databases die in the field:

**A long-running read view pins undo.** As in MySQL, an open transaction
prevents purge and the history grows. Expose the history length, and enforce a
configurable maximum transaction age that aborts the offending transaction
rather than letting the store grow without bound.

**A write burst outruns the flush.** With a best-effort `flush()` and a browser
that may throttle a background tab, the dirty-page list can grow faster than it
drains. Apply backpressure at the commit path — block new commits when dirty
pages exceed a threshold — rather than accumulating unbounded memory.

## What this buys, restated

- Readers never block. Writers never block readers.
- No deadlock detection, because there are no lock cycles to detect.
- Crash recovery is one forward scan of a self-verifying log.
- The whole model can be explained in a paragraph, which means it can be
  tested — and, more importantly, that its guarantees can be stated honestly to
  someone deciding whether to trust it with their data.
