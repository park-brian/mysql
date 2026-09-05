# 28 — The binary JSON format

> Source: `sql-common/json_binary.h` — the grammar below is transcribed from the
> `@verbatim` block in that header. Implementation in
> `sql-common/json_binary.cc`.

MySQL's `JSON` type does not store text. It stores a binary representation
designed so that a path lookup (`col->'$.a.b'`) is O(log n) rather than a
re-parse, and so that a sub-document can be replaced in place.

This format appears in three places — `.ibd` files, binlog row images, and
`JSON_*` function internals — so it is worth implementing once, carefully.

## Grammar

```
doc ::= type value

type ::=
    0x00 |   // small JSON object
    0x01 |   // large JSON object
    0x02 |   // small JSON array
    0x03 |   // large JSON array
    0x04 |   // literal (true/false/null)
    0x05 |   // int16
    0x06 |   // uint16
    0x07 |   // int32
    0x08 |   // uint32
    0x09 |   // int64
    0x0a |   // uint64
    0x0b |   // double
    0x0c |   // utf8mb4 string
    0x0f     // custom data (any MySQL data type)

object ::= element-count size key-entry* value-entry* key* value*
array  ::= element-count size value-entry* value*

element-count ::= uint16   (small)  | uint32 (large)
size          ::= uint16   (small)  | uint32 (large)

key-entry   ::= key-offset key-length
key-offset  ::= uint16 (small) | uint32 (large)
key-length  ::= uint16                     // keys must be < 64 KB

value-entry ::= type offset-or-inlined-value
offset-or-inlined-value ::= uint16 (small) | uint32 (large)

key ::= utf8mb4-data

literal ::= 0x00 (null) | 0x01 (true) | 0x02 (false)

number ::= little-endian [u]int(16|32|64); double via float8store

string ::= data-length utf8mb4-data

custom-data ::= custom-type data-length binary-data
custom-type ::= uint8       // an enum_field_types value

data-length ::= uint8*      // 7 bits per byte, high bit = continuation
```

## The parts that matter

**Small vs large.** Every object and array exists in two forms. "Small" uses
16-bit counts and offsets and is used when the whole value fits in 64 KiB;
"large" uses 32-bit. The type byte tells you which, and it changes the width of
*every* offset in that container. A single container can be small while a nested
one inside it is large.

**`size` is the whole container's byte length**, which is what lets a reader skip
a sub-document without parsing it.

**Offsets are relative to the start of the container**, not the document.

**Inlining.** `offset-or-inlined-value` holds either an offset *or the value
itself*, when the value is small enough to fit: literals (`null`, `true`,
`false`) and small integers are stored directly in the entry. This is a
significant space win for arrays of small numbers and a common source of bugs in
third-party readers, which tend to treat every entry as an offset.

**Keys are sorted.** Object keys are stored in order — by length first, then
lexicographically by bytes — so lookup is a binary search. This is also why
`JSON_OBJECT('b',1,'a',2)` comes back with `a` first: MySQL is not preserving
your insertion order, it is storing the sorted form. Reproducing this ordering
exactly is required for output compatibility.

**The length varint** is 7 bits per byte with the high bit as a continuation
flag, little-endian order — the same scheme as Protocol Buffers. Lengths up to
127 take one byte, up to 16383 take two.

**`custom-data` (`0x0f`)** wraps a non-JSON MySQL value — a `DATE`, `TIME`,
`DATETIME`, `DECIMAL`, or an opaque blob — with its `enum_field_types` code and
the value in that type's *storage* encoding ([24](./24-column-encodings.md)).
This is how `CAST(NOW() AS JSON)` round-trips a temporal without turning it into
a string, and it is why the JSON codec depends on the column codec.

## Reader sketch

```js
function parseJson(buf, off = 0) {
  return parseValue(buf, buf[off], off + 1)
}

function parseValue(buf, type, off) {
  const dv = new DataView(buf.buffer, buf.byteOffset)
  switch (type) {
    case 0x00: return parseObject(buf, off, false)
    case 0x01: return parseObject(buf, off, true)
    case 0x02: return parseArray(buf, off, false)
    case 0x03: return parseArray(buf, off, true)
    case 0x04: return [null, true, false][buf[off]]
    case 0x05: return dv.getInt16(off, true)
    case 0x06: return dv.getUint16(off, true)
    case 0x07: return dv.getInt32(off, true)
    case 0x08: return dv.getUint32(off, true)
    case 0x09: return dv.getBigInt64(off, true)
    case 0x0a: return dv.getBigUint64(off, true)
    case 0x0b: return dv.getFloat64(off, true)
    case 0x0c: { const [len, n] = varint(buf, off)
                 return utf8.decode(buf.subarray(off + n, off + n + len)) }
    case 0x0f: { const fieldType = buf[off]
                 const [len, n] = varint(buf, off + 1)
                 return decodeStorageValue(fieldType,
                          buf.subarray(off + 1 + n, off + 1 + n + len)) }
    default: throw new Error(`bad JSON type 0x${type.toString(16)}`)
  }
}

function varint(buf, off) {
  let value = 0, shift = 0, n = 0
  for (;;) {
    const b = buf[off + n++]
    value |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) return [value, n]
    shift += 7
  }
}
```

Container parsing must decide *inline vs offset* per entry, using the same rule
the writer used: literals and integers that fit in the entry width are inline.

## Partial updates

Since 8.0, `JSON_SET`/`JSON_REPLACE`/`JSON_REMOVE` can modify a document **in
place** when the replacement fits in the existing space, and the change is
logged as a `PARTIAL_UPDATE_ROWS_EVENT` (doc 18) carrying only the diff. This
is what keeps updating one field of a 1 MB document from rewriting 1 MB, and it
is the reason the format stores explicit sizes everywhere.

## Should we use this format?

**Yes, for `JSON` columns.** Three good reasons:

1. It is genuinely well designed — O(log n) key lookup, skip-without-parse, and
   partial update all fall out of it.
2. Binlog and `.ibd` compatibility come free.
3. Writing a second format would mean writing a second codec for the same
   values anyway.

The one caveat: **key ordering is observable**. `JSON_KEYS()` and the text
rendering of a JSON value both reflect the stored order, so matching MySQL's
sort (length, then bytes) is required, not optional.
