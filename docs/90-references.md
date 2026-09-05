# 90 — References

## Reference source trees

Cloned into `reference/`, which is **gitignored** — these are GPL/other-licensed
trees and must not be vendored into this repository. Reproduce them with:

```bash
mkdir -p reference && cd reference

# MySQL server — the primary source for everything in docs 10–30.
# --filter=blob:none keeps it to a few hundred MB instead of ~1.5 GB.
git clone --depth 1 --filter=blob:none https://github.com/mysql/mysql-server.git mysql
git -C mysql fetch --depth 1 origin 8.4:refs/remotes/origin/8.4   # LTS, for format cross-checks

# node-mysql2 — an independent, complete JS implementation of both protocol sides
git clone --depth 1 https://github.com/sidorares/node-mysql2.git mysql2

# MariaDB's Node connector — a second opinion on the ambiguous corners
git clone --depth 1 https://github.com/mariadb-corporation/mariadb-connector-nodejs.git mariadb-node

# PGlite — the delivery model we are following
git clone --depth 1 https://github.com/electric-sql/pglite.git pglite

# SQLite — the ergonomics and file-format-documentation benchmark
git clone --depth 1 https://github.com/sqlite/sqlite.git sqlite
```

Versions the docs were written against:

| Tree | Commit | Notes |
|---|---|---|
| `mysql-server` | `e174239c` (trunk) | `MYSQL_VERSION` 26.10, INNOVATION; 8.0/8.4 formats cross-checked |
| `node-mysql2` | `af6aa0e0` | |
| `mariadb-connector-nodejs` | `ff43a2c8` | |
| `pglite` | `ae182ff8` | |
| `sqlite` | `f3b9f74d` | |

### Extracting the protocol documentation

MySQL's protocol reference is written as Doxygen `@page` blocks *inside* the
C++ sources. To pull them all into one file:

```bash
python3 - <<'PY'
import re
files = ["sql/protocol_classic.cc", "sql-common/net_serv.cc",
         "sql/auth/sql_authentication.cc", "sql/auth/sha2_password.cc",
         "sql/mysqld.cc", "sql-common/client.cc", "vio/viossl.cc"]
out = []
for f in files:
    src = open(f, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'/\*\*(.*?)\*/', src, re.S):
        if '@page page_protocol' in m.group(1):
            out.append(f"\n\n<!-- from {f} -->\n" + m.group(1))
open('protocol-doxygen.txt', 'w').write("".join(out))
PY
```

Run from `reference/mysql/`. It produces ~145 KB of authoritative protocol
specification, which is what docs 10–17 were written from.

## Primary sources, by document

### Protocol (docs 10–18)

| File | Contents |
|---|---|
| `sql/protocol_classic.cc` | `@page page_protocol_basics`, packet types, resultsets, `COM_*`, binary protocol |
| `sql-common/net_serv.cc` | packet framing, compression, `ColumnDefinition41` |
| `sql/auth/sql_authentication.cc` | connection phase, auth methods, MFA |
| `sql/auth/sha2_password.cc` | `caching_sha2_password`; the `fast_auth_success = '\3'` / `perform_full_authentication = '\4'` markers |
| `vio/viossl.cc` | TLS |
| `include/mysql_com.h` | `CLIENT_*` capabilities, `SERVER_STATUS_*`, column flags |
| `include/my_command.h` | `enum_server_command` |
| `include/field_types.h` | `enum_field_types` |
| `share/messages_to_clients.txt` | error numbers and SQL states |
| `libs/mysql/binlog/event/binlog_event.h` | event header offsets, `Log_event_type` |
| `libs/mysql/binlog/event/rows_event.h` | Table_map and Rows post-headers |

### Storage (docs 20–30)

