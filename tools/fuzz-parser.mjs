#!/usr/bin/env node
// M3.10 — arbitrary text into the lexer and the expression parser.
//
// Ground rule 5, doc 43 §6: a typed error, never a crash, never a hang, never
// an out-of-bounds read. Doc 43's attack-surface table names this one directly
// — "SQL text | arbitrary strings to the parser" — and it is the surface
// reachable from an unauthenticated `COM_QUERY`, so the invariant is not a
// nicety.
//
// The shape is `fuzz-reader.mjs`'s, deliberately: a seeded xorshift32 so a
// crasher replays from its seed, a per-input time budget so a hang is caught as
// a hang rather than as a CI timeout, and a crasher written into the corpus
// where it becomes a regression test.
//
// The one real difference is the generator. Uniform random bytes mostly
// exercise the first token and stop, so this builds SQL-shaped noise instead:
// quotes, backslashes, backticks, comment openers, and gbk lead bytes. A
// generator that never emits a quote never tests the string scanner, and the
// string scanner is where the interesting bugs are.
import { lex, lexBytes, parseExpression, parseStatement, parseSqlMode, ParseError } from '@myjs/parser'
import { roundTrip } from './lib/round-trip.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { xorshift } from './lib/cli.mjs'

const RUNS = Number(process.env.FUZZ_RUNS ?? 1_000_000)
const SEED = Number(process.env.FUZZ_SEED ?? (Date.now() & 0x7fffffff))
const PER_INPUT_BUDGET_MS = Number(process.env.FUZZ_INPUT_BUDGET_MS ?? 250)
const CORPUS = new URL('../test/format/fuzz-corpus/', import.meta.url).pathname

/** xorshift32, seeded (`tools/lib/cli.mjs`), so a seed reproduces the corpus. */
const { rnd } = xorshift(SEED)
const randInt = (n) => Math.floor(rnd() * n)
const pick = (xs) => xs[randInt(xs.length)]

/**
 * Fragments worth combining.
 *
 * Chosen for the places a lexer or parser can lose its footing: an opener with
 * no closer, an escape at the very end of the input, a comment that never
 * terminates, an operator where an operand belongs, and deep nesting.
 */
