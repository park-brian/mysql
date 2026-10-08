// REGEXP, RLIKE and REGEXP_LIKE, as 8.4.11 answered each of these statements.
//
// What it pins: case-insensitivity from a `_ci` collation and never accent-
// insensitivity; binary strings case-sensitive, and mixed with text 3995; a
// number matched as its text; REGEXP_LIKE's match types (`c`, `i`, `m`,
// `n`, the last of `c` and `i` winning, anything else 1210); ICU's POSIX
// classes and inline `(?i)`; and ICU's errors for patterns it refuses. Then
// REGEXP_INSTR, REGEXP_SUBSTR and REGEXP_REPLACE: positions in characters,
// an emoji one of them; a position out of the subject 3686, an occurrence
// below 1 the first; the return option (1210); REPLACE's occurrence 0 for
// every match and the text before the position kept; ICU's replacement,
// `$n` (3686 past the last group), `\x`, and a bare `$` 3887; empty
// matches; and 3995 for a binary replacement into text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE t (id INT PRIMARY KEY, s VARCHAR(20), b VARBINARY(20))", [0,0,"",0]],
  ["INSERT INTO t VALUES (1, 'Apple', 'Apple'), (2, 'banana', 'banana'), (3, NULL, NULL), (4, 'cherry pie', 'cherry pie')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id FROM t WHERE s REGEXP '^a' ORDER BY id", [["1"]]],
  ["SELECT id FROM t WHERE b REGEXP '^a' ORDER BY id", [3995,"Character set 'binary' cannot be used in conjunction with 'utf8mb4_unicode_ci' in call to regexp_like."]],
  ["SELECT id, s REGEXP 'an' FROM t ORDER BY id", [["1","0"],["2","1"],["3",null],["4","0"]]],
  ["SELECT id FROM t WHERE s NOT REGEXP 'e' ORDER BY id", [["2"]]],
  ["SELECT 'Abc' REGEXP 'abc'", [["1"]]],
  ["SELECT 'abc' REGEXP '^a.c$'", [["1"]]],
  ["SELECT 'é' REGEXP 'e'", [["0"]]],
  ["SELECT 'É' REGEXP 'é'", [["1"]]],
  ["SELECT NULL REGEXP 'a'", [[null]]],
  ["SELECT 'a' REGEXP NULL", [[null]]],
  ["SELECT 123 REGEXP '^1'", [["1"]]],
  ["SELECT 'abc' NOT REGEXP 'b'", [["0"]]],
  ["SELECT 'abc' RLIKE 'B'", [["1"]]],
  ["SELECT 'abc' NOT RLIKE 'x'", [["1"]]],
  ["SELECT x'41' REGEXP x'61'", [["0"]]],
  ["SELECT x'61' REGEXP x'61'", [["1"]]],
  ["SELECT CAST('Abc' AS BINARY) REGEXP CAST('abc' AS BINARY)", [["0"]]],
  ["SELECT 'Abc' COLLATE utf8mb4_bin REGEXP 'abc'", [["0"]]],
  ["SELECT 'Abc' REGEXP 'abc' COLLATE utf8mb4_bin", [["0"]]],
  ["SELECT 'Abc' REGEXP BINARY 'abc'", [3995,"Character set 'utf8mb4_unicode_ci' cannot be used in conjunction with 'binary' in call to regexp_like."]],
  ["SELECT x'41' REGEXP 'a'", [3995,"Character set 'binary' cannot be used in conjunction with 'utf8mb4_unicode_ci' in call to regexp_like."]],
  ["SELECT 1.5 REGEXP '^1\\\\.5$'", [["1"]]],
  ["SELECT 'a.c' REGEXP 'a\\\\.c'", [["1"]]],
  ["SELECT 'abc' REGEXP ''", [3685,"Illegal argument to a regular expression."]],
  ["SELECT 'x' REGEXP '^$'", [["0"]]],
  ["SELECT '' REGEXP '^$'", [["1"]]],
  ["SELECT 'ab' REGEXP '(?i)AB'", [["1"]]],
  ["SELECT 'aB' REGEXP 'a\\\\p{Lu}'", [["1"]]],
  ["SELECT 'ÀB' REGEXP '^.B$'", [["1"]]],
  ["SELECT 'abab' REGEXP '(ab)\\\\1'", [["1"]]],
  ["SELECT REGEXP_LIKE('Abc', 'abc')", [["1"]]],
  ["SELECT REGEXP_LIKE('Abc', 'abc', 'c')", [["0"]]],
  ["SELECT REGEXP_LIKE('abc', 'ABC', 'i')", [["1"]]],
  ["SELECT REGEXP_LIKE('a\\nb', 'a.b')", [["0"]]],
  ["SELECT REGEXP_LIKE('a\\nb', 'a.b', 'n')", [["1"]]],
  ["SELECT REGEXP_LIKE('a\\nb', '^b', 'm')", [["1"]]],
  ["SELECT REGEXP_LIKE('a\\nb', '^b')", [["0"]]],
  ["SELECT REGEXP_LIKE('ABC', 'abc', 'ci')", [["1"]]],
  ["SELECT REGEXP_LIKE('ABC', 'abc', 'ic')", [["0"]]],
  ["SELECT REGEXP_LIKE('a', 'a', 'x')", [1210,"Incorrect arguments to regexp_like"]],
  ["SELECT REGEXP_LIKE('a', 'a', NULL)", [[null]]],
  ["SELECT REGEXP_LIKE('a')", [1582,"Incorrect parameter count in the call to native function 'REGEXP_LIKE'"]],
  ["SELECT 'a1' REGEXP '[[:digit:]]'", [["1"]]],
  ["SELECT 'ab' REGEXP '^[[:alpha:]]+$'", [["1"]]],
  ["SELECT 'a b' REGEXP '[[:space:]]'", [["1"]]],
  ["SELECT 'AB' REGEXP '^[[:upper:]]+$'", [["1"]]],
  ["SELECT 'x' REGEXP '[[:punct:]]'", [["0"]]],
  ["SELECT 'é' REGEXP '^[[:alpha:]]$'", [["1"]]],
  ["SELECT 'ab' REGEXP '\\\\w+'", [["1"]]],
  ["SELECT 'aaa' REGEXP '^a{3}$'", [["1"]]],
  ["SELECT 'ab' REGEXP 'a|z'", [["1"]]],
  ["SELECT 'a' REGEXP '('", [3691,"Mismatched parenthesis in regular expression."]],
  ["SELECT 'a' REGEXP '[a'", [3696,"The regular expression contains an unclosed bracket expression."]],
  ["SELECT 'a' REGEXP '*a'", [3688,"Syntax error in regular expression on line 1, character 1."]],
  ["SELECT 'a' REGEXP 'a**'", [3688,"Syntax error in regular expression on line 1, character 3."]],
  ["SELECT 'a' REGEXP '[[:<:]]a'", [3685,"Illegal argument to a regular expression."]],
  ["SELECT 'a' REGEXP 'a{2,1}'", [3693,"The maximum is less than the minumum in a {min,max} interval."]],
  ["CREATE TABLE rt (id INT PRIMARY KEY, s VARCHAR(20), b VARBINARY(20))", [0,0,"",0]],
  ["INSERT INTO rt VALUES (1, 'Apple', 'Apple'), (2, 'banana', 'banana'), (3, NULL, NULL), (4, 'cherry pie', 'cherry pie')", [4,0,"Records: 4  Duplicates: 0  Warnings: 0",0]],
  ["SELECT REGEXP_INSTR('dog cat dog','dog'), REGEXP_INSTR('dog cat dog','dog',2), REGEXP_INSTR('dog cat dog','dog',1,2), REGEXP_INSTR('dog cat dog','dog',1,2,1), REGEXP_INSTR('aa aaa','a{3}'), REGEXP_INSTR('abc','x')", [["1","9","9","12","4","0"]]],
  ["SELECT REGEXP_INSTR('héllo','l'), REGEXP_INSTR('abc','B'), REGEXP_INSTR('abc','B',1,1,0,'c'), REGEXP_INSTR(NULL,'a'), REGEXP_INSTR('a',NULL), REGEXP_INSTR('abc','b',NULL)", [["3","2","0",null,null,null]]],
  ["SELECT REGEXP_INSTR('abc','b',0)", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_INSTR('abc','b',4), REGEXP_INSTR('abc','b',3)", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_INSTR('abc','b',5)", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_INSTR('abc','b',1,0)", [["2"]]],
  ["SELECT REGEXP_INSTR('abc','b',1,1,2)", [1210,"Incorrect arguments to regexp_instr: return_option must be 1 or 0."]],
  ["SELECT REGEXP_REPLACE('a b c','b','X'), REGEXP_REPLACE('abc abc','b','X',1,2), REGEXP_REPLACE('abc abc','b','X',3), REGEXP_REPLACE('abcabc','(b)(c)','$2$1'), REGEXP_REPLACE('abc','B','x'), REGEXP_REPLACE('abc','B','x',1,0,'c')", [["a X c","abc aXc","abc aXc","acbacb","axc","abc"]]],
  ["SELECT REGEXP_REPLACE('abc','b','\\\\1'), REGEXP_REPLACE('aaa','a*','X'), REGEXP_REPLACE('abc','','X')", [3685,"Illegal argument to a regular expression."]],
  ["SELECT REGEXP_REPLACE('abc','x*','-')", [["-a-b-c-"]]],
  ["SELECT REGEXP_REPLACE('abc','(b)','$2')", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_REPLACE('abc','b','$')", [3887,"A capture group has an invalid name."]],
  ["SELECT REGEXP_SUBSTR('dog cat dog','\\\\w+'), REGEXP_SUBSTR('dog cat dog','\\\\w+',2), REGEXP_SUBSTR('dog cat dog','\\\\w+',1,3), REGEXP_SUBSTR('dog cat dog','\\\\w+',1,4), REGEXP_SUBSTR('abc','B'), REGEXP_SUBSTR(NULL,'a')", [["dog","og","dog",null,"b",null]]],
  ["SELECT REGEXP_REPLACE('héllo wörld','[öé]','_'), REGEXP_SUBSTR('héllo','l+'), REGEXP_INSTR('héllo','o',1,1,1)", [["h_llo w_rld","ll","6"]]],
  ["SELECT REGEXP_INSTR(12345,'3'), REGEXP_REPLACE(12345,'3','x'), REGEXP_SUBSTR(12345,'3.')", [["3","12x45","34"]]],
  ["SELECT REGEXP_REPLACE(_binary'abc','b','x'), REGEXP_SUBSTR(_binary'abc','b')", [3995,"Character set 'binary' cannot be used in conjunction with 'utf8mb4_unicode_ci' in call to regexp_replace."]],
  ["SELECT REGEXP_REPLACE('abc','b',NULL), REGEXP_SUBSTR('abc','b',1,1,NULL)", [[null,null]]],
  ["SELECT REGEXP_INSTR('abc','b',1,1,0,'z')", [1210,"Incorrect arguments to regexp_instr"]],
  ["SELECT REGEXP_REPLACE('aXbXc','x','-',1,0,'i'), REGEXP_SUBSTR('A\\nB','^B',1,1,'m'), REGEXP_SUBSTR('A\\nB','A.B',1,1,'n')", [["a-b-c","B","A\nB"]]],
  ["SELECT REGEXP_INSTR('abc','b','x')", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_INSTR('abc','b',-1)", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_INSTR('abc','b',1,-1)", [["2"]]],
  ["SELECT REGEXP_REPLACE('abc','b','x',1,-1)", [["axc"]]],
  ["SELECT REGEXP_INSTR('abc','b',1.6)", [["2"]]],
  ["SELECT REGEXP_INSTR('abc')", [1582,"Incorrect parameter count in the call to native function 'REGEXP_INSTR'"]],
  ["SELECT REGEXP_REPLACE('abc','b')", [1582,"Incorrect parameter count in the call to native function 'REGEXP_REPLACE'"]],
  ["SELECT REGEXP_SUBSTR('','a'), REGEXP_REPLACE('','a','b'), REGEXP_INSTR('','a'), REGEXP_INSTR('','x*')", [[null,"","0","1"]]],
  ["SELECT REGEXP_INSTR('abc','x*'), REGEXP_SUBSTR('abc','x*'), REGEXP_INSTR('abc','c',4), REGEXP_SUBSTR('abc','c',3)", [3686,"Index out of bounds in regular expression search."]],
  ["SELECT REGEXP_REPLACE('abc','b','\\\\1')", [["a1c"]]],
  ["SELECT REGEXP_REPLACE('abc','(b)','\\\\1\\\\1'), REGEXP_REPLACE('abc','b','\\\\$'), REGEXP_REPLACE('abc','(b)','$0$0'), REGEXP_REPLACE('aaa','a*','X')", [["a11c","a$c","abbc","XX"]]],
  ["SELECT REGEXP_INSTR('abc','x*'), REGEXP_SUBSTR('abc','x*'), REGEXP_SUBSTR('abc','c',3), REGEXP_INSTR('abc','c',3,1,1)", [["1","","c","4"]]],
  ["SELECT REGEXP_REPLACE('abcabc','b','X',1,0), REGEXP_REPLACE('abcabc','b','X',1,3), REGEXP_REPLACE('abcb','b','X',3,1)", [["aXcaXc","abcabc","abcX"]]],
  ["SELECT REGEXP_INSTR('a😀b','b'), REGEXP_SUBSTR('a😀b','.',2), REGEXP_REPLACE('a😀b','.','x')", [["3","😀","xxx"]]],
  ["SELECT REGEXP_INSTR('abc','B' COLLATE utf8mb4_bin), REGEXP_SUBSTR('ABC','b' COLLATE utf8mb4_0900_as_cs)", [["0",null]]],
  ["SELECT REGEXP_SUBSTR(_latin1'abc','b') l", [["b"]]],
  ["SELECT REGEXP_SUBSTR(_binary'abc',_binary'b'), REGEXP_INSTR(_binary'abc',_binary'B'), REGEXP_REPLACE('abc','b',_binary'x')", [3995,"Character set 'utf8mb4_unicode_ci' cannot be used in conjunction with 'binary' in call to regexp_replace."]],
  ["SELECT REGEXP_INSTR('abc','b',2.4), REGEXP_INSTR('abc','b','2'), REGEXP_INSTR('abc','b',1,'1x')", [["2","2","2"]]],
  ["SELECT id, REGEXP_INSTR(s, 'a'), REGEXP_SUBSTR(s, '[aeiou]+', 1, 2), REGEXP_REPLACE(s, '[aeiou]', '*'), REGEXP_REPLACE(b, _binary'a', _binary'X'), REGEXP_INSTR(b, _binary'a') FROM rt ORDER BY id", [["1","1","e","*ppl*","Apple","0"],["2","2","a","b*n*n*","bXnXnX","2"],["3",null,null,null,null,null],["4","0","ie","ch*rry p**","cherry pie","0"]]],
  ["SELECT id, REGEXP_INSTR(s, 'a'), REGEXP_SUBSTR(s, '[aeiou]+', 1, 2), REGEXP_REPLACE(s, '[aeiou]', '*'), REGEXP_REPLACE(b, 'a', 'X') FROM rt ORDER BY id", [3995,"Character set 'binary' cannot be used in conjunction with 'utf8mb4_unicode_ci' in call to regexp_replace."]],
  ["SELECT id FROM rt WHERE REGEXP_INSTR(s, 'e') > 3 ORDER BY id", [["1"]]],
  ["SELECT REGEXP_REPLACE('a😀b😀c', '😀', '-', 3), REGEXP_INSTR('a😀b😀c', '😀', 3), REGEXP_SUBSTR('héllo wörld', '\\\\w+', 7)", [["a😀b-c","4","wörld"]]],
  ["DROP TABLE rt", [0,0,"",0]],
]

test('M5.10: REGEXP and REGEXP_LIKE answer every statement of the script as 8.4.11 did', async () => {
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
