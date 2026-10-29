# CLAUDE.md

Orientation for working in this repository. **[docs/44-roadmap.md](./docs/44-roadmap.md)
is the living plan** — what is done, what is decided, what is still unknown. This
file is the shorter thing you read first. **[ARCHITECTURE.md](./ARCHITECTURE.md)**
is the narrative overview of the target architecture, for humans; it carries
no status beyond one dated section, and the roadmap wins where they differ (D-72).

## What this is

An isomorphic, in-process MySQL for JavaScript: no server process, no native
addon, MySQL's wire protocol and MySQL's semantics. M0–M4 are complete: the
protocol, charsets and collations, the type system, the parser down to the
administration statements, and storage (pages, B+tree, WAL, crash recovery,
MVCC transactions, the catalog, the Node VFS). M5, the executor, is most of
the way: DDL, DML and transactions, upserts, relational SELECT (joins,
grouping, subqueries, CTEs, set operations), window functions, JSON, views,
foreign keys, CHECK constraints, generated columns, FULLTEXT search,
INFORMATION_SCHEMA, temporary tables and ALTER TABLE all run through
unmodified `mysql2`. The committed execution and relational corpora agree
with 8.4.11; the committed coercion corpus also agrees completely (M5.2).
Some function behavior and optimizer strategies remain partial. Datatype aliases
now reuse complete private facts, preserving national charsets and exceptional
shapes. National-literal, completed-assignment and unary-BINARY parser warnings now
survive failure without changing successful-root provenance. Native CAST
precision admission still needs explicit charset warning histories before promotion. M5.1 naming and
M5.5 aggregate precision are reopened by native probes in the roadmap. M5.19 numeric
set-operation holders now agree with the expanded native audits, including
default/fixed FLOAT behavior. Raw BIT with VARCHAR/VARBINARY now shares the
collation resolver, including explicit text overrides. BLOB holders now size
raw/computed branches in the proper charset without counting bytes twice.
Binary BLOB copies now distinguish raw packed BIT fields from computed
numeric readings, with reference coverage for nested LIMIT sorts and derived
DECIMAL fields. Source-to-text FLOAT, explicit text-BLOB transcoding, non-BLOB
computed BIT readers remain open, alongside nested
set ordering/multiplicity and a separate M5.10 scalar COALESCE reader.
M5's ORM exit criterion holds with recorded test configuration; default
parallel runs can lose interactive-transaction tests to scheduling delays.
Doc 42's query API
(`db.query()`, `db.execute()`, `db.transaction()`) is a client of the same
protocol, its values `mysql2`'s (M5.36, D-76). The roadmap's **Next** section
says what comes next: 0.3 packaging is staged (`npm run pack`, D-79/D-80);
publication remains pending. Bounded FirstMatch now omits physically proved
integer bounds under the existing caps. Pure correlated integer NOT EXISTS now
prices deferred membership against lookup, reusing the invocation's existing
membership cache after outer sorting. NULL first probes build; empty outer input
and LIMIT 0 skip the build. Proved lookup profiles now retain their bound
correlated reader after the outer sort too. Its admitted pure source now stops
after its first qualified row and skips NULL-key searches after normal binding.
NULL-safe equality and materialized first-NULL builds retain their paths. Generic
EXISTS, excluded profiles and broader strategies remain open.
With FirstMatch disabled and weedout enabled, a proved materialized winner now
uses the same deferred build. Full cost accumulation and replacement priority
follow MySQL; rounded trace prices do not decide ties. When weedout is disabled,
the same proved profile can materialize without beating its disabled competitor.
With materialization disabled and weedout enabled, the proved correlated reader
now sorts before probing, skips NULL and stops at its first qualified hit;
EXPLAIN shows its physical one-row inner Limit. With materialization enabled,
full native costs now select that same reader for proved weedout winners.
Distribution changes can still select a first-NULL materialized build, including
on cached executions. With every competing strategy disabled, the same physically
proved fallback now retains that bound and outer ordering. Semijoin-off execution
remains open. A bounded canonical-column cohort now validates NULL-key source
visibility through the actual bound table under the invocation transaction.
Headers publish after reader construction and before deferred reads/sort fill;
missing validation capability retains the qualified reader. Canonical retained-view
failures now carry their actual handler key and publish warning 159 before 1412,
retaining condition-prefix limits and full totals. Broader constructor readiness
and retained-view locking reads after TRUNCATE remain open. The dependent-subquery
audit requires filtering before outer sorting.
M5.19 field copying now shares the
BLOB promotion rule with metadata. Actual DISTINCT/group/derived writers now
normalize stored DECIMAL values, closing the measured streamed-join copy gaps.
Grouped AVG arithmetic now retains quotient digits while actual window and
derived/CTE fields keep their stored scale. Ordinary temporary AVG now stores
its running total at input scale, preserving accumulation order. DISTINCT AVG
and typed DECIMAL caches now share canonical declared-scale values; explicit
DECIMAL CAST reuses that conversion and preserves its diagnostics. ROUND and
TRUNCATE now use it at their declared result writer, preserving raw IF readers,
and clamp places before a single rounding operation. Prepared rounding places
retain input scale; FLOOR/CEIL now share the native eighteen-digit BIGINT
boundary. Repeated grouping columns now require each physical index part once;
ROLLUP retains its positional keys. Selected grouping keys, including unary-plus
readers, now eliminate redundant outer DISTINCT without copying aggregate readers;
copied computed keys retain their key metadata without rewriting the parsed
expression. Grouped slots now share their unchanged result readers while field
copies and window frames keep separate ownership. Bounded retained DISTINCT over
computed exact ordinary AVG now finishes its final field copy before delivery,
with readiness after physical reader construction. AVG(DISTINCT) now completes its
intermediate field copy before enclosing arithmetic, retaining both materialization
barriers. Division rounding and broader aggregate metadata/readiness remain open. Raw declarations still decide grouping strategy. Failed PREPARE now
publishes command-local diagnostics and preserves native warning-prefix totals;
its placeholder admission refusal clears diagnostics. Native diagnostic SHOW
commands now refuse PREPARE before resolution. Query preflight now publishes
its failures, clears comment diagnostics and shares one lexical pass with parsing;
parameter admission uses the actual SQL mode. System-variable components and quoted user names now retain their identity.
Read-reference validation and SET target validation precede diagnostic-count
PREPARE admission; view restrictions retain precedence. Native field widths
distinguish unset user variables from assigned NULL. WHERE now shares one
SELECT-local resolution owner and preserves grouped clause precedence, written
FALSE/NULL short circuits and binary LIMIT 0 parameter initialization. Successful
PREPARE now publishes or clears its collected diagnostics on every supported
success path, retaining complete totals independently of the kept prefix while
its packet encodes their low sixteen bits. HAVING now shares clause-local
condition admission with WHERE, while aggregate/window/grouping readers retain
their row lifetimes. The later GROUPING admission/input expansion is withdrawn
after a late-source regression; its native captures remain research evidence.
Bounded constant ORDER-key startup now uses bound correlation and the existing
statement memo under the actual invocation transaction before metadata, preserving
PREPARE and ordinary projection timing. Filtered, grouped, opaque and stateful
profiles remain open. Pinned complete single-column PRIMARY points now omit
ORDER readers after binding, requiring both the condition owner's PRIMARY pin
and the final physical access. Duplicate IN retains its readers; physical
cardinality and metadata const-table flags are insufficient alone. Bounded
unfiltered ordinary base readers now enqueue metadata after physical reader
construction, before deferred reading/projection. Full-text projections retain
their earlier initialization boundary; their empty-source errors and InnoDB
warning 159 remain open. One physical operator owns access, decoding and closure;
slow-consumer cancellation releases its read view. Deterministic row-dependent
ORDER keys, including bounded sorts, now share that boundary through their
existing binding pass. Every written HAVING is excluded: its nonnullable-aggregate fold still masks
COUNT/BIT_AND window admission and needs source-preparation precedence repaired.
Ordinary delivery now applies LIMIT after sorting and before SELECT projection,
retaining copied-field writers and closing its reader on early termination.
Remaining optimization/readiness profiles stay open. NULL LIMIT coercion remains
coupled to the HAVING/source-preparation repair. Bounded retained DISTINCT now
uses ordinary AVG's temporary strategy and copies completed AVG(DISTINCT)
fields before projection, preserving both blocking lifetimes. Exact division
retains both operands' fractional words; cancelled zeros and AVG keep display
scale independent of held digits. Actual field copies retain their declared
scales. Ordinary no-FROM sources now publish metadata before projection errors;
written WHERE/HAVING/WINDOW/ORDER and locking retain their earlier fences.
Numeric CAST printing shares its resolved dimensions with evaluation, including
zero precision at scale zero. View writability uses the canonical aggregate
inventory, retaining nested-query exclusions. Decimal division now respects
nine-word capacity and leading-word ties, raises native overflow and normalizes
truncated zero without losing display scale. DIV result width is at least one
after its sign contribution. Decimal-path DIV overflow emits its conversion
warning; strict writes retain primary 1292 plus later 1690, with complete counts
before prefix truncation. Strict membership is generated from the pinned native
handler. Derived/view and recursive-CTE metadata now shares one owner for
whole-list name validation and fresh field-type construction, avoiding redundant
arrays and copies. Each statement caches rows under the bound source instance.
Bounded literal/typed-integer-NULL sources and plain SIGNED/UNSIGNED casts of
integer, boolean, NULL and text literals now announce readiness after actual
materialization. The separate positive grammar no longer duplicates integer-text
length/range conversion policy; the CAST writer owns wrapping, saturation and
warnings. Raw uncast bounds and caller/source fences remain intact. Cardinality
alone supplies no readiness proof. Quoted DUAL retains ordinary table lookup and row identity;
the parser owns unquoted DUAL normalization. Broader CAST and function-source
admission remain open. Nonfinite DOUBLE literals now fail during parsing, with
native spelling and label bounds, and preserve earlier namespace refusals. Shared grammar name
readers validate registered charsets/collations; the registry owns case, utf8
aliases and NUL prefixes, and one SQL resolver serves expressions and DDL.
DDL permits the BINARY collation keyword while expression COLLATE rejects it.
The generated registry includes utf8mb4_0900_bin (309) and its protocol widths;
its NO PAD ordering uses UTF-8 byte keys.
Checked parser boundaries retain recoverable COLLATE and DOUBLE-overflow condition
histories while preserving the first error by identity and keeping invalid ASTs
out of execution. Unknown charsets and DDL collation failures stop parsing; raw
cursor APIs still refuse immediately. Parser conditions publish the native
1,024-entry prefix; ordinary runtime warning totals retain their existing rules.
Admission fixtures protect individual matching conditions and primary-error
attributes even when a whole outcome remains open. The current parser-warning
repair retains NCHAR warning 3720 on checked grammar failures; valid ASTs keep
their existing publisher. Bounded CAST/CONVERT modifier admission now passes
Docker verification: character targets take one charset clause and at most one
BINARY, while national/numeric targets leave column modifiers for syntax refusal.
Default column readers retain their grammar. A warning-filled 1,024-condition prefix can accompany ERR with zero
retained errors. Valid-AST warning limits and later binding failures remain open.
The BINARY attribute warning now survives failed CAST/CONVERT admission only after
its optional charset succeeds; the parser and DDL share its text. This bounded
repair passes Docker verification. The migrated grammar readers share one token
owner for unquoted ASCII keyword identity, retaining Unicode identifier spelling.
Native-rejected Unicode-lookalike SET/INSERT and DROP/CREATE now fail before
execution. A 150-command capture enforces 134 complete matches while retaining
sixteen function-name and charset-value gaps. Interval units, event-schedule units
and first/subsequent resource selectors now share that owner too. Their capture
improves 1,046 to 1,670 complete outcomes of 1,850, with all 180 separate event
outcomes retained. Quoted interval units are refused, and actual DROP results
guard event storage. Failed CAST/CONVERT admission now retains ASCII/UNICODE
warnings around BINARY in written order at the existing datatype reduction phases.
Unknown charsets and malformed clauses suppress attributes; named charset values
are not shorthand modifiers. All 276 failed-grammar controls agree in the
552-command capture, while its 156 valid-outcome gaps stay open. Valid-AST warning
publication and runtime limits retain their existing owners. Unresolved functions
now require a selected database and report native error 1046 when absent. Thirteen
existing required-schema checks share that presence rule without changing their
resolution phases or explicit-name handling. The 378-command capture protects
48 repaired primary errors; diagnostic-count and precedence gaps remain open.
Native function classification now shares an ASCII spelling key and the existing
call-role flag. Quoted/spaced lexer names retain collision grammar, and Unicode
lookalikes bypass native binding before argument effects. The 6,084-command
capture now protects 5,430 complete matches with unchanged native answers;
all 654 remaining outcomes stay recorded. Generated-column execution admission now checks arguments before calls, then
references, aggregates and windows in written order through its existing owner.
The 3,276-command capture now protects 1,792 complete matches without losing
protected facts; definitions and existing rows are checked on every frame.
Raw-name diagnostics now use actual SQL mode and double only the chosen quote.
Lookup and serialization share native syntax eligibility; quoted reserved words
retain their collision role and generic names survive serialization. A new
3,573-command capture now enforces 2,820 complete matches across five modes and all
three APIs. All matching facts are retained. PREPARE now shares early generated
expression admission, without resolving columns/aggregates or executing DDL. It
rejects variables, subqueries, placeholders and prohibited calls after system-name
binding, preserving SQL mode and generated/DEFAULT precedence. All 48 generated
execute/PREPARE gaps in the older function capture close. A new 685-command capture
protects 256 complete matches and 680 primary diagnostics across five modes.
Ordered statement admission now rejects generated expressions before DDL dispatch,
so prior writes remain rollbackable. Column compatibility and name binding retain
native order; later reference/aggregate/window failures retain implicit commit.
Native diagnostic spelling is shared across 39 fixed keys with explicit aliases.
Five captures preserve 2,538 observations. DEFAULT now shares early ordered
admission with its own prohibition policy; clocks, randomness and session
functions remain admitted. A pure postorder check shares only traversal and native
diagnostic construction with generated columns. ALTER SET DEFAULT retains its
late execution boundary and non-executing PREPARE behavior. The extended tests
pass 153 transaction boundaries and nine missing-database cases against both
engines. Forty-eight admission captures enforce 66,881/84,587 complete normalized commands,
with unchanged native answer pools and 17,706 open outcomes. CHECK permissions/namespace,
malformed declaration ordering, ANSI SHOW CREATE and other function gaps remain
open. A CHECK permission-only trial was withdrawn because native clock precision
and RANDOM_BYTES evaluation were prerequisites. RANDOM_BYTES now has a bounded
evaluator; SYSDATE construction and mixed CHECK precedence still block that
permission change. A deterministic 702-command
capture protects these boundaries. The clock compiler now shares canonical native
labels with value-generator diagnostics, retaining separate arity spelling and
validation timing. Its 1,566-command capture improves 430 to 490 complete matches;
context-dependent precision precedence stays open. Ordinary fractional clocks
now share the optional unsigned NUM31 production with the bare column-clock reader;
generic quoted/spaced roles, OVER fields and semantic precision timing remain intact.
Two native captures retain 2,619 commands and improve 510 to 1,728 complete matches
without losing earlier matching facts. The clock compiler now narrows precision to
a byte before checking 0..6, preserving existing admission and resolution timing.
The 2,313-command precision capture now protects 1,856 complete matches. Raw clock
TIME widths use an eight-character base, while actual copied TIME fields retain
the general ten-character base through their existing writers. A fixed-clock
1,458-command audit improves 452 to 698 complete matches without losing matching
facts or changing native answers. The precision reader uses its parser-guaranteed
NUM31 literal directly; numeric classification shares the existing predicate.
TIME() and TIME CAST now share conversion and result precision, preserving mode,
JSON diagnostics and raw versus packed negative zero at actual field writers.
The 3,756-command native audit now protects 3,640 complete matches without
losing matched facts; native answers reconstruct exactly. Shared temporal
arithmetic and text renderers remove duplicated mechanics under all nine unchanged
size caps. Temporal CAST precision now refuses after the closed constructor,
while FSP token grammar enforces NUM31 and the public datatype API retains its
modifier-only contract. Sequential SUBSTRING-family argument reading removes
forward lookahead; shared grammar completion preserves role boundaries. A new
3,228-command native audit now protects 2,806 complete matches, including
typed client Dates, without losing matching facts. The repeated census adds one
correct annotated 1426 refusal, preserving coverage and the entire official result.
SUBSTRING-family native grammar now requires two arguments with an optional third
and refuses OVER before later admission or binding. Stored roles retain their own
grammar; preceding batch writes and conditions survive. A 1,728-command audit
improves 324 to 1,107 complete matches without losing earlier matching facts.
Existing name/operator readers and mandatory CASE construction remove redundant
mechanics under unchanged caps. Qualified calls now preserve explicit schema identity,
generic grammar and collision diagnostics, including no-default-database sessions.
Stored CHECK calls retain their boolean and permission refusals; DEFAULT/generated
and CREATE/ALTER CHECK share component-aware diagnostic quoting. Shared column,
list and postorder declaration readers remove duplicate mechanics. A 2,172-command
native audit improves 253 to 1,559 complete matches without losing matching facts.
Mixed CHECK prerequisites and native constructor/permission behavior remain open;
a broader phase reorder was removed after the existing SYSDATE guard rejected it.
Ordered admission now validates function-reference schema/name boundaries and
preserves completed grammar warnings before typed constructor refusal. A 1,188-command
native audit improves 303 to 807 complete matches without losing matching facts.
Grammar provenance stays with the exact parsed root, outside AST serialization;
cached/repeated/two-session use retains it. Grammar and constructor diagnostics
transfer the same kept prefix, while ordinary runtime counters stay complete.
Diagnostic retention uses max_error_count at statement entry, including SET's own
changes. Ninety prefix, sixteen SET and twelve mixed-batch controls match native.
The existing UTF-8 diagnostic renderer now serves identifier errors too; parameter
Dates share the protocol converter, and row writers share their transaction/count
boundary. RANDOM_BYTES now uses the secure random source and shared integer
reader, validates length before allocation and evaluates afresh without generating
during PREPARE. Its binary field remains 1,024 bytes wide. Bounded BINARY grammar
histories now publish once per supported PREPARE/text query after admission,
excluding mixed histories, table references and charset conversion. Grammar prefix
retention precedes ordinary runtime accounting; EXECUTE does not republish it.
Six native captures improve 78 to 944 complete normalized matches across 1,791
commands without losing matching facts. Secure-source and two-session tests cover
actual bytes, cached execution, repeated preparation and retained limits. Existing
UTC/date, range-error and condition kernels remove duplicate mechanics under all
nine unchanged size caps. The shared function reader now rounds fractional TIME
with carry, distinguishing bare source fields from computed readings under
TIME_TRUNCATE_FRACTIONAL. A 2,880-command native capture improves 1,878 to 2,164
complete matches without losing a matching fact. Cached mode changes preserve
field rounding and release readers; the existing half-even storage/function
kernel now has one implementation. Actual derived/set-operation TIME writers now establish the field integer
reading, while declared-TIME MIN/MAX and scalar caches replace it with the numeric
reading. Reduced scalar references forward it; HAVING retains a cache. Existing
plainValue owns trait normalization, and IF/CASE versus CAST/COALESCE retain
their distinct policies. A 9,570-command native audit improves 7,236 to 7,958
complete matches without losing a matching fact. Payload/sign and earlier MIN
negative-zero normalization stay separate. Shared byte temporal formatting keeps
legacy two-argument and callback behavior, verified over 90,432 baseline facts.
Stored TIME decoding now establishes the reading forwarded through IF/CASE,
removing column-origin inference from integer argument readers. The optional
enumerable bigint changes the exported decoded TIME Value shape; payloads and
generic conversion remain unchanged. A 6,264-command native capture improves
5,020 to 5,184 matches with no matching fact lost. Native/local cached DML,
DEFAULT, generated fields and CHECK controls pass. Fresh Docker verifies 1,546
tests and all seven corpora, under all nine unchanged caps. The bounded DATETIME
follow-up retains 2,184 native commands, 1,318 complete current matches and 866
open outcomes without changing runtime code. Calendar versus numeric-cache
carry, zero parts and deferred 1441 warnings need separate reader rules. Fresh
Docker passes 1,547 tests; the next implementation returns to captured M5.47
strategies. NULLIF temporal readers/diagnostics, packet publication, DATETIME
integer rounding/overflow, mixed-type/cache and user-variable payloads,
assignment expressions, DECIMAL overflow warnings, JSON labels, bound-parameter
metadata, CAST BINARY collation/nullability and broader warning publication
remain open. Supplementary identifiers, ordinary table-name
refusal, result/prepared temporal metadata, JSON extraction, consumer range warnings,
declaration phase, string nullability and merged temporal charset also remain open.
Bare DEFAULT/ON UPDATE now use their four timestamp aliases, require NOW
parentheses and validate the NUM token before BigInt conversion, producing typed
syntax errors for malformed precision. A shared integer-token reader preserves
caller bounds, raw spelling, conversions and AST ownership. Three native captures
retain 1,800 observations and protect these DDL boundaries. M5.10 stays partial.
CAST/CONVERT targets leave internal COLLATE to the syntax boundary while column
datatype readers retain it. Cursor string reading concatenates adjacent literals
only when expression or ENUM/SET grammar requests it; ordinary callers consume
one token. Other CAST grammar, metadata and conversion gaps remain open.
DDL preloading gathers collation IDs while the writer alone validates the full
table spec. Lexical lookahead, CAST type grammar, builtin arity admission,
collation-name conversion warnings,
DECIMAL precision priority and finite negative-double CAST overflow remain open. Integer DIV minimum rejection also remains parked after
broader CAST and written-clause controls exposed lost headers. Evaluation-count
contracts preserve actual operand effects and prepared non-execution. Buffered multi-statement runtime failures
now retain completed results with their own status and warnings before the ERR
packet. Private completion facts preserve direct-call error identity and JSON;
one batch writer serves text and binary rows. Incremental parsing now preserves
earlier execution before later syntax failures, while checked boundaries retain
single-result streaming. Parser failures publish diagnostics once; settled SQL
failures retain their own condition history. CTE definitions now enter one
ordered name map after each closing parenthesis, preserving case-sensitive local
scope and nested error priority. Typed duplicate admission precedes later syntax
and execution, with earlier multi-statement results and writes retained. Duplicate
labels retain the native 192-byte UTF-8 limit and partial-byte replacements. Query
construction shares optional-field writers, local cursors and the common word/string
reader for charsets, collations, accounts and plugins.
Whole-command lexing, later multiline error line numbers, the failing statement's
own partial response, optional session tracking and shared CTE effects remain
open. The positive literal/typed-NULL profile fits under unchanged caps, with
564 native command/state controls and all already-matched components enforced.
Fresh DIV audits reject both parked candidates for derived-source metadata
regressions. The 2,536-command native contracts retain 1,957 complete matches,
all already-matched components, 2,412 header-presence controls and 2,520 matched
table states. Exact plain integer
CAST-source admission is next; nullable function sources need separate proofs.
Integer-only minimum-boundary behavior, expression spelling, wider
copied-field/parameter metadata, invalid-dimension admission and CAST warning labels,
broader multiplication precision and supplementary identifier-alias admission
remain open. Broader
strategy and measured field-copy gaps stay open.
The cost-based planner (M5.7, M5.42–M5.46) is done:
`EXPLAIN FORMAT=TREE` prints the plan that runs, and 2,126 of the relational
corpus's 2,248 plans agree with 8.4.11's; M5.47 is in progress, M5.48 is done,
M5.49 and M5.50 are in progress.
`db.stream()` (M5.40) streams with backpressure at every hop (D-85). Then the
browser (M6).
The package an application installs is `myjs`, a facade over `@myjs/core`.

