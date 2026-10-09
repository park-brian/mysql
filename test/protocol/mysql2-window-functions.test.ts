// Window functions, as 8.4.11 answered each of these statements, result
// column lengths, types, flags and decimals included.
//
// What it pins: ROW_NUMBER, RANK, DENSE_RANK, PERCENT_RANK, CUME_DIST and
// NTILE over partitions and peers; LAG and LEAD with offsets and defaults
// (their type aggregated with the default's); FIRST_VALUE, LAST_VALUE and
// NTH_VALUE over frames; the aggregates over ROWS and RANGE frames, a RANGE
// over a DESC key and a DECIMAL one, empty frames, the default frame with and
// without an ORDER BY; named windows and one extending another; a window
// function in ORDER BY; and the refusals (1210, 1235, 3579, 3586, 3587).
// Over a grouped query, windows run after HAVING over the groups, their
// arguments and keys the groups' aggregates (`SUM(SUM(v)) OVER …`), and the
// window's table takes the groups' place in the metadata, except for one row
// of an aggregate without GROUP BY. Not pinned, and named in the roadmap:
// LAG's negative offset (a 1064 in the server's grammar), and the key a
// derived table gets for `WHERE rn = 1`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly [readonly (readonly (string | null)[])[], string] | readonly [number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE w (id INT PRIMARY KEY, g CHAR(1), v INT, d DECIMAL(6,2), s VARCHAR(10))", [0]],
  ["INSERT INTO w VALUES (1,'a',10,1.50,'x'),(2,'a',20,2.25,'y'),(3,'a',20,NULL,'z'),(4,'b',5,4.00,NULL),(5,'b',NULL,1.00,'w'),(6,'c',7,7.70,'v')", [6]],
  ["SELECT id, LAG(v) OVER (ORDER BY id) a, LAG(v, 2) OVER (ORDER BY id) b, LAG(v, 1, -1) OVER (ORDER BY id) c, LEAD(v) OVER (ORDER BY id) d, LEAD(s, 2, 'none') OVER (PARTITION BY g ORDER BY id) e FROM w ORDER BY id", [[["1",null,null,"-1","20","z"],["2","10",null,"10","20","none"],["3","20","10","20","5","none"],["4","20","20","20",null,"none"],["5","5","20","5","7","none"],["6",null,"5",null,null,"none"]],"11/3/4097/0 11/8/0/0 11/8/0/0 11/8/0/0 11/8/0/0 40/253/0/0"]],
  ["SELECT id, FIRST_VALUE(v) OVER (PARTITION BY g ORDER BY id) a, LAST_VALUE(v) OVER (PARTITION BY g ORDER BY id) b, LAST_VALUE(v) OVER (PARTITION BY g ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) c, NTH_VALUE(v, 2) OVER (PARTITION BY g ORDER BY id) d FROM w ORDER BY id", [[["1","10","10","20",null],["2","10","20","20","20"],["3","10","20","20","20"],["4","5","5",null,null],["5","5",null,null,null],["6","7","7","7",null]],"11/3/4097/0 11/8/0/0 11/8/0/0 11/8/0/0 11/8/0/0"]],
  ["SELECT id, NTILE(2) OVER (ORDER BY id) a, NTILE(4) OVER (PARTITION BY g ORDER BY id) b, CUME_DIST() OVER (ORDER BY v) c, PERCENT_RANK() OVER (ORDER BY v) e FROM w ORDER BY id", [[["1","1","1","0.6666666666666666","0.6"],["2","1","2","1","0.8"],["3","1","3","1","0.8"],["4","2","1","0.3333333333333333","0.2"],["5","2","2","0.16666666666666666","0"],["6","2","1","0.5","0.4"]],"11/3/4097/0 21/8/33/0 21/8/33/0 23/5/1/31 23/5/1/31"]],
  ["SELECT id, SUM(v) OVER (ORDER BY id) a, SUM(v) OVER (PARTITION BY g) b, COUNT(*) OVER (ORDER BY v) c, AVG(d) OVER (PARTITION BY g ORDER BY id) e, MIN(s) OVER () f, MAX(v) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) h FROM w ORDER BY id", [[["1","10","50","4","1.500000","v","20"],["2","30","50","6","1.875000","v","20"],["3","50","50","6","1.875000","v","20"],["4","55","5","2","4.000000","v","20"],["5","55","5","1","2.500000","v","7"],["6","62","7","3","7.700000","v","7"]],"11/3/4097/0 33/246/0/0 33/246/0/0 21/8/1/0 12/246/0/6 40/253/0/0 11/8/0/0"]],
  ["SELECT id, SUM(v) OVER (ORDER BY v RANGE BETWEEN 5 PRECEDING AND CURRENT ROW) a, COUNT(v) OVER (ORDER BY id ROWS 2 PRECEDING) b, SUM(d) OVER (ORDER BY id ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) c FROM w ORDER BY id", [[["1","22","1","16.45"],["2","40","2","14.95"],["3","40","3","12.70"],["4","5","3","12.70"],["5",null,"2","8.70"],["6","12","2","7.70"]],"11/3/4097/0 33/246/0/0 21/8/1/0 30/246/0/2"]],
  ["SELECT id, SUM(v) OVER w1, ROW_NUMBER() OVER w1, COUNT(*) OVER (w1 ROWS UNBOUNDED PRECEDING) FROM w WINDOW w1 AS (PARTITION BY g ORDER BY id) ORDER BY id", [[["1","10","1","1"],["2","30","2","2"],["3","50","3","3"],["4","5","1","1"],["5","5","2","2"],["6","7","1","1"]],"11/3/4097/0 33/246/0/0 21/8/33/0 21/8/1/0"]],
  ["SELECT id, BIT_OR(v) OVER (ORDER BY id), STDDEV_POP(v) OVER (), VAR_SAMP(v) OVER (PARTITION BY g), JSON_ARRAYAGG(id) OVER (PARTITION BY g ORDER BY id) FROM w ORDER BY id", [[["1","10","6.406246951218787","33.33333333333333","[1]"],["2","30","6.406246951218787","33.33333333333333","[1,2]"],["3","30","6.406246951218787","33.33333333333333","[1,2,3]"],["4","31","6.406246951218787",null,"[4]"],["5","31","6.406246951218787",null,"[4,5]"],["6","31","6.406246951218787",null,"[6]"]],"11/3/4097/0 21/8/33/0 23/5/0/31 23/5/0/31 4294967295/245/144/0"]],
  ["SELECT id, SUM(DISTINCT v) OVER () FROM w", [1235,"This version of MySQL doesn't yet support '<window function>(DISTINCT ..)'"]],
  ["SELECT id, NTILE(0) OVER (ORDER BY id) FROM w", [1210,"Incorrect arguments to ntile"]],
  ["SELECT id, NTH_VALUE(v, 0) OVER (ORDER BY id) FROM w", [1210,"Incorrect arguments to nth_value"]],
  ["SELECT id, SUM(v) OVER (ORDER BY id RANGE BETWEEN 1 PRECEDING AND CURRENT ROW) FROM w ORDER BY id", [[["1","10"],["2","30"],["3","40"],["4","25"],["5","5"],["6","7"]],"11/3/4097/0 33/246/0/0"]],
  ["SELECT id, SUM(v) OVER (ORDER BY s RANGE 1 PRECEDING) FROM w", [3587,"Window '<unnamed window>' with RANGE N PRECEDING/FOLLOWING frame requires exactly one ORDER BY expression, of numeric or temporal type"]],
  ["SELECT id, SUM(v) OVER (ROWS BETWEEN 1 FOLLOWING AND 1 PRECEDING) FROM w", [3586,"Window '<unnamed window>': frame start or end is negative, NULL or of non-integral type"]],
  ["SELECT id, GROUP_CONCAT(v) OVER () FROM w", [1235,"This version of MySQL doesn't yet support 'group_concat as window function'"]],
  ["SELECT id, v, LAG(v) OVER (ORDER BY id) - v AS delta FROM w ORDER BY id", [[["1","10",null],["2","20","-10"],["3","20","0"],["4","5","15"],["5",null,null],["6","7",null]],"11/3/4097/0 11/3/0/0 12/8/0/0"]],
  ["SELECT id, SUM(v) OVER (ORDER BY v DESC RANGE BETWEEN 5 PRECEDING AND 5 FOLLOWING) a, COUNT(*) OVER (ORDER BY v DESC RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) b FROM w ORDER BY id", [[["1","22","4"],["2","40","6"],["3","40","6"],["4","22","2"],["5",null,"1"],["6","22","3"]],"11/3/4097/0 33/246/0/0 21/8/1/0"]],
  ["SELECT id, SUM(d) OVER (ORDER BY d RANGE BETWEEN 1.5 PRECEDING AND 0.5 FOLLOWING) a FROM w ORDER BY id", [[["1","2.50"],["2","4.75"],["3",null],["4","4.00"],["5","2.50"],["6","7.70"]],"11/3/4097/0 30/246/0/2"]],
  ["SELECT id, SUM(v) OVER (ORDER BY id ROWS BETWEEN 3 FOLLOWING AND 5 FOLLOWING) a, FIRST_VALUE(v) OVER (ORDER BY id ROWS BETWEEN 10 FOLLOWING AND UNBOUNDED FOLLOWING) b, COUNT(*) OVER (ORDER BY id ROWS BETWEEN 4 PRECEDING AND 2 PRECEDING) c FROM w ORDER BY id", [[["1","12",null,"0"],["2","7",null,"0"],["3","7",null,"1"],["4",null,null,"2"],["5",null,null,"3"],["6",null,null,"3"]],"11/3/4097/0 33/246/0/0 11/8/0/0 21/8/1/0"]],
  ["SELECT id, NTILE(10) OVER (ORDER BY id) a, NTILE(4) OVER (ORDER BY id) b FROM w ORDER BY id", [[["1","1","1"],["2","2","1"],["3","3","2"],["4","4","2"],["5","5","3"],["6","6","4"]],"11/3/4097/0 21/8/33/0 21/8/33/0"]],
  ["SELECT id, LAG(v, 1, 'x') OVER (ORDER BY id) a, LEAD(d, 1, 0) OVER (ORDER BY id) b, LAG(id, 0) OVER (ORDER BY id) c FROM w ORDER BY id", [[["1","x","2.25","1"],["2","10",null,"2"],["3","20","4.00","3"],["4","20","1.00","4"],["5","5","7.70","5"],["6",null,"0.00","6"]],"11/3/4097/0 44/253/0/0 8/246/0/2 11/8/0/0"]],
  ["SELECT id, ROW_NUMBER() OVER (ORDER BY v DESC, id) rn FROM w ORDER BY rn", [[["2","1"],["3","2"],["1","3"],["6","4"],["4","5"],["5","6"]],"11/3/4097/0 21/8/33/0"]],
  ["SELECT id FROM w ORDER BY ROW_NUMBER() OVER (ORDER BY v DESC, id)", [[["2"],["3"],["1"],["6"],["4"],["5"]],"11/3/4097/0"]],
  ["SELECT id, RANK() OVER (ORDER BY g) r, SUM(v) OVER (ORDER BY g) s FROM w", [[["1","1","50"],["2","1","50"],["3","1","50"],["4","4","55"],["5","4","55"],["6","6","62"]],"11/3/4097/0 21/8/33/0 33/246/0/0"]],
  ["SELECT id, AVG(v) OVER (PARTITION BY g ROWS UNBOUNDED PRECEDING) a FROM w ORDER BY id", [[["1","10.0000"],["2","15.0000"],["3","16.6667"],["4","5.0000"],["5","5.0000"],["6","7.0000"]],"11/3/4097/0 16/246/0/4"]],
  ["SELECT id, MIN(d) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) a, MAX(s) OVER (PARTITION BY g) b FROM w ORDER BY id", [[["1","1.50","z"],["2","1.50","z"],["3","2.25","z"],["4","4.00","w"],["5","1.00","w"],["6","1.00","v"]],"11/3/4097/0 8/246/0/2 40/253/0/0"]],
  ["SELECT g, ROW_NUMBER() OVER () FROM w ORDER BY id", [[["a","1"],["a","2"],["a","3"],["b","4"],["b","5"],["c","6"]],"4/254/0/0 21/8/33/0"]],
  ["SELECT id, CUME_DIST() OVER () a, PERCENT_RANK() OVER () b, RANK() OVER () c FROM w ORDER BY id", [[["1","1","0","1"],["2","1","0","1"],["3","1","0","1"],["4","1","0","1"],["5","1","0","1"],["6","1","0","1"]],"11/3/4097/0 23/5/1/31 23/5/1/31 21/8/33/0"]],
  ["SELECT id, SUM(v) OVER (PARTITION BY g ORDER BY id RANGE UNBOUNDED PRECEDING) FROM w ORDER BY id", [[["1","10"],["2","30"],["3","50"],["4","5"],["5","5"],["6","7"]],"11/3/4097/0 33/246/0/0"]],
  ["SELECT id, SUM(v) OVER w2 FROM w WINDOW w1 AS (PARTITION BY g), w2 AS (w1 ORDER BY id) ORDER BY id", [[["1","10"],["2","30"],["3","50"],["4","5"],["5","5"],["6","7"]],"11/3/4097/0 33/246/0/0"]],
  ["SELECT id, SUM(v) OVER nope FROM w", [3579,"Window name 'nope' is not defined."]],
  ["SELECT id, COUNT(*) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING) FROM w ORDER BY id", [[["1","0"],["2","1"],["3","1"],["4","1"],["5","1"],["6","1"]],"11/3/4097/0 21/8/1/0"]],
  ["SELECT DISTINCT g, COUNT(*) OVER (PARTITION BY g) FROM w ORDER BY g", [[["a","3"],["b","2"],["c","1"]],"4/254/0/0 21/8/1/0"]],
  ["SELECT id, SUM(v) OVER (ORDER BY id) FROM w LIMIT 2", [[["1","10"],["2","30"]],"11/3/4097/0 33/246/0/0"]],
  ["SELECT g, SUM(SUM(v)) OVER (ORDER BY g), RANK() OVER (ORDER BY SUM(v) DESC) FROM w GROUP BY g ORDER BY g", [[["a","50","1"],["b","55","3"],["c","62","2"]],"4/254/0/0 55/246/0/0 21/8/33/0"]],
  ["SELECT g, COUNT(*) c, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, g) rn FROM w GROUP BY g ORDER BY rn", [[["a","3","1"],["b","2","2"],["c","1","3"]],"4/254/0/0 21/8/1/0 21/8/33/0"]],
  ["SELECT g, AVG(v), LAG(MAX(v)) OVER (ORDER BY g) FROM w GROUP BY g", [[["a","16.6667",null],["b","5.0000","20"],["c","7.0000","5"]],"4/254/0/0 16/246/0/4 11/8/0/0"]],
  ["SELECT COUNT(*), ROW_NUMBER() OVER () FROM w", [[["6","1"]],"21/8/129/0 21/8/161/0"]],
  ["SELECT g, SUM(v) s, SUM(SUM(v)) OVER w1 FROM w GROUP BY g HAVING s > 6 WINDOW w1 AS (ORDER BY g) ORDER BY g", [[["a","50","50"],["c","7","57"]],"4/254/0/0 33/246/0/0 55/246/0/0"]],
  ["SELECT g, ROW_NUMBER() OVER (PARTITION BY g) FROM w GROUP BY g", [[["a","1"],["b","1"],["c","1"]],"4/254/0/0 21/8/33/0"]],
  ["SELECT g FROM w GROUP BY g ORDER BY RANK() OVER (ORDER BY MIN(id) DESC)", [[["c"],["b"],["a"]],"4/254/0/0"]],
]

test('window functions agree with 8.4.11, metadata included', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r, f] = await conn.query({ sql, rowsAsArray: true })
        actual = Array.isArray(r)
          ? [(r as unknown[][]).map((row) => row.map((v) => (v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)))), f.map((x) => [x.columnLength, x.columnType, x.flags, x.decimals].join('/')).join(' ')]
          : [(r as mysql.ResultSetHeader).affectedRows]
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
