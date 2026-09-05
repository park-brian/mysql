# 10 — The MySQL client/server protocol: overview

> Sources: `sql/protocol_classic.cc`, `sql-common/net_serv.cc`,
> `sql/auth/sql_authentication.cc` (the protocol reference is written as Doxygen
> `@page page_protocol_*` blocks inside those files), `include/mysql_com.h`,
> `include/my_command.h`, `include/field_types.h`. Cross-checked against two
> independent implementations: `node-mysql2` and `mariadb-connector-nodejs`.

This is the *classic* protocol — the one on port 3306, spoken by every
JavaScript driver. MySQL also has the X Protocol (port 33060, protobuf); it is
out of scope ([00](./00-goals-and-scope.md)).

## Why this is the highest-leverage thing to implement

The protocol is small, completely specified, and stable. Implementing the server
side of it buys the entire client ecosystem — `mysql2`, `mariadb`, Prisma,
Drizzle, Sequelize, TypeORM, Knex, and the `mysql` CLI — with no per-driver
work. It is also self-verifying: those drivers become the conformance suite.

## The connection as a state machine

```
                    ┌──────────────────────────┐
   TCP/stream open   │   CONNECTION PHASE       │
   ────────────────▶ │                          │
                     │  S→C  HandshakeV10       │
                     │  C→S  [SSLRequest]       │  ─┐ optional TLS upgrade,
                     │        ↕ TLS handshake   │   │ then everything below
                     │  C→S  HandshakeResponse41│  ─┘ is inside TLS
                     │  ⟳    auth exchange       │  (doc 13)
                     │  S→C  OK | ERR | AuthNextFactor
                     └────────────┬─────────────┘
                                  │ OK
                     ┌────────────▼─────────────┐
                     │   COMMAND PHASE          │   loop, one command at a time
                     │                          │
                     │  C→S  COM_xxx  (seq = 0) │
                     │  S→C  response (seq 1..) │
                     └────────────┬─────────────┘
                                  │ COM_QUIT / error / socket close
                                  ▼
                              disconnected
```

Two properties define everything:

- **It is strictly request/response and half-duplex.** The client sends one
  command; the server replies; only then may the client send again. There is no
  pipelining and no request id — correlation is purely positional. (The
  exceptions are the server-initiated pushes inside `COM_BINLOG_DUMP` and the
  `LOCAL INFILE` sub-dialogue, both of which are still driven by one command.)
- **The layout of nearly every packet depends on the negotiated capability
  flags.** You cannot parse the protocol without first tracking the intersection
  of client and server capabilities. This is the number-one source of bugs in
  third-party implementations.

## Packet framing

Every packet — in both directions, in both phases — is:

```
 0        1        2        3        4                        4+len
 ├────────┴────────┴────────┼────────┼──────────────────────────┤
 │   payload_length  (int3) │seq (i1)│        payload           │
 └──────────────────────────┴────────┴──────────────────────────┘
   little-endian, max 0xFFFFFF
```

`payload_length` counts only the payload, not the 4-byte header. All multi-byte
integers in the protocol are **little-endian** unless stated otherwise.

### Payloads larger than 16 MiB

If a logical message is ≥ 2²⁴−1 bytes, it is split: each chunk carries
`payload_length = 0xFFFFFF`, and the message ends with a chunk whose length is
*less than* `0xFFFFFF`.

The consequence people get wrong: **a message of exactly 16777215 bytes must be
followed by an empty packet.** Encoding a 16777215-byte payload looks like

```
ff ff ff 00  <16777215 bytes>
00 00 00 01
```

A reader that stops at the first `0xFFFFFF` chunk without checking for the
terminator will desynchronise on exactly this boundary. `max_allowed_packet`
(server side) caps the reassembled size.

### Sequence ids

`sequence_id` starts at **0** and increments per packet sent, wrapping at 256.

- It **resets to 0** at the start of each new command in the command phase. The
  client's `COM_*` packet is always sequence 0; the server's first response
  packet is 1.
- It does **not** reset during the connection phase — it runs continuously from
  the server's `HandshakeV10` (which is sequence 0) through the whole auth
  exchange.
- Each side validates that the received sequence is the expected one; a mismatch
  is a protocol error (`ER_NET_PACKETS_OUT_OF_ORDER`). Getting this wrong is the
  classic symptom of a half-implemented auth switch.
- When compression is enabled, the compressed envelope has its **own,
  independent** sequence counter (doc 17).

## Generic response packets

After a command, the first byte of the server's first packet almost always
tells you what kind of response this is:

| First byte | Meaning | Caveat |
|---|---|---|
| `0x00` | **OK_Packet** | only if payload length ≥ 7 |
| `0xFF` | **ERR_Packet** | always |
| `0xFE` | **EOF_Packet** | only if payload length < 9 |
| `0xFE` | OK packet marking end-of-resultset | when `CLIENT_DEPRECATE_EOF` is on |
| `0xFB` | `LOCAL INFILE` request | only as the first byte of a `COM_QUERY` response |
| other | length-encoded column count, i.e. a resultset follows | |