## Running things

Node **≥ 22.18** is required and there is **no build step** — Node strips the
types and runs the `.ts` directly (D-01). `tsc` is only a checker, except
in `npm run pack`, which emits what npm would install (D-79).

```bash
npm ci
npm test          # unit + format + protocol + 300 crash points; no Docker, no browser; about 1.5 min on 4 cores
CRASH_POINTS=10000 npm run test:crash   # the M4 exit criterion's 10,000, as CI runs it
npm run typecheck
npm run lint      # the isomorphic gate and the package graph
npm run size      # the ratcheting bundle budget
npm run fuzz      # 10^6 inputs per parser, and 2 x 10^4 statements into the executor
npm run pack -- --smoke   # every package as a tarball, installed into an empty project and run
npm run verify:docker -- --reference  # disposable Node 22.18.0 + pinned MySQL 8.4.11; no fixture recapture
```

`npm test` and `npm run test:protocol` run ordinary files with Node's normal
parallelism, then run the full bulk-latency file separately. Both phases are
required; the latency bound and its competing connections are unchanged.

Because there is no build step, only **erasable** TypeScript is legal: no
`enum`, no `namespace`, no parameter properties, no decorators. `tsc` enforces
it with `erasableSyntaxOnly`, so the constraint fails at commit time.

