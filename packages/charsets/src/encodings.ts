// GENERATED FILE — do not edit by hand. Run `npm run gen:charsets`.
//
// B0 / M2.3: byte -> code point tables for the single-byte charsets, read
// out of each `CHARSET_INFO`'s own `tab_to_uni` field.
//
// These replace `TextDecoder` for every charset listed here, because trusting it
// was a real bug: on a runtime without full ICU, `new TextDecoder('windows-1252')`
// succeeds and silently behaves as ISO-8859-1, so MySQL's latin1 decoded 0x80 to
// U+0080 rather than the euro sign and no error was raised anywhere.
//
// Format: `<charset> <256 code points>`, delta-plus-run against the byte value
// itself — the same codec and the same `expandRuns` decoder the weight tables
// use. The ASCII half of every one of these tables is identity, so it collapses
// to a single run.
//
// `tis620` is deliberately absent: MySQL leaves its struct's `tab_to_uni` null
// and reads the table through a custom handler, so it stays on `TextDecoder`.
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
// Single-byte charsets: 24
// Left on TextDecoder: binary tis620

/** SHA-256 over every source file's own hash — the same value the registry carries. */
export const ENCODING_TABLE_SOURCE_SHA256 =
  '037f18f34aac7c6d3eed67a3d3763202ab89824c8972627f96364fbe052aa473'

/**
 * `charset code-points`, one single-byte charset per line.
 *
 * Delta-plus-run, the same codec `collations/weights.ts` uses.
 */
