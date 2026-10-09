// FLOAT(M,D) and DOUBLE(M,D), as 8.4.11 answered each of these statements.
//
// The digits are a width and a fixed number of decimals. A value is rounded
// to D places as it is stored, half to even on the fraction, and refused
// (1264) past M - D digits before the point (`Field_real::truncate`). A
// column reports M as its length and D as its decimals, and prints exactly D
// places as text. Arithmetic over one keeps the largest scale
// (`aggregate_float_properties`), division adds div_precision_increment,
// and a comparison of two sides with fixed decimals is within
// 5 / 10^(D+1) (`compare_real_fixed`). A FLOAT, digits or not, prints six
// significant digits wherever it becomes text, and stays FLOAT beside the
// smaller integers. FLOAT(p) is a FLOAT to 24 bits and a DOUBLE to 53, and
// past that 1063. The digits, and UNSIGNED on an inexact type, are each a
// deprecation warning, and AUTO_INCREMENT on one is 1063.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Rows = readonly (readonly (string | null)[])[]
type Outcome = Rows | readonly [Rows, string] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE f1 (c FLOAT(3,1), d DOUBLE(4,2), e FLOAT(5,2) UNSIGNED)", [0,0,"",4]],
  ["INSERT INTO f1 (c) VALUES (99.94)", [1,0,"",0]],
  ["INSERT INTO f1 (c) VALUES (99.96)", [1264,"Out of range value for column 'c' at row 1"]],
  ["INSERT INTO f1 (c) VALUES (-99.96)", [1264,"Out of range value for column 'c' at row 1"]],
  ["INSERT INTO f1 (d) VALUES (99.999)", [1264,"Out of range value for column 'd' at row 1"]],
  ["INSERT INTO f1 (e) VALUES (-1)", [1264,"Out of range value for column 'e' at row 1"]],
  ["INSERT INTO f1 (c) VALUES (1.26)", [1,0,"",0]],
  ["SELECT * FROM f1", [[["99.9",null,null],["1.3",null,null]],"4/3/1 5/4/2 4/5/2"]],
  ["INSERT IGNORE INTO f1 (c, d) VALUES (1000, 1000)", [1,0,"",2]],
  ["SELECT * FROM f1", [[["99.9",null,null],["1.3",null,null],["99.9","99.99",null]],"4/3/1 5/4/2 4/5/2"]],
  ["CREATE TABLE f2 (c FLOAT(3,1) DEFAULT 99.96)", [1067,"Invalid default value for 'c'"]],
  ["CREATE TABLE f3 (c FLOAT(3,1) DEFAULT 99.94)", [0,0,"",1]],
  ["SHOW CREATE TABLE f3", [["f3","CREATE TABLE `f3` (\n  `c` float(3,1) DEFAULT '99.9'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE g1 (a FLOAT(54))", [1063,"Incorrect column specifier for column 'a'"]],
  ["CREATE TABLE g2 (a FLOAT(3,4))", [1427,"For float(M,D), double(M,D) or decimal(M,D), M must be >= D (column 'a')."]],
  ["CREATE TABLE g3 (a FLOAT(256,2))", [1439,"Display width out of range for column 'a' (max = 255)"]],
  ["CREATE TABLE g4 (a FLOAT(40,31))", [1425,"Too big scale 31 specified for column 'a'. Maximum is 30."]],
  ["CREATE TABLE g5 (a DOUBLE(255,30))", [0,0,"",1]],
  ["CREATE TABLE g6 (a FLOAT(3,1), b DOUBLE(6,2) UNSIGNED, c FLOAT(10,0))", [0,0,"",4]],
  ["SHOW CREATE TABLE g6", [["g6","CREATE TABLE `g6` (\n  `a` float(3,1) DEFAULT NULL,\n  `b` double(6,2) unsigned DEFAULT NULL,\n  `c` float(10,0) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["INSERT INTO g6 VALUES (1.25, 1.005, 12345.6), (1.35, 2.675, -0.5), (0.05, 3.5, 1.5)", [3,0,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT a, b, c, a + 0, a * 2 FROM g6", [[["1.2","1","12346","1.2","2.4"],["1.4","2.67","-1","1.4","2.8"],["0","3.5","1","0","0"]],"4/3/1 5/6/2 4/10/0 5/3/1 5/3/1"]],
  ["UPDATE g6 SET a = a * 100", [1264,"Out of range value for column 'a' at row 1"]],
  ["SELECT * FROM g6", [[["1.2","1","12346"],["1.4","2.67","-1"],["0","3.5","1"]],"4/3/1 5/6/2 4/10/0"]],
  ["DROP TABLE g6", [0,0,"",0]],
  ["CREATE TABLE g6 (a FLOAT(3,1), b DOUBLE(6,2) UNSIGNED, c FLOAT(10,0), f FLOAT, d DECIMAL(5,3))", [0,0,"",4]],
  ["INSERT INTO g6 VALUES (1.25, 1.005, 12345.6, 1.5, 1.5)", [1,0,"",0]],
  ["SELECT a, b, c, a + 0, a * 2, a + b, a + f, a + d, a / 3, -a, ABS(a), ROUND(a), COALESCE(a, b), IF(1, a, f), CAST(a AS CHAR), CONCAT(a), a + 1e0 FROM g6", [[["1.2","1","12346","1.2","2.4","2.2","2.700000047683716","2.7","0.4","-1.2","1.2","1","1.2","1.2","1.2","1.2","2.200000047683716"]],"4/3/1 5/6/2 4/10/0 5/3/1 5/3/1 5/6/2 5/23/31 5/7/3 5/7/5 5/18/1 5/18/1 5/23/31 5/6/2 4/23/31 253/12/31 253/12/31 5/23/31"]],
  ["SELECT SUM(a), AVG(a), MAX(a), SUM(b), AVG(c) FROM g6", [[["1.2","1.2","1.2","1","12346"]],"5/18/1 5/22/5 4/3/1 5/19/2 5/21/4"]],
  ["CREATE TABLE h (f FLOAT, g FLOAT(5,2))", [0,0,"",1]],
  ["INSERT INTO h VALUES (0.1, 0.1)", [1,0,"",0]],
  ["SELECT CONCAT(f), CAST(f AS CHAR), CONCAT(g), f + 0, g + 0, IF(1, f, f), COALESCE(g, f), IFNULL(f, 1), LENGTH(f), f = 0.1, g = 0.1, CONCAT(-g), CONCAT(g * 2) FROM h", [[["0.1","0.1","0.10","0.10000000149011612","0.1","0.1","0.1","0.1","3","0","1","-0.10","0.20"]],"253/48/31 253/48/31 253/20/31 5/23/31 5/5/2 4/23/31 4/23/31 4/23/31 8/10/0 8/1/0 8/1/0 253/88/31 253/88/31"]],
  ["CREATE TABLE h2 (f FLOAT DEFAULT 0.1, g DOUBLE(5,2) DEFAULT 1.005)", [0,0,"",1]],
  ["SHOW CREATE TABLE h2", [["h2","CREATE TABLE `h2` (\n  `f` float DEFAULT '0.1',\n  `g` double(5,2) DEFAULT '1.00'\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE w1 (a FLOAT(3,1) UNSIGNED, b DECIMAL(5,2) UNSIGNED, c DOUBLE UNSIGNED, d FLOAT(30), e INT(5), f FLOAT(3,1) ZEROFILL, g DOUBLE(5,2) DEFAULT 1.005)", [0,0,"",8]],
  ["CREATE TABLE w2 (a int)", [0,0,"",0]],
  ["ALTER TABLE w2 ADD COLUMN b FLOAT(3,1) UNSIGNED", [0,0,"Records: 0  Duplicates: 0  Warnings: 2",2]],
  ["ALTER TABLE w2 ADD COLUMN c INT(4)", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["ALTER TABLE w2 MODIFY COLUMN c BIGINT(4) ZEROFILL", [0,0,"Records: 0  Duplicates: 0  Warnings: 2",2]],
  ["CREATE TABLE w3 (h DOUBLE AUTO_INCREMENT KEY)", [1063,"Incorrect column specifier for column 'h'"]],
  ["CREATE TABLE w4 (h DECIMAL(5,0) AUTO_INCREMENT KEY)", [1063,"Incorrect column specifier for column 'h'"]],
  ["CREATE TABLE w5 (a DECIMAL(0,0))", [0,0,"",0]],
  ["SHOW CREATE TABLE w5", [["w5","CREATE TABLE `w5` (\n  `a` decimal(10,0) DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE w6 (a FLOAT(24), b FLOAT(25), c FLOAT(54))", [1063,"Incorrect column specifier for column 'c'"]],
  ["CREATE TABLE w7 (a FLOAT(24), b FLOAT(25))", [0,0,"",0]],
  ["SHOW CREATE TABLE w7", [["w7","CREATE TABLE `w7` (\n  `a` float DEFAULT NULL,\n  `b` double DEFAULT NULL\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE w8 (a FLOAT(0,0))", [1439,"Display width out of range for column 'a' (max = 255)"]],
  ["SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'app' AND DATA_TYPE IN ('float', 'double') ORDER BY TABLE_NAME, ORDINAL_POSITION", [[["f1","c","float(3,1)","3","1",null],["f1","d","double(4,2)","4","2",null],["f1","e","float(5,2) unsigned","5","2",null],["f3","c","float(3,1)","3","1","99.9"],["g5","a","double(255,30)","255","30",null],["g6","a","float(3,1)","3","1",null],["g6","b","double(6,2) unsigned","6","2",null],["g6","c","float(10,0)","10","0",null],["g6","f","float","12",null,null],["h","f","float","12",null,null],["h","g","float(5,2)","5","2",null],["h2","f","float","12",null,"0.1"],["h2","g","double(5,2)","5","2","1.00"],["w1","a","float(3,1) unsigned","3","1",null],["w1","c","double unsigned","22",null,null],["w1","d","double","22",null,null],["w1","f","float(3,1) unsigned zerofill","3","1",null],["w1","g","double(5,2)","5","2","1.00"],["w2","b","float(3,1) unsigned","3","1",null],["w7","a","float","12",null,null],["w7","b","double","22",null,null]],"253/256/0 253/256/0 252/67108860/0 8/10/0 8/10/0 252/262140/0"]],
  ["SELECT a, ROUND(a, 1), a < 1.25, a > 1.15, a BETWEEN 1.2 AND 1.2, a IN (1.2) FROM g6", [[["1.2","1.2","1","1","1","1"]],"4/3/1 5/23/31 8/1/0 8/1/0 8/1/0 8/1/0"]],
  ["CREATE TABLE g7 (a FLOAT(3,1))", [0,0,"",1]],
  ["INSERT INTO g7 VALUES (1.2), (NULL)", [2,0,"Records: 2  Duplicates: 0  Warnings: 0",0]],
  ["SELECT a IN (1.2, 1.3), a IN (1.2), a NOT IN (1.2, 5), a BETWEEN 1.2 AND 1.3, a BETWEEN 1.21 AND 1.3, a BETWEEN 1.204 AND 1.3, a = 1.2004, a <=> 1.2, a <=> NULL, NULLIF(a, 1.2), CASE a WHEN 1.2 THEN 'y' ELSE 'n' END, GREATEST(a, 1.2), a NOT IN (1.2) FROM g7", [[["0","1","1","1","0","0","0","1","0",null,"n","1.2","0"],[null,null,null,null,null,null,null,"0","1",null,"n",null,null]],"8/1/0 8/1/0 8/1/0 8/1/0 8/1/0 8/1/0 8/1/0 8/1/0 8/1/0 4/3/1 253/4/31 5/4/1 8/1/0"]],
]

test('FLOAT(M,D) and DOUBLE(M,D) answer every statement of the script as 8.4.11 did, metadata included', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
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
          actual = sql.startsWith('SHOW') ? rows : [rows, (fields as mysql.FieldPacket[]).map((f) => `${f.columnType}/${f.columnLength}/${f.decimals}`).join(' ')]
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