The `0xFE` ambiguity is real and must be resolved by length, not by byte value —
`0xFE` is also the 8-byte prefix of a length-encoded integer. See
[11-protocol-primitives.md](./11-protocol-primitives.md).

### OK_Packet

```
int<1>       header                 0x00, or 0xFE when it stands in for EOF
int<lenenc>  affected_rows
int<lenenc>  last_insert_id
if CLIENT_PROTOCOL_41:
  int<2>     status_flags           SERVER_STATUS_*
  int<2>     warnings
elif CLIENT_TRANSACTIONS:
  int<2>     status_flags
if CLIENT_SESSION_TRACK:
  if (status_flags & SERVER_SESSION_STATE_CHANGED) or info is non-empty:
    string<lenenc>  info
  if status_flags & SERVER_SESSION_STATE_CHANGED:
    string<lenenc>  session_state_changes     # see doc 17
else:
  string<EOF>  info
```

Minimal OK (0 rows, 0 insert id, autocommit, 0 warnings) is 7 payload bytes:

```
07 00 00 02  00 00 00 02 00 00 00
└ header ─┘  └───── payload ─────┘
```

### ERR_Packet

```
int<1>       header            0xFF
int<2>       error_code
if CLIENT_PROTOCOL_41:
  string[1]  sql_state_marker  always '#'
  string[5]  sql_state         e.g. "42S02"
string<EOF>  error_message     never exceeds MYSQL_ERRMSG_SIZE
```

```
17 00 00 01  ff 48 04 23 48 59 30 30 30 4e 6f 20 74 61 62 6c 65 73 20 75 73 65 64
             ff |1096 | # | H Y 0 0 0 |"No tables used"
```

During the *connection* phase, a client that has not yet negotiated
`CLIENT_PROTOCOL_41` must be sent an ERR without the SQL-state fields.

### EOF_Packet (deprecated since 5.7.5)

```
int<1>   header      0xFE
if CLIENT_PROTOCOL_41:
  int<2> warnings
  int<2> status_flags
```

Modern clients advertise `CLIENT_DEPRECATE_EOF`, and then the server sends an
**OK packet with header `0xFE`** in every place an EOF used to appear
(end of column definitions, end of rows). A server implementation must honour
the flag in both directions or drivers will misparse resultsets.

## Status flags

`SERVER_STATUS_*`, sent in OK/EOF packets (`include/mysql_com.h`):

| Value | Name | Meaning |
|---|---|---|
| `0x0001` | `SERVER_STATUS_IN_TRANS` | a multi-statement transaction is open |
| `0x0002` | `SERVER_STATUS_AUTOCOMMIT` | autocommit is on |
| `0x0008` | `SERVER_MORE_RESULTS_EXISTS` | another resultset follows |
| `0x0010` | `SERVER_QUERY_NO_GOOD_INDEX_USED` | |
| `0x0020` | `SERVER_QUERY_NO_INDEX_USED` | |
| `0x0040` | `SERVER_STATUS_CURSOR_EXISTS` | a read-only cursor was opened |
| `0x0080` | `SERVER_STATUS_LAST_ROW_SENT` | cursor exhausted |
| `0x0100` | `SERVER_STATUS_DB_DROPPED` | |
| `0x0200` | `SERVER_STATUS_NO_BACKSLASH_ESCAPES` | affects string literal parsing |
| `0x0400` | `SERVER_STATUS_METADATA_CHANGED` | a re-prepared statement changed shape |
| `0x0800` | `SERVER_QUERY_WAS_SLOW` | |
| `0x1000` | `SERVER_PS_OUT_PARAMS` | this resultset carries OUT parameters |
| `0x2000` | `SERVER_STATUS_IN_TRANS_READONLY` | |
| `0x4000` | `SERVER_SESSION_STATE_CHANGED` | session-tracking data present in this OK |

`SERVER_MORE_RESULTS_EXISTS` and `SERVER_SESSION_STATE_CHANGED` are the two that
change how the *next* bytes are parsed, so they must be threaded through the
reader correctly.

## Implementation notes for our server side

1. **Model the negotiated capabilities as an immutable value** computed once at
   the end of the connection phase (`client_caps & server_caps`), and pass it to
   every reader and writer. Do not consult mutable connection state.
2. **Frame first, parse second.** A `PacketReader` that yields complete
   reassembled payloads (handling the 16 MiB split and sequence validation)
   keeps every packet parser trivial and independently fuzzable.
3. **Never trust lengths.** Every length-encoded value must be bounds-checked
   against the remaining payload; this is where a malformed client would
   otherwise walk off the end of a buffer.
4. **Sequence ids belong to the framer**, not to the packet types. `mysql2` gets
   this right (`connection.js` owns the counter, packets are written with a
   placeholder) and it is worth copying.
