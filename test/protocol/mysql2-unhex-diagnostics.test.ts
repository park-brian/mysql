// Own SQL inputs and complete pinned MySQL 8.4.11 outcomes. Printer, raw message caps and wide metadata remain separate measured gaps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const m0 = [["x",8,10,128,0,63,"","","",""]]
const m1 = [["x",253,32,0,31,224,"","","",""]]
const m2 = [["x",253,0,128,31,63,"","","",""]]
const m3 = [["x",253,4,128,31,63,"","","",""]]
const m4 = [["x",253,2,128,31,63,"","","",""]]
const m5 = [["x",253,8,128,31,63,"","","",""]]
const m6 = [["x",253,6,128,31,63,"","","",""]]
const m7 = [["x",253,1,128,31,63,"","","",""]]
const m8 = [["x",253,3,128,31,63,"","","",""]]
const m9 = [["x",253,252,128,31,63,"","","",""]]
const m10 = [["x",253,124,128,31,63,"","","",""]]
const m11 = [["x",253,126,128,31,63,"","","",""]]
const m12 = [["x",253,6000,128,31,63,"","","",""]]
const m13 = [["x",253,2000,128,31,63,"","","",""]]
const m14 = [["UNHEX(b)",253,6000,128,31,63,"","","",""]]
const m15 = [["UNHEX(b)",253,6000,128,31,63,"","","",""],["UNHEX(b)",253,6000,128,31,63,"","","",""]]
const m16 = [["IF(0,UNHEX(b),NULL)",253,6000,128,31,63,"","","",""]]
const m17 = [["IF(1,UNHEX(b),NULL)",253,6000,128,31,63,"","","",""]]
const m18 = [["UNHEX(CONCAT(b))",253,6000,128,31,63,"","","",""]]
const m19 = [["UNHEX(CONCAT(b))",253,6000,128,31,63,"","","",""],["UNHEX(CONCAT(b))",253,6000,128,31,63,"","","",""]]
const m20 = [["IF(0,UNHEX(CONCAT(b)),NULL)",253,6000,128,31,63,"","","",""]]
const m21 = [["IF(1,UNHEX(CONCAT(b)),NULL)",253,6000,128,31,63,"","","",""]]
const o0 = [[[null]],m0,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_byte_reader61`.`t`.`b`' for function unhex"}]]
const o1 = [[[null]],m1,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_byte_reader61`.`t`.`b`' for function unhex"}]]
const o2 = [[[null]],m0,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_byte_reader61`.`t`.`b`)' for function unhex"}]]
const o3 = [[[null]],m1,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_byte_reader61`.`t`.`b`)' for function unhex"}]]
const o4 = [[[2]],m0,[]]
const o5 = [[["0410"]],m1,[]]
const o6 = [[["0411"]],m1,[]]
const o7 = [[["0412"]],m1,[]]
const o8 = [[["0413"]],m1,[]]
const o9 = [[["0414"]],m1,[]]
const o10 = [[["0415"]],m1,[]]
const o11 = [[["0416"]],m1,[]]
const o12 = [[["0417"]],m1,[]]
const o13 = [[["0418"]],m1,[]]
const o14 = [[["0419"]],m1,[]]
const o15 = [[["041A"]],m1,[]]
const o16 = [[["041B"]],m1,[]]
const o17 = [[["041C"]],m1,[]]
const o18 = [[["041D"]],m1,[]]
const o19 = [[["041E"]],m1,[]]
const o20 = [[["041F"]],m1,[]]
const o21 = [[[0]],m0,[]]
const o22 = [[[""]],m1,[]]
const o23 = [[[512]],m0,[]]
const o24 = [[["41414141"]],m1,[]]
const o25 = [[[513]],m0,[]]
const o26 = [[[100000]],m0,[]]
const o27 = [[[100001]],m0,[]]
const o28 = [[["04444444"]],m1,[]]
const o29 = [[["44444444"]],m1,[]]
const o30 = [[[null]],m0,[]]
const o31 = [[[null]],m1,[]]
const o32 = [[[{"type":"Buffer","data":[]}]],m2,[]]
const o33 = [[[{"type":"Buffer","data":[65]}]],m3,[]]
const o34 = [[[{"type":"Buffer","data":[15]}]],m4,[]]
const o35 = [[[null]],m3,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''GG'' for function unhex"}]]
const o36 = [[[null]],m5,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''0x41'' for function unhex"}]]
const o37 = [[[null]],m6,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''41 '' for function unhex"}]]
const o38 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''é'' for function unhex"}]]
const o39 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''€'' for function unhex"}]]
const o40 = [[[null]],m7,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '_binary'GG'' for function unhex"}]]
const o41 = [[[null]],m7,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '_latin1'GG'' for function unhex"}]]
const o42 = [[[null]],m3,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '_utf8mb4'GG'' for function unhex"}]]
const o43 = [[[null]],m7,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0xff' for function unhex"}]]
const o44 = [[[{"type":"Buffer","data":[1,35]}]],m4,[]]
const o45 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '-(123)' for function unhex"}]]
const o46 = [[[null]],m8,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '1.25' for function unhex"}]]
const o47 = [[[null]],m2,[]]
const o48 = [[[null]],m3,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat('4','G')' for function unhex"}]]
const o49 = [[[null]],m3,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'lower('GG')' for function unhex"}]]
const o50 = [[[null]],m3,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'if(1,'GG','41')' for function unhex"}]]
const o51 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343100' for function unhex"}]]
const o52 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343101' for function unhex"}]]
const o53 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343102' for function unhex"}]]
const o54 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343103' for function unhex"}]]
const o55 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343104' for function unhex"}]]
const o56 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343105' for function unhex"}]]
const o57 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343106' for function unhex"}]]
const o58 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343107' for function unhex"}]]
const o59 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343108' for function unhex"}]]
const o60 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343109' for function unhex"}]]
const o61 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34310a' for function unhex"}]]
const o62 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34310b' for function unhex"}]]
const o63 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34310c' for function unhex"}]]
const o64 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34310d' for function unhex"}]]
const o65 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34310e' for function unhex"}]]
const o66 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34310f' for function unhex"}]]
const o67 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343110' for function unhex"}]]
const o68 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343111' for function unhex"}]]
const o69 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343112' for function unhex"}]]
const o70 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343113' for function unhex"}]]
const o71 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343114' for function unhex"}]]
const o72 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343115' for function unhex"}]]
const o73 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343116' for function unhex"}]]
const o74 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343117' for function unhex"}]]
const o75 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343118' for function unhex"}]]
const o76 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343119' for function unhex"}]]
const o77 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34311a' for function unhex"}]]
const o78 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34311b' for function unhex"}]]
const o79 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34311c' for function unhex"}]]
const o80 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34311d' for function unhex"}]]
const o81 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34311e' for function unhex"}]]
const o82 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34311f' for function unhex"}]]
const o83 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343120' for function unhex"}]]
const o84 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343121' for function unhex"}]]
const o85 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343122' for function unhex"}]]
const o86 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343123' for function unhex"}]]
const o87 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343124' for function unhex"}]]
const o88 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343125' for function unhex"}]]
const o89 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343126' for function unhex"}]]
const o90 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343127' for function unhex"}]]
const o91 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343128' for function unhex"}]]
const o92 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343129' for function unhex"}]]
const o93 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34312a' for function unhex"}]]
const o94 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34312b' for function unhex"}]]
const o95 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34312c' for function unhex"}]]
const o96 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34312d' for function unhex"}]]
const o97 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34312e' for function unhex"}]]
const o98 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34312f' for function unhex"}]]
const o99 = [[[{"type":"Buffer","data":[4,16]}]],m4,[]]
const o100 = [[[{"type":"Buffer","data":[4,17]}]],m4,[]]
const o101 = [[[{"type":"Buffer","data":[4,18]}]],m4,[]]
const o102 = [[[{"type":"Buffer","data":[4,19]}]],m4,[]]
const o103 = [[[{"type":"Buffer","data":[4,20]}]],m4,[]]
const o104 = [[[{"type":"Buffer","data":[4,21]}]],m4,[]]
const o105 = [[[{"type":"Buffer","data":[4,22]}]],m4,[]]
const o106 = [[[{"type":"Buffer","data":[4,23]}]],m4,[]]
const o107 = [[[{"type":"Buffer","data":[4,24]}]],m4,[]]
const o108 = [[[{"type":"Buffer","data":[4,25]}]],m4,[]]
const o109 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34313a' for function unhex"}]]
const o110 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34313b' for function unhex"}]]
const o111 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34313c' for function unhex"}]]
const o112 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34313d' for function unhex"}]]
const o113 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34313e' for function unhex"}]]
const o114 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34313f' for function unhex"}]]
const o115 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343140' for function unhex"}]]
const o116 = [[[{"type":"Buffer","data":[4,26]}]],m4,[]]
const o117 = [[[{"type":"Buffer","data":[4,27]}]],m4,[]]
const o118 = [[[{"type":"Buffer","data":[4,28]}]],m4,[]]
const o119 = [[[{"type":"Buffer","data":[4,29]}]],m4,[]]
const o120 = [[[{"type":"Buffer","data":[4,30]}]],m4,[]]
const o121 = [[[{"type":"Buffer","data":[4,31]}]],m4,[]]
const o122 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343147' for function unhex"}]]
const o123 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343148' for function unhex"}]]
const o124 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343149' for function unhex"}]]
const o125 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34314a' for function unhex"}]]
const o126 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34314b' for function unhex"}]]
const o127 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34314c' for function unhex"}]]
const o128 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34314d' for function unhex"}]]
const o129 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34314e' for function unhex"}]]
const o130 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34314f' for function unhex"}]]
const o131 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343150' for function unhex"}]]
const o132 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343151' for function unhex"}]]
const o133 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343152' for function unhex"}]]
const o134 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343153' for function unhex"}]]
const o135 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343154' for function unhex"}]]
const o136 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343155' for function unhex"}]]
const o137 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343156' for function unhex"}]]
const o138 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343157' for function unhex"}]]
const o139 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343158' for function unhex"}]]
const o140 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343159' for function unhex"}]]
const o141 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34315a' for function unhex"}]]
const o142 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34315b' for function unhex"}]]
const o143 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34315c' for function unhex"}]]
const o144 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34315d' for function unhex"}]]
const o145 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34315e' for function unhex"}]]
const o146 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34315f' for function unhex"}]]
const o147 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343160' for function unhex"}]]
const o148 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343167' for function unhex"}]]
const o149 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343168' for function unhex"}]]
const o150 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343169' for function unhex"}]]
const o151 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34316a' for function unhex"}]]
const o152 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34316b' for function unhex"}]]
const o153 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34316c' for function unhex"}]]
const o154 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34316d' for function unhex"}]]
const o155 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34316e' for function unhex"}]]
const o156 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34316f' for function unhex"}]]
const o157 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343170' for function unhex"}]]
const o158 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343171' for function unhex"}]]
const o159 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343172' for function unhex"}]]
const o160 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343173' for function unhex"}]]
const o161 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343174' for function unhex"}]]
const o162 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343175' for function unhex"}]]
const o163 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343176' for function unhex"}]]
const o164 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343177' for function unhex"}]]
const o165 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343178' for function unhex"}]]
const o166 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343179' for function unhex"}]]
const o167 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34317a' for function unhex"}]]
const o168 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34317b' for function unhex"}]]
const o169 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34317c' for function unhex"}]]
const o170 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34317d' for function unhex"}]]
const o171 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34317e' for function unhex"}]]
const o172 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34317f' for function unhex"}]]
const o173 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343180' for function unhex"}]]
const o174 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343181' for function unhex"}]]
const o175 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343182' for function unhex"}]]
const o176 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343183' for function unhex"}]]
const o177 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343184' for function unhex"}]]
const o178 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343185' for function unhex"}]]
const o179 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343186' for function unhex"}]]
const o180 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343187' for function unhex"}]]
const o181 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343188' for function unhex"}]]
const o182 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343189' for function unhex"}]]
const o183 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34318a' for function unhex"}]]
const o184 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34318b' for function unhex"}]]
const o185 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34318c' for function unhex"}]]
const o186 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34318d' for function unhex"}]]
const o187 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34318e' for function unhex"}]]
const o188 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34318f' for function unhex"}]]
const o189 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343190' for function unhex"}]]
const o190 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343191' for function unhex"}]]
const o191 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343192' for function unhex"}]]
const o192 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343193' for function unhex"}]]
const o193 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343194' for function unhex"}]]
const o194 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343195' for function unhex"}]]
const o195 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343196' for function unhex"}]]
const o196 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343197' for function unhex"}]]
const o197 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343198' for function unhex"}]]
const o198 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x343199' for function unhex"}]]
const o199 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34319a' for function unhex"}]]
const o200 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34319b' for function unhex"}]]
const o201 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34319c' for function unhex"}]]
const o202 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34319d' for function unhex"}]]
const o203 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34319e' for function unhex"}]]
const o204 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x34319f' for function unhex"}]]
const o205 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a0' for function unhex"}]]
const o206 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a1' for function unhex"}]]
const o207 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a2' for function unhex"}]]
const o208 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a3' for function unhex"}]]
const o209 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a4' for function unhex"}]]
const o210 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a5' for function unhex"}]]
const o211 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a6' for function unhex"}]]
const o212 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a7' for function unhex"}]]
const o213 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a8' for function unhex"}]]
const o214 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431a9' for function unhex"}]]
const o215 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431aa' for function unhex"}]]
const o216 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ab' for function unhex"}]]
const o217 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ac' for function unhex"}]]
const o218 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ad' for function unhex"}]]
const o219 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ae' for function unhex"}]]
const o220 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431af' for function unhex"}]]
const o221 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b0' for function unhex"}]]
const o222 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b1' for function unhex"}]]
const o223 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b2' for function unhex"}]]
const o224 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b3' for function unhex"}]]
const o225 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b4' for function unhex"}]]
const o226 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b5' for function unhex"}]]
const o227 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b6' for function unhex"}]]
const o228 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b7' for function unhex"}]]
const o229 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b8' for function unhex"}]]
const o230 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431b9' for function unhex"}]]
const o231 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ba' for function unhex"}]]
const o232 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431bb' for function unhex"}]]
const o233 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431bc' for function unhex"}]]
const o234 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431bd' for function unhex"}]]
const o235 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431be' for function unhex"}]]
const o236 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431bf' for function unhex"}]]
const o237 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c0' for function unhex"}]]
const o238 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c1' for function unhex"}]]
const o239 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c2' for function unhex"}]]
const o240 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c3' for function unhex"}]]
const o241 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c4' for function unhex"}]]
const o242 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c5' for function unhex"}]]
const o243 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c6' for function unhex"}]]
const o244 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c7' for function unhex"}]]
const o245 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c8' for function unhex"}]]
const o246 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431c9' for function unhex"}]]
const o247 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ca' for function unhex"}]]
const o248 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431cb' for function unhex"}]]
const o249 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431cc' for function unhex"}]]
const o250 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431cd' for function unhex"}]]
const o251 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ce' for function unhex"}]]
const o252 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431cf' for function unhex"}]]
const o253 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d0' for function unhex"}]]
const o254 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d1' for function unhex"}]]
const o255 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d2' for function unhex"}]]
const o256 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d3' for function unhex"}]]
const o257 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d4' for function unhex"}]]
const o258 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d5' for function unhex"}]]
const o259 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d6' for function unhex"}]]
const o260 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d7' for function unhex"}]]
const o261 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d8' for function unhex"}]]
const o262 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431d9' for function unhex"}]]
const o263 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431da' for function unhex"}]]
const o264 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431db' for function unhex"}]]
const o265 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431dc' for function unhex"}]]
const o266 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431dd' for function unhex"}]]
const o267 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431de' for function unhex"}]]
const o268 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431df' for function unhex"}]]
const o269 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e0' for function unhex"}]]
const o270 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e1' for function unhex"}]]
const o271 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e2' for function unhex"}]]
const o272 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e3' for function unhex"}]]
const o273 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e4' for function unhex"}]]
const o274 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e5' for function unhex"}]]
const o275 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e6' for function unhex"}]]
const o276 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e7' for function unhex"}]]
const o277 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e8' for function unhex"}]]
const o278 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431e9' for function unhex"}]]
const o279 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ea' for function unhex"}]]
const o280 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431eb' for function unhex"}]]
const o281 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ec' for function unhex"}]]
const o282 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ed' for function unhex"}]]
const o283 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ee' for function unhex"}]]
const o284 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ef' for function unhex"}]]
const o285 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f0' for function unhex"}]]
const o286 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f1' for function unhex"}]]
const o287 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f2' for function unhex"}]]
const o288 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f3' for function unhex"}]]
const o289 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f4' for function unhex"}]]
const o290 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f5' for function unhex"}]]
const o291 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f6' for function unhex"}]]
const o292 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f7' for function unhex"}]]
const o293 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f8' for function unhex"}]]
const o294 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431f9' for function unhex"}]]
const o295 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431fa' for function unhex"}]]
const o296 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431fb' for function unhex"}]]
const o297 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431fc' for function unhex"}]]
const o298 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431fd' for function unhex"}]]
const o299 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431fe' for function unhex"}]]
const o300 = [[[null]],m4,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '0x3431ff' for function unhex"}]]
const o301 = [[[null]],m9,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'' for function unhex"}]]
const o302 = [[[null]],m10,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé'' for function unhex"}]]
const o303 = [[[null]],m11,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé'' for function unhex"}]]
const o304 = [[[null]],m6,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''G\tG'' for function unhex"}]]
const o305 = [[[null]],m6,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''G\bG'' for function unhex"}]]
const o306 = [[[null]],m6,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''G\\\\G'' for function unhex"}]]
const o307 = [[[null]],m6,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''G\\'G'' for function unhex"}]]
const o308 = [[[{"type":"Buffer","data":[65]}]],m12,[]]
const o309 = [[{"x":{"type":"Buffer","data":[65]}}],m12,[]]
const o310 = [[[null]],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"}]]
const o311 = [[{"x":null}],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"}]]
const o312 = [[[{"type":"Buffer","data":[65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65]}]],m12,[]]
const o313 = [[{"x":{"type":"Buffer","data":[65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65,65]}}],m12,[]]
const o314 = [[[{"type":"Buffer","data":[]}]],m12,[]]
const o315 = [[{"x":{"type":"Buffer","data":[]}}],m12,[]]
const o316 = [[[null]],m12,[]]
const o317 = [[{"x":null}],m12,[]]
const o318 = [[["x",253,6000,128,31,63,"","","",""]],[]]
const o319 = [[[null]],m13,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`s`' for function unhex"}]]
const o320 = [[{"x":null}],m13,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`s`' for function unhex"}]]
const o321 = [[[{"type":"Buffer","data":[65]}]],m13,[]]
const o322 = [[{"x":{"type":"Buffer","data":[65]}}],m13,[]]
const o323 = [[[null]],m13,[]]
const o324 = [[{"x":null}],m13,[]]
const o325 = [[["x",253,2000,128,31,63,"","","",""]],[]]
const o326 = [[[null]],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"}]]
const o327 = [[{"x":null}],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"}]]
const o328 = [[[null]],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'if((`unhex_warnings71`.`t`.`g` = 1),`unhex_warnings71`.`t`.`b`,`unhex_warnings71`.`t`.`s`)' for function unhex"}]]
const o329 = [[{"x":null}],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'if((`unhex_warnings71`.`t`.`g` = 1),`unhex_warnings71`.`t`.`b`,`unhex_warnings71`.`t`.`s`)' for function unhex"}]]
const o330 = [[[null]],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'nullif(`unhex_warnings71`.`t`.`b`,`unhex_warnings71`.`t`.`s`)' for function unhex"}]]
const o331 = [[{"x":null}],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'nullif(`unhex_warnings71`.`t`.`b`,`unhex_warnings71`.`t`.`s`)' for function unhex"}]]
const o332 = [[[null]],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'coalesce(`unhex_warnings71`.`t`.`b`,`unhex_warnings71`.`t`.`s`)' for function unhex"}]]
const o333 = [[{"x":null}],m12,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'coalesce(`unhex_warnings71`.`t`.`b`,`unhex_warnings71`.`t`.`s`)' for function unhex"}]]
const o334 = [[[null],[null],[null]],m14,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"}]]
const o335 = [[[null,null],[null,null],[null,null]],m15,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"}]]
const o336 = [[[null],[null],[null]],m16,[]]
const o337 = [[[null],[null],[null]],m17,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '`unhex_warnings71`.`t`.`b`' for function unhex"}]]
const o338 = [[[null],[null],[null]],m18,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"}]]
const o339 = [[[null,null],[null,null],[null,null]],m19,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"}]]
const o340 = [[[null],[null],[null]],m20,[]]
const o341 = [[[null],[null],[null]],m21,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"},{"Level":"Warning","Code":1411,"Message":"Incorrect string value: 'concat(`unhex_warnings71`.`t`.`b`)' for function unhex"}]]
const o342 = [[[null]],m0,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''GG'' for function unhex"}]]
const o343 = [[[null]],m0,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '?' for function unhex"}]]
const o344 = [[{"x":null}],m0,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: '?' for function unhex"}]]
const o345 = [[[1]],m0,[]]
const o346 = [[{"x":1}],m0,[]]
const o347 = [[{"x":null}],m0,[]]
const o348 = [[[null]],m0,[{"Level":"Warning","Code":1411,"Message":"Incorrect string value: ''41\\\\0F'' for function unhex"}]]
const o349 = [[["x",8,10,128,0,63,"","","",""]],[]]

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

async function outcome(conn: mysql.Connection, sql: string, method: 'query' | 'execute') {
  const options = { sql, rowsAsArray: true }
  try {
    const [rows, columns] = await (method === 'query' ? conn.query(options) : conn.execute(options))
    const warnings = (await conn.query('SHOW WARNINGS'))[0]
    return [JSON.parse(JSON.stringify(rows)), fields(columns as mysql.FieldPacket[]), warnings]
  } catch (caught) {
    const error = caught as { errno: number; sqlState: string; message: string }
    return { error: [error.errno, error.sqlState, error.message] }
  }
}

test('UNHEX invalid byte inputs warn through complete readers without changing values or fields', async () => {
  const { db, conn } = await connect()
  const values = [...Array.from({length:256},(_,i)=>Buffer.from([0x34,0x31,i])),Buffer.from(''),Buffer.from('41'.repeat(512)),Buffer.from('41'.repeat(513)),Buffer.from('41'.repeat(100000)),Buffer.from('4'.repeat(200001)),Buffer.from('41'.repeat(100000)+'x'),null]
  const sources = ['b','CONCAT(b)']
  const expressions = ['LENGTH(UNHEX($))','HEX(SUBSTRING(UNHEX($),1,4))','HEX(RIGHT(UNHEX($),4))']
  const fixtures: unknown[][] = [
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o4,o5,o5,o4,o5,o5],
    [o4,o6,o6,o4,o6,o6],
    [o4,o7,o7,o4,o7,o7],
    [o4,o8,o8,o4,o8,o8],
    [o4,o9,o9,o4,o9,o9],
    [o4,o10,o10,o4,o10,o10],
    [o4,o11,o11,o4,o11,o11],
    [o4,o12,o12,o4,o12,o12],
    [o4,o13,o13,o4,o13,o13],
    [o4,o14,o14,o4,o14,o14],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o4,o15,o15,o4,o15,o15],
    [o4,o16,o16,o4,o16,o16],
    [o4,o17,o17,o4,o17,o17],
    [o4,o18,o18,o4,o18,o18],
    [o4,o19,o19,o4,o19,o19],
    [o4,o20,o20,o4,o20,o20],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o4,o15,o15,o4,o15,o15],
    [o4,o16,o16,o4,o16,o16],
    [o4,o17,o17,o4,o17,o17],
    [o4,o18,o18,o4,o18,o18],
    [o4,o19,o19,o4,o19,o19],
    [o4,o20,o20,o4,o20,o20],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o0,o1,o1,o2,o3,o3],
    [o21,o22,o22,o21,o22,o22],
    [o23,o24,o24,o23,o24,o24],
    [o25,o24,o24,o25,o24,o24],
    [o26,o24,o24,o26,o24,o24],
    [o27,o28,o29,o27,o28,o29],
    [o0,o1,o1,o2,o3,o3],
    [o30,o31,o31,o30,o31,o31],
  ]
  try {
    await conn.query('CREATE DATABASE unhex_byte_reader61')
    await conn.query('USE unhex_byte_reader61')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB)')
    for (const [id,value] of values.entries()) await conn.query('INSERT INTO t VALUES(?,?)',[id,value])
    for (const [id,expected] of fixtures.entries()) {
      let index = 0
      for (const source of sources) for (const expression of expressions) {
        const sql = 'SELECT '+expression.replaceAll('$',source)+' AS x FROM t WHERE id='+id
        for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[index],method+': '+sql)
        index++
        conn.unprepare({sql,rowsAsArray:true})
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS unhex_byte_reader61')
    await conn.end()
    await db?.end()
  }
})

test('UNHEX diagnostics retain verified SQL argument spelling and NULL controls', async () => {
  const { db, conn } = await connect()
  const fixtures: [string,unknown[]][] = [
    ["SELECT UNHEX('') AS x",o32],
    ["SELECT UNHEX('41') AS x",o33],
    ["SELECT UNHEX('F') AS x",o34],
    ["SELECT UNHEX('GG') AS x",o35],
    ["SELECT UNHEX('0x41') AS x",o36],
    ["SELECT UNHEX('41 ') AS x",o37],
    ["SELECT UNHEX('é') AS x",o38],
    ["SELECT UNHEX('€') AS x",o39],
    ["SELECT UNHEX(_binary'GG') AS x",o40],
    ["SELECT UNHEX(_latin1'GG') AS x",o41],
    ["SELECT UNHEX(_utf8mb4'GG') AS x",o42],
    ["SELECT UNHEX(X'FF') AS x",o43],
    ["SELECT UNHEX(123) AS x",o44],
    ["SELECT UNHEX(-123) AS x",o45],
    ["SELECT UNHEX(1.25) AS x",o46],
    ["SELECT UNHEX(NULL) AS x",o47],
    ["SELECT UNHEX(CONCAT('4','G')) AS x",o48],
    ["SELECT UNHEX(LOWER('GG')) AS x",o49],
    ["SELECT UNHEX(IF(1,'GG','41')) AS x",o50],
    ["SELECT UNHEX(IF(0,'GG','41')) AS x",o33],
    ["SELECT UNHEX(X'343100') AS x",o51],
    ["SELECT UNHEX(X'343101') AS x",o52],
    ["SELECT UNHEX(X'343102') AS x",o53],
    ["SELECT UNHEX(X'343103') AS x",o54],
    ["SELECT UNHEX(X'343104') AS x",o55],
    ["SELECT UNHEX(X'343105') AS x",o56],
    ["SELECT UNHEX(X'343106') AS x",o57],
    ["SELECT UNHEX(X'343107') AS x",o58],
    ["SELECT UNHEX(X'343108') AS x",o59],
    ["SELECT UNHEX(X'343109') AS x",o60],
    ["SELECT UNHEX(X'34310a') AS x",o61],
    ["SELECT UNHEX(X'34310b') AS x",o62],
    ["SELECT UNHEX(X'34310c') AS x",o63],
    ["SELECT UNHEX(X'34310d') AS x",o64],
    ["SELECT UNHEX(X'34310e') AS x",o65],
    ["SELECT UNHEX(X'34310f') AS x",o66],
    ["SELECT UNHEX(X'343110') AS x",o67],
    ["SELECT UNHEX(X'343111') AS x",o68],
    ["SELECT UNHEX(X'343112') AS x",o69],
    ["SELECT UNHEX(X'343113') AS x",o70],
    ["SELECT UNHEX(X'343114') AS x",o71],
    ["SELECT UNHEX(X'343115') AS x",o72],
    ["SELECT UNHEX(X'343116') AS x",o73],
    ["SELECT UNHEX(X'343117') AS x",o74],
    ["SELECT UNHEX(X'343118') AS x",o75],
    ["SELECT UNHEX(X'343119') AS x",o76],
    ["SELECT UNHEX(X'34311a') AS x",o77],
    ["SELECT UNHEX(X'34311b') AS x",o78],
    ["SELECT UNHEX(X'34311c') AS x",o79],
    ["SELECT UNHEX(X'34311d') AS x",o80],
    ["SELECT UNHEX(X'34311e') AS x",o81],
    ["SELECT UNHEX(X'34311f') AS x",o82],
    ["SELECT UNHEX(X'343120') AS x",o83],
    ["SELECT UNHEX(X'343121') AS x",o84],
    ["SELECT UNHEX(X'343122') AS x",o85],
    ["SELECT UNHEX(X'343123') AS x",o86],
    ["SELECT UNHEX(X'343124') AS x",o87],
    ["SELECT UNHEX(X'343125') AS x",o88],
    ["SELECT UNHEX(X'343126') AS x",o89],
    ["SELECT UNHEX(X'343127') AS x",o90],
    ["SELECT UNHEX(X'343128') AS x",o91],
    ["SELECT UNHEX(X'343129') AS x",o92],
    ["SELECT UNHEX(X'34312a') AS x",o93],
    ["SELECT UNHEX(X'34312b') AS x",o94],
    ["SELECT UNHEX(X'34312c') AS x",o95],
    ["SELECT UNHEX(X'34312d') AS x",o96],
    ["SELECT UNHEX(X'34312e') AS x",o97],
    ["SELECT UNHEX(X'34312f') AS x",o98],
    ["SELECT UNHEX(X'343130') AS x",o99],
    ["SELECT UNHEX(X'343131') AS x",o100],
    ["SELECT UNHEX(X'343132') AS x",o101],
    ["SELECT UNHEX(X'343133') AS x",o102],
    ["SELECT UNHEX(X'343134') AS x",o103],
    ["SELECT UNHEX(X'343135') AS x",o104],
    ["SELECT UNHEX(X'343136') AS x",o105],
    ["SELECT UNHEX(X'343137') AS x",o106],
    ["SELECT UNHEX(X'343138') AS x",o107],
    ["SELECT UNHEX(X'343139') AS x",o108],
    ["SELECT UNHEX(X'34313a') AS x",o109],
    ["SELECT UNHEX(X'34313b') AS x",o110],
    ["SELECT UNHEX(X'34313c') AS x",o111],
    ["SELECT UNHEX(X'34313d') AS x",o112],
    ["SELECT UNHEX(X'34313e') AS x",o113],
    ["SELECT UNHEX(X'34313f') AS x",o114],
    ["SELECT UNHEX(X'343140') AS x",o115],
    ["SELECT UNHEX(X'343141') AS x",o116],
    ["SELECT UNHEX(X'343142') AS x",o117],
    ["SELECT UNHEX(X'343143') AS x",o118],
    ["SELECT UNHEX(X'343144') AS x",o119],
    ["SELECT UNHEX(X'343145') AS x",o120],
    ["SELECT UNHEX(X'343146') AS x",o121],
    ["SELECT UNHEX(X'343147') AS x",o122],
    ["SELECT UNHEX(X'343148') AS x",o123],
    ["SELECT UNHEX(X'343149') AS x",o124],
    ["SELECT UNHEX(X'34314a') AS x",o125],
    ["SELECT UNHEX(X'34314b') AS x",o126],
    ["SELECT UNHEX(X'34314c') AS x",o127],
    ["SELECT UNHEX(X'34314d') AS x",o128],
    ["SELECT UNHEX(X'34314e') AS x",o129],
    ["SELECT UNHEX(X'34314f') AS x",o130],
    ["SELECT UNHEX(X'343150') AS x",o131],
    ["SELECT UNHEX(X'343151') AS x",o132],
    ["SELECT UNHEX(X'343152') AS x",o133],
    ["SELECT UNHEX(X'343153') AS x",o134],
    ["SELECT UNHEX(X'343154') AS x",o135],
    ["SELECT UNHEX(X'343155') AS x",o136],
    ["SELECT UNHEX(X'343156') AS x",o137],
    ["SELECT UNHEX(X'343157') AS x",o138],
    ["SELECT UNHEX(X'343158') AS x",o139],
    ["SELECT UNHEX(X'343159') AS x",o140],
    ["SELECT UNHEX(X'34315a') AS x",o141],
    ["SELECT UNHEX(X'34315b') AS x",o142],
    ["SELECT UNHEX(X'34315c') AS x",o143],
    ["SELECT UNHEX(X'34315d') AS x",o144],
    ["SELECT UNHEX(X'34315e') AS x",o145],
    ["SELECT UNHEX(X'34315f') AS x",o146],
    ["SELECT UNHEX(X'343160') AS x",o147],
    ["SELECT UNHEX(X'343161') AS x",o116],
    ["SELECT UNHEX(X'343162') AS x",o117],
    ["SELECT UNHEX(X'343163') AS x",o118],
    ["SELECT UNHEX(X'343164') AS x",o119],
    ["SELECT UNHEX(X'343165') AS x",o120],
    ["SELECT UNHEX(X'343166') AS x",o121],
    ["SELECT UNHEX(X'343167') AS x",o148],
    ["SELECT UNHEX(X'343168') AS x",o149],
    ["SELECT UNHEX(X'343169') AS x",o150],
    ["SELECT UNHEX(X'34316a') AS x",o151],
    ["SELECT UNHEX(X'34316b') AS x",o152],
    ["SELECT UNHEX(X'34316c') AS x",o153],
    ["SELECT UNHEX(X'34316d') AS x",o154],
    ["SELECT UNHEX(X'34316e') AS x",o155],
    ["SELECT UNHEX(X'34316f') AS x",o156],
    ["SELECT UNHEX(X'343170') AS x",o157],
    ["SELECT UNHEX(X'343171') AS x",o158],
    ["SELECT UNHEX(X'343172') AS x",o159],
    ["SELECT UNHEX(X'343173') AS x",o160],
    ["SELECT UNHEX(X'343174') AS x",o161],
    ["SELECT UNHEX(X'343175') AS x",o162],
    ["SELECT UNHEX(X'343176') AS x",o163],
    ["SELECT UNHEX(X'343177') AS x",o164],
    ["SELECT UNHEX(X'343178') AS x",o165],
    ["SELECT UNHEX(X'343179') AS x",o166],
    ["SELECT UNHEX(X'34317a') AS x",o167],
    ["SELECT UNHEX(X'34317b') AS x",o168],
    ["SELECT UNHEX(X'34317c') AS x",o169],
    ["SELECT UNHEX(X'34317d') AS x",o170],
    ["SELECT UNHEX(X'34317e') AS x",o171],
    ["SELECT UNHEX(X'34317f') AS x",o172],
    ["SELECT UNHEX(X'343180') AS x",o173],
    ["SELECT UNHEX(X'343181') AS x",o174],
    ["SELECT UNHEX(X'343182') AS x",o175],
    ["SELECT UNHEX(X'343183') AS x",o176],
    ["SELECT UNHEX(X'343184') AS x",o177],
    ["SELECT UNHEX(X'343185') AS x",o178],
    ["SELECT UNHEX(X'343186') AS x",o179],
    ["SELECT UNHEX(X'343187') AS x",o180],
    ["SELECT UNHEX(X'343188') AS x",o181],
    ["SELECT UNHEX(X'343189') AS x",o182],
    ["SELECT UNHEX(X'34318a') AS x",o183],
    ["SELECT UNHEX(X'34318b') AS x",o184],
    ["SELECT UNHEX(X'34318c') AS x",o185],
    ["SELECT UNHEX(X'34318d') AS x",o186],
    ["SELECT UNHEX(X'34318e') AS x",o187],
    ["SELECT UNHEX(X'34318f') AS x",o188],
    ["SELECT UNHEX(X'343190') AS x",o189],
    ["SELECT UNHEX(X'343191') AS x",o190],
    ["SELECT UNHEX(X'343192') AS x",o191],
    ["SELECT UNHEX(X'343193') AS x",o192],
    ["SELECT UNHEX(X'343194') AS x",o193],
    ["SELECT UNHEX(X'343195') AS x",o194],
    ["SELECT UNHEX(X'343196') AS x",o195],
    ["SELECT UNHEX(X'343197') AS x",o196],
    ["SELECT UNHEX(X'343198') AS x",o197],
    ["SELECT UNHEX(X'343199') AS x",o198],
    ["SELECT UNHEX(X'34319a') AS x",o199],
    ["SELECT UNHEX(X'34319b') AS x",o200],
    ["SELECT UNHEX(X'34319c') AS x",o201],
    ["SELECT UNHEX(X'34319d') AS x",o202],
    ["SELECT UNHEX(X'34319e') AS x",o203],
    ["SELECT UNHEX(X'34319f') AS x",o204],
    ["SELECT UNHEX(X'3431a0') AS x",o205],
    ["SELECT UNHEX(X'3431a1') AS x",o206],
    ["SELECT UNHEX(X'3431a2') AS x",o207],
    ["SELECT UNHEX(X'3431a3') AS x",o208],
    ["SELECT UNHEX(X'3431a4') AS x",o209],
    ["SELECT UNHEX(X'3431a5') AS x",o210],
    ["SELECT UNHEX(X'3431a6') AS x",o211],
    ["SELECT UNHEX(X'3431a7') AS x",o212],
    ["SELECT UNHEX(X'3431a8') AS x",o213],
    ["SELECT UNHEX(X'3431a9') AS x",o214],
    ["SELECT UNHEX(X'3431aa') AS x",o215],
    ["SELECT UNHEX(X'3431ab') AS x",o216],
    ["SELECT UNHEX(X'3431ac') AS x",o217],
    ["SELECT UNHEX(X'3431ad') AS x",o218],
    ["SELECT UNHEX(X'3431ae') AS x",o219],
    ["SELECT UNHEX(X'3431af') AS x",o220],
    ["SELECT UNHEX(X'3431b0') AS x",o221],
    ["SELECT UNHEX(X'3431b1') AS x",o222],
    ["SELECT UNHEX(X'3431b2') AS x",o223],
    ["SELECT UNHEX(X'3431b3') AS x",o224],
    ["SELECT UNHEX(X'3431b4') AS x",o225],
    ["SELECT UNHEX(X'3431b5') AS x",o226],
    ["SELECT UNHEX(X'3431b6') AS x",o227],
    ["SELECT UNHEX(X'3431b7') AS x",o228],
    ["SELECT UNHEX(X'3431b8') AS x",o229],
    ["SELECT UNHEX(X'3431b9') AS x",o230],
    ["SELECT UNHEX(X'3431ba') AS x",o231],
    ["SELECT UNHEX(X'3431bb') AS x",o232],
    ["SELECT UNHEX(X'3431bc') AS x",o233],
    ["SELECT UNHEX(X'3431bd') AS x",o234],
    ["SELECT UNHEX(X'3431be') AS x",o235],
    ["SELECT UNHEX(X'3431bf') AS x",o236],
    ["SELECT UNHEX(X'3431c0') AS x",o237],
    ["SELECT UNHEX(X'3431c1') AS x",o238],
    ["SELECT UNHEX(X'3431c2') AS x",o239],
    ["SELECT UNHEX(X'3431c3') AS x",o240],
    ["SELECT UNHEX(X'3431c4') AS x",o241],
    ["SELECT UNHEX(X'3431c5') AS x",o242],
    ["SELECT UNHEX(X'3431c6') AS x",o243],
    ["SELECT UNHEX(X'3431c7') AS x",o244],
    ["SELECT UNHEX(X'3431c8') AS x",o245],
    ["SELECT UNHEX(X'3431c9') AS x",o246],
    ["SELECT UNHEX(X'3431ca') AS x",o247],
    ["SELECT UNHEX(X'3431cb') AS x",o248],
    ["SELECT UNHEX(X'3431cc') AS x",o249],
    ["SELECT UNHEX(X'3431cd') AS x",o250],
    ["SELECT UNHEX(X'3431ce') AS x",o251],
    ["SELECT UNHEX(X'3431cf') AS x",o252],
    ["SELECT UNHEX(X'3431d0') AS x",o253],
    ["SELECT UNHEX(X'3431d1') AS x",o254],
    ["SELECT UNHEX(X'3431d2') AS x",o255],
    ["SELECT UNHEX(X'3431d3') AS x",o256],
    ["SELECT UNHEX(X'3431d4') AS x",o257],
    ["SELECT UNHEX(X'3431d5') AS x",o258],
    ["SELECT UNHEX(X'3431d6') AS x",o259],
    ["SELECT UNHEX(X'3431d7') AS x",o260],
    ["SELECT UNHEX(X'3431d8') AS x",o261],
    ["SELECT UNHEX(X'3431d9') AS x",o262],
    ["SELECT UNHEX(X'3431da') AS x",o263],
    ["SELECT UNHEX(X'3431db') AS x",o264],
    ["SELECT UNHEX(X'3431dc') AS x",o265],
    ["SELECT UNHEX(X'3431dd') AS x",o266],
    ["SELECT UNHEX(X'3431de') AS x",o267],
    ["SELECT UNHEX(X'3431df') AS x",o268],
    ["SELECT UNHEX(X'3431e0') AS x",o269],
    ["SELECT UNHEX(X'3431e1') AS x",o270],
    ["SELECT UNHEX(X'3431e2') AS x",o271],
    ["SELECT UNHEX(X'3431e3') AS x",o272],
    ["SELECT UNHEX(X'3431e4') AS x",o273],
    ["SELECT UNHEX(X'3431e5') AS x",o274],
    ["SELECT UNHEX(X'3431e6') AS x",o275],
    ["SELECT UNHEX(X'3431e7') AS x",o276],
    ["SELECT UNHEX(X'3431e8') AS x",o277],
    ["SELECT UNHEX(X'3431e9') AS x",o278],
    ["SELECT UNHEX(X'3431ea') AS x",o279],
    ["SELECT UNHEX(X'3431eb') AS x",o280],
    ["SELECT UNHEX(X'3431ec') AS x",o281],
    ["SELECT UNHEX(X'3431ed') AS x",o282],
    ["SELECT UNHEX(X'3431ee') AS x",o283],
    ["SELECT UNHEX(X'3431ef') AS x",o284],
    ["SELECT UNHEX(X'3431f0') AS x",o285],
    ["SELECT UNHEX(X'3431f1') AS x",o286],
    ["SELECT UNHEX(X'3431f2') AS x",o287],
    ["SELECT UNHEX(X'3431f3') AS x",o288],
    ["SELECT UNHEX(X'3431f4') AS x",o289],
    ["SELECT UNHEX(X'3431f5') AS x",o290],
    ["SELECT UNHEX(X'3431f6') AS x",o291],
    ["SELECT UNHEX(X'3431f7') AS x",o292],
    ["SELECT UNHEX(X'3431f8') AS x",o293],
    ["SELECT UNHEX(X'3431f9') AS x",o294],
    ["SELECT UNHEX(X'3431fa') AS x",o295],
    ["SELECT UNHEX(X'3431fb') AS x",o296],
    ["SELECT UNHEX(X'3431fc') AS x",o297],
    ["SELECT UNHEX(X'3431fd') AS x",o298],
    ["SELECT UNHEX(X'3431fe') AS x",o299],
    ["SELECT UNHEX(X'3431ff') AS x",o300],
    ["SELECT UNHEX('GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG') AS x",o301],
    ["SELECT UNHEX('éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé') AS x",o302],
    ["SELECT UNHEX('ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééé') AS x",o303],
    ["SELECT UNHEX('G\\tG') AS x",o304],
    ["SELECT UNHEX('G\\bG') AS x",o305],
    ["SELECT UNHEX('G\\\\G') AS x",o306],
    ["SELECT UNHEX('G\\'G') AS x",o307],
  ]
  try {
    for (const [sql,expected] of fixtures) {
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected,method+': '+sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})

test('UNHEX warnings follow fresh prepared writes and individual lazy row reads', async () => {
  const { db, conn } = await connect()
  const values = [Buffer.from('41'),Buffer.from('GG'),Buffer.from('41\0F'),Buffer.from([0x34,0x31,0x80,0xff]),Buffer.from('4'.repeat(4096)+'G'),Buffer.from('41'.repeat(2048)),Buffer.from(''),null]
  const fixtures: [string,unknown[],[unknown[],unknown[],unknown[]][]][] = [
    ["SELECT UNHEX(b) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o318,[[o308,o308,o309],[o310,o310,o311],[o310,o310,o311],[o310,o310,o311],[o310,o310,o311],[o312,o312,o313],[o314,o314,o315],[o316,o316,o317]]],
    ["SELECT UNHEX(s) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o325,[[o319,o319,o320],[o319,o319,o320],[o319,o319,o320],[o319,o319,o320],[o319,o319,o320],[o321,o321,o322],[o319,o319,o320],[o323,o323,o324]]],
    ["SELECT UNHEX(CONCAT(b)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o318,[[o308,o308,o309],[o326,o326,o327],[o326,o326,o327],[o326,o326,o327],[o326,o326,o327],[o312,o312,o313],[o314,o314,o315],[o316,o316,o317]]],
    ["SELECT UNHEX(IF(g=1,b,s)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o318,[[o308,o308,o309],[o328,o328,o329],[o328,o328,o329],[o328,o328,o329],[o328,o328,o329],[o312,o312,o313],[o314,o314,o315],[o316,o316,o317]]],
    ["SELECT UNHEX(NULLIF(b,s)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o318,[[o308,o308,o309],[o316,o316,o317],[o330,o330,o331],[o330,o330,o331],[o330,o330,o331],[o312,o312,o313],[o314,o314,o315],[o316,o316,o317]]],
    ["SELECT UNHEX(COALESCE(b,s)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o318,[[o308,o308,o309],[o332,o332,o333],[o332,o332,o333],[o332,o332,o333],[o332,o332,o333],[o312,o312,o313],[o314,o314,o315],[o316,o316,o317]]],
  ]
  const lifetime: [string,unknown[]][] = [
    ["SELECT UNHEX(b) FROM t ORDER BY id",o334],
    ["SELECT UNHEX(b),UNHEX(b) FROM t ORDER BY id",o335],
    ["SELECT IF(0,UNHEX(b),NULL) FROM t ORDER BY id",o336],
    ["SELECT IF(1,UNHEX(b),NULL) FROM t ORDER BY id",o337],
    ["SELECT UNHEX(CONCAT(b)) FROM t ORDER BY id",o338],
    ["SELECT UNHEX(CONCAT(b)),UNHEX(CONCAT(b)) FROM t ORDER BY id",o339],
    ["SELECT IF(0,UNHEX(CONCAT(b)),NULL) FROM t ORDER BY id",o340],
    ["SELECT IF(1,UNHEX(CONCAT(b)),NULL) FROM t ORDER BY id",o341],
  ]
  const parameterWrites: [string | null,unknown[],unknown[],unknown[]][] = [
    ["GG",o342,o343,o344],
    ["41",o345,o345,o346],
    [null,o30,o30,o347],
    ["41\\0F",o348,o343,o344],
  ]
  try {
    await conn.query('CREATE DATABASE unhex_warnings71')
    await conn.query('USE unhex_warnings71')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(12000),s VARCHAR(1000),g INT DEFAULT 1)')
    await conn.query("INSERT INTO t VALUES(1,'41','41',1),(2,'41','41',1),(3,NULL,NULL,1)")
    for (const [sql,prepared,writes] of fixtures) {
      const options = {sql,rowsAsArray:true}
      await conn.query('DO 0')
      const stmt = await conn.prepare(options)
      try {
        const resolved = stmt as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual([fields(resolved.statement.columns),(await conn.query('SHOW WARNINGS'))[0]],prepared)
        for (const [id,expected] of writes.entries()) {
          const value = values[id]
          await conn.query('UPDATE t SET b=?,s=? WHERE id=2',[value,value===null?null:id===4?'GG':id===5?'41':'GG'])
          for (const [i,method] of (['query','execute','statement'] as const).entries()) {
            await conn.query('DO 0')
            const [rows,columns] = method==='statement'?await stmt.execute([1,1]):method==='query'?await conn.query(options,[1,1]):await conn.execute(options,[1,1])
            assert.deepEqual([JSON.parse(JSON.stringify(rows)),fields(columns),(await conn.query('SHOW WARNINGS'))[0]],expected[i],method+': '+sql)
          }
        }
      } finally {
        await stmt.close()
        conn.unprepare(options)
      }
    }
    await conn.query("UPDATE t SET b='GG'")
    for (const [sql,expected] of lifetime) {
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected,method+': '+sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
    const options = {sql:'SELECT LENGTH(UNHEX(?)) AS x',rowsAsArray:true}
    await conn.query('DO 0')
    const stmt = await conn.prepare(options)
    try {
      const resolved = stmt as unknown as { statement: { columns: mysql.FieldPacket[] } }
      assert.deepEqual([fields(resolved.statement.columns),(await conn.query('SHOW WARNINGS'))[0]],o349)
      for (const [value,...expected] of parameterWrites) for (const [i,method] of (['query','execute','statement'] as const).entries()) {
        await conn.query('DO 0')
        const [rows,columns] = method==='statement'?await stmt.execute([value]):method==='query'?await conn.query(options,[value]):await conn.execute(options,[value])
        assert.deepEqual([JSON.parse(JSON.stringify(rows)),fields(columns),(await conn.query('SHOW WARNINGS'))[0]],expected[i],method+': '+options.sql)
      }
    } finally {
      await stmt.close()
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS unhex_warnings71')
    await conn.end()
    await db?.end()
  }
})
