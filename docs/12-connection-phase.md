# 12 — The connection phase

> Sources: `@page page_protocol_connection_phase*` in
> `sql/auth/sql_authentication.cc`; `include/mysql_com.h` for the flags.

## Sequence

```
   client                                            server
     │                                                  │
     │◀───────────── seq 0: HandshakeV10 ───────────────│
     │                                                  │
     │──── seq 1: SSLRequest (32 bytes, optional) ─────▶│
     │◀════════════ TLS handshake ═════════════════════▶│
     │                                                  │
     │──── seq 1 or 2: HandshakeResponse41 ────────────▶│
     │                                                  │
     │◀──── seq n: AuthSwitchRequest / AuthMoreData ────│   (doc 13)
     │───── seq n+1: AuthSwitchResponse ───────────────▶│   ⟳ as needed
     │                                                  │
     │◀────── seq n: OK_Packet | ERR_Packet ────────────│
     ▼                                                  ▼
                       command phase (seq resets to 0)
```

The sequence id runs continuously across this whole exchange; it only resets
when the command phase begins. When TLS is used, `SSLRequest` is sent in the
clear as sequence 1, and `HandshakeResponse41` — sent *inside* TLS — continues
at sequence 2.

## Capability flags

The negotiation is a plain bitwise AND: the server advertises what it supports,
the client replies with what it wants, and the effective capability set is the
intersection. `mysql_com.h`:

| Bit | Flag | Meaning · relevance to us |
|---|---|---|
| `0x00000001` | `CLIENT_LONG_PASSWORD` | Historic. **MariaDB overloads its absence** — a MariaDB server leaves this clear and repurposes 4 reserved handshake bytes for extended capabilities. |
| `0x00000002` | `CLIENT_FOUND_ROWS` | `affected_rows` reports matched rather than changed rows |
| `0x00000004` | `CLIENT_LONG_FLAG` | send all column flags |
| `0x00000008` | `CLIENT_CONNECT_WITH_DB` | initial schema in the handshake response |
| `0x00000010` | `CLIENT_NO_SCHEMA` | historic |
| `0x00000020` | `CLIENT_COMPRESS` | zlib compression (doc 17) |
| `0x00000040` | `CLIENT_ODBC` | historic |
| `0x00000080` | `CLIENT_LOCAL_FILES` | permit `LOAD DATA LOCAL INFILE` (doc 17) |
| `0x00000100` | `CLIENT_IGNORE_SPACE` | allow space before `(` in function calls |
| `0x00000200` | `CLIENT_PROTOCOL_41` | **always set in practice**; gates most packet layouts |
| `0x00000400` | `CLIENT_INTERACTIVE` | use `interactive_timeout` |
| `0x00000800` | `CLIENT_SSL` | upgrade to TLS |
| `0x00001000` | `CLIENT_IGNORE_SIGPIPE` | client-local |
| `0x00002000` | `CLIENT_TRANSACTIONS` | status flags in OK/EOF |
| `0x00004000` | `CLIENT_RESERVED` | old 4.1 flag |
| `0x00008000` | `CLIENT_RESERVED2` | was `CLIENT_SECURE_CONNECTION`; removed in 8.0 but still set by clients |
| `0x00010000` | `CLIENT_MULTI_STATEMENTS` | `;`-separated statements in one `COM_QUERY` |
| `0x00020000` | `CLIENT_MULTI_RESULTS` | multiple resultsets in a response |
| `0x00040000` | `CLIENT_PS_MULTI_RESULTS` | ditto for prepared statements |
| `0x00080000` | `CLIENT_PLUGIN_AUTH` | pluggable authentication — **required** for `caching_sha2_password` |
| `0x00100000` | `CLIENT_CONNECT_ATTRS` | key/value connection attributes |
| `0x00200000` | `CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA` | auth response is length-encoded rather than `int<1>`-prefixed |
| `0x00400000` | `CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS` | sandbox mode instead of an error (doc 13) |
| `0x00800000` | `CLIENT_SESSION_TRACK` | session state changes in OK packets (doc 17) |
| `0x01000000` | `CLIENT_DEPRECATE_EOF` | **OK packets replace EOF packets**; changes resultset parsing |
| `0x02000000` | `CLIENT_OPTIONAL_RESULTSET_METADATA` | metadata may be omitted (doc 15) |
| `0x04000000` | `CLIENT_ZSTD_COMPRESSION_ALGORITHM` | zstd instead of zlib (doc 17) |
| `0x08000000` | `CLIENT_QUERY_ATTRIBUTES` | named attributes on `COM_QUERY`/`COM_STMT_EXECUTE` (doc 17) |
| `0x10000000` | `MULTI_FACTOR_AUTHENTICATION` | 2FA/3FA factors (doc 13) |
| `0x20000000` | `CLIENT_CAPABILITY_EXTENSION` | reserved for a future 64-bit extension |
| `0x40000000` | `CLIENT_SSL_VERIFY_SERVER_CERT` | client-local |
| `0x80000000` | `CLIENT_REMEMBER_OPTIONS` | client-local |

**What our server should advertise.** A minimal, honest set:

```
PROTOCOL_41 | LONG_PASSWORD | LONG_FLAG | CONNECT_WITH_DB | TRANSACTIONS
| SECURE_CONNECTION(0x8000) | PLUGIN_AUTH | PLUGIN_AUTH_LENENC_CLIENT_DATA
| CONNECT_ATTRS | SESSION_TRACK | DEPRECATE_EOF | MULTI_STATEMENTS
| MULTI_RESULTS | PS_MULTI_RESULTS | QUERY_ATTRIBUTES | LOCAL_FILES | FOUND_ROWS
```