export const PACKED_CHARSET_TO_UNI = `armscii8 161*0,26a0,5,4e6,-7b,-7d,15,4,1f6c,-7b,4b3,2*-7f,4b2,1f78,4ad,4ab,4ad,47f,4ae,47e,4ad,47d,4ac,47c,4ab,47b,4aa,47a,4a9,479,4a8,478,4a7,477,4a6,476,4a5,475,4a4,474,4a3,473,4a2,472,4a1,471,4a0,470,49f,46f,49e,46e,49d,46d,49c,46c,49b,46b,49a,46a,499,469,498,468,497,467,496,466,495,465,494,464,493,463,492,462,491,461,490,460,48f,45f,48e,45e,48d,45d,48c,45c,48b,45b,48a,45a,489,1f1b,-d8
ascii 128*0,-80,-81,-82,-83,-84,-85,-86,-87,-88,-89,-8a,-8b,-8c,-8d,-8e,-8f,-90,-91,-92,-93,-94,-95,-96,-97,-98,-99,-9a,-9b,-9c,-9d,-9e,-9f,-a0,-a1,-a2,-a3,-a4,-a5,-a6,-a7,-a8,-a9,-aa,-ab,-ac,-ad,-ae,-af,-b0,-b1,-b2,-b3,-b4,-b5,-b6,-b7,-b8,-b9,-ba,-bb,-bc,-bd,-be,-bf,-c0,-c1,-c2,-c3,-c4,-c5,-c6,-c7,-c8,-c9,-ca,-cb,-cc,-cd,-ce,-cf,-d0,-d1,-d2,-d3,-d4,-d5,-d6,-d7,-d8,-d9,-da,-db,-dc,-dd,-de,-df,-e0,-e1,-e2,-e3,-e4,-e5,-e6,-e7,-e8,-e9,-ea,-eb,-ec,-ed,-ee,-ef,-f0,-f1,-f2,-f3,-f4,-f5,-f6,-f7,-f8,-f9,-fa,-fb,-fc,-fd,-fe,-ff
cp1250 128*0,202c,-81,1f98,-83,1f9a,1fa1,2*1f9a,-88,1fa7,d6,1fae,ce,d7,ef,ea,-90,2*1f87,2*1f89,1f8d,2*1f7d,-98,2089,c7,1f9f,bf,c8,e0,db,0,226,236,9e,0,5f,4*0,b4,4*0,cc,2*0,229,8f,5*0,4c,a5,0,81,220,80,bd,94,2*0,3f,0,74,40,0,44,0,4e,0,4e,2*0,3f,40,72,75,2*0,7b,2*0,80,95,0,95,2*0,84,0,75,2*0,20,0,55,21,0,25,0,2f,0,2f,2*0,20,21,53,56,2*0,5c,2*0,61,76,0,76,2*0,65,1da
cp1251 128*0,2*382,1f98,3d0,1f9a,1fa1,2*1f9a,2024,1fa7,37f,1fae,37e,37f,37d,380,3c2,2*1f87,2*1f89,1f8d,2*1f7d,-98,2089,3bf,1f9f,3be,3bf,3bd,3c0,0,36d,3bc,365,0,3eb,2*0,359,0,35a,4*0,358,2*0,354,3a3,3dd,3*0,399,205d,39a,0,39c,348,397,398,64*350
cp1256 128*0,202c,5fd,1f98,10f,1f9a,1fa1,2*1f9a,23e,1fa7,-8a,1fae,c6,5f9,60a,-8f,61f,2*1f87,2*1f89,1f8d,2*1f7d,-98,2089,-9a,1f9f,b7,2*1f6f,-9f,0,56b,8*0,-aa,15*0,561,4*0,560,-c0,22*560,0,4*55f,4*564,0,563,0,4*562,5*0,2*55d,2*0,4*55b,0,2*55a,0,559,0,558,2*0,2*1f11,-ff
cp1257 128*0,202c,-81,1f98,-83,1f9a,1fa1,2*1f9a,-88,1fa7,-8a,1fae,-8c,1b,239,29,-90,2*1f87,2*1f89,1f8d,2*1f7d,-98,2089,-9a,1f9f,-9c,12,23d,-9f,0,-a1,3*0,-a5,2*0,30,0,ac,4*0,17,8*0,40,0,9d,4*0,27,44,6d,3e,43,2*0,52,4b,44,0,af,4b,56,69,5c,6c,90,72,73,0,78,3*0,9a,68,80,8f,0,9e,9f,0,25,4e,1f,24,2*0,33,2c,25,0,90,2c,37,4a,3d,4d,71,53,54,0,59,3*0,7b,49,61,70,0,7f,80,1da
cp850 128*0,47,7b,67,5f,60,5b,5f,60,2*62,5e,64,62,5f,2*36,39,55,34,61,62,5d,65,62,67,3d,42,5d,7,3b,39,f3,41,4c,51,57,4d,2c,4,13,17,5,2,12,10,-c,-3,c,3*24e1,244f,2470,2*c,9,-f,24aa,2497,249c,24a1,-1b,-19,2451,2454,2473,246a,2459,243c,2477,1d,-4,2492,248b,249f,249b,2494,2483,249e,-2b,20,-1,2*-8,-c,5c,3*-9,243f,2432,24ad,24a8,-37,-12,24a1,-d,-2,-e,-11,11,-10,-31,17,-a,2*-f,-12,11,-10,-3f,-3b,-43,-40,1f25,-35,-3e,-4e,1,-3f,-48,-51,-43,-42,-49,-4b,24a2,-5f
cp852 128*0,47,7b,67,5f,60,ea,81,60,ba,62,2*c6,62,ec,36,77,39,2*a8,61,62,2*a8,2*c3,3d,42,2*c9,a4,39,6e,41,4c,51,57,2*60,2*d7,2*70,2,cf,60,b2,-3,c,3*24e1,244f,2470,2*c,63,a6,24aa,2497,249c,24a1,2*be,2451,2454,2473,246a,2459,243c,2477,2*3c,2492,248b,249f,249b,2494,2483,249e,-2b,41,3f,3c,-8,3b,72,2*-9,43,243f,2432,24ad,24a8,85,90,24a1,-d,-2,-e,2*60,63,2*7a,6c,-f,6b,85,11,-10,75,-3b,-43,1ec,1e9,1d4,1e4,-4e,1,-3f,-48,-51,1df,76,2*5c,24a2,-5f
cp866 128*0,48*390,3*24e1,244f,2470,2*24ac,249f,249d,24aa,2497,249c,24a1,249f,249d,2451,2454,2473,246a,2459,243c,2477,2*2498,2492,248b,249f,249b,2494,2483,249e,2*2498,2*2493,2486,2484,2*247d,2494,2492,243f,2432,24ad,24a8,24af,24b2,24a1,16*360,311,360,312,361,313,362,318,367,-48,2120,-43,211f,1f83,-4b,24a2,-5f
dec8 164*0,-a4,0,-a6,0,-4,3*0,-ac,-ad,-ae,-af,4*0,-b4,3*0,-b8,5*0,-be,17*0,-d0,6*0,7b,5*0,9b,-de,17*0,-f0,6*0,5c,5*0,2,-fe,-ff
geostd8 128*0,202c,-81,1f98,-83,1f9a,1fa1,2*1f9a,-88,1fa7,-8a,1fae,-8c,-8d,-8e,-8f,-90,2*1f87,2*1f89,1f8d,2*1f7d,-98,-99,-9a,1f9f,-9c,-9d,-9e,-9f,32*0,7*1010,102a,6*100f,1024,6*100e,101e,12*100d,1012,2*100c,1010,-e6,-e7,-e8,-e9,-ea,-eb,-ec,-ed,-ee,-ef,-f0,-f1,-f2,-f3,-f4,-f5,-f6,-f7,-f8,-f9,-fa,-fb,-fc,2019,-fe,-ff
greek 161*0,21c,21a,0,-a4,-a5,4*0,-aa,3*0,-ae,1f66,4*0,3*2d0,0,3*2d0,0,2d0,0,20*2d0,-d2,44*2d0,-ff
hebrew 161*0,-a1,8*0,2d,4*0,1f8f,10*0,3d,4*0,-bf,-c0,-c1,-c2,-c3,-c4,-c5,-c6,-c7,-c8,-c9,-ca,-cb,-cc,-cd,-ce,-cf,-d0,-d1,-d2,-d3,-d4,-d5,-d6,-d7,-d8,-d9,-da,-db,-dc,-dd,-de,1f38,27*4f0,-fb,-fc,2*1f11,-ff
hp8 161*0,1f,20,25,2*26,2*28,c,222,21c,-3,230,2c,2d,1ff5,-1,2c,4b,-3,13,32,1b,3a,-17,6,-16,-18,-17,-16,d4,-1d,22,29,32,38,1d,24,2d,33,18,1f,28,2e,18,1e,28,2d,-b,1d,6,-d,11,18,22,f,-14,13,-4,1,-13,12,1,-b,-1f,-1e,1,-13,c,-18,-1a,-14,-16,-14,b,2*75,-13,8a,10,-12,d,-3b,2*-3e,-37,1f1e,2*-3b,-4f,-40,-50,24a4,-42,-4d,-ff
keybcs2 128*0,8c,7b,67,8c,60,89,de,86,93,91,af,42,b2,ad,36,32,39,ed,eb,61,62,3e,d9,43,65,3d,42,c5,a1,40,ba,c6,41,4c,51,57,a4,a2,c8,2d,b9,b0,ab,a9,10,-c,-3,c,3*24e1,244f,2470,2*24ac,249f,249d,24aa,2497,249c,24a1,249f,249d,2451,2454,2473,246a,2459,243c,2477,2*2498,2492,248b,249f,249b,2494,2483,249e,2*2498,2*2493,2486,2484,2*247d,2494,2492,243f,2432,24ad,24a8,24af,24b2,24a1,2d1,-2,2b1,2dd,2bf,2de,-31,2dd,2be,2af,2bf,2c9,2132,2d9,2c7,213a,2171,-40,2173,2171,2*222c,1,2151,-48,2120,-43,211f,1f83,-4b,24a2,-5f
koi8r 128*0,2480,2481,248a,248d,2490,2493,2496,249d,24a4,24ab,24b2,24f5,24f8,24fb,24fe,4*2501,228d,250c,2*2184,21b1,2*21cc,6,2286,14,15,19,58,3*24b0,3ae,15*24af,34e,11*24ae,-16,38e,2*36f,383,2*370,37e,36c,37d,8*36f,37e,4*36e,360,35b,374,372,35d,36d,371,36c,369,36b,34e,2*32f,343,2*330,33e,32c,33d,8*32f,33e,4*32e,320,31b,334,332,31d,32d,331,32c,329,32b
koi8u 128*0,2480,2481,248a,248d,2490,2493,2496,249d,24a4,24ab,24b2,24f5,24f8,24fb,24fe,4*2501,228d,250c,1f8d,2184,21b1,2*21cc,6,2286,14,15,19,58,3*24b0,3ae,3b0,24af,2*3b0,5*24af,3e4,5*24af,34e,350,24ae,2*350,5*24ae,3d3,24ae,-16,38e,2*36f,383,2*370,37e,36c,37d,8*36f,37e,4*36e,360,35b,374,372,35d,36d,371,36c,369,36b,34e,2*32f,343,2*330,33e,32c,33d,8*32f,33e,4*32e,320,31b,334,332,31d,32d,331,32c,329,32b
latin1 128*0,202c,0,1f98,10f,1f9a,1fa1,2*1f9a,23e,1fa7,d6,1fae,c6,0,ef,2*0,2*1f87,2*1f89,1f8d,2*1f7d,244,2089,c7,1f9f,b7,0,e0,d9,96*0
latin2 161*0,63,236,9e,0,98,b4,2*0,b7,b4,b9,cd,0,cf,cc,0,54,229,8f,0,89,a5,210,0,a8,a5,aa,be,220,c0,bd,94,2*0,3f,0,74,40,0,44,0,4e,0,4e,2*0,3f,40,72,75,2*0,7b,2*0,80,95,0,95,2*0,84,0,75,2*0,20,0,55,21,0,25,0,2f,0,2f,2*0,20,21,53,56,2*0,5c,2*0,61,76,0,76,2*0,65,1da
latin5 208*0,4e,12*0,53,80,17*0,2f,12*0,34,61,0
latin7 161*0,1f7c,3*0,1f79,2*0,30,0,ac,4*0,17,4*0,1f68,3*0,40,0,9d,4*0,27,44,6d,3e,43,2*0,52,4b,44,0,af,4b,56,69,5c,6c,90,72,73,0,78,3*0,9a,68,80,8f,0,9e,9f,0,25,4e,1f,24,2*0,33,2c,25,0,90,2c,37,4a,3d,4d,71,53,54,0,59,3*0,7b,49,61,70,0,7f,80,1f1a
macce 128*0,44,2*7f,46,80,51,56,5a,7d,83,5a,82,2*7a,5b,2*ea,7d,5b,7c,2*7e,80,5c,7f,5b,5c,5a,5e,2*7d,5d,1f80,f,76,0,3,1f7d,10,38,6,0,2078,6e,-4,21b3,75,2*7f,79,2*21b2,77,81,214c,215a,8a,4*82,2*7c,2*86,82,-16,2157,80,82,2140,-1c,-d,1f5d,-2a,7d,84,8,83,7d,2*1f43,2*1f4a,2*1f44,21,24f3,75,2*7b,7d,2*1f5d,7b,2*77,7f,1f38,1f3b,7d,2*75,-26,2*7c,-1d,2*92,7d,2*-1b,7b,7d,-18,5*7c,-1b,4,3d,80,45,7f,24,1c8
macroman 128*0,2*44,45,46,4d,51,56,5a,58,59,5a,58,59,5a,5b,59,2*5a,5b,59,2*5a,5b,5c,5a,5b,5c,5a,5e,5c,2*5d,1f80,f,2*0,3,1f7d,10,38,6,0,2078,9,-4,21b3,18,29,216e,0,2*21b2,-f,0,214c,215a,2157,307,2171,-11,-2,2ec,28,39,-1,-20,-16,2157,ce,2183,2140,-1c,-d,1f5d,-2a,-b,-9,8,2*84,2*1f43,2*1f4a,2*1f44,21,24f3,27,9f,1f6a,1fd1,2*1f5d,2*fa23,1f41,-2a,1f38,1f3b,1f4c,-23,-1c,-26,-1d,-21,3*-1d,-21,2*-1b,f80f,-1f,2*-18,-1b,3c,1d0,1e5,-49,3*1df,-44,1e0,1dd,1c8
swe7 64*0,89,26*0,69,7a,68,7e,0,89,26*0,69,7a,68,7e,-7f,-80,-81,-82,-83,-84,-85,-86,-87,-88,-89,-8a,-8b,-8c,-8d,-8e,-8f,-90,-91,-92,-93,-94,-95,-96,-97,-98,-99,-9a,-9b,-9c,-9d,-9e,-9f,-a0,-a1,-a2,-a3,-a4,-a5,-a6,-a7,-a8,-a9,-aa,-ab,-ac,-ad,-ae,-af,-b0,-b1,-b2,-b3,-b4,-b5,-b6,-b7,-b8,-b9,-ba,-bb,-bc,-bd,-be,-bf,-c0,-c1,-c2,-c3,-c4,-c5,-c6,-c7,-c8,-c9,-ca,-cb,-cc,-cd,-ce,-cf,-d0,-d1,-d2,-d3,-d4,-d5,-d6,-d7,-d8,-d9,-da,-db,-dc,-dd,-de,-df,-e0,-e1,-e2,-e3,-e4,-e5,-e6,-e7,-e8,-e9,-ea,-eb,-ec,-ed,-ee,-ef,-f0,-f1,-f2,-f3,-f4,-f5,-f6,-f7,-f8,-f9,-fa,-fb,-fc,-fd,-fe,-ff`
