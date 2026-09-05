# 15 — Types on the wire

> Sources: `include/field_types.h` (`enum_field_types`), `include/mysql_com.h`
> (column flags), `@page page_protocol_com_query_response_text_resultset_column_definition`
> and `@page page_protocol_binary_resultset` in `sql/protocol_classic.cc`.

There are **two** encodings for every value, and confusing them is the single
most common protocol bug:

- **Text protocol** (`COM_QUERY` resultsets): every value is its SQL string
  rendering, as `string<lenenc>`; NULL is the single byte `0xFB`.
- **Binary protocol** (`COM_STMT_EXECUTE` resultsets and parameters): each type
  has its own fixed or length-prefixed byte layout; NULL lives in a bitmap.

Note also that neither of these is the *storage* encoding — how a value sits in
an InnoDB page is a third format entirely ([24](./24-column-encodings.md)).

## Column definition (`ColumnDefinition41`)

Sent once per column before the rows:

```
string<lenenc>  catalog            always "def"
string<lenenc>  schema
string<lenenc>  table              alias, as the query sees it
string<lenenc>  org_table          the real table name
string<lenenc>  name               alias
string<lenenc>  org_name           the real column name
int<lenenc>     length of the fixed block   always 0x0c
int<2>          character_set      collation id  (doc 29)
int<4>          column_length      max byte length of a value
int<1>          type               enum_field_types
int<2>          flags              see below
int<1>          decimals           0 for ints/fixed strings, 0x1f for float/double/dynamic strings, 0..0x51 for DECIMAL
string[2]       reserved           zero
if the command was COM_FIELD_LIST:
  string<lenenc> default value
```

Three fields together determine how a client decodes a value, and all three must
be right:

- `type` — the wire type, not necessarily the declared SQL type.
- `character_set` — `63` (`binary`) means the value is bytes, not text. This is
  how clients distinguish `VARBINARY`/`BLOB` from `VARCHAR`/`TEXT`, since both
  arrive as `VAR_STRING`/`BLOB`.
- `flags` — `UNSIGNED` in particular, which changes integer interpretation.

`column_length` is in **bytes**, not characters, so a `VARCHAR(255)` in
`utf8mb4` reports `1020`. Clients use it only for display width.

