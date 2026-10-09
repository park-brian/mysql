// SHOW COLUMNS, DESCRIBE, SHOW INDEX and SHOW CREATE VIEW, as 8.4.11 answered each of these
// statements: rows, and every result column's definition (table, original
// table, name, original name, length, type, flags, decimals).
//
// What it pins: each is a query over INFORMATION_SCHEMA filtered by the
// database, the table, LIKE on the first column and the statement's own WHERE
// over the renamed columns; ordered by the column's position, or the key's and
// the part's. The result columns are the server's SHOW views' own, not a
// derived table's. A FULLTEXT column is a key's (MUL). Cardinality is each
// key prefix's distinct values, NULLs as one and in the key's collation ('A'
// and 'a' are one), a FULLTEXT key's the row count, after ANALYZE TABLE so
// the server's statistics are not caught mid-recalculation. 1049 before 1146.
//
// SHOW CREATE VIEW (and SHOW CREATE TABLE of a view) writes the view back
// with its algorithm, definer, SQL SECURITY, column list and check option,
// and names in the current database unqualified; a view over a view prints
// too. A table is 1347. INFORMATION_SCHEMA.VIEWS keeps the select list's own
// names under a column list. Column definitions are compared for SHOW and
// DESCRIBE, values for every statement.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly [readonly (readonly (string | null)[])[], string] | readonly [number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE g (id INT PRIMARY KEY AUTO_INCREMENT, a VARCHAR(20) NOT NULL DEFAULT 'x' COMMENT 'hi', b DECIMAL(5,2), c TEXT, d DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, e VARCHAR(10), UNIQUE KEY ua (a), KEY kb (b, a(5)) COMMENT 'kc', KEY ke (e), FULLTEXT KEY fc (c))", [0]],
  ["INSERT INTO g (a, b, e) VALUES ('p', 1, 'A'), ('q', 1, 'a'), ('r', 2, NULL), ('s', NULL, NULL), ('ss', NULL, 'b')", [5]],
  ["ANALYZE TABLE g", [[["app.g","analyze","status","OK"]],""]],
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

const VIEW_SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE g (id INT PRIMARY KEY, a INT)", [0]],
  ["CREATE VIEW v AS SELECT id, a * 2 b FROM g WHERE a > 10", [0]],
  ["SHOW CREATE VIEW v", [[["v","CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select `g`.`id` AS `id`,(`g`.`a` * 2) AS `b` from `g` where (`g`.`a` > 10)","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["SELECT VIEW_DEFINITION FROM information_schema.VIEWS WHERE TABLE_NAME = 'v'", [[["select `app`.`g`.`id` AS `id`,(`app`.`g`.`a` * 2) AS `b` from `app`.`g` where (`app`.`g`.`a` > 10)"]],""]],
  ["CREATE ALGORITHM=MERGE VIEW v2 (x, y) AS SELECT id, a FROM g WITH CHECK OPTION", [0]],
  ["SHOW CREATE VIEW v2", [[["v2","CREATE ALGORITHM=MERGE DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v2` (`x`,`y`) AS select `g`.`id` AS `id`,`g`.`a` AS `a` from `g` WITH CASCADED CHECK OPTION","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["CREATE ALGORITHM=TEMPTABLE SQL SECURITY INVOKER VIEW v3 AS SELECT 1 AS one, 'x'", [0]],
  ["SHOW CREATE VIEW v3", [[["v3","CREATE ALGORITHM=TEMPTABLE DEFINER=`root`@`%` SQL SECURITY INVOKER VIEW `v3` AS select 1 AS `one`,'x' AS `x`","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["CREATE VIEW v4 AS SELECT * FROM v WITH LOCAL CHECK OPTION", [0]],
  ["SHOW CREATE VIEW v4", [[["v4","CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v4` AS select `v`.`id` AS `id`,`v`.`b` AS `b` from `v` WITH LOCAL CHECK OPTION","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["SHOW CREATE VIEW app.v", [[["v","CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select `g`.`id` AS `id`,(`g`.`a` * 2) AS `b` from `g` where (`g`.`a` > 10)","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["SHOW CREATE VIEW g", [1347,"'app.g' is not VIEW"]],
  ["SHOW CREATE VIEW nope", [1146,"Table 'app.nope' doesn't exist"]],
  ["SHOW CREATE TABLE v", [[["v","CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v` AS select `g`.`id` AS `id`,(`g`.`a` * 2) AS `b` from `g` where (`g`.`a` > 10)","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["CREATE DATABASE o2", [1]],
  ["CREATE VIEW o2.vo AS SELECT id FROM app.g", [0]],
  ["SHOW CREATE VIEW o2.vo", [[["vo","CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `o2`.`vo` AS select `g`.`id` AS `id` from `g`","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["SELECT TABLE_NAME, VIEW_DEFINITION, SECURITY_TYPE, CHECK_OPTION FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'app' ORDER BY TABLE_NAME", [[["v","select `app`.`g`.`id` AS `id`,(`app`.`g`.`a` * 2) AS `b` from `app`.`g` where (`app`.`g`.`a` > 10)","DEFINER","NONE"],["v2","select `app`.`g`.`id` AS `id`,`app`.`g`.`a` AS `a` from `app`.`g`","DEFINER","CASCADED"],["v3","select 1 AS `one`,'x' AS `x`","INVOKER","NONE"],["v4","select `app`.`v`.`id` AS `id`,`app`.`v`.`b` AS `b` from `app`.`v`","DEFINER","LOCAL"]],""]],
  ["RENAME TABLE v3 TO v3b", [0]],
  ["SHOW CREATE VIEW v3b", [[["v3b","CREATE ALGORITHM=TEMPTABLE DEFINER=`root`@`%` SQL SECURITY INVOKER VIEW `v3b` AS select 1 AS `one`,'x' AS `x`","utf8mb4","utf8mb4_unicode_ci"]],"//View//256/253/1/31 //Create View//4096/253/1/31 //character_set_client//128/253/1/31 //collation_connection//128/253/1/31"]],
  ["DROP DATABASE o2", [1]],
]

for (const [title, script] of [['SHOW COLUMNS, DESCRIBE and SHOW INDEX answer as 8.4.11 does, column definitions included', SCRIPT], ['SHOW CREATE VIEW writes a view back as 8.4.11 does', VIEW_SCRIPT]] as const) {
  test(title, async () => {
    const db = await MySQL.open(':memory:')
    const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
    try {
      await conn.query('CREATE DATABASE app')
      await conn.query('USE app')
      for (const [sql, expected] of script) {
        let actual: Outcome
        try {
          const [r, f] = await conn.query({ sql, rowsAsArray: true })
          actual = Array.isArray(r)
            ? [(r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v)))), /^(SHOW|DESC)/i.test(sql) ? f.map((x) => [x.table, x.orgTable, x.name, x.orgName, x.columnLength, x.columnType, x.flags, x.decimals].join('/')).join(' ') : '']
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
}
