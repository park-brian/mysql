// SHOW COLUMNS, DESCRIBE and SHOW INDEX, as 8.4.11 answered each of these
// statements: rows, and every result column's definition (table, original
// table, name, original name, length, type, flags, decimals).
//
// What it pins: each is a query over INFORMATION_SCHEMA filtered by the
// database, the table, LIKE on the first column and the statement's own WHERE
// over the renamed columns; ordered by the column's position, or the key's and
// the part's. The result columns are the server's SHOW views' own, not a
// derived table's. A FULLTEXT column is a key's (MUL). Cardinality is each
// key prefix's distinct values, NULLs as one and in the key's collation ('A'
// and 'a' are one), a FULLTEXT key's the row count. 1049 before 1146.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly [readonly (readonly (string | null)[])[], string] | readonly [number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE g (id INT PRIMARY KEY AUTO_INCREMENT, a VARCHAR(20) NOT NULL DEFAULT 'x' COMMENT 'hi', b DECIMAL(5,2), c TEXT, d DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, e VARCHAR(10), UNIQUE KEY ua (a), KEY kb (b, a(5)) COMMENT 'kc', KEY ke (e), FULLTEXT KEY fc (c))", [0]],
  ["INSERT INTO g (a, b, e) VALUES ('p', 1, 'A'), ('q', 1, 'a'), ('r', 2, NULL), ('s', NULL, NULL), ('ss', NULL, 'b')", [5]],
  ["CREATE VIEW gv AS SELECT id, a FROM g", [0]],
  ["SHOW COLUMNS FROM g", [[["id","int","NO","PRI",null,"auto_increment"],["a","varchar(20)","NO","UNI","x",""],["b","decimal(5,2)","YES","MUL",null,""],["c","text","YES","MUL",null,""],["d","datetime","YES","","CURRENT_TIMESTAMP","DEFAULT_GENERATED on update CURRENT_TIMESTAMP"],["e","varchar(10)","YES","MUL",null,""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["SHOW FULL COLUMNS FROM g", [[["id","int",null,"NO","PRI",null,"auto_increment","select,insert,update,references",""],["a","varchar(20)","utf8mb4_0900_ai_ci","NO","UNI","x","","select,insert,update,references","hi"],["b","decimal(5,2)",null,"YES","MUL",null,"","select,insert,update,references",""],["c","text","utf8mb4_0900_ai_ci","YES","MUL",null,"","select,insert,update,references",""],["d","datetime",null,"YES","","CURRENT_TIMESTAMP","DEFAULT_GENERATED on update CURRENT_TIMESTAMP","select,insert,update,references",""],["e","varchar(10)","utf8mb4_0900_ai_ci","YES","MUL",null,"","select,insert,update,references",""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Collation/Collation/256/253/0/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0 COLUMNS//Privileges/Privileges/616/253/0/0 COLUMNS//Comment/Comment/24576/252/145/0"]],
  ["SHOW COLUMNS FROM g LIKE '_'", [[["a","varchar(20)","NO","UNI","x",""],["b","decimal(5,2)","YES","MUL",null,""],["c","text","YES","MUL",null,""],["d","datetime","YES","","CURRENT_TIMESTAMP","DEFAULT_GENERATED on update CURRENT_TIMESTAMP"],["e","varchar(10)","YES","MUL",null,""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["SHOW COLUMNS FROM g WHERE `Null` = 'NO'", [[["id","int","NO","PRI",null,"auto_increment"],["a","varchar(20)","NO","UNI","x",""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["SHOW FIELDS FROM g FROM app", [[["id","int","NO","PRI",null,"auto_increment"],["a","varchar(20)","NO","UNI","x",""],["b","decimal(5,2)","YES","MUL",null,""],["c","text","YES","MUL",null,""],["d","datetime","YES","","CURRENT_TIMESTAMP","DEFAULT_GENERATED on update CURRENT_TIMESTAMP"],["e","varchar(10)","YES","MUL",null,""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["SHOW COLUMNS IN app.g WHERE Field LIKE '%a%' AND `Key` <> ''", [[["a","varchar(20)","NO","UNI","x",""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["SHOW COLUMNS FROM gv", [[["id","int","NO","","0",""],["a","varchar(20)","NO","","x",""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["DESCRIBE g", [[["id","int","NO","PRI",null,"auto_increment"],["a","varchar(20)","NO","UNI","x",""],["b","decimal(5,2)","YES","MUL",null,""],["c","text","YES","MUL",null,""],["d","datetime","YES","","CURRENT_TIMESTAMP","DEFAULT_GENERATED on update CURRENT_TIMESTAMP"],["e","varchar(10)","YES","MUL",null,""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["DESC g a", [[["a","varchar(20)","NO","UNI","x",""]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["DESC g 'd%'", [[["d","datetime","YES","","CURRENT_TIMESTAMP","DEFAULT_GENERATED on update CURRENT_TIMESTAMP"]],"COLUMNS//Field/Field/256/253/0/0 COLUMNS/columns/Type/Type/67108860/252/4241/0 COLUMNS//Null/Null/12/253/1/0 COLUMNS/columns/Key/Key/12/254/4481/0 COLUMNS/columns/Default/Default/262140/252/144/0 COLUMNS//Extra/Extra/1024/253/0/0"]],
  ["SHOW INDEX FROM g", [[["g","0","PRIMARY","1","id","A","5",null,null,"","BTREE","","","YES",null],["g","0","ua","1","a","A","5",null,null,"","BTREE","","","YES",null],["g","1","kb","1","b","A","3",null,null,"YES","BTREE","","kc","YES",null],["g","1","kb","2","a","A","5","5",null,"","BTREE","","kc","YES",null],["g","1","ke","1","e","A","3",null,null,"YES","BTREE","","","YES",null],["g","1","fc","1","c",null,"5",null,null,"YES","FULLTEXT","","","YES",null]],"SHOW_STATISTICS/tables/Table/Table/256/253/4225/0 SHOW_STATISTICS//Non_unique/Non_unique/2/3/1/0 SHOW_STATISTICS//Key_name/Key_name/256/253/0/0 SHOW_STATISTICS/index_column_usage/Seq_in_index/Seq_in_index/10/3/4129/0 SHOW_STATISTICS//Column_name/Column_name/256/253/0/0 SHOW_STATISTICS//Collation/Collation/4/253/0/0 SHOW_STATISTICS//Cardinality/Cardinality/21/8/0/0 SHOW_STATISTICS//Sub_part/Sub_part/21/8/0/0 //Packed//0/6/128/0 SHOW_STATISTICS//Null/Null/12/253/1/0 SHOW_STATISTICS//Index_type/Index_type/44/253/129/0 SHOW_STATISTICS//Comment/Comment/32/253/1/0 SHOW_STATISTICS/indexes/Index_comment/Index_comment/8192/253/4225/0 SHOW_STATISTICS//Visible/Visible/12/253/1/0 SHOW_STATISTICS//Expression/Expression/4294967295/252/144/0"]],
  ["SHOW KEYS FROM g WHERE Key_name = 'kb'", [[["g","1","kb","1","b","A","3",null,null,"YES","BTREE","","kc","YES",null],["g","1","kb","2","a","A","5","5",null,"","BTREE","","kc","YES",null]],"SHOW_STATISTICS/tables/Table/Table/256/253/4225/0 SHOW_STATISTICS//Non_unique/Non_unique/2/3/1/0 SHOW_STATISTICS//Key_name/Key_name/256/253/0/0 SHOW_STATISTICS/index_column_usage/Seq_in_index/Seq_in_index/10/3/4129/0 SHOW_STATISTICS//Column_name/Column_name/256/253/0/0 SHOW_STATISTICS//Collation/Collation/4/253/0/0 SHOW_STATISTICS//Cardinality/Cardinality/21/8/0/0 SHOW_STATISTICS//Sub_part/Sub_part/21/8/0/0 //Packed//0/6/128/0 SHOW_STATISTICS//Null/Null/12/253/1/0 SHOW_STATISTICS//Index_type/Index_type/44/253/129/0 SHOW_STATISTICS//Comment/Comment/32/253/1/0 SHOW_STATISTICS/indexes/Index_comment/Index_comment/8192/253/4225/0 SHOW_STATISTICS//Visible/Visible/12/253/1/0 SHOW_STATISTICS//Expression/Expression/4294967295/252/144/0"]],
  ["SHOW INDEXES IN g FROM app WHERE Non_unique = 0", [[["g","0","PRIMARY","1","id","A","5",null,null,"","BTREE","","","YES",null],["g","0","ua","1","a","A","5",null,null,"","BTREE","","","YES",null]],"SHOW_STATISTICS/tables/Table/Table/256/253/4225/0 SHOW_STATISTICS//Non_unique/Non_unique/2/3/1/0 SHOW_STATISTICS//Key_name/Key_name/256/253/0/0 SHOW_STATISTICS/index_column_usage/Seq_in_index/Seq_in_index/10/3/4129/0 SHOW_STATISTICS//Column_name/Column_name/256/253/0/0 SHOW_STATISTICS//Collation/Collation/4/253/0/0 SHOW_STATISTICS//Cardinality/Cardinality/21/8/0/0 SHOW_STATISTICS//Sub_part/Sub_part/21/8/0/0 //Packed//0/6/128/0 SHOW_STATISTICS//Null/Null/12/253/1/0 SHOW_STATISTICS//Index_type/Index_type/44/253/129/0 SHOW_STATISTICS//Comment/Comment/32/253/1/0 SHOW_STATISTICS/indexes/Index_comment/Index_comment/8192/253/4225/0 SHOW_STATISTICS//Visible/Visible/12/253/1/0 SHOW_STATISTICS//Expression/Expression/4294967295/252/144/0"]],
  ["SHOW COLUMNS FROM nope", [1146,"Table 'app.nope' doesn't exist"]],
  ["SHOW INDEX FROM nope", [1146,"Table 'app.nope' doesn't exist"]],
  ["DESCRIBE nope", [1146,"Table 'app.nope' doesn't exist"]],
  ["SHOW COLUMNS FROM g FROM nodb", [1049,"Unknown database 'nodb'"]],
]

test('SHOW COLUMNS, DESCRIBE and SHOW INDEX answer as 8.4.11 does, column definitions included', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '' })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r, f] = await conn.query({ sql, rowsAsArray: true })
        actual = Array.isArray(r)
          ? [(r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v)))), f.map((x) => [x.table, x.orgTable, x.name, x.orgName, x.columnLength, x.columnType, x.flags, x.decimals].join('/')).join(' ')]
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
