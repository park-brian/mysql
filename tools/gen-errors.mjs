#!/usr/bin/env node
// M1.6 / D-14 — the error table is generated from MySQL's own
// `share/messages_to_clients.txt`, not transcribed by hand. There are ~1,400
// codes with SQLSTATEs, and transcription is how you get 1451 and 1452 the
// wrong way round.
//
// Ground rule 7: nothing from the MySQL tree is copied into this MIT
// repository. The source is fetched, hashed, and discarded.
//
// D-29 narrows what "generated" means here: we emit **facts only** — the error
// number, the symbol and the SQLSTATE. The English message templates are
// expression rather than fact, and they are not reproduced. Message strings
// for the codes we actually emit are authored in `messages.ts`.
//
// The source is pinned to the exact tree docs 10–30 were written against
// (doc 90), so re-running reproduces the committed output byte for byte — the
// property CI checks with `git diff --exit-code`.
import { writeFileSync } from 'node:fs'
import { REF, REPO, fetchPinned } from './lib/gen-common.mjs'

const PATH = 'share/messages_to_clients.txt'
const OUT = new URL('../packages/protocol/src/errors/table.ts', import.meta.url).pathname

const { text: source, sha256 } = await fetchPinned(PATH)

// Grammar (verified against the pinned file):
//   column 0, lowercase  -> a directive (`start-error-number N`, `languages`,
//                           `default-language`, `reserved-error-section`)
//   column 0, uppercase  -> SYMBOL [sqlstate [odbc-sqlstate]]
//   indented             -> `<lang> "message"`, which we deliberately ignore
//   `#`                  -> comment
//
// Numbers are assigned sequentially from the most recent `start-error-number`,
// and OBSOLETE_* entries consume a number just like live ones — skipping them
// would shift every code after them.
const entries = []
let next = null

for (const raw of source.split('\n')) {
  const line = raw.replace(/\r$/, '')
  if (line === '' || line.startsWith('#')) continue
  if (/^\s/.test(line)) continue // a translated message

  const directive = /^start-error-number\s+(\d+)/.exec(line)
  if (directive !== null) {
    next = Number(directive[1])
    continue
  }
  if (/^[a-z]/.test(line)) continue // languages, default-language, reserved-error-section

  const symbolMatch = /^([A-Z][A-Z0-9_]*)\s*(.*)$/.exec(line)
  if (symbolMatch === null) {
    console.error(`gen-errors: unparsed line: ${JSON.stringify(line)}`)
    process.exit(1)
  }
  if (next === null) {
    console.error(`gen-errors: symbol ${symbolMatch[1]} before any start-error-number`)
    process.exit(1)
  }
  const symbol = symbolMatch[1]
  // The first state is the SQLSTATE; a second, when present, is the legacy
  // ODBC state, which MySQL does not send.
  const states = symbolMatch[2].trim().split(/\s+/).filter((t) => /^[0-9A-Z]{5}$/.test(t))
  entries.push({ errno: next, symbol, sqlState: states[0] ?? null })
  next += 1
}

// Sanity checks: the roadmap's own acceptance assertion, plus the pair doc 14
// calls out as the classic transcription error.
const bySymbol = new Map(entries.map((e) => [e.symbol, e]))
const check = (symbol, errno, sqlState) => {
  const got = bySymbol.get(symbol)
  if (got === undefined || got.errno !== errno || got.sqlState !== sqlState) {
    console.error(
      `gen-errors: expected ${symbol} = ${errno}/${sqlState}, got ` +
        (got === undefined ? 'nothing' : `${got.errno}/${got.sqlState}`),
    )
    process.exit(1)
  }
}
check('ER_DUP_ENTRY', 1062, '23000') // M1.6's acceptance assertion
check('ER_PARSE_ERROR', 1064, '42000')
check('ER_NO_SUCH_TABLE', 1146, '42S02')
check('ER_LOCK_DEADLOCK', 1213, '40001') // D-09
check('ER_ROW_IS_REFERENCED_2', 1451, '23000') // the pair doc 14 warns about
check('ER_NO_REFERENCED_ROW_2', 1452, '23000')

// Packed one entry per line: `errno symbol [sqlstate]`. A minified object
// literal of 1,400 entries costs far more in the bundle than a string the
// consumer expands lazily on first lookup.
const packed = entries
  .map((e) => (e.sqlState === null ? `${e.errno} ${e.symbol}` : `${e.errno} ${e.symbol} ${e.sqlState}`))
  .join('\n')

const out = `// GENERATED FILE — do not edit by hand. Run \`npm run gen:errors\`.
//
// M1.6 / D-14: generated from MySQL's own error source rather than
// transcribed. D-29: facts only — error number, symbol and SQLSTATE. The
// English message templates are not reproduced; ground rule 7 keeps this
// repository free of MySQL source, which is GPLv2 to our MIT.
//
// Source:  ${REPO}@${REF} ${PATH}
// SHA-256: ${sha256}
// Entries: ${entries.length}

/** The upstream file this table was generated from, for re-verification. */
export const ERROR_TABLE_SOURCE = '${REPO}@${REF} ${PATH}'

/** SHA-256 of that file. CI regenerates and diffs; a change here is a real change. */
export const ERROR_TABLE_SOURCE_SHA256 =
  '${sha256}'

/** Number of entries, including OBSOLETE_* symbols, which still consume codes. */
export const ERROR_TABLE_SIZE = ${entries.length}

/**
 * One entry per line: \`errno symbol\` with an optional trailing SQLSTATE.
 * Expanded lazily by \`errors.ts\` — a minified object literal of ${entries.length}
 * entries costs several times this in the bundle.
 */
export const PACKED_ERROR_TABLE = \`${packed}\`
`

writeFileSync(OUT, out)
console.log(
  `gen-errors: ${entries.length} entries -> ${OUT}\n` +
    `  source ${REPO}@${REF} ${PATH}\n  sha256 ${sha256}`,
)
