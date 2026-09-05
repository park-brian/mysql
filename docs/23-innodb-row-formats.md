# 23 — InnoDB row formats and the record header

> Sources: `storage/innobase/rem/rec.h` (every constant and the REDUNDANT
> bit-layout diagram), `storage/innobase/rem/rem0rec.cc` (the authoritative
> variable-length decoding loop and the instant/version handling),
> `storage/innobase/include/data0type.h` (system column lengths),
> `storage/innobase/include/lob0lob.h` (external field references),
> `page0size.h` (`FIELD_REF_SIZE`).

## The four row formats

| Format | Since | Notes |
|---|---|---|
| `REDUNDANT` | the beginning | 6-byte header, per-field offset array, all fields indexed |
| `COMPACT` | 5.0 (Barracuda "Antelope") | 5-byte header, null bitmap, offsets only for variable-length fields |
| `DYNAMIC` | 5.7 default | COMPACT plus "atomic BLOBs": overflowed columns store a 20-byte pointer only |
| `COMPRESSED` | 5.5 | DYNAMIC plus zlib per-page compression; out of scope |

Which one a tablespace uses is in `FSP_SPACE_FLAGS` (doc 21):
`POST_ANTELOPE` distinguishes REDUNDANT from the rest, and `ATOMIC_BLOBS`
distinguishes COMPACT from DYNAMIC/COMPRESSED. Within a page, the top bit of
`PAGE_N_HEAP` says COMPACT-style vs REDUNDANT-style headers (doc 22).

**Implement DYNAMIC and COMPACT.** They cover every MySQL 5.7+ table.
REDUNDANT is worth a read-only implementation for old imports; COMPRESSED is
not worth it.

## Anatomy of a COMPACT/DYNAMIC record

The record's *origin* is the address of its first data byte. Everything before
it — the header and the length arrays — is stored **backwards**, growing towards
lower addresses:

```
        lower addresses                                  higher addresses
◄───────────────────────────────────────────────────────────────────────►

┌──────────────┬──────────────┬──────────┬───────────┬──────┬──────┬────┐
│ var-len array│ null bitmap  │ [version]│  5-byte   │ col0 │ col1 │... │
│  (reversed)  │  (reversed)  │  1 byte  │  header   │      │      │    │
└──────────────┴──────────────┴──────────┴───────────┴──────┴──────┴────┘
                                                     ▲
                                                  origin
```

`REC_N_NEW_EXTRA_BYTES = 5`. The optional version byte appears only for records
touched by instant DDL (below).

### The 5-byte header

Byte offsets are given as distances *back* from the origin, matching the
`REC_NEW_*` constants in `rec.h`:

```
origin-5 :  [ iiii oooo ]          i = info bits (mask 0xF0), o = n_owned (0x0F)
origin-4 :  [ hhhh hhhh ]  ┐
origin-3 :  [ hhhh hsss ]  ┘       h = heap_no (13 bits, mask 0xFFF8 >> 3)
                                   s = record status (3 bits, mask 0x07)
origin-2 :  [ nnnn nnnn ]  ┐
origin-1 :  [ nnnn nnnn ]  ┘       n = REC_NEXT, SIGNED relative offset
```

- **`REC_NEXT` is a signed 16-bit *relative* offset** from this record's origin
  in COMPACT/DYNAMIC, and an *absolute* page offset in REDUNDANT. Arithmetic
  wraps modulo 65536.
- **Record status** (`REC_STATUS_*`): `0` ordinary, `1` node pointer, `2`
  infimum, `3` supremum.
- **Info bits** (`rec.h`):

  | Bit | Constant | Meaning |
  |---|---|---|
  | `0x10` | `REC_INFO_MIN_REC_FLAG` | the leftmost record on a non-leaf level — "minus infinity" |
  | `0x20` | `REC_INFO_DELETED_FLAG` | delete-marked; still present until purge |
  | `0x40` | `REC_INFO_VERSION_FLAG` | the record carries a row version byte (8.0.29+) |
  | `0x80` | `REC_INFO_INSTANT_FLAG` | inserted/updated after an instant `ADD COLUMN` |

  Combined, the last two give `Rec_instant_state`: `REC_IS_SIMPLE` (neither),
  `REC_IS_VERSIONED` (version only), `REC_IS_INSTANT` (instant only).

### Null bitmap

`ceil(n_nullable / 8)` bytes, one bit per **nullable** column of the index, read
backwards from just before the header. Columns declared `NOT NULL` are absent
from the bitmap entirely, so the bitmap index is *not* the column index —
you must walk the index definition to map between them.

A set bit means NULL, and **no length and no data are stored** for that column.
This is the crucial consequence: NULL columns are genuinely free in COMPACT,
which is why "NULL costs a byte" advice from the REDUNDANT era is wrong.

### Variable-length array

One entry per variable-length column that is present and non-NULL, again read
backwards. The rule, transcribed from `rem0rec.cc`:

