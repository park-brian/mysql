// M3.5 — column types, with charset and collation.
//
// The roadmap names doc 29 for this item, and the reason is that a column type
// in MySQL is not just a name: `VARCHAR(10)` means nothing until you know its
// charset, because the charset decides how many bytes those ten characters
// occupy (M2.6's `byteLengthFor`) and its collation decides how they compare
// and sort. A parser that recorded `VARCHAR(10)` and dropped the
// `CHARACTER SET gbk COLLATE gbk_bin` after it would hand M4 a column
// definition that cannot be laid out or indexed.
//
// The type *name* table is written out here rather than generated, and that is
// a deliberate exception to D-14. The mapping from written name to
// `enum_field_types` lives in MySQL's grammar (`sql/sql_yacc.yy`), not in a
// struct — extracting it means parsing a Bison file, which is the fragility
// M2.17 exists to avoid. What makes the table honest instead is that it is
// checked against MySQL's own corpus: M3.11's census parses every `CREATE`
// statement in `mysql-test/t`, so a name spelled wrong here is a parse failure
// there rather than a silent divergence.
//
// The traps this table exists to get right, each of which a first draft gets
// wrong and none of which is visible from the type name alone:
//
//   - **`FLOAT(p)` with one argument is a precision, not a display width**, and
//     `p` in 24..53 makes the column a DOUBLE. `FLOAT(24)` and `FLOAT(24,2)`
//     are therefore different types.
//   - **`REAL` is DOUBLE**, except under `REAL_AS_FLOAT`, where it is FLOAT.
//     That mode has been parsed since M3.7 and read by nothing until now.
//   - **`SERIAL` is not a type** but an alias for
//     `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE`, so it carries column
//     attributes with it.
//   - **`BINARY` after a string type is a collation**, not the BINARY type:
//     `VARCHAR(10) BINARY` is a VARCHAR in the charset's `_bin` collation.
//   - **`ASCII` and `UNICODE` are charset shorthands** in the same position —
//     `CHAR(10) ASCII` is latin1 and `CHAR(10) UNICODE` is ucs2.
//   - Several names are two words (`DOUBLE PRECISION`, `CHARACTER VARYING`,
//     `LONG VARBINARY`, `NATIONAL CHAR`), so the table cannot be a single-token
//     lookup.
import { FIELD_TYPE, type FieldTypeCode } from '@myjs/bytes'
import type { Cursor } from './cursor.ts'
import { TOKEN } from './tokens.ts'
import type { SqlMode } from './sql-mode.ts'

/**
 * What follows a type name, which is what the parser needs to know next.
 *
 * Not the same as the storage class: `TEXT` and `BLOB` share a storage class
 * and differ exactly in whether a charset may follow, which is the distinction
 * that matters here.
 */
const SHAPE = {
  /** `(M)` display width, then `UNSIGNED` / `ZEROFILL`. */
  INTEGER: 'integer',
  /** `(M[,D])`, then `UNSIGNED` / `ZEROFILL`. */
  DECIMAL: 'decimal',
  /** `(p)` or `(M,D)` — the two mean different things. */
  FLOAT: 'float',
  /** `(fsp)`, 0..6. */
  FSP: 'fsp',
  /** `(M)`, then a charset. */
  TEXT: 'text',
  /** `(M)`, no charset — the byte-string types. */
  BYTES: 'bytes',
  /** `('a','b')`, then a charset. */
  VALUES: 'values',
  /** `(M)` and nothing else. */
  WIDTH: 'width',
  /** No arguments at all. */
  NONE: 'none',
} as const

type Shape = (typeof SHAPE)[keyof typeof SHAPE]

interface TypeSpec {
  readonly code: FieldTypeCode
  readonly shape: Shape
  /** The canonical name recorded on the node, when it differs from what was written. */
  readonly as?: string
  /** A charset the type name itself implies — `NCHAR` is utf8mb3. */
  readonly charset?: string
}

/**
 * Every type name MySQL 8.4 accepts in a column definition.
 *
 * Multi-word names are spelled with single spaces and matched by
 * `#typeName` below, which joins the words it consumed the same way.
 */
