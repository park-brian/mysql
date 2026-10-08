// M5.26 — FULLTEXT indexes and MATCH … AGAINST, as 8.4.11 answered each of
// these statements, relevance values to the last bit of InnoDB's float.
//
// The script covers: FULLTEXT keys made by CREATE TABLE, ALTER TABLE and
// CREATE INDEX, shown by SHOW CREATE TABLE and STATISTICS, dropped, and
// refused (1061, 1214, 1283); MATCH's own refusals (1191, 1210); natural
// language ranking, `tf × idf²`, over Prisma's three users and over a
// table with repeated words, punctuation, a NULL row, stopwords and a word
// every row holds; a natural query naming a word twice; BOOLEAN MODE's
// operators, prefixes, phrases and groups, and its grammar's errors with
// Bison's words, `'John <--> Smith'` among them, which Prisma snapshots; an
// ORDER BY on relevance, which keeps ties in row order; and a DELETE, after
// which the statistics no longer count the row.
//
// What is left out is named in `fulltext.ts`: InnoDB counts an UPDATE's old
// version in a prefix's statistics until OPTIMIZE TABLE, and applies a
// transaction's changes to the index at its commit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE u (id INT PRIMARY KEY AUTO_INCREMENT, email VARCHAR(191) NOT NULL, name VARCHAR(191) NOT NULL, FULLTEXT INDEX nm (name), FULLTEXT INDEX ne (name, email), FULLTEXT INDEX em (email))", [0,0,"",0]],
  ["INSERT INTO u (email, name) VALUES ('email1@email.io', 'John Smith'), ('email2@email.io', 'April ONeal'), ('email3@email.io', 'John Pearl')", [3,1,"Records: 3  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, MATCH(name) AGAINST('John'), MATCH(name) AGAINST('John' IN BOOLEAN MODE), MATCH(name, email) AGAINST('John'), MATCH(name) AGAINST('Smith'), MATCH(name) AGAINST('John Smith'), MATCH(email) AGAINST('email1') FROM u ORDER BY id", [["1","0.031008131802082062","0.031008131802082062","0.031008131802082062","0.22764469683170319","0.25865283608436584","0.22764469683170319"],["2","0","0","0","0","0","0"],["3","0.031008131802082062","0.031008131802082062","0.031008131802082062","0","0.031008131802082062","0"]]],
  ["SELECT id FROM u WHERE MATCH(name) AGAINST('+John +Smith' IN BOOLEAN MODE)", [["1"]]],
  ["SELECT id FROM u WHERE MATCH(name) AGAINST('John April' IN BOOLEAN MODE) ORDER BY id", [["1"],["2"],["3"]]],
  ["SELECT id FROM u WHERE MATCH(name) AGAINST('John -Smith April' IN BOOLEAN MODE) ORDER BY id", [["2"],["3"]]],
  ["SELECT id FROM u WHERE MATCH(name) AGAINST('+April +Smith' IN BOOLEAN MODE)", []],
  ["SELECT id FROM u WHERE MATCH(name) AGAINST('John <--> Smith' IN BOOLEAN MODE)", [1064,"syntax error, unexpected '-'"]],
  ["SELECT id FROM u ORDER BY MATCH(name) AGAINST('John') DESC", [["1"],["3"],["2"]]],
  ["SELECT id FROM u ORDER BY MATCH(name) AGAINST('John') ASC", [["2"],["1"],["3"]]],
  ["SELECT id FROM u ORDER BY MATCH(name, email) AGAINST('John') ASC", [["2"],["1"],["3"]]],
  ["SELECT id FROM u WHERE MATCH(email, name) AGAINST('John') ORDER BY id", [["1"],["3"]]],
  ["SELECT id, MATCH(email) AGAINST('email'), MATCH(email) AGAINST('email' IN BOOLEAN MODE) FROM u ORDER BY id", [["1","1.885928302414186e-9","1.885928302414186e-9"],["2","1.885928302414186e-9","1.885928302414186e-9"],["3","1.885928302414186e-9","1.885928302414186e-9"]]],
  ["SELECT id FROM u WHERE MATCH(email) AGAINST('email') ORDER BY id", [["1"],["2"],["3"]]],
  ["SELECT id FROM u WHERE MATCH(email) AGAINST('John')", []],
  ["SELECT id FROM u WHERE MATCH(id) AGAINST('John')", [1191,"Can't find FULLTEXT index matching the column list"]],
  ["SELECT id FROM u WHERE MATCH(name) AGAINST(name)", [1210,"Incorrect arguments to AGAINST"]],
  ["SELECT id, MATCH(name) AGAINST('jo*' IN BOOLEAN MODE), MATCH(name) AGAINST('\"john smith\"' IN BOOLEAN MODE), MATCH(name) AGAINST('the'), MATCH(name) AGAINST(NULL), MATCH(name) AGAINST('') FROM u ORDER BY id", [["1","0.031008131802082062","0.25865283608436584","0","0","0"],["2","0","0","0","0","0"],["3","0.031008131802082062","0","0","0","0"]]],
  ["SELECT MATCH(u.name) AGAINST('John') FROM u JOIN u v ON u.id = v.id ORDER BY u.id", [["0.031008131802082062"],["0"],["0.031008131802082062"]]],
  ["SELECT id, MATCH(name) AGAINST('John') FROM u WHERE MATCH(name) AGAINST('John') ORDER BY 2 DESC, id", [["1","0.031008131802082062"],["3","0.031008131802082062"]]],
  ["SHOW CREATE TABLE u", [["u","CREATE TABLE `u` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `email` varchar(191) NOT NULL,\n  `name` varchar(191) NOT NULL,\n  PRIMARY KEY (`id`),\n  FULLTEXT KEY `nm` (`name`),\n  FULLTEXT KEY `ne` (`name`,`email`),\n  FULLTEXT KEY `em` (`email`)\n) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["SELECT index_name, index_type, column_name, seq_in_index, sub_part, non_unique, nullable, collation FROM information_schema.statistics WHERE table_schema = 'app' AND table_name = 'u' ORDER BY 1, 4", [["em","FULLTEXT","email","1",null,"1","",null],["ne","FULLTEXT","name","1",null,"1","",null],["ne","FULLTEXT","email","2",null,"1","",null],["nm","FULLTEXT","name","1",null,"1","",null],["PRIMARY","BTREE","id","1",null,"0","","A"]]],
  ["CREATE TABLE d (id INT PRIMARY KEY AUTO_INCREMENT, t TEXT, FULLTEXT (t))", [0,0,"",0]],
  ["INSERT INTO d (t) VALUES ('apple apple banana'), ('apple cherry'), ('banana banana banana cherry date'), ('date elderberry fig'), ('Apple-pie, apple_pie and apple''s pie'), ('fig'), (NULL), ('the and was')", [8,1,"Records: 8  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, MATCH(t) AGAINST('apple'), MATCH(t) AGAINST('banana'), MATCH(t) AGAINST('apple apple'), MATCH(t) AGAINST('apple banana'), MATCH(t) AGAINST('pie'), MATCH(t) AGAINST('and') FROM d ORDER BY id", [["1","0.36289870738983154","0.3624762296676636","0.031219376251101494","0.7253749370574951","0","0"],["2","0.18144935369491577","0","0.015609688125550747","0.18144935369491577","0","0"],["3","0","1.0874286890029907","0","1.0874286890029907","0","0"],["4","0","0","0","0","0","0"],["5","0.36289870738983154","0","0.031219376251101494","0.36289870738983154","1.6311430931091309","0.3624762296676636"],["6","0","0","0","0","0","0"],["7","0","0","0","0","0","0"],["8","0","0","0","0","0","0.3624762296676636"]]],
  ["SELECT id, MATCH(t) AGAINST('apple_pie'), MATCH(t) AGAINST('apple''s'), MATCH(t) AGAINST('\"apple pie\"' IN BOOLEAN MODE), MATCH(t) AGAINST('APPLE'), MATCH(t) AGAINST('fig date') FROM d ORDER BY id", [["1","0","0.36289870738983154","0","0.36289870738983154","0"],["2","0","0.18144935369491577","0","0.18144935369491577","0"],["3","0","0","0","0","0.3624762296676636"],["4","0","0","0","0","0.7249524593353271"],["5","0.8155715465545654","0.36289870738983154","1.9940418004989624","0.36289870738983154","0"],["6","0","0","0","0","0.3624762296676636"],["7","0","0","0","0","0"],["8","0","0","0","0","0"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+apple' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+apple' IN BOOLEAN MODE)", [["1:0.36289870738983154,2:0.18144935369491577,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('>apple banana' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('>apple banana' IN BOOLEAN MODE)", [["1:1.7253749370574951,2:1.1814494132995605,3:1.0874286890029907,5:1.3628987073898315"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('<apple banana' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('<apple banana' IN BOOLEAN MODE)", [["1:-0.2746250629425049,2:-0.8185506463050842,3:1.0874286890029907,5:-0.6371012926101685"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('~apple' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('~apple' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('apple -banana' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('apple -banana' IN BOOLEAN MODE)", [["2:0.18144935369491577,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('ban*' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('ban*' IN BOOLEAN MODE)", [["1:0.3624762296676636,3:1.0874286890029907"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('(apple cherry)' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('(apple cherry)' IN BOOLEAN MODE)", [["1:0.36289870738983154,2:0.5439255833625793,3:0.3624762296676636,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('~apple banana' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('~apple banana' IN BOOLEAN MODE)", [["1:0.3624762296676636,3:1.0874286890029907"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('apple ~banana' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('apple ~banana' IN BOOLEAN MODE)", [["1:-0.2746250629425049,2:0.18144935369491577,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+apple +(banana cherry)' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+apple +(banana cherry)' IN BOOLEAN MODE)", [["1:0.7253749370574951,2:0.5439255833625793"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+apple -(banana cherry)' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+apple -(banana cherry)' IN BOOLEAN MODE)", [["5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('apple*  ban*' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('apple*  ban*' IN BOOLEAN MODE)", [["1:0.5437143445014954,2:0.0906190574169159,3:1.0874286890029907,5:0.1812381148338318"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+the' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+the' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('-apple' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('-apple' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+apple -apple' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+apple -apple' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('\"apple banana\"' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('\"apple banana\"' IN BOOLEAN MODE)", [["1:0.7253749370574951"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('\"banana apple\"' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('\"banana apple\"' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('>(apple banana)' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('>(apple banana)' IN BOOLEAN MODE)", [["1:1.7253749370574951,2:1.1814494132995605,3:2.087428569793701,5:1.3628987073898315"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('a*' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('a*' IN BOOLEAN MODE)", [["1:0.031219376251101494,2:0.015609688125550747,5:0.031219376251101494,8:0.015609688125550747"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+pie' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+pie' IN BOOLEAN MODE)", [["5:1.6311430931091309"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('''apple''' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('''apple''' IN BOOLEAN MODE)", [["1:0.36289870738983154,2:0.18144935369491577,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('apple,banana' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('apple,banana' IN BOOLEAN MODE)", [["1:0.7253749370574951,2:0.18144935369491577,3:1.0874286890029907,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+appl*' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+appl*' IN BOOLEAN MODE)", [["1:0.1812381148338318,2:0.0906190574169159,5:0.1812381148338318"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('x<y' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('x<y' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('()' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('()' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('+()' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('+()' IN BOOLEAN MODE)", [[null]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('< apple' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('< apple' IN BOOLEAN MODE)", [["1:-0.6371012926101685,2:-0.8185506463050842,5:-0.6371012926101685"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('apple >banana <cherry' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('apple >banana <cherry' IN BOOLEAN MODE)", [["1:1.7253749370574951,2:-0.45607441663742065,3:1.4499049186706543,5:0.36289870738983154"]]],
  ["SELECT GROUP_CONCAT(id, ':', MATCH(t) AGAINST('\"unclosed' IN BOOLEAN MODE) ORDER BY id) FROM d WHERE MATCH(t) AGAINST('\"unclosed' IN BOOLEAN MODE)", [[null]]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('--apple' IN BOOLEAN MODE)", [1064,"syntax error, unexpected '-'"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('+-apple' IN BOOLEAN MODE)", [1064,"syntax error, unexpected '-'"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('apple-' IN BOOLEAN MODE)", [1064,"syntax error, unexpected $end"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('(apple' IN BOOLEAN MODE)", [1064,"syntax error, unexpected $end"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('apple)' IN BOOLEAN MODE)", [1064,"syntax error, unexpected ')', expecting $end"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('**' IN BOOLEAN MODE)", [1064,"syntax error, unexpected $end, expecting FTS_TERM or FTS_NUMB or '*'"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('apple**' IN BOOLEAN MODE)", [1064,"syntax error, unexpected $end, expecting FTS_TERM or FTS_NUMB or '*'"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('@3 apple' IN BOOLEAN MODE)", [1064,"syntax error, unexpected '@', expecting $end"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('apple@2' IN BOOLEAN MODE)", [1064,"syntax error, unexpected '@', expecting $end"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('+' IN BOOLEAN MODE)", [1064,"syntax error, unexpected $end"]],
  ["SELECT id FROM d WHERE MATCH(t) AGAINST('-' IN BOOLEAN MODE)", [1064,"syntax error, unexpected $end"]],
  ["DELETE FROM d WHERE id = 6", [1,0,"",0]],
  ["SELECT id, MATCH(t) AGAINST('apple'), MATCH(t) AGAINST('fig') FROM d WHERE id IN (1, 4) ORDER BY id", [["1","0.27081382274627686","0"],["4","0","0.7141907215118408"]]],
  ["CREATE TABLE f1 (id INT, FULLTEXT (id))", [1283,"Column 'id' cannot be part of FULLTEXT index"]],
  ["CREATE TABLE f2 (b VARBINARY(10), FULLTEXT (b))", [1283,"Column 'b' cannot be part of FULLTEXT index"]],
  ["CREATE TABLE f3 (t VARCHAR(10), FULLTEXT KEY (t), FULLTEXT KEY (t))", [0,0,"",1]],
  ["ALTER TABLE f3 ADD FULLTEXT INDEX ft (t)", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["CREATE FULLTEXT INDEX ft2 ON f3 (t)", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["CREATE FULLTEXT INDEX ft2 ON f3 (t)", [1061,"Duplicate key name 'ft2'"]],
  ["SELECT index_name FROM information_schema.statistics WHERE table_schema = 'app' AND table_name = 'f3' ORDER BY 1", [["ft"],["ft2"],["t"],["t_2"]]],
  ["ALTER TABLE f3 DROP INDEX ft", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["DROP INDEX t_2 ON f3", [0,0,"Records: 0  Duplicates: 0  Warnings: 0",0]],
  ["SHOW CREATE TABLE f3", [["f3","CREATE TABLE `f3` (\n  `t` varchar(10) DEFAULT NULL,\n  FULLTEXT KEY `t` (`t`),\n  FULLTEXT KEY `ft2` (`t`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"]]],
  ["CREATE TABLE f4 (t VARCHAR(10), FULLTEXT KEY (t)) ENGINE = MEMORY", [1214,"The used table type doesn't support FULLTEXT indexes"]],
  ["CREATE TABLE f5 (id INT PRIMARY KEY, t VARCHAR(10))", [0,0,"",0]],
  ["INSERT INTO f5 VALUES (1, 'kiwi')", [1,0,"",0]],
  ["SELECT id FROM f5 WHERE MATCH(t) AGAINST('kiwi')", [1191,"Can't find FULLTEXT index matching the column list"]],
  ["ALTER TABLE f5 ADD FULLTEXT (t)", [0,0,"Records: 0  Duplicates: 0  Warnings: 1",1]],
  ["SELECT id, MATCH(t) AGAINST('kiwi') FROM f5", [["1","1.885928302414186e-9"]]],
  ["DROP TABLE u, d, f3, f5", [0,0,"",0]],
]

test('M5.26: FULLTEXT indexes and MATCH … AGAINST answer every statement of the script as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
    await conn.query("SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'")
    for (const [sql, expected] of SCRIPT) {
      let actual: Outcome
      try {
        const [r] = await conn.query({ sql, rowsAsArray: true })
        if (Array.isArray(r)) actual = (r as unknown[][]).map((row) => row.map((v) => (v === null ? null : String(v))))
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
