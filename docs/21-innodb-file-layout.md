# 21 — InnoDB file layout: tablespaces, pages, extents, segments

> Sources: `storage/innobase/include/fil0types.h` (FIL header/trailer),
> `fil0fil.h` (page types), `fsp0types.h` (space flags, extent size, reserved
> page numbers), `fsp0fsp.h` (FSP header, XDES, INODE), `fut0lst.h` (list
> nodes), `page0size.h`, `univ.i` (page size limits).

## Page size

Every tablespace is an array of fixed-size pages. `univ.i`:

- default **16384** bytes (`UNIV_PAGE_SIZE_SHIFT_DEF = 14`)
- minimum 4096 (`SHIFT_MIN = 12`), maximum 65536 (`SHIFT_MAX = 16`)
- compressed pages: 1 KiB to 16 KiB (`UNIV_ZIP_SIZE_SHIFT_MIN = 10`, `MAX = 14`)

Page size is fixed for the whole instance at initialisation
(`innodb_page_size`) and is recorded in each tablespace's flags. All the offsets
below assume 16 KiB.

## The FIL header and trailer — every page, without exception

Every page, whatever its type, begins with a 38-byte header and ends with an
8-byte trailer. `fil0types.h`:

| Offset | Size | Name | Meaning |
|---|---|---|---|
| 0 | 4 | `FIL_PAGE_SPACE_OR_CHKSUM` | page checksum (was the space id pre-4.0.14) |
| 4 | 4 | `FIL_PAGE_OFFSET` | **this page's own page number** |
| 8 | 4 | `FIL_PAGE_PREV` | previous page at this B+tree level; `FIL_NULL` (`0xFFFFFFFF`) if none |
| 12 | 4 | `FIL_PAGE_NEXT` | next page at this level |
| 16 | 8 | `FIL_PAGE_LSN` | LSN of the last modification to this page |
| 24 | 2 | `FIL_PAGE_TYPE` | see the table below |
| 26 | 8 | `FIL_PAGE_FILE_FLUSH_LSN` | only meaningful on page 0 of the system tablespace |
| 34 | 4 | `FIL_PAGE_SPACE_ID` | the tablespace id |
| **38** | | `FIL_PAGE_DATA` | where the page body starts |

Trailer, the last 8 bytes (`FIL_PAGE_DATA_END = 8`):

| Offset from end | Size | Meaning |
|---|---|---|
| −8 | 4 | old-style checksum (or the CRC32 again) |
| −4 | 4 | **low 32 bits of `FIL_PAGE_LSN`** |

Two things this buys you, and both are worth copying into our own format:

- **`FIL_PAGE_OFFSET` is self-identifying.** A page knows its own number, so a
  misdirected write is detectable rather than silently corrupting.
- **The low LSN appears at both ends.** If the head and tail LSNs disagree, the
  page was torn — half old, half new. This is the cheapest possible torn-write
  detector and it is why InnoDB can validate a page without reading the log.

At offsets 8/12 and 26, some page types reuse the fields: `FIL_PAGE_SRV_VERSION`
and `FIL_PAGE_SPACE_VERSION` overlay `PREV`/`NEXT` on page 0; compressed pages
overlay the flush-LSN area with `FIL_PAGE_VERSION` / `ALGORITHM_V1` /
`ORIGINAL_TYPE_V1` / `ORIGINAL_SIZE_V1` / `COMPRESS_SIZE_V1`; R-tree pages use it
for `FIL_RTREE_SPLIT_SEQ_NUM`.

### Checksums

`FIL_PAGE_SPACE_OR_CHKSUM` and the trailer checksum are computed over the page
excluding the LSN field and the checksum fields themselves.
`innodb_checksum_algorithm` selects the function; **`crc32` is the default since
5.6** and the only one worth implementing (`innodb`, the legacy Fletcher-like
variant, and `none` also exist). InnoDB accepts several variants on read for
upgrade compatibility, which is worth mirroring in a reader.

## Page types

`fil0fil.h`. Reading a `.ibd` starts with dispatching on `FIL_PAGE_TYPE`:

