# 16 — Prepared statements and the binary protocol

> Sources: `@page page_protocol_com_stmt_*` and `@page page_protocol_binary_resultset`
> in `sql/protocol_classic.cc`; `include/mysql_com.h` `enum_cursor_type`.

Prepared statements are how every serious client sends parameters — they avoid
SQL string interpolation, they let the server cache the plan, and they use the
compact binary encoding. Prisma, Drizzle, and `mysql2`'s `execute()` all use
this path, so it must be as solid as `COM_QUERY`.

## Lifecycle

```
COM_STMT_PREPARE   →  COM_STMT_PREPARE_OK + param defs + column defs
COM_STMT_SEND_LONG_DATA *   (optional, no response, repeatable)
COM_STMT_EXECUTE   →  OK | ERR | binary resultset
COM_STMT_FETCH *          (only if a cursor was opened)
COM_STMT_RESET     →  OK | ERR
COM_STMT_CLOSE            (no response)
```

## `COM_STMT_PREPARE`

Request: `0x16` followed by the SQL as `string<EOF>`.

Response, on success:

```
int<1>   status              0x00
int<4>   statement_id
int<2>   num_columns
int<2>   num_params
int<1>   reserved            0x00
if payload length >= 12:
  int<2> warning_count
  if CLIENT_OPTIONAL_RESULTSET_METADATA:
    int<1> metadata_follows
```

Then, if `num_params > 0`, `num_params` `ColumnDefinition41` packets (the
*parameter* definitions), terminated by EOF unless `CLIENT_DEPRECATE_EOF`; then,
if `num_columns > 0`, `num_columns` column definitions, likewise terminated.

Notes:

- The parameter definitions are largely **placeholders**: MySQL reports every
  `?` as `VAR_STRING` (`0xFD`) with charset `63`, since it cannot know the type
  until execution. In the specification's own worked example the parameter
  columns are named `?` with type `fd`. Do not try to infer real parameter
  types; clients do not expect it.
- `LOAD DATA` cannot be prepared, so — unlike `COM_QUERY` — a
  `LOCAL INFILE` request can never appear in this response.
- Statement ids are per-connection. Ours are a monotonically increasing 32-bit
  counter; reuse after `COM_STMT_CLOSE` is allowed but pointless.

## `COM_STMT_EXECUTE`

```
int<1>   0x17
int<4>   statement_id
int<1>   flags                      enum_cursor_type
int<4>   iteration_count            always 1
if num_params > 0 or (CLIENT_QUERY_ATTRIBUTES and flags & PARAMETER_COUNT_AVAILABLE):
  if CLIENT_QUERY_ATTRIBUTES:
    int<lenenc> parameter_count     overrides num_params from PREPARE
  if parameter_count > 0:
    binary    null_bitmap           (parameter_count + 7) / 8   — offset 0
    int<1>    new_params_bind_flag
    if new_params_bind_flag:
      for each parameter:
        int<2>  type + flags        low byte = enum_field_types; 0x8000 = unsigned
        if CLIENT_QUERY_ATTRIBUTES:
          string<lenenc> parameter_name    empty for positional parameters
    binary    parameter_values      doc 15, skipping NULLs
```

`enum_cursor_type` (`mysql_com.h`):

| Value | Name |
|---|---|
| `0x00` | `CURSOR_TYPE_NO_CURSOR` |
| `0x01` | `CURSOR_TYPE_READ_ONLY` |
| `0x02` | `CURSOR_TYPE_FOR_UPDATE` |
| `0x04` | `CURSOR_TYPE_SCROLLABLE` |
| `0x08` | `PARAMETER_COUNT_AVAILABLE` |

The pitfalls, in the order they will bite an implementation:

1. **`new_params_bind_flag` is stateful.** When 0, the types from the *previous*
   execution of this statement are reused and only values are sent. A server
   that does not remember the last bound types per statement will misparse the
   values. Older clients rebind every time; `mysql2` sets it to 1 always, but
   the C client does not.
2. **The NULL bitmap has offset 0 here**, not 2. Different from resultset rows.
3. **Parameters sent via `COM_STMT_SEND_LONG_DATA` are still present in the
   bitmap** and are *not* repeated in `parameter_values`. The server must merge
   the accumulated long-data buffer for that parameter index.
