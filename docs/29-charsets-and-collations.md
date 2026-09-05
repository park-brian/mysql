# 29 — Character sets and collations

> Sources: `strings/ctype-*.cc` (collation definitions and their numeric ids —
> the ids below were extracted programmatically from those files),
> `include/mysql/strings/m_ctype.h`, `mysys/charset.cc`.

This document exists because collation is not a display concern. **It determines
index order, `ORDER BY` results, `=` semantics, and unique-constraint
violations.** An engine that gets collation wrong is not MySQL-compatible in any
meaningful sense, however good its protocol implementation is.

## Character set vs. collation

- A **character set** is an encoding: `utf8mb4`, `latin1`, `binary`.
- A **collation** is a comparison and sorting rule *for* a character set:
  `utf8mb4_0900_ai_ci`, `utf8mb4_bin`.

Every collation has a numeric id used in the wire protocol (`character_set` in
`HandshakeV10` and in every column definition) and in the data dictionary.

## The ids that matter

Verified by extracting them from `strings/ctype-*.cc`:

| Id | Collation | Notes |
|---|---|---|
| 8 | `latin1_swedish_ci` | the MySQL 5.x default; still common in old dumps |
| 33 | `utf8mb3_general_ci` | the old "utf8" — 3-byte only, cannot store emoji |
| 45 | `utf8mb4_general_ci` | the 5.7 default for utf8mb4 |
| 46 | `utf8mb4_bin` | byte comparison |
| **63** | **`binary`** | **not text** — this is how a client knows a column is `BLOB`/`VARBINARY` |
| 224 | `utf8mb4_unicode_ci` | UCA 4.0.0 |
| 246 | `utf8mb4_unicode_520_ci` | UCA 5.2.0 |
| **255** | **`utf8mb4_0900_ai_ci`** | **the MySQL 8.0 default** — UCA 9.0.0, accent- and case-insensitive |
| 278 | `utf8mb4_0900_as_cs` | accent- and case-sensitive |

Id **63** deserves emphasis: it is not a text collation at all, and it is the
mechanism by which `TEXT` is distinguished from `BLOB` and `VARCHAR` from
`VARBINARY` on the wire (doc 15), since those pairs share a type byte.

`HandshakeV10` carries only a single byte for the default collation, so ids
above 255 cannot be advertised there — which is why servers advertise a
low-numbered default and clients issue `SET NAMES` afterwards.

## The three families, and what each requires

### 1. Binary (`*_bin`, `binary`)

Compare bytes with `memcmp`. Trivial and exact.

### 2. `*_general_ci` — the legacy simple collations

A per-character weight table: fold to a single 16-bit weight per code point,
compare weight sequences. Fast, approximate, and full of well-known quirks
(`ä` = `a`, no expansions, `ß` ≠ `ss`).

Implementable from a generated table. `utf8mb4_general_ci` is roughly 1.1 MB of
source weights but compresses to a few tens of KB with the right structure
(most of Unicode maps to identity).

### 3. `*_0900_*` — UCA-based collations

The MySQL 8 default family, based on the Unicode Collation Algorithm with DUCET
9.0.0. These are the hard ones, because a correct implementation needs:

- **Multi-level weights**: primary (base letter), secondary (accents), tertiary
  (case). `_ai_ci` compares only the primary level; `_as_cs` compares all three.
- **Contractions**: sequences that collate as a unit (`ch` in Czech).
- **Expansions**: one character collating as several weights (`æ` → `a` + `e`).
- **Normalisation** interactions.

The weight table alone is on the order of a megabyte.

## The pragmatic plan

Full UCA for every collation is not a first-milestone project. A layered
approach:

**Layer 1 (core, always bundled)**
- `binary`, `utf8mb4_bin`, `latin1_bin`, `ascii_bin` — `memcmp`.
- `utf8mb4_general_ci`, `latin1_swedish_ci` — small generated tables.

**Layer 2 (default, bundled but lazily loaded)**
- `utf8mb4_0900_ai_ci`. It is the MySQL 8 default and therefore what most
  schemas will actually use, so it cannot be optional in practice — but it can
  be a dynamically imported module so it does not sit in the initial bundle.

**Layer 3 (opt-in packages)**
- `utf8mb4_0900_as_cs`, `utf8mb4_unicode_520_ci`, and the language-specific
  variants (`*_0900_ai_ci` for Czech, Polish, Turkish, …), each as a separate
  importable module.

### Why not `Intl.Collator`?

It is available everywhere and implements UCA correctly. It is still the wrong
choice as the *primary* implementation, for three reasons:

1. **It is not MySQL.** ICU's tailorings and MySQL's are not identical, and
   MySQL's are frozen at specific UCA versions. Results would differ in exactly
   the cases people notice.
2. **It gives no sort key.** `Intl.Collator.compare` is a comparator, but a
   B+tree wants a **byte string** it can store and `memcmp`. Without sort keys we
   would have to call into `Intl` at every node of every descent — orders of
   magnitude slower — and index bytes would depend on the runtime's ICU version,
   which is unacceptable for a persistent file.
