// M2.18 — the `Transcoder` seam and `SET NAMES`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHARSET_BINARY,
  CHARSET_UTF8MB4_0900_AI_CI,
  Session,
  capabilities,
  utf8Transcoder,
} from '@myjs/protocol'
import { SqlExecutor, charsetChange, charsetTranscoder, charsetVariables } from '@myjs/core'
import { STATEMENT, parseStatement } from '@myjs/parser'

const session = () => new Session({ connectionId: 1, capabilities: capabilities(0) })

/**
 * The charset change a statement asks for — its last `NAMES` or `CHARACTER SET`
 * item — or `null`. M3.6 replaced the regex this file used to test with the
 * parser, so the cases below now go through the same path a `COM_QUERY` does.
 */
const parseSetNames = (sql: string) => {
  const node = parseStatement(sql)
  if (node.kind !== STATEMENT.SET) return null
  const item = [...node.items].reverse().find((i) => i.type === 'names' || i.type === 'charset')
  return item === undefined || (item.type !== 'names' && item.type !== 'charset') ? null : charsetChange(item)
}

test('D-33: a session gets the UTF-8-only transcoder unless one is supplied', () => {
  assert.equal(session().transcoder, utf8Transcoder)
  const custom = new Session({ connectionId: 1, capabilities: capabilities(0), transcoder: charsetTranscoder })
  assert.equal(custom.transcoder, charsetTranscoder)
})

test('D-33: the built-in transcoder handles utf8mb4 and refuses the rest', () => {
  const text = 'héllo €'
  assert.equal(utf8Transcoder.decode(utf8Transcoder.encode(text, 255), 255), text)
  // latin1 (8) and binary (63) both need the registry.
  assert.throws(() => utf8Transcoder.encode(text, 8), /transcoder/)
  assert.throws(() => utf8Transcoder.decode(new Uint8Array([1]), CHARSET_BINARY), /transcoder/)
  // Refusing is the point: latin1 bytes read as UTF-8 do not throw, they turn
  // into replacement characters that reach the application as data.
})

test('M2.18: the real transcoder round-trips latin1', () => {
  assert.deepEqual(charsetTranscoder.encode('€', 8), Uint8Array.from([0x80]))
  assert.equal(charsetTranscoder.decode(Uint8Array.from([0x80]), 8), '€')
  assert.equal(charsetTranscoder.decode(charsetTranscoder.encode('naïve', 8), 8), 'naïve')
})

test('M2.18: SET NAMES resolves a charset to its default collation', () => {
  assert.deepEqual(parseSetNames('SET NAMES utf8mb4'), {
    collationId: 255,
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_ai_ci',
  })
  assert.deepEqual(parseSetNames('SET NAMES latin1'), {
    collationId: 8,
    charset: 'latin1',
    collation: 'latin1_swedish_ci',
  })
  // Doc 29: HandshakeV10 carries one byte, so id 255 is unreachable at
  // connect time. `SET NAMES` is how a client actually gets there.
  assert.ok((parseSetNames('SET NAMES utf8mb4') as { collationId: number }).collationId > 255 === false)
})

test('M2.18: SET NAMES ... COLLATE picks an explicit collation', () => {
  assert.deepEqual(parseSetNames('SET NAMES utf8mb4 COLLATE utf8mb4_bin'), {
    collationId: 46,
    charset: 'utf8mb4',
    collation: 'utf8mb4_bin',
  })
  // A COLLATE that does not belong to the named charset is an error in MySQL,
  // not a silent override of the charset.
  assert.equal(parseSetNames('SET NAMES utf8mb4 COLLATE latin1_swedish_ci'), 'unknown')
})

