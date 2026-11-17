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
// Format: `<charset> <runs for 256 code points>`. Relative runs are the same
// as the weight tables. `[count]=` encodes absolute zeroes. An identity span can
// fit in one relative run. Some charsets, such as swe7, remap ASCII bytes.
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

import { relativeTables } from './runs.ts'

/** SHA-256 over every source file's own hash — the same value the registry carries. */
export const ENCODING_TABLE_SOURCE_SHA256 =
  '037f18f34aac7c6d3eed67a3d3763202ab89824c8972627f96364fbe052aa473'

/**
 * `charset code-points`, one single-byte charset per line.
 *
 * Delta-plus-run with additional zero runs. Internal values are base 36.
 */
export const CHARSET_ENCODING_RUNS = `armscii8 161*0,7mo,5,yu,-3f,-3h,l,4,67g,-3f,xf,2*-3j,xe,67s,x9,x7,x9,vz,xa,vy,x9,vx,x8,vw,x7,vv,x6,vu,x5,vt,x4,vs,x3,vr,x2,vq,x1,vp,x0,vo,wz,vn,wy,vm,wx,vl,ww,vk,wv,vj,wu,vi,wt,vh,ws,vg,wr,vf,wq,ve,wp,vd,wo,vc,wn,vb,wm,va,wl,v9,wk,v8,wj,v7,wi,v6,wh,v5,wg,v4,wf,v3,we,v2,wd,v1,wc,v0,wb,uz,wa,uy,w9,657,-60
ascii 128*0,128=
cp1250 128*0,6cs,=,68o,=,68q,68x,2*68q,=,693,5y,69a,5q,5z,6n,6i,=,2*687,2*689,68d,2*67x,=,6fd,5j,68v,5b,5k,68,63,0,fa,fq,4e,0,2n,4*0,50,4*0,5o,2*0,fd,3z,5*0,24,4l,0,3l,f4,3k,59,44,2*0,1r,0,38,1s,0,1w,0,26,0,26,2*0,1r,1s,36,39,2*0,3f,2*0,3k,45,0,45,2*0,3o,0,39,2*0,w,0,2d,x,0,11,0,1b,0,1b,2*0,w,x,2b,2e,2*0,2k,2*0,2p,3a,0,3a,2*0,2t,d6
cp1251 128*0,2*oy,68o,r4,68q,68x,2*68q,6ck,693,ov,69a,ou,ov,ot,ow,qq,2*687,2*689,68d,2*67x,=,6fd,qn,68v,qm,qn,ql,qo,0,od,qk,o5,0,rv,2*0,nt,0,nu,4*0,ns,2*0,no,pv,rh,3*0,pl,6e5,pm,0,po,nc,pj,pk,64*nk
cp1256 128*0,6cs,16l,68o,7j,68q,68x,2*68q,fy,693,=,69a,5i,16h,16y,=,17j,2*687,2*689,68d,2*67x,=,6fd,=,68v,53,2*67j,=,0,12j,8*0,=,15*0,129,4*0,128,=,22*128,0,4*127,4*12c,0,12b,0,4*12a,5*0,2*125,2*0,4*123,0,2*122,0,121,0,120,2*0,2*64x,=
cp1257 128*0,6cs,=,68o,=,68q,68x,2*68q,=,693,=,69a,=,r,ft,15,=,2*687,2*689,68d,2*67x,=,6fd,=,68v,=,i,fx,=,0,=,3*0,=,2*0,1c,0,4s,4*0,n,8*0,1s,0,4d,4*0,13,1w,31,1q,1v,2*0,2a,23,1w,0,4v,23,2e,2x,2k,30,40,36,37,0,3c,3*0,4a,2w,3k,3z,0,4e,4f,0,11,26,v,10,2*0,1f,18,11,0,40,18,1j,22,1p,25,35,2b,2c,0,2h,3*0,3f,21,2p,34,0,3j,3k,d6
cp850 128*0,1z,3f,2v,2n,2o,2j,2n,2o,2*2q,2m,2s,2q,2n,2*1i,1l,2d,1g,2p,2q,2l,2t,2q,2v,1p,1u,2l,7,1n,1l,6r,1t,24,29,2f,25,18,4,j,n,5,2,i,g,-c,-3,c,3*7a9,767,774,2*c,9,-f,78q,787,78c,78h,-r,-p,769,76c,777,76y,76h,75o,77b,t,-4,782,77v,78f,78b,784,77n,78e,-17,w,-1,2*-8,-c,2k,3*-9,75r,75e,78t,78o,-1j,-i,78h,-d,-2,-e,-h,h,-g,-1d,n,-a,2*-f,-i,h,-g,-1r,-1n,-1v,-1s,65h,-1h,-1q,-26,1,-1r,-20,-29,-1v,-1u,-21,-23,78i,-2n
cp852 128*0,1z,3f,2v,2n,2o,6i,3l,2o,56,2q,2*5i,2q,6k,1i,3b,1l,2*4o,2p,2q,2*4o,2*5f,1p,1u,2*5l,4k,1l,32,1t,24,29,2f,2*2o,2*5z,2*34,2,5r,2o,4y,-3,c,3*7a9,767,774,2*c,2r,4m,78q,787,78c,78h,2*5a,769,76c,777,76y,76h,75o,77b,2*1o,782,77v,78f,78b,784,77n,78e,-17,1t,1r,1o,-8,1n,36,2*-9,1v,75r,75e,78t,78o,3p,40,78h,-d,-2,-e,2*2o,2r,2*3e,30,-f,2z,3p,h,-g,39,-1n,-1v,do,dl,d0,dg,-26,1,-1r,-20,-29,db,3a,2*2k,78i,-2n
cp866 128*0,48*pc,3*7a9,767,774,2*78s,78f,78d,78q,787,78c,78h,78f,78d,769,76c,777,76y,76h,75o,77b,2*788,782,77v,78f,78b,784,77n,78e,2*788,2*783,77q,77o,2*77h,784,782,75r,75e,78t,78o,78v,78y,78h,16*o0,lt,o0,lu,o1,lv,o2,m0,o7,-20,6jk,-1v,6jj,683,-23,78i,-2n
dec8 164*0,=,0,=,0,-4,3*0,4=,4*0,=,3*0,=,5*0,=,17*0,=,6*0,3f,5*0,4b,=,17*0,=,6*0,2k,5*0,2,2=
geostd8 128*0,6cs,=,68o,=,68q,68x,2*68q,=,693,=,69a,5=,2*687,2*689,68d,2*67x,3=,68v,4=,32*0,7*368,36y,6*367,36s,6*366,36m,12*365,36a,2*364,368,23=,6c9,2=
greek 161*0,f0,ey,0,2=,4*0,=,3*0,=,67a,4*0,3*k0,0,3*k0,0,k0,0,20*k0,=,44*k0,=
hebrew 161*0,=,8*0,19,4*0,68f,10*0,1p,4*0,32=,660,27*z4,2=,2*64x,=
hp8 161*0,v,w,11,2*12,2*14,c,f6,f0,-3,fk,18,19,6b9,-1,18,23,-3,j,1e,r,1m,-n,6,-m,-o,-n,-m,5w,-t,y,15,1e,1k,t,10,19,1f,o,v,14,1a,o,u,14,19,-b,t,6,-d,h,o,y,f,-k,j,-4,1,-j,i,1,-b,-v,-u,1,-j,c,-o,-q,-k,-m,-k,b,2*39,-j,3u,g,-i,d,-1n,2*-1q,-1j,65a,2*-1n,-27,-1s,-28,78k,-1u,-25,=
keybcs2 128*0,3w,3f,2v,3w,2o,3t,66,3q,43,41,4v,1u,4y,4t,1i,1e,1l,6l,6j,2p,2q,1q,61,1v,2t,1p,1u,5h,4h,1s,56,5i,1t,24,29,2f,4k,4i,5k,19,55,4w,4r,4p,g,-c,-3,c,3*7a9,767,774,2*78s,78f,78d,78q,787,78c,78h,78f,78d,769,76c,777,76y,76h,75o,77b,2*788,782,77v,78f,78b,784,77n,78e,2*788,2*783,77q,77o,2*77h,784,782,75r,75e,78t,78o,78v,78y,78h,k1,-2,j5,kd,jj,ke,-1d,kd,ji,j3,jj,jt,6k2,k9,jr,6ka,6lt,-1s,6lv,6lt,2*6r0,1,6kx,-20,6jk,-1v,6jj,683,-23,78i,-2n
koi8r 128*0,77k,77l,77u,77x,780,783,786,78d,78k,78r,78y,7at,7aw,7az,7b2,4*7b5,6tp,7bg,2*6mc,6nl,2*6oc,6,6ti,k,l,p,2g,3*78w,q6,15*78v,ni,11*78u,-m,pa,2*of,oz,2*og,ou,oc,ot,8*of,ou,4*oe,o0,nv,ok,oi,nx,od,oh,oc,o9,ob,ni,2*mn,n7,2*mo,n2,mk,n1,8*mn,n2,4*mm,m8,m3,ms,mq,m5,ml,mp,mk,mh,mj
koi8u 128*0,77k,77l,77u,77x,780,783,786,78d,78k,78r,78y,7at,7aw,7az,7b2,4*7b5,6tp,7bg,68d,6mc,6nl,2*6oc,6,6ti,k,l,p,2g,3*78w,q6,q8,78v,2*q8,5*78v,ro,5*78v,ni,nk,78u,2*nk,5*78u,r7,78u,-m,pa,2*of,oz,2*og,ou,oc,ot,8*of,ou,4*oe,o0,nv,ok,oi,nx,od,oh,oc,o9,ob,ni,2*mn,n7,2*mo,n2,mk,n1,8*mn,n2,4*mm,m8,m3,ms,mq,m5,ml,mp,mk,mh,mj
latin1 128*0,6cs,0,68o,7j,68q,68x,2*68q,fy,693,5y,69a,5i,0,6n,2*0,2*687,2*689,68d,2*67x,g4,6fd,5j,68v,53,0,68,61,96*0
latin2 161*0,2r,fq,4e,0,48,50,2*0,53,50,55,5p,0,5r,5o,0,2c,fd,3z,0,3t,4l,eo,0,4o,4l,4q,5a,f4,5c,59,44,2*0,1r,0,38,1s,0,1w,0,26,0,26,2*0,1r,1s,36,39,2*0,3f,2*0,3k,45,0,45,2*0,3o,0,39,2*0,w,0,2d,x,0,11,0,1b,0,1b,2*0,w,x,2b,2e,2*0,2k,2*0,2p,3a,0,3a,2*0,2t,d6
latin5 208*0,26,12*0,2b,3k,17*0,1b,12*0,1g,2p,0
latin7 161*0,67w,3*0,67t,2*0,1c,0,4s,4*0,n,4*0,67c,3*0,1s,0,4d,4*0,13,1w,31,1q,1v,2*0,2a,23,1w,0,4v,23,2e,2x,2k,30,40,36,37,0,3c,3*0,4a,2w,3k,3z,0,4e,4f,0,11,26,v,10,2*0,1f,18,11,0,40,18,1j,22,1p,25,35,2b,2c,0,2h,3*0,3f,21,2p,34,0,3j,3k,656
macce 128*0,1w,2*3j,1y,3k,29,2e,2i,3h,3n,2i,3m,2*3e,2j,2*6i,3h,2j,3g,2*3i,3k,2k,3j,2j,2k,2i,2m,2*3h,2l,680,f,3a,0,3,67x,g,1k,6,0,6ew,32,-4,6nn,39,2*3j,3d,2*6nm,3b,3l,6ks,6l6,3u,4*3m,2*3g,2*3q,3m,-m,6l3,3k,3m,6kg,-s,-d,671,-16,3h,3o,8,3n,3h,2*66b,2*66i,2*66c,x,7ar,39,2*3f,3h,2*671,3f,2*3b,3j,660,663,3h,2*39,-12,2*3g,-t,2*42,3h,2*-r,3f,3h,-o,5*3g,-r,4,1p,3k,1x,3j,10,co
macroman 128*0,2*1w,1x,1y,25,29,2e,2i,2g,2h,2i,2g,2h,2i,2j,2h,2*2i,2j,2h,2*2i,2j,2k,2i,2j,2k,2i,2m,2k,2*2l,680,f,2*0,3,67x,g,1k,6,0,6ew,9,-4,6nn,o,15,6lq,0,2*6nm,-f,0,6ks,6l6,6l3,lj,6lt,-h,-2,ks,14,1l,-1,-w,-m,6l3,5q,6mb,6kg,-s,-d,671,-16,-b,-9,8,2*3o,2*66b,2*66i,2*66c,x,7ar,13,4f,67e,6a9,2*671,2*1der,669,-16,660,663,66k,-z,-s,-12,-t,-x,3*-t,-x,2*-r,1czz,-v,2*-o,-r,1o,cw,dh,-21,3*db,-1w,dc,d9,co
swe7 64*0,3t,26*0,2x,3e,2w,3i,0,3t,26*0,2x,3e,2w,3i,129=`

/** The public code-point tables in their original delta format and literal type. */
export const PACKED_CHARSET_TO_UNI = /* @__PURE__ */ relativeTables(CHARSET_ENCODING_RUNS) as `armscii8 161*0,26a0,5,4e6,-7b,-7d,15,4,1f6c,-7b,4b3,2*-7f,4b2,1f78,4ad,4ab,4ad,47f,4ae,47e,4ad,47d,4ac,47c,4ab,47b,4aa,47a,4a9,479,4a8,478,4a7,477,4a6,476,4a5,475,4a4,474,4a3,473,4a2,472,4a1,471,4a0,470,49f,46f,49e,46e,49d,46d,49c,46c,49b,46b,49a,46a,499,469,498,468,497,467,496,466,495,465,494,464,493,463,492,462,491,461,490,460,48f,45f,48e,45e,48d,45d,48c,45c,48b,45b,48a,45a,489,1f1b,-d8
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
