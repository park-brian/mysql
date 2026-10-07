# 22 — The InnoDB INDEX page

> Sources: `storage/innobase/include/page0types.h` (all `PAGE_*` offsets),
> `page0page.h` (`PAGE_DIR`, slot sizes), `fsp0types.h` (`FSEG_HEADER_SIZE`),
> `storage/innobase/rem/rec.h` (record constants).

`FIL_PAGE_INDEX` (17855) is where every row and every index entry lives. If you
implement one InnoDB page type, implement this one.

## Layout of a 16 KiB INDEX page

```
offset
     0 ┌──────────────────────────────────────────────┐
       │ FIL header                          38 bytes │  doc 21
    38 ├──────────────────────────────────────────────┤
       │ INDEX page header                   36 bytes │
    74 ├──────────────────────────────────────────────┤
       │ FSEG header (leaf + top)      2 × 10 = 20 B  │  only on the root page
    94 ├──────────────────────────────────────────────┤  ← PAGE_DATA
       │ infimum  pseudo-record (5 hdr + 8 data)      │  ← PAGE_NEW_INFIMUM = 99
       │ supremum pseudo-record (5 hdr + 8 data)      │  ← PAGE_NEW_SUPREMUM = 112
   120 ├──────────────────────────────────────────────┤  ← PAGE_NEW_SUPREMUM_END
       │ user records, in insertion order,            │
       │ singly linked in KEY order                   │
       │                     ↓ grows down             │
       │              (free space)                    │
       │                     ↑ grows up               │
       │ page directory: 2-byte slots, descending     │
 16376 ├──────────────────────────────────────────────┤  ← PAGE_DIR
       │ FIL trailer                          8 bytes │
 16384 └──────────────────────────────────────────────┘
```

The derived constants: `PAGE_HEADER = FSEG_PAGE_DATA = FIL_PAGE_DATA = 38`, and
`PAGE_DATA = PAGE_HEADER + 36 + 2 × FSEG_HEADER_SIZE = 38 + 36 + 20 = 94`.

## The INDEX page header (36 bytes at offset 38)

`page0types.h`, offsets relative to `PAGE_HEADER`:

| Offset | Abs | Size | Field | Meaning |
|---|---|---|---|---|
| 0 | 38 | 2 | `PAGE_N_DIR_SLOTS` | number of page-directory slots |
| 2 | 40 | 2 | `PAGE_HEAP_TOP` | end of the used record heap |
| 4 | 42 | 2 | `PAGE_N_HEAP` | records in the heap, **including infimum/supremum**; the **top bit is the COMPACT flag** |
| 6 | 44 | 2 | `PAGE_FREE` | head of the free (deleted-record) list |
| 8 | 46 | 2 | `PAGE_GARBAGE` | bytes in deleted records |
| 10 | 48 | 2 | `PAGE_LAST_INSERT` | offset of the last inserted record |
| 12 | 50 | 2 | `PAGE_DIRECTION` | `LEFT`/`RIGHT`/`NO_DIRECTION` — insert-pattern hint |
| 14 | 52 | 2 | `PAGE_N_DIRECTION` | consecutive inserts in that direction |
| 16 | 54 | 2 | `PAGE_N_RECS` | number of user records |
| 18 | 56 | 8 | `PAGE_MAX_TRX_ID` | max trx id that modified this page (secondary index leaves) |
| 26 | 64 | 2 | `PAGE_LEVEL` | **0 = leaf**, increasing towards the root |
| 28 | 66 | 8 | `PAGE_INDEX_ID` | which index this page belongs to |
| 36 | 74 | 10 | `PAGE_BTR_SEG_LEAF` | FSEG header for leaf pages — **root page only** |
| 46 | 84 | 10 | `PAGE_BTR_SEG_TOP` | FSEG header for internal pages — **root page only** |

Details that matter when parsing:

- **The COMPACT flag lives in the top bit of `PAGE_N_HEAP`.** This is the *only*
  in-page indication of whether records use the old (REDUNDANT) or new
  (COMPACT/DYNAMIC) record header. `PAGE_HEADER_PRIV_END = 26` marks the end of
  the fields the page-compression code treats as private.
