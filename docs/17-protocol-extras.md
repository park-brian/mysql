# 17 — Protocol extras: compression, TLS, LOCAL INFILE, session tracking, query attributes

> Sources: `@page page_protocol_basic_compression*` in `sql-common/net_serv.cc`,
> `@page page_protocol_basic_tls` in `vio/viossl.cc`,
> `@page page_protocol_com_query_response_local_infile_*` and
> `@page page_protocol_basic_ok_packet` in `sql/protocol_classic.cc`.

Everything here is optional, negotiated by a capability flag. For an in-process
engine most of it should be *declined*; but all of it must be **understood**,
because a client that negotiates a feature we then get wrong is worse than one
that never had the option.

## Compression (`CLIENT_COMPRESS`, `CLIENT_ZSTD_COMPRESSION_ALGORITHM`)

When enabled, an extra framing layer wraps the ordinary packet stream:

```
int<3>   length of compressed payload   (this envelope's length, minus its 7-byte header)
int<1>   compressed sequence id          independent counter from the inner one
int<3>   length of uncompressed payload  0 means "the payload is NOT compressed"
binary   payload                         zlib deflate, zstd, or raw
```

Key properties:

- **Two independent sequence counters.** The compressed envelope has its own,
  reset on the same events as the inner one but incremented separately. Reusing
  one counter for both is the classic bug here.
- **`uncompressed_length == 0` means the payload is stored raw.** Senders use
  this for small packets where compression would grow them. A reader that always
  calls `inflate` will fail on exactly these.
- **The envelope boundary is unrelated to the packet boundary.** One compressed
  envelope may carry a fragment of a MySQL packet, or several whole packets. The
  decompressor must feed a byte stream to the packet framer, not try to align
  them.
- zlib is `CLIENT_COMPRESS`; zstd is `CLIENT_ZSTD_COMPRESSION_ALGORITHM`, with
  the level sent as `int<1>` at the end of `HandshakeResponse41`.

**Our position**: never advertise compression in-process — it is pure cost on a
memory-to-memory transfer. Advertise zlib on the Node TCP path if a remote
client asks; browsers have `DecompressionStream('deflate')` natively, so even
the browser bridge can support it without a dependency.

## TLS (`CLIENT_SSL`)

The client sends a 32-byte `SSLRequest` (the head of `HandshakeResponse41`) in
the clear, both sides run a TLS handshake, and everything afterwards — including
the real handshake response — is inside TLS. Sequence numbering continues
across the upgrade.

**Our position**: not applicable in-process (there is no channel to secure). On
the Node listener, use `node:tls` and honour the flag. For the browser
WebSocket bridge, `wss://` provides transport security at a lower layer, so
`CLIENT_SSL` stays off and the connection is reported as secure to the auth
layer.

## `LOAD DATA LOCAL INFILE` (`CLIENT_LOCAL_FILES`)

A rare inversion: the server asks the *client* for data.

```
C→S  COM_QUERY  "LOAD DATA LOCAL INFILE 'x.csv' INTO TABLE t"
S→C  0xFB + filename                    ← the LOCAL INFILE request
C→S  file contents  (one or more packets)
C→S  empty packet                       ← end of file
S→C  OK
```

The specification's own example is `0xFB` followed by `/etc/passwd`, which is
not an accident — **this is a well-known attack**. A malicious or compromised
server can request *any* path, and a client that honours it will upload the
file. This is why `local_infile` defaults to off in `mysql2`, and why clients
that enable it should whitelist paths.

Consequences for us:

- **As a server**, only ever request a filename the client's own SQL statement
  named. Never derive it from anything else.
- **In the browser**, there is no filesystem to read, so `LOCAL INFILE` must be
  wired to an explicit `File`/`Blob` the application supplies. `mysql2` already
  models this via a `infileStreamFactory` callback; we should expose the same
  shape.
- The terminating **empty packet is mandatory**. A client that sends data and
  then a `COM_QUERY` without the empty packet leaves the server waiting.
