// M5.49: explicit source requirements permit full covering-key access without a raw 'all' sentinel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { BTree } from '@myjs/engine'
import { MySQL } from '@myjs/core'

const FIELDS: unknown[][][] = [
  [["x",3,11,16392,0,63,"covering80","hidden","hidden","x"],["y",253,48,16384,0,224,"covering80","hidden","hidden","y"]],
  [["x",3,11,16392,0,63,"covering80","t","hidden","x"],["y",253,48,16384,0,224,"covering80","t","hidden","y"]],
  [["COUNT(*)",8,21,129,0,63,"","","",""]],
  [["id",3,11,20483,0,63,"covering80","primary_key","primary_key","id"],["x",3,11,16392,0,63,"covering80","primary_key","primary_key","x"],["y",253,48,16384,0,224,"covering80","primary_key","primary_key","y"]],
  [["id",3,11,20483,0,63,"covering80","t","primary_key","id"],["x",3,11,16392,0,63,"covering80","t","primary_key","x"],["y",253,48,16384,0,224,"covering80","t","primary_key","y"]],
  [["a",3,11,20483,0,63,"covering80","composite_key","composite_key","a"],["b",3,11,20483,0,63,"covering80","composite_key","composite_key","b"],["y",253,48,16392,0,224,"covering80","composite_key","composite_key","y"]],
  [["a",3,11,20483,0,63,"covering80","t","composite_key","a"],["b",3,11,20483,0,63,"covering80","t","composite_key","b"],["y",253,48,16392,0,224,"covering80","t","composite_key","y"]],
  [["x",3,11,16392,0,63,"covering80","prefix_key","prefix_key","x"],["y",253,48,16384,0,224,"covering80","prefix_key","prefix_key","y"]],
  [["x",3,11,16392,0,63,"covering80","t","prefix_key","x"],["y",253,48,16384,0,224,"covering80","t","prefix_key","y"]],
  [["x",3,11,32768,0,63,"covering80","prefix_key","prefix_key","x"],["y",253,48,32768,0,224,"covering80","prefix_key","prefix_key","y"]],
  [["x",3,11,32768,0,63,"covering80","t","prefix_key","x"],["y",253,48,32768,0,224,"covering80","t","prefix_key","y"]],
  [["x",3,11,0,0,63,"covering80","prefix_key","prefix_key","x"],["y",253,48,0,0,224,"covering80","prefix_key","prefix_key","y"]],
  [["x",3,11,16392,0,63,"covering80","invisible_key","invisible_key","x"],["y",253,48,16384,0,224,"covering80","invisible_key","invisible_key","y"]],
  [["x",3,11,16392,0,63,"covering80","t","invisible_key","x"],["y",253,48,16384,0,224,"covering80","t","invisible_key","y"]],
  [["x",3,11,32768,0,63,"covering80","invisible_key","invisible_key","x"],["y",253,48,32768,0,224,"covering80","invisible_key","invisible_key","y"]],
  [["x",3,11,32768,0,63,"covering80","t","invisible_key","x"],["y",253,48,32768,0,224,"covering80","t","invisible_key","y"]],
  [["x",3,11,0,0,63,"covering80","invisible_key","invisible_key","x"],["y",253,48,0,0,224,"covering80","invisible_key","invisible_key","y"]],
  [["id",3,11,20483,0,63,"covering80","binary_key","binary_key","id"],["x",253,8,16520,0,63,"covering80","binary_key","binary_key","x"]],
  [["id",3,11,20483,0,63,"covering80","t","binary_key","id"],["x",253,8,16520,0,63,"covering80","t","binary_key","x"]],
  [["all",3,11,16392,0,63,"covering80","named_all","named_all","all"],["y",253,48,0,0,224,"covering80","named_all","named_all","y"]],
  [["all",3,11,16392,0,63,"covering80","t","named_all","all"],["y",253,48,0,0,224,"covering80","t","named_all","y"]],
  [["all",3,11,32768,0,63,"covering80","named_all","named_all","all"],["y",253,48,32768,0,224,"covering80","named_all","named_all","y"]],
  [["all",3,11,32768,0,63,"covering80","t","named_all","all"],["y",253,48,32768,0,224,"covering80","t","named_all","y"]],
  [["all",3,11,0,0,63,"covering80","named_all","named_all","all"],["y",253,48,0,0,224,"covering80","named_all","named_all","y"]],
  [["all",3,11,16392,0,63,"covering80","named_all","named_all","all"]],
  [["x",3,11,16392,0,63,"covering80_fresh","h","h","x"],["y",253,48,16384,0,224,"covering80_fresh","h","h","y"]],
  [["x",3,11,16392,0,63,"covering80_fresh","h","h","x"]],
  [["id",3,11,20483,0,63,"covering80_fresh","p","p","id"],["x",3,11,16392,0,63,"covering80_fresh","p","p","x"],["y",253,48,16384,0,224,"covering80_fresh","p","p","y"]],
  [["x",3,11,16392,0,63,"covering80_fresh","p","p","x"]],
  [["id",8,20,20483,0,63,"covering80_fresh","b","b","id"],["x",253,8,16520,0,63,"covering80_fresh","b","b","x"]],
  [["x",253,8,16520,0,63,"covering80_fresh","b","b","x"]],
  [["all",3,11,16392,0,63,"covering80_fresh","a","a","all"],["y",253,48,0,0,224,"covering80_fresh","a","a","y"]],
  [["all",3,11,32768,0,63,"covering80_fresh","a","a","all"],["y",253,48,32768,0,224,"covering80_fresh","a","a","y"]],
  [["all",3,11,0,0,63,"covering80_fresh","a","a","all"],["y",253,48,0,0,224,"covering80_fresh","a","a","y"]],
  [["all",3,11,16392,0,63,"covering80_fresh","a","a","all"]],
  [["x",3,11,0,0,63,"covering80","hidden","hidden","x"],["y",253,48,0,0,224,"covering80","hidden","hidden","y"]],
  [["x",3,11,0,0,63,"covering80_fresh","h","h","x"],["y",253,48,0,0,224,"covering80_fresh","h","h","y"]]
]
const DEFS: string[][] = [
  ["hidden","x INT,y VARCHAR(12),KEY k(x,y)","(1,'one'),(1,'one'),(NULL,'null'),(NULL,'null')"],
  ["primary_key","id INT PRIMARY KEY,x INT,y VARCHAR(12),KEY k(x,y)","(1,2,'two'),(2,1,'one'),(3,NULL,'null'),(4,1,'one')"],
  ["composite_key","a INT,b INT,y VARCHAR(12),PRIMARY KEY(a,b),KEY k(y)","(1,2,'two'),(1,1,'one'),(2,1,'one'),(2,2,'null')"],
  ["prefix_key","x INT,y VARCHAR(12),KEY k(x,y(3))","(1,'one'),(1,'only'),(NULL,'null'),(NULL,'null')"],
  ["invisible_key","x INT,y VARCHAR(12),KEY k(x,y) INVISIBLE","(1,'one'),(1,'one'),(NULL,'null'),(NULL,'null')"],
  ["binary_key","id INT PRIMARY KEY,x VARBINARY(8),KEY k(x)","(1,X'80FF'),(2,X'0001'),(3,NULL),(4,X'80FF')"],
  ["named_all","`all` INT,y VARCHAR(12),KEY k(`all`)","(1,'one'),(1,'two'),(NULL,'null'),(NULL,'null')"]
]
const CASES: { table: string; sql: string; prepare: number; fields: number; rows: unknown[][] }[] = [
  {"table":"hidden","sql":"SELECT * FROM hidden","prepare":0,"fields":0,"rows":[[null,"null"],[null,"null"],[1,"one"],[1,"one"]]},
  {"table":"hidden","sql":"SELECT t.* FROM hidden t","prepare":1,"fields":1,"rows":[[null,"null"],[null,"null"],[1,"one"],[1,"one"]]},
  {"table":"hidden","sql":"SELECT * FROM hidden LIMIT 1","prepare":0,"fields":0,"rows":[[null,"null"]]},
  {"table":"hidden","sql":"SELECT * FROM hidden ORDER BY 1,2","prepare":0,"fields":0,"rows":[[null,"null"],[null,"null"],[1,"one"],[1,"one"]]},
  {"table":"hidden","sql":"SELECT DISTINCT * FROM hidden","prepare":0,"fields":0,"rows":[[null,"null"],[1,"one"]]},
  {"table":"hidden","sql":"SELECT DISTINCT * FROM hidden ORDER BY 1,2","prepare":0,"fields":0,"rows":[[null,"null"],[1,"one"]]},
  {"table":"hidden","sql":"SELECT DISTINCT t.* FROM hidden t ORDER BY 1,2","prepare":1,"fields":1,"rows":[[null,"null"],[1,"one"]]},
  {"table":"hidden","sql":"SELECT DISTINCT * FROM hidden LIMIT 1","prepare":0,"rows":[[null,"null"]],"fields":35},
  {"table":"hidden","sql":"SELECT DISTINCT * FROM hidden LIMIT 0 OFFSET 1","prepare":0,"rows":[],"fields":35},
  {"table":"hidden","sql":"SELECT COUNT(*) FROM hidden","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"primary_key","sql":"SELECT * FROM primary_key","prepare":3,"fields":3,"rows":[[3,null,"null"],[2,1,"one"],[4,1,"one"],[1,2,"two"]]},
  {"table":"primary_key","sql":"SELECT t.* FROM primary_key t","prepare":4,"fields":4,"rows":[[3,null,"null"],[2,1,"one"],[4,1,"one"],[1,2,"two"]]},
  {"table":"primary_key","sql":"SELECT * FROM primary_key LIMIT 1","prepare":3,"fields":3,"rows":[[3,null,"null"]]},
  {"table":"primary_key","sql":"SELECT * FROM primary_key ORDER BY 1,2","prepare":3,"fields":3,"rows":[[1,2,"two"],[2,1,"one"],[3,null,"null"],[4,1,"one"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key","prepare":3,"fields":3,"rows":[[3,null,"null"],[2,1,"one"],[4,1,"one"],[1,2,"two"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key ORDER BY 1,2","prepare":3,"fields":3,"rows":[[1,2,"two"],[2,1,"one"],[3,null,"null"],[4,1,"one"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT t.* FROM primary_key t ORDER BY 1,2","prepare":4,"fields":4,"rows":[[1,2,"two"],[2,1,"one"],[3,null,"null"],[4,1,"one"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key LIMIT 1","prepare":3,"fields":3,"rows":[[3,null,"null"]]},
  {"table":"primary_key","sql":"SELECT DISTINCT * FROM primary_key LIMIT 0 OFFSET 1","prepare":3,"fields":3,"rows":[]},
  {"table":"primary_key","sql":"SELECT COUNT(*) FROM primary_key","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"composite_key","sql":"SELECT * FROM composite_key","prepare":5,"fields":5,"rows":[[2,2,"null"],[1,1,"one"],[2,1,"one"],[1,2,"two"]]},
  {"table":"composite_key","sql":"SELECT t.* FROM composite_key t","prepare":6,"fields":6,"rows":[[2,2,"null"],[1,1,"one"],[2,1,"one"],[1,2,"two"]]},
  {"table":"composite_key","sql":"SELECT * FROM composite_key LIMIT 1","prepare":5,"fields":5,"rows":[[2,2,"null"]]},
  {"table":"composite_key","sql":"SELECT * FROM composite_key ORDER BY 1,2","prepare":5,"fields":5,"rows":[[1,1,"one"],[1,2,"two"],[2,1,"one"],[2,2,"null"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key","prepare":5,"fields":5,"rows":[[2,2,"null"],[1,1,"one"],[2,1,"one"],[1,2,"two"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key ORDER BY 1,2","prepare":5,"fields":5,"rows":[[1,1,"one"],[1,2,"two"],[2,1,"one"],[2,2,"null"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT t.* FROM composite_key t ORDER BY 1,2","prepare":6,"fields":6,"rows":[[1,1,"one"],[1,2,"two"],[2,1,"one"],[2,2,"null"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key LIMIT 1","prepare":5,"fields":5,"rows":[[2,2,"null"]]},
  {"table":"composite_key","sql":"SELECT DISTINCT * FROM composite_key LIMIT 0 OFFSET 1","prepare":5,"fields":5,"rows":[]},
  {"table":"composite_key","sql":"SELECT COUNT(*) FROM composite_key","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"prefix_key","sql":"SELECT * FROM prefix_key","prepare":7,"fields":7,"rows":[[1,"one"],[1,"only"],[null,"null"],[null,"null"]]},
  {"table":"prefix_key","sql":"SELECT t.* FROM prefix_key t","prepare":8,"fields":8,"rows":[[1,"one"],[1,"only"],[null,"null"],[null,"null"]]},
  {"table":"prefix_key","sql":"SELECT * FROM prefix_key LIMIT 1","prepare":7,"fields":7,"rows":[[1,"one"]]},
  {"table":"prefix_key","sql":"SELECT * FROM prefix_key ORDER BY 1,2","prepare":7,"fields":7,"rows":[[null,"null"],[null,"null"],[1,"one"],[1,"only"]]},
  {"table":"prefix_key","sql":"SELECT DISTINCT * FROM prefix_key","prepare":7,"fields":9,"rows":[[1,"one"],[1,"only"],[null,"null"]]},
  {"table":"prefix_key","sql":"SELECT DISTINCT * FROM prefix_key ORDER BY 1,2","prepare":7,"fields":9,"rows":[[null,"null"],[1,"one"],[1,"only"]]},
  {"table":"prefix_key","sql":"SELECT DISTINCT t.* FROM prefix_key t ORDER BY 1,2","prepare":8,"fields":10,"rows":[[null,"null"],[1,"one"],[1,"only"]]},
  {"table":"prefix_key","sql":"SELECT DISTINCT * FROM prefix_key LIMIT 1","prepare":7,"fields":11,"rows":[[1,"one"]]},
  {"table":"prefix_key","sql":"SELECT DISTINCT * FROM prefix_key LIMIT 0 OFFSET 1","prepare":7,"fields":11,"rows":[]},
  {"table":"prefix_key","sql":"SELECT COUNT(*) FROM prefix_key","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"invisible_key","sql":"SELECT * FROM invisible_key","prepare":12,"fields":12,"rows":[[1,"one"],[1,"one"],[null,"null"],[null,"null"]]},
  {"table":"invisible_key","sql":"SELECT t.* FROM invisible_key t","prepare":13,"fields":13,"rows":[[1,"one"],[1,"one"],[null,"null"],[null,"null"]]},
  {"table":"invisible_key","sql":"SELECT * FROM invisible_key LIMIT 1","prepare":12,"fields":12,"rows":[[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT * FROM invisible_key ORDER BY 1,2","prepare":12,"fields":12,"rows":[[null,"null"],[null,"null"],[1,"one"],[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key","prepare":12,"fields":14,"rows":[[1,"one"],[null,"null"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key ORDER BY 1,2","prepare":12,"fields":14,"rows":[[null,"null"],[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT t.* FROM invisible_key t ORDER BY 1,2","prepare":13,"fields":15,"rows":[[null,"null"],[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key LIMIT 1","prepare":12,"fields":16,"rows":[[1,"one"]]},
  {"table":"invisible_key","sql":"SELECT DISTINCT * FROM invisible_key LIMIT 0 OFFSET 1","prepare":12,"fields":16,"rows":[]},
  {"table":"invisible_key","sql":"SELECT COUNT(*) FROM invisible_key","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"binary_key","sql":"SELECT * FROM binary_key","prepare":17,"fields":17,"rows":[[3,null],[2,{"type":"Buffer","data":[0,1]}],[1,{"type":"Buffer","data":[128,255]}],[4,{"type":"Buffer","data":[128,255]}]]},
  {"table":"binary_key","sql":"SELECT t.* FROM binary_key t","prepare":18,"fields":18,"rows":[[3,null],[2,{"type":"Buffer","data":[0,1]}],[1,{"type":"Buffer","data":[128,255]}],[4,{"type":"Buffer","data":[128,255]}]]},
  {"table":"binary_key","sql":"SELECT * FROM binary_key LIMIT 1","prepare":17,"fields":17,"rows":[[3,null]]},
  {"table":"binary_key","sql":"SELECT * FROM binary_key ORDER BY 1,2","prepare":17,"fields":17,"rows":[[1,{"type":"Buffer","data":[128,255]}],[2,{"type":"Buffer","data":[0,1]}],[3,null],[4,{"type":"Buffer","data":[128,255]}]]},
  {"table":"binary_key","sql":"SELECT DISTINCT * FROM binary_key","prepare":17,"fields":17,"rows":[[3,null],[2,{"type":"Buffer","data":[0,1]}],[1,{"type":"Buffer","data":[128,255]}],[4,{"type":"Buffer","data":[128,255]}]]},
  {"table":"binary_key","sql":"SELECT DISTINCT * FROM binary_key ORDER BY 1,2","prepare":17,"fields":17,"rows":[[1,{"type":"Buffer","data":[128,255]}],[2,{"type":"Buffer","data":[0,1]}],[3,null],[4,{"type":"Buffer","data":[128,255]}]]},
  {"table":"binary_key","sql":"SELECT DISTINCT t.* FROM binary_key t ORDER BY 1,2","prepare":18,"fields":18,"rows":[[1,{"type":"Buffer","data":[128,255]}],[2,{"type":"Buffer","data":[0,1]}],[3,null],[4,{"type":"Buffer","data":[128,255]}]]},
  {"table":"binary_key","sql":"SELECT DISTINCT * FROM binary_key LIMIT 1","prepare":17,"fields":17,"rows":[[3,null]]},
  {"table":"binary_key","sql":"SELECT DISTINCT * FROM binary_key LIMIT 0 OFFSET 1","prepare":17,"fields":17,"rows":[]},
  {"table":"binary_key","sql":"SELECT COUNT(*) FROM binary_key","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"named_all","sql":"SELECT * FROM named_all","prepare":19,"fields":19,"rows":[[1,"one"],[1,"two"],[null,"null"],[null,"null"]]},
  {"table":"named_all","sql":"SELECT t.* FROM named_all t","prepare":20,"fields":20,"rows":[[1,"one"],[1,"two"],[null,"null"],[null,"null"]]},
  {"table":"named_all","sql":"SELECT * FROM named_all LIMIT 1","prepare":19,"fields":19,"rows":[[1,"one"]]},
  {"table":"named_all","sql":"SELECT * FROM named_all ORDER BY 1,2","prepare":19,"fields":19,"rows":[[null,"null"],[null,"null"],[1,"one"],[1,"two"]]},
  {"table":"named_all","sql":"SELECT DISTINCT * FROM named_all","prepare":19,"fields":21,"rows":[[1,"one"],[1,"two"],[null,"null"]]},
  {"table":"named_all","sql":"SELECT DISTINCT * FROM named_all ORDER BY 1,2","prepare":19,"fields":21,"rows":[[null,"null"],[1,"one"],[1,"two"]]},
  {"table":"named_all","sql":"SELECT DISTINCT t.* FROM named_all t ORDER BY 1,2","prepare":20,"fields":22,"rows":[[null,"null"],[1,"one"],[1,"two"]]},
  {"table":"named_all","sql":"SELECT DISTINCT * FROM named_all LIMIT 1","prepare":19,"fields":23,"rows":[[1,"one"]]},
  {"table":"named_all","sql":"SELECT DISTINCT * FROM named_all LIMIT 0 OFFSET 1","prepare":19,"fields":23,"rows":[]},
  {"table":"named_all","sql":"SELECT COUNT(*) FROM named_all","prepare":2,"fields":2,"rows":[[4]]},
  {"table":"named_all","sql":"SELECT `all` FROM named_all","prepare":24,"fields":24,"rows":[[null],[null],[1],[1]]},
  {"table":"named_all","sql":"SELECT `all` FROM named_all LIMIT 1","prepare":24,"fields":24,"rows":[[null]]},
  {"table":"named_all","sql":"SELECT DISTINCT `all` FROM named_all","prepare":24,"fields":24,"rows":[[null],[1]]}
]
const FRESH_DEFS: string[][] = [
  ["h","x INT,y VARCHAR(12),KEY k(x,y)","(1,'one'),(1,'one'),(NULL,'null'),(NULL,'null')","x","UPDATE h SET y=CONCAT('z',y)","DELETE FROM h WHERE x=1"],
  ["p","id INT PRIMARY KEY,x INT,y VARCHAR(12),KEY k(x,y)","(1,2,'two'),(2,1,'one'),(3,NULL,'null'),(4,1,'one')","x","UPDATE p SET y=CONCAT('z',y)","DELETE FROM p WHERE id=1"],
  ["b","id BIGINT PRIMARY KEY,x VARBINARY(8),KEY k(x)","(9007199254740993,X'80FF'),(9007199254740994,X'0001'),(9007199254740995,NULL),(9007199254740996,X'80FF')","x","UPDATE b SET x=X'00FF' WHERE id=9007199254740993","DELETE FROM b WHERE id=9007199254740993"],
  ["a","`all` INT,y VARCHAR(12),KEY k(`all`)","(1,'one'),(1,'two'),(NULL,'null'),(NULL,'null')","`all`","UPDATE a SET y=CONCAT('z',y)","DELETE FROM a WHERE `all`=1"]
]
const FRESH_CASES: { table: string; sql: string; prepare: number; fields: number; rows: unknown[][][] }[] = [
  {"table":"h","sql":"SELECT * FROM h","prepare":25,"fields":25,"rows":[[[null,"null"],[null,"null"],[1,"one"],[1,"one"]],[[null,"znull"],[null,"znull"],[1,"zone"],[1,"zone"]],[[null,"znull"],[null,"znull"]],[[null,"null"],[null,"null"],[1,"one"],[1,"one"]]]},
  {"table":"h","sql":"SELECT * FROM h LIMIT 1","prepare":25,"fields":25,"rows":[[[null,"null"]],[[null,"znull"]],[[null,"znull"]],[[null,"null"]]]},
  {"table":"h","sql":"SELECT DISTINCT * FROM h ORDER BY 1,2 LIMIT 2 OFFSET 1","prepare":25,"fields":25,"rows":[[[1,"one"]],[[1,"zone"]],[],[[1,"one"]]]},
  {"table":"h","sql":"SELECT DISTINCT * FROM h LIMIT 1","prepare":25,"rows":[[[null,"null"]],[[null,"znull"]],[[null,"znull"]],[[null,"null"]]],"fields":36},
  {"table":"h","sql":"SELECT x FROM h","prepare":26,"fields":26,"rows":[[[null],[null],[1],[1]],[[null],[null],[1],[1]],[[null],[null]],[[null],[null],[1],[1]]]},
  {"table":"p","sql":"SELECT * FROM p","prepare":27,"fields":27,"rows":[[[3,null,"null"],[2,1,"one"],[4,1,"one"],[1,2,"two"]],[[3,null,"znull"],[2,1,"zone"],[4,1,"zone"],[1,2,"ztwo"]],[[3,null,"znull"],[2,1,"zone"],[4,1,"zone"]],[[3,null,"null"],[2,1,"one"],[4,1,"one"],[1,2,"two"]]]},
  {"table":"p","sql":"SELECT * FROM p LIMIT 1","prepare":27,"fields":27,"rows":[[[3,null,"null"]],[[3,null,"znull"]],[[3,null,"znull"]],[[3,null,"null"]]]},
  {"table":"p","sql":"SELECT DISTINCT * FROM p ORDER BY 1,2 LIMIT 2 OFFSET 1","prepare":27,"fields":27,"rows":[[[2,1,"one"],[3,null,"null"]],[[2,1,"zone"],[3,null,"znull"]],[[3,null,"znull"],[4,1,"zone"]],[[2,1,"one"],[3,null,"null"]]]},
  {"table":"p","sql":"SELECT DISTINCT * FROM p LIMIT 1","prepare":27,"fields":27,"rows":[[[3,null,"null"]],[[3,null,"znull"]],[[3,null,"znull"]],[[3,null,"null"]]]},
  {"table":"p","sql":"SELECT x FROM p","prepare":28,"fields":28,"rows":[[[null],[1],[1],[2]],[[null],[1],[1],[2]],[[null],[1],[1]],[[null],[1],[1],[2]]]},
  {"table":"b","sql":"SELECT * FROM b","prepare":29,"fields":29,"rows":[[["9007199254740995",null],["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740993",{"type":"Buffer","data":[128,255]}],["9007199254740996",{"type":"Buffer","data":[128,255]}]],[["9007199254740995",null],["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740993",{"type":"Buffer","data":[0,255]}],["9007199254740996",{"type":"Buffer","data":[128,255]}]],[["9007199254740995",null],["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740996",{"type":"Buffer","data":[128,255]}]],[["9007199254740995",null],["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740993",{"type":"Buffer","data":[128,255]}],["9007199254740996",{"type":"Buffer","data":[128,255]}]]]},
  {"table":"b","sql":"SELECT * FROM b LIMIT 1","prepare":29,"fields":29,"rows":[[["9007199254740995",null]],[["9007199254740995",null]],[["9007199254740995",null]],[["9007199254740995",null]]]},
  {"table":"b","sql":"SELECT DISTINCT * FROM b ORDER BY 1,2 LIMIT 2 OFFSET 1","prepare":29,"fields":29,"rows":[[["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740995",null]],[["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740995",null]],[["9007199254740995",null],["9007199254740996",{"type":"Buffer","data":[128,255]}]],[["9007199254740994",{"type":"Buffer","data":[0,1]}],["9007199254740995",null]]]},
  {"table":"b","sql":"SELECT DISTINCT * FROM b LIMIT 1","prepare":29,"fields":29,"rows":[[["9007199254740995",null]],[["9007199254740995",null]],[["9007199254740995",null]],[["9007199254740995",null]]]},
  {"table":"b","sql":"SELECT x FROM b","prepare":30,"fields":30,"rows":[[[null],[{"type":"Buffer","data":[0,1]}],[{"type":"Buffer","data":[128,255]}],[{"type":"Buffer","data":[128,255]}]],[[null],[{"type":"Buffer","data":[0,1]}],[{"type":"Buffer","data":[0,255]}],[{"type":"Buffer","data":[128,255]}]],[[null],[{"type":"Buffer","data":[0,1]}],[{"type":"Buffer","data":[128,255]}]],[[null],[{"type":"Buffer","data":[0,1]}],[{"type":"Buffer","data":[128,255]}],[{"type":"Buffer","data":[128,255]}]]]},
  {"table":"a","sql":"SELECT * FROM a","prepare":31,"fields":31,"rows":[[[1,"one"],[1,"two"],[null,"null"],[null,"null"]],[[1,"zone"],[1,"ztwo"],[null,"znull"],[null,"znull"]],[[null,"znull"],[null,"znull"]],[[1,"one"],[1,"two"],[null,"null"],[null,"null"]]]},
  {"table":"a","sql":"SELECT * FROM a LIMIT 1","prepare":31,"fields":31,"rows":[[[1,"one"]],[[1,"zone"]],[[null,"znull"]],[[1,"one"]]]},
  {"table":"a","sql":"SELECT DISTINCT * FROM a ORDER BY 1,2 LIMIT 2 OFFSET 1","prepare":31,"fields":32,"rows":[[[1,"one"],[1,"two"]],[[1,"zone"],[1,"ztwo"]],[],[[1,"one"],[1,"two"]]]},
  {"table":"a","sql":"SELECT DISTINCT * FROM a LIMIT 1","prepare":31,"fields":33,"rows":[[[1,"one"]],[[1,"zone"]],[[null,"znull"]],[[1,"one"]]]},
  {"table":"a","sql":"SELECT `all` FROM a","prepare":34,"fields":34,"rows":[[[null],[null],[1],[1]],[[null],[null],[1],[1]],[[null],[null]],[[null],[null],[1],[1]]]}
]
const fieldsOf = (fields: mysql.FieldPacket[]) => fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
const jsonRows = (rows: unknown): unknown => JSON.parse(JSON.stringify(rows))
const objectRows = (rows: unknown[][], fields: number) => rows.map((row) => Object.fromEntries(row.map((value, i) => [String(FIELDS[fields]![i]![0]), value])))

async function withTables(schema: string, definitions: string[][], run: (conn: mysql.Connection) => Promise<void>, exactBigInts = false): Promise<void> {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection({ supportBigNumbers: exactBigInts, bigNumberStrings: exactBigInts,
    ...(db === undefined ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
      : { stream: db.createStream(), user: 'root' }) })
  try {
    await conn.query(`CREATE DATABASE ${schema}`)
    await conn.query(`USE ${schema}`)
    for (const [table, def, values] of definitions) {
      await conn.query(`CREATE TABLE ${table}(${def}) STATS_AUTO_RECALC=0`)
      await conn.query(`INSERT INTO ${table} VALUES ${values}`)
      await conn.query(`ANALYZE TABLE ${table}`)
    }
    await run(conn)
  } finally { await conn.query(`DROP DATABASE IF EXISTS ${schema}`); await conn.end(); await db?.end() }
}

async function assertExecution(conn: mysql.Connection, statement: mysql.PreparedStatementInfo, entry: { sql: string; prepare: number; fields: number }, expected: unknown[][], state: number): Promise<void> {
  const options = { sql: entry.sql, rowsAsArray: true }
  for (const method of ['query', 'execute', 'prepared']) {
    const [rows, fields] = method === 'prepared' ? await statement.execute([]) : method === 'query' ? await conn.query(options) : await conn.execute(options)
    assert.deepEqual(jsonRows(rows), method === 'prepared' ? objectRows(expected, entry.prepare) : expected, `${entry.sql}/${state}/${method}: rows and bytes`)
    assert.deepEqual(fieldsOf(fields), FIELDS[entry.fields], `${entry.sql}/${state}/${method}: fields`)
    assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], `${entry.sql}/${state}/${method}: warnings`)
  }
}

test('covering star access preserves native order, bytes, key exclusions and matched field facts', async () => {
  await withTables('covering80', DEFS, async (conn) => {
    for (const entry of CASES) {
      const options = { sql: entry.sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fieldsOf(columns), FIELDS[entry.prepare], `${entry.sql}: prepare`)
        await assertExecution(conn, statement, entry, entry.rows, 0)
      } finally { await statement.close(); conn.unprepare(options) }
    }
  })
})

test('source coverage and UNIQUE ordering stay fresh across writes and retained statements', async () => {
  await withTables('covering80_fresh', FRESH_DEFS, async (conn) => {
    for (const entry of FRESH_CASES) {
      const options = { sql: entry.sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fieldsOf(columns), FIELDS[entry.prepare], `${entry.sql}: prepare`)
        const definition = FRESH_DEFS.find((d) => d[0] === entry.table)!
        for (const state of [0, 1, 2, 3]) {
          if (state === 1) await conn.query(definition[4]!)
          if (state === 2) await conn.query(definition[5]!)
          if (state === 3) {
            await conn.query(`DELETE FROM ${entry.table}`)
            await conn.query(`INSERT INTO ${entry.table} VALUES ${definition[2]}`)
          }
          await assertExecution(conn, statement, entry, entry.rows[state]!, state)
        }
      } finally { await statement.close(); conn.unprepare(options) }
    }
  }, true)
})

test('full hidden-row-ID keys drive bounded scans with clustered value fetches and early lock release', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root' })
  try {
    await conn.query('CREATE DATABASE d')
    await conn.query('USE d')
    for (const [table, key] of [['h', 'KEY k(x,y)'], ['hp', 'KEY k(x,y(2))'], ['hi', 'KEY k(x,y) INVISIBLE']]) {
      await conn.query(`CREATE TABLE ${table}(x INT,y VARCHAR(12),${key}) STATS_AUTO_RECALC=0`)
      await conn.query(`INSERT INTO ${table} VALUES(1,'one'),(NULL,'null'),(NULL,'null')`)
      await conn.query(`ANALYZE TABLE ${table}`)
    }
    const catalog = db.catalog!
    const open = catalog.table.bind(catalog)
    const rowTree = open('d', 'h').def.rowIdIndexId!
    const counters = new Map<string, { index: number; table: number; closed: number }>()
    let clustered = 0
    const get = BTree.prototype.get
    BTree.prototype.get = function(key) { if (this.indexId === rowTree) clustered++; return get.call(this, key) }
    catalog.table = (schema, name, trx) => {
      const table = open(schema, name, trx)
      if (schema === 'd' && ['h', 'hp', 'hi'].includes(name)) {
        const counter = counters.get(name) ?? { index: 0, table: 0, closed: 0 }
        counters.set(name, counter)
        const scan = table.scan.bind(table), indexScan = table.indexScan.bind(table)
        table.scan = function*(range, transaction, mode) {
          try { for (const row of scan(range, transaction, mode)) { counter.table++; yield row } }
          finally { counter.closed++ }
        }
        table.indexScan = function*(index, range, transaction, mode) {
          try { for (const row of indexScan(index, range, transaction, mode)) { counter.index++; yield row } }
          finally { counter.closed++ }
        }
      }
      return table
    }
    try {
      assert.deepEqual((await conn.query({ sql: 'SELECT * FROM h LIMIT 1', rowsAsArray: true }))[0], [[null, 'null']])
      assert.deepEqual(counters.get('h'), { index: 1, table: 0, closed: 1 })
      assert.equal(clustered, 1, 'secondary access still fetches the original clustered value')
      for (const name of ['hp', 'hi']) {
        assert.deepEqual((await conn.execute({ sql: `SELECT * FROM ${name} LIMIT 1`, rowsAsArray: true }))[0], [[1, 'one']])
        assert.deepEqual(counters.get(name), { index: 0, table: 1, closed: 1 })
      }
    } finally { catalog.table = open; BTree.prototype.get = get }
    for await (const row of db.stream<{ x: number | null; y: string }>('SELECT * FROM d.h FOR UPDATE')) {
      assert.deepEqual(row, { x: null, y: 'null' })
      break
    }
    assert.equal(db.openConnections, 1)
    const writer = await db.connect()
    try { await writer.query('SET innodb_lock_wait_timeout=1'); await writer.query("UPDATE d.h SET y='changed' WHERE x IS NULL") }
    finally { await writer.end() }
  } finally { await conn.end(); await db.end() }
})