## Checking against a real MySQL

Most of what this project knows about MySQL that no document states came from
asking a server. Get one:

```bash
sudo node tools/mysql-local.mjs install    # Ubuntu 24.04 x64; checksum-pinned MySQL 8.4.11
node tools/mysql-local.mjs start           # binlog on, FULL row images
node tools/mysql-local.mjs provision       # the accounts capture:traces needs
npm run fetch:reference                    # the pinned MySQL source tree
```

8.4.11 is not arbitrary: it is the exact build the committed corpora were
captured against, so they are reproduced rather than resembled. With it up:

```bash
npm run capture:types        # storage encodings + sort keys, from binlog row images
npm run capture:precedence   # 1,200 generated expressions, evaluated by the server
npm run capture:traces       # 13 client/server byte traces, via a recording proxy
npm run capture:keywords     # MySQL's reserved words, into @myjs/parser (D-39)
npm run capture:fulltext     # InnoDB's stopwords and token bounds, into @myjs/core (M5.26)
npm run capture:queries      # 1,200 generated joins and set operations, run by the server
npm run capture:execution    # 400 generated scripts, run by the server through mysql2
npm run capture:relational   # 300 multi-table scripts, both protocols, plans captured
npm run capture:json         # 250 scripts over JSON columns, the constructors and aggregates
npm run capture:temporal     # 2,700 generated strings into DATE/DATETIME/TIME/TIMESTAMP, with SHOW WARNINGS
npm run capture:functions    # 200 scripts of string and numeric function calls, both protocols
npm run capture:temporal-functions   # 300 scripts of date and time function calls, in UTC
npm run capture:more-functions       # 300 scripts of string, math, hashing and network function calls
npm run capture:information-schema   # 120 DDL scripts, then Prisma's introspection queries
npm run capture:variables    # the 619 system variables: scope, type, range, default (restart before and after)
npm run census:orm           # Drizzle's and Prisma's MySQL suites: a feature census, and our pass count
npm run exit-criterion       # the real C client against our server
npm run census:mysqltest -- --refresh   # MySQL's own test corpus, lexed and parsed
```

