# 24 — Byte-exact column encodings

> Sources: `storage/innobase/row/row0mysql.cc`
> (`row_mysql_store_col_in_innobase_format` — the integer transform),
> `storage/innobase/handler/ha_innodb.cc` (`get_innobase_type_from_mysql_type` —
> the type mapping), `mysys/decimal.cc` (`decimal2bin` and its worked example),
> `mysys/my_time.cc` (`@page datetime_and_date_low_level_rep`,
> `my_datetime_packed_to_binary`, `my_timestamp_to_binary`, `DATETIMEF_INT_OFS`),
> `sql/field.cc` (`Field_date::get_date_internal`),
> `storage/innobase/rem/rem0cmp.cc` (float comparison),
> `sql-common/json_binary.h` (doc 28).

This is the document to keep open while writing the codec. It answers, for every
MySQL type: **what exact bytes are on disk, and in what order.**

## Two global rules

**Rule 1 — InnoDB stores integers big-endian with the sign bit flipped.**
From `row_mysql_store_col_in_innobase_format`:

```c
if (type == DATA_INT) {
  /* Store integer data in Innobase in a big-endian format,
     sign bit negated if the data is a signed integer. In MySQL,
     integers are stored in a little-endian format. */
  byte *p = buf + col_len;
  for (;;) { p--; *p = *mysql_data; if (p == buf) break; mysql_data++; }
  if (!(dtype->prtype & DATA_UNSIGNED)) *buf ^= 128;
}
```

Both halves exist for the same reason: so that `memcmp` on two encoded values
yields the correct numeric ordering. Big-endian puts the most significant byte
first; flipping the sign bit maps signed range `[-2^(n-1), 2^(n-1))` onto
unsigned `[0, 2^n)` monotonically. This is what makes B+tree key comparison a
`memcmp` rather than a type-dispatched comparison.

```
INT signed        -1  →  LE 0xFFFFFFFF → reverse → FF FF FF FF → flip → 7F FF FF FF
INT signed         0  →  LE 0x00000000 → reverse → 00 00 00 00 → flip → 80 00 00 00
INT signed         1  →  LE 0x01000000 → reverse → 00 00 00 01 → flip → 80 00 00 01
INT UNSIGNED       1  →                              00 00 00 01  (no flip)
```

**Rule 2 — the exceptions are FLOAT, DOUBLE and DECIMAL.**
`FLOAT`/`DOUBLE` are stored in **little-endian IEEE-754**
(`mach_double_read`/`mach_float_read` normalise to little-endian) and are
compared *numerically*, not by `memcmp` — see `cmp_data()` in
`rem0cmp.cc`, which switches on `DATA_DOUBLE`/`DATA_FLOAT` and compares the
decoded values. `DECIMAL` is stored in a form that *is* `memcmp`-comparable but
is not an integer transform.

So: **most things big-endian, floats little-endian.** That asymmetry is real and
it will bite you.

## The type mapping

`get_innobase_type_from_mysql_type()` collapses MySQL's 30-odd types into a
handful of InnoDB "main types" (`data0type.h`). This table is the key to
everything below:

