// Complete pinned MySQL 8.4.11 fixed-field outcomes; split-multibyte message conversion and variable-field policies remain open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const m0 = [["x",246,66,128,0,63,"","","",""]]
const m1 = [["x",246,66,129,0,63,"","","",""]]
const o0 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o1 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o2 = [[["0"]],m1,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"}]]
const o3 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' \\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x0'"}]]
const o4 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o5 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o6 = [[["123"]],m0,[]]
const o7 = [[["123"]],m1,[]]
const o8 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o9 = [[["1230"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x'"}]]
const o10 = [[["1230"]],m0,[]]
const o11 = [[["1230"]],m1,[]]
const o12 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x00x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o13 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1\\x00xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o14 = [[["1"]],m0,[]]
const o15 = [[["1"]],m1,[]]
const o16 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '00000000000000000000000000000000000000000000000000000000000000000000000000000000123x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o17 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '000000000000000000000000000000000000000000000000000000000000000000000000000000000123x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x0'"}]]
const o18 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001'"}]]
const o19 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'"}]]
const o20 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\x00'"}]]
const o21 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\x0'"}]]
const o22 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\x'"}]]
const o23 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\'"}]]
const o24 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o25 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA'"}]]
const o26 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x82\\xAC\\xE2\\x8'"}]]
const o27 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x8'"}]]
const o28 = [[[null]],m0,[]]
const o29 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o30 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x01\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o31 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x02\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o32 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x03\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o33 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x04\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o34 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x05\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o35 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x06\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o36 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x07\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o37 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x08\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o38 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x09\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o39 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x0A\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o40 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x0B\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o41 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x0C\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o42 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x0D\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o43 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x0E\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o44 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x0F\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o45 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x10\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o46 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x11\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o47 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x12\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o48 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x13\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o49 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x14\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o50 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x15\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o51 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x16\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o52 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x17\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o53 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x18\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o54 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x19\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o55 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x1A\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o56 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x1B\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o57 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x1C\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o58 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x1D\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o59 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x1E\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o60 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x1F\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o61 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123 \\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o62 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123!\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o63 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\"\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o64 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123#\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o65 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123$\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o66 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123%\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o67 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123&\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o68 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123'\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o69 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123(\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o70 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123)\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o71 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123*\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o72 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123+\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o73 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123,\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o74 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123-\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o75 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o76 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123/\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o77 = [[["1230"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1230\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o78 = [[["1231"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1231\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o79 = [[["1231"]],m0,[]]
const o80 = [[["1231"]],m1,[]]
const o81 = [[["1232"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1232\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o82 = [[["1232"]],m0,[]]
const o83 = [[["1232"]],m1,[]]
const o84 = [[["1233"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1233\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o85 = [[["1233"]],m0,[]]
const o86 = [[["1233"]],m1,[]]
const o87 = [[["1234"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1234\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o88 = [[["1234"]],m0,[]]
const o89 = [[["1234"]],m1,[]]
const o90 = [[["1235"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1235\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o91 = [[["1235"]],m0,[]]
const o92 = [[["1235"]],m1,[]]
const o93 = [[["1236"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1236\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o94 = [[["1236"]],m0,[]]
const o95 = [[["1236"]],m1,[]]
const o96 = [[["1237"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1237\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o97 = [[["1237"]],m0,[]]
const o98 = [[["1237"]],m1,[]]
const o99 = [[["1238"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1238\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o100 = [[["1238"]],m0,[]]
const o101 = [[["1238"]],m1,[]]
const o102 = [[["1239"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1239\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o103 = [[["1239"]],m0,[]]
const o104 = [[["1239"]],m1,[]]
const o105 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123:\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o106 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123;\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o107 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123<\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o108 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123=\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o109 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123>\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o110 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123?\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o111 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123@\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o112 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123A\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o113 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123B\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o114 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123C\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o115 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123D\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o116 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123E\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o117 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123F\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o118 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123G\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o119 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123H\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o120 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123I\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o121 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123J\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o122 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123K\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o123 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123L\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o124 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123M\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o125 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123N\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o126 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123O\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o127 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123P\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o128 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123Q\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o129 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123R\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o130 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123S\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o131 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123T\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o132 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123U\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o133 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123V\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o134 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123W\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o135 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123X\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o136 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123Y\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o137 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123Z\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o138 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123[\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o139 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o140 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123]\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o141 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123^\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o142 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123_\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o143 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123`\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o144 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123a\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o145 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123b\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o146 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123c\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o147 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123d\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o148 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o149 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123f\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o150 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123g\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o151 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123h\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o152 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123i\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o153 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123j\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o154 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123k\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o155 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123l\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o156 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123m\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o157 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123n\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o158 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123o\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o159 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123p\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o160 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123q\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o161 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123r\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o162 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123s\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o163 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123t\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o164 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123u\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o165 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123v\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o166 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123w\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o167 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123y\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o168 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123z\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o169 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123{\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o170 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123|\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o171 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123}\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o172 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123~\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o173 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x7F\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o174 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x80\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o175 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x81\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o176 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x82\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o177 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x83\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o178 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x84\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o179 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x85\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o180 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x86\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o181 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x87\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o182 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x88\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o183 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x89\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o184 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x8A\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o185 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x8B\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o186 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x8C\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o187 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x8D\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o188 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x8E\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o189 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x8F\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o190 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x90\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o191 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x91\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o192 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x92\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o193 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x93\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o194 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x94\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o195 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x95\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o196 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x96\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o197 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x97\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o198 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x98\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o199 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x99\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o200 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x9A\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o201 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x9B\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o202 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x9C\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o203 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x9D\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o204 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x9E\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o205 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\x9F\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o206 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA0\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o207 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o208 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA2\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o209 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA3\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o210 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA4\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o211 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA5\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o212 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA6\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o213 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA7\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o214 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA8\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o215 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xA9\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o216 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xAA\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o217 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xAB\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o218 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xAC\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o219 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xAD\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o220 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xAE\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o221 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xAF\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o222 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB0\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o223 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o224 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB2\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o225 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB3\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o226 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB4\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o227 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB5\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o228 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB6\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o229 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB7\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o230 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB8\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o231 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xB9\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o232 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xBA\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o233 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xBB\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o234 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xBC\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o235 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xBD\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o236 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xBE\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o237 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xBF\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o238 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC0\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o239 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o240 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC2\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o241 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC3\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o242 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC4\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o243 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC5\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o244 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC6\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o245 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC7\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o246 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC8\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o247 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xC9\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o248 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xCA\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o249 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xCB\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o250 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xCC\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o251 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xCD\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o252 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xCE\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o253 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xCF\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o254 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD0\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o255 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o256 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD2\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o257 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD3\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o258 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD4\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o259 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD5\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o260 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD6\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o261 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD7\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o262 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD8\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o263 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xD9\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o264 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xDA\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o265 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xDB\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o266 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xDC\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o267 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xDD\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o268 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xDE\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o269 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xDF\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o270 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE0\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o271 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o272 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE2\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o273 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE3\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o274 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE4\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o275 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE5\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o276 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE6\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o277 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE7\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o278 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE8\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o279 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xE9\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o280 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xEA\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o281 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xEB\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o282 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xEC\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o283 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xED\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o284 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xEE\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o285 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xEF\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o286 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF0\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o287 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o288 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF2\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o289 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF3\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o290 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF4\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o291 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF5\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o292 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF6\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o293 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF7\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o294 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF8\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o295 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xF9\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o296 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xFA\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o297 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xFB\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o298 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xFC\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o299 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xFD\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o300 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xFE\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o301 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123\\xFF\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o302 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o303 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc'"}]]
const o304 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o305 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123.45x'"}]]
const o306 = [[["1230"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123e1x'"}]]
const o307 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123'"}]]
const o308 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1'"}]]
const o309 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '00000000000000000000000000000000000000000000000000000000000000000000000000000000123x'"}]]
const o310 = [[["123"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '000000000000000000000000000000000000000000000000000000000000000000000000000000000123x'"}]]
const o311 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o312 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o313 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o314 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o315 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx'"}]]
const o316 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx'"}]]
const o317 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x'"}]]
const o318 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x'"}]]
const o319 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1??????????????????????????????x'"}]]
const o320 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1???????????????????????????????x'"}]]
const o321 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1????????????????????????????????x'"}]]
const o322 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1?????????????????????????????????x'"}]]
const o323 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????'"}]]
const o324 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o325 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ' \\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x0'"}]]
const o326 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o327 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o328 = [[["0"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x'"}]]
const o329 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x'"}]]
const o330 = [[{"x":"123"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00'"}]]
const o331 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o332 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\'"}]]
const o333 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"}]]
const o334 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA9\\xC3\\xA'"}]]
const o335 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x80\\xF0\\x9F\\x98\\x8'"}]]
const o336 = [[{"x":null}],m0,[]]
const o337 = [m0,[]]
const o338 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: ''"}]]
const o339 = [[["0"]],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o340 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1366,"Message":"Incorrect DECIMAL value: '0' for column '' at row -1"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: 'abc1'"}]]
const o341 = [[["0"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]]
const o342 = [[{"x":"0"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '0x'"}]]
const o343 = [[{"x":"123"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '123x'"}]]
const o344 = [[["1"]],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o345 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '.5x'"}]]
const o346 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx'"}]]
const o347 = [[{"x":"1"}],m0,[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DECIMAL value: '1????????????????????????????????x'"}]]
const v0 = [o0,o0,o0,o1,o2,o1]
const v1 = [o3,o3,o3,o1,o2,o1]
const v2 = [o4,o4,o4,o1,o2,o1]
const v3 = [o5,o5,o5,o6,o7,o6]
const v4 = [o8,o8,o8,o6,o7,o6]
const v5 = [o9,o9,o9,o10,o11,o10]
const v6 = [o12,o12,o12,o6,o7,o6]
const v7 = [o13,o13,o13,o14,o15,o14]
const v8 = [o16,o16,o16,o6,o7,o6]
const v9 = [o17,o17,o17,o6,o7,o6]
const v10 = [o18,o18,o18,o6,o7,o6]
const v11 = [o19,o19,o19,o6,o7,o6]
const v12 = [o20,o20,o20,o14,o15,o14]
const v13 = [o21,o21,o21,o14,o15,o14]
const v14 = [o22,o22,o22,o14,o15,o14]
const v15 = [o23,o23,o23,o14,o15,o14]
const v16 = [o24,o24,o24,o14,o15,o14]
const v17 = [o25,o25,o25,o14,o15,o14]
const v18 = [o26,o26,o26,o14,o15,o14]
const v19 = [o27,o27,o27,o14,o15,o14]
const v20 = [o28,o28,o28,o28,o7,o28]
const v21 = [o29,o29,o29,o6,o7,o6]
const v22 = [o30,o30,o30,o6,o7,o6]
const v23 = [o31,o31,o31,o6,o7,o6]
const v24 = [o32,o32,o32,o6,o7,o6]
const v25 = [o33,o33,o33,o6,o7,o6]
const v26 = [o34,o34,o34,o6,o7,o6]
const v27 = [o35,o35,o35,o6,o7,o6]
const v28 = [o36,o36,o36,o6,o7,o6]
const v29 = [o37,o37,o37,o6,o7,o6]
const v30 = [o38,o38,o38,o6,o7,o6]
const v31 = [o39,o39,o39,o6,o7,o6]
const v32 = [o40,o40,o40,o6,o7,o6]
const v33 = [o41,o41,o41,o6,o7,o6]
const v34 = [o42,o42,o42,o6,o7,o6]
const v35 = [o43,o43,o43,o6,o7,o6]
const v36 = [o44,o44,o44,o6,o7,o6]
const v37 = [o45,o45,o45,o6,o7,o6]
const v38 = [o46,o46,o46,o6,o7,o6]
const v39 = [o47,o47,o47,o6,o7,o6]
const v40 = [o48,o48,o48,o6,o7,o6]
const v41 = [o49,o49,o49,o6,o7,o6]
const v42 = [o50,o50,o50,o6,o7,o6]
const v43 = [o51,o51,o51,o6,o7,o6]
const v44 = [o52,o52,o52,o6,o7,o6]
const v45 = [o53,o53,o53,o6,o7,o6]
const v46 = [o54,o54,o54,o6,o7,o6]
const v47 = [o55,o55,o55,o6,o7,o6]
const v48 = [o56,o56,o56,o6,o7,o6]
const v49 = [o57,o57,o57,o6,o7,o6]
const v50 = [o58,o58,o58,o6,o7,o6]
const v51 = [o59,o59,o59,o6,o7,o6]
const v52 = [o60,o60,o60,o6,o7,o6]
const v53 = [o61,o61,o61,o6,o7,o6]
const v54 = [o62,o62,o62,o6,o7,o6]
const v55 = [o63,o63,o63,o6,o7,o6]
const v56 = [o64,o64,o64,o6,o7,o6]
const v57 = [o65,o65,o65,o6,o7,o6]
const v58 = [o66,o66,o66,o6,o7,o6]
const v59 = [o67,o67,o67,o6,o7,o6]
const v60 = [o68,o68,o68,o6,o7,o6]
const v61 = [o69,o69,o69,o6,o7,o6]
const v62 = [o70,o70,o70,o6,o7,o6]
const v63 = [o71,o71,o71,o6,o7,o6]
const v64 = [o72,o72,o72,o6,o7,o6]
const v65 = [o73,o73,o73,o6,o7,o6]
const v66 = [o74,o74,o74,o6,o7,o6]
const v67 = [o75,o75,o75,o6,o7,o6]
const v68 = [o76,o76,o76,o6,o7,o6]
const v69 = [o77,o77,o77,o10,o11,o10]
const v70 = [o78,o78,o78,o79,o80,o79]
const v71 = [o81,o81,o81,o82,o83,o82]
const v72 = [o84,o84,o84,o85,o86,o85]
const v73 = [o87,o87,o87,o88,o89,o88]
const v74 = [o90,o90,o90,o91,o92,o91]
const v75 = [o93,o93,o93,o94,o95,o94]
const v76 = [o96,o96,o96,o97,o98,o97]
const v77 = [o99,o99,o99,o100,o101,o100]
const v78 = [o102,o102,o102,o103,o104,o103]
const v79 = [o105,o105,o105,o6,o7,o6]
const v80 = [o106,o106,o106,o6,o7,o6]
const v81 = [o107,o107,o107,o6,o7,o6]
const v82 = [o108,o108,o108,o6,o7,o6]
const v83 = [o109,o109,o109,o6,o7,o6]
const v84 = [o110,o110,o110,o6,o7,o6]
const v85 = [o111,o111,o111,o6,o7,o6]
const v86 = [o112,o112,o112,o6,o7,o6]
const v87 = [o113,o113,o113,o6,o7,o6]
const v88 = [o114,o114,o114,o6,o7,o6]
const v89 = [o115,o115,o115,o6,o7,o6]
const v90 = [o116,o116,o116,o6,o7,o6]
const v91 = [o117,o117,o117,o6,o7,o6]
const v92 = [o118,o118,o118,o6,o7,o6]
const v93 = [o119,o119,o119,o6,o7,o6]
const v94 = [o120,o120,o120,o6,o7,o6]
const v95 = [o121,o121,o121,o6,o7,o6]
const v96 = [o122,o122,o122,o6,o7,o6]
const v97 = [o123,o123,o123,o6,o7,o6]
const v98 = [o124,o124,o124,o6,o7,o6]
const v99 = [o125,o125,o125,o6,o7,o6]
const v100 = [o126,o126,o126,o6,o7,o6]
const v101 = [o127,o127,o127,o6,o7,o6]
const v102 = [o128,o128,o128,o6,o7,o6]
const v103 = [o129,o129,o129,o6,o7,o6]
const v104 = [o130,o130,o130,o6,o7,o6]
const v105 = [o131,o131,o131,o6,o7,o6]
const v106 = [o132,o132,o132,o6,o7,o6]
const v107 = [o133,o133,o133,o6,o7,o6]
const v108 = [o134,o134,o134,o6,o7,o6]
const v109 = [o135,o135,o135,o6,o7,o6]
const v110 = [o136,o136,o136,o6,o7,o6]
const v111 = [o137,o137,o137,o6,o7,o6]
const v112 = [o138,o138,o138,o6,o7,o6]
const v113 = [o139,o139,o139,o6,o7,o6]
const v114 = [o140,o140,o140,o6,o7,o6]
const v115 = [o141,o141,o141,o6,o7,o6]
const v116 = [o142,o142,o142,o6,o7,o6]
const v117 = [o143,o143,o143,o6,o7,o6]
const v118 = [o144,o144,o144,o6,o7,o6]
const v119 = [o145,o145,o145,o6,o7,o6]
const v120 = [o146,o146,o146,o6,o7,o6]
const v121 = [o147,o147,o147,o6,o7,o6]
const v122 = [o148,o148,o148,o6,o7,o6]
const v123 = [o149,o149,o149,o6,o7,o6]
const v124 = [o150,o150,o150,o6,o7,o6]
const v125 = [o151,o151,o151,o6,o7,o6]
const v126 = [o152,o152,o152,o6,o7,o6]
const v127 = [o153,o153,o153,o6,o7,o6]
const v128 = [o154,o154,o154,o6,o7,o6]
const v129 = [o155,o155,o155,o6,o7,o6]
const v130 = [o156,o156,o156,o6,o7,o6]
const v131 = [o157,o157,o157,o6,o7,o6]
const v132 = [o158,o158,o158,o6,o7,o6]
const v133 = [o159,o159,o159,o6,o7,o6]
const v134 = [o160,o160,o160,o6,o7,o6]
const v135 = [o161,o161,o161,o6,o7,o6]
const v136 = [o162,o162,o162,o6,o7,o6]
const v137 = [o163,o163,o163,o6,o7,o6]
const v138 = [o164,o164,o164,o6,o7,o6]
const v139 = [o165,o165,o165,o6,o7,o6]
const v140 = [o166,o166,o166,o6,o7,o6]
const v141 = [o167,o167,o167,o6,o7,o6]
const v142 = [o168,o168,o168,o6,o7,o6]
const v143 = [o169,o169,o169,o6,o7,o6]
const v144 = [o170,o170,o170,o6,o7,o6]
const v145 = [o171,o171,o171,o6,o7,o6]
const v146 = [o172,o172,o172,o6,o7,o6]
const v147 = [o173,o173,o173,o6,o7,o6]
const v148 = [o174,o174,o174,o6,o7,o6]
const v149 = [o175,o175,o175,o6,o7,o6]
const v150 = [o176,o176,o176,o6,o7,o6]
const v151 = [o177,o177,o177,o6,o7,o6]
const v152 = [o178,o178,o178,o6,o7,o6]
const v153 = [o179,o179,o179,o6,o7,o6]
const v154 = [o180,o180,o180,o6,o7,o6]
const v155 = [o181,o181,o181,o6,o7,o6]
const v156 = [o182,o182,o182,o6,o7,o6]
const v157 = [o183,o183,o183,o6,o7,o6]
const v158 = [o184,o184,o184,o6,o7,o6]
const v159 = [o185,o185,o185,o6,o7,o6]
const v160 = [o186,o186,o186,o6,o7,o6]
const v161 = [o187,o187,o187,o6,o7,o6]
const v162 = [o188,o188,o188,o6,o7,o6]
const v163 = [o189,o189,o189,o6,o7,o6]
const v164 = [o190,o190,o190,o6,o7,o6]
const v165 = [o191,o191,o191,o6,o7,o6]
const v166 = [o192,o192,o192,o6,o7,o6]
const v167 = [o193,o193,o193,o6,o7,o6]
const v168 = [o194,o194,o194,o6,o7,o6]
const v169 = [o195,o195,o195,o6,o7,o6]
const v170 = [o196,o196,o196,o6,o7,o6]
const v171 = [o197,o197,o197,o6,o7,o6]
const v172 = [o198,o198,o198,o6,o7,o6]
const v173 = [o199,o199,o199,o6,o7,o6]
const v174 = [o200,o200,o200,o6,o7,o6]
const v175 = [o201,o201,o201,o6,o7,o6]
const v176 = [o202,o202,o202,o6,o7,o6]
const v177 = [o203,o203,o203,o6,o7,o6]
const v178 = [o204,o204,o204,o6,o7,o6]
const v179 = [o205,o205,o205,o6,o7,o6]
const v180 = [o206,o206,o206,o6,o7,o6]
const v181 = [o207,o207,o207,o6,o7,o6]
const v182 = [o208,o208,o208,o6,o7,o6]
const v183 = [o209,o209,o209,o6,o7,o6]
const v184 = [o210,o210,o210,o6,o7,o6]
const v185 = [o211,o211,o211,o6,o7,o6]
const v186 = [o212,o212,o212,o6,o7,o6]
const v187 = [o213,o213,o213,o6,o7,o6]
const v188 = [o214,o214,o214,o6,o7,o6]
const v189 = [o215,o215,o215,o6,o7,o6]
const v190 = [o216,o216,o216,o6,o7,o6]
const v191 = [o217,o217,o217,o6,o7,o6]
const v192 = [o218,o218,o218,o6,o7,o6]
const v193 = [o219,o219,o219,o6,o7,o6]
const v194 = [o220,o220,o220,o6,o7,o6]
const v195 = [o221,o221,o221,o6,o7,o6]
const v196 = [o222,o222,o222,o6,o7,o6]
const v197 = [o223,o223,o223,o6,o7,o6]
const v198 = [o224,o224,o224,o6,o7,o6]
const v199 = [o225,o225,o225,o6,o7,o6]
const v200 = [o226,o226,o226,o6,o7,o6]
const v201 = [o227,o227,o227,o6,o7,o6]
const v202 = [o228,o228,o228,o6,o7,o6]
const v203 = [o229,o229,o229,o6,o7,o6]
const v204 = [o230,o230,o230,o6,o7,o6]
const v205 = [o231,o231,o231,o6,o7,o6]
const v206 = [o232,o232,o232,o6,o7,o6]
const v207 = [o233,o233,o233,o6,o7,o6]
const v208 = [o234,o234,o234,o6,o7,o6]
const v209 = [o235,o235,o235,o6,o7,o6]
const v210 = [o236,o236,o236,o6,o7,o6]
const v211 = [o237,o237,o237,o6,o7,o6]
const v212 = [o238,o238,o238,o6,o7,o6]
const v213 = [o239,o239,o239,o6,o7,o6]
const v214 = [o240,o240,o240,o6,o7,o6]
const v215 = [o241,o241,o241,o6,o7,o6]
const v216 = [o242,o242,o242,o6,o7,o6]
const v217 = [o243,o243,o243,o6,o7,o6]
const v218 = [o244,o244,o244,o6,o7,o6]
const v219 = [o245,o245,o245,o6,o7,o6]
const v220 = [o246,o246,o246,o6,o7,o6]
const v221 = [o247,o247,o247,o6,o7,o6]
const v222 = [o248,o248,o248,o6,o7,o6]
const v223 = [o249,o249,o249,o6,o7,o6]
const v224 = [o250,o250,o250,o6,o7,o6]
const v225 = [o251,o251,o251,o6,o7,o6]
const v226 = [o252,o252,o252,o6,o7,o6]
const v227 = [o253,o253,o253,o6,o7,o6]
const v228 = [o254,o254,o254,o6,o7,o6]
const v229 = [o255,o255,o255,o6,o7,o6]
const v230 = [o256,o256,o256,o6,o7,o6]
const v231 = [o257,o257,o257,o6,o7,o6]
const v232 = [o258,o258,o258,o6,o7,o6]
const v233 = [o259,o259,o259,o6,o7,o6]
const v234 = [o260,o260,o260,o6,o7,o6]
const v235 = [o261,o261,o261,o6,o7,o6]
const v236 = [o262,o262,o262,o6,o7,o6]
const v237 = [o263,o263,o263,o6,o7,o6]
const v238 = [o264,o264,o264,o6,o7,o6]
const v239 = [o265,o265,o265,o6,o7,o6]
const v240 = [o266,o266,o266,o6,o7,o6]
const v241 = [o267,o267,o267,o6,o7,o6]
const v242 = [o268,o268,o268,o6,o7,o6]
const v243 = [o269,o269,o269,o6,o7,o6]
const v244 = [o270,o270,o270,o6,o7,o6]
const v245 = [o271,o271,o271,o6,o7,o6]
const v246 = [o272,o272,o272,o6,o7,o6]
const v247 = [o273,o273,o273,o6,o7,o6]
const v248 = [o274,o274,o274,o6,o7,o6]
const v249 = [o275,o275,o275,o6,o7,o6]
const v250 = [o276,o276,o276,o6,o7,o6]
const v251 = [o277,o277,o277,o6,o7,o6]
const v252 = [o278,o278,o278,o6,o7,o6]
const v253 = [o279,o279,o279,o6,o7,o6]
const v254 = [o280,o280,o280,o6,o7,o6]
const v255 = [o281,o281,o281,o6,o7,o6]
const v256 = [o282,o282,o282,o6,o7,o6]
const v257 = [o283,o283,o283,o6,o7,o6]
const v258 = [o284,o284,o284,o6,o7,o6]
const v259 = [o285,o285,o285,o6,o7,o6]
const v260 = [o286,o286,o286,o6,o7,o6]
const v261 = [o287,o287,o287,o6,o7,o6]
const v262 = [o288,o288,o288,o6,o7,o6]
const v263 = [o289,o289,o289,o6,o7,o6]
const v264 = [o290,o290,o290,o6,o7,o6]
const v265 = [o291,o291,o291,o6,o7,o6]
const v266 = [o292,o292,o292,o6,o7,o6]
const v267 = [o293,o293,o293,o6,o7,o6]
const v268 = [o294,o294,o294,o6,o7,o6]
const v269 = [o295,o295,o295,o6,o7,o6]
const v270 = [o296,o296,o296,o6,o7,o6]
const v271 = [o297,o297,o297,o6,o7,o6]
const v272 = [o298,o298,o298,o6,o7,o6]
const v273 = [o299,o299,o299,o6,o7,o6]
const v274 = [o300,o300,o300,o6,o7,o6]
const v275 = [o301,o301,o301,o6,o7,o6]
const v276 = [o302,o302,o302,o1,o2,o1]
const v277 = [o303,o303,o303,o1,o2,o1]
const v278 = [o304,o304,o304,o6,o7,o6]
const v279 = [o305,o305,o305,o6,o7,o6]
const v280 = [o306,o306,o306,o10,o11,o10]
const v281 = [o307,o307,o307,o6,o7,o6]
const v282 = [o308,o308,o308,o14,o15,o14]
const v283 = [o309,o309,o309,o6,o7,o6]
const v284 = [o310,o310,o310,o6,o7,o6]
const v285 = [o311,o311,o311,o14,o15,o14]
const v286 = [o312,o312,o312,o14,o15,o14]
const v287 = [o313,o313,o313,o14,o15,o14]
const v288 = [o314,o314,o314,o14,o15,o14]
const v289 = [o315,o315,o315,o14,o15,o14]
const v290 = [o316,o316,o316,o14,o15,o14]
const v291 = [o317,o317,o317,o14,o15,o14]
const v292 = [o318,o318,o318,o14,o15,o14]
const v293 = [o319,o319,o319,o14,o15,o14]
const v294 = [o320,o320,o320,o14,o15,o14]
const v295 = [o321,o321,o321,o14,o15,o14]
const v296 = [o322,o322,o322,o14,o15,o14]
const v297 = [o323,o323,o323,o14,o15,o14]
const f0: [string | null, unknown[], unknown[]][] = [
      ["",o0,o324],
      [" ",o3,o325],
      ["abc1",o326,o327],
      ["0x",o328,o329],
      ["123x",o5,o330],
      [".5x",o331,o332],
      ["1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",o24,o333],
      ["1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",o25,o334],
      ["1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",o27,o335],
      [null,o28,o336],
]
const f1: [string | null, unknown[], unknown[]][] = [
      ["",o302,o338],
      [" ",o302,o338],
      ["abc1",o339,o340],
      ["0x",o341,o342],
      ["123x",o304,o343],
      [".5x",o344,o345],
      ["1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",o24,o333],
      ["1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",o315,o346],
      ["1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",o321,o347],
      [null,o28,o336],
]
const f2: [string | null, unknown[], unknown[]][] = [
      ["",o302,o338],
      [" ",o302,o338],
      ["abc1",o339,o340],
      ["0x",o341,o342],
      ["123x",o304,o343],
      [".5x",o344,o345],
      ["1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",o24,o333],
      ["1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",o315,o346],
      [null,o28,o336],
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

test('fixed CHAR/BINARY DECIMAL fields retain source-owned caps, padding, warning order and every byte', async () => {
  const { db, conn } = await connect()
  const sources = ["CAST(x AS DECIMAL(65,0))","CAST(IF(g=1,x,'123x') AS DECIMAL(65,0))","CAST(NULLIF(x,'zz') AS DECIMAL(65,0))","CAST(CONCAT(x) AS DECIMAL(65,0))","CAST(COALESCE(x,'123x') AS DECIMAL(65,0))","CAST(GREATEST(x,'') AS DECIMAL(65,0))"]
  const fixtures: [string, string | null | { type: 'Buffer'; data: number[] }, unknown[]][] = [
    ["BINARY(255)","",v0],
    ["BINARY(255)"," ",v1],
    ["BINARY(255)","abc",v2],
    ["BINARY(255)","123x",v3],
    ["BINARY(255)","123.45x",v4],
    ["BINARY(255)","123e1x",v5],
    ["BINARY(255)","123\u0000x",v6],
    ["BINARY(255)","1\u0000xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v7],
    ["BINARY(255)","00000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v8],
    ["BINARY(255)","000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v9],
    ["BINARY(255)","0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v10],
    ["BINARY(255)","00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v11],
    ["BINARY(255)","000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v11],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v12],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v13],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v14],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v15],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["BINARY(255)","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["BINARY(255)","1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v17],
    ["BINARY(255)","1éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v17],
    ["BINARY(255)","1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v17],
    ["BINARY(255)","1éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v17],
    ["BINARY(255)","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v18],
    ["BINARY(255)","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v18],
    ["BINARY(255)","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v18],
    ["BINARY(255)","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v18],
    ["BINARY(255)","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v19],
    ["BINARY(255)","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v19],
    ["BINARY(255)","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v19],
    ["BINARY(255)","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v19],
    ["BINARY(255)",null,v20],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,0]},v21],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,1]},v22],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,2]},v23],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,3]},v24],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,4]},v25],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,5]},v26],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,6]},v27],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,7]},v28],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,8]},v29],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,9]},v30],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,10]},v31],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,11]},v32],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,12]},v33],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,13]},v34],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,14]},v35],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,15]},v36],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,16]},v37],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,17]},v38],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,18]},v39],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,19]},v40],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,20]},v41],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,21]},v42],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,22]},v43],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,23]},v44],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,24]},v45],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,25]},v46],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,26]},v47],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,27]},v48],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,28]},v49],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,29]},v50],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,30]},v51],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,31]},v52],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,32]},v53],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,33]},v54],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,34]},v55],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,35]},v56],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,36]},v57],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,37]},v58],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,38]},v59],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,39]},v60],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,40]},v61],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,41]},v62],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,42]},v63],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,43]},v64],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,44]},v65],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,45]},v66],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,46]},v67],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,47]},v68],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,48]},v69],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,49]},v70],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,50]},v71],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,51]},v72],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,52]},v73],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,53]},v74],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,54]},v75],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,55]},v76],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,56]},v77],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,57]},v78],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,58]},v79],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,59]},v80],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,60]},v81],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,61]},v82],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,62]},v83],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,63]},v84],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,64]},v85],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,65]},v86],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,66]},v87],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,67]},v88],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,68]},v89],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,69]},v90],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,70]},v91],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,71]},v92],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,72]},v93],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,73]},v94],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,74]},v95],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,75]},v96],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,76]},v97],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,77]},v98],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,78]},v99],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,79]},v100],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,80]},v101],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,81]},v102],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,82]},v103],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,83]},v104],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,84]},v105],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,85]},v106],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,86]},v107],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,87]},v108],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,88]},v109],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,89]},v110],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,90]},v111],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,91]},v112],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,92]},v113],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,93]},v114],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,94]},v115],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,95]},v116],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,96]},v117],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,97]},v118],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,98]},v119],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,99]},v120],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,100]},v121],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,101]},v122],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,102]},v123],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,103]},v124],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,104]},v125],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,105]},v126],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,106]},v127],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,107]},v128],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,108]},v129],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,109]},v130],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,110]},v131],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,111]},v132],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,112]},v133],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,113]},v134],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,114]},v135],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,115]},v136],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,116]},v137],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,117]},v138],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,118]},v139],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,119]},v140],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,120]},v3],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,121]},v141],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,122]},v142],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,123]},v143],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,124]},v144],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,125]},v145],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,126]},v146],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,127]},v147],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,128]},v148],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,129]},v149],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,130]},v150],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,131]},v151],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,132]},v152],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,133]},v153],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,134]},v154],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,135]},v155],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,136]},v156],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,137]},v157],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,138]},v158],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,139]},v159],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,140]},v160],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,141]},v161],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,142]},v162],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,143]},v163],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,144]},v164],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,145]},v165],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,146]},v166],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,147]},v167],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,148]},v168],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,149]},v169],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,150]},v170],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,151]},v171],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,152]},v172],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,153]},v173],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,154]},v174],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,155]},v175],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,156]},v176],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,157]},v177],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,158]},v178],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,159]},v179],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,160]},v180],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,161]},v181],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,162]},v182],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,163]},v183],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,164]},v184],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,165]},v185],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,166]},v186],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,167]},v187],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,168]},v188],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,169]},v189],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,170]},v190],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,171]},v191],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,172]},v192],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,173]},v193],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,174]},v194],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,175]},v195],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,176]},v196],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,177]},v197],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,178]},v198],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,179]},v199],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,180]},v200],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,181]},v201],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,182]},v202],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,183]},v203],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,184]},v204],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,185]},v205],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,186]},v206],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,187]},v207],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,188]},v208],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,189]},v209],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,190]},v210],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,191]},v211],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,192]},v212],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,193]},v213],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,194]},v214],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,195]},v215],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,196]},v216],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,197]},v217],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,198]},v218],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,199]},v219],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,200]},v220],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,201]},v221],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,202]},v222],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,203]},v223],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,204]},v224],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,205]},v225],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,206]},v226],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,207]},v227],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,208]},v228],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,209]},v229],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,210]},v230],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,211]},v231],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,212]},v232],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,213]},v233],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,214]},v234],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,215]},v235],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,216]},v236],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,217]},v237],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,218]},v238],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,219]},v239],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,220]},v240],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,221]},v241],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,222]},v242],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,223]},v243],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,224]},v244],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,225]},v245],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,226]},v246],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,227]},v247],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,228]},v248],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,229]},v249],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,230]},v250],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,231]},v251],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,232]},v252],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,233]},v253],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,234]},v254],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,235]},v255],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,236]},v256],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,237]},v257],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,238]},v258],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,239]},v259],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,240]},v260],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,241]},v261],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,242]},v262],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,243]},v263],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,244]},v264],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,245]},v265],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,246]},v266],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,247]},v267],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,248]},v268],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,249]},v269],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,250]},v270],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,251]},v271],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,252]},v272],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,253]},v273],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,254]},v274],
    ["BINARY(255)",{"type":"Buffer","data":[49,50,51,255]},v275],
    ["BINARY(255)",{"type":"Buffer","data":[49,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,0,128,255]},v13],
    ["BINARY(255)",{"type":"Buffer","data":[49,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,0,128,255]},v14],
    ["BINARY(255)",{"type":"Buffer","data":[49,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,0,128,255]},v15],
    ["BINARY(255)",{"type":"Buffer","data":[49,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,0,128,255]},v16],
    ["BINARY(255)",{"type":"Buffer","data":[49,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,120,0,128,255]},v16],
    ["CHAR(255) CHARACTER SET utf8mb4","",v276],
    ["CHAR(255) CHARACTER SET utf8mb4"," ",v276],
    ["CHAR(255) CHARACTER SET utf8mb4","abc",v277],
    ["CHAR(255) CHARACTER SET utf8mb4","123x",v278],
    ["CHAR(255) CHARACTER SET utf8mb4","123.45x",v279],
    ["CHAR(255) CHARACTER SET utf8mb4","123e1x",v280],
    ["CHAR(255) CHARACTER SET utf8mb4","123\u0000x",v281],
    ["CHAR(255) CHARACTER SET utf8mb4","1\u0000xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v282],
    ["CHAR(255) CHARACTER SET utf8mb4","00000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v283],
    ["CHAR(255) CHARACTER SET utf8mb4","000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v284],
    ["CHAR(255) CHARACTER SET utf8mb4","0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v10],
    ["CHAR(255) CHARACTER SET utf8mb4","00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v11],
    ["CHAR(255) CHARACTER SET utf8mb4","000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v11],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v285],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v286],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v287],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v288],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["CHAR(255) CHARACTER SET utf8mb4","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["CHAR(255) CHARACTER SET utf8mb4","1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v289],
    ["CHAR(255) CHARACTER SET utf8mb4","1éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v290],
    ["CHAR(255) CHARACTER SET utf8mb4","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v291],
    ["CHAR(255) CHARACTER SET utf8mb4","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v292],
    ["CHAR(255) CHARACTER SET utf8mb4","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v293],
    ["CHAR(255) CHARACTER SET utf8mb4","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v294],
    ["CHAR(255) CHARACTER SET utf8mb4","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v295],
    ["CHAR(255) CHARACTER SET utf8mb4","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v296],
    ["CHAR(255) CHARACTER SET utf8mb4","1😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀x",v297],
    ["CHAR(255) CHARACTER SET utf8mb4",null,v20],
    ["CHAR(255) CHARACTER SET latin1","",v276],
    ["CHAR(255) CHARACTER SET latin1"," ",v276],
    ["CHAR(255) CHARACTER SET latin1","abc",v277],
    ["CHAR(255) CHARACTER SET latin1","123x",v278],
    ["CHAR(255) CHARACTER SET latin1","123.45x",v279],
    ["CHAR(255) CHARACTER SET latin1","123e1x",v280],
    ["CHAR(255) CHARACTER SET latin1","123\u0000x",v281],
    ["CHAR(255) CHARACTER SET latin1","1\u0000xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v282],
    ["CHAR(255) CHARACTER SET latin1","00000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v283],
    ["CHAR(255) CHARACTER SET latin1","000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v284],
    ["CHAR(255) CHARACTER SET latin1","0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v10],
    ["CHAR(255) CHARACTER SET latin1","00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v11],
    ["CHAR(255) CHARACTER SET latin1","000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000123x",v11],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v285],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v286],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v287],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v288],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["CHAR(255) CHARACTER SET latin1","1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",v16],
    ["CHAR(255) CHARACTER SET latin1","1ééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v289],
    ["CHAR(255) CHARACTER SET latin1","1éééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééééx",v290],
    ["CHAR(255) CHARACTER SET latin1","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v291],
    ["CHAR(255) CHARACTER SET latin1","1€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€x",v292],
    ["CHAR(255) CHARACTER SET latin1",null,v20],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_fixed69')
    await conn.query('USE decimal_fixed69')
    for (const type of ["BINARY(255)","CHAR(255) CHARACTER SET utf8mb4","CHAR(255) CHARACTER SET latin1"]) {
      await conn.query('CREATE TABLE t(id INT PRIMARY KEY,x ' + type + ',g INT DEFAULT 1)')
      for (const [storage,value,results] of fixtures) {
        if (storage !== type) continue
        const input = value !== null && typeof value !== 'string' ? Buffer.from(value.data) : type.startsWith('BINARY') && value !== null ? Buffer.from(value) : value
        await conn.query('INSERT INTO t(id,x) VALUES(1,?)',[input])
        for (const [i,source] of sources.entries()) {
          const sql = 'SELECT ' + source + ' AS x FROM t WHERE id=1'
          for (const method of ['query','execute'] as const) {
            await conn.query('DO 0')
            assert.deepEqual(await outcome(conn,sql,method),results[i],storage + ': ' + method + ': ' + sql)
          }
          conn.unprepare({sql,rowsAsArray:true})
        }
        await conn.query('DELETE FROM t')
      }
      await conn.query('DROP TABLE t')
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS decimal_fixed69')
    await conn.end()
    await db?.end()
  }
})

test('fixed CHAR/BINARY DECIMAL fields follow fresh cached byte and NULL writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, string, unknown[], [string | null, unknown[], unknown[]][]][] = [
    ["BINARY(255)","SELECT CAST(x AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f0],
    ["BINARY(255)","SELECT CAST(IF(g=1,x,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f0],
    ["BINARY(255)","SELECT CAST(NULLIF(x,'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f0],
    ["CHAR(255) CHARACTER SET utf8mb4","SELECT CAST(x AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f1],
    ["CHAR(255) CHARACTER SET utf8mb4","SELECT CAST(IF(g=1,x,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f1],
    ["CHAR(255) CHARACTER SET utf8mb4","SELECT CAST(NULLIF(x,'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f1],
    ["CHAR(255) CHARACTER SET latin1","SELECT CAST(x AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f2],
    ["CHAR(255) CHARACTER SET latin1","SELECT CAST(IF(g=1,x,'123x') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f2],
    ["CHAR(255) CHARACTER SET latin1","SELECT CAST(NULLIF(x,'zz') AS DECIMAL(65,0)) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",o337,f2],
  ]
  try {
    await conn.query('CREATE DATABASE decimal_fixedfresh69')
    await conn.query('USE decimal_fixedfresh69')
    for (const [storage, sql, prepare, writes] of fixtures) {
      await conn.query(`CREATE TABLE t(id INT PRIMARY KEY,x ${storage},g INT DEFAULT 1)`)
      await conn.query("INSERT INTO t VALUES(1,'1',1),(2,'1',1),(3,NULL,1)")
      const options = { sql, rowsAsArray: true }
      await conn.query('DO 0')
      const stmt = await conn.prepare(options)
      try {
        const prepared = stmt as unknown as { statement: { columns: mysql.FieldPacket[] } }
        assert.deepEqual([fields(prepared.statement.columns), (await conn.query('SHOW WARNINGS'))[0]], prepare)
        for (const [value, expected, objects] of writes) {
          await conn.query('UPDATE t SET x=? WHERE id=2', [storage.startsWith('BINARY') && value !== null ? Buffer.from(value) : value])
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
    await conn.query('DROP DATABASE IF EXISTS decimal_fixedfresh69')
    await conn.end()
    await db?.end()
  }
})