| Value | Constant | Contents |
|---|---|---|
| 0 | `FIL_PAGE_TYPE_ALLOCATED` | allocated but never written |
| 1 | `FIL_PAGE_TYPE_UNUSED` | |
| 2 | `FIL_PAGE_UNDO_LOG` | undo log page (doc 25) |
| 3 | `FIL_PAGE_INODE` | file segment inodes |
| 4 | `FIL_PAGE_IBUF_FREE_LIST` | insert buffer free list |
| 5 | `FIL_PAGE_IBUF_BITMAP` | insert buffer bitmap |
| 6 | `FIL_PAGE_TYPE_SYS` | system page |
| 7 | `FIL_PAGE_TYPE_TRX_SYS` | transaction system header |
| 8 | `FIL_PAGE_TYPE_FSP_HDR` | **page 0** — the tablespace header |
| 9 | `FIL_PAGE_TYPE_XDES` | extent descriptor page |
| 10 | `FIL_PAGE_TYPE_BLOB` | uncompressed off-page column (pre-DYNAMIC LOB) |
| 11/12 | `FIL_PAGE_TYPE_ZBLOB`, `ZBLOB2` | compressed off-page column |
| 13 | `FIL_PAGE_TYPE_UNKNOWN` | |
| 18/19 | `FIL_PAGE_SDI_BLOB`, `SDI_ZBLOB` | overflow for SDI records |
| 20 | `FIL_PAGE_TYPE_LEGACY_DBLWR` | old doublewrite pages inside `ibdata1` |
| 21 | `FIL_PAGE_TYPE_RSEG_ARRAY` | rollback segment array |
| 22–24 | `FIL_PAGE_TYPE_LOB_INDEX`, `LOB_DATA`, `LOB_FIRST` | the 8.0 LOB format |
| 25–29 | `ZLOB_*` | compressed LOB |
| **17853** | `FIL_PAGE_SDI` | serialised dictionary information (doc 27) |
| **17854** | `FIL_PAGE_RTREE` | spatial index |
| **17855** | `FIL_PAGE_INDEX` | **B+tree page — where rows live** (doc 22) |

The three large values are historical: they are ASCII-ish sentinels chosen to be
unlikely to collide with the small type codes.

## Space management: extents and segments

InnoDB does not allocate pages one at a time once a tablespace is warm. Three
levels:

**Page** → **extent** → **segment**.

An **extent** is a run of physically contiguous pages sized to ~1 MiB
(`fsp0types.h`): with a 16 KiB page that is **64 pages**; the rule is 1 MiB for
pages ≤ 16 KiB, 2 MiB for 32 KiB, 4 MiB for 64 KiB.

A **segment** is a logical allocation unit that owns extents. Each B+tree owns
*two* segments — one for leaf pages (`PAGE_BTR_SEG_LEAF`) and one for internal
pages (`PAGE_BTR_SEG_TOP`) — which is why range scans over leaves tend to be
sequential.

A new segment starts by taking individual pages from *fragment* extents (up to
32 pages), then switches to whole-extent allocation. This avoids wasting a
megabyte on a table with three rows.

## Page 0: the FSP header

Page 0 of every tablespace is `FIL_PAGE_TYPE_FSP_HDR`. Its body starts at
`FSP_HEADER_OFFSET = FIL_PAGE_DATA = 38` (`fsp0fsp.h`):

| Offset (from 38) | Size | Field | Meaning |
|---|---|---|---|
| 0 | 4 | `FSP_SPACE_ID` | tablespace id |
| 4 | 4 | `FSP_NOT_USED` | |
| 8 | 4 | `FSP_SIZE` | current size in pages |
| 12 | 4 | `FSP_FREE_LIMIT` | first page not yet initialised |
| 16 | 4 | `FSP_SPACE_FLAGS` | see below |
| 20 | 4 | `FSP_FRAG_N_USED` | used pages in the `FREE_FRAG` list |
| 24 | 16 | `FSP_FREE` | base node: list of fully free extents |
| 40 | 16 | `FSP_FREE_FRAG` | base node: partially used fragment extents |
| 56 | 16 | `FSP_FULL_FRAG` | base node: full fragment extents |
| 72 | 8 | `FSP_SEG_ID` | next segment id to allocate |
| 80 | 16 | `FSP_SEG_INODES_FULL` | base node: full inode pages |
| 96 | 16 | `FSP_SEG_INODES_FREE` | base node: inode pages with space |
| **112** | | `FSP_HEADER_SIZE` | = `32 + 5 × FLST_BASE_NODE_SIZE` |

List primitives (`fut0lst.h`, `fil0types.h`):

```
FIL_ADDR         = { page_no: int32, boffset: int16 }     6 bytes
FLST_NODE_SIZE   = 2 × FIL_ADDR_SIZE                      12 bytes  (prev, next)
FLST_BASE_NODE_SIZE = 4 + 2 × FIL_ADDR_SIZE               16 bytes  (len, first, last)
```

These doubly-linked lists threaded *through page contents* are InnoDB's universal
data structure — free extents, inode pages, undo segments, LOB pages all use
them. They are also a liability: a single bad write breaks a list and the damage
propagates. Our own format should prefer allocation bitmaps over on-disk linked
lists wherever the access pattern allows.

### `FSP_SPACE_FLAGS`

A bitfield (`fsp0types.h`, `FSP_FLAGS_POS_*` / `FSP_FLAGS_WIDTH_*`), in order
from bit 0:

