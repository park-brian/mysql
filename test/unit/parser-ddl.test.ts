// M3.5 — `CREATE TABLE` and `DROP`, and the column types they carry.
//
// M3's exit criterion is "every `CREATE TABLE` in MySQL's own test suite
// parses", and M3.11's census is what measures that — 3,469 `CREATE`s from
// `mysql-test/t`, checked on every push. This file is the other half: the cases
// that are *hard to see* in an aggregate number, written out so a reader can
// tell what the parser claims without downloading a corpus.
//
// Several of them are here because the corpus found them, and each says so.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_TYPE } from '@myjs/bytes'
import {
  KEY,
  ParseError,
  STATEMENT,
  parseSqlMode,
  parseStatement,
  type CreateTableNode,
  type DropNode,
} from '@myjs/parser'

const create = (sql: string, sqlMode?: string): CreateTableNode => {
  const node = parseStatement(sql, sqlMode === undefined ? {} : { sqlMode: parseSqlMode(sqlMode) })
  assert.equal(node.kind, STATEMENT.CREATE_TABLE)
  return node as CreateTableNode
}

const drop = (sql: string): DropNode => {
  const node = parseStatement(sql)
  assert.equal(node.kind, STATEMENT.DROP)
  return node as DropNode
}

/** The error a statement raises. `assert.throws` returns nothing to inspect. */
const refusal = (sql: string): ParseError => {
  try {
    parseStatement(sql)
  } catch (e) {
    return e as ParseError
  }
  throw new Error(`expected ${sql} to be refused`)
}

/** The one column of a single-column table, for readable type assertions. */
const column = (type: string) => create(`CREATE TABLE t (c ${type})`).columns[0]!

test('M3.5: a column carries its charset and collation, or says it has none', () => {
  // The reason doc 29 is cited by this item. `VARCHAR(10)` means nothing until
  // you know its charset — the charset decides how many bytes ten characters
  // occupy and the collation decides how they sort — so a parser that dropped
  // the clause after the type would hand M4 a column it cannot lay out.
  const c = column('VARCHAR(10) CHARACTER SET gbk COLLATE gbk_bin')
  assert.equal(c.type.name, 'VARCHAR')
  assert.equal(c.type.code, FIELD_TYPE.VAR_STRING)
  assert.equal(c.type.length, 10)
  assert.equal(c.type.charset, 'gbk')
  assert.equal(c.type.collation, 'gbk_bin')

  // Nothing written means *inherit*, which is M4's to resolve — so it is absent
  // rather than filled in with a guess. An AST is cached at prepare time
  // (doc 03), so a guessed default would outlive the statement that made it.
  assert.equal(column('VARCHAR(10)').type.charset, undefined)

  // `CHARSET` is the short spelling and means the same thing.
  assert.equal(column('TEXT CHARSET utf8mb4').type.charset, 'utf8mb4')

  // `BINARY` here is **not** the BINARY type: it asks for the binary collation
  // of whichever charset ends up applying, which is only known after
  // resolution. Recorded as a flag for that reason.
  const bin = column('VARCHAR(10) BINARY')
  assert.equal(bin.type.code, FIELD_TYPE.VAR_STRING)
  assert.equal(bin.type.binary, true)
})

test('M3.5: FLOAT(p) is a precision and FLOAT(M,D) is not', () => {
  // The trap this table exists for. One argument to FLOAT is a precision in
  // bits of mantissa, and 24 or more makes the column a DOUBLE; two arguments
  // are the old display form and leave it a FLOAT. So `FLOAT(24)` and
  // `FLOAT(24,2)` are different types, which is not visible from the syntax.
  assert.equal(column('FLOAT').type.code, FIELD_TYPE.FLOAT)
  assert.equal(column('FLOAT(23)').type.code, FIELD_TYPE.FLOAT)
  assert.equal(column('FLOAT(24)').type.code, FIELD_TYPE.DOUBLE)
  assert.equal(column('FLOAT(53)').type.code, FIELD_TYPE.DOUBLE)
  const two = column('FLOAT(24,2)')
  assert.equal(two.type.code, FIELD_TYPE.FLOAT)
  assert.equal(two.type.length, 24)
  assert.equal(two.type.scale, 2)
})