test('M2.18: quoting and casing are accepted, as a real client sends them', () => {
  assert.equal((parseSetNames("set names 'utf8mb4'") as { collationId: number }).collationId, 255)
  assert.equal((parseSetNames('SET NAMES "latin1";') as { collationId: number }).collationId, 8)
  assert.equal((parseSetNames('SET CHARACTER SET latin1') as { collationId: number }).collationId, 8)
  assert.equal((parseSetNames('SET NAMES DEFAULT') as { collationId: number }).collationId, 255)
})

test('M2.18: a charset MySQL does not have is refused, not guessed at', () => {
  assert.equal(parseSetNames('SET NAMES nosuchcharset'), 'unknown')
})

test('M2.18: anything that is not a charset change returns null and falls through', () => {
  assert.equal(parseSetNames('SET autocommit = 1'), null)
  assert.equal(parseSetNames('SELECT 1'), null)
  assert.equal(parseSetNames('SET sql_mode = "ANSI_QUOTES"'), null)
})

test('M2.18: the character_set_* variables follow the session, not a constant', () => {
  const utf8 = charsetVariables(CHARSET_UTF8MB4_0900_AI_CI)
  assert.equal(utf8.character_set_client, 'utf8mb4')
  assert.equal(utf8.collation_connection, 'utf8mb4_0900_ai_ci')

  const latin1 = charsetVariables(8)
  assert.equal(latin1.character_set_client, 'latin1')
  assert.equal(latin1.character_set_results, 'latin1')
  assert.equal(latin1.collation_connection, 'latin1_swedish_ci')
  // `character_set_server` is the server's, and does not move with the session.
  assert.equal(latin1.character_set_server, 'utf8mb4')
})

test('M2.18: session.characterSet is now interpreted rather than merely stored', () => {
  const s = session()
  assert.equal(s.characterSet, CHARSET_UTF8MB4_0900_AI_CI)
  const change = parseSetNames('SET NAMES latin1') as { collationId: number }
  s.characterSet = change.collationId
  assert.equal(charsetVariables(s.characterSet).character_set_client, 'latin1')
})

// --- M3.6: SET reaches the session ------------------------------------------

/** A stub-backed session that runs statements and reads variables back. */
const live = () => {
  const s = new Session({ connectionId: 1, capabilities: capabilities(0), transcoder: charsetTranscoder })
  const stub = new SqlExecutor()
  const run = (sql: string) => stub.query(s, sql)
  const read = async (variable: string) => {
    const result = await run(`SELECT ${variable}`)
    // M5: a string comes back as bytes in the session's result charset, as
    // it goes onto the wire.
    const v = (result as { rows: unknown[][] }).rows[0]?.[0]
    return v instanceof Uint8Array ? s.transcoder.decode(v, s.characterSet) : v
  }
  return { s, run, read }
}

test('M3.6: SET sql_mode reaches the session, in the form @@sql_mode reports', async () => {
  const { s, run, read } = live()
  await run("SET sql_mode = 'ansi'")
  // What 8.4.11 answers for the same statement: the expansion, in bit order,
  // with the combination name kept.
  assert.equal(s.sqlMode, 'REAL_AS_FLOAT,PIPES_AS_CONCAT,ANSI_QUOTES,IGNORE_SPACE,ONLY_FULL_GROUP_BY,ANSI')
  assert.equal(await read('@@sql_mode'), s.sqlMode)
  await run('SET SESSION sql_mode = NO_ZERO_DATE')
  assert.equal(s.sqlMode, 'NO_ZERO_DATE')
  await run("SET @@sql_mode = ''")
  assert.equal(s.sqlMode, '')
  // GLOBAL leaves the session alone, as it does on a real server.
  await run("SET GLOBAL sql_mode = 'ANSI_QUOTES'")
  assert.equal(s.sqlMode, '')
  assert.equal(await read('@@global.sql_mode'), 'ANSI_QUOTES')
  // An unknown mode is ER_WRONG_VALUE_FOR_VAR, with MySQL's message, and changes nothing.
  await assert.rejects(run("SET sql_mode = 'nonsense'"), (e: Error & { errno?: number }) => e.errno === 1231)
  assert.equal(s.sqlMode, '')
})

