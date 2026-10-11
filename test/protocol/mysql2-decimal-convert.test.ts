// Own SQL and complete pinned MySQL 8.4.11 outcomes. Each converted source owns
// its DECIMAL prefix; charset evaluation, result metadata and statement diagnostics
// stay independent. Full audits retain overflow/exponent/VT/FF and charset gaps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const OUTCOMES: unknown[][] = [
  [[["123"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1230"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1231"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1232"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1233"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1234"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1235"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1236"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1237"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1238"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["1239"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '80'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '81'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '82'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '83'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '84'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '85'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '86'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '87'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '88'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '89'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8A'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8B'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8C'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8D'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8E'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '8F'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '90'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '91'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '92'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '93'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '94'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '95'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '96'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '97'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '98'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '99'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9A'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9B'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9C'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9D'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9E'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '9F'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A0'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A1'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A2'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A3'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A4'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A5'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A6'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A7'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A8'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'A9'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AA'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AB'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AC'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AD'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AE'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'AF'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B0'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B1'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B2'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B3'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B4'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B5'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B6'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B7'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B8'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'B9'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BA'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BB'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BC'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BD'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BE'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'BF'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C0'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C1'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C2'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C3'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C4'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C5'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C6'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C7'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C8'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'C9'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CA'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CB'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CC'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CD'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CE'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'CF'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D0'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D1'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D2'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D3'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D4'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D5'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D6'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D7'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D8'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'D9'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DA'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DB'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DC'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DD'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DE'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'DF'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E0'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E1'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E2'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E3'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E4'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E5'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E6'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E7'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E8'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'E9'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EA'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EB'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EC'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'ED'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EE'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'EF'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F0'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F1'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F2'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F3'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F4'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F5'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F6'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F7'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F8'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'F9'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FA'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FB'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FC'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FD'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FE'"}]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: 'FF'"}]],
  [[["-123"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["124"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[[null]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1300,"Message":"Invalid utf8mb4 character string: '80FF'"}]],
  [[["0"]],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
  [[["1"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["-1"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]],
  [[["0"]],[["x",246,66,128,0,63,"","","",""]],[]],
  [[{"x":"0"}],[["x",246,66,128,0,63,"","","",""]],[]],
  [[{"x":"123"}],[["x",246,66,128,0,63,"","","",""]],[]],
  [[{"x":"1"}],[["x",246,66,128,0,63,"","","",""]],[]],
  [[{"x":null}],[["x",246,66,128,0,63,"","","",""]],[]],
  [[["x",246,66,128,0,63,"","","",""]],[]]
]
const BYTE_SOURCES = [
  "CONVERT(b USING binary)",
  "CONVERT(b USING utf8mb4)",
  "CONVERT(b USING latin1)",
  "CONVERT(v USING binary)",
  "CONVERT(CONCAT(b) USING binary)",
  "IF(1,CONVERT(b USING binary),b)",
  "COALESCE(CONVERT(b USING binary),b)",
  "b"
]
const BYTE_MATRIX: number[][] = [
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [1,1,1,1,1,1,1,1],
  [2,2,2,2,2,2,2,2],
  [3,3,3,3,3,3,3,3],
  [4,4,4,4,4,4,4,4],
  [5,5,5,5,5,5,5,5],
  [6,6,6,6,6,6,6,6],
  [7,7,7,7,7,7,7,7],
  [8,8,8,8,8,8,8,8],
  [9,9,9,9,9,9,9,9],
  [10,10,10,10,10,10,10,10],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,11,0,0,0,0,0,0],
  [0,12,0,0,0,0,0,0],
  [0,13,0,0,0,0,0,0],
  [0,14,0,0,0,0,0,0],
  [0,15,0,0,0,0,0,0],
  [0,16,0,0,0,0,0,0],
  [0,17,0,0,0,0,0,0],
  [0,18,0,0,0,0,0,0],
  [0,19,0,0,0,0,0,0],
  [0,20,0,0,0,0,0,0],
  [0,21,0,0,0,0,0,0],
  [0,22,0,0,0,0,0,0],
  [0,23,0,0,0,0,0,0],
  [0,24,0,0,0,0,0,0],
  [0,25,0,0,0,0,0,0],
  [0,26,0,0,0,0,0,0],
  [0,27,0,0,0,0,0,0],
  [0,28,0,0,0,0,0,0],
  [0,29,0,0,0,0,0,0],
  [0,30,0,0,0,0,0,0],
  [0,31,0,0,0,0,0,0],
  [0,32,0,0,0,0,0,0],
  [0,33,0,0,0,0,0,0],
  [0,34,0,0,0,0,0,0],
  [0,35,0,0,0,0,0,0],
  [0,36,0,0,0,0,0,0],
  [0,37,0,0,0,0,0,0],
  [0,38,0,0,0,0,0,0],
  [0,39,0,0,0,0,0,0],
  [0,40,0,0,0,0,0,0],
  [0,41,0,0,0,0,0,0],
  [0,42,0,0,0,0,0,0],
  [0,43,0,0,0,0,0,0],
  [0,44,0,0,0,0,0,0],
  [0,45,0,0,0,0,0,0],
  [0,46,0,0,0,0,0,0],
  [0,47,0,0,0,0,0,0],
  [0,48,0,0,0,0,0,0],
  [0,49,0,0,0,0,0,0],
  [0,50,0,0,0,0,0,0],
  [0,51,0,0,0,0,0,0],
  [0,52,0,0,0,0,0,0],
  [0,53,0,0,0,0,0,0],
  [0,54,0,0,0,0,0,0],
  [0,55,0,0,0,0,0,0],
  [0,56,0,0,0,0,0,0],
  [0,57,0,0,0,0,0,0],
  [0,58,0,0,0,0,0,0],
  [0,59,0,0,0,0,0,0],
  [0,60,0,0,0,0,0,0],
  [0,61,0,0,0,0,0,0],
  [0,62,0,0,0,0,0,0],
  [0,63,0,0,0,0,0,0],
  [0,64,0,0,0,0,0,0],
  [0,65,0,0,0,0,0,0],
  [0,66,0,0,0,0,0,0],
  [0,67,0,0,0,0,0,0],
  [0,68,0,0,0,0,0,0],
  [0,69,0,0,0,0,0,0],
  [0,70,0,0,0,0,0,0],
  [0,71,0,0,0,0,0,0],
  [0,72,0,0,0,0,0,0],
  [0,73,0,0,0,0,0,0],
  [0,74,0,0,0,0,0,0],
  [0,75,0,0,0,0,0,0],
  [0,76,0,0,0,0,0,0],
  [0,77,0,0,0,0,0,0],
  [0,78,0,0,0,0,0,0],
  [0,79,0,0,0,0,0,0],
  [0,80,0,0,0,0,0,0],
  [0,81,0,0,0,0,0,0],
  [0,82,0,0,0,0,0,0],
  [0,83,0,0,0,0,0,0],
  [0,84,0,0,0,0,0,0],
  [0,85,0,0,0,0,0,0],
  [0,86,0,0,0,0,0,0],
  [0,87,0,0,0,0,0,0],
  [0,88,0,0,0,0,0,0],
  [0,89,0,0,0,0,0,0],
  [0,90,0,0,0,0,0,0],
  [0,91,0,0,0,0,0,0],
  [0,92,0,0,0,0,0,0],
  [0,93,0,0,0,0,0,0],
  [0,94,0,0,0,0,0,0],
  [0,95,0,0,0,0,0,0],
  [0,96,0,0,0,0,0,0],
  [0,97,0,0,0,0,0,0],
  [0,98,0,0,0,0,0,0],
  [0,99,0,0,0,0,0,0],
  [0,100,0,0,0,0,0,0],
  [0,101,0,0,0,0,0,0],
  [0,102,0,0,0,0,0,0],
  [0,103,0,0,0,0,0,0],
  [0,104,0,0,0,0,0,0],
  [0,105,0,0,0,0,0,0],
  [0,106,0,0,0,0,0,0],
  [0,107,0,0,0,0,0,0],
  [0,108,0,0,0,0,0,0],
  [0,109,0,0,0,0,0,0],
  [0,110,0,0,0,0,0,0],
  [0,111,0,0,0,0,0,0],
  [0,112,0,0,0,0,0,0],
  [0,113,0,0,0,0,0,0],
  [0,114,0,0,0,0,0,0],
  [0,115,0,0,0,0,0,0],
  [0,116,0,0,0,0,0,0],
  [0,117,0,0,0,0,0,0],
  [0,118,0,0,0,0,0,0],
  [0,119,0,0,0,0,0,0],
  [0,120,0,0,0,0,0,0],
  [0,121,0,0,0,0,0,0],
  [0,122,0,0,0,0,0,0],
  [0,123,0,0,0,0,0,0],
  [0,124,0,0,0,0,0,0],
  [0,125,0,0,0,0,0,0],
  [0,126,0,0,0,0,0,0],
  [0,127,0,0,0,0,0,0],
  [0,128,0,0,0,0,0,0],
  [0,129,0,0,0,0,0,0],
  [0,130,0,0,0,0,0,0],
  [0,131,0,0,0,0,0,0],
  [0,132,0,0,0,0,0,0],
  [0,133,0,0,0,0,0,0],
  [0,134,0,0,0,0,0,0],
  [0,135,0,0,0,0,0,0],
  [0,136,0,0,0,0,0,0],
  [0,137,0,0,0,0,0,0],
  [0,138,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [139,139,139,139,139,139,139,139],
  [140,140,140,140,140,140,140,140],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,141,0,0,0,0],
  [0,0,0,141,0,0,0,0],
  [0,142,0,0,0,0,0,0],
  [141,141,141,141,141,141,141,141]
]
const TEXT_SOURCES = [
  "CONVERT(b USING binary)",
  "CONVERT(b USING utf8mb4)",
  "CONVERT(b USING latin1)",
  "IF(g=1,CONVERT(b USING binary),b)",
  "CAST(b AS BINARY)"
]
const TEXT_MATRIX: [number,number[]][] = [
  [0,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [1,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [2,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [3,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [4,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [5,[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]],
  [6,[6,6,6,6,6,6,6,6,6,6,6,6,6,6,6]],
  [7,[144,144,144,144,144,144,144,144,144,144,144,144,144,144,144]],
  [8,[145,145,145,145,145,145,145,145,145,145,145,145,145,145,145]],
  [9,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [10,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [11,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [12,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [13,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [14,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [15,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [16,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [17,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [18,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [19,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [20,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [21,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [22,[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]],
  [27,[141,141,141,141,141,141,141,141,141,141,141,141,141,141,141]],
  [28,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [29,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [30,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [31,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]],
  [32,[143,143,143,143,143,143,143,143,143,143,143,143,143,143,143]]
]
const FRESH: [string,[string,number,number[][]][]][] = [
  ["VARBINARY(60000)",[["SELECT CAST(CONVERT(b USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING utf8mb4) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(IF(g=1,CONVERT(b USING binary),'999x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(IFNULL(b,'123x') USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149]]],["SELECT CAST(CONVERT(CONCAT(b) USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]]]],
  ["BLOB",[["SELECT CAST(CONVERT(b USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING utf8mb4) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(IF(g=1,CONVERT(b USING binary),'999x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(IFNULL(b,'123x') USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149]]],["SELECT CAST(CONVERT(CONCAT(b) USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]]]],
  ["MEDIUMBLOB",[["SELECT CAST(CONVERT(b USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING utf8mb4) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(IF(g=1,CONVERT(b USING binary),'999x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(IFNULL(b,'123x') USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[0,0,149]]],["SELECT CAST(CONVERT(CONCAT(b) USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]]]],
  ["LONGBLOB",[["SELECT CAST(CONVERT(b USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING utf8mb4) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(b USING latin1) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(IF(g=1,CONVERT(b USING binary),'999x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]],["SELECT CAST(CONVERT(IFNULL(b,'123x') USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[0,0,149]]],["SELECT CAST(CONVERT(CONCAT(b) USING binary) AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",152,[[143,143,146],[143,143,146],[143,143,146],[147,147,148],[0,0,149],[144,144,150],[0,0,149],[0,0,149],[0,0,149],[0,0,149],[141,141,151]]]]]
]

function fields(columns: mysql.FieldPacket[]): unknown[][] {
  return columns.map(f => [f.name,f.columnType,f.columnLength,f.flags,f.decimals,f.characterSet,f.schema,f.table,f.orgTable,f.orgName])
}
async function connect() {
  const host = process.env['MYSQL_REFERENCE_HOST']
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined ? {host:host as string,user:'root',password:process.env['MYSQL_REFERENCE_PASSWORD'] ?? ''} : {stream:db.createStream(),user:'root'})
  return {db,conn}
}
async function outcome(conn: mysql.Connection, sql: string, method: 'query' | 'execute') {
  await conn.query('DO 0')
  const options = {sql,rowsAsArray:true}
  const [rows,columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
  const warnings = (await conn.query('SHOW WARNINGS'))[0]
  conn.unprepare(options)
  return [JSON.parse(JSON.stringify(rows)),fields(columns),warnings]
}

test('CONVERT USING owns DECIMAL prefixes through every byte tail and complete binary inputs', async () => {
  const {db,conn} = await connect()
  const values = [...Array.from({length:256},(_,i)=>Buffer.from([0x31,0x32,0x33,i])),...Array.from({length:4},(_,i)=>Buffer.from(' '.repeat(1023+i)+'123')),...Array.from({length:4},(_,i)=>Buffer.from('0'.repeat(1023+i)+'123')),Buffer.from(' '.repeat(4096)+'-123'),Buffer.from('0'.repeat(4096)+'123.5'),Buffer.from('0'.repeat(4096)+'123x'),Buffer.from('123'+' '.repeat(4096)),Buffer.from('123'+' '.repeat(4096)+'x'),Buffer.from('0'.repeat(200000)+'123'),Buffer.from(' '.repeat(200000)+'123'),Buffer.concat([Buffer.from('0'.repeat(4096)+'123'),Buffer.from([0,0x80,0xff])]),null]
  try {
    await conn.query('CREATE DATABASE decimal_convert73')
    await conn.query('USE decimal_convert73')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,v VARBINARY(60000))')
    for (const [id,value] of values.entries()) await conn.query('INSERT INTO t VALUES(?,?,?)',[id,value,value !== null && value.length > 60000 ? null : value])
    for (const [id,expected] of BYTE_MATRIX.entries()) for (const [s,source] of BYTE_SOURCES.entries()) {
      const sql = 'SELECT CAST('+source+' AS DECIMAL(65,0)) AS x FROM t WHERE id='+id
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),OUTCOMES[expected[s]!],method+': '+sql)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_convert73')
    await conn.end()
    await db?.end()
  }
})

test('CONVERT USING preserves DECIMAL reads across text, varchar and introduced literal sources', async () => {
  const {db,conn} = await connect()
  const values = ['',' ','abc','123x','123.45x','123e1x','123.45e1x','.5x','-0.5x','123\0x','123\x80x',...Array.from({length:8},(_,i)=>'0'.repeat([0,80,81,82,127,128,1023,1024][i]!)+'123x'),' '.repeat(4096)+'123x','0'.repeat(4096)+'123x','123'+' '.repeat(4096)+'x','0'.repeat(4096)+'123\0x', '1'.repeat(80)+'x','1'.repeat(81)+'x','1'.repeat(82)+'x','1e400x',null,'abc1','+x1','.x1','--1','NaN1','\v1','\f1']
  try {
    await conn.query('CREATE DATABASE decimal_converttext73')
    await conn.query('USE decimal_converttext73')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b MEDIUMBLOB,s MEDIUMTEXT,c VARCHAR(12000),g INT NOT NULL DEFAULT 1)')
    for (const [id,value] of values.entries()) await conn.query('INSERT INTO t(id,b,s,c) VALUES(?,?,?,?)',[id,value === null ? null : Buffer.from(value),value,value])
    for (const [id,expected] of TEXT_MATRIX) for (const [s,original] of TEXT_SOURCES.entries()) for (const [k,kind] of ['s','c','literal'].entries()) {
      const value = values[id]!
      const column = kind === 'literal' ? value === null ? 'NULL' : "_utf8mb4 X'"+Buffer.from(value).toString('hex')+"'" : kind
      const sql = 'SELECT CAST('+original.replace(/\bb\b/g,column)+' AS DECIMAL(65,0)) AS x FROM t WHERE id='+id
      for (const method of ['query','execute'] as const) assert.deepEqual(await outcome(conn,sql,method),OUTCOMES[expected[s*3+k]!],method+': '+sql)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_converttext73')
    await conn.end()
    await db?.end()
  }
})

test('CONVERT USING DECIMAL diagnostics follow fresh prepared writes across binary storage kinds', async () => {
  const {db,conn} = await connect()
  try {
    await conn.query('CREATE DATABASE decimal_convertfresh73')
    await conn.query('USE decimal_convertfresh73')
    for (const [storage,fixtures] of FRESH) {
      const values = ['',' ','abc1','0x','123x','.5x','0'.repeat(1023)+'123x','0'.repeat(1024)+'123x',' '.repeat(4096)+'123x',...(storage==='MEDIUMBLOB'||storage==='LONGBLOB'?['0'.repeat(200000)+'123x']:[]),null]
      await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b '+storage+',g INT DEFAULT 1)')
      await conn.query("INSERT INTO t VALUES(1,'1',1),(2,'1',1),(3,NULL,1)")
      for (const [sql,prepared,writes] of fixtures) {
        const options = {sql,rowsAsArray:true}
        await conn.query('DO 0')
        const stmt = await conn.prepare(options)
        try {
          const resolved = stmt as unknown as {statement:{columns:mysql.FieldPacket[]}}
          assert.deepEqual([fields(resolved.statement.columns),(await conn.query('SHOW WARNINGS'))[0]],OUTCOMES[prepared])
          for (const [id,expected] of writes.entries()) {
            const value = values[id]!
            await conn.query('UPDATE t SET b=? WHERE id=2',[value === null ? null : Buffer.from(value)])
            for (const [i,method] of (['query','execute','statement'] as const).entries()) {
              await conn.query('DO 0')
              const [rows,columns] = method === 'statement' ? await stmt.execute([1,1]) : method === 'query' ? await conn.query(options,[1,1]) : await conn.execute(options,[1,1])
              assert.deepEqual([JSON.parse(JSON.stringify(rows)),fields(columns),(await conn.query('SHOW WARNINGS'))[0]],OUTCOMES[expected[i]!],method+': '+sql)
            }
          }
        } finally {
          await stmt.close()
          conn.unprepare(options)
        }
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_convertfresh73')
    await conn.end()
    await db?.end()
  }
})