const TYPES: Readonly<Record<string, TypeSpec>> = {
  BIT: { code: FIELD_TYPE.BIT, shape: SHAPE.WIDTH },

  TINYINT: { code: FIELD_TYPE.TINY, shape: SHAPE.INTEGER },
  INT1: { code: FIELD_TYPE.TINY, shape: SHAPE.INTEGER, as: 'TINYINT' },
  // `BOOL` is a TINYINT(1) — a distinct spelling of the same type, not a
  // distinct type. MySQL reports `tinyint(1)` for it.
  BOOL: { code: FIELD_TYPE.TINY, shape: SHAPE.NONE, as: 'TINYINT' },
  BOOLEAN: { code: FIELD_TYPE.TINY, shape: SHAPE.NONE, as: 'TINYINT' },
  SMALLINT: { code: FIELD_TYPE.SHORT, shape: SHAPE.INTEGER },
  INT2: { code: FIELD_TYPE.SHORT, shape: SHAPE.INTEGER, as: 'SMALLINT' },
  MEDIUMINT: { code: FIELD_TYPE.INT24, shape: SHAPE.INTEGER },
  INT3: { code: FIELD_TYPE.INT24, shape: SHAPE.INTEGER, as: 'MEDIUMINT' },
  MIDDLEINT: { code: FIELD_TYPE.INT24, shape: SHAPE.INTEGER, as: 'MEDIUMINT' },
  INT: { code: FIELD_TYPE.LONG, shape: SHAPE.INTEGER },
  INTEGER: { code: FIELD_TYPE.LONG, shape: SHAPE.INTEGER, as: 'INT' },
  INT4: { code: FIELD_TYPE.LONG, shape: SHAPE.INTEGER, as: 'INT' },
  BIGINT: { code: FIELD_TYPE.LONGLONG, shape: SHAPE.INTEGER },
  INT8: { code: FIELD_TYPE.LONGLONG, shape: SHAPE.INTEGER, as: 'BIGINT' },

  DECIMAL: { code: FIELD_TYPE.NEWDECIMAL, shape: SHAPE.DECIMAL },
  DEC: { code: FIELD_TYPE.NEWDECIMAL, shape: SHAPE.DECIMAL, as: 'DECIMAL' },
  NUMERIC: { code: FIELD_TYPE.NEWDECIMAL, shape: SHAPE.DECIMAL, as: 'DECIMAL' },
  FIXED: { code: FIELD_TYPE.NEWDECIMAL, shape: SHAPE.DECIMAL, as: 'DECIMAL' },

  FLOAT: { code: FIELD_TYPE.FLOAT, shape: SHAPE.FLOAT },
  FLOAT4: { code: FIELD_TYPE.FLOAT, shape: SHAPE.FLOAT, as: 'FLOAT' },
  DOUBLE: { code: FIELD_TYPE.DOUBLE, shape: SHAPE.DECIMAL },
  'DOUBLE PRECISION': { code: FIELD_TYPE.DOUBLE, shape: SHAPE.DECIMAL, as: 'DOUBLE' },
  FLOAT8: { code: FIELD_TYPE.DOUBLE, shape: SHAPE.DECIMAL, as: 'DOUBLE' },
  // REAL is DOUBLE unless REAL_AS_FLOAT, handled in `parseDataType`.
  REAL: { code: FIELD_TYPE.DOUBLE, shape: SHAPE.DECIMAL, as: 'DOUBLE' },

  DATE: { code: FIELD_TYPE.DATE, shape: SHAPE.NONE },
  TIME: { code: FIELD_TYPE.TIME, shape: SHAPE.FSP },
  TIMESTAMP: { code: FIELD_TYPE.TIMESTAMP, shape: SHAPE.FSP },
  DATETIME: { code: FIELD_TYPE.DATETIME, shape: SHAPE.FSP },
  YEAR: { code: FIELD_TYPE.YEAR, shape: SHAPE.WIDTH },

  CHAR: { code: FIELD_TYPE.STRING, shape: SHAPE.TEXT },
  CHARACTER: { code: FIELD_TYPE.STRING, shape: SHAPE.TEXT, as: 'CHAR' },
  VARCHAR: { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT },
  'CHARACTER VARYING': { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT, as: 'VARCHAR' },
  'CHAR VARYING': { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT, as: 'VARCHAR' },
  // The `NATIONAL` family is utf8mb3 by definition — MySQL's chosen "national"
  // charset — and that is part of the type rather than a clause after it.
  NCHAR: { code: FIELD_TYPE.STRING, shape: SHAPE.TEXT, as: 'CHAR', charset: 'utf8mb3' },
  'NATIONAL CHAR': { code: FIELD_TYPE.STRING, shape: SHAPE.TEXT, as: 'CHAR', charset: 'utf8mb3' },
  'NATIONAL CHARACTER': { code: FIELD_TYPE.STRING, shape: SHAPE.TEXT, as: 'CHAR', charset: 'utf8mb3' },
  NVARCHAR: { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT, as: 'VARCHAR', charset: 'utf8mb3' },
  'NATIONAL VARCHAR': { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT, as: 'VARCHAR', charset: 'utf8mb3' },
  'NCHAR VARCHAR': { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT, as: 'VARCHAR', charset: 'utf8mb3' },
  'NCHAR VARYING': { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.TEXT, as: 'VARCHAR', charset: 'utf8mb3' },
  'NATIONAL CHARACTER VARYING': {
    code: FIELD_TYPE.VAR_STRING,
    shape: SHAPE.TEXT,
    as: 'VARCHAR',
    charset: 'utf8mb3',
  },

  BINARY: { code: FIELD_TYPE.STRING, shape: SHAPE.BYTES },
  'CHAR BYTE': { code: FIELD_TYPE.STRING, shape: SHAPE.BYTES, as: 'BINARY' },
  VARBINARY: { code: FIELD_TYPE.VAR_STRING, shape: SHAPE.BYTES },

  TINYBLOB: { code: FIELD_TYPE.TINY_BLOB, shape: SHAPE.NONE },
  BLOB: { code: FIELD_TYPE.BLOB, shape: SHAPE.BYTES },
  MEDIUMBLOB: { code: FIELD_TYPE.MEDIUM_BLOB, shape: SHAPE.NONE },
  LONGBLOB: { code: FIELD_TYPE.LONG_BLOB, shape: SHAPE.NONE },
  TINYTEXT: { code: FIELD_TYPE.TINY_BLOB, shape: SHAPE.TEXT },
  TEXT: { code: FIELD_TYPE.BLOB, shape: SHAPE.TEXT },
  MEDIUMTEXT: { code: FIELD_TYPE.MEDIUM_BLOB, shape: SHAPE.TEXT },
  LONGTEXT: { code: FIELD_TYPE.LONG_BLOB, shape: SHAPE.TEXT },
  // `LONG` alone, and `LONG VARCHAR`, are MEDIUMTEXT — a compatibility spelling
  // old enough that a reader will not guess it.
  LONG: { code: FIELD_TYPE.MEDIUM_BLOB, shape: SHAPE.TEXT, as: 'MEDIUMTEXT' },
  'LONG VARCHAR': { code: FIELD_TYPE.MEDIUM_BLOB, shape: SHAPE.TEXT, as: 'MEDIUMTEXT' },
  'LONG CHAR VARYING': { code: FIELD_TYPE.MEDIUM_BLOB, shape: SHAPE.TEXT, as: 'MEDIUMTEXT' },
  'LONG VARBINARY': { code: FIELD_TYPE.MEDIUM_BLOB, shape: SHAPE.BYTES, as: 'MEDIUMBLOB' },

  ENUM: { code: FIELD_TYPE.ENUM, shape: SHAPE.VALUES },
  SET: { code: FIELD_TYPE.SET, shape: SHAPE.VALUES },
  JSON: { code: FIELD_TYPE.JSON, shape: SHAPE.NONE },

  GEOMETRY: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  POINT: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  LINESTRING: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  POLYGON: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  MULTIPOINT: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  MULTILINESTRING: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  MULTIPOLYGON: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  GEOMETRYCOLLECTION: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE },
  GEOMCOLLECTION: { code: FIELD_TYPE.GEOMETRY, shape: SHAPE.NONE, as: 'GEOMETRYCOLLECTION' },

  // Not a type but an alias for a type *and four column attributes*. Recorded
  // as what it stands for, with `serial` set so the column parser can apply the
  // rest.
  SERIAL: { code: FIELD_TYPE.LONGLONG, shape: SHAPE.NONE, as: 'BIGINT' },
}