- If the column's **maximum** length is ≤ 255 bytes, the actual length is
  **always one byte**.
- Otherwise (`DATA_BIG_COL` — a long column or a BLOB):
  - length 0–127 → **one byte**;
  - length ≥ 128, or the field is stored externally → **two bytes**, where the
    first byte has `0x80` set, and `0x40` in that first byte means **stored
    externally**.

```
   1exxxxxxx xxxxxxxx
   │└─ 0x40 = external
   └── 0x80 = two-byte form
```

Getting this wrong produces plausible-looking garbage rather than an error,
which makes it the single highest-value thing to unit-test against real files.

Fixed-length columns contribute no entry. `CHAR(n)` in a multi-byte charset is
the awkward case: it is treated as variable-length in COMPACT/DYNAMIC (trailing
spaces are stripped) unless the charset is single-byte.

### Field data

Columns follow the origin in index order, using the storage encodings in
[24-column-encodings.md](./24-column-encodings.md).

For a **clustered index** leaf record, the physical column order is:

```
[ primary key columns ]  [ DB_TRX_ID (6) ]  [ DB_ROLL_PTR (7) ]  [ all other columns ]
```

`data0type.h`: `DATA_ROW_ID_LEN = 6`, `DATA_TRX_ID_LEN = 6`,
`DATA_ROLL_PTR_LEN = 7`, `DATA_N_SYS_COLS = 3`. If the table has no user primary
key, a hidden 6-byte `DB_ROW_ID` takes its place at the front.

For a **secondary index** leaf record:

```
[ indexed columns ]  [ primary key columns ]
```

— which is why the primary key's width is added to every secondary index, and
why a secondary index can answer a query without touching the clustered index
only when it is covering.

For a **node pointer** record (any level > 0):

```
[ index key columns ]  [ child page number (4 bytes, big-endian) ]
```

## REDUNDANT, for completeness

Six extra bytes, laid out (from `rec.h`'s own diagram, byte 1 nearest the
origin):

```
 byte 6    byte 5    byte 4    byte 3    byte 2    byte 1
[iiiioooo][hhhhhhhh][hhhhhfff][fffffffs][pppppppp][pppppppp]►origin
```

- `p` — next record pointer, 2 bytes, **absolute** page offset
- `s` — 1 if the field offset array uses 1 byte per entry, 0 for 2 bytes
- `f` — number of fields, 10 bits
- `h` — heap number, 13 bits
- `o` — n_owned, 4 bits
- `i` — info bits, 4 bits

Before the header sits an offset array with **one entry per field** (not just
variable-length ones). In 1-byte mode, `0x80` in an entry means SQL NULL
(`REC_1BYTE_SQL_NULL_MASK`); in 2-byte mode, `0x8000` means NULL and `0x4000`
means the tail is stored off-page (`REC_2BYTE_SQL_NULL_MASK`,
`REC_2BYTE_EXTERN_MASK`). Offset limits are `REC_1BYTE_OFFS_LIMIT = 0x7F` and
`REC_2BYTE_OFFS_LIMIT = 0x7FFF`.

REDUNDANT stores NULL columns as zero-length but still occupying an offset
entry, and it pads `CHAR(n)` to full length. It is simply less efficient.

## Off-page (external) columns

A record must fit comfortably in a page — InnoDB requires roughly two records
per page, so the practical limit is about 8000 bytes at 16 KiB. Longer values
overflow.

The 20-byte external field reference (`FIELD_REF_SIZE = 20` in `page0size.h`,
field offsets in `lob0lob.h`):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `BTR_EXTERN_SPACE_ID` |
| 4 | 4 | `BTR_EXTERN_PAGE_NO` — first page of the LOB |
| 8 | 4 | `BTR_EXTERN_OFFSET` (aliased as `BTR_EXTERN_VERSION` in the 8.0 LOB format) |
| 12 | 8 | `BTR_EXTERN_LEN` — total length; the **top byte carries flags** |

Flags in the most significant byte of `BTR_EXTERN_LEN`:
`BTR_EXTERN_OWNER_FLAG = 0x80` (this record does *not* own the LOB — set on
inherited copies) and `BTR_EXTERN_INHERITED_FLAG = 0x40` (the field was
inherited from an updated record and must not be freed on rollback).

The two formats differ in how much stays in the row:

- **COMPACT**: stores a 768-byte local prefix plus the 20-byte reference. The
  prefix wastes space but lets prefix indexes and `LIKE 'abc%'` work without
  fetching the LOB.
- **DYNAMIC** ("atomic BLOBs"): stores **only** the 20-byte reference; the entire
  value goes off-page. This is why DYNAMIC supports much larger index key
  prefixes (3072 bytes vs 767).

`BTR_EXTERN_LOCAL_STORED_MAX_SIZE` in `btr0types.h` is the COMPACT prefix
constant.

