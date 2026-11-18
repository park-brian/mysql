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

import type { CollationInfo } from './collation.ts'

/** The upstream files this registry was generated from, for re-verification. */
export const COLLATION_TABLE_SOURCE = 'mysql/mysql-server@e174239c strings/ctype-*.cc'

/** SHA-256 over every source file's own hash. CI regenerates and diffs. */
export const COLLATION_TABLE_SOURCE_SHA256 =
  '037f18f34aac7c6d3eed67a3d3763202ab89824c8972627f96364fbe052aa473'

/** Number of collations MySQL e174239c compiles in. */
export const COLLATION_TABLE_SIZE = 291

const COLLATION_GROUPS = `big5 1 2
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
250 unicode_520_ci`
let decoded: CollationInfo[] | undefined

/** Decode the generated groups once, in ascending collation-id order. */
export function collationRows(): readonly CollationInfo[] {
  if (decoded !== undefined) return decoded
  const rows: CollationInfo[] = []
  for (const group of COLLATION_GROUPS.split('\n\n')) {
    const [header, ...entries] = group.split('\n')
    const [charset, min, max] = header!.split(' ') as [string, string, string]
    const mbminlen = Number(min)
    const mbmaxlen = Number(max)
    for (const entry of entries) {
      const [rawId, suffix, flags = ''] = entry.split(' ') as [string, string, string?]
      const id = Number(rawId)
      const name = suffix.startsWith('@') ? suffix.slice(1) : `${charset}_${suffix}`
      rows[id] = { id, name, charset, mbminlen, mbmaxlen, padAttribute: flags.includes('n') ? 'NO PAD' : 'PAD SPACE', isDefault: flags.includes('d'), isBinary: flags.includes('b') }
    }
  }
  return (decoded = rows)
}

/** Restore the public row format, including its flags in source order. */
function packedCollations(): string {
  return collationRows().filter(Boolean).map(({ id, name, charset, mbminlen, mbmaxlen, padAttribute, isDefault, isBinary }) => {
    const flags = (padAttribute === 'NO PAD' ? 'n' : '') + (isDefault ? 'd' : '') + (isBinary ? 'b' : '')
    return `${id} ${name} ${charset} ${mbminlen} ${mbmaxlen}${flags ? ` ${flags}` : ''}`
  }).join('\n')
}