test('M3.5: REAL is DOUBLE, and REAL_AS_FLOAT is why sql_mode reaches the type', () => {
  // `realAsFloat` has been parsed since M3.7 and read by nothing until M3.5.
  assert.equal(column('REAL').type.code, FIELD_TYPE.DOUBLE)
  assert.equal(create('CREATE TABLE t (c REAL)', 'REAL_AS_FLOAT').columns[0]!.type.code, FIELD_TYPE.FLOAT)
  // `ANSI` expands to include it, which is the reason M3.7 expands the
  // combination modes rather than matching the string.
  assert.equal(create('CREATE TABLE t (c REAL)', 'ANSI').columns[0]!.type.code, FIELD_TYPE.FLOAT)
})

test('M3.5: SERIAL is four column attributes wearing a type', () => {
  const c = column('SERIAL')
  assert.equal(c.type.code, FIELD_TYPE.LONGLONG)
  assert.equal(c.type.name, 'BIGINT')
  assert.equal(c.notNull, true)
  assert.equal(c.autoIncrement, true)
  assert.equal(c.unique, true)
})

test('M3.5: the two-word type names, and the ones that carry a charset', () => {
  assert.equal(column('DOUBLE PRECISION').type.code, FIELD_TYPE.DOUBLE)
  assert.equal(column('CHARACTER VARYING(4)').type.name, 'VARCHAR')
  assert.equal(column('LONG VARBINARY').type.code, FIELD_TYPE.MEDIUM_BLOB)
  // `LONG` on its own is MEDIUMTEXT — a compatibility spelling old enough that
  // a reader would not guess it.
  assert.equal(column('LONG').type.name, 'MEDIUMTEXT')
  // The NATIONAL family is utf8mb3 by definition, and that is part of the type.
  assert.equal(column('NCHAR(3)').type.charset, 'utf8mb3')
  assert.equal(column('NATIONAL CHARACTER VARYING(3)').type.charset, 'utf8mb3')
  // `ASCII` and `UNICODE` are charset shorthands in the attribute position.
  assert.equal(column('CHAR(3) ASCII').type.charset, 'latin1')
  assert.equal(column('CHAR(3) UNICODE').type.charset, 'ucs2')
})

test('M3.5: ENUM members keep their order, and may be written as hex or bits', () => {
  // The order *is* the identity: an ENUM stores the 1-based index, so
  // reordering the list rewrites what every stored row means.
  assert.deepEqual(column("ENUM('c','a','b')").type.values, ['c', 'a', 'b'])

  // Found by the census: `ctype_utf8mb4.test` writes members as hex and bit
  // literals, which are string constants spelled another way. Refusing them
  // failed nine `CREATE`s for a syntax MySQL accepts.
  assert.equal(column("SET('b',0xc3a6) CHARSET utf8mb3").type.values?.length, 2)
  assert.equal(column("ENUM(b'1001001') BYTE").type.binary, true)
})

test('M3.5: a key and a column of the same name are told apart by what follows', () => {
  // `KEY` and `INDEX` are legal column names, so neither can be a key
  // introducer on sight. The genuinely hard case came out of the corpus:
  //
  //     KEY timestamp (timestamp)     -- a key named `timestamp`
  //     key TIMESTAMP(6)              -- a column named `key`
  //
  // Both are a key-ish word, a type name, and a `(`. What separates them is
  // what is inside the parentheses — a type's argument is a number and an
  // index's is a column.
  const keyed = create('CREATE TABLE t (a INT, KEY timestamp (timestamp))')
  assert.equal(keyed.keys.length, 1)
  assert.equal(keyed.keys[0]!.name, 'timestamp')

  const named = create('CREATE TABLE t (`key` TIMESTAMP(6))')
  assert.equal(named.columns.length, 1)
  assert.equal(named.columns[0]!.name, 'key')
  assert.equal(named.columns[0]!.type.length, 6)

  // An unnamed key: a column can never look like this, since a column needs a
  // type.
  assert.equal(create('CREATE TABLE t (a INT, KEY (a))').keys[0]!.name, undefined)
})