Off-page pages themselves are `FIL_PAGE_TYPE_BLOB` (the old chained format: a
4-byte "next page" pointer per page) or, since 8.0, the LOB page family
`FIL_PAGE_TYPE_LOB_FIRST` / `LOB_INDEX` / `LOB_DATA`, which forms an indexed
structure supporting partial updates — the mechanism behind `JSON_SET` on a
large document not rewriting the whole value.

## Instant DDL and row versions

`ALTER TABLE ... ADD COLUMN, ALGORITHM=INSTANT` (8.0.12) and instant
`DROP COLUMN` (8.0.29) do not rewrite existing rows. The record format therefore
has to describe rows with *different column sets in the same page*.

Two mechanisms, and a reader must handle both:

1. **Old implementation (8.0.12–8.0.28)**: `REC_INFO_INSTANT_FLAG` (`0x80`) is
   set, and a 1- or 2-byte *field count* precedes the null bitmap
   (`REC_N_FIELDS_TWO_BYTES_FLAG = 0x80`,
   `REC_N_FIELDS_ONE_BYTE_MAX = 0x7F`). Fields beyond that count take their
   values from the column's stored default.
2. **New implementation (8.0.29+)**: `REC_INFO_VERSION_FLAG` (`0x40`) is set,
   and a **1-byte row version** precedes the null bitmap. The version selects
   which historical column set the record was written against; the data
   dictionary holds a per-version column mapping.

Parsing order backwards from the origin is therefore:

```
header (5) → [version byte | n_fields (1–2)] → null bitmap → var-len array
```

and — critically — **the number of nullable columns depends on the version**
(`index->get_nullable_in_version(row_version)` in `rec.h`), so the null bitmap's
*size* is not fixed for the index. You cannot decode a record without knowing its
version and the dictionary's per-version metadata.

This is a good illustration of the argument in [02-strategy.md](./02-strategy.md):
the record format is not self-describing, and its meaning is version-dependent.

## Decoding a COMPACT/DYNAMIC record

```js
// index: { fields: [{ name, fixedLen, nullable, maxLen, isBig }], nNullable }
function parseRecord(page, origin, index) {
  const info   = page[origin - 5]
  const infoBits = info & 0xf0
  const nOwned   = info & 0x0f
  const hs     = (page[origin - 4] << 8) | page[origin - 3]
  const heapNo = hs >>> 3
  const status = hs & 0x07
  const next   = origin + (((page[origin - 2] << 8 | page[origin - 1]) << 16) >> 16)

  let p = origin - 5
  let version = null
  if (infoBits & 0x40) version = page[--p]        // REC_INFO_VERSION_FLAG
  else if (infoBits & 0x80) p -= readInstantFieldCountWidth(page, p)

  const nNullable = version === null ? index.nNullable
                                     : index.nullableInVersion(version)
  const nullBytes = (nNullable + 7) >> 3
  const nullsEnd  = p                              // bitmap grows downwards
  p -= nullBytes
  let lens = p                                     // var-len array grows downwards

  const fields = []
  let dataOff = origin, nullBit = 0
  for (const f of index.fieldsForVersion(version)) {
    if (f.nullable) {
      const byte = page[nullsEnd - 1 - (nullBit >> 3)]
      const isNull = (byte >> (nullBit & 7)) & 1
      nullBit++
      if (isNull) { fields.push(null); continue }
    }
    let len, external = false
    if (f.fixedLen) {
      len = f.fixedLen
    } else {
      len = page[--lens]
      if (f.isBig && (len & 0x80)) {
        external = (len & 0x40) !== 0
        len = ((len & 0x3f) << 8) | page[--lens]
      }
    }
    fields.push({ off: dataOff, len, external })
    dataOff += len
  }
  return { infoBits, nOwned, heapNo, status, next, version, fields }
}
```

Two subtleties this makes concrete: the null bitmap is indexed by *nullable
column ordinal*, not column ordinal; and the variable-length array is consumed
in forward column order while walking *backwards* through memory.

## What we take from this

- **The null bitmap plus a variable-length array is the right design.** It is
  compact, it costs nothing for NOT NULL columns, and it is cheap to skip
  fields. We use the same shape.
- **Store lengths, not offsets.** InnoDB's REDUNDANT format stored offsets and
  paid for it in every record; COMPACT's switch to lengths is strictly better.
- **Do not build instant DDL into the record format.** InnoDB's version byte
  makes every record's layout dependent on external dictionary state, which
  makes the format non-self-describing and the parser stateful. We can get the
  same user-visible behaviour by keeping a per-table schema-version table and
  storing a schema version in the *page* rather than the record — the cost is
  paid once per page, not once per row, and a page remains independently
  decodable.
- **Adopt DYNAMIC's atomic-BLOB semantics.** No local prefix; a large value is
  a pointer. Simpler, and it makes long index prefixes possible.