const FRAGMENTS = [
  "'", '"', '`', "\\'", '\\', '--', '-- ', '#', '/*', '*/', '/*!', '/*!99999', '/*+',
  'SELECT', 'NOT', 'AND', 'OR', 'XOR', 'BETWEEN', 'IN', 'LIKE', 'ESCAPE', 'IS', 'NULL',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'INTERVAL', 'DAY', 'COLLATE', 'DISTINCT', 'DIV',
  '(', ')', ',', '.', '?', '@', '@@', '_latin1', 'x', 'b', '0x', '0b',
  '+', '-', '*', '/', '%', '=', '<', '>', '<=>', '<<', '>>', '||', '&&', '!', '~', '^', '|', '&', ':=',
  '1', '2.5', '1e999', "'a'", '`a`', 'a', ' ', '\n', '\t', '\0',

  // M3.5's surface. Without these a million inputs almost never reach past the
  // dispatcher, so `parseStatement` would be fuzzed in name only — the same
  // mistake as the nesting bound below, which sat under the crash threshold and
  // made a clean run mean nothing. A generator's bounds are part of what it
  // tests.
  'CREATE', 'TABLE', 'TEMPORARY', 'IF', 'EXISTS', 'DROP', 'INDEX', 'VIEW', 'SCHEMA',
  'INT', 'VARCHAR', 'DECIMAL', 'ENUM', 'SET', 'FLOAT', 'SERIAL', 'BLOB', 'TEXT', 'GEOMETRY',
  'UNSIGNED', 'ZEROFILL', 'CHARACTER SET', 'CHARSET', 'BINARY', 'NATIONAL', 'DOUBLE PRECISION',
  'PRIMARY', 'KEY', 'UNIQUE', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'CHECK', 'DEFAULT',
  'AUTO_INCREMENT', 'GENERATED', 'ALWAYS', 'AS', 'STORED', 'VIRTUAL', 'COMMENT', 'USING',
  'ENGINE', 'ROW_FORMAT', 'KEY_BLOCK_SIZE', 'LIKE', 'ON', 'DELETE', 'CASCADE', ';',

  // M3.3 and M3.4's surface, for the same reason.
  'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET', 'WITH ROLLUP', 'ASC', 'DESC',
  'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'NATURAL',
  'STRAIGHT_JOIN', 'LATERAL', 'DUAL', 'WITH', 'RECURSIVE', 'VALUES', 'VALUE', 'ROW', 'TABLE', 'OVER',
  'PARTITION BY', 'WINDOW', 'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING', 'CURRENT ROW', 'UNBOUNDED',
  'INTO', '@v', 'OUTFILE', 'DUMPFILE', 'FOR UPDATE', 'FOR SHARE', 'NOWAIT', 'LOCK IN SHARE MODE',
  'CAST(', 'CONVERT(', 'USING', 'SIGNED', 'ANY', 'SOME', 'EXISTS', 'MATCH', 'AGAINST', 'MEMBER OF',
  'GROUP_CONCAT(', 'SEPARATOR', 'TRIM(', 'LEADING', 'EXTRACT(', 'SUBSTRING(', 'POSITION(', 'FOR',
  'INSERT', 'REPLACE', 'UPDATE', 'IGNORE', 'DUPLICATE', 'QUICK', 'LOW_PRIORITY', '{', '}', 'OJ', '->', '->>',
  'USE INDEX', 'FORCE KEY', 'N', "N'x'", '_binary', "x'41'", 't', 't.a', 't.*', '*',

  // M3.6's surface.
  'GLOBAL', 'SESSION', 'LOCAL', 'PERSIST', 'PERSIST_ONLY', '@@global.', '@@x', 'NAMES', 'TRANSACTION',
  'ISOLATION LEVEL', 'READ ONLY', 'READ WRITE', 'SERIALIZABLE', 'SHOW', 'FULL', 'EXTENDED', 'COLUMNS',
  'FIELDS', 'TABLES', 'STATUS', 'VARIABLES', 'WARNINGS', 'COUNT(*)', 'GRANTS', 'EXPLAIN', 'DESCRIBE',
  'ANALYZE', 'FORMAT=', 'TREE', 'CONNECTION', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
  'RELEASE', 'CHAIN', 'NO', 'WORK', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'DO', 'USE',

  // M3.5's second half.
  'ALTER', 'ADD', 'MODIFY', 'CHANGE', 'AFTER', 'FIRST', 'RENAME', 'TO', 'CONVERT TO', 'ENABLE KEYS',
  'ALGORITHM=', 'LOCK=', 'PARTITION', 'PARTITIONS', 'SUBPARTITION', 'LINEAR', 'HASH', 'LESS THAN',
  'MAXVALUE', 'COLUMNS', 'DATABASE',

  // M3.17's surface.
  'CHECK TABLE', 'CHECKSUM', 'OPTIMIZE', 'REPAIR', 'FOR UPGRADE', 'QUICK', 'USE_FRM', 'HISTOGRAM', 'BUCKETS',
  'USING DATA', 'FLUSH', 'PRIVILEGES', 'LOGS', 'FOR EXPORT', 'WITH READ LOCK', 'TRUNCATE', 'LOCK TABLES',
  'UNLOCK', 'WRITE', 'INSTANCE', 'LOAD DATA', 'INFILE', 'TERMINATED BY', 'ENCLOSED BY', 'LINES', 'IGNORE 1 ROWS',
  'GRANT', 'REVOKE', 'PROXY', 'ON *.*', 'WITH GRANT OPTION', 'WITH ADMIN OPTION', 'CREATE USER', "'u'@'h'",
  'u@localhost', 'IDENTIFIED BY', 'RANDOM PASSWORD', 'REQUIRE SSL', 'ACCOUNT LOCK', 'PASSWORD EXPIRE',
  'DEFAULT ROLE', 'CURRENT_USER', 'RESET', 'REPLICA', 'PERSIST',
]

/**
 * Whole statements to splice fragments into. Fragments alone rarely add up to
 * a query that parses, and a statement that never parses never reaches the
 * deparser — so a share of the inputs start from one of these and are mutated,
 * which is what puts the round-trip target below to work.
 */