Advertise `CLIENT_LONG_PASSWORD` so that MariaDB-aware clients treat us as a
MySQL server and do not try to read MariaDB extended capabilities out of the
reserved bytes. Do **not** advertise `CLIENT_SSL` in-process — there is no
socket to secure — but do advertise it when running over a real TCP listener
with TLS configured. Do **not** advertise `CLIENT_COMPRESS` in-process; it costs
CPU to compress a memcpy.

## Protocol::HandshakeV10 (server → client, sequence 0)

```
int<1>       protocol_version           always 10
string<NUL>  server_version             e.g. "8.4.0-myjs"
int<4>       thread_id / connection id
string[8]    auth_plugin_data_part_1    first 8 bytes of the 20-byte scramble
int<1>       filler                     0x00
int<2>       capability_flags_lower
int<1>       character_set              default collation id, low byte only
int<2>       status_flags
int<2>       capability_flags_upper
if CLIENT_PLUGIN_AUTH:
  int<1>     auth_plugin_data_len       21 for a 20-byte scramble (+ NUL)
else:
  int<1>     0x00
string[10]   reserved                   all zero
string[$len] auth_plugin_data_part_2    $len = max(13, auth_plugin_data_len - 8)
if CLIENT_PLUGIN_AUTH:
  string<NUL> auth_plugin_name          e.g. "caching_sha2_password"
```

Details that matter:

- The scramble is 20 random bytes, split 8 + 12, with a **trailing NUL** — hence
  `auth_plugin_data_len = 21` and a 13-byte part 2. `mysql2` writes exactly
  this: 12 bytes then `0x00`.
- `character_set` is only the *low byte* of the collation id, so ids above 255
  (`utf8mb4_0900_ai_ci` = 255 fits; `utf8mb4_0900_as_cs` = 278 does not) cannot
  be expressed here. Servers advertise a low-numbered default and the client
  sets the real one afterwards with `SET NAMES`.
- **MariaDB detection**: MariaDB 10.2+ leaves `CLIENT_LONG_PASSWORD` clear and
  uses the last 4 of the `reserved` bytes for `MARIADB_CLIENT_*` capabilities.
  `mysql2`'s `handshake.js` branches on exactly this. Our server sets
  `CLIENT_LONG_PASSWORD` and zeroes the reserved bytes.
- **Version-string sniffing is real.** Clients and ORMs parse `server_version`
  to enable features. Reporting something like `8.4.0-myjs-0.1.0` puts us in the
  "modern MySQL" bucket while staying honest. Reporting a MariaDB-shaped version
  (`5.5.5-10.x`) would change client behaviour in ways we do not want.

## Protocol::SSLRequest (client → server, optional)

The first 32 bytes of `HandshakeResponse41` and nothing else: `client_flag`
(int4), `max_packet_size` (int4), `character_set` (int1), 23 filler bytes. It
tells the server "upgrade now"; the real handshake response follows inside TLS.

## Protocol::HandshakeResponse41 (client → server)

```
int<4>       client_flag                CLIENT_PROTOCOL_41 always set
int<4>       max_packet_size
int<1>       character_set
string[23]   filler                     all zero
string<NUL>  username
if CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA:
  string<lenenc> auth_response
else:
  int<1>     auth_response_length
  string[n]  auth_response
if CLIENT_CONNECT_WITH_DB:
  string<NUL> database
if CLIENT_PLUGIN_AUTH:
  string<NUL> client_plugin_name        UTF-8
if CLIENT_CONNECT_ATTRS:
  int<lenenc>  total length of all key/value bytes
  ( string<lenenc> key, string<lenenc> value ) *
if CLIENT_ZSTD_COMPRESSION_ALGORITHM:
  int<1>     zstd_compression_level
```

Server-side parsing notes:

- Honour `CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA`. Without it the auth response
  is capped at 255 bytes, which is fine for the 20-byte native scramble and the
  32-byte SHA-2 digest but not for an RSA-encrypted password.
- **Multibyte connection charsets (UCS2/UTF16/UTF32) are not supported here** —
  the specification says so explicitly, because the NUL-terminated fields would
  be ambiguous. Reject them.
- Connection attributes are advisory metadata (`_os`, `_client_name`, `_pid`,
  `_client_version`, `_platform`, plus user keys). Store them; surface them in
  `performance_schema.session_connect_attrs`. Cap the total size and the count —
  this is unauthenticated attacker-controlled input.
- `max_packet_size` is what the *client* will accept from us. Respect it when
  splitting large resultset rows.

## After the handshake response

The server either completes authentication (doc 13) or sends an
`AuthSwitchRequest`. On success: `OK_Packet`. On failure: `ERR_Packet` — and by
convention error `1045 (28000) Access denied for user ...`, with no distinction
between "no such user" and "wrong password".

## Reconnection commands

Two command-phase packets re-enter this state machine:

- **`COM_CHANGE_USER`** — full re-authentication on an existing connection,
  including the auth-switch dance. Resets session state: temporary tables,
  user variables, prepared statements, transaction.
- **`COM_RESET_CONNECTION`** — resets session state *without* re-authenticating.
  Much cheaper; this is what connection pools use. Responds with a single OK.

Both must reset our session object to exactly the post-connect state, or pooled
connections will leak state between logical users. This is a correctness *and* a
security boundary.
