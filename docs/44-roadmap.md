# 44 — Roadmap

Ordered by dependency, not by excitement. Each milestone ends with something
demonstrable, because a database project that cannot be demonstrated for six
months is a database project that gets abandoned.

**This file is the living plan.** Docs 00–43 say what the formats are and why we
chose this shape; this one says what we are doing about it, what we have
decided, what we have finished, and what we still do not know. It is edited in
the same commit as the work it describes. If you want to know the state of the
project, read this file and nothing else.

---

## How to use this document

**Status glyphs.** `☐` not started · `◐` in progress · `☑` done · `⊘` deferred
or out of scope.

**Work items are append-only.** `M4.7` means `M4.7` forever. If an item turns
out to be wrong, mark it `⊘` with a reason and add a new one; never renumber,
because commit messages and issue titles reference these ids.

**Decisions are superseded, never edited.** A `D-NN` row is a historical record.
Changing your mind means adding `D-NN+1` and filling in the `Supersedes` column.
The reasoning that was wrong is as useful as the reasoning that was right.

**The scoreboard moves in the same commit as the code.** A compatibility claim
that is updated by hand, occasionally, is marketing. One that CI writes is an
engineering artefact (doc 43 §8).

**Open questions are pinned to the milestone that must resolve them.** A `Q-NN`
with no milestone is a note; with a milestone it is a blocker with a deadline.

---

## Status at a glance

| | Milestone | Theme | Done | Status |
|---|---|---|---|---|
| **M0** | [Foundations](#m0--foundations) | bytes, VFS interface, CI | 10 / 10 | ☑ |
| **M1** | [Speak the protocol](#m1--speak-the-protocol) | the whole client ecosystem, for a few thousand lines | 24 / 24 | ☑ |
| **M2** | [Types and collations](#m2--types-and-collations) | the part everyone else gets wrong | 25 / 25 | ☑ |
| **M3** | [Parse SQL](#m3--parse-sql) | lexer, parser, AST | 17 / 17 | ☑ |
| **M4** | [The storage engine](#m4--the-storage-engine) | pages, B+tree, WAL, MVCC | 26 / 26 | ☑ |
| **M5** | [Execute](#m5--execute) | operators, planner, functions | 44 / 53 | ◐ |
| **M6** | [The browser](#m6--the-browser) | OPFS, workers, leader election | 0 / 10 | ☐ |
| **M7** | [InnoDB interchange](#m7--innodb-interchange) | read and write real `.ibd` | 0 / 13 | ☐ |
| **M8** | [Beyond](#m8--beyond) | as demand arrives | 0 / 12 | ☐ |
| | | **Total** | **146 / 190** | |

## Next

**0.3 is staged**, with exact workspace versions and installed-package smoke
checks. Publication still requires claiming the npm scope/name and publishing
leaves first. M5.53's stabilization preserves the wire API and native format.
The ORM review measured Drizzle's 487 passes and Prisma's 1,122 passes with the
same reference snapshot failure at two workers. Browser work remains M6;
InnoDB interchange remains M7, outside the staged Node release.

**Measured compatibility.** M5.2's committed coercion gate is complete:
3,148 observations and 1,737 warning counts agree through both protocols.
The three function corpora agree on 8,765 observations. The relational corpus
agrees on all 5,635 observations, with 2,124 of 2,248 plans agreeing;
its required floor remains 2,118. CI reproduces all seven captures against
pinned MySQL 8.4.11 without recapturing
fixtures. The official mysqltest measurement is 38 total passes, 37 shared with
the reference's 1,146 passing files. FLUSH TABLES and FLUSH STATUS are explicitly
unsupported. These are measured gates, not complete MySQL coverage.

**Commit and continue.** Run the relevant Docker checks, update this roadmap and
[the changelog](./45-changelog.md), commit and push each validated slice directly
to main. Inspect GitHub runs by exact SHA during work and at slice boundaries.
Pending jobs permit continuation; known failures require a reproducible repair.
Use an independent read-only continuation review after every committed slice.
Do not weaken thresholds or hide mismatches in captures. Full Docker release
validation is described in [43](./43-testing.md); retain Prisma's worker count
when comparing fresh ORM runs. Monitoring stays within the active session.

Bounded function/coercion repairs are verified below. A fresh set-operation
boundary audit reopens M5.19. Mixed signed/unsigned integer UNION widening now
agrees with the reference in all 400 integer-only outcomes, fixing negative
execute() results for positive unsigned values. Repair the remaining measured
YEAR and FLOAT boundaries before returning to M5.47, then M5.49/M5.50
before browser work. Remaining
function boundaries stay open for separate verification. The current state and remaining work are:

1. **M5.10: remaining function and coercion behavior.** Mixed TIME/text/binary
   and binary DATETIME extrema, typed TIME bounds, shared statement-date
   anchoring and dated readings in CASE/IN now have live regressions. Remaining
   work includes UTF-8 transcoding of binary regex results, full ICU Unicode
   folding, JSON extrema's prepare-time warnings and NULL metadata,
   CAST(TIME AS DATETIME) anchoring/rounding, and temporal-literal spelling
   deprecation warnings. TIME/JSON extrema remain explicitly unsupported.
   JSON INTEGER diagnostic wording is now repaired. ABS(JSON) reads and returns
   DOUBLE, floating ABS normalizes negative zero, and ABS BIT/HEX literals now
   preserve their existing signedness facts. COLLATE now reports nullable results
   and explicit coercibility through the shared node/literal type owners. The
   binary value path now preserves every byte through its existing reader.
   Wide COLLATE/HEX metadata now uses the shared string-result type policy.
   CONCAT now shares capped result sizing, including wide-column sums.
   DATETIME now uses identifier/quoted-alias grammar; DATE/TIME/TIMESTAMP
   retain typed literals and DATETIME casts retain their own grammar. INTEGER
   binary-column casts now escape bytes, retain NUL and warn on empty values.
   Binary-column INTEGER CAST now bypasses blob and small-VARBINARY field
   suppression through one compiled fact. That fact now also covers binary
   expressions and introduced literals, preserving ordinary numeric field reads
   and unintroduced HEX/BIT numeric facts. Nonbinary INTEGER CAST now also
   bypasses field suppression and warns on empty/whitespace strings. Its default
   text formatting now shares a local utf8mb3 normalization and UTF-8 cap.
   INTEGER complement warnings now use original text ranges and exclude numeric
   HEX/BIT and ordinal values. Negative-zero and leading-control-whitespace
   reading remain open with expected parameter types. BLOB/TEXT and CONCAT
   DECIMAL prefix diagnostics now have explicit source-owned handling. IF/CASE
   DECIMAL readers delegate to the selected original branch before type merging.
   IFNULL/COALESCE retain their own merged-value prefix policy. The scalar
   string dispatch and builtin case aliases now declare their verified fact.
   ANY_VALUE owns its string DECIMAL prefix diagnostics; NULLIF delegates its
   original result reader and retains its native two-read boundary. CHAR/BINARY
   casts and non-temporal, non-JSON string extrema now own their verified prefix
   facts. Fixed CHAR/BINARY field DECIMAL formatting and the complete shared
   numeric binary text reader are verified. COLLATE owns its DECIMAL prefix
   policy; CONVERT USING owns its verified DECIMAL prefix policy without changing
   charset conversion or metadata. UNHEX shares the complete reader and emits
   invalid-argument 1411.
   Resolved literals now share control escaping and caller-specific charset
   prefixes; generated expressions share CHECK clauses' extra escape layer.
   SHOW CREATE VIEW retains literal introducers through its explicit selected,
   foreign or NULL schema context; omitted context retains INFORMATION_SCHEMA
   policy. Non-ASCII INFORMATION_SCHEMA view-value conversion remains a gap,
   separate from diagnostic message caps. UTF-8 source generated/CHECK text now
   uses verified byte rendering through shared table-expression setup; legacy
   source handling, CESU-8 and metadata/admission boundaries remain separate.
   Variable field diagnostics still need raw-byte cap and message-conversion
   repair. Numeric/temporal/JSON
   extrema and split-multibyte message conversion retain separate gaps.
   Numeric-warning escaping, binary IF derivation, packet overflow and explicit
   results-charset metadata/transcoding remain separate measured gaps.
   Over-64-bit literal truncation,
   JSON DIV/DECIMAL conversions and BETWEEN prepare-warning lifetime remain
   separate open gaps.
   Prepared multi-item TIME IN and CAST need one expected-type contract across
   prepare metadata, binding conversion and evaluation. MySQL's prepared TIME
   parameters have precision six; CAST parameters can inherit DATETIME. This
   executor currently infers a placeholder's type from its bound value. Prepared
   CASE WHEN already inherits TIME and preserves its query/execute difference.
   [MySQL's comparison implementation](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_cmpfunc.cc)
   distinguishes sorted STRING IN lists from simple CASE's packed temporal
   reader. Verify IN and CAST together; do not add per-function parameter
   exceptions. COUNT comparisons expose the same contract: bound '1x' produces
   INTEGER warnings per group on MySQL, versus one DOUBLE warning here; invalid
   text literals also differ at prepare time.
2. **M5.47: semijoin/antijoin strategies.** Integer NOT EXISTS with one correlated
   equality and an unindexed integer/literal predicate now selects a real
   indexed loop or filtered hash build through the existing cost planner.
   Live tests pin both protocols, NULLs/duplicates, fresh execution after writes,
   output order and early locking-stream cancellation. Integer IN/EXISTS can
   now deduplicate an ordered inner index before outer primary-key lookups,
   when the existing join cost search selects that order. Eligibility requires
   a full ascending one-column covering inner index and exact integer keys,
   with at most one integer-column/numeric-literal inner filter. NULLs are
   discarded before deduplication; one lookup runs per distinct remaining key.
   MySQL's trace on the captured case costs LooseScan at 1.40 versus FirstMatch
   at 2.75; the existing ordinary join also selects inner-first. Three of five
   LooseScan captures initially agreed, raising the plan floor 2,113 → 2,116.
   Semijoin-specific costs now close the other two captures (2,118 plans):
   the existing join search weighs the full covering-index read, distinct-key
   evaluation fanout and final outer cardinality separately. ORDER BY and LIMIT
   reach that search before the plan is chosen; small ordered limits choose
   FirstMatch instead. Replay no longer skips any strategy's metadata. Live
   tests pin query/execute fields, warning lists, order, aliases, duplicate/NULL
   keys, filters, limits, changed data, empty inputs and early cancellation.
   Temporary tables keep one-open behavior and skip speculative costing;
   semijoin/loosescan switches disable this path. The outer-first choice now
   uses a real FirstMatch lookup, stopping after its first qualifying inner row;
   earlier duplicates failing the inner filter cannot end the probe. The shared
   candidate preserves outer slots, source fields and index order. Live tests
   cover both protocols, aliases, filters, limits, duplicate/NULL keys, absent
   matches, writes between prepared executions, empty inputs and cancellation.
   A counted test observes three inner records for three outer probes, including
   one rejected duplicate and one absent key, and verifies that every scan closes.
   Unfiltered empty-inner FirstMatch and hash LooseScan now use their physical
   strategies and native cost boundaries; filtered empty ranges retain the
   existing fallback. FirstMatch sort cardinality counts outer rows rather than
   duplicate inner fanout. Bounded unfiltered positive integer IN now selects a
   real materialized lookup when its cost wins; the unique build is lazy.
   With firstmatch=off, the existing lookup for DISTINCT's
   unused last table supplies a one-row Limit and preserves source fields. M5.49
   now supplies a compatible ordered PRIMARY scan, including single-key DESC
   schemas, or sorts the outer table
   before probing when order needs a sort. The existing ordered reader and
   first-table sort are shared; prefer_ordering_index=off retains the covering
   scan and sort. Materialized lookup now shares those cost and indexed-build
   owners within unchanged size caps, with one build after a valid outer probe,
   duplicate outer identity, fresh executions and early closure verified.
   Ordered empty-inner lookup now also costs its competing weedout strategy when
   FirstMatch and LooseScan are disabled; see the verified cost repair below.
   LooseScan heuristic pruning now retains the raw driving prefix independently
   of materialization availability, including the disabled-materialization loop.
   Bounded outer-first weedout now pays its temporary cost and respects its
   switch when FirstMatch or materialized lookup provides an enabled alternative.
   LooseScan-only competition now also models explicit unfiltered disablement
   and preserves native finite-bound pruning.
   Bounded materialized scans use a hash join or nested loop according to the
   captured buffering switch. Both build eagerly, skip an empty build and retain
   duplicate outer identity; a nested loop scans once per distinct inner key.
   Their costs compete with lazy lookup and weedout; the verified matrix is 144/144.
   Bounded inner-first hash weedout now keeps raw inner duplicates, evaluates
   every matching pair and emits each physical outer identity once. Empty or
   all-NULL builds skip the outer scan.
   FirstMatch availability now retains the logical inner alias when disabled;
   last-resort weedout pays its temporary cost and explores tied root prefixes
   only when the alternatives are disabled. Switch cases now agree on 180/180.
   Bounded repeated-scan weedout now streams raw inner rows, reopens the outer
   scan for duplicates and NULL keys, and retains physical identity across visits.
   Its disabled-hash audit agrees on 480/480, including all previously matched
   components. Full Docker verification and pinned-reference replay pass.
   Bounded indexed materialized scans now finish a unique non-NULL build
   before point probes. All 234 selected indexed scans agree; the new indexed
   audit now matches all 960 complete outcomes, including indexed raw weedout.
   Raw duplicate drivers open separate point reads; NULL keys skip probing and
   physical identity is retained after every ON check. The separate disabled-
   materialization audit matches all 1,920 outcomes.
   Bounded trivial correlated EXISTS now shares the same materialized operators;
   its separate 1,920-outcome audit agrees completely.
   Selected constant-range join quotes now share the range selector and its
   row/count/cost readers (M5.49); the 72-outcome range/ref audit agrees fully.
   Compatible two-table integer equalities now share inferred physical ranges
   and join quotes; every row in the 48-case inference audit agrees.
   Bounded inner-key literal residuals now use those prices for partial
   materialization/weedout admission; 2,532/5,760 new outcomes agree completely,
   preserving every earlier matched component. Weedout now caps distinct outer
   identities with full table cardinality, retaining filtered search order and
   range/build prices. This closes 132 field mismatches: 5,748/5,760 field vectors
   agree; all rows/warnings and 2,532 complete plans remain native.
   Native temporary-cost grouping now also corrects 156 small-inner materialized-
   scan choices; exact comparisons and complete-plan counts are unchanged.
   Selected-range filtering facts now also repair default FirstMatch under a
   small ordered LIMIT; all 5,760 row/full-field/warning vectors agree, retaining
   earlier components. Complete plans remain 2,532/5,760.
   **Next:** redundant child Filter placement, broader eligibility and
   access/order comparisons. Baseline/current live probes show
   ordered IN over a nullable
   non-primary key or two empty tables still loses source key flags here
   (4,097 versus the reference's 20,485). MySQL also retains prepare-time
   optimizer switches on a cached statement; this executor replans with current
   settings. A shared prepare-context contract must retain those choices alongside
   parameter expectations. Broader predicates and strategies stay open. M5.48's
   optimizer proofs are complete.
3. **M5.49: access paths, order and filesort.** Single-derived column/COUNT
   condition pushdown filters after grouping and before materialization;
   integer, NULL and numeric/NULL parameters have live coverage. Limits,
   windows, outer joins and shared CTEs retain their boundaries. Compatible
   first-table keys sort before inner lookup joins or reuse a clustered/chosen
   covering index; grouping consumes that order before expanded join rows.
   Outer-first integer semijoins likewise order their outer rows before probes.
   Ordinary single-table whole scans share the same ordered-access decision.
   A compatible covering scan stays selected; otherwise ordering preference
   can select a compatible PRIMARY scan. Preference-off retains the original
   covering scan and sorts only when that scan cannot supply the order.
   DISTINCT keeps its previous access choice even when a unique
   key removes deduplication. Ranges, windows and hash antijoins keep their
   exclusions. Every requested ordering column needs a full matching key part,
   and every requested direction must agree on the same physical forward or
   reverse scan. This handles uniform and mixed schema/SQL directions, including
   PRIMARY parts appended to a secondary key. Extra ordering columns after a
   complete unique key retain the native sort. A secondary part already naming
   a column suppresses the appended PRIMARY copy; a truncated part supplies
   neither that full column nor its order. Independent full parts still cover
   reads. Covering and ordering analysis share this schema extension rule.
   Shared sort-key resolution supplies aliases, positions and constant-order
   proofs. Physical iterators are constructed after access/order settings are
   final; filters still compile eagerly. Live regressions pin both protocols,
   full fields, warnings, plans, physical tie order, LIMIT/OFFSET, directions,
   switches and fresh data. Counted PRIMARY/secondary scans stop after LIMIT
   plus OFFSET rows and close; incompatible orders consume every row before
   sorting. Early locking-stream return releases the writer.
   Bounded integer filesort uses the planner's source estimate and record
   capacity for native queue eligibility and preserves its physical slots.
   Small non-queue buffers now use median-pivot preselection at the native
   half-input threshold, based on actual rows read. A depth limit switches
   adversarial inputs to heap selection. The queue and selection share heap
   repair while retaining their different equality policies. Native peer order
   is verified for whole-table integer layouts, non-queue inputs of at most 16
   rows fitting in memory, and queues keeping fewer than 16 rows including
   OFFSET. Filters, DISTINCT, windows and locking reads remain outside this
   native-layout boundary. Unknown layouts use the same bounded selector with
   arrival position breaking ties, preserving stable fallback results.
   Native regressions cover queue memory/width boundaries and non-queue equal,
   NULL, grouped, monotone, reversed, organ-pipe, zigzag, integer-extreme and
   depth-limit inputs. Both protocols pin full fields, warnings and plans.
   Counted sorts exhaust and close their source once; early stream return
   closes its connection. Read-only AST proof traversal, alias resolution,
   typed planner lookups, bounded join guards and non-null unique-key proofs
   share their existing authorities. Public APIs and diagnostics are retained.
   All 1,133 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
   package smoke, 20,000 seeded executor statements and seven native corpus
   replays pass. The original 144 observations now match completely, closing
   the last 20 row differences. An expanded 1,520-observation matrix agrees on
   rows, all ten metadata fields and warnings; 1,484 also match exact plans.
   Its 36 remaining plan differences are LIMIT 0 OFFSET 1. Core is 334,317 B
   gzipped and facade 334,244 B, both smaller than the preceding commit.
   **Then zero-count planning and sort initialization.** The non-grouped
   planner uses count plus OFFSET for its empty-result and temporary-field
   proofs. Positive-offset queries retain their real Limit/Sort/ordered-scan
   operators; ordered DISTINCT keeps copied-field metadata. A zero count and
   zero offset skips iterator initialization and ORDER BY effects entirely.
   Positive-offset filesorts still read and close their source and evaluate
   every key, producing the same warnings and side effects as MySQL. The
   earlier claim of no sampled effects was incorrect: equality of effects
   was mistaken for absence. Forty-four native query/execute observations
   pin all ten field attributes, warnings, effects and exact plans. All 1,520
   expanded filesort observations now also match exact plans, closing the
   previous 36 plan differences. Counted
   query/execute/stream tests pin no reads at zero offset, required complete
   sorts at positive offsets, closure and writer release. All 1,135 Windows/
   Docker tests, typecheck, lint, nine unchanged size gates, package smoke,
   20,000 seeded executor statements and seven native corpora pass. Core is
   334,323 B gzipped; facade is 334,250 B. The preceding selection commit
   passed every required GitHub job. Budgets, fixtures and the 2,118-plan
   floor are unchanged. M5.49 remains partial.
   **Then bounded unordered DISTINCT initialization.** The existing delivery
   stage materializes projection and deduplication up to count plus OFFSET
   before the enclosing Limit runs. It stops after the needed unique row;
   duplicate-heavy or exhausted inputs still close their physical iterator.
   A zero count and zero offset, impossible inputs and unique-key elimination
   retain their boundaries. Bounded unordered copies do not gain GROUP_FLAG;
   unbounded unordered copies retain it. Existing copied-field metadata
   represents both, without a new public API or descriptive-only stage.
   Two hundred thirty-four native query/execute observations pin duplicate/
   NULL inputs, constants, keys, impossible conditions, bounded/unbounded
   results, all ten field attributes, warnings, effects and exact plans.
   Counted query/execute/stream checks pin unique-row stopping, exhaustion,
   source closure and early-return writer release. All 1,136 Windows/Docker
   tests, typecheck, lint, nine unchanged size gates, package smoke, 20,000
   seeded executor statements and seven native corpora pass. Core is
   334,331 B gzipped; facade is 334,257 B. Fixtures, ceilings and the
   2,118-plan floor are unchanged. All original 52 zero-limit observations
   now agree. The preceding zero-count commit passed every required GitHub
   job. M5.49 remains partial.
   **Then ordered DISTINCT copied values.** The delivery stage projects and
   deduplicates before sorting when every ORDER BY key names a selected
   alias, position or source column. Sort keys read immutable copied slots,
   so selected expressions run once per input row, before deduplication,
   instead of twice or after a zero-count Limit. Unmapped expressions retain
   their prior path; unique-key elimination and zero-offset skips are intact.
   One slot reader serves existing column/star/aggregate/ROLLUP/set-position
   and VALUES readers. Window offsets remain deferred because grouping can
   change their base after compilation. SELECT proof setup and copied-field
   selection share their existing boundaries; constant-row existence is
   checked afresh in each delivery's transaction. Case-insensitive pin names
   are stored once for DISTINCT and grouping rather than reconstructed.
   The native regression now pins 520 query/execute observations, preserving
   every earlier unordered fixture verbatim. Counted query/execute/stream
   checks pin full source consumption, warning order and multiplicity, closure
   and early-return writer release. All 1,136 Windows/Docker tests, typecheck,
   lint, nine unchanged size gates, package smoke, 20,000 seeded executor
   statements and seven native corpora pass. Core is 334,335 B gzipped;
   facade is 334,252 B. The preceding commit passed every required GitHub job.
   The full 572-observation probe now matches 532 complete observations,
   closing 72 differences; 16 bare repeated-expression and 24 duplicate-field
   metadata observations remain. M5.49 stays partial.
   **Then bounded DISTINCT ORDER BY admission.** With ONLY_FULL_GROUP_BY,
   the single physical-table, non-grouped/non-windowed planner resolves all
   ORDER BY names before checking selected expressions and columns. Unknown
   names retain 1054 precedence; unsupported expression classes decline this
   proof. The verified grammar includes columns, literals, parameter identity,
   addition, SIGNED casts, COLLATE and ABS/CONCAT/RAND/LAST_INSERT_ID calls.
   Resolved scope slots and native constant classes establish equivalence;
   SQL spelling and function evaluation do not. Boolean, integer, decimal and
   double constants keep their classes. Hex and bit literals share their byte
   class; introduced bytes can become string constants. COLLATE wraps the
   original literal rather than changing equality inside it. Collation aliases
   share registry IDs. Both protocols pin zero-count errors, aliases, positions,
   qualified names, literal spellings, byte widths, collations and parameters.
   Equal substituted text parameters can be admitted while separate prepared
   parameters are rejected, as on MySQL. Rejected locking statements read no
   rows, initialize no scan and evaluate neither CAST warnings nor LAST_INSERT_ID
   calls through query/execute/stream. Shared AST readers retain each caller's
   subquery pruning and traversal order. Typed speculative name/compile readers,
   index candidate scoring and NULL-safe point bounds preserve their policies.
   There are 210 full native query/execute outcomes, 96 SQL-mode-off admission
   checks and 68 literal-class admission outcomes. All 1,138 Windows/Docker
   tests, typecheck, lint, nine unchanged size gates, package smoke, 20,000 seeded
   executor statements and seven native corpora pass. Core is 334,340 B and facade
   334,261 B gzipped. The preceding commit passed every required GitHub job.
   The 408-observation probe closes 72 missing 3065 rejections, without new
   rejections of previously accepted queries. Six correlated-subquery admission
   gaps remain. The 572 copied-value observations are unchanged, with 532 full
   native matches. Prepared arithmetic metadata and SQL-mode-off metadata/order
   choices remain separate measured gaps. M5.49 stays partial.
   **Then repeated SIGNED casts on copied values.** Admission equality alone
   does not prove reuse: copying additionally requires exact string constants,
   supported deterministic scalar children and every selected expression to
   have a proof. RAND and LAST_INSERT_ID decline that stronger proof. Only a
   repeated SIGNED cast adds a slot binding here; aliases, positions and direct
   columns retain their existing bindings. Every sort key must be covered
   before the iterator projects once, deduplicates and sorts those copies.
   Partial coverage keeps original keys and their evaluation path. Sort types
   remain the original compiled types, and early physical sorts stay separate.
   Qualification, case/parentheses, CONVERT spelling, descending order, supported
   pure alias collisions and fully covered mixed keys match native behavior.
   LIMIT 0 at positive offsets still fills and closes the required temporary
   table. Shared ORDER BY resolution preserves the caller's aggregate/window
   context and positional/name error policies without a second selected-list
   projection. The permanent test pins 364 complete native query/execute
   outcomes, four executions after writes through a cached statement, and two
   boundary checks proving case-different constants both execute (their warning
   ordering remains open). Thirty added query/execute/stream cases count and
   close repeated-CAST/CONVERT physical scans. All 1,139 Windows/Docker tests,
   typecheck, lint, nine unchanged size gates, package smoke, 20,000 seeded
   executor statements and seven native corpora pass. Core is 334,351 B and
   facade 334,266 B gzipped. The preceding commit passed every required GitHub
   job. At that boundary the 572-observation matrix had 548 full matches,
   closing its 16 repeated-CAST warning gaps. Its remaining 24 source-field
   flags are now closed below.
   At that boundary the 442-expression matrix had 286 full matches, closing 64
   complete CAST outcomes and the warnings in 24 duplicate-computed-field
   outcomes, whose metadata still differs. No new differences appear in either
   matrix. M5.49 stays partial.
   **Then first-only flags on duplicate source fields.** A materialized
   single-table DISTINCT now tracks resolved local source slots: only the
   first selected copy carries GROUP_FLAG. Aliases, qualification, case and
   expanded stars preserve each output's names, nullability and other flags.
   Computed expressions remain separate, as do stream/window fields. Unique
   key elimination, constants, PREPARE and zero-count/offset decisions retain
   their existing boundaries. Shared metadata patches keep expression
   evaluators unchanged; grouped and ungrouped planners share result-column
   reporting, window-field marking and local field resolution. Repeated LIMIT
   parsing is consolidated without changing count-before-offset error order;
   grouped planning reuses its already parsed count.
   The new test pins 564 complete native query/execute outcomes, PREPARE's
   source metadata and four executions after writes through a cached statement.
   Forty-five added query/execute/stream cases count reads and closure while
   retaining CAST warning order. All 1,140 Windows/Docker tests, typecheck, lint,
   nine unchanged size gates, package smoke, 20,000 seeded executor statements
   and seven pinned corpora pass. Core is 334,338 B and facade
   334,257 B gzipped, within unchanged ceilings. The preceding commit passed
   every required GitHub job. The 648-observation probe closes all 242 metadata
   mismatches, reaching 584 full matches with no new differences; its remaining
   64 plan differences concern pinned/const-table access and repeated PRIMARY
   fields ordered in mixed directions. The 442-expression matrix reaches 310
   full matches, closing 24 more source-field flags; computed-field flags and
   volatile-expression outcomes remain open. Existing fixtures and the
   2,118-of-2,248 relational plan floor stay unchanged. The unchanged
   572-observation initialization matrix now matches every outcome completely.
   The 158 type/case-fold probe is unchanged; the 408 admission probe closes
   eight duplicate-alias field differences with no new mismatches. M5.49
   remains partial.
   **Then first-only flags on verified duplicate SIGNED fields.** The shared
   identity reader now names three contracts: admission, copied-value reuse
   and field-key membership. Field equality can fold string constants while
   keeping both evaluators; copied-value reuse still requires exact strings.
   Only local source fields and root SIGNED casts over the verified deterministic
   grammar share membership. Explicit COLLATE wrappers, literal classes and
   parameter indices retain their distinctions; outer-depth and volatile
   references decline the field proof. Plain and grouped SELECT share ordered
   star expansion while retaining their compilation/naming precedence, physical
   slots and nullability. Window compile contexts and transaction environments
   share builders without caching execution facts.
   The native test pins 828 full query/execute outcomes, PREPARE metadata and
   four cached executions after writes. Text substitution can fold equal
   literal parameters while execute preserves their separate indices. Eight
   additional native outcomes guard star fields and field-list errors; 45 added
   counted query/execute/stream cases preserve both evaluations' interleaved
   warnings, read bounds and closure. All 1,142 Windows/Docker tests, typecheck,
   lint, nine unchanged size gates, package smoke, 20,000 seeded executor
   statements and seven pinned corpora pass. Core is 334,322 B and facade
   334,257 B gzipped. The preceding commit passed every required GitHub job.
   Of 900 new observations, 860 match fully: 385 field mismatches close without
   regressions. Twelve introduced-literal flags and 24 const-table plan/warning
   outcomes remain outside this boundary. The 442-expression probe reaches 334
   full matches, closing another 24 computed-field flags. The 572, 416, 648,
   408 and 158-observation probes are unchanged. Existing fixtures, ceilings
   and the 2,118-plan floor are preserved; M5.49 stays partial.
   **Then repeated resolved ORDER BY columns.** Ordered-access selection
   keeps only the first occurrence of each resolved local field and its
   direction. Qualification, alias/ordinal binding and opposite directions on
   later copies preserve that first order. The proof still requires every key
   to be a local same-alias column, every requested physical prefix to be
   unprefixed, and all parts to agree on one scan direction. Computed/volatile
   keys, different columns after a PRIMARY key and unrelated access guards keep
   their existing sort/evaluation paths. Candidate matching no longer copies
   a key-prefix array; its one caller supplies the explicit ordering preference.
   The 384-outcome native probe reaches 380 full matches, closing all 240 plan
   and four row-order differences without regressions. Four selected-CAST
   OFFSET warning differences remain a separate projection boundary.
   The new test pins 372 complete native outcomes, PREPARE metadata and six
   fresh cached query/execute/statement executions after writes. Existing mixed
   direction tests add 576 complete text/composite-index outcomes under both
   ordering preferences. Forty-eight added query/execute cases count LIMIT plus
   OFFSET reads and closure; eight added locking stream returns release the
   writer and close their source. All 1,153 Windows/Docker tests, typecheck,
   lint, nine unchanged size gates, package smoke, 20,000 seeded executor
   statements and seven pinned corpora pass. Core is 334,327 B and facade
   334,263 B gzipped. The preceding commit passed every required GitHub job.
   The 648-source probe closes its ten repeated-PRIMARY plan differences,
   reaching 594 full matches; 54 pinned/const-table plans remain. The 572,
   442, 416, 408, 158 and 900-observation probes are unchanged. Existing fixtures,
   ceilings and the 2,118-plan floor are preserved; M5.49 stays partial.
   Ordinary ordered-index LIMIT/OFFSET now precedes SELECT projection, closing
   all four selected-CAST warning gaps; this matrix now matches all 384 outcomes.
   WHERE, sort, DISTINCT, HAVING and window evaluation retain their separate
   boundaries. **Next:** continue the measured M5.10 binary COLLATE byte proof
   before broader access/order work. Introduced literals,
   broader field classes and alias/star/GROUP error precedence remain measured
   gaps. The 416-observation probe retains 96 warning, 22 plan and 22
   effect differences for incomplete key coverage, case-different COLLATE,
   const-table and volatile expressions; no new differences were introduced.
   Native may admit case-folded constants while evaluating both; admission
   equality alone cannot establish copied-value reuse. Aliases within ORDER BY
   expressions, other function/cast/operator classes, correlated admission,
   prepared arithmetic metadata and SQL-mode-off choices remain open.
   Another 158 type/case-fold observations are unchanged from the preceding
   commit; 146 match native completely. Twelve pre-existing differences expose
   BIT copied-field/type behavior and pinned-column grouping plans. Keep those
   separate from this copied-value timing repair.
   Larger queues/buffers, variable-length layouts, broader eligibility,
   spilling and grouped/window LIMIT initialization remain open.
   The pinned [filesort](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/filesort.cc),
   [queue](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/bounded_queue.h)
   and [selection](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/filesort_utils.cc)
   guide the verified boundary. The ignored [GCC heap](https://github.com/gcc-mirror/gcc/blob/releases/gcc-11.5.0/libstdc%2B%2B-v3/include/bits/stl_heap.h)
   and [selection](https://github.com/gcc-mirror/gcc/blob/releases/gcc-11.5.0/libstdc%2B%2B-v3/include/bits/stl_algo.h)
   sources inform the depth/equality checks; no upstream code is vendored.
   Broader prefix-byte/range, non-covering and access/order costs remain open,
   alongside actual covering reads, FORCE/IGNORE INDEX costing, broader
   grouping/pushdown, COUNT conversion warnings and missing inner EXPLAIN
   children under window materialization. HAVING/stream placement needs a real
   projection/materialization boundary; do not add an identity stage merely
   to move an EXPLAIN label.
4. **M5.50: finish writes in one descent.** Prepared BTree upsert copies key/old
   bytes and releases the read pin before overflow encoding and undo writes.
   Row-write reentry is refused across handles sharing a journal/index;
   callback failures roll back preparation writes. Clustered INSERT, UPDATE and
   delete-mark use it, including secondary entries after their required unique
   prefix scan. Uniqueness still refuses before preparation, permits NULL keys
   and compares PAD SPACE keys; missing/marked secondary deletes add no undo.
   NativeTable UPDATE/delete now use the previous fields
   returned by that mutation instead of rereading the clustered row. Existing
   boolean wrappers remain; returned fields own their bytes, including separation
   from a pending ROW image inside an outer batch. Same-key/collation-equivalent
   replacement, changed-key delete/insert, secondary sequencing and hidden row IDs
   retain their behavior. Undefined means no replacement, while empty bytes replace;
   absent/marked UPDATE/delete rows add no undo or ROW event. Exact descent/pin
   tests, ROW images, failed overflow/undo preparation, historical visibility,
   purge and schema-growth splits are covered. All 1,108 Windows/Docker tests,
   typecheck, lint, nine unchanged size gates, installed-package smoke,
   20,000 executor statements at seed 20261010 and 10,000 Docker crash points
   pass. All seven pinned-reference corpora reproduced unchanged after INSERT.
   Tests forbid the table's separate current read and pin duplicate
   failure atomicity, hidden IDs, PAD SPACE keys and returned-byte ownership.
   Secondary migration passes all 1,110 Windows/Docker tests, typecheck, lint,
   unchanged size gates, package smoke, 20,000 seeded executor statements and
   10,000 crash points. The final 61 focused Docker tests also pass. Exact descent counts start
   after the uniqueness scan. Tests cover tombstone reinsertion and old views;
   a repeatable-read reader becoming a writer uses the latest row's secondary
   key, which can be reused by a later unique insertion.
   Paired best-of-five INSERT runs in the same Docker container measure the
   pre-M5.50 baseline at 40.3, 39.0 and 42.8 ms, versus 42.7, 42.2 and 42.7 ms
   now, alternating order. No gain exceeds the documented ±30% noise; the
   performance criterion remains unmet. In-place schema upgrades retain the
   descended insertion path; growth that rebuilds a leaf retains the full
   insertion fallback. The shared preparation guard now also refuses own-tree
   destruction before Store changes its generation, directory, counters, cache
   or allocation. Root/deeper-tree regressions cover direct/nested alias handles,
   replacement/no-op refusal, independent-write rollback, caught refusal then
   success, independent-tree drops, guard cleanup and persisted reopening.
   All 1,277 Windows/Docker tests and 10,000 crash points pass with the normal
   gates. Transactional schema upgrades need shared durable schema ownership:
   Store rollback/purge reopen
   trees at version zero and cannot process a manually versioned transactional
   tree. A baseline/current probe confirms this pre-existing limitation. Native
   SQL tables use version zero; generic BTree upgrade/split behavior is verified.
5. **M6: browser storage and hosting**, after the outstanding engine/planner work.
   Build against established VFS/protocol seams: OPFS, workers, leader election
   and actual browser crash tests. InnoDB interchange remains M7.

---

## Decision log

Append-only. These are lifted out of the design docs so that "what did we decide
about page size" is one lookup rather than a re-read of eleven documents. The
`Docs` column is where the argument lives; this table records only the
conclusion.

| # | Date | Decision | Why | Docs | Supersedes |
|---|---|---|---|---|---|
| D-01 | 2026-09-05 | **Author TypeScript; run it with Node's type stripping.** No build step for tests. Only erasable syntax: no `enum`, no `namespace`, no parameter properties, no decorators — enforced by `erasableSyntaxOnly` + `verbatimModuleSyntax`. `tsc --emitDeclarationOnly` produces `.d.ts` for publishing; a bundler produces the browser artefact. `engines.node` becomes `>=22.18`. | Byte-level codecs and a type system are exactly the code that benefits most from types, and type stripping buys that without a build step between "edit" and `node --test`. | — | — |
| D-02 | 2026-09-05 | **npm workspaces monorepo from the first commit**, `packages/*` exactly as doc 03's table. | The boundaries in doc 03 are load-bearing. Enforcing them later means discovering they were violated. `@myjs/protocol` and `@myjs/innodb` are independently useful and should be independently publishable. | [03](./03-architecture.md) | — |
| D-03 | 2026-09-05 | **This file is the single roadmap.** No second planning document. | Two roadmaps drift; the stale one is always the one someone reads. | — | — |
| D-04 | 2026-09-05 | **Granularity is milestone → work item → acceptance assertion.** Every item names its docs, its dependencies, and one falsifiable "done when". | "Implement MVCC" is not a task. An item you can finish in a sitting and prove you finished is. | — | — |
| D-05 | — | **The wire protocol is the primary compatibility contract**, ahead of SQL semantics, ahead of file format. | It is small, fully specified, and it buys the entire driver and ORM ecosystem at once — and those drivers then become the conformance suite. | [00](./00-goals-and-scope.md), [02](./02-strategy.md) | — |
| D-06 | — | **Reimplement in JavaScript; do not port MySQL to WASM.** | No single-user mode; InnoDB starts ~20 mandatory threads; the build pulls in ICU/OpenSSL/protobuf/Boost; and MySQL is GPLv2, which would infect every consumer. | [02](./02-strategy.md) | — |
| D-07 | — | **Native storage is our own format. InnoDB is interchange, not our on-disk format.** We read and write single `.ibd` + `.cfg` tablespaces; we never attempt to write a whole datadir. | Transportable tablespaces are the boundary MySQL itself documents and supports. A whole datadir means a version-specific internal data dictionary and redo log — a compatibility surface MySQL does not promise even to itself. | [02](./02-strategy.md), [27](./27-data-dictionary.md) | — |
| D-08 | — | **Single writer, many concurrent readers.** No lock manager, no deadlock detection, no lock escalation, no two-phase locking. | OPFS sync access handles are exclusive and `readwrite-unsafe` is Chrome-only, so a multi-writer browser design is unshippable. It also matches the deployment — one app, one database — and removes the bug class where database engines actually go wrong. | [41](./41-durability-and-concurrency.md) | — |
| D-09 | — | **Still report `ER_LOCK_DEADLOCK` (1213/40001), `ER_LOCK_WAIT_TIMEOUT` (1205), `ER_DUP_ENTRY` (1062/23000)** even though there is no lock manager. | ORMs and application retry loops are keyed to these numbers. Reporting them means existing recovery logic works. | [41](./41-durability-and-concurrency.md), [25](./25-mvcc-and-undo.md) | — |
| D-10 | — | **Target MySQL 8.0/8.4 behaviour**, default collation `utf8mb4_0900_ai_ci`. Advertise `8.4.0-myjs`; never a MariaDB-shaped version string; set `CLIENT_LONG_PASSWORD` and zero the reserved bytes so MariaDB-aware clients do not read extended capabilities out of them. | Clients sniff the version string and branch on it. | [00](./00-goals-and-scope.md), [12](./12-connection-phase.md) | — |
| D-11 | — | **`caching_sha2_password` is the default plugin; `mysql_native_password` is supported.** In-process connections are treated as already secure, so the full path degenerates to compare-and-go — no RSA, no key management. The RSA branch exists only for the Node TCP listener. Never implement `mysql_old_password`. | Auth is not the security boundary for an embedded database; it exists so that drivers work. Treating in-process as secure removes a whole dependency without weakening anything real. | [13](./13-authentication.md) | — |
| D-12 | — | **Never advertise `CLIENT_COMPRESS` or `CLIENT_SSL` in-process.** zstd never in-process or in the browser; zlib optional on the Node TCP listener. In the browser, `wss://` provides transport security and the connection is simply reported as secure to the auth layer. | It costs CPU to compress a `memcpy`. | [17](./17-protocol-extras.md) | — |
| D-13 | — | **`CLIENT_MULTI_STATEMENTS` is honoured when negotiated but gated behind an engine-level switch defaulting off.** | It turns a SQL-injection point into arbitrary statement execution. | [14](./14-command-phase.md) | — |
| D-14 | — | **The error table is generated from `share/messages_to_clients.txt`**, not transcribed by hand. | ~1,200 codes with SQLSTATEs. Transcription is how you get 1451 and 1452 the wrong way round. | [14](./14-command-phase.md) | — |
| D-15 | — | **JS type mapping matches `mysql2` exactly**: DECIMAL and TIME as strings, BLOB/BINARY as `Uint8Array`, BIGINT as number-if-safe else `BigInt`, JSON parsed, zero dates as `null` unless `dateStrings`. | Swapping a real connection for ours must change nothing in the application. | [15](./15-wire-types.md) | — |
| D-16 | — | **Keep InnoDB's 16 KiB page size, but use 4 KiB WAL blocks** (not InnoDB's 512 B). | 16 KiB gives a one-to-one mapping for imported pages and three tree levels over a billion rows. 512-byte log blocks would be 8× the header overhead for no atomicity benefit on any storage we target. | [21](./21-innodb-file-layout.md), [26](./26-redo-and-recovery.md) | — |
| D-17 | — | **CRC32 for reading InnoDB pages (accepting the legacy variants); CRC32C for our own WAL blocks.** A block that does not verify did not happen. | InnoDB has used CRC32 since 5.6 and it is the only variant worth writing. Our WAL must be self-verifying because OPFS `flush()` is best-effort. | [21](./21-innodb-file-layout.md), [26](./26-redo-and-recovery.md), [40](./40-vfs.md) | — |
| D-18 | — | **Full-page images in the WAL after each checkpoint, instead of a doublewrite file.** Plus two alternating superblocks, a monotonic LSN per block, and LSN at head *and* tail of every data page. | Our WAL is already sequential and already being flushed; a second file buys nothing. These four properties together degrade "best-effort flush" from "the database may be corrupt" to "we may lose the last few commits", which is a guarantee we can state honestly. | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | — |
| D-19 | — | **Bitmap allocator, not InnoDB's on-disk linked lists. Dense page directory, not InnoDB's sparse 4-to-8-owned design. No change buffer.** | The linked lists and the sparse directory are 1990s optimisations for storage we do not target. A dense `Uint16Array` directory is a pure binary search with no linear tail. | [21](./21-innodb-file-layout.md), [22](./22-innodb-page-formats.md) | — |
| D-20 | — | **Implement COMPACT and DYNAMIC; REDUNDANT read-only for old imports; COMPRESSED never.** Our own records adopt DYNAMIC's atomic-BLOB semantics — a large value is a pointer, with no local prefix. | COMPACT and DYNAMIC cover every MySQL 5.7+ table. Whole-page compression at the VFS layer is the better answer to COMPRESSED (see Q-08). | [23](./23-innodb-row-formats.md) | — |
| D-21 | — | **Do not build instant DDL into the record format.** Use a page-level schema version instead, so a page stays independently decodable. | InnoDB's per-record version byte makes the null bitmap's *size* version-dependent, which couples every record decode to the dictionary. | [23](./23-innodb-row-formats.md) | — |
| D-22 | — | **Adopt MySQL's binary JSON and every doc-24 column encoding byte-for-byte, even inside our own format.** | They are shared with binlog row images and with `.ibd` files, so one codec serves the engine, the importer and the change stream. Binlog and `.ibd` compatibility come free. | [24](./24-column-encodings.md), [28](./28-json-binary.md) | — |
| D-23 | — | **Generate MySQL's own collation weight tables; reject `Intl.Collator` as the primary source** (fallback only, with a loud warning). | `Intl.Collator` does not implement MySQL's tailorings, gives no sort key, and its semantics move with the JS engine version — which would make stored index bytes engine-version-dependent. | [29](./29-charsets-and-collations.md) | — |
| D-24 | — | **Storage engines in scope: `native`, `memory`, `innodb-ro`, `csv`.** MyISAM read-only and later; ARCHIVE skipped; BLACKHOLE/FEDERATED/NDB/MERGE out. | An embedded database does not need an engine zoo; it needs enough import formats. | [30](./30-other-engines.md) | — |
| D-25 | — | **The WAL record format must carry logical before/after row images from its first version.** This is a blocking decision inside M4, not a note (M4.13). | Change streams and live queries (M8) are a projection of the WAL. Retrofitting logical information onto a purely physical log is painful, and doc 26 says to decide it *now*. | [18](./18-binlog.md), [26](./26-redo-and-recovery.md) | — |
| D-26 | — | **The catalog format is explicitly versioned, with a documented migration per change**, from its first commit (M4.23). | Same reason SQLite publishes a file format document. A store whose format is undocumented cannot be migrated, only abandoned. | [27](./27-data-dictionary.md) | — |
| D-27 | 2026-09-06 | **The isomorphic lint gate exempts `packages/vfs`, `packages/server` and `packages/core/src/host/*`** — everything else is `Uint8Array`/`DataView` only. | Ground rule 1 names only `packages/vfs`, but `@myjs/server` must open TCP sockets, and the `mysql2`-facing duplex must emit Node `Buffer`s: `mysql2`'s `PacketParser.executePayload` calls `chunk.copy()`, which `Uint8Array` does not have. Confining that to conditional-export host files keeps every other package provably portable. | [03](./03-architecture.md), [42](./42-public-api.md) | — |
| D-28 | 2026-09-06 | **`execProtocol(bytes)` answers one call with every response byte that call produced, and each `createConnection()` is a connection of its own: its framer, sequence counter, negotiated capabilities and statement table.** *Recorded 2026-10-09: M1.24 built this and the code and Q-11 cite D-28, but the row was never written; the number was free, and is filled rather than reused.* | It is PGlite's shape and the simplest seam a transport can sit on: the TCP listener, the stream and the port are each a loop around it. Its cost is Q-11's: a result set is materialised before it is returned, which `db.stream()` cannot accept. | [03](./03-architecture.md), [42](./42-public-api.md) | — |
| D-30 | 2026-09-06 | **Typed-error taxonomy**: `MyjsError` is the base carrying `code`, and optionally `errno`/`sqlState`; `ProtocolError` covers framing and parse faults; `SqlError` (M1) carries `mysql2`'s exact shape. `@myjs/bytes` never resolves error numbers — it has no dependencies, so `@myjs/protocol` supplies them from the generated table. | Ground rule 5 requires a typed error from every parser, and doc 42 requires `err.code`/`err.errno`/`err.sqlState`/`err.sqlMessage` to match `mysql2` so existing `catch` blocks keep working. Doc 11 names `ProtocolError` without giving it a shape. | [11](./11-protocol-primitives.md), [42](./42-public-api.md) | — |
| D-29 | 2026-09-06 | **The generated error table carries facts only — error number, symbol and SQLSTATE — never MySQL's English message text.** Messages for the codes we emit are authored in `packages/protocol/src/errors/messages.ts`. | D-14 says generate rather than transcribe, and ground rule 7 keeps GPLv2 material out of this MIT repository. Numbers and SQLSTATEs are facts; the message templates are expression. The source is fetched at generation time, hashed, and discarded. | [14](./14-command-phase.md) | — |
| D-31 | 2026-09-06 | **Numeric caps on unauthenticated input**: `max_allowed_packet` 64 MiB, enforced per chunk *during* reassembly rather than on the finished buffer; connection attributes ≤ 64 KiB and ≤ 128 pairs, rejected before authentication; accumulated `COM_STMT_SEND_LONG_DATA` capped at `max_allowed_packet`. | Docs 12, 16 and 17 all require caps and name no numbers. Every one of these bounds an allocation a peer can force before it has proved anything about itself. | [12](./12-connection-phase.md), [16](./16-prepared-statements.md), [17](./17-protocol-extras.md) | — |
| D-32 | 2026-09-08 | **The neutral value structs live in `@myjs/bytes`, not in `@myjs/types`.** `SqlValue`, `MysqlDateTime`, `MysqlTime` and their two guards move down; `@myjs/protocol` and `@myjs/types` both re-export them. `@myjs/types` owns the *rules* — it defines a separate engine-facing `StorageValue` and a named `toDriverValue()` for D-15, rather than widening `SqlValue`. | Two packages above need to *name* these structs and neither may depend on the other: the release plan ships `@myjs/protocol` at 0.1 and `@myjs/charsets`/`@myjs/types` at 0.2, so a protocol→types edge would make the 0.1 artefact unpublishable as specified. D-30 set the precedent when it put `MyjsError` in `bytes` for the same reason. The move is type-only apart from the two guards. | [11](./11-protocol-primitives.md), [15](./15-wire-types.md), [24](./24-column-encodings.md) | — |
| D-33 | 2026-09-08 | **`@myjs/protocol` never depends on `@myjs/charsets`.** Behaviour that needs a session is injected (a `Transcoder`, like `Capabilities` and `Executor` before it); the two facts the protocol must decide *without* one — the pre-authentication connection-charset check and `columnLengthForChars` — are generated into `packages/protocol/src/constants/charset-metrics.ts` by the same parse that builds the full registry, so there is no hand-maintained second copy. | The release plan ships `@myjs/protocol` at 0.1 and `@myjs/charsets` at 0.2, so a dependency edge would make the 0.1 artefact unpublishable as specified — and `@myjs/protocol` is the standalone MySQL protocol toolkit that does not otherwise exist. The widths cost ~400 bytes gzipped; the collation tables would cost tens of KB. | [12](./12-connection-phase.md), [15](./15-wire-types.md), [29](./29-charsets-and-collations.md) | — |
| D-35 | 2026-09-09 | **Every variable-length index key part declares its byte width, and is padded to it.** A PAD SPACE `'text'` part is padded with the collation's own pad weight; anything else is NUL-padded and carries a two-byte length suffix. `'text'` parts must always declare a width; a truncating `'bytes'` part must declare one unless it is last. | The memcmp-ordering property was not true for a PAD SPACE collation and no test noticed, because the one test that should have compared key order against `Collation.compare` compared it against `Collation.sortKey` instead. PAD SPACE does not merely ignore trailing spaces — it *inverts* order against raw bytes: `'a' > 'a\\x01'`, because the shorter value is extended with 0x20 and 0x20 > 0x01. Trimming cannot express that; only bringing both keys to a common width can, which is what MySQL's `strnxfrm` does with `nweights`. The length suffix exists because NUL padding alone cannot tell `'a'` from `'a\x00'`, which a unique index must. Separately, concatenating variable-length parts is ambiguous — `'ab' + 'c'` and `'a' + 'bc'` are the same bytes — and a declared width fixes that too. | [24](./24-column-encodings.md), [29](./29-charsets-and-collations.md), [43 §4](./43-testing.md) | — |
| D-34 | 2026-09-08 | **Until M7, storage-encoding golden vectors come from binlog row images and `WEIGHT_STRING()`, not from `.ibd` files.** `mysqlbinlog --hexdump` under `binlog_row_image=FULL` yields the doc-24 bytes; `SELECT HEX(WEIGHT_STRING(s LEVELS 1))` yields exactly what `Collation.sortKey()` must produce. Committed fixtures replay offline and gate; re-capture against a real server is informational, as `trace-capture` already is. | Doc 43 §4 asks for real `.ibd` files, but `@myjs/innodb` does not exist until M7 — so M2 would otherwise have no differential check at all. Doc 24 says the `decimal2bin` form is used identically in `.ibd` files and binlog row images, and doc 28 says the same of binary JSON, so the binlog gives the same bytes years earlier. The two documented divergences (binlog integers are little-endian and unflipped; binlog `VARCHAR` keeps its length prefix) are a feature: the fixture records which framing it is, which makes doc 24's "both steps matter" sentence executable. | [24](./24-column-encodings.md), [29](./29-charsets-and-collations.md), [43 §4](./43-testing.md) | — |
| D-36 | 2026-09-10 | **A lazily loaded collation is reached by an explicit `loadCollation()`, not by a lazy `sortKey`.** `collation()` stays synchronous and throws `ER_COLLATION_NOT_LOADED` — a different code from `ER_COLLATION_NOT_IMPLEMENTED` — for a collation whose tables exist but are not resident; `collationAvailability()` names the three states `resident` / `loadable` / `unsupported`. The async half is called on the async edge (a `SET NAMES`, opening a table). The question this answers is *how a lazy module survives a synchronous API*, which M2.20's item text did not say. | Ground rule 3 is "async at the edges, sync in the core", and `Collation.sortKey` is synchronous the whole way down into `encodeKeyPart` — an index key cannot afford to discover mid-build that it needs a 50 KB download. The distinct error code matters because the two refusals need opposite responses: one sends a caller looking for a missing feature, the other for a missing await. A corollary, found by measurement: the *preload* entry point must live apart from the resolver, because a module that can synchronously return a weighted `Collation` must statically contain every weight table it can return — wiring the preload through `collationAvailability` put all 42 legacy 8-bit tables into `@myjs/core` and cost it 10 KB gzipped. | [29](./29-charsets-and-collations.md), [03](./03-architecture.md) | — |
| D-37 | 2026-09-10 | **`enum_field_types`, the column flags and the binary collation id live in `@myjs/bytes`.** `FIELD_TYPE`, `COLUMN_FLAG` and `CHARSET_BINARY` move down out of `@myjs/protocol`, which re-exports them. The test of what belongs there: a *fact about the format*, not *behaviour*. What stays in `@myjs/protocol` is the wire-only part — the parameter type word, its unsigned bit, and the charset ids a handshake advertises. The temporal renderers (`renderMysqlDateTime`, `renderMysqlTime`) move down by the same rule. | The third time this edge has forced a placement choice, after D-30 (`MyjsError`) and D-32 (`SqlValue`), and for the same reason each time: two packages above need to name something and neither may depend on the other. `@myjs/types` must dispatch on a field type in `decodeStorageValue` while `@myjs/protocol` needs the same numbers to frame a column definition, and the release plan ships protocol at 0.1 and types at 0.2. These numbers are the same in a wire packet, a binlog row image and an `.ibd` file — which is precisely why more than one package needs them. The renderers move for the same reason and collapse a duplication at the same time: `renderDateTime` and `binaryValueToText` were two independent renderers of one value, reached from different directions, and a third was about to be written. | [15](./15-wire-types.md), [24](./24-column-encodings.md), [03](./03-architecture.md) | — |
| D-38 | 2026-09-10 | **A statement's bytes reach the executor undecoded; the dispatcher turns them into text with the session's `Transcoder`.** `parseComQuery` returns `sqlBytes` rather than `sql`, and `parseComStmtPrepare` returns bytes. | They were decoded with `fromUtf8`, unconditionally, and `Session.transcoder` was never consulted — right for the default charset and silently wrong for every other. A `latin1` client's `0x80` came back as U+FFFD, so the statement that ran was not the statement that was sent; a `gbk` client's multi-byte characters were mangled. That is E-11's mistake one layer up, and doc 14's own sketch already wrote `parseComQuery(session, payload)` — the doc was right and the code had diverged. Keeping the bytes is also what M3.1 needs: a lexer must see the original sequence to know that a `gbk` lead byte's `0x5C` trail is part of a character and not a backslash escape. D-33 stays intact — the protocol still resolves no charsets, it just stops guessing. **Not yet fixed, same family:** `COM_INIT_DB`, `COM_FIELD_LIST` and query-attribute names still assume UTF-8. Each needs its own thought (a database name is nearly always ASCII; `COM_FIELD_LIST` is deprecated), so they are recorded here rather than swept in. | [14](./14-command-phase.md), [29](./29-charsets-and-collations.md) | — |
| D-39 | 2026-10-07 | **MySQL's reserved-word list is captured from a real server, not generated from `reference/`.** `tools/capture-keywords.mjs` reads `INFORMATION_SCHEMA.KEYWORDS` on the pinned 8.4.11 and writes `packages/parser/src/keywords.ts`; re-capturing in the `type-vectors` job is the drift check. A deliberate exception to D-14's "generate from the source", in the same direction as M3.5's hand-written type table. | In the source, the *words* are in `sql/lex.h` but reserved-ness is not a field anywhere — it is which `ident_keyword*` productions of `sql_yacc.yy` mention a word, and MySQL's build derives the `KEYWORDS` table from Bison's output. Re-deriving it means parsing Bison. The server has already done that derivation and publishes the answer as a table of facts — a word and a flag — so ground rule 7 is untouched. | [43 §2](./43-testing.md) | — |
| D-40 | 2026-10-07 | **A parsed tree is at most 1,000 levels deep** (`MAX_TREE_DEPTH`, checked once per statement by an iterative walk), alongside the parser's 100-level recursion bound. The deparser writes a left-nested run of one operator flat, since every MySQL operator but `:=` associates left. | `MAX_DEPTH` bounds the parser's recursion, but left-associative chains — `+`, `OR`, `JOIN … ON`, `UNION` — are built by loops, so a tree can be as deep as its input is long, and everything that walks it afterwards recurses: the deparser overflowed at about 2,700 terms and M5's resolver and evaluator would too. One bound at parse time keeps every consumer stack-safe without rewriting each as a loop. MySQL's deepest corpus tree is 70 levels. **A recorded divergence:** MySQL flattens `AND`/`OR`/`UNION` chains into lists and accepts chains longer than this refuses; a real client meeting the limit is the signal to flatten them into n-ary nodes. | [43 §6](./43-testing.md) | — |
| D-41 | 2026-10-07 | **One data file per database, with a superblock on page 0, page 1 reserved for its alternate, and a directory B+tree mapping index ids to root pages that never move.** Until Tier 4 the file is persistent and not crash-safe. | SQLite's shape. It needs the fewest OPFS access handles (doc 40), and a file per table is what interchange needs (D-07), not what storage needs. Fixed roots (InnoDB's `btr_root_raise_and_insert`) mean the directory changes only when an index is created or dropped. | [21](./21-innodb-file-layout.md) | — |
| D-42 | 2026-10-07 | **The B+tree is an ordered unique map from `Uint8Array` to `Uint8Array`, compared with `memcmp` only.** Keys come from `encodeKey`. A clustered leaf holds PK sort key + record, and a secondary entry is secondary key ++ PK key with an empty value. Every variable-length key part declares its width, and the longest key is checked at index definition. | The tree never sees a type or a collation, so it can be tested exhaustively against a `Map`. A PAD SPACE sort key is not reversible, so the record must carry the values. Appending the PK makes every secondary key unique, which is what lets a nullable `UNIQUE` index hold many NULLs, and it makes the PK recoverable from the entry. Appending it also makes every secondary part non-last, which is why D-35's width becomes mandatory. | [22](./22-innodb-page-formats.md), [24](./24-column-encodings.md) | — |
| D-43 | 2026-10-07 | **The index page has a dense sorted slot array and no record chain and no infimum/supremum records. Every internal page's first cell carries the empty key.** | Departs from doc 22:188, deliberately. With a dense directory (D-19) the chain is a second copy of the same order. The sentinels serve the chain and gap locking, and D-08 removes locking. The empty key is a true −∞ under `memcmp`, so the leftmost-record flag becomes a property of the data. | [22](./22-innodb-page-formats.md) | — |
| D-44 | 2026-10-07 | **CRC32C for data pages, not only WAL blocks**, computed over every byte after the checksum and sealed once, when the buffer pool writes the page out. InnoDB's CRC32 stays a read-side concern of `@myjs/innodb`. | D-17 named CRC32C for the WAL alone. One checksum for everything we write is one implementation to trust, and sealing at write time costs one CRC per write rather than one per change. | [21](./21-innodb-file-layout.md), [22](./22-innodb-page-formats.md) | D-17 (extends) |
| D-45 | 2026-10-07 | **The log is a second file: a ring of 4 KiB blocks, each a 20-byte header (CRC32C, salt, LSN, used, first-group offset) and 4,076 bytes of payload. The LSN counts payload bytes. A written block is never rewritten, and the salt changes at every open.** A block that fails its checksum, carries another salt, or does not continue the LSN of the block before it is the end of the log. | Rewriting a half-full block in place is what InnoDB does, and it is safe only because a 512-byte sector write is atomic. On OPFS a 4 KiB write is not, and a torn rewrite would take an acknowledged commit with it, so a durable commit seals its block instead. Continuity plus salt is what stops a stale block from an earlier lap, or one written after a lost one, from being read as the next. The salt counts up rather than being random, so that holds by construction and not by probability. Doc 26's sketch had a `flags` field and no salt; the salt is the field the format needed. | [26](./26-redo-and-recovery.md), [40](./40-vfs.md) | D-17, D-18 (implements) |
| D-46 | 2026-10-07 | **Redo is a byte diff of each page, taken by a journal against the page as its mini-transaction found it. A page's first change since it was last written is logged as an image. Recovery is LSN-guarded, and a page torn on disk is skipped until its image.** | It keeps the tree, the allocator and the overflow code free of logging code: they declare atomic boundaries and nothing else, and the redo is as schema-blind as the tree (D-42). Imaging on a page's own clean→dirty transition, rather than on its first change after a checkpoint as D-18 and PostgreSQL say, is what an *incremental* checkpointer needs. A page written out between checkpoints and changed again must be imaged again, or a tear in its next write has nothing to be rebuilt from. **The first draft of this decision was wrong, and a design review found it.** It claimed that every page in the redo range starts with an image, so recovery would need neither the on-disk page nor an LSN guard. A page written out by a checkpoint that stops short of it, then changed, then torn, breaks that claim. The guard came back, and the claim is now "a torn page always has an image ahead of it". | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | D-18 (refines) |
| D-47 | 2026-10-07 | **A mini-transaction is all-or-nothing in memory as well as on disk.** The pages it changes stay pinned until it ends, and their snapshots are its undo. An error anywhere inside it restores every page and the state outside pages, and a caught inner error does not un-abort it. **Fresh pages** — allocated in it, and free before it — are exempt from pinning and may be written early. That exemption excludes pages still resident and pages it freed itself, and a fresh page is stamped with the mini-transaction's start LSN. | Pinning is what keeps an uncommitted change off disk. The fresh-page exemption is what lets a value larger than the pool be one mini-transaction. The review found that the exemption as first drafted was unsafe. "Allocated here" does not imply "free on disk": a page freed by an earlier mini-transaction that is not yet durable, or by this one, still holds live data if that free is lost. Stamping the start LSN makes the WAL rule flush earlier mini-transactions first, and the freed-here set covers the rest. Aborting in memory also fixed a live leak: `ER_TOO_BIG_ROWSIZE` after `writeChain` used to leave its chain allocated. | [26](./26-redo-and-recovery.md) | — |
| D-48 | 2026-10-07 | **`ROW` records carry a row's logical before and after images, every field inline, in MySQL's text-row encoding (a length-encoded string per field, `0xFB` for NULL), alongside the physical redo and in the same group.** Off-page values are read back in. | This implements D-25 in the log's first version, as D-25 required. A change stream cannot follow a reference to pages that a later change may have freed, so the image must be whole. The encoding is a fact of a format already here, not a new one. Redo ignores the record; a test replays the records alone and rebuilds the table from them. | [18](./18-binlog.md), [26](./26-redo-and-recovery.md) | D-25 (implements) |
| D-49 | 2026-10-07 | **`Store.commit()` is the durability point, following `flushLogAtTrxCommit` 0/1/2 as InnoDB's knob does. `Store.sync()` is the once-a-second flush, and the host calls it.** A checkpoint runs before a mini-transaction when the log is half full or three quarters of the pool is dirty. | Ground rule 3: a synchronous core owns no timer, so "once per second" must belong to whoever owns the event loop. In a synchronous engine, blocking a commit on a backlog (doc 41) means doing the cleaning first; that is M4.3's backpressure. | [41](./41-durability-and-concurrency.md) | — |
| D-50 | 2026-10-07 | **Undo is kept per index entry, not per row.** A record says "index *i*: key *k* was inserted" or "had value *v*", and carries two lists of overflow chains: those to free on purge and those to free on rollback, computed by the index layer when it makes the change. One record type, with explicit `isInsert` and `purgeRemoves` flags. | Redo is per page so that the tree stays schema-blind (D-46); undo per entry does the same for rollback, crash recovery and purge, which then need no catalog. That is what lets M4.18 finish before M4.23. An update writes every off-page field afresh, so a chain belongs to exactly one version and exactly one list frees it. A design review found the double free that inferring "free what the removed row holds" would cause, and the lost version that logging a re-insert over a mark as an insert would cause (InnoDB's `TRX_UNDO_UPD_DEL_REC`). | [25](./25-mvcc-and-undo.md) | — |
| D-51 | 2026-10-07 | **A secondary entry carries its own delete-mark and last-modifier trx id (7 bytes).** It replaces D-42's empty value and M4.21's `PAGE_MAX_TRX_ID` fast path. | Per entry, the two questions MVCC asks of a secondary index are exact and local. A reader asks whether the mark is accurate for its view. Purge asks whether the mark is still the one it is purging. With InnoDB's per-page id, purge needs a `row_purge_poss_sec`-style re-derivation from the clustered record to answer the second. The cost is 7 bytes an entry. | [22](./22-innodb-page-formats.md), [25](./25-mvcc-and-undo.md) | D-42 (in part) |
| D-52 | 2026-10-07 | **An undo record holds the old value whole, not doc 25's changed columns.** "Differential" in M4.20's title is deferred, not done. | A value is at most one leaf cell, and its 14-byte header changes on every write, so a schema-blind byte diff saves little. Whole images make version rebuild, rollback and the ref-list reasoning trivial, which the review's attack showed was where the bugs live. If undo volume ever matters, a diff is a change to one codec. | [25](./25-mvcc-and-undo.md) | — |
| D-53 | 2026-10-07 | **The single writer (D-08) is a slot.** A transaction's first write, or locking read, takes it until the transaction ends. Any other transaction's attempt is `ENGINE_WRITER_BUSY` at once. The async edge turns that into a queue and, after `innodb_lock_wait_timeout`, `ER_LOCK_WAIT_TIMEOUT`. | A synchronous core cannot wait (ground rule 3), so waiting is the edge's job, and the engine's job is to answer at once. A locking read must hold the slot, or a later writer could change the rows it "locked". With the slot, doc 25's current read is the latest version, which is committed or the reader's own. | [41](./41-durability-and-concurrency.md), [25](./25-mvcc-and-undo.md) | D-08 (implements) |
| D-54 | 2026-10-07 | **The history is bounded in commits (`maxHistory`, default 10,000).** Past the bound, the views pinning its oldest entries expire, and their next read is `ER_LOCK_DEADLOCK` 1213/40001. That is the only 1213 this engine raises. | Commits, not seconds, are what grow the store, and a wall-clock limit belongs to the host. One writer cannot form a lock cycle, so 1213 never means deadlock here (Q-02). It is still the error ORMs already retry when a transaction must start again (D-09). | [25](./25-mvcc-and-undo.md), [41](./41-durability-and-concurrency.md) | — |
| D-55 | 2026-10-07 | **A NO PAD text key part has no width: it is its sort key with each `00` written `00 ff`, then `00 00`.** A width given for one is the budget an index is sized by, not a refusal. A PAD SPACE part keeps D-35's padded width. A `CHAR` part keys its value without trailing spaces. | D-35's width assumed one weight per character, and `utf8mb4_0900_ai_ci`, the default, expands: `VARCHAR(6) PRIMARY KEY` refused `'Straße'`, a 14-byte sort key against 12. A width safe for every expansion would be enormous. The escaped form is prefix-free and keeps `memcmp` order, so multi-part keys stay unambiguous and `DESC` complements exactly, which D-35's width was for. A design review found the bug; running it confirmed it. | [24](./24-column-encodings.md) | D-35 (for NO PAD collations) |
| D-56 | 2026-10-07 | **The catalog's bootstrap descriptor is code**: reserved index ids below 16 and fixed layouts for the system tables, pinned by the store's `FORMAT_VERSION`. There is no fixed page. | Nothing has to be read to find the system tables, and their layout changes only with the store format, which is refused, not migrated (D-26). A descriptor page would be a second place for the same constants. | [27](./27-data-dictionary.md), [21](./21-innodb-file-layout.md) | — |
| D-57 | 2026-10-07 | **A table's definition is its `_myjs_tables` row**, JSON checked field by field, and not a per-table page. | One copy, changed by the transaction that changes the table. Doc 27's per-table page was SDI's idea for a file per table; with one file and a transactional catalog, it would be a second copy, and two copies drift (D-03's argument). | [27](./27-data-dictionary.md) | — |
| D-58 | 2026-10-07 | **The memory engine is independent of native**: sorted arrays ordered by comparing *values* (a collation's `compare`, a float's number), never by encoded keys. It is non-transactional, and says so in two capability flags. | "The executor cannot tell them apart" is only evidence if they could disagree. Two engines ordering by the same `encodeKey` would pass a differential test with the same bug. Ordering memory by `memcmp` fails the test, and so does keying native with D-35's old width. A review raised it. | [30](./30-other-engines.md) | — |
| D-59 | 2026-10-07 | **DDL is undo, and catalog lookups read the latest committed definition.** CREATE TABLE's trees are dropped on rollback and DROP TABLE's on purge, by a second undo record type. A table handle re-checks its row before every write (`ER_NO_SUCH_TABLE`). A consistent read through a view older than the definition is `ER_TABLE_DEF_CHANGED` (1412). | DDL becomes crash-atomic through the path rows already take, and a DROP needs no metadata lock to keep an older view's reads working. A review broke the first draft, which looked tables up through the reader's view: a view older than a DROP could write into trees that purge was about to drop. MySQL's dictionary is not MVCC either. | [27](./27-data-dictionary.md), [25](./25-mvcc-and-undo.md) | — |
| D-60 | 2026-10-07 | **The clustered index is InnoDB's choice**: the PRIMARY KEY, else the first UNIQUE index whose columns are all NOT NULL and which has no prefix part, else a hidden 6-byte row id. | It decides the order a full scan returns, which M5.4's "MySQL's row order" depends on. It is read from `sort_keys` and `TABLE_SHARE`'s promotion in the source, not remembered. | [27](./27-data-dictionary.md) | — |
| D-61 | 2026-10-07 | **AUTO_INCREMENT and hidden row ids come from a raw counters tree keyed by clustered index id**, a value taken in a mini-transaction of its own. | A value handed out is gone, committed or not, as InnoDB's are: an abort cannot give it back, and redo order makes it durable before any row that uses it. Index ids are never reused, so a table created again under the same name cannot inherit a stale counter. | [27](./27-data-dictionary.md) | — |
| D-62 | 2026-10-07 | **The executor lives in `@myjs/core` (`src/sql/`); the value rules live in `@myjs/types`.** Evaluation has its own value, `Value`, a third shape beside `StorageValue` and `SqlValue`, and `types` owns what is done with it: MySQL's choice of comparison type (`compareValues`), arithmetic (`add`, `divide`, …), and assignment into a column (`encodeField`) with its strict-mode refusals. | Doc 03 puts "value repr · coercion · comparison" in `types`. Evaluation needs three things both existing shapes erase. An integer's signedness, since `-` of an unsigned value saturates. A DECIMAL's exact scale, and the wider scale a quotient is held at: `1/7*7` is `1.0000`, not `1.0003`. A string's coercibility, since a column's collation beats a literal's. Keeping the rules below the executor means an importer can store a value the way an INSERT does without running SQL. | [03](./03-architecture.md), [24](./24-column-encodings.md) | — |
| D-63 | 2026-10-07 | **A statement parses once and compiles once per execution: each expression becomes a closure, and the row loop never walks the tree.** | The types a client is sent depend on the parameters. `SELECT ?` reports a 16,383-character string until it is bound, and the bound value's type after. A range's bounds are the parameters' values, too. Both are known only at execute. Compiling walks the tree once, which costs nothing beside the rows. | — | — |
| D-64 | 2026-10-07 | **A statement is atomic through a savepoint taken before it. A writing statement takes the writer slot before anything else, so the async edge waits by running it again, up to `innodb_lock_wait_timeout` and then 1205. DDL commits the session's transaction first.** | InnoDB rolls back a failed statement, not its transaction: a multi-row INSERT whose third row is a duplicate leaves nothing of the first two, and the transaction's earlier work stands. Taking the slot first means a busy slot is found before anything has changed, so running the statement again is the same as having waited. That puts D-53's queue at the edge, where ground rule 3 wants it. A closed connection rolls its transaction back (D-68), so a dead client cannot hold the slot. | [41](./41-durability-and-concurrency.md) | D-53 (implements) |
| D-65 | 2026-10-07 | **The whole WHERE is applied to every row an access path returns. The planner narrows a scan only where a constant converts to the column's type exactly, and uses a secondary index only for equality and IN.** | A range that is too wide costs time; one that is too narrow loses rows, and nothing downstream could notice. So narrowing is allowed only where the encoded bound is the value the comparison itself would use: not `varchar_col = 1`, which compares as doubles, nor `float_col = 1.1`. Row order without ORDER BY is the access path's, and on a secondary range MySQL's cost model decides it. The first capture found MySQL answering `SELECT age, id … WHERE id < 55` from the covering index on `age`, in `age` order. Planting a planner that drops the WHERE after a range fails three corpus cases. | [43 §2](./43-testing.md) | — |
| D-66 | 2026-10-07 | **`@myjs/core` carries the legacy 8-bit weight tables, and the UCA weights stay behind their lazy boundary.** | D-36's corollary kept the synchronous resolver out of core, because core only preloaded collations. The executor compares strings, so the resolver is what it is for: a `latin1_swedish_ci` column orders by one of those tables. What D-36 promised still holds and is still tested: the 48.6 KB of UCA weights are in no chunk core's entry point loads statically. | [29](./29-charsets-and-collations.md) | D-36 (its corollary) |
| D-67 | 2026-10-07 | **A record field is in InnoDB's framing for every type, DATE included: byte-reversed with the sign bit flipped (`DATA_INT`), not the binlog's little-endian form that `decodeStorageValue` reads.** `encodeField` and `decodeField` are the record codec. `decodeStorageValue` keeps D-34's binlog framing for the captured fixtures. | Keys are compared with `memcmp` (D-42), and a little-endian DATE sorts `2024-01-02` before `2023-12-31`. Doc 24 says both steps matter for an `.ibd`, and a record here is one; a test asserts the order. | [24](./24-column-encodings.md) | — |
| D-68 | 2026-10-07 | **`Executor` gains `reset(session)` and `end(session)`. A resultset row may hold the temporal structs (`RowValue`), which the text protocol now renders as the binary one already wrote them.** | When a connection ends, by `COM_QUIT`, by a destroyed stream or by a socket closing, its open transaction must roll back, or the one writer slot is held forever (D-53). A test destroys a `mysql2` connection mid-transaction and writes from another. The binary writer already took `MysqlDateTime`; letting rows carry it means the executor does no per-protocol conversion of dates. | [42](./42-public-api.md) | — |
| D-69 | 2026-10-08 | **Several statements in one `COM_QUERY` run when D-13's switch is on and the client negotiated `CLIENT_MULTI_STATEMENTS`; they run in order, and the first error stops the rest.** They are parsed together, under the `sql_mode` in force when the text arrives. | Doc 42 promises `multipleStatements: true` and the executor answered every such text with a parse error, because it parsed one statement. Stopping at the first error is MySQL's behaviour, and a test shows the statement before the error standing and the one after it never running. **A recorded divergence:** MySQL parses each statement as it reaches it, so a `SET sql_mode` early in the text changes how the rest is read; here it does not. | [14](./14-command-phase.md), [42](./42-public-api.md) | D-13 (implements) |
| D-70 | 2026-10-08 | **SQL newer than 8.4 is refused as 8.4.11 refuses it, with ER_PARSE_ERROR, not with ER_NOT_SUPPORTED_YET. The census counts the corpus's uses of it under a named, probed list (`NEWER_THAN_TARGET`), apart from both failures and the not-implemented.** | The pinned corpus is a later tree than the server we target (D-10), and it uses `GROUP BY GROUPING SETS`, which 8.4.11 answers with 1064. 1235 says "not yet" to a client whose server never will, the mistake the M3 review fixed for `RELEASE sp`. Counting the statement as a parse failure would break the census's gate over SQL we refuse correctly. Counting it as not implemented would keep M3.17's list from ever emptying. A pattern is tried only on a statement that failed with ER_PARSE_ERROR, so the list cannot hide one that parses. | [43 §1](./43-testing.md) | D-10 (applies) |
| D-71 | 2026-10-08 | **`Table` gains `duplicateOf(index, row)`: the live row `row` collides with in one UNIQUE index, as the uniqueness check sees it. The executor checks unique keys in MySQL's `sort_keys` order, which InnoDB's index order follows. In order: NOT NULL keys before nullable, PRIMARY first, keys without a prefix part before keys with one, then declared order.** | An upsert must update the row a duplicate means, and REPLACE must delete it, but a 1062 names only an index. Looking the row up through `indexScan` would re-encode the key outside the engine, and that encoding is the engine's business (D-42, D-55). Asking the engine with the key code it checks with is exact for collations and prefixes by construction. The order matters three times over: it decides which key a 1062 names, which row an upsert updates when a row collides with two, and whether REPLACE may update in place. The engine checks in declared order; the executor re-finds the first conflict in sorted order, so neither engine needs MySQL's rule. A conformance case pins both engines to the same answers. | [30](./30-other-engines.md) | — |
| D-72 | 2026-10-08 | **`ARCHITECTURE.md`, at the root, is the narrative of the target architecture; it is not a plan.** It describes the finished design and the reasons for it, marks what is planned rather than built in its diagrams, and carries status only in one dated section that defers to this file. Doc 03 stays as the compact reference, with its package table corrected to the dependencies the code actually has. | Thirty-one specifications and seventy decisions are the right record and the wrong introduction: each is written for someone already inside the project. A paper a newcomer can read in one sitting is worth having, but D-03's warning applies to it — a second document that tracks progress drifts, and the stale one is the one people read. Keeping status out of it is what keeps it true. | [03](./03-architecture.md) | D-03 (applies) |
| D-73 | 2026-10-08 | **A grouped query compiles above its grouping against one flat row: the group's first row, its key values, its rollup level, then each aggregate's result. Aggregate values and result types are `@myjs/types`'; the grouping strategy is chosen as 8.4.11 chooses it (index, sort, temporary table), because the strategy decides both the order of the groups and the metadata.** | The row loop still never walks the tree (D-63): a bare column reads its group's first row, which ONLY_FULL_GROUP_BY makes safe, and a ROLLUP key reads its slot, which is NULL in a super-aggregate row. D-62 placed MySQL's value rules below the executor, and SUM's 22 extra digits and AVG's four are value rules like any other. The strategy cannot be the executor's free choice. A temporary table returns groups in first-appearance order and an index in index order, and the temporary table changes what a client is told: `COUNT(*)` is 0x81 by index and 0x01 by temporary table. A different strategy is a different answer. | [43 §2](./43-testing.md) | D-62 (extends) |
| D-74 | 2026-10-08 | **A FROM is one flat row, however many tables it joins: each table's columns at an offset, NULL where an outer join found no match. A USING or NATURAL column is the preserved side's slot, which a bare name resolves to; an ON resolves in a view of the row that holds only its own join's tables.** | The executor's row was already a flat array that one table filled, and `TableScope` had laid tables side by side since M5.17. Keeping it means a join is a generator of rows and nothing above the FROM knows how many tables there were. The merged column needs no COALESCE: it is the preserved side's own value, the left side's or under a RIGHT JOIN the right side's, which never NULL-extends. 8.4.11 reports its metadata from the same side. | [03](./03-architecture.md) | D-63 (extends) |
| D-75 | 2026-10-08 | **Joins run as 8.4.11's iterators run them, in the statement's join order. A hash join builds on the earlier tables, probes with the later one, and emits each probe row's matches newest first. A LEFT JOIN probes with its outer side. A unique key that the condition pins is a single-row lookup.** | Row order without ORDER BY is the plan's (M5.18), so another algorithm would be another answer. The join order is the cost model's (M5.7), and STRAIGHT_JOIN fixes it, which is what lets the corpus check order before that exists. Evaluating the full condition on every pair makes a keyed hash join and the no-condition form come out in one order, so the hash key is an acceleration and never a semantic. | [43 §2](./43-testing.md) | — |
| D-76 | 2026-10-09 | **Doc 42's query API is a client of the wire protocol whose values are `mysql2` 3.24.3's: its typing of every column type, its type options, its capability flags and connection collation, its `format` for `query()` values and its parameter encoding for `execute()`. It departs in three places, each named in doc 42: bytes are a `Uint8Array`; under NO_BACKSLASH_ESCAPES a quote is doubled; a plain object is refused as a `query()` value.** | "Familiar beats novel" (doc 42) is only true if it is exact. An application that moves from `mysql2` to `db.query()` should find no value changed type. A differential test against `mysql2` itself makes that falsifiable, statement by statement. The departures are where `mysql2`'s rule is wrong for this server or this package: a backslash under NO_BACKSLASH_ESCAPES escapes nothing, so sql-escaper's `\\'` would end the string early, and a SET-clause guess is an injection-shaped heuristic. | [42](./42-public-api.md) | — |
| D-77 | 2026-10-09 | **A statement may pause between its mini-transactions.** The core stays synchronous (ground rule 3), but a statement that may run long is a generator that yields where no mini-transaction is open, and the async edge resumes it, giving the event loop a turn every few milliseconds. A writing statement pauses holding the writer slot, so no other writer, DDL or purge changes a page while it waits. A session that ends during a pause has ER_QUERY_INTERRUPTED thrown in at the pause, and the statement rolls back as on any error. Purge is incremental to match: a commit purges a bounded number of undo records, and the rest is purged a slice at a time while no writer holds the slot. | A 32,000-row statement held the event loop for seconds, and every other connection — Prisma's parallel test files, above all their handshakes — waited behind it. Per-row speed cannot fix that, since a larger statement stalls again, and an async core would put an `await` on every row. Pausing only where the engine is already consistent costs nothing in atomicity: the state between two batches is the state between two statements of an open transaction, which other sessions already see. | [41](./41-durability-and-concurrency.md) | — |
| D-78 | 2026-10-09 | **The host adapter is chosen by a package import, `#host`, whose `browser` condition names the browser's and whose `default` names Node's; each exports the same functions and a `DriverStream` type.** | A run-time test of `process` chose the adapter before, and the `browser` field mapped one file over the other for bundlers, so `createStream()` could only be typed as a bag of unknowns. A condition is resolved where the type checker and the bundler both read it, so on Node the type is `Duplex` and in a browser bundle Web Streams, and no `node:` specifier reaches a file the lint gate covers. Deno and Bun take `default`, Node's, which they run. | [42](./42-public-api.md) | — |
| D-79 | 2026-10-09 | **The repository stays source-first, and what npm installs is emitted: each package is published as the JavaScript and declarations `tsc` writes, under a `package.json` `tools/pack.mjs` generates; and the package an application installs is `myjs`, a facade that re-exports doc 42's surface from `@myjs/core` and `serve()` from `@myjs/server` as `myjs/server`.** | Node strips types only outside `node_modules`, so a tarball of `src/*.ts` fails on its first import; D-01's no-build workflow is kept for everyone working in the repository, and the build exists only where the artefact leaves it. A facade rather than renaming `@myjs/core`: `myjs/server` must depend on `@myjs/server`, which depends on the core, so a renamed core exporting it would be a cycle, and every import in the repository would churn. The facade also makes the frozen 1.0 surface one file, not every export a neighbouring package needs. CI installs the tarballs into an empty project and runs them, so a manifest that names a file the tarball lacks fails there, not for a user. | [42](./42-public-api.md) | D-01's publishing sentence (declarations only) |
| D-80 | 2026-10-09 | **0.1 and 0.2 are folded into 0.3.0: every package is released at one version, and each pins the others it depends on exactly.** | The protocol toolkit and the type packages were finished months of commits before anything was published, and publishing them now as 0.1 and 0.2 would announce versions nobody could have used. Lockstep versions with exact pins mean the combination npm installs is the one CI packed and smoke-installed, and nothing else; ranges would let a user assemble a set that was never run together. A package that later needs its own cadence can leave the lockstep then. | [44 §Release plan](#release-plan) | the release plan's separate 0.1 and 0.2 |
| D-81 | 2026-10-09 | **A plan is described from the decisions that run it, never worked out again for display.** EXPLAIN FORMAT=TREE prints a tree of `PlanNode`s, named as 8.4.11's iterators print themselves. Each node comes from the same choice the executor acted on: one function chooses a table's access path for both, and the grouping strategy and the temporary-table flags that set the metadata choose what the grouping and the DISTINCT say. Execution stays the generators it was; making the tree the program is M5.43's remainder. | A plan that agrees with the server's makes the replay compare that query's rows in order, so a description that drifted from execution would turn a plan "agreement" into a row disagreement, and the corpus would say so. Printing a hash join's sides the wrong way round does exactly that, and is checked. Describing first and interpreting later puts the measure in place before the refactor it measures. The other order would refactor three thousand lines with nothing to tell whether the result was MySQL's plan. | [43 §2](./43-testing.md) | — |
| D-82 | 2026-10-09 | **The plan is a tree of iterators, each running and describing itself, and the WHERE is applied by them: each conjunct at the iterator 8.4.11 places it at, evaluated as MySQL's AND evaluates (false at the first FALSE, NULL past a NULL).** A key read's own equality is still checked, since its exactness is decided per value (D-65); EXPLAIN leaves it out, as the server does. | D-81 described the plan from the decisions that ran it, but a description beside the code it describes can still drift: two functions, one change. One object for both cannot. Applying the WHERE above the FROM and describing it pushed down was a second, quieter kind of drift. Applying it where it is placed is also what the server does, so a condition on a build side runs once per build row, not once per pair. The warning counts every corpus compares are the check that this changed nothing a client sees. | [43 §2](./43-testing.md) | D-81 (completes) |
| D-83 | 2026-10-09 | **A table's statistics are stored in its definition by ANALYZE TABLE, and read three ways, as 8.4.11 reads them: the optimizer reads rows per key (frozen at ANALYZE under `STATS_AUTO_RECALC=0`, recomputed after a tenth of the rows change otherwise) and the live row count; SHOW INDEX and `STATISTICS` read a cache written at first read and by ANALYZE.** | A plan is a cost decision, and its costs turn on these figures down to a float's rounding, so they must be the server's, not exact counts at query time. Stored with the definition they persist and are dropped with it, with no system table to keep in step. InnoDB's background recalculation cannot be reproduced in time, only in the state it settles to, which is what is modelled; a capture that wants a fixed plan sets `STATS_AUTO_RECALC=0` and runs ANALYZE, as the corpus does. | [27](./27-data-dictionary.md) | — |
| D-84 | 2026-10-09 | **Access paths are chosen by 8.4.11's classic cost model, its constants the server's defaults (a row evaluated 0.1, a page read from memory 0.25, a 256 KB join buffer), its rules `best_access_path`'s, reimplemented and checked against the optimizer trace.** | The order of an unordered join is its plan's, and the plan is a cost decision. Matching the server's choice means matching its arithmetic, heuristics included (a covering index forbids the scan; a unique key costs by distinct key sources). An approximation would agree on the easy cases and disagree on exactly the ones a corpus is for. | [43 §2](./43-testing.md) | — |
| D-85 | 2026-10-09 | **A resultset larger than a batch is answered as a stream: the executor hands out each batch as it reads it, the dispatcher sends the head at once and each batch when the connection asks, and a connection whose transport reads as it writes (`onOutput`) waits while more than 64 KiB it has queued is unread.** A transport that stops taking stops the statement. One that goes away ends it: its generator is `return()`ed, and `steps()` rolls back a statement that did not finish, whether it threw or was abandoned. With no transport reading, as for `execProtocol`, nothing waits and the answer is whole (D-28 unchanged). | `db.stream()` needs the memory held to be a batch, not the result, and that holds only if every hop pulls: executor, dispatcher, connection, transport. A pushed stream with no backpressure only moves the materialised result into a socket's buffer. Streaming every large resultset, not only `db.stream()`'s, is what 8.4.11 does, and the client cannot ask for it anyway: `mysql2`'s `query().stream()` sends the same COM_QUERY as `query()`. The cost is that a failure after the first batch comes after rows already sent, which is the server's own behaviour (a subquery's 1242 at the 700th row follows 699 rows), so the rows read before a failure are now sent ahead of it. A cursor's rows stay materialised, as 8.4.11 keeps them in a temporary table. | [42](./42-public-api.md), [14](./14-command-phase.md) | answers Q-11 |
| D-86 | 2026-10-09 | **The system variables are 8.4.11's, captured from the server into a generated table (`system-variables.ts`): 619 names, each with its scope, its writability, its type, its range and its default. SHOW VARIABLES and SHOW STATUS are queries over PERFORMANCE_SCHEMA tables built for them, as the server answers them.** A value that describes the machine is this server's own (`OURS`), and so is any variable naming machinery not kept here. SHOW STATUS lists only what is counted. | What a variable is lives in `sys_vars.cc`'s constructors and the classes behind them, and the server publishes the answer, as D-39 found for keywords. A list written by hand had two dozen names, and every other `@@name` was a 1193 that 8.4.11 never raises. Building SHOW VARIABLES as the server does, a query over `performance_schema`, makes its WHERE an ordinary WHERE, with nothing to special-case. Counters that are always 0 would be wrong answers, so the other 246 status variables are left out rather than invented. The table costs about 8 KB gzipped of `@myjs/core`'s budget, which is recorded. | [42](./42-public-api.md), [14](./14-command-phase.md) | |
| D-87 | 2026-10-10 | **Node ownership fails closed.** Canonicalize the database root, reject symlink components and escaping VFS paths, and refuse every existing lock file. Stale recovery is an explicit operator action after all owners stop. Shutdown shares one promise and attempts every cleanup, preserving failures. | PID checks and automatic stale-lock replacement cannot prove exclusive ownership across races, PID reuse or namespaces. File creation with exclusive access is the ownership gate. Cleanup failures must not leave queues or unrelated resources held. | [40](./40-vfs.md), [42](./42-public-api.md) | — |
| D-88 | 2026-10-10 | **Qualify D-06’s licensing rationale.** Reimplementation remains the decision; GPL obligations depend on the distributed combination and do not attach to every JavaScript consumer merely through aggregation. | The previous universal claim was too broad. Doc 02 now distinguishes MySQL Community Server, client-library FOSS exceptions and commercial licensing, with primary sources. | [02](./02-strategy.md) | D-06 (licensing rationale only) |

---

## Ground rules

These apply to every milestone. No item below repeats them.

1. **`Uint8Array` and `DataView` only above the VFS.** No `Buffer`, no `node:*`.
   This is what "isomorphic" actually costs, and it is cheap if enforced from
   the first commit — so it is enforced by a lint rule, not by good intentions.
2. **Bytes in, bytes out, at every layer boundary.** Wire packets, page images,
   index keys, undo records. No hidden object graphs crossing layers, so every
   layer can be fuzzed and snapshot-tested.
3. **Async at the edges, sync in the core.** OPFS sync access handles and Node's
   `readSync` are both synchronous. No `await` inside a page split.
4. **Every format constant cites its header.** A comment naming the MySQL header
   it came from, so it can be re-verified against a newer tree.
5. **Typed errors, always.** A malformed input produces a typed error — never a
   crash, never a hang, never an out-of-bounds read. This is the fuzzing
   invariant and it applies to every parser we write.
6. **The memory VFS is the reference implementation.** Every unit test runs
   against it. If a bug reproduces only on OPFS, the VFS is at fault, not the
   engine.
7. **Nothing from `reference/` is copied into this repository.** MySQL is
   GPLv2, this project is MIT. `mysql-test` is fetched in CI, never vendored.

---

## Repository layout

Per D-02. The `Since` column is the milestone that creates the package.

| Package | Responsibility | Depends on | Publishable alone | Since |
|---|---|---|---|---|
| `@myjs/bytes` | Cursor/writer over `Uint8Array`; LE/BE ints, varints, length-encoded values; the neutral value structs both packages above name (D-32) | — | yes | M0 |
| `@myjs/vfs` | The one storage interface + memory and Node backends (OPFS is M6.1); `FaultInjectingVfs` at the `@myjs/vfs/fault` subpath, so no application pays for it, and the Node backend at `@myjs/vfs/node`, so no browser bundle meets `node:fs` | — | yes | M0 |
| `@myjs/protocol` | Packet framing, every packet type both directions, auth plugins | `bytes` — and never `charsets` or `types`, per D-32 and D-33 | **yes — the M1 release** | M1 |
| `@myjs/charsets` | Charset ids, encoders/decoders, collation key transforms | `bytes` (for `MyjsError` only — ground rule 5) | yes | M2 |
| `@myjs/types` | Value model, coercion, comparison, collation aggregation, index key encoding | `bytes`, `charsets` | yes | M2 |
| `@myjs/parser` | Lexer + parser → AST; `sql_mode`-aware | `bytes`, `charsets` | yes | M3 |
| `@myjs/engine` | Pages, B+tree, MVCC, WAL, recovery, catalog | `bytes`, `charsets`, `types`, `vfs` | no | M4 |
| `@myjs/core` | Wires it together: the `MySQL` class, the executor, the query API | all of the above | no (`myjs` re-exports it) | M1 |
| `@myjs/server` | Node TCP server (`serve()`); a WebSocket bridge and a worker host are M6's | `core`, `protocol` | yes | M1 |
| `myjs` | What an application installs: doc 42's surface re-exported from `core`, and `serve()` as `myjs/server` (D-79) | `core`, `server` | **yes — the 0.3 release** | M5 |
| `@myjs/innodb` | Real `.ibd` and SDI codec — import/export only | `bytes`, `types` | **yes** | M7 |

The `Depends on` column is checked: `tools/lint-isomorphic.mjs` holds the same
graph as a table and fails a package that imports, or declares, any other.

`@myjs/innodb` deliberately does not sit under `@myjs/engine`. It is a codec,
not a storage backend: someone should be able to install it purely to parse a
tablespace they found on a dead server.

Tests live in four directories, all of which `npm test` runs with no server,
no Docker and no browser:

```
test/
  unit/          per-module, memory VFS, fast
  protocol/      trace replay, and real clients (`mysql2`, the query API) against the executor
  format/        golden vectors and the corpora captured from 8.4.11, replayed
  crash/         fault injection: 300 crash points here, 10,000 in CI
  lib/           helpers the tests share (the relational corpus's replay)
```

Doc 43 also names `mysqltest/` (M5.15's interpreter), `browser/` (M6.10) and
`bench/`; they are made when their work is. The differential runs against a
real server are the `capture:*` tools and CI's `type-vectors` job, not a
directory.

The generators in `tools/*.mjs` sit **outside** the isomorphic lint gate, which
walks `packages/` only. They may use `node:` freely; everything they *emit*
into `packages/` may not. Worth stating, because ground rule 1 reads as though
it covered the whole repository and M2 adds two more generators.

---

## M0 — Foundations

*Nothing works yet, but everything after this is easy.*

**Exit criterion.** Property tests round-trip every protocol primitive, and the
bundle-size gate is enforcing a real number.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M0.1 | Workspace scaffolding: npm workspaces, `packages/*`, root `tsconfig` with `erasableSyntaxOnly` + `verbatimModuleSyntax`, `engines.node >=22.18` | — | D-01, D-02 | — | ☑ | `node --test` runs a `.ts` test file with no build step |
| M0.2 | Lint gate: no `Buffer` or `node:*` outside `packages/vfs`; no non-erasable TS syntax | — | [03](./03-architecture.md) | M0.1 | ☑ | a deliberate `node:buffer` import in `packages/types` fails CI |
| M0.3 | `Reader` — the contract written out in doc 11: all widths, `u24`/`u48`, `u64 → BigInt`, lenenc int and bytes, NUL and EOF strings | bytes | [11](./11-protocol-primitives.md) | M0.1 | ☑ | every read bounds-checks against `remaining`; `0xFB` returns `null`, never `251` |
| M0.4 | `Writer` — geometric growth, reserves the 4-byte packet header, canonical shortest lenenc | bytes | [11](./11-protocol-primitives.md) | M0.3 | ☑ | `lenEnc(250)` is 1 byte, `lenEnc(251)` is 3 — required for byte-exact trace comparison |
| M0.5 | `ProtocolError` and the typed-error base | bytes | [11](./11-protocol-primitives.md) | — | ☑ | no path in `bytes` throws a bare `Error` |
| M0.6 | Bitmap helpers with the offset parameter | bytes | [11](./11-protocol-primitives.md) | M0.3 | ☑ | offset 2 and offset 0 both round-trip; the asymmetry is a test, not a comment |
| M0.7 | Property tests: round-trip every primitive | bytes | [43 §4](./43-testing.md) | M0.3, M0.4 | ☑ | `fast-check` covers all int widths, lenenc, and all four string forms |
| M0.8 | Fuzz target: arbitrary bytes into `Reader` | bytes | [43 §6](./43-testing.md) | M0.3 | ☑ | 10⁶ random inputs, zero crashes and hangs, only `ProtocolError` |
| M0.9 | `Vfs` / `VfsFile` interfaces from doc 40, with erratum E-02 applied | vfs | [40](./40-vfs.md) | M0.1 | ☑ | `durability` lives on `Vfs`; a conformance suite exists that any backend must pass |
| M0.10 | Memory VFS — the reference backend — plus CI: unit tests, lint, bundle-size budget | vfs | [40](./40-vfs.md), [43 §7](./43-testing.md) | M0.9 | ☑ | memory passes the conformance suite; the size gate fails a commit that exceeds the committed number |

---

## M1 — Speak the protocol

*The most valuable milestone per unit of effort. Do it first.*

This milestone alone is a genuinely useful artefact — a MySQL protocol server
toolkit for JavaScript, which does not currently exist as a standalone package.
It ships as `@myjs/protocol` 0.1 (see [Release plan](#release-plan)).

**Exit criterion.** `mysql -h 127.0.0.1` connects, authenticates with
`caching_sha2_password`, runs `SELECT 1`, and quits cleanly; and `mysql2`'s
connection tests pass against the stub.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M1.1 | Packet framer: 4-byte header, >16 MiB reassembly, `max_allowed_packet` enforced *during* reassembly | protocol | [10](./10-protocol-overview.md), [17](./17-protocol-extras.md) | M0.4 | ☑ | a 16777215-byte payload emits `ff ff ff n` **plus an empty packet**, and decodes back |
| M1.2 | Sequence ids owned by the framer: reset per command, continuous through the connection phase | protocol | [10](./10-protocol-overview.md) | M1.1 | ☑ | a mismatch raises `ER_NET_PACKETS_OUT_OF_ORDER`, and the counter is not visible to packet types |
| M1.3 | Capability constants; the negotiated set as one immutable value | protocol | [12](./12-connection-phase.md) | — | ☑ | every reader and writer takes it as a parameter; none reads mutable session state |
| M1.4 | Response discriminator resolved by **length**, not by byte value | protocol | [10](./10-protocol-overview.md) | M1.3 | ☑ | a `0xFE` payload of ≥9 bytes parses as a lenenc integer, not as EOF |
| M1.5 | OK / ERR / EOF writers, capability-conditional, including the OK-as-EOF form | protocol | [10](./10-protocol-overview.md) | M1.3 | ☑ | the minimal OK is byte-identical to `07 00 00 02 00 00 00 02 00 00 00` |
| M1.6 | Error table generated from `share/messages_to_clients.txt` (D-14) | protocol | [14](./14-command-phase.md) | — | ☑ | 1062 → `ER_DUP_ENTRY`/`23000`; the generator is re-runnable and its source hash is checked in |
| M1.7 | Crypto shim: `getRandomValues`, SHA-1, SHA-256, constant-time compare, RSA-OAEP-SHA1 | protocol | [13](./13-authentication.md) | — | ☑ | one module, identical API on Node and in the browser; nothing above it imports `node:crypto` |
| M1.8 | `HandshakeV10` writer; 20-byte scramble split 8 + 12 with a trailing NUL | protocol | [12](./12-connection-phase.md) | M1.5, M1.7 | ☑ | `mysql2` parses it; `CLIENT_LONG_PASSWORD` set and reserved bytes zeroed (D-10) |
| M1.9 | `SSLRequest` and `HandshakeResponse41` parsers; connection attributes with size and count caps | protocol | [12](./12-connection-phase.md) | M1.3 | ☑ | oversized attributes are rejected before authentication — this is unauthenticated input |
| M1.10 | Auth framing: `AuthSwitchRequest`, `AuthSwitchResponse`, `AuthMoreData`, `AuthNextFactor` | protocol | [13](./13-authentication.md) | M1.8 | ☑ | `AuthNextFactor` produces a clear error rather than a hang |
| M1.11 | `mysql_native_password` verification | protocol | [13](./13-authentication.md) | M1.10 | ☑ | the empty-password zero-length-response case is handled on both sides |
| M1.12 | `caching_sha2_password` fast path | protocol | [13](./13-authentication.md) | M1.10 | ☑ | `0x03` is sent as its **own packet before** the OK; a client expecting OK immediately would desync, and does not |
| M1.13 | `caching_sha2_password` full path, secure-channel branch (D-11) | protocol | [13](./13-authentication.md) | M1.12 | ☑ | in-process connections take this branch and never touch RSA |
| M1.14 | `caching_sha2_password` RSA branch, TCP listener only | protocol, server | [13](./13-authentication.md) | M1.13 | ☑ | the `mysql` CLI authenticates over TCP against a fresh, uncached account |
| M1.15 | Uniform access-denied (`1045`/`28000`) and failure rate-limiting on the TCP path | protocol | [13](./13-authentication.md) | M1.11 | ☑ | unknown user and wrong password are indistinguishable in timing and in bytes |
| M1.16 | `COM_*` dispatcher; `COM_PING` implemented first; unknown → `ER_UNKNOWN_COM_ERROR`/`08S01` | protocol | [14](./14-command-phase.md) | M1.5 | ☑ | a pool's ping loop runs 10 000 times without desynchronising |
| M1.17 | No-response commands: `COM_STMT_SEND_LONG_DATA`, `COM_STMT_CLOSE`, `COM_QUIT` | protocol | [14](./14-command-phase.md), [16](./16-prepared-statements.md) | M1.16 | ☑ | nothing is written, not even on error — a reply desynchronises every client |
| M1.18 | The command-phase quirks: `COM_FIELD_LIST` (no column-count prefix), `COM_SET_OPTION` (EOF-shaped), `COM_STATISTICS` (bare `string<EOF>`) | protocol | [14](./14-command-phase.md) | M1.16 | ☑ | each matches a captured trace from a real server |
| M1.19 | `ColumnDefinition41` writer | protocol | [15](./15-wire-types.md) | M1.3 | ☑ | `VARCHAR(255)` utf8mb4 reports `column_length` 1020; charset 63 distinguishes BLOB from TEXT |
| M1.20 | Text resultset writer and text value renderers | protocol | [14](./14-command-phase.md), [15](./15-wire-types.md) | M1.19 | ☑ | DECIMAL keeps trailing zeros to scale; multi-resultset sets `SERVER_MORE_RESULTS_EXISTS` on every terminator but the last |
| M1.21 | Binary resultset writer and binary value codecs; null bitmap at **offset 2** | protocol | [15](./15-wire-types.md) | M1.19 | ☑ | doc 15's temporal byte dumps encode and decode exactly, shortest form on write; `INT24` occupies 4 bytes |
| M1.22 | `COM_QUERY` and `COM_STMT_EXECUTE` parsers with query attributes; null bitmap at **offset 0** | protocol | [14](./14-command-phase.md), [16](./16-prepared-statements.md) | M1.21 | ☑ | doc 16's worked `COM_STMT_EXECUTE` example parses to the parameters it documents |
| M1.23 | `COM_STMT_*` and the `PreparedStatement` state class: sticky bound types, long-data merge, cursors with a timeout, `max_prepared_stmt_count` 16382 | protocol | [16](./16-prepared-statements.md) | M1.22 | ☑ | `new_params_bind_flag === 0` works against a client that never sets it; an abandoned cursor is reclaimed |
| M1.24 | `execProtocol()`, `createStream()`, `createPort()`, `serve()`, and a stub executor | core, server | [03](./03-architecture.md), [42](./42-public-api.md) | M1.20 | ☑ | `mysql2.createConnection({ stream: db.createStream() })` completes a full session unpatched; `serve()` refuses a non-loopback bind without a configured password |

Trace-replay fixtures (doc 43 §3) are built alongside M1.12 and are the
acceptance mechanism for M1.1–M1.23, not a separate item: an item is not done
until its trace replays byte-identically.

---

## M2 — Types and collations

*Where most "MySQL-compatible" projects quietly fail.* Collation is not a
display concern — it determines index order, `ORDER BY` results, `=` semantics
and unique-constraint violations.

**Exit criterion.** The `memcmp`-ordering property test passes for every type,
and the golden vectors from MySQL's own source comments all decode correctly.
**Met.** `doc-vectors.test.ts` checks the second clause rather than asserting
it — it parses docs 15, 24 and 28, extracts every byte dump and fails on one
with no test — and M2.21 added the clause neither doc could supply: 24 vectors
from a real MySQL 8.4, which disagreed with us on `utf8mb4_bin` the first time
they ran (E-12).

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M2.1 | Collation registry and the `Collation` interface (`sortKey`, `compare`, `padAttribute`) | charsets | [29](./29-charsets-and-collations.md) | M2.17 | ☑ | ids 8, 33, 45, 46, 63, 224, 246, 255, 278 resolve to a collation or a typed "unsupported" |
| M2.2 | `binary` (63) and `utf8mb4_bin` (46) — pure `memcmp` | charsets | [29](./29-charsets-and-collations.md) | M2.1 | ☑ | enough to build and test the entire B+tree; ordering equals `memcmp` on arbitrary bytes. Corrected by M2.21: "the sort key is the value" holds for every *8-bit* `*_bin` collation and not for the Unicode ones — `utf8mb4_bin` writes three big-endian bytes per code point and `utf8mb3_bin` two (E-12). Which collations those are is now generated from MySQL's own `MY_COLLATION_HANDLER` structs (`BIN_KEY_WIDTHS`), not from a list, because `utf8mb3_bin` and `utf8mb4_bin` carry identical flags and have different key widths |
| M2.3 | Charset encode/decode over `TextEncoder`/`TextDecoder`; MySQL name → WHATWG label | charsets | [29](./29-charsets-and-collations.md) | M2.1 | ☑ | `latin1` maps to `windows-1252`, so `0x80` decodes to `€` |
| M2.4 | `mbminlen`/`mbmaxlen` table and the limits it drives | charsets, protocol | [29](./29-charsets-and-collations.md) | M2.17 | ☑ | `VARCHAR(16383)` is the utf8mb4 row-limit boundary; `KEY (col(255))` budgets 1020 bytes |
| M2.5 | Weight-table generator for the **simple** collations, re-runnable, source hash checked in. UCA is M2.20 | charsets | [29](./29-charsets-and-collations.md) | M2.17 | ☑ | re-running against the pinned MySQL tree reproduces the committed tables bit for bit |
| M2.6 | `utf8mb4_general_ci` and `latin1_swedish_ci` (PAD SPACE) | charsets | [29](./29-charsets-and-collations.md) | M2.5 | ☑ | `'ä' = 'a'` and `'ß' ≠ 'ss'`; `'a' = 'a '` is true |
| M2.7 | `utf8mb4_0900_ai_ci` (UCA 9.0.0, NO PAD), lazily loaded | charsets | [29](./29-charsets-and-collations.md) | M2.20 | ☑ | `'a' = 'a '` is false — and, because UCA expands where `general_ci` folds, sharp s equals `'ss'` here and cannot under `general_ci`. The differential check against a real 8.4 is the M2.21 fixture and is now **met**: 12 captured `WEIGHT_STRING` vectors, including the Han implicit weight `FB40CE00` and the Hangul decomposition `3BF53C73`, agree with our tables byte for byte |
| M2.8 | Integer transform: big-endian, sign bit flipped unless unsigned | types | [24](./24-column-encodings.md) | M0.3, M2.16 | ☑ | doc 24's four worked `INT` lines reproduce byte for byte |
| M2.9 | FLOAT and DOUBLE: little-endian IEEE-754, compared **numerically** | types | [24](./24-column-encodings.md) | M2.8 | ☑ | the ordering property test knows these are the exception and does not assert `memcmp` |
| M2.10 | `decimal2bin` | types | [24](./24-column-encodings.md) | M2.8 | ☑ | `DECIMAL(14,4) 1234567890.1234 → 81 0D FB 38 D2 04 D2`, and its negative |
| M2.11 | Temporal family: DATETIME2, TIMESTAMP2, TIME2, DATE, YEAR, plus the legacy decoders | types | [24](./24-column-encodings.md) | M2.8 | ☑ | `DATETIMEF_INT_OFS` and `year*13 + month` are right; all fractional widths round-trip |
| M2.12 | ENUM and SET (forced unsigned, **no** sign flip), BIT, CHAR/VARCHAR/BINARY padding | types | [24](./24-column-encodings.md) | M2.8 | ☑ | ENUM indexes are 1-based; `CHAR` latin1 space-pads, `BINARY` zero-pads |
| M2.13 | Binary JSON codec | types | [28](./28-json-binary.md) | M2.11, M2.12, M2.24 | ☑ | small/large switches per container; key order is length-then-bytes; `custom-data` reaches back into `decodeStorageValue`. Two things the property test found: a stored `__proto__` key was prototype pollution reachable from a table row, and `-0` must stay a double because `float8store` keeps its sign |
| M2.14 | Index key encoding: NULL flag byte, prefix keys, collation sort keys | types | [24](./24-column-encodings.md) | M2.12, M2.2 | ☑ | the memcmp-ordering property holds for every non-float type, and character columns compare on the *sort key* rather than the value — revised by D-35, which added the declared width a PAD SPACE part needs for that property to actually hold — and again by M2.21, which made that width computable: `declaredKeyWidth(collationId, chars)` is `padUnit.length * chars`, because `padUnit` is already one character's worth of key. `mbmaxlen * chars` is the plausible wrong answer, and it is wrong in both directions — 16 bytes where `utf8mb4_bin` needs 12, 16 where `utf8mb4_0900_ai_ci` needs 8. A width that is not a whole number of characters is now refused outright, since padding with a *fragment* of the pad character puts two keys in different phases |
| M2.15 | Golden-vector and property suite | test | [43 §4](./43-testing.md) | all | ☑ | every byte dump quoted anywhere in docs 15, 24 and 28 is a test case — and the claim is *checked* rather than maintained by hand: `doc-vectors.test.ts` parses the docs, extracts the dumps and fails on one with no test. 14 dumps, 12 distinct, all covered. **Doc 28 quotes none at all**, so its third of the claim was vacuous; the JSON vectors are spec-derived from doc 28's grammar instead, with the captured `WEIGHT_STRING` corpus arriving in M2.21 and the captured storage bytes still to be committed |
| M2.16 | Relocate the value model to `@myjs/bytes` so `@myjs/types` can name it (D-32) | bytes, protocol | [15](./15-wire-types.md) | — | ☑ | the 9 frozen traces still replay byte-identically; no package's `dependencies` field changes |
| M2.17 | Collation registry generator: one parse of MySQL's `CHARSET_INFO` definitions emits both the `@myjs/charsets` registry and the byte widths `@myjs/protocol` needs (D-33) | charsets, protocol | [29](./29-charsets-and-collations.md) | M0.1 | ☑ | re-running reproduces both committed files byte for byte; the generated connection-charset rule agrees with the registry on every id |
| M2.18 | The `Transcoder` seam and `SET NAMES`: `session.characterSet` finally interpreted, `@myjs/core` supplying the real transcoder (D-33) | protocol, core | [11](./11-protocol-primitives.md), [29](./29-charsets-and-collations.md) | M2.3 | ☑ | a latin1 session round-trips `0x80` as `€`; `@myjs/protocol` still depends only on `@myjs/bytes` |
| M2.19 | The packing structure for the simple weight tables — two-level pages, identity-page elision, delta-plus-run within a page, supplementary plane a constant. **Owns Q-04** | charsets | [29](./29-charsets-and-collations.md) | M2.5 | ☑ | the packed `utf8mb4_general_ci` table is under 20 KB raw and 10 KB gzipped, asserted by a test — Q-04 answered with a number, not an adjective |
| M2.20 | UCA 9.0.0 packing and the lazy-module boundary: level 1 only, implicit weights computed rather than tabulated, reached solely by `await import()`. **Owns Q-13**; the boundary's shape is D-36 | charsets | [29](./29-charsets-and-collations.md) | M2.19 | ☑ | an esbuild bundle of `packages/charsets/src/index.ts` contains no UCA weights — asserted by a test that bundles it and looks for a probe from the middle of the real table, after `tools/size-budget.mjs` was taught to measure the entry chunk rather than the whole build |
| M2.21 | `tools/capture-types.mjs` and the informational `type-vectors` CI job (D-34) | test | [43 §4](./43-testing.md) | M2.11 | ☑ | **the corpus exists and it caught a bug on its first run.** `weight-strings.json` is 24 vectors from a real MySQL 8.4, committed and gating, which closes M2.7's outstanding acceptance clause. It disagreed with us immediately: `WEIGHT_STRING('a' COLLATE utf8mb4_bin)` is `0x000061` and we answered `0x61` — see E-12. Nothing we could have written ourselves would have found that, because every other collation test compares us against our own reading of doc 29. The storage-encoding half is committed too, and **all 45 vectors decode to the value that was inserted** — the first external check M2.8–M2.13 have ever had. Doc 24's worked `DECIMAL(14,4)` example comes back byte for byte off a server rather than out of a source comment, and doc 28's three JSON documents are the first captured binary JSON in the project, since doc 28 quotes no dumps at all (M2.15). D-34's two documented divergences are now executable rather than described: the replay converts each binlog integer to storage form (reverse, then flip the sign bit — doc 24's "both steps matter") and strips the length prefix a binlog CHAR/VARCHAR keeps, and removing either step fails the test. It took a second parser to get there. The first read the `Write_rows:` label as though it *preceded* its own hex dump, when `mysqlbinlog` prints it after, so every event was one out of step and three columns came back empty. The parser is structure-driven — event type off byte 4 of the common header, row image off the v2 body layout, CRC32 trailer stripped per `@@binlog_checksum` — and lives in `tools/lib/binlog-hexdump.mjs` so it can be tested without a server; `test/unit/binlog-hexdump.test.ts` drives it with a real captured event, and the label-driven version fails all seven cases. The capture now also asserts one row image per value inserted rather than writing whatever it found. **D-34's SQL is wrong**: it writes `WEIGHT_STRING(s LEVELS 1)`, but the keyword is `LEVEL` (singular) and 8.4 rejects `LEVELS` outright. The tool omits the clause entirely, because bare `WEIGHT_STRING` already returns what that collation's `strnxfrm` produces — naming a level is redundant for an `_ai_ci` collation and wrong for a multi-level one. Two further things a real 8.4 settled: `SHOW MASTER STATUS` is **removed** in 8.4 (`SHOW BINARY LOG STATUS` replaces it), and a literal introduced as one charset cannot be collated as another, so each weight case carries its own introducer. **All three fixtures reproduce byte-for-byte** on an independent run against a fresh container — checked by diffing a later artifact against the committed files — so the job's `git diff --stat` is a real drift signal rather than churn, the same shape as the `generated` job. That is what makes re-capturing worth doing on every push rather than once |
| M2.22 | Size-budget discovery: measure every package with a browser entry point, and fail on one with no committed number | — | [43 §7](./43-testing.md) | M0.10 | ☑ | adding a package without a budget line fails CI instead of printing `[no budget yet]` and passing |
| M2.23 | `Intl.Collator` fallback for a collation we have no tables for: supplies `compare`; `sortKey` throws. Off by default | charsets | [29](./29-charsets-and-collations.md) | M2.7 | ☑ | index bytes are never runtime-dependent, because the path that would produce them refuses to run |
| M2.24 | `StorageValue` and `toDriverValue()` in `@myjs/types` — the half of D-32 no item created. Add `decodeStorageValue(fieldType, bytes, meta)` over the existing per-type decoders; the field-type constants move down by D-37 | types, bytes | [15](./15-wire-types.md), [24](./24-column-encodings.md) | M2.12 | ☑ | D-15's mapping is a named function with a test per row of doc 15's table — including the two rows beyond D-15's one-line summary, `BIT` (a number to BIT(53), bytes past it) and `GEOMETRY` — and `decodeStorageValue` is what doc 28's `custom-data` tag calls, so M2.13 has something to return into |
| M2.25 | `utf8mb4_unicode_ci` and `utf8mb3_unicode_ci`: UCA 4.0.0, PAD SPACE, lazily loaded | charsets | [29](./29-charsets-and-collations.md) | M2.20 | ☑ | the sort key of every one of 2,950 sampled code points equals 8.4.11's `WEIGHT_STRING`, trailing pad weights aside. **Found by the Prisma half of M5.22:** Prisma gives every table it creates `COLLATE utf8mb4_unicode_ci`, and a string key in a collation with no weights is 1273, so no Prisma table with a string key could be made. Doc 29 had left it in Layer 3. `tools/gen-uca400.mjs` parses `strings/uca_data.h` into `uca400.ts`, in `uca900.ts`'s format, and the two load separately (D-36). **What the source and the server taught.** This is MySQL's older scanner (`uca_scanner_any`), and it differs from 9.0.0's in three ways. Everything above U+FFFF weighs 0xFFFD, so two emoji are equal and sort after every CJK ideograph. A page with no table gets an implicit pair whose leading weight knows only Unicode 4.0's two CJK blocks, and there is no Hangul decomposition. And it pads: the longer string's remaining weights are compared with the space's, so `'a' = 'a '` while a tab, which weighs below a space, sorts `'a\t'` before `'a'`. `comparePadded`, M2.19's, already does exactly that on sort keys. No code point's weights run past its slot, the pointer walk the scanner's loop would otherwise follow |

---

## M3 — Parse SQL

**Exit criterion.** Every `CREATE TABLE` in MySQL's own test suite parses.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M3.1 | Lexer: charset-aware, `ANSI_QUOTES`, `NO_BACKSLASH_ESCAPES` | parser | [29](./29-charsets-and-collations.md) | M2.3 | ☑ | a `gbk` or `sjis` lead byte cannot swallow a backslash to escape a quote — **met by construction**, and the test is the attack itself: `SELECT '<BF 5C>' OR 1=1` lexed as gbk yields a closed literal and separate `OR 1=1` tokens. The lexer scans **characters, not bytes**: the statement is decoded once in its session charset, so `BF 5C` is one character and there is no backslash to find. MySQL does this with per-charset lead-byte tables, which were considered and rejected — its ranges are C macros (`isgbkhead`) rather than the struct fields `tab_to_uni` gave B0, so generating them means parsing macros, the fragility D-14 and M2.17 exist to avoid. The other half: a charset this runtime cannot decode faithfully is **refused**, because lexing a guess means lexing SQL the client did not send. Verified by reverting to a byte-scanning decode, which fails exactly the gbk case. Also here: an identifier may begin with a digit (`0xZZ` is a name, not `0` then `xZZ`), a backslash never escapes inside a quoted identifier, `--` is only a comment when whitespace follows, and `/*!nnnnn ... */` is **live SQL** rather than a comment |
| M3.2 | Expression parser: MySQL precedence, operators, literals, `?` placeholders | parser | — | M3.1 | ☑ | precedence matches a real server across a generated expression corpus — **1,050 of 1,050 evaluated expressions agree with MySQL 8.4.11**. The replay parses each expression and evaluates the *tree* with an evaluator that contains no precedence knowledge at all, so it cannot share the parser's mistake; swapping `*` with `+` or `|` with `&` in the table is caught. Integers only, deliberately: `/` returns DECIMAL and the float family is inexact, so including them would test formatting rather than grouping. Captured on the server the vectors job already has up. **The corpus found three bugs and all three were in the test**, which is the harness working: `<=>` is null-*safe* equality and does not propagate NULL the way `=` does; negating an unsigned BIGINT **saturates** to -2^63 rather than wrapping, so `3 \| - ~ 4` is 9223372036854775811; and `%` and `DIV` — unlike `+`, `-` and `*` — do **not** promote to unsigned, so `-5 % (0 ^ 2)` is -1. Each was a fact about MySQL that no document stated and only a server could settle. Two `sql_mode` flags *regroup* rather than re-spell, which is why they are the parser's: `HIGH_NOT_PRECEDENCE` (`NOT 2 = 1` is 1 by default and 0 under the mode — most `NOT x = y` pairs agree by accident of boolean algebra, and 2 is the smallest operand where they part) and `PIPES_AS_CONCAT`, which moves `\|\|` from the bottom of the table to just below the unary operators. Wiring that up found a crash: with the mode off, `a \|\| b` indexed one past the end of the precedence table and threw a `TypeError` — ordinary input producing a crash, which ground rule 5 forbids. The generator was strengthened after the fact: a flat pick from seventeen operators rarely puts two *adjacent* operators from *different* levels together, which is the only shape that can detect a precedence bug, so a scrambled table disagreed on just 2 of 328 — caught, but by a margin thin enough to be luck. Grouping the operators by level and picking two levels on purpose took that to 6–39 |
| M3.3 | `SELECT`: joins, subqueries, CTEs, `GROUP BY`/`HAVING`, `ORDER BY`, `LIMIT`, window functions | parser | — | M3.2 | ☑ | round-trips through a deparser to semantically equivalent SQL. **The deparser came first, so the grammar lands with its check already running.** `deparse()` parenthesises every operator application and backticks every name, so it holds no precedence table and cannot share one of the parser's mistakes; string literals are escaped for the `sql_mode` they will be read under. The census now runs `parse(deparse(ast))` on every statement that parses and gates on zero differences. Building it found three places where **the parser itself** dropped what a statement said, and one of them had a test asserting the loss: `a COLLATE utf8mb4_bin` parsed to a unary node with no field for the name — so `utf8mb4_bin` and `latin1_bin` were the same tree — and `parser-expression.test.ts` asserted exactly that tree, `'(COLLATE a)'`, so it passed for as long as the bug did. It is now its own node. The other two the round-trip *cannot* see, because a value the first parse loses is lost from both trees alike, and they were found by reading while writing the deparser: `ENUM(0xc3a6)` recorded its member as the string `'c3a6'` rather than the bytes of `æ`, and `@'a'` lexed to the bare text `a`, indistinguishable from a column. A fourth was a spelling ambiguity rather than a loss — a `COLLATE` after other column attributes went on the column and one before them on the type, two trees for one column — and both now land on the type. The census-scale gate is checked rather than trusted: planting a deparser that drops a type's collation fails 67 corpus statements. Planting one that drops a key `COMMENT`, an expression `COLLATE` or a DOUBLE's exponent leaves the census green — the corpus's `CREATE`s do not exercise them — so `parser-deparse.test.ts` writes every node out and fails on each of those three | **The grammar is in, and 6,156 of the corpus's 6,187 `SELECT`s parse and round-trip — zero failures, every remaining one either refused on purpose by MySQL or newer than 8.4.** Overall the census went from 4,153 parsed to 10,671 of 17,681. Three groupings decide what a query means and are invisible to a tree that merely parses, so each is written as a shape in `parser-query.test.ts`: `INTERSECT` above `UNION`/`EXCEPT`; a comma below every `JOIN`; and — the one no reading of the manual gives — a condition-less inner join has the *lowest* precedence of all in MySQL's grammar (`%prec CONDITIONLESS_JOIN`), so the right side of a `JOIN` keeps absorbing joins until a condition closes it, and `a JOIN b JOIN c ON x ON y` is legal. A recursive descent gets yacc's shift preference by parsing every join's right side as a full table reference. The corpus corrected a first draft twice: `STRAIGHT_JOIN` is an `inner_join_type` and groups like `JOIN` rather than taking a single table (`derived_correlated.test`), and `t.* AS x` is a syntax error (twenty statements in `alias.test`, found by the expected-failure accounting). `ORDER BY`, `LIMIT`, `INTO` and locking belong to the query expression, so a trailing `ORDER BY` orders a whole `UNION`; `INTO`'s four positions are one field, refused in a subquery or a non-last branch as a real 8.4 refuses them (ER_MISPLACED_INTO, ER_MULTIPLE_INTO_CLAUSES — probed, not assumed). `((SELECT 1) UNION (SELECT 2))` is a query and `((SELECT 1) + 1)` is arithmetic, and the difference is decided at `UNION` by continuing the query from where it is — never by a trial parse undone on failure, which is exponential in nesting depth; `INTERVAL(` was first written that way and was replaced before it shipped. The nesting guard that M3.15 moved onto the cursor is what makes `(SELECT (SELECT …` a typed refusal at depth 100 rather than a stack overflow. **More than half the census's failures on the first run were the census's.** The extractor treated any line starting with a mysqltest command word as a command — so `END` closing a `CASE` on its own line, and `IF(` opening an expression, were deleted from the middle of statements, and the census reported `CASE … ELSE c FROM t` and `UPDATE … b = SELECT …` as SQL we could not parse. A command word is now a command only at command position (under the `;` delimiter, where mid-statement is reliable). `let $q = …` values took the `--error` of the `eval` that sends them, and `--disable_testcase` blocks — never run — are skipped. Each rule was checked by diffing what it changed against the previous extractor: two broader versions removed 456 and 524 statements of real SQL, which a rule that silently removes corpus does without any other symptom; the narrow ones replace 45 corrupted statements with 45 whole ones. **A review pass found four more things, each by a check rather than by reading.** A 5,000-link `JOIN … ON` chain after a condition-less join was a `RangeError` *at parse time*: the re-hang walked the right side's left spine recursively, and that spine is built by a loop the nesting guard never sees. The fuzzer could not reach it because no generator repeated a binary fragment; one does now, and it reproduced the crash before the fix (now a loop) and runs clean after. The same shape broke every recursive consumer of the tree, which is D-40. Writing D-40's deparser rule exposed that `:=` had been parsed left-associative like the rest of the table; on 8.4.11 `@a := @b := 7` sets both, so it is right-associative, and only a user variable may be assigned (`a := 1`, `@@sql_mode := 1` are ER_PARSE_ERROR). And probing the server with a list of malformed statements found four forms accepted here and refused there — `a IN ()`, a bare `*` after the first select item, a four-part name, and those `:=` targets — which the census can see only when the corpus happens to hold one under an `--error`. Folding `SELECT`'s and `DELETE`'s two copies of the `LIMIT` grammar into one found a fifth — `LIMIT @a`, which both copies accepted and 8.4.11 refuses — and the census then reported one `SELECT` with `LIMIT @one` as a failure. The server agreed with the parser; the census was wrong again: the corpus predicts that error on `eval EXPLAIN $query`, and the let-value mapping knew only a bare `eval $query`
| M3.4 | `INSERT` (incl. `ON DUPLICATE KEY UPDATE`), `UPDATE`, `DELETE`, `REPLACE` | parser | — | M3.2 | ☑ | multi-row and `SELECT`-sourced forms included — **and every one of the corpus's 3,669 that MySQL accepts parses and round-trips**: `INSERT` 3,305 / 3,314, `UPDATE` 156 / 156, `DELETE` 188 / 194, `REPLACE` 20 / 20, the remainder refused on purpose by MySQL. Nearly all of it is M3.3 reused — a multi-table `UPDATE` is table references, `INSERT … SELECT` a query expression, a `VALUES` row the row a `VALUES` statement has — so what this item owns is clause order and a handful of facts a server settled by probe rather than the manual: `UPDATE` and `DELETE` take `LIMIT n` and refuse `LIMIT m, n` and `OFFSET`; an `INSERT` column list may be qualified; and `WITH` opens an `UPDATE` or a `DELETE` as it opens a query, which the dispatcher learns only after the `WITH` clause — so the clause is read once and handed to whichever statement follows, rather than re-read. Spellings that are one statement are one tree: `VALUES`/`VALUE`/`VALUES ROW`, and `DELETE t FROM …` against `DELETE FROM t USING …`. One deparser trap: the single-table `DELETE` writes its alias *before* its partitions, the reverse of a table reference in a `FROM` list. **The census found one more of its own defects on the way**: mysqltest accepts `-- error 1064` with a space after the dashes, the extractor's pattern did not, and `default_as_expr.test` alone writes it 59 times — so statements MySQL refuses on purpose had been counted as statements it accepts, and three of them in `derived.test` (`DELETE FROM (SELECT …)`) surfaced as failures here |
| M3.5 | `CREATE`/`ALTER`/`DROP` for tables, indexes and views; column types with charset and collation | parser | [29](./29-charsets-and-collations.md) | M3.2 | ☑ | **Done: `ALTER` 77 / 77, and `CREATE INDEX`, `CREATE DATABASE`, `DROP TABLES` and `CREATE TABLE … PARTITION BY` with it, so every `CREATE TABLE` MySQL accepts in the corpus now parses.** `CREATE INDEX` is returned as the tree of `ALTER TABLE … ADD INDEX`, because that is how MySQL executes it, and `MODIFY c def` is `CHANGE c c def`. The server settled four things the manual does not state. `ALTER TABLE t` with no action is legal. Options and actions interleave, but only across a comma: `COMMENT='x' ADD INDEX (z)` is ER_PARSE_ERROR and `DEFAULT CHARACTER SET x, MODIFY …` is not. A first draft refused the second, and the corpus corrected it. `KEY ALGORITHM` is 1 or 2 in the grammar itself, while `PARTITIONS 0` and `VALUES IN` under `RANGE` are refused only after parsing. The fourth was a shipped over-permissiveness: an unparenthesised `DEFAULT` read any expression, and 8.4.11 refuses `DEFAULT 1 + 1`, `DEFAULT c` and `DEFAULT ~1`. It takes a literal or a signed number, while `ON UPDATE` takes only the `NOW()` family. Partition *management* (`ADD PARTITION`, `REMOVE PARTITIONING` and the rest) is named as not implemented and left to M8.9. What follows is the item's history. `CREATE TABLE` and `DROP` were done first and **`would not parse: none`** — every statement in MySQL's own corpus that this parser attempts, and that a real server accepts, parses. `ALTER` remains, which is why this is ◐ rather than ☑ — `CREATE VIEW` and `CREATE TABLE … SELECT` arrived with M3.3's query parser, and `CREATE TABLE … PARTITION BY` (2 statements) is the last `CREATE TABLE` form the census reports as unimplemented. The census is what says so: 2,793 of the corpus's 3,469 `CREATE`s parse, 314 more are `CREATE TABLE … SELECT` waiting on M3.3's query parser, and the rest are statements MySQL itself rejects. **That last category is the item's real lesson.** The corpus is full of deliberate syntax errors — 102 of them carry `--error ER_PARSE_ERROR` — so "how much parses" was the wrong question and gave the wrong number: it counted refusing invalid SQL as a failure. The extractor now tracks `--error` and the census asks the right one, *how much of what MySQL accepts parses*, which is the criterion's own wording. It also opened a direction a parse rate cannot see: **SQL we accept and a real server rejects**. Fourteen statements were in that state, and every fix came from reading the corpus rather than reasoning: a trailing comma in a column list is `--error 1064`; `row_format=page` is MariaDB's; and `KEY_BLOCK_SIZE = 2147483647` is rejected because — as `create.test`'s own comments say — the option is "2 bytes in frm", so the bound is 16-bit and not the 32-bit one a reader would assume. Two remain, both needing machinery this item does not own (MySQL's reserved-word list, for `create table lateral(…)`, and its rules for characters in an unquoted identifier), and the census ratchets them. One of my own fixes was wrong in the same way and the accounting caught it: I had made option values accept a leading `-` *so that* `KEY_BLOCK_SIZE = -2147483647` would parse, having inferred that the range check was the server's. It is the parser's, and MySQL refuses it. The type table is the item's other half and is written out rather than generated — a deliberate exception to D-14, since the name-to-`enum_field_types` mapping lives in `sql_yacc.yy` and extracting it means parsing Bison. What keeps it honest is the corpus: a name spelled wrong here is a parse failure there. Five traps it exists to get right, none visible from the type name: **`FLOAT(p)` with one argument is a precision**, and `p ≥ 24` makes the column a DOUBLE, so `FLOAT(24)` and `FLOAT(24,2)` are different types; `REAL` is DOUBLE unless `REAL_AS_FLOAT`, which is the first thing to read that flag since M3.7 parsed it; `SERIAL` is not a type but `BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE`; `BINARY` after a string type is a *collation*, not the BINARY type; and several names are two words, so the table cannot be a single-token lookup. The hardest piece of grammar was not a type but an ambiguity the corpus found: `KEY timestamp (timestamp)` is a key named `timestamp` and `key TIMESTAMP(6)` is a column named `key`, and both are a key-ish word, a type name and a `(`. What separates them is what is *inside* the parentheses — a type's argument is a number, an index's is a column. Two more came out of the corpus and are now in the expression parser: typed temporal literals (`DEFAULT DATE'2019-10-01'`), and **a space before a function call's `(`**, which the manual's "there must be no whitespace" made me forbid — `default_as_expr.test` has `DEFAULT (CONCAT ('[', data, ']'))` with no `--error`, so a real 8.4 accepts it and the strict reading was refusing valid SQL. `Cursor` was extracted so both parsers advance one position: a `DEFAULT (a + 1)` is an expression inside DDL and cannot be re-lexed from a substring. `parseStatement` is fuzzed as a third target, with the generator taught DDL words — without them a million inputs almost never get past the dispatcher, which is M3.10's lesson applied to its own successor |
| M3.6 | `SET`, `USE`, `SHOW`, `EXPLAIN`, transaction control | parser | [14](./14-command-phase.md) | M3.2 | ☑ | `SET NAMES` and `SET sql_mode` reach the session — **and the session's `sql_mode` now decides how its next statement is parsed**: `@myjs/core` parses `SET` and `USE` with `parseSqlMode(session.sqlMode)`, so `SET NAMES 'latin1\'` is ER_PARSE_ERROR by default and, after `SET sql_mode = 'NO_BACKSLASH_ESCAPES'`, a closed literal naming an unknown charset. The regex `parseSetNames` is gone, which matters beyond tidiness: it matched `SET NAMES` only as a whole statement, while `SET @a = 1, NAMES latin1` is legal. Prepared statements and `DO` came along, since they are the same size and the census ranks them above most of what remains. **Census: `SET` 1,138 / 1,138, `SHOW` 240 / 240, `EXPLAIN` 731 / 733 (the other two refused on purpose), `EXECUTE` 213 / 213, `PREPARE` 80 / 80, `DO` 77 / 77, with no failures and no round-trip differences.** Every refusal and every "these spellings are one tree" was put to a real 8.4.11 first, and four of the answers are not in the manual. **A scope keyword is sticky across a `SET` list and `@@scope.` is not**: `SET GLOBAL a = 1, b = 2` sets both globally, while after `SET GLOBAL a = 1, @@b = 2` or `SET @@global.a = 1, b = 2` the `b` is not global. That depends only on the text, so `SetItem` records the scope each item actually has. The deparser writes `@@global.x`, never `GLOBAL x`, so its output cannot re-scope a later bare name, and a planted deparser that writes the keyword form fails the test. A bare name with no scope in force stays its own `name` item, because inside a stored program it is a local variable first. `SET NAMES` may sit anywhere in a list but never after a scope keyword, and `SET TRANSACTION` may not sit in one at all. `PREPARE … FROM` takes exactly one string literal or user variable: an introducer, adjacent literals and a call are all ER_PARSE_ERROR. `EXPLAIN`'s options have one order (`ANALYZE`, `FORMAT`, `INTO`, `FOR SCHEMA`), `FOR SCHEMA` exists in 8.4, and `ANALYZE` excludes `INTO` in the grammar while `INTO` without `FORMAT=JSON` is refused only after parsing (ER 6006). `SHOW` is one node with a canonical `what`, so `FIELDS`/`COLUMNS`, `KEYS`/`INDEX`, `SCHEMAS`/`DATABASES` and `FROM t FROM db`/`FROM db.t` are one tree. When both name a schema the second `FROM` wins: `SHOW COLUMNS FROM mysql.t1 FROM test` lists `test.t1`. **Three things were wrong and the work found them.** `parseSqlMode` claimed to be "whitespace-tolerant, as MySQL is", and a test asserted it. 8.4.11 refuses `' ansi_quotes '`. It also accepted any well-shaped name, contrary to M3.7's own text, so `SET sql_mode = 'nonsense'` would have been stored. The list of modes is now captured from the server — `SET sql_mode = 1 << i` names bit `i` — and `formatSqlMode` reports them as `@@sql_mode` does, in bit order with the combination name kept: `ANSI` comes back as `REAL_AS_FLOAT,…,ONLY_FULL_GROUP_BY,ANSI`, byte for byte what the server says. Second, the census found `FORCE INDEX ()` accepted: an empty hint list is `USE`'s alone, and `parser-deparse.test.ts` had asserted `FORCE INDEX FOR ORDER BY ()` as valid SQL. `group_by.test` asserts the refusal under `EXPLAIN`, so it was invisible until `EXPLAIN` parsed. The third was the census's own: see the change log on `delimiter`. `@myjs/core` now depends on `@myjs/parser`, which is 20 KB gzipped of growth taken deliberately: the executor will need every byte of it |
| M3.7 | `sql_mode` threaded through lexer and parser | parser | [29](./29-charsets-and-collations.md) | M3.1 | ☑ | the same text parses differently under `ANSI_QUOTES`, proven by test — `"x"` is a string literal by default and an identifier under the mode. Threaded as a parameter from the first commit rather than read from a global, because a parser that acquires `sql_mode` awareness afterwards gets rewritten. Six modes are parsed, chosen by a test: the ones that change what a statement **is** rather than what it does. The combination modes are expanded, so `SET sql_mode='ANSI'` turns `ANSI_QUOTES` on — which `split(',').includes('ANSI_QUOTES')` would miss. A value that is not a mode name is refused rather than dropped, since it arrives from `SET sql_mode = <user string>` and a silently dropped mode leaves a session parsing differently from what its own `@@sql_mode` reports |
| M3.8 | Accept and store — do not execute — routines, triggers, events | parser | [00](./00-goals-and-scope.md) | M3.6 | ☑ | `CREATE PROCEDURE` stores; `CALL` errors with a clear "not yet supported" — the stub keeps procedures, functions, triggers and events by name. Duplicates and missing names give the server's errors (1304, 1305, 1359), and `CALL` of a stored procedure is ER_NOT_SUPPORTED_YET naming `CALL`. **Census: `CALL` 36 / 36, and every routine in the corpus parses.** The head is parsed in full (parameters, return type, characteristics, schedule). The body is kept as the source text it was written in, because executing it is M8.5's. A body that is one ordinary statement is parsed as well, since 8.4.11 refuses `CREATE PROCEDURE p() garbage`. A compound body, which is the stored-program language (`BEGIN … END`, `IF`, `WHILE`, labels), is stored unread: it is the one place this parser accepts SQL it has not checked, and it is recorded rather than hidden. Writing the tests found three bugs. `STATEMENT.CALL` was first spelled `'call'`, the kind of a function-call *expression*, so the deparser took every function call for a statement. The lexer had no bare `:` token, so a labelled body (`l1: LOOP`) could not be tokenised at all. And mysqltest sends a `delimiter` block as one *multi-statement* query, so `DROP FUNCTION …; CREATE FUNCTION … BEGIN …; END` is two statements. Only a parser can find that boundary, because the body is full of `;`. `parseStatements()` is that parser, and is what D-13's opt-in multi-statement mode will call |
| M3.9 | Parse errors as `ER_PARSE_ERROR` (1064/42000) with position | parser | [14](./14-command-phase.md) | M3.2 | ☑ | message shape matches MySQL's "near '…' at line N", and the `near` text is a **suffix** — from the offending position to the end, capped — because that is what clients and MySQL's own suite match on. `messages.parseError` had been written ahead in M1 and called by nothing, so this is mostly wiring. `@myjs/parser` writes its errnos out rather than looking them up, since it must not depend on `@myjs/protocol` (doc 03) — the trade `@myjs/types` already makes — and a test asserts them against the generated table so the trade stays honest |
| M3.10 | Parser fuzz target | test | [43 §6](./43-testing.md) | M3.3 | ☑ | arbitrary strings never crash, hang, or read out of bounds — 10^6 inputs per run across every `sql_mode` and eight collations, into the lexer, the byte-level lexer and the expression parser. `tools/fuzz-reader.mjs`'s shape, so a crasher replays from its seed and lands in the corpus as a regression test; the CI job has been called "fuzz parsers" since M0.8 while running one target, and now runs two. The generator emits SQL-shaped noise rather than uniform bytes — quotes, backslashes, comment openers, gbk lead bytes — because random bytes mostly exercise the first token and stop. **It found nothing on its first million inputs, and the reason is the lesson**: its nesting bound was 40, and the parser blew the JavaScript stack at about 390. `'('.repeat(1000)` was eleven bytes of typing that turned into a `RangeError` from anyone who could send a query. Reading the code found it; the bound is now 400 and the same mutation is caught at iteration 322. A generator's bounds are part of what it tests | **Extended by M3.3/M3.4 with a fourth target, the round-trip**: any fuzzed statement that parses must survive `parse(deparse(ast))`, so the deparser's acceptance property is checked over inputs nobody wrote. Fragments alone rarely add up to a query that parses, so 40% of inputs are a seed statement with up to two tokens mutated — about 33,000 statements per million inputs reach the deparser, across three seeds, with no difference, crash or hang
| M3.11 | Parse-only pass over MySQL's own test corpus: fetch `mysql-test/t` at the pinned ref, extract statements, report lex and parse rates and a keyword census | test | [43 §1](./43-testing.md) | M3.1 | ☑ | **18,751 statements from 120 files, 18,751 lexing — 100%, and the job gates.** Doc 43 §1 calls `mysql-test` "the single highest-value testing asset available to us" and ground rule 7 already says how to use it: fetched in CI, never vendored. The full interpreter is M5.15 and stays there, because diffing `.result` files needs an executor — but the *parse-only* half needs only a parser, and **M3's own exit criterion already assumed this tool existed** ("every `CREATE TABLE` in MySQL's own test suite parses") while no item owned it. The same shape as the M2.24 gap: a criterion resting on infrastructure nothing built. Two numbers come out. `lexed` is measurable today and is the first time the lexer has met real-world SQL rather than the 22 cases someone thought to write; it gates, and reverting the lexer's `#`-comment handling turns it red. `parsed` is 0 until M3.3–M3.6, and its value is the **breakdown** rather than the total: over the full 120 files, SELECT 5687, CREATE 3164, INSERT 2910, DROP 2286 is 75% of the corpus and is a better build order than a list drawn from memory — `DROP` outranking `UPDATE` twenty-three to one, and `ALTER` (1089) outranking `DELETE` (186), is not what I would have guessed. Statement boundaries come from our own lexer rather than from splitting on `;`, since a semicolon inside a string literal is not a terminator. **Only facts are committed** — names, hashes, counts, frequencies — never a line of the SQL, which is D-29's rule applied to a corpus instead of a table; failing statements are printed to the ephemeral CI log and nowhere else. The first run over a wider selection reported eight files that would not lex, and **not one of them was a lexer bug** — every one was the instrument measuring itself. Five were pure `--source` wrappers with no SQL in them at all (`derived_condition_pushdown.test` is two lines, both includes); one was `ctype_sjis.test`, which is Shift-JIS on purpose and arrives full of U+FFFD because `Response.text()` decodes as UTF-8; and two were multi-line mysqltest directives whose continuation lines carry no `--` of their own, so half a `--assert([SELECT … ])` was handed to the SQL lexer as a statement. Those are now three named outcomes — `no-sql`, `not-utf8`, `lex-failed` — because reporting a file with nothing in it as a parser defect teaches a reader to ignore the number. Fixing the third of them produced the more useful lesson. The first continuation rule counted brackets and backticks on **every** directive, which is wrong because `--echo` carries free prose: one bug title ending `` assertion `!m_wrapper->empty()' `` opens a backtick that never closes, and 25 lines of real SQL across three files vanished into it. The census went on reporting 100% lexed over less and less corpus — strictly worse than the miscount it replaced, since a heuristic that silently drops input flatters every number downstream of it. So the directives that may continue are a closed list (`let`, `assert`, `expr`, `if`, `while`), the run is bounded, and a fresh `--` line ends it. The extractor moved to `tools/lib/mysqltest-extract.mjs` for the same reason `binlog-hexdump.mjs` did — the census needs the network and its rules do not — and `test/unit/mysqltest-extract.test.ts` drives them with nine cases written for the purpose, since ground rule 7 forbids quoting the corpus even in a test. Restoring either version of the bug fails a different one of them. A `measured` count and a cap landed at the same time: `no-sql` is a legitimate outcome and also the shape an extractor collapse would take at corpus scale, so it is capped at 10% of the selection, while `not-utf8` is only reported — it is a property of the source file that nothing in the tool can cause, and capping it would restate the selection rather than check anything. The expanded run then found the gap that becomes **M3.12**: 8 of the 13 unmeasured files are `ctype_*`, which is to say the corpus's own tests for exactly what M3.1 was built for, unread because they are not UTF-8 |
| M3.12 | Census reads the charset test files: fetch `.test` bytes rather than text, honour each file's `SET NAMES`, and lex with the declared collation | test | [43 §1](./43-testing.md), [29](./29-charsets-and-collations.md) | M3.11 | ☑ | **M3.1's security clause is now checked against MySQL's own test for it.** Until this item the clause — "a `gbk` or `sjis` lead byte cannot swallow a backslash to escape a quote" — was proven only by cases written here, because the eight `ctype_*` files that test it were the eight the census skipped: it read every file through `Response.text()`, so a Shift-JIS or latin1 source arrived as U+FFFD. Now the bytes are fetched and hashed as bytes, and each file is split into **regions** by the charset in force — `--character_set` takes effect immediately, `SET NAMES` after the statement that carries it, because it is SQL and executes in the charset it was sent in. `ctype_utf8.test` alone switches twenty times. The corpus grew from 107 measured files to 115 and from 18,751 statements to 21,240, and it is now read in **twelve charsets**: utf8mb4 17705, latin1 2237, utf8mb3 984, latin2 135, sjis 46, gbk 37, big5 36, euckr 27, koi8r 19, gb2312 7, gb18030 5, swe7 2. Two mutations prove the point rather than assert it: ignoring the charset switches, and making the lexer scan bytes (latin1 identity), both fail on the same line of `ctype_sjis.test` — `SELECT QUOTE('<81 5C>')`, one Shift-JIS character whose trail byte is the ASCII backslash. Read wrongly, the `5C` escapes the closing quote and the literal never ends. Three switches are **refused, as a real server refuses them**: `ucs2` may not be a connection charset (doc 12), and `SET character_set_client = CONCAT('ucs', …)` is not a name — `ctype_ucs.test` does both on purpose. `SET NAMES DEFAULT` and `SET NAMES utf8` resolve instead, to utf8mb4 and utf8mb3, since treating them as unknown would leave the wrong charset in force over changed bytes. A charset this build will not decode is neither followed blindly nor refused: the region is entered and skipped, and its lines are **counted** — 68 lines of `binary`, which is the difference between "100% lexed" and "100% of what we could read". **And the corpus found a shipped bug on its first charset-aware run.** `func_like.test` runs `SET NAMES gb2312`, and gb2312 was absent from the generated registry entirely: `strings/ctype-gb2312.cc` was not among the files `gen-charsets.mjs` reads, so ids 24 and 86 resolved to nothing and a gb2312 client got `unknown collation` rather than either service or an honest refusal — while `APPROXIMATE_CHARSETS` had been naming a charset the registry could not produce. The gap was visible in the committed table all along, as `23 … 25` and `85 … 87`. 288 collations became 290 |
| M3.13 | The pinned tree is read from a local clone when there is one: `fetchPinned*` and the census's directory listing resolve against `reference/mysql` before the network | test | [90](./90-references.md), [43 §1](./43-testing.md) | M3.11 | ☑ | **Every generator and the census now run offline, and closing that loop found the census had been measuring a truncated corpus.** `reference/` was documented by doc 90 and read by *nothing*: all four generators and the census fetched over HTTPS on every run. One seam changes it — `fetchPinned`/`fetchPinnedBytes` in `tools/lib/gen-common.mjs` are the only way any tool reaches upstream — so a `git show <REF>:<path>` before the fetch makes all five hermetic. The blob bytes are the same bytes `raw.githubusercontent.com` serves for that commit, and the proof is the `generated` job's own check: `gen:errors`, `gen:charsets` and `gen:uca` reproduce all seven committed tables byte for byte from disk. `gen:uca` went from downloading 7.4 MB to 0.35 s. Ground rule 7 is untouched — `reference/` is gitignored and nothing is copied — because the rule governs what may be *committed*, not how a generator reaches a commit. **The listing is where the defect was.** The census listed `mysql-test/t` through the GitHub contents API, which returns at most 1,000 entries per page, so it had been selecting 120 files from the first 1,000 *filenames alphabetically* rather than from the directory — a truncation with no error, since the response is a valid short list. `git ls-tree` over the pinned commit answers the same question with no token, no sixty-an-hour rate limit, and no cutoff, and the selection moved: every file it had been choosing sorts at or before `key_myisam.test`, and `null.test`, `order_by_*`, `subquery_*` and `update.test` appeared for the first time. That is **E-14**, and it retracts most of E-13 |
| M3.14 | A real MySQL 8.4 on the developer's machine: `tools/mysql-local.mjs` installs, initialises, starts and provisions one, and the capture tools run against it | test | [43 §2](./43-testing.md), [90](./90-references.md) | M2.21 | ☑ | **The differential loop closes on this machine instead of only in Actions**, which matters because every compatibility fact this project holds that no document supplied came from a server — `utf8mb4_bin`'s sort key, `<=>` being null-safe, unsigned negation saturating, `%` not promoting. 8.4.11 from `repo.mysql.com`'s `mysql-8.4-lts`, which is the *exact* build `precedence.json` and `storage-encodings.json` were captured against, so the corpora are reproduced rather than resembled — and all three do reproduce, byte for byte: 45 storage vectors, 24 weight strings, 1,050 expressions. It also carries `mysql-community-test`, which is the real `mysqltest` binary and MySQL's own `.result` files; that is not needed to capture anything and is recorded here because it may make M5.15's interpreter unnecessary. Three things it found. **`capture-traces` had never once completed**: it requires a `nopw` and a `trace` account and refuses to invent them — rightly — but nothing else created them either, and `continue-on-error: true` made an abort indistinguishable from a pass, so the job had been silently dead since it was written. Provisioning is now its own explicit step, and the capture step no longer swallows its own failure: *the tool aborting* and *the bytes differing* are different events and only the second is advisory. **The captures depended on the machine's locale.** The `mysql` CLI takes its default charset from `LANG`, so on a host without one it negotiates latin1 and a UTF-8 literal is stored double-encoded — `café` as `63 61 66 C3 83 C2 A9` rather than `63 61 66 C3 A9`. The corpus that comes out looks entirely plausible and is wrong, which is this file's own recurring failure mode; `--default-character-set=utf8mb4` is now pinned rather than inherited. And the M1 exit criterion has now been met against an **8.4** client, having only ever been run against 8.0.46 |
| M3.15 | MySQL's reserved words (D-39), and one nesting guard per statement rather than per parser | parser, test | [43 §1](./43-testing.md) | M3.11 | ☑ | **`CREATE TABLE lateral (a INT)` is refused, as a real 8.4 refuses it, and the census's wrongly-accepted ratchet falls from 2 to 1.** 262 of 734 keywords are reserved. An unquoted reserved word is never a name, except after a `.` (`t.select`) or as a builtin function before a `(` (`IF(`, `LEFT(`, `RANK()`) — that second list is written out, because the server publishes which words are reserved but not which its grammar also accepts as a function. The list replaces M3.2's eight hand-kept `STOP_WORDS`, which is what lets a query parser stop an expression at `FROM`, `GROUP` or `UNION` at all. **Asking the server found that a piece of M3.5 was guarding a case MySQL does not have.** M3.5 treated `KEY`, `INDEX` and `UNIQUE` as legal column names and told `KEY timestamp (timestamp)` from `key TIMESTAMP(6)` by looking inside the parentheses; all three are reserved, `CREATE TABLE t (key INT)` is ER_PARSE_ERROR on 8.4.11, and the corpus's column named `key` was in backticks — which never reached the heuristic. The lookahead is gone and the test now asserts the refusal. The depth guard moved from the expression parser onto the `Cursor`, the one object every parser of a statement shares: with subqueries each level starts a new expression parser, so a per-parser counter would restart at zero and `(SELECT (SELECT …` would be M3.10's stack overflow again. Also fixed: `mysql-local.mjs start` raced its own TCP grant on a fresh datadir and reported "up, but not answering" |
| M3.16 | Query grouping checked against a real server: `tools/capture-queries.mjs` runs generated joins and set operations on 8.4.11 over three small tables; the replay parses each and evaluates the tree with an evaluator that knows no grouping | test | [43 §2](./43-testing.md) | M3.3, M3.14 | ☑ | **1,200 of 1,200 queries agree with MySQL 8.4.11 — and the corpus disagreed with the parser on its first run.** M3.2's corpus checks operator precedence; this one checks the grouping one level up — which tables an `ON` may see, what an `INTERSECT` or a trailing `LIMIT` applies to — where a wrong tree parses, round-trips through its own deparser and means something else. 711 queries return rows and 489 are refused, and the refusals are the point: `t1, t2 JOIN t3 ON t1.a = t3.a` is ER_BAD_FIELD_ERROR because the comma binds loosest, so an `ON` naming a table outside its operands is a grouping fact the server states. The replay's evaluator checks each `ON` against the columns its two operands supply and nothing else, so it cannot rescue a misgrouped tree. **What the first run found:** M3.3's join grammar had MySQL's absorbing rule — the right side of a `JOIN` keeps reading until a condition closes it, which is what makes `a JOIN b JOIN c ON x ON y` legal — and lacked the second rule that the same grammar action applies. A condition-less inner join calls `add_cross_join`, which re-hangs it on the leftmost table of what it absorbed, so `a JOIN b JOIN c ON x` ends as `(a JOIN b) JOIN c ON x` and `x` may name `a`. Sixteen vectors disagreed; probing the server separated the two rules (with a second `ON` the first is the inner join's; without one it is not) and `sql_yacc.yy` confirmed the mechanism. Reasoning from the grammar's precedence declarations alone had produced half of it, confidently. Five planted mistakes each fail the replay: a comma at `JOIN`'s level (41 disagreements), `INTERSECT` at `UNION`'s (46), a trailing `ORDER BY`/`LIMIT` on the last branch (146), no re-hanging (16) and no absorbing (13). `LIMIT` is generated only with an `ORDER BY`, since without one *which* rows survive is the server's choice and a vector recording it would not be a fact; the capture reproduces byte for byte |
| M3.17 | Administration statements: `ANALYZE`/`CHECK`/`OPTIMIZE`/`REPAIR TABLE`, `FLUSH`, `TRUNCATE`, `LOCK`/`UNLOCK TABLES`, `LOAD DATA`, `GRANT`/`REVOKE` and user management | parser | [14](./14-command-phase.md) | M3.2 | ☑ | the census's not-implemented list is empty — today it holds `ANALYZE` 292, `FLUSH` 55, `CHECK` 24, `GRANT` 10, `LOAD` 6, `TRUNCATE` 6 and a handful more. Added when M3.8 closed, because these were the only statements left in the corpus that no item owned. M3's exit criterion does not need them, so 0.2 does not wait on them. **Done: `not implemented yet: none`, and the census now gates on it.** 17,534 of 17,589 statements parse, with no failures and no round-trip differences. `ANALYZE` 292 / 292, `FLUSH` 55 / 55, `CHECK` 24 / 24, `GRANT` 10 / 10, `LOAD` 6 / 6, `TRUNCATE` 6 / 6, `DROP` 1,946 / 1,946. `packages/parser/src/admin.ts` covers table maintenance with histograms, `FLUSH`, `TRUNCATE`, table and instance locks, `RENAME TABLE`, `LOAD DATA`/`LOAD XML` clause by clause, `GRANT`/`REVOKE` with privileges, roles and proxies, `CREATE`/`ALTER`/`DROP`/`RENAME USER`, `CREATE`/`DROP ROLE`, `SET PASSWORD`/`ROLE`/`DEFAULT ROLE` and `RESET`. **Each form was put to 8.4.11 first, and then checked twice more against it.** Every statement `parser-admin.test.ts` accepts was deparsed and replayed: none is a 1064. Every statement it refuses was replayed: all 113 are. The facts the manual does not give: `FLUSH TABLES t, PRIVILEGES` flushes a *table* named `PRIVILEGES`, and `FLUSH TABLES, PRIVILEGES` is a syntax error. `CHECK` and `CHECKSUM` take no `LOCAL`. `CHECKSUM` takes one of `QUICK` or `EXTENDED`, while `CHECK` and `REPAIR` take any run of their words, repeats included. In `GRANT`, anything that is not a static privilege is a name, so `GRANT SELECT, r1 ON t` parses and is refused later. Column lists belong to four privileges, and never to a routine. A role may not be an unquoted `NONE`, but a user may (`GRANT r1 TO none`). `REVOKE ALL FROM u` needs `, GRANT OPTION`. `CREATE USER`'s clauses have one order. `AND IDENTIFIED` is `CREATE`'s, while `REPLACE`, `RETAIN CURRENT PASSWORD` and `DISCARD OLD PASSWORD` are `ALTER`'s. A `LOAD DATA` delimiter is one literal (`',' ','` is refused), `ROWS IDENTIFIED BY` comes before `FIELDS`, and `MEMORY = 100M` is a number the lexer reads as a name. `RESET MASTER`, `RESET SLAVE`, `FLUSH HOSTS` and `FLUSH QUERY CACHE` are gone from 8.4 and are refused as it refuses them. **Emptying the list needed two fixes that were not grammar.** Eight of its twenty-one entries were never statements. `QUERY_VERTICAL` is a mysqltest command that sends the SQL after it, and that SQL is now measured: four more statements, all of which parse. `FROM`, `WHERE`, `ORDER`, `T3`, `T6A`, `T1_INV_DATE` and an 81-digit number were the halves of `let` values and bare `eval`s that the extractor cut. A let name may be written without `$` (`let query1=`). A let value is a statement only if it begins with a statement keyword, not merely with a letter. A bare `eval` or `let` runs to its delimiter, as every bare command does. Diffing the keyword census before and after shows exactly those entries gone and nothing real lost. The ninth was `GROUP BY GROUPING SETS`, which 8.4.11 refuses with 1064. It is newer than our target, and the census now counts it under that name (D-70). At M3.17 core still answered `FLUSH`, `SET PASSWORD` and `SET ROLE` with OK without performing their effects. M5.53 removes that false success: unsupported administration returns 1235; the parser coverage remains complete. The fuzzer learned the admin words and six seeds, and a million inputs ran clean. The grammar costs 6.2 KB gzipped of parser, the same trade M3.6 made |

---

## M4 — The storage engine

*The big one.* Ordered in six tiers rather than as one list, because the
dependency structure is real: records need pages, the tree needs records, the
WAL wraps the tree, and MVCC needs all three.

**Exit criterion.** The fault-injection suite runs 10,000 crash points with zero
inconsistencies and zero lost acknowledged commits.

### Tier 1 — page frame and buffer pool

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.1 | CRC32C, table-driven (see E-01) | engine | [26](./26-redo-and-recovery.md) | M0.1 | ☑ | matches the RFC 3720 test vectors — all four §B.4 vectors and the `123456789` check value. Table-driven, byte at a time: a page is checksummed once per write, so slicing-by-8 would buy speed nothing needs yet |
| M4.2 | Page frame: 16 KiB, self-identifying header, LSN at head **and** tail | engine | [21](./21-innodb-file-layout.md), [41](./41-durability-and-concurrency.md) | M4.1 | ☑ | a torn page is detected without consulting the log — a CRC32C over everything after itself (D-44), and the LSN at head and tail. The test tears a page by hand (new head, old tail) and flips a bit at five offsets. The checksum is sealed once, when the pool writes the page out, and LSNs are read as two `u32`s so no `BigInt` reaches the hot path. Page 0 is a minimal superblock (D-41), refused with `ENGINE_BAD_FORMAT` for a wrong magic, format version or page size (D-26) |
| M4.3 | Buffer pool: young/old LRU split over one `ArrayBuffer`; dirty list in LSN order; commit backpressure | engine | [41](./41-durability-and-concurrency.md) | M4.2 | ☑ | scanning 10× the pool does not evict the working set — **met**, and its companion test shows the instrument can fail: the same workload with promotion on every re-access loses the working set. Promotion needs a second access more than `promoteAfter` fetches after the first, which is `innodb_old_blocks_time` on a logical clock. The dirty list is ordered by **first** change, not by page LSN, and because LSNs only rise that is insertion order: a `Map` keeps it for free, and a test re-dirties the oldest page and checks it stays first. A `beforeWrite(lsn)` hook is where Tier 4's WAL-before-data rule attaches. The pool also runs a structural check on every index page it reads from storage — found by the engine fuzzer, below. **And met with Tier 4: commits block before dirty pages grow unbounded.** In a synchronous engine, blocking means doing the work first. Before each mini-transaction, a checkpoint runs to the median dirty page once three quarters of the pool is dirty, or to the log's midpoint once the ring is half full (D-49). A test commits 3,000 random inserts into a 32-frame pool with an 8-block log. Dirty pages never pass 32, and the log never leaves its ring. `oldestDirty` is a minimum over recLsns rather than the `Map`'s first entry, so an aborted change's discarded frame cannot break the order a checkpoint relies on |

### Tier 2 — records

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.4 | **Decision (not code):** design the page-level schema version that replaces instant DDL. Resolves Q-03; implements D-21 | engine | [22](./22-innodb-page-formats.md), [23](./23-innodb-row-formats.md) | M4.2 | ☑ | the page header reserves the field and the design is written back into doc 22 — a `u32` meaning "every record on this leaf is in version v", set on clustered leaves only. The tree stays schema-blind and takes `upgrade(value, fromVersion)`. A read upgrades without writing. Any write to an older leaf first re-encodes it: in place when it fits, otherwise by emptying the leaf and re-inserting through the ordinary path so it can split. A merge of two leaves at different versions upgrades both. The test doubles every value's size across a version, which forces the split path. Answers Q-03. M4.23 inherits one requirement: a version stays in the catalog until no page uses it |
| M4.5 | Record encoding: null bitmap plus a variable-length array storing **lengths, not offsets**; DYNAMIC atomic-BLOB semantics | engine | [23](./23-innodb-row-formats.md) | M4.4, M2.14 | ☑ | round-trip property over arbitrary generated schemas — 1,000 random layouts and rows, plus every value in `storage-encodings.json` packed into records, so the inputs include bytes a real MySQL wrote. Lengths, not offsets, and one byte under 128. DYNAMIC's off-page rule lives here, and the codec stays pure by being *given* a `storeExternal`: while the record is over budget, the longest inline field over 40 bytes moves out, and a record that still does not fit is ER_TOO_BIG_ROWSIZE. `externalRefs` lists what delete must free |
| M4.6 | Overflow pages: a large value is a pointer, no local prefix | engine | [23](./23-innodb-row-formats.md) | M4.5 | ☑ | a 1 MB value round-trips and its pages are freed on delete — through a reopen, with the reachable-set check passing before and after. A chain of overflow pages behind an 8-byte reference with no local prefix (D-20), allocated from the tree's own overflow segment. The walk is bounded by the reference's length, so a cycle is a typed error rather than a hang |

### Tier 3 — B+tree

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.7 | Dense page directory and binary search | engine | [22](./22-innodb-page-formats.md) | M4.5 | ☑ | lookup is pure binary search with no linear tail (D-19) — and the test counts the search key's reads to show it. A slotted page with a dense, sorted `u16` slot array and **no record chain and no infimum/supremum** (D-43). The leftmost child of an internal page has the empty key, which is M4.8's leftmost-record flag as data rather than a bit. A random insert/delete sequence agrees with a sorted map and stays well-formed after every step. `validateIndexPage` answers any bytes with a typed error |
| M4.8 | B+tree search, insert, split; node pointers and the leftmost-record flag | engine | [22](./22-innodb-page-formats.md) | M4.7 | ☑ | descending the left spine of a four-level tree reaches the correct leaf. **The root never moves**: a root split moves its cells into two new children, as `btr_root_raise_and_insert` does, so the directory is written when an index is created and never again. The model test runs four key regimes (random, ascending, descending and maximum-size) against a `Map`, with close-and-reopen as a command, and runs `verifyStore` after every operation. At 1 KiB pages the maximum-size regime reaches five levels |
| M4.9 | Delete, merge, page reorganise, free-list reuse | engine | [22](./22-innodb-page-formats.md) | M4.8 | ☑ | a randomised insert/delete workload leaves no unreachable page — `verifyStore` holds the allocation maps equal to the set of reachable pages after every operation of the model test, and emptying a 2,000-key tree collapses its root to a leaf and returns all but a handful of pages. Merge when the two pages fit in one, otherwise redistribute. **A redistribution whose new separator would not fit the parent is skipped**: an underfull page is legal, and a delete that could split its parent would be a second, rarer path for no real gain |
| M4.10 | The `PAGE_DIRECTION` split heuristic — 100/0 sequential, 50/50 random | engine | [22](./22-innodb-page-formats.md) | M4.8 | ☑ | sequential primary-key inserts fill pages ≥95%; random inserts do not — ascending and descending loads both pack above 95%, and a shuffled load sits below 85%. An insert past the end of a page that has seen an ascending run splits there, 100/0, and a descending run mirrors it. Anything else halves by bytes |
| M4.11 | Clustered and secondary indexes; secondary leaves carry the primary key | engine | [20](./20-storage-overview.md), [23](./23-innodb-row-formats.md) | M4.8 | ☑ | a non-covering secondary lookup costs exactly one extra descent, and the test proves it — the pool's fetch counter shows a row lookup costs the covering read plus exactly the clustered tree's height per row. The clustered tree stores PK sort key + record, because a PAD SPACE key is not reversible. A secondary entry is *secondary key ++ PK key* with an empty value (D-42), so a nullable `UNIQUE` index holds many NULLs, and `'a'` collides with `'a '` under `utf8mb4_bin`. **Every variable-length key part must declare its width**, since none is last once the PK follows, and the longest possible key is checked when the index is defined (ER_TOO_LONG_KEY), never at insert. A refused definition leaves no tree behind. This is the only module that imports `@myjs/types` |
| M4.12 | Extent-based bitmap allocator; separate leaf and internal segments | engine | [21](./21-innodb-file-layout.md) | M4.2 | ☑ | growth is extent-granular and freed extents are reused (D-19) — an extent emptied by frees goes back to the pool and the next segment that needs one gets it before the file grows. Map pages sit at computable places, one per group of extents. Each tree has a leaf, an internal and an overflow segment, and **a segment's first 32 pages come from shared fragment extents**, with the count kept on the tree's root as InnoDB keeps its `FSEG` headers. The extent holding a group's system pages is itself a fragment extent, so its other 61 pages are used. The in-memory view is rebuilt from the maps on open, and a test checks it matches and allocates the same next page |

### Tier 4 — WAL and recovery

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.13 | **Decision (not code):** the WAL record format, carrying logical before/after row images. Implements D-25; blocks M8.1 | engine | [18](./18-binlog.md), [26](./26-redo-and-recovery.md) | — | ☑ | the record specification is written down and reviewed **before** M4.14 begins — **written into doc 26 §Our log, and reviewed adversarially before the code, and the review broke it.** A group is a length, records and `END`. `PAGE` is a byte diff or an image (D-46), `META` carries the superblock's mutable fields in every group, and `ROW` carries whole logical images (D-48). The length is what tells a group cut short by the end of the log from one that is whole and wrong. The review attacked the draft with concrete event sequences and found four holes, each with a sequence that broke it. A page written out between checkpoints and changed again made the no-guard claim false (D-46). A fresh page could overwrite a live one whose free was not yet durable (D-47). Recovery could write data pages from log blocks that a process crash had left only in the OS cache, so it now flushes the log first. And a salt chosen at random made "never chains" probable rather than certain. Each is now a test, and each test was shown to fail without its fix |
| M4.14 | WAL block codec: 4 KiB, 20-byte header, CRC32C, monotonic LSN, first-record-group offset | engine | [26](./26-redo-and-recovery.md), [40](./40-vfs.md) | M4.13, M4.1 | ☑ | a mutated block fails verification and is treated as end-of-log; an LSN gap stops recovery there — **both, and a block from another salt or an earlier lap never chains** (D-45). Blocks are never rewritten: a flush seals its block and the next group starts a new one. The first-group offset is a cross-check, and re-sealing a block with a wrong offset is `ENGINE_CORRUPT_LOG`. A group the ring cannot hold is `ENGINE_LOG_FULL`, with nothing written. Two mutations prove the tests can fail: dropping the continuity check fails the gap and stale-lap tests, and rewriting a partial block in place fails the never-rewritten and stale-lap tests. The engine fuzzer gained two targets, mutated real logs (half of them re-sealed) and mutated groups. On its first million inputs it found a re-sealed superblock claiming a log of 2³² blocks, which `new Float64Array` turned into a `RangeError`. The log is now capped at 2²⁰ blocks (4 GiB) wherever its size is read |
| M4.15 | Mini-transaction grouping | engine | [26](./26-redo-and-recovery.md) | M4.14 | ☑ | a page split is never half-applied after a crash at any point inside it — **checked at every write of a split and of the checkpoint that writes it out, under both a process crash and power loss.** And never in memory either (D-47): an error part-way through a mini-transaction of 200 splits leaves every page byte-identical and the allocator as it was, and one that runs the pool out of frames aborts cleanly. The journal is the only writer of log records — the tree, allocator and overflow code gained `atomically` boundaries and nothing else. `LsnClock` is gone: the log owns the LSN |
| M4.16 | Full-page images after each checkpoint | engine | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | M4.15 | ☑ | a torn data page is reconstructed from the log alone, with no doublewrite file — **the test tears half of a leaf on disk and recovery rebuilds it from its image.** An image is a diff against zeros, so a sparse page costs what it holds. Disabling the image on clean→dirty fails five tests, including this one, the split test and the idempotence test |
| M4.17 | Two alternating superblocks and the fuzzy checkpointer | engine | [26](./26-redo-and-recovery.md), [41](./41-durability-and-concurrency.md) | M4.16 | ☑ | a crash at any point during a checkpoint still leaves one valid superblock — **at every write of two checkpoints, under power loss, recovery reaches the committed state.** The superblock is format 2, two slots written alternately by generation. Format 1 is refused with its reason (D-26), never migrated: it had no log. The log's tail moves only once the new slot is durable, which the review named as the rule that keeps the older slot's redo range intact |
| M4.18 | Recovery: forward scan, idempotent LSN-guarded apply, undo-based rollback | engine | [26](./26-redo-and-recovery.md) | M4.17 | ☑ | injected faults at every write offset recover to a consistent state — **both halves now.** Redo arrived with Tier 4, and undo-based rollback with Tier 5 (D-50). Recovery rolls back the transaction a crash left open through the path a live rollback takes: one mini-transaction per undo record, which also truncates the log at it. A rollback a crash interrupts therefore resumes where it stopped. Three tests cover it. A crash at every write of a multi-step transaction recovers to before it or after it. A crash at every write of a rollback finishes the rollback. And a crash at every write of *recovery's own* rollback recovers again, to the same place. Removing the truncation fails the second of these and the model test. Removing recovery's rollback fails the first and third, and the crash suite. The rollback test was weak at first: rolling back writes nothing until a checkpoint, so only one crash point in the whole window found a part-done rollback. It now rolls back two records at a time, durably, and the truncation mutation is caught |
| M4.19 | `flushLogAtTrxCommit` 0 / 1 / 2 | engine | [41](./41-durability-and-concurrency.md) | M4.17 | ☑ | at `1`, the crash suite loses no acknowledged commit; the guarantee text in doc 41 is true as written — **for its Node clause, at all three settings, under process and power-loss crashes** (D-49). Doc 41 now says what the suite does and does not check. The browser clause assumes that a best-effort `flush()` never reorders writes across itself, which is Q-14. A direct check, that no page on disk is ahead of the log that recovered it, catches removing the WAL rule. The suite needed a 16-frame pool before it could: at 32 frames only long-cold pages were ever evicted. The fault model was not the weak point; the workload was |

### Tier 5 — MVCC

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.20 | `DB_TRX_ID` / `DB_ROLL_PTR`, differential undo records, version-chain walk | engine | [25](./25-mvcc-and-undo.md) | M4.5, M4.15 | ☑ | doc 25's roll-pointer bit layout round-trips; an older version rebuilds correctly — **the 56 bits as doc 25 writes them, checked as one integer; ten transactions and ten views each read their own version back, through an update, a delete and a re-insert.** The clustered value carries `DB_TRX_ID` and `DB_ROLL_PTR` as a 14-byte prefix. A delete marks rather than removes. Every change leaves an undo record per index entry (D-50), holding the old value whole (D-52: the title's "differential" is deferred, with the reason). Undo logs are page chains in the transaction directory's overflow segment. Writing the test found its own bug first: it expected the ninth view, which the ninth transaction's delete hides, to see a row |
| M4.21 | Read views and `isVisible`; READ COMMITTED, REPEATABLE READ, and RR's "current read" rule; the `PAGE_MAX_TRX_ID` fast path | engine | [25](./25-mvcc-and-undo.md), [41](./41-durability-and-concurrency.md) | M4.20 | ☑ | doc 25's `isVisible` truth table holds for every combination; `SELECT … FOR UPDATE` sees the latest committed version under RR — **the truth table is checked against simulated histories rather than restated.** A version is visible exactly when its transaction is the creator, or committed before the view was made. The view is built from what was active at that moment, which is the formula's input, so a wrong formula disagrees with the history (ignoring the active set fails it). A model test interleaves one writer with several readers, savepoints, rollbacks and purge, and checks every read against snapshots, through the secondary index too. The `PAGE_MAX_TRX_ID` fast path is superseded by a per-entry trx id (D-51). Five mutations fail it, each at least one test: the active set ignored, secondary marks trusted under any view, purge ignoring views, a re-insert over a mark logged as an insert, and purge removing any mark |
| M4.22 | Purge, observable history length, maximum-transaction-age abort | engine | [25](./25-mvcc-and-undo.md), [41](./41-durability-and-concurrency.md) | M4.21 | ☑ | `db.stats()` reports history length; an over-age transaction is aborted rather than allowed to grow the store (resolves Q-09) — **`store.stats()` reports it, and core's `db.stats()` will read it at M5.13; `maxHistory` expires the views pinning the oldest commits, and their next read is 1213** (D-54). Purge removes a mark only if it is still the purged transaction's. A test builds T1 marking, T2 resurrecting and T3 re-marking, with a view between T2 and T3, and fails if purge removes any mark. Only undo records free chains, and freeing a removed row's refs as well fails three tests as a double free. With every view closed and everything purged, a store gives back every row, version, chain and undo page (exact page count) |

### Tier 6 — catalog and interface

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M4.23 | Catalog: `_myjs_*` system tables, a fixed-page bootstrap descriptor, a per-table JSON definition page, and an **explicit format version** (D-26) | engine | [27](./27-data-dictionary.md) | M4.21 | ☑ | opening a database written by an older catalog version either migrates it or refuses with a clear message — never silently misreads it. **Done, and each of its three paths is a test.** A catalog at version 1 opened by a build at 2 is migrated, in one transaction that also writes the new version. A crash at every write of that migration leaves it unmigrated, and the next open migrates it. A missing step, or a newer catalog, is `ENGINE_BAD_FORMAT` naming both versions. Two parts of the title were narrowed by building them: the bootstrap descriptor is code pinned by `FORMAT_VERSION` (D-56), and the definition is the `_myjs_tables` row, not a page (D-57). DDL is a transaction of its own. Its trees are dropped by undo, on rollback for CREATE and on purge for DROP (D-59). A crash at every write of CREATE TABLE and of DROP TABLE recovers to before or after it, with no orphan tree. A second design review broke the first draft in six places before any code. Lookups through a reader's view let a write land in a dropped table. The default collation's keys did not fit their widths (D-55). The clustered-index rule had to come from the source (D-60). The rest were AUTO_INCREMENT semantics (D-61), row atomicity across indexes, and names that would not fit at 1 KiB pages. Mutations confirm the tests: removing CREATE's drop-on-rollback, dropping at commit instead of purge, ignoring the version, the write re-check, the 1412 check, or the trim each fail one. The first of these survived the crash loop, because a small CREATE's log fits one block, so a test now leaves a CREATE open on purpose. The crash suite found the subtlest case. A name dropped and created again re-inserts over the dropped row's delete-mark, so the old definition is only in undo. `verifyStore` now takes a pending drop's layout from the undo record that will drop it |
| M4.24 | The `StorageEngine` / `Table` interface from doc 30, plus the `native` and `memory` implementations | engine | [30](./30-other-engines.md) | M4.11 | ☑ | the executor cannot tell the two apart. **Two instruments say so.** The first is `tableConformanceCases`, from `@myjs/engine/conformance`, which both engines pass. The second is a differential property test: random inserts, updates, deletes and range scans give the same result, or the same error and message, at every step, and every index the same contents. Each row operation is one write, so a duplicate in the third index leaves nothing in the first two. The memory engine orders by comparing values, never by encoded keys (D-58), so the differential test checks the key encoding rather than echoing it. Ordering memory by `memcmp` fails it. So does keying native with D-35's width, and so does dropping `DESC` in memory. The two may differ only in their declared capabilities, `transactional` and `consistentReads`. The test is scoped to autocommit and one session for that reason, and native's transactions are tested by name. Writing the conformance suite found a wrong expectation in it, not in either engine: trimmed, `'a  '` keys as `'a'`, so it sorts *before* `'a\t'` |
| M4.25 | `FaultInjectingVfs` and the 10,000-crash-point suite | test | [43 §5](./43-testing.md) | M4.18 | ☑ | the milestone exit criterion — **10,000 crash points over transactions: zero inconsistencies, and no acknowledged commit lost beyond what its setting allows.** Each step is now a transaction of several mini-transactions with inserts, updates (off-page values included) and deletes over a clustered and a secondary index. Some steps roll their last change back to a savepoint, some roll back whole, and a reader pins history across a hundred steps. Of the first 300 points, 118 recovered by rolling back an open transaction. Skipping that rollback, the WAL rule, or truncation as a rollback goes each fails the suite. The pool is back at 32 frames, because a write now holds the clustered path, the secondary path and the undo tail. It runs at 1 KiB pages, which is what makes splits and evictions frequent. **Since Tier 6 it runs through the catalog and the `Table` interface**, and a second table is created, filled and dropped every forty steps, so DDL is crashed at every write too, some DROPs waiting on the reader's view |
| M4.26 | Node VFS over `openSync`/`readSync`/`writeSync`/`fsyncSync`, and `MySQL.open()` finally resolving its `path` argument to a backend | vfs, core | [40](./40-vfs.md), [42](./42-public-api.md) | M0.10 | ☑ | it passes the same conformance suite as memory, and `MySQL.open('./data')` stops silently giving you a memory database. **Both hold.** All 18 conformance cases pass on a real disk. `MySQL.open(dir)` and `MySQL.open('file://…')` are two files on disk, and their rows survive `end()` and a reopen. A child process that commits and then exits without `end()` loses no committed row and keeps none of its open transaction: recovery replays the log. The backend is `@myjs/vfs/node`, reached only through the host adapter (D-27), so no browser bundle meets `node:fs`. A path holding `..` is refused, not normalised. A directory open in one instance is refused to another at once (`VFS_LOCKED`), not waited on. The lock is a file holding the owner's pid, plus a registry kept for the whole process. The first draft treated a lock file naming its own pid as stale, so two instances in one process both opened the same directory, and the test for exactly that caught it |

---

## M5 — Execute

**Exit criterion.** Drizzle's and Prisma's MySQL test suites pass end to end.

**Met (2026-10-09).** Three consecutive runs of each, served over TCP: Drizzle 487 of 487, and Prisma 1,122 of the 1,122 tests 8.4.11 passes, file for file. Prisma's one failure is a snapshot of another MySQL version's error text, which 8.4.11 fails too; `orm-census.test.ts` counts a failure shared with 8.4.11 as parity and fails on any file whose counts differ. CI's `orm-suites` job runs both on request. M5's remaining items (the planner, `db.stream()`, the function library's tail) are no longer what the criterion waits on.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M5.1 | Name resolution and type inference over the AST | core | [03](./03-architecture.md) | M3.3, M2.14 | ☑ | column references resolve through joins, subqueries and CTEs. **Begun by M5.17.** One table's scope is done: a bare name searches every table (1052 on two hits), `t.c` names a table by its alias, which hides its real name (1054), and `*` expands in column order. Every expression the executor compiles is typed, with the width, flags and charset 8.4.11 reports. Joins, subqueries and CTEs remain  **Planned (M5.18):** derived tables, `LATERAL`, CTEs (recursive ones too) and subqueries, where EXISTS and IN run as semijoins with weedout, as 8.4.11's plans show. A correlated reference compiles to a depth and a slot, so the row loop still never walks the tree (D-63). Set operations are M5.19's, not this item's **Joins done (M5.4):** names resolve through any number of tables, a USING or NATURAL column is one name, an ON sees only its own join's tables (1054 'on clause'), and an outer join's nullable side reports nullable. Subqueries, derived tables and CTEs remain **Done.** Subqueries (scalar, IN and NOT IN, EXISTS, ANY/SOME/ALL), correlated to any depth; derived tables, with column lists and LATERAL; CTEs, recursive ones included. The relational corpus agrees on every such statement. So does `mysql2-subquery.test.ts`, a 41-statement script captured from 8.4.11 with 1242, 1060, 3636, 1222, 1250 and 1093 among its answers. **A correlated reference is a slot one or more queries out (D-74).** The scope of an enclosing query resolves it to a depth, the compiled closure reads `env.outer[depth − 1]`, and the subquery runs again for each outer row. An uncorrelated one runs once per statement, through `env.memo`. Planning never evaluates a subquery, and 1242 is raised only on evaluation, so an empty outer table raises nothing. **The metadata rules came off the server as before.** A scalar subquery is its item as an expression, nullable unless it has no FROM. A mergeable derived table or CTE keeps its columns' metadata, keys included, under the new alias. One that groups, DISTINCTs, LIMITs or has no FROM is materialized. A recursive CTE is typed as a set operation's column, nullable. An aggregating correlated scalar subquery in the select list makes the outer table it reads nullable there. An IN or EXISTS is a semijoin, so the query is a join for streaming purposes, unless it is a nested loop over an index, which lets a sort go first. **The covering-index scan is also MySQL's, and it changes order.** With no condition choosing a path, a table is read through its smallest secondary index that holds every column the query reads. The semijoin strategy MySQL chooses by cost, LooseScan or FirstMatch, is M5.7's. All five captured LooseScan plans are modelled by M5.47: the corpus compares both protocols' metadata and row order without an UNMODELLED escape. Broader strategy choices remain open under M5.47. **Later, by the ORM slice: WITH on UPDATE and DELETE.** The CTEs are visible to the statement's subqueries and read once, before the first row changes, as a derived table is. So one that reads the table being written is no 1093, and a SET that adds its MAX adds the same MAX to every row; a subquery reading that table directly still is 1093. A CTE named as the target is 1288 (8.4.11). Drizzle's `with … update` and `with … delete` are that shape, and `mysql2-with-dml.test.ts` pins it |
| M5.2 | Coercion and comparison rules — MySQL's quirks, not SQL's ideals | types, core | [24](./24-column-encodings.md), [29](./29-charsets-and-collations.md) | M5.1 | ☑ | the committed differential coercion corpus matches pinned MySQL 8.4.11. **Begun by M5.17 (D-62).** The comparison type is chosen from both operands: `'10' < '9'` and `10 > '9'` are both true. Strings meet under an aggregated collation. DECIMAL is exact, and a quotient is held truncated to the next multiple of nine digits, so `2/3*1000000000` is `666666666.0000`. A value converts into a column under strict mode with MySQL's errors (1264, 1366, 1406, 1292, 1048) or, outside it, a warning. The execution corpus mixes types in every comparison it generates and agrees on all of them, and M3.2's corpus agrees through the executor, refusals included. **The coercion corpus (2026-10-09).** `npm run capture:coercion` sets columns of nearly every type and literals written every way MySQL reads one against each other: comparisons, arithmetic, BETWEEN, IN and the CASE family, 300 scripts through both protocols (`coercion-vectors.test.ts`). Its first replay disagreed on 256 of 2,246 statements, and the largest class was the type of a CASE, IF, IFNULL or COALESCE of mixed arguments. MySQL merges field types pairwise by a fixed table, which no rule here had reproduced: a CHAR beside a DECIMAL is a CHAR, a DATE beside a TIME a DATETIME (a TIME on today's date), a YEAR beside an INT an INT, JSON beside anything a LONGBLOB. `npm run capture:type-merge` asks 8.4.11 for every pair of 23 column types and NULL, checks that COALESCE, IF and CASE agree on all 576, and writes the table into `@myjs/types` (D-39); 205 disagree now, a ratchet the test holds. Then the rules the corpus named next, each asked of 8.4.11. NULLIF gives a temporal or a YEAR back as its text, and a string constant beside a BIGINT column is converted to an integer first, so that the comparison is exact. Unary minus on a temporal is a double with the temporal's fractional digits, so `-dt` of `…05.678` is `…05.680`, the nearest double. Negative zero prints `-0`, and a TIME's number keeps its fraction. The logical operators, IF's condition and a searched CASE read text's truth as a double, and warn for text that is not one. `CASE x WHEN …` and BETWEEN take one comparison type over all their operands, not pair by pair. A constant's 1292 is raised once a statement, though the optimizer evaluates it too, because both share the warning by the expression's node. 168 statements disagree and 102 warning counts differ. A third round: JSON is true to a logical operator unless it is a number that is zero, but IF and CASE WHEN read it as a number, so `[1]` is true to NOT and false to IF. JSON among other types is a LONGBLOB wherever it stands. A FLOAT branch in a string result keeps a float's digits. A BIT's bytes under a DECIMAL result are latin1 text, converted for the client. A constant negative integer negated is a DECIMAL, except the literal 2^63. DIV's width follows `Item_func_div_int::result_precision`. A text constant beside a date in NULLIF, in a one-item IN and as a hex or bit literal is read as a date, or is 1525. Since each fix brings statements into comparison that the case's first disagreement had hidden, the test now holds floors on agreement (2,650 statements, 1,119 warning counts) rather than ceilings on disagreement; 126 statements disagree. A fourth round: a DOUBLE literal is as wide as it was written (`1e1` is 3), which the parser now keeps and the deparser prints, as MySQL prints one; a JSON string read as a number is read from its characters; a binary result takes text in its own charset's bytes and a YEAR or FLOAT as its text; a BIT beside temporals that merge to a string makes the result binary; `-FALSE` is 2 wide and `-NULL` a DOUBLE. A binary CASE, IF, IFNULL or COALESCE sizes a DOUBLE literal by its text, where a text one and GREATEST and LEAST size it as 22 — the function corpus caught the first cut applying it to LEAST. 106 statements disagree. A fifth round, on comparisons: text compared with a date column is converted each row, and text that is no date is the zero date with 1292 'Incorrect datetime value', where a constant is converted once or is 1525; a text constant beside a YEAR column is the YEAR it would be stored as (`'10:11:12'` is 2010), unless it starts with no number; a YEAR column prints four digits, `0000` for zero, where YEAR()'s result prints 0; and a comparison does not read its right side when its left is NULL, so the right's conversion does not warn. That per-row conversion first made NULLIF return the converted zero date in place of its argument; NULLIF now converts only to compare. BETWEEN takes one comparison type over its three operands: with a number among them all are doubles, temporals by their number; with only dates and text, all are dates. In arithmetic a temporal has its number's digits, 8, 7 or 14, and its fractional digits as a scale, where it had counted none; that one rule settled 79 statements. A text constant beside a date that is no date is 1525 when the statement is prepared, so under a WHERE no row passes too; in BETWEEN it is never 1525, but the zero date with 1292 each row, as a column's text is. The merge table's integers are signed: an unsigned one beside a signed one is promoted a size (TINYINT with TINYINT UNSIGNED is SMALLINT, BIGINT with BIGINT UNSIGNED a DECIMAL), and a BIT beside only unsigned integers is a BIGINT, its value a number; YEAR takes no part. A CASE's ELSE now takes a double result's form as its WHENs did. A text constant beside a YEAR column that starts with no number stays text, to compare as a double with its 1292; a double past 14 digits is no datetime, so `1e300 >= dt` compares as numbers; NULL in arithmetic is a DOUBLE as wide as the other operand, with its decimals, and a scale resolved from the other operand when divided (M5.53 corrects the earlier blanket DOUBLE(4,4) rule); MOD's double keeps the dividend's sign flag. JSON in BETWEEN is compared as text with 1235. Then warnings, tallied by shape against the server's SHOW WARNINGS: a constant bound of BETWEEN warns each row, where `=`'s warns once; JSON read as a number is 3156 each row for an array, an object, `null` or a string that is not wholly a number; JSON in a logical operator is 3986 once. DIV reads its operands as DECIMALs, and a column's text with no digit read as one is 1366 before its 1292. A date comparison's conversion warns as 8.4.11 words it: plainly beside a column, "truncated" beside a literal, and once for a number constant that is no date. **Complete (2026-10-10):** all 3,148 captured statements agree on values and metadata through both protocols, with zero refusals; all 1,737 warning counts agree. The test now requires zero disagreements as well as its full-coverage floors. Whole-list and per-item temporal IN comparators, numeric/date/text JSON BETWEEN, TIME/text comparisons, mixed temporal bounds on the statement date, opaque JSON BIT identity, JSON rendering in CASE, and NULLIF converted constants (YEAR and packed temporal results included) match pinned 8.4.11. Resolution and evaluation diagnostics match the capture, including empty-result queries, cached constants, temporal CASE, NULL short-circuiting, date/time truncation notes, decimal-buffer saturation and underflow in DIV, and delimiter warnings. Additional reference probes hold exact adjacent BIGINT/DECIMAL comparisons, YEAR text boundaries and constant-versus-row delimiter timing. Constant IN lists retain their sorted search path without evaluating the same list twice. This completes the captured differential gate; it does not claim every possible MySQL expression is covered |
| M5.3 | Volcano operators: table scan, index scan, filter, project, limit | core | [03](./03-architecture.md) | M4.24 | ☑ | each operator is independently testable over a fixed row source. **Each is a generator over any iterable, and `sql-operators.test.ts` drives filter, sort, project, DISTINCT and LIMIT over arrays.** Filter keeps TRUE, never FALSE or NULL. Sort orders by collation, NULL first ascending. Default ties are stable; verified bounded integer filesort preserves native queue slots and preselection order (M5.49). DISTINCT treats `'x'` and `'X'` as one value under the default collation. LIMIT over an endless source returns, because it stops pulling. Only `scan` touches a `Table` |
| M5.4 | Nested-loop and hash joins | core | — | M5.3 | ☑ | a three-table join returns MySQL's row order for the same plan  **Planned (M5.18):** "the same plan" is made checkable. M5.18 captures 8.4.11's `EXPLAIN FORMAT=TREE` and compares order wherever our tree matches it. The iterators are MySQL's. A hash join builds on the earlier table, probes with the later one, emits a probe row's matches newest first, and hashes keys in the comparison type, converted once per row per side, which is also what makes warning counts agree. A nested loop does an index lookup where D-65 allows one. A non-equi join is a hash join with no condition plus a filter. Join order is FROM order or a hint until M5.7 **Done.** Inner, LEFT, RIGHT, CROSS, comma and STRAIGHT joins, nested and parenthesised, with USING and NATURAL, through `mysql2`. A 34-statement script whose answers 8.4.11 gave first (`mysql2-join.test.ts`) agrees on every statement, row order included, though not one of its unordered queries has an ORDER BY. The relational corpus and `queries.json`'s 700 joins agree on every statement the executor runs. **The iterators are MySQL's (D-75).** A hash join builds on the earlier tables and probes with the later one, each probe row's matches newest first. A LEFT JOIN probes with its outer side, and a RIGHT JOIN is one with the sides swapped. A unique key that the condition pins makes a single-row lookup. The condition is evaluated in full on every pair, so a hash key could only ever be an acceleration. Join order is the statement's, as STRAIGHT_JOIN fixes it; the optimizer's own order is M5.7's. **The metadata was the larger half**, as it was for grouping. Sorting a join's rows, or DISTINCT over them, first streams them into a temporary table. That materializes every item but a constant: a column loses its key flags, with no GROUP_FLAG; an expression keeps only NOT_NULL; a boolean becomes an INT, and anything ten characters or wider a BIGINT. The exceptions all come from MySQL's optimizer, which runs before it decides to make that table, so `optimize.ts` reproduces the parts that matter. Outer-join simplification. Equality classes, and constants propagated through them, three-valued across OR. A range analysis that proves an indexed column's ranges empty. Const tables: a unique key pinned to a constant is read while planning, its columns are constants, and an empty one proves the result empty, except under STRAIGHT_JOIN, which does not read ahead. Then a sort that a nested-loop spine lets go to the first table before the joins. Each rule was a plan of the corpus's. ON joins functional dependence: an inner join's as the WHERE, an outer join's only from its preserved side. `ANALYZE TABLE` now answers as 8.4.11 does, so a script can pin the server's statistics |
| M5.5 | Sort (spilling when large), aggregate, `GROUP BY`/`HAVING`, `DISTINCT` | core | [29](./29-charsets-and-collations.md) | M5.3 | ☑ | sorting respects collation, not code-point order. **What M5.8's corpora left here about `SELECT DISTINCT`, all probed on 8.4.11.** Whether MySQL makes its temporary table is decided by its optimizer. It does not make one for a zero limit, an impossible WHERE, a const table, or columns the WHERE pins to one value (E-17). Four shapes need the range optimizer to see that the WHERE is empty, and they still differ in metadata: `b = 'x' AND b <= 'ann'`, two disjoint `IN` lists, an empty `BETWEEN`, and `NOT (n >= 9 OR n <> 6)` on a key. Through the table an *expression* changes more than its flags: `DISTINCT a + 1` gains GROUP_FLAG when nullable, a string loses its 31 decimals, and `a = 5` becomes a 3, not an 8. An unordered DISTINCT through an index puts NULL first  **Planned (M5.18):** grouping and aggregates over one table come first, because they build the temporary-table operator that DISTINCT, derived tables, CTEs and UNION all reuse. That operator is an insertion-ordered sort-key map, which reproduces first-appearance order and replaces `distinct()`'s O(n²) list. Spilling moves to M5.23. Aggregate types were read off 8.4.11: COUNT is BIGINT 21 with NOT_NULL and BINARY, SUM(INT) is DECIMAL length 33, AVG(INT) is DECIMAL(16,4), AVG(1.5) has scale 5, STD is DOUBLE 23 with 31 decimals, GROUP_CONCAT is type 251 with length 65536, and MIN/MAX keep their argument's type. Through a derived table COUNT loses BINARY **Done: GROUP BY, HAVING, WITH ROLLUP, `GROUPING()` and fifteen aggregates over one table, through `mysql2`, with MySQL's grouping strategy and the metadata each strategy leaves.** Every relational-corpus statement the executor runs agrees with 8.4.11, and so does every statement of `mysql2-group.test.ts`, a 27-statement script whose answers came from the server first. A group is a value under its collation: `'ann'` and `'ÄNN'` are one group, as are `'Bob'` and `'bob'`. The keying is shared with DISTINCT (`keys.ts`): a collation sort key, an exact decimal without trailing zeros, a temporal's normalised text. **The strategy is MySQL's, and the strategy is what a client sees.** Keys that are an index's leading columns stream in index order. ROLLUP, a DISTINCT aggregate or any GROUP_CONCAT sorts first. Anything else goes through an aggregating temporary table, in first-appearance order. Each leaves different metadata, and the rules were read off EXPLAIN and metadata probes before they were written. Through the temporary table a column loses its key flags, and keeps NO_DEFAULT_VALUE (E-19), and keeps GROUP_FLAG only if it is a nullable key at its first mention. COUNT, SUM, MIN and MAX become fields of the table: COUNT is 0x01 there, not 0x81. AVG, the variance family and BIT_* keep their own metadata, because the table holds their intermediates. A grouped query sorted for an ORDER BY that is not its keys' ascending order is first streamed into a temporary table, which materializes everything, AVG included. There, GROUP_CONCAT becomes a BLOB (252, 0x10) whose length is its own over the argument charset's width, a ROLLUP INT key becomes a BIGINT, and `MIN(pk)` carries the column's NO_DEFAULT_VALUE. Anything computed over an aggregate (`COUNT(*) + 2`) keeps its own metadata. Without a GROUP BY a column becomes nullable. **ONLY_FULL_GROUP_BY** is a closure over keys, PRIMARY and NOT NULL UNIQUE keys, and WHERE equalities with constants and columns. 1055 names the first undetermined column, as `db.table.column`, and 1140 is the no-GROUP-BY form. GROUP BY resolves a name to a table column before a select alias, HAVING to an alias and then to the columns of the select list or the keys (1054 otherwise), and ORDER BY to an alias first. Spilling is M5.23's. The four `SELECT DISTINCT` shapes that need the range optimizer move to M5.7, which owns it. **Later (2026-10-09):** HAVING without grouping, refused as 1235 until then, filters the rows WHERE kept, and both forms resolve alike: select-list aliases first, selected columns, and what an alias's expression reads, with 1052 for two items of one alias and 3594 for an alias of a window function. Probing it found two bugs. An aggregate in HAVING over a column that is not selected (`HAVING MAX(a) > 1`) was 1054. That was not the aggregate: the previous commit had made the overflow label print eagerly through HAVING's narrowed scope, and Drizzle's suite showed it as 3 failures before any script did. The label is now printed only when there is an overflow to report |
| M5.6 | Window functions | core | — | M5.5 | ☑ | frame semantics match a real server on the ORM corpora. **Begun by the ORM slice: `ROW_NUMBER`, `RANK` and `DENSE_RANK` over a PARTITION BY and an ORDER BY** (`window.ts`). Drizzle's relational API asked for them, and not for the number. It writes `ROW_NUMBER() OVER (ORDER BY …)` inside its LATERAL derived table for the order: a window's rows leave sorted as the window sorts them, and the `JSON_ARRAYAGG` above collects them in that order. **What 8.4.11 taught.** Windows run after WHERE and before ORDER BY, DISTINCT and LIMIT. Each one sorts by its partition, NULL first, then by its order, and a later ORDER BY sorts that output. Tied LIMIT winners depend on the selected filesort path (M5.49). The result is a BIGINT, NOT NULL and UNSIGNED, without BINARY, because it is a field of the window's temporary table. The other columns are read through that table too, so they lose their key flags. A window in WHERE, HAVING or an ON is 3593. A derived table with a window is not merged. Frames, named windows, the other window functions, and windows over a grouped query are refused by name. `mysql2-window.test.ts` pins the rows against a script 8.4.11 answered. **Then the rest (2026-10-09)**, against a 35-statement script from 8.4.11 that pins values and result metadata (`mysql2-window-functions.test.ts`), identical through the binary protocol. That covers PERCENT_RANK, CUME_DIST, NTILE, LAG and LEAD, FIRST_VALUE, LAST_VALUE and NTH_VALUE, and the aggregates over ROWS and RANGE frames, named windows and windows extending them, and a window function in ORDER BY. **What 8.4.11 taught.** Without a frame, a window with an ORDER BY runs from the partition's start to the current row's *last peer*; without an ORDER BY it is the whole partition. A planted ROWS-for-RANGE mutation fails on peers. RANGE is by value on the one key: NULL keys are their own frame, and over a DESC key PRECEDING means larger. A planted mutation ignoring DESC fails. LAG and LEAD take their argument's type aggregated with the default's, so `LAG(v, 1, 'x')` is VARCHAR(11) and a DECIMAL's default 0 is `0.00`. An integer becomes a BIGINT of its own width, and none of the column's flags carry over. MIN and MAX of an integer are BIGINT too. NTILE gives the first n % k buckets one extra row; a planted mutation dropping that fails. DISTINCT over a window's table adds no GROUP flag. **How.** A frame that starts at the partition and only grows is evaluated with one running aggregate state. Any other frame is evaluated afresh for each row, and a RANGE bound scans its partition: O(n²), adequate until a corpus says otherwise. JSON_ARRAYAGG's result is now a copy, because a running window reads it again after adding rows. **Then windows over a grouped query** (seven more statements in the script). They run after HAVING, over the grouped rows, compiled in the post-group context so an argument or a key may be the groups' own aggregate (`SUM(SUM(v)) OVER (ORDER BY g)`, `RANK() OVER (ORDER BY SUM(v) DESC)`). Their slots follow the aggregates', which are known only after compiling, so a sink's base is now set late. In the metadata, the window's table replaces the groups' (no GROUP flag, no BINARY), except for one row of an aggregate without GROUP BY, which the server reads through no window table. **Named, not yet done:** LAG and LEAD with a negative offset, a 1064 in the server's grammar that is 1210 here; and the key MySQL gives a derived table for `WHERE rn = 1`, which shows as a PART_KEY flag **Closed (2026-10-09).** A RANGE frame over a date or time key is bounded by an INTERVAL, the key moved as DATE_ADD moves it; LAG's and LEAD's distance is a number as written or a `?`, so `LAG(v, -1)` is 1064 at the `-` as 8.4.11's grammar says. Both are pinned in `mysql2-window-functions.test.ts`. The key flag a derived table's `rn` has under `WHERE rn = 1` comes from the plan, an `<auto_key0>` lookup by a constant on a materialized derived table, and moves to M5.49 with it |
| M5.7 | Planner: index selection, predicate pushdown, join ordering for small joins | core | — | M5.4 | ☑ | `EXPLAIN` names the index a MySQL DBA would expect on the test schemas. **What M5.18's review left here, from three corpus seeds that were not committed (about 17,000 statements).** Every row and every error agrees. Forty-five statements report other column metadata than 8.4.11, and each traces to a plan choice this executor does not make yet. 8.4.11 reorders an inner join by cost (`lt JOIN kl ON lt.n = kl.g` ran as `kl, lt`). It sorts the first table ahead of a single-row lookup, even for an ORDER BY over the looked-up table's columns, because they depend on its key, and so it streams nothing. It scans a semijoin's outer table through a covering index that already gives the ORDER BY. It treats a table whose ON proves a missing key as a constant row. And it groups a GROUP BY whose every key is NULL-complemented as a streaming aggregate. **The corpus cannot see join order.** It compares rows without an ORDER BY as a multiset, and orders "0 by plan". So when the review planted "build on the later table" and "matches oldest first", only `mysql2-join.test.ts`'s 34 statements caught them. This item is what moves "plans agreeing" off zero, and with it the order of every unordered join the corpus holds **Begun (2026-10-09), with EXPLAIN as the measure (M5.44): plans agreeing 1,712 → 1,825.**<br>- An enclosing query's column is a constant for each run of a correlated subquery, so `WHERE ch.pa_id = pa.id` inside it reads the index on `pa_id` ("Index lookup"). Before the outer row exists, exactness is decided by the column's type (`exactType`), and only where the value check could never say otherwise. So EXPLAIN and the run read the same index.<br>- `<=>` is a key read: `= v` for a value, IS NULL for NULL.<br>- `COUNT(*)` reads no column, so a secondary index covers it. Its `*` had been taken for a select-list `*`, and the covering scan 8.4.11 takes was missed.<br>- An ORDER BY over a prefix of the index a table is read whole by sorts nothing: the clustered index, or a covering secondary index with the clustered key behind it.<br>- `[NOT] EXISTS` over one indexed equality is a nested-loop semijoin or antijoin, which is what probing the subquery per outer row already was.<br>- The grouped single-table path asked `chooseAccess` itself and skipped the covering index. It now reads through the FROM's one decision, as EXPLAIN does.<br><br>**Still open:** join order by cost, single-row lookups through USING and NATURAL, the other semijoin strategies (LooseScan, materialization, duplicate weedout), constant tables read ahead, and `<auto_key0>` lookups into a materialized derived table. Each needs the statistics of M5.45 first<br><br>**A lookup or a hash join, by cost (2026-10-09, D-84): 1,839 → 1,858.** An index on the later table no longer means a lookup. The choice is 8.4.11's `best_access_path`, reimplemented in `cost.ts` and checked against the server's optimizer trace. The join is planned table by table, each table's position recording the rows it fetches per earlier row, the fraction its conditions keep, and the tables its key is read from.<br>- A unique key is read once per distinct row of the tables its key comes from (`prev_record_reads`). Any other key is read once per prefix row: a page per row found, capped at `worst_seeks`, or the index's own pages when it covers.<br>- A scan through the join buffer is read once per buffer-full, its own conditions' discards evaluated each time.<br>- A lookup wins outright when it finds fewer rows than the table holds at no more than a scan's cost, or when some index covers the table's columns; otherwise only a strictly cheaper scan beats it.<br>- Filters are `get_filtering_effect`'s defaults without histograms: an equality by the rows per key of the first index the column leads, else a tenth, each at least a row's worth; the WHERE and inner joins' ONs filter, an outer join's ON does not.<br><br>`c LEFT JOIN b ON b.x = c.y` over 4 rows and 3 values hashes, because the scan costs 1.85 against the lookup's 1.8667. In `c JOIN b … JOIN a ON a.id = b.id` the unique lookup into `a` costs 0.8667, since only `b`'s 1.33 rows supply its key. The first version costed it against all 5.33 prefix rows and hashed; `mysql2-join.test.ts`'s row order caught it. **Still open, each its own class in `npm run plans`:** join order (`pa NATURAL JOIN kl` runs `kl` first), range access feeding the costs (`quick_rows`), a covering scan of PRIMARY, a lookup across collations (latin1 into utf8mb4), `<auto_key0>`, constant tables, and the semijoin strategies<br><br>**Join order by cost (2026-10-09): 1,858 → 1,909, and 297 queries' rows checked in plan order, up from 269.** An inner join of base tables is reordered as `greedy_search` orders it (`joinOrder` in `cost.ts`). The tables are first sorted: after those they depend on, after those their keys read from, fewer rows first, then as written. Every order is then searched, each prefix extended table by table and dropped once it costs as much as the best whole plan. `prune_level=1`'s heuristics are kept, because they decide which of two equal plans is found first. An extension no cheaper and no smaller than an earlier one at its depth is not explored, and a unique-key table draws the others like it after it without permuting them. The tree is rebuilt left-deep in that order; the ONs become conditions placed like the WHERE's. SELECT STRAIGHT_JOIN, an outer join, a derived or a LATERAL table keep the written order for now. **What a corpus statement taught: range estimates order the joins.** `lt JOIN pa ON lt.n = pa.id WHERE pa.id <= 0.5 OR pa.name IS NULL` ran `lt` first on 8.4.11, so its result was streamed. The OR's second half is false for a NOT NULL column, and the first holds for `lt.n` through the equality, so the range optimizer estimated `lt` at one row. `found_records` now counts what each index's range would read: the conditions on a column an index leads, propagated through column equalities, counted exactly as the server's index dives count a small table, never below one. Each counted column's share is its filter (`quick_rows`). Inverting the pre-sort's "fewer rows first" costs 2 plans, which the ratchet catches; a later plan replacing an equal one changes nothing, since a prefix that costs as much as the best is already pruned. **Still open:** outer joins in the search (an inner table after its preserved side), a range's own read cost, `<auto_key0>`, constant tables, semijoin strategies, a lookup across collations, and IN→EXISTS<br><br>**Constant tables and covering scans of PRIMARY (2026-10-09): 1,909 → 1,984, and 331 queries' rows checked in plan order.**<br>- A table read whole whose read columns are all its clustered key's is a covering index scan of PRIMARY (`find_shortest_key`), when no secondary index covers them (+42).<br>- `IS NOT NULL` of a NOT NULL column that no outer join can null is dropped, as the server drops it (+7).<br>- A single-table query whose WHERE pins a unique key is a constant table, read while planning: "Rows fetched before execution" if the WHERE holds of its row, else "Zero rows". So is a key equal to an uncorrelated scalar subquery, which the server evaluates while planning (+14).<br>- A derived table with no FROM is a constant row, and a FROM of nothing else reads it while planning (+9).<br>- The range proof gave a NOT NULL column's `IS NULL` and `<=> NULL` the NULL interval, which such a column cannot hold; they are empty now, so `id IS NULL OR id <> NULL` is "Zero rows" (+3).<br>**Still open, by size:** the range optimizer (about 75 plans: `<>` and NOT IN as two ranges, IS NOT NULL, LIKE prefixes, a constant rounded outward, string bounds, and the cost of a range against a scan); IN→EXISTS ("Alternative plans for IN subquery"); `<auto_key0>`; semijoin strategies and the hash antijoin; constant tables in a join (left out of its tree); outer joins in the search<br><br>**What the server does around a plan (2026-10-09): 1,984 → 2,001.**<br>- A plan that does not start with the one table an ORDER BY or GROUP BY reads pays a sort of its rows (`sort_by_table`), so `pa CROSS JOIN ch … ORDER BY pa.grp` runs `pa` first though its join costs more. Once that table is placed first by a scan under a LIMIT that keeps its rows (always, without a LIMIT), every plan pays the sort; the server's state is kept as it is, since it decides plans.<br>- An inner join's lookup keyed by a nullable column of an earlier table puts `col IS NOT NULL` on that table (`add_not_null_conds`). A NULL finds no row, so the rows are the same and only the plan shows it (+8).<br>- What is true of every row is folded away, as the server folds it: `IS NOT NULL` of COUNT or a BIT_ aggregate in HAVING, an integer column's `<>` with a number it never equals, and an OR with either (+7).<br>The bundle grew about 2% with the cost model, the join search and the range estimate; `size-budget.json` is updated for it<br><br>**The range optimizer (2026-10-09): 2,001 → 2,029, and 346 queries' rows checked in plan order.** `plan.ts`'s header had left a range on a secondary index "to a full scan until the cost model of M5.7 can say what MySQL would pick". It can now.<br>- **Intervals.** They are `optimize.ts`'s range proof, moved to `ranges.ts` and shared: AND and OR, comparisons, BETWEEN, IN, NOT IN, `<>` and IS [NOT] NULL, normalised and merged.<br>- **Key bounds.** Each converts where `exact` allows. An integer column's bound is rounded outward (`< 5.5` reads to 5), which is what the server does and is never too narrow.<br>- **Choice.** Each index's range has its rows counted as the server's index dives count a small table (at least one a range, a unique key's point one). It is costed as `multi_range_read_info_const` costs it. It must beat `test_quick_select`'s baseline: a table scan plus 2.1, or a full scan of the shortest covering index. A lone range that wins even reading every row is not counted (bench range scan: 206 → 181 ms).<br>- **EXPLAIN.** A range prints its intervals after `over`, as the server does (`over (1 < id)`). Conditions on a secondary index's own columns are shown on the read, not as a Filter, because InnoDB pushes them into the index (index condition pushdown); the clustered key gets no such push, which is why `lt.n IN (NULL, 4)` keeps its Filter.<br>- **NOT IN with a NULL.** It is true of nothing, but the server's range analysis does not prove that. Sharing the intervals made `optimize.ts` prove it, and four statements' metadata changed, so it proves nothing again.<br>- **Planted fault.** An upper bound rounded one too far inward fails 3 corpus statements<br><br>**Range checked for each record (2026-10-09): 2,029 → 2,044.** `a JOIN b ON a.x < b.id` is a nested loop whose range on `b` is planned again for each row of `a` ("Index range scan on b (re-planned for each iteration)"), not a hash join with a filter. The server rechecks every later table it reads whole (`make_join_query_block`). Where a condition compares an indexed column with the tables before it and the table has no range of its own on constants, the range is dynamic, and join buffering is off for it. **The trace taught one rule the source hid.** `b.x = c.y` is rechecked as well, with the same `depends_on_unread_values`, yet it stays a hash join: a key an equality could look up by was already weighed as a lookup (`checked_keys`). So only `<`, `<=`, `>`, `>=` and BETWEEN make one. The per-row plan is the range optimizer's own (`dynamicAccess`), with the earlier tables' columns as its constants<br><br>**Outer joins the WHERE makes inner, and covering eq_ref (2026-10-09): 2,044 → 2,065.**<br>- An outer join whose nullable side the WHERE rejects NULL on is planned as the inner join it is (`simplify_joins`), to the same fixed point `optimize.ts` reaches for the metadata. It can then be reordered, and its tables read by ranges (+11). The scope keeps the nullability its columns report, since that is what 8.4.11's metadata shows.<br>- A unique lookup whose index holds every column the query reads is "Single-row covering index lookup", PRIMARY included when only its columns are read. One helper, `holdsRead`, now answers that question for the cost model, the range optimizer and EXPLAIN alike (+10)<br><br>**`<auto_key0>` (2026-10-09): 2,065 → 2,080.** A materialized derived table or CTE joined by an equality is looked up by the index the server builds on its join columns ("Index lookup on d using `<auto_key0>`", the Materialize beneath it). Its rows are materialized once and kept by key in the order they were made, which is the index's order within a key, and each earlier row looks up its key's. The key is the hash join's (`hashKeys`), so it is used only where equal values always key alike, and every condition is still checked of every pair<br><br>**DISTINCT's last table (2026-10-09): 2,080 → 2,082.** Under SELECT DISTINCT, the last table in join order, when joined by a lookup and not read by the select list, needs one match for each row before it (`not_used_in_distinct`, "Limit: 1 row(s)" above its read). The lookup now stops at the first match, as the server's does<br><br>**Done (2026-10-09): 2,082 of 2,248 plans agree, from 1,712 when the item began; the rest are named as M5.47–M5.49.** **Three fresh seeds** (7101, 7202, 7303; 900 cases, 16,616 statements, captured from 8.4.11 and not committed) agree on every row and every error. Plans agree on 5,988 of 6,584 (91%, against 93% on the corpus the work was measured on). 31 statements report other metadata or order than the server, against the 45 this note began with, and each traces to a strategy now an item of its own:<br>- 12 to the shape of a plan: a sort of the first table ahead of its joins under STRAIGHT_JOIN … ORDER BY … LIMIT, and an outer join whose ON is proved impossible, leaving NULL-complemented rows (M5.48, M5.49).<br>- 4 to a "Zero rows" proof over two columns or through a semijoin (M5.48).<br>- 3 to NOT EXISTS as a nested-loop antijoin, whose key flags differ (M5.47).<br>- 4 to the nullability of an EXCEPT over a nested INTERSECT, whose plan already agrees (M5.48).<br>- The rest to the grouped path's choice of index, range or temporary table (M5.49).<br>**Two of the first seed's divergences were bugs, fixed here.** EXCEPT ALL and INTERSECT ALL now send a row's copies together, in the order rows first came, because their temporary table counts each row once (`2,1,NULL,2,3,1,2 EXCEPT ALL 2,5,1` is 2, 2, 1, NULL, 3). `<=>` no longer makes a column functionally dependent, with a constant or a column, so `WHERE id <=> 0 GROUP BY g` selecting `n` is 1055, as on 8.4.11. `UNMODELLED` in the replay names the two strategies left to M5.47 and M5.48 |
| M5.8 | DML execution: `ON DUPLICATE KEY UPDATE`, `REPLACE`, `AUTO_INCREMENT` | core, engine | [00](./00-goals-and-scope.md) | M5.3 | ☑ | `affectedRows` is 2 for an updated upsert, as MySQL reports it; `insertId` matches. **Begun by M5.17.** AUTO_INCREMENT and `insertId` match a real 8.4.11 across the corpus. The first generated value wins; failing that, the OK packet reports the last explicit one, which `LAST_INSERT_ID()` does not take. A value is taken only after every field converts, so a row refused as out of range costs no id and one refused as a duplicate costs one. That ordering was not known until the corpus disagreed by one. UPDATE counts changed rows, or matched rows under `CLIENT_FOUND_ROWS`, which `mysql2` asks for. `ON DUPLICATE KEY UPDATE`, `REPLACE` and `INSERT IGNORE` remain, and are refused by name. **Done: all three run, and the execution corpus, now drawing them a quarter of the time, agrees with 8.4.11 on 3,629 of 3,629 statements, 250 of them upserts, REPLACEs and IGNOREs.** Three more corpora from other seeds, 46,346 statements, agree except four `SELECT DISTINCT` metadata cases that belong to the planner (see M5.5). `insert()` is now MySQL's `write_record`, a row at a time, with its four counters, and every rule was read off the server through `mysql2` before it was written: `affectedRows` is rows inserted, plus rows REPLACE deleted, plus rows an upsert updated — or, under FOUND_ROWS, every row an upsert met — so a changed upsert is 2 and an unchanged one 1. `insertId` is the first generated value written, else `LAST_INSERT_ID(x)`'s x, else the last row's AUTO_INCREMENT value, which is why an upsert of row 7 reports 7. REPLACE deletes the row in its way and tries again, unless the key it hit is the table's last UNIQUE key, when it updates in place, so replacing a row with itself is 1, not 2. Which key is hit first is MySQL's `sort_keys` order, not the order declared, and the engine gained `Table.duplicateOf` to find the row a 1062 means (D-71). A row alias exposes only the inserted columns, a bare name under it is 1052, and each `VALUES()` call costs a 1287 warning. **AUTO_INCREMENT was the deep part, and the old executor had it wrong for multi-row statements.** InnoDB reserves a block of one id per row at the statement's first generated value and counts it down as rows are written, so a three-row INSERT that fails on its second row costs three ids, not one. A duplicate under IGNORE or an upsert gives its value back to the next row. An explicit value carries the handler past it, a value that stores as 0 (`'0'`, `0.4`, `'abc'` under IGNORE) is generated, and a generated value past the column's range is clamped silently and collides as 1062, never 1264. Each rule came from `handler::update_auto_increment` and InnoDB's `get_auto_increment`, read in `reference/`, and was then confirmed against the server. **The new corpus found six bugs in code M5.17 had shipped, and one in a test.** A DOUBLE given `'abc'` is 1265, not 1366. An integer given `'12abc'` is 1265 as well, and `types-sql.test.ts` had asserted 1366 for exactly that value. `c = DEFAULT` on a column with no default is 1364 under a strict mode. An AUTO_INCREMENT column's DEFAULT is 0. A non-strict UPDATE stores NULL into NOT NULL as the type's zero. `unsigned / unsigned` is an unsigned DECIMAL, one digit narrower. `LAST_INSERT_ID()` is 21 wide, not 20, and `LAST_INSERT_ID(expr)` now runs; an INSERT or UPDATE that evaluates it reports the value. A sixth was E-17, in `SELECT DISTINCT`'s metadata. Planted mutations, each run against the corpus and `mysql2-upsert.test.ts`: an unchanged upsert counted 1, REPLACE's in-place update not counted, IGNORE's duplicates counted as REPLACE's, and ids reserved one at a time all fail. The corpus alone cannot see the first, because `mysql2` always asks for FOUND_ROWS; the test file can. One mutation survived both, giving an upsert's id back from the handler rather than the row. Under one writer the two are the same value, which makes it an equivalent mutant rather than a gap. `UPDATE IGNORE` and `INSERT … SELECT` stay refused by name **The code review of M3.17 and M5.8 raised ten findings. Each was put to 8.4.11 first, and each confirmed one became a failing test in `mysql2-upsert.test.ts` before its fix.** Seven held. `LAST_INSERT_ID(1e30)` saturates at 2^63 − 1 and `-1e30` is 1690, where this wrapped to 64 bits. Two placeholders in `a = ? OR a = ?` are two values even when bound alike. `u <=> NULL` on a nullable UNIQUE key is no constant table. `AS n(a, A)` is 1060. A pin shared by OR branches holds through AND inside them. Two code-quality findings were fixed as well: a conflict looked up twice, and an integer-range table kept in three places, now `integerRange` in `@myjs/types`. Probing the prepared-statement finding turned up two older bugs. COM_STMT_PREPARE's metadata never shows the temporary table, because MySQL reports a statement before it optimizes it, and this had shown it since M5.17. Planning also evaluated calls, so a prepare of `… WHERE LAST_INSERT_ID(7) = 7`, or a WHERE made impossible by `1 = 0`, changed `LAST_INSERT_ID()`. Folding now never evaluates a call, a variable or a placeholder that is not yet bound, and an impossible WHERE reads no rows. The probes also overturned two rules of my own: `c = NULL` is not folded to false, and NULL pins nothing. One finding did not reproduce: 8.4.11 accepts a schema-qualified row alias, `db.n.v`, as this does. One was declined. Storing a table's keys in MySQL's `sort_keys` order at CREATE TABLE would let the engine name the right key itself. But catalogs already written would still need the executor's ordering, and the engine's error would still have to carry the row, so D-71 stays in one place. The order SHOW CREATE TABLE writes keys in is M5.9's to settle. **Later, by the ORM slice: a VALUES or SET expression reads the row being written.** The row starts as its defaults. A NOT NULL column with none holds its type's zero and an AUTO_INCREMENT one 0, and each value replaces one in the list's order, so `VALUES (UPPER(a), 'y')` reads '' and `VALUES ('x', UPPER(a))` reads 'x' (8.4.11). Drizzle's `$onUpdateFn` writes the second shape, and `mysql2-insert-row.test.ts` pins it. The value read is the one written, not yet converted to the column's type, a divergence nothing has shown |
| M5.9 | DDL execution; `SHOW CREATE TABLE` | core | [27](./27-data-dictionary.md) | M4.23 | ☑ | `SHOW CREATE TABLE` output matches a real server's bytes. **Begun by M5.17.** `CREATE`/`DROP DATABASE` and `CREATE`/`DROP TABLE` run, as do `SHOW DATABASES` and `SHOW TABLES`. A collation resolves from the column, then the table, then the schema, then `utf8mb4_0900_ai_ci`, and `BINARY` means that charset's `_bin`. Unnamed indexes are named as 8.4.11 names them (`a`, `a_2`). The length limits are refused with the server's numbers (1439, 1074, 1426). CHECK constraints, generated columns, JSON and `CREATE TABLE … SELECT` are refused rather than accepted half-done. `SHOW CREATE TABLE` and ALTER remain. **TRUNCATE (the ORM slice, 26 of Drizzle's failures):** it commits the open transaction first, as 8.4.11 does, so a ROLLBACK after it undoes nothing. `Catalog.truncateTable` then drops the table and creates it again from the same definition in one DDL transaction. New trees mean AUTO_INCREMENT starts again from 1, which is what the server does. **Views (the ORM slice, 11 of Drizzle's failures).** A view is a `_myjs_tables` row with id 0, which no table has, and a `ViewDef` for its definition. Tables and views share one key, so they share the namespace MySQL gives them: 1050 either way, and 1347 for OR REPLACE or DROP VIEW over a table. The view's query is stored as its text and parsed again at each use, because an unaliased column is named by its text (`c*2`). The names its columns got at CREATE are stored too, because naming depends on session state and the server fixes them once. **What 8.4.11 taught.** CREATE VIEW commits. The query is resolved at CREATE, before the name is checked (1146 before 1050), and in the database current then, not the view's own: `CREATE VIEW vp.w AS SELECT * FROM t` under `USE vq` reads `vq.t`. A variable, a system one included, is 1351, and an INTO is 1350, which the parser now lets through so the executor can say so. A view that names itself through any path is 1146 on its own name, and one whose table is gone is 1356. DROP VIEW is all or nothing, and it and DROP TABLE IF EXISTS note each name they miss. A view expands as a derived table that sees nothing of the statement around it. Merged, its columns report the view as their original table and its schema as theirs, except an expression, whose schema is empty. Once a DISTINCT, a grouping or a sort over a join copies that expression, it reports the schema and no table. SHOW TABLES lists views, and SHOW FULL TABLES says which they are. INSERT, UPDATE and DELETE through a view are refused by name: 8.4.11 writes through an updatable view to its base table, and nothing asked for that yet. `mysql2-view.test.ts` pins all of it, names included. **And the promoted key:** with no PRIMARY KEY, the unique key InnoDB clusters on, the first whose columns are all NOT NULL, is reported as PRI. SERIAL's key is one (8.4.11), and so is a MEMORY table's **CHECK constraints (M8.7's half).** A constraint is kept as the text it was written in and parsed again where it is needed. It is compiled against the row to enforce it, and reprinted for CHECK_CLAUSE by the printer view definitions use too (`print.ts`). **What the probes taught.** An unnamed constraint is `<table>_chk_<n>`, numbered in writing order with a column's own among the table's, and a name is unique in its schema. Violations are checked in name order, so 3819 names `bc` before `c_chk_1`. The check comes before the row is written, so it costs no AUTO_INCREMENT value, and a row IGNORE skips is not one of the "Records" (an FK skip is). The parser had refused a column's own `CONSTRAINT dd CHECK (…)`. Reprinting showed four things the view printer had wrong: an AND or OR chain prints as one group, NOT LIKE as `(not((a like b)))`, REGEXP as `regexp_like(a,b)`, and a float as written **Done: SHOW CREATE TABLE matches 8.4.11 byte for byte** on 13 tables built to cover every type and attribute the executor stores (`show-create.ts`). A view's form, which prints its query unqualified, is refused by name. **What it taught.** A literal default is quoted as the column stores it, a number too. TEXT and BLOB never say DEFAULT NULL. A column's charset prints only when its collation is not the table's. Keys print in `sort_keys` order: PRIMARY, then UNIQUE keys with no nullable part, then other UNIQUE keys, then prefix ones, then the rest. ZEROFILL with no width written has its type's implied one, `bigint(20)`, in COLUMN_TYPE too. And a MEMORY table's foreign key is dropped without its parent being checked at all |
| M5.10 | Function library: string, math, date/time, `CASE`/`IF`/`COALESCE` | core | — | M5.2 | ◐ | prioritised by measured usage frequency across the ORM test suites. **Begun by the ORM slice, in M5.22's order: INTERVAL arithmetic, HEX and UNHEX.** `± INTERVAL`, DATE_ADD, DATE_SUB, ADDDATE and SUBDATE are one operation. Its arithmetic is `@myjs/types`' (`interval.ts`): MySQL's own day number (`calc_daynr`), and months that clamp the day, so `2024-01-31 + INTERVAL 1 MONTH` is 2024-02-29. Its result type is decided by the argument and the unit. A DATE stays a DATE under a unit of days or more and is a DATETIME under any other; a TIME stays a TIME under a unit of less than a day. A string or number argument gives a 29-character string, a date or a datetime as its text and the unit decide. **What 8.4.11 taught.** A simple unit takes an integer, and a number and a string reach it differently: `INTERVAL 1.5 DAY` is two days and `INTERVAL '1.5' DAY` one. SECOND keeps a number's fraction. A compound unit reads its fields from the right, so `'1:2:3' DAY_SECOND` is one hour, two minutes and three seconds. A result past 9999 is NULL; one before year 1 is the zero date, as `get_date_from_daynr` makes it; a zero-date argument is NULL. HEX is a string's bytes in its own charset, or a number's rounded value as 64-bit two's complement, so `HEX(-1.5)` is `FFFFFFFFFFFFFFFE`. UNHEX is half its argument's width in bytes, and reads a number as its decimal digits. The probes also fixed the literals and casts around them. BINARY and CAST AS BINARY are as wide as their argument's bytes and nullable, and BINARY(N) pads with zero bytes. An introducer re-reads a literal's bytes, so `_latin1'é'` from a utf8mb4 client is 'Ã©', `_latin1 x'E9'` is 'é', and a multi-byte charset that cannot read the bytes is 1300. A literal with COLLATE is nullable. Expression warning counts (1292, 1441, 1411) are now captured and checked by the function/coercion gates. `mysql2-temporal-hex.test.ts` pins 70 expressions, value and metadata **JSON paths, next in Prisma's order.** Prisma filters JSON columns with `JSON_CONTAINS(JSON_EXTRACT(col, ?), ?)`. MySQL's path language is now parsed byte by byte as `json_path.cc` parses it (`json-path.ts`), so a 3143's position is the server's. It covers `$`, members quoted or not, `[n]`, `[last - n]`, `[m to n]`, `.*`, `[*]` and `**`. Over it run JSON_EXTRACT with `->` and `->>`, JSON_UNQUOTE, JSON_CONTAINS, JSON_CONTAINS_PATH, JSON_TYPE, JSON_LENGTH, JSON_DEPTH, JSON_KEYS and JSON_VALID, plus COLLATION and CHARSET. A 42-statement script captured from 8.4.11 pins them, column metadata included. **What the probes taught.** An unquoted key must be an ECMAScript identifier, and "letter" is `my_isalpha` on the code point's low byte, so `é` is one and `ж` is not. A `[n]` on a value that is not an array treats it as a one-element array, while `[*]` matches nothing. Every text these functions return is utf8mb4_bin whatever the connection, so `JSON_UNQUOTE('"ABC"') = 'abc'` is 0. And the JSON text parser had put an invalid escape one byte late: rapidjson reports the backslash **REGEXP, RLIKE and REGEXP_LIKE** (`regexp.ts`), matched with the engine's RegExp after translating what ICU writes differently: POSIX classes and an inline `(?i)`. A 59-statement script captured from 8.4.11 agrees. **What the probes taught.** Case-insensitivity comes from a `_ci` collation, and accent-insensitivity never does. A binary string against a text one is 3995. ICU's syntax errors keep their own numbers, mapped from what the engine refuses. A named divergence: ICU folds case fully, so `'Straße' REGEXP 'STRASSE'` is 1 there and 0 here **REGEXP_INSTR, REGEXP_SUBSTR and REGEXP_REPLACE followed, against 43 more captured statements and both protocols' metadata.** Positions count code points, bytes in a binary string. A position outside the subject is 3686, and REPLACE keeps the text before it. Occurrence 0 replaces every match. ICU's replacement syntax is parsed here, `$n` and `\x`. The capture also found that ICU's `\w` and `\d` are Unicode's where the engine's are ASCII's, so they are translated to property classes **The string and numeric slices, instrument first.** `tools/capture-functions.mjs` captured 2,091 statements from 8.4.11 before any code was written: SUBSTRING, LEFT, RIGHT, LPAD, RPAD, REPEAT, REVERSE, LOCATE, INSTR, POSITION, TRIM and its forms, REPLACE, CONCAT_WS, SPACE, ASCII, ROUND, FLOOR, CEIL, TRUNCATE, SIGN, GREATEST and LEAST, each over a table of every type with NULLs, through both protocols with metadata. All 2,091 now agree (M5.53); the 6 formerly refused were GREATEST and LEAST over text and a DATETIME. **What the corpus taught.** `MAX_BLOB_WIDTH` is 16,777,216, the width of a result no constant bounds. Past 65,535 bytes a result is a MEDIUMTEXT or LONGTEXT, reported in bytes. A binary operand decides a result's collation only at the lowest coercibility. LOCATE searches in the haystack's character set, so a binary needle that is not text there is 3854, as is a character with no place in a narrower set. ROUND of a double rounds half to even and keeps -0. A select item named after its own text shows a character outside the BMP as `?`, and an alias holding one is 3854 **ICU's pattern language, parsed rather than translated (review).** `icu-pattern.ts` reads a pattern as ICU does and writes the engine's `v`-mode syntax, so `\Q…\E`, `(?#…)`, `(?x)`, flags switched mid-pattern, possessive quantifiers, atomic groups, `&&` and `--` between sets and loosely named properties all work, and every refusal has ICU's number. 315 statements captured from 8.4.11 pin it (`mysql2-icu-patterns.test.ts`). **What the probes taught.** A syntax error's line and character are the offending character's, or the last one when the pattern ends early. `(?x)` strips spaces inside brackets and intervals too, so `(?x)a[ ]b` is an unclosed bracket. An interval's numbers stop at 16,777,215 (4007). A lookbehind must be bounded, so `+`, `*`, a backreference or `\X` inside one is 3695. `\x{…}` takes up to seven hex digits. In a replacement, `$12` with two groups is group 1 and then '2', and a trailing `\` is dropped. `$` matches before a final newline and `\b` is Unicode's. Named divergences: `\N{name}` and Unicode blocks are refused (1235); a backreference to a group that has not matched matches empty here; mixed case-sensitivity folds only characters and ranges **Collations meeting, checked as the server checks them (review).** COLLATE must name a collation of its operand's charset, else 1253. Where strings meet, their collations are aggregated at compile time as `DTCollation::aggregate` does it, and an undecidable mix is 1267, 1270 or 1271. A 134-statement script pins it (`mysql2-collation-mix.test.ts`). **What the probes taught.** Two EXPLICIT collations are refused even across charsets. Two IMPLICIT non-`_bin` collations of one charset leave the charset's `_bin` at derivation NONE. COERCIBILITY reports that as 1. CONCAT and IF carry it, and any comparison then refuses it. A number is listed as latin1_swedish_ci NUMERIC and NULL as binary IGNORABLE. `CONCAT(col, x'61')` is the column's text, not bytes. A user variable's text is IMPLICIT. The reference tree is 26.10, not 8.4.11, and its version of the algorithm differs: NONE is the weakest derivation there and is skipped. The server was the instrument. A literal that cannot be converted into a latin1 column's charset (`c = 'ж'`) is 1267 there; it was a named divergence here until the more-functions slice, and is now refused the same way **The date and time slice, instrument first.** `tools/capture-temporal-functions.mjs` captured 300 scripts from 8.4.11 before the functions were written: DATE, TIME, TIMESTAMP, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, MICROSECOND, DAYOFWEEK, DAYOFYEAR, WEEK, WEEKDAY, YEARWEEK, QUARTER, DAYNAME, MONTHNAME, LAST_DAY, DATE_FORMAT, TIME_FORMAT, STR_TO_DATE, UNIX_TIMESTAMP, FROM_UNIXTIME, DATEDIFF, TIMEDIFF, TIMESTAMPDIFF, TIMESTAMPADD, ADDTIME, SUBTIME, MAKEDATE, MAKETIME, SEC_TO_TIME, TIME_TO_SEC, TO_DAYS, FROM_DAYS, TO_SECONDS, PERIOD_ADD, PERIOD_DIFF, EXTRACT, GET_FORMAT and CONVERT_TZ between offsets. They ran over every temporal type, text and numbers, in UTC, through both protocols. All 3,463 statements agree, warning counts included (`temporal-function-vectors.test.ts`). The calendar, the readings and the formats are `@myjs/types`' (`calendar.ts`, `temporal-args.ts`, `date-format.ts`). **What the corpus taught.** An argument is read as `get_date` or `get_time` reads it, and the type of the reading matters, not just its value. A number past 838:59:59 is NULL as a time, where text is clamped. A DATE column read as a time keeps its date, so `SUBTIME('-1 02:03:04', d)` counts d's day of the month, while a DATE literal is 00:00:00. TIMEDIFF reads both sides as dates when either is one, and a string becomes whichever the other side is. A date the function's zero-date rules refuse is NULL without a word when it is a column, and with 1292 when it is text. TIMESTAMPDIFF stops at a NULL first argument, while DATEDIFF reads and warns on both. DATE_ADD reads its date before its interval. A datetime read from text raises its delimiter deprecations, at the row being produced. `EXTRACT(WEEK FROM 0)` is 613566757, an unsigned wrap. A TIME given where a date is wanted lands on today's date, so the generator keeps TIMEs to the time functions and the corpus does not depend on the day it is replayed. Named divergences: named time zones need the time zone tables, so CONVERT_TZ takes offsets only, and `lc_time_names` is en_US **The rest of the string, numeric, hashing and network functions, instrument first.** `tools/capture-more-functions.mjs` captured 300 scripts from 8.4.11 before the functions were written: CHAR (with USING), FIELD, ELT, MAKE_SET, EXPORT_SET, FIND_IN_SET, INSERT, SUBSTRING_INDEX, QUOTE, SOUNDEX, FORMAT with locales, BIT_LENGTH, CONV, TO_BASE64, FROM_BASE64, ORD, MD5, SHA1, SHA2, CRC32, PI, POW, SQRT, EXP, LN, LOG, LOG2, LOG10, the trigonometry, DEGREES, RADIANS, BIT_COUNT, ISNULL, INTERVAL, INET_ATON, INET_NTOA, INET6_ATON, INET6_NTOA, the IS_IPV* and IS_UUID tests, UUID_TO_BIN and BIN_TO_UUID. They ran over text in two charsets, bytes, signed and unsigned integers, DECIMAL and DOUBLE, through both protocols. All 3,211 statements agree, warning counts included (`more-function-vectors.test.ts`), with DOUBLE results allowed 4 ulps for the platform's libm. The digests are `@myjs/types`' (`digest.ts`, against the published vectors). **What the corpus taught.** FIELD compares in its first argument's collation alone, converting every other argument into its charset: a constant that cannot be converted is 3854 before any row is read, bytes are validated, and an explicit COLLATE after the first argument is ignored. A VARCHAR or VARBINARY column read as a number is quiet when exactly twice its length bytes go unconverted: 2 bytes in a column under 256 bytes, 4 from there. A CHAR always warns. A 1292 quotes bytes up to their first NUL, as UTF-8. INET_ATON, INET6_ATON, INET6_NTOA and INET_NTOA quote their argument as `Item::print` prints it (`` `app`.`t`.`v` ``, `-(1)`, `''abc''`), not its value. CHAR is big-endian bytes from a 32-bit integer, and a double is `rint`-ed first, halves to even. FORMAT's locales group as the server's tables say: bg_BG's separator is a NUL, and en_IN groups in the Indian way. CONV parses text except a hex literal. SHA2's width comes from a constant length, and an invalid constant warns once. `mysql2-number-warnings.test.ts` pins the warning texts the corpus compares only by count **Binary regex codec repaired (2026-10-10).** Subjects, patterns and replacements use the existing generated MySQL latin1 decoder, and binary results use its encoder. This removes host-dependent decoding and the narrowing that corrupted 27 of the 32 bytes 80–9F. Live 8.4.11 and executor regressions through both protocols check all 256 bytes, high-byte patterns and replacement literals, captures, Unicode classes, byte positions, NUL, empty matches, subjects and capture outputs over 128 KiB, plus raw latin1-result metadata. An identity U+00xx loop would disagree with the server on dot and Unicode classes. **Further bounded repairs (2026-10-11).** Mixed TIME/text/binary and binary DATETIME extrema, typed TIME bounds, shared statement-date anchoring and dated CASE/IN readings now have live native regressions. The shared JSON numeric reader now preserves INTEGER in diagnostic 3156 for signed/unsigned casts and integer-taking functions, retaining DOUBLE/DECIMAL, column names and delivered-row numbering. There are 222 complete native query/execute/fresh prepared outcomes plus PREPARE metadata; fixtures preserve negative-zero bits, Buffer bytes and explicitly UTC client dates. ABS now reads JSON as DOUBLE and normalizes floating negative zero through the existing reader/type helpers; metadata is computed once and retains integer, unsigned, decimal, fixed-scale and literal distinctions. Its 318 complete native outcomes include 160 JSON source/control outcomes, 140 numeric/text/binary/BIT-column controls, PREPARE metadata and eighteen fresh cached executions after writes. The 210-outcome probe reaches 173 full matches, closing 78 with no regressions; grouped/DISTINCT diagnostics, expression diagnostic names and prepared-parameter fields stay open. The 150 numeric probe now reaches 146 full matches; DIV and large DECIMAL conversions remain separate. ABS now also preserves the existing literalInt.unsigned fact: BIT literals are signed and HEX literals unsigned. Tests pin 224 full native literal outcomes through 64 bits, including empty literals, unary plus/minus and signed/unsigned casts, six PREPARE metadata checks and 54 fresh cached executions across writes. The original 272-outcome probe closes 160 complete outcomes without regressions; sixteen matching syntax-error outcomes were unquoted COLLATE names. Quoting the name exposes separate existing nullability and numeric-warning byte-format gaps, so those full groups remain outside the new strict fixtures. The corrected probe reaches 248 full matches; over-64-bit truncation values/warnings remain open. All 150 original numeric/text/binary/BIT-column controls now match. **COLLATE metadata repaired.** The shared node reports nullable results even for NOT NULL inputs. One string-literal type builder owns explicit nullability/coercibility for text, binary and introduced HEX/BIT values, preserving uncollated numeric literal facts and charset validation. The 600-outcome probe reaches 576 complete matches, closing 308 without regressions; 24 binary value/diagnostic differences remain. Tests pin 552 complete source/literal outcomes, sixty complete introduced/uncollated/aggregation controls, ten exact native refusals, eight PREPARE checks and 72 fresh cached executions. The 72-control probe reaches seventy matches, closing 22 without regressions; binary IF coercibility remains separate. Binary COLLATE now preserves original bytes through the shared reader; the 600-outcome probe reaches 584 full matches and all forty byte-value outcomes agree. Numeric-warning escaping and binary IF derivation remain separate. Wide COLLATE/HEX now shares the existing result-type policy: 224 blob/text and 246 threshold outcomes close, and all thirty function/alias outcomes agree. The new fixtures pin 1,412 complete executions plus 32 PREPARE checks. CONCAT now shares capped result sizing: all 1,074 expanded native outcomes agree, closing 560 differences without regressions; 384 fresh executions and 32 PREPARE checks agree. The earlier 640 blob/text and forty LONGBLOB outcomes now all match. DATETIME now uses identifier/alias grammar: 26 complete differences close, retaining native temporal literals and casts. INTEGER binary-column CAST diagnostics now retain bytes/NUL, exact 128-character formatted caps and empty-value warnings. Named cast-versus-field reading keeps ordinary function warning behavior unchanged. Binary-column INTEGER CAST now shares one fact to bypass field suppression: all 434 fresh outcomes and all 364 direct cast controls agree across small/wide VARBINARY, BINARY and every blob class. Binary expression/introduced-literal casts now share that fact: all 93 fresh outcomes agree, the byte/cap probe closes 740 full differences and the literal probe closes 44. Nonbinary INTEGER CAST warning emission now agrees across all text classes and fresh reads. Its utf8mb3 normalization and bounded UTF-8 cap now have live regressions. Original INTEGER prefix ranges now suppress spurious overflow complement warnings and retain numeric HEX/BIT and ENUM/SET quietness; negative-zero, leading control whitespace and expected parameter conversion remain separate. BLOB/TEXT and CONCAT DECIMAL prefix readers now discard truncation status while preserving fatal invalid-prefix warnings; the shared numeric parser exposes validity without a duplicate parser. IF/CASE selected-branch DECIMAL readers, IFNULL/COALESCE and scalar string prefix readers, ANY_VALUE string prefixes, NULLIF original-argument readers, CHAR/BINARY cast prefixes and non-temporal string extrema now agree within their verified boundaries. CONVERT USING now owns its verified DECIMAL prefix policy; complete binary numeric input reading is verified. Decimal-buffer overflow, VT/FF parsing and deprecated/unavailable charset boundaries remain open. Split-multibyte message conversion remains separate; named-argument/function-call admission, packet overflow and explicit results-charset metadata/transcoding remain separate. **Still open:** direct binary regex results need character_set_results transcoding while HEX sees original bytes; the default-UTF8 wire boundary and full ICU Unicode folding remain open. JSON extrema prepare warnings/NULL metadata, CAST(TIME AS DATETIME) anchoring/rounding and temporal-literal deprecations also remain open; TIME/JSON extrema stay explicitly unsupported. Prepared multi-item TIME IN/CAST and COUNT conversion warnings need one statement-identity/expected-type contract across prepare, binding and evaluation. The Next section records the concrete measured boundaries. Complete numeric binary text, BIT text and large valid UNHEX now share a full byte reader; COLLATE owns its verified DECIMAL prefix policy (see the verification below). Variable-field message conversion remains open. UNHEX invalid reads now emit 1411 through a shared diagnostic owner. Resolved literals now share verified control escaping and preserve caller charset policy; generated expressions share CHECK_CLAUSE's extra escape layer. SHOW CREATE VIEW now retains introducers through its existing explicit context, including NULL. UTF-8 source I_S generated/CHECK byte rendering now shares its existing complete reader and table-expression printer setup. Legacy source, CESU-8, metadata/admission, view-value conversion, message caps and wide-result gaps remain measured below. |
| M5.11 | Aggregate and `JSON_*` functions | core | [28](./28-json-binary.md) | M5.10 | ☑ | `JSON_KEYS()` returns keys in MySQL's length-then-bytes order **The aggregate half is done (M5.5):** COUNT, SUM, AVG, MIN, MAX, GROUP_CONCAT, BIT_AND/OR/XOR and the variance family. Their values and result types are `@myjs/types`' (D-73). The variance is Welford's recurrence, as `Item_sum_variance` computes it, so STD's last digit agrees. The `JSON_*` functions, JSON_ARRAYAGG and JSON_OBJECTAGG included, are M5.21's **Closed (2026-10-09).** The order is pinned by keys that tell it from alphabetical order (`'B'` before `'b'`, two-byte `'é'` after `'ab'`) in `mysql2-json-path.test.ts`. The JSON functions this item never built, those that change a document and JSON_TABLE, are M5.51 |
| M5.12 | `INFORMATION_SCHEMA` (resolves Q-06) | core | [27](./27-data-dictionary.md) | M5.9 | ☑ | Prisma and Drizzle introspection reconstruct the schema exactly, multi-column indexes included. **Planned by the Prisma half of M5.22, instrument first.** Prisma's schema engine introspects every schema it pushes to with seven fixed queries, 634 times each in its suite. They read TABLES, COLUMNS, STATISTICS, KEY_COLUMN_USAGE, REFERENTIAL_CONSTRAINTS, TABLE_CONSTRAINTS, CHECK_CONSTRAINTS, VIEWS and ROUTINES. Without them `db push` fails, and Prisma's P1014 accounts for nearly all of its failures here. `tools/capture-information-schema.mjs` captures two things from 8.4.11 before any of this code is written. One is each table's column definitions and collations, generated into `information-schema-defs.ts`: names and numbers, as D-39's keywords are. The other is a corpus of 120 DDL scripts, each followed by Prisma's queries and every table filtered to its schema. The scripts cover every column type both ORMs write, defaults, comments, keys, foreign keys with every rule, views and a CHECK. **What the capture taught.** These are views over the data dictionary, and their metadata shows it. A dictionary column reports schema `information_schema` and its key flags; a computed one reports no schema and 31 decimals. Schema and table names compare in `utf8mb3_bin`, which `lower_case_table_names=0` makes case-sensitive, and column and index names in `utf8mb3_tolower_ci`. Sizes, row counts, clocks and cardinality differ between two runs of one server, so the corpus leaves them out and names them. **Begun: the nine tables, and every statement of the corpus not refused agrees, 949 of 2,568.** The 1,619 refused are ALTER TABLE and CHECK, M5.25's and M5.9's. Each table is a derived source over the catalog, computed when read (`information-schema.ts`). Its columns report the definitions 8.4.11 does, captured whole into `ResultType.wire`, because no rule here derives them. **What the corpus taught, beyond the capture.** The tables are views over a join of dictionary tables, so a sort over one streams through a temporary table as over any join (`DerivedSource.joined`). Under that stream a dictionary column copies as a column and a computed one as an expression, except a constant, which is not copied at all. That last rule is knowable only from the server, so the capture also records each column's metadata under a sort (`streamed`). An outer join still makes a column nullable whatever the dictionary says. COLUMNS lists a view's columns too. They have no key and no `auto_increment`, and a NOT NULL one defaults to its type's zero, numbers only. VIEWS prints the query as MySQL reprints it (`view-text.ts`): every column qualified, operators parenthesized, `COUNT(*)` as `count(0)`, `NOT c` as `(0 = c)`. Anything past that subset reports the view's own text, a named divergence. Index and column names sort in `utf8mb3_tolower_ci`, which is general_ci's handler weighing by `tolower`, so `gen-charsets.mjs` now emits that column of `my_unicase_default` too. **And what it found elsewhere.** An ORDER BY on columns the WHERE holds to constants is dropped before any sort, which decides whether a join's columns are streamed. A constant in a DISTINCT is not copied into its table. A temporary table holds a string expression over 512 characters as a BLOB, and reports every BLOB as type 252. A binary UNION is as wide as its widest branch in that branch's own bytes. And an integer's declared display width is its metadata length: TINYINT(1) reports 1, which is how a driver knows a boolean. BOOL is TINYINT(1), ZEROFILL is a flag, and each written width draws a 1681 **With CHECK constraints in, all 2,568 statements of the corpus agree and none is refused.** Two last rules showed only once CHECK scripts ran. COLUMNS lists a schema's tables and views together, by name as bytes, not tables first. And a view's NOT NULL column with no default reports its type's zero only when it is computed or AUTO_INCREMENT. A plain column reports NULL **Closed (2026-10-09), by running both.** `tools/introspection-diff.mjs` makes each of the information-schema corpus's 120 schemas on 8.4.11 and on this executor, then runs `drizzle-kit pull` and `prisma db pull` against each. Drizzle's 120 come out identical. 119 of Prisma's are identical; the 120th declares the same two enums in the other order, because Prisma lists columns `ORDER BY ordinal_position` and 8.4.11 breaks that sort's ties in its own order (M5.49's filesort tie order). The first Drizzle run found a bug: `INFORMATION_SCHEMA.STATISTICS.TABLE_SCHEMA`, the schema in upper case in a qualified column, was 1054. INFORMATION_SCHEMA is named in any case, and its tables' names as written (`mysql2-introspection.test.ts`) |
| M5.13 | `SHOW`, `EXPLAIN`, and the `db.explain()` / `db.stats()` / introspection API | core | [42](./42-public-api.md) | M5.7 | ☑ | doc 42's introspection methods all return real data. **Begun (2026-10-09): SHOW COLUMNS, DESCRIBE and SHOW INDEX**, against a 20-statement script from 8.4.11 that pins every result column's definition (`mysql2-show-columns-index.test.ts`). Each is what the server makes of it in `sql/dd/info_schema/show.cc`: a query over INFORMATION_SCHEMA, its columns renamed in a derived table and filtered by the database, the table, LIKE and the statement's own WHERE. That gives the rows, and the column definitions are the server's SHOW views', which differ from a derived table's, so they are pinned as captured. Cardinality is each key prefix's distinct count, NULLs as one value and in the key's collation, as InnoDB's statistics give it for a small table. It is counted only for SHOW INDEX: INFORMATION_SCHEMA.STATISTICS, which introspection reads on every connect, still says 0 rather than scan every key. The probes also found FULLTEXT keys missing from a column's key flags, in COLUMN_KEY (MUL) and in result metadata (PART_KEY, MULTIPLE_KEY). **Then SHOW CREATE VIEW**, and SHOW CREATE TABLE of a view, which answers the same. The view is written back with its algorithm, definer, SQL SECURITY (now stored, where INFORMATION_SCHEMA had said DEFINER for every view), the column list it was created with, and its check option. Names in the *current* database are unqualified, the view's own name too. The probes also corrected INFORMATION_SCHEMA.VIEWS in two places: under a column list the select items keep their own names, and a view over a view prints rather than falling back to its source text. Still to come: SHOW TABLE STATUS, and EXPLAIN's other formats; `EXPLAIN FORMAT=TREE` is M5.44's **Then the system variables (D-86).** The executor knew two dozen variables, accepted a `SET` of any name, and answered the rest with 1193, where mysqltest stopped in 192 files. `tools/capture-variables.mjs` now asks 8.4.11 for all 619. For each it records the scope, whether it may be set and by which `SET`, the type, the range, and the default as SHOW VARIABLES writes it. The probes for the capture found two exceptions to "a session's DEFAULT is the global value": `foreign_key_checks` and `unique_checks` go to 0. They also found three variables a session may read but only SET GLOBAL assigns (1621). Both are flags in the table, not code. `@@name`, `SET` and their errors (1193, 1238, 1228, 1229, 1231, 1232, 1621, and clamping with 1292) follow from that table, and 37 probes agree with the server. The values that describe a machine (paths, the host, the port, a uuid) are this server's own, and so are `log_bin` and `performance_schema`, since none is kept. SHOW VARIABLES and SHOW STATUS are what 8.4.11 makes of them: queries over `performance_schema.session_variables` and its siblings, now built for that purpose, so a statement's own WHERE filters as it would any table's. Their columns are the server's. SHOW STATUS lists only what is counted here: `Questions` (equal to 8.4.11's statement for statement), `Queries`, `Connections`, `Threads_connected` and `Uptime`. The other 246 describe machinery this executor does not have. The probes also found every INFORMATION_SCHEMA dictionary column sent without its table and schema names, where the server names them; that is fixed. **Named.** An enumerated variable's values are not checked (8.4.11 refuses `transaction_isolation = 'nope'` with 1231), because the server publishes no table of them. mysqltest: 31 of 1,146, up from 23; the files that needed a variable now reach their own requirements and skip, or reach the next missing feature **Done.** Doc 42's five methods are built, each a query through the client (doc 42's first rule), in `client/introspection.ts`. `schemas()`, `tables()` and `columns()` read INFORMATION_SCHEMA. `explain()` reads EXPLAIN FORMAT=TREE. `stats()` reads SHOW GLOBAL STATUS and INFORMATION_SCHEMA.INNODB_METRICS. Because the functions take any query function, the same code ran against 8.4.11 through `mysql2`, and `api-introspection.test.ts` pins its answers for a schema of tables, a MEMORY table, a generated column, a foreign key and a view: identical, field for field. `explain()` matches at the level EXPLAIN compares, the plan's skeleton (M5.44). The status `stats()` reads is the buffer pool under InnoDB's own names (`Innodb_buffer_pool_pages_*`, `_read_requests`, `_reads`, `Innodb_page_size`). The history length is INNODB_METRICS' `trx_rseg_history_len`, whose largest and smallest since the server started the engine now tracks, so its row holds no invented numbers. Beside them come INFORMATION_SCHEMA.ENGINES (the head of mysqltest's queue, 211 files), SHOW ENGINES and SHOW TABLE STATUS. Each is the query over INFORMATION_SCHEMA 8.4.11 makes of it, metadata included. ENGINES lists the server's eleven engines in its order, with the support each has here: InnoDB, MEMORY, and MyISAM (stored natively); no XA. SHOW TABLE STATUS showed the rule for a sort over a view: a column read from the sort's temporary table is named for its item, and a computed one has no table behind it. That holds for every sort over INFORMATION_SCHEMA. **Named.** CREATE_TIME is NULL, since no table's creation time is kept, and mysqltest masks it. A MEMORY table's statistics are InnoDB's. Under a sort, the server names the dictionary's own tables (`tables`, `collations`), which were never captured. An empty table's const lookup is M5.48's. EXPLAIN's other formats, now mysqltest's first reason (160 files), are M8.12. mysqltest: 37 of 1,146, the same on two runs |
| M5.14 | Real transactions: `db.transaction()` with bounded 1213 retry, savepoints, `db.begin()` | core | [42](./42-public-api.md), [41](./41-durability-and-concurrency.md) | M4.21 | ☑ | commits on return, rolls back on throw, and the retry limit is configurable and documented. **The SQL half is done by M5.17 (D-64).** `BEGIN`/`START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`/`ROLLBACK TO`/`RELEASE`, `autocommit = 0`, `SET TRANSACTION ISOLATION LEVEL` and `READ ONLY` all run. A failed statement leaves its transaction open. A second writer waits and then gets 1205, and a connection that goes away mid-transaction releases the writer. `db.transaction()` and `db.begin()` remain, and need `db.query()` first. **Then the API half, by M5.36:** `db.transaction(fn, { retries })` commits on return, rolls back on a throw, and runs `fn` again on a fresh connection after ER_LOCK_DEADLOCK, up to `retries` (3) times with a pause doubling from 10 ms. `db.begin({ isolation, readOnly })` returns a transaction whose `commit()` and `rollback()` end its connection. Both are documented in doc 42 and pinned by `api-params.test.ts` |
| M5.15 | `mysqltest` interpreter, curated allowlist, pass-rate reporting | test | [43 §1](./43-testing.md) | M5.10 | ☑ | the scoreboard number is produced by CI, not by hand; the suite is fetched, never vendored. **Narrowed by M3.11**, which took the parse-only half forward into M3 — the corpus fetcher, the statement extractor and the census exist and run on every push. What remains here is what genuinely needs an executor: running the statements and diffing `.result` files **The interpreter was never needed (2026-10-09).** `mysql-community-test`, which `mysql-local.mjs install` already installed, carries MySQL's own `mysqltest` and the suite's `.result` files. `mysqltest` is a client, so `tools/mysqltest-run.mjs` points it at `@myjs/server` over TCP, a fresh database per file, and records each file's outcome and a reason: an error number, the feature our 1235 names, or the class of a difference, never a statement. **The denominator is 8.4.11 under its own `mysql-test-run.pl`.** A first cut ran 8.4.11 like this executor, on one shared server, and passed 120 files. Earlier files had set `binlog_format`, read-only transactions and `SET PERSIST`ed variables (`character_set_server=greek`, a bogus `ssl_ca`) that every later file met, and some shut the server down; the local datadir had to be rebuilt. Under its own runner 8.4.11 passes 1,146 of 1,459 files, fails 23 and skips 290. This executor passes 23 of those 1,146, the same files on two runs. The tally is the work queue: INFORMATION_SCHEMA.ENGINES (198 files, a common include's check), unknown system variables (192), SHOW VARIABLES (162), EXPLAIN FORMAT=TRADITIONAL (82), SHOW STATUS (78), `mtr.add_suppression` (62). Its first file found SCHEMATA without `information_schema`, fixed. CI's new `mysqltest-run` job, informational for its first run, reproduced 23 of 1,146 against the committed row in about three minutes, and now gates |
| M5.16 | Differential harness against MySQL 8.4 in Docker | test | [43 §2](./43-testing.md) | M5.10 | ☑ | rows and their order, column metadata, `affectedRows`, errno and SQLSTATE all compared. **All five, and `insertId`, `info` and the warning count with them.** `tools/capture-execution.mjs` runs generated scripts on 8.4.11 through `mysql2` and records each statement's outcome. `execution-vectors.test.ts` replays them against the executor through the same driver, so the two sides differ in nothing but the server. The `type-vectors` CI job re-captures against MySQL 8.4 in Docker, as it does every corpus. Shared with M5.17, which built it. Taking it before M5.10 was right: the harness found eleven of M5.17's bugs, and without it they would have shipped |
| M5.17 | **First vertical slice: single-table DDL, DML and transactions through unmodified `mysql2`.** `@myjs/core`'s regex stub is replaced by an executor (D-62–D-68): parse, compile, plan, run against the catalog | core, types | [03](./03-architecture.md), [30](./30-other-engines.md), [42](./42-public-api.md) | M4.24, M3.3 | ☑ | a generated corpus of whole scripts agrees with a real 8.4.11 on every statement — **3,741 of 3,741, over 400 scripts on four tables: rows and their order, column metadata, `affectedRows`, `insertId`, `info`, errno and SQLSTATE.** The tables are an AUTO_INCREMENT key with a UNIQUE text column, a text primary key under the accent- and case-insensitive default, a table with no key at all, and a latin1 table. Three planted mutations each fail it: affected rows reported as changed rows (18 cases), `memcmp` in place of the collation (153), and a WHERE dropped after a range (3). **Every metadata rule was read off the server.** The rules a manual does not give: a column's NO_DEFAULT_VALUE and key flags; `-flag` on a TINYINT UNSIGNED reports 4 wide; integer `DIV` and `%` widths; a double expression reports 23 where a double column reports 22; a `_bin` string carries BINARY; `COALESCE` converts its result to the aggregated type and `IF` does not (`IF(1, 1, 0.5)` is `1`, `COALESCE(1, 1.5)` is `1.0`); `CONCAT` is always nullable and concatenates raw bytes when one argument is binary. **`SELECT DISTINCT` changes the metadata**: through MySQL's temporary table a column loses its key flags and gains GROUP_FLAG, unless the select list is a unique key or an index prefix, when the server skips the table. **A select item is named by its source text**, and one ending in a word keeps the whitespace after it (`-id `). That holds until the session's first `SET sql_mode = …`, after which it does not, even when the mode is set to the value it already had. That is observed, not explained, and it is modelled as session state. `SELECT @@version_comment` and `SELECT 1, 'two', NULL` now answer with column definitions byte-identical to 8.4.11's. The nine frozen self-traces were re-answered from their recorded client bytes (`freeze-traces --reanswer`); the two that do not reach the executor came out unchanged. **The executor fuzzer (`fuzz:executor`) found a bug on its first run.** `VARCHAR(18446744073709551615)` passed CREATE TABLE, and every later statement on that table reported a corrupt catalog. Now the engine refuses any definition its own decoder would reject (1063), and DDL refuses lengths with 8.4.11's numbers. M3.2's corpus, run through the executor with its 150 refusals included, agrees on 1,200 of 1,200, and running it found E-15 **The code review of this item found ten bugs, and each became a failing test before it was fixed** (`mysql2-review.test.ts`). They are E-16's abandoned statement; CREATE DATABASE skipping the implicit commit, so it waited on its own transaction; an IN list deduplicated by the literal's collation rather than the index's, which read one key twice and updated its row twice; a datetime bound rounded past an exclusive `<`; UPDATE assignments seeing unconverted values (8.4.11: `SET d = 1.234, x = d` gives x = 1.200); fractional seconds truncated rather than rounded with carry (8.4.11: `'2020-12-31 23:59:59.7'` is 2021-01-01); `transaction_isolation` and `SET SESSION TRANSACTION` being two settings; `SHOW TABLES LIKE 'user\\_roles'` ignoring its escape; warnings counted twice when an ON UPDATE column fired; and two processes able to take over one stale lock file. The same pass closed three gaps of my own: several statements in one query (D-69); a `createPort()` whose closed port never ended its session; and `end()` closing the store under live transactions, which now ends every session first |
| M5.18 | **The multi-table differential corpus, with MySQL's plans captured.** The instrument for relational SELECT, built before the operators it checks, as M5.16 was for M5.17. `capture-execution.mjs` gains a multi-table schema family: a parent, a child with a nullable indexed reference that dangles, a keyless table with duplicates, and a latin1/`_bin` table so a join meets 1267. It generates joins, GROUP BY, subqueries, derived tables, CTEs and set operations. Every SELECT also records `EXPLAIN FORMAT=TREE` with its costs stripped, and runs through both `query` and `execute`. `queries.json`'s 1,200 captured join and set-operation results are replayed through the executor, where today only a test-local evaluator checks them | core, test | [43 §2](./43-testing.md) | M5.16 | ☑ | the corpus is captured from 8.4.11 and committed. It replays with every statement the executor does not yet run counted as a refusal, and every statement it runs agreeing. Rows are compared in order, with warnings and errors, wherever our plan's tree matches the captured one; elsewhere rows are compared as a multiset, and the case counts against "plans agreeing with 8.4.11". **Planning it put the plan's assumptions to 8.4.11 first, and four of them were wrong.** *Order is not arbitrary; it is the plan's.* A hash join builds on the earlier table in join order and probes with the later one, and a probe row's matches come out newest-inserted first. GROUP BY and DISTINCT through a temporary table return groups in first-appearance order. GROUP BY on an indexed column is a streaming aggregate in index order, NULL first. WITH ROLLUP is sorted. A plain scan can be a covering secondary index, in that index's order. *Warning counts are the plan's too.* `int_col = varchar_col` over junk strings warns twice under a hash join, where each key converts once per row, once under an index lookup, and ten times under a hash join with no condition and a filter. *So is error timing.* An uncorrelated scalar subquery returning two rows is 1242 only if it is evaluated: an empty outer table raises nothing, except inside an IN subquery, which a semijoin evaluates anyway. *And the plan is a cost decision* (`a JOIN b` ran as `b, a`). InnoDB recomputes the row estimates behind it asynchronously, so the capture runs `ANALYZE TABLE` and sets `STATS_AUTO_RECALC=0`, and a capture cannot choose different plans on two runs. Half the generated joins carry `STRAIGHT_JOIN` or `JOIN_ORDER` hints, so execution is checked in full order before M5.7 has a cost model. Both protocols run because the corpus was text-only, and Prisma never uses the text protocol **Done: 300 scripts, 5,635 statements, 2,294 of them queries, captured from 8.4.11 and committed as `relational.json`, with `queries.json`'s 1,200 run through the executor beside them.** Before anything new ran, the executor agreed on every statement it accepts: 4,211 of the 5,635, and 288 of the 1,200. It refused 1,424 and 912, and the two tests ratchet on those numbers, so each later stage must lower them and none may raise them. **The corpus found two bugs in code M5.17 had shipped before a single operator was written.** `SELECT DISTINCT qty, label` on a NOT NULL `qty` keeps NO_DEFAULT_VALUE through the temporary table (E-19). `BIT_AND` was ER_SP_DOES_NOT_EXIST, where an aggregate this executor does not run yet must be refused by name. **What the capture taught.** No query's binary-protocol answer differed from its text answer, so the fixture records `"same"`. 81 queries warn on 8.4.11, every one a correlated subquery: Note 1276, "Field or reference … was resolved in SELECT #1", raised at prepare time. That is a fact M5.1 must reproduce once resultset warnings are compared, and the fixture already records them. 8.4.11 explains `id = (SELECT pa_id FROM ch)` as "Zero rows" when `ch` is empty: it evaluated the subquery while planning. **Widened later, by the ORM slice:** each column now records its schema, table, original table and original name as well as its shape. The re-capture disagreed on 246 statements, all of them names, which the shape alone had hidden |
| M5.19 | Set operations: `UNION [ALL\|DISTINCT]`, `INTERSECT`, `EXCEPT`, nested, with a trailing `ORDER BY`/`LIMIT` | core, types | [43 §2](./43-testing.md) | M5.18, M5.5 | ◐ | **Reopened (2026-10-17):** the committed corpora still agree. The new 784-outcome boundary audit initially exposed 144 differing result vectors and 272 differing full-field vectors. Integer UNIONs now reuse the existing aggregate signedness rule: all 400 integer-only outcomes agree, closing 64 result and 120 field mismatches, including execute() decoding 255 as -1. The other 384 outcomes still have 80 result and 152 field mismatches across YEAR/integer and FLOAT boundaries; keep this item partial. M5.18's set-operation cases and `queries.json`'s 500 agree, metadata included. 8.4.11 types `SELECT int_col UNION SELECT varchar_col` as VARCHAR(44) in utf8mb4, and a UNION's rows are its temporary table's, in first-appearance order **Done: all six forms, nested and parenthesised, with a trailing ORDER BY and LIMIT.** `queries.json`'s 500 set operations agree, so `queries.json` is 1,200 of 1,200 through the executor, and so do the relational corpus's. A column is typed across its branches as `Item_type_holder` types it: integers use the shared field merge and signedness rule, DECIMAL and DOUBLE as arithmetic, two temporals of a kind keep it, anything else meeting a string is a VARCHAR as wide as the widest as text, a NULL branch takes no part, and nothing carries BINARY for a number. Every value is converted to that type before rows meet. That was a real wrong-rows bug before the rule existed: a `_bin` branch and a default-collation one compared in their own collations, so EXCEPT kept a row the server removed. Nullability was the subtle rule. The outermost operation is nullable where any branch is, and so is a branch of the same operator, which MySQL flattens into it. A branch of a different operator is as nullable as its rows can be: INTERSECT where every side is, EXCEPT as its left side |
| M5.20 | `INSERT … SELECT`, with IGNORE and `ON DUPLICATE KEY UPDATE`, and subqueries in UPDATE and DELETE | core | — | M5.1, M5.8 | ☑ | M5.18's corpus agrees on them, counters included, through M5.8's `write_record`. M5.8 left them refused by name, with no owner. Multi-table UPDATE/DELETE and `CREATE TABLE … SELECT` stay refused by name **Done: `INSERT … SELECT` with IGNORE, `ON DUPLICATE KEY UPDATE` and REPLACE, through M5.8's `write_record`. Subqueries in UPDATE and DELETE came with M5.1, 1093 included.** The relational corpus is 5,635 of 5,635 with nothing refused. So is `mysql2-insert-select.test.ts`, a 27-statement script whose answers came from the server first. The query is read in full before the first row is written, so a SELECT from the target table sees none of the rows it adds. **Almost every counter differs from the VALUES form, and each was read off 8.4.11.** The info line is always present. An upsert's "Duplicates" counts only the rows it changed, whatever FOUND_ROWS says. `insertId` falls back to nothing once any row was upserted, even beside rows inserted with ids of their own. InnoDB cannot count a SELECT's rows, so it reserves 1, then 2, then 4 ids, and an upserted row's id is lost when the statement ends. A string too long for its column is 1265 when the SELECT copies a table column, and 1406 when it computes the value. That holds through a join, a merged CTE, a grouping, a derived table, and any branch of a set operation. `ON DUPLICATE KEY UPDATE` reads the SELECT's columns when the SELECT is one query block that neither groups nor aggregates. A bare name both sides hold is 1052. **The corpus found three bugs older than this item.** A NULL into a NOT NULL column warns once per column per INSERT, not once per row, in the VALUES form too. A nested set operation is typed over every SELECT beneath it, pairwise and in order, not over its own result: `grp UNION (amt INTERSECT s)` is 56 bytes wide and `grp UNION (s INTERSECT amt)` is 44. And an outer join whose ON the range optimizer proves empty is read as one NULL-complemented row. Its columns are copied into a temporary table but never keyed, so they get no GROUP_FLAG, and a DISTINCT over what is left is keyed as one table's |
| M5.21 | JSON as a value: the JSON column, binary JSON through `@myjs/types` (D-22), `JSON_OBJECT`, `JSON_ARRAY`, `JSON_ARRAYAGG`, `JSON_OBJECTAGG` | types, core | [28](./28-json-binary.md) | M5.5, M5.1 | ☑ | Drizzle's relational query shape runs and agrees with 8.4.11: `LEFT JOIN LATERAL (SELECT coalesce(json_arrayagg(json_array(…)), json_array()) …) ON true`, which `drizzle-orm@0.36.4`'s `mysql-core/dialect.js` emits. Until then the M5 exit criterion's main ORM path is blocked, and nothing owned JSON as a value: M5.9 refuses the column, and M5.11 names only the functions | **Planned, with its corpus captured first:** `tools/capture-json.mjs` holds 250 scripts and 4,617 statements, run on 8.4.11 through both protocols, with JSON recorded as the text the server sent. (mysql2 parses JSON itself and turns 18446744073709551615 into …552000, so the capture reads raw text and sets `jsonStrings`.) The corpus covers documents in and out, the four constructors over every column type, Drizzle's LATERAL shape, CAST, comparison, UNION with a string, and writes. It replays with every statement refused, and `json-vectors.test.ts` ratchets on that count. **What the first probes taught.** Text renders with `", "` and `": "`, keys in length-then-bytes order, and a duplicate key's last value. A VARBINARY in JSON is an opaque `"base64:type15:…"`, and a DATETIME is `"…:59.000000"`. An integer past UINT64 becomes a double, `1.8446744073709552e19`. A JSON column is type 245, length 4294967295, BLOB and BINARY, charset 63. A JSON expression is 245 with length 4294967292 and 31 decimals, flagged BINARY, in the connection's charset, and becomes a column's metadata when a derived table materializes it. Invalid text is 3140 into a column and 3141 as CAST's argument, and the two protocols agreed on every query **Done: the JSON column, JSON as a value, the four constructors and aggregates, and CAST, and the JSON corpus agrees on all 4,617 statements with nothing refused.** Drizzle went from 10 of 487 tests to 425. Its relational API's LATERAL `JSON_ARRAYAGG` shape runs, and the corpus holds 61 instances of that shape agreeing row for row. **The value is a second model beside M2.13's codec, lossless where MySQL is observable** (`json-doc.ts`). The codec's `JsonValue` erases the difference between an INT16 and a double, and between a signed and an unsigned integer, and holds a temporal as a storage value. The new model keeps all of those, plus a DECIMAL's scale (`[1.50]`), opaque bytes with the field type they came from (`"base64:type254:YWIA"`), and an object's keys sorted and unique. It is stored as MySQL's binary JSON (D-22), with decimals and temporals as custom data, and M2.13's reader reads the result. **What 8.4.11 taught, beyond the first probes.** MySQL parses numbers with rapidjson's normal-precision path, which accumulates a long integer as a double digit by digit. So `123456789012345678901234567890` is `1.2345678901234566e29`, one ulp from the correctly rounded value, and the parser now follows that algorithm step for step. A boolean result is JSON `true`, so `TRUE`, `1 = 1` and `NOT x` carry a boolean flag on their type that only JSON reads. `JSON_ARRAYAGG` and `JSON_OBJECTAGG` sort their groups as GROUP_CONCAT does. A mergeable LATERAL derived table is merged, and a LATERAL join is a nested loop, so a sort can go ahead of it. JSON meeting a string is a LONGTEXT in `utf8mb4_bin`, JSON's own collation, which is why `s UNION ALL doc` is flagged BINARY. **A sort is not a comparison.** ORDER BY keys a JSON array or object on its length alone, and 8.4.11 breaks the ties the same way ascending and descending. They are not in its key at all, so the corpus no longer claims that `ORDER BY nn` fixes an order. The replay found that `distinct()` deduplicated on "sorts equal": two arrays of one length were one row. It now keys on equality, which also replaces its O(n²) list. JSON_EXTRACT and the other `JSON_*` functions stay M5.11's
| M5.22 | ORM statement census: the Drizzle and Prisma MySQL suites run against 8.4.11 with `general_log` on, and their statements are classified by feature | test | [43 §1](./43-testing.md) | M3.11 | ☑ | a committed census (counts and feature names, never statements, as M3.11's) says which clauses and functions the exit criterion's suites use. M5.10 is "prioritised by measured usage frequency across the ORM test suites", and nothing measured it | **Drizzle's half is done.** `tools/orm-suites.mjs` clones `drizzle-orm` at 0.36.4 into `reference/` and installs only what its MySQL suites import, pinned. It runs them against 8.4.11 with `general_log` on, and parses every statement they sent: 6,599 statements, and every one parses. It runs them again against this executor, served over TCP, where all 487 tests now pass. `orm-census.json` holds counts and feature names only. **What Drizzle sends is mostly DDL.** There are 2,769 CREATE TABLEs and 2,305 DROPs, because each test rebuilds its tables, and 682 of those tables have a JSON column. Its queries lean on very little. LEFT JOIN appears 127 times, LATERAL derived tables 83, `JSON_ARRAY` and `JSON_ARRAYAGG` 83 and 73, COALESCE 73. Then come UPPER and LOWER, ROW_NUMBER() OVER (14), CREATE VIEW (11), and a handful each of CONCAT, LENGTH, UNHEX, INTERVAL and CAST. NOW() and CURRENT_TIMESTAMP appear 954 times, nearly all as column defaults. **That is M5.10's order, measured.** **Prisma's half is done too.** The tool clones `prisma` at 5.22.0 and builds its monorepo with pnpm 8, as its CI does; its engines download from binaries.prisma.sh. It runs the functional tests with `--provider mysql` and reads jest-junit's XML. 8.4.11 passes 1,122. The census of the 13,421 statements those tests sent orders the work differently from Drizzle's. Introspection comes first: seven fixed INFORMATION_SCHEMA queries, 634 times each, because the schema engine diffs every schema it pushes. Foreign keys come next, 210 `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`, which brings M8.6 forward as M5.25. And `utf8mb4_unicode_ci` is the collation of every table Prisma creates. **Done: both halves committed.** It ordered the slice that took Drizzle to 487 of 487 and Prisma from 16 to 1,104 of 1,122
| M5.23 | Spilling: sorts, hash joins and temporary tables past a memory bound go to scratch files through the `Vfs` | core | [40](./40-vfs.md) | M5.5, M5.4 | ☐ | a sort and a GROUP BY over a table larger than the bound return the same rows as in memory, in the same order. Split out of M5.5 so its grouping can close. MySQL's own spill changes a hash join's order (chunk files), and whether to follow it is this item's to probe |
| M5.24 | The `sql_mode` flags that change values and names: `NO_ZERO_DATE`, `NO_ZERO_IN_DATE` and `ERROR_FOR_DIVISION_BY_ZERO` as a strict mode enforces them, and the `IGNORE_SPACE` a client's `CLIENT_IGNORE_SPACE` adds to its session | core, types, protocol | [24](./24-column-encodings.md) | M5.2 | ☑ | each is a script captured from 8.4.11 through `mysql2` that agrees statement by statement. Found while closing M5.20: a session now starts in 8.4.11's default mode, which holds all three date flags, and nothing enforces them. 8.4.11 refuses `INSERT … VALUES (1/0)` with 1365 and `'0000-00-00'` into a DATE with 1292, where this executor stores both. `mysql2` asks for `CLIENT_IGNORE_SPACE`, so 8.4.11's session mode through it begins with `IGNORE_SPACE`, and ours does not. A TIME given a string with a date part warns as a DATE given a time does (1292 strict, 1265 otherwise), and does not here yet. **Done.** The three date flags were already enforced when the work began; the rest was one mechanism. MySQL routes every condition through `Strict_error_handler`: under a strict mode, in an INSERT, REPLACE, UPDATE, DELETE, CREATE TABLE or ALTER TABLE without IGNORE, a warning of its 23 listed codes is raised as an error. Here the statement's list of conditions does the same, so `'abc' + 1` in an UPDATE's WHERE, in a subquery of an INSERT, or in an upsert's assignment that runs is 1292, and SELECT, SET and DO still warn. Division by zero warns only under ERROR_FOR_DIVISION_BY_ZERO, and before this it warned in every mode. The probes found three more bugs. Text past the largest double was infinity and then 1690, where `my_strtod` stops at DBL_MAX with a 1292. CAST AS FLOAT was a double, where 8.4.11 rounds it to a single and refuses one past FLT_MAX with 1690. The info line's `Warnings:` left out an expression's warnings. A client's CLIENT_IGNORE_SPACE now puts IGNORE_SPACE first in its session mode. Its effect on parsing is M5.33. UPDATE IGNORE, which was 1235, came with this work, because IGNORE is what turns the handler off: a skipped row's cascades are undone to a savepoint. Pinned by a 79-statement script and a 50-statement UPDATE IGNORE script, with three planted mutations caught (no escalation, no mode gate on 1365, no savepoint) |
| M5.25 | Foreign keys: stored, shown by `INFORMATION_SCHEMA`, added by ALTER TABLE, and enforced with their referential actions — M8.6, brought forward | core, engine | [00](./00-goals-and-scope.md) | M5.12, M5.8 | ☑ | Prisma's referential-action tests pass, and an FK corpus captured from 8.4.11 agrees: each rule's cascade, nulling and refusal (1451, 1452), on delete and on update. **Why now.** M8.6 put enforcement "as demand arrives", and the exit criterion is that demand. Prisma's default relation mode is `foreignKeys`, so every relation it pushes is an `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` (210 in its suite) carrying RESTRICT, CASCADE, SET NULL, NO ACTION or SET DEFAULT. Its tests then rely on the server to carry those rules out **Begun: definition, ALTER TABLE and enforcement, and a 121-statement script captured from 8.4.11 agrees, messages included.** A key is stored in its child's definition with its parent's schema and both actions resolved (`foreign-keys.ts`). CREATE TABLE and ALTER TABLE make it as InnoDB does. An unnamed key is `<table>_ibfk_<n>` and a name is unique in its schema. A missing supporting index is added, named for the constraint. Each refusal comes in the server's order: 1239, 1826, 1072, 1830, 1824, 3734, 3780, 6125. Every DML write goes through one guarded `Table`, so REPLACE, upserts and IGNORE need nothing of their own. ALTER TABLE is `Catalog.rebuildTable`, a copy in one DDL, for ADD and DROP of foreign keys and indexes and for ADD COLUMN. Its "Records" counts rows only when MySQL would copy too. **What the probes taught.** Type compatibility is InnoDB's `cmp_cols_are_equal`, by storage class. Strings must share a collation whatever their length. DECIMAL, DATETIME, TIME and VARBINARY are all "binary" and match each other. In 8.4 a parent's key must be exactly the referenced columns: a prefix of a wider key is 6125. SET DEFAULT is accepted, shown, and enforced as RESTRICT, since InnoDB never implemented it. Its 1451 text omits the clause SHOW CREATE TABLE prints. A cascaded update into a table an update above it is changing is 1451, so a self-referencing ON UPDATE CASCADE refuses every change of a referenced key. And REPLACE deletes and re-inserts, firing the cascades, whenever the table is referenced, where it would otherwise update in place (`write_record`). The INFORMATION_SCHEMA corpus now agrees on 2,154 of 2,568 statements. The 414 it refuses are all CHECK constraints (M5.9) **Done.** Prisma's referential-action and relationMode suites pass all 24 of their MySQL tests, and the captured FK script agrees, messages and all |
| M5.26 | FULLTEXT indexes and `MATCH … AGAINST`, natural-language and boolean, ranked as InnoDB ranks | core | [00](./00-goals-and-scope.md) | M5.9, M5.12 | ☑ || Prisma's `fulltext-search` suite passes, and an 85-statement script captured from 8.4.11 agrees, every relevance to the last bit. **Why now.** It was the largest group of Prisma failures left: 8 tests, all refused at CREATE TABLE. **Probed before written.** InnoDB's rank is `tf × idf²`, where idf is `log10(N / n)` over the table's rows, or `log10(1.0001)` when every row holds the word. A word repeated in a natural-language query counts its rows again. The arithmetic is float, with each term rounded and then the sum; BOOLEAN MODE's `>` and `<` add or take 1 after the term is added. A word is letters, digits and `_`. The 3-to-84-character bounds and the 35 stopwords are the server's own, captured by `tools/capture-fulltext.mjs`. The boolean grammar's errors carry Bison's words (`syntax error, unexpected '-'`), and Prisma snapshots one. **Built.** The index is kept in the definition and not built: `fulltext.ts` reads the table once per statement for its statistics. That is correct, and slow on a large table, which a real inverted index (an engine-level FULLTEXT) would fix. Duplicate keys now draw 1831, FULLTEXT or not, and `DROP INDEX … ON` runs as the ALTER it is. **Named divergences.** WITH QUERY EXPANSION is refused, and a prefix's term frequency over several matching words is the largest of theirs, where InnoDB's is not. InnoDB applies a transaction's changes to the index at commit, and counts an UPDATE's old version in a prefix's statistics until OPTIMIZE TABLE; here the rows are read as they stand **A third review, against the server and `fts0que.cc`.** The prefix divergence is gone. A prefix scans InnoDB's red-black tree of cached words: from the first node on the search path that it begins, backward while words match, then forward. A row counts the occurrences of the first scanned word it holds. So `'data*'` over 'database data data data' counts 1, and the tree's shape (`ut0rbt.cc`, words inserted row by row in sorted order) decides the rank. A prefix and the word it spells share one entry, counted once per scan, and the logarithm of a count above the row total is taken below zero rather than replaced by the epsilon. A 40-row generated table with 18 prefix queries agrees to the bit. A constant query is parsed before any row is read. Bison's 10,000-entry stack gives 1064 'memory exhausted' at 4,999 nested groups (3,333 with operators) and 209 below it, and the group parser is a loop so that depth reaches the server's answer instead of the engine's stack. MATCH takes column names only, refuses a number among them as a collation mix, works in a JOIN's ON, and searches for a variable or a subquery. A FULLTEXT key takes no `USING` and no ASC or DESC. Its COMMENT and INVISIBLE are kept, and so are every other key's, which SHOW CREATE TABLE and STATISTICS had dropped (`mysql2-index-options.test.ts`). Still named: MATCH over a derived table, which the server merges, is 1191; the cache takes rows in insertion order where this reads them in table order; `WITH PARSER ngram` is refused **Closed against its done-when.** Both halves hold: Prisma's `fulltext-search` suite passes in every census run, and the captured script agrees to the bit. What the prose names as still open is not part of that assertion, so it moves to M8.11 rather than keep this item open: a built inverted index, WITH QUERY EXPANSION, `WITH PARSER ngram`, InnoDB's apply-at-commit statistics, and MATCH over a merged derived table |
| M5.27 | ALTER TABLE's column, key and table actions: DROP COLUMN, MODIFY and CHANGE COLUMN, RENAME COLUMN, ALTER COLUMN SET and DROP DEFAULT, RENAME INDEX, RENAME TO, and the COMMENT, AUTO_INCREMENT and ENGINE options | core | [00](./00-goals-and-scope.md) | M5.25 | ☑ | a 104-statement script captured from 8.4.11 agrees, messages and "Records" counts included. **Why.** Migration tools write these, and a second review found each refused by name. **What the probes taught.** A dropped column leaves every key it was in, and the key goes when it has no column left. It takes along a CHECK that named it alone; a CHECK naming it with another, or any CHECK on a renamed column, is 3959. A foreign key's column cannot be dropped (1828, or 1829 from the parent's side). It is renamed on both sides, and cannot be retyped apart from its partner (3780). A retyped column converts its rows as a strict INSERT would: 1264 and 1265 name the row, and NULL into NOT NULL is 1138. "Records" counts the rows unless InnoDB makes the change in place: a VARCHAR made longer, NULL made NOT NULL, a rename, a default. DROP DEFAULT leaves no default at all, so an INSERT that omits the column is 1364, and SHOW CREATE TABLE says nothing for it. Every column dropped is 1090, decided before any name is looked up. RENAME alone answers without counts, as RENAME TABLE does. A FULLTEXT key follows its columns and keeps them text (1283) |
| M5.28 | **The diagnostics area**: every warning, note and error a statement raises, listed by SHOW WARNINGS and SHOW ERRORS, counted by `@@warning_count` and the result's terminator, and compared in every corpus | core, types, protocol | [14](./14-command-phase.md) | M5.16, M5.18 | ☑ || a query's warning count agrees with 8.4.11's across the relational, function and JSON corpora (0 of 2,248, 1,163 and 1,377 disagree), and a 219-statement SHOW WARNINGS script agrees text for text. **Why.** SHOW WARNINGS answered an empty list, and nothing counted a SELECT's warnings at all. A review asked for it; migration tools and anyone debugging a silent truncation read it. **What it taught.** The corpora said they kept each query's warning count, but the capture read `@@warning_count` after the binary execute and the EXPLAIN, so it recorded the EXPLAIN's. All 81 "warned" relational queries were EXPLAIN's; the true count is 0. The instrument was the bug, as so often. Fixed, recaptured, and only then compared. The server's rules, probed: SHOW WARNINGS, SHOW ERRORS and their COUNT(*) forms leave the area alone; every other statement starts afresh after `@@warning_count` is read; an error is a condition. Text read as a number warns 1292 each time it is read (once a row), except that a constant compared with a number is converted once a statement (`cache_converted_constant`). A TEXT column never warns (`Field_blob::val_real` discards the error). `val_int` of text stops at the first non-digit, so `CAST('1.5' AS SIGNED)` is 1, `LEFT(s, '2.7')` takes 2, and past 64 bits it saturates. We rounded instead, and `CAST('99999999999999999999' AS SIGNED)` answered a number past 64 bits. Outside a strict mode, data too long is 1265; a temporal that does not parse is 1265, and one that parses but is impossible is 1264. LPAD and RPAD built their result before checking its size, so `LPAD('a', 100000000, 'b')` was a hang; now it is NULL with 1301, as for REPEAT and SPACE. **Still divergent, by name.** A VARCHAR column holding exactly two characters ('x1', 'ab') reads as a double without a warning on 8.4.11, and so does '1 2'. The source says it should warn; observed, not explained, and not emulated. `NULL + 1` is a DOUBLE there and NULL here. DATE(), CAST AS DATE's 1292, and NCHAR's 3720 wait on their functions **Closed.** Re-probed against 8.4.11 one by one, the named divergences are gone: the two-character VARCHAR ('x1', 'ab') and `'1 2'` read as a double without a warning, as on the server, while 'abc' warns; `NULL + 1` is typed as the server types it (M5.2's `nullArithmetic`); DATE() and CAST AS DATE raise 1292, and an NCHAR or NATIONAL column and CAST AS NCHAR raise 3720, each with the server's words. One neighbour found by the probe is not a warning and stays named: `NCHAR(65)` as a call is 1064 on 8.4.11, a keyword with no function production, and 1305 here. The three corpora's warning counts still disagree 0 times, and the 219-statement script agrees text for text |
| M5.29 | `CREATE TEMPORARY TABLE` and `DROP TEMPORARY TABLE`: a table one session sees, until it ends | core, engine | [14](./14-command-phase.md) | M5.9, M5.14 | ☑ | a 107-statement script over two connections, captured from 8.4.11, agrees in full (`mysql2-temporary-tables.test.ts`). Found missing by the second review's re-run, with no item to own it. **How it is built.** A temporary table's rows live in the store with every other table's, so a transaction covers them. Its definition lives in a hidden schema, `#tmp#<session>#<n>`. Each session reads the catalog through a facade (`temporary.ts`) that sends a name to its temporary table first. That facade, a `Pick` of the catalog's public methods, is what `Run.catalog` now is. A Proxy gives a temporary table's engine handle the definition the session sees. Temporary DDL runs in the session's own transaction, which holds the one writer, so the catalog's DDL and lookups take a `trx` (an engine change). The hidden schemas end with their session, or with COM_RESET_CONNECTION, and a crash's are dropped when the next executor opens the store. **What 8.4.11 taught.** CREATE and DROP TEMPORARY do not commit, and ROLLBACK, whole or to a savepoint and under `autocommit = 0` too, takes a temporary table's rows but neither its creation nor its drop. The server's warnings follow what the transaction did, not what is left: 1751 for a creation, 1752 for a drop, both for a table made and dropped in one transaction. So a `reconcile` after every rollback restores the session's registry of tables. A statement may name a temporary table once (1137, naming the first reference's alias), a view may not read it (1352), it takes no FULLTEXT key (1796), and a foreign key may be neither its own (1215) nor point at it (1824, since the dictionary never sees it). ALTER TABLE always copies it, its rename included (`Records: 1`). SHOW CREATE TABLE says TEMPORARY, and no listing shows it or its schema. Named here: RENAME TABLE, which acts on the table everyone sees, is not supported at all yet |
| M5.30 | `CREATE TABLE … LIKE` and `CREATE TABLE … SELECT`, temporary or not | core | [14](./14-command-phase.md) | M5.9, M5.20 | ☑ | both agree with 8.4.11 over a captured script, metadata of the columns CREATE … SELECT derives included. Found missing by the second review's re-run. **Done: a 66-statement script agrees in full (`mysql2-create-like-select.test.ts`).** LIKE copies the definition: columns, keys, FULLTEXT keys, CHECK constraints renamed `<table>_chk_<n>` as new ones are, and the comment. It does not copy foreign keys or the counter. … SELECT (`create-select.ts`) plans the query first, so its errors (1052) come before any table. Each column it returns becomes DDL text. A table's column is its own SHOW CREATE TABLE line, AUTO_INCREMENT made a default of 0. Anything else is typed by its result: text past 512 characters as TEXT, NULL as VARBINARY(0), and NOT NULL with a default of 0 or '' (none for a temporal) when it is never NULL. The text is parsed and resolved like a declared column. Declared columns the query does not name come first, and a declared column keeps its declaration. The rows are an INSERT … SELECT, IGNORE and REPLACE included, and a failure drops the table (1062 leaves none). **What the probes taught.** Whether an integer becomes INT or BIGINT depends on the kind of item, not its type: `generate_create_field` gives a literal `create_tmp_field_from_item`'s rule (BIGINT from width 10) and a function its own `tmp_table_field` (BIGINT past 11). So `2147483647` is BIGINT and `-2147483648`, a negation, INT. A permanent table made under a temporary one of its name is the one filled. **Bugs in CREATE TABLE itself that it found.** SHOW CREATE TABLE wrote a column's charset by comparing it with the table's, where the server keeps whether it was named (`is_explicit_collation`): a named one is always written, a derived one only where it differs. `JSON`/`TEXT`/`BLOB DEFAULT NULL` was refused with 1101, where only a non-NULL default is. `AUTO_INCREMENT = n` was ignored. NCHAR, BINARY, `utf8` and `utf8mb3` drew none of their warnings (3720, 1287, 3719) |
| M5.31 | Generated columns, VIRTUAL and STORED | core, engine | [14](./14-command-phase.md) | M5.9 | ☑ | a generated column's value, type and refusals agree with 8.4.11 over a captured script. Found missing by the second review's re-run. **Done: an 86-statement script agrees in full (`mysql2-generated-columns.test.ts`).** A column `AS (expr)` keeps its expression as written and is filled in column order from the row as it will be stored. That happens on INSERT (VALUES, SET and SELECT), REPLACE, an upsert, UPDATE, and ALTER TABLE's copy, which counts its rows when a STORED one is added. Under a strict mode, what the expression warns of is the statement's error (`'7x' + 0` is 1292 and no row). Refused as the server refuses: DEFAULT on one (1221); a column the table lacks (1054, "in 'generated column function'"); a generated column at or after its own place (3107); AUTO_INCREMENT (3109); a subquery (3102); a variable (3772, in a default's words); a function whose value is not the row's (3763, naming it); a value other than DEFAULT (3105); a foreign key on a virtual one (3733); and dropping a column one names (3108). SHOW CREATE TABLE and COLUMNS print the expression as `Item::print` does, `->>` as `json_unquote(json_extract(…))` and strings with the charset they were read in, which the column keeps. LIKE copies a generated column and CREATE TABLE … SELECT makes a plain one. **Named divergence:** 8.4.11 computes a VIRTUAL column whenever a statement reads it, so its expression's warnings come again on each read (`SELECT b` warns where `SELECT a` does not) and are an error to a strict UPDATE or DELETE that reads the row. Here it is computed once, as the row is written. Doing it the server's way needs each statement's read set, which the executor does not track |
| M5.32 | Bulk statements that do not stall other connections: a 32,000-row INSERT, IN list or DELETE in well under a second | engine, core | [26](./26-redo-and-recovery.md) | M4 | ⊘ | measured: today each row costs about 130 µs (redo diffs 12%, GC 7%, text encoding and collation keys the rest), so Prisma's chunking tests block the event loop for 5–7 s and parallel suites time out connecting (`Can't reach database server`). That, not a failing feature, is why Prisma's count moves between 1,109 and 1,113 from run to run. First pass, 10,000 rows: an IN list of strings 1,333 → 610 ms, because the items' sort keys go into a set, stripped of PAD SPACE's pad weights, and the leaf a range starts on is binary-searched rather than walked; DELETE 1,107 → about 760 ms, because purge takes up to 64 undo records into one mini-transaction while it holds under 8 pages, and the page-header reads no longer make a `DataView` each. A cache of views per frame in a `WeakMap` was tried and made DELETE twice as slow, and unrolling the redo diff's word loop made it slower too: at 6 µs a 16 KB page it is already near memory speed, so what is left is the number of mini-transactions per row, not the diff. Second pass: a multi-row INSERT of explicit keys writes its rows in batches, up to 64 rows into one mini-transaction while it holds under 16 pages, and the redo and undo writers are reused rather than made per record. 10,000 rows 1,040 → about 770 ms. A batch takes no counter, since one must be taken outside a mini-transaction, so the first row is written alone (MySQL takes no AUTO_INCREMENT value when that row fails) and VALUES that give the auto column are written one by one. When a later row fails, the batch's abort takes back the row it met, so a duplicate is named from the engine's error and the new row's values, as the server names it (`mysql2-insert-batch`; dropping that fallback fails it). A table handle asked the catalog, for every row written, whether its table still existed: about 6 µs a row. It now remembers the transaction that last found it alive, until the next write to `_myjs_tables` or that transaction's next rollback to a savepoint. A unit test plants both: dropping either half of the key lets a write through a dropped, or rolled-back, table. 10,000 rows: INSERT about 700 ms, DELETE 715 → 635 ms. The lexer tried every operator against each `(`, `,` and `)`, longest first; it now tries only those that begin with the character it is on, still longest first. INSERT 700 → 610 ms. A prepared statement was parsed when prepared and again when run; the executor now keeps the last 16 parses by sql_mode and text. That is safe only if nothing changes a statement after parsing. So, before the cache, every parse was deep-frozen and the test suite, the executor fuzzer, Drizzle (487/487) and Prisma (1,113, the one known snapshot failure) were run: none wrote to one. INSERT 610 → about 560 ms; 32,000 rows is still over a second. At 32,000 rows, two costs grew faster than the rows. The PREPARE response built an identical definition for each `?`, re-encoding the same strings each time; it is now built once. The planner keyed each IN point by a hex string made a byte at a time; it is now a string of one character a byte, which orders the same way. Reversing that order, or keying the points by anything else, fails existing tests. 32,000 rows: INSERT 1,865 → 1,280 ms, an IN list 1,943 → 1,660 ms. UPDATE and DELETE without IGNORE now batch as INSERT does (`inBatches`), since any error fails them whole; with IGNORE, a row's error is a warning and only that row's changes are undone, so those still write a row at a time. A script of bulk statements that fail partway (a duplicate whose partner the same batch wrote, a CHECK, a foreign key, a cascade, a key moved up into its neighbour) matches 8.4.11 (`mysql2-update-delete-batch`). Swallowing a row's error inside a batch fails it. 32,000 rows: DELETE 2,188 → about 1,330 ms **⊘ 2026-10-09, superseded by M5.37.** Its done-when measures throughput, but its title asks for no stall, and the stall is latency: what other connections need is a statement that yields, which M5.37 is. The speedups recorded here stand; what was left of the stall is M5.37's. |
| M5.33 | `IGNORE_SPACE` as the parser sees it: the names in the lexer's `sql_functions[]` (`COUNT`, `SUM`, `SUBSTRING`, `NOW`, `CAST`, `TRIM` and their like) are function tokens only when `(` follows at once, and anywhere a space may come between under IGNORE_SPACE | parser | [12](./12-connection-phase.md) | M3.3 | ☑ || `SELECT COUNT (*) FROM t` is 1064 with IGNORE_SPACE off and a count with it on, as 8.4.11 answers both. Found closing M5.24: the parser accepts the space everywhere (a choice recorded in `expression.ts`, from M3.11's census), which is right for a `mysql2` session, since IGNORE_SPACE is on from the handshake, and wrong once a statement sets the mode without it **Done.** The manual's list was taken as a claim and checked: every one of its 35 names, written `NAME (1)` with IGNORE_SPACE off, is 1630 on 8.4.11, and a builtin off the list (CONCAT, ABS, LEFT) takes the space. Those with a grammar of their own (`COUNT(*)`, `CAST(x AS …)`, `TRIM(LEADING …)`) are a syntax error instead, because the call is read as a stored function's, whose arguments are plain expressions: `COUNT (*)` is 1064 near `'*) FROM t'`. So the parser reads such a call as one (`CallNode.stored`), and the executor, which has no stored functions, answers 1630 with the server's text. A `mysql2` session is unaffected, since its handshake sets IGNORE_SPACE. The parser fuzzer and the mysqltest census stay clean. Pinned by `mysql2-ignore-space.test.ts`, which fails with the parser branch disabled |
| M5.34 | `RENAME TABLE`, and `ALTER TABLE … RENAME` alone, as a move of names | core, engine | [27](./27-data-dictionary.md) | M5.27, M5.29 | ☑ | a 55-statement RENAME TABLE script and a 19-statement ALTER … RENAME script captured from 8.4.11 agree. M5.29 named it as missing, and migration tools write it. **How.** The catalog gains `renameTable`, which moves a table's dictionary row to a new name or schema and leaves its trees alone, since they are keyed by its id. It also gains `setTableOptions`, which rewrites a definition in place, and `ddlTransaction`, so a statement's pairs are one DDL. A lone ALTER … RENAME used to copy every row and now takes this path too. **What 8.4.11 taught.** The pairs apply in order and atomically, so a swap through a third name works and a missing table among them leaves every name as it was. The order of errors is 1049, then 1146, then 1050, and the table's own name counts as in use. ALTER … RENAME to its own name is no error. A view can be renamed but cannot change schema (1450). A temporary table is not seen. An unqualified new name goes to the current database, for ALTER … RENAME too, which the copying path had placed in the table's own schema. Generated constraint names follow the table: `t_ibfk_N` and `t_chk_N` become `u_…`, as does a name written in that shape by hand. Every foreign key naming a renamed table follows it through the pairs in order. Two planted mutations are caught: no references followed, and no names followed |
| M5.35 | Multi-table UPDATE and DELETE: `UPDATE a JOIN b … SET`, `DELETE a, b FROM …`, `DELETE FROM a USING …` | core, parser | [14](./14-command-phase.md) | M5.4, M5.8 | ☑ | a 68-statement script captured from 8.4.11 agrees (`mysql2-multi-table-dml.test.ts`). Found refused by name while probing gaps after the second review. **How.** The FROM plan can now carry each base table's row id through every join operator, on request, so ordinary queries pay nothing. The statement reads every joined row the WHERE keeps first, and then writes each target row once. **What 8.4.11 taught.** An UPDATE target row takes its values from the first joined row that reaches it, in the hash join's order. Every SET item reads the row as it was read, so `SET q.x = q.x + 1, q.y = q.x * 10` gives y = 50; the single-table form gives 60. The second planted mutation, which let later items see earlier ones, passed the first script and was therefore probed rather than assumed. The probe showed the code was wrong and the mutation right. "Rows matched" counts target rows of every table. ORDER BY and LIMIT are 1221. A subquery reading any joined table is 1093, naming the first table whichever one it reads. A derived target is 1288 and an unknown DELETE target is 1109. ORDER BY after a multi-table DELETE's WHERE is a 1064, so the parser now stops there. **Named, not yet done:** when a DELETE takes a parent and its children, and the parent's cascade has already removed the children, 8.4.11 still counts one of them; it reports 2 where this executor reports 1 |
| M5.36 | Doc 42's query API: `db.query()`, `db.execute()`, `db.connect()`, `db.begin()`, `db.transaction()`, in `mysql2/promise`'s shape | core | [42](./42-public-api.md) | M5.17 | ☑ | every statement of five corpora (execution, relational, functions, temporal functions, JSON; 160 scripts) answers through `db.query()` and `db.execute()` as through `mysql2/promise`: rows and their JavaScript values, fields, OK headers, errors. Each SELECT is also run under eight type-option sets (`api-query.test.ts`), and parameters of every kind in three time zones (`api-params.test.ts`). Built on the protocol, as doc 42's rule 1 says, by a client in `core/src/client/` that drives a `ProtocolConnection` as `execProtocol` does. It sends `mysql2`'s capability flags and utf8mb4_unicode_ci (D-76), so a session behaves as `mysql2`'s does. The first comparison found a binary DATETIME read in a fixed-offset zone off by a factor of a thousand in its milliseconds, because `mysql2` pads the microseconds to six digits. Writing the NO_BACKSLASH_ESCAPES rule found that the server never reported the mode in its OK status (0x200), which 8.4.11 does on every OK. It also found that `SET sql_mode = <expression>` was accepted and ignored, a stand-in from before there was an executor. It is now evaluated as 8.4.11 evaluates it: bits, names, 1232 for a DECIMAL, 3899 for reserved bits, and 3090 for PAD_CHAR_TO_FULL_LENGTH (`mysql2-sql-mode.test.ts`). `db.stream()` waits on Q-11 |
| M5.37 | **A bulk statement pauses between batches, so other connections are served while it runs.** INSERT, UPDATE and DELETE run as generators that yield only between mini-transactions; the async edge resumes them and yields to the event loop every few milliseconds (D-77) | core | [41](./41-durability-and-concurrency.md) | M5.32 | ☑ | while one connection runs a prepared 32,000-row INSERT and a 32,000-item `DELETE … IN`, taking over 500 ms, a second connection's `SELECT 1` never waits more than 200 ms; a slice of `Infinity` fails that, and a connection closed mid-statement leaves no rows and the writer free **Done.** The measurement came first, and its first version was wrong twice: it timed each `SELECT 1` from when the probe ran, which a stalled loop delays too, so a 3-second stall measured as 4 ms; then it stopped on `done` before measuring the answer that came after the stall. Measured right, a 32,000-row INSERT held the loop for 3 s. **What paused it.** `insert`, `update` and `remove` are generators that yield between mini-transactions (`inBatches`, and every 64 rows where each row is its own), and the single-table UPDATE and DELETE pause while they collect their rows too: the statement holds the writer slot, so nothing else changes the tree. `SqlSession.steps` is `statement` for a generator, which `statement` now runs straight through; `#drive` resumes it, pausing a turn every 10 ms. A commit purges at most 1,024 undo records and the executor purges the rest a slice a turn while no writer holds the slot, since a bulk DELETE's purge, inside its commit, was as long again. And three stalls were not statements at all: `emptyText` lexed every statement to see whether it was only a comment (half of a large PREPARE), PREPARE lexed twice, and PREPARE, the client's EXECUTE and its decoding ran as one turn of the event loop, since nothing between them is a macrotask. A large PREPARE and a decode of thousands of parameters now pause after themselves. Run alone, the slowest round trip is under 200 ms over about 50 of them; under `npm test`'s parallel load the bound is a third of the statement's own time, so a loaded machine does not decide it. `SLICE_MS = Infinity` fails it (562 ms of 818), and so does dropping the ended-session check, in both companion tests: a closed connection's statement, autocommit or in BEGIN, leaves nothing and frees the writer, and a database closed mid-statement reopens empty. **Erratum, same day:** the budgeted purge let one step spend past its budget, so a budget that ended inside a transaction's last step freed its log and still reported the budget spent; the transaction stayed in the history, and the next purge freed the same pages again. Prisma's census found it, 198 tests passing where 1,113 had: the allocator's first double free corrupted every database after it. Each step now stops with its budget (`engine-purge.test.ts`), and the crash suite purges in small budgets between its steps as the executor does, which finds the bug in its first run without the fix **Metadata delivery followed (2026-10-10).** PREPARE can return 32,000 parameter definitions before any row runs. Initial packet lists now yield every 512 packets inside the same serialized feed; a closed connection stops sending, and an abandoned stream is finalized. A dedicated PREPARE probe failed before the fix with only one answer from the second connection and passes cold and warmed afterwards, with the original latency bound unchanged. A close after the 1,000th metadata packet produces no later output and ends its session once |
| M5.38 | **A read pauses too.** A B+tree scan notices a change made while it was paused and finds its place again by key, so a SELECT can yield between rows without the single writer's protection | engine, core | [26](./26-redo-and-recovery.md) | M5.37 | ☑ | a scan paused on a leaf that another transaction then splits and merges returns exactly the rows its view sees, and removing the re-seek fails that; a 32,000-item IN-list SELECT meets M5.37's latency bound **Done.** The journal counts the mini-transactions it commits; `BTree.entries` notes the count when it reads a leaf, and if it has moved before the next, finds its place again from the root by the last key it handed out, and hands out nothing at or before it. A query's result set is collected in steps of 256 rows (`resultSteps`) under the same driver as a write's. **The test had to be found.** The first two versions passed without the re-seek. Under an open view a delete only marks its rows, and a split leaves every sibling link pointing at a leaf that still holds what it held; so only purge, which may remove rows deleted before the view, frees a leaf a paused scan is about to follow, and only a freed page taken again by new rows makes that link lead elsewhere. A search over scan positions and delete ranges found such cases: without the re-seek the scan lost or repeated rows, and with it every case agrees. The engine test is one of them, and the latency test runs a 32,000-item IN-list SELECT under M5.37's bound |
| M5.39 | **The query API's types.** `query<T>()` and `execute<T>()` are generic, `createStream()` returns a type `mysql2` accepts as a stream, and an option `open()` does not honour is refused rather than ignored | core | [42](./42-public-api.md) | M5.36 | ☑ | doc 42's TypeScript example typechecks verbatim, the tests' 61 `createStream() as never` casts are gone, and `MySQL.open(':memory:', { timeZone })` rejects **Done.** `query<T>()` and `execute<T>()` take the rows' type on `MySQL`, `Connection` and `Transaction`, unconstrained as `mysql2`'s is, so doc 42's `interface User` needs no index signature. `api-types.test.ts`, part of `npm run typecheck`, holds doc 42's example verbatim, and a `@ts-expect-error` proves `T` is not `any`. `createStream()` is typed by the host: `@myjs/core` imports `#host`, whose conditions choose `host/node.ts` (a `Duplex`) or `host/browser.ts` (Web Streams), in place of a `browser` field and a run-time sniff of `process` (D-78). The 61 casts were 63, and needless all along: `mysql2` types `stream` as `any`. `sqlMode`, `characterSet`, `collation`, `timeZone` and `readOnly` were accepted by `open()` and read by nothing; they are out of `MySQLOptions`, and passing one from JavaScript is ER_NOT_SUPPORTED_YET |
| M5.40 | **`db.stream()`**, and the streaming `execProtocol` Q-11 asks for: rows handed out per batch from a statement that pauses (D-77), never a materialised result set | core, protocol | [42](./42-public-api.md) | M5.38 | ☑ | iterating `db.stream()` over 1,000,000 rows keeps the heap within a fixed bound over its baseline, and breaking after ten rows frees the connection and the writer. Pinned to 0.4 **Done (D-85).** Measured by `db-stream.test.ts`: a 1,000 × 1,000 cross join streams its million rows with the heap at most about 4 MB over its baseline. Held whole, the same rows take about 285 MB, and the test fails when the executor is made to collect them, so its 16 MB bound is not a guess. Breaking after ten rows of `FOR UPDATE` lets another connection write at once, under a lock timeout of one second; with `steps()` rolling back only on a throw, the write times out with 1205. **Every hop pulls.** The executor's `resultSteps` hands each 256-row batch to `emit` and keeps none. The dispatcher sends the head at once, then each batch only when the connection asks. The connection waits while more than 64 KiB is queued and unread, if its transport reads as it writes. The Node `Duplex`, the browser's `ReadableStream`, TCP and the client each stop taking when their reader is full. So `mysql2`'s `query().stream()` streams too, over either host and over TCP. **What it found.** The latency test caught the first draft: a batch handed out at every pause hid the clock, and the stream never yielded the loop. A server sends each row as it reads it, so a failure part way now comes after the rows read before it, exactly as 8.4.11 sends them at the 1st, 100th and 700th rows. Joining packets with `push(...packets)` overflowed the stack at a few hundred thousand rows, a latent bug that streaming would have hidden for single statements. It is a loop now, with a test that fails on the old code. Profiling a million rows found the protocol allocating a `DataView` and a `Writer` per row, and calling `TextEncoder` for every number's three bytes. Framing without a `Writer`, lazy views and a short-ASCII path took `query()` of a million rows from 11.4 s to 3.9 s. An async generator's `yield` costs several promises a row, which is three times the cost under async-context tracking (APM tools, `node:test`). So rows are handed out of the batch in hand by `RowStream`, at one promise a row: `db.stream()` reads a million rows in 3.5 s. **Named.** An error on the first row is answered with ERR alone, where 8.4.11 sends the column metadata first; which errors the server raises before its metadata is the optimizer's business (a constant subquery is evaluated there). A sort, hash build, temporary table or window reads its input whole before its first row, bounded by memory until M5.23 |
| M5.41 | **A package that installs.** `myjs`, a facade over `@myjs/core` with `myjs/server`, and every package packed as JavaScript and declarations, since Node strips types only outside `node_modules` (D-79) | all | [42](./42-public-api.md) | M5.39 | ☑ | CI packs every package, installs the tarballs and `mysql2` into an empty project, and runs a smoke test there: a directory database, `db.query()`, `mysql2` over `createStream()`, `serve()` over TCP, and doc 42's typed examples through `tsc`; pointing `exports` back at `src/` fails it |
| M5.42 | **The planner slice's review**: what a review of `core/src/sql`, the engine and the type codecs found, fixed before the refactor begins | core, types, engine, bytes, protocol | — | — | ☑ | each finding is a test that fails on the code before it (`mysql2-review-m542.test.ts`, `engine-undo.test.ts`), with 8.4.11's answers asked first. **What it found.** A row's hash key joined values with `\|`, and a `latin1_bin` sort key is the text itself, so `('x\|sy','z')` and `('x','y\|sz')` were one row to DISTINCT, UNION, GROUP BY and COUNT(DISTINCT); each part is now behind its length. A length argument folded at compile time ran with no session, so `LEFT('abc', CONNECTION_ID())` was 1815. LIKE recursed once per character, so a 100,000-character value overflowed the stack; it is an iterative matcher that backtracks only to the last `%`. GROUP_CONCAT cut its bytes and decoded them as UTF-8 whatever its charset, so latin1 came back as `???,`, and a binary GROUP_CONCAT could not run at all (1115); it now cuts text at a whole character in its own charset and joins binary as bytes, cut anywhere, as 8.4.11 does. A JSON container nested in another could not pass 64 KiB, because the encoder used a `RangeError` as control flow and retried only the top level, which also encoded every level twice; each container now chooses its own width once. The undo reader allocated a length read from the page before checking it, and a roll pointer was read with no bounds check, so corruption could surface as a raw `RangeError` (ground rule 5). **What 8.4.11 taught.** An expression default, `DEFAULT (…)`, is not in the row until it is taken. A VALUES expression that reads it first reads NULL, and a row that is given the column never evaluates it, so it never warns or fails for it. A literal default is in the row from the start. The executor had treated only a default that reads the row that way. INTERSECT and EXCEPT keeping a hex literal's flag, which UNION strips, was probed and agrees in every form a client can see, so it is unchanged. **What the instrument taught.** The latency test asserted that each statement took over 300 or 500 ms, "long enough for a stall to show", which would fail the day the engine got faster. What it needed is that the second connection was answered at least three times during the statement, and `SLICE_MS = 1e9` fails that. **Not changed:** a bound `?` still reads NULL when a length is folded at compile time, as before. Whether 8.4.11 resolves `LEFT(s, ?)`'s width from the bound value was probed afterwards: it does not. `LEFT(s, ?)` over a VARCHAR(20) is 80 bytes wide, the column's own width, against 12 for `LEFT(s, 3)`, and RIGHT, SUBSTRING, REPEAT and LPAD with `?` are as wide as theirs, which ours already were, so `constantInt` stays as it is (the last test in `mysql2-review-m542.test.ts`) |
| M5.43 | **One plan tree** (D-81): a SELECT planned into nodes named as 8.4.11's iterators are named, one interpreter that runs them, and metadata read from the tree | core | [03](./03-architecture.md) | M5.42 | ☑ | every committed corpus agrees exactly as before, and no plan decision (`chooseAccess`, `eqRef`, `chooseCovering`, `chooseStrategy`, the temporary-table rules) is made outside the tree's builder. **Begun by M5.44, at the cheaper end.** The plan is described from the decisions that run it (D-81), in `explain.ts`'s `PlanNode`. A base table's access is decided by one function, `leafAccess`, which both the row reader and the description call. Grouping is described from the strategy `chooseStrategy` picked, DISTINCT and the sort's stream from the flags that set the metadata, and an empty result from `optimizerFacts`, which until now fed only the metadata. **What remains** is the half that would make the tree the program: execution as an interpreter over `PlanNode`, rather than generators the description mirrors. The cost model (M5.7) needs that, since it must be able to choose between trees **Done (2026-10-09): the tree is the program.** The FROM's plan is a tree of iterators (`from.ts`'s `Op`): table access, Filter, hash join, nested-loop lookup and LATERAL. Each one's `rows()` and `describe()` are one object, so EXPLAIN prints what ran (D-82). Above the FROM, a query's HAVING, windows, ORDER BY with DISTINCT, and LIMIT are `Stage`s of the same kind (`pipeline.ts`). Every `explain()` that mirrored a `rows()` is gone; a set operation's description is built from the same structure its rows are.<br>**What changed in running:**<br>- The WHERE is applied by the FROM, each conjunct where the server places it, with MySQL's AND: stop at FALSE, carry on past NULL. Every corpus's warning counts still agree.<br>- A LEFT JOIN over a unique key runs as the nested loop it was always described as. With one match at most per outer row, the order is the same.<br>- A read in an index's order no longer sorts again, and an ORDER BY … DESC reads the index backwards. That was a correctness fix: ties in a non-unique key now come out in descending key order as 8.4.11's do, where a stable sort of an ascending scan reversed them (`mysql2-reverse-index.test.ts`).<br>**What the tests caught:**<br>- A sort skipped under windows, which reorder the rows first.<br>- Sending an equality that cannot key our hash, across collations, to a Filter instead of to the join that owns it, which cost 14 plans until it was put back |
| M5.44 | **`EXPLAIN FORMAT=TREE`** from the plan tree | core | [42](./42-public-api.md) | M5.43 | ☑ | the relational corpus's "Plans agreeing" tally is non-zero and ratcheted by its test, comparing `planSkeleton`'s form of each plan: **1,712 of 2,248** agree, and `relational-vectors.test.ts` fails below that. The answer is 8.4.11's shape: one VAR_STRING column, `EXPLAIN`, 78 characters, NOT NULL. Other formats, ANALYZE and the plan of a write are refused with 1235. `npm run plans` lists where the plans differ, most common first. **What 8.4.11 taught.** A condition on one table is placed at that table, under the join (`Filter` beneath `Inner hash join`). An equality between the two sides is the hash join's key, not a filter. A hash join prints its probe side first, then `Hash` over the build side. An ORDER BY over a prefix of the clustered key reads the index in order and sorts nothing. A chain of one set operator is one temporary table: branches after its last DISTINCT are written under `Disable deduplication`, and a UNION ALL nothing sorts or limits is `Append`. A subquery is `Select #n`, numbered by its SELECT's place in the text, under the Filter for a WHERE subquery or after the plan for a select-list one. **What it found.** Once our plan agreed with the server's, the replay compared those rows in order, 215 queries where it had compared none. Three statements in the JSON corpus then disagreed: ties under ORDER BY over JSON (E-22). Planting "matches oldest first" in the hash join now fails 10 corpus statements; the M5.7 note records that only `mysql2-join.test.ts` saw it before. Printing a hash join's sides the other way round fails 13 statements on order as well as the count, because a plan that claims what did not run makes the rows be compared in an order they do not have. **Left to M5.7:** the remaining 536 are plan choices, not descriptions. They are join order, `ref` access for a correlated equality, single-row lookups through USING and NATURAL (which `eqRef` does not recognise), semijoins, constant tables read ahead, and a covering index for an ORDER BY |
| M5.45 | **Persistent index statistics** (D-82, planned): `n_rows` and each key prefix's `n_diff`, written by ANALYZE TABLE in its own transaction | engine, core | [27](./27-data-dictionary.md) | M5.43 | ☑ | after ANALYZE, SHOW INDEX's cardinalities and `INFORMATION_SCHEMA.STATISTICS` agree with 8.4.11's on the relational corpus's tables without a rescan. **Probed (2026-10-09).** After ANALYZE, 8.4.11's `innodb_index_stats` holds exact counts for an eight-row table: `n_rows` 8, and each prefix's `n_diff` with NULLs as one value (`grp` over 1, 1, 2, NULL, NULL, 3, 3, 3 is 4). A secondary index's prefixes run on through the clustered key behind it (`grp`'s `n_diff_pfx02` is (grp, id), 8), which `keyCardinalities` does not count yet. Before ANALYZE, under `STATS_AUTO_RECALC=0`, every figure is 0, which is why the corpus runs ANALYZE after loading **Done (2026-10-09).** The decision planned here as D-82 is D-83, since D-82 went to the plan tree. ANALYZE TABLE counts each index's `n_diff` by prefix, a non-unique key's on through the clustered key, and stores them with the row count in the table's definition, in a catalog transaction of its own. So they persist as the catalog does, and a TRUNCATE or an ALTER drops them, as InnoDB's are reset. There is no separate system table: the figures belong to one table's definition and change only when it does. **Readers.** The optimizer reads rows per key (`stats.ts`): the stored figures for a `STATS_AUTO_RECALC=0` table (one row per key before any ANALYZE, as InnoDB's empty statistics give), and figures recomputed once a tenth of the rows have changed for any other, which is the state the server's background recalculation settles to. The row count is always live. SHOW INDEX and `STATISTICS` read the server's statistics cache, which the probes showed is not the statistics. It is written when first read and by ANALYZE, and kept through growth and through TRUNCATE (`mysql2-statistics.test.ts`). A never-analysed table shows 1, InnoDB's live rows over rows-per-key with no `n_diff`. `keyCardinalities` and the run flag that made SHOW INDEX alone count keys are gone, and `INFORMATION_SCHEMA.STATISTICS` no longer says 0. SHOW CREATE TABLE prints `STATS_AUTO_RECALC` when it was written. **What the probes taught.** `rec_per_key` is a float, and ties turn on it: 4 rows over 3 values is 1.3333334. The cache, not the statistics, is what a client sees: a table grown after its first SHOW INDEX shows its old figures until ANALYZE. The script's relational schema (latin1 and `_bin` keys, NULLs, a two-part key) agrees key for key |
| M5.46 | **Join order by cost, and the operators' speed** | core, types, engine | — | M5.7 | ☑ | `lt JOIN kl ON lt.n = kl.g` runs as `kl, lt`, as 8.4.11 runs it. The plan also makes these faster: a hash join that hashes (today an O(n·m) loop), collation resolved at compile time, top-k under LIMIT, hashed uncorrelated IN subqueries, and one tree descent per row write. `npm run bench` records each change's figures **The speed half is begun (2026-10-09), measured by `npm run bench`.** These are best-of-5 timings in ms, the last commit and this one run back to back on one machine; the machine varies by about ±30% from run to run, so only the large moves are claimed.<br>- **A hash join that hashes.** The build side is bucketed by `rowKey` over the equi-join columns and a bucket is walked newest first, so the order is D-75's. The full ON is still evaluated, and a key is used only where an equal comparison always means an equal key: two exact numbers, or two strings under one collation. Inner 567 → 80, left 461 → 26.<br>- **IN and NOT IN over an uncorrelated subquery** read a set of its values, under the same rule and the loop's NULL logic: 2,270 → 123.<br>- **ORDER BY on a string** computes each row's NO PAD sort key once rather than encoding at every comparison: 1,221 → 457, and 1,099 → 269 under LIMIT 10. A PAD SPACE collation keeps the comparator, since a key without the column's width cannot express its padding (D-35).<br>- **LIKE** keeps each character's equality key per collation across rows: 467 → 113.<br>- **The engine.** A clean page's change is tested with a word compare that stops at the first difference, not a full diff thrown away. A binary search compares keys in place, not through a `subarray` per probe. An internal page is read once per level on the way down. An unversioned tree no longer descends just to find nothing to upgrade. INSERT of 5k rows is about 15–20% faster, inside the noise of a single run.<br>- The IN-list and MATCH caches are keyed on the statement's memo, so a correlated subquery no longer rebuilds them for every outer row.<br><br>**Not done:** join order, top-k under LIMIT, a write in one descent (it would write undo pages while a leaf is held mid-write), compile-time collation for `=`. **Found by M5.7's cost model:** a covering index lookup reads each entry's clustered row, because a secondary key holds collation weights rather than values, so the server's plan for `c JOIN p ON p.g = c.qty` costs 513 ms where the hash join it replaced cost 57. Index hints (`USE`/`IGNORE`/`FORCE INDEX`) are parsed and ignored by every access decision<br><br>**Done (2026-10-09).** Join order is M5.7's cost search, and the corpus's five `lt JOIN kl ON lt.n = kl.g` statements all run in 8.4.11's order, plan for plan. Top-k under LIMIT is a stable insertion into the first *k*. Comparisons of text resolve their collation once a site and encode a constant once, not once a row (`textComparer`): `s = 's123'` over 20k rows 137 → 117 ms, inside the bench's noise for a column against a column. **The oversized functions are split by family**, each family with one helper for its shared preamble:<br>- `builtinFunction` into text and numbers, control flow, information functions, regexp and the clock.<br>- `temporalFunction` into parts, text and seconds, and arithmetic.<br>- The string library's number functions, its hashes, lists and conversions, each its own compiler.<br>- `insert`'s choice of what it writes is `insertSource`.<br>The largest of them went from 513 lines to 263, and every function corpus is unchanged. `planGrouped` is left whole: its phases share most of their state. **Moved to M5.50:** a row write in one tree descent, which would write undo pages while a leaf is held mid-write, and so waits on an engine change and a clean crash suite at 10,000 points. The bench is within its noise of the figures recorded when this item began. The covering lookup join is M5.49's |
| M5.47 | **Semijoin and antijoin strategies**, as 8.4.11 chooses them: NOT EXISTS and NOT IN as a nested-loop or hash antijoin; `[NOT] IN` rewritten to EXISTS ("Limit / Filter / Filter" over the pushed equality, "Alternative plans for IN subquery" when the outer side can be NULL); LooseScan ("Remove duplicates from input sorted on"); materialization ("Materialize with deduplication"); duplicate weedout ("Remove duplicate … rows using temporary table") | core | — | M5.7 | ◐ | every relational plan using one of these strategies agrees, and `UNMODELLED` no longer lists LooseScan. Each strategy changes row order, which the corpus then checks **Begun: the subqueries it does not join (2,090 → 2,100).** An uncorrelated `[NOT] IN`, `= ALL` or `<> ANY` over one column of one table, which 8.4.11 neither semijoins nor antijoins, is now planned as it plans it. Probed over every combination of nullable and indexed, in each context: - An equality over an indexed column becomes EXISTS: a `Limit` of one over a lookup by the outer value. A unique key's lookup is `Single-row`. - Where a NULL is not as good as false (NOT IN, outside the top of a WHERE), a nullable inner column adds two Filters, and a nullable outer value adds one, over `Alternative plans for IN subquery`. Otherwise the subquery's WHERE is one Filter. - With no index leading the column, the subquery is materialized, deduplicated, and looked up by its own key. - `= ALL` and `<> ANY` are EXISTS over a scan, with one Filter or two. The two plans left choose a scan over the lookup when the subquery's WHERE ORs the column `IS NOT NULL`, a cost decision **Then costed integer NOT EXISTS (2,103 → 2,106).** One correlated integer equality with one unindexed inner integer/literal predicate now selects an indexed nested loop or a real filtered hash build through the existing preserved-side join planner. Both protocols agree on values, complete metadata and warnings; aliases, reversed equality, duplicates, NULL keys, fresh execution after writes and empty inputs are covered. An ordered hash antijoin still sorts and streams its result, as 8.4.11 does. Returning a FOR UPDATE stream releases the writer. Broader predicates, other semijoin/antijoin strategies and LooseScan remain open **Then bounded integer LooseScan (2,113 → 2,116).** A full ascending one-column covering inner index supplies ordered keys, filtered and deduplicated before outer primary-key lookups, when the existing join cost search chooses inner-first. IN and trivially correlated EXISTS share the same physical iterator and description; the logical outer scope retains its slots. Exact integer keys exclude BIT/YEAR, and one optional numeric-literal filter is supported. Live regressions pin both protocols, complete fields, warnings, duplicates, NULLs, aliases, filters, limits, fresh execution after writes, empty inputs and disabled optimizer switches. An instrumented test counts one outer probe per distinct key; early locking-stream return releases its writer. All 1,112 Windows/Docker tests, typecheck, lint, nine unchanged size gates, package smoke and 20,000 seeded executor statements pass; all seven pinned-reference corpora reproduce unchanged. Matching LooseScan plans now compare metadata and row order through both protocols, reducing the unmodelled cases from five to two. Two captured LooseScan choices still need semijoin fanout costing. Baseline/current probes leave ordered IN source-key flags for non-primary/empty outer paths open, as well as cached prepared optimizer choices. **Then bounded outer-first FirstMatch.** The shared integer candidate uses the existing join search and lookup iterator, stopping only after the first qualifying match. The outer logical slots, source metadata and index order are preserved. A counted test proves three inner records for three outer probes: one rejected duplicate, two accepted matches, and an absent key. Live 8.4.11 regressions pin query/execute fields, warnings, aliases, filtered duplicates, limits, fresh data after writes, empty inputs and firstmatch=off on a fresh prepare, where the existing DISTINCT unused-last-table lookup supplies a one-row Limit and retains source fields. Returning a locking stream closes its scans and releases the writer. Empty standalone inner ranges keep the existing path pending materialization costing. All 1,114 Windows/Docker tests, typecheck, lint, nine unchanged size gates, package smoke, 20,000 seeded executor statements and all seven pinned-reference corpora pass; the 2,116-plan floor is unchanged. **Then semijoin-specific fanout costing (2,116 → 2,118).** The existing join search separately weighs full covering-index reads, distinct-key evaluation and final outer cardinality, retaining the later lookup's original read cost. ORDER BY/LIMIT reach the search before it chooses a plan. Live query/execute regressions reproduce captures 149/248 and cheaper FirstMatch choices under an ordered LIMIT, including complete fields, warnings and uppercase column spelling. All five captured LooseScan plans agree; the last UNMODELLED escape is removed, so every replayed query compares metadata through both protocols. All 1,115 Windows/Docker tests, typecheck, lint, nine unchanged size gates, package smoke, 20,000 seeded executor statements and all seven pinned-reference corpora pass. M5.49 subsequently closes bounded outer-first ORDER BY id access and sort placement. Broader access/order costing, materialization, weedout, predicates and retained prepared choices remain open. **Shared setup reviewed.** Correlated-key extraction, local-to-logical row filling and lookup descriptions now each have one owner; original alias, residual, slot, filtering and metadata policies remain intact. A 1,124-observation audit is strictly unchanged. Fresh pinned weedout probes and optimizer traces establish small-estimate eligibility and competing materialization/FirstMatch costs; the larger prototype exceeds unchanged size caps and is not shipped. See the verified consolidation and deferred strategy evidence below. **Non-primary FirstMatch verified.** Outer-first indexed loops now accept exact integer keys without PRIMARY uniqueness; inner-first LooseScan keeps its PRIMARY identity requirement. Native captures 36/88, duplicate/nullable keys, aliases, signed/unsigned/composite keys, exact BIGINTs, retained statements after writes and early-return read/lock bounds are pinned below. The bounded unfiltered empty-inner FirstMatch repair below closes four more audit plans; broader materialization and weedout remain open. M5.47 stays partial. Bounded hash LooseScan closes eight additional base plans (272/288); switch-state updates/masks/resets/snapshots are native-backed. Materialization, broader limits and switch scopes remain open; see the verified 2026-10-12 hash section. **Bounded materialized scans are verified below.** A real eager unique build skips outer probing when empty, retains outer duplicates and competes through native costs. Disabling hashing selects a real nested scan, with one outer read per distinct inner key. Bounded inner-first hash weedout now preserves raw duplicates and tests every candidate pair while emitting each physical outer identity once. Base 288/288 and threshold 2,160/2,160 agree; the all-disabled ordered cost boundary is also verified below. Bounded repeated-scan weedout is also verified below: raw duplicates and NULL drivers reopen the outer scan, physical identities survive repeated visits, and the disabled-hash audit now matches 480/480 completely. Bounded indexed materialized scans are verified below, including source metadata and deferred strategy costs; all 234 native indexed scans match, and the 960-outcome audit improves from 534 to 768 complete outcomes. Indexed raw weedout now closes its remaining 192 plans; all 960 outcomes agree. A separate 1,920-outcome materialization-disabled sweep also agrees completely. The existing point reader streams raw drivers, skips NULL keys and checks every candidate before shared physical-identity suppression. LIMIT and cancellation close both readers. Bounded trivial EXISTS now also admits the same materialized plans; its 1,920-outcome audit agrees completely. Residual, group, nested-expression, type and temporary-table exclusions remain intact. Broader eligibility and prepared choices stay open. **Bounded materialized lookup is verified below.** Unfiltered positive integer IN now compares and executes a lazy unique build through the shared cost/build owners, under unchanged caps. Its bounded competing-cost repair retains weedout costs and outer cardinality with FirstMatch disabled; ordered empty-inner choices improve without component regressions. Broader materialization, weedout and prepared choices remain open. |
| M5.48 | **The optimizer's remaining proofs and constants**: an empty result proved across columns (`id IS NULL OR name IS NULL`) or through a semijoin over an empty subquery; an outer join whose ON is impossible, whose table is then NULL-complemented and left out of the plan; constant tables inside a join and on the grouped path; the nullability of an EXCEPT over a nested INTERSECT | core | — | M5.7 | ☑ | three fresh `capture:relational` seeds show none of these four kinds among their divergences, and `UNMODELLED` no longer lists grouping over a join reduced to one table Found by M5.13's test: a const lookup in an empty table is `Zero rows (no matching row in const table)` on 8.4.11 and `Zero rows` here **Begun (2,082 → 2,089).** Two proofs the optimizer already made were never reported in the plan. An aggregate with no GROUP BY over an input proved empty is `Zero input rows` in the Aggregate's place, with only its HAVING's Filter and its LIMIT around it. The single row is not sorted, and a subquery of its select list is dropped (8.4.11, probed for each). A const table found with no row for its key now empties the plan, as it already emptied the result: `Zero rows (no matching row in const table)`, including where an outer join's WHERE turned it inner and its ON pinned the key **Then the constant tables of a STRAIGHT_JOIN.** The optimizer does not read them ahead of the written order, but it still treats them as constants. Each is joined last as `Constant row from c1`, by a nested loop, with its own conditions folded while planning. An ORDER BY over such tables alone sorts nothing. A join they reduce to one base table groups as that table alone would, reading its index in order, so the `UNMODELLED` entry for it is gone and its metadata is compared **Then constant tables in every other join, emptiness across columns and through a semijoin, and the impossible ON (2,100 → 2,102).** Outside STRAIGHT_JOIN a const table is read ahead and is not in the plan at all: `FROM kl, pa WHERE pa.id = 1` is `Table scan on kl`, a condition over both a Filter on the other side, and a join of nothing but const tables is `Rows fetched before execution`. The optimizer already knew these tables; only the plan still joined them. An outer join whose ON can never hold drops its inner tables the same way. An OR is impossible when each of its sides is (`id IS NULL OR name IS NULL` over NOT NULL columns), but in an ON only the range proofs count, since `IS NULL` there is still a join. A semijoin over an uncorrelated one-table subquery the optimizer proves empty empties the outer query, while NOT EXISTS over one does not. What 8.4.11 does not prove was probed too and left alone: `a = b AND b IS NULL` in a plain join is a hash join there, and a LEFT JOIN whose ON pins the inner table's key is `Constant row from pa` under a nested loop, done below **Then the three fresh seeds' metadata (2,102 → 2,103).** Replaying them named the rest, each asked of 8.4.11. A set operation nested under an INTERSECT or an EXCEPT is nullable where any of its operands is; only under a UNION does a nested INTERSECT or EXCEPT narrow it. An OR rejects NULL on a table both its sides reject it on, so `WHERE ch.id BETWEEN … OR ch.id BETWEEN …` turns a LEFT JOIN to ch inner. An impossible ON condition counts only over the inner tables' columns: `p2.grp <> NULL` on the preserved side proves nothing. A DISTINCT that the range optimizer proves empty makes no temporary table, and one whose single remaining table's unique key is selected, beside NULL-complemented tables, is no DISTINCT at all. GROUP BY keys over const tables alone make one group, grouped as the rows come and never sorted, and a single const table's grouping reads its row while planning. `col IS NULL` holds its class to NULL when const tables are sought (`kl.g = ch.id AND kl.g IS NULL` is `no matching row in const table`), but not when conditions are folded, as the server does **Then a DISTINCT of constants, and the IS NULL that STRAIGHT_JOIN proves.** A DISTINCT whose items read only NULL-complemented tables is `Group (no aggregates)` over the rest, its columns' flags kept; over const tables' rows it is `Limit: 1 row(s)` over a temporary table without deduplication. Under a LIMIT the first becomes an ordinary deduplicating table, and any deduplicating table under a LIMIT with nothing sorted above it is filled only to `Limit table size`, which was missing everywhere. Under STRAIGHT_JOIN, `k1.g IS NULL` is rewritten onto the first column of its equality class in the written order, so `ch STRAIGHT_JOIN kl ON ch.qty = kl.g AND kl.g IS NULL` over a NOT NULL `qty` is impossible; with kl first, or without STRAIGHT_JOIN, it is a hash join **Then how const tables are found.** A const table's columns are constants once its row is read, so a table whose key they hold is const too, to a fixed point: `q JOIN p ON q.n = p.id AND p.name = 'x y'` reads p by name, then q by `p.id`, and is `Rows fetched before execution`. Under STRAIGHT_JOIN a table's access is the first key, PRIMARY first, whose parts are all bound, by constants or by the tables before it, and only one bound by constants alone makes it const: `q STRAIGHT_JOIN p ON q.n = p.id AND p.name = 'x y'` looks p up by its PRIMARY KEY. The run of const tables a STRAIGHT_JOIN begins with is read ahead and absent from the plan, and the rest are constant rows. `IS NOT NULL` rejects NULL, so it turns an outer join inner, and a GROUP BY key that the WHERE holds to a constant is no part of the temporary table's key over a join **Done: an outer join's constant row, and the seeds clean.** An outer join's single inner table whose ON holds its PRIMARY or NOT NULL UNIQUE key to constants is read once, as `Constant row from p` under a nested-loop left join, NULL-complemented where the rest of its ON fails. `IS NULL` holds a class to NULL only for a PRIMARY KEY: over a unique key it is a lookup. Replayed whole, the three fresh seeds' remaining divergences are M5.47's antijoins and M5.49's grouped-path, sort-first and ordering choices, plus ROLLUP over a join through a temporary table, recorded for M5.49. None is one of this item's four kinds |
| M5.49 | **The access paths left**: index merge ("Sort-deduplicate by row ID"); ranges over more than an index's first column; derived condition pushdown (a Filter inside its Materialize); a sort of the first table ahead of any nested-loop join; the grouped path's choice of index, range or temporary table; index hints, today parsed and ignored; a materialized derived table read by `<auto_key0>` for a constant equality (`WHERE rn = 1` over a window function's derived table), with the key flag it gives the column; a covering read that skips the clustered row, which needs a secondary key that holds values rather than collation weights; the order of ties under `ORDER BY … LIMIT`, which 8.4.11's bounded filesort selection can reorder (priority queue or nth-element preselection) (`ORDER BY g LIMIT 4` over ties gives ids 5 8 2 9 there, where our stable top-k gives 2 5 8 4, a full sort's first rows) | core, engine | — | M5.7 | ◐ | every relational plan of these kinds agrees, `ORDER BY … LIMIT` over ties returns 8.4.11's rows in its order, and `npm run bench`'s covering lookup join is within twice its hash join **Partial; current verified boundary.** Grouped COUNT condition pushdown moves one bounded comparison into HAVING before materialization. First-table group sorts and outer-first semijoin sorts run before dependent lookups; logical projection slots remain unchanged. Ordinary and semijoin reads share paired index/direction selection. Full secondary and appended PRIMARY parts supply compatible uniform or mixed SQL/schema orders; prefixes cannot falsely cover or order full columns. Counted ordered scans stop at LIMIT plus OFFSET and close on return. The shared sorter caches keys once per row. Whole fixed-integer reads keeping fewer than 16 rows use bounded queues with native fixed-slot ties; non-queue selection reproduces in-memory integer buffers of at most 16 rows through median pivots and a depth-limited heap fallback. Unknown layouts retain stable fallback order. Count plus OFFSET drives non-grouped empty proofs; zero offset skips initialization and positive offsets retain required sort effects. Bounded unordered DISTINCT fills its actual temporary table up to the required unique row and omits GROUP_FLAG; unlimited copies retain it. Ordered DISTINCT projects and deduplicates before sorting selected aliases, positions and columns through immutable copied slots. Constant-row copied metadata is checked afresh per transaction. Native regressions pin 520 query/execute observations; counted query/execute/stream checks cover read bounds, warnings, source closure and writer release. All 1,143 Windows/Docker tests, typecheck, lint, nine unchanged size gates, package smoke, 20,000 seeded executor statements and seven pinned corpora pass. Core is 334,345 B and facade 334,260 B gzipped. Captured fixtures, size ceilings and the 2,118-of-2,248 plan floor are unchanged. The preceding commit passed every required GitHub job. The unchanged 572-observation probe now matches every outcome completely; its final 24 duplicate-source-field metadata differences are repaired. Bounded single-table scalar DISTINCT admission now rejects missing selected columns with native 3065, after all names resolve, under ONLY_FULL_GROUP_BY and even at zero counts. Resolved slots, constant classes, byte widths and original-literal COLLATE wrappers establish equality without evaluating calls. The 374 new native protocol checks cover full outcomes, SQL-mode admission and literal identity; counted rejected statements never initialize their scan or evaluate warnings/effects. Shared AST, typed proof readers and candidate scoring retain their boundaries. The 408-observation probe closes 72 missing rejections; six correlated cases remain. Prepared arithmetic metadata and SQL-mode-off metadata/order choices remain separate. Repeated SIGNED casts now sort copied slots when stricter deterministic/literal identity and complete key coverage are proven; volatile calls decline reuse, and fallback keys retain their evaluation path. The shared ORDER BY reader keeps grouped/window contexts and positional errors. There are 364 complete native outcomes, four fresh-value executions after writes, two limited literal-case boundary checks and thirty added counted scan-closure cases. The repeated-CAST slice closed 16 warning gaps in that matrix; source-field flags are now repaired. The preceding CAST repair closed 64 complete outcomes and warnings in 24 duplicate-computed-field outcomes; the source-field repair brought the 442-expression matrix to 310 full matches; the deterministic cast-field repair reaches 334. Duplicate selected source fields now share first-only GROUP_FLAG by resolved local slot, preserving per-output metadata and separate computed/volatile evaluators. There are 564 complete native query/execute outcomes, one PREPARE metadata check, four executions after fresh writes and 45 added counted source-closure cases. Shared metadata reporting, window marking, field resolution and LIMIT parsing remove duplication without changing execution boundaries. The 648-observation probe closes all 242 metadata differences; 584 match fully, with 64 pre-existing pinned/const-table and repeated-PK mixed-direction plans still open. Duplicate root SIGNED casts now share first-only GROUP_FLAG under a separate field identity contract, which folds literals while retaining every evaluator. Copied-value identity keeps exact strings; admission, copying and field membership have named modes. Explicit collations, literal classes, local depth and placeholder indices remain conservative. There are 828 full native protocol outcomes, one PREPARE check, four cached executions after writes, eight star/error outcomes and 45 added counted closure/warning cases. Shared SELECT expansion, window contexts and execution environments remove duplication while retaining error order and fresh transaction facts. The new 900-observation probe closes 385 metadata mismatches, reaching 860 full matches with no regressions; twelve introduced-literal flags and 24 const-table plan/warning outcomes stay open. Five older probes are unchanged; the 442-expression matrix closes another 24 flags. Ordered-access selection now retains only the first occurrence of each resolved local column and its direction; qualification and alias/ordinal binding retain their normal authority. All existing source, prefix, scope, direction and preference guards remain. Computed/volatile keys and different fields after a PRIMARY key keep their original sort/evaluation paths. The 384-outcome probe reaches 380 full matches, closing all 240 plan and four row-order differences without regressions; four selected-CAST OFFSET warning gaps remain outside this proof. Tests pin 372 complete native outcomes, PREPARE metadata and six cached executions after writes; mixed text/composite-index tests add 576 native outcomes under both ordering preferences, 48 counted LIMIT/OFFSET reads and eight locking stream returns. The 648-source probe closes ten more plans and reaches 594 full matches, leaving 54 pinned/const-table plans. Six other probes are unchanged. Ordinary ordered-index reads now apply their existing LIMIT/OFFSET iterator before SELECT projection, preserving WHERE evaluation and leaving DISTINCT, HAVING, windows and semijoin/sorting paths at their existing boundaries. Generic LIMIT preserves its Rowed inputs directly, removing two wrapping iterators; the grouped planner requires the facts its one caller already supplies. The 392-outcome boundary probe closes 67 full mismatches and reaches 317 full matches with no regressions. Permanent tests pin 266 complete native outcomes, twenty delivered-row JSON diagnostics, PREPARE metadata, six fresh cached executions and six positive-count WHERE/SELECT warning sequences. Counted checks cover 32 bounded/exhausted scans, sixteen zero-count guards and four locking stream returns with writer release. The repeated-order matrix now matches all 384 outcomes; all seven older DISTINCT probes are unchanged. The shared JSON diagnostic repair now restores the supplied INTEGER kind; DOUBLE/DECIMAL/non-JSON controls and fresh cached execution are pinned separately under M5.10. **Current function boundary:** the complete shared binary reader is verified; BLOB/CONCAT, IF/CASE, IFNULL/COALESCE, scalar strings, ANY_VALUE string prefixes, NULLIF original-argument readers, CHAR/BINARY cast prefixes and non-temporal string extrema are verified; INTEGER complement-range facts, nonbinary diagnostic normalization and capped complete-character boundaries now agree; warning emission now agrees across every text class; binary expression/introduced-literal casts now share the verified fact; direct binary-column CAST conversion, DATETIME grammar and wide COLLATE/HEX/CONCAT now agree. Keep packet-overflow values, result charsets, warning escaping, IF derivation and function admission separate. Broader OFFSET projection through DISTINCT/HAVING/sorting, sixteen exhausted positive-OFFSET binary cast warning outcomes, LIMIT 0 with positive OFFSET WHERE initialization, prepared CAST parameter nullability, correlated-subquery metadata/plans, missing DATE deprecations remain open. Incomplete key coverage, literal-case warning ordering, const-table warnings/effects, volatile copied fields and broader computed-field metadata remain open. The 442-expression probe still exposes other repeated-expression classes, other computed-field metadata, RAND copied-field flags, effects after unique-key elimination and broader DISTINCT ORDER BY admission gaps. The bounded different-collation rejection is verified; other classes need independent proofs. Another 158 type/case-fold observations are unchanged from the preceding commit; 146 match native, with 12 pre-existing BIT copied-field/type and pinned-column grouping-plan differences recorded separately. Larger queues/layouts, spilling, grouped/window initialization, broader costs and hints, actual covering storage reads, COUNT conversion warnings and window/HAVING materialization plans remain open. Physical single-source DISTINCT omits global row-key state when expanded, resolved local fields include a whole PRIMARY or non-null UNIQUE key. Indexed prefixes, outer fields, computed casts and nullable UNIQUE keys cannot supply that proof. Metadata uses the same expanded local fields and accepts a visible indexed prefix, without a raw-star shortcut. The wildcard repair improves 139 to 223 complete matches out of 297, closing 78 field mismatches without component regressions; a retained-statement write probe agrees on all 260 records. The earlier 130-record UNIQUE audit improves 46 to 58 full matches and 106 to 118 matching fields. Covering-star reads now use explicit source-column sets, removing the real-column `all` sentinel collision. Full secondary coverage is admitted on hidden-row-ID tables; prefix and invisible indexes remain excluded. Whole-key UNIQUE projections may reconsider PRIMARY ordering through the existing physical proof. The 292-record audit improves 163 to 250 complete matches, closing all 69 row-order differences without component regressions. Bounded unordered DISTINCT now requires whole-key uniqueness to avoid copied fields; indexed prefixes retain their unbounded/ordered metadata proof. A 2,160-record nine-key/cardinality/LIMIT audit improves 1,671 to 1,827 full matches and 1,854 to 2,115 matching fields without losing a matching component. All 732 parameterized retained-statement records agree across writes. This also closes six earlier base and twelve fresh execution-field gaps, improving their full agreement to 256/292 and 260/260; prior wildcard results improve 244 to 250/297. Another 1,264 older observations and the UNIQUE audit are strictly unchanged. Secondary scans still fetch clustered values; storage-level coverage, invisible-column admission, ORDER BY NULL copying/sort admission, high-fanout skip dedup, correlated execution metadata and broader plans remain separate. Historical slices are in doc 45. |
| M5.50 | **A row write in one tree descent**: insert, update and delete find the leaf once, the undo written before the leaf is held (a `BTree.upsert` that answers the old value) | engine | [26](./26-redo-and-recovery.md) | M5.46 | ◐ | `npm run bench`'s INSERT of 5k rows is faster than the figure M5.46 recorded by more than the bench's noise, and `CRASH_POINTS=10000 npm run test:crash` stays clean **Native writes migrated.** Clustered INSERT, UPDATE/delete-mark and secondary insert/delete-mark use prepared upsert; required unique-prefix scans precede secondary mutation. NativeTable obtains old fields from the actual mutation, preserving same-key replacement, changed-key delete/insert, secondary sequencing and hidden IDs. Existing boolean APIs remain. Keys and old bytes are copied; the read pin is released before overflow/undo writes. Handles sharing a journal/index refuse row-write reentry; callback failures roll back preparation. Undefined means no replacement, distinct from empty bytes; absent/marked updates and deletes add no undo/ROW event. Returned fields cannot alter pending ROW images inside an outer batch. Tests count one descent after required uniqueness scans, forbid map get/put re-descent and table current rereads, and cover NULL/PAD SPACE uniqueness, tombstone reinsertion, duplicate refusal atomicity, copied fields, ROW images, overflow history/rollback/purge and schema-growth splits. A repeatable-read reader becoming a writer maintains secondaries from the latest row despite its older snapshot. All 1,110 Windows/Docker tests, typecheck, lint, unchanged size gates, package smoke, 20,000 seeded executor statements and 10,000 crash points pass; the final 61 focused Docker tests pass too. Three alternating paired best-of-five INSERT runs measure pre-M5.50 at 40.3/39.0/42.8 ms versus current 42.7/42.2/42.7 ms, within the documented ±30% noise. The upgrade owner now reports whether topology stayed in place: prepared upserts reuse their descended path for in-place rewrites, retaining root restart after rebuilding/splitting. Exact fetch checks cover root/two/deeper-level inserts and replacements, no-op WAL, detached keys/old values and zero callback pins. Codec/preparation failures roll back other writes, replacement growth propagates actual splits, and every storage write of targeted root/deep upgrade-and-split workloads recovers a whole before/after state under process/power loss. All 1,275 Windows/Docker tests, 65 focused engine tests and 10,000 crash points pass with all usual gates. Paired best-of-five INSERT runs measure preceding/current at 44.4/48.2, 42.6/49.8 and 41.9/42.8 ms, within the documented ±30% noise; the performance criterion remains unmet. The existing preparation guard now also protects Store destruction before generation, directory, counters, allocation or cache changes. Direct/nested and alias preparations refuse own-tree drops for replacement/no-op callbacks, roll back independent writes, clear both guards after failure, permit caught refusal followed by success and independent-tree drops, and reopen with the expected persisted rows/counters. All 1,277 Windows/Docker tests and 10,000 crash points pass with the usual gates. The helper remains internal; no public API or additional registry is added. Three isolated Docker CPU profiles attribute 0.59/0.66/0.73% of sampled time directly to engine search calls; inlining may attribute work elsewhere, so this is not a precise bound or a speed comparison. The evidence does not justify retaining another search result. No optimization is shipped, and the performance criterion remains unmet; return to captured planner strategy gaps. Store rollback/purge reopen trees at version zero; transactional schema upgrades need shared durable schema ownership. Native SQL tables use zero, and generic BTree upgrade/split fallback is verified |
| M5.51 | **The JSON functions that change a document**, and JSON_TABLE: JSON_SET, JSON_INSERT, JSON_REPLACE, JSON_REMOVE, JSON_ARRAY_APPEND, JSON_ARRAY_INSERT, JSON_MERGE_PATCH, JSON_MERGE_PRESERVE, JSON_QUOTE, JSON_SEARCH, JSON_VALUE, JSON_PRETTY, JSON_STORAGE_SIZE; JSON_TABLE, refused by the parser today. Split from M5.11, whose done-when they were never part of | core, parser | [28](./28-json-binary.md) | M5.11 | ☐ | a `capture:json` corpus of these functions over every JSON shape, paths and errors included, agrees with 8.4.11 whole |
| M5.52 | **`VALUES` and `TABLE` as queries**: `VALUES ROW(…), ROW(…)` alone, in a set operation and as a derived table with its column list, and `TABLE t`, both refused with 1235 today | core | [00](./00-goals-and-scope.md) | M5.4 | ☐ | a script captured from 8.4.11 of each form, metadata included, agrees statement by statement. Found while building SHOW VARIABLES (M5.13): `VALUES` is not typed as the UNION ALL it resembles. Over a DECIMAL column it sends the integer 1 as "1", not "1.0", with other flags and decimals; and a derived VALUES table's integers are INT, not BIGINT. So it needs its own item type, not a rewrite |
| M5.53 | **Stabilization review:** exclusive Node ownership, safe initialization/shutdown, serialized row reads, explicit unsupported administration errors, portable paths and validation tooling, and documentation reconciled with measured behavior | core, engine, vfs, tools | [40](./40-vfs.md), [42](./42-public-api.md), [43](./43-testing.md) | M5.41 | ☑ | targeted regressions and the full Windows/Linux test gates pass; a disposable Docker copy installs dependencies, checks packages, and compares recorded observations with pinned MySQL 8.4.11 without recapturing fixtures. No third-party runtime dependencies added. Stale locks require explicit recovery (D-87). The review also repairs joined-view introspection, large-double DIV, numeric TIME range comparisons, NULL-division metadata, CASE over ENUM/SET, and mixed DATETIME/text GREATEST/LEAST. At this review M5.2 remained partial; the subsequent coercion slice completes its captured gate. CI now runs the disposable pinned-reference verifier as a blocking job |

---

### Verified ordered-read projection boundary (M5.49)

The pinned 8.4.11 probe covers 392 query/execute outcomes: ordinary PRIMARY and
secondary scans in both directions, warning-producing constant/row casts,
seeded RAND, LAST_INSERT_ID counters, empty scans and zero/exhausted limits,
with DISTINCT, HAVING, windows and fallback sorting as separate controls.
Native SELECT expressions evaluate only the rows delivered after OFFSET;
tested constants warn per delivered row and exhausted offsets warn zero times.
RAND starts at its first seeded value and counters start at one after skipping.
JSON conversion diagnostics number delivered rows from one, independently of
their physical positions. The existing limit iterator now runs before projection only on ordinary
ordered-index reads, excluding
DISTINCT, HAVING, windows and semijoin paths. WHERE and compile-time diagnostics
retain their owners. Prepared CAST parameter nullability, correlated-subquery
metadata/plans, range/sorting boundaries, missing DATE
deprecations and positive-OFFSET zero-count WHERE initialization remain separate gaps; this proof does not waive their mismatches.

### Verified JSON numeric diagnostic boundary (M5.10)

The pinned native probe covers 150 numeric/comparison query/execute outcomes
over twelve SQL NULL/JSON value classes and five LIMIT/OFFSET tails; 124 match
fully. SIGNED and UNSIGNED casts each have six diagnostic-only mismatches:
the shared JSON reader previously renamed INTEGER to SIGNED. Another 22
outcomes confirm INTEGER for LEFT, RIGHT, SUBSTRING, ELT, CHAR, MAKEDATE and
signed/unsigned casts with or without the optional INTEGER keyword. Restoring
the supplied numeric kind fixes their warning wording without changing values,
metadata, column naming or delivered-row numbering. DOUBLE, DECIMAL and
non-JSON 1292 diagnostics need complete controls. The broader probe separately
records two DECIMAL overflow/conversion outcomes, two DIV error/metadata
outcomes and ten ABS metadata outcomes (six also differ in values); they stay
open rather than being folded into this diagnostic repair. The corrected 150-outcome
probe reaches 136 full matches without regressions. The integer-context probe
closes twenty complete outcomes; one pre-existing binary BETWEEN prepare-warning
lifetime mismatch remains (native suppresses 1235 after PREPARE). Tests exclude
that whole comparison group and pin twenty complete integer-context outcomes,
120 numeric outcomes, seventy DOUBLE/DECIMAL/non-JSON controls, PREPARE metadata
and twelve cached fresh-value executions after writes. Native negative zero is
preserved explicitly rather than being lost in JSON fixture serialization.
ABS JSON source reads are now verified below. Expression/parameter forms remain
separate diagnostic/metadata boundaries; do not broaden their repair to unrelated
DIV, DECIMAL or prepared-warning behavior.

### Verified ABS numeric boundary (M5.10)

The pinned 210-outcome ABS probe has 95 complete matches before repair. Four
nullable/NOT NULL JSON source groups expose forty incorrect result-type outcomes
and twenty-four value outcomes: ABS passes JSON through instead of returning
DOUBLE. Existing JSON-plus-zero DOUBLE inputs are complete controls. Native ABS
normalizes floating negative zero, while ABS of a converted JSON negative zero
previously kept it here; native MOD and multiplication preserve negative zero
and must keep doing so. The repair uses the existing DOUBLE reading and metadata owners for JSON and
normalizes floating ABS only. Integer, unsigned, decimal, fixed-scale, text and binary inputs have full native
controls. Grouped/
DISTINCT evaluation, JSON expression diagnostic names, unary JSON conversions
and prepared-parameter fields remain distinct boundaries until verified; unary
JSON numeric inputs now match in the bounded matrix. The 210-outcome probe
reaches 173 full matches, closing 78 without regressions; the control matrix
closes twelve floating negative-zero outcomes and reaches 140 of 150 matches.
The remaining ten control outcomes previously differed only in ABS BIT-literal
UNSIGNED flags; the existing literalInt.unsigned fact now closes them all.
Permanent tests pin 160 full JSON source outcomes, 140 complete controls,
PREPARE metadata and eighteen fresh executions after writes. Existing MOD
negative-zero expectations remain exact. The literal repair adds 224 complete
native outcomes, six PREPARE metadata checks and 54 fresh cached executions
after source writes. Empty BIT/HEX, widths through 64 bits, unary plus/minus and
signed/unsigned casts are pinned. The original 272-outcome probe closes 160
full mismatches, including eight empty-result outcomes of over-64-bit literals,
without regressions. Sixteen original COLLATE outcomes matched syntax errors:
`binary` needs quoting as a collation name. With that corrected, the matrix has
248 full matches; quoted high-byte COLLATE leaves sixteen metadata/diagnostic
gaps and over-64-bit literals leave eight value/warning gaps. Neither full
group is included in the passing fixtures. Numeric/text/binary/BIT-column
controls now match all 150 outcomes, while the 210 JSON probe and 150 numeric
probe retain 173 and 146 full matches without regressions. The shared COLLATE
metadata repair below now closes the independently measured NOT_NULL and
explicit-coercibility differences; binary warning bytes and over-64-bit
truncation retain separate boundaries.

### Verified COLLATE metadata boundary (2026-10-11)

The general COLLATE node now reports nullable results, including NOT NULL
columns and numeric/temporal expressions. One string-literal type builder owns
nullability and explicit coercibility for text, binary and introduced HEX/BIT
literals. Value and type derivation agree; uncollated literalInt facts and
literalText remain with their original owners. Introduced single-byte and
multi-byte readings now share their final type construction and one charset
lookup, preserving byte-versus-character widths, replacement behavior and
invalid-character checks.

The 600-outcome probe across literals, nullable/NOT NULL columns, parentheses,
casts, ABS and COERCIBILITY reaches 576 complete matches from 268, closing 308
without regressions. Permanent tests admit 552 full outcomes; the six groups
with binary byte/diagnostic differences remain excluded in full. Another
72-outcome probe reaches seventy matches, closing 22 without regressions, and
pins sixty complete introduced/uncollated/aggregation controls plus ten exact
native refusals. IF over binary arms still reports coercibility two rather
than native zero and remains outside those fixtures. Eight PREPARE metadata
checks and 72 fresh cached query/execute/actual-statement executions preserve
values, fields and ordered warnings across writes and NULLs. Buffer fixtures
retain exact native bytes.

The subsequent binary-value repair below now preserves the original bytes.
Numeric-warning escaping, binary IF derivation, blob-result field classes and
over-64-bit literal truncation retain separate boundaries.

### Verified binary COLLATE value boundary (2026-10-11)

Binary COLLATE now returns the existing bytesValue/valueBytes representation,
preserving bytes instead of decoding them as text. Nonbinary values, NULLs and
metadata retain their owners. The shared collation lookup resolves utf8 aliases
once and validates the source charset when one exists; native numeric and
temporal utf8 aliases now work. Unintroduced numeric HEX/BIT literal handling
keeps its original branch before introducer resolution.

The forty-outcome byte probe reaches forty full matches from 24 across every
byte, empty/NUL/invalid-UTF8 sequences, nullable/NOT NULL sources and zero-count
reads. The thirty-outcome function/alias probe reaches 26 from six with no
regressions, including dot-all regex, byte positions and 131,073-byte values.
Four regex result-field/width outcomes remain outside the fixtures in their
entire groups. All 96 numeric, temporal, NULL, text and JSON controls agree,
including eight exact refusals. Six PREPARE checks and 144 fresh cached
query/execute/actual-statement executions agree across writes and NULLs.
Permanent tests pin 306 outcomes (294 successes and twelve exact refusals)
plus those six PREPARE checks, preserving native Buffer values and all fields
and ordered warnings.

The earlier 600-outcome probe improves from 576 to 584 full matches without
regressions; sixteen warning-byte outcomes remain separate. All forty LONGBLOB
values and warnings now agree, but 32 result-field-class outcomes still differ,
so complete matches remain eight. A controls probe also found a separate parser
admission gap: SELECT DATETIME '…' AS x is accepted here but rejected with
native 1064. Without AS, the name can be a column with a quoted alias; the
valid TIMESTAMP literal controls all agree.

All 1,162 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core is 334,345 B and facade 334,263 B gzipped. Captures, caps and the
2,118-plan floor are unchanged. The preceding COLLATE metadata commit passed
every required GitHub job.

The shared string-result metadata repair below closes the independently proven
COLLATE/HEX field-class and width boundary, including the two regex-through-HEX
groups. Other regex result classes retain their own boundaries.

### Verified wide string-result metadata boundary (2026-10-11)

One stringResultType in meta.ts now owns the existing string-function result
policy and is also used by general COLLATE and HEX. Above 65,535 bytes it selects
MEDIUM_BLOB; above 16,777,215 it selects LONG_BLOB. Text blob results retain the
native byte-width reporting through the result charset. Source-column/literal
stringType, values, collation checks, NULL handling and evaluators are unchanged.
The helper builds one local result object, preserving binary derivation. Shared
integer limits replace repeated HEX/LAST_INSERT_ID bounds, and byteWidth reads
charWidth once.

The 640-outcome blob/text probe closes 224 metadata differences and reaches 592
full matches without regressions; all rows and warnings agree. The six wide
CONCAT groups (48 outcomes) remain excluded in full. The 512-outcome threshold/
result-charset probe closes 246 full mismatches without regressions, reaching
452. All 432 threshold outcomes agree across binary, utf8mb4 and latin1 operands,
including both sides of the VAR_STRING/MEDIUM_BLOB/LONG_BLOB boundaries and
existing REPEAT controls. The eighty explicit character_set_results controls
remain outside these fixtures as whole configurations: sixty field/charset
outcomes differ, and twelve binary-results row outcomes also differ.

Permanent tests pin 1,412 complete protocol outcomes: 592 blob/text reads,
432 threshold controls, 384 fresh cached query/execute/actual-statement reads
after byte/text/NULL writes, and four formerly open regex-through-HEX outcomes.
Thirty-two PREPARE metadata checks agree. Values, all ten field attributes and
ordered warnings retain exact native snapshots. The original thirty function/
alias outcomes now all agree; the forty LONGBLOB outcomes improve from eight to
32, leaving eight CONCAT fields separate. The prior 600- and 900-outcome probes
retain 584 and 860 full matches without regressions.

All 1,166 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core is 334,341 B and facade 334,263 B gzipped. Captures, caps
and the 2,118-plan floor are unchanged. The preceding binary COLLATE commit
passed every required GitHub job.

The subsequent CONCAT repair below closes its independently proven capped
metadata boundary. Packet-overflow values remain separate until verified.

### Verified CONCAT result metadata boundary (2026-10-11)

CONCAT now uses the shared stringResultType policy with capped byte sizing and
retains its explicit derivation. Wide sums select native MEDIUM_BLOB/LONG_BLOB
fields and widths, including LONG columns whose sums previously wrapped their
wire length. The change is one metadata expression; evaluator order, values,
NULLs, input conversion and source/literal types retain their owners.

The 818-outcome probe closes all 384 metadata differences. Adding single- and
three-argument reads expands it to 1,074 outcomes, all of which agree, closing
560 mismatches without regressions. Binary and text derivation, nullable/NOT NULL
sources, empty/NUL/multibyte values, explicit COLLATE, zero/exhausted reads and
both field-class thresholds are covered. All 306 scalar threshold controls
agree across binary/utf8mb4/latin1 operands, including capped sums, HEX and
COERCIBILITY. Tests pin 1,458 complete executions, including 384 fresh cached
query/execute/actual-statement reads after byte/text/NULL writes, plus 32 PREPARE
metadata checks. The fresh probe closes 195 complete differences. The earlier
640 blob/text and forty LONGBLOB outcomes now all agree.

All 1,169 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core is 334,337 B and facade 334,257 B gzipped. Captures, caps and the
2,118-plan floor are unchanged. The preceding wide metadata commit passed every
required GitHub job.

The following parser repair closes its independently proven identifier/alias
boundary. Named-argument and function-call admission retain separate contracts.

### Verified DATETIME identifier/alias boundary (2026-10-11)

DATETIME is removed from the parser's typed-literal keyword set. Existing
identifier/quoted-alias grammar now owns it, including real columns, case,
qualified names and quoted names. DATE/TIME/TIMESTAMP literals and DATETIME
casts retain their existing ASTs and behavior. No keyword-specific refusal or
new grammar owner is added.

The 88-outcome native probe improves from 56 to 82 complete matches, closing
26 differences without regressions. Native 1064/1054 refusals and real column
alias values, fields and ordered warnings agree through both protocols.
Permanent tests pin 130 complete outcomes (110 successes and twenty exact
refusals), including 48 fresh query/execute/actual-statement reads across writes,
plus four PREPARE checks. Structural AST and round-trip controls retain valid
temporal forms. Docker parser fuzzing passes one million inputs with 32,249
round trips and no crash or hang. Six outcomes remain separate: four HEX
named-argument refusal differences (native 1583) and two DATETIME-call admission
differences. Their whole groups remain outside passing fixtures.

All 1,172 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core is 334,336 B and facade 334,254 B gzipped. Captures, caps and the
2,118-plan floor are unchanged. The preceding CONCAT commit passed every
required GitHub job.

The next repair closes warned binary-column INTEGER CAST diagnostics. Numeric
field/function reads, expression sources and text remain separate contracts.

### Verified binary-column INTEGER CAST diagnostics (2026-10-11)

The shared numeric reader records cast-versus-field reading by name. Warned
INTEGER casts of binary columns retain printable ASCII, escape each other byte
as upper-case \xHH, preserve embedded NUL and cap the formatted text at 128
characters. The cap can cut an escape midway. Empty and whitespace-only binary
values warn. Numeric field/function reading keeps its existing policy; applying
cast warnings to CHAR/EXPORT_SET was rejected by the unchanged corpus and then
narrowed to the measured cast contract.

One shared escapedBytes loop also replaces the two identical charset-error
formatters, retaining their sixteen-input-byte limits. Cast diagnostics inspect
at most 128 input bytes before the formatted cap. Existing hexOf, valueBytes,
byteWidth, integer bounds and value/type text guards replace repeated local
logic. A common truncation-message builder leaves each reader's text policy
intact. FLOAT(p>24) shares DOUBLE's result closure, date casts normalize once,
and bounded CHAR casts allocate their character array once. Values, source
metadata, NULL handling and diagnostic order retain their existing owners.

The original 2,670-outcome probe improves from 1,240 to 1,586 complete matches,
closing 346 without regressions; all rows and fields agree. The 2,344-outcome
escape/length/source probe improves from 858 to 1,598 complete matches, closing
740 without regressions. All 256 A-prefixed bytes and exact printable/control/
NUL/UTF-8 and 120–131-character cap boundaries are pinned. Over-64-bit signed
CAST retains a separate extra-1105 warning gap; CONCAT/COLLATE expression
sources keep their whole incomplete groups separate. The 220-outcome text/
parameter/literal probe improves from 96 to 112 without regressions, retaining
hex-literal numeric and bound-source distinctions.

Tests pin 1,862 complete executions plus four PREPARE checks: 1,168 bounded
SIGNED/UNSIGNED byte/cap outcomes, 534 single-byte INTEGER outcomes, forty
DOUBLE/DECIMAL/ABS/arithmetic controls and 120 fresh query/execute/actual-
statement reads after byte/empty/whitespace/NULL writes. Fresh BINARY(8) padding
and VARBINARY(1024) agree. The broader 310-outcome fresh probe has 196 full
matches; small VARBINARY(10) quiet-tail and BLOB/MEDIUMBLOB CAST groups remain
excluded in full, with 114 known warning differences. Ordinary CHAR/EXPORT_SET
and the original number-warning regression retain their existing snapshots.

All 1,175 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass. Core is 334,269 B and
facade 334,187 B gzipped; captures, caps and the 2,118-plan floor are unchanged.
The preceding DATETIME commit passed every required GitHub job.

The following repair closes the independently verified direct-column CAST
conversion boundary. Function-field readers retain their existing authority.

### Verified binary-column INTEGER CAST reading (2026-10-11)

One binaryCast fact is computed while compiling the numeric reader from the
named cast context, resolved column, INTEGER kind and binary type. It bypasses
BLOB and small-VARBINARY quiet-tail suppression only under that proof and is
also passed to the existing diagnostic check. Field/function readers retain
their existing policy, and the header now qualifies empty/whitespace behavior.
No evaluator, conversion value, metadata or new public API is introduced.

The original 310-outcome fresh probe now agrees completely, closing 114 warning
differences. Adding TINYBLOB and LONGBLOB expands it to 434 full matches,
including fourteen PREPARE checks and 420 fresh query/execute/actual-statement
reads; 222 full differences close without regressions. Small VARBINARY(10),
VARBINARY(1024), BINARY(8) and every blob class retain native empty/whitespace/
NUL/UTF-8, padded, fractional-tail and NULL behavior across writes.

The cast/field probe improves from 458 to 542 of 780 complete matches, closing
84. Adding TINYBLOB and LONGBLOB expands it to 1,092 outcomes and improves from
622 to 786 full matches, closing 164 without regressions. All 364 direct CAST
outcomes agree. Ordinary field/function outcomes are unchanged, including the
separate binary-shift byte-result gap. Whole incomplete field/function groups
stay outside fixtures; 108 bounded CHAR/EXPORT_SET/arithmetic controls are
pinned separately with every field and ordered warning.

The 192-outcome cap probe improves from 106 to 178 full matches, closing 72
without regressions. All 128 direct CAST outcomes agree across VARBINARY(60000),
BLOB/MEDIUMBLOB/LONGBLOB, including 60,000 bytes and mid-escape formatted caps.
The initial VARBINARY(65535) plus PRIMARY key setup is refused natively with
1118 but accepted here; that DDL row-size admission boundary remains separate.
Permanent tests pin 1,020 complete executions plus fourteen PREPARE checks:
364 direct CAST and 108 field controls, 128 wide cap reads and 420 fresh reads.

All 1,178 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass. Core is 334,271 B and
facade 334,189 B gzipped; captures, caps and the 2,118-plan floor are unchanged.
The preceding diagnostic commit passed every required GitHub job.

**Next:** prove binary expression/literal INTEGER CAST diagnostic formatting
through the existing named cast context. The earlier 2,344-outcome probe has
1,598 full matches; CONCAT/COLLATE expression sources still expose escaping and
empty-input warning gaps, while direct columns retain their verified behavior.
A fresh 93-outcome expression-source probe has 39 complete matches, including
all three PREPARE checks; 54 execution warning outcomes remain open through
CONCAT, COLLATE and CAST AS BINARY across writes and NULLs. A 100-outcome
literal-source probe has 52 full matches and no native refusals; every row and
field agrees, while 48 warning sequences differ across introduced binary,
expression and empty-text sources. Keep nonbinary text as a separate reader.
Preserve unintroduced HEX/BIT numeric facts and keep prepared parameter expected
types separate. Before broadening the cast fact, the 220-outcome source
audit has 112 full matches. Its 88 parameter outcomes include thirty complete
query matches (twelve string, eighteen Buffer); neither execute parameter group
currently matches metadata. Values agree for all string parameters and all
execute Buffer parameters; query Buffer values agree in eighteen of 22. This
slice must preserve every existing full and component match. Remove only the
column restriction from the binary INTEGER cast fact if expression and
introduced-literal proof supports it; retain the numeric HEX/BIT guard and
ordinary field readers. Expected parameter typing remains separate. Nonbinary text diagnostics, other numeric kinds' UTF-8/NUL and
whitespace rules, binary shifts, packet overflow, explicit result charsets, IF
derivation, over-64-bit warning order, named-argument/function-call admission,
DDL row-size admission and broader regex/ICU/function behavior remain open.
M5.10 stays partial; M5.47/M5.49/M5.50 follow before browser work.

### Verified binary INTEGER CAST expression sources (2026-10-11)

The existing cast fact now uses source context, INTEGER kind and resolved binary
type without requiring a column. One shared reader handles CONCAT, COLLATE,
CAST AS BINARY and introduced binary literals. Numeric HEX/BIT facts still
bypass string diagnostics; ordinary field/function policies remain unchanged.
The reader comments now include binary expressions. No public APIs,
expected parameter types or conversion results change.

The 2,344-outcome byte/cap probe improves from 1,598 to 2,338 complete matches,
closing 740 without regressions; all rows and all ten field attributes agree.
The six remaining differences are the whole signed over-64-bit warning-order
group. All 93 fresh expression outcomes agree, closing 54, including three
PREPARE checks and ninety query/execute/actual-statement executions after writes.
The literal probe improves from 52 to 96 of 100 full matches, closing 44; its
four remaining outcomes are the nonbinary empty-text group.

The 220-outcome source probe improves from 112 to 128 without regressions.
All 88 parameter outcomes are unchanged in every component, preserving all
thirty existing full query matches. Execute parameter metadata still differs
for both string and Buffer, and query Buffer values still differ in four
observations; these are separate expected-type/serialization contracts. The
2,670-outcome other-kind/field probe is unchanged at 1,586 complete matches,
with every value and field still agreeing.

A new 96-outcome constant/empty-result probe agrees on all values and fields
and eighty complete outcomes. Sixteen warning sequences differ for exhausted
positive OFFSET, with and without a table, across four binary source forms;
record them under M5.49 rather than weakening the diagnostic reader. Permanent
tests pin 1,426 complete executions plus three PREPARE checks: 1,168 expression
byte/cap reads, 96 literal controls, 72 non-OFFSET constant/empty-result controls
and ninety fresh cached reads. Whole nonbinary-empty, over-64-bit and exhausted
OFFSET groups stay separate.

All 1,182 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Focused native tests also pass. Core is 334,271 B and facade 334,188 B gzipped.
The preceding commit passed every required GitHub job. Captures,
caps and the 2,118-plan floor remain unchanged.

**Next:** close nonbinary INTEGER CAST suppression through the same named cast
context. The new 868-outcome fresh text probe has 466 complete matches across
VARCHAR(10/1024), CHAR(8) and all four TEXT classes; every value and field agrees
through direct/CONCAT signed/unsigned casts, 28 PREPARE checks and writes. A
648-outcome text source/control/cap probe has 424 complete matches and agrees
on every value and field. Keep the text formatting cap separate: native stops
at NUL and converts diagnostics through utf8mb3 before applying its byte cap.
A further 96-outcome split-boundary probe exposes per-byte '?' substitution
and two warning groups whose native message loses its closing quote. Prove a
coherent reader contract before implementing those formatting boundaries. Audit parameters
and preserve complete and component matches before broadening another fact.
The independent reviewer approves suppression only. Before implementation,
retain the source audit's 128 full matches and all thirty full parameter query
matches; preserve every matching value, field and warning component. Generalize
the one compiled cast fact to retain its resolved string/bytes kind, using it
for field-suppression bypass and warning emission. Keep binary message selection
and default nonbinary text formatting unchanged; add no per-parameter exceptions.

Keep expected parameter types, other numeric kinds, binary shifts, exhausted
OFFSET projection, explicit result charsets, IF derivation, packet overflow,
DDL row-size admission and broader ICU/function behavior explicitly open.

### Verified INTEGER CAST text warning emission (2026-10-11)

The existing compiled cast fact now retains the resolved string/bytes kind for
INTEGER CAST. It bypasses BLOB/TEXT and small-VARCHAR/VARBINARY field
suppression, and warns on empty/whitespace values. Binary messages still use
the proven byte reader; nonbinary messages retain the default NUL-terminated
text reader. HEX/BIT numeric facts, ordinal ENUM reads, other numeric kinds and
ordinary field/function paths retain their policies. No public API, parameter
type or conversion result changes.

All 868 fresh text outcomes now agree, closing 402 complete differences without
regressions. This covers VARCHAR(10/1024), CHAR(8), TINYTEXT, TEXT, MEDIUMTEXT and
LONGTEXT through direct/CONCAT signed/unsigned casts, 28 PREPARE checks and 840
query/execute/actual-statement executions across writes and NULLs. The
648-outcome text source/control/cap probe improves from 424 to 448 complete
matches, closing 24 without regressions; all values and fields agree. Whole
utf8mb3 conversion/cap groups remain open.

The 220-outcome source audit improves from 128 to 152 complete matches with
zero full or component regressions. Short string query parameters close six
complete outcomes and reach eighteen of 22; query Buffer remains eighteen of
22. Execute warning components improve from four to eight of 22 in each group,
while every execute parameter field still differs. Values and metadata are
unchanged. The 2,670-outcome other-kind/field probe is unchanged at 1,586 full
matches, and the 1,092-outcome binary cast/ordinary-field probe is unchanged at
786; all previously matching components remain matched.

Three native tests pin 1,212 complete executions and 28 PREPARE checks: 336
short text-source/control reads, all 840 fresh reads and 36 short string/Buffer
query parameter reads. Their expected rows, ten field attributes and ordered
SHOW WARNINGS come from pinned MySQL. Long diagnostic caps and execute parameter
metadata stay outside these complete fixture groups.

All 1,185 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Focused native tests also pass. Core is 334,272 B and facade 334,190 B gzipped.
Captures, size caps and the 2,118-plan floor remain unchanged. The preceding
commit passed every required GitHub job.

**Next:** prove the nonbinary INTEGER CAST diagnostic cap at the existing reader
boundary, independently of warning emission. A 176-outcome introduced
latin1/utf8mb3/utf8mb4 and non-BMP cap probe has zero complete matches but all
values and fields agree. Native latin1/utf8mb3/utf8mb4 messages each retain only
64 repeated é characters; supplementary characters become '?' before the
128-byte cap, retaining up to 128 replacements. Keep split-multibyte substitution
and malformed native closing-quote groups explicit; do not add source/function
exceptions to match them. Preserve binary messages and all existing parameter
components while proving any formatter change. The independent reviewer approves a
local nonbinary INTEGER CAST formatter for normalization and the 128-byte cap,
preserving the default warnedText and global charset codec. The existing
utf8mb3 encoder uses ordinary UTF-8 and does not normalize supplementary code
points; share CONVERT USING's existing BMP substitution when appropriate.
Keep split-multibyte and missing-quote groups open at the diagnostic/message
conversion boundary. Audit against the source probe's 152 full matches and all
matching parameter components before broadening formatting. Expected parameter types, other
numeric readers, binary shifts, exhausted OFFSET projection, explicit result
charsets, IF derivation, packet overflow, DDL row-size admission and broader
ICU/function behavior remain open.

### Verified INTEGER CAST text diagnostic normalization and caps (2026-10-11)

A local nonbinary INTEGER CAST formatter preserves the default NUL boundary,
normalizes supplementary characters to '?' and then applies the 128-byte UTF-8
cap. It shares CONVERT USING's existing BMP substitution; CONVERT's byte/string
branches keep their previous behavior. Three explicit branches select binary
CAST, nonbinary CAST or default diagnostics. warnedText, global charset codecs,
other numeric readers, public APIs and parameter types retain their contracts.

The 648-outcome text probe improves from 448 to 640 complete matches, closing
192 without regressions. Eight split-character warnings remain open; every
value and field agrees. The 176 introduced-charset/cap observations improve
from zero to 152 full matches: all 128 latin1/utf8mb4 outcomes agree, while the
whole introduced-utf8mb3 group still misses 24 query deprecation warnings.
Execute INTEGER diagnostic messages agree in that group. All 261 fresh cap
outcomes agree across latin1, utf8mb3 and utf8mb4 columns, closing ninety from
171, including nine PREPARE checks and 252 cached query/execute/actual-statement
reads after writes. NULLs, NUL, whitespace and long BMP/non-BMP values agree.

The 220-outcome source audit improves from 152 to 168 full matches, closing
sixteen without full or component regressions. All 22 string query parameter
outcomes now agree; query Buffer remains eighteen of 22. Execute warning
components improve from eight to ten of 22 in each group; every value/field is
unchanged and expected execute parameter fields remain open. The 868 fresh
text outcomes still all agree. The 2,670 other-kind/field and 1,092 binary
cast/ordinary-field outcomes are identical to the preceding commit.

The 96 split-multibyte probe agrees on all values/fields and 56 full outcomes;
forty warnings retain per-byte substitution or missing closing-quote gaps.
These remain diagnostic/message conversion boundaries. A thirty-outcome
CONVERT control probe is unchanged at 24 complete matches, with all values and
fields agreeing; existing utf8mb3 execute deprecation lifetime and invalid
binary-utf8mb3 diagnostic spelling remain separate. No malformed-message
exceptions or partial-warning assertions were added to permanent fixtures.

Five native tests pin 656 complete executions and nine PREPARE checks: 248
complete-character caps, 128 introduced latin1/utf8mb4 reads, 252 fresh column
reads, four long string query parameters and 24 unchanged CONVERT controls.
Entire split-message, introduced-utf8mb3 admission, utf8mb3 execute-warning and
invalid binary-utf8mb3 groups remain outside those full-outcome fixtures.

Primary source confirms the separation: the pinned release's
[ErrConvString/err_conv](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_error.cc)
converts nonbinary diagnostics to the system charset, and its
[1292 message definition](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/share/messages_to_clients.txt)
bounds the value field by 128 bytes. The malformed split outcomes suggest a
subsequent message conversion boundary, which still needs its own proof. No
MySQL source was copied into this repository.

All 1,190 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
The final reader cleanup passes Windows release gates and Docker typecheck,
lint, size and all eighteen cast tests (6,176 complete executions plus 58
PREPARE checks). Focused native tests also pass. Core is 334,334 B and facade
334,255 B gzipped; caps, captures and the 2,118-plan floor are unchanged.
The preceding commit passed every required GitHub job.

The following original-prefix range proof supersedes the proposed complement
warning work. Negative-zero text and leading-control-whitespace readings remain
open; prepared parameters must retain their own expected-type conversion phase.

### Verified INTEGER CAST original-prefix complement ranges (2026-10-11)

The additive @myjs/types integerPrefix(value) export owns text classification
and the pre-saturation integer prefix. It retains leading whitespace and sign,
returns '0' when text has no digits and returns undefined for numeric values,
HEX/BIT numeric bytes and ENUM/SET ordinals. valInt keeps its signature, numeric
paths and saturated values; its previous duplicated sign/digit reader is gone.
CAST warnings use the original range rather than the saturated result, accepting
only valid negative or positive complements. Leading tab/newline/carriage-return
prefixes decline complement warnings. The shared diagnostic guard reuses the
same text classification; DOUBLE, DECIMAL and ordinary field controls agree.
INTEGER result normalization has explicit branches and one value constructor.

The 468-outcome bound probe improves from 358 to 448 complete matches, closing
ninety with no matching-component regressions. All fields and all 463 previously
matching values are preserved; 420 of 432 string/binary outcomes agree fully.
Twelve negative-zero warnings and eight numeric-overflow-literal conversion
outcomes remain separate. The 732-outcome lexical probe improves from 586 to
640 full matches, closing 54 without regressions. Whole negative-zero and leading
control groups remain outside the passing fixtures. Native prepared '-0' is
already numeric and quiet, unlike text '-0'; an attempted lexical-zero repair
regressed that matching warning component and was removed before commitment.
The expected-type owner must resolve that distinction rather than adding a
per-function parameter exception. Leading-control values need their own reader
proof; they are not a formatting-only boundary.
The pinned release's [CAST resolution](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_func.cc)
propagates a BIGINT expectation to its argument and selects distinct text,
numeric and DECIMAL readers. Expected-type conversion owns this distinction.

The 196 ordinal/fresh/parameter controls improve from 133 to 157 full matches,
closing 24 without component regressions. All 32 ENUM/SET controls agree,
including high-bit SET ordinals and negative-looking ENUM labels. All four
PREPARE checks and 96 included fresh executions agree across VARBINARY/VARCHAR
writes and NULLs. Entire negative-zero and bound-parameter groups remain outside
full-outcome fixtures, with their existing matching components preserved. Four
regression tests pin 1,144 complete executions and four PREPARE checks: 436
bound outcomes, 580 lexical controls, 32 ordinals and 96 fresh reads. Values,
all ten field properties and complete ordered diagnostics are checked.

The original 2,344 byte/cap outcomes now all agree, closing the remaining six.
The 220 source controls retain 168 full matches and every matching component.
The 2,670 other-kind/field and 1,092 binary cast/ordinary-field outcomes are
identical to the preceding commit. All 868 fresh text and 261 fresh cap outcomes
still agree; the thirty CONVERT controls are unchanged at 24 full matches.

All 1,194 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Focused native tests also pass. Core is 334,309 B and facade 334,264 B gzipped;
caps, captures and the 2,118-plan floor are unchanged. The preceding commit
passed every required GitHub job. M5.10 remains partial.

The full-byte proof exposed diagnostic prerequisites: MySQL delegates DECIMAL
reading to source readers, including the selected branch of IF/CASE. The
following source-reader slices resolve those prerequisites. Complete shared
byte reading is now verified below, including zero previously matching
component regressions; remaining field message caps are separate.

### Verified BLOB/TEXT and CONCAT DECIMAL prefix readers (2026-10-11)

The existing numericPrefix parser now reports an additive readonly valid fact,
distinguishing a parsed zero from its invalid-input fallback. DECIMAL column
checks use that fact, so invalid prefixes containing later digits also produce
the converter's 1366 warning. BLOB/TEXT column readers and CONCAT's explicitly
declared decimalPrefix fact discard truncation status for numeric prefixes;
invalid inputs retain the fatal 1366 diagnostic. Ordinary CHAR/VARCHAR and
VARBINARY fields retain their subsequent 1292, and literals retain their own
1292-only reader. Numeric, HEX/BIT, ordinal and NULL exclusions retain their
existing owners. Output metadata is not used to guess a function's reader.

CONCAT computes its input type list once, shares one width reduction and uses
valueBytes for ordinary byte encoding, preserving raw BIT payloads explicitly.
This removes duplicated encoding branches while retaining evaluation order,
collation derivation and capped metadata. The native reader evidence is from
8.4.11's Item_string and Item_str_func decimal paths and Field_blob behavior;
no source code was copied.

The 1,260-outcome source-reader audit improves from 248 to 718 complete matches,
closing 470 with no regressions in previously matching rows, fields, warnings
or errors. The 8,736 byte/numeric audit improves from 6,346 to 7,310 full
matches, closing 964; all 8,192 single-byte values and fields still agree.
The 800 PREPARE/fresh/long-input outcomes improve from 344 to 500 full matches,
closing 156 with no matching-component regressions. Three protocol regressions
pin 1,868 complete executions and twenty PREPARE checks: 364 short column,
function and literal controls, 1,024 all-byte-tail DECIMAL reads and 480 fresh
cached executions through query, execute and an actual prepared statement.
All ten field properties and complete ordered diagnostics are checked. A unit
regression pins parsed-zero versus invalid-prefix classification.

All 1,198 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Focused native tests also pass. Core is 334,308 B and facade 334,260 B gzipped;
caps, captures and the 2,118-plan floor are unchanged. The preceding commit
83ba6c3 passed every required GitHub job. M5.10 remains partial.

### Verified selected-branch IF/CASE DECIMAL readers (2026-10-11)

One shared choiceOf selector owns IF and CASE evaluation. Normal result reads
retain branchOf and doubleOf behavior; a lazy internal decimalOf reader builds
the original branch readers once when requested. asNumber dispatches that
reader before aggregate-type shortcuts and propagates its once memoization
argument. Each evaluation selects once and reads only its selected branch;
statement diagnostics keep their existing lifetime. CASE compiles comparison
readers separately from its result branches and represents absent ELSE as a
compiled NULL, removing duplicated branch bookkeeping.

Evaluator-changing temporal/comparison, joined-assignment and window-conversion
wrappers keep type/eval explicitly, clearing source-reader capabilities that
would otherwise bypass their conversion or row binding. Value-preserving
warning wrappers retain their source identity. IFNULL/COALESCE remain separate:
their null-test and selected-value lifetime needs proof before delegation.
The native authority is [8.4.11's IF/CASE decimal readers](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_cmpfunc.cc),
which delegate to the selected argument; no source code was copied.

The 1,960-outcome branch audit improves from 1,072 to 1,684 full matches,
closing 612. Its 2,240-outcome DECIMAL(65,0) extension improves from 1,142 to
1,964, closing 822, including exact UINT64 maximum selection beside DOUBLE.
The 1,040 PREPARE/fresh-write audit improves from 342 to 864, closing 522.
All previously matching rows, fields, warnings and errors are preserved.
A separate 176-outcome nested/normal/selector-effect audit retains every
matching component; 104 outcomes agree completely. Existing normal BLOB
metadata, nested normal DOUBLE-to-text behavior and unsupported := variable
assignment remain explicit outside this reader slice. PREPARE following a
warning-bearing previous execution also retains stale diagnostics here; fresh
prepared metadata is verified separately after DO 0 resets that prior state.

Three native-backed protocol tests pin 1,960 complete executions and 32 PREPARE
checks: 1,184 literal/field/CONCAT/numeric/NULL branch reads, 104 nested/BIT/
normal controls and 672 query/execute/actual-statement reads after fresh writes.
Each checks all ten field properties and ordered warnings. A unit regression
counts selector/branch effects, proves unselected branches are never evaluated,
checks nested once memoization and new-statement reset, and retains exact
unsigned integers. All seven older control probes are unchanged: 2,344 byte/
cap, 220 source, 2,670 other-kind/field, 1,092 cast/field, 868 fresh text, 261
fresh cap and thirty CONVERT outcomes. Their incomplete groups stay open.

All 1,202 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Focused native tests also pass. Core is 334,334 B and facade 334,263 B gzipped;
caps, captures and the 2,118-plan floor are unchanged. The preceding commit
161c821 passed every required GitHub job. M5.10 remains partial.

### Verified IFNULL/COALESCE merged-value DECIMAL prefixes (2026-10-11)

IFNULL and COALESCE declare the existing source-owned decimalPrefix fact.
Their string results discard truncation status and retain fatal invalid-prefix
1366, including selected literals and VARBINARY values. Numeric result readers
retain their normal merged-value conversion; no selected-branch decimalOf
factory is added. [MySQL 8.4.11's hybrid numeric reader](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_func.cc)
dispatches on the merged result kind, unlike IF/CASE's original-branch reader.
This distinction is represented by existing internal facts, not guessed from
output metadata. No reference source code was copied.

Both functions share the existing first-non-NULL loop and chosenOf conversions.
Arity errors, collation aggregation and nullable-result rules are preserved.
Each argument is evaluated once in order; the selected value is converted once
and later arguments are untouched. The compiler's reader comment now names
prefix-accepting function owners. Production duplication is removed.

The 840-outcome source audit improves from 158 to 642 full matches, closing
484. The 4,368 byte/long-input audit improves from 272 to 4,148, closing 3,876;
all 4,096 single-byte outcomes agree. The 1,040 fresh-write audit improves from
158 to 788, closing 630. Previously matching rows, all fields, ordered warnings
and errors are preserved. Three protocol regressions pin 5,320 complete
executions plus 32 PREPARE checks: 552 source/numeric controls, 4,096 all-byte
reads and 672 query/execute/actual-statement reads after cached byte/NULL writes.
A counted unit regression proves argument order, one evaluation per argument,
unselected-argument laziness and statement-scoped diagnostic memoization through
nested functions. Seven older control probes are unchanged.

All 1,206 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Focused native tests also pass. Core is 334,281 B and facade 334,197 B gzipped;
caps, captures and the 2,118-plan floor are unchanged. The preceding b3f50a9
commit passed every required GitHub job. M5.10 remains partial.

**Reader sequence:** the scalar string dispatch and builtin case transforms are
now verified in the next section. ANY_VALUE, NULLIF and CHAR/BINARY casts
retain separate owners and evaluation lifetimes. Do not infer a reader policy
from string-result metadata. NULLIF delegates to its original first argument:
a truncated VARBINARY or literal retains 1292 there, unlike the same input
through REPLACE or ANY_VALUE. Keep comparison/result reads, hybrid numeric
behavior, cast readers, overflow and source limits explicit until verified.

Complete textOf byte reading is now verified below, after the source-reader
prerequisites, without any previously matching component regression.
It also backs toText for byte values: prove downstream formatting, network and
temporal consumers as well as numeric reads. Cover every byte, embedded NUL,
long leading spaces/zeros/tails, 200,003-byte inputs and fresh cached writes.
Audit selected IF/CASE branches against the current committed reader policy;
previously matching warnings must remain identical. Preserve HEX/BIT/ordinal
readings. Other string-source reader boundaries and 81-digit/exponent
overflow diagnostics and DECIMAL string-field 128-character warning caps remain
explicit. UNHEX has a separate byte spread and missing 1411 invalid-input
warnings: its 3,156 outcomes retain only 312 full matches, with 2,808 single-byte
diagnostic gaps and thirty-six large-input errors. Migrate it only after its
own complete byte/large-result and diagnostic proof. Keep negative-zero, control whitespace,
split-message conversion, charset deprecation admission/lifetime, expected
parameter types, binary shifts, exhausted OFFSET projection, packet overflow,
result charsets, IF binary derivation, DDL row-size admission and broader
ICU/function behavior open. Continue M5.47, M5.49 and M5.50 before browser work.

### Verified scalar string DECIMAL prefix readers (2026-10-11)

The string-function compiler now declares the existing decimalPrefix fact at
its nonnumeric library and hash/list/conversion/remaining-string dispatch
boundaries. LOWER/LCASE/UPPER/UCASE declare it at their builtin constructor.
These owners discard DECIMAL truncation status while retaining fatal 1366 for
an invalid prefix. All 44 dispatch members and aliases were probed before
assigning the shared fact. Integral results bypass text conversion as before;
NUMBER_FUNCTIONS, including GREATEST/LEAST, retain their separate path.
No metadata rule, evaluator wrapper or new abstraction is introduced.

The binary-source audit improves from 2,648 to 7,595 full matches out of 9,240,
closing 4,947. The TEXT/VARCHAR/literal audit improves from 2,526 to 8,241 out
of 9,240, closing 5,715. The byte/long-input audit improves from 298 to 4,152
out of 4,368, closing 3,854; all 4,096 single-byte outcomes agree. Fresh cached
execution improves from 116 to 704 out of 1,040, closing 588. The older 1,820
and 5,460 source probes reach 1,096 and 3,296 full matches, closing 668 and
2,004. No previously matching rows, fields, warnings or errors regress.
Seven integer/CAST control matrices are unchanged.

Three protocol tests pin 9,936 complete native executions and 32 PREPARE
checks: all constructors, six source kinds, invalid prefixes, valid tails,
all bytes, nested transforms and fresh cached writes across four BLOB/VARBINARY
storage kinds. Shared native outcome vectors keep the fixtures small. A counted
unit test pins argument reads, fresh statement memoization and unchanged
DOUBLE/INTEGER diagnostics and NUMBER_FUNCTIONS ownership. Ordered warning
lists and all ten field properties are compared, including actual prepared
statement object rows. SPACE/CHAR argument-reader gaps are kept outside these
bounded source groups; their result-reader fact has independent native proof.

All 1,210 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and all seven pinned corpora
pass; focused native checks pass. Core is 334,303 B and facade 334,216 B
gzipped. Captures, caps and the 2,118-plan floor are unchanged. The preceding
9131f26 commit passed every required GitHub job.

**Reader sequence:** ANY_VALUE's string prefix repair is verified below.
Its numeric, temporal, BIT/HEX and JSON differences remain separate, including
DOUBLE width and hybrid conversion. Preserve its normal evaluator and metadata;
sharing the COALESCE compiler requires its own broader native proof. NULLIF's
original-argument reader and CHAR/BINARY cast prefixes are verified below.
Non-temporal string extrema and complete shared byte reading are verified
below. Retain ordinary DECIMAL field diagnostic caps and long zero/space prefixes,
81-digit/exponent overflow, SPACE/CHAR argument diagnostics and prepared
constant lifetime, FORMAT argument warnings, CONV overflow and mixed-string
FIND_IN_SET NUL/high-byte comparison differences as separate measured gaps.
M5.10 stays partial; M5.47/M5.49/M5.50 follow before browser work.

### Verified ANY_VALUE string DECIMAL prefix reader (2026-10-11)

ANY_VALUE declares its own decimalPrefix fact on the existing evaluator. Its
normal values and expressionOf metadata remain unchanged. No decimalOf
selected-argument delegation or shared COALESCE compiler is introduced: an
IF/CASE inside ANY_VALUE first supplies its normal merged value, whereas an
outer IF/CASE selects ANY_VALUE's own reader. Numeric results retain their
existing path, including UINT64 beside DOUBLE.

The 1,890 binary-source audit improves from 636 to 1,428 full matches, closing
792; the 1,890 TEXT/VARCHAR/literal audit improves from 630 to 1,638, closing
1,008. The 4,368 byte/long-input audit improves from 774 to 4,148, closing
3,374, with all 4,096 single-byte outcomes agreeing. The 1,040 fresh audit
improves from 314 to 746, closing 432. A 408-outcome normal/DECIMAL type audit
improves from 296 to 330, closing 34. No previously matching rows, fields,
warnings or errors regress. Seven integer/CAST and four scalar-reader matrices
are unchanged.

Four protocol tests pin 5,968 complete native executions and 32 PREPARE
checks, including six source kinds, invalid prefixes, valid tails, all bytes,
nested IF/CASE/NULLIF/COALESCE boundaries, fresh cached writes across four
BLOB/VARBINARY storage kinds and complete NULL/exact-numeric/numeric-JSON
controls. Native metadata distinguishes nullable ANY_VALUE casts from the
COALESCE wrapper. A counted unit test pins normal and DECIMAL argument order,
unselected-branch laziness, NULLs, once-per-statement fatal diagnostics and
nested DOUBLE conversion without selected-branch reader delegation.

All 1,215 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and all seven pinned corpora
pass; focused native checks pass. Core is 334,304 B and facade 334,217 B
gzipped, one byte more each. Captures, caps and the 2,118-plan floor are
unchanged. The preceding b447825 commit passed every required GitHub job.

**Reader sequence:** NULLIF's original-argument delegation/repeated reads and
CHAR/BINARY cast and non-temporal string extrema prefix facts are verified
below. Complete shared binary text reading is also verified below, with
component preservation. Remaining source message caps have their own proof
and repair boundary.

ANY_VALUE DOUBLE metadata widths, temporal/BIT/HEX hybrid conversion and
nonnumeric JSON readers remain explicit. Long zero/space prefixes, ordinary
DECIMAL field caps, 81-digit/exponent overflow, SPACE/CHAR argument diagnostics
and prepared-constant lifetime, FORMAT argument warnings, CONV overflow and
mixed-string FIND_IN_SET comparison differences remain separate. M5.10 stays
partial; M5.47/M5.49/M5.50 follow before browser work.

### Verified NULLIF original-argument DECIMAL reader (2026-10-11)

NULLIF now shares its comparison/result boundary between normal and DECIMAL
readers. DECIMAL reads the original first argument after comparison, preserving
its source diagnostics and selected IF/CASE readers. It does not apply a
blanket prefix fact or reuse the first comparison value. Constant replacement,
temporal text conversion, metadata and comparison diagnostic order retain
their existing paths.

A native twelve-outcome effect probe establishes argument read counts
(first, second): NULL-first (2,0), equal (1,1), unequal (2,1), for normal and
DECIMAL evaluation. The former early NULL return was incorrect: a NULL first
comparison skips the right argument, then reads the first argument again for
the result. Counted tests change the first argument between reads, reject an
unwanted result/right read, retain nested choices, and prove fresh statement
memoization. Expression user-variable assignment remains unsupported here;
the native assignment probe stays separate from protocol conformance fixtures.

The 1,890 binary-source audit improves from 748 to 1,250 complete matches,
closing 502; the 1,890 text-source audit improves from 824 to 1,434, closing
610. A 544 normal/DECIMAL type audit improves from 456 to 480, closing 24.
The 4,368 byte/long audit improves from 1,022 to 3,914, closing 2,892; the
1,040 fresh audit improves from 341 to 746, closing 405. A 32-outcome
constant-replacement/temporal audit improves from 28 to 30. No previously
matching rows, fields, warnings or errors regress. Seven integer/CAST and
four scalar-reader control matrices are unchanged.

Five native protocol tests pin 5,756 complete executions and 32 PREPARE
checks: six string source kinds, equal/unequal/NULL and numeric comparisons,
seven paths through all 256 trailing bytes, fresh cached writes across four
storage kinds, original numeric/BIT/HEX/temporal/JSON controls, constant
replacement and temporal result conversion. Shared errors and every field
property are checked along with rows and ordered warnings. The tests do not
claim direct VARBINARY high-byte warning encoding or remaining long-input
behavior is complete.

All 1,221 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and all seven pinned corpora
pass; focused native checks pass. Core is 334,343 B and facade 334,260 B
gzipped. Captures, caps and the 2,118-plan floor are unchanged. The preceding
f87ccf8 commit passed every required GitHub job.

**Reader sequence:** CHAR/BINARY casts' own DECIMAL prefix fact is verified
below, followed by non-temporal string extrema and complete shared byte
reading. Field diagnostic caps and other hybrid reader boundaries remain
separate. Keep diagnostic caps distinct from actual conversion limits. Direct VARBINARY warning encoding, the two
cached-execute warning lifetime gaps for NULLIF('123x',BIGINT), nonnumeric
JSON, 81-digit/exponent overflow and long binary prefixes remain open.

### Verified CHAR/BINARY cast DECIMAL prefix readers (2026-10-11)

CHAR and BINARY casts now declare their own decimalPrefix fact
on existing evaluators. DECIMAL reads the cast result with fatal invalid-prefix
diagnostics and quiet valid tails, including padding bytes. It does not
delegate to the original argument. Normal values, type metadata, target
charset conversion and padding/truncation warning order are preserved.
The CHAR path now has one result return, retains character-aware truncation,
and avoids rejoining an untruncated value. Charset selection has one fallback
and does not search for an unspecified charset.

Each 1,890 binary/text source audit improves from 270 to 1,380 full matches,
closing 1,110. The 4,368 byte/long audit improves from 996 to 3,902, closing
2,906; the 1,040 fresh audit improves from 152 to 830, closing 678. A 408
normal/DECIMAL type audit improves from 228 to 344, closing 116. No previously
matching rows, fields, ordered warnings or errors regress. Seven integer/CAST
and four scalar-reader matrices are unchanged.

Four native protocol tests pin 5,668 complete executions and 32 PREPARE
checks: six source kinds, fixed/unbounded casts, nested selected readers,
seven paths through all 256 trailing bytes, fresh cached writes across four
storage kinds, normal numeric/BIT/temporal controls, DECIMAL DOUBLE/JSON
controls and fixed BINARY JSON results. Counted tests prove one original read
per cast, lazy unselected arguments, NULLs, original reader separation,
truncation-before-DECIMAL warning order and fresh diagnostic memoization.
NULLIF wrapping a cast preserves its own two-read boundary. Complete field
properties, rows and ordered warnings remain checked against native outcomes.

All 1,226 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass; focused native checks pass. Core is 334,347 B and facade 334,264 B
gzipped, four bytes more each. Captures, caps and the 2,118-plan floor are
unchanged. The preceding 0aa3106 commit passed every required GitHub job.

**Reader sequence:** non-temporal, non-JSON string extrema's own prefix fact
is verified below. Numeric, temporal and JSON extrema remain separate readers.
Native effect counts distinguish ordinary string (1,1), NULL-first string
(1,0), and numeric DECIMAL (2,1) readings; numeric DECIMAL still reads its
first argument only once here. User-variable assignment remains unsupported.
Fixed BINARY truncation byte/NUL messages, normal JSON cast metadata,
DOUBLE-to-BINARY metadata and decimal-buffer overflow remain open. Complete
binary numeric prefixes are now verified below.

### Verified non-temporal string extrema DECIMAL prefix readers (2026-10-11)

GREATEST/LEAST now declare their own decimalPrefix fact only when the result
is text or bytes and no argument is temporal or JSON. The DATETIME path
returns before this fact; TIME and JSON paths remain excluded explicitly.
DECIMAL reads the selected result, preserving fatal invalid-prefix diagnostics
and quiet valid tails. Numeric/temporal/JSON readers, normal comparison,
metadata, errors and NULL handling retain their existing behavior.

The conversion closure is chosen once at compilation and uses the existing
valueBytes owner for binary conversion. The row evaluator no longer creates
a conversion closure or copies the argument array to skip its first element.

Binary source outcomes improve from 306/1,890 to 1,362/1,890, closing 1,056;
text source outcomes improve from 266/1,890 to 1,450/1,890, closing 1,184.
The 544 normal/DECIMAL type audit improves from 304 to 330, closing 26. The
4,368 byte/long audit improves from 802 to 4,176, closing 3,374; the 1,040
fresh audit improves from 242 to 746, closing 504. In total, 6,144 complete
outcome mismatches close; no previously matching rows, complete fields,
ordered warnings or errors regress. Seven integer/CAST and four scalar-reader
matrices are unchanged. The numeric counted-reader probe is unchanged.

Four protocol tests pin 6,048 complete native executions and 32 PREPARE
checks: source/literal boundaries, nested choices, eight paths through every
trailing byte, cached writes across four binary storage kinds, and normal
and DECIMAL numeric/temporal controls plus normal BIT/HEX/large-DOUBLE controls.
Two introduced UTF8 literal paths nested inside IF/CASE retain an existing
nullability discrepancy and stay outside the pinned passing groups; they
remain measured in the full audit. JSON query diagnostics/metadata and
numeric, BIT/HEX and temporal reader gaps also remain explicit. Dates are
serialized with a fixed UTC client timezone in the protocol controls.
Counted tests pin one read per string argument, NULL short-circuiting, lazy
unselected branches, nested NULLIF reads and fresh diagnostic memoization.
Numeric, temporal and JSON controls exclude a blanket string prefix rule.

All 1,231 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass; focused native tests pass. Core is 334,350 B and facade 334,264 B
gzipped, three bytes more and unchanged respectively. Captures, caps and the
2,118-plan floor are unchanged. The preceding b657b63 commit passed every
required GitHub job.

**Reader sequence:** fixed CHAR/BINARY field DECIMAL formatting and complete
shared numeric byte reading are verified below. COLLATE's own prefix policy
preserves warning behavior for long binary inputs. Variable field raw-byte
message caps, decimal-buffer overflow and numeric/temporal/JSON extrema remain
independent repairs. Preserve complete numeric inputs and warning order.

### Verified fixed CHAR/BINARY field DECIMAL diagnostics (2026-10-11)

Fixed CHAR/BINARY fields now use the existing INTEGER cast diagnostic policy
for DECIMAL readings. The compiled diagnostic kind is chosen only for a real
column with FIELD_TYPE.STRING; it does not follow output metadata alone.
Binary diagnostics escape every byte, retain embedded NUL and padding, and
cap escaped output at 128 bytes, including partial final escapes. CHAR
normalizes supplementary characters before its UTF-8 cap. Diagnostics do
not truncate the numeric input. Original field, IF and NULLIF readers retain
their own policy; CONCAT/COALESCE/GREATEST retain their function prefix policy.

This boundary follows the pinned implementation's separate
[fixed-field and variable-field decimal readers](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/field.cc).
Fixed fields use a charset-aware error representation. Variable fields pass
raw stored bytes to the warning formatter; its
[message precision](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/share/messages_to_clients.txt)
is distinct from full-data numeric conversion. Do not share these formatters
without an independent proof.

The 13,368-outcome, nine-class source audit improves from 10,194 to 12,030
full matches, closing 1,836. BINARY(255) improves from 1,782 to all 3,528;
CHAR utf8mb4 improves from 330 to 390/420, and CHAR latin1 from 300 to 330/360.
Five split-multibyte inputs per CHAR class retain message-conversion gaps.
Every VARCHAR/VARBINARY/TEXT/BLOB outcome remains unchanged. The 270-outcome
fresh audit improves from 162 to all 270, closing 108. No previously matching
rows, complete fields, ordered warnings or errors regress. Seven integer/CAST
and four scalar-reader matrices remain unchanged.

Two protocol tests pin 4,449 complete executions and nine PREPARE checks:
three fixed field classes, six reader paths, all 256 trailing bytes, embedded
NUL and zero padding, ASCII/Unicode cap boundaries, numeric prefixes beyond
the message cap, cached writes and NULLs. Five split-multibyte CHAR inputs
remain outside the passing fixture groups and measured in the complete
audit. Captured field tuples are shared without deriving expected behavior.
Counted tests preserve original read order, lazy IF branches, NULLIF's two
reads, source-reader separation, full numeric inputs and fresh memo lifetime.

The touched reader now names its broader diagnostic kind explicitly and
shares the ordinary numeric field predicate for BLOB and VARCHAR suppression.
It tests existing column/boolean facts directly. The private text formatter
is named for its fixed diagnostic boundary. Public contracts are unchanged.

All 1,234 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass; focused native tests pass. Core is 334,346 B and facade 334,259 B
gzipped, four and five bytes smaller respectively. Captures, caps and the
2,118-plan floor are unchanged. The preceding e4ac9c6 commit passed every
required GitHub job.

### Verified complete numeric binary text and COLLATE prefix readers (2026-10-11)

The shared numeric binary text reader now maps every byte to U+0000–U+00FF
with a local loop. It reads complete values beyond 1,024 bytes without an
argument-spreading limit. BIT payload text uses the same reader, and UNHEX
routes through the existing toText conversion. Charset codecs retain their
own boundaries: binary regex uses MySQL's CP1252 mapping, independently of
numeric byte identity; regex wire UTF-8 and broader ICU gaps remain open.

COLLATE declares its own DECIMAL prefix policy. The pinned
[COLLATE class](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_strfunc.h)
inherits the scalar string-function reader; it does not delegate to the
original field. This closes the prerequisite warning discrepancy exposed by
long binary prefixes. Normal values, types, collation checks, NULLs, selected
argument order and statement-local warning memoization keep their owners.

Six complete native audits close 1,210 mismatches without any previously
matching row, complete field, ordered warning or error component regressing:

| Audit | Outcomes | Before | After |
|---|---:|---:|---:|
| Binary numeric text | 8,736 | 7,310 | 7,754 |
| Byte-text consumers | 1,056 | 596 | 788 |
| UNHEX byte inputs | 3,156 | 312 | 336 |
| DECIMAL readers | 1,008 | 724 | 820 |
| DECIMAL contracts | 1,260 | 840 | 1,000 |
| Fresh cached byte inputs | 800 | 500 | 794 |

The nine-class field audit additionally improves from 12,030 to 12,084 of
13,368 complete outcomes. Four scalar-reader control matrices close another
1,220 complete mismatches without component regressions. Seven INTEGER,
CAST, warning-format and normalization matrices remain wholly unchanged.

Five protocol tests pin 3,382 complete executions and twenty PREPARE metadata
checks against 8.4.11 through query, execute and cached statements. They cover
all 256 trailing bytes in DECIMAL readers, 1,023–1,026-byte boundaries,
4,096/200,000-byte subjects, zero/space prefixes, format/network consumers,
valid large UNHEX, COLLATE, four binary storage classes, fresh writes and NULLs.
Native field tuples and outcome records are shared; repeated input runs are
constructed without changing expectations. Three unit tests pin all byte
code points, BIT text, empty inputs and large subjects; a counted COLLATE test
pins lazy reads, complete numeric input and fresh warning lifetime.

Passing groups exclude independently measured numeric/temporal warnings,
invalid UNHEX's missing 1411, decimal-buffer overflow and six cached
VARBINARY DOUBLE/DECIMAL raw-cap executions. The full audits retain those
outcomes. Variable-field formatting and fixed CHAR split-multibyte messages
are not repaired by complete numeric reading. M5.10 remains partial.

All 1,243 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass; focused native tests pass. Core is 334,328 B and facade 334,243 B
gzipped, eighteen and sixteen bytes smaller respectively. Captures, caps and
the 2,118-plan floor are unchanged. The preceding 89e639e commit passed every
required GitHub job.

### Verified UNHEX invalid-argument diagnostics (2026-10-11)

UNHEX's invalid-input branch now emits 1411 and returns NULL. Its verified
argument paths use the existing resolved-expression printer: qualified columns,
function calls, literals/introducers and prepared placeholders retain their
spelling. The argument's value is evaluated once; NULL and valid hex remain
quiet. Each invalid row read warns independently, including repeated calls
and fresh cached executions; unselected IF branches stay quiet.

The existing network-function warning-to-NULL helper now lives with the
compiler's diagnostic helpers and serves both owners. All 1,056 format,
network and temporal consumer records remain unchanged. Its message and network
evaluation policies are unchanged. UNHEX preserves complete input reading,
odd-digit conversion, values, metadata and public contracts.

The pinned [UNHEX implementation](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_strfunc.cc)
prints its argument rather than the bad value's contents. The separate
[1411 message precision](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/share/messages_to_clients.txt)
and completed-message encoding still need repair.

The full 3,156-outcome byte audit improves from 336 to all 3,156 complete
matches, closing 2,820 without a previously matching component regression.
The 796-outcome fresh/literal/parameter matrix improves from 169 to 762,
closing 593 with no row, complete-field, ordered-warning or error regression.
Its 34 unmatched outcomes retain printer and wide-result gaps. The separate
44-outcome cap/escaping probe measures long ASCII/Unicode, split boundaries,
HEX and control escapes; fourteen now agree, while the rest remain open.

Three protocol tests pin 3,894 complete executions and seven PREPARE checks:
all 256 byte tails through six complete-input paths, 1,024-byte boundaries,
200,000-byte subjects, literal/introducer/HEX/numeric spelling, quiet NULL and
valid controls, 128-byte fitting printed strings, fresh binary/text writes,
qualified fields, repeated row warnings and lazy branches. Bound-parameter
diagnostics are pinned through LENGTH(UNHEX(?)) with every field and warning,
because direct-result parameter metadata remains independently incomplete.
Native outcomes and field tuples are shared; Buffer rows are serialized
without changing their bytes. A counted unit test pins one original value
read per evaluation, repeated and fresh warning lifetime, laziness, large
valid values and NULLs.

This slice's passing groups excluded NUL/non-BMP literal escaping, BIT/cast/COLLATE
argument printing, over-cap raw-message conversion, wide UNHEX metadata and
direct/hybrid prepared-parameter result widths. Full audits retain those
outcomes. Broad ICU and other function repairs remain open; M5.10 is partial.

All 1,247 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass; focused native tests pass. Core is 334,339 B and facade 334,262 B
gzipped, eleven and nineteen bytes more respectively. Captures, caps and
the 2,118-plan floor remain unchanged. The preceding 06a4422 commit passed
every required GitHub job.

The fresh wildcard probe has 297 records over nine table definitions and
query/execute/retained-PREPARE forms. Raw-star metadata coverage is separate
from covering-star source order, correlated scalar metadata and CREATE TABLE
column visibility: INVISIBLE columns are parsed but omitted visibility is not
preserved, so native hidden-key wildcard projection differs. Do not infer a
visibility implementation from a key-coverage repair. ALTER column visibility
is explicitly unsupported. These gaps remain open under M5.49/M5.12.

**Next:** finish the remaining M5.47 strategy differences through the existing
cost and physical iterator owners. Bounded integer semijoins match
288 of 288 non-primary observations; this bounded base matrix is complete. All
rows, full fields and warnings agree with pinned MySQL. The 352-record changing-
data matrix now agrees on 313/352 complete configurations and 337 matching
fields; 15 execution fields and 39 complete configurations remain open. All
192 earlier fresh observations and 2,243 older controls are strictly unchanged.

Optimizer switch configuration and connection snapshot lifetimes are verified
below. Broader text grammar and builtin session/global inheritance remain
separate boundaries. Compare materialized lookup/hash costs and actual
deduplicated iterators against native traces before broader weedout admission.
The 192-record nonempty strategy audit has all rows, fields and warnings native
but only 24 complete plan matches: unordered, ordered-LIMIT and disabled-strategy
alternatives remain separate. Keep captures, size caps and the 2,118-plan floor
unchanged. M5.47 stays partial. The 468254b exact-SHA GitHub run
38316521358 passed all eleven required jobs; monitor subsequent runs while working.

**Measured materialization boundary:** a fresh pinned matrix has 144 query/
execute outcomes across 20/200 outer rows, 0/8/80 inner rows, nullable duplicate
keys, unordered/ordered-LIMIT reads and six switch combinations. All rows, full
fields and warnings agree; only 44 complete outcomes match. Of 72 configurations,
22 native LooseScan plans match; 48 native materialized plans and two fallback
plans remain open. Switches independently disable FirstMatch, LooseScan,
materialization and weedout; all measured groups remain in the audit.

Seventy-two native traces pin competing costs. For 200 outer/8 inner rows with
FirstMatch disabled, MaterializeLookup costs 43.1 against LooseScan 80.9019;
disabling materialization selects LooseScan. MaterializeLookup costs are 7.1/
21.5 for 20 outer rows with 8/80 inner rows, and 43.1/57.5 for 200 outer rows.
Thirty-six EXPLAIN ANALYZE observations distinguish planning from lifetime:
where materialization is selected, eight inner rows yield three non-NULL keys
in one build; unordered execution probes 150 non-NULL outer rows, retaining
separate duplicate outer identities. Ordered LIMIT 1 still builds once and
probes once. Empty/all-NULL outer inputs can change the selected strategy and
execute no inner read; do not infer cached prepared choices from text EXPLAIN.

The existing keyed IN membership builder already owns one build/probe per
statement. The verified cleanup streams rows directly into its key set rather
than retaining a second complete row array in the memo. Empty input remains distinct
from NULL-only input; correlated/non-keyed fallbacks are unchanged. Two focused
subquery tests, typecheck, lint and every size cap pass; all 144 audit outcomes
are strictly unchanged. A direct before/after measurement over 200 outer
evaluations keeps one eight-row build, three keys and one closed source iterator;
retained full-row copies fall from eight to zero. Core/facade are
334,308/334,240 B gzipped. Full Docker verification passes: all 1,288 tests, package smoke, 20,000 executor statements
seeded 20261010 and seven pinned corpora. Seventeen native checks pass; the
272/288 base matches, 262/352 fresh matches with 328 fields, 192 earlier fresh
outcomes and 2,243 older controls are unchanged. Plans remain 2,124/2,248 against
the unchanged 2,118 floor. No cap, fixture or lazy chunk changes.

No materialized strategy admission is shipped by this audit. Reuse the physical
deduplication and indexed lookup/hash owners; compare selected costs through the existing
search, preserve every previously matching component, and test changing data,
NULLs, exact integer widths and early stream closure. Build/probe counters must
verify execution rather than inferred plan labels. Keep broader grammar and
prepared-choice gaps, all caps/fixtures and the 2,118 floor unchanged.

**Verified FirstMatch sort-cardinality repair (2026-10-13):**
The shared join search charges an outer-first FirstMatch sort for its outer
rows, independent of duplicate inner fanout. The pinned four-outer/four-inner
trace selects FirstMatch at 2.4511 over MaterializeLookup at 3.1. A permanent
regression verifies ordered and ordered-LIMIT rows, all ten field attributes,
warnings and the physical plan through query and execute on both implementations.
Focused Docker/native tests and all nine unchanged size gates pass: core
334,319 B and facade 334,236 B. All 1,289 Docker tests, typecheck, lint,
package smoke, 20,000 executor
statements seeded 20261010 and seven pinned corpora pass. Eighteen live native
checks pass; the completed regression also pins a cost-search choice that
failed on the previous implementation. Base 272/288, fresh 262/352 with 328
fields, 192 earlier fresh outcomes and 2,243 older controls are unchanged.
Plans remain 2,124/2,248 against the unchanged 2,118 floor. M5.47 remains partial;
materialized lookup admission is next.

**Verified keyed build ownership cleanup (2026-10-13):** Following the
independent slice review, hash joins and automatic derived-table indexes now
store joined-row references directly in their keyed buckets. A keyed build
retains no separate full row array plus positional index lists. The source is
still consumed completely before key evaluation; hash buckets probe newest
first, automatic indexes oldest first, and unkeyed hash joins retain their full
rows. No materialized semijoin is admitted. All 1,289 Docker tests, ten focused
checks, eighteen live native controls, typecheck, lint, nine unchanged caps,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
The 144 materialization research outcomes, base/fresh/192 earlier fresh/2,243
older controls and 2,124/2,248 plans are unchanged, floor 2,118. Core/facade
are 334,283/334,201 B gzipped. All eleven required jobs in preceding FirstMatch
CI run 38503905854 pass. Selected materialization admission remains next and M5.47 remains partial.

**Next bounded MaterializeLookup contract (implementation in progress):**
Admit only positive IN over one unhinted, nontemporary base outer table and one
unfiltered inner base table, with one exact integer column on each side and a
complete ascending single-column covering secondary inner index. Keep the
existing no-CTE/parent/window/options boundaries; reject GROUP BY and additional
SELECT subqueries in the select list or ORDER BY for this virtual-table proof.
EXISTS, NOT IN, residual filters, BIT/YEAR, other types, materialized scans/hash
and weedout retain their existing paths. The materialization switch must enable
admission. Compare the native temporary-build/probe cost inside join search,
including pruning; retain FirstMatch outer cardinality and LooseScan's original
prefix estimates. The selected plan must execute through the automatic-index
owner. Consume and deduplicate the inner exactly once per execution after the
first non-NULL outer probe, with no inner build for empty/all-NULL outer inputs.
Keep eager derived-table index initialization unchanged. Preserve duplicate
outer identities, exact BIGINT keys, fresh retained-statement data and early
closure/writer release. Preserve every matching row/field/warning/plan component,
all size caps, captures, lazy chunks and the 2,118 plan floor. No unrelated
prototype cleanup is included. Both preceding committed slices now passed every required GitHub job:
FirstMatch 8fb64b1/run 38503905854 and bucket ownership 3a43d33/run 38504964361.

The earlier minimum candidate was preserved locally and was not shipping-ready;
the final bounded admission is verified below. A shared
build/probe iterator retains eager hash/derived initialization and the selected
materialized lookup's lazy boundary. Its unique keyed build owns NULL exclusion
and deduplication rather than borrowing LooseScan's sorted iterator. Switch
reading stays with the FROM planner; the caller supplies semantic eligibility.
Twenty-one native checks and focused tests pass; the materialization audit still
matches 128/144 complete outcomes with every row/full field/warning native.
Fresh matches improve 262 to 292/352, with every previously matching component
kept; base/older controls and 2,124/2,248 plans are unchanged. A full run before later settings/name cleanup has
1,291 passes and one failure, the existing size-budget test. Subsequent local
cleanup passes focused tests and typecheck, but the preserved candidate remains
212/227 B over core/facade caps at 334,573/334,493 B. Full shipping gates need to
pass after the size repair. Unrelated broad prototype rewrites stay excluded.

**Verified quantified prefix coverage repair (2026-10-14):** Native MySQL
confirms that a trailing prefix key does not cover its complete string column.
The dependent-subquery descriptor now uses the same complete-column reader as
physical access selection, replacing a duplicate check that ignored prefixes.
A 16-outcome native probe improves six to twelve complete matches, preserving
all matching components and all rows/full fields/warnings. Permanent regressions
pin the six new prefix plans plus four complete-key ANY/ALL controls through
query and execute. Complete-key IN residual-filter placement and prefix NOT IN
strategy selection remain separate open gaps. All 1,290 Docker tests, nineteen live native checks, typecheck, lint, nine
unchanged caps, package smoke, 20,000 executor statements seeded 20261010 and
seven pinned corpora pass. Base/fresh/192 earlier fresh/2,243 older controls and
2,124/2,248 plans are unchanged, floor 2,118. Core/facade are 334,226/334,145 B
gzipped. Preceding 3a43d33 CI passed all eleven required jobs. Materialized
lookup admission resumes next, and M5.47 remains partial.

**Verified bounded repeated-scan weedout (2026-10-16):** With buffering
disabled, the existing bounded two-table integer semijoin now streams raw
inner rows and reopens the outer scan for every duplicate or NULL key.
Statement-scoped deduplication retains physical outer identity across scans,
including equal projected rows. The existing repeated-scan owner supplies
row identifiers and closes both scans on cancellation; MaterializeScan keeps
its separate eager unique build. Canonical numeric byte identity is shared
with joined UPDATE/DELETE and accepts freshly allocated Uint8Array or Buffer
identifiers. Private planner/scope fields retain explicit undefined values
without temporary object spreads; TableScope owns schema fallback. Filter
estimates share their existing negation rule and normalize operator case once.

Native activity now proves four raw driver rows (including a NULL and a
duplicate) reopen the outer scan four times: 80 row visits, 15 matching
pairs and ten emitted physical identities. Five NULL-only driver rows still
reopen it five times. Empty drivers skip it. Native locking confirms that
NULL-only drivers can wait on an outer lock, while empty drivers do not.
Unordered LIMIT 1 consumes two driver rows and 22 outer visits in the measured
case, stopping during the first matching scan. Both protocols preserve full
fields and warning counts. The implementation uses the existing repeated-scan
owner and a statement-local identity set, sharing canonical byte identity
with joined UPDATE/DELETE. The disabled-hash audit now matches 480/480;
local lifecycle and native protocol checks pass. Expanded permanent checks
cover both protocols, three integer classes, ordering, LIMIT, fresh prepared
data and full fields/warnings. A 4,096-row counted test supplies Buffer row
identifiers and pins raw reads, NULL-only drivers, cancellation and writer
release; the stream sets optimizer switches on its own connection. The actual
planFrom/compiler spy checks all 80 raw pairs, yielding ten physical rows.
All previously matching components remain intact: 180 switch, 240 last-resort
cost, 144 materialization, 2,160 threshold and 288 base outcomes; fresh complete
matches remain 313/352 and both 120-case scan controls remain exact. Thirty-two
focused native checks, the older controls and 2,124/2,248 plans pass.
Final Docker verification passes all 1,303 tests, typecheck, lint, nine size
gates, installed-package/typed-example smoke, the real client and all seven
pinned corpora. The full run also passes three million reader/parser/engine
inputs, 20,000 seeded executor statements and 10,000 crash points. The final
source passes another seeded 20,000 executor statements. Core/facade are
334,343/334,261 B gzipped under unchanged caps, captures and lazy chunks.
Preceding 1a66e59/run 38863568319 passed all eleven required jobs. Indexed
materialized probes follow; broader eligibility/order and retained prepare
choices remain open. M5.47 stays partial.

**Verified bounded indexed materialized scan (2026-10-17):**
A fresh 960-outcome probe adds an outer `g` index to the disabled-hash audit
and also retains buffering-enabled controls. Across both protocols, three
integer classes, four outer cardinalities, four inner cardinalities and five
order/LIMIT variants, the baseline agrees on 534 plans, 936 row results,
918 field vectors and all 960 warning vectors; 534 outcomes agree completely.
Native chooses 234 indexed materialized-scan outcomes. For two outer and two
inner rows with buffering disabled and `ORDER BY g,s,id`, native materialized
scan plus outer index lookup costs 2.55 and wins after the deferred access
recalculation. Before this repair the executor rejected that physical
candidate and used lookup materialization instead; its outer `g` source flags
also differed (native 0, previous 16,392). Regression proofs pin eager unique
build timing, indexed probe identity/order, NULL filtering, LIMIT, closure
and metadata. Admission remains the existing unfiltered,
positive, same-integer-class, two-base-table semijoin; the selected materialized
driver must precede an existing point lookup into the outer table. Retain the
deferred native access recalculation and point fanout, eager unique build,
one lookup per distinct non-NULL key and source-field metadata boundary.
Share the existing build and point-read owners; do not turn a raw weedout
driver into a materialized one. Preserve every matching component in this
new probe as well as the existing controls. Broader cost/pruning and retained
prepare contexts remain separate; M5.47 is still partial.

The bounded implementation now reuses the point-reader owner. It consumes the
complete raw driver before keyed deduplication, excludes NULL keys and opens
one point read per retained key. The 960-outcome probe improves from 534 to
768 complete matches; all 234 indexed scans agree, as do all 960 row, field
and warning vectors. Every previously matched component remains intact.
The deferred indexed candidate must also beat its local strategy competitor
before final sort cost is added. Native four-outer/eight-inner traces choose
weedout 6.05 over indexed scan 6.45 at that stage, then retain outer-first
materialized lookup globally; overlooking this loses 36 previously matching
outcomes. Permanent controls pin that boundary with both buffering settings
and ORDER/LIMIT variants.

Keyed DISTINCT supplies the unique source without a new materialization
adapter. Its optional key callback excludes undefined keys; ordinary SQL
DISTINCT still retains one NULL row. Canonical key insertion is shared with
physical-row weedout and joined UPDATE/DELETE. Scope star expansion uses the
existing slot lookup. A shared lowercase hex encoder in @myjs/bytes replaces
copies in parser deparsing, digests, SQL keys/HEX/UUID and client literal
formatting; byte equality retains its length guard and delegates to the byte
comparator. These changes keep every existing API and representation intact,
with one added byte utility. Unit oracles cover every byte, Buffer/subarray
inputs, large subjects and native byte comparison.

The remaining 192 plan differences in the new probe are indexed weedout:
two/four outer rows with an empty or one-row inner table, under both buffering
settings. Rows, fields and warnings already agree. A separate native activity
probe with materialization disabled reads four raw driver rows, filters the
NULL key and opens three point lookups: 15 matching pairs become ten physical
outer identities. LIMIT 1 stops after two raw driver rows and the first point
result. Empty and NULL-only drivers skip a locked outer table; a valid key
waits on that lock (native 1205). This streams its raw driver; it must not
reuse the eager unique build or repeated full scans' NULL-driver behavior.
Prove duplicate identities, NULL filtering, pair consumption and closure for
that point-read strategy before admitting it. Broader semijoin eligibility,
prepared strategy retention and M5.49/M5.50 remain open.

Core/facade are 334,316/334,259 B gzipped under unchanged caps; all nine size
gates pass. All 1,309 tests, typecheck, lint, installed-package/typed-example
smoke, the real client and all seven pinned corpora pass. The full run also
passes three million reader/parser/engine inputs, 20,000 seeded executor
statements and 10,000 crash points. Initial orchestration stopped during the
crash stage; authoritative process inspection confirmed it was no longer
running. The remaining crash and reference stages passed after resuming in
the same containers. Final production files match that snapshot; a separate
final full test run includes both buffering settings in the lifecycle test.
Thirty-five focused native checks, all prior matching audit components, the
240 last-resort cost controls, older controls and 2,124/2,248 plans remain
intact. Fresh complete matches improve from 313 to 319/352. No fixture, cap,
lazy chunk or comparison floor changes. Preceding bd53a65/run 38866841399
passed all eleven required GitHub jobs.

**Verified bounded indexed raw weedout (2026-10-17):**
The existing point reader now admits the unfiltered two-leaf integer proof
when the cost search selects inner-first raw weedout. A shared operator owns
statement-scoped physical identity for point reads and repeated scans. It
checks each candidate's ON condition before suppressing repeated identities;
raw weedout cannot inherit FirstMatch or unused-final-table stopping. Hash
weedout retains its existing probe-local identity owner. LATERAL invalidation
uses the actual inner reference rather than the absence of a weedout setting.

The new 1,920-outcome native sweep improves from 720 to 1,920 complete matches;
all rows, ten field attributes, warnings and plans agree. It covers INT,
BIGINT and unsigned BIGINT, empty and NULL inputs, four cardinalities,
buffering/duplicateweedout switches, ordering/LIMIT and both protocols.
Every previously matched component survives. The earlier indexed materialized
scan sweep improves from 768 to 960/960, closing all 192 raw-weedout plan gaps.

Protocol regressions pin duplicate-valued physical rows, NULL keys, exact
integer metadata and fresh prepared executions. Counted reads prove four raw
driver rows open three point probes, testing 15 pairs before emitting ten
physical identities. LIMIT 1 consumes only the NULL driver, first non-NULL
key and first matching outer row; both readers close. Empty/NULL-only drivers
skip probing. A 4,096-row cancellation test retains raw duplicates, closes
both readers and releases the writer with either buffering setting.

Full Docker verification with --full --reference passes all 1,311 tests,
typecheck, lint, nine size gates, installed-package/typed-example smoke,
three million reader/parser/engine inputs, 20,000 executor statements seeded
20261010, 10,000 crash points, the real client and all seven pinned corpora.
Thirty-seven focused native checks, every prior matched component, all 240
last-resort controls and 2,124/2,248 plans remain intact. Fresh audit matches
remain 319/352; full field matches improve from 337 to 340. Core/facade are
334,333/334,257 B gzipped. Captures, caps, lazy chunks and the comparison floor
are unchanged. The tested source and all 299 test files match the workspace.
Preceding bac15fc/run 39059287244 passed all eleven required GitHub jobs.
Broader predicates, semijoin eligibility, access/order comparisons and retained
prepare choices remain open; M5.47 stays partial.

**Verified bounded correlated EXISTS materialization (2026-10-17):**
The existing literal-projection, single-equality decorrelation proof now admits
materialization alongside IN. Both equality directions reuse the existing
cost/build/probe owners; no new execution machinery is introduced. Residual
predicates must still be absent, columns must be exact integers, and grouping,
nested select/order expressions and temporary tables retain their exclusions.

A 1,920-outcome native sweep improves from 1,230 to 1,920 complete matches:
all plans, rows, ten field attributes and warnings agree. Only materialization-
enabled choices change; disabled-materialization controls are preserved. The
existing 352-outcome fresh-data audit improves from 319 to 337 complete matches
without losing a previously matched component. All earlier 1,920 indexed raw
weedout, 960 indexed materialized and 240 last-resort outcomes remain native.

Existing protocol tests now exercise IN, EXISTS and reversed equality through
materialized hash scans, repeated scans, indexed scans and lazy lookup. They
retain integer/unsigned BIGINT exactness, NULLs, duplicate physical identities,
metadata, warnings, sorting and fresh prepared executions. Counted cancellation
tests cover correlated indexed/repeated scans and lazy lookup; eager builds
still finish before probing, and empty/NULL-only outer input does not initialize
a lazy build. Returning the locking streams closes readers and releases writers.

A separate 320-outcome exclusion audit is strictly unchanged against the
preceding commit. It covers residual and additional correlated predicates,
grouping, nested select/order expressions, DECIMAL/DOUBLE/BIT/string columns
and temporary tables with both buffering settings and protocols. Every row and
warning vector agrees with native; 312 full field vectors agree. Their 320 plan
differences and eight field differences remain recorded for later work. These
controls prove retained boundaries, not completed broader eligibility.

Thirty-seven focused native checks, previous matching audit components,
20,000 executor statements seeded 20261010 and all nine size gates pass.
Core/facade are 334,329/334,253 B gzipped; fixtures, caps and lazy chunks are
unchanged. Full Docker/reference verification passes all 1,311 tests,
typecheck, lint, package/typed-example smoke, the real client and all seven
pinned corpora. The tested production source and all 299 test files match the
workspace. The preceding slice also passed its full fuzz/crash gate locally.

Preceding 6112f4d/run 39060657177 passed ten required CI jobs; the pinned-
reference job failed its internal bulk-PREPARE latency test (125 ms versus
one-third of 372 ms), before reference replay. The unchanged second attempt passed all required jobs.
Ten isolated Docker repetitions pass; one of four simultaneous copies pinned
to one CPU reproduces the ratio failure. Thresholds remain unchanged. Investigate
this scheduling-sensitive check before more optimizer work; the independently
validated EXISTS slice is preserved. Broader residual materialization, semijoin
eligibility, access/order costing and retained prepare choices remain open;
M5.47 stays partial.

**Verified CI latency isolation repair (2026-10-17):**
The required pinned-reference job exposed process contention in the relative
PREPARE latency assertion. Ten isolated repetitions pass; one of four test
processes pinned to the same CPU reproduces the failure despite 23 answered
round trips. External processes can delay either measurement unevenly, so a
relative bound cannot cancel that interference.

The canonical npm test and protocol-test commands now discover the same test
files, run ordinary files with Node's existing parallelism, then run the full
bulk-latency file as a separate required phase. Both client connections still
compete within that test; its one-third bound, minimum trip counts, data sizes,
cancellation assertions and every case remain unchanged. Failure of either
phase fails the command. Docker and CI already invoke the canonical command.
Runner fixtures pin nested discovery, protocol-only selection, exactly-once
execution, phase ordering and failure propagation from either phase. No runtime
SQL, scheduler, protocol, fixture or bundle-budget change is part of this repair.
The latency comment now states the actual limitation of external CPU load.

Discovery matches the original globs exactly: 260 test modules, 259 ordinary
and one latency file. Fresh Docker --reference verification passes all 1,314
cases (1,310 ordinary plus four latency), typecheck, lint, nine size gates,
package/typed-example smoke, the real client and all seven pinned corpora.
The three runner fixtures also pass on Windows; protocol CLI option forwarding
passes in Docker. The tested source, runner, package script and all 300 files
under test match the workspace. Core/facade remain 334,329/334,253 B gzipped.
Historical changelog entries and all latency code from the bound onward are
byte-for-byte unchanged. Preceding ed507e5/run 39061469118 passed all eleven
required CI jobs. The earlier 6112f4d reference failure passed on unchanged
attempt two. Continue with the bounded filtered-equality evidence below.

**Next filtered-equality evidence:** A separate 1,920-outcome native sweep adds
one inner-key numeric-literal residual to the correlated equality. Across
INT/BIGINT/unsigned BIGINT, buffering/materialization switches, cardinalities,
ordering/LIMIT and both protocols, the baseline agrees on 1,872 row results,
1,560 full field vectors and all warning vectors, but no complete plan. This
is a separate eligibility/cost proof, not covered by the trivial-EXISTS repair. All 48 row
mismatches are unordered, unbounded output order, twelve per switch set;
every row multiset and physical identity agrees with native. Native selected
materialized scan or raw weedout groups point probes by driving key, whereas
the current fallback retains outer scan order. Preserve this distinction;
no value, multiplicity or ordered/LIMIT result mismatch was found in this
sweep. The next proof must price the filtered range/build before admission,
retaining materialization-disabled and other residual controls.
A discarded admission prototype preserves all previously matched components
in this sweep but reaches only 144 complete matches. It is not shipped.
Pinned optimizer trace for 20 outer/eight inner INT rows prices the four-row
covering inner range at 0.660823, before the join's row evaluation. It prices
the ten-row non-covering outer range at 3.76, likewise before join evaluation.
MaterializeScan wins at 6.86082 versus MaterializeLookup at 8.22082. The inspected pre-quote
prototype instead charges filtered scans (0.65 inner, 1.25 outer);
with the existing formulas the prototype prefers lookup at 5.7 over scan at
6.85. Cardinalities are already correct (inner four, outer ten, ref fanout five).
This identifies the missing range access quote as the cause of the reversed
strategy comparison.

**Verified constant-range quote boundary (M5.49 feeding M5.47, 2026-10-17):**
Join placement now consumes the selected single-interval constant range's
index, row estimate and price from the existing range selector and index dives.
It retains the ordinary scan when no range wins. Range reads are priced once
per prefix row, regardless of buffering, with discarded-row evaluation before
the join's kept-row evaluation. Ref heuristics use the selected range's rows
and price; a compatible ref on the same index retains native precedence.
Selection and quoting share the existing range shape/count/cost readers.

Unbuffered ordinary joins now execute repeated inner reads through the existing
nested-loop owner. Each logical inner row retains its outer context so ON and
local predicates can share one filter before identity suppression. Materialized
build/probe lifetimes retain their existing owners. Shared slot construction,
planner bookkeeping and byte equality replace duplicated implementations;
public APIs, captures, caps and lazy chunks are unchanged.

The 72-outcome pinned native audit agrees on every row, all ten field
attributes, warnings and plans for covering/non-covering range versus ref,
both buffering settings, selective/broad/empty ranges, ORDER BY and LIMIT,
through query and execute. A real prepared statement also sees changed bounds
and data without stale access. A separate 24-outcome native guard audit pins
nested LEFT JOIN, three-table ON and LATERAL results, field flags/origins and
warnings with buffering on/off. Three cost tests pin repeated reads, discarded
row evaluation and ref precedence. Counted local lifecycle tests over 16,384
rows pin one buffered range versus twenty repeated ranges (2,048 versus 40,960
visits), LIMIT's one-row stop, active-stream cancellation, closure and writer
release. These larger lifecycle counts are implementation invariants, not a
native plan-equivalence claim: a separate native probe chooses per-iteration
range replanning on this larger sampled-statistics dataset. That broader
statistics/access-path divergence remains M5.49 work.

Thirty-nine focused checks pass in the Docker native-mode run against pinned
8.4.11, including local lifecycle instrumentation. Prior native
threshold/switch/materialization/order controls and every previously matched
audit component remain intact; the fresh audit retains 337/352 complete and
340 full-field matches, and the corpus retains 2,124/2,248 plans. All nine size
caps pass (core/facade 334,328/334,254 B gzipped). Full Docker verification with --full --reference passes all 1,319 tests,
typecheck, lint, installed-package/typed-example smoke, three million fuzz
inputs, 20,000 seeded executor statements, 10,000 crash points, the real client
and all seven pinned corpora. The tested production, runner/package script and
all 302 files under test match the workspace. Preceding 7fccd53/run 39062684849
passed all eleven required GitHub jobs.

**Verified equality-inferred access proof (M5.49, 2026-10-17):** physical
reads and join quotes now share a statement-local inferred predicate. Initial
admission is two base tables without a nullable join side, a direct equality
between matching INT/BIGINT storage types and signedness, and `column > integer
literal`. Base-column resolution excludes derived/LATERAL sources. Other
comparisons, types, expressions, transitive classes and bound parameters retain
their existing path. The selector, range shape/price and index dives remain the
same authority. Quotations now use the existing statement access cache.

The separate 48-outcome ordinary-equality audit improves from 36 to 48 matching
row results; every field and warning vector remains native. All twelve
unordered arrival differences close. The inferred outer range now runs, while
a redundant child filter remains in all 48 plans. Filter elimination is not
claimed. Permanent tests pin 72 further executions through both protocols for
reversed equality, NULLs, exact BIGINT bounds, buffering, order and LIMIT, plus
LEFT JOIN/LATERAL exclusions and real prepared statements after parameter/data
changes. Prepared tests retain a literal inferred bound and vary a separate
outer-id parameter; inference from a bound parameter remains open. A separate
32-outcome guard audit preserves complete native results, fields and warnings
for INT/DOUBLE, INT/VARCHAR, BIGINT/DOUBLE and signed/unsigned BIGINT pairs;
none admits the excluded outer range. A further 144-outcome audit agrees on
rows, full fields and warnings around INT, signed/unsigned 64-bit and over-64-bit
literal bounds. A 192-outcome empty/small-inner cardinality sweep also matches
every row, full field and warning vector, preserving every previously native
component; its remaining plan differences include the same child-filter gap.

Conjunction construction is shared with the existing semijoin/SHOW readers.
Base-column proofs resolve through the existing scope owner instead of a
second qualified-name shortcut. Range sample counters are accumulated locally
and converted to the result map once; repeated recursive filter estimates
share their already bound context. These changes preserve their existing
source positions and evaluation order. All nine unchanged size caps pass
(core/facade 334,350/334,258 B gzipped).

The preceding constant-range commit 3ceed5a/run 39065277424 passed all eleven
CI jobs. Focused native-mode checks, previously matching audit components,
2,124/2,248 plans and 20,000 seeded executor statements pass. Full Docker
verification with --reference passes all 1,320 tests, typecheck, lint, nine
size gates, installed-package/typed-example smoke, the real client and all
seven pinned corpora. Tested production, runner/package script and all 303
files under test match the workspace. Captures and lazy chunks are unchanged.

**Verified filtered candidate/build proof (M5.47, 2026-10-17):** the
20-outer/eight-inner trace now uses the shared access quotations: covering
inner range 0.660823271131 and non-covering outer range 3.76. Measured
MaterializeScan is 6.860823271131 versus MaterializeLookup 8.220823271131,
matching pinned native costs and the winning strategy. The selected access,
not a second selectivity formula, supplies these prices.

Bounded residual admission now consumes that same inference proof. The actual
predicate stays with the FROM's filters; only its cost/strategy eligibility
changes. The existing grouping/nested-expression materialization boundary
must hold. Matching INT/BIGINT types and signedness, a direct two-column
integer equality, an indexed outer key and `inner_key > integer_literal`
remain the admitted class. Other residuals retain their prior behavior.
Proven inferred entries are rebuilt for each table; absent proofs are removed.
FirstMatch's captured logical-inner configuration is shared across its uses.

The original 1,920-outcome sweep improves from zero to 1,188 complete native
matches, with all rows/warnings and 1,836 full field vectors agreeing. An
additional 3,840-outcome default/FirstMatch/LooseScan/materialization/buffering
sweep improves from zero to 1,344 complete matches; all rows/warnings and
3,780 full field vectors agree. Every previously matching component is
preserved in both sweeps. Combined: 2,532/5,760 complete matches, all 5,760 row
and warning vectors native, and 5,616 field vectors native. The remaining 144
field vectors and strategy/access/filter-placement differences stay open;
this is partial admission, not completion of the residual class.

Permanent regressions pin 216 executions through query/execute over IN and
both EXISTS equality directions, three integer classes, buffering, order and
LIMIT, all ten field attributes and warnings. Real prepared LIMIT values and
changed data retain fresh results. Counted local lifecycle tests over 4,096
outer rows pin the four-row filtered build completing before two point probes,
eager build under LIMIT, cancellation, both reader closures and writer release.
The native-mode run passes both new tests; its positive cases compare selected
operators and exact values/fields, while the redundant native child Filter
remains explicitly separate. These local large-data lifecycle counts do not
claim full native large-data plan equivalence.

Clustered-index identity and appended key parts now have one schema owner in
`indexes.ts`, shared by access, ordering and grouping. Range shapes use that
selected index identity. Eighteen mixed-case, UNIQUE-clustered and prefix-part
grouping outcomes agree fully with native and are unchanged from the previous
implementation. All 320 excluded-type/temporary/grouping/nested-expression
controls remain strictly unchanged, retaining their prior 312 field matches
and open plan differences. Existing audit components, 337/352 fresh matches
with 340 field matches, 2,124/2,248 plans and 20,000 seeded executor statements
pass. All nine unchanged size caps pass (core/facade 334,326/334,265 B gzipped).
Full Docker verification with --reference passes all 1,322 tests, typecheck,
lint, installed-package/typed-example smoke, the real client and all seven
pinned corpora. Tested production, runner/package script and all 304 files
under test match the workspace. Captures, caps and lazy chunks are unchanged.
An 80-outcome outer-index direction/composite audit preserves every previously
matched component: native row matches improve 64 to 72, field matches 64 to 68,
and complete plan matches zero to eight. Remaining direction/access differences
stay under M5.49. Preceding ab1cb31/run 39066562883 passed all eleven CI jobs.

**Verified bounded weedout distinct cardinality (2026-10-17):** Join candidates
now distinguish constant-condition `found_records`, which still order the
search, from unfiltered table rows, which cap distinct outer identities.
The 20-outer/eight-inner trace now reproduces native weedout 10.060823271131
rather than 9.060823271131; the verified range/build and materialized prices
are retained. Small two/four-outer and two/eight-inner traces keep their
separate tie/strategy gaps explicit.

The search only receives freely reorderable inner joins: its existing caller
rejects outer joins and LATERAL inputs. Unused dependency sets, always empty
in every producer, are removed; those caller ordering guards remain intact.
Core/facade are 334,298/334,234 B gzipped under all nine unchanged caps.

The original 1,920 outcomes now match every row, full field vector and warning,
closing its remaining 84 field mismatches; complete plans remain 1,188.
The expanded 3,840 outcomes retain every row/warning match and improve fields
3,780 to 3,828, with 1,344 complete plans. Every previously matching component
is preserved: combined 5,748/5,760 full field vectors and 2,532 complete matches.
The twelve remaining field vectors and strategy/access/filter-placement gaps
remain open. Permanent native-mode query/execute regressions cover 48 ordered
executions across three integer classes, buffering, LIMIT and 20/200 outer
rows; the preceding implementation fails their physical-plan assertion.
Fresh Docker verification with --reference passes all 1,323 tests, typecheck,
lint, nine size caps, installed-package/typed-example smoke, the real client
and all seven pinned corpora. All 304 test files and touched production match
the tested source. The 20,000-statement executor seed passes. All 960 indexed
materialization and 1,920 trivial-EXISTS outcomes remain fully native; all 320
excluded controls are unchanged. Existing base/fresh controls and 2,124/2,248
plans pass. Captures, thresholds and lazy chunks are unchanged.
Preceding ffbb6b7/run 39068161106 passed all eleven CI jobs.

**Small-inner arithmetic evidence (2026-10-17):** In the two/four-outer,
two-inner cases, the local materialized scan is 2.0100000000000002 while
weedout is 2.01; native chooses the materialized scan at the displayed 2.01
tie. Grouping the outer read/evaluation alone does not remove this difference.
Pinned [`sql_planner.cc`](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_planner.cc#L3715-L3718)
charges weedout temporary creation before its separate read/write contribution;
[`opt_costmodel.h`](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/opt_costmodel.h#L178-L185)
combines write/read row counts.
The local folded creation-plus-rows addition rounds differently. Creation is
now charged first at the existing weedout owner, reproducing exact scan/weedout
2.0100000000000002 ties. The 4.260823271131 tie and neighboring 2.66/3.46 and
6.860823271131/10.060823271131 non-ties are retained. Materialization, the
ordinary step and exact strategy comparisons are unchanged.

This corrects 108 materialized-scan choices in the original filtered sweep and
48 in the expanded switch sweep. Every previously matching component remains;
all 5,760 row/warning vectors, 5,748 field vectors and 2,532 complete plans
remain native. Redundant child Filter placement prevents these strategy
repairs from increasing complete-plan counts. The twelve default-FirstMatch
field cases remain separate. A permanent 216-execution query/execute regression
covers IN/both EXISTS directions, three integer classes, two buffer settings,
ties and neighboring non-ties. It passes native mode and fails on the preceding
implementation. All nine unchanged size caps pass (core/facade 334,300/334,236 B
gzipped). Broader controls preserve all existing matched components, including
960 indexed materialization and 1,920 trivial-EXISTS outcomes; 320 excluded
controls are unchanged. The executor seed passes 20,000 statements and the
relational plan count remains 2,124/2,248. Fresh full Docker --reference passes
all 1,324 tests, typecheck, lint, nine size caps, installed-package/typed-example
smoke, the real client and all seven pinned corpora. All 305 test files and
touched production match the tested source. Captures, thresholds and lazy
chunks are unchanged. Preceding f1729d2/run 39069311634 passed all eleven CI jobs.

**Remaining FirstMatch competition evidence (2026-10-17):** The four-outer,
two-inner default ordered LIMIT 1 trace prices LooseScan at 0.900274423710
plus one output row of sort, versus FirstMatch 1.86 with the outer sorted
before its probes. Locally LooseScan is 0.800274423710 and prunes FirstMatch
at 1.800274423710. The full loose-index scan reapplies filtering already covered
by the selected constant range. Native condition filtering retains those
range-covered fields even when pricing a loose full-index scan; the local
ordinary placed filter already owns that exclusion. Each existing candidate
now retains whether its constant range was selected; LooseScan costing reuses
that fact and its placed filter without another range-estimation scan. Physical predicates, full-index reads, original lookup
read prices and ordinary unselected-range filtering are preserved.

The twelve remaining field differences are closed: all 5,760 row, full-field
and warning vectors in the two filtered sweeps now agree with native, retaining
every earlier matching component. Complete plans remain 2,532/5,760; redundant
child filters and broader strategy/access differences stay open. A permanent
648-execution query/execute regression covers IN/both EXISTS directions, three
integer classes, buffering, six neighboring cardinality pairs and default,
LooseScan-off and FirstMatch-off settings. It passes native mode and fails on
the preceding implementation. Exact FirstMatch/materialization choices and
all ten field attributes are pinned; remaining LooseScan/weedout controls
compare their selected known boundaries without claiming complete trees.
Counted local tests prove two outer range records close before one inner probe,
including a wide returned locking stream and writer access to both tables.
All nine unchanged size caps pass (core/facade 334,315/334,250 B gzipped).
Fresh Docker --reference passes all 1,326 tests, typecheck, lint, nine unchanged
size caps, installed-package/typed-example smoke, the real client and all seven
pinned corpora. All 306 test files and touched production match the tested
source. The executor seed passes 20,000 statements. Existing base/fresh and
older controls pass, as do 2,124/2,248 relational plans. All 960 indexed
materialization and 1,920 trivial-EXISTS outcomes remain fully native; 320
excluded controls are unchanged. Captures, thresholds and lazy chunks are
unchanged. Preceding bace47f/run 39070023703 passed all eleven CI jobs.

**Integer-width ownership and new set-operation boundary evidence (2026-10-17):**
`@myjs/types` now owns the five SQL integer packed widths through `integerBytes`,
shared by integer ranges, field encoding/decoding, index costing, foreign-key
storage classes and set-operation width ordering. YEAR, floating, temporal and
decimal policies remain with their callers. Before/after comparison of 784
UNION/UNION ALL observations across fourteen boundary column types and both
protocols is strictly unchanged. Native agreement is 640 result vectors, 512
full-field vectors and all 784 warnings. Its 400 integer-only outcomes agree on
336 result vectors and 280 field vectors; the other 384 agree on 304 result
vectors and 232 field vectors. Keep those repair groups separate.
These are newly exposed pre-existing
M5.19 gaps, not relaxed test gates: TINYINT signed plus TINYINT UNSIGNED should
report SMALLINT; the old TINYINT field decodes 255 as -1 through execute().
M5.19 is reopened and these wrong-result cases take priority over plan cleanup.

The physical predicate-proof prototype uses exact integer-equality inference
plus the executed outer range's encoded lower bound. It reproduces the focused
native FirstMatch tree while retaining focused rows/fields/warnings. It is
unshipped: the prototype exceeds the unchanged size caps and broader negative
and evaluation-count verification is still required. No SQL filter removal is
included in the width cleanup. Raw core/facade code falls 158 B; gzip remains
essentially unchanged at 334,320/334,252 B, under all nine unchanged caps.
This establishes one width owner but does not solve the proof's size constraint.
Fresh Docker --reference passes all 1,326 tests, typecheck, lint, nine unchanged
size caps, installed-package/typed-example smoke, the real client and seven
pinned corpora. All 306 test files and all five touched runtime sources match
the tested copy. All 5,760 filtered outcomes are strictly unchanged; existing
base/fresh and older controls, 2,124/2,248 plans and 20,000 seeded executor
statements pass. Captures, thresholds and lazy chunks are unchanged.
Preceding e8c948e/run 39071065681 passed all eleven CI jobs.

**Integer UNION signedness repair (2026-10-17):** integer set-operation typing
now calls the existing expression aggregate owner instead of selecting a field
by packed width alone. Its signedness policy widens mixed inputs through
SMALLINT, MEDIUMINT, INT and BIGINT to DECIMAL, preserving UNION widths,
nullability and source-free metadata. All 400 integer-only observations now
agree with MySQL 8.4.11 on rows, complete field metadata and warnings. The
other 384 observations are unchanged at 304 result and 232 field matches;
there are no previously matching component regressions. The permanent native
regression pins 460 executions: every integer pair in both protocols, UNION
and UNION ALL, both operand orders, storage boundaries, nested and NULL
branches, and empty typed branches. It fails against the preceding code.
Core/facade shrink to 334,265/334,202 B under all nine unchanged caps.
Fresh Docker --reference passes all 1,327 tests, typecheck, lint, installed
package/typed-example smoke, the real client and all seven pinned corpora.
All 307 test files and touched runtime sources match the tested copy; the
20,000-statement executor seed passes. Captures, caps and lazy chunks remain
unchanged. Preceding 7fa7d68/run 39072448863 passed all eleven CI jobs.

**Next:** repair the remaining measured M5.19 YEAR/integer and FLOAT
set-operation boundaries, separating value conversion from field policy. The
84 YEAR/integer outcomes retain 68 row and 84 field mismatches; the 108 FLOAT
partner outcomes retain 12 row and 68 field mismatches. All other 576 outcomes
are fully native, including the DECIMAL controls. A separate 784-outcome audit
using FLOAT(8,2)/DOUBLE(8,2) agrees on 716 result and 492 field vectors, with
all warnings matching; its fixed-scale metadata remains a separate repair
group, not part of the 400 repaired integer observations. Then verify redundant child Filter
elimination against the actual executed range and integer-equality proof; retain physical predicates unless those
existing facts prove them redundant. The candidate's selected-range cost fact
alone is insufficient: a full LooseScan still evaluates its bound. Preserve exact temporary-cost ties,
distinct cardinality, range/build prices and every earlier matching component.
Broader strategy/predicate coverage, multi-interval and bound-parameter
inference, retained prepared choices and sampled-statistics access differences
remain separate. M5.47 and M5.49 stay partial.

The pinned source cross-check is MySQL 8.4.11's
[sql_planner.cc](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/sql_planner.cc),
particularly `calculate_scan_cost` and `best_access_path`. The Docker trace,
not an EXPLAIN spelling change, supplies the acceptance evidence.

**Verified last-resort weedout costs (2026-10-16):** The two
remaining 180-case switch mismatches were the four-row outer/two-row inner
case with all four alternatives disabled and ORDER BY g,s LIMIT 1, through
query and execute. Native trace costs inner-first hash weedout at 3.80001
versus outer-first indexed weedout at 3.85. The internal FirstMatch contract
now captures the logical inner alias and availability separately, preserving
identity when disabled. Filtered costs keep their previous boundary. Disabled
weedout is costed only as the last resort when the other alternatives are absent.

A fresh 240-outcome sweep also pins an unordered two-row/two-row prefix tie.
With weedout enabled, native pruning retains the indexed loop; with all
alternatives disabled, native explores the hash competitor at 2.40001 versus
2.55. Root-prefix admission preserves this switch-dependent distinction rather
than enabling disabled weedout generally. The sweep improves 214 to 240/240,
matching every row, full field, warning and plan. A permanent protocol test pins
both boundaries with weedout on/off, preserving the enabled-strategy control.

Point-read stop behavior now belongs to the indexed-join owner: FirstMatch and
DISTINCT's unused final table share that decision, with dynamic/left-join
exclusions retained. Owned hash arrays/buckets are arranged once after complete
source reading/key evaluation, preserving newest-first hash probes, oldest-first
index probes and materialized key order without a generator for every probe.
Key-dependency analysis consumes the planner's already split conjuncts. Private
planner objects store explicit undefined values instead of allocating optional
object spreads; their public contracts and readers are unchanged.

Thirty-two focused native checks, nineteen local FirstMatch/semijoin checks,
typecheck and all 1,303 Docker tests pass. Strict audits retain every previously
matching component: switch cases improve 178 to 180/180; base 288/288, fresh
313/352 with 337 fields, threshold 2,160/2,160, matrix 144/144, 120 hash-order
and 120 disabled-hash outcomes remain intact. All 192 earlier fresh observations,
2,243 older controls and 2,124/2,248 corpus plans are retained, with the 2,118
floor unchanged. The 480-case disabled-hash audit still has 66 separate repeated-
scan weedout plan gaps. Core/facade are 334,340/334,266 B gzipped under unchanged
caps; 20,000 executor statements seeded 20261010 pass. Full package/client gates
and all seven pinned corpora pass. M5.47 stays partial. Preceding
8067288/run 38801397933 passed all eleven required GitHub jobs.

**Verified bounded hash weedout (2026-10-15):** The bounded unfiltered
inner-first hash path retains raw inner duplicates and evaluates every candidate
pair. Each physical outer row has one probe visit, so a probe-local emitted bit
removes repeated output without conflating equal projected rows. A single pair
loop now serves hash, automatic-index, constant and lateral joins; their build
and scan owners retain initialization, ordering and cancellation. Lookup key
kind reads the existing column metadata helper instead of constructing a scope.

Pinned MySQL EXPLAIN ANALYZE verifies 15 raw matching pairs and ten distinct
outer identities, one complete inner build, one outer scan and no outer scan
for empty/all-NULL hash builds. A two-connection lock probe confirms that empty
builds skip a locked outer table, while a nonempty build waits (1205/HY000).
Three regressions cover query/execute integer fields (including exact signed
and unsigned BIGINT), ordering, equal projected outer rows, fresh prepared
writes, complete pair evaluation, build/probe counts, backpressure and closure.
Thirty-one focused checks pass locally/natively. Strict audits improve base
276 to 288/288, fresh 301 to 313/352 (fields 328 to 337), threshold 2,148 to
2,160/2,160 and switch 164 to 178/180; every previously matching component is retained. Matrix 144/144,
120 hash-order cases, 120 disabled-hash cases and all 120 materialized loops in
the 480-case complete-order probe remain intact. The latter's 66 unbuffered
weedout plans remain separate. Two switch outcomes still choose a native hash
weedout over the ordered outer lookup with all four alternatives disabled;
repair that cost boundary before wider eligibility. M5.47 stays partial.
All 1,302 Docker tests, typecheck, lint, nine unchanged size gates, installed-
package/typed-example smoke, the real-client exit criterion, seven pinned
corpora and 20,000 executor statements seeded 20261010 pass. All 192 earlier
fresh observations, 2,243 older controls and 2,124/2,248 corpus plans are
retained, with the 2,118 floor unchanged. Core/facade are 334,337/334,264 B
gzipped within unchanged caps; no fixtures were recaptured.
Preceding c7a2488/run 38797571100 passed all eleven required GitHub jobs.

**Verified MaterializeScan switch repair (2026-10-15):** Independent
review of a71435d found that unfiltered materialized scans still hash with
`block_nested_loop=off`. A fresh pinned 120-outcome control matches all rows,
full fields and warnings, but only 84 complete plans: 36 native plans use a
real materialized nested loop with repeated outer scans. The original slice's
verified hash scope therefore required hash joins enabled. The repair extends
native scan/loop costs and execution through the existing build/probe owner,
pinning multiple distinct inner keys, duplicate outer identity, NULLs, exact
BIGINTs, initialization, ordering, repeated reads and early closure before
resuming physical weedout.

The repair captures the unfiltered scan-buffering policy
for native access costs and selects an explicit lazy lookup, eager hash scan or
eager nested-loop mode. All modes share the existing build and pair-evaluation
owner; a loop visits deduplicated keys in build order and scans the outer once
per distinct key. The original disabled-hash probe improves 84 to 120/120
complete outcomes. A fresh 480-outcome probe with complete sort keys matches
all rows, full fields and warnings, including all 120 selected materialized
loops; its 66 remaining plan differences are physical weedout. The earlier
200-row probe also exposed existing filesort tie ordering, still open in M5.49.
Native EXPLAIN ANALYZE pins one build, two outer scans for two distinct keys,
NULL exclusion and repeated all-NULL outer scans. A locked outer input is skipped
for an empty build and waited on for a nonempty one. Fifteen focused checks
pass locally/natively; counted scans pin repeated reads, backpressure, early
return and writer release. Twenty-eight broader native/older controls and
strict component audits pass on the final candidate. Lookup and range costing
consume already split conjuncts from the same tree traversal. All 1,299 Docker
tests, typecheck, lint, nine unchanged size gates, installed-package and typed
example smoke, the real-client exit criterion, seven pinned corpora and
20,000 executor statements seeded 20261010 pass. Core/facade are
334,351/334,265 B. Hash order 120/120, matrix 144/144, threshold 2,148/2,160,
switch 164/180, base 276/288, fresh 301/352 with 328 fields, 192 earlier fresh
and 2,243 older controls and 2,124/2,248 corpus plans are retained; every
previously matching component and the 2,118 floor remain intact. Physical
weedout, indexed materialized probes and wider eligibility/order costs remain
open; M5.47 stays partial.

Exact-SHA CI for a71435d/run 38793269915 passed ten required jobs and failed the
PREPARE responsiveness test in the pinned-reference job: 170 ms maximum delay
across a 417 ms statement and 21 round trips exceeded its one-third bound.
Six isolated pinned-Node Docker repetitions pass; a profiled run measures
40/181 ms and 17 trips. The single rerun of that failed job passes on the same
SHA: attempt 2 now has all eleven required jobs passed. The original failure is
retained; no timing threshold or test is weakened.

**Verified bounded MaterializeScan/hash (2026-10-15):** Fresh pinned
MySQL 8.4.11 EXPLAIN ANALYZE tests show a real deduplicated inner build before
the outer probe. With 20 outer rows and an empty inner input, materialization
and the inner index scan execute once while the outer table scan is never
executed. With one non-NULL inner key, the build executes once and all 20 outer
rows are probed, preserving five equal outer results. All-NULL outer input
still performs that build and probes 20 rows, returning none. This lifecycle
must remain distinct from MaterializeLookup's valid-outer-key lazy build.

A second connection holds an outer-table write lock. Materialized hash with
empty inner input returns an empty result without waiting; with one inner key,
the same native plan waits and reports ER_LOCK_WAIT_TIMEOUT. This independently
pins empty-build short-circuiting rather than inferring it from row results.

Native classic optimizer traces cost MaterializeScan at 3.8 versus inner-first
weedout 4.0 and outer-first MaterializeLookup 5.7 for 20 outer rows and the
empty inner estimate. With eight inner rows, scan costs 19.9 versus weedout
20.1 and lookup 7.1; lookup wins. These are strategy-selection costs, distinct
from iterator costs printed by EXPLAIN ANALYZE. Ordered cases retain the
lookup/sort decision. Both orientations now compete through the existing search
and execute a deduplicated build/probe through its shared owner. Native checks
pin NULL exclusion, duplicate outer identity, fresh executions and scan closure.
Selection follows costs rather than empty-data inspection.
Physical hash weedout and broader eligibility remain separate open work.
Preceding 521b66b/run 38529430860 passed all eleven required CI jobs.

The implementation selects and executes the bounded hash scan
through the existing deduplicated build/probe owner. It retains eager scan
initialization, empty-build short-circuiting and lazy lookup initialization.
Native query/execute checks include full integer fields, duplicate outer row
identity, ordering and fresh prepared executions. Counted scans additionally
pin early stream closure under backpressure and eager builds for all-NULL
outer input. Fourteen focused checks pass locally and against the pinned server;
20,000 executor statements seeded 20261010 pass. Comparison audits improve the
materialization matrix 136 to 144/144, threshold cases 2,100 to 2,148/2,160,
switch cases 160 to 164/180 and fresh cases 292 to 301/352, preserving every
previously matching component. The 120-case integer projection/order probe
matches completely. Indexed MaterializeScan probes and physical weedout remain
open. The size repair now passes all nine unchanged gates at core/facade
334,340/334,261 B. Condition placement and hash key compilation share the same
equality-side proof; lookup proofs share nonconstant alias containment. One
join-tree traversal collects leaves, retained ON predicates, costing predicates
and written lookup eligibility. Restricted compilation scopes and candidate
statistics are captured once per planning owner. The SELECT caller receives
only the selected physical ordering fact. All 1,298 Docker tests, typecheck,
lint, nine unchanged size gates, installed-package and typed-example smoke,
the real-client exit criterion and all seven pinned corpora pass. Twenty-seven
live native controls and the strict audits pass on this final candidate, as do
20,000 executor statements seeded 20261010. Base 276/288, 328 matching fresh
fields, 192 earlier fresh and 2,243 older controls and 2,124/2,248 corpus plans
are retained; the floor remains 2,118. The preceding full three-million-input
fuzz and 10,000-crash-point run is the earlier cost slice's result, not a new
full run for this slice. Continue with physical hash weedout and indexed scan
probe admission; M5.47 remains partial.

**Verified LooseScan-only competition (2026-10-14):** Unfiltered
FirstMatch distinguishes explicit disablement from an unmodeled filtered
identity. The existing cost owner derives LooseScan-only semijoin identity and
charges its outer-first temporary competitor. Heuristic pruning requires a
finite complete-plan bound, allowing enabled LooseScan to replace an excluded
temporary choice. Enabled weedout ties and all-four-disabled fallback retain
their native behavior; filtered costing stays within its previous boundary.

The original driving access and prefix cost now share one captured step. Base
and derived leaves use the existing joined-row envelope, with row IDs captured
only at requested base leaves. Filter, constant-row and lateral descriptions
reuse the established wrapper; no iterator stage or resource lifetime is added.
Permanent tests pin query/execute results, full fields/warnings/plans, raw-prefix
pruning, ties, disabled alternatives and prepared executions after writes.

The 2,160-outcome audit improves 2,066 to 2,100 complete matches, and the
180-outcome switch probe improves 142 to 160. Every previously matched component
is preserved. Base 276/288, fresh 292/352 with 328 matching fields,
materialization 136/144, 192 earlier fresh, 2,243 older controls and 2,124/2,248
corpus plans are retained, with floor 2,118 unchanged. Twelve focused tests
pass locally and natively; twenty-five broader native controls and 20,000
executor statements with seed 20261010 pass. All 1,296 tests, typecheck, lint,
nine unchanged caps, package/typed-example smoke, real-client exit criterion
and seven corpora pass through `npm run verify:docker -- --reference`.
Core/facade are 334,349/334,258 B, under unchanged caps; captures and lazy chunks
are unchanged.

M5.47 remains partial. The 60 remaining threshold differences require
materialized scan/hash (48) or physical hash weedout (12). The new switch probe
retains 20 differences in those same categories; its 18 LooseScan-only choices
now agree. Eight unordered materialized scan/hash matrix outcomes remain open.
Wider predicates, filtered costs, order/access, physical weedout and retained
prepared strategy choices remain open. Preceding ddf286b/run 38526382659 passed
all eleven required jobs.

**Pinned LooseScan-only boundary (2026-10-14):** The preceding 94 threshold
differences classify as 34 existing LooseScan choices, 48 materialized scan/hash
choices and 12 physical hash-weedout choices. Repair the existing LooseScan
competition first. When unfiltered FirstMatch is explicitly disabled and
materialization is unavailable, the cost owner still needs the inner semijoin
identity to charge its outer-first weedout competitor. Absence of a modeled
FirstMatch identity in filtered queries is a separate condition; preserve those
existing boundaries rather than interpreting every missing alias as disabled.

Native FirstMatch/materialization/weedout-off controls allow last-resort weedout
until enabled LooseScan wins. An excluded temporary competitor must not supply
a finite complete-plan bound for heuristic pruning. Preserve raw driving-prefix
costs, dependency guards, enabled ties and the all-four-disabled fallback. Use
the existing LooseScan and unused-last-table iterators; do not infer broader
physical weedout or materialized scan/hash support. Prior matched components
and unchanged caps remain required. CI for ddf286b/run 38526382659 is running
with no known failure.

**Verified bounded weedout competition (2026-10-14):**
The existing cost search charges temporary creation and writes/lookups for
either order when it needs weedout, and reads duplicateweedout from the same
statement environment. With an enabled FirstMatch or materialized alternative,
a disabled temporary competitor cannot displace it. Enabled weedout retains
its native equal-cost tie priority. When no such alternative is modeled, the
existing last-resort fallback remains; general physical weedout is not admitted.

Permanent tests pin both protocols, ordered/unordered plans, full fields and
warnings for enabled ties, disabled weedout and all-four-disabled fallback,
including signed/unsigned BIGINTs beyond 2^53. Constant joins choose their
immutable fixed/shown sides once; source reads remain inside execution. The
descriptor uses the existing filter wrapper. Dependency ordering retains native
priority and written-order ties; original LooseScan driving access is reused.

The 180-outcome probe improves 96 to 142 complete matches; the 2,160-outcome
threshold audit improves 1,766 to 2,066. Base matches improve 272 to 276/288;
fresh matches remain 292/352 with 328 matching fields. Every previously matching
component is preserved. All rows/full fields/warnings remain native in the new,
threshold, materialization and base audits. The materialization matrix remains
136/144; 192 earlier fresh and 2,243 older controls and 2,124/2,248 corpus plans
are retained, floor 2,118 unchanged. Eleven local/native focused tests and
twenty-four broader native controls pass, along with 20,000 seeded executor
statements. All 1,295 tests, typecheck, lint, nine unchanged size gates,
package/typed-example smoke, real-client exit criterion and seven corpora pass
through `npm run verify:docker -- --reference`. Core/facade are 334,346/334,266 B
under unchanged caps; captures and lazy chunks are unchanged.

M5.47 stays partial. The remaining 94 threshold and 38 new switch-control
configurations include LooseScan/materialized choices and disabled-strategy
pruning that still need independent proofs. Eight unordered materialized
scan/hash matrix outcomes remain open, alongside wider predicates/order,
physical weedout and retained prepared strategy choices. Preceding e7d5e53/run
38523972634 passed all eleven required CI jobs.

**Pinned competing-strategy contract (2026-10-14):** A fresh 180-outcome
native probe spans 1/4/20 outer rows, 0/2/8 inner rows, ordered/unordered input,
both protocols and five FirstMatch/LooseScan/materialization/weedout switch
combinations. Every row, full field and warning already agrees; 96 complete
plans agree before repair. The existing 2,160-outcome audit contains 276
unused-last-table-loop versus MaterializeLookup differences, making this smaller
than introducing materialized scan/hash execution.

For one outer row and empty inner input, MySQL costs both outer-first lookup
and weedout at 1.9. Enabled weedout wins that tie; disabling it retains
MaterializeLookup. Disabling materialization as well permits last-resort
weedout until an enabled LooseScan wins. With all four strategies disabled,
native still uses weedout as its fallback. Disabling a switch therefore cannot
mean unconditional rejection of the only executable fallback. Pin outer-first
temporary costs, legal alternatives, tie priority and search pruning together
before changing selection. Preserve the existing unused-last-table iterator;
do not infer general physical weedout support from its one-row inner limit.
All previously matching components, heuristic dependency guards and unchanged
size caps remain required. The preceding 550064e CI now passed all eleven
required jobs; e7d5e53/run 38523972634 is running with no known failure.

**Verified LooseScan raw-prefix pruning (2026-10-14):**
The join search uses the original driving-table prefix for heuristic pruning
before LooseScan substitutes its distinct-key fanout. This rule now applies
independently of materialization eligibility; dependency guards and the selected
iterator's actual fanout stay intact. No strategy is forced.

Pinned MySQL 8.4.11, with FirstMatch and materialization disabled, starts with
20 outer rows at cost 2.25, then prunes an 80-row inner-first scan at cost 8.25
by its heuristic. Its final DuplicateWeedout choice costs 90.3543; because the
last table is unused, it runs an outer loop with a one-row inner limit. The
existing unused-last-table iterator supplies that behavior here. This is not
general physical weedout admission. Permanent query/execute regressions pin
both ordered and unordered results, full fields, warnings and iterator plans.

The materialization audit improves 132 to 136/144 complete matches, and the
threshold audit improves 1,724 to 1,766/2,160. Every previously matching component
is retained; all rows, full fields and warnings remain native in those audits.
Base 272/288, fresh 292/352 with 328 matching fields, 192 earlier fresh and
2,243 older controls and 2,124/2,248 corpus plans are retained, with floor 2,118
unchanged. Ten focused local/native tests and twenty-three native controls pass;
20,000 executor statements with seed 20261010 pass. All 1,294 tests, typecheck,
lint, nine unchanged size gates, package/typed-example smoke, real-client exit
criterion and seven corpora pass through `npm run verify:docker -- --reference`.
The preceding slice also passed three million fuzz inputs and 10,000 crash
points. Core/facade are 334,348/334,260 B under unchanged caps.

M5.47 remains partial. Eight unordered materialized-scan/hash audit outcomes and
394 threshold configurations still have plan differences. Broader predicates,
order/access, physical weedout and retained prepared strategy choices remain
open. CI for preceding 550064e/run 38523224503 has nine successful required jobs
and no known failure; remaining running jobs do not block continued work.

**Verified materialized lookup competing-cost repair (2026-10-14):**
The cost owner derives the bounded semijoin identity from FirstMatch or the
eligible materialized candidate. Disabling FirstMatch therefore no longer
removes inner-first weedout's temporary cost or outer-first semijoin's output
cardinality. This changes selection through the existing search and executes
the existing lazy materialized lookup and first-table sort; no empty-data rule
or descriptive-only stage is added. Unique extension reuses its captured prefix,
and materialized pruning requires an actual bounded candidate.

Fresh digest-pinned MySQL 8.4.11 traces, with FirstMatch and LooseScan disabled,
choose ordered MaterializeLookup at 5.7 versus outer-first weedout 14.25 for
20 outer rows, and 41.7 versus 131.25 for 200. Output estimates retain 20/200
outer rows. The alternative inner-first MaterializeScan costs 3.8/21.8 before
ordering; those unordered scan/hash strategies remain open. Permanent tests
pin both protocols, full fields/warnings/plans and retained executions across
empty, duplicate/NULL-populated and empty-again inner inputs.

The 144-outcome audit improves 128 to 132 complete matches, and the 2,160-outcome
threshold audit improves 1,680 to 1,724. All rows, full fields and warnings agree;
every previously matching component is preserved. Base 272/288, fresh 292/352
with 328 matching fields, 192 earlier fresh and 2,243 older controls and
2,124/2,248 corpus plans are retained, with the unchanged 2,118 floor. Nine
focused tests pass locally and natively; twenty-two broader native controls
pass. All 1,293 tests, typecheck, lint, nine size gates, package/typed-example
smoke, three million seeded fuzz inputs, 20,000 executor statements, 10,000
crash points, the real-client exit criterion and seven corpora pass through
`npm run verify:docker -- --full --reference`. Core/facade are 334,350/334,261 B
gzipped under unchanged caps; captures and lazy chunks are unchanged.

M5.47 stays partial. Twelve materialization audit and 436 threshold complete
configurations still differ in plan; unordered scan/hash, disabled-materialization
choices, broader predicates/order, physical weedout and prepared strategy
contracts remain open. Preceding commit 1691b2c/run 38521048178 passed all eleven
required jobs; pending CI does not block the next validated slice.

**Verified bounded materialized integer lookup (2026-10-14):** Unfiltered
positive integer IN uses a real outer-first materialized key lookup when the
shared cost search selects it. Scan/evaluation, temporary creation and key-write
costs are paid once; the existing prefix step charges each outer probe. The
materialized candidate participates in pruning without replacing LooseScan's
original prefix estimate. FirstMatch retains its outer-cardinality sort cost.

The shared hash/automatic-index build owner consumes its full source before
keying. Selected materialization alone defers that build until a valid outer
probe, excludes NULL keys and retains one row per key. Empty/all-NULL outer
inputs initialize nothing. Ordinary hash and derived-table builds remain eager;
hash probes stay newest first and automatic-index probes oldest first. Duplicate
outer identity, exact signed/unsigned BIGINTs, retained statements after writes,
source closure and locking-stream early return are pinned by permanent tests.

Cost positions own access and prefix counters together. Admission shares its
unhinted base-table, integer literal, definition, key-read and predicate proofs;
NOT IN retains a separate nullable contract. Point lookups and per-row ranges
share pair checking and scan closure while retaining their own access selection.
Logical joins share pair matching and identity composition; leaves own capture,
and constant joins reuse the plan's existing slots. Public APIs are unchanged.

All 1,292 tests pass through `npm run verify:docker -- --full --reference`, using
Node 22.18.0 and the digest-pinned MySQL 8.4.11. Typecheck, lint, nine unchanged
size gates, installed-package/typed-example smoke, three million seeded reader/
parser/engine fuzz inputs, 20,000 executor statements, 10,000 crash points, the
real-client exit criterion and seven reference corpora pass. Twenty-one native
controls pass. The 144-outcome materialization audit improves 44 to 128 complete
matches; all rows/full fields/warnings agree. The 2,160-outcome threshold audit
is unchanged at 1,680 complete matches, with all data components native. Base
matches remain 272/288; fresh matches improve 262 to 292/352 with every previously
matching component retained. The 192 earlier fresh and 2,243 older controls and
2,124/2,248 corpus plans are unchanged; floor 2,118 stays fixed. Core/facade are
334,345/334,263 B gzipped, under unchanged caps with no new lazy chunks.

M5.47 remains partial. The remaining 16 materialization audit and 480 threshold
plan outcomes include empty-inner/disabled-strategy choices; broader filtered,
scan/hash, weedout, ordering and prepared strategy contracts remain open.
Continue with the smallest native-backed repair of those choices before broader
access/order work. The preceding 90ecbee/run 38509343819 passed all eleven
required CI jobs. Pending jobs for this slice permit continued implementation.

**Preserved materialized-lookup prototype (not shipped):** the positive exact-integer
candidate compares materialization inside the shared join search. A cheaper
materialized choice participates in prefix pruning; LooseScan retains its
original prefix estimate for that pruning. FirstMatch sorts its outer rowcount,
not duplicate inner fanout: a native four-outer/four-inner trace pins FirstMatch
2.4511 versus MaterializeLookup 3.1. One bounded strategy state holds the eligible
switches and selected physical mode. The existing indexed derived-table probe
builds lazily for selected materialization after a non-NULL outer row; existing
sorted integer deduplication removes NULLs and repeated inner keys. Generic
quantified NULL semantics and ordinary derived initialization remain separate.

Earlier prototype audits improve 44 to 128 complete matches in 144 outcomes with every row, full
field and warning native. Base matches remain 272/288; the 352-record changing-
data audit improves 262 to 292, with every previously matching component kept.
All 192 earlier fresh outcomes and 2,243 older controls are unchanged. Eleven
focused local semijoin tests and nineteen live native checks passed before the
latest cleanup, which still needs verification. Indexed/range table probes share
pair testing
and accepted-first-match scan closure; lookup descriptions use their existing
formatter. MySQL's other materialized scan/hash and disabled-strategy outcomes
remain open.

The preserved prototype is not validated for shipping: core is 334,636 B
against 334,361 and facade 334,566 against 334,266 (275/300 over), under
unchanged caps. Its source snapshot is retained as ignored local evidence;
production includes the independent FirstMatch cardinality, bucket ownership,
quantified prefix-coverage and bounded materialized lookup repairs. The earlier
broad prototype was not shipped wholesale.
The new
INT/BIGINT/unsigned-BIGINT, switch and retained-data regression passes
locally and against pinned MySQL. Counted locking tests prove one eight-row build,
no inner read for empty/NULL-only outer input, source closure and writer release
after early return. Buckets retain rows directly rather than positions plus
another retained array, preserving hash traversal order. Full Docker tests,
package smoke, fuzz and reference gates still need to pass after cleanup. Keep
all caps, captures, lazy chunks and the plan floor unchanged. The f7cdf29
exact-SHA GitHub run 38318367503 passed all eleven
required jobs. Docker's completed update required restarting only this task's
Node 22.18.0 and digest-pinned MySQL 8.4.11 containers; both are available again.

The preparation destruction repair is verified below. Three isolated Docker
INSERT profiles did not establish a material duplicate-search cost, so no
search-result cache is added. Old-schema upgrades still need a fresh search;
rebuilding retains root restart. The M5.50 INSERT speed criterion remains unmet.
Native SQL tables use version zero. Store rollback/purge reopen trees at zero
before Catalog opens, so arbitrary upgrade callbacks cannot supply durable
schema/undo authority.
Secondary scans still fetch clustered values; storage-level coverage needs durable
original values because keys contain collation weights. ORDER BY NULL copying/sort
admission, column visibility, correlated fields, high-fanout skip dedup, ordinary
grouping and DESC temporary fields remain separate. The adjacent grouping
prototype remains unshipped over unchanged caps. M5.47's 16 remaining base plan gaps,
weedout, broader predicates and retained strategy costs remain open.

**Deferred formatter:** the variable DECIMAL field prototype exceeded the
unchanged size gates and is not shipped. VARCHAR/VARBINARY use raw stored
bytes, terminate at NUL, and cap at 128 bytes before completed-message
utf8mb3 conversion; latin1 and non-BMP behavior differs from fixed CHAR.
Keep complete numeric inputs independent of diagnostic caps. A compact
repair must prove split sequences/BOM and preserve the existing boundaries;
do not restore an unreviewed prototype or raise thresholds. Fixed CHAR/INTEGER
split-message and 81-digit/exponent buffer/alias gaps remain separate.
Numeric DECIMAL extrema's first-argument prefetch and temporal/JSON/prepared
readers follow. M5.47/M5.49/M5.50 follow bounded function repairs before
browser work. M5.10 stays partial.

### Verified resolved-literal control escaping (2026-10-11)

The existing expression printer now owns complete string-literal assembly.
It escapes NUL, newline, CR, Ctrl-Z, backslash and quote, retaining literal
TAB and backspace as pinned MySQL 8.4.11 does. Diagnostics, CHECK clauses,
generated expressions, expression defaults and views supply their existing
charset policy. Table expressions share their unqualified quoted-column
callback; diagnostics and views retain their own name resolution. Public
contracts, parsing, NULL behavior and evaluation lifetime are unchanged.

INFORMATION_SCHEMA's generated expression had an additional omission:
backslashes were not escaped again. It now shares the extra printed-expression
escape layer with CHECK_CLAUSE. This second layer remains independent of literal
assembly and warning-message conversion. Literal defaults and comments retain
SHOW CREATE's separate quote-doubling policy.

A fresh native audit covers 18,792 complete outcomes: all 256 byte-valued
characters, quote/backslash duplicates, combined controls, empty strings and
NULL; four introducer configurations; UNHEX, INET_ATON and INET6_ATON;
CREATE TABLE/VIEW and both query/execute introspection paths. Complete matches
improve from 14,350 to 14,672, closing 322 with no previously matching row,
field, ordered warning or error regression. The remaining 4,120 outcomes
retain non-ASCII INFORMATION_SCHEMA conversion, introduced view-value
conversion and SHOW CREATE VIEW introducer-retention gaps. They remain in the
full audit, separate from this verified escape rule. The earlier UNHEX fresh
audit improves again from 762 to 764 of 796; the cap/control audit improves
from fourteen to twenty-two of 44. Its previously stated count of 42 is
corrected here; historical changelog entries remain untouched. All 1,056
format/network/temporal consumer records remain unchanged.

Two protocol tests pin 6,720 complete executions, including 6,216 diagnostic
literal reads through both protocols and 504 DDL/introspection observations.
Recorded printed arguments and field tuples are shared; native rows, all ten
metadata facts, complete ordered warnings and DDL headers are compared.
The DDL groups cover every relevant control, ordinary text, quote/backslash,
empty strings and NULL. Explicit introducers are verified at each admitted
consumer; SHOW CREATE VIEW with an explicit introducer remains excluded as a
whole configuration. The same tests pass against the pinned native server.

All 1,249 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass. Core/facade are 334,326/334,257 B gzipped, thirteen/five bytes smaller.
Captures, caps and the 2,118-plan floor remain unchanged. The preceding
a146f61 commit passed every required GitHub job. M5.10 remains partial;
message caps, completed-message conversion, Unicode/ICU and other measured
function gaps remain open.

### Verified CONVERT USING DECIMAL prefix ownership (2026-10-11)

CONVERT(... USING charset) now declares its own DECIMAL prefix fact on its
existing evaluator. The native
[charset conversion class](https://github.com/mysql/mysql-server/blob/mysql-8.4.11/sql/item_strfunc.h)
inherits the string-function reader. This is a source-owned policy rather
than delegation to the argument or a new conversion implementation. Charset
conversion, invalid-UTF8 handling, result widths/collations/coercibility,
NULL behavior and public contracts remain unchanged. INTEGER and DOUBLE
readers retain their diagnostics; selected IF branches retain original reads.

The native byte audit covers 4,368 complete query/execute outcomes: every
byte tail, 1,024-byte boundaries, 4,096/200,000-byte inputs, embedded NUL,
NULL, binary/utf8mb4/latin1 destinations, nested CONCAT/IF and bare-field/
COALESCE controls. Complete matches improve from 1,698 to all 4,368,
closing 2,670 with no previously matching component regression. A fresh
four-storage-kind prepared matrix improves from 84 to all 780 observations,
closing 696, with fields and ordered warnings checked at prepare and after
writes through query(), execute() and an existing prepared statement.

A broader 2,100-outcome text audit improves from 222 to 978, closing 756
without row, complete-field, warning or error regressions. Remaining outcomes
retain 80/81/82-digit overflow/alias and exponent-buffer diagnostics, leading
VT/FF parsing, utf8mb3 parse-warning lifetime and unavailable UCS2/UTF16/UTF32
codecs. Passing protocol groups exclude those complete input or charset
configurations explicitly; all outcomes remain in the full audit. They are
not repaired by a DECIMAL prefix fact.

Three protocol tests pin 5,994 complete executions and 24 PREPARE checks;
153 recorded outcomes are shared. A counted unit test covers text and binary
sources, three destination charsets, plain/nested IF selection, large complete
inputs, one original read, unselected-branch laziness, once-per-statement
invalid-prefix warnings and fresh diagnostics. Separate INTEGER/DOUBLE reads
and quiet NULLs are checked. All three protocol tests pass against pinned
MySQL 8.4.11; the four focused tests pass locally.

All 1,253 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora
pass. Core/facade are 334,327/334,258 B gzipped, one byte more each. Captures,
caps and the 2,118-plan floor remain unchanged. The preceding 666a454 commit
passed every required GitHub job. The stale claim that full binary reading
was still a prerequisite is corrected. M5.10 remains partial.

### Verified SHOW CREATE VIEW literal context (2026-10-11)

The existing view printer uses its caller context to retain literal introducers
for SHOW CREATE VIEW. An explicit schema string or NULL means SHOW; an omitted
context means INFORMATION_SCHEMA. Database selection controls name qualification
independently. The repair changes one literal callback, preserves public APIs
and value conversion, and retains the existing INFORMATION_SCHEMA literal policy.

A pinned native audit checks 38,308 observations: 266 inputs covering every
byte-valued character, quoting and mixed controls, empty strings, NULL, BMP,
non-BMP and BOM; four introducer configurations; literal/CONCAT/IF forms;
selected/foreign/unset schemas and INFORMATION_SCHEMA; query(), execute() and
existing prepared statements after each view replacement. Complete matches
improve from 14,431 to 35,896, closing 21,465, with zero regressions in rows,
full fields, ordered warnings or errors. All 28,728 SHOW executions agree.
The remaining 2,412 INFORMATION_SCHEMA observations retain introduced high-byte
value conversion and non-BMP conversion gaps; all INFORMATION_SCHEMA observations
are strictly unchanged by this slice.

One protocol test pins 35,892 complete executions and four PREPARE results.
Expected native SQL is factored into literal/context parts only after strict
reconstruction against every captured outcome; INFORMATION_SCHEMA admission
excludes complete measured input/configuration groups explicitly. Both native
and local runs pass, including prepared object-row shapes and cached definition
refresh. The older literal test's stale introducer-gap comment is corrected.

All 1,254 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core/facade are 334,332/334,264 B gzipped, five/six bytes more; captures, caps
and the 2,118-plan floor remain unchanged. The preceding 1d00a16 commit passed
every required GitHub job. M5.10 remains partial.

### Verified UTF-8 table-expression byte rendering (2026-10-11)

INFORMATION_SCHEMA generation and CHECK text now render persisted UTF-8 source
bytes as U+00xx through the existing complete byte reader, then apply their
existing extra escaping. Legacy source text is unchanged: blanket UTF-8 or
CP1252 re-encoding would regress measured outcomes. A shared table-expression
setup owns column names, introducer defaults and source text for generated,
CHECK and expression-default printers. SHOW and INFORMATION_SCHEMA CHECK reads
share one resolved-expression/fallback owner. Generation's existing unsupported
fallback retains only its previous extra escaping; parse errors still propagate.
Public contracts, value evaluation, result metadata and source stamping are unchanged.

The every-byte/control audit improves from 16,232 to 18,280 of 18,792 complete
outcomes, closing 2,048 without component regressions; all table-expression
outcomes agree. The 512 remaining outcomes are INFORMATION_SCHEMA view-value
conversion, a separate boundary. A broader source/destination charset audit has
11,112 native observations versus 11,592 own observations because native DDL
refusals suppress later reads. Full matches improve from 5,344 to 6,288, closing
944 with zero row, full-field, ordered-warning or error regressions. Every SHOW
and latin1-source observation is strictly unchanged. A result-charset-controlled
capture independently distinguishes rendering from still-open wire metadata.

A 6,003-observation fresh audit improves from 3,938 to 5,138, closing 1,200
without component regressions. It creates definitions under utf8mb4, utf8mb3
and latin1, then reads them from a fixed UTF-8 connection through query(),
execute() and existing statements after replacement. Controls, explicit
introducers, NULL, BOM, non-BMP input, 8,192-character and 70,001-character
expressions test persisted source ownership and complete input handling.
A name audit captures 350 native observations versus 450 own observations,
improving 46 to 142 complete matches (+96), with no previously matching
component regression. Twenty native legacy-name DDL reparse errors lack
corresponding own error records and remain explicit; every own SHOW/legacy
record is unchanged. Non-ASCII and quoted identifiers require the whole
expression byte layer, rather than only literal conversion.

Three protocol tests pin 11,544 complete observations plus three PREPARE
checks, including 530 fresh writes and 130 identifier-name reads. Complete
source/input/statement-kind groups explicitly exclude CESU-8, legacy high-byte
and admission, SHOW implicit-conversion and wide-output metadata gaps; full
audits retain them. Native fixture factoring is checked against every admitted
record. Repeated large strings and prepared object rows are reconstructed from
verified captures; actual rows are never normalized. Two unit tests preserve
unsupported/parse-error fallbacks, source defaults/introducers and complete
140,000-byte UTF-8 rendering. All focused tests pass locally and all protocol
tests pass against pinned MySQL 8.4.11.

All 1,259 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core/facade are 334,324/334,254 B gzipped, eight/ten bytes smaller. Captures,
caps and the 2,118-plan floor are unchanged. The preceding 025a580 commit
passed every required GitHub job. Windows/Docker replay and the plan diagnostic
now measure 2,122 of 2,248 plans, correcting stale summary/scoreboard metrics;
the required 2,118 floor is unchanged and this slice claims no planner change. M5.10 remains partial; the next bounded
implementation returns to M5.47.

### Verified planner setup consolidation and deferred weedout (2026-10-11)

Correlated semijoin/antijoin candidates now share extraction of a qualified
key equality and at most one residual, preserving their original alias-case
and residual eligibility policies. One row-filling helper owns the same
local-to-logical slot mapping for estimates, leaf reads, indexed joins and
dynamic ranges. Physical and dependent-subquery index lookup descriptions
share the existing unique/covering facts and spelling. Iterators, access
choices, value evaluation, filtering, metadata and public APIs are unchanged.
This consolidation removes duplicated setup, without shipping a new strategy.

Fresh pinned MySQL probes cover captures 102, 106 and 139 across empty, one-row,
two duplicate/distinct/NULL/filtered/unmatched rows, larger duplicate/NULL
sets and high fanout; ordered/unordered/LIMIT forms and six switch
configurations; query() and execute(). All 1,080 own observations are strictly
unchanged by the shipped consolidation. Another 42 complete observations
and two PREPARE field checks verify retained statements across seven write
states, exact BIGINT primary identities above 2^53 and distinct outer rows
with equal selected values; these are also strictly unchanged.

The native optimizer trace chooses weedout for the filtered, inner-first
primary lookup at estimated zero/one/two source rows: its cost ties
MaterializeScan at 1.9/1.9/2.0 in the five-row outer probe. At three rows,
a floating-cost tie is not selected; larger estimates often materialize,
and high fanout chooses FirstMatch. Empty runtime input is therefore not
the eligibility rule. Ordered LIMIT chooses a competing hash semijoin;
disabling duplicateweedout or both LooseScan/FirstMatch can materialize.
Broader estimates, indexed residuals, limits and retained strategy changes
need independent cost proofs.

A tested integer/text-residual prototype improved 96 to 348 complete matches
in the 1,080-outcome audit (+252), with no previously matching row, full-field,
warning, plan or error regression; the fresh audit improved 2 to 44 (+42).
It used actual matched PRIMARY identity deduplication after the complete join,
not selected-value DISTINCT or a renamed filter. It also closed the three
captured plan gaps locally. The prototype exceeded the unchanged core/facade
size caps; the later text-only narrowing sketch has not been revalidated.
Neither variant nor their strategy regressions are shipped. Ignored probes,
captures and sketches are evidence, not current production or release gates.

All 1,259 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Four focused planner tests pass against pinned MySQL 8.4.11, alongside four
local read/closure checks in the same run. Core/facade are
334,309/334,224 B gzipped, 15/30 bytes smaller than the preceding slice;
captures, caps and the 2,118-plan floor are unchanged. Actual production plan
agreement stays 2,122 of 2,248. The preceding f7f929d commit passed every
required GitHub job. M5.47 remains partial; continue from this measured
boundary, then M5.49/M5.50 before browser work.

### Verified non-primary integer FirstMatch (2026-10-11)

The existing cost search can now choose an outer-first indexed semijoin when
its exact integer outer key is not a single-column PRIMARY key. Each outer
occurrence still probes until its first qualifying match, so equal outer
rows remain separate. The PRIMARY identity proof remains required for
inner-first LooseScan. No new iterator, strategy cost, public API or plan
label is introduced; disabled FirstMatch uses the existing inner Limit.

A pinned query()/execute() audit of captures 36/88 covers six row states,
four switch settings and ordered/unordered/LIMIT forms. Complete native
agreement improves from 72 to 260 of 288 observations, without losing any
previous complete match. All rows, ten field facts and warnings agree.
The remaining 28 plan differences concern empty-inner materialization;
24 retain their previous fallback plan, while four firstmatch=off/LIMIT
outcomes select an indexed loop instead of native deduplicated materialization.
Those costs remain unverified and M5.47 stays partial.

Another 180 complete observations and 12 PREPARE field checks all agree with
native MySQL: nullable/duplicate keys, secondary and composite keys, aliases,
signed/unsigned integers, BIGINTs above 2^53, IN/EXISTS/LIMIT, retained query,
execute and prepared statements across writes and FirstMatch switch changes.
Counted local scans examine one qualifying inner row for each repeated outer
occurrence; early locking-stream return releases the writer. Six focused
tests pass against pinned MySQL and five local iterator/closure checks pass.

All 1,262 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core/facade measure 334,308/334,225 B gzipped. Production plan agreement is
2,124 of 2,248; fixtures, caps and the 2,118-plan floor are unchanged.
The preceding 7ef3ed2 commit passed every required GitHub job. Continue
M5.49/M5.50 before browser work; larger semijoin costs remain open.

### Verified physical UNIQUE-key DISTINCT elimination (2026-10-11)

Single-source delivery now omits its global DISTINCT row-key set when resolved
local selected fields include a whole PRIMARY or non-null UNIQUE key. Metadata
coverage and physical uniqueness share one key-part reader, with an explicit
local scope for the stricter physical proof. Indexed prefixes and metadata's
wildcard shortcut do not prove uniqueness; same-named outer fields, computed
casts and nullable UNIQUE keys keep their existing deduplication path. No public
API, cost, plan label or fixture changes.

The paired 130-record audit is strictly unchanged in every component across
query(), cached execute() and retained statements after update/delete/restore.
All 120 execution rows and warnings agree with pinned MySQL, alongside 96
execution field records and all ten PREPARE field records. Twenty-four wildcard
and correlated scalar execution-field mismatches remain explicit; complete
native plan/field agreement stays 46 of 130. Permanent tests retain the native
values and matching fields without substituting local metadata for those gaps.
Exact BIGINTs above 2^53, duplicate fields, computed controls, NULL duplicates,
qualification and zero-count/positive-offset boundaries are covered.

Counted local checks allocate zero DISTINCT row identities for selected PRIMARY
keys versus 1,000 for an unproved computed CAST. A clustered ordered LIMIT 1
reads one row and closes its source; early locking-stream return releases its
connection and permits a writer. Eight focused native tests and one local
state/closure test pass. All 1,264 Windows/Docker tests, typecheck, lint, nine
unchanged size gates, package smoke, 20,000 seeded executor statements and seven
pinned corpora pass. Core/facade measure 334,339/334,261 B gzipped. Production
plans stay 2,124 of 2,248; captures, caps and the 2,118 floor remain unchanged.
The preceding 1a764f8 commit passed every required GitHub job. M5.49 stays partial;
wildcard/correlated metadata, secondary-versus-clustered order costs and adjacent
grouping remain open before the remaining M5.50 work.

### Verified expanded wildcard DISTINCT metadata (2026-10-11)

The existing SELECT expansion now supplies the key-coverage reader. Every
selected field resolves locally; whole PRIMARY/non-null UNIQUE keys prove
physical uniqueness, while a visible indexed prefix may separately retain
source metadata. Raw '*' no longer claims coverage on an unkeyed, nullable-key
or partial-key table. Invisible nonunique indexes cannot supply the metadata
proof. Expanded whole-key wildcards also avoid physical global DISTINCT state.
The expanded-list type requires its expression, removing unreachable undefined
guards and redundant collection paths; public APIs and evaluation owners stay
unchanged.

The pinned 297-record probe covers nine table definitions, query/execute/actual
PREPARE, duplicate and NULL values, aliases/qualification, repeated star fields
and LIMIT/OFFSET boundaries. Complete agreement improves 139 to 223, closing
84 outcomes without losing any complete match or matching component; matching
field records improve 181 to 259. The covering-star configuration still has six
row-order and six bounded-field differences; its source access/grouping plans
remain separate. Native hidden PRIMARY columns are absent from '*' while our
CREATE path currently drops column visibility, leaving that whole configuration
open. Composite-key and covering-key plans also remain open. Do not substitute
local observations for these native differences.

All 260 fresh records agree across four schemas, five queries, four write states
and three execution forms, including twenty PREPARE field records. The earlier
130-record UNIQUE probe improves 46 to 58 complete matches and 106 to 118 matching
fields: wildcard fields close, twelve correlated scalar execution-field gaps
remain, and the correlated inner temporary plan improves. Every row/warning
continues to agree. Permanent tests pin 231 base records (including seven exact
PREPARE refusals) and all 260 fresh records. Existing wildcard assertions are
strengthened with native fields; counted expanded-PK reads allocate no DISTINCT
row identities. Ten focused native tests and one local state/closure test pass.

All 1,266 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned corpora pass.
Core/facade measure 334,279/334,201 B gzipped, sixty bytes smaller each.
Plans remain 2,124 of 2,248; the stale top summary is corrected. Captures, caps
and the 2,118 floor remain unchanged. The preceding 1cbf5c7 commit passed every
required GitHub job. M5.49 remains partial; proceed to the bounded covering-star
read proof, then the remaining M5.50 work before browser work.

### Verified covering-star source reads (2026-10-11)

The existing scope's source columns now supply explicit read sets for stars,
conservatively retaining join inputs. A real column named 'all' no longer collides
with a whole-table sentinel. Existing full-key coverage admits secondary scans
on hidden-row-ID tables; prefix and invisible indexes remain excluded. Whole-key
UNIQUE projections may reconsider PRIMARY ordering through the same physical
uniqueness proof, fixing composite-key ordering while keeping DISTINCT projection
and OFFSET boundaries. Correlated reads and public APIs retain their owners.

The pinned 292-record, seven-schema probe improves 163 to 250 complete matches
(+87). All rows agree, closing 69 row-order differences; all 73 PREPARE records
and every previously matching field/warning component remain native. Fields
agree in 286 records, leaving six bounded unordered hidden-row-ID DISTINCT
execution-field differences. Fresh retained statements cover four schemas, four
write states, binary values, large BIGINT identities and a real 'all' column:
all rows/warnings and twenty PREPARE records agree across 260 records, with twelve
pre-existing bounded-field differences (248 complete matches). Do not recapture
these differences as local expectations.

Earlier wildcard and UNIQUE matrices improve 223 to 244 of 297 and 58 to 70 of
130 complete matches, without losing any matching component or complete record.
Another 1,264 strict observations across four older DISTINCT/expansion probes are
unchanged. Permanent tests pin the 292 base and 260 fresh records, retaining the
known metadata boundaries explicitly. Counted LIMIT reads select one secondary
scan, no table scan and close once, while still fetching one clustered value;
prefix/invisible controls use one closed table scan. Early locking stream return
also releases the read so another connection can write. Twelve focused native
tests and two local instrumentation/closure tests pass.

All 1,269 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned MySQL 8.4.11
corpora pass. Core/facade measure 334,261/334,185 B gzipped, eighteen/sixteen bytes
smaller. Plans remain 2,124 of 2,248; captures, caps and the 2,118 floor remain
unchanged. The preceding 1993513 commit passed every required GitHub job.
M5.49 remains partial. Bounded unordered copied-field metadata is next, followed
by remaining M5.50 work before browser work. Actual storage covering reads and
column visibility remain separate; this slice changes access selection only.

### Verified bounded unordered DISTINCT copied fields (2026-10-11)

The existing DISTINCT metadata owner now requires whole-key non-null uniqueness
to avoid copied fields for a bounded query without ORDER BY. An indexed prefix
still supplies the separate unbounded/ordered metadata proof. Existing constant,
impossible-WHERE and zero-count-plus-OFFSET guards remain; PREPARE precedes this
boundary. No access selector, evaluator or public API is added.

The 2,160-record native probe covers nine key definitions at zero, four and 256
rows: full/leading/prefix/invisible keys, nullable/non-null UNIQUE, PRIMARY,
composite and unindexed tables. It includes full/partial projections and stars,
counts zero through 10,000, OFFSET, source ordering, constant/impossible WHERE,
and query/execute/actual PREPARE. All rows/warnings agree. Full agreement improves
1,671 to 1,827 (+156); matching fields improve 1,854 to 2,115 (+261), with no lost
complete match or previously matching component. The remaining 45 fields are
ORDER BY NULL copying/sort admission, excluded from this policy. Native higher
fanout selects physical index skip dedup; that strategy remains separate.

All 732 fresh parameterized records agree across four key shapes, three
projections, four write states and five count/OFFSET pairs, including twelve
PREPARE records. Retained statements change parameters after updates, deletion
to empty and restoration without stale field facts. Permanent tests pin all
2,160 base rows/warnings, 540 PREPARE field records, 2,115 matching base fields
and 429 matching query plans, plus all 732 fresh outcomes. The earlier covering
test now asserts native fields directly, closing its six base/twelve fresh gaps:
full agreement becomes 256 of 292 and 260 of 260. Wildcard agreement improves
244 to 250 of 297. The 130-record UNIQUE and 1,264 older DISTINCT/expansion
observations are strictly unchanged. Eight focused native tests plus one local
scan/closure check pass.

All 1,271 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements and seven pinned MySQL 8.4.11
corpora pass. Core/facade measure 334,266/334,190 B gzipped (+5/+5); plans remain
2,124 of 2,248. Captures, caps and the 2,118 floor remain unchanged. The preceding
230dd2f commit passed every required GitHub job. M5.49 remains partial; continue
the bounded in-place schema-upgrade insertion proof under M5.50 before browser
work, keeping durable transactional schema ownership and measured INSERT gains
explicitly open.

### Verified topology-preserving leaf upgrades (2026-10-11)

The existing leaf-upgrade owner reports whether the leaf and its ancestor path
stay in place. Prepared upserts keep the already descended insertion path after
an in-place rewrite; a rebuild/split restarts through the existing full put path.
Preparation still receives detached old bytes after releasing read pins, runs
once, and validates its replacement before upgrading. Undefined leaves old
schema/WAL untouched. No cursor, schema registry or public API is added.

The paired root/two-level probe reduces page fetches from six to four and nine
to five. Permanent tests add root/two/deeper-level insertion and replacement
checks (height plus three fetches), copied-key/value mutation, no-op WAL and
callback pin/call counts. Preparation and codec failures roll back independent
tree writes and retain every old-schema value. A large replacement actually
splits an in-place upgraded root/deep leaf through its original ancestors.
Every storage write in targeted root/deep upgrade-and-replacement-split workloads
is crashed under both process and seeded power loss; recovery returns a whole
before/after value, preserves other rows and all acknowledged replacements, and
passes independent store verification. The caller explicitly retains the bare
tree's codec; this does not supply transactional durable schema authority.

All 1,275 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements, seven pinned MySQL 8.4.11
corpora and 10,000 crash points pass. Sixty-five focused Docker engine tests pass.
Core/facade/engine measure 334,277/334,198/56,551 B gzipped (+11/+8/+14).
Three alternating paired best-of-five INSERT runs measure preceding/current
44.4/48.2, 42.6/49.8 and 41.9/42.8 ms, within the documented ±30% noise. The
unversioned SQL INSERT speed criterion remains unmet; do not claim a gain.
Captures, caps and the 2,118-plan floor remain unchanged. The preceding 625aab7
commit passed every required GitHub job.

A separate callback/drop probe confirms that the preceding committed code also
allows preparation to destroy its own tree and continue into a freed leaf.
Store destruction must honor the same shared preparation boundary before its
generation or pages change. Repair that bounded lifetime gap next; M5.50 remains
partial, with measured INSERT performance and transactional schema ownership
explicitly open.

### Verified preparation destruction boundary (2026-10-12)

Store destruction now honors the same journal/index preparation guard as tree
row writes, before changing the drop generation or entering the mutation.
The preceding implementation could free a tree inside its preparation callback
and then write into that freed leaf, or return a nominal no-op after dropping it.
The internal shared check closes that lifetime gap without another registry or
public export; reserved-tree error precedence and normal destruction remain.

Root-only and deeper-tree regressions cover direct and nested callbacks through
alias handles, both replacement and undefined/no-op results, exact row/counter,
allocation, directory, generation and WAL preservation, independent-write
rollback and zero leaked pins. Both nested guards clear after refusal. A caught
refusal permits a valid replacement and an independent-tree drop. Sync/reopen
retains the expected rows and counters, and normal drops then reclaim the tree
and reset its counters. Both new regressions fail against the exact preceding
committed Store/BTree with missing expected refusal. Existing drop/purge/rollback/
crash coverage remains.

All 1,277 Windows/Docker tests, typecheck, lint, nine unchanged size gates,
package smoke, 20,000 seeded executor statements, seven pinned MySQL 8.4.11
corpora and 10,000 crash points pass. Core/facade/engine measure
334,305/334,222/56,582 B gzipped (+28/+24/+31). Captures, caps and the 2,118-plan
floor are unchanged. Every required GitHub job for the preceding bfeaca1 commit
passed. M5.50 stays partial: measured INSERT gains and durable transactional
schema authority remain open. Investigate the duplicate prepared-leaf search
through this existing guarded lifetime next, with idle paired measurements.

### Prepared-leaf search profiling (2026-10-12)

Three isolated Docker Node 22.18.0 runs profile the unchanged committed code
with the existing INSERT workload, warm-up and 30 measured repetitions.
Sampling at 100 microseconds attributes 16.5/18.0/20.6 ms to engine search calls
out of 2,804.3/2,723.0/2,818.1 ms total sampled time: 0.59/0.66/0.73%.
Each profile includes setup, warm-up, module loading and teardown. JIT inlining
can attribute search work to callers; these figures are neither a precise bound
on redundant searches nor a measured benefit from removing them. Garbage
collection, parser/AST work, undo and redo are visible larger costs. The profiled
best-of-30 INSERT figures are 48.9/43.2/47.8 ms, with instrumentation overhead;
they are not paired acceptance benchmarks and establish no speed gain.

Do not add search-result state on this evidence. Current-schema preparation is
guarded, but old-schema upgrade callbacks have a separate boundary and still
need fresh searches; rebuilding retains root restart. Production code and tests
are unchanged from the 1,277-test, seven-corpus and 10,000-crash-point validated
eaa5e03 commit. Its GitHub run is in progress with no reported failure at this
boundary. M5.50 remains partial, with the performance criterion and durable
transactional schema ownership explicitly open. Continue the concrete M5.47
empty-inner strategy differences through the existing cost/iterator owners.

### Verified empty-inner semijoin candidate boundary (2026-10-12)

The pinned 8.4.11 server exactly reproduces all 288 observations in the earlier
non-primary integer audit. Current code retains 260 complete matches, and all
rows, fields and warnings agree. The 28 plan differences belong to six plan
classes. Twenty-four optimizer traces (two captured schemas, four switch sets,
three ORDER/LIMIT forms) are complete, with zero omitted trace bytes.

For the empty-inner two-row outer case, native outer-first FirstMatch costs
1.15. Unordered with LooseScan disabled it beats materialized lookup at 2.1 and
weedout at 2.55. Enabled LooseScan can run inner-first deduplication followed by
hash join at about 0.800005; the current bounded LooseScan requires an outer
PRIMARY lookup and cannot run that hash alternative. Ordered and disabled-
FirstMatch forms select weedout or materialization, so blanket admission cannot
make every plan match.

Current shared join search also selects the approximately 0.8 ordinary
inner-first hash plan for these empty cases, without the semijoin's required
outer-row deduplication proof. The bounded integer candidate rejects that
topology before reaching its empty-range guard. An isolated temporary removal
of the guard changes none of the 288 complete outcomes and is restored.
Diagnostic candidate logging likewise preserves every outcome and is restored;
source-byte verification confirms production code is unchanged.

The next candidate investigation belongs at the existing dependency/cost owner:
FirstMatch requires outer-before-inner placement unless an eligible LooseScan
alternative exists. Do not add an empty-data rule or a plan label for an
unimplemented strategy. This research closes no plan difference yet. Code and
tests remain the eaa5e03 state validated by 1,277 Windows/Docker tests, seven
pinned corpora and 10,000 crash points. Every required GitHub job for eaa5e03
has passed; the profiling-documentation commit's CI is still running without a
reported failure. M5.47 and M5.50 remain partial.

### Verified costed empty-inner FirstMatch (2026-10-12)

The bounded unfiltered two-table candidate supplies its inner alias to the
existing join search before the plan is cached. An ordinary inner-first order
now pays default memory temporary creation/write/lookup costs and sorts distinct
outer cardinality. A cheaper unsupported order still falls back; this adds no
weedout or materialization iterator. Indexed LooseScan keeps its existing proof.
Filtered empty ranges retain their materialization boundary, including copied
source fields. A dependency-only prototype improved four base plans but lost
twelve previously matching changing-data fields, so it is withdrawn.

Admission keeps settings for the strategy actually returned; rejection or an
exception clears speculative flags and the cached plan. Range presence shares
the existing bounded counter, which closes its reader. Set-subset proofs share
one local helper with all prior empty-set guards preserved. Join search owns
its fixed order, reuses private unique-extension sets, tests their cardinality
after restoring the remaining set, and returns its already owned result array.
Key widths add their nullable byte once; no width or cost constant changes.

Pinned 8.4.11 comparison improves 260 to 264 of 288 complete non-primary
observations (+4), with no matching component lost and all rows/full fields/
warnings native. The four added plans cover both captured schemas and both
protocols with empty inner input, LooseScan disabled and no ORDER BY. The other
24 plans remain open. A new 352-record changing-data audit contains sixteen
PREPARE records and 336 executions across four key shapes, four query forms,
empty/duplicate/NULL/restored states and FirstMatch switches. Complete agreement
improves 247 to 262; all rows/warnings and 328 fields agree, with no matching
component lost. Twenty-four fields and ninety complete configurations still
need unsupported strategy/metadata work. All 192 earlier fresh observations and
2,243 older controls are strictly unchanged. Permanent regressions pin the four
base plans and a retained UINT statement's fields through twenty-one executions
and PREPARE. Existing filtered-empty and counted-iterator regressions remain.

All 1,278 Docker tests, typecheck, lint, nine unchanged size gates, package smoke,
20,000 executor statements seeded 20261010 and seven pinned-reference corpora
pass. Ten focused protocol/iterator checks pass, including live native execution.
The relational plan count remains 2,124 of 2,248; fixtures and the 2,118 floor
are unchanged. Core/facade are 334,345/334,259 bytes gzipped, below their existing
334,361/334,266 caps; engine remains 56,582. The preceding 36719e7 GitHub run
passed every required job. M5.47 remains partial; subsequent pushes are monitored
by exact SHA while implementation continues.

### Verified hash LooseScan and optimizer switch state (2026-10-12)

The bounded inner-first alternative shares the existing complete ascending
integer-key coverage proof, filtered adjacent-key deduplication and hash join.
It builds distinct inner keys and probes every outer occurrence; duplicate
outer values retain separate row identities and NULLs never match. Indexed
LooseScan retains a unique PRIMARY lookup proof. A shared switch reader refuses
hash admission when block_nested_loop is disabled. Unsupported cost winners
fall back through the ordinary compiler; no EXPLAIN-only strategy is added.

The 288-observation audit improves 264 to 272 complete matches (+8), with every
row/full field/warning native and no matching component lost. Eight new
empty-inner plans cover two schemas, ordered/unordered forms and both protocols.
A 192-record nonempty audit covers 20/200 outer rows, duplicates, NULLs, IN/EXISTS,
residuals, ordering, limits and switch changes: all rows/fields/warnings agree,
but only 24 complete plans match. Those 24 ordered hash cases are permanent
native-backed regressions. A first inner row that fails the residual cannot
hide a later qualifying duplicate. A counted locking stream builds seven inner
rows once, closes its scan and releases the writer after an early return; a
subsequent write is visible immediately. Materialization and broader LIMIT/
disabled-strategy costs remain open.

SET optimizer_switch now applies commands atomically and retains omitted names.
It implements native numeric masks (including the accepted reserved high bit),
NULL/type/range errors, remainder diagnostics, duplicate rejection, reset
precedence and hypergraph refusal. SESSION resets use current GLOBAL defaults;
GLOBAL resets use compiled defaults. Both-scope generic values are copied into
the existing connection map before later global assignments. Twenty-four basic
assignments, fifty mask/grammar observations and nineteen session/global
readbacks agree with native; permanent tests use an independent flag list and
masks under query/execute. Wider text grammar, embedding options and built-in
session/global inheritance are still separate audit boundaries.

SET operand evaluation is shared with sql_mode, preserving bit validation,
warnings and parser-state mutation. The existing mode script runs against both
protocols and pinned MySQL; SHOW WARNINGS uses query because native cannot prepare
it. Constant-table joins share one lazy iterator, preserving held-key outer
rows and STRAIGHT_JOIN behavior. Local logical-slot resolution, index coverage,
row assembly and physical nested-loop descriptions each retain one owner.
No public API, package boundary, width/cost constant or lazy chunk changes.

All 1,282 Docker tests, typecheck, lint, nine unchanged size gates, package smoke,
20,000 executor statements seeded 20261010 and seven pinned-reference corpora
pass. Fifteen focused checks pass, including live native execution. The
352-record changing-data matrix remains at 262 complete matches, with all rows/
warnings and 328 fields native, no matching component lost; all 192 earlier fresh
observations and 2,243 older controls are strictly unchanged. Plans remain 2,124
of 2,248; fixtures and the 2,118 floor are unchanged. Core/facade are
334,331/334,258 bytes gzipped under existing 334,361/334,266 caps; engine stays
56,582. The preceding f5f18c8 GitHub run passed every required job. M5.47 remains
partial, with later runs monitored by exact SHA while implementation continues.

### Verified optimizer configuration and connection snapshots (2026-10-12)

Embedding optimizer_switch values now use the same atomic assignment parser as
SET, normalized against compiled defaults before sessions can observe them.
Eight valid configurations cover partial/empty/default strings, bytes and
integer masks; seven invalid inputs leave supplied options unchanged. GLOBAL
DEFAULT restores compiled flags, SESSION resets use current globals, and older
sessions retain their own snapshot. Wider grammar/scopes remain open.

Pinned cold and paused-greeting tests prove defaults are copied before the
server greeting, before authentication and the first statement. An optional
executor factory captures there, applies after successful authentication and
database validation, and captures again for RESET/CHANGE_USER. RESET also uses
the captured server connection collation (native fields change 224 to 255).
Only actual global overrides need copying; immutable compiled defaults remain
the fallback. Broader builtin inheritance remains open.

One ended flag owns connection closure. Phase transitions precede output;
closure during greeting, SHA-2 authentication, final OK or an awaited database
check prevents late initialization, packets and commands. The packet pump and
ERR writer share their fault boundaries and the existing typed-error assertion.
The byte count already maintained for backpressure sizes take(); statistics
formatting and program-error families each have one owner. Savepoint deletion
walks existing keys without a copy and preserves named/later removal semantics.

All 1,288 Docker tests, typecheck, lint, nine unchanged size gates, package smoke,
20,000 executor statements seeded 20261010 and seven pinned-reference corpora
pass. Thirty-one focused local checks pass, including the reproduced SHA-2
closure regression. Seventeen live native checks pass. Query/execute and plan controls preserve 272/288
base matches, 262/352 fresh matches and 328 fields; all matching components,
192 earlier fresh observations and 2,243 older controls survive unchanged.
Plans stay 2,124/2,248 against the unchanged 2,118 floor. Core/facade are
334,329/334,232 bytes gzipped, engine 56,582; no caps, fixtures or lazy chunks
change. The preceding c169779 GitHub run passed every required job. M5.47 and
the full roadmap remain partial.

### Verified streamed membership foundation (2026-10-12)

Uncorrelated keyed IN/NOT IN now builds its existing membership set directly
from the source iterator. It no longer retains another complete row array;
empty and NULL-only input remain distinct, and correlated/non-keyed fallbacks
keep their own policy. A direct 200-probe before/after measurement keeps one
eight-row build, three keys and one source closure, removing eight cached row
copies. This is a foundation cleanup; materialized semijoin admission is open.

All 1,288 Docker tests, typecheck, lint, nine unchanged size gates, package smoke,
20,000 seeded executor statements and seven pinned-reference corpora pass.
Two focused subquery tests and seventeen live native controls pass. The fresh
144-outcome materialization audit is strictly unchanged: all rows/fields/
warnings agree, 44 complete outcomes match. The base/fresh/older plan controls
and 2,124/2,248 plans are unchanged; caps, fixtures and the 2,118 floor stay fixed.
Core/facade are 334,308/334,240 B, engine 56,582. The preceding 468254b GitHub
run passed all eleven required jobs. Native costs and build/probe lifetimes
are recorded above for the next selected-strategy repair; M5.47 remains partial.

## M6 — The browser

**Exit criterion.** A Playwright test runs the full suite in Chrome, Firefox and
Safari, including a mid-transaction page kill and recovery.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M6.1 | OPFS VFS over `FileSystemSyncAccessHandle` | vfs | [40](./40-vfs.md) | M0.10 | ☐ | passes the same conformance suite as the memory backend |
| M6.2 | Access-handle pool: `.pool/NNNN` plus a manifest | vfs | [40](./40-vfs.md) | M6.1 | ☐ | opening a logical file after startup is synchronous; the pool grows when exhausted |
| M6.3 | Handle re-acquisition after tab suspension | vfs | [40](./40-vfs.md) | M6.2 | ☐ | a suspended-then-resumed tab continues without data loss or a thrown handle error |
| M6.4 | OPFS async fallback via `createWritable()` | vfs | [40](./40-vfs.md) | M6.1 | ☐ | works outside a dedicated worker, with its different atomicity documented |
| M6.5 | IndexedDB block store | vfs | [40](./40-vfs.md) | M6.1 | ☐ | the full suite passes in Safari private browsing, where OPFS does not exist |
| M6.6 | Dedicated-worker host; `MySQLWorker` with the same interface as `MySQL` | server | [42](./42-public-api.md), [03](./03-architecture.md) | M1.24 | ☐ | swapping `MySQL` for `MySQLWorker` changes no application code |
| M6.7 | Web Locks leader election, `BroadcastChannel` discovery, re-election | server | [41](./41-durability-and-concurrency.md) | M6.6 | ☐ | killing the leader tab promotes another and clients reconnect automatically |
| M6.8 | `dump()` and `MySQL.load()` | core | [42](./42-public-api.md) | M4.23 | ☐ | a database seeded from a build artefact opens without running recovery |
| M6.9 | Bundle splitting: collations and optional features loaded on demand | — | [29](./29-charsets-and-collations.md), [43 §7](./43-testing.md) | M2.7 | ☐ | the core stays inside the M0.10 budget shipping only `binary` and `utf8mb4_bin` |
| M6.10 | Playwright suite across Chrome, Firefox and Safari, with a mid-transaction page kill | test | [43 §5](./43-testing.md) | M6.5 | ☐ | the milestone exit criterion |

---

## M7 — InnoDB interchange

Note the ordering inversion that makes this milestone unlike M4: for **reading**
a real tablespace the dictionary comes *first*, not last. Doc 27's open sequence
is page 0 → SDI root → inflate the zlib JSON → build the descriptor → read each
index's root page out of `se_private_data` → descend the B+tree. You cannot
decode a record without the dictionary, because ENUM and SET member lists and
the legacy temporal types exist only there.

**Exit criterion.** A table round-trips through a real MySQL 8.4 server in CI,
in both directions, with byte-identical values.

| # | Work item | Pkg | Docs | Deps | St | Done when |
|---|---|---|---|---|---|---|
| M7.1 | FIL header and trailer; CRC32 primary with the legacy variants accepted on read | innodb | [21](./21-innodb-file-layout.md) | M0.3 | ☐ | `innochecksum` agrees with us on a corpus of real files |
| M7.2 | `FSP_SPACE_FLAGS`, the FSP header, page-type dispatch | innodb | [21](./21-innodb-file-layout.md) | M7.1 | ☐ | flags are decoded before anything else, as doc 21 insists |
| M7.3 | XDES array and segment INODE readers | innodb | [21](./21-innodb-file-layout.md) | M7.2 | ☐ | the free/used extent picture matches what the server reports |
| M7.4 | SDI reader: locate the tree, `(type, id)` keys, inflate the zlib JSON | innodb | [27](./27-data-dictionary.md) | M7.2 | ☐ | output matches `ibd2sdi` on the same file |
| M7.5 | SDI → table descriptor, including `se_private_data` index root pages | innodb | [27](./27-data-dictionary.md) | M7.4 | ☐ | index roots resolve — without this not a single row can be read |
| M7.6 | INDEX page parser: header, directory, record chain, infimum/supremum | innodb | [22](./22-innodb-page-formats.md) | M7.2 | ☐ | doc 22's `parseIndexPage` contract is satisfied on real pages |
| M7.7 | COMPACT and DYNAMIC record decoder, including both instant-DDL mechanisms | innodb | [23](./23-innodb-row-formats.md) | M7.6, M7.5 | ☐ | the variable-length array is unit-tested against real files — doc 23 calls this the single highest-value test here |
| M7.8 | REDUNDANT decoder, read-only | innodb | [23](./23-innodb-row-formats.md) | M7.7 | ☐ | a pre-5.7 tablespace reads |
| M7.9 | External field references and both LOB page families | innodb | [23](./23-innodb-row-formats.md) | M7.7 | ☐ | a 1 MB BLOB reassembles from a real file |
| M7.10 | Import: `.ibd` + `.cfg` → a native table | innodb, core | [27](./27-data-dictionary.md) | M7.9 | ☐ | a table exported from MySQL 8.4 in CI imports and every value matches |
| M7.11 | Export: native table → `.ibd` + `.cfg` | innodb, core | [27](./27-data-dictionary.md) | M7.10 | ☐ | `ALTER TABLE … IMPORT TABLESPACE` accepts it on a real 8.4 |
| M7.12 | `mysqldump` reader and writer | core | [42](./42-public-api.md) | M5.9 | ☐ | a real `mysqldump` file restores here, and ours restores into a real server |
| M7.13 | `innodb-ro` and `csv` engines behind the doc-30 interface | innodb | [30](./30-other-engines.md) | M4.24, M7.7 | ☐ | the executor queries an imported `.ibd` without copying it into native storage |

---

## M8 — Beyond

Roughly in the order the demand is likely to arrive. Deliberately unsequenced —
these are pulled forward by users, not pushed by the plan.

| # | Work item | Docs | Deps | St | Notes |
|---|---|---|---|---|---|
| M8.1 | Change streams and live queries — a projection of the WAL | [18](./18-binlog.md), [42](./42-public-api.md) | M4.13 | ☐ |  |
| M8.2 | `@myjs/binlog` — a standalone binlog reader, useful on its own for migration | [18](./18-binlog.md) | M2.15 | ☐ |  |
| M8.3 | `COM_BINLOG_DUMP` over the change stream | [18](./18-binlog.md) | M8.1, M8.2 | ☐ |  |
| M8.4 | A sync protocol built on the change stream | [18](./18-binlog.md) | M8.1 | ☐ |  |
| M8.5 | Stored procedures, functions and triggers — execution, not just storage | [00](./00-goals-and-scope.md) | M3.8, M5.10 | ☐ |  |
| M8.6 | Foreign key enforcement (accepted and stored from M3) | [00](./00-goals-and-scope.md) | M5.8 | ⊘ | **Moved to M5.25.** Prisma's suite, half of M5's exit criterion, relies on the server to enforce its relations, so enforcement cannot wait for M8 |
| M8.7 | Generated columns and `CHECK` constraints | [00](./00-goals-and-scope.md) | M5.10 | ⊘ | **Both halves moved to M5: generated columns are M5.31's, done.** **CHECK constraints are done, brought forward with M5.9's DDL work, because the INFORMATION_SCHEMA corpus refused 414 statements on them.** They are named, refused, enforced and shown as 8.4.11 does (`checks.ts`), and a 35-statement script captured from the server agrees. |
| M8.8 | Full-text search | [00](./00-goals-and-scope.md) | M5.10 | ⊘ | **Moved to M5.26.** Prisma's `fulltext-search` suite needed FULLTEXT indexes and MATCH … AGAINST, so they could not wait for M8 |
| M8.9 | Spatial types beyond storage round-tripping; partitioning | [24](./24-column-encodings.md) | M5.10 | ☐ |  |
| M8.10 | MyISAM read-only import (`.MYD`, `.MYI`, `.frm`) | [30](./30-other-engines.md) | M7.13 | ☐ |  |
| M8.11 | **Full-text search beyond M5.26's done-when**: an inverted index kept by the engine (today `fulltext.ts` reads the table for its statistics), WITH QUERY EXPANSION, `WITH PARSER ngram`, the index changed at commit and an UPDATE's old version counted until OPTIMIZE TABLE as InnoDB does, the FTS cache's insertion order, and MATCH over a derived table the server merges (1191 here) | [00](./00-goals-and-scope.md) | M5.26 | ☐ | Split from M5.26 when it closed. Done when a script of each, captured from 8.4.11, agrees, and a MATCH over 100,000 rows reads the index rather than the table |
| M8.12 | **EXPLAIN's other formats**: TRADITIONAL, the default, with its select_type, type, possible_keys, key, key_len, ref, rows, filtered and Extra columns; JSON in both versions; and EXPLAIN ANALYZE | [42](./42-public-api.md) | M5.44, M5.7 | ☐ | Split from M5.13, whose done-when it was not part of. mysqltest's first reason after M5.13 (160 files), and the default a bare `EXPLAIN` prints, so it is the first M8 item to take. Done when the relational corpus's TRADITIONAL plans, captured from 8.4.11, agree as their TREE skeletons do, rows and filtered included |

---

## Release plan

Milestones map to npm releases, so there is a shipping story long before M8.

| Version | Ships | Gate |
|---|---|---|
| **0.1** | `@myjs/protocol` + `@myjs/bytes` — a MySQL protocol server toolkit for JavaScript, which does not currently exist as a standalone package | M1 exit criterion |
| **0.2** | `@myjs/charsets`, `@myjs/types`, `@myjs/parser` | M2 and M3 exit criteria |
| **0.3** | `myjs` itself — `MySQL.open()`, real storage, real execution, Node only | M4 and M5 exit criteria |
| **0.4** | The browser: OPFS, workers, `myjs/worker` | M6 exit criterion |
| **0.5** | `@myjs/innodb` and import/export | M7 exit criterion |
| **1.0** | — | Every scoreboard target below met, and the API frozen |

Until 0.3 the packages were to be published but `myjs` not: shipping a
package named `myjs` that cannot open a database would be a worse first
impression than shipping nothing. As it happened nothing was published before
0.3, so 0.1 and 0.2 are folded into it (D-80): every package is staged at
0.3.0, each pinning the others exactly, by `npm run pack`.

---

## Scoreboard

The compatibility claim, as a number, updated by CI in the same commit as the
code that moves it (doc 43 §8). A claim without a number is marketing.

| Metric | Today | Target for 1.0 |
|---|---|---|
| MySQL `mysql-test` files passing | 37 / 1,146 — the files of `mysql-community-test` 8.4.11 passes under its own `mysql-test-run.pl` (of 1,459; 23 fail there, 290 skip), run by MySQL's own `mysqltest` against this executor over TCP (M5.15). Written by `tools/mysqltest-run.mjs` into `mysqltest-run.json`, and a test fails if this row and that file disagree | ≥ 800 |
| MySQL `mysql-test` statements lexing | 17,588 lexed + 1 correctly refused = 17,589 / 17,589, over a curated 120 files (112 measured, in 12 charsets; the rest are `--source` wrappers with no SQL). The selection changed with E-14 — it is now drawn from all 1,543 files rather than the first 1,000 by name. The denominator fell from 17,681 when the extractor began honouring `delimiter`, so a routine is one statement rather than one per `;` in its body, and from 17,595 when M3.17 stopped measuring pieces of `let` values and bare `eval`s as statements | the corpus, as it grows |
| MySQL `mysql-test` statements parsing | 17,534 / 17,589 — **0 failures**, **0 round-trip differences** and **nothing not implemented**: `SELECT` 6,126 / 6,158, `INSERT` 3,304 / 3,313, `CREATE` 2,660 / 2,665, `DROP` 1,946 / 1,946, `SET` 1,138 / 1,138, `EXPLAIN` 733 / 735, `ANALYZE` 292 / 292, `SHOW` 240 / 240, `EXECUTE` 213 / 213, `DELETE` 188 / 194, `UPDATE` 153 / 153, `PREPARE` 80 / 80, `ALTER` 77 / 77, `DO` 77 / 77, `FLUSH` 55 / 55, `CALL` 36 / 36, `CHECK` 24 / 24, `GRANT` 10 / 10, `LOAD` 6 / 6, `TRUNCATE` 6 / 6. Every shortfall is a statement MySQL itself refuses, and one (`GROUPING SETS`) is newer than 8.4 (D-70) | 100% of the curated corpus |
| `mysql2` test suite | 0 / 253 — not yet run. Its npm package ships no tests, so it needs the repository checked out against a server; nothing runs it yet | ≥ 245 |
| Drizzle MySQL suite | 487 / 487 — `drizzle-orm@0.36.4`'s five MySQL suites (the query builder, prefixed tables, custom types, the proxy driver and the relational API), served over TCP; 8.4.11 passes all 487 and skips the same 8. Written by `tools/orm-suites.mjs` into `orm-census.json`, and a test fails if this row and that file disagree. M5.21's JSON took it from 10 to 425, TRUNCATE and the first window functions to 465, views to 476, and INSERT reading its own row, WITH on UPDATE and DELETE, INTERVAL and UNHEX to all of them. Drizzle's half of the exit criterion holds | pass |
| Prisma MySQL suite | 1,122 / 1,122 — `prisma@5.22.0`'s functional tests (`packages/client/tests/functional`), built from its monorepo and run with `--provider mysql`; its engines speak the binary protocol through Rust's `mysql_async`. 8.4.11 passes 1,122 and fails one, a snapshot of another MySQL version's error text. Written by `tools/orm-suites.mjs` into `orm-census.json`, and a test fails if this row and that file disagree. With INFORMATION_SCHEMA (M5.12), foreign keys (M5.25) and FULLTEXT (M5.26) in, its schemas push, its relations hold and its full-text search passes. The one failure is the snapshot 8.4.11 fails too, and every file's counts equal the server's, which a test checks. Runs before M5.37 lost two to five tests to connections that timed out while `chunking-query` held the event loop; three runs since have each passed all 1,122 **Review repeat, 2026-10-10:** both sides again pass 1,122, fail the same snapshot, and skip 12,139, file for file, with `--prisma-workers 2`. Default parallel runs also exposed timing failures; the worker count is recorded in fresh reports rather than changing tests or timeouts. | pass |
| Protocol traces replayed byte-identically | 9 / 9 — our own server's traces (`test/protocol/self-traces`), replayed byte for byte. The 13 traces recorded between real clients and a real server (`test/protocol/fixtures`) are read by our parsers instead (`trace-conformance.test.ts`): a response byte-identical to a real server's is not the claim, since a version string and a connection id differ by design (Q-12) | 100% |
| Sort keys agreeing with a real MySQL 8.4 | 24 / 24, over `utf8mb4_0900_ai_ci`, `utf8mb4_general_ci`, `utf8mb4_bin` and `latin1_swedish_ci` | every implemented collation |
| Storage vectors decoding to the value a real MySQL 8.4 stored | 45 / 45, over 23 columns | every type in doc 24 |
| Expressions grouping the way a real MySQL 8.4 grouped them | 1,050 / 1,050; and evaluated by the executor, 1,200 / 1,200 with the 150 refusals included | every operator in the table |
| Queries grouping the way a real MySQL 8.4 grouped them | 1,200 / 1,200 — joins, commas, outer joins and set operations, 489 of them refusals the grouping decides | every join and set operator |
| Statements executing the way a real MySQL 8.4 executed them | 3,629 / 3,629 — 400 generated scripts through `mysql2`, 250 of their statements upserts, REPLACEs or IGNOREs: rows and order, column metadata, `affectedRows`/`insertId`/`info`, errno and SQLSTATE. Three further seeds, 46,346 statements and not committed, agree except four `SELECT DISTINCT` metadata cases that need the range optimizer (M5.7, which owns it since M5.5 closed) | every statement the executor accepts |
| InnoDB round-trip, by type | 0 / 17 | 17 / 17 |
| Crash injection points, inconsistencies | 10,000 points, 0 inconsistencies — CI's `crash` job runs `CRASH_POINTS=10000`, and `npm test` 300 of them | 10,000 points, 0 |
| Core bundle, gzipped | 334,346 B (326.5 KiB) for the browser entry chunk, measured on 2026-10-11; the facade is 334,259 B. The two deferred UCA chunks total 184,654 B raw. `tools/size-budget.mjs` measures each package including its workspace dependencies, so package figures do not add up. The M5.2 coercion and M5.10 function fixes pass the existing stabilization budgets without raising them | < 500 KB |
| Function calls returning what a real MySQL 8.4 returned | 8,765 / 8,765 — the string and numeric slices (2,091 / 2,091, including GREATEST and LEAST over text and a DATETIME), the date and time slice (3,463 / 3,463) and the rest of the string, math, hashing and network functions (3,211 / 3,211), both protocols, metadata and warning counts | every function in the library |
| Implicit coercion | 3,148 / 3,148 captured statements agree, with 0 refusals; warning counts agree on 1,737 / 1,737 queries. All observations are compared with zero disagreements (M5.2 complete) | every captured value, metadata field and warning count |
| Relational statements executing the way a real MySQL 8.4 executed them | 5,635 / 5,635 agree and none are refused, over 300 multi-table scripts through `mysql2`, both protocols. `queries.json` through the executor: 1,200 / 1,200. Rows are compared in order wherever the statement or an agreeing plan fixes it | every statement the executor accepts, and no refusals |
| Plans agreeing with a real MySQL 8.4 (`EXPLAIN FORMAT=TREE`, costs stripped) | 2,124 / 2,248 relational SELECTs observed; 2,118 required, skeleton for skeleton (M5.44, M5.7), ratcheted by `relational-vectors.test.ts`; a plan that agrees also has its rows compared in order. `npm run plans` lists the rest. They are the cost model's (M5.7): join order, `ref` access, semijoins and constant tables | every corpus SELECT |
| Cold start, browser | — | published, tracked |

---

## Open questions

Each pinned to the milestone that must answer it. A question with no milestone
is a note; with one, it is a blocker with a deadline.

| # | Question | Resolve by | Notes |
|---|---|---|---|
| Q-01 | ~~What is the undo spill threshold — at what size does an in-memory undo log move to a page file?~~ **Answered (M4.20): there is none, because undo lives in pages from its first record.** An in-memory log cannot survive a crash, and crash rollback needs it to: a page the writer dirtied may be written out mid-transaction, and the undo that reverses it must then be durable. Pages logged through the journal are durable for free, the buffer pool is the in-memory part, and eviction is the spill. | M4 | Doc 25 says "spilled … when it exceeds a threshold" and does not name one. |
| Q-02 | ~~How is `ER_LOCK_DEADLOCK` actually detected under optimistic concurrency, with no lock manager?~~ **Answered (D-53, D-54): it is not, because with one writer there is no conflict to detect.** A second writer is refused at once (`ENGINE_WRITER_BUSY`, which the edge turns into 1205), so no lock cycle can form. 1213 is raised for an expired snapshot, and only then. | M4 | Doc 41 says "an optimistic conflict detected at commit"; the detection mechanism is undesigned. D-09 requires we report it. |
| Q-03 | ~~What does the page-level schema version look like, concretely?~~ **Answered (M4.4).** A `u32` in the index page header, on clustered leaves only, meaning "every record on this page is encoded in version v". The tree re-encodes a leaf through an injected `upgrade` before any write to it, through the insert path so it can split. Doc 22 §The page-level schema version | M4 (owned by M4.4) | D-21 rejects InnoDB's per-record version byte, but doc 22's page-header proposal reserved no field for the replacement. |
| Q-04 | ~~How do the `general_ci` weight tables get from ~1.1 MB of source weights to "a few tens of KB"?~~ **Answered (M2.19).** They are already stored that way: `my_unicase_default` is 256 pages of which **11 are non-null**, an absent page means the weight *is* the code point, and everything above 0xFFFF is the constant 0xFFFD. That is 2,816 weights; delta-plus-run over them is **5,033 bytes raw and 1,726 gzipped**, against a 20 KB / 10 KB budget, asserted by a test. | M2 | The structure doc 29 declined to name is MySQL's own. |
| Q-05 | Do our index pages get prefix compression? | M7 (deferred from M4) | Doc 30 notes MyISAM's saves 30–50% on string keys. Explicitly not decided. *Re-pinned 2026-10-09: M4 closed without deciding it. It is a page-format question, so the format work of M7, which reads InnoDB's own pages, is where it gets an answer.* |
| Q-06 | ~~How faithful must `INFORMATION_SCHEMA` be?~~ **Answered (M5.12): byte for byte, column metadata included, because Prisma diffs what it reads against what it pushed.** A captured corpus of 2,568 statements agrees in full. | M5 (owned by M5.12) | Doc 15 raises it and does not settle it. Migration tools query it directly, and `MULTIPLE_KEY_FLAG` is set only on an index's first column, so clients cannot reconstruct indexes from flags alone. |
| Q-07 | How are legacy temporals disambiguated when their byte lengths overlap the modern forms? | M7 | Doc 24 says the dictionary's declared type decides, without naming the SDI field that carries it. |
| Q-08 | Is whole-page compression at the VFS layer the answer to COMPACT/COMPRESSED parity? | M6 or M8 | Proposed in doc 21 as the COMPRESSED replacement (D-20), with no design. |
| Q-09 | ~~What is the history-length policy — what API exposes it, and what does the max-age abort actually do?~~ **Answered (M4.22, D-54).** `store.stats().historyLength` exposes it. `maxHistory` bounds it in commits (default 10,000). The abort expires the views that pin the oldest commits, and their next read is `ER_LOCK_DEADLOCK`. | M4 (owned by M4.22) | Doc 25 says "report the history length, and let an application choose"; the knob is undefined. |
| Q-10 | Do we ever parse a real redo log? If so, the `OBSOLETE_*_8027` type-number mapping must be transcribed. | M7, only if needed | Currently we do not: we read tablespaces, not datadirs (D-07). Recorded so the gap is not rediscovered. |
| Q-11 | ~~Does `execProtocol` need a streaming variant?~~ **Answered (M5.40, D-85): no. `execProtocol` stays whole, and a connection whose transport reads as it writes (`onOutput`) gets the stream.** A resultset larger than a batch leaves the executor a batch at a time, and the connection waits for its transport while 64 KiB is unread. | M5.40 | D-28 returns every response byte for one command, which materialises a whole resultset in memory. That is right for a stub and wrong for doc 42's `db.stream()`, which exists so a large resultset is never materialised. **Answered in principle by D-77 (2026-10-09):** a read already pauses every 256 rows (M5.38), so its rows can leave a batch at a time; M5.40 owns the seam's shape and builds it for 0.4. |
| Q-12 | ~~How faithful can trace replay be against a *real* server, rather than against our own frozen output?~~ **Answered (M5.16): by comparing what a client sees, not bytes.** The differential harness compares rows, column metadata, counters, errors and warnings through `mysql2` against 8.4.11, and every corpus does. Byte identity is kept for our own frozen traces, and a real server's traces are parsed, not matched. | M5 | Our version string, capability set, connection id and resultset metadata differ from a real server's by design, so byte-identity there is not simply a matter of correctness. The differential harness (M5.16) is where this gets answered properly. |
| Q-13 | ~~Does the `@myjs/charsets` bundle need splitting before M6.9?~~ **Answered (M2.20).** The boundary exists and UCA is behind it: 126,423 bytes raw and 49,787 gzipped of DUCET weights are in a chunk nothing loads until a session asks for a `_0900_` collation. The 42 legacy 8-bit tables are **not** behind it and cannot be, because `collation()` must stay synchronous for them (D-36) and one of them serves doc 29's Layer 1 `latin1_swedish_ci`. Their cost is now bounded and measured rather than feared: 4,733 bytes gzipped inside `@myjs/charsets`, and **nothing at all** inside `@myjs/core`, which no longer reaches the synchronous resolver. Splitting them further is M6.9's call, with a number to make it on. | M2 (owned by M2.20) | The boundary, not an allowlist — a curated list would be the hand-maintained second source of truth D-14 and M2.17 exist to avoid. |
| Q-14 | Does a best-effort `flush()` ever reorder writes across itself? If OPFS can make a page write durable while an earlier log write it was flushed after is lost, the WAL rule is void and doc 41's "in no case corrupt" is false in the browser. | M6 | M4.25's fault model loses and tears writes since the last flush but trusts the flush itself, which is the Node guarantee. Doc 41 now says that the browser clause rests on this assumption. M6's real-browser crash tests, which kill the tab mid-write, are where it gets settled. If the answer is yes, a page would have to be recognisable as ahead of its log without the log; nothing yet does that. |

### Errata in the design docs

Corrections to be made to docs 20–43. Recorded here rather than fixed silently,
so the correction has a reason attached.

| # | Doc | Error | Correction |
|---|---|---|---|
| E-01 | [26](./26-redo-and-recovery.md) | Suggests `crypto.subtle.digest` for CRC32C "where a hardware path exists". | WebCrypto offers no CRC32C — it has no CRC at all. The implementation is table-driven, full stop. Applied by M4.1. |
| E-02 | [40](./40-vfs.md) | Declares `durability` on the `Vfs` interface, but the prose exposes it on `VfsFile`. | Keep it on `Vfs`; a backend's durability is a property of the backend, not of one open file. Applied by M0.9. |
| E-03 | [40](./40-vfs.md) | The durability table says memory's real guarantee is "none", but the `Vfs.durability` union is `'strong' \| 'best-effort'` and §Memory says to report `'best-effort'`. | Report `'best-effort'`, as §Memory says. The table means "no platform guarantee"; a third union member would make every consumer branch on a case only a test backend can produce. Applied by M0.10. |
| E-04 | [40](./40-vfs.md) | `Vfs.lock()` returns `Promise<Lock>`, and `Lock` is never declared anywhere in the docs. | Declared in M0.9: `path`, `held`, `release()` and `[Symbol.dispose]()`, so a lock can be released from a `finally` or a `using`. A second `release()` is a no-op, not an error. |
| E-05 | [13](./13-authentication.md) | Suggests constant-time comparison "via `crypto.subtle.timingSafeEqual` where available and a manual constant-time loop otherwise". | WebCrypto has no `timingSafeEqual` on any platform — the method exists only on Node's `node:crypto`, which ground rule 1 forbids above the VFS. The manual loop is the implementation, full stop. Applied by M1.7. |
| E-06 | [15](./15-wire-types.md) | Describes a parameter's unsigned flag as "the high bit of the high byte (`0x80`)", while docs 14 and 16 say `0x8000`. | The same bit. State it once as `typeWord & 0x8000` over the whole `int<2>`; the `0x80` form reads as a mask over the word when quoted out of context. Applied by M1.3. |
| E-07 | [15](./15-wire-types.md) | The third binary `TIME` dump prints `01` for the all-zero value, contradicting the layout three lines above it, which allows a length byte of only 0, 8 or 12. | Encode the all-zero `TIME` as a bare `00`, as the layout requires; `01` is a transcription slip. Applied by M1.21 and **confirmed**: MySQL 8.0.46 encodes `CAST('00:00:00' AS TIME)` as a bare `00` in a binary row (`test/protocol/fixtures/binary-temporals-prepared.json`). |
| E-08 | [16](./16-prepared-statements.md) | The worked `COM_STMT_EXECUTE` example encodes the parameter's type word as `0f 00` while calling it `VAR_STRING`; doc 15's table gives `VAR_STRING` = `0xfd`, and `0x0f` is `VARCHAR`, which is internal-only. | Parse what is on the wire rather than "correcting" it — the example is transcribed from upstream. **Settled**: `mysql2` against MySQL 8.0.46 sends `fd 00` for a string parameter (`test/protocol/fixtures/binary-scalars-prepared.json`), so `0x0f` is an artefact of the transcription. Noted by M1.22. |
| E-09 | [13](./13-authentication.md) | "Empty password ⇒ empty response" (zero-length). The C client — and so the `mysql` CLI — sends a **single `0x00` byte** instead, seen on the wire as the length-encoded pair `01 00`. | Accept both. A real scramble is 20 bytes (native) or 32 (sha2), so neither empty form can collide with one. Applied by M1.11/M1.12. |
| E-10 | [13](./13-authentication.md) | Describes the empty-password short-circuit without saying that it must skip `fast_auth_success`. | Send the OK directly, with no `0x03`. Having sent an empty response the C client returns from its plugin at once and expects the final OK; an AuthMoreData there is read as a malformed packet (`ERROR 2027`). `mysql2` tolerates it, which is why only a real C client finds this. Applied by M1.12. |
| E-11 | [29](./29-charsets-and-collations.md) | "`TextDecoder`/`TextEncoder` handle `utf-8`, `utf-16`, and most legacy encodings natively in both Node and browsers, so the encoding layer is mostly a matter of mapping MySQL charset names to WHATWG labels." **False, and it cost a silent corruption bug.** A runtime built without full ICU has exactly one single-byte decoder, and every label in the Latin-1 family resolves to it *successfully* — `new TextDecoder('windows-1252')` does not throw, it returns ISO-8859-1. So MySQL's `latin1` decoded `0x80` to `U+0080` instead of `€`, no error was raised, and the wrong character reached the application as data; the reverse table built from that decoder then encoded `€` as `?`. Every test passed on a full-ICU laptop and four failed on CI, on `main` as well as on the branch. | Generate the tables. The byte → code point map for all 24 single-byte charsets MySQL's `CHARSET_INFO` names is emitted by the same parse that already builds the registry and the weight tables — 7,804 bytes raw, 2,637 gzipped — so those charsets never consult `TextDecoder` again and are identical on every runtime. What stays on `TextDecoder` (UTF-8, UTF-16, the multi-byte legacy charsets) is probed rather than trusted: a decoder that returns `U+0080`–`U+009F` for bytes `0x80`–`0x9F` is the Latin-1 substitute, whatever it was asked for, and is refused. Applied by B0; regression-tested in a child process whose `TextDecoder` behaves like a small-ICU build's. Two further latent bugs surfaced with it: `ascii` was decoding high bytes as cp1252 characters (now U+FFFD, as MySQL's own table says they are undefined), and `cp850`, `macce` and `ascii` stopped being `APPROXIMATE_CHARSETS`. |
| E-12 | [29](./29-charsets-and-collations.md) | Says of the binary collations that "ordering is `memcmp`" and treats the sort key as the value throughout — which doc 43 §4 then repeats as the property to test. **True for ordering, false for the key.** MySQL runs `my_strnxfrm_unicode_full_bin` for `utf8mb4_bin`, which writes each code point as three big-endian bytes, and `my_strnxfrm_unicode` for `utf8mb3_bin`, which writes two; only the 8-bit `*_bin` collations `memcpy`. So `WEIGHT_STRING('a' COLLATE utf8mb4_bin)` is `0x000061`, `'ä'` is `0x0000E4` — one three-byte weight, not the two UTF-8 bytes — and a `CHAR(4)` key is 12 bytes wide, not 16. Ordering was never affected, because UTF-8 is order-preserving, which is exactly why every test passed: the property that was checked (`compare` agrees with `memcmp` of the keys) holds under both. | Emit the widths. `BIN_KEY_WIDTHS` is generated from each collation's `MY_COLLATION_HANDLER`, resolved to its `strnxfrm` function — a fact from the source, like `tab_to_uni` in E-11, rather than a rule inferred from the charset name; `utf8mb3_bin` and `utf8mb4_bin` are indistinguishable by name, flags and `mbmaxlen` and have different widths. `compare` for these collations is now *derived* from `sortKey` rather than written beside it, so D-35's agreement property is structural instead of coincidental. Found by M2.21's captured corpus on its first successful run — the first time anything in this project was checked against a server rather than against a document. |
| E-13 | [43 §1](./43-testing.md) | Proposes a starting allowlist for MySQL's test corpus: "`type_*`, `func_*`, `select`, `join*`, `order_by`, `group_by`, `insert*`, `update`, `delete`, `null`, `varbinary`, `ctype_*`". **Half of it does not exist at the pinned ref.** `mysql-test/t` holds 2,448 `.test` files at `e174239c`, and `select.test`, `order_by.test`, `update.test`, `null.test`, `union.test` and `varbinary.test` are not among them; `type_*` matches **nothing at all**. Those tests moved into `mysql-test/suite/` at some point and the doc was written against an older tree — or from memory. The count is stale too: doc 43 says 1,543 files, which is what the scoreboard has carried since. | Never hardcode the names. M3.11's census lists the directory at the pinned ref and selects with patterns, so the file list is read from the tree rather than transcribed — D-14's principle applied to a file list instead of a table, and the same reason `tab_to_uni` is parsed out of the struct rather than inferred from a charset name. The scoreboard's denominator is now 2,448. |
| E-14 | [44 §errata](#errata-in-the-design-docs) | **E-13 is itself mostly wrong, and this is the correction.** It reports that `mysql-test/t` holds 2,448 `.test` files at `e174239c` and that `update.test`, `null.test`, `union.test` and `varbinary.test` are absent while `type_*` "matches nothing at all". A clone of that exact commit says otherwise: **1,543 `.test` files** — precisely the number doc 43 gave and E-13 called stale — with `update.test`, `null.test`, `union.test`, `varbinary.test`, `delete.test`, `group_by.test`, `insert.test` and `join.test` all present, and `type_*` matching 29. Only `select.test` and `order_by.test` are genuinely gone. | Every wrong claim is about a filename sorting after roughly `mysqladmin_shutdown.test`, because E-13 was written from a GitHub contents-API listing and that endpoint caps a page at 1,000 entries. The count and the absences are both artefacts of a truncated response that carried no error. E-13's *remedy* stands and is why this was findable — the census reads the tree rather than a transcribed list — but it was reading a short tree. M3.13 lists with `git ls-tree` over the pinned commit; the scoreboard's denominator goes back to 1,543. The lesson is E-13's own, one level up: a listing is input too, and an instrument that silently drops input flatters every number downstream of it. |
| E-15 | [44 M3.2](#m3--parse-sql) | M3.2's text, and its evaluator's comment, say `%` and `DIV` "do **not** promote to unsigned" the way `+`, `-` and `*` do. **True of `%`, false of `DIV`.** `-7 DIV (0 ^ 2)` is ER_DATA_OUT_OF_RANGE on 8.4.11 and `7 DIV (0 ^ 5) - 8` is too: a `DIV` with an unsigned operand is unsigned. | The evaluator skips the vectors the server refused, and every vector that shows the difference is a refusal, so 1,050 of 1,050 agreed with the claim wrong. The executor runs the same corpus and reports refusals, and disagreed on one, `4 AND ! 0 DIV ~ 5 - 5`. `intDivide` promotes. The evaluator's values are unaffected, because wherever the promotion matters the server refused, and its comment now says so. The instrument agreed for as long as it could not see the case. |
| E-16 | [44 D-64](#decision-log) | D-64 says a closed connection rolls its transaction back, "so a dead client cannot hold the slot". **Not true of a statement that was waiting when the connection closed.** It woke after `end()` had rolled the transaction back, and ran in a fresh session. Under `autocommit = 0` that opened a transaction nothing would ever end, and every later writer got 1205. Found by the code review of M5.17. | The executor now remembers which sessions have ended, and a waiting statement re-checks after every await and stops with ER_QUERY_INTERRUPTED. The first test written for it passed on the broken code, because of a second bug in our own host: the in-process stream only called back from `write()` when the statement finished, and Node holds a `destroy()` until the pending write calls back, so the close arrived too late to show anything. The test now goes over TCP, where the close arrives at once, and fails on the old code with exactly the 1205 the review predicted. The stream now acknowledges a write at once and keeps commands in order behind a promise chain. |
| E-17 | [44 M5.17](#m5--execute) | M5.17 says `SELECT DISTINCT` through MySQL's temporary table makes a column "lose its key flags and gain GROUP_FLAG", and `meta.ts` did that for every column. **GROUP_FLAG is set only on a *nullable* grouped column**: `SELECT DISTINCT c` on a NOT NULL `c` reports `c`'s flags without it. Separately, a column the WHERE pins to one value (`a = 5`) is held in the table but not grouped, and gets none. The table is skipped altogether for a zero limit, an impossible WHERE (`notnull IS NULL`, `int_col = 9.5`) and a const table. | Every non-key DISTINCT column the first corpus drew was nullable, so the rule held for every case it had. M5.8's corpus redrew the cases and found three that disagreed, and probing found the rest. The fix is in `meta.ts` and in `distinctConstant` in `query.ts`. M5.5 inherits the shapes that need the range optimizer. |
| E-18 | [26](./26-redo-and-recovery.md) | §Records says an update's `ROW` record, "both images in one record — waits for the executor to have one." **No longer true.** `ClusteredIndex.update` logs the before and after images together (`indexes.ts`), since M5.17 gave the engine an executor. Found while writing `ARCHITECTURE.md` against the code (D-72). | Read the sentence as past: inserts log an after image, deletes a before image, and updates both. |
| E-19 | [44 E-17](#errata-in-the-design-docs) | E-17, and `meta.ts` after it, say that a column copied through `SELECT DISTINCT`'s temporary table loses its key flags, and they counted NO_DEFAULT_VALUE among them. **It does not lose that one.** On 8.4.11, `SELECT DISTINCT qty, label` reports a NOT NULL `qty` with no default as 0x1001, and the same column with `DEFAULT 3` as 0x0001. | Every NOT NULL column M5.17's corpus drew for DISTINCT held a whole key, so the server skipped the table and the flag was never tested. M5.18's corpus has a NOT NULL column that is not a key (`ch.qty`), and it disagreed on its first run. The temporary table drops PRI, UNIQUE, MULTIPLE, PART_KEY and AUTO_INCREMENT, and keeps NO_DEFAULT_VALUE. |
| E-20 | [44 M3.9](#m3--parse-sql) | M3.9 is ☑ on "the `near` text is a **suffix** — from the offending position to the end, capped". That holds for an error the lexer finds. **One the parser finds quoted only its token:** `SELECT 1 FROM WHERE x = 1` said `near 'WHERE'`, where 8.4.11 says `near 'WHERE x = 1'`. Nothing compared a message from the parser: the corpora compare errnos, and the M3.9 tests used lexer errors. A view's INTO, refused at the wrong position, showed it. | `Cursor.fail()` quotes the source from the token, capped at 80 characters as the lexer's is, and `parser-query.test.ts` pins both 8.4.11 messages. |
| E-21 | [43 §Test infrastructure](./43-testing.md#test-infrastructure) | Lays out `test/` with `mysqltest/`, `differential/`, `browser/` and `bench/`, and says `npm test` runs "unit, protocol, format and mysqltest". | As built, `npm test` runs `unit`, `protocol`, `format` and `crash` (300 points), and `test/lib/` holds what tests share. The differential runs against a real server are the `capture:*` tools and CI's `type-vectors` job, which commit their answers as fixtures that `format/` replays, so they need no directory of their own; `mysqltest/`, `browser/` and `bench/` arrive with M5.15, M6.10 and the first benchmark. The roadmap's Repository layout is the tree as it stands. |
| E-22 | [44 M5.21](#m5--execute) | M5.21, and `orderJson`'s comment after it, say that two JSON arrays or objects that tie in a sort (one length, one type) keep their input order. **They do not.** 8.4.11's filesort appends a 64-bit hash of the row's JSON key values to each sort record and compares it after the keys, low byte first and ascending under DESC too (`Json_wrapper::make_hash_key`). Nine values inserted in order come out as `9 8 7 5 4 3 1 2 6` under ASC and `5 4 3 1 2 6 9 8 7` under DESC. The corpus never compared those rows in order until our plan agreed with the server's (M5.44), and then three JSON statements disagreed. | Ties break by `jsonSortHash` (`@myjs/types`) in the sort operator; `mysql2-json-sort.test.ts` pins both probes. |
| E-23 | [26](./26-redo-and-recovery.md), [43](./43-testing.md), [42](./42-public-api.md), [02](./02-strategy.md) | The corrections recorded in E-18 and E-21 had not been applied to their design documents. Public API examples also described shipped streaming/introspection as future work, and the strategy’s licensing argument treated every consumer as a derived work. | Applied in M5.53: ROW update images and crash-time transaction undo are built; test paths and commands describe the actual tree; streaming/introspection are in 0.3.0 tarballs; browser and interchange stay planned; licensing wording follows the cited primary sources (D-88). The bundle scoreboard is measured again. |
| E-24 | [44 M5.3](#m5--execute), [44 M5.6](#m5--execute) | The operator/window descriptions imply that ORDER BY always preserves arrival order among ties. Native bounded queues preserve retained record slots instead; non-queue nth-element preselection can also reorder tied rows. In a 16-row probe, LIMIT 2 over integer groups returns ids 4,2, versus a stable selection's 2,4. | The shared sorter receives the native source estimate and record capacity, applies verified queue eligibility and preserves physical slots for whole-table integer sorts keeping fewer than 16 rows. The descriptions now distinguish this from stable fallback behavior. Non-queue preselection, larger queues, wider layouts and spilling remain M5.49/M5.5 work. |

---

## Sequencing notes

**Why M1 before the engine.** It is the smallest amount of work that produces
something people can use, it is fully specified so it can be built without
design risk, and it forces the `execProtocol` boundary to exist before anything
can grow around it. It also makes every later milestone demonstrable through
real tools.

**Why M2 before M3.** The parser needs the type system to fold literals and
resolve collations. Building it the other way round means rewriting the parser.

**Why M4 before M5.** An executor without storage is a toy, and the shape of the
storage layer determines which operators are cheap.

**Why M6 late.** OPFS is a VFS backend. If the VFS interface is right, the
browser is a fortnight; if it is wrong, no amount of browser work saves it. Build
against memory and Node until the interface is proven.

**Why M7 last.** It is the most self-contained work in the project and has no
dependents. It is also the piece most likely to be someone else's favourite part,
so it is a natural first external contribution.

### Parallel tracks

The milestone numbering is a dependency order, not a schedule. The dependency
graph has two independent roots — `bytes` and `vfs` — and the M0→M3 sequence
serialises what grows from them more than the code requires. Work that can
proceed concurrently once M0.1–M0.5 exist:

```
M0.3–M0.8  bytes ────┬──▶ M1  protocol
                     │
M0.9–M0.10 vfs ──────┼────────────────────▶ M4  engine
                     │                      ▲
M2.1–M2.7  charsets ─┴──▶ M2.8–M2.15 types ─┘
               │
               └──▶ M3.1–M3.10 parser
```

*As built:* the parser needed less than the first bullet below expected. It
folds no literal and resolves no collation, so it depends on `bytes` and
`charsets` alone, and the edge to `types` that this diagram once drew was
never made.

Two specific unblockings worth naming:

- **The parser needs the type system only for literal folding and collation
  resolution.** M3.1 and M3.2 can start as soon as M2.3 (charset decode) exists;
  they do not wait for the UCA collations.
- **The B+tree needs only `memcmp` collations.** Doc 29 is explicit that
  `binary` and `*_bin` are enough to build and test the entire tree, because
  ordering there is `memcmp`. So M4 waits on M2.14 (key encoding) and M2.2, not
  on M2.7.

---

## Risks, and what we do about them

| Risk | Mitigation |
|---|---|
| SQL semantics are a bottomless pit | Fix scope by *test pass rate*, not by feature list. Publish the number (the [scoreboard](#scoreboard), doc 43). |
| Collation tables bloat the bundle | Generate them; load them on demand; ship only `binary` + `utf8mb4_bin` in the core (M6.9). |
| OPFS durability is weaker than assumed | Self-verifying WAL, full-page images, fault injection. Assume nothing (docs 40, 41; D-17, D-18). |
| Performance disappoints against native | Be honest about the target: an embedded database for one application, not a server. Benchmark cold start and bundle size as first-class metrics. |
| The engine drifts from MySQL over time | Differential testing against a real server in CI, on every commit (M5.16). |
| Scope creep into a general SQL engine | The three compatibility contracts in doc 00 are the scope. Anything that serves none of them is out. |
| Type stripping constrains the code we can write | No `enum`, `namespace`, parameter properties or decorators. Enforced by `erasableSyntaxOnly` (M0.1) so the constraint fails at commit time, not at publish time. If it ever becomes genuinely limiting, adding a build step is a one-line change — the source is already TypeScript. |
| The GPL boundary is crossed by accident | `reference/` stays gitignored; `mysql-test` is fetched in CI and never vendored; no MySQL source is copied into this MIT repository. Ground rule 7, checked in review. |

---

## Change log

[Doc 45](./45-changelog.md), newest first. It was this section until it grew to
a third of the file; an entry is still added in the same commit as the work.