MariaDB adds an *extended metadata* block before the `0x0c` marker when
`MARIADB_CLIENT_EXTENDED_METADATA` is negotiated, carrying real type names for
its `UUID`/`INET4`/`INET6` types (see `mysql2`'s `column_definition.js`). A MySQL
server never sends it.

## Column flags

`include/mysql_com.h`:

| Value | Flag |
|---|---|
| `0x0001` | `NOT_NULL_FLAG` |
| `0x0002` | `PRI_KEY_FLAG` |
| `0x0004` | `UNIQUE_KEY_FLAG` |
| `0x0008` | `MULTIPLE_KEY_FLAG` — part of a non-unique index |
| `0x0010` | `BLOB_FLAG` |
| `0x0020` | `UNSIGNED_FLAG` |
| `0x0040` | `ZEROFILL_FLAG` |
| `0x0080` | `BINARY_FLAG` |
| `0x0100` | `ENUM_FLAG` |
| `0x0200` | `AUTO_INCREMENT_FLAG` |
| `0x0400` | `TIMESTAMP_FLAG` |
| `0x0800` | `SET_FLAG` |
| `0x1000` | `NO_DEFAULT_VALUE_FLAG` |
| `0x2000` | `ON_UPDATE_NOW_FLAG` |
| `0x8000` | `NUM_FLAG` — the value is numeric |

Only the first column of a multi-column index carries `MULTIPLE_KEY_FLAG`, so
clients cannot reconstruct index definitions from flags — they must query
`INFORMATION_SCHEMA`. Worth knowing when deciding how faithful our
`INFORMATION_SCHEMA` needs to be: for migration tools, very.

## Field types (`enum_field_types`)

| Code | Name | Declared SQL types |
|---|---|---|
| `0x00` | `DECIMAL` | pre-5.0 `DECIMAL`; never sent by a modern server |
| `0x01` | `TINY` | `TINYINT`, `BOOL` |
| `0x02` | `SHORT` | `SMALLINT` |
| `0x03` | `LONG` | `INT`, `INTEGER` |
| `0x04` | `FLOAT` | `FLOAT` |
| `0x05` | `DOUBLE` | `DOUBLE`, `REAL` |
| `0x06` | `NULL` | the literal `NULL` |
| `0x07` | `TIMESTAMP` | `TIMESTAMP` |
| `0x08` | `LONGLONG` | `BIGINT` |
| `0x09` | `INT24` | `MEDIUMINT` |
| `0x0a` | `DATE` | `DATE` |
| `0x0b` | `TIME` | `TIME` |
| `0x0c` | `DATETIME` | `DATETIME` |
| `0x0d` | `YEAR` | `YEAR` |
| `0x0e` | `NEWDATE` | internal only |
| `0x0f` | `VARCHAR` | internal only |
| `0x10` | `BIT` | `BIT(n)` |
| `0x11` | `TIMESTAMP2` | internal (storage) |
| `0x12` | `DATETIME2` | internal (storage) |
| `0x13` | `TIME2` | internal (storage) |
| `0x14` | `TYPED_ARRAY` | replication only |
| `0xf2` | `VECTOR` | `VECTOR` (MySQL 9.0+) |
| `0xf3` | `INVALID` | |
| `0xf4` | `BOOL` | placeholder, unused |
| `0xf5` | `JSON` | `JSON` |
| `0xf6` | `NEWDECIMAL` | `DECIMAL`, `NUMERIC` |
| `0xf7` | `ENUM` | `ENUM` — **sent as `STRING` (0xFE) with `ENUM_FLAG`** |
| `0xf8` | `SET` | `SET` — **sent as `STRING` with `SET_FLAG`** |
| `0xf9` | `TINY_BLOB` | `TINYBLOB`, `TINYTEXT` |
| `0xfa` | `MEDIUM_BLOB` | `MEDIUMBLOB`, `MEDIUMTEXT` |
| `0xfb` | `LONG_BLOB` | `LONGBLOB`, `LONGTEXT` |
| `0xfc` | `BLOB` | `BLOB`, `TEXT` |
| `0xfd` | `VAR_STRING` | `VARCHAR`, `VARBINARY` |
| `0xfe` | `STRING` | `CHAR`, `BINARY`, and `ENUM`/`SET` on the wire |
| `0xff` | `GEOMETRY` | all spatial types |

The mapping is lossy on purpose, and clients cope by combining `type` +
`character_set` + `flags`:

- `TEXT` vs `BLOB`: identical `type`; `character_set == 63` means BLOB.
- `VARCHAR` vs `VARBINARY`: same, on `VAR_STRING`.
- `ENUM`/`SET`: arrive as `STRING` with `ENUM_FLAG`/`SET_FLAG` set.
- `BOOL` is `TINY(1)`; there is no boolean on the wire.
- Note the collision: `0xf7` is `ENUM` in `enum_field_types` but `SET`'s flag is
  `0x0800` — the type byte and the flag are independent channels.

## Text protocol encoding

Every value is `string<lenenc>`, NULL is `0xFB`. The bytes are the value's SQL
rendering in the column's character set:

| Type | Text form |
|---|---|
| integers | `-42`, `18446744073709551615` |
| `DECIMAL` | `123.4500` — trailing zeros to the declared scale |
| `FLOAT`/`DOUBLE` | shortest round-trippable form, e.g. `10.2`, `1.7976931348623157e308` |
| `DATE` | `2010-10-17` |
| `DATETIME`/`TIMESTAMP` | `2010-10-17 19:27:30`, plus `.000001` if the column has fractional precision |
| `TIME` | `-120:19:27`, range `-838:59:59` … `838:59:59`; note hours may exceed 24 |
| `YEAR` | `2010` |
| `BIT` | raw bytes, big-endian, minimal length |
| `ENUM`/`SET` | the label, or comma-joined labels |
| `JSON` | the serialised JSON text |
| `BLOB`/`BINARY` | raw bytes |
| `GEOMETRY` | internal geometry format: 4-byte SRID + WKB |

`TIME` is the one that catches people: it is a *duration*, not a clock time. It
can be negative and it can exceed 24 hours, so mapping it to a `Date` is wrong.

## Binary protocol encoding

Used for `COM_STMT_EXECUTE` parameters and for binary resultset rows.

### Row framing

```
int<1>    0x00                     packet header
binary    null_bitmap              (column_count + 7 + 2) / 8 bytes
binary    values                   only for columns not marked NULL
```

The NULL bitmap has a **2-bit offset** in a resultset row (the low two bits of
the first byte are reserved) and a **0-bit offset** for `COM_STMT_EXECUTE`
parameters:

```
bytes = floor((n + 7 + offset) / 8)
byte  = (i + offset) >> 3
bit   = (i + offset) & 7
```

### Value layouts

| Type | Encoding |
|---|---|
| `TINY` | `int<1>` |
| `SHORT`, `YEAR` | `int<2>` |
| `LONG`, `INT24` | `int<4>` — note `INT24` is 4 bytes on the wire |
| `LONGLONG` | `int<8>` |
| `FLOAT` | 4 bytes, IEEE-754 single, little-endian |
| `DOUBLE` | 8 bytes, IEEE-754 double, little-endian |
| `STRING`, `VARCHAR`, `VAR_STRING`, `ENUM`, `SET`, all `*BLOB`, `GEOMETRY`, `BIT`, `DECIMAL`, `NEWDECIMAL`, `JSON` | `string<lenenc>` |
| `NULL` | nothing — the bitmap carries it |

`DECIMAL` and `JSON` travel as **strings** even in the binary protocol. There is
no binary numeric form for `DECIMAL` on the wire.

Signedness is not in the value; it comes from `UNSIGNED_FLAG` in the column
definition (resultsets) or from the parameter's flag byte (parameters). Decoding
`int<8>` without consulting it produces negative `BIGINT UNSIGNED` values — a
classic driver bug.

### `DATE`, `DATETIME`, `TIMESTAMP`

Length-prefixed and truncated to the shortest sufficient form:

```
int<1> length     0, 4, 7, or 11
int<2> year
int<1> month
int<1> day
int<1> hour
int<1> minute
int<1> second
int<4> microsecond
```

- `0` — the value is all-zero (the zero date); nothing follows.
- `4` — date only.
- `7` — date and time, no microseconds.
- `11` — everything.

```
04 da 07 0a 11                            → 2010-10-17
0b da 07 0a 11 13 1b 1e 01 00 00 00       → 2010-10-17 19:27:30.000001
```

A writer **must** emit the shortest form; a reader must accept all four.

### `TIME`

```
int<1> length     0, 8, or 12
int<1> is_negative  1 = negative
int<4> days
int<1> hour       0..23  (hours beyond 24 live in `days`)
int<1> minute
int<1> second
int<4> microsecond
```

```
0c 01 78 00 00 00 13 1b 1e 01 00 00 00    → -120d 19:27:30.000001
08 01 78 00 00 00 13 1b 1e                → -120d 19:27:30
01                                        →  0d 00:00:00
```

The `days` + `hour` split is why `TIME` can reach 838 hours: `838:59:59` is
34 days and 22 hours.

### Parameter binding (`COM_STMT_EXECUTE`)

Each parameter contributes `int<2>` of type information: the low byte is the
`enum_field_types` code and the **high bit of the high byte (`0x80`)** is the
unsigned flag. Values then follow in order, skipping NULLs. Full layout in
[16-prepared-statements.md](./16-prepared-statements.md).

## Mapping to JavaScript

The mapping is a policy decision, not a protocol fact. Our defaults, chosen to
match `mysql2` so that swapping in our engine changes nothing:

| MySQL | JavaScript | Rationale |
|---|---|---|
| `TINYINT`…`INT`, `MEDIUMINT` | `number` | always exact in a double |
| `BIGINT` | `number` if safe, else `BigInt`; `BigInt` always under `supportBigNumbers` | silent precision loss is unacceptable |
| `DECIMAL` | `string` by default | a double cannot represent `DECIMAL(30,10)`; opt in to `BigDecimal`-style objects |
| `FLOAT`/`DOUBLE` | `number` | exact |
| `DATE`, `DATETIME`, `TIMESTAMP` | `Date`, or `string` under `dateStrings` | `Date` loses sub-millisecond precision and the zero date |
| `TIME` | `string` | it is a duration, not an instant |
| `YEAR` | `number` | |
| `CHAR`, `VARCHAR`, `TEXT`, `ENUM`, `SET` | `string`, decoded per the column charset | |
| `BINARY`, `VARBINARY`, `BLOB` | `Uint8Array` | |
| `BIT` | `Uint8Array`, or `number` for `BIT(1)`…`BIT(53)` | |
| `JSON` | parsed value by default | matches `mysql2` |
| `NULL` | `null` | |
| `GEOMETRY` | `Uint8Array` (SRID + WKB), parsed on request | |

Two behaviours worth calling out because they surprise people, and we should
match MySQL exactly:

- **The zero date** `'0000-00-00'` is representable in MySQL and not in `Date`.
  Under `dateStrings` it round-trips; otherwise it becomes `null`, as `mysql2`
  does.
- **Timezones.** MySQL `DATETIME` has no timezone; `TIMESTAMP` is stored as UTC
  and converted using the session `time_zone`. Our engine must implement the
  session variable, and the driver-side `timezone` option must be honoured
  identically, or values shift by hours between drivers.
