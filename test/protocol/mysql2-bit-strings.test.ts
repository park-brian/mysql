// BIT columns, and bytes read as text, as 8.4.11 answered each statement:
// the second review's BIT findings.
//
// A BIT is a number in arithmetic and its bytes in a string: CONCAT of one
// is binary, and CAST of one AS CHAR reads its bytes in the target charset,
// as CAST of any bytes does. Bytes that are no text there are NULL with 1300
// (CAST(X'C3A9' AS CHAR) is 'é'; it was read as Latin-1, 'Ã©'). Text stored
// into a BIT is its bytes, so '1' is 49. A value too wide is "too long",
// 1406, refused in a strict mode, a warning under IGNORE, and 1264 outside a
// strict mode. MAX and MIN of a BIT carry no BINARY flag. BIN and OCT read
// their argument as base-10 text up to its first non-digit. IF, COALESCE
// and IFNULL over a BIT answer erratically on 8.4.11 and are left out.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]
type Outcome = Rows | readonly [Rows, string] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE b (id INT, v BIT(10), w BIT(64), x BIT(1))", [0,0,"",0]],
  ["INSERT INTO b VALUES (1, b'1010000001', 18446744073709551615, 1), (2, 5, 0, 0), (3, NULL, x'FF', b'1')", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, v, w, x FROM b ORDER BY id", [[["1","\u0002�","��������","\u0001"],["2","\u0000\u0005","\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000","\u0000"],["3",null,"\u0000\u0000\u0000\u0000\u0000\u0000\u0000�","\u0001"]],"3/11/0/0 16/10/32/0 16/64/32/0 16/1/32/0"]],
  ["SELECT id, v+0, w+0, x+0, HEX(v), BIN(v), v = 641, v = b'1010000001', w = -1 FROM b ORDER BY id", [[["1","641","18446744073709551615","1","281","1010000001","1","1","0"],["2","5","0","0","5","101","0","0","0"],["3",null,"255","1",null,null,null,null,"0"]],"3/11/0/0 8/11/160/0 8/65/160/0 8/2/160/0 253/64/0/31 253/260/0/31 8/1/128/0 8/1/128/0 8/1/128/0"]],
  ["SELECT SUM(v), MAX(v), MIN(w), AVG(v), BIT_OR(v), COUNT(DISTINCT x) FROM b", [[["646","\u0002�","\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000","323.0000","645","2"]],"246/33/128/0 16/10/32/0 16/64/32/0 246/16/128/4 8/21/161/0 8/21/129/0"]],
  ["SELECT MAX(v) + 0, MIN(v) + 0 FROM b", [[["641","5"]],"8/11/160/0 8/11/160/0"]],
  ["SELECT CAST(v AS UNSIGNED), CAST(w AS SIGNED), CAST(v AS CHAR), CONCAT(v), JSON_ARRAY(v), JSON_OBJECT('w', w) FROM b ORDER BY id", [[["641","-1",null,"\u0002�","base64:type16:AoE=","[object Object]"],["5","0","\u0000\u0005","\u0000\u0005","base64:type16:AAU=","[object Object]"],[null,"255",null,null,"","[object Object]"]],"8/21/160/0 8/21/128/0 253/40/0/31 253/10/128/31 245/4294967292/128/31 245/4294967292/128/31"]],
  ["SELECT id FROM b ORDER BY v DESC, id", [[["1"],["2"],["3"]],"3/11/0/0"]],
  ["SELECT id FROM b WHERE v > 100 ORDER BY id", [[["1"]],"3/11/0/0"]],
  ["SELECT id FROM b WHERE v IN (5, 641) ORDER BY id", [[["1"],["2"]],"3/11/0/0"]],
  ["SELECT id FROM b WHERE v = '5'", [[["2"]],"3/11/0/0"]],
  ["SELECT id FROM b WHERE v BETWEEN 1 AND 10", [[["2"]],"3/11/0/0"]],
  ["SELECT v | 0, v & 1, v >> 1, ~x FROM b ORDER BY id", [[["641","1","320","18446744073709551614"],["5","1","2","18446744073709551615"],[null,null,null,"18446744073709551614"]],"8/21/160/0 8/21/160/0 8/21/160/0 8/21/160/0"]],
  ["SELECT x FROM b WHERE x", [[["\u0001"],["\u0001"]],"16/1/32/0"]],
  ["SELECT x, NOT x FROM b ORDER BY id", [[["\u0001","0"],["\u0000","1"],["\u0001","0"]],"16/1/32/0 8/1/128/0"]],
  ["INSERT INTO b (id, v) VALUES (4, 1024)", [1406,"Data too long for column 'v' at row 1"]],
  ["INSERT INTO b (id, v) VALUES (5, '1')", [1,0,"",0]],
  ["INSERT INTO b (id, v) VALUES (6, -1)", [1406,"Data too long for column 'v' at row 1"]],
  ["INSERT INTO b (id, v) VALUES (7, 1.5)", [1,0,"",0]],
  ["INSERT INTO b (id, x) VALUES (8, 2)", [1406,"Data too long for column 'x' at row 1"]],
  ["INSERT INTO b (id, v) VALUES (9, x'03FF')", [1,0,"",0]],
  ["INSERT INTO b (id, v) VALUES (10, x'0400')", [1406,"Data too long for column 'v' at row 1"]],
  ["SELECT id, v+0 FROM b WHERE id > 3 ORDER BY id", [[["5","49"],["7","2"],["9","1023"]],"3/11/0/0 8/11/160/0"]],
  ["SELECT v + 0 FROM (SELECT v FROM b WHERE id = 1) d", [[["641"]],"8/11/160/0"]],
  ["SELECT (SELECT v FROM b WHERE id = 1) + 0", [[["641"]],"8/11/160/0"]],
  ["SELECT v FROM b WHERE id = 1 UNION SELECT 1", [[["641"],["1"]],"246/11/0/0"]],
  ["SELECT BIN(5), BIN(-1), BIN('12x'), BIN(NULL), BIN(2.7), OCT(8), OCT(-1), BIN(X'41'), BIN(''), BIN(' -3')", [[["101","1111111111111111111111111111111111111111111111111111111111111111","1100",null,"10","10","1777777777777777777777","1000001",null,"1111111111111111111111111111111111111111111111111111111111111101"]],"253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31 253/260/0/31"]],
  ["INSERT IGNORE INTO b (id, v) VALUES (11, 1024)", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1406","Data too long for column 'v' at row 1"]]],
  ["INSERT IGNORE INTO b (id, v) VALUES (12, 'abc')", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1406","Data too long for column 'v' at row 1"]]],
  ["SET sql_mode = ''", [0,0,"",0]],
  ["INSERT INTO b (id, v) VALUES (13, 5000)", [1,0,"",1]],
  ["SHOW WARNINGS", [["Warning","1264","Out of range value for column 'v' at row 1"]]],
  ["SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'", [0,0,"",1]],
  ["SELECT id, v + 0 FROM b WHERE id > 10 ORDER BY id", [[["11","1023"],["12","1023"],["13","1023"]],"3/11/0/0 8/11/160/0"]],
  ["SELECT CAST(X'0281' AS CHAR), CAST(X'0005' AS CHAR), CONCAT(X'0281'), CONCAT('a', X'0281'), CAST(X'C3A9' AS CHAR), CAST(X'FF' AS CHAR CHARACTER SET latin1), CAST(X'E9' AS CHAR), CAST(X'41E9' AS CHAR)", [[[null,"\u0000\u0005","\u0002�","a\u0002�","é","ÿ",null,null]],"253/8/0/31 253/8/0/31 253/2/128/31 253/6/128/31 253/8/0/31 253/4/0/31 253/4/0/31 253/8/0/31"]],
  ["SHOW WARNINGS", [["Warning","1300","Invalid utf8mb4 character string: '81'"],["Warning","1300","Invalid utf8mb4 character string: 'E9'"],["Warning","1300","Invalid utf8mb4 character string: 'E9'"]]],
  ["DROP TABLE b", [0,0,"",0]],
]

test('BIT columns in strings, in storage and under BIN and OCT answer every statement of the script as 8.4.11 did, metadata included', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r, fields] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) {
          const rows = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
          actual = sql.startsWith('SHOW') ? rows : [rows, (fields as mysql.FieldPacket[]).map((f) => `${f.columnType}/${f.columnLength}/${f.flags}/${f.decimals}`).join(' ')]
        }
        else {
          const h = r as mysql.ResultSetHeader
          actual = [h.affectedRows, Number(h.insertId), h.info, h.warningStatus]
        }
      } catch (e) {
        const err = e as { errno: number; message: string }
        actual = [err.errno, err.message.replace(/#sql-[0-9a-f]+_[0-9a-f]+/g, '#sql-…')]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})