| File | Contents |
|---|---|
| `storage/innobase/include/fil0types.h` | FIL header/trailer offsets |
| `storage/innobase/include/fil0fil.h` | `FIL_PAGE_*` type codes |
| `storage/innobase/include/fsp0types.h` | space flags, extent size, reserved page numbers |
| `storage/innobase/include/fsp0fsp.h` | FSP header, XDES, inode layout |
| `storage/innobase/include/fut0lst.h` | `FLST_*` list node sizes |
| `storage/innobase/include/page0types.h` | every `PAGE_*` offset, infimum/supremum |
| `storage/innobase/include/page0page.h` | page directory |
| `storage/innobase/rem/rec.h` | record header constants, the REDUNDANT bit diagram, instant/version state |
| `storage/innobase/rem/rem0rec.cc` | the authoritative variable-length decoding loop |
| `storage/innobase/rem/rem0cmp.cc` | comparison, including float handling |
| `storage/innobase/include/data0type.h` | `DATA_*` types, system column lengths |
| `storage/innobase/include/lob0lob.h` | external field reference layout |
| `storage/innobase/include/trx0rec.h` | undo record types |
| `storage/innobase/include/trx0undo.ic` | roll pointer encode/decode |
| `storage/innobase/include/log0constants.h` | redo block and file header layout |
| `storage/innobase/include/mtr0types.h` | `mlog_id_t` |
| `storage/innobase/include/univ.i` | page size limits |
| `storage/innobase/row/row0mysql.cc` | `row_mysql_store_col_in_innobase_format` — the integer transform |
| `storage/innobase/handler/ha_innodb.cc` | `get_innobase_type_from_mysql_type` |
| `mysys/decimal.cc` | `decimal2bin` and its worked example |
| `mysys/my_time.cc` | temporal packed/binary conversions, `DATETIMEF_INT_OFS` |
| `sql/field.cc` | per-type `Field` storage, `Field_date::get_date_internal` |
| `sql-common/json_binary.h` | the binary JSON grammar |
| `sql/dd/impl/tables/*.cc` | data dictionary table definitions |
| `storage/innobase/include/dict0sdi.h` | SDI key format |
| `strings/ctype-*.cc` | collations and their numeric ids |

## External documentation

- MySQL Internals — Client/Server Protocol:
  <https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html>
  (the rendered form of the Doxygen pages above)
- MySQL Reference Manual — InnoDB on-disk structures:
  <https://dev.mysql.com/doc/refman/8.4/en/innodb-on-disk-structures.html>
- MySQL Reference Manual — Data dictionary:
  <https://dev.mysql.com/doc/refman/8.4/en/data-dictionary.html>
- MySQL 9.x — WebAssembly libraries (note: WASM *inside* MySQL, not a WASM build
  of MySQL): <https://dev.mysql.com/doc/refman/9.6/en/srjs-webassembly.html>
- SQLite file format: <https://sqlite.org/fileformat2.html>
- SQLite VFS: <https://sqlite.org/vfs.html>
- PGlite: <https://pglite.dev>
- MDN — `FileSystemFileHandle.createSyncAccessHandle()`:
  <https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle>
- MDN — Web Locks API:
  <https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API>
- Chrome for Developers — multiple readers and writers on OPFS
  (`readwrite-unsafe`):
  <https://developer.chrome.com/blog/new-dev-trial-for-multiple-readers-and-writers>
- PowerSync — *The Current State Of SQLite Persistence On The Web* (May 2026):
  <https://powersync.com/blog/sqlite-persistence-on-the-web>
- wasmlabs — *LAMP Stack, but make it Wasm* (MySQL runs natively there, not in
  WASM): <https://wasmlabs.dev/articles/wordpress-nginx-fcgi-mysql/>

## Third-party work worth reading

- **Jeremy Cole's InnoDB series** — the best independent explanation of InnoDB's
  page and record formats; `innodb_ruby` is a working parser.
  <https://blog.jcole.us/innodb/>
- **`node-mysql2`** — a complete JS implementation of both protocol sides.
  `lib/packets/` is a second opinion on every packet layout in docs 10–17.
- **`ibd2sdi`**, **`innochecksum`** — ship with MySQL; useful oracles when
  testing `@myjs/innodb`.
- **SQLancer** — differential SQL testing; the techniques in doc 43 come from
  this work. <https://github.com/sqlancer/sqlancer>

## A note on licensing

MySQL and MariaDB are **GPLv2**. Everything in `reference/` is gitignored and
nothing from those trees is copied into this repository. The docs here cite
constants, offsets, and algorithms — facts about a format — and describe them in
our own words. Do not paste MySQL source code into this repository, and do not
vendor `mysql-test` (see [43-testing.md](./43-testing.md) for how to use it in
CI without doing so).

This licence boundary is not incidental. It is one of the main reasons the
project reimplements rather than ports — see
[02-strategy.md](./02-strategy.md).
