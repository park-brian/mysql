// A BIT through IF, CASE, COALESCE, IFNULL and GREATEST, as 8.4.11 answered
// each of these through both protocols, metadata included.
//
// What it pins: beside another integer a BIT makes a DECIMAL of as many
// digits as it has bits; beside text, a VARBINARY as wide; beside BITs, the
// widest BIT. Numerically the value is the BIT's number everywhere. As text
// it differs by function: IF and CASE hand on the BIT's own bytes (`val_str`
// passes them through), so a DECIMAL column carries the byte 0x05, while
// COALESCE and IFNULL convert, so BITs alone send the number's digits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]

/** Each statement: its rows through `query`, through `execute`, and its fields as type/length/charset/flags/decimals. */
const SCRIPT: readonly (readonly [string, Rows, Rows, string])[] = [
  ["SELECT IF(1, x, 0) a, COALESCE(x, 0) b, IFNULL(x, 0) c, IF(1, x, x) d, COALESCE(x) e, IFNULL(x, x) f, IF(1, x, 'a') g, COALESCE(x, 'a') h, IFNULL(x, 1.5) i, COALESCE(x, y) j, IF(1, x, y) k, CASE WHEN 1 THEN x ELSE 0 END l, CASE WHEN 1 THEN x END m, COALESCE(x, NULL) n, GREATEST(x, 0) o FROM b ORDER BY id", [["\u0005","5","5","0x05","0x35","0x35","0x05","0x05","5.0","0x35","0x05","\u0005","0x05","0x35","5"],[null,"0","0",null,null,null,null,"0x61","1.5","0x33",null,null,null,null,null]], [["\u0005","5","5","0x05","0x35","0x35","0x05","0x05","5.0","0x35","0x05","\u0005","0x05","0x35","5"],[null,"0","0",null,null,null,null,"0x61","1.5","0x33",null,null,null,null,null]], "246/9/63/128/0 246/9/63/129/0 246/9/63/129/0 16/8/63/32/0 16/8/63/32/0 16/8/63/32/0 253/8/63/128/31 253/8/63/129/31 246/11/63/129/1 16/12/63/32/0 16/12/63/32/0 246/9/63/128/0 16/8/63/32/0 16/8/63/32/0 246/9/63/128/0"],
  ["SELECT IF(1, x, 0) = 5, IF(1, x, 0) + 1, COALESCE(x) = 5, COALESCE(x) + 1, IF(1, x, x) + 1, IF(1, x, 'a') = 'a', CASE WHEN 1 THEN x ELSE 0 END * 2, COALESCE(x, 'a') = 5, HEX(IF(1, x, 0)), HEX(COALESCE(x)), CONCAT(IF(1, x, 0)), LENGTH(COALESCE(x, y)) FROM b ORDER BY id", [["1","6","1","6","6","0","10","0","5","5","\u0005","1"],[null,null,null,null,null,null,null,"0",null,null,null,"1"]], [["1","6","1","6","6","0","10","0","5","5","\u0005","1"],[null,null,null,null,null,null,null,"0",null,null,null,"1"]], "8/1/63/128/0 246/10/63/128/0 8/1/63/128/0 8/9/63/160/0 8/9/63/160/0 8/1/63/128/0 246/10/63/128/0 8/1/63/129/0 253/64/224/0/31 253/64/224/0/31 253/36/224/0/31 8/10/63/128/0"],
  ["SELECT id FROM b WHERE IF(1, x, 0) = 5", [["1"]], [["1"]], "3/11/63/20483/0"],
  ["SELECT id FROM b WHERE COALESCE(x, 0) = 5", [["1"]], [["1"]], "3/11/63/20483/0"],
]

test('a BIT under IF, CASE, COALESCE and IFNULL is typed and sent as 8.4.11 does', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  const show = (v: unknown): string | null => (v === null ? null : v instanceof Uint8Array ? `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}` : String(v))
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query('CREATE TABLE b (id INT PRIMARY KEY, x BIT(8), y BIT(12))')
    await conn.query("INSERT INTO b VALUES (1, b'101', b'100000001'), (2, NULL, b'11')")
    for (const [sql, text, binary, fields] of SCRIPT) {
      const [r1, f1] = await conn.query({ sql, rowsAsArray: true })
      const [r2] = await conn.execute({ sql, rowsAsArray: true })
      assert.deepEqual((r1 as unknown[][]).map((r) => r.map(show)), text, sql)
      assert.deepEqual((r2 as unknown[][]).map((r) => r.map(show)), binary, `${sql} (binary)`)
      assert.equal(f1.map((x) => `${x.columnType}/${x.columnLength}/${x.characterSet}/${x.flags}/${x.decimals}`).join(' '), fields, `${sql} (fields)`)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