4. **`parameter_count` may exceed `num_params`** when query attributes are in
   use. The first `num_params` values satisfy the `?` placeholders positionally;
   the remainder are named attributes stored on the session and readable via
   `mysql_query_attribute_string()`. Named or not, the first `num_params` are
   positional.

Worked example from the specification — statement 1, one parameter, type
`VAR_STRING` (`0x0f`… note the example shows `0f 00` because the low byte of the
`int<2>` is the type), value `"foo"`:

```
12 00 00 00 17 01 00 00 00 00 01 00 00 00 00 01 0f 00 03 66 6f 6f
            │  └─stmt id─┘ │  └─iter cnt─┘ │  │  └type┘ └─"foo"─┘
            │              flags           │  new_params_bind_flag
            COM_STMT_EXECUTE               null_bitmap
```

### Response

- No resultset → OK or ERR.
- Resultset → a **binary resultset**: length-encoded column count, column
  definitions, then binary rows (doc 15), then the terminator (OK under
  `DEPRECATE_EOF`, else EOF).
- Cursor opened → column definitions, then immediately the terminator with
  `SERVER_STATUS_CURSOR_EXISTS` set and **no rows**. Rows come from
  `COM_STMT_FETCH`.
- Stored procedure `OUT` parameters arrive as an extra resultset flagged
  `SERVER_PS_OUT_PARAMS`.

## `COM_STMT_SEND_LONG_DATA`

```
int<1>   0x18
int<4>   statement_id
int<2>   param_id
string<EOF>  data
```

**No response, ever** — not even on error. If it fails, the error surfaces at
the next `COM_STMT_EXECUTE`. Multiple sends for the same `param_id` concatenate.
The buffer is cleared by `COM_STMT_RESET` or by a successful execute.

This is how large BLOBs are streamed without one enormous packet. It is also an
unbounded server-side allocation driven by an unauthenticated-adjacent client,
so cap it (`max_allowed_packet`-equivalent) and error at execute time.

## `COM_STMT_FETCH`

```
int<1>   0x1c
int<4>   statement_id
int<4>   num_rows
```

Returns up to `num_rows` binary rows, then EOF/OK. When the cursor is exhausted,
the terminator carries `SERVER_STATUS_LAST_ROW_SENT`.

Cursors are how a client streams a large resultset without buffering it. On a
real server they materialise into a temporary table; in our engine an open
cursor is an iterator plus a pinned read view, which is simpler and better —
but it means an abandoned cursor pins undo records. Time them out.

## `COM_STMT_RESET` and `COM_STMT_CLOSE`

- `RESET` (`0x1a`, `int<4>` id): drops accumulated long data, closes the cursor,
  clears warnings. Keeps the statement. Responds OK.
- `CLOSE` (`0x19`, `int<4>` id): frees the statement. **No response.**

## Server-side state

```js
class PreparedStatement {
  id            // int32
  sql           // original text
  ast           // parsed once
  plan          // compiled once; invalidated on schema change
  paramCount
  columns       // ColumnDefinition[] — empty for non-SELECT
  lastBoundTypes  // for new_params_bind_flag === 0
  longData      // Map<paramIndex, Uint8Array[]>
  cursor        // open iterator + read view, or null
}
```

Rules:

- Statements belong to a **connection**, not to the database. `COM_CHANGE_USER`
  and `COM_RESET_CONNECTION` destroy them all.
- If the schema changes underneath a prepared statement, MySQL transparently
  re-prepares and sets `SERVER_STATUS_METADATA_CHANGED` if the resultset shape
  changed. We should do the same: a plan cache keyed on a schema version, with
  automatic invalidation.
- Cap the number of open statements per connection
  (`max_prepared_stmt_count`, default 16382) and return `ER_MAX_PREPARED_STMT_COUNT_REACHED`.

## Why the binary protocol is worth the effort

For our engine specifically, it is not just about matching MySQL:

- Values skip the string round trip in both directions. An `INT` is 4 bytes, not
  a decimal rendering that must be parsed back.
- Types are unambiguous, so no locale- or format-dependent parsing.
- The parse and plan happen once per statement rather than once per execution,
  which matters far more when the "server" shares a CPU with the application's
  UI thread.