test("review: a session starts in 8.4.11's sql_mode, and a strict mode without the date modes warns 3135", async () => {
  const { s, run, read } = live()
  // 8.4.11's default, which `SELECT @@SESSION.sql_mode` reads on a fresh
  // connection; this was 5.7's `STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION`.
  const DEFAULT = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'
  assert.equal(s.sqlMode, DEFAULT)
  assert.equal(await read('@@global.sql_mode'), DEFAULT)
  const warnings = async (sql: string) => ((await run(sql)) as { warnings?: number }).warnings ?? 0
  // NO_ZERO_DATE, NO_ZERO_IN_DATE and ERROR_FOR_DIVISION_BY_ZERO belong with
  // a strict mode, all three or none: each line is what 8.4.11 answers.
  assert.equal(await warnings("SET sql_mode = 'STRICT_TRANS_TABLES'"), 1)
  assert.equal(await warnings("SET sql_mode = 'NO_ZERO_DATE'"), 1)
  assert.equal(await warnings("SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE'"), 1)
  assert.equal(await warnings("SET sql_mode = 'TRADITIONAL'"), 0)
  assert.equal(await warnings("SET sql_mode = ''"), 0)
  assert.equal(await warnings('SET sql_mode = DEFAULT'), 0)
  // DEFAULT is the global's value, and is checked like any other.
  assert.equal(await warnings("SET GLOBAL sql_mode = 'STRICT_ALL_TABLES'"), 1)
  assert.equal(await warnings('SET sql_mode = DEFAULT'), 1)
  assert.equal(await warnings("SET sql_mode = 'STRICT_TRANS_TABLES', @@session.sql_mode = 'NO_ZERO_DATE'"), 2)
})

test("M3.6: the session's sql_mode decides how its next statement is parsed", async () => {
  const { s, run } = live()
  // `'latin1\'` never closes by default, since `\'` escapes the quote…
  await assert.rejects(run("SET NAMES 'latin1\\'"), (e: Error & { errno?: number }) => e.errno === 1064)
  await run("SET sql_mode = 'NO_BACKSLASH_ESCAPES'")
  // …and under NO_BACKSLASH_ESCAPES it is a closed literal naming no charset.
  await assert.rejects(run("SET NAMES 'latin1\\'"), (e: Error & { errno?: number }) => e.errno === 1115)
  assert.equal(s.characterSet, CHARSET_UTF8MB4_0900_AI_CI)
})

test('M3.6: SET NAMES is one item of a list, not the whole statement', async () => {
  const { s, run, read } = live()
  await run('SET @a = 1, NAMES latin1, autocommit = 1')
  assert.equal(s.characterSet, 8)
  assert.equal(await read('@@character_set_client'), 'latin1')
  await run('USE `my db`')
  assert.equal(s.database, 'my db')
})

test('review: the SETs a driver sends on connect still succeed against the stub', async () => {
  const { s, run, read } = live()
  await run('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED')
  await run("SET PASSWORD = 'x'")
  // Parsed since M3.17, and still answered OK rather than refused.
  await run('SET ROLE DEFAULT')
  await run('SET DEFAULT ROLE ALL TO u')
  await run('FLUSH PRIVILEGES')
  await run('FLUSH TABLES')
  await run('SET RESOURCE GROUP g')
  await run("SET SESSION sql_mode = 'ANSI_QUOTES'")
  // An expression needs the executor: accepted, and nothing changes.
  await run("SET SESSION sql_mode = (SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))")
  assert.equal(s.sqlMode, 'ANSI_QUOTES')
  await assert.rejects(run('SET sql_mode = NULL'), (e: Error & { errno?: number }) => e.errno === 1231)
  assert.equal(await read('@@local.sql_mode'), 'ANSI_QUOTES')
})