| MySQL type | InnoDB mtype | Storage |
|---|---|---|
| `TINYINT`, `SMALLINT`, `MEDIUMINT`, `INT`, `BIGINT`, `BOOL` | `DATA_INT` | big-endian, sign-flipped if signed |
| `DATE`, `YEAR`, and *legacy* `DATETIME`/`TIMESTAMP`/`TIME` | `DATA_INT` | same integer transform |
| `ENUM`, `SET` | `DATA_INT` (forced `DATA_UNSIGNED`) | big-endian, **no** sign flip |
| `DATETIME2`, `TIME2`, `TIMESTAMP2` (i.e. all modern temporals) | `DATA_FIXBINARY` | stored **verbatim** as MySQL's `Field` wrote them |
| `DECIMAL`/`NUMERIC` (`NEWDECIMAL`) | `DATA_FIXBINARY` | `decimal2bin` packed form |
| `FLOAT` | `DATA_FLOAT` | 4-byte IEEE-754, little-endian |
| `DOUBLE` | `DATA_DOUBLE` | 8-byte IEEE-754, little-endian |
| `CHAR`, `BIT` (binary charset) | `DATA_FIXBINARY` | fixed bytes |
| `CHAR` (latin1) | `DATA_CHAR` | fixed, space-padded |
| `CHAR` (other charsets) | `DATA_MYSQL` | variable-length in COMPACT/DYNAMIC |
| `VARCHAR`/`VARBINARY` (binary) | `DATA_BINARY` | length in the var-len array |
| `VARCHAR` (latin1) | `DATA_VARCHAR` | ditto |
| `VARCHAR` (other) | `DATA_VARMYSQL` | ditto |
| `TINYBLOB`…`LONGBLOB`, `TEXT`, `JSON`, `VECTOR` | `DATA_BLOB` | variable, off-page when long |
| `GEOMETRY` | `DATA_GEOMETRY` | SRID + WKB |

Note the two easy-to-miss lines: `DATA_FIXBINARY` means **no transform at all**,
so all the modern temporal types keep the byte layout `mysys/my_time.cc`
produced; and `ENUM`/`SET` are forced unsigned even though MySQL's own
`UNSIGNED_FLAG` is clear on them.

## Integers

| Type | Bytes |
|---|---|
| `TINYINT` | 1 |
| `SMALLINT` | 2 |
| `MEDIUMINT` | 3 |
| `INT` | 4 |
| `BIGINT` | 8 |

Big-endian; XOR `0x80` into the first byte unless the column is `UNSIGNED`.
`BOOL`/`BOOLEAN` is `TINYINT(1)`, no separate type.

`DISPLAY_WIDTH` (`INT(11)`) affects only `ZEROFILL` formatting, never storage —
and is deprecated in 8.0.

## `DECIMAL` / `NUMERIC`

Stored in the `decimal2bin` format (`mysys/decimal.cc`), which is designed so
that **two values of the same `(precision, scale)` compare correctly with
`memcmp`**.

The algorithm:

1. Digits are grouped base 10⁹ (`DIG_PER_DEC1 = 9`, `DIG_BASE = 1000000000`).
2. Each full group of 9 digits is stored as a 4-byte big-endian integer.
3. The leading partial group (`intg % 9` digits) uses the minimum number of
   bytes for that many digits, from
   `dig2bytes[] = {0, 1, 1, 2, 2, 3, 3, 4, 4, 4}`.
4. The same for the fractional part: full groups as 4 bytes, the trailing
   partial group in `dig2bytes[frac % 9]`.
5. If the value is negative, **every byte is inverted**.
6. Finally, **the most significant bit of the first byte is flipped**, so that
   unsigned `memcmp` orders negatives before positives.

Total size:

```js
const DIG2BYTES = [0, 1, 1, 2, 2, 3, 3, 4, 4, 4]
function decimalBinSize(precision, scale) {
  const intg = precision - scale
  return ((intg / 9 | 0) * 4) + DIG2BYTES[intg % 9] +
         ((scale / 9 | 0) * 4) + DIG2BYTES[scale % 9]
}
```

The worked example from `decimal.cc`, `DECIMAL(14,4)`:

```
value  1234567890.1234
groups          1 | 234567890 | 123400000
                ^   ^           ^
             1 digit  9 digits    4 digits (scale=4)
bytes        01   0D FB 38 D2    04 D2
flip MSB  →  81   0D FB 38 D2    04 D2       (7 bytes total)

value -1234567890.1234  →  7E F2 04 C7 2D FB 2D
```

`DECIMAL(65,30)` is the maximum. This encoding is worth implementing exactly:
it is used identically in `.ibd` files and in binlog row images.

## Temporal types

