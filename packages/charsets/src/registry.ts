// GENERATED FILE — do not edit by hand. Run `npm run gen:charsets`.
//
// M2.1 / M2.17: the collation registry, from MySQL's own `CHARSET_INFO`
// definitions. Facts only — ids, names, byte widths and pad attributes.
// Weight tables are a separate generator (M2.5, M2.20).
//
// Source:  mysql/mysql-server@e174239c strings/ctype-big5.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-bin.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-cp932.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-czech.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-eucjpms.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-euc_kr.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-extra.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-gb18030.cc
// Source:  mysql/mysql-server@e174239c strings/ctype-gb2312.cc
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
// Collations: 291

/** The upstream files this registry was generated from, for re-verification. */
export const COLLATION_TABLE_SOURCE = 'mysql/mysql-server@e174239c strings/ctype-*.cc'

/** SHA-256 over every source file's own hash. CI regenerates and diffs. */
export const COLLATION_TABLE_SOURCE_SHA256 =
  '037f18f34aac7c6d3eed67a3d3763202ab89824c8972627f96364fbe052aa473'

/** Number of collations MySQL e174239c compiles in. */
export const COLLATION_TABLE_SIZE = 291

/** Restore the registry's public, ascending-id row format. */
function collationRows(data: string): string {
  const rows: string[] = []
  for (const group of data.split('\n\n')) {
    const [header, ...entries] = group.split('\n')
    const [charset, min, max] = header!.split(' ')
    for (const entry of entries) {
      const [id, suffix, flags] = entry.split(' ')
      const name = suffix!.startsWith('@') ? suffix!.slice(1) : `${charset}_${suffix}`
      rows[Number(id)] = `${id} ${name} ${charset} ${min} ${max}${flags === undefined ? '' : ` ${flags}`}`
    }
  }
  return rows.filter(Boolean).join('\n')
}

/**
 * One collation per line: `id collation charset mbminlen mbmaxlen [flags]`.
 *
 * Flags are a subset of `n` (NO PAD), `d` (the charset's default collation)
 * and `b` (binary). The public rows keep their original spelling and order.
 */
