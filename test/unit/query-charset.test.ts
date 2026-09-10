// A query's text is in the session's charset, not in UTF-8.
//
// `parseComQuery` used to call `fromUtf8` on the statement body and never
// consult `Session.transcoder`, which is right for the default and silently
// wrong for every other charset. That is E-11's mistake — assuming one charset
// for everything — one layer up, and doc 14's own sketch already had it right:
// it writes `parseComQuery(session, payload)`.
//
// Both cases below fail against that code, for different reasons, which is why
// there are two: the latin1 one is a *corruption* (a byte that means something
// becomes U+FFFD), and the gbk one is the *security* case M3.1 is built around.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writer } from '@myjs/bytes'
import { CLIENT, COM, Session, capabilities, dispatch } from '@myjs/protocol'
import type { DispatchContext, Executor, Parameter, StatementResult } from '@myjs/protocol'
import { charsetTranscoder } from '@myjs/core'
import { canDecode, encodeCharset } from '@myjs/charsets'

const CAPS = capabilities(CLIENT.PROTOCOL_41 | CLIENT.TRANSACTIONS | CLIENT.DEPRECATE_EOF)

/** Records the SQL it was handed, which is the whole point of these tests. */
class Recorder implements Executor {
  sql = ''
  async query(_s: Session, sql: string): Promise<StatementResult> {
    this.sql = sql
    return { affectedRows: 0 }
  }
  async prepare(_s: Session, sql: string) {
    this.sql = sql
    return { paramCount: 0, columns: [] }
  }
  async execute(_s: Session, sql: string, _p: readonly Parameter[]): Promise<StatementResult> {
    this.sql = sql
    return { affectedRows: 0 }
  }
}

/** A session that speaks `collationId` and has the real registry-backed transcoder. */
function contextFor(collationId: number): { ctx: DispatchContext; executor: Recorder } {
  const executor = new Recorder()
  const session = new Session({ connectionId: 1, capabilities: CAPS, transcoder: charsetTranscoder })
  session.characterSet = collationId
  return { ctx: { session, executor, capabilities: CAPS }, executor }
}

function comQuery(bytes: Uint8Array): Uint8Array {
  const w = new Writer()
  w.u8(COM.QUERY)
  w.bytes(bytes)
  return w.toBytes()
}

test('a latin1 session’s query keeps its bytes’ meaning', async () => {
  // `0x80` is the euro sign in MySQL's latin1 (which is cp1252 — M2.3, E-11)
  // and is not valid UTF-8 at all. Decoded as UTF-8 it becomes U+FFFD, so the
  // statement the executor ran was not the statement the client sent.
  const { ctx, executor } = contextFor(8)
  await dispatch(comQuery(encodeCharset("SELECT '€'", 'latin1')), ctx)
  assert.equal(executor.sql, "SELECT '€'")
  assert.ok(!executor.sql.includes('�'), 'a replacement character means the decode was wrong')
})

test('M3.1 groundwork: a gbk lead byte does not smuggle a backslash through', async () => {
  // The classic multi-byte injection: in gbk, `BF 5C` is one character whose
  // trail byte is the ASCII backslash. A client that escapes `'` to `\'` over
  // raw bytes emits `BF 5C 27`, and anything that reads those bytes as ASCII
  // sees an escape followed by a live quote — the quote escapes the literal.
  //
  // Decoding with the session's charset closes it by construction: `BF 5C`
  // becomes one character and there is no backslash left to find. This is the
  // property M3.1's lexer inherits, asserted here at the layer that produces
  // the string it will lex.
  if (!canDecode('gbk')) {
    // A runtime without full ICU cannot do gbk at all. It must refuse rather
    // than substitute (M2.18/M2.23), which is the correct outcome and worth
    // asserting instead of skipping quietly.
    const { ctx } = contextFor(28)
    await assert.rejects(() => dispatch(comQuery(Uint8Array.of(0x27, 0xbf, 0x5c, 0x27)), ctx))
    return
  }
  const { ctx, executor } = contextFor(28)
  await dispatch(comQuery(Uint8Array.of(0x53, 0x45, 0x4c, 0x45, 0x43, 0x54, 0x20, 0x27, 0xbf, 0x5c, 0x27)), ctx)
  assert.equal(executor.sql, "SELECT '縗'", 'BF 5C is one character, and the trailing quote closes the literal')
  assert.ok(!executor.sql.includes('\\'), 'no backslash survives the decode, so none can escape the quote')
})

test('COM_STMT_PREPARE decodes in the session charset too', async () => {
  // The same bug, the same fix: `parseComStmtPrepare` also called `fromUtf8`.
  // Worth its own case because a prepared statement's text is cached in the
  // statement table and reused for every execute, so a bad decode here is
  // durable rather than per-query.
  const { ctx, executor } = contextFor(8)
  const w = new Writer()
  w.u8(COM.STMT_PREPARE)
  w.bytes(encodeCharset("SELECT '€', ?", 'latin1'))
  await dispatch(w.toBytes(), ctx)
  assert.equal(executor.sql, "SELECT '€', ?")
})