3. **`localeCompare` semantics vary by engine version**, so a database written
   by one browser could sort differently in another.

Generated MySQL weight tables are the only way to get a stable, portable,
storable index order. `Intl.Collator` is a reasonable *fallback* for a collation
we have not generated tables for, with a loud warning that index order is then
runtime-dependent.

## Sort keys

The interface the engine needs:

```js
interface Collation {
  id: number
  charset: string
  name: string
  // byte string such that memcmp(sortKey(a), sortKey(b)) === compare(a, b)
  sortKey(bytes: Uint8Array): Uint8Array
  compare(a: Uint8Array, b: Uint8Array): number
  // pad semantics: PAD SPACE (pre-8.0 collations) or NO PAD (*_0900_*)
  padAttribute: 'PAD SPACE' | 'NO PAD'
}
```

`sortKey` is what goes into index entries. Two consequences:

- **Index size depends on the collation.** A UCA sort key can be several bytes
  per character. Index prefix limits (3072 bytes in DYNAMIC) are in *bytes* of
  the indexed value, and this is why.
- **`PAD SPACE` vs `NO PAD` is observable.** Pre-8.0 collations pad with spaces
  when comparing, so `'a' = 'a '` is **true** under `utf8mb4_general_ci`; the
  `_0900_` collations are `NO PAD`, so the same comparison is **false**. Unique
  indexes behave accordingly. This is one of the most common real-world
  surprises when upgrading MySQL, and we must reproduce both behaviours.

## Encoding

Beyond collation, the *encodings* themselves:

| Charset | Bytes/char | Notes |
|---|---|---|
| `utf8mb4` | 1–4 | full Unicode; the modern default |
| `utf8mb3` ("utf8") | 1–3 | **deprecated**; cannot represent emoji or any BMP-supplementary character |
| `latin1` | 1 | ISO-8859-1; MySQL's `latin1` is actually cp1252, which differs in 0x80–0x9F |
| `ascii` | 1 | |
| `binary` | 1 | no interpretation |
| `ucs2`, `utf16`, `utf16le`, `utf32` | 2–4 | supported in columns, **not usable as a connection charset** |
| `gbk`, `big5`, `sjis`, `cp932`, `euckr`, … | 1–2 | East Asian legacy sets |

`TextDecoder`/`TextEncoder` handle `utf-8`, `utf-16`, and most legacy encodings
natively in both Node and browsers, so the encoding layer is mostly a matter of
mapping MySQL charset names to WHATWG labels. `latin1` is the one to be careful
with: MySQL's `latin1` is cp1252 (`windows-1252`), *not* `iso-8859-1`, and the
difference is real characters in the 0x80–0x9F range.

The multi-byte sets that `TextDecoder` does not cover need generated tables.
`gbk` and `sjis` also have a security dimension — the classic
`addslashes()`/`SET NAMES` injection relies on a multi-byte lead byte swallowing
a backslash — so the parser must be charset-aware when scanning string literals.

## `mbminlen` / `mbmaxlen`

Every charset has a minimum and maximum bytes per character. These are not
trivia; they drive real behaviour:

- `VARCHAR(n)` reserves `n × mbmaxlen` bytes, which is why the 65535-byte row
  limit is hit at `VARCHAR(16383)` in `utf8mb4`.
- `CHAR(n)` with `mbmaxlen > 1` is stored **variable-length** in InnoDB
  (doc 24).
- Index prefix limits are in bytes, so `KEY (col(255))` on a `utf8mb4` column
  needs 1020 bytes of key.
- Whether a length-prefixed `VARCHAR` uses one byte or two
  (`DATA_LONG_TRUE_VARCHAR`) depends on `n × mbmaxlen`.

## `sql_mode` interactions

Two `sql_mode` flags change string behaviour directly and must be threaded
through the parser and the executor:

- `NO_BACKSLASH_ESCAPES` — backslash is an ordinary character in string
  literals. It is also reported in the connection status flags
  (`SERVER_STATUS_NO_BACKSLASH_ESCAPES`, doc 10) so clients can adjust their
  escaping, which means the *server* must set it correctly or clients will
  produce broken SQL.
- `ANSI_QUOTES` — `"` becomes an identifier quote rather than a string quote.

## Priorities

For a first working engine:

1. `binary` and `utf8mb4_bin` — enough to build and test the entire B+tree,
   because ordering is `memcmp`.
2. `utf8mb4_general_ci` — a small table, and it covers a lot of legacy schemas.
3. `utf8mb4_0900_ai_ci` — required in practice, since it is the 8.0 default.
4. `latin1_swedish_ci` — for old dumps.
5. Everything else, on demand.

Generate all of these from MySQL's own source tables in `strings/`, with a
build script that is re-runnable against a newer MySQL, and check the generated
tables in with a hash of their source so drift is detectable.