| Bits | Field | Meaning |
|---|---|---|
| 1 | `POST_ANTELOPE` | row format is at least COMPACT |
| 4 | `ZIP_SSIZE` | compressed page size shift, 0 = uncompressed |
| 1 | `ATOMIC_BLOBS` | DYNAMIC or COMPRESSED (off-page storage semantics) |
| 4 | `PAGE_SSIZE` | logical page size shift |
| 1 | `DATA_DIR` | tablespace lives outside the datadir |
| 1 | `SHARED` | a general tablespace |
| 1 | `TEMPORARY` | |
| 1 | `ENCRYPTION` | |
| 1 | `SDI` | the tablespace carries SDI pages |
| 1 | `UNDO_UNUSABLE` | undo tablespace marked unusable |

These flags tell a reader the page size and row format before it has parsed a
single record — read them first.

## Extent descriptors (XDES)

Immediately after the FSP header, at `XDES_ARR_OFFSET = 38 + 112 = 150`, page 0
holds an array of extent descriptors covering the first *page-size* extents.
Each descriptor (`fsp0fsp.h`):

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | `XDES_ID` | owning segment id, or 0 if free |
| 8 | 12 | `XDES_FLST_NODE` | list node linking it into `FSP_FREE`/`FREE_FRAG`/… |
| 20 | 4 | `XDES_STATE` | `FREE`(1), `FREE_FRAG`(2), `FULL_FRAG`(3), `FSEG`(4), `FSEG_FRAG`(5) |
| 24 | 16 | `XDES_BITMAP` | 2 bits per page: `XDES_FREE_BIT`(0), `XDES_CLEAN_BIT`(1) |

`XDES_SIZE = 24 + ceil(64 × 2 / 8) = 40` bytes at 16 KiB. One 16 KiB page thus
describes 16384/64 = 256 extents = 256 MiB of tablespace. Beyond that, dedicated
`FIL_PAGE_TYPE_XDES` pages appear at every 256-extent boundary (page 16384,
32768, …), repeating the descriptor array. `FSP_XDES_OFFSET = 0` and
`FSP_IBUF_BITMAP_OFFSET = 1` are the offsets *within* each such group.

## Reserved page numbers in the system tablespace (space id 0)

`fsp0types.h`:

| Page | Constant | Contents |
|---|---|---|
| 0 | `FSP_XDES_OFFSET` | FSP header + XDES array |
| 1 | `FSP_IBUF_BITMAP_OFFSET` | insert buffer bitmap |
| 2 | `FSP_FIRST_INODE_PAGE_NO` | first segment inode page |
| 3 | `FSP_IBUF_HEADER_PAGE_NO` | insert buffer header |
| 4 | `FSP_IBUF_TREE_ROOT_PAGE_NO` | insert buffer B+tree root |
| 5 | `FSP_TRX_SYS_PAGE_NO` | transaction system header |
| 6 | `FSP_FIRST_RSEG_PAGE_NO` | first rollback segment |
| 7 | `FSP_DICT_HDR_PAGE_NO` | dictionary header (pre-8.0 `SYS_*` tables) |

In a **file-per-table** `.ibd`, pages 0–2 have the same meaning; page 3 is the
first index root (or an SDI root, when SDI is present).

## Segment inodes

`FIL_PAGE_INODE` pages hold an array of segment inodes, each describing one
segment: its id, the number of used pages, and three list base nodes for its
extents (`FREE`, `NOT_FULL`, `FULL`) plus an array of up to 32 individually
allocated fragment pages. A B+tree page header points at its two segment inodes
through a 10-byte `FSEG_HEADER` (`{ space_id: 4, page_no: 4, offset: 2 }`,
`FSEG_HEADER_SIZE = 10`).

## Implications for our own storage format

Reading InnoDB carefully suggests both what to copy and what to avoid.

**Copy:**
- Fixed-size pages with a self-identifying header (page number + checksum + LSN).
- LSN at both head and tail for torn-write detection.
- Extent-based allocation to keep leaf scans sequential.
- Separate leaf and internal allocation so range scans stay physical.

**Do not copy:**
- On-disk doubly-linked lists. Use a bitmap allocator; it is one page to
  validate rather than a graph to traverse, and it is far friendlier to
  incremental checksums.
- The insert buffer / change buffer. It exists to defer random secondary-index
  writes on spinning disks. On OPFS and SSDs it is complexity for no gain.
- Compressed row format. `DYNAMIC` plus whole-page compression at the VFS layer
  is simpler and usually better.

**Do keep the 16 KiB page size**, even though OPFS and most SSDs have 4 KiB
granularity. It matches InnoDB (so imported pages map one-to-one), it keeps
B+tree fanout high, and it bounds tree depth: at 16 KiB with a 4-byte key, one
internal page holds ~1000 children, so three levels cover a billion rows.