MySQL 5.6.4 introduced fractional-second temporal types (`TIMESTAMP2`,
`DATETIME2`, `TIME2`). Modern tables use those; legacy tables may still hold the
old ones. All modern temporals are `DATA_FIXBINARY` in InnoDB, so the bytes
below are exactly what is on disk.

### `DATETIME` (`DATETIME2`) — 5 bytes + fraction

From `@page datetime_and_date_low_level_rep` in `mysys/my_time.cc`, the packed
64-bit in-memory form is:

```
Format: SYYYYYYY.YYYYYYYY.YYdddddh.hhhhmmmm.mmssssss.ffffffff.ffffffff.ffffffff

  1 bit  sign            (only used on disk)
 17 bits year*13 + month (year 0–9999, month 0–12)
  5 bits day             (0–31)
  5 bits hour            (0–23)
  6 bits minute          (0–59)
  6 bits second          (0–59)
 24 bits microseconds
```

On disk the *integer part* (the top 40 bits) is written **big-endian in 5 bytes**
with an offset added:

```c
#define DATETIMEF_INT_OFS 0x8000000000LL
mi_int5store(ptr, my_packed_time_get_int_part(nr) + DATETIMEF_INT_OFS);
```

The offset makes the value unsigned so the bytes sort correctly. Fractional
bytes follow, sized by the declared precision:

| `dec` | Extra bytes | Content |
|---|---|---|
| 0 | 0 | — |
| 1, 2 | 1 | `microseconds / 10000` |
| 3, 4 | 2 | `microseconds / 100`, big-endian |
| 5, 6 | 3 | `microseconds`, big-endian |

So `DATETIME(0)` is 5 bytes, `DATETIME(3)` is 7, `DATETIME(6)` is 8.

```js
function encodeDatetime2(y, mo, d, h, mi, s, micros, dec) {
  const ymd = BigInt((y * 13 + mo) * 32 + d)     // (year*13+month) << 5 | day
  const hms = BigInt((h << 12) | (mi << 6) | s)
  const intPart = (ymd << 17n) | hms
  const withOfs = intPart + 0x8000000000n
  const out = [
    Number((withOfs >> 32n) & 0xffn), Number((withOfs >> 24n) & 0xffn),
    Number((withOfs >> 16n) & 0xffn), Number((withOfs >>  8n) & 0xffn),
    Number( withOfs         & 0xffn),
  ]
  if (dec >= 5) { const v = micros;          out.push(v>>16 & 0xff, v>>8 & 0xff, v & 0xff) }
  else if (dec >= 3) { const v = micros/100|0; out.push(v>>8 & 0xff, v & 0xff) }
  else if (dec >= 1) { out.push((micros/10000|0) & 0xff) }
  return Uint8Array.from(out)
}
```

Note `month` occupies its slot as `year * 13 + month`, not `year * 12` — because
month 0 is legal (the zero date).

### `TIMESTAMP` (`TIMESTAMP2`) — 4 bytes + fraction

`my_timestamp_to_binary`: a 4-byte **big-endian** Unix epoch second
(`mi_int4store`), plus the same fractional tail as `DATETIME2`.

```
dec 0     → 4 bytes
dec 1,2   → 5 bytes   (usec/10000, 1 byte)
dec 3,4   → 6 bytes   (usec/100, 2 bytes BE)
dec 5,6   → 7 bytes   (usec, 3 bytes BE)
```

`TIMESTAMP` is stored as **UTC** and converted to the session `time_zone` on
read; `DATETIME` has no timezone at all. Reproducing this distinction is
mandatory — it is the most commonly observed MySQL behaviour difference between
engines.

### `TIME` (`TIME2`) — 3 bytes + fraction

3 bytes big-endian with offset `0x800000`, packing:

```
 1 bit  sign (1 = non-negative)
 1 bit  unused
10 bits hour   (0–838)
 6 bits minute (0–59)
 6 bits second (0–59)
```