/**
 * The multi-word names, longest first, as arrays of their words.
 *
 * Longest first is load-bearing for the same reason `OPERATORS` is:
 * `NATIONAL CHARACTER VARYING` must be tried before `NATIONAL CHARACTER`, or
 * the `VARYING` is left behind to be read as a column attribute.
 */
const MULTI_WORD: readonly (readonly string[])[] = Object.keys(TYPES)
  .filter((name) => name.includes(' '))
  .map((name) => name.split(' '))
  .sort((a, b) => b.length - a.length)

/** Shorthand charsets that appear where a `CHARACTER SET` clause would. */
const SHORTHAND_CHARSETS: Readonly<Record<string, string>> = { ASCII: 'latin1', UNICODE: 'ucs2' }

/** A column's declared type, as written. */
export interface DataType {
  /** The canonical MySQL spelling: `INT`, `VARCHAR`, `DOUBLE`. */
  readonly name: string
  /** The `enum_field_types` code, so M4 need not re-derive it from the name. */
  readonly code: FieldTypeCode
  /** `VARCHAR(255)`, `DECIMAL(10,2)`'s 10, `TIME(6)`'s 6, `BIT(8)`'s 8. */
  readonly length?: number
  /** `DECIMAL(10,2)`'s 2. */
  readonly scale?: number
  readonly unsigned?: boolean
  readonly zerofill?: boolean
  /** `ENUM`/`SET` members, in declaration order — index 1 is the first. */
  readonly values?: readonly string[]
  readonly charset?: string
  readonly collation?: string
  /**
   * A bare `BINARY` modifier after a string type — `VARCHAR(10) BINARY`.
   *
   * Not the same as `collation: 'binary'`: it means *the binary collation of
   * whichever charset ends up applying*, which is only known once the column,
   * table and schema defaults have been resolved. Recording it as a flag keeps
   * that resolution where it belongs, in M4, rather than guessing a charset
   * here to name a collation after.
   */
  readonly binary?: boolean
  /** `SERIAL`, which also implies UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE. */
  readonly serial?: boolean
  readonly at: number
}

