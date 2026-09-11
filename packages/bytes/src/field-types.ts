// D-37 — `enum_field_types`, the column flags, and the binary collation id.
//
// These live in `@myjs/bytes` for the third time this argument has come up.
// D-30 put `MyjsError` here because two packages above needed to throw it and
// neither could depend on the other; D-32 put `SqlValue` here for the same
// reason; and now `@myjs/types` needs to dispatch on a field type in
// `decodeStorageValue` while `@myjs/protocol` needs the same numbers to frame
// a column definition. The release plan ships protocol at 0.1 and types at
// 0.2, so an edge in either direction would make the 0.1 artefact
// unpublishable as specified.
//
// The test of whether something belongs here is whether it is a *fact about
// the format* rather than *behaviour*. These are facts: they are the same
// numbers in a wire packet, in a binlog row image and in an `.ibd` file, which
// is precisely why more than one package needs them. What stays in
// `@myjs/protocol` is the wire-only part — the parameter type word, its
// unsigned bit, and the charset ids a handshake advertises.
//
// Sources: `include/field_types.h` and `include/mysql_com.h`; tables in
// docs/15-wire-types.md.

export const FIELD_TYPE = {
  DECIMAL: 0x00, // pre-5.0; never sent by a modern server
  TINY: 0x01, // TINYINT, BOOL
  SHORT: 0x02, // SMALLINT
  LONG: 0x03, // INT
  FLOAT: 0x04,
  DOUBLE: 0x05, // DOUBLE, REAL
  NULL: 0x06, // the literal NULL
  TIMESTAMP: 0x07,
  LONGLONG: 0x08, // BIGINT
  INT24: 0x09, // MEDIUMINT — four bytes on the wire, not three
  DATE: 0x0a,
  TIME: 0x0b,
  DATETIME: 0x0c,
  YEAR: 0x0d,
  NEWDATE: 0x0e, // internal only
  VARCHAR: 0x0f, // internal only
  BIT: 0x10,
  TIMESTAMP2: 0x11, // internal (storage)
  DATETIME2: 0x12, // internal (storage)
  TIME2: 0x13, // internal (storage)
  TYPED_ARRAY: 0x14, // replication only
  VECTOR: 0xf2, // MySQL 9.0+
  INVALID: 0xf3,
  BOOL: 0xf4, // placeholder, unused
  JSON: 0xf5,
  NEWDECIMAL: 0xf6, // DECIMAL, NUMERIC
  ENUM: 0xf7, // on the wire ENUM arrives as STRING with ENUM_FLAG
  SET: 0xf8, // likewise SET, with SET_FLAG
  TINY_BLOB: 0xf9,
  MEDIUM_BLOB: 0xfa,
  LONG_BLOB: 0xfb,
  BLOB: 0xfc, // BLOB, TEXT
  VAR_STRING: 0xfd, // VARCHAR, VARBINARY
  STRING: 0xfe, // CHAR, BINARY, and ENUM/SET on the wire
  GEOMETRY: 0xff, // all spatial types
} as const

export type FieldTypeCode = (typeof FIELD_TYPE)[keyof typeof FIELD_TYPE]

/** Column flags (`include/mysql_com.h`; doc 15). */
export const COLUMN_FLAG = {
  NOT_NULL: 0x0001,
  PRI_KEY: 0x0002,
  UNIQUE_KEY: 0x0004,
  /** Set only on an index's *first* column, so clients cannot reconstruct indexes from flags (Q-06). */
  MULTIPLE_KEY: 0x0008,
  BLOB: 0x0010,
  UNSIGNED: 0x0020,
  ZEROFILL: 0x0040,
  BINARY: 0x0080,
  ENUM: 0x0100,
  AUTO_INCREMENT: 0x0200,
  TIMESTAMP: 0x0400,
  SET: 0x0800,
  NO_DEFAULT_VALUE: 0x1000,
  ON_UPDATE_NOW: 0x2000,
  NUM: 0x8000,
} as const

/**
 * The `binary` collation id.
 *
 * This is how a client tells VARBINARY from VARCHAR and BLOB from TEXT: the
 * type byte is identical and only `character_set == 63` distinguishes them
 * (doc 15).
 */
export const CHARSET_BINARY = 63

/** `utf8mb4_0900_ai_ci` — our default (D-10). */
