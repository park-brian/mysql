// JSON paths and the functions that take them, as 8.4.11 answered each
// statement: JSON_EXTRACT and its `->` and `->>`, JSON_UNQUOTE, JSON_CONTAINS,
// JSON_CONTAINS_PATH, JSON_TYPE, JSON_LENGTH, JSON_DEPTH, JSON_KEYS and
// JSON_VALID. Prisma filters JSON columns with JSON_CONTAINS over
// JSON_EXTRACT.
//
// The path language is MySQL's: `$`, `.key` or `."quoted key"`, `[n]`,
// `[last]`, `[last-n]`, `[m to n]`, and the wildcards `.*`, `[*]` and `**`.
// One path with none of the last three gives the value or NULL; anything
// else gives an array of every match, or NULL. A scalar is its own `[0]`.
// The errors are 3143 for a path, with its position, 3141 for a text that
// is not JSON, 3146 for a value that is neither JSON nor a string, and 3149
// for a wildcard where one is not allowed. JSON values are read as text, as
// the server sent them, not as mysql2 parses them. JSON_LENGTH over a
// wildcard or a range counts the values it reached, and JSON_CONTAINS_PATH
// reads its paths in order and stops at the first that decides: a NULL or a
// malformed path after it is never looked at (both found by review). And
// `v MEMBER OF (j)`, JSON_OVERLAPS, and STRCMP beside them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE r (id INT PRIMARY KEY, j JSON, s VARCHAR(100))", [0,0,"",0]],
  ["INSERT INTO r VALUES (1, '{\"a\": 1, \"b\": [1, 2, {\"c\": \"x\"}], \"d\": {\"e\": null, \"f\": \"y\"}, \"g h\": 3}', '{\"a\": \"q\"}'), (2, '[1, \"two\", [3, 4], {\"a\": 5}]', '[1]'), (3, '\"str\"', 'plain'), (4, '42', NULL), (5, NULL, '\"q\\\\\"t\"')", [5,0,"Records: 5  Duplicates: 0  Warnings: 0",0]],
  ["SELECT id, JSON_EXTRACT(j, '$.a') FROM r ORDER BY id", [["1","1"],["2",null],["3",null],["4",null],["5",null]]],
  ["SELECT id, JSON_EXTRACT(j, '$.b[1]'), JSON_EXTRACT(j, '$.b[2].c'), JSON_EXTRACT(j, '$.\"g h\"'), JSON_EXTRACT(j, '$.d.e') FROM r ORDER BY id", [["1","2","\"x\"","3","null"],["2",null,null,null,null],["3",null,null,null,null],["4",null,null,null,null],["5",null,null,null,null]]],
  ["SELECT id, JSON_EXTRACT(j, '$[0]'), JSON_EXTRACT(j, '$[last]'), JSON_EXTRACT(j, '$[last-1]'), JSON_EXTRACT(j, '$[1 to 2]'), JSON_EXTRACT(j, '$[9]') FROM r ORDER BY id", [["1","{\"a\": 1, \"b\": [1, 2, {\"c\": \"x\"}], \"d\": {\"e\": null, \"f\": \"y\"}, \"g h\": 3}","{\"a\": 1, \"b\": [1, 2, {\"c\": \"x\"}], \"d\": {\"e\": null, \"f\": \"y\"}, \"g h\": 3}",null,null,null],["2","1","{\"a\": 5}","[3, 4]","[\"two\", [3, 4]]",null],["3","\"str\"","\"str\"",null,null,null],["4","42","42",null,null,null],["5",null,null,null,null,null]]],
  ["SELECT id, JSON_EXTRACT(j, '$.*'), JSON_EXTRACT(j, '$[*]'), JSON_EXTRACT(j, '$**.a'), JSON_EXTRACT(j, '$.b[*]') FROM r ORDER BY id", [["1","[1, [1, 2, {\"c\": \"x\"}], {\"e\": null, \"f\": \"y\"}, 3]",null,"[1]","[1, 2, {\"c\": \"x\"}]"],["2",null,"[1, \"two\", [3, 4], {\"a\": 5}]","[5]",null],["3",null,null,null,null],["4",null,null,null,null],["5",null,null,null,null]]],
  ["SELECT id, JSON_EXTRACT(j, '$.a', '$.zz'), JSON_EXTRACT(j, '$.zz', '$.yy'), JSON_EXTRACT(j, '$') FROM r ORDER BY id", [["1","[1]",null,"{\"a\": 1, \"b\": [1, 2, {\"c\": \"x\"}], \"d\": {\"e\": null, \"f\": \"y\"}, \"g h\": 3}"],["2",null,null,"[1, \"two\", [3, 4], {\"a\": 5}]"],["3",null,null,"\"str\""],["4",null,null,"42"],["5",null,null,null]]],
  ["SELECT id, j -> '$.a', j ->> '$.d.f', j ->> '$.b', j -> '$[2][1]' FROM r ORDER BY id", [["1","1","y","[1, 2, {\"c\": \"x\"}]",null],["2",null,null,null,"4"],["3",null,null,null,null],["4",null,null,null,null],["5",null,null,null,null]]],
  ["SELECT JSON_EXTRACT('{\"a\": {\"b\": 1}}', '$.a.b'), JSON_EXTRACT('[[1, 2], [3]]', '$[*][0]'), JSON_EXTRACT('{\"a\": 1, \"b\": {\"a\": 2}}', '$**.a')", [["1","[1, 3]","[1, 2]"]]],
  ["SELECT JSON_EXTRACT('{\"a\": 1}', '$.a.b'), JSON_EXTRACT('1', '$[0]'), JSON_EXTRACT('{\"a\": 1}', '$[0]'), JSON_EXTRACT('1', '$[1]'), JSON_EXTRACT(NULL, '$'), JSON_EXTRACT('[1]', NULL)", [[null,"1","{\"a\": 1}",null,null,null]]],
  ["SELECT JSON_EXTRACT('{\"a\": 1}', 'a')", [3143,"Invalid JSON path expression. The error is around character position 1."]],
  ["SELECT JSON_EXTRACT('{\"a\": 1}', '$.')", [3143,"Invalid JSON path expression. The error is around character position 2."]],
  ["SELECT JSON_EXTRACT('{\"a\": 1}', '$[')", [3143,"Invalid JSON path expression. The error is around character position 2."]],
  ["SELECT JSON_EXTRACT('{\"a\": 1}', '$**')", [3143,"Invalid JSON path expression. The error is around character position 3."]],
  ["SELECT JSON_EXTRACT('{a}', '$.a')", [3141,"Invalid JSON text in argument 1 to function json_extract: \"Missing a name for object member.\" at position 1."]],
  ["SELECT JSON_EXTRACT(s, '$.a') FROM r WHERE id = 3", [3141,"Invalid JSON text in argument 1 to function json_extract: \"Invalid value.\" at position 0."]],
  ["SELECT JSON_EXTRACT(s, '$.a') FROM r WHERE id = 1", [["\"q\""]]],
  ["SELECT JSON_EXTRACT(1, '$')", [3146,"Invalid data type for JSON data in argument 1 to function json_extract; a JSON string or JSON type is required."]],
  ["SELECT JSON_UNQUOTE('\"a\\\\tb\"'), JSON_UNQUOTE('abc'), JSON_UNQUOTE('\"x'), JSON_UNQUOTE(NULL), JSON_UNQUOTE(JSON_EXTRACT('{\"a\": \"z\"}', '$.a')), JSON_UNQUOTE(JSON_EXTRACT('{\"a\": [1]}', '$.a'))", [["a\tb","abc","\"x",null,"z","[1]"]]],
  ["SELECT JSON_UNQUOTE('\"\\\\u00e9\\\\n\"'), JSON_UNQUOTE('\"\"')", [["é\n",""]]],
  ["SELECT JSON_UNQUOTE(1)", [3064,"Incorrect type for argument 1 in function json_unquote."]],
  ["SELECT JSON_UNQUOTE('\"a')", [["\"a"]]],
  ["SELECT JSON_UNQUOTE('\"a\\\\x\"')", [3141,"Invalid JSON text in argument 1 to function json_unquote: \"Invalid escape character in string.\" at position 2."]],
  ["SELECT id, JSON_CONTAINS(j, '1'), JSON_CONTAINS(j, '[1, 2]', '$.b'), JSON_CONTAINS(j, '{\"a\": 1}'), JSON_CONTAINS(j, '\"x\"', '$.b[2].c'), JSON_CONTAINS(j, '1', '$.zz') FROM r ORDER BY id", [["1","0","1","1","1",null],["2","1",null,"0",null,null],["3","0",null,"0",null,null],["4","0",null,"0",null,null],["5",null,null,null,null,null]]],
  ["SELECT JSON_CONTAINS('[1, [2, 3]]', '[3]'), JSON_CONTAINS('[1, [2, 3]]', '3'), JSON_CONTAINS('{\"a\": [1, 2]}', '{\"a\": 1}'), JSON_CONTAINS('1', '1.0'), JSON_CONTAINS('\"1\"', '1'), JSON_CONTAINS('[]', '[]'), JSON_CONTAINS('{}', '{}'), JSON_CONTAINS('[1]', '{}')", [["1","1","1","1","0","1","1","0"]]],
  ["SELECT JSON_CONTAINS('[1]', '1', '$[*]')", [3149,"In this situation, path expressions may not contain the * and ** tokens or an array range."]],
  ["SELECT JSON_CONTAINS('[1]', 'x')", [3141,"Invalid JSON text in argument 2 to function json_contains: \"Invalid value.\" at position 0."]],
  ["SELECT JSON_CONTAINS(1, '1')", [3146,"Invalid data type for JSON data in argument 1 to function json_contains; a JSON string or JSON type is required."]],
  ["SELECT JSON_CONTAINS(NULL, '1'), JSON_CONTAINS('1', NULL), JSON_CONTAINS('1', '1', NULL)", [[null,null,null]]],
  ["SELECT id, JSON_TYPE(j), JSON_LENGTH(j), JSON_LENGTH(j, '$.b'), JSON_DEPTH(j), JSON_KEYS(j), JSON_KEYS(j, '$.d') FROM r ORDER BY id", [["1","OBJECT","4","3","4","[\"a\", \"b\", \"d\", \"g h\"]","[\"e\", \"f\"]"],["2","ARRAY","4",null,"3",null,null],["3","STRING","1",null,"1",null,null],["4","INTEGER","1",null,"1",null,null],["5",null,null,null,null,null,null]]],
  // Keys shortest first, then by their bytes: 'B' before 'b', 'é' (two bytes) after 'ab' (M5.11's done-when, 8.4.11).
  ["SELECT JSON_KEYS('{\"aa\":1,\"b\":2,\"ab\":3,\"B\":4,\"é\":5,\"z\":6}')", [["[\"B\", \"b\", \"z\", \"aa\", \"ab\", \"é\"]"]]],
  ["SELECT JSON_TYPE('1.5'), JSON_TYPE('1e2'), JSON_TYPE('true'), JSON_TYPE('null'), JSON_TYPE('18446744073709551615'), JSON_TYPE(CAST(1.5 AS JSON)), JSON_TYPE(CAST(NOW() AS JSON) ), JSON_TYPE(NULL)", [["DOUBLE","DOUBLE","BOOLEAN","NULL","UNSIGNED INTEGER","DECIMAL","DATETIME",null]]],
  ["SELECT JSON_TYPE('x')", [3141,"Invalid JSON text in argument 1 to function json_type: \"Invalid value.\" at position 0."]],
  ["SELECT JSON_VALID('{}'), JSON_VALID('{a}'), JSON_VALID(NULL), JSON_VALID(1), JSON_VALID('1'), JSON_VALID(JSON_ARRAY())", [["1","0",null,"0","1","1"]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\": 1, \"b\": {\"c\": 2}}', 'one', '$.a', '$.x'), JSON_CONTAINS_PATH('{\"a\": 1, \"b\": {\"c\": 2}}', 'all', '$.a', '$.x'), JSON_CONTAINS_PATH('{\"a\": 1, \"b\": {\"c\": 2}}', 'all', '$.a', '$.b.c'), JSON_CONTAINS_PATH('[1]', 'one', '$[*]')", [["1","0","1","1"]]],
  ["SELECT JSON_CONTAINS_PATH('[1]', 'some', '$')", [3154,"The oneOrAll argument to json_contains_path may take these values: 'one' or 'all'."]],
  ["SELECT JSON_LENGTH('[1]', '$[*]')", [["1"]]],
  ["SELECT id FROM r WHERE JSON_CONTAINS(JSON_EXTRACT(j, '$.d.f'), '\"y\"') AND JSON_CONTAINS('\"y\"', JSON_EXTRACT(j, '$.d.f'))", [["1"]]],
  ["SELECT id FROM r WHERE JSON_EXTRACT(j, '$.a') = 1 ORDER BY id", [["1"]]],
  ["SELECT id FROM r WHERE JSON_UNQUOTE(JSON_EXTRACT(j, '$.d.f')) LIKE '%y%' ORDER BY id", [["1"]]],
  ["SELECT id FROM r WHERE j ->> '$.a' = '1' ORDER BY id", [["1"]]],
  ["SELECT id FROM r WHERE JSON_EXTRACT(j, '$[0]') = CAST('1' AS JSON) ORDER BY id", [["2"]]],
  ["SELECT JSON_UNQUOTE('\"ABC\"') = 'abc', JSON_TYPE('{}') = 'object', JSON_UNQUOTE('abc') = 'ABC', COLLATION(JSON_UNQUOTE('x')), COLLATION(JSON_TYPE('1')), COLLATION(j ->> '$.d.f') FROM r WHERE id = 1", [["0","0","0","utf8mb4_bin","utf8mb4_bin","utf8mb4_bin"]]],
  ["SELECT JSON_LENGTH('[1,[2,3]]','$[*]'), JSON_LENGTH('[1,[2,3]]','$[1 to 1]'), JSON_LENGTH('[1,[2,3]]','$[5 to 9]'), JSON_LENGTH('{\"a\":[1,2],\"b\":3}','$.*'), JSON_LENGTH('[[1,2,3]]','$[0]'), JSON_LENGTH('[[1,2,3]]','$**[0]'), JSON_LENGTH('[]','$[*]')", [["2","1",null,"2","3","4",null]]],
  ["SELECT JSON_LENGTH('[[1,2,3],[4]]','$[*]'), JSON_LENGTH('[[1,2,3],[4]]','$[0 to 1]'), JSON_LENGTH('[[1,2,3]]','$[0 to 0]'), JSON_LENGTH('{\"a\":{\"x\":1,\"y\":2}}','$.*')", [["2","2","1","1"]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','one','$.a',NULL), JSON_CONTAINS_PATH('{\"a\":1}','one','$.a','$x'), JSON_CONTAINS_PATH('{\"a\":1}','all','$.b','$x')", [["1","1","0"]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','one','$.b',NULL)", [[null]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','all','$.a',NULL)", [[null]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','one','$.b','$x')", [3143,"Invalid JSON path expression. The error is around character position 1."]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','all','$.a','$x')", [3143,"Invalid JSON path expression. The error is around character position 1."]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','one',NULL,'$.a')", [[null]]],
  ["SELECT JSON_CONTAINS_PATH(NULL,'one','$x')", [[null]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}',NULL,'$.a')", [[null]]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','xx','$.a')", [3154,"The oneOrAll argument to json_contains_path may take these values: 'one' or 'all'."]],
  ["SELECT JSON_CONTAINS_PATH('{\"a\":1}','one','$x', NULL)", [3143,"Invalid JSON path expression. The error is around character position 1."]],
  ["SELECT JSON_LENGTH('[1]', NULL), JSON_LENGTH(NULL, '$x')", [[null,null]]],
  ["SELECT JSON_EXTRACT('[[1,2,3]]','$**[0]'), JSON_LENGTH('[[1,2,3]]','$**[0]')", [["[[1, 2, 3], 1, 2, 3]","4"]]],
  ["SELECT 1 MEMBER OF ('[1, 2]'), 3 MEMBER OF ('[1, 2]'), 'a' MEMBER OF ('[\"a\"]'), 'a' MEMBER OF ('\"a\"'), 1 MEMBER OF ('1'), NULL MEMBER OF ('[1]'), 1 MEMBER OF (NULL), CAST('[1]' AS JSON) MEMBER OF ('[[1], 2]'), '[1]' MEMBER OF ('[[1], 2]'), 1.0 MEMBER OF ('[1]'), 'A' MEMBER OF ('[\"a\"]')", [["1","0","1","1","1",null,null,"1","0","1","0"]]],
  ["SELECT 1 MEMBER OF ('x')", [3141,"Invalid JSON text in argument 2 to function member of: \"Invalid value.\" at position 0."]],
  ["SELECT JSON_OVERLAPS('[1,2]','[2,3]'), JSON_OVERLAPS('[1,2]','[3]'), JSON_OVERLAPS('{\"a\":1}','{\"a\":1,\"b\":2}'), JSON_OVERLAPS('{\"a\":1}','{\"a\":2}'), JSON_OVERLAPS('1','1'), JSON_OVERLAPS('[1]','1'), JSON_OVERLAPS('1','[1]'), JSON_OVERLAPS('[[1]]','[1]'), JSON_OVERLAPS(NULL,'1'), JSON_OVERLAPS('{\"a\":1}','[1]'), JSON_OVERLAPS('[]','[]')", [["1","0","1","0","1","1","1","0",null,"0","0"]]],
  ["SELECT JSON_OVERLAPS('x','1')", [3141,"Invalid JSON text in argument 1 to function json_overlaps: \"Invalid value.\" at position 0."]],
  ["SELECT JSON_OVERLAPS(1,'1')", [3146,"Invalid data type for JSON data in argument 1 to function json_overlaps; a JSON string or JSON type is required."]],
  ["SELECT STRCMP('a','b'), STRCMP('b','a'), STRCMP('a','A'), STRCMP('a' COLLATE utf8mb4_bin,'A'), STRCMP(NULL,'a'), STRCMP(1, 2), STRCMP(10, 9), STRCMP('', ' '), STRCMP('a ', 'a')", [["-1","1","0","1",null,"-1","-1","0","0"]]],
  ["SELECT STRCMP(_binary'a','A')", [["1"]]],
]

test('JSON paths and the functions over them answer as 8.4.11 did', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({
    stream: db.createStream(),
    user: 'root',
    password: '',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
  })
  try {
    await conn.query('CREATE DATABASE app')
    await conn.query('USE app')
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
        actual = [err.errno, err.message]
      }
      assert.deepEqual(actual, expected, sql)
    }
  } finally {
    await conn.end()
    await db.end()
  }
})

test('JSON_DEPTH of a document too wide to spread into arguments', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '' })
  try {
    // 8.4.11: 2 and 2 — an array of 300,000 numbers, an object of 200,000 keys.
    const wide = `[${'1,'.repeat(299_999)}1]`
    const keys = `{${Array.from({ length: 200_000 }, (_, i) => `"k${i}": 1`).join(',')}}`
    const [rows] = await conn.query({ sql: 'SELECT JSON_DEPTH(?), JSON_DEPTH(?)', values: [wide, keys], rowsAsArray: true })
    assert.deepEqual(rows, [[2, 2]])
  } finally {
    await conn.end()
    await db.end()
  }
})