- `PAGE_LEVEL == 0` means leaf. Combined with `FIL_PAGE_PREV`/`NEXT`, leaves form
  a doubly-linked list, which is how range scans work.
- `PAGE_BTR_SEG_*` are only meaningful on the **root** page; on other pages
  those 20 bytes are unused, which is why `PAGE_DATA` is 94 everywhere.
- `PAGE_DIRECTION`/`PAGE_N_DIRECTION` drive the split heuristic: a page being
  filled by ascending inserts splits 100/0 rather than 50/50, which is why
  `AUTO_INCREMENT` primary keys produce dense pages and random UUIDs do not. Any
  engine that wants MySQL-like space behaviour needs this heuristic.

## Infimum and supremum

Two pseudo-records that always exist, at fixed offsets, in every INDEX page:

```
PAGE_NEW_INFIMUM      =  94 + 5  =  99      data: "infimum\0"   (8 bytes)
PAGE_NEW_SUPREMUM     =  94 + 10 + 8 = 112  data: "supremum"    (8 bytes)
PAGE_NEW_SUPREMUM_END = 120
```

(REDUNDANT pages use `PAGE_OLD_INFIMUM`/`PAGE_OLD_SUPREMUM`, computed with the
6-byte header and a 9-byte supremum.)

They are sentinels: infimum sorts before every key, supremum after every key.
The record chain always starts at infimum and ends at supremum, so insertion and
scanning need no null checks — a nice trick worth reusing. They are also lock
targets: a gap lock on "before the first record" is a lock on infimum, and
next-key locking on the last record locks supremum.

## The record chain

Records are stored **in the heap in insertion order** but linked **in key
order** by the `REC_NEXT` field of the record header. `REC_NEXT` is a *relative*
offset in COMPACT format (a signed 16-bit delta from the record origin) and an
absolute page offset in REDUNDANT format.

To scan a page in key order you follow the chain from infimum. To find free
space you look at the heap. The two orders are independent — which is why
InnoDB pages become fragmented and why `OPTIMIZE TABLE` exists.

Deleted records are marked with `REC_INFO_DELETED_FLAG` and then, once purged,
moved to the free list at `PAGE_FREE`, with `PAGE_GARBAGE` accumulating their
bytes. Space is reclaimed by reorganising the page.

## The page directory

At the end of the page (`PAGE_DIR = FIL_PAGE_DATA_END = 8` from the end), a
descending array of 2-byte slots, each pointing at a record:

```
PAGE_DIR_SLOT_SIZE       = 2
PAGE_DIR_SLOT_MIN_N_OWNED = 4
PAGE_DIR_SLOT_MAX_N_OWNED = 8
PAGE_EMPTY_DIR_START      = PAGE_DIR + 2 × PAGE_DIR_SLOT_SIZE
```

Every record is "owned" by exactly one slot — the nearest slot at or after it in
key order — and each slot owns between 4 and 8 records (infimum's slot owns only
itself). The record header's `n_owned` field records the count for the owning
record; it is 0 for records that are not slot owners.

Searching a page is therefore a **binary search over the directory** (~7 steps
for 16 KiB) followed by a **linear walk of at most 8 records**. That hybrid is
the right design: a full per-record index would cost too much space, and a pure
linked-list scan would cost too much time.

When a slot would own more than 8 records the directory is rebalanced (a slot is
added); fewer than 4, and slots are merged.

## Node pointer records (internal pages)

On a page with `PAGE_LEVEL > 0`, records have `REC_STATUS_NODE_PTR` (1) and
carry:

```
[ the index key columns ]  [ child page number: 4 bytes big-endian ]
```

`REC_NODE_PTR_SIZE = 4`. The key stored is the *smallest* key in the child
subtree. The leftmost record on the leftmost page of each level carries
`REC_INFO_MIN_REC_FLAG` (`0x10`) — it represents "minus infinity" and its key
bytes are ignored during comparison. Miss this and every descent down the left
spine of the tree goes wrong.

## Reading a page: pseudocode