With `reference/mysql` present the generators and the census read it instead of
the network, so `npm run gen:*` is hermetic and needs no GitHub token.
`reference/` is gitignored and **nothing from it is ever copied into this
repository** — MySQL is GPLv2 and this project is MIT (ground rule 7). That
applies to tests too: the census commits names, hashes and counts, never a line
of corpus SQL.

## The packages, and the edges that are not allowed

```
package    depends on
bytes      —
vfs        —
charsets   bytes
types      bytes, charsets
parser     bytes, charsets
protocol   bytes                         never charsets or types (D-33)
engine     bytes, charsets, types, vfs
core       all of the above
server     core, protocol
myjs       core, server                  the facade an application installs (D-79)
```

The table in `tools/lint-isomorphic.mjs` is the authority: `npm run lint`
fails an import, or a declared dependency, that it does not allow.

`@myjs/bytes` is the cycle-breaker and the reason is the release plan, not
taste: `@myjs/protocol` ships at 0.1 and `@myjs/charsets`/`@myjs/types` at 0.2,
so an edge between them would make the 0.1 artefact unpublishable. When two
packages above need to *name* the same thing, it moves **down** into `bytes` —
that is D-30 (`MyjsError`), D-32 (`SqlValue`), D-37 (`FIELD_TYPE`). The test for
what belongs there: a *fact about the format*, not *behaviour*.

