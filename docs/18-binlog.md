# 18 — The binary log and replication

> Sources: `libs/mysql/binlog/event/binlog_event.h` (event header offsets,
> `Log_event_type`), `libs/mysql/binlog/event/rows_event.h` (Table_map and Rows
> post-headers).

The binlog is not on the critical path for an embedded database, but it is the
right shape for two things we will eventually want: **change data capture** (the
`electric-sql`/`pglite-sync` pattern — reactive queries, live sync) and
**migration from a real MySQL server**. So it is worth understanding now and
implementing later.

## Framing

A binlog file starts with the 4-byte magic `fe 62 69 6e` (`\xfe"bin"`), then a
sequence of events. Every event has a 19-byte common header (v4 format,
`BINLOG_VERSION = 4`):

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `timestamp` — seconds since epoch, when the statement started |
| 4 | 1 | `type_code` — `Log_event_type` |
| 5 | 4 | `server_id` |
| 9 | 4 | `event_size` — total, including this header |
| 13 | 4 | `log_pos` — offset of the *next* event in the file |
| 17 | 2 | `flags` |

(The constants are `EVENT_TYPE_OFFSET 4`, `SERVER_ID_OFFSET 5`,
`EVENT_LEN_OFFSET 9`, `LOG_POS_OFFSET 13`, `FLAGS_OFFSET 17`,
`LOG_EVENT_HEADER_LEN 19`.)

After the header comes a per-type **post-header** whose length is declared by the
`FORMAT_DESCRIPTION_EVENT` at the top of every file, then the **body**, then
optionally a 4-byte CRC32 **footer** (when `binlog_checksum = CRC32`, the
default since 5.6). You cannot parse a binlog without first reading the
format-description event: it is what tells you the post-header length of every
other type.

## Event types that matter

`Log_event_type` (`binlog_event.h`):

| Code | Event | Purpose |
|---|---|---|
| 2 | `QUERY_EVENT` | a statement, in statement-based replication; also `BEGIN` markers in RBR |
| 4 | `ROTATE_EVENT` | pointer to the next binlog file |
| 15 | `FORMAT_DESCRIPTION_EVENT` | **first event of every file**; declares post-header lengths |
| 16 | `XID_EVENT` | transaction commit, carries the XA id |
| 19 | `TABLE_MAP_EVENT` | binds a numeric table id to schema/table/column types |
| 30 | `WRITE_ROWS_EVENT` | INSERT |
| 31 | `UPDATE_ROWS_EVENT` | UPDATE (before and after images) |
| 32 | `DELETE_ROWS_EVENT` | DELETE |
| 33 | `GTID_LOG_EVENT` | global transaction identifier |
| 34 | `ANONYMOUS_GTID_LOG_EVENT` | ditto, GTID mode off |
| 39 | `PARTIAL_UPDATE_ROWS_EVENT` | JSON partial updates |

Codes 23/24/25 are the obsolete v1 row events; a modern server emits 30/31/32.

## Row-based replication

RBR is what we care about, because it carries *data*, not SQL to re-execute.

A transaction looks like:

```
GTID_LOG_EVENT
QUERY_EVENT          "BEGIN"
TABLE_MAP_EVENT      table id 42 → `db`.`t`, column types, metadata, nullability
WRITE_ROWS_EVENT     table id 42, rows
TABLE_MAP_EVENT      table id 43 → ...
UPDATE_ROWS_EVENT    table id 43, before/after rows
XID_EVENT            commit
```

### `TABLE_MAP_EVENT`

The schema half. Post-header: table id (6 bytes) and flags (2 bytes). Body:

```
1 byte    schema name length,  schema name, 0x00
1 byte    table name length,   table name,  0x00
lenenc    column count
n bytes   column types      one enum_field_types byte per column
lenenc    metadata length
n bytes   metadata          per-type extra info (see below)
n bytes   null_bits         one bit per column, "is nullable"
[ optional metadata blocks ]   signedness, charsets, column names, ENUM/SET labels, ...
```

The **metadata block** is the awkward part: its layout is per-type and
undocumented outside the source. `VARCHAR` contributes 2 bytes (max length);
`BLOB` contributes 1 (the length-bytes count); `DECIMAL` contributes 2
(precision, scale); `DATETIME2`/`TIME2`/`TIMESTAMP2` contribute 1 (fractional
precision); `STRING` contributes a packed type+length pair. Without it you
cannot decode the row images, because the row image uses the *storage*
encodings ([24](./24-column-encodings.md)), not the wire ones.

The optional metadata blocks (5.7.20+, `binlog_row_metadata = FULL`) are what
make a binlog self-describing: signedness, charsets, column names, ENUM/SET
label sets, primary key. Without `FULL`, a consumer must have the schema out of
band. **Any CDC design of ours should require `FULL`.**

### Rows events

Post-header: table id (6 bytes), flags (2 bytes), and — for v2 events (30/31/32)
— `extra_row_info` (2-byte length plus payload). Body:

```
lenenc    number of columns
n bytes   columns_before_image   bitmap: which columns are present
n bytes   columns_after_image    UPDATE only
rows:
  n bytes null_bits             one bit per *present* column
  values                        storage encodings, in column order
```

Two bitmaps matter and are easy to confuse: `columns_before_image` says which
columns appear in the image at all (partial images under
`binlog_row_image = MINIMAL`), and `null_bits` says which of *those* are NULL.
The `null_bits` length is `(number of present columns + 7) / 8`.

Values use the **storage** encodings: `DECIMAL` in the packed binary form
(doc 24), `DATETIME2` big-endian with the `0x8000000000` offset, `JSON` in the
binary JSON format (doc 28). This is precisely why doc 24 exists — the same
codec serves the binlog reader and the InnoDB reader.

## Streaming it: `COM_BINLOG_DUMP`

```
int<1>   0x12
int<4>   binlog position
int<2>   flags        0x01 = BINLOG_DUMP_NON_BLOCK
int<4>   server id
string<EOF>  binlog filename
```

The server then pushes events indefinitely, each wrapped in an ordinary MySQL
packet with a leading `0x00` byte. This breaks the request/response rule
described in doc 10 — the connection becomes a one-way stream until it is
closed. `COM_BINLOG_DUMP_GTID` (`0x1e`) is the GTID-based variant.

## What we should build, and when

**Not** a replication server. But three related things, in order:

1. **A binlog *reader*** (`@myjs/binlog`), as a standalone parser. Immediately
   useful for migrating an existing database, and testable against files a real
   server produced.
2. **A change stream from our own engine.** Our engine already produces a
   redo/WAL record for every modification ([26](./26-redo-and-recovery.md)); a
   logical change stream is a projection of that. Emitting it in
   binlog-event *shape* (table map + row events, `FULL` metadata) means
   downstream tooling built for MySQL CDC works against us unmodified — a real
   payoff for a small amount of extra design.
3. **`COM_BINLOG_DUMP` support** over that change stream, so an existing CDC
   client can subscribe. This is the piece that would make "sync a browser
   database to a server" a natural extension rather than a rewrite.

Point 2 is the one to hold in mind while designing the WAL record format, since
retrofitting logical information onto a purely physical log is painful. Record
enough to reconstruct before/after row images at commit time.