test('M3.5: keys, constraints and references', () => {
  const t = create(
    'CREATE TABLE t (a INT, b INT, PRIMARY KEY (a), UNIQUE u (b DESC), ' +
      'CONSTRAINT fk FOREIGN KEY (b) REFERENCES o (c) ON DELETE SET NULL ON UPDATE CASCADE, ' +
      'CONSTRAINT ck CHECK (a > 0) NOT ENFORCED)',
  )
  assert.deepEqual(
    t.keys.map((k) => k.type),
    [KEY.PRIMARY, KEY.UNIQUE, KEY.FOREIGN],
  )
  assert.equal(t.keys[1]!.columns[0]!.desc, true)
  assert.equal(t.keys[2]!.constraint, 'fk')
  assert.equal(t.keys[2]!.references?.onDelete, 'SET NULL')
  assert.equal(t.keys[2]!.references?.onUpdate, 'CASCADE')
  assert.equal(t.checks.length, 1)
  assert.equal(t.checks[0]!.name, 'ck')
  assert.equal(t.checks[0]!.enforced, false)

  // A prefix length is how a TEXT column is indexed at all.
  assert.equal(create('CREATE TABLE t (a TEXT, KEY (a(15)))').keys[0]!.columns[0]!.length, 15)
  // A functional index, whose inner parentheses are required.
  assert.ok(create('CREATE TABLE t (a INT, KEY ((a + 1)))').keys[0]!.columns[0]!.expr !== undefined)
})

test('M3.5: table options, including the two that are not just recorded', () => {
  const t = create("CREATE TABLE t (a INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT 'x' AUTO_INCREMENT=5")
  assert.equal(t.options['ENGINE'], 'InnoDB')
  assert.equal(t.options['CHARACTER SET'], 'utf8mb4')
  assert.equal(t.options['COLLATE'], 'utf8mb4_bin')
  assert.equal(t.options['COMMENT'], 'x')
  assert.equal(t.options['AUTO_INCREMENT'], '5')
  // The `=` is optional and so is the comma between options.
  assert.equal(create('CREATE TABLE t (a INT) ENGINE InnoDB, MAX_ROWS=1').options['ENGINE'], 'InnoDB')
})

test('M3.5: being more permissive than the server is a bug too', () => {
  // Every case here carries `--error ER_PARSE_ERROR` in MySQL's own
  // `create.test`, and every one of them parsed until the census's
  // expected-failure accounting reported that we accepted SQL a real server
  // rejects. That is a divergence in the direction a parse-rate cannot see.
  assert.throws(() => parseStatement('CREATE TABLE t (a INT,)'), ParseError)
  assert.throws(() => parseStatement('CREATE TABLE t (a INT) ROW_FORMAT=PAGE'), ParseError)
  // `create.test` says why in its own comments: KEY_BLOCK_SIZE is "2 bytes in
  // frm", so an explicit check bounds it at 65535 — which is why 2147483647 is
  // rejected even though it fits a 32-bit unsigned.
  assert.throws(() => parseStatement('CREATE TABLE t (a INT) KEY_BLOCK_SIZE = 2147483647'), ParseError)
  assert.throws(() => parseStatement('CREATE TABLE t (a INT) KEY_BLOCK_SIZE = -1'), ParseError)
  assert.equal(create('CREATE TABLE t (a INT) KEY_BLOCK_SIZE = 8').options['KEY_BLOCK_SIZE'], '8')
})

