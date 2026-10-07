# 27 — The data dictionary and SDI

> Sources: `sql/dd/impl/tables/*.cc` (the DD table definitions),
> `storage/innobase/include/dict0sdi.h` (`SDI_TYPE_LEN = 4`,
> `SDI_KEY_LEN = 8`), `fsp0types.h` (`FSP_FLAGS_HAS_SDI`),
> `fil0fil.h` (`FIL_PAGE_SDI = 17853`).

The data dictionary is where "what does this table look like" lives. In MySQL it
moved twice, and the second move is what makes reading a real datadir hard.

## Before 8.0: `.frm` files

Each table had a `<table>.frm` next to its data: a binary blob with a header,
the column definitions, key definitions, defaults, and comments, plus InnoDB's
own `SYS_TABLES` / `SYS_COLUMNS` / `SYS_INDEXES` / `SYS_FIELDS` internal tables
in the system tablespace (rooted at `FSP_DICT_HDR_PAGE_NO = 7`, doc 21).

Two sources of truth that could disagree. `.frm` parsers exist (`mysqlfrm`,
various Python/Go implementations) and the format is documented by reverse
engineering, not by Oracle.

## MySQL 8.0: the transactional data dictionary

`.frm` files were removed. The dictionary now lives in **InnoDB tables inside
`mysql.ibd`**, so DDL is transactional and crash-safe.

The DD tables (`sql/dd/impl/tables/`):

```
catalogs                 columns                  column_type_elements
column_statistics        character_sets           collations
check_constraints        events                   foreign_keys
foreign_key_column_usage index_column_usage       index_partitions
index_stats              indexes                  parameters
parameter_type_elements  resource_groups          routines
schemata                 spatial_reference_systems
tables                   table_partitions         table_stats
tablespaces              tablespace_files         triggers
view_routine_usage       view_table_usage
dd_properties
```

They are **not directly queryable** — `SELECT * FROM mysql.tables` is refused.
`INFORMATION_SCHEMA` views are the supported interface, and they are
implemented as views over these tables. `dd_properties` holds the DD schema
version, which is how upgrades are detected.

**This is the crux of the argument in [02-strategy.md](./02-strategy.md).** To
write a datadir a real `mysqld` will serve, you must write these tables — whose
schema is internal, undocumented, and version-specific — using InnoDB's own
record format. That is a far larger and far less stable surface than the page
format itself.

## SDI: Serialized Dictionary Information

MySQL 8 also stores a **copy** of each table's definition inside the tablespace
that holds the table, as JSON. That is SDI.

- Stored in pages of type `FIL_PAGE_SDI` (17853), in an SDI B+tree within the
  tablespace, with overflow in `FIL_PAGE_SDI_BLOB` (18) / `SDI_ZBLOB` (19).
- Present only when `FSP_FLAGS_HAS_SDI` is set in the tablespace flags (doc 21).
- Records are keyed by `(type: uint32, id: uint64)` — `SDI_TYPE_LEN = 4`,
  `SDI_KEY_LEN = 8`. Type 1 is a table, type 2 is a tablespace.
- The payload is **zlib-compressed JSON**.
- `ibd2sdi`, shipped with MySQL, extracts it.

SDI exists so a tablespace is self-describing: it is what makes
`ALTER TABLE ... IMPORT TABLESPACE` possible without the source server's
dictionary, and it is what a forensic tool uses to read an orphaned `.ibd`.

An SDI document for a table looks roughly like:

```json
{
  "mysqld_version_id": 80400,
  "dd_version": 80023,
  "sdi_version": 80019,
  "dd_object_type": "Table",
  "dd_object": {
    "name": "users",
    "schema_ref": "myapp",
    "engine": "InnoDB",
    "collation_id": 255,
    "columns": [
      { "name": "id", "type": 4, "is_nullable": false,
        "is_unsigned": false, "char_length": 11,
        "column_key": 2, "collation_id": 63, "ordinal_position": 1 },
      { "name": "email", "type": 16, "char_length": 1020,
        "collation_id": 255, "ordinal_position": 2 }
    ],
    "indexes": [
      { "name": "PRIMARY", "type": 1, "algorithm": 2,
        "elements": [ { "ordinal_position": 1, "length": 4,
                        "order": 2, "column_opx": 0 } ] }
    ],
    "se_private_data": "id=1068;root=4;space_id=42;table_id=1078;trx_id=1234;"
  }
}
```

Two fields do a lot of work:

- `se_private_data` — the storage-engine-specific bindings: the InnoDB
  `table_id`, `space_id`, and each index's **root page number**. Without it you
  cannot find the B+tree root, so you cannot read a single row.
- The `type` codes are `enum_column_types` from `sql/dd/types/column.h`, which is
  a *different* enumeration from `enum_field_types` on the wire. Yet another
  place where "MySQL type" means three different things.

## What this means for us

### Reading real InnoDB files

For `@myjs/innodb`, SDI is the entry point:

```
1. read page 0, check FSP_FLAGS_HAS_SDI, get page size and row format
2. find the SDI B+tree root
3. read the SDI record for the table, inflate the zlib JSON
4. build a column/index descriptor from it
5. read se_private_data for each index's root page number
6. descend that B+tree and decode records (docs 22–24)
```

This works on a single `.ibd` with **no access to `mysql.ibd`** — which is
exactly why SDI is the right compatibility boundary, and why transportable
tablespaces are the right interchange mechanism.

### Writing files a real server will accept

`ALTER TABLE ... IMPORT TABLESPACE` needs:

- an `.ibd` whose pages are internally consistent (checksums, page numbers,
  space id);