plus the same fractional tail (1/2/3 bytes). The 10-bit hour field is why the
range is `-838:59:59` to `838:59:59`.

Negative `TIME` values are stored as the two's complement of the packed value
before adding the offset, so `memcmp` ordering still holds.

### `DATE` — 3 bytes

From `Field_date::get_date_internal`:

```c
const uint32 tmp = uint3korr(ptr);      // little-endian 3-byte read
ltime->day   =  tmp        & 31;
ltime->month = (tmp >>  5) & 15;
ltime->year  =  tmp >>  9;
```

so the packed value is `year << 9 | month << 5 | day`, written little-endian by
MySQL's `Field`. `DATE` maps to `DATA_INT`, so InnoDB then **byte-reverses it to
big-endian and flips the sign bit** on the way into the record. Both steps
matter when reading a `.ibd`; only the first matters when reading a binlog row
image.

`0000-00-00` is representable (all zeros) and is legal unless `sql_mode`
includes `NO_ZERO_DATE`.

### `YEAR` — 1 byte

`Field_year` is a `Field_tiny` constructed with `unsigned = true`, so no sign
flip. The stored byte is `year - 1900`, with `0` reserved for the zero year.
Range 1901–2155 (`Field_year::Limits`).

### Legacy temporal formats (pre-5.6.4)

Still found in old tablespaces:

| Type | Storage |
|---|---|
| `DATETIME` (old) | 8 bytes: the decimal number `YYYYMMDDHHMMSS` as an int64 |
| `TIMESTAMP` (old) | 4 bytes: Unix epoch seconds, little-endian |
| `TIME` (old) | 3 bytes: the decimal number `HHMMSS` |

All three map to `DATA_INT`, so they also get the byte-reverse and sign flip.
A reader must distinguish them by the *dictionary's* declared type, since the
byte lengths overlap with the modern forms.

## Strings and binary

| Type | Storage |
|---|---|
| `CHAR(n)` single-byte charset | fixed `n` bytes, **space-padded** (`0x20`) |
| `CHAR(n)` multi-byte charset | *variable-length* in COMPACT/DYNAMIC: trailing spaces stripped, length in the var-len array |
| `BINARY(n)` | fixed `n` bytes, **zero-padded** (`0x00`) |
| `VARCHAR(n)` | variable; the length lives in the record's var-len array, **not** as a prefix in the data |
| `VARBINARY(n)` | same |
| `TINYTEXT`/`TINYBLOB` … `LONGTEXT`/`LONGBLOB` | variable; off-page when long (doc 23) |

Two traps:

- **The `VARCHAR` length prefix is not in the InnoDB record.** MySQL's in-memory
  row buffer has a 1- or 2-byte prefix (2 bytes when `DATA_LONG_TRUE_VARCHAR`),
  and `row_mysql_store_col_in_innobase_format` *strips* it. It is, however,
  present in binlog row images. Same value, two different framings.
- **`CHAR` padding differs by charset.** With `latin1`, `CHAR(10)` is always 10
  bytes. With `utf8mb4`, InnoDB stores it variable-length with trailing spaces
  removed, so it behaves like `VARCHAR` on disk while still behaving like `CHAR`
  in comparisons (which pad). Both halves of that must be reproduced or
  `CHAR` comparisons go wrong.

`n` for `VARCHAR(n)` counts **characters**; the byte budget is `n × mbmaxlen`,
which is why `VARCHAR(255)` in `utf8mb4` needs a 2-byte length and why the
64 KB row limit bites sooner than users expect.

## `ENUM` and `SET`

Forced `DATA_UNSIGNED`, so no sign flip.

- **`ENUM`**: 1 byte if there are ≤ 255 values, otherwise 2 bytes, big-endian.
  The value is the **1-based index** into the declared value list. `0` means the
  invalid/empty string — the value MySQL stores when a bad `ENUM` value is
  inserted in non-strict mode.