const SEEDS = [
  'SELECT a, b FROM t WHERE a = 1',
  'SELECT a FROM t JOIN u ON t.a = u.a LEFT JOIN v USING (a)',
  'SELECT 1 UNION ALL SELECT 2 INTERSECT SELECT 3 ORDER BY 1 LIMIT 1',
  'WITH c AS (SELECT 1) SELECT * FROM c',
  'SELECT (SELECT 1) FROM (SELECT 2) AS d WHERE a IN (SELECT b FROM u)',
  'SELECT SUM(a) OVER (PARTITION BY b ORDER BY c ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) FROM t',
  'INSERT INTO t (a, b) VALUES (1, 2), (3, DEFAULT) ON DUPLICATE KEY UPDATE b = 1',
  'UPDATE t, u SET t.a = u.a WHERE 1',
  'DELETE t FROM t JOIN u ON 1 WHERE 1',
  'SELECT CAST(a AS CHAR(3)), TRIM(LEADING 1 FROM a), EXTRACT(DAY FROM a) FROM t',
  "SET GLOBAL a = 1, b = DEFAULT, @c := 2, NAMES utf8mb4 COLLATE utf8mb4_bin, @@session.d = ON",
  'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY',
  "SHOW EXTENDED FULL COLUMNS FROM t FROM d LIKE 'a%'",
  'EXPLAIN ANALYZE FORMAT = TREE FOR SCHEMA d SELECT 1',
  "PREPARE s FROM 'SELECT 1'",
  'COMMIT AND NO CHAIN RELEASE',
  "ALTER TABLE t ADD a INT FIRST, MODIFY b BIGINT AFTER a, DROP INDEX i, ALTER c SET DEFAULT -1, ENGINE=InnoDB",
  'CREATE TABLE t (x INT) PARTITION BY RANGE (x) (PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN MAXVALUE)',
  'CREATE UNIQUE INDEX i ON t (a DESC, (b + 1))',
  'ANALYZE TABLE t UPDATE HISTOGRAM ON a, b WITH 10 BUCKETS MANUAL UPDATE',
  'FLUSH LOCAL TABLES t, u WITH READ LOCK',
  "LOAD DATA LOCAL INFILE 'f' REPLACE INTO TABLE t FIELDS TERMINATED BY ',' LINES STARTING BY 'x' IGNORE 1 LINES (a, @b) SET c = @b",
  "GRANT SELECT (a), r1 ON d.* TO 'u'@'%' WITH GRANT OPTION AS CURRENT_USER WITH ROLE ALL EXCEPT r2",
  "CREATE USER IF NOT EXISTS u IDENTIFIED BY 'p' DEFAULT ROLE r REQUIRE SSL WITH MAX_USER_CONNECTIONS 1 PASSWORD EXPIRE NEVER COMMENT 'c'",
  "SET PASSWORD FOR u = 'p' REPLACE 'q' RETAIN CURRENT PASSWORD",
]

/**
 * Long left-associative chains: `1+1+…`, `a OR a OR …`, `t JOIN t ON 1 …`,
 * `SELECT 1 UNION …`. The parser builds these with loops, not recursion, so
 * the nesting bound never sees them — and before D-40 a 5,000-link `JOIN …
 * ON` chain was a `RangeError` at parse time that no other generator here
 * could reach, because none repeated a binary fragment. M3.10's lesson again:
 * a generator's bounds are part of what it tests.
 */
const CHAINS = [
  ['SELECT 1', '+1'],
  ['SELECT a', ' OR a'],
  ['SELECT 1 FROM a JOIN b', ' JOIN t ON 1'],
  ['SELECT 1 FROM a', ' JOIN t ON 1'],
  ['SELECT 1', ' UNION SELECT 1'],
  ['SELECT 1 FROM a', ', t'],
]

/** A statement-shaped string. */
function makeText() {
  if (rnd() < 0.002) {
    const [head, link] = pick(CHAINS)
    return head + link.repeat(1 + randInt(6000))
  }
  if (rnd() < 0.4) return mutate(pick(SEEDS))
  const n = 1 + randInt(12)
  let out = ''
  for (let i = 0; i < n; i++) {
    const roll = rnd()
    // Deep enough to cross the parser's nesting limit. The first version of
    // this capped at 40, which sat just under the depth where the parser blew
    // the JavaScript stack — so a million inputs found nothing and reading the
    // code found it instead. A generator's bounds are part of what it tests.
    if (roll < 0.08) out += '('.repeat(1 + randInt(400))
    else if (roll < 0.12) out += String.fromCharCode(randInt(0x110000 - 0x800) + 0x800) // astral and CJK
    else out += pick(FRAGMENTS)
  }
  return out
}