/** True if the cursor is at something that could start a column type. */
export function atDataType(c: Cursor): boolean {
  const t = c.peek()
  if (t.kind !== TOKEN.IDENTIFIER || t.quoted === true) return false
  return TYPES[t.text.toUpperCase()] !== undefined || MULTI_WORD.some((words) => c.atWords(...words))
}

/**
 * Parse a column type and everything that belongs to it.
 *
 * Everything that belongs to it is more than the parentheses: `UNSIGNED`,
 * `ZEROFILL`, `CHARACTER SET`, `COLLATE`, `BINARY`, `ASCII` and `UNICODE` are
 * all part of the type rather than attributes of the column, and MySQL accepts
 * them in any order.
 */
export function parseDataType(c: Cursor, mode: SqlMode): DataType {
  const at = c.peek().start
  const name = typeName(c)
  if (name === null) c.fail()
  const spec = TYPES[name] as TypeSpec

  let code = spec.code
  let canonical = spec.as ?? name
  let length: number | undefined
  let scale: number | undefined
  let values: readonly string[] | undefined

  // `REAL` is the one type whose meaning `sql_mode` changes. The flag has been
  // parsed since M3.7 and read by nothing until here.
  if (name === 'REAL' && mode.realAsFloat) {
    code = FIELD_TYPE.FLOAT
    canonical = 'FLOAT'
  }

  switch (spec.shape) {
    case SHAPE.VALUES:
      values = valueList(c)
      break
    case SHAPE.FLOAT: {
      const args = numberList(c, 2)
      if (args.length === 1) {
        // **The trap.** One argument to `FLOAT` is a *precision* in bits of
        // mantissa, not a display width, and 24 or more makes the column a
        // DOUBLE. `FLOAT(24)` and `FLOAT(24,2)` are different types.
        const p = args[0] as number
        if (p >= 24) {
          code = FIELD_TYPE.DOUBLE
          canonical = 'DOUBLE'
        }
      } else if (args.length === 2) {
        length = args[0]
        scale = args[1]
      }
      break
    }
    case SHAPE.DECIMAL: {
      const args = numberList(c, 2)
      length = args[0]
      scale = args[1]
      break
    }
    case SHAPE.INTEGER:
    case SHAPE.FSP:
    case SHAPE.WIDTH:
    case SHAPE.TEXT:
    case SHAPE.BYTES: {
      const args = numberList(c, 1)
      length = args[0]
      break
    }
    case SHAPE.NONE:
      break
  }

  let unsigned: boolean | undefined
  let zerofill: boolean | undefined
  let charset = spec.charset
  let collation: string | undefined
  let binaryModifier: boolean | undefined

  // MySQL accepts these in any order and repeated, so this is a loop rather
  // than a fixed sequence. `ZEROFILL` implies `UNSIGNED`, which is a real rule
  // and not a convenience: `INT(4) ZEROFILL` is an unsigned column.
  for (;;) {
    if (c.takeWord('UNSIGNED')) {
      unsigned = true
      continue
    }
    if (c.takeWord('SIGNED')) {
      unsigned = false
      continue
    }
    if (c.takeWord('ZEROFILL')) {
      zerofill = true
      unsigned = true
      continue
    }
    if (spec.shape === SHAPE.TEXT || spec.shape === SHAPE.VALUES) {
      // `BINARY` here is the *binary collation of the charset*, not the BINARY
      // type: `VARCHAR(10) BINARY` is a VARCHAR that compares byte-wise. A
      // parser that read it as a type would produce a column of the wrong
      // class entirely.
      // `BYTE` is `BINARY`'s older spelling in this position, and MySQL still
      // accepts it: `ENUM('a','b') BYTE`.
      if (c.takeWord('BINARY') || c.takeWord('BYTE')) {
        binaryModifier = true
        continue
      }
      const shorthand = shorthandCharset(c)
      if (shorthand !== null) {
        charset = shorthand
        continue
      }
      if (c.takeWords('CHARACTER', 'SET') || c.takeWord('CHARSET')) {
        charset = charsetName(c)
        continue
      }
      if (c.takeWord('COLLATE')) {
        collation = charsetName(c)
        continue
      }
    }
    break
  }

  return {
    name: canonical,
    code,
    ...(length === undefined ? {} : { length }),
    ...(scale === undefined ? {} : { scale }),
    ...(unsigned === undefined ? {} : { unsigned }),
    ...(zerofill === undefined ? {} : { zerofill }),
    ...(values === undefined ? {} : { values }),
    ...(charset === undefined ? {} : { charset }),
    ...(collation === undefined ? {} : { collation }),
    ...(binaryModifier === undefined ? {} : { binary: binaryModifier }),
    ...(name === 'SERIAL' ? { serial: true } : {}),
    at,
  }
}