- **`SET`**: a bitmask, one bit per declared member, in 1, 2, 3, 4 or 8 bytes
  (whichever is the smallest that holds up to 64 members), big-endian.

Both therefore depend entirely on the dictionary's stored member list; the bytes
alone are meaningless. Preserving member *order* through any schema change is a
correctness requirement.

## `BIT(n)`

`ceil(n / 8)` bytes, big-endian, with the value right-aligned. In InnoDB this is
`DATA_FIXBINARY` (via `Field_bit_as_char`), so the bytes are stored as-is.

MyISAM has a genuinely strange variant where the leftover bits are packed into
the record's null-byte area; InnoDB does not do this. If you ever import MyISAM,
this is a real difference.

## `JSON`

`DATA_BLOB`, holding the **binary JSON** representation
([28-json-binary.md](./28-json-binary.md)) — not the text. Off-page like any
other BLOB when large, and the 8.0 LOB page format supports partial in-place
updates, which is what makes `JSON_SET` on a large document cheap.

## `GEOMETRY`

`DATA_GEOMETRY`: a 4-byte little-endian SRID followed by standard WKB
(Well-Known Binary). `DATA_POINT` and `DATA_VAR_POINT` are internal
optimisations for the `POINT` type; `DATA_MBR_LEN = SPDIMS * 2 * sizeof(double)`
is the minimum bounding rectangle stored in R-tree node pointers.

## `VECTOR` (MySQL 9.0+)

`DATA_BLOB`: a packed array of 4-byte little-endian IEEE-754 floats. The
dimension count is `byte_length / 4` (`vector-common/vector_constants.h`:
`get_dimensions(length, precision)`), with `max_dimensions = 16383`.

## System columns

`data0type.h`:

| Column | Bytes | Meaning |
|---|---|---|
| `DB_ROW_ID` | 6 | hidden PK when none was declared; a global monotonic counter |
| `DB_TRX_ID` | 6 | transaction that last modified the row (doc 25) |
| `DB_ROLL_PTR` | 7 | pointer into the undo log (doc 25) |

`DATA_N_SYS_COLS = 3`. All big-endian.

## Index key encoding

Index keys use the same per-column encodings, concatenated in index order. Two
additions:

- For a **nullable** indexed column, a 1-byte NULL flag precedes the value in
  key comparisons (in the record itself, the null bitmap serves this role).
- For **prefix indexes** (`KEY (col(10))`), only the first *n* bytes (characters,
  for a character column) are stored.

Because integers, temporals and `DECIMAL` are all encoded to be
`memcmp`-ordered, comparing two index keys is a byte comparison — **except** for
character columns, where the collation's sort key must be used, and for
`FLOAT`/`DOUBLE`, which are compared numerically. See
[29-charsets-and-collations.md](./29-charsets-and-collations.md); this is the
single hardest part of matching MySQL's ordering.

## Implementation plan for the codec

```
@myjs/types/
  encode.js      value  → storage bytes  (per mtype)
  decode.js      bytes  → value
  keys.js        value  → memcmp-ordered key bytes
  compare.js     ordering for the types that are not memcmp-ordered
```

Testing strategy (see [43-testing.md](./43-testing.md)):

1. **Golden vectors from the source's own examples** — the `DECIMAL(14,4)`
   worked example, the `DATETIME`/`TIME` binary-protocol examples in doc 15.
2. **Round-trip property tests** — `decode(encode(v)) === v` for random values
   across every type and every precision.
3. **Ordering property tests** — for every pair of values of a type,
   `sign(compare(a, b)) === sign(memcmp(encode(a), encode(b)))` wherever the
   encoding claims to be `memcmp`-ordered. This single test catches nearly every
   sign-flip and endianness bug.
4. **Differential tests against a real server** — `SELECT HEX(col)` and, better,
   dump real `.ibd` files in CI and compare byte-for-byte.