```js
function parseIndexPage(page /* Uint8Array(16384) */) {
  const dv = new DataView(page.buffer, page.byteOffset)
  const type = dv.getUint16(24)                       // FIL_PAGE_TYPE, big-endian
  if (type !== 17855) throw new Error('not an INDEX page')

  const nHeapRaw = dv.getUint16(42)                   // PAGE_N_HEAP
  const compact  = (nHeapRaw & 0x8000) !== 0          // top bit = COMPACT
  const nHeap    = nHeapRaw & 0x7fff
  const level    = dv.getUint16(64)                   // PAGE_LEVEL
  const nRecs    = dv.getUint16(54)                   // PAGE_N_RECS
  const indexId  = dv.getBigUint64(66)                // PAGE_INDEX_ID
  const nSlots   = dv.getUint16(38)                   // PAGE_N_DIR_SLOTS

  // walk the key-ordered chain from infimum to supremum
  const infimum = compact ? 99 : /* PAGE_OLD_INFIMUM */ 94 + 1 + 6
  const records = []
  let off = infimum
  for (;;) {
    const next = compact
      ? (off + dv.getInt16(off - 2)) & 0xffff         // relative, wraps mod 65536
      : dv.getUint16(off - 2)                         // absolute
    if (next === (compact ? 112 : /* PAGE_OLD_SUPREMUM */ 94 + 2 + 12 + 8)) break
    records.push(next)
    off = next
  }
  return { compact, level, nRecs, nHeap, indexId, nSlots, records }
}
```

**All InnoDB header integers are big-endian**, the opposite of the wire
protocol. The relative `REC_NEXT` in COMPACT format wraps modulo 65536, so the
mask is not optional.

## What our own page format should take from this

- **The directory.** Binary search over ~2000 slots plus a short linear walk is
  an excellent space/time trade, and it degrades gracefully.
- **Infimum/supremum sentinels.** They eliminate boundary cases in insert,
  delete, split, and locking.
- **Sorted-chain-over-unsorted-heap.** Inserting does not memmove the page.

And what to change:

- **Store the directory as a dense sorted array of offsets, not an
  every-4th-to-8th-record sparse index.** At 16 KiB a page holds a few hundred
  records; a dense `Uint16Array` directory costs under 1 KiB and makes lookup a
  pure binary search with no linear tail. InnoDB's sparse design is a 1990s
  space optimisation we do not need.
- **Keep `PAGE_LEVEL`, `PAGE_INDEX_ID`, `PAGE_N_RECS`** — cheap, and they make
  a page self-describing enough to verify offline. A format you can validate
  page-by-page without the rest of the database is a format you can debug.

## Our index page (M4.2, M4.4, M4.7 — D-43, D-44)

The format `@myjs/engine` writes. The offsets are ours, so no MySQL header
is cited. Every page starts with the same **frame**:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | CRC32C over bytes `[4, size)` — everything after itself (D-44) |
| 4 | 4 | page number — a page copied to the wrong place is caught |
| 8 | 8 | LSN of the last change, as two big-endian `u32`s |
| 16 | 1 | page type: 1 superblock, 2 allocation map, 3 index, 4 overflow |
| 17 | 7 | reserved, zero |
| size − 8 | 8 | the same LSN again |

A page is **torn** if its checksum fails, or if its head LSN and tail LSN
differ. Either check alone catches most tears, and together they need nothing
from the log (M4.2). The checksum is computed once, when the buffer pool writes
the page out, not on every change. A page that was never written reads back as
zeros and fails verification, so it can never be mistaken for an empty node.

An **index page** adds a 36-byte header after the frame:

| Offset | Size | Field |
|---|---|---|
| 24 | 2 | level — 0 for a leaf |
| 26 | 2 | number of cells |
| 28 | 2 | heap top: the end of the cell heap |
| 30 | 2 | garbage: bytes of dead cells inside the heap |
| 32 | 4 | index id |
| 36 | 4 | schema version (M4.4, below) — 0 except on a clustered leaf |
| 40 | 4 | left sibling, 0 for none (page 0 is the superblock, so 0 is never a node) |
| 44 | 4 | right sibling |
| 48 | 2 | slot of the last insert, `0xFFFF` for none |
| 50 | 2 | how many inserts in a row went in the same direction |
| 52 | 1 | that direction: 0 none, 1 ascending, 2 descending (M4.10) |
| 53 | 1 | reserved |
| 54 | 6 | on a root only: the tree's fragment-page counts, leaf, internal and overflow (M4.12) |

