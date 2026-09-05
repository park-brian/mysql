# 14 — The command phase

> Sources: `include/my_command.h` (the `enum_server_command` values),
> `@page page_protocol_command_phase` and the per-command pages in
> `sql/protocol_classic.cc`.

Once authenticated, the connection loops: the client sends one packet whose
first byte is a command code (sequence id 0), the server replies with one or
more packets (sequence 1, 2, …), and the cycle repeats.

## Command codes

From `include/my_command.h`. Codes marked *removed* are refused by a modern
server; codes marked *deprecated* still work but should not be implemented in
new code.

| Code | Command | Status · what we do |
|---|---|---|
| `0x00` | `COM_SLEEP` | internal, never on the wire |
| `0x01` | `COM_QUIT` | **implement** — close the connection, no response |
| `0x02` | `COM_INIT_DB` | **implement** — `USE <db>`; OK or ERR |
| `0x03` | `COM_QUERY` | **implement** — the workhorse |
| `0x04` | `COM_FIELD_LIST` | deprecated; **implement minimally** — some old tools use it |
| `0x05` | `COM_CREATE_DB` | refused by MySQL; return ERR |
| `0x06` | `COM_DROP_DB` | refused by MySQL; return ERR |
| `0x07` | *was* `COM_REFRESH` | removed |
| `0x08` | *was* `COM_SHUTDOWN` | removed (use `SHUTDOWN` SQL) |
| `0x09` | `COM_STATISTICS` | **implement** — one human-readable `string<EOF>` |
| `0x0a` | *was* `COM_PROCESS_INFO` | removed |
| `0x0b` | `COM_CONNECT` | internal |
| `0x0c` | *was* `COM_PROCESS_KILL` | removed (use `KILL` SQL) |
| `0x0d` | `COM_DEBUG` | OK or ERR; trivial |
| `0x0e` | `COM_PING` | **implement** — OK. Every pool health-checks with this |
| `0x0f` | `COM_TIME` | refused |
| `0x10` | `COM_DELAYED_INSERT` | removed |
| `0x11` | `COM_CHANGE_USER` | **implement** — re-auth + full session reset (doc 12) |
| `0x12` | `COM_BINLOG_DUMP` | replication (doc 18) |
| `0x13` | `COM_TABLE_DUMP` | legacy replication |
| `0x14` | `COM_CONNECT_OUT` | internal |
| `0x15` | `COM_REGISTER_SLAVE` | replication |
| `0x16` | `COM_STMT_PREPARE` | **implement** (doc 16) |
| `0x17` | `COM_STMT_EXECUTE` | **implement** (doc 16) |
| `0x18` | `COM_STMT_SEND_LONG_DATA` | **implement** (doc 16) — no response packet |
| `0x19` | `COM_STMT_CLOSE` | **implement** — no response packet |
| `0x1a` | `COM_STMT_RESET` | **implement** — OK or ERR |
| `0x1b` | `COM_SET_OPTION` | **implement** — toggles `CLIENT_MULTI_STATEMENTS` |
| `0x1c` | `COM_STMT_FETCH` | **implement** — cursor fetch (doc 16) |
| `0x1d` | `COM_DAEMON` | removed |
| `0x1e` | `COM_BINLOG_DUMP_GTID` | replication (doc 18) |
| `0x1f` | `COM_RESET_CONNECTION` | **implement** — session reset, no re-auth. Pools rely on it |
| `0x20` | `COM_CLONE` | clone plugin; out of scope |
| `0x21` | `COM_SUBSCRIBE_GROUP_REPLICATION_STREAM` | out of scope |

Two commands have **no response at all** — `COM_STMT_SEND_LONG_DATA` and
`COM_STMT_CLOSE`. A server that helpfully sends an OK for them will
desynchronise every client. (`COM_QUIT` also has no response; the server just
closes.)

## `COM_QUERY`

```
int<1>       0x03
if CLIENT_QUERY_ATTRIBUTES:
  int<lenenc>  parameter_count
  int<lenenc>  parameter_set_count      # currently always 1
  if parameter_count > 0:
    binary       null_bitmap            # (parameter_count + 7) / 8, offset 0
    int<1>       new_params_bind_flag   # must be 1
    for each parameter:
      int<2>     type + flags           # MSB of the high byte = unsigned
      string<lenenc> parameter_name
    binary       parameter_values       # binary protocol values (doc 15)
string<EOF>  the SQL text
```

Without `CLIENT_QUERY_ATTRIBUTES` this is simply `0x03` followed by the query
text — which is why `COM_QUERY` is so often described as trivial. With the flag
(8.0.23+), named attributes precede the text, encoded exactly like prepared
statement parameters. Note the NULL bitmap here has **offset 0**, unlike a
binary resultset row.

### The response

The first byte of the first response packet decides:

| First byte | Response |
|---|---|
| `0x00` | OK — statement produced no resultset |
| `0xFF` | ERR |
| `0xFB` | `LOCAL INFILE` request (doc 17) |
| anything else | length-encoded column count → a **text resultset** follows |

### Text resultset

```
[ if CLIENT_OPTIONAL_RESULTSET_METADATA: int<1> metadata_follows ]
int<lenenc>  column_count
[ column_count × ColumnDefinition41 packets ]        # unless metadata skipped
[ EOF packet ]                                        # only if !DEPRECATE_EOF
row packet *                                          # zero or more
terminator:
   ERR                    if an error occurred while producing rows
   OK with header 0xFE    if CLIENT_DEPRECATE_EOF
   EOF                    otherwise
```