- a matching table definition already created on the target server;
- a `.cfg` file describing the columns and indexes, produced by
  `FLUSH TABLES ... FOR EXPORT`.

The import path adjusts space ids and validates the schema against the target
table. Producing a valid `.cfg` and a clean `.ibd` is achievable and testable.
Producing a whole datadir with a valid `mysql.ibd` is not, and we do not attempt
it.

### Our own catalog

We need a dictionary too, and there is a genuinely better option available to us
than either of MySQL's.

**Store the catalog as ordinary tables in our own store, and keep a
self-describing JSON copy in the file header.** Concretely:

- The catalog lives in system tables (`_myjs_tables`, `_myjs_columns`,
  `_myjs_indexes`, …), so DDL is transactional through the same code path as
  everything else — the good idea MySQL 8 had.
- A **bootstrap descriptor** at a fixed page describes those system tables
  themselves, in a simple fixed format, so the chicken-and-egg problem is solved
  once and explicitly.
- Each table's full definition is *also* serialised as JSON into a
  per-table header page — SDI's good idea. A single table's pages are then
  independently readable, which makes debugging, partial recovery and forensic
  tooling possible.

And one thing to do differently from both: **version the catalog format
explicitly, and write a migration for every change.** MySQL's `dd_properties`
version exists but the format's evolution is not documented. Ours should be, in
the same spirit as SQLite's file format document.

## Our catalog (M4.23 — D-26, D-56, D-57, D-59, D-60)

Built as above, with two of the proposals narrowed by building them.

**System tables** are ordinary MVCC clustered indexes. Their trees have reserved
index ids, below `FIRST_USER_INDEX` (16):

| Id | Tree | Key | Row |
|---|---|---|---|
| 1 | counters (the store's, raw) | index id, slot | next value, `u64` |
| 2 | `_myjs_catalog` | name | value: `version`, `lower_case_table_names` |
| 3 | `_myjs_schemas` | name | id, definition (JSON) |
| 4 | `_myjs_tables` | schema id, name | id, definition (JSON: a `TableDef`) |

**The bootstrap descriptor is code, not a page (D-56).** Those ids and layouts
are constants, and the store's `FORMAT_VERSION` (4) pins them. Nothing has to
be read to find the system tables, and their layout changes only with the
format, which is refused rather than migrated (D-26).

**A table's definition is its `_myjs_tables` row (D-57)**, not a separate page.
There is one copy, changed by the transaction that changes the table. The
row's value is JSON that `decodeTableDef` checks field by field.
`ENGINE_CORRUPT_CATALOG` answers anything that does not decode, or does not
hang together. Key parts are built when a table opens, not when it decodes,
because they need its collations. The async edge loads those first, from
`collationsOf` (D-36). The per-table page doc 27 proposed would have been a
second copy, and two copies of a definition drift.

**A `TableDef`** is engine-level, not SQL. Its columns carry `@myjs/types`'
`ColumnType`: `ColumnMeta` plus the declared length. Its indexes carry named
parts, with a prefix or a direction. What only SQL reads rides along in
`attributes`: a default's text, a comment. It says which index clusters the
table, by **InnoDB's rule (D-60)**: the PRIMARY KEY, or else the first UNIQUE
index whose columns are all NOT NULL and which has no prefix part, or else a
hidden 6-byte row id. That is MySQL's `sort_keys` order, then `TABLE_SHARE`'s
promotion. `layoutOf` and `keyColumnsOf` are the joins nothing made before: a
column list to a record layout, an index to its key columns.

**DDL is a transaction of its own (D-59)**, as MySQL's implicit commit makes
it:

- **CREATE TABLE** makes each tree in its own write, with an undo record that
  drops it on rollback (doc 25 §DDL records). It then inserts the row. A crash
  anywhere rolls all of it back, and no tree is left that nothing will drop.
- **DROP TABLE** deletes the row, then leaves a record that drops the trees **on
  purge**. A view older than the DROP keeps reading them until it closes. The
  row goes first, so purge, newest first, drops the trees before it removes the
  row.

**Lookups read the latest committed definition**, as MySQL's dictionary does,
never a view's:

- A `Table` handle re-checks its row before every write. A write cannot land
  in a tree that purge is about to drop: `ER_NO_SUCH_TABLE`.
- A consistent read through a view older than the definition is
  `ER_TABLE_DEF_CHANGED` (1412), InnoDB's answer.

**Versioning, the done-when.** The version is a row, and `CATALOG_VERSION` is
1.

- **Older:** each registered migration runs in order, in one transaction that
  also writes the new version. A crash leaves the catalog old and unmigrated,
  or new and migrated, never half. `Catalog.open` runs after the store's
  recovery has rolled back whatever a crash left open, a half-done migration
  included.
- **Newer, or older with a step missing:** `ENGINE_BAD_FORMAT`, naming both
  versions.
- **What a migration can change:** it rewrites definitions. The system tables'
  layout belongs to the store format.

A test proves all three paths, crashing a migration at every write.

Names are case-sensitive: `lower_case_table_names` is 0, stored when the
catalog is made, and 1 is refused as `ER_NOT_SUPPORTED_YET`. A name is at
most 64 BMP characters, as MySQL's identifiers are. At 1 KiB pages that leaves
a catalog row 98 bytes, and a long name goes off-page like any long field. The
catalog needs pages of at least 1 KiB; MySQL's smallest is 4 KiB.

`AUTO_INCREMENT` and the hidden row id come from the counters tree, keyed by
the clustered index id (D-61). Ids are never reused, so a table created again
starts again. A value is taken in a mini-transaction of its own: one handed
out is gone, committed or not, as InnoDB's are. An explicit value moves the
counter past itself, in the inserting write. Dropping the tree deletes its
counters.