- Server-side `LOAD DATA INFILE` (without `LOCAL`) reads from the server's own
  filesystem. For us that means the VFS, which in a browser means OPFS — a
  sensible and safe thing to support.

## Session tracking (`CLIENT_SESSION_TRACK`)

When the flag is negotiated and `SERVER_SESSION_STATE_CHANGED` (`0x4000`) is set
in an OK packet's status flags, the OK carries a trailing
`string<lenenc>` block of state-change records:

```
int<1>          type       enum_session_state_type
string<lenenc>  data
```

| Type | Name | `data` payload |
|---|---|---|
| 0 | `SESSION_TRACK_SYSTEM_VARIABLES` | `string<lenenc>` name, `string<lenenc>` value |
| 1 | `SESSION_TRACK_SCHEMA` | `string<lenenc>` new schema name |
| 2 | `SESSION_TRACK_STATE_CHANGE` | `string<lenenc>` — `"1"` (0x31) if tracking is on |
| 3 | `SESSION_TRACK_GTIDS` | GTID set |
| 4 | `SESSION_TRACK_TRANSACTION_CHARACTERISTICS` | the SQL to recreate the transaction |
| 5 | `SESSION_TRACK_TRANSACTION_STATE` | an 8-character state string |

Examples from the specification:

```
after SET autocommit = OFF :   00 <len> 0a "autocommit" 03 "OFF"
after USE test :               01 <len> 04 "test"
```

**Why we should implement this** rather than treating it as exotic: connection
pools use it to know when a connection is safe to hand back, and clients use
`SESSION_TRACK_SCHEMA` to keep `USE` in sync without an extra round trip.
Implementing tracking for `character_set_client`, `character_set_results`,
`autocommit`, `time_zone`, `sql_mode`, and the current schema is cheap and makes
pooled behaviour correct.

## Query attributes (`CLIENT_QUERY_ATTRIBUTES`, 8.0.23+)

Named key/value pairs attached to a statement, readable inside it via
`mysql_query_attribute_string()`. They ride along in `COM_QUERY` (doc 14) and
`COM_STMT_EXECUTE` (doc 16), encoded exactly like parameters with an added
`string<lenenc>` name.

They are how observability tooling propagates trace ids into the database. Cheap
to support — store them on the session, expose the accessor function — and
worth it.

## Optional resultset metadata (`CLIENT_OPTIONAL_RESULTSET_METADATA`)

When negotiated, a resultset begins with an `int<1>` flag
(`enum_resultset_metadata`: `RESULTSET_METADATA_NONE = 0`,
`RESULTSET_METADATA_FULL = 1`) and column definitions may be omitted entirely.

This is a real optimisation for repeated execution of a prepared statement — the
client already knows the shape. Implement the *parsing* of the flag from day one
(so we do not misread clients that negotiate it), and the omission itself later.

## `max_allowed_packet`

The server's limit on a reassembled packet; the client sends its own limit in
`HandshakeResponse41`. Exceeding either end's limit is a hard error
(`ER_NET_PACKET_TOO_LARGE`) and, on a real server, drops the connection.

For us this is primarily a **memory-safety control**: it bounds how much a
single client message can make us allocate. Default to MySQL's 64 MiB, make it
configurable, and enforce it during reassembly rather than after.

## A checklist for the extras

| Feature | In-process | Node TCP | Browser bridge |
|---|---|---|---|
| `CLIENT_COMPRESS` | no | optional (zlib) | optional (`DecompressionStream`) |
| `CLIENT_ZSTD_…` | no | optional | no |
| `CLIENT_SSL` | no | yes | no (`wss://` instead) |
| `LOCAL INFILE` | via callback | via callback | via `File`/`Blob` callback |
| Session tracking | **yes** | yes | yes |
| Query attributes | **yes** | yes | yes |
| Optional metadata | parse now, omit later | same | same |
