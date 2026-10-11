// Complete pinned MySQL 8.4.11 outcomes. Remaining field metadata, truncation encoding, long-input and overflow gaps stay open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const o0 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o1 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o2 = [[["1230"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o3 = [[["1"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o4 = [[["-1"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o5 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[]]
const o6 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: '123x'"}]]
const o7 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: '123.45x'"}]]
const o8 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: '123e1x'"}]]
const o9 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: '-0.5x'"}]]
const o10 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: 'abc1'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o11 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: '123x'"}]]
const o12 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: '123.45x'"}]]
const o13 = [[["123"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: '123e1x'"}]]
const o14 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: '-0.5x'"}]]
const o15 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: 'abc1'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o16 = [[["1231"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o17 = [[["1232"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o18 = [[["1233"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o19 = [[["1234"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o20 = [[["1235"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o21 = [[["1236"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o22 = [[["1237"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o23 = [[["1238"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o24 = [[["1239"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o25 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '80'"}]]
const o26 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '81'"}]]
const o27 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '82'"}]]
const o28 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '83'"}]]
const o29 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '84'"}]]
const o30 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '85'"}]]
const o31 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '86'"}]]
const o32 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '87'"}]]
const o33 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '88'"}]]
const o34 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '89'"}]]
const o35 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8A'"}]]
const o36 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8B'"}]]
const o37 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8C'"}]]
const o38 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8D'"}]]
const o39 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8E'"}]]
const o40 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8F'"}]]
const o41 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '90'"}]]
const o42 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '91'"}]]
const o43 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '92'"}]]
const o44 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '93'"}]]
const o45 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '94'"}]]
const o46 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '95'"}]]
const o47 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '96'"}]]
const o48 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '97'"}]]
const o49 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '98'"}]]
const o50 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '99'"}]]
const o51 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9A'"}]]
const o52 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9B'"}]]
const o53 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9C'"}]]
const o54 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9D'"}]]
const o55 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9E'"}]]
const o56 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9F'"}]]
const o57 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A0'"}]]
const o58 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A1'"}]]
const o59 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A2'"}]]
const o60 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A3'"}]]
const o61 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A4'"}]]
const o62 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A5'"}]]
const o63 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A6'"}]]
const o64 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A7'"}]]
const o65 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A8'"}]]
const o66 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A9'"}]]
const o67 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AA'"}]]
const o68 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AB'"}]]
const o69 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AC'"}]]
const o70 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AD'"}]]
const o71 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AE'"}]]
const o72 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AF'"}]]
const o73 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B0'"}]]
const o74 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B1'"}]]
const o75 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B2'"}]]
const o76 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B3'"}]]
const o77 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B4'"}]]
const o78 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B5'"}]]
const o79 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B6'"}]]
const o80 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B7'"}]]
const o81 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B8'"}]]
const o82 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B9'"}]]
const o83 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BA'"}]]
const o84 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BB'"}]]
const o85 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BC'"}]]
const o86 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BD'"}]]
const o87 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BE'"}]]
const o88 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BF'"}]]
const o89 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C0'"}]]
const o90 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C1'"}]]
const o91 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C2'"}]]
const o92 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C3'"}]]
const o93 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C4'"}]]
const o94 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C5'"}]]
const o95 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C6'"}]]
const o96 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C7'"}]]
const o97 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C8'"}]]
const o98 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C9'"}]]
const o99 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CA'"}]]
const o100 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CB'"}]]
const o101 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CC'"}]]
const o102 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CD'"}]]
const o103 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CE'"}]]
const o104 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CF'"}]]
const o105 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D0'"}]]
const o106 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D1'"}]]
const o107 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D2'"}]]
const o108 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D3'"}]]
const o109 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D4'"}]]
const o110 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D5'"}]]
const o111 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D6'"}]]
const o112 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D7'"}]]
const o113 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D8'"}]]
const o114 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D9'"}]]
const o115 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DA'"}]]
const o116 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DB'"}]]
const o117 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DC'"}]]
const o118 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DD'"}]]
const o119 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DE'"}]]
const o120 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DF'"}]]
const o121 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E0'"}]]
const o122 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E1'"}]]
const o123 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E2'"}]]
const o124 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E3'"}]]
const o125 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E4'"}]]
const o126 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E5'"}]]
const o127 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E6'"}]]
const o128 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E7'"}]]
const o129 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E8'"}]]
const o130 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E9'"}]]
const o131 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EA'"}]]
const o132 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EB'"}]]
const o133 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EC'"}]]
const o134 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'ED'"}]]
const o135 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EE'"}]]
const o136 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EF'"}]]
const o137 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F0'"}]]
const o138 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F1'"}]]
const o139 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F2'"}]]
const o140 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F3'"}]]
const o141 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F4'"}]]
const o142 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F5'"}]]
const o143 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F6'"}]]
const o144 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F7'"}]]
const o145 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F8'"}]]
const o146 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F9'"}]]
const o147 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FA'"}]]
const o148 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FB'"}]]
const o149 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FC'"}]]
const o150 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FD'"}]]
const o151 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FE'"}]]
const o152 = [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FF'"}]]
const o153 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o154 = [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]]
const o155 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o156 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o157 = [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]]
const o158 = [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]]
const o159 = [[["x",246,66,128,0,63,"","","",""]],[]]
const o160 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: 'abc1'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o161 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect CHAR(3) value: '123x'"}]]
const o162 = [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: 'abc1'"},{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o163 = [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(3) value: '123x'"}]]
const o164 = [[[null]],[["x",253,0,0,31,224,"","","",""]],[]]
const o165 = [[[null]],[["x",246,67,128,2,63,"","","",""]],[]]
const o166 = [[[null]],[["x",253,0,128,31,63,"","","",""]],[]]
const o167 = [[[null]],[["x",253,16,128,31,63,"","","",""]],[]]
const o168 = [[[null]],[["x",253,3,128,31,63,"","","",""]],[]]
const o169 = [[["18446744073709551615"]],[["x",253,80,0,31,224,"","","",""]],[]]
const o170 = [[["18446744073709551615.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o171 = [[[{"type":"Buffer","data":[49,56,52,52,54,55,52,52,48,55,51,55,48,57,53,53,49,54,49,53]}]],[["x",253,20,128,31,63,"","","",""]],[]]
const o172 = [[[{"type":"Buffer","data":[49,56,52,52,54,55,52,52,48,55,51,55,48,57,53,53]}]],[["x",253,16,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(16) value: '18446744073709551615'"}]]
const o173 = [[["1844674407370955.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(16) value: '18446744073709551615'"}]]
const o174 = [[["-9223372036854775808"]],[["x",253,80,0,31,224,"","","",""]],[]]
const o175 = [[["-9223372036854775808.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o176 = [[[{"type":"Buffer","data":[45,57,50,50,51,51,55,50,48,51,54,56,53,52,55,55,53,56,48,56]}]],[["x",253,20,128,31,63,"","","",""]],[]]
const o177 = [[[{"type":"Buffer","data":[45,57,50,50,51,51,55,50,48,51,54,56,53,52,55,55]}]],[["x",253,16,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(16) value: '-9223372036854775808'"}]]
const o178 = [[["-922337203685477.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(16) value: '-9223372036854775808'"}]]
const o179 = [[["123.45"]],[["x",253,28,0,31,224,"","","",""]],[]]
const o180 = [[["123.45"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o181 = [[[{"type":"Buffer","data":[49,50,51,46,52,53]}]],[["x",253,7,128,31,63,"","","",""]],[]]
const o182 = [[[{"type":"Buffer","data":[49,50,51,46,52,53,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o183 = [[["123.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o184 = [[["5"]],[["x",253,4,0,31,224,"","","",""]],[]]
const o185 = [[["5.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o186 = [[[{"type":"Buffer","data":[53]}]],[["x",253,1,128,31,63,"","","",""]],[]]
const o187 = [[[{"type":"Buffer","data":[53,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o188 = [[[{"type":"Buffer","data":[53]}]],[["x",253,3,128,31,63,"","","",""]],[]]
const o189 = [[["123x"]],[["x",253,16,0,31,224,"","","",""]],[]]
const o190 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,4,128,31,63,"","","",""]],[]]
const o191 = [[[{"type":"Buffer","data":[49,50,51,120,0,0,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o192 = [[[{"type":"Buffer","data":[49,50,51,120]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o193 = [[["2026-10-11 12:34:56.123456"]],[["x",253,104,0,31,224,"","","",""]],[]]
const o194 = [[["2026.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o195 = [[[{"type":"Buffer","data":[50,48,50,54,45,49,48,45,49,49,32,49,50,58,51,52,58,53,54,46,49,50,51,52,53,54]}]],[["x",253,26,128,31,63,"","","",""]],[]]
const o196 = [[[{"type":"Buffer","data":[50,48,50,54,45,49,48,45,49,49,32,49,50,58,51,52]}]],[["x",253,16,128,31,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(16) value: '2026-10-11 12:34:56.123456'"}]]
const o197 = [[["2026.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect BINARY(16) value: '2026-10-11 12:34:56.123456'"}]]
const o198 = [[["12:34:56.123456"]],[["x",253,68,0,31,224,"","","",""]],[]]
const o199 = [[["12.00"]],[["x",246,67,128,2,63,"","","",""]],[]]
const o200 = [[[{"type":"Buffer","data":[49,50,58,51,52,58,53,54,46,49,50,51,52,53,54]}]],[["x",253,17,128,31,63,"","","",""]],[]]
const o201 = [[[{"type":"Buffer","data":[49,50,58,51,52,58,53,54,46,49,50,51,52,53,54,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o202 = [[["2026-10-11"]],[["x",253,40,0,31,224,"","","",""]],[]]
const o203 = [[[{"type":"Buffer","data":[50,48,50,54,45,49,48,45,49,49]}]],[["x",253,10,128,31,63,"","","",""]],[]]
const o204 = [[[{"type":"Buffer","data":[50,48,50,54,45,49,48,45,49,49,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o205 = [[[{"type":"Buffer","data":[49,50,51,0,0,0,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o206 = [[["0.00"]],[["x",246,67,128,2,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o207 = [[[{"type":"Buffer","data":[34,49,50,51,120,34,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o208 = [[[{"type":"Buffer","data":[116,114,117,101,0,0,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const o209 = [[[{"type":"Buffer","data":[91,49,44,32,50,93,0,0,0,0,0,0,0,0,0,0]}]],[["x",253,16,128,31,63,"","","",""]],[]]
const v0 = [o0,o0,o0,o1,o1,o2,o3,o4,o5,o0]
const v1 = [o0,o0,o0,o6,o7,o8,o3,o9,o5,o10]
const v2 = [o0,o0,o0,o11,o12,o13,o3,o14,o5,o15]
const v3 = [o1,o1,o1,o1,o1,o1,o1]
const v4 = [o2,o2,o2,o2,o2,o2,o2]
const v5 = [o16,o16,o16,o16,o16,o16,o16]
const v6 = [o17,o17,o17,o17,o17,o17,o17]
const v7 = [o18,o18,o18,o18,o18,o18,o18]
const v8 = [o19,o19,o19,o19,o19,o19,o19]
const v9 = [o20,o20,o20,o20,o20,o20,o20]
const v10 = [o21,o21,o21,o21,o21,o21,o21]
const v11 = [o22,o22,o22,o22,o22,o22,o22]
const v12 = [o23,o23,o23,o23,o23,o23,o23]
const v13 = [o24,o24,o24,o24,o24,o24,o24]
const v14 = [o1,o1,o1,o25,o1,o25,o1]
const v15 = [o1,o1,o1,o26,o1,o26,o1]
const v16 = [o1,o1,o1,o27,o1,o27,o1]
const v17 = [o1,o1,o1,o28,o1,o28,o1]
const v18 = [o1,o1,o1,o29,o1,o29,o1]
const v19 = [o1,o1,o1,o30,o1,o30,o1]
const v20 = [o1,o1,o1,o31,o1,o31,o1]
const v21 = [o1,o1,o1,o32,o1,o32,o1]
const v22 = [o1,o1,o1,o33,o1,o33,o1]
const v23 = [o1,o1,o1,o34,o1,o34,o1]
const v24 = [o1,o1,o1,o35,o1,o35,o1]
const v25 = [o1,o1,o1,o36,o1,o36,o1]
const v26 = [o1,o1,o1,o37,o1,o37,o1]
const v27 = [o1,o1,o1,o38,o1,o38,o1]
const v28 = [o1,o1,o1,o39,o1,o39,o1]
const v29 = [o1,o1,o1,o40,o1,o40,o1]
const v30 = [o1,o1,o1,o41,o1,o41,o1]
const v31 = [o1,o1,o1,o42,o1,o42,o1]
const v32 = [o1,o1,o1,o43,o1,o43,o1]
const v33 = [o1,o1,o1,o44,o1,o44,o1]
const v34 = [o1,o1,o1,o45,o1,o45,o1]
const v35 = [o1,o1,o1,o46,o1,o46,o1]
const v36 = [o1,o1,o1,o47,o1,o47,o1]
const v37 = [o1,o1,o1,o48,o1,o48,o1]
const v38 = [o1,o1,o1,o49,o1,o49,o1]
const v39 = [o1,o1,o1,o50,o1,o50,o1]
const v40 = [o1,o1,o1,o51,o1,o51,o1]
const v41 = [o1,o1,o1,o52,o1,o52,o1]
const v42 = [o1,o1,o1,o53,o1,o53,o1]
const v43 = [o1,o1,o1,o54,o1,o54,o1]
const v44 = [o1,o1,o1,o55,o1,o55,o1]
const v45 = [o1,o1,o1,o56,o1,o56,o1]
const v46 = [o1,o1,o1,o57,o1,o57,o1]
const v47 = [o1,o1,o1,o58,o1,o58,o1]
const v48 = [o1,o1,o1,o59,o1,o59,o1]
const v49 = [o1,o1,o1,o60,o1,o60,o1]
const v50 = [o1,o1,o1,o61,o1,o61,o1]
const v51 = [o1,o1,o1,o62,o1,o62,o1]
const v52 = [o1,o1,o1,o63,o1,o63,o1]
const v53 = [o1,o1,o1,o64,o1,o64,o1]
const v54 = [o1,o1,o1,o65,o1,o65,o1]
const v55 = [o1,o1,o1,o66,o1,o66,o1]
const v56 = [o1,o1,o1,o67,o1,o67,o1]
const v57 = [o1,o1,o1,o68,o1,o68,o1]
const v58 = [o1,o1,o1,o69,o1,o69,o1]
const v59 = [o1,o1,o1,o70,o1,o70,o1]
const v60 = [o1,o1,o1,o71,o1,o71,o1]
const v61 = [o1,o1,o1,o72,o1,o72,o1]
const v62 = [o1,o1,o1,o73,o1,o73,o1]
const v63 = [o1,o1,o1,o74,o1,o74,o1]
const v64 = [o1,o1,o1,o75,o1,o75,o1]
const v65 = [o1,o1,o1,o76,o1,o76,o1]
const v66 = [o1,o1,o1,o77,o1,o77,o1]
const v67 = [o1,o1,o1,o78,o1,o78,o1]
const v68 = [o1,o1,o1,o79,o1,o79,o1]
const v69 = [o1,o1,o1,o80,o1,o80,o1]
const v70 = [o1,o1,o1,o81,o1,o81,o1]
const v71 = [o1,o1,o1,o82,o1,o82,o1]
const v72 = [o1,o1,o1,o83,o1,o83,o1]
const v73 = [o1,o1,o1,o84,o1,o84,o1]
const v74 = [o1,o1,o1,o85,o1,o85,o1]
const v75 = [o1,o1,o1,o86,o1,o86,o1]
const v76 = [o1,o1,o1,o87,o1,o87,o1]
const v77 = [o1,o1,o1,o88,o1,o88,o1]
const v78 = [o1,o1,o1,o89,o1,o89,o1]
const v79 = [o1,o1,o1,o90,o1,o90,o1]
const v80 = [o1,o1,o1,o91,o1,o91,o1]
const v81 = [o1,o1,o1,o92,o1,o92,o1]
const v82 = [o1,o1,o1,o93,o1,o93,o1]
const v83 = [o1,o1,o1,o94,o1,o94,o1]
const v84 = [o1,o1,o1,o95,o1,o95,o1]
const v85 = [o1,o1,o1,o96,o1,o96,o1]
const v86 = [o1,o1,o1,o97,o1,o97,o1]
const v87 = [o1,o1,o1,o98,o1,o98,o1]
const v88 = [o1,o1,o1,o99,o1,o99,o1]
const v89 = [o1,o1,o1,o100,o1,o100,o1]
const v90 = [o1,o1,o1,o101,o1,o101,o1]
const v91 = [o1,o1,o1,o102,o1,o102,o1]
const v92 = [o1,o1,o1,o103,o1,o103,o1]
const v93 = [o1,o1,o1,o104,o1,o104,o1]
const v94 = [o1,o1,o1,o105,o1,o105,o1]
const v95 = [o1,o1,o1,o106,o1,o106,o1]
const v96 = [o1,o1,o1,o107,o1,o107,o1]
const v97 = [o1,o1,o1,o108,o1,o108,o1]
const v98 = [o1,o1,o1,o109,o1,o109,o1]
const v99 = [o1,o1,o1,o110,o1,o110,o1]
const v100 = [o1,o1,o1,o111,o1,o111,o1]
const v101 = [o1,o1,o1,o112,o1,o112,o1]
const v102 = [o1,o1,o1,o113,o1,o113,o1]
const v103 = [o1,o1,o1,o114,o1,o114,o1]
const v104 = [o1,o1,o1,o115,o1,o115,o1]
const v105 = [o1,o1,o1,o116,o1,o116,o1]
const v106 = [o1,o1,o1,o117,o1,o117,o1]
const v107 = [o1,o1,o1,o118,o1,o118,o1]
const v108 = [o1,o1,o1,o119,o1,o119,o1]
const v109 = [o1,o1,o1,o120,o1,o120,o1]
const v110 = [o1,o1,o1,o121,o1,o121,o1]
const v111 = [o1,o1,o1,o122,o1,o122,o1]
const v112 = [o1,o1,o1,o123,o1,o123,o1]
const v113 = [o1,o1,o1,o124,o1,o124,o1]
const v114 = [o1,o1,o1,o125,o1,o125,o1]
const v115 = [o1,o1,o1,o126,o1,o126,o1]
const v116 = [o1,o1,o1,o127,o1,o127,o1]
const v117 = [o1,o1,o1,o128,o1,o128,o1]
const v118 = [o1,o1,o1,o129,o1,o129,o1]
const v119 = [o1,o1,o1,o130,o1,o130,o1]
const v120 = [o1,o1,o1,o131,o1,o131,o1]
const v121 = [o1,o1,o1,o132,o1,o132,o1]
const v122 = [o1,o1,o1,o133,o1,o133,o1]
const v123 = [o1,o1,o1,o134,o1,o134,o1]
const v124 = [o1,o1,o1,o135,o1,o135,o1]
const v125 = [o1,o1,o1,o136,o1,o136,o1]
const v126 = [o1,o1,o1,o137,o1,o137,o1]
const v127 = [o1,o1,o1,o138,o1,o138,o1]
const v128 = [o1,o1,o1,o139,o1,o139,o1]
const v129 = [o1,o1,o1,o140,o1,o140,o1]
const v130 = [o1,o1,o1,o141,o1,o141,o1]
const v131 = [o1,o1,o1,o142,o1,o142,o1]
const v132 = [o1,o1,o1,o143,o1,o143,o1]
const v133 = [o1,o1,o1,o144,o1,o144,o1]
const v134 = [o1,o1,o1,o145,o1,o145,o1]
const v135 = [o1,o1,o1,o146,o1,o146,o1]
const v136 = [o1,o1,o1,o147,o1,o147,o1]
const v137 = [o1,o1,o1,o148,o1,o148,o1]
const v138 = [o1,o1,o1,o149,o1,o149,o1]
const v139 = [o1,o1,o1,o150,o1,o150,o1]
const v140 = [o1,o1,o1,o151,o1,o151,o1]
const v141 = [o1,o1,o1,o152,o1,o152,o1]
const f0: [string | null, unknown[], unknown[]][] = [
      ["",o0,o153],
      [" ",o0,o153],
      ["abc1",o0,o153],
      ["0x",o154,o155],
      ["123x",o1,o156],
      [".5x",o3,o157],
      [null,o5,o158],
]
const f1: [string | null, unknown[], unknown[]][] = [
      ["",o0,o153],
      [" ",o0,o153],
      ["abc1",o10,o160],
      ["0x",o154,o155],
      ["123x",o6,o161],
      [".5x",o3,o157],
      [null,o5,o158],
]
const f2: [string | null, unknown[], unknown[]][] = [
      ["",o0,o153],
      [" ",o0,o153],
      ["abc1",o15,o162],
      ["0x",o154,o155],
      ["123x",o11,o163],
      [".5x",o3,o157],
      [null,o5,o158],
]

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

test('CHAR/BINARY casts own string DECIMAL prefix diagnostics across sources and nested selection boundaries', async () => {
  const { db, conn } = await connect()
  const values = [""," ","abc","123x","123.45x","123e1x",".5x","-0.5x",null,"abc1"]
  const fixtures: [string, string[], number[], unknown[]][] = [
    ["CAST(b AS CHAR)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["CAST(b AS CHAR CHARACTER SET latin1)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["CAST(b AS CHAR(3))",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v1],
    ["CAST(b AS BINARY)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["CAST(b AS BINARY(3))",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v2],
    ["CAST(b AS BINARY(16))",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["CAST(IF(g=1,b,'123x') AS CHAR)",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["IF(g=1,CAST(b AS BINARY),'123x')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
    ["NULLIF(CAST(b AS BINARY),_binary'zz')",["blob","varbinary","literal","text","varchar","textliteral"],[0,1,2,3,4,5,6,7,8,9],v0],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_cast67')
    await conn.query('USE decimal_cast67')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,s MEDIUMTEXT,v VARBINARY(12000),c VARCHAR(12000),g INT DEFAULT 1)')
    for (const [id,value] of values.entries()) await conn.query('INSERT INTO t(id,b,s,v,c) VALUES(?,?,?,?,?)',[id,value === null ? null : Buffer.from(value),value,value === null ? null : Buffer.from(value),value])
    for (const [source,kinds,ids,results] of fixtures) for (const kind of kinds) for (const [i,id] of ids.entries()) {
      const value = values[id]
      const input = kind === 'blob' ? 'b' : kind === 'text' ? 's' : kind === 'varbinary' ? 'v' : kind === 'varchar' ? 'c' : value === null ? 'NULL' : '_' + (kind === 'literal' ? 'binary' : 'utf8mb4') + " X'" + Buffer.from(value as string).toString('hex') + "'"
      const sql = 'SELECT CAST(' + source.replace(/\bb\b/g,input) + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + id
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),results[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_cast67')
    await conn.end()
    await db?.end()
  }
})

test('CHAR/BINARY DECIMAL readers retain every trailing byte through nested choices', async () => {
  const { db, conn } = await connect()
  const sources = ["CAST(b AS BINARY)","CAST(v AS BINARY)","CAST(b AS BINARY(16))","CAST(b AS CHAR)","CAST(b AS CHAR CHARACTER SET latin1)","CAST(IF(TRUE,b,'123x') AS CHAR)","IF(TRUE,CAST(b AS BINARY),'123x')"]
  const expected = [
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v4,v5,v6,v7,v8,v9,v10,v11,v12,v13,v3,v3,v3,v3,v3,v3,
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,v3,
    v14,v15,v16,v17,v18,v19,v20,v21,v22,v23,v24,v25,v26,v27,v28,v29,
    v30,v31,v32,v33,v34,v35,v36,v37,v38,v39,v40,v41,v42,v43,v44,v45,
    v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56,v57,v58,v59,v60,v61,
    v62,v63,v64,v65,v66,v67,v68,v69,v70,v71,v72,v73,v74,v75,v76,v77,
    v78,v79,v80,v81,v82,v83,v84,v85,v86,v87,v88,v89,v90,v91,v92,v93,
    v94,v95,v96,v97,v98,v99,v100,v101,v102,v103,v104,v105,v106,v107,v108,v109,
    v110,v111,v112,v113,v114,v115,v116,v117,v118,v119,v120,v121,v122,v123,v124,v125,
    v126,v127,v128,v129,v130,v131,v132,v133,v134,v135,v136,v137,v138,v139,v140,v141,
  ]
  try {
    await conn.query('CREATE DATABASE decimal_castbytes67')
    await conn.query('USE decimal_castbytes67')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (let byte=0;byte<256;byte++) await conn.query('INSERT INTO t VALUES(?,?,?)',[byte,Buffer.from([0x31,0x32,0x33,byte]),Buffer.from([0x31,0x32,0x33,byte])])
    for (let byte=0;byte<256;byte++) for (const [i,source] of sources.entries()) {
      const sql = 'SELECT CAST(' + source + ' AS DECIMAL(65,0)) AS x FROM t WHERE id=' + byte
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),expected[byte]?.[i],method + ': ' + sql)
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_castbytes67')
    await conn.end()
    await db?.end()
  }
})

test('CHAR/BINARY DECIMAL readers follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["VARBINARY(60000)","SELECT CAST(CAST(b AS BINARY) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["VARBINARY(60000)","SELECT CAST(CAST(b AS CHAR(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f1],
    ["VARBINARY(60000)","SELECT CAST(CAST(b AS BINARY(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f2],
    ["VARBINARY(60000)","SELECT CAST(CAST(b AS BINARY(16)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["VARBINARY(60000)","SELECT CAST(CAST(b AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["VARBINARY(60000)","SELECT CAST(CAST(b AS CHAR CHARACTER SET latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["VARBINARY(60000)","SELECT CAST(CAST(IF(g=1,b,'123x') AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["VARBINARY(60000)","SELECT CAST(IF(g=1,CAST(b AS BINARY),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["BLOB","SELECT CAST(CAST(b AS BINARY) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["BLOB","SELECT CAST(CAST(b AS CHAR(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f1],
    ["BLOB","SELECT CAST(CAST(b AS BINARY(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f2],
    ["BLOB","SELECT CAST(CAST(b AS BINARY(16)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["BLOB","SELECT CAST(CAST(b AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["BLOB","SELECT CAST(CAST(b AS CHAR CHARACTER SET latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["BLOB","SELECT CAST(CAST(IF(g=1,b,'123x') AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["BLOB","SELECT CAST(IF(g=1,CAST(b AS BINARY),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["MEDIUMBLOB","SELECT CAST(CAST(b AS BINARY) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["MEDIUMBLOB","SELECT CAST(CAST(b AS CHAR(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f1],
    ["MEDIUMBLOB","SELECT CAST(CAST(b AS BINARY(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f2],
    ["MEDIUMBLOB","SELECT CAST(CAST(b AS BINARY(16)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["MEDIUMBLOB","SELECT CAST(CAST(b AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["MEDIUMBLOB","SELECT CAST(CAST(b AS CHAR CHARACTER SET latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["MEDIUMBLOB","SELECT CAST(CAST(IF(g=1,b,'123x') AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["MEDIUMBLOB","SELECT CAST(IF(g=1,CAST(b AS BINARY),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["LONGBLOB","SELECT CAST(CAST(b AS BINARY) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["LONGBLOB","SELECT CAST(CAST(b AS CHAR(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f1],
    ["LONGBLOB","SELECT CAST(CAST(b AS BINARY(3)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f2],
    ["LONGBLOB","SELECT CAST(CAST(b AS BINARY(16)) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["LONGBLOB","SELECT CAST(CAST(b AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["LONGBLOB","SELECT CAST(CAST(b AS CHAR CHARACTER SET latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["LONGBLOB","SELECT CAST(CAST(IF(g=1,b,'123x') AS CHAR) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
    ["LONGBLOB","SELECT CAST(IF(g=1,CAST(b AS BINARY),'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o159,f0],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_castfresh67')
    await conn.query('USE decimal_castfresh67')
    for (const [storage, sql, prepare, writes] of fixtures) {
      await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,b ${storage},g INT DEFAULT 1)`)
      await conn.query("INSERT INTO t VALUES(1,'1',1),(2,'1',1),(3,NULL,1)")
      const options = { sql, rowsAsArray: true }
      await conn.query('DO 0')
      const stmt = await conn.prepare(options)
      try {
        const prepared = stmt as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual([fields(prepared.statement.columns), (await conn.query('SHOW WARNINGS'))[0]], prepare)
        for (const [value, expected, objects] of writes) {
          await conn.query('UPDATE t SET b=? WHERE id=2', [value === null ? null : Buffer.from(value)])
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [rows, columns] = method === 'statement' ? await stmt.execute([1,1]) : method === 'query' ? await conn.query(options,[1,1]) : await conn.execute(options,[1,1])
            assert.deepEqual([rows, fields(columns), (await conn.query('SHOW WARNINGS'))[0]], method === 'statement' ? objects : expected, storage + ': ' + method + ': ' + sql)
          }
        }
      } finally {
        await stmt.close()
        conn.unprepare(options)
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_castfresh67')
    await conn.end()
    await db?.end()
  }
})

test('CHAR/BINARY casts retain original numeric, BIT, temporal and JSON controls', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown][] = [
    ["SELECT CAST(NULL AS CHAR) AS x",o164],
    ["SELECT CAST(CAST(NULL AS CHAR) AS DECIMAL(65,2)) AS x",o165],
    ["SELECT CAST(NULL AS CHAR CHARACTER SET latin1) AS x",o164],
    ["SELECT CAST(CAST(NULL AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o165],
    ["SELECT CAST(NULL AS BINARY) AS x",o166],
    ["SELECT CAST(CAST(NULL AS BINARY) AS DECIMAL(65,2)) AS x",o165],
    ["SELECT CAST(NULL AS BINARY(16)) AS x",o167],
    ["SELECT CAST(CAST(NULL AS BINARY(16)) AS DECIMAL(65,2)) AS x",o165],
    ["SELECT IF(TRUE,CAST(NULL AS BINARY),0e0) AS x",o168],
    ["SELECT CAST(IF(TRUE,CAST(NULL AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o165],
    ["SELECT NULLIF(CAST(NULL AS BINARY),_binary'zz') AS x",o166],
    ["SELECT CAST(NULLIF(CAST(NULL AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o165],
    ["SELECT CAST(18446744073709551615 AS CHAR) AS x",o169],
    ["SELECT CAST(CAST(18446744073709551615 AS CHAR) AS DECIMAL(65,2)) AS x",o170],
    ["SELECT CAST(18446744073709551615 AS CHAR CHARACTER SET latin1) AS x",o169],
    ["SELECT CAST(CAST(18446744073709551615 AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o170],
    ["SELECT CAST(18446744073709551615 AS BINARY) AS x",o171],
    ["SELECT CAST(CAST(18446744073709551615 AS BINARY) AS DECIMAL(65,2)) AS x",o170],
    ["SELECT CAST(18446744073709551615 AS BINARY(16)) AS x",o172],
    ["SELECT CAST(CAST(18446744073709551615 AS BINARY(16)) AS DECIMAL(65,2)) AS x",o173],
    ["SELECT IF(TRUE,CAST(18446744073709551615 AS BINARY),0e0) AS x",o171],
    ["SELECT CAST(IF(TRUE,CAST(18446744073709551615 AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o170],
    ["SELECT NULLIF(CAST(18446744073709551615 AS BINARY),_binary'zz') AS x",o171],
    ["SELECT CAST(NULLIF(CAST(18446744073709551615 AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o170],
    ["SELECT CAST(-9223372036854775808 AS CHAR) AS x",o174],
    ["SELECT CAST(CAST(-9223372036854775808 AS CHAR) AS DECIMAL(65,2)) AS x",o175],
    ["SELECT CAST(-9223372036854775808 AS CHAR CHARACTER SET latin1) AS x",o174],
    ["SELECT CAST(CAST(-9223372036854775808 AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o175],
    ["SELECT CAST(-9223372036854775808 AS BINARY) AS x",o176],
    ["SELECT CAST(CAST(-9223372036854775808 AS BINARY) AS DECIMAL(65,2)) AS x",o175],
    ["SELECT CAST(-9223372036854775808 AS BINARY(16)) AS x",o177],
    ["SELECT CAST(CAST(-9223372036854775808 AS BINARY(16)) AS DECIMAL(65,2)) AS x",o178],
    ["SELECT IF(TRUE,CAST(-9223372036854775808 AS BINARY),0e0) AS x",o176],
    ["SELECT CAST(IF(TRUE,CAST(-9223372036854775808 AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o175],
    ["SELECT NULLIF(CAST(-9223372036854775808 AS BINARY),_binary'zz') AS x",o176],
    ["SELECT CAST(NULLIF(CAST(-9223372036854775808 AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o175],
    ["SELECT CAST(123.45 AS CHAR) AS x",o179],
    ["SELECT CAST(CAST(123.45 AS CHAR) AS DECIMAL(65,2)) AS x",o180],
    ["SELECT CAST(123.45 AS CHAR CHARACTER SET latin1) AS x",o179],
    ["SELECT CAST(CAST(123.45 AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o180],
    ["SELECT CAST(123.45 AS BINARY) AS x",o181],
    ["SELECT CAST(CAST(123.45 AS BINARY) AS DECIMAL(65,2)) AS x",o180],
    ["SELECT CAST(123.45 AS BINARY(16)) AS x",o182],
    ["SELECT CAST(CAST(123.45 AS BINARY(16)) AS DECIMAL(65,2)) AS x",o180],
    ["SELECT IF(TRUE,CAST(123.45 AS BINARY),0e0) AS x",o181],
    ["SELECT CAST(IF(TRUE,CAST(123.45 AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o180],
    ["SELECT NULLIF(CAST(123.45 AS BINARY),_binary'zz') AS x",o181],
    ["SELECT CAST(NULLIF(CAST(123.45 AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o180],
    ["SELECT CAST(CAST(123e0 AS CHAR) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST(123e0 AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST(123e0 AS BINARY) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST(123e0 AS BINARY(16)) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(IF(TRUE,CAST(123e0 AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(NULLIF(CAST(123e0 AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(b'00110101' AS CHAR) AS x",o184],
    ["SELECT CAST(CAST(b'00110101' AS CHAR) AS DECIMAL(65,2)) AS x",o185],
    ["SELECT CAST(b'00110101' AS CHAR CHARACTER SET latin1) AS x",o184],
    ["SELECT CAST(CAST(b'00110101' AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o185],
    ["SELECT CAST(b'00110101' AS BINARY) AS x",o186],
    ["SELECT CAST(CAST(b'00110101' AS BINARY) AS DECIMAL(65,2)) AS x",o185],
    ["SELECT CAST(b'00110101' AS BINARY(16)) AS x",o187],
    ["SELECT CAST(CAST(b'00110101' AS BINARY(16)) AS DECIMAL(65,2)) AS x",o185],
    ["SELECT IF(TRUE,CAST(b'00110101' AS BINARY),0e0) AS x",o188],
    ["SELECT CAST(IF(TRUE,CAST(b'00110101' AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o185],
    ["SELECT NULLIF(CAST(b'00110101' AS BINARY),_binary'zz') AS x",o186],
    ["SELECT CAST(NULLIF(CAST(b'00110101' AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o185],
    ["SELECT CAST(X'31323378' AS CHAR) AS x",o189],
    ["SELECT CAST(CAST(X'31323378' AS CHAR) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(X'31323378' AS CHAR CHARACTER SET latin1) AS x",o189],
    ["SELECT CAST(CAST(X'31323378' AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(X'31323378' AS BINARY) AS x",o190],
    ["SELECT CAST(CAST(X'31323378' AS BINARY) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(X'31323378' AS BINARY(16)) AS x",o191],
    ["SELECT CAST(CAST(X'31323378' AS BINARY(16)) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT IF(TRUE,CAST(X'31323378' AS BINARY),0e0) AS x",o190],
    ["SELECT CAST(IF(TRUE,CAST(X'31323378' AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT NULLIF(CAST(X'31323378' AS BINARY),_binary'zz') AS x",o190],
    ["SELECT CAST(NULLIF(CAST(X'31323378' AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(_binary'123x' AS CHAR) AS x",o189],
    ["SELECT CAST(CAST(_binary'123x' AS CHAR) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(_binary'123x' AS CHAR CHARACTER SET latin1) AS x",o189],
    ["SELECT CAST(CAST(_binary'123x' AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(_binary'123x' AS BINARY) AS x",o190],
    ["SELECT CAST(CAST(_binary'123x' AS BINARY) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(_binary'123x' AS BINARY(16)) AS x",o191],
    ["SELECT CAST(CAST(_binary'123x' AS BINARY(16)) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT IF(TRUE,CAST(_binary'123x' AS BINARY),0e0) AS x",o190],
    ["SELECT CAST(IF(TRUE,CAST(_binary'123x' AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT NULLIF(CAST(_binary'123x' AS BINARY),_binary'zz') AS x",o190],
    ["SELECT CAST(NULLIF(CAST(_binary'123x' AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST('123x' AS CHAR) AS x",o189],
    ["SELECT CAST(CAST('123x' AS CHAR) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST('123x' AS CHAR CHARACTER SET latin1) AS x",o189],
    ["SELECT CAST(CAST('123x' AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST('123x' AS BINARY) AS x",o192],
    ["SELECT CAST(CAST('123x' AS BINARY) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST('123x' AS BINARY(16)) AS x",o191],
    ["SELECT CAST(CAST('123x' AS BINARY(16)) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT IF(TRUE,CAST('123x' AS BINARY),0e0) AS x",o192],
    ["SELECT CAST(IF(TRUE,CAST('123x' AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT NULLIF(CAST('123x' AS BINARY),_binary'zz') AS x",o192],
    ["SELECT CAST(NULLIF(CAST('123x' AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS CHAR) AS x",o193],
    ["SELECT CAST(CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS CHAR) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS CHAR CHARACTER SET latin1) AS x",o193],
    ["SELECT CAST(CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY) AS x",o195],
    ["SELECT CAST(CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY(16)) AS x",o196],
    ["SELECT CAST(CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o197],
    ["SELECT IF(TRUE,CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY),0e0) AS x",o195],
    ["SELECT CAST(IF(TRUE,CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT NULLIF(CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY),_binary'zz') AS x",o195],
    ["SELECT CAST(NULLIF(CAST(CAST('2026-10-11 12:34:56.123456' AS DATETIME(6)) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('12:34:56.123456' AS TIME(6)) AS CHAR) AS x",o198],
    ["SELECT CAST(CAST(CAST('12:34:56.123456' AS TIME(6)) AS CHAR) AS DECIMAL(65,2)) AS x",o199],
    ["SELECT CAST(CAST('12:34:56.123456' AS TIME(6)) AS CHAR CHARACTER SET latin1) AS x",o198],
    ["SELECT CAST(CAST(CAST('12:34:56.123456' AS TIME(6)) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o199],
    ["SELECT CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY) AS x",o200],
    ["SELECT CAST(CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY) AS DECIMAL(65,2)) AS x",o199],
    ["SELECT CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY(16)) AS x",o201],
    ["SELECT CAST(CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o199],
    ["SELECT IF(TRUE,CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY),0e0) AS x",o200],
    ["SELECT CAST(IF(TRUE,CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o199],
    ["SELECT NULLIF(CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY),_binary'zz') AS x",o200],
    ["SELECT CAST(NULLIF(CAST(CAST('12:34:56.123456' AS TIME(6)) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o199],
    ["SELECT CAST(CAST('2026-10-11' AS DATE) AS CHAR) AS x",o202],
    ["SELECT CAST(CAST(CAST('2026-10-11' AS DATE) AS CHAR) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('2026-10-11' AS DATE) AS CHAR CHARACTER SET latin1) AS x",o202],
    ["SELECT CAST(CAST(CAST('2026-10-11' AS DATE) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('2026-10-11' AS DATE) AS BINARY) AS x",o203],
    ["SELECT CAST(CAST(CAST('2026-10-11' AS DATE) AS BINARY) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST('2026-10-11' AS DATE) AS BINARY(16)) AS x",o204],
    ["SELECT CAST(CAST(CAST('2026-10-11' AS DATE) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT IF(TRUE,CAST(CAST('2026-10-11' AS DATE) AS BINARY),0e0) AS x",o203],
    ["SELECT CAST(IF(TRUE,CAST(CAST('2026-10-11' AS DATE) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o194],
    ["SELECT NULLIF(CAST(CAST('2026-10-11' AS DATE) AS BINARY),_binary'zz') AS x",o203],
    ["SELECT CAST(NULLIF(CAST(CAST('2026-10-11' AS DATE) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o194],
    ["SELECT CAST(CAST(CAST('123' AS JSON) AS CHAR) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST(CAST('123' AS JSON) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST(CAST('123' AS JSON) AS BINARY) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST('123' AS JSON) AS BINARY(16)) AS x",o205],
    ["SELECT CAST(CAST(CAST('123' AS JSON) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(IF(TRUE,CAST(CAST('123' AS JSON) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(NULLIF(CAST(CAST('123' AS JSON) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o183],
    ["SELECT CAST(CAST(CAST('\\\"123x\\\"' AS JSON) AS CHAR) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('\\\"123x\\\"' AS JSON) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('\\\"123x\\\"' AS JSON) AS BINARY) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST('\\\"123x\\\"' AS JSON) AS BINARY(16)) AS x",o207],
    ["SELECT CAST(CAST(CAST('\\\"123x\\\"' AS JSON) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(IF(TRUE,CAST(CAST('\\\"123x\\\"' AS JSON) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(NULLIF(CAST(CAST('\\\"123x\\\"' AS JSON) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('true' AS JSON) AS CHAR) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('true' AS JSON) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('true' AS JSON) AS BINARY) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST('true' AS JSON) AS BINARY(16)) AS x",o208],
    ["SELECT CAST(CAST(CAST('true' AS JSON) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(IF(TRUE,CAST(CAST('true' AS JSON) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(NULLIF(CAST(CAST('true' AS JSON) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('[1,2]' AS JSON) AS CHAR) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('[1,2]' AS JSON) AS CHAR CHARACTER SET latin1) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST(CAST('[1,2]' AS JSON) AS BINARY) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(CAST('[1,2]' AS JSON) AS BINARY(16)) AS x",o209],
    ["SELECT CAST(CAST(CAST('[1,2]' AS JSON) AS BINARY(16)) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(IF(TRUE,CAST(CAST('[1,2]' AS JSON) AS BINARY),0e0) AS DECIMAL(65,2)) AS x",o206],
    ["SELECT CAST(NULLIF(CAST(CAST('[1,2]' AS JSON) AS BINARY),_binary'zz') AS DECIMAL(65,2)) AS x",o206],
  ]
  try {
    for (const [sql,result] of fixtures) {
      for (const method of ['query','execute'] as const) {
        await conn.query('DO 0')
        assert.deepEqual(await outcome(conn,sql,method),result,method + ': ' + sql)
      }
      conn.unprepare({sql,rowsAsArray:true})
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})
