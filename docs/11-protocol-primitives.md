# 11 — Protocol primitives: the byte grammar

> Source: `@page page_protocol_basic_data_types` in `sql/protocol_classic.cc`.

Everything in the protocol is built from six primitives. Get these exactly right
once, in `@myjs/bytes`, and every packet becomes a few lines.

## Integers

### Fixed-length, little-endian, unsigned

`int<1>`, `int<2>`, `int<3>`, `int<4>`, `int<6>`, `int<8>`.

Note `int<3>` and `int<6>` — MySQL genuinely uses 3- and 6-byte integers
(`payload_length` is `int<3>`; `int<6>` appears in binlog contexts). Any reader
built on `DataView` alone needs explicit helpers for these.

```js
// int<3>
const v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)

// int<8> — must be BigInt; affected_rows and last_insert_id can exceed 2^53
const v = dv.getBigUint64(o, true)
```

`int<8>` values (`affected_rows`, `last_insert_id`, statement ids in some
contexts) can exceed `Number.MAX_SAFE_INTEGER`. Decide the policy once: we
return `BigInt` when the value does not fit exactly in a `Number`, matching
`mysql2`'s `supportBigNumbers` behaviour, and always `BigInt` from the low-level
reader.

### Length-encoded integer (`int<lenenc>`)

The single most important primitive. 1, 3, 4 or 9 bytes:

| First byte | Total bytes | Value |
|---|---|---|
| `0x00`–`0xFA` | 1 | the byte itself (0–250) |
| `0xFB` | 1 | **NULL** — only valid in a text resultset row |
| `0xFC` | 3 | `int<2>` follows |
| `0xFD` | 4 | `int<3>` follows |
| `0xFE` | 9 | `int<8>` follows |
| `0xFF` | — | never valid here (it is the ERR packet header) |

Two traps, both of which have bitten real drivers:

- **`0xFB` is NULL, not a length.** It is only meaningful as a column value in a
  text resultset row. Anywhere else it is a malformed packet. A generic
  `readLenEncInt` that returns `251` for `0xFB` will silently corrupt data.
- **`0xFE` is ambiguous with the EOF packet header.** If `0xFE` appears as the
  *first byte of a packet*, you must check the packet length: fewer than 9 bytes
  of payload means it is an EOF/OK-as-EOF packet, not a 9-byte length-encoded
  integer. The MySQL docs flag this explicitly.

```js
function readLenEncInt(r) {
  const first = r.u8()
  if (first < 0xfb) return BigInt(first)
  if (first === 0xfb) return null          // NULL, caller must expect it
  if (first === 0xfc) return BigInt(r.u16())
  if (first === 0xfd) return BigInt(r.u24())
  if (first === 0xfe) return r.u64()
  throw new ProtocolError('invalid length-encoded integer prefix 0xff')
}
```

Writers must use the **shortest** encoding — real clients are tolerant, but
byte-for-byte comparison against captured traces (doc 43) is only possible if we
are canonical.

## Strings

| Form | Encoding |
|---|---|
| `string<fix>` / `string[n]` | exactly *n* bytes, no terminator (e.g. the 5-byte SQL state) |
| `string<NUL>` | NUL-terminated |
| `string<lenenc>` | `int<lenenc>` length, then that many bytes |
| `string<var>` | length comes from elsewhere in the packet |
| `string<EOF>` | runs to the end of the packet payload |

`string<EOF>` is why the framer must hand parsers an exact payload slice: the
"end" is the end of the *reassembled* payload, and getting the 16 MiB
continuation wrong turns an error message into a buffer overrun.

### Which character set?

Strings are bytes; the encoding depends on where they appear:

- **Identifiers and error messages**: the connection's `character_set_results`.
- **Column values in a text resultset**: the column's own charset, from the
  column definition packet (doc 15) — *not* the connection charset.
- **The server version string** in `HandshakeV10`: MySQL writes it as CESU-8
  (`mysql2` decodes it with a `cesu8` codec). In practice it is ASCII.
- **`client_plugin_name`**: UTF-8, per the specification.
- **Connection attributes**: the connection charset.

Never assume UTF-8 globally. The type layer must carry the charset id alongside
the bytes; see [29-charsets-and-collations.md](./29-charsets-and-collations.md).

## Bitmaps

Used for NULL flags in the binary protocol (docs 15, 16):

```
bytes = floor((n + 7 + offset) / 8)
byte  = (i + offset) >> 3
bit   = (i + offset) & 7
```

`offset` is **2** for a binary *resultset row* (the low two bits are reserved)
and **0** for `COM_STMT_EXECUTE` parameters. This asymmetry is documented but
easy to miss, and it is a common interop bug.

## A reader/writer contract worth fixing early

```js
class Reader {
  constructor(bytes /* Uint8Array */, start = 0, end = bytes.length)
  get remaining()          // bytes left; every read checks against it
  u8() u16() u24() u32() u48() u64()      // little-endian, u64 → BigInt
  i8() i16() i32() i64()
  f32() f64()
  bytes(n)                 // subarray, zero-copy
  lenEncInt()              // BigInt | null
  lenEncBytes()            // Uint8Array | null
  nulString()              // Uint8Array up to NUL, consumes the NUL
  restBytes()              // to end of payload
  skip(n)
}
```

Rules that keep this safe and fast:

1. **Zero-copy reads.** `bytes()` returns a `subarray`, never a copy. Decoding to
   a JS string is a separate, deferred step — `mysql2` defers even column
   metadata strings for exactly this reason.
2. **Bounds-check every read.** One check per read, throwing a typed
   `ProtocolError`. This is the entire attack surface for a malicious peer.
3. **No `Buffer`.** `Uint8Array` + `DataView` only, so the module runs unchanged
   in the browser ([03](./03-architecture.md)).
4. **The writer grows geometrically** and emits the 4-byte header last, once the
   payload length is known — or, better, reserves the header and backfills, so a
   large resultset is written in one pass.
