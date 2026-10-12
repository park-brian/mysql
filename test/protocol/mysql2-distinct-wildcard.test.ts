// M5.49: expanded local fields determine DISTINCT coverage; raw '*' proves nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

const FIELDS: unknown[][][] = [
  [["x",3,11,0,0,63,"wildcard79","plain","plain","x"],["y",253,48,0,0,224,"wildcard79","plain","plain","y"]],
  [["x",3,11,32768,0,63,"wildcard79","plain","plain","x"],["y",253,48,32768,0,224,"wildcard79","plain","plain","y"]],
  [["x",3,11,0,0,63,"wildcard79","t","plain","x"],["y",253,48,0,0,224,"wildcard79","t","plain","y"]],
  [["x",3,11,32768,0,63,"wildcard79","t","plain","x"],["y",253,48,32768,0,224,"wildcard79","t","plain","y"]],
  [["x",3,11,0,0,63,"wildcard79","plain","plain","x"],["y",253,48,0,0,224,"wildcard79","plain","plain","y"],["y",253,48,0,0,224,"wildcard79","plain","plain","y"]],
  [["x",3,11,32768,0,63,"wildcard79","plain","plain","x"],["y",253,48,32768,0,224,"wildcard79","plain","plain","y"],["y",253,48,0,0,224,"wildcard79","plain","plain","y"]],
  [["x",3,11,20483,0,63,"wildcard79","primary_key","primary_key","x"],["y",253,48,0,0,224,"wildcard79","primary_key","primary_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","t","primary_key","x"],["y",253,48,0,0,224,"wildcard79","t","primary_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","primary_key","primary_key","x"],["y",253,48,0,0,224,"wildcard79","primary_key","primary_key","y"],["y",253,48,0,0,224,"wildcard79","primary_key","primary_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","unique_key","unique_key","x"],["y",253,48,0,0,224,"wildcard79","unique_key","unique_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","t","unique_key","x"],["y",253,48,0,0,224,"wildcard79","t","unique_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","unique_key","unique_key","x"],["y",253,48,0,0,224,"wildcard79","unique_key","unique_key","y"],["y",253,48,0,0,224,"wildcard79","unique_key","unique_key","y"]],
  [["x",3,11,16388,0,63,"wildcard79","nullable_key","nullable_key","x"],["y",253,48,0,0,224,"wildcard79","nullable_key","nullable_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","nullable_key","nullable_key","x"],["y",253,48,32768,0,224,"wildcard79","nullable_key","nullable_key","y"]],
  [["x",3,11,16388,0,63,"wildcard79","t","nullable_key","x"],["y",253,48,0,0,224,"wildcard79","t","nullable_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","t","nullable_key","x"],["y",253,48,32768,0,224,"wildcard79","t","nullable_key","y"]],
  [["x",3,11,0,0,63,"wildcard79","nullable_key","nullable_key","x"],["y",253,48,0,0,224,"wildcard79","nullable_key","nullable_key","y"]],
  [["x",3,11,16388,0,63,"wildcard79","nullable_key","nullable_key","x"],["y",253,48,0,0,224,"wildcard79","nullable_key","nullable_key","y"],["y",253,48,0,0,224,"wildcard79","nullable_key","nullable_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","nullable_key","nullable_key","x"],["y",253,48,32768,0,224,"wildcard79","nullable_key","nullable_key","y"],["y",253,48,0,0,224,"wildcard79","nullable_key","nullable_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","composite_key","composite_key","x"],["y",253,48,20483,0,224,"wildcard79","composite_key","composite_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","t","composite_key","x"],["y",253,48,20483,0,224,"wildcard79","t","composite_key","y"]],
  [["x",3,11,20483,0,63,"wildcard79","composite_key","composite_key","x"],["y",253,48,20483,0,224,"wildcard79","composite_key","composite_key","y"],["y",253,48,20483,0,224,"wildcard79","composite_key","composite_key","y"]],
  [["x",3,11,16392,0,63,"wildcard79","partial_key","partial_key","x"],["y",253,48,0,0,224,"wildcard79","partial_key","partial_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","partial_key","partial_key","x"],["y",253,48,32768,0,224,"wildcard79","partial_key","partial_key","y"]],
  [["x",3,11,16392,0,63,"wildcard79","t","partial_key","x"],["y",253,48,0,0,224,"wildcard79","t","partial_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","t","partial_key","x"],["y",253,48,32768,0,224,"wildcard79","t","partial_key","y"]],
  [["x",3,11,0,0,63,"wildcard79","partial_key","partial_key","x"],["y",253,48,0,0,224,"wildcard79","partial_key","partial_key","y"]],
  [["x",3,11,16392,0,63,"wildcard79","partial_key","partial_key","x"],["y",253,48,0,0,224,"wildcard79","partial_key","partial_key","y"],["y",253,48,0,0,224,"wildcard79","partial_key","partial_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","partial_key","partial_key","x"],["y",253,48,32768,0,224,"wildcard79","partial_key","partial_key","y"],["y",253,48,0,0,224,"wildcard79","partial_key","partial_key","y"]],
  [["x",3,11,16392,0,63,"wildcard79","invisible_key","invisible_key","x"],["y",253,48,16384,0,224,"wildcard79","invisible_key","invisible_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","invisible_key","invisible_key","x"],["y",253,48,32768,0,224,"wildcard79","invisible_key","invisible_key","y"]],
  [["x",3,11,16392,0,63,"wildcard79","t","invisible_key","x"],["y",253,48,16384,0,224,"wildcard79","t","invisible_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","t","invisible_key","x"],["y",253,48,32768,0,224,"wildcard79","t","invisible_key","y"]],
  [["x",3,11,0,0,63,"wildcard79","invisible_key","invisible_key","x"],["y",253,48,0,0,224,"wildcard79","invisible_key","invisible_key","y"]],
  [["x",3,11,16392,0,63,"wildcard79","invisible_key","invisible_key","x"],["y",253,48,16384,0,224,"wildcard79","invisible_key","invisible_key","y"],["y",253,48,16384,0,224,"wildcard79","invisible_key","invisible_key","y"]],
  [["x",3,11,32768,0,63,"wildcard79","invisible_key","invisible_key","x"],["y",253,48,32768,0,224,"wildcard79","invisible_key","invisible_key","y"],["y",253,48,0,0,224,"wildcard79","invisible_key","invisible_key","y"]],
  [["x",3,11,0,0,63,"wildcard79_fresh","p","p","x"],["y",253,48,0,0,224,"wildcard79_fresh","p","p","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","p","p","x"],["y",253,48,32768,0,224,"wildcard79_fresh","p","p","y"]],
  [["x",3,11,0,0,63,"wildcard79_fresh","t","p","x"],["y",253,48,0,0,224,"wildcard79_fresh","t","p","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","t","p","x"],["y",253,48,32768,0,224,"wildcard79_fresh","t","p","y"]],
  [["x",3,11,0,0,63,"wildcard79_fresh","p","p","x"],["y",253,48,0,0,224,"wildcard79_fresh","p","p","y"],["y",253,48,0,0,224,"wildcard79_fresh","p","p","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","p","p","x"],["y",253,48,32768,0,224,"wildcard79_fresh","p","p","y"],["y",253,48,0,0,224,"wildcard79_fresh","p","p","y"]],
  [["x",3,11,16388,0,63,"wildcard79_fresh","n","n","x"],["y",253,48,0,0,224,"wildcard79_fresh","n","n","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","n","n","x"],["y",253,48,32768,0,224,"wildcard79_fresh","n","n","y"]],
  [["x",3,11,16388,0,63,"wildcard79_fresh","t","n","x"],["y",253,48,0,0,224,"wildcard79_fresh","t","n","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","t","n","x"],["y",253,48,32768,0,224,"wildcard79_fresh","t","n","y"]],
  [["x",3,11,16388,0,63,"wildcard79_fresh","n","n","x"],["y",253,48,0,0,224,"wildcard79_fresh","n","n","y"],["y",253,48,0,0,224,"wildcard79_fresh","n","n","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","n","n","x"],["y",253,48,32768,0,224,"wildcard79_fresh","n","n","y"],["y",253,48,0,0,224,"wildcard79_fresh","n","n","y"]],
  [["x",3,11,0,0,63,"wildcard79_fresh","n","n","x"],["y",253,48,0,0,224,"wildcard79_fresh","n","n","y"]],
  [["x",3,11,20483,0,63,"wildcard79_fresh","u","u","x"],["y",253,48,0,0,224,"wildcard79_fresh","u","u","y"]],
  [["x",3,11,20483,0,63,"wildcard79_fresh","t","u","x"],["y",253,48,0,0,224,"wildcard79_fresh","t","u","y"]],
  [["x",3,11,20483,0,63,"wildcard79_fresh","u","u","x"],["y",253,48,0,0,224,"wildcard79_fresh","u","u","y"],["y",253,48,0,0,224,"wildcard79_fresh","u","u","y"]],
  [["x",3,11,16392,0,63,"wildcard79_fresh","i","i","x"],["y",253,48,0,0,224,"wildcard79_fresh","i","i","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","i","i","x"],["y",253,48,32768,0,224,"wildcard79_fresh","i","i","y"]],
  [["x",3,11,16392,0,63,"wildcard79_fresh","t","i","x"],["y",253,48,0,0,224,"wildcard79_fresh","t","i","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","t","i","x"],["y",253,48,32768,0,224,"wildcard79_fresh","t","i","y"]],
  [["x",3,11,16392,0,63,"wildcard79_fresh","i","i","x"],["y",253,48,0,0,224,"wildcard79_fresh","i","i","y"],["y",253,48,0,0,224,"wildcard79_fresh","i","i","y"]],
  [["x",3,11,32768,0,63,"wildcard79_fresh","i","i","x"],["y",253,48,32768,0,224,"wildcard79_fresh","i","i","y"],["y",253,48,0,0,224,"wildcard79_fresh","i","i","y"]],
  [["x",3,11,0,0,63,"wildcard79_fresh","i","i","x"],["y",253,48,0,0,224,"wildcard79_fresh","i","i","y"]]
]
const DEFS: string[][] = [
  ["plain","x INT,y VARCHAR(12)","(1,'one'),(1,'one'),(NULL,'null'),(NULL,'null')"],
  ["primary_key","x INT PRIMARY KEY,y VARCHAR(12)","(1,'one'),(2,'one'),(3,NULL)"],
  ["unique_key","x INT NOT NULL UNIQUE,y VARCHAR(12)","(1,'one'),(2,'one'),(3,NULL)"],
  ["nullable_key","x INT UNIQUE,y VARCHAR(12)","(1,'one'),(NULL,'null'),(NULL,'null')"],
  ["composite_key","x INT NOT NULL,y VARCHAR(12) NOT NULL,PRIMARY KEY(x,y)","(1,'one'),(1,'two'),(2,'one')"],
  ["partial_key","x INT,y VARCHAR(12),KEY k(x)","(1,'one'),(1,'two'),(NULL,'null'),(NULL,'null')"],
  ["invisible_key","x INT,y VARCHAR(12),KEY k(x,y) INVISIBLE","(1,'one'),(1,'one'),(NULL,'null'),(NULL,'null')"]
]
const CASES: { table: string; sql: string; prepare?: number; fields?: number; rows?: unknown[][]; error?: [number, string, string] }[] = [
  {"table":"plain","sql":"SELECT DISTINCT * FROM plain ORDER BY 1,2","prepare":0,"fields":1,"rows":[[null,"null"],[1,"one"]]},
  {"table":"plain","sql":"SELECT DISTINCT t.* FROM plain t ORDER BY 1,2","prepare":2,"fields":3,"rows":[[null,"null"],[1,"one"]]},
  {"table":"plain","sql":"SELECT DISTINCT * FROM plain","prepare":0,"fields":1,"rows":[[1,"one"],[null,"null"]]},
  {"table":"plain","sql":"SELECT DISTINCT * FROM plain LIMIT 1","prepare":0,"fields":0,"rows":[[1,"one"]]},
  {"table":"plain","sql":"SELECT DISTINCT * FROM plain LIMIT 0","prepare":0,"fields":0,"rows":[]},
  {"table":"plain","sql":"SELECT DISTINCT * FROM plain LIMIT 0 OFFSET 1","prepare":0,"fields":0,"rows":[]},
  {"table":"plain","sql":"SELECT DISTINCT x,* FROM plain ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM plain ORDER BY 1,2,3' at line 1"]},
  {"table":"plain","sql":"SELECT DISTINCT *,y FROM plain ORDER BY 1,2,3","prepare":4,"fields":5,"rows":[[null,"null","null"],[1,"one","one"]]},
  {"table":"plain","sql":"SELECT DISTINCT * FROM wildcard79.plain ORDER BY 1,2","prepare":0,"fields":1,"rows":[[null,"null"],[1,"one"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key ORDER BY 1,2","prepare":6,"fields":6,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"primary_key","sql":"SELECT DISTINCT t.* FROM primary_key t ORDER BY 1,2","prepare":7,"fields":7,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key","prepare":6,"fields":6,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key LIMIT 1","prepare":6,"fields":6,"rows":[[1,"one"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key LIMIT 0","prepare":6,"fields":6,"rows":[]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key LIMIT 0 OFFSET 1","prepare":6,"fields":6,"rows":[]},
  {"table":"primary_key","sql":"SELECT DISTINCT x,* FROM primary_key ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM primary_key ORDER BY 1,2,3' at line 1"]},
  {"table":"primary_key","sql":"SELECT DISTINCT *,y FROM primary_key ORDER BY 1,2,3","prepare":8,"fields":8,"rows":[[1,"one","one"],[2,"one","one"],[3,null,null]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM wildcard79.primary_key ORDER BY 1,2","prepare":6,"fields":6,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"unique_key","sql":"SELECT DISTINCT * FROM unique_key ORDER BY 1,2","prepare":9,"fields":9,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"unique_key","sql":"SELECT DISTINCT t.* FROM unique_key t ORDER BY 1,2","prepare":10,"fields":10,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"unique_key","sql":"SELECT DISTINCT * FROM unique_key","prepare":9,"fields":9,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"unique_key","sql":"SELECT DISTINCT * FROM unique_key LIMIT 1","prepare":9,"fields":9,"rows":[[1,"one"]]},
  {"table":"unique_key","sql":"SELECT DISTINCT * FROM unique_key LIMIT 0","prepare":9,"fields":9,"rows":[]},
  {"table":"unique_key","sql":"SELECT DISTINCT * FROM unique_key LIMIT 0 OFFSET 1","prepare":9,"fields":9,"rows":[]},
  {"table":"unique_key","sql":"SELECT DISTINCT x,* FROM unique_key ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM unique_key ORDER BY 1,2,3' at line 1"]},
  {"table":"unique_key","sql":"SELECT DISTINCT *,y FROM unique_key ORDER BY 1,2,3","prepare":11,"fields":11,"rows":[[1,"one","one"],[2,"one","one"],[3,null,null]]},
  {"table":"unique_key","sql":"SELECT DISTINCT * FROM wildcard79.unique_key ORDER BY 1,2","prepare":9,"fields":9,"rows":[[1,"one"],[2,"one"],[3,null]]},
  {"table":"nullable_key","sql":"SELECT DISTINCT * FROM nullable_key ORDER BY 1,2","prepare":12,"fields":13,"rows":[[null,"null"],[1,"one"]]},
  {"table":"nullable_key","sql":"SELECT DISTINCT t.* FROM nullable_key t ORDER BY 1,2","prepare":14,"fields":15,"rows":[[null,"null"],[1,"one"]]},
  {"table":"nullable_key","sql":"SELECT DISTINCT * FROM nullable_key","prepare":12,"fields":13,"rows":[[1,"one"],[null,"null"]]},
  {"table":"nullable_key","sql":"SELECT DISTINCT * FROM nullable_key LIMIT 1","prepare":12,"fields":16,"rows":[[1,"one"]]},
  {"table":"nullable_key","sql":"SELECT DISTINCT * FROM nullable_key LIMIT 0","prepare":12,"fields":12,"rows":[]},
  {"table":"nullable_key","sql":"SELECT DISTINCT * FROM nullable_key LIMIT 0 OFFSET 1","prepare":12,"fields":16,"rows":[]},
  {"table":"nullable_key","sql":"SELECT DISTINCT x,* FROM nullable_key ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM nullable_key ORDER BY 1,2,3' at line 1"]},
  {"table":"nullable_key","sql":"SELECT DISTINCT *,y FROM nullable_key ORDER BY 1,2,3","prepare":17,"fields":18,"rows":[[null,"null","null"],[1,"one","one"]]},
  {"table":"nullable_key","sql":"SELECT DISTINCT * FROM wildcard79.nullable_key ORDER BY 1,2","prepare":12,"fields":13,"rows":[[null,"null"],[1,"one"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key ORDER BY 1,2","prepare":19,"fields":19,"rows":[[1,"one"],[1,"two"],[2,"one"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT t.* FROM composite_key t ORDER BY 1,2","prepare":20,"fields":20,"rows":[[1,"one"],[1,"two"],[2,"one"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key","prepare":19,"fields":19,"rows":[[1,"one"],[1,"two"],[2,"one"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key LIMIT 1","prepare":19,"fields":19,"rows":[[1,"one"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key LIMIT 0","prepare":19,"fields":19,"rows":[]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key LIMIT 0 OFFSET 1","prepare":19,"fields":19,"rows":[]},
  {"table":"composite_key","sql":"SELECT DISTINCT x,* FROM composite_key ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM composite_key ORDER BY 1,2,3' at line 1"]},
  {"table":"composite_key","sql":"SELECT DISTINCT *,y FROM composite_key ORDER BY 1,2,3","prepare":21,"fields":21,"rows":[[1,"one","one"],[1,"two","two"],[2,"one","one"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM wildcard79.composite_key ORDER BY 1,2","prepare":19,"fields":19,"rows":[[1,"one"],[1,"two"],[2,"one"]]},
  {"table":"partial_key","sql":"SELECT DISTINCT * FROM partial_key ORDER BY 1,2","prepare":22,"fields":23,"rows":[[null,"null"],[1,"one"],[1,"two"]]},
  {"table":"partial_key","sql":"SELECT DISTINCT t.* FROM partial_key t ORDER BY 1,2","prepare":24,"fields":25,"rows":[[null,"null"],[1,"one"],[1,"two"]]},
  {"table":"partial_key","sql":"SELECT DISTINCT * FROM partial_key","prepare":22,"fields":23,"rows":[[1,"one"],[1,"two"],[null,"null"]]},
  {"table":"partial_key","sql":"SELECT DISTINCT * FROM partial_key LIMIT 1","prepare":22,"fields":26,"rows":[[1,"one"]]},
  {"table":"partial_key","sql":"SELECT DISTINCT * FROM partial_key LIMIT 0","prepare":22,"fields":22,"rows":[]},
  {"table":"partial_key","sql":"SELECT DISTINCT * FROM partial_key LIMIT 0 OFFSET 1","prepare":22,"fields":26,"rows":[]},
  {"table":"partial_key","sql":"SELECT DISTINCT x,* FROM partial_key ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM partial_key ORDER BY 1,2,3' at line 1"]},
  {"table":"partial_key","sql":"SELECT DISTINCT *,y FROM partial_key ORDER BY 1,2,3","prepare":27,"fields":28,"rows":[[null,"null","null"],[1,"one","one"],[1,"two","two"]]},
  {"table":"partial_key","sql":"SELECT DISTINCT * FROM wildcard79.partial_key ORDER BY 1,2","prepare":22,"fields":23,"rows":[[null,"null"],[1,"one"],[1,"two"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key ORDER BY 1,2","prepare":29,"fields":30,"rows":[[null,"null"],[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT t.* FROM invisible_key t ORDER BY 1,2","prepare":31,"fields":32,"rows":[[null,"null"],[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key","prepare":29,"fields":30,"rows":[[1,"one"],[null,"null"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key LIMIT 1","prepare":29,"fields":33,"rows":[[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key LIMIT 0","prepare":29,"fields":29,"rows":[]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key LIMIT 0 OFFSET 1","prepare":29,"fields":33,"rows":[]},
  {"table":"invisible_key","sql":"SELECT DISTINCT x,* FROM invisible_key ORDER BY 1,2,3","error":[1064,"42000","You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '* FROM invisible_key ORDER BY 1,2,3' at line 1"]},
  {"table":"invisible_key","sql":"SELECT DISTINCT *,y FROM invisible_key ORDER BY 1,2,3","prepare":34,"fields":35,"rows":[[null,"null","null"],[1,"one","one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM wildcard79.invisible_key ORDER BY 1,2","prepare":29,"fields":30,"rows":[[null,"null"],[1,"one"]]}
]
const FRESH_DEFS: string[][] = [
  ["p","x INT,y VARCHAR(12)","(1,'one'),(1,'one'),(NULL,'null'),(NULL,'null')"],
  ["n","x INT UNIQUE,y VARCHAR(12)","(1,'one'),(NULL,'null'),(NULL,'null')"],
  ["u","x INT PRIMARY KEY,y VARCHAR(12)","(1,'one'),(2,'one'),(3,NULL)"],
  ["i","x INT,y VARCHAR(12),KEY k(x)","(1,'one'),(1,'two'),(NULL,'null'),(NULL,'null')"]
]
const FRESH_CASES: { table: string; sql: string; prepare: number; fields: number; rows: unknown[][][] }[] = [
  {"table":"p","sql":"SELECT DISTINCT * FROM p ORDER BY 1,2","prepare":36,"fields":37,"rows":[[[null,"null"],[1,"one"]],[[null,"znull"],[1,"zone"]],[[null,"znull"]],[[null,"null"],[1,"one"]]]},
  {"table":"p","sql":"SELECT DISTINCT t.* FROM p t ORDER BY 1,2","prepare":38,"fields":39,"rows":[[[null,"null"],[1,"one"]],[[null,"znull"],[1,"zone"]],[[null,"znull"]],[[null,"null"],[1,"one"]]]},
  {"table":"p","sql":"SELECT DISTINCT *,y FROM p ORDER BY 1,2,3","prepare":40,"fields":41,"rows":[[[null,"null","null"],[1,"one","one"]],[[null,"znull","znull"],[1,"zone","zone"]],[[null,"znull","znull"]],[[null,"null","null"],[1,"one","one"]]]},
  {"table":"p","sql":"SELECT DISTINCT * FROM p LIMIT 0 OFFSET 1","prepare":36,"fields":36,"rows":[[],[],[],[]]},
  {"table":"p","sql":"SELECT DISTINCT * FROM p ORDER BY 1,2 LIMIT 1 OFFSET 1","prepare":36,"fields":37,"rows":[[[1,"one"]],[[1,"zone"]],[],[[1,"one"]]]},
  {"table":"n","sql":"SELECT DISTINCT * FROM n ORDER BY 1,2","prepare":42,"fields":43,"rows":[[[null,"null"],[1,"one"]],[[null,"znull"],[1,"zone"]],[[null,"znull"]],[[null,"null"],[1,"one"]]]},
  {"table":"n","sql":"SELECT DISTINCT t.* FROM n t ORDER BY 1,2","prepare":44,"fields":45,"rows":[[[null,"null"],[1,"one"]],[[null,"znull"],[1,"zone"]],[[null,"znull"]],[[null,"null"],[1,"one"]]]},
  {"table":"n","sql":"SELECT DISTINCT *,y FROM n ORDER BY 1,2,3","prepare":46,"fields":47,"rows":[[[null,"null","null"],[1,"one","one"]],[[null,"znull","znull"],[1,"zone","zone"]],[[null,"znull","znull"]],[[null,"null","null"],[1,"one","one"]]]},
  {"table":"n","sql":"SELECT DISTINCT * FROM n LIMIT 0 OFFSET 1","prepare":42,"fields":48,"rows":[[],[],[],[]]},
  {"table":"n","sql":"SELECT DISTINCT * FROM n ORDER BY 1,2 LIMIT 1 OFFSET 1","prepare":42,"fields":43,"rows":[[[1,"one"]],[[1,"zone"]],[],[[1,"one"]]]},
  {"table":"u","sql":"SELECT DISTINCT * FROM u ORDER BY 1,2","prepare":49,"fields":49,"rows":[[[1,"one"],[2,"one"],[3,null]],[[1,"zone"],[2,"zone"],[3,"z"]],[[2,"zone"],[3,"z"]],[[1,"one"],[2,"one"],[3,null]]]},
  {"table":"u","sql":"SELECT DISTINCT t.* FROM u t ORDER BY 1,2","prepare":50,"fields":50,"rows":[[[1,"one"],[2,"one"],[3,null]],[[1,"zone"],[2,"zone"],[3,"z"]],[[2,"zone"],[3,"z"]],[[1,"one"],[2,"one"],[3,null]]]},
  {"table":"u","sql":"SELECT DISTINCT *,y FROM u ORDER BY 1,2,3","prepare":51,"fields":51,"rows":[[[1,"one","one"],[2,"one","one"],[3,null,null]],[[1,"zone","zone"],[2,"zone","zone"],[3,"z","z"]],[[2,"zone","zone"],[3,"z","z"]],[[1,"one","one"],[2,"one","one"],[3,null,null]]]},
  {"table":"u","sql":"SELECT DISTINCT * FROM u LIMIT 0 OFFSET 1","prepare":49,"fields":49,"rows":[[],[],[],[]]},
  {"table":"u","sql":"SELECT DISTINCT * FROM u ORDER BY 1,2 LIMIT 1 OFFSET 1","prepare":49,"fields":49,"rows":[[[2,"one"]],[[2,"zone"]],[[3,"z"]],[[2,"one"]]]},
  {"table":"i","sql":"SELECT DISTINCT * FROM i ORDER BY 1,2","prepare":52,"fields":53,"rows":[[[null,"null"],[1,"one"],[1,"two"]],[[null,"znull"],[1,"zone"],[1,"ztwo"]],[[null,"znull"]],[[null,"null"],[1,"one"],[1,"two"]]]},
  {"table":"i","sql":"SELECT DISTINCT t.* FROM i t ORDER BY 1,2","prepare":54,"fields":55,"rows":[[[null,"null"],[1,"one"],[1,"two"]],[[null,"znull"],[1,"zone"],[1,"ztwo"]],[[null,"znull"]],[[null,"null"],[1,"one"],[1,"two"]]]},
  {"table":"i","sql":"SELECT DISTINCT *,y FROM i ORDER BY 1,2,3","prepare":56,"fields":57,"rows":[[[null,"null","null"],[1,"one","one"],[1,"two","two"]],[[null,"znull","znull"],[1,"zone","zone"],[1,"ztwo","ztwo"]],[[null,"znull","znull"]],[[null,"null","null"],[1,"one","one"],[1,"two","two"]]]},
  {"table":"i","sql":"SELECT DISTINCT * FROM i LIMIT 0 OFFSET 1","prepare":52,"fields":58,"rows":[[],[],[],[]]},
  {"table":"i","sql":"SELECT DISTINCT * FROM i ORDER BY 1,2 LIMIT 1 OFFSET 1","prepare":52,"fields":53,"rows":[[[1,"one"]],[[1,"zone"]],[],[[1,"one"]]]}
]
const fieldsOf = (fields: mysql.FieldPacket[]) => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
const objectRows = (rows: unknown[][], fields: number) => rows.map((row) => Object.fromEntries(row.map((value, i) => [String(FIELDS[fields]![i]![0]), value])))

async function withTables(schema: string, definitions: string[][], run: (conn: mysql.Connection) => Promise<void>): Promise<void> {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const [table, def, values] of definitions) {
      await conn.query(`CREATE TABLE ${table}(${def}) STATS_AUTO_RECALC=0`)
      await conn.query(`INSERT INTO ${table} VALUES ${values}`)
      await conn.query(`ANALYZE TABLE ${table}`)
    }
    await run(conn)
  } finally {
    await conn.query(`DROP DATABASE IF EXISTS ${schema}`)
    await conn.end()
    await db?.end()
  }
}

test('wildcard DISTINCT reports native fields for plain, whole, nullable, partial and invisible keys', async () => {
  // Covering-star source order and invisible-column admission remain separate;
  // their complete configurations stay recorded in the paired roadmap probe.
  await withTables('wildcard79', DEFS, async (conn) => {
    for (const entry of CASES) {
      const options = { sql: entry.sql, rowsAsArray: true }
      if (entry.error !== undefined) {
        await assert.rejects(conn.prepare(options), (e: unknown) => {
          const error = e as { errno: number; sqlState: string; sqlMessage: string }
          assert.deepEqual([error.errno, error.sqlState, error.sqlMessage], entry.error)
          return true
        })
        continue
      }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fieldsOf(columns), FIELDS[entry.prepare!], `${entry.sql}: prepare`)
        for (const method of ['query', 'execute', 'prepared']) {
          const [rows, fields] = method === 'prepared' ? await statement.execute([]) : method === 'query' ? await conn.query(options) : await conn.execute(options)
          assert.deepEqual(rows, method === 'prepared' ? objectRows(entry.rows!, entry.prepare!) : entry.rows, `${entry.sql}/${method}: rows`)
          assert.deepEqual(fieldsOf(fields), FIELDS[entry.fields!], `${entry.sql}/${method}: fields`)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${entry.sql}/${method}: warnings`)
        }
      } finally { await statement.close(); conn.unprepare(options) }
    }
  })
})

test('expanded wildcard proof and copied metadata remain fresh in retained statements after writes', async () => {
  await withTables('wildcard79_fresh', FRESH_DEFS, async (conn) => {
    for (const entry of FRESH_CASES) {
      const options = { sql: entry.sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fieldsOf(columns), FIELDS[entry.prepare], `${entry.sql}: prepare`)
        for (const state of [0, 1, 2, 3]) {
          if (state === 1) await conn.query(`UPDATE ${entry.table} SET y=CONCAT('z',COALESCE(y,''))`)
          if (state === 2) await conn.query(`DELETE FROM ${entry.table} WHERE x=1`)
          if (state === 3) {
            await conn.query(`DELETE FROM ${entry.table}`)
            await conn.query(`INSERT INTO ${entry.table} VALUES ${FRESH_DEFS.find((d) => d[0] === entry.table)![2]}`)
          }
          for (const method of ['query', 'execute', 'prepared']) {
            const [rows, fields] = method === 'prepared' ? await statement.execute([]) : method === 'query' ? await conn.query(options) : await conn.execute(options)
            assert.deepEqual(rows, method === 'prepared' ? objectRows(entry.rows[state]!, entry.prepare) : entry.rows[state], `${entry.sql}/${state}/${method}: rows`)
            assert.deepEqual(fieldsOf(fields), FIELDS[entry.fields], `${entry.sql}/${state}/${method}: fields`)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${entry.sql}/${state}/${method}: warnings`)
          }
        }
      } finally { await statement.close(); conn.unprepare(options) }
    }
  })
})