`@myjs/protocol` never depends on `@myjs/charsets` (D-33). Behaviour that needs
a session is injected — a `Transcoder`, a `Capabilities`, an `Executor`.

## Three seams carry the design

- **`execProtocol(bytes) → bytes`** (doc 03). Every other entry point is a
  caller of it, which is why `mysql2.createConnection({ stream })` works with no
  knowledge that there is no socket.
- **The `Vfs` interface** (doc 40) — the only platform-dependent code, and
  synchronous, so there is no `await` inside a page split.
- **`journal.atomically(fn)`** (doc 26 §Our log) — every page change in the
  engine sits inside one, and the journal, not the tree, writes the log. Code
  above the pool declares where an atomic change begins and ends and nothing
  more.

The engine seam is `Executor` in `packages/protocol/src/session.ts`, answered by
`SqlExecutor` in `packages/core/src/sql/` (D-62–D-68): parse once, compile each
expression to a closure, plan a key range only where it is exact, run in the
session's transaction. MySQL's value rules — comparison, arithmetic, a value
into a column — are `@myjs/types`', not the executor's. Below the executor, the
storage seam is `Catalog` and `Table` in `@myjs/engine` (doc 30 §Our engines):
rows as storage-encoded field bytes, DDL as transactions.

## Ground rules