export const PACKED_COLLATIONS = collationRows(`big5 1 2
1 chinese_ci d
84 bin b

latin2 1 1
2 czech_cs
9 general_ci d
21 hungarian_ci
27 croatian_ci
77 bin b

dec8 1 1
3 swedish_ci d
69 bin b

cp850 1 1
4 general_ci d
80 bin b

latin1 1 1
5 german1_ci
8 swedish_ci d
15 danish_ci
31 german2_ci
47 bin b
48 general_ci
49 general_cs
94 spanish_ci

hp8 1 1
6 english_ci d
72 bin b

koi8r 1 1
7 general_ci d
74 bin b

swe7 1 1
10 swedish_ci d
82 bin b

ascii 1 1
11 general_ci d
65 bin b

ujis 1 3
12 japanese_ci d
91 bin b

sjis 1 2
13 japanese_ci d
88 bin b

cp1251 1 1
14 bulgarian_ci
23 ukrainian_ci
50 bin b
51 general_ci d
52 general_cs

hebrew 1 1
16 general_ci d
71 bin b

filename 1 5
17 @filename d

tis620 1 1
18 thai_ci d
89 bin b

euckr 1 2
19 korean_ci d
85 bin b

latin7 1 1
20 estonian_cs
41 general_ci d
42 general_cs
79 bin b

koi8u 1 1
22 general_ci d
75 bin b

gb2312 1 2
24 chinese_ci d
86 bin b

greek 1 1
25 general_ci d
70 bin b

cp1250 1 1
26 general_ci d
34 czech_cs
44 croatian_ci
66 bin b
99 polish_ci

gbk 1 2
28 chinese_ci d
87 bin b

cp1257 1 1
29 lithuanian_ci
58 bin b
59 general_ci d

latin5 1 1
30 turkish_ci d
78 bin b

armscii8 1 1
32 general_ci d
64 bin b

utf8mb3 1 3
33 general_ci d
76 tolower_ci
83 bin b
192 unicode_ci
193 icelandic_ci
194 latvian_ci
195 romanian_ci
196 slovenian_ci
197 polish_ci
198 estonian_ci
199 spanish_ci
200 swedish_ci
201 turkish_ci
202 czech_ci
203 danish_ci
204 lithuanian_ci
205 slovak_ci
206 spanish2_ci
207 roman_ci
208 persian_ci
209 esperanto_ci
210 hungarian_ci
211 sinhala_ci
212 german2_ci
213 croatian_ci
214 unicode_520_ci
215 vietnamese_ci
223 general_mysql500_ci

ucs2 2 2
35 general_ci d
90 bin b
128 unicode_ci
129 icelandic_ci
130 latvian_ci
131 romanian_ci
132 slovenian_ci
133 polish_ci
134 estonian_ci
135 spanish_ci
136 swedish_ci
137 turkish_ci
138 czech_ci
139 danish_ci
140 lithuanian_ci
141 slovak_ci
142 spanish2_ci
143 roman_ci
144 persian_ci
145 esperanto_ci
146 hungarian_ci
147 sinhala_ci
148 german2_ci
149 croatian_ci
150 unicode_520_ci
151 vietnamese_ci
159 general_mysql500_ci

cp866 1 1
36 general_ci d
68 bin b

keybcs2 1 1
37 general_ci d
73 bin b

macce 1 1
38 general_ci d
43 bin b

macroman 1 1
39 general_ci d
53 bin b

cp852 1 1
40 general_ci d
81 bin b

utf8mb4 1 4
45 general_ci
46 bin b
224 unicode_ci
225 icelandic_ci
226 latvian_ci
227 romanian_ci
228 slovenian_ci
229 polish_ci
230 estonian_ci
231 spanish_ci
232 swedish_ci
233 turkish_ci
234 czech_ci
235 danish_ci
236 lithuanian_ci
237 slovak_ci
238 spanish2_ci
239 roman_ci
240 persian_ci
241 esperanto_ci
242 hungarian_ci
243 sinhala_ci
244 german2_ci
245 croatian_ci
246 unicode_520_ci
247 vietnamese_ci
255 0900_ai_ci nd
256 de_pb_0900_ai_ci n
257 is_0900_ai_ci n
258 lv_0900_ai_ci n
259 ro_0900_ai_ci n
260 sl_0900_ai_ci n
261 pl_0900_ai_ci n
262 et_0900_ai_ci n
263 es_0900_ai_ci n
264 sv_0900_ai_ci n
265 tr_0900_ai_ci n
266 cs_0900_ai_ci n
267 da_0900_ai_ci n
268 lt_0900_ai_ci n
269 sk_0900_ai_ci n
270 es_trad_0900_ai_ci n
271 la_0900_ai_ci n
272 fa_0900_ai_ci n
273 eo_0900_ai_ci n
274 hu_0900_ai_ci n
275 hr_0900_ai_ci n
276 si_0900_ai_ci n
277 vi_0900_ai_ci n
278 0900_as_cs n
279 de_pb_0900_as_cs n
280 is_0900_as_cs n
281 lv_0900_as_cs n
282 ro_0900_as_cs n
283 sl_0900_as_cs n
284 pl_0900_as_cs n
285 et_0900_as_cs n
286 es_0900_as_cs n
287 sv_0900_as_cs n
288 tr_0900_as_cs n
289 cs_0900_as_cs n
290 da_0900_as_cs n
291 lt_0900_as_cs n
292 sk_0900_as_cs n
293 es_trad_0900_as_cs n
294 la_0900_as_cs n
295 fa_0900_as_cs n
296 eo_0900_as_cs n
297 hu_0900_as_cs n
298 hr_0900_as_cs n
299 si_0900_as_cs n
300 vi_0900_as_cs n
303 ja_0900_as_cs n
304 ja_0900_as_cs_ks n
305 0900_as_ci n
306 ru_0900_ai_ci n
307 ru_0900_as_cs n
308 zh_0900_as_cs n
309 0900_bin nb
310 nb_0900_ai_ci n
311 nb_0900_as_cs n
312 nn_0900_ai_ci n
313 nn_0900_as_cs n
314 sr_latn_0900_ai_ci n
315 sr_latn_0900_as_cs n
316 bs_0900_ai_ci n
317 bs_0900_as_cs n
318 bg_0900_ai_ci n
319 bg_0900_as_cs n
320 gl_0900_ai_ci n
321 gl_0900_as_cs n
322 mn_cyrl_0900_ai_ci n
323 mn_cyrl_0900_as_cs n

utf16 2 4
54 general_ci d
55 bin b
101 unicode_ci
102 icelandic_ci
103 latvian_ci
104 romanian_ci
105 slovenian_ci
106 polish_ci
107 estonian_ci
108 spanish_ci
109 swedish_ci
110 turkish_ci
111 czech_ci
112 danish_ci
113 lithuanian_ci
114 slovak_ci
115 spanish2_ci
116 roman_ci
117 persian_ci
118 esperanto_ci
119 hungarian_ci
120 sinhala_ci
121 german2_ci
122 croatian_ci
123 unicode_520_ci
124 vietnamese_ci

utf16le 2 4
56 general_ci d
62 bin b

cp1256 1 1
57 general_ci d
67 bin b

utf32 4 4
60 general_ci d
61 bin b
160 unicode_ci
161 icelandic_ci
162 latvian_ci
163 romanian_ci
164 slovenian_ci
165 polish_ci
166 estonian_ci
167 spanish_ci
168 swedish_ci
169 turkish_ci
170 czech_ci
171 danish_ci
172 lithuanian_ci
173 slovak_ci
174 spanish2_ci
175 roman_ci
176 persian_ci
177 esperanto_ci
178 hungarian_ci
179 sinhala_ci
180 german2_ci
181 croatian_ci
182 unicode_520_ci
183 vietnamese_ci

binary 1 1
63 @binary ndb

geostd8 1 1
92 general_ci d
93 bin b

cp932 1 2
95 japanese_ci d
96 bin b

eucjpms 1 3
97 japanese_ci d
98 bin b

gb18030 1 4
248 chinese_ci d
249 bin b
250 unicode_520_ci`)

/**
 * The `*_bin` collations whose sort key is **not** the value, and how many
 * bytes each code point becomes.
 *
 * Every 8-bit `*_bin` collation copies its input — `my_strnxfrm_8bit_bin_*`
 * is a `memcpy` — so "the sort key is the value" holds for all of them and
 * they are absent here. The Unicode ones do not: `utf8mb4_bin` runs
 * `my_strnxfrm_unicode_full_bin`, which writes each code point as three
 * big-endian bytes, and `utf8mb3_bin` runs `my_strnxfrm_unicode`, which
 * writes two. `WEIGHT_STRING('a' COLLATE utf8mb4_bin)` is `0x000061` on a
 * real 8.4, not `0x61` — which is how M2.21's captured corpus found this.
 *
 * Read from each collation's `MY_COLLATION_HANDLER`, not from its name or
 * its flags: `utf8mb3_bin` and `utf8mb4_bin` carry identical flags and have
 * different key widths.
 */
export const BIN_KEY_WIDTHS: Readonly<Record<number, number>> = {
  46: 3, // utf8mb4_bin
  55: 3, // utf16_bin
  61: 3, // utf32_bin
  62: 3, // utf16le_bin
  83: 2, // utf8mb3_bin
  90: 2, // ucs2_bin
}