A **text resultset row** is just the column values back to back, each as
`string<lenenc>` — with the single byte `0xFB` standing for NULL. Every value,
including numbers and dates, is its SQL string rendering in the column's
character set. That is the whole format.

The ERR-instead-of-terminator case is worth handling deliberately: a query can
successfully produce metadata and then fail mid-scan (an evaluation error, a
deadlock). Our executor must be able to abandon a resultset in progress and emit
an ERR packet in the terminator position.

### Multiple resultsets

With `CLIENT_MULTI_STATEMENTS`, a single `COM_QUERY` may contain several
`;`-separated statements. Each produces its own complete response, and every
response except the last sets `SERVER_MORE_RESULTS_EXISTS` (`0x0008`) in its
terminating OK/EOF. The client keeps reading while that flag is set.

This is also how stored procedures return results, which is why
`CLIENT_MULTI_RESULTS` is negotiated separately from `CLIENT_MULTI_STATEMENTS`.

Security note: `CLIENT_MULTI_STATEMENTS` turns a SQL-injection point into
arbitrary statement execution. Most drivers default it off. Our server should
honour the negotiated flag and additionally expose an engine-level switch,
defaulting to off.

## `COM_INIT_DB`

`0x02` followed by the schema name (`string<EOF>`). Responds OK or ERR. With
`CLIENT_SESSION_TRACK`, the OK carries a `SESSION_TRACK_SCHEMA` block so the
client can update its notion of the current database without a round trip.

## `COM_PING`, `COM_STATISTICS`, `COM_DEBUG`

- `COM_PING` → OK. Implement it before anything else; connection pools call it
  constantly and a broken ping looks like a broken database.
- `COM_STATISTICS` → a bare `string<EOF>` (not an OK packet) in the shape
  `Uptime: 1234  Threads: 1  Questions: 5  ...`. Cheap to fake, occasionally
  parsed by monitoring tools.
- `COM_DEBUG` → OK (requires the `SUPER` privilege on a real server).

## `COM_FIELD_LIST` (deprecated)

`0x04`, `string<NUL>` table name, `string<EOF>` column wildcard. Responds with a
sequence of `ColumnDefinition41` packets terminated by EOF — **no column count
prefix**, which makes it the one resultset-shaped response that does not follow
the usual framing. Implement it for compatibility with old tooling and then
never think about it again.

## `COM_SET_OPTION`

`0x1b` plus `int<2>`: `0` enables `CLIENT_MULTI_STATEMENTS`, `1` disables it.
Responds with EOF (or OK under `DEPRECATE_EOF`). Note that it responds with an
*EOF-shaped* packet, not an OK — a quirk that has broken more than one client.

## Dispatch skeleton

```js
async function dispatch(session, payload) {
  const cmd = payload[0]
  switch (cmd) {
    case COM.QUIT:              return session.close()          // no response
    case COM.PING:              return session.writeOk()
    case COM.INIT_DB:           return session.useSchema(str(payload, 1))
    case COM.QUERY:             return runQuery(session, parseComQuery(session, payload))
    case COM.STMT_PREPARE:      return prepare(session, str(payload, 1))
    case COM.STMT_EXECUTE:      return execute(session, parseExecute(session, payload))
    case COM.STMT_SEND_LONG_DATA: return appendLongData(session, payload)   // no response
    case COM.STMT_CLOSE:        return closeStmt(session, payload)          // no response
    case COM.STMT_RESET:        return resetStmt(session, payload)
    case COM.STMT_FETCH:        return fetchCursor(session, payload)
    case COM.RESET_CONNECTION:  return session.resetState(), session.writeOk()
    case COM.CHANGE_USER:       return changeUser(session, payload)
    case COM.SET_OPTION:        return setOption(session, payload)
    case COM.FIELD_LIST:        return fieldList(session, payload)
    case COM.STATISTICS:        return session.writeRaw(statistics(session))
    default:
      return session.writeErr(ER_UNKNOWN_COM_ERROR, '08S01', 'Unknown command')
  }
}
```

The sequence-id reset belongs to the framer, which zeroes it whenever it hands a
command payload to this function.

## Error codes and SQL states

Errors carry both a MySQL error number and a 5-character SQLSTATE. Clients — and
ORMs especially — branch on these, so returning the *right* code matters more
than returning a good message.

| Code | SQLSTATE | Meaning |
|---|---|---|
| 1045 | 28000 | Access denied |
| 1046 | 3D000 | No database selected |
| 1049 | 42000 | Unknown database |
| 1050 | 42S01 | Table already exists |
| 1051 | 42S02 | Unknown table |
| 1054 | 42S22 | Unknown column |
| 1062 | 23000 | Duplicate entry for key |
| 1064 | 42000 | Syntax error |
| 1146 | 42S02 | Table doesn't exist |
| 1213 | 40001 | Deadlock; restart transaction |
| 1205 | HY000 | Lock wait timeout exceeded |
| 1264 | 22003 | Out of range value for column |
| 1292 | 22007 | Incorrect datetime value |
| 1364 | HY000 | Field has no default value |
| 1406 | 22001 | Data too long for column |
| 1451/1452 | 23000 | Foreign key constraint fails |

`share/messages_to_clients.txt` in the MySQL tree is the authoritative list;
generate our error table from it rather than transcribing by hand.

`1062` and `1452` in particular are load-bearing: `INSERT … ON DUPLICATE KEY`
handling, ORM upserts, and migration tools all detect them by number.