export const PACKED_COLLATIONS = /* @__PURE__ */ packedCollations() as `1 big5_chinese_ci big5 1 2 d
2 latin2_czech_cs latin2 1 1
3 dec8_swedish_ci dec8 1 1 d
4 cp850_general_ci cp850 1 1 d
5 latin1_german1_ci latin1 1 1
6 hp8_english_ci hp8 1 1 d
7 koi8r_general_ci koi8r 1 1 d
8 latin1_swedish_ci latin1 1 1 d
9 latin2_general_ci latin2 1 1 d
10 swe7_swedish_ci swe7 1 1 d
11 ascii_general_ci ascii 1 1 d
12 ujis_japanese_ci ujis 1 3 d
13 sjis_japanese_ci sjis 1 2 d
14 cp1251_bulgarian_ci cp1251 1 1
15 latin1_danish_ci latin1 1 1
16 hebrew_general_ci hebrew 1 1 d
17 filename filename 1 5 d
18 tis620_thai_ci tis620 1 1 d
19 euckr_korean_ci euckr 1 2 d
20 latin7_estonian_cs latin7 1 1
21 latin2_hungarian_ci latin2 1 1
22 koi8u_general_ci koi8u 1 1 d
23 cp1251_ukrainian_ci cp1251 1 1
24 gb2312_chinese_ci gb2312 1 2 d
25 greek_general_ci greek 1 1 d
26 cp1250_general_ci cp1250 1 1 d
27 latin2_croatian_ci latin2 1 1
28 gbk_chinese_ci gbk 1 2 d
29 cp1257_lithuanian_ci cp1257 1 1
30 latin5_turkish_ci latin5 1 1 d
31 latin1_german2_ci latin1 1 1
32 armscii8_general_ci armscii8 1 1 d
33 utf8mb3_general_ci utf8mb3 1 3 d
34 cp1250_czech_cs cp1250 1 1
35 ucs2_general_ci ucs2 2 2 d
36 cp866_general_ci cp866 1 1 d
37 keybcs2_general_ci keybcs2 1 1 d
38 macce_general_ci macce 1 1 d
39 macroman_general_ci macroman 1 1 d
40 cp852_general_ci cp852 1 1 d
41 latin7_general_ci latin7 1 1 d
42 latin7_general_cs latin7 1 1
43 macce_bin macce 1 1 b
44 cp1250_croatian_ci cp1250 1 1
45 utf8mb4_general_ci utf8mb4 1 4
46 utf8mb4_bin utf8mb4 1 4 b
47 latin1_bin latin1 1 1 b
48 latin1_general_ci latin1 1 1
49 latin1_general_cs latin1 1 1
50 cp1251_bin cp1251 1 1 b
51 cp1251_general_ci cp1251 1 1 d
52 cp1251_general_cs cp1251 1 1
53 macroman_bin macroman 1 1 b
54 utf16_general_ci utf16 2 4 d
55 utf16_bin utf16 2 4 b
56 utf16le_general_ci utf16le 2 4 d
57 cp1256_general_ci cp1256 1 1 d
58 cp1257_bin cp1257 1 1 b
59 cp1257_general_ci cp1257 1 1 d
60 utf32_general_ci utf32 4 4 d
61 utf32_bin utf32 4 4 b
62 utf16le_bin utf16le 2 4 b
63 binary binary 1 1 ndb
64 armscii8_bin armscii8 1 1 b
65 ascii_bin ascii 1 1 b
66 cp1250_bin cp1250 1 1 b
67 cp1256_bin cp1256 1 1 b
68 cp866_bin cp866 1 1 b
69 dec8_bin dec8 1 1 b
70 greek_bin greek 1 1 b
71 hebrew_bin hebrew 1 1 b
72 hp8_bin hp8 1 1 b
73 keybcs2_bin keybcs2 1 1 b
74 koi8r_bin koi8r 1 1 b
75 koi8u_bin koi8u 1 1 b
76 utf8mb3_tolower_ci utf8mb3 1 3
77 latin2_bin latin2 1 1 b
78 latin5_bin latin5 1 1 b
79 latin7_bin latin7 1 1 b
80 cp850_bin cp850 1 1 b
81 cp852_bin cp852 1 1 b
82 swe7_bin swe7 1 1 b
83 utf8mb3_bin utf8mb3 1 3 b
84 big5_bin big5 1 2 b
85 euckr_bin euckr 1 2 b
86 gb2312_bin gb2312 1 2 b
87 gbk_bin gbk 1 2 b
88 sjis_bin sjis 1 2 b
89 tis620_bin tis620 1 1 b
90 ucs2_bin ucs2 2 2 b
91 ujis_bin ujis 1 3 b
92 geostd8_general_ci geostd8 1 1 d
93 geostd8_bin geostd8 1 1 b
94 latin1_spanish_ci latin1 1 1
95 cp932_japanese_ci cp932 1 2 d
96 cp932_bin cp932 1 2 b
97 eucjpms_japanese_ci eucjpms 1 3 d
98 eucjpms_bin eucjpms 1 3 b
99 cp1250_polish_ci cp1250 1 1
101 utf16_unicode_ci utf16 2 4
102 utf16_icelandic_ci utf16 2 4
103 utf16_latvian_ci utf16 2 4
104 utf16_romanian_ci utf16 2 4
105 utf16_slovenian_ci utf16 2 4
106 utf16_polish_ci utf16 2 4
107 utf16_estonian_ci utf16 2 4
108 utf16_spanish_ci utf16 2 4
109 utf16_swedish_ci utf16 2 4
110 utf16_turkish_ci utf16 2 4
111 utf16_czech_ci utf16 2 4
112 utf16_danish_ci utf16 2 4
113 utf16_lithuanian_ci utf16 2 4
114 utf16_slovak_ci utf16 2 4
115 utf16_spanish2_ci utf16 2 4
116 utf16_roman_ci utf16 2 4
117 utf16_persian_ci utf16 2 4
118 utf16_esperanto_ci utf16 2 4
119 utf16_hungarian_ci utf16 2 4
120 utf16_sinhala_ci utf16 2 4
121 utf16_german2_ci utf16 2 4
122 utf16_croatian_ci utf16 2 4
123 utf16_unicode_520_ci utf16 2 4
124 utf16_vietnamese_ci utf16 2 4
128 ucs2_unicode_ci ucs2 2 2
129 ucs2_icelandic_ci ucs2 2 2
130 ucs2_latvian_ci ucs2 2 2
131 ucs2_romanian_ci ucs2 2 2
132 ucs2_slovenian_ci ucs2 2 2
133 ucs2_polish_ci ucs2 2 2
134 ucs2_estonian_ci ucs2 2 2
135 ucs2_spanish_ci ucs2 2 2
136 ucs2_swedish_ci ucs2 2 2
137 ucs2_turkish_ci ucs2 2 2
138 ucs2_czech_ci ucs2 2 2
139 ucs2_danish_ci ucs2 2 2
140 ucs2_lithuanian_ci ucs2 2 2
141 ucs2_slovak_ci ucs2 2 2
142 ucs2_spanish2_ci ucs2 2 2
143 ucs2_roman_ci ucs2 2 2
144 ucs2_persian_ci ucs2 2 2
145 ucs2_esperanto_ci ucs2 2 2
146 ucs2_hungarian_ci ucs2 2 2
147 ucs2_sinhala_ci ucs2 2 2
148 ucs2_german2_ci ucs2 2 2
149 ucs2_croatian_ci ucs2 2 2
150 ucs2_unicode_520_ci ucs2 2 2
151 ucs2_vietnamese_ci ucs2 2 2
159 ucs2_general_mysql500_ci ucs2 2 2
160 utf32_unicode_ci utf32 4 4
161 utf32_icelandic_ci utf32 4 4
162 utf32_latvian_ci utf32 4 4
163 utf32_romanian_ci utf32 4 4
164 utf32_slovenian_ci utf32 4 4
165 utf32_polish_ci utf32 4 4
166 utf32_estonian_ci utf32 4 4
167 utf32_spanish_ci utf32 4 4
168 utf32_swedish_ci utf32 4 4
169 utf32_turkish_ci utf32 4 4
170 utf32_czech_ci utf32 4 4
171 utf32_danish_ci utf32 4 4
172 utf32_lithuanian_ci utf32 4 4
173 utf32_slovak_ci utf32 4 4
174 utf32_spanish2_ci utf32 4 4
175 utf32_roman_ci utf32 4 4
176 utf32_persian_ci utf32 4 4
177 utf32_esperanto_ci utf32 4 4
178 utf32_hungarian_ci utf32 4 4
179 utf32_sinhala_ci utf32 4 4
180 utf32_german2_ci utf32 4 4
181 utf32_croatian_ci utf32 4 4
182 utf32_unicode_520_ci utf32 4 4
183 utf32_vietnamese_ci utf32 4 4
192 utf8mb3_unicode_ci utf8mb3 1 3
193 utf8mb3_icelandic_ci utf8mb3 1 3
194 utf8mb3_latvian_ci utf8mb3 1 3
195 utf8mb3_romanian_ci utf8mb3 1 3
196 utf8mb3_slovenian_ci utf8mb3 1 3
197 utf8mb3_polish_ci utf8mb3 1 3
198 utf8mb3_estonian_ci utf8mb3 1 3
199 utf8mb3_spanish_ci utf8mb3 1 3
200 utf8mb3_swedish_ci utf8mb3 1 3
201 utf8mb3_turkish_ci utf8mb3 1 3
202 utf8mb3_czech_ci utf8mb3 1 3
203 utf8mb3_danish_ci utf8mb3 1 3
204 utf8mb3_lithuanian_ci utf8mb3 1 3
205 utf8mb3_slovak_ci utf8mb3 1 3
206 utf8mb3_spanish2_ci utf8mb3 1 3
207 utf8mb3_roman_ci utf8mb3 1 3
208 utf8mb3_persian_ci utf8mb3 1 3
209 utf8mb3_esperanto_ci utf8mb3 1 3
210 utf8mb3_hungarian_ci utf8mb3 1 3
211 utf8mb3_sinhala_ci utf8mb3 1 3
212 utf8mb3_german2_ci utf8mb3 1 3
213 utf8mb3_croatian_ci utf8mb3 1 3
214 utf8mb3_unicode_520_ci utf8mb3 1 3
215 utf8mb3_vietnamese_ci utf8mb3 1 3
223 utf8mb3_general_mysql500_ci utf8mb3 1 3
224 utf8mb4_unicode_ci utf8mb4 1 4
225 utf8mb4_icelandic_ci utf8mb4 1 4
226 utf8mb4_latvian_ci utf8mb4 1 4
227 utf8mb4_romanian_ci utf8mb4 1 4
228 utf8mb4_slovenian_ci utf8mb4 1 4
229 utf8mb4_polish_ci utf8mb4 1 4
230 utf8mb4_estonian_ci utf8mb4 1 4
231 utf8mb4_spanish_ci utf8mb4 1 4
232 utf8mb4_swedish_ci utf8mb4 1 4
233 utf8mb4_turkish_ci utf8mb4 1 4
234 utf8mb4_czech_ci utf8mb4 1 4
235 utf8mb4_danish_ci utf8mb4 1 4
236 utf8mb4_lithuanian_ci utf8mb4 1 4
237 utf8mb4_slovak_ci utf8mb4 1 4
238 utf8mb4_spanish2_ci utf8mb4 1 4
239 utf8mb4_roman_ci utf8mb4 1 4
240 utf8mb4_persian_ci utf8mb4 1 4
241 utf8mb4_esperanto_ci utf8mb4 1 4
242 utf8mb4_hungarian_ci utf8mb4 1 4
243 utf8mb4_sinhala_ci utf8mb4 1 4
244 utf8mb4_german2_ci utf8mb4 1 4
245 utf8mb4_croatian_ci utf8mb4 1 4
246 utf8mb4_unicode_520_ci utf8mb4 1 4
247 utf8mb4_vietnamese_ci utf8mb4 1 4
248 gb18030_chinese_ci gb18030 1 4 d
249 gb18030_bin gb18030 1 4 b
250 gb18030_unicode_520_ci gb18030 1 4
255 utf8mb4_0900_ai_ci utf8mb4 1 4 nd
256 utf8mb4_de_pb_0900_ai_ci utf8mb4 1 4 n
257 utf8mb4_is_0900_ai_ci utf8mb4 1 4 n
258 utf8mb4_lv_0900_ai_ci utf8mb4 1 4 n
259 utf8mb4_ro_0900_ai_ci utf8mb4 1 4 n
260 utf8mb4_sl_0900_ai_ci utf8mb4 1 4 n
261 utf8mb4_pl_0900_ai_ci utf8mb4 1 4 n
262 utf8mb4_et_0900_ai_ci utf8mb4 1 4 n
263 utf8mb4_es_0900_ai_ci utf8mb4 1 4 n
264 utf8mb4_sv_0900_ai_ci utf8mb4 1 4 n
265 utf8mb4_tr_0900_ai_ci utf8mb4 1 4 n
266 utf8mb4_cs_0900_ai_ci utf8mb4 1 4 n
267 utf8mb4_da_0900_ai_ci utf8mb4 1 4 n
268 utf8mb4_lt_0900_ai_ci utf8mb4 1 4 n
269 utf8mb4_sk_0900_ai_ci utf8mb4 1 4 n
270 utf8mb4_es_trad_0900_ai_ci utf8mb4 1 4 n
271 utf8mb4_la_0900_ai_ci utf8mb4 1 4 n
272 utf8mb4_fa_0900_ai_ci utf8mb4 1 4 n
273 utf8mb4_eo_0900_ai_ci utf8mb4 1 4 n
274 utf8mb4_hu_0900_ai_ci utf8mb4 1 4 n
275 utf8mb4_hr_0900_ai_ci utf8mb4 1 4 n
276 utf8mb4_si_0900_ai_ci utf8mb4 1 4 n
277 utf8mb4_vi_0900_ai_ci utf8mb4 1 4 n
278 utf8mb4_0900_as_cs utf8mb4 1 4 n
279 utf8mb4_de_pb_0900_as_cs utf8mb4 1 4 n
280 utf8mb4_is_0900_as_cs utf8mb4 1 4 n
281 utf8mb4_lv_0900_as_cs utf8mb4 1 4 n
282 utf8mb4_ro_0900_as_cs utf8mb4 1 4 n
283 utf8mb4_sl_0900_as_cs utf8mb4 1 4 n
284 utf8mb4_pl_0900_as_cs utf8mb4 1 4 n
285 utf8mb4_et_0900_as_cs utf8mb4 1 4 n
286 utf8mb4_es_0900_as_cs utf8mb4 1 4 n
287 utf8mb4_sv_0900_as_cs utf8mb4 1 4 n
288 utf8mb4_tr_0900_as_cs utf8mb4 1 4 n
289 utf8mb4_cs_0900_as_cs utf8mb4 1 4 n
290 utf8mb4_da_0900_as_cs utf8mb4 1 4 n
291 utf8mb4_lt_0900_as_cs utf8mb4 1 4 n
292 utf8mb4_sk_0900_as_cs utf8mb4 1 4 n
293 utf8mb4_es_trad_0900_as_cs utf8mb4 1 4 n
294 utf8mb4_la_0900_as_cs utf8mb4 1 4 n
295 utf8mb4_fa_0900_as_cs utf8mb4 1 4 n
296 utf8mb4_eo_0900_as_cs utf8mb4 1 4 n
297 utf8mb4_hu_0900_as_cs utf8mb4 1 4 n
298 utf8mb4_hr_0900_as_cs utf8mb4 1 4 n
299 utf8mb4_si_0900_as_cs utf8mb4 1 4 n
300 utf8mb4_vi_0900_as_cs utf8mb4 1 4 n
303 utf8mb4_ja_0900_as_cs utf8mb4 1 4 n
304 utf8mb4_ja_0900_as_cs_ks utf8mb4 1 4 n
305 utf8mb4_0900_as_ci utf8mb4 1 4 n
306 utf8mb4_ru_0900_ai_ci utf8mb4 1 4 n
307 utf8mb4_ru_0900_as_cs utf8mb4 1 4 n
308 utf8mb4_zh_0900_as_cs utf8mb4 1 4 n
309 utf8mb4_0900_bin utf8mb4 1 4 nb
310 utf8mb4_nb_0900_ai_ci utf8mb4 1 4 n
311 utf8mb4_nb_0900_as_cs utf8mb4 1 4 n
312 utf8mb4_nn_0900_ai_ci utf8mb4 1 4 n
313 utf8mb4_nn_0900_as_cs utf8mb4 1 4 n
314 utf8mb4_sr_latn_0900_ai_ci utf8mb4 1 4 n
315 utf8mb4_sr_latn_0900_as_cs utf8mb4 1 4 n
316 utf8mb4_bs_0900_ai_ci utf8mb4 1 4 n
317 utf8mb4_bs_0900_as_cs utf8mb4 1 4 n
318 utf8mb4_bg_0900_ai_ci utf8mb4 1 4 n
319 utf8mb4_bg_0900_as_cs utf8mb4 1 4 n
320 utf8mb4_gl_0900_ai_ci utf8mb4 1 4 n
321 utf8mb4_gl_0900_as_cs utf8mb4 1 4 n
322 utf8mb4_mn_cyrl_0900_ai_ci utf8mb4 1 4 n
323 utf8mb4_mn_cyrl_0900_as_cs utf8mb4 1 4 n`

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