From the roadmap, which states them once so no work item repeats them:

1. `Uint8Array` and `DataView` only above the VFS — no `Buffer`, no `node:*`.
   Enforced by `npm run lint`, not by good intentions. `tools/` is outside the
   gate and may use `node:` freely; what it *emits* into `packages/` may not.
2. Bytes in, bytes out at every layer boundary.
3. Async at the edges, sync in the core.
4. Every format constant cites the MySQL header it came from.
5. Typed errors, always — a malformed input produces a typed error, never a
   crash, never a hang, never an out-of-bounds read. This is the fuzzing
   invariant.
6. The memory VFS is the reference implementation.
7. Nothing from `reference/` is copied into this repository.

## How work is recorded

- **The roadmap is edited in the same commit as the work it describes** (D-03),
  and so are the scoreboard and an entry in [doc 45](./docs/45-changelog.md).
  `test/format/roadmap.test.ts` recounts the status glyphs, so the summary
  cannot drift from the tables. A compatibility number updated by hand, later, is
  marketing; one CI writes is an engineering artefact.
- **Work items are append-only.** `M4.7` means `M4.7` forever. An item that
  turns out wrong is marked `⊘` with a reason and a new one is added.
- **Decisions are superseded, never edited**, and so are errata — `E-14`
  corrects `E-13` rather than rewriting it. The reasoning that was wrong is as
  useful as the reasoning that was right.
- A work item's "done when" is one falsifiable assertion, and the prose beside
  it records what the work *taught*. That density is deliberate.

## The habit worth keeping

Almost every entry in the [change log](./docs/45-changelog.md) has the same shape: a claim was checked
against something real, and the check found a bug — frequently **in the test
rather than in the code**. `utf8mb4_bin`'s sort key, `<=>` being null-safe, an
unsigned BIGINT negation saturating, a charset missing from a generated
registry, a corpus listing truncated at 1,000 entries. Prefer the check that
could falsify the claim, and when it fires, ask first whether the instrument is
the thing that is broken.
