// M5.49: resolve ORDER BY before enforcing the bounded DISTINCT admission proof.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('DISTINCT ORDER BY admission, equality classes and zero LIMIT match MySQL 8.4.11', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  // Literal pinned observations, including all ten field attributes.
  // Correlated admission, aliases inside expressions, copied expression
  // reuse and duplicate-field flags remain explicit roadmap gaps.
  const fixtures: { sql: string; method?: 'query' | 'execute'; params: number[]; rows?: unknown; fields?: unknown; warnings?: unknown; plan?: string; error?: unknown; effects?: unknown }[] = [
    {"sql":"SELECT DISTINCT g FROM t ORDER BY id","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY id LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY id LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT id FROM t ORDER BY g","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT id FROM t ORDER BY g LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT id FROM t ORDER BY g LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY g+1","rows":[[null],[1],[3]],"fields":[["g",3,11,32768,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY g+1 LIMIT 0","rows":[],"fields":[["g",3,11,0,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY g+1 LIMIT 0 OFFSET 1","rows":[],"fields":[["g",3,11,32768,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY n","rows":[[null],[2],[4]],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY n LIMIT 0","rows":[],"fields":[["n",8,12,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY n LIMIT 0 OFFSET 1","rows":[],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+1","rows":[[null],[2],[4]],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+1 LIMIT 0","rows":[],"fields":[["n",8,12,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+1 LIMIT 0 OFFSET 1","rows":[],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY (t.g+1)","rows":[[null],[2],[4]],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY (t.g+1) LIMIT 0","rows":[],"fields":[["n",8,12,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY (t.g+1) LIMIT 0 OFFSET 1","rows":[],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY 1+g","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY 1+g LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY 1+g LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+01","rows":[[null],[2],[4]],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+01 LIMIT 0","rows":[],"fields":[["n",8,12,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+01 LIMIT 0 OFFSET 1","rows":[],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+1.0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+1.0 LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+1.0 LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+TRUE","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+TRUE LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+TRUE LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1e0 AS n FROM t ORDER BY g+1.0e0","rows":[[null],[2],[4]],"fields":[["n",5,23,32768,31,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1e0 AS n FROM t ORDER BY g+1.0e0 LIMIT 0","rows":[],"fields":[["n",5,23,128,31,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+1e0 AS n FROM t ORDER BY g+1.0e0 LIMIT 0 OFFSET 1","rows":[],"fields":[["n",5,23,32768,31,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+b'01' AS n FROM t ORDER BY g+b'1'","rows":[[null],[2],[4]],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+b'01' AS n FROM t ORDER BY g+b'1' LIMIT 0","rows":[],"fields":[["n",8,12,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+b'01' AS n FROM t ORDER BY g+b'1' LIMIT 0 OFFSET 1","rows":[],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+b'000000001' AS n FROM t ORDER BY g+b'1'","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+b'000000001' AS n FROM t ORDER BY g+b'1' LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+b'000000001' AS n FROM t ORDER BY g+b'1' LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') AS n FROM t ORDER BY CONCAT(g,'A')","rows":[[null],["1a"],["3a"]],"fields":[["n",253,48,32768,0,224,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') AS n FROM t ORDER BY CONCAT(g,'A') LIMIT 0","rows":[],"fields":[["n",253,48,0,31,224,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') AS n FROM t ORDER BY CONCAT(g,'A') LIMIT 0 OFFSET 1","rows":[],"fields":[["n",253,48,32768,0,224,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'A') COLLATE utf8mb4_bin","rows":[[null],["1a"],["3a"]],"fields":[["n",253,48,32896,0,224,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'A') COLLATE utf8mb4_bin LIMIT 0","rows":[],"fields":[["n",253,48,128,31,224,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'A') COLLATE utf8mb4_bin LIMIT 0 OFFSET 1","rows":[],"fields":[["n",253,48,32896,0,224,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'a') COLLATE utf8mb4_0900_ai_ci","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'a') COLLATE utf8mb4_0900_ai_ci LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'a') COLLATE utf8mb4_0900_ai_ci LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g,CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'a') COLLATE utf8mb4_0900_ai_ci","rows":[[null,null],[1,"1a"],[3,"3a"]],"fields":[["g",3,11,32768,0,63,"distinct_admit","t","t","g"],["n",253,48,32896,0,224,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g,CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'a') COLLATE utf8mb4_0900_ai_ci LIMIT 0","rows":[],"fields":[["g",3,11,0,0,63,"distinct_admit","t","t","g"],["n",253,48,128,31,224,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g,CONCAT(g,'a') COLLATE utf8mb4_bin AS n FROM t ORDER BY CONCAT(g,'a') COLLATE utf8mb4_0900_ai_ci LIMIT 0 OFFSET 1","rows":[],"fields":[["g",3,11,32768,0,63,"distinct_admit","t","t","g"],["n",253,48,32896,0,224,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT ABS(g) AS n FROM t ORDER BY ABS(g)+1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT ABS(g) AS n FROM t ORDER BY ABS(g)+1 LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT ABS(g) AS n FROM t ORDER BY ABS(g)+1 LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT CAST(g AS SIGNED) AS n FROM t ORDER BY CONVERT(t.g,SIGNED)","rows":[[null],[1],[3]],"fields":[["n",8,21,32768,0,63,"","","","n"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT CAST(g AS SIGNED) AS n FROM t ORDER BY CONVERT(t.g,SIGNED) LIMIT 0","rows":[],"fields":[["n",8,21,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT CAST(g AS SIGNED) AS n FROM t ORDER BY CONVERT(t.g,SIGNED) LIMIT 0 OFFSET 1","rows":[],"fields":[["n",8,21,32768,0,63,"","","","n"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g AS id FROM t ORDER BY id","rows":[[null],[1],[3]],"fields":[["id",3,11,32768,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g AS id FROM t ORDER BY id LIMIT 0","rows":[],"fields":[["id",3,11,0,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g AS id FROM t ORDER BY id LIMIT 0 OFFSET 1","rows":[],"fields":[["id",3,11,32768,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g AS id FROM t ORDER BY t.id","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g AS id FROM t ORDER BY t.id LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g AS id FROM t ORDER BY t.id LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY missing","error":[1054,"42S22","Unknown column 'missing' in 'order clause'"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY missing LIMIT 0","error":[1054,"42S22","Unknown column 'missing' in 'order clause'"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY missing LIMIT 0 OFFSET 1","error":[1054,"42S22","Unknown column 'missing' in 'order clause'"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY id,missing","error":[1054,"42S22","Unknown column 'missing' in 'order clause'"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY id,missing LIMIT 0","error":[1054,"42S22","Unknown column 'missing' in 'order clause'"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY id,missing LIMIT 0 OFFSET 1","error":[1054,"42S22","Unknown column 'missing' in 'order clause'"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY 1,id","error":[3065,"HY000","Expression #2 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY 1,id LIMIT 0","error":[3065,"HY000","Expression #2 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY 1,id LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #2 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT t.* FROM t ORDER BY id","rows":[[1,3],[2,1],[3,1],[4,null]],"fields":[["id",3,11,20483,0,63,"distinct_admit","t","t","id"],["g",3,11,0,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Index scan on t using PRIMARY","params":[]},
    {"sql":"SELECT DISTINCT t.* FROM t ORDER BY id LIMIT 0","rows":[],"fields":[["id",3,11,20483,0,63,"distinct_admit","t","t","id"],["g",3,11,0,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT t.* FROM t ORDER BY id LIMIT 0 OFFSET 1","rows":[],"fields":[["id",3,11,20483,0,63,"distinct_admit","t","t","id"],["g",3,11,0,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Limit/Offset\n    Index scan on t using PRIMARY","params":[]},
    {"sql":"SELECT DISTINCT 1 AS n FROM t ORDER BY id","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT 1 AS n FROM t ORDER BY id LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT 1 AS n FROM t ORDER BY id LIMIT 0 OFFSET 1","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"params":[]},
    {"sql":"SELECT DISTINCT g+1 AS g FROM t ORDER BY g+1","rows":[[null],[2],[4]],"fields":[["g",8,12,32768,0,63,"","","","g"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS g FROM t ORDER BY g+1 LIMIT 0","rows":[],"fields":[["g",8,12,128,0,63,"","","",""]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g+1 AS g FROM t ORDER BY g+1 LIMIT 0 OFFSET 1","rows":[],"fields":[["g",8,12,32768,0,63,"","","","g"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g AS n FROM t ORDER BY RAND(7)","rows":[[1],[null],[3]],"fields":[["n",3,11,32768,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Sort\n    Table scan on <temporary>\n        Temporary table with deduplication\n            Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g AS n FROM t ORDER BY RAND(7) LIMIT 0","rows":[],"fields":[["n",3,11,0,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Zero rows","params":[]},
    {"sql":"SELECT DISTINCT g AS n FROM t ORDER BY RAND(7) LIMIT 0 OFFSET 1","rows":[],"fields":[["n",3,11,32768,0,63,"distinct_admit","t","t","g"]],"warnings":[],"plan":"Limit/Offset\n    Sort\n        Table scan on <temporary>\n            Temporary table with deduplication\n                Table scan on t","params":[]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+?","method":"query","params":[1,1],"rows":[[null],[2],[4]],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+?","method":"execute","params":[1,1],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0","method":"query","params":[1,1],"rows":[],"fields":[["n",8,12,128,0,63,"","","",""]],"warnings":[],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0","method":"execute","params":[1,1],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0 OFFSET 1","method":"query","params":[1,1],"rows":[],"fields":[["n",8,12,32768,0,63,"","","","n"]],"warnings":[],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0 OFFSET 1","method":"execute","params":[1,1],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+?","method":"query","params":[1,2],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+?","method":"execute","params":[1,2],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0","method":"query","params":[1,2],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0","method":"execute","params":[1,2],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0 OFFSET 1","method":"query","params":[1,2],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g+? AS n FROM t ORDER BY t.g+? LIMIT 0 OFFSET 1","method":"execute","params":[1,2],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.g' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb3_bin AS n FROM t ORDER BY CONCAT(t.g,'A') COLLATE utf8_bin","method":"query","params":[],"error":[1253,"42000","COLLATION 'utf8mb3_bin' is not valid for CHARACTER SET 'utf8mb4'"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb3_bin AS n FROM t ORDER BY CONCAT(t.g,'A') COLLATE utf8_bin","method":"execute","params":[],"error":[1253,"42000","COLLATION 'utf8mb3_bin' is not valid for CHARACTER SET 'utf8mb4'"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb3_bin AS n FROM t ORDER BY CONCAT(t.g,'A') COLLATE utf8_bin LIMIT 0","method":"query","params":[],"error":[1253,"42000","COLLATION 'utf8mb3_bin' is not valid for CHARACTER SET 'utf8mb4'"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb3_bin AS n FROM t ORDER BY CONCAT(t.g,'A') COLLATE utf8_bin LIMIT 0","method":"execute","params":[],"error":[1253,"42000","COLLATION 'utf8mb3_bin' is not valid for CHARACTER SET 'utf8mb4'"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb3_bin AS n FROM t ORDER BY CONCAT(t.g,'A') COLLATE utf8_bin LIMIT 0 OFFSET 1","method":"query","params":[],"error":[1253,"42000","COLLATION 'utf8mb3_bin' is not valid for CHARACTER SET 'utf8mb4'"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CONCAT(g,'a') COLLATE utf8mb3_bin AS n FROM t ORDER BY CONCAT(t.g,'A') COLLATE utf8_bin LIMIT 0 OFFSET 1","method":"execute","params":[],"error":[1253,"42000","COLLATION 'utf8mb3_bin' is not valid for CHARACTER SET 'utf8mb4'"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY id","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY id","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY id LIMIT 0","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY id LIMIT 0","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY id LIMIT 0 OFFSET 1","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT CAST(CONCAT(g,'x') AS SIGNED) AS n FROM t ORDER BY id LIMIT 0 OFFSET 1","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT LAST_INSERT_ID(g) AS n FROM t ORDER BY id","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT LAST_INSERT_ID(g) AS n FROM t ORDER BY id","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT LAST_INSERT_ID(g) AS n FROM t ORDER BY id LIMIT 0","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT LAST_INSERT_ID(g) AS n FROM t ORDER BY id LIMIT 0","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT LAST_INSERT_ID(g) AS n FROM t ORDER BY id LIMIT 0 OFFSET 1","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT LAST_INSERT_ID(g) AS n FROM t ORDER BY id LIMIT 0 OFFSET 1","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY LAST_INSERT_ID(id)","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY LAST_INSERT_ID(id)","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY LAST_INSERT_ID(id) LIMIT 0","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY LAST_INSERT_ID(id) LIMIT 0","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY LAST_INSERT_ID(id) LIMIT 0 OFFSET 1","method":"query","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
    {"sql":"SELECT DISTINCT g FROM t ORDER BY LAST_INSERT_ID(id) LIMIT 0 OFFSET 1","method":"execute","params":[],"error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_admit.t.id' which is not in SELECT list; this is incompatible with DISTINCT"],"effects":[[0]]},
  ]
  try {
    await conn.query('CREATE DATABASE distinct_admit')
    await conn.query('USE distinct_admit')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT)')
    await conn.query('INSERT INTO t VALUES(1,3),(2,1),(3,1),(4,NULL)')
    await conn.query('ANALYZE TABLE t')
    await conn.query("SET sql_mode='ONLY_FULL_GROUP_BY'")
    for (const fixture of fixtures) {
      for (const method of fixture.method === undefined ? ['query', 'execute'] as const : [fixture.method]) {
        await conn.query('SELECT LAST_INSERT_ID(0)')
        const options = { sql: fixture.sql, rowsAsArray: true }
        const query = () => method === 'query' ? conn.query(options, fixture.params) : conn.execute(options, fixture.params)
        if (fixture.error !== undefined) {
          await assert.rejects(query, (error: unknown) => {
            const e = error as { errno: number; sqlState: string; message: string }
            assert.deepEqual([e.errno, e.sqlState, e.message], fixture.error, method + ': ' + fixture.sql)
            return true
          })
        } else {
          const [rows, fields] = await query()
          assert.deepEqual(rows, fixture.rows, method + ': rows: ' + fixture.sql)
          assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), fixture.fields, method + ': fields: ' + fixture.sql)
          assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], fixture.warnings, method + ': warnings: ' + fixture.sql)
          if (fixture.plan !== undefined) {
            const [tree] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + fixture.sql, fixture.params)
            assert.equal(planSkeleton(tree[0]?.EXPLAIN), fixture.plan, method + ': plan: ' + fixture.sql)
          }
        }
        assert.deepEqual((await conn.query({ sql: 'SELECT LAST_INSERT_ID()', rowsAsArray: true }))[0], fixture.effects ?? [[0]], method + ': effects: ' + fixture.sql)
        conn.unprepare(options)
      }
    }
    // Disabling ONLY_FULL_GROUP_BY changes admission, including zero counts.
    // Native metadata/order choices for these admitted queries remain open.
    await conn.query("SET sql_mode=''")
    for (const fixture of fixtures.filter((f) => (f.error as number[] | undefined)?.[0] === 3065)) {
      for (const method of fixture.method === undefined ? ['query', 'execute'] as const : [fixture.method]) {
        const options = { sql: fixture.sql, rowsAsArray: true }
        await assert.doesNotReject(() => method === 'query' ? conn.query(options, fixture.params) : conn.execute(options, fixture.params), method + ': SQL mode: ' + fixture.sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS distinct_admit')
    await conn.end()
    await db?.end()
  }
})

test('DISTINCT admission uses native literal classes, introductions and COLLATE wrappers', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root', password: '' })
  // This fixture pins admission only: these are literal-class comparisons,
  // including accepted strings that warn during numeric coercion.
  const fixtures: { sql: string; error?: unknown }[] = [
    {"sql":"SELECT DISTINCT g+x'01' AS n FROM t ORDER BY g+b'1'"},
    {"sql":"SELECT DISTINCT g+x'01' AS n FROM t ORDER BY g+b'1' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+x'0001' AS n FROM t ORDER BY g+b'000000001'"},
    {"sql":"SELECT DISTINCT g+x'0001' AS n FROM t ORDER BY g+b'000000001' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+0x01 AS n FROM t ORDER BY g+x'01'"},
    {"sql":"SELECT DISTINCT g+0x01 AS n FROM t ORDER BY g+x'01' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+_latin1 x'61' AS n FROM t ORDER BY g+_latin1'a'"},
    {"sql":"SELECT DISTINCT g+_latin1 x'61' AS n FROM t ORDER BY g+_latin1'a' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+_latin1 x'61' AS n FROM t ORDER BY g+_latin1 x'41'"},
    {"sql":"SELECT DISTINCT g+_latin1 x'61' AS n FROM t ORDER BY g+_latin1 x'41' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+_binary x'61' AS n FROM t ORDER BY g+_binary'a'"},
    {"sql":"SELECT DISTINCT g+_binary x'61' AS n FROM t ORDER BY g+_binary'a' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+_utf8mb4 x'61' AS n FROM t ORDER BY g+_utf8mb4'a'"},
    {"sql":"SELECT DISTINCT g+_utf8mb4 x'61' AS n FROM t ORDER BY g+_utf8mb4'a' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+1.0 AS n FROM t ORDER BY g+1.00"},
    {"sql":"SELECT DISTINCT g+1.0 AS n FROM t ORDER BY g+1.00 LIMIT 0"},
    {"sql":"SELECT DISTINCT g+1.0 AS n FROM t ORDER BY g+01.0"},
    {"sql":"SELECT DISTINCT g+1.0 AS n FROM t ORDER BY g+01.0 LIMIT 0"},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+TRUE","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_literals.t.g' which is not in SELECT list; this is incompatible with DISTINCT"]},
    {"sql":"SELECT DISTINCT g+1 AS n FROM t ORDER BY g+TRUE LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_literals.t.g' which is not in SELECT list; this is incompatible with DISTINCT"]},
    {"sql":"SELECT DISTINCT g+b'1' AS n FROM t ORDER BY g+TRUE","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_literals.t.g' which is not in SELECT list; this is incompatible with DISTINCT"]},
    {"sql":"SELECT DISTINCT g+b'1' AS n FROM t ORDER BY g+TRUE LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_literals.t.g' which is not in SELECT list; this is incompatible with DISTINCT"]},
    {"sql":"SELECT DISTINCT g+DATE'2020-01-01' AS n FROM t ORDER BY g+TIMESTAMP'2020-01-01 00:00:00'","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_literals.t.g' which is not in SELECT list; this is incompatible with DISTINCT"]},
    {"sql":"SELECT DISTINCT g+DATE'2020-01-01' AS n FROM t ORDER BY g+TIMESTAMP'2020-01-01 00:00:00' LIMIT 0","error":[3065,"HY000","Expression #1 of ORDER BY clause is not in SELECT list, references column 'distinct_literals.t.g' which is not in SELECT list; this is incompatible with DISTINCT"]},
    {"sql":"SELECT DISTINCT g+TIME'01:00:00.50' AS n FROM t ORDER BY g+TIME'01:00:00.500'"},
    {"sql":"SELECT DISTINCT g+TIME'01:00:00.50' AS n FROM t ORDER BY g+TIME'01:00:00.500' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+'a' COLLATE utf8mb4_bin AS n FROM t ORDER BY g+'A' COLLATE utf8mb4_bin"},
    {"sql":"SELECT DISTINCT g+'a' COLLATE utf8mb4_bin AS n FROM t ORDER BY g+'A' COLLATE utf8mb4_bin LIMIT 0"},
    {"sql":"SELECT DISTINCT g+'a' COLLATE utf8mb4_0900_ai_ci AS n FROM t ORDER BY g+'A' COLLATE utf8mb4_0900_ai_ci"},
    {"sql":"SELECT DISTINCT g+'a' COLLATE utf8mb4_0900_ai_ci AS n FROM t ORDER BY g+'A' COLLATE utf8mb4_0900_ai_ci LIMIT 0"},
    {"sql":"SELECT DISTINCT g+'a' AS n FROM t ORDER BY g+'a '"},
    {"sql":"SELECT DISTINCT g+'a' AS n FROM t ORDER BY g+'a ' LIMIT 0"},
    {"sql":"SELECT DISTINCT g+_latin1'a' AS n FROM t ORDER BY g+_latin1'a '"},
    {"sql":"SELECT DISTINCT g+_latin1'a' AS n FROM t ORDER BY g+_latin1'a ' LIMIT 0"},
  ]
  try {
    await conn.query('CREATE DATABASE distinct_literals')
    await conn.query('USE distinct_literals')
    await conn.query('CREATE TABLE t(g INT)')
    await conn.query('INSERT INTO t VALUES(1),(2)')
    await conn.query("SET sql_mode='ONLY_FULL_GROUP_BY'")
    for (const fixture of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        const query = () => method === 'query' ? conn.query(fixture.sql) : conn.execute(fixture.sql)
        if (fixture.error === undefined) await assert.doesNotReject(query, method + ': ' + fixture.sql)
        else await assert.rejects(query, (error: unknown) => {
          const e = error as { errno: number; sqlState: string; message: string }
          assert.deepEqual([e.errno, e.sqlState, e.message], fixture.error, method + ': ' + fixture.sql)
          return true
        })
        conn.unprepare(fixture.sql)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS distinct_literals')
    await conn.end()
    await db?.end()
  }
})