/** A seed statement with a few tokens replaced, inserted or deleted. */
function mutate(seed) {
  const words = seed.split(' ')
  for (let k = randInt(3); k > 0; k--) {
    const at = randInt(words.length + 1)
    const roll = rnd()
    if (roll < 0.4) words.splice(at, 1, pick(FRAGMENTS))
    else if (roll < 0.8) words.splice(at, 0, pick(FRAGMENTS))
    else words.splice(at, 1)
  }
  return words.join(' ')
}

/** Raw bytes, so the charset-decoding path is exercised too. */
function makeBytes() {
  const n = randInt(48)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    // Biased toward the bytes that matter: quote, backslash, backtick, and the
    // gbk/sjis lead-byte range where a trail byte can be an ASCII backslash.
    const roll = rnd()
    out[i] = roll < 0.2 ? pick([0x27, 0x22, 0x60, 0x5c, 0x23, 0x2d, 0x2a, 0x2f]) : roll < 0.4 ? 0x81 + randInt(0x7e) : randInt(256)
  }
  return out
}

const MODES = ['', 'ANSI_QUOTES', 'NO_BACKSLASH_ESCAPES', 'PIPES_AS_CONCAT', 'HIGH_NOT_PRECEDENCE', 'IGNORE_SPACE', 'ANSI']
// gbk, big5, sjis, cp932, euckr, gb18030, latin1, utf8mb4 — the collations
// whose decoders differ, so the byte path is not always UTF-8.
const COLLATIONS = [255, 28, 1, 13, 95, 19, 248, 8]

function recordCrasher(input, op, err) {
  mkdirSync(CORPUS, { recursive: true })
  const file = join(CORPUS, `parser-crash-${SEED}-${Date.now()}.json`)
  writeFileSync(
    file,
    JSON.stringify(
      {
        seed: SEED,
        op,
        input: typeof input === 'string' ? input : [...input],
        error: { name: err?.name ?? 'unknown', message: String(err?.message ?? err) },
      },
      null,
      2,
    ) + '\n',
  )
  return file
}

let refusals = 0
let roundTrips = 0
const started = Date.now()

for (let i = 0; i < RUNS; i++) {
  const asBytes = rnd() < 0.35
  const input = asBytes ? makeBytes() : makeText()
  const mode = parseSqlMode(pick(MODES))
  // M3.5 added a second parser over the same token stream, so it is a second
  // target: a `CREATE TABLE` reachable from an untrusted `COM_QUERY` has the
  // same obligation as the expression parser under it.
  const op = asBytes ? 'lexBytes' : ['lex', 'parseExpression', 'parseStatement'][Math.floor(rnd() * 3)]
  const at = Date.now()
  try {
    if (op === 'lexBytes') lexBytes(input, { collationId: pick(COLLATIONS), sqlMode: mode })
    else if (op === 'lex') lex(input, { sqlMode: mode })
    else if (op === 'parseExpression') parseExpression(input, { sqlMode: mode })
    else {
      // A statement that parses must also survive the deparser: M3.3's
      // acceptance property, checked over inputs nobody wrote by hand.
      const ast = parseStatement(input, { sqlMode: mode })
      const broken = roundTrip(ast, { sqlMode: mode })
      roundTrips++
      if (broken !== null) {
        const file = recordCrasher(input, 'roundTrip', new Error(`${broken.error}: ${broken.sql}`))
        console.error(`round-trip failed at iteration ${i} (seed ${SEED}): ${broken.error}\n  in:  ${input}\n  out: ${broken.sql}`)
        console.error(`corpus: ${file}`)
        process.exit(1)
      }
    }
  } catch (err) {
    if (err instanceof ParseError) {
      refusals++
    } else {
      // Anything that is not a typed refusal is the bug this exists to find.
      const file = recordCrasher(input, op, err)
      console.error(`crash at iteration ${i} (seed ${SEED}, ${op}): ${err?.name}: ${err?.message}`)
      console.error(`corpus: ${file}`)
      process.exit(1)
    }
  }
  const elapsed = Date.now() - at
  if (elapsed > PER_INPUT_BUDGET_MS) {
    const file = recordCrasher(input, op, new Error(`took ${elapsed}ms`))
    console.error(`hang at iteration ${i} (seed ${SEED}, ${op}): ${elapsed}ms`)
    console.error(`corpus: ${file}`)
    process.exit(1)
  }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  `fuzz: ${RUNS.toLocaleString()} inputs in ${seconds}s, seed ${SEED}; ` +
    `${refusals.toLocaleString()} ParseErrors, ${roundTrips.toLocaleString()} statements round-tripped, 0 crashes, 0 hangs`,
)