/**
 * The type name at the cursor, consumed. Multi-word names first.
 *
 * Returns `null` without moving when this is not a type name, so a caller can
 * use it to decide between a column definition and something else.
 */
function typeName(c: Cursor): string | null {
  for (const words of MULTI_WORD) {
    if (c.takeWords(...words)) return words.join(' ')
  }
  const t = c.peek()
  if (t.kind !== TOKEN.IDENTIFIER || t.quoted === true) return null
  const name = t.text.toUpperCase()
  if (TYPES[name] === undefined) return null
  c.skip()
  return name
}

/**
 * `ASCII` or `UNICODE` used as a charset shorthand.
 *
 * Only when it is not followed by something that would make it a type name in
 * its own right — `CHAR(10) ASCII` is latin1, but `ASCII` never starts a type,
 * so a bare match is safe here.
 */
function shorthandCharset(c: Cursor): string | null {
  for (const [word, charset] of Object.entries(SHORTHAND_CHARSETS)) {
    if (c.takeWord(word)) return charset
  }
  return null
}

/** A charset or collation name: a bare word, or a quoted string. */
function charsetName(c: Cursor): string {
  const t = c.peek()
  if (t.kind === TOKEN.IDENTIFIER || t.kind === TOKEN.STRING) {
    c.skip()
    return t.text.toLowerCase()
  }
  // `DEFAULT` is legal here and means "the table's", which the parser records
  // as written and M4 resolves.
  if (c.takeWord('DEFAULT')) return 'default'
  c.fail()
}

/** `(1)` or `(10, 2)` — up to `max` integers, or nothing at all. */
function numberList(c: Cursor, max: number): number[] {
  if (!c.atOp('(')) return []
  c.skip()
  const out: number[] = []
  do {
    const t = c.peek()
    if (t.kind !== TOKEN.NUMBER || !/^\d+$/.test(t.text)) c.fail()
    c.skip()
    out.push(Number(t.text))
  } while (c.takeOp(','))
  c.expectOp(')')
  if (out.length > max) c.fail()
  return out
}

/**
 * `('a', 'b')` — an ENUM or SET member list.
 *
 * The members are string literals, and their *order is their identity*: an
 * ENUM stores the 1-based index, so reordering the list rewrites every row's
 * meaning. That is why they are kept as written rather than sorted or
 * de-duplicated here.
 */
function valueList(c: Cursor): string[] {
  c.expectOp('(')
  const out: string[] = []
  do {
    const t = c.peek()
    // Usually a string, and sometimes not: `ENUM(0xc3a6, 0xc3b8)` and
    // `ENUM(b'1001001')` are both in MySQL's own `ctype_utf8mb4.test`. A
    // hex or bit literal is a string constant written another way, so it is a
    // member like any other — refusing it would have failed nine `CREATE`s in
    // the corpus for a syntax MySQL accepts.
    if (t.kind !== TOKEN.STRING && t.kind !== TOKEN.HEX && t.kind !== TOKEN.BIT) c.fail()
    c.skip()
    out.push(t.text)
  } while (c.takeOp(','))
  c.expectOp(')')
  return out
}