test('M3.5: DEFAULT takes a literal, a bare function, or a parenthesised expression', () => {
  assert.equal(column("INT DEFAULT 1").default?.kind, 'literal')
  // `CURRENT_TIMESTAMP` may be written without parentheses, and with an fsp.
  const ts = create('CREATE TABLE t (c TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6))')
  assert.equal(ts.columns[0]!.default?.kind, 'call')
  assert.equal(ts.columns[0]!.onUpdate?.kind, 'call')
  // Since 8.0.13 an expression default is allowed, with the parentheses
  // *required* — they are syntax rather than grouping.
  assert.equal(column('INT DEFAULT (1 + 1)').default?.kind, 'binary')

  // A typed temporal literal, found by the census in `default.test`. It is a
  // DATE rather than the string it is written with, which is why a bare string
  // default would not be legal in the same place.
  const d = column("DATE DEFAULT DATE'2019-10-01'")
  assert.equal(d.default?.kind, 'literal')
  assert.equal((d.default as { type: string; unit?: string }).type, 'temporal')
  assert.equal((d.default as { unit?: string }).unit, 'DATE')
})

test('M3.5: generated columns record which kind they are', () => {
  // `STORED` and `VIRTUAL` are not interchangeable: a stored column occupies
  // row space and can be indexed by any engine.
  const stored = create('CREATE TABLE t (a INT, b INT GENERATED ALWAYS AS (a + 1) STORED)')
  assert.equal(stored.columns[1]!.generated?.stored, true)
  const virtual = create('CREATE TABLE t (a INT, b INT AS (a + 1))')
  assert.equal(virtual.columns[1]!.generated?.stored, false)
})

test('M3.5: DROP, in the forms that differ from each other', () => {
  const many = drop('DROP TABLE IF EXISTS a, b.c')
  assert.equal(many.ifExists, true)
  assert.deepEqual(many.names, [{ name: 'a' }, { schema: 'b', name: 'c' }])

  const index = drop('DROP INDEX i ON t ALGORITHM = INPLACE')
  assert.equal(index.object, 'INDEX')
  assert.deepEqual(index.on, { name: 't' })

  assert.equal(drop('DROP SCHEMA d').object, 'DATABASE')
  assert.equal(drop('DROP TEMPORARY TABLE t').temporary, true)
  assert.equal(drop('DROP VIEW v RESTRICT').behaviour, 'RESTRICT')
})

test('M3.5: what is not implemented says so, and is not a syntax error', () => {
  // The distinction the census turns on. `SELECT 1` is valid SQL; reporting it
  // as malformed would be a lie, and counting it as a parse failure would make
  // M3's exit criterion measure M3.3's absence rather than M3.5's coverage.
  for (const sql of ['SELECT 1', 'INSERT INTO t VALUES (1)', 'ALTER TABLE t ADD a INT', 'CREATE VIEW v AS SELECT 1']) {
    const e = refusal(sql)
    assert.equal(e.code, 'ER_NOT_SUPPORTED_YET', sql)
    assert.equal(e.errno, 1235, sql)
  }

  // `CREATE TABLE ... SELECT` is the interesting one: the DDL half parses and
  // only the query body is missing, so it is unimplemented rather than
  // malformed. There are 313 of them in the corpus, and counting them as
  // failures would have hidden that everything else parses.
  assert.equal(refusal('CREATE TABLE t (a INT) SELECT 1').code, 'ER_NOT_SUPPORTED_YET')

  // A genuine syntax error is still 1064.
  assert.equal(refusal('CREATE TABLE t (a NOTATYPE)').errno, 1064)
})

test('M3.5: a second statement is refused rather than ignored', () => {
  // D-13 gates multi-statement execution off because it "turns a SQL-injection
  // point into arbitrary statement execution". Silently parsing the first and
  // dropping the rest would be the same hole with a quieter failure mode.
  assert.equal(drop('DROP TABLE t;').names.length, 1)
  assert.throws(() => parseStatement('DROP TABLE t; DROP TABLE u'), ParseError)
})
