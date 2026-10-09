// RAND, as 8.4.11 answered each of these statements.
//
// What it pins: MySQL's own generator (`randominit` and `my_rnd`), so a seed
// gives the server's sequence. The seed is read as an integer (1.7 is 2, '3'
// is 3, NULL is 0) and kept to 32 bits (2^32 is 0). One that reads no column,
// a user variable included, seeds once a statement and the rows take the
// sequence; one that reads the row seeds again for each. ORDER BY RAND(n) is
// therefore reproducible.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["SELECT RAND(1), RAND(1), RAND(0), RAND(-1), RAND(4294967296), RAND(NULL), RAND(1.7), RAND('3')", [["0.40540353712197724","0.40540353712197724","0.15522042769493574","0.9050373219931845","0.15522042769493574","0.15522042769493574","0.6555866465490187","0.9057697559760601"]]],
  ["CREATE TABLE r (id INT PRIMARY KEY)", [0,0,"",0]],
  ["INSERT INTO r VALUES (1),(2),(3)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, RAND(5) FROM r ORDER BY id", [["1","0.40613597483014313"],["2","0.8745439358749836"],["3","0.15431178561813363"]]],
  ["SELECT id, RAND(id) FROM r ORDER BY id", [["1","0.40540353712197724"],["2","0.6555866465490187"],["3","0.9057697559760601"]]],
  ["SELECT id FROM r ORDER BY RAND(7)", [["3"],["2"],["1"]]],
  ["SELECT RAND() < 1, RAND() >= 0", [["1","1"]]],
  ["SET @s = 3", [0,0,"",0]],
  ["SELECT id, RAND(@s) FROM r ORDER BY id", [["1","0.9057697559760601"],["2","0.37307905813034536"],["3","0.14808605345719125"]]],
  ["SELECT RAND(2, 3)", [1582,"Incorrect parameter count in the call to native function 'RAND'"]],
  ["SELECT COUNT(*) FROM r WHERE RAND() < 2", [["3"]]],
  ["SELECT id, RAND(id * 2) FROM r ORDER BY id", [["1","0.6555866465490187"],["2","0.15595286540310166"],["3","0.6563190842571847"]]],
  ["SELECT ROUND(RAND(42) * 100), ROUND(RAND(42) * 100)", [["66","66"]]],
]

test('RAND gives the sequences 8.4.11 gives, seeded as it seeds them', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : typeof v === 'object' ? JSON.stringify(v) : String(v))))
        else {
          const h = r as mysql.ResultSetHeader
          actual = [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
        }
      } catch (e) {
        const err = e as { errno: number; message: string }
        actual = [err.errno, err.message]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
