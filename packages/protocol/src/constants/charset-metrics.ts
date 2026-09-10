// GENERATED FILE — do not edit by hand. Run `npm run gen:charsets`.
//
// D-33: `@myjs/protocol` must not depend on `@myjs/charsets` — the
// release plan ships the protocol at 0.1 and the charset registry at 0.2.
//
// Two decisions the protocol makes with no session to consult need nothing
// but a collation's byte widths: the pre-authentication connection-charset
// check (doc 12 — a multibyte charset makes the NUL-terminated fields
// ambiguous) and `columnLengthForChars` (doc 15 — `VARCHAR(255)` utf8mb4
// reports 1020). Those widths are generated here from the same parse that
// builds the full registry, so there is no hand-maintained second copy.
//
// Source:  mysql/mysql-server@e174239c strings/ctype-big5.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-bin.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-cp932.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-czech.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-eucjpms.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-euc_kr.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-extra.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-gb18030.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-gbk.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-latin1.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-mb.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-simple.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-sjis.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-tis620.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-uca.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-ucs2.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-ujis.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-utf8.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-win1250ch.cc
// Collations: 288
// Classes: 8

/** SHA-256 over every source file's own hash — the same value the registry carries. */
export const CHARSET_METRICS_SOURCE_SHA256 =
  'b00392630713ac249eddd5f45df836d2cc03a63a58c73443e0caf465ce54248f'

/**
 * `mbminlen mbmaxlen id-ranges`, one width class per line.
 *
 * Only a handful of distinct widths exist across 288 collations and the ids
 * within a class are mostly contiguous, so ranges beat one line per id by an
 * order of magnitude.
 */
export const PACKED_CHARSET_METRICS = `1 1 2-11,14-16,18,20-23,25-27,29-32,34,36-44,47-53,57-59,63-75,77-82,89,92-94,99
1 2 1,13,19,28,84-85,87-88,95-96
1 3 12,33,76,83,91,97-98,192-215,223
1 4 45-46,224-250,255-300,303-308,310-323
1 5 17
2 2 35,90,128-151,159
2 4 54-56,62,101-124
4 4 60-61,160-183`
