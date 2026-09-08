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
import { charsetTranscoder, charsetVariables, parseSetNames } from '@myjs/core'

const session = () => new Session({ connectionId: 1, capabilities: capabilities(0) })

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