Cells grow up from offset 60. The **slot array** grows down from the trailer:
slot *i* is a `u16` cell offset at `size − 8 − 2(i + 1)`, and the slots are kept
in key order. A cell is `varint keyLength · varint valueLength · key · value`.
On an internal page the value is the 4-byte child page number.

Three decisions, each against the text above:

- **No record chain and no infimum/supremum (D-43).** Once the directory is
  dense and sorted (D-19), a next-record chain is a second copy of the same
  order. The two sentinels exist for the chain's boundary cases and for gap
  locking, and D-08 removes locking. An insert moves at most the slot array,
  which is under 1 KiB.
- **The leftmost child has the empty key.** Every internal page's first cell
  carries the zero-length key, which `memcmp` orders before every other key.
  So every internal cell has the same `(key, child)` shape, and InnoDB's
  `REC_INFO_MIN_REC_FLAG` (M4.8's "leftmost-record flag") is a property of the
  data rather than a bit.
- **Keys are bytes and compare with `memcmp` (D-42).** The tree never sees a
  type or a collation. The index layer builds keys with `encodeKey`, and the
  tree is an ordered map from `Uint8Array` to `Uint8Array`.

A cell may be at most a third of the usable space, less its slot. A leaf then
always holds at least two cells and an internal page three children, so a
split always has somewhere to put both halves. Index key widths are static, so
the limit on a key is checked when the index is defined (`ER_TOO_LONG_KEY`). A
record that would exceed it moves its longest columns off-page (M4.5, M4.6).

### The page-level schema version (M4.4, Q-03)

D-21 rejects InnoDB's per-record version byte. Ours is per page: **every record
on a clustered leaf is encoded in the schema version its header names.** The
tree takes the current version and an `upgrade(value, fromVersion)` function
from the layer above, and stays ignorant of what a version means. Before **any
write** to a leaf whose version is older, it re-encodes every record on the leaf
through `upgrade`. That covers inserts, deletes and the merge of two leaves of
different versions. The re-encode goes through the ordinary insert path, since
an added column can make records longer and the page may have to split.

The cost is paid once per page rather than once per row, and a page stays
decodable on its own: its header says how to read it. Internal pages,
secondary indexes and overflow pages hold no records and write 0. A version
must stay in the catalog until no page uses it, which is a requirement M4.23
inherits.

### Records (M4.5)

A record is a null bitmap, then a **length** for each variable-length field
that is not null, then the field bytes in column order. Field bytes are doc
24's storage encodings, untouched (D-22). A length is one byte when it is under
128 and the field is inline. Otherwise it is two bytes: the high bit set, the
next bit marking an off-page field, and 14 bits of length. Lengths rather than
offsets, as COMPACT chose over REDUNDANT.

An off-page field (DYNAMIC's atomic BLOB, D-20) is replaced inline by an
8-byte reference, `u32` first overflow page and `u32` total length, with no
local prefix. Which fields go off-page is DYNAMIC's rule: while the record is
over its budget, the longest inline variable-length field of more than 40 bytes
moves off-page. A record that still does not fit is `ER_TOO_BIG_ROWSIZE`.

**In a leaf, a record follows a version header (M4.20).** A clustered value is
`flags`, `DB_TRX_ID` (6 bytes) and `DB_ROLL_PTR` (7), then the record: doc 25's
hidden columns, placed as a value prefix because the primary key is the tree's
key. A secondary entry's value, empty under D-42, is now `flags` and the trx id
that last changed the entry. Flag bit 0 is the delete-mark, so a delete leaves
the entry for purge. The tree never reads either header; doc 25 §Our undo is
the layer that does. `PAGE_MAX_TRX_ID` is not used: the per-entry id does its
job exactly (D-51).

### Overflow pages (M4.6)

An overflow page is the frame, a `u32` next page (0 at the end of the chain), a
`u32` byte count, and then data. A chain belongs to its tree's overflow segment
and is freed page by page when its record is deleted or replaced.
