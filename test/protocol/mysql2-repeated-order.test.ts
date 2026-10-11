// M5.49: only the first occurrence of a resolved local order field supplies direction.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
// @ts-expect-error — the capture owns plan normalization.
import { planSkeleton } from '../../tools/capture-relational.mjs'

test('redundant ORDER BY fields match MySQL 8.4.11 index scans, ties, LIMIT and protocol metadata', async () => {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  // Complete literal native outcomes; selected CAST/OFFSET warnings remain a separate roadmap gap.
  const layouts: unknown[][][] = [[["id",3,11,20483,0,63,"repeated_order","t","t","id"],["id",3,11,20483,0,63,"repeated_order","t","t","id"],["g",3,11,0,0,63,"repeated_order","t","t","g"]],[["id",3,11,20483,0,63,"repeated_order","t","t","id"],["g",3,11,0,0,63,"repeated_order","t","t","g"]],[["x",3,11,20483,0,63,"repeated_order","t","t","id"],["y",3,11,0,0,63,"repeated_order","t","t","g"]],[["id",3,11,0,0,63,"repeated_order","t","t","g"],["pk",3,11,20483,0,63,"repeated_order","t","t","id"]],[["a",3,11,20483,0,63,"repeated_order","m","m","a"],["b",3,11,20483,0,63,"repeated_order","m","m","b"],["g",3,11,0,0,63,"repeated_order","m","m","g"]],[["x",3,11,20483,0,63,"repeated_order","m","m","a"],["y",3,11,20483,0,63,"repeated_order","m","m","b"],["g",3,11,0,0,63,"repeated_order","m","m","g"]],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[["x",3,11,20483,0,63,"repeated_order","s","s","id"],["y",3,11,16392,0,63,"repeated_order","s","s","g"]]]
  const warnings: unknown[][] = [[],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '3x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect INTEGER value: '1x'"}]]
  const plans: string[] = ["Index scan on t using PRIMARY","Zero rows","Limit/Offset\n    Index scan on t using PRIMARY","Limit\n    Index scan on t using PRIMARY","Sort\n    Table scan on t","Limit/Offset\n    Sort\n        Table scan on t","Limit\n    Sort\n        Table scan on t","Index scan on m using PRIMARY","Limit/Offset\n    Index scan on m using PRIMARY","Limit\n    Index scan on m using PRIMARY","Sort\n    Table scan on m","Limit/Offset\n    Sort\n        Table scan on m","Limit\n    Sort\n        Table scan on m","Covering index scan on s using kg","Limit/Offset\n    Covering index scan on s using kg","Limit\n    Covering index scan on s using kg","Sort\n    Covering index scan on s using kg","Limit/Offset\n    Sort\n        Covering index scan on s using kg","Limit\n    Sort\n        Covering index scan on s using kg"]
  const fixtures: [string, unknown[][], number, number, unknown[][], number][] = [
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1,2 DESC",[[1,1,3],[2,2,1],[3,3,1],[4,4,null]],0,0,[[0]],0],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1,2 DESC LIMIT 0 OFFSET 0",[],0,0,[[0]],1],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1,2 DESC LIMIT 0 OFFSET 1",[],0,0,[[0]],2],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1,2 DESC LIMIT 1",[[1,1,3]],0,0,[[0]],3],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1,2 DESC LIMIT 1 OFFSET 1",[[2,2,1]],0,0,[[0]],2],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1,2 DESC LIMIT 2 OFFSET 8",[],0,0,[[0]],2],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1 DESC,2",[[4,4,null],[3,3,1],[2,2,1],[1,1,3]],0,0,[[0]],0],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1 DESC,2 LIMIT 0 OFFSET 0",[],0,0,[[0]],1],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1 DESC,2 LIMIT 0 OFFSET 1",[],0,0,[[0]],2],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1 DESC,2 LIMIT 1",[[4,4,null]],0,0,[[0]],3],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1 DESC,2 LIMIT 1 OFFSET 1",[[3,3,1]],0,0,[[0]],2],
    ["SELECT DISTINCT id,id,g FROM t ORDER BY 1 DESC,2 LIMIT 2 OFFSET 8",[],0,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id,id DESC",[[1,3],[2,1],[3,1],[4,null]],1,0,[[0]],0],
    ["SELECT id,g FROM t ORDER BY id,id DESC LIMIT 0 OFFSET 0",[],1,0,[[0]],1],
    ["SELECT id,g FROM t ORDER BY id,id DESC LIMIT 0 OFFSET 1",[],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id,id DESC LIMIT 1",[[1,3]],1,0,[[0]],3],
    ["SELECT id,g FROM t ORDER BY id,id DESC LIMIT 1 OFFSET 1",[[2,1]],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id,id DESC LIMIT 2 OFFSET 8",[],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id DESC,id",[[4,null],[3,1],[2,1],[1,3]],1,0,[[0]],0],
    ["SELECT id,g FROM t ORDER BY id DESC,id LIMIT 0 OFFSET 0",[],1,0,[[0]],1],
    ["SELECT id,g FROM t ORDER BY id DESC,id LIMIT 0 OFFSET 1",[],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id DESC,id LIMIT 1",[[4,null]],1,0,[[0]],3],
    ["SELECT id,g FROM t ORDER BY id DESC,id LIMIT 1 OFFSET 1",[[3,1]],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id DESC,id LIMIT 2 OFFSET 8",[],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id,id,id DESC",[[1,3],[2,1],[3,1],[4,null]],1,0,[[0]],0],
    ["SELECT id,g FROM t ORDER BY id,id,id DESC LIMIT 0 OFFSET 0",[],1,0,[[0]],1],
    ["SELECT id,g FROM t ORDER BY id,id,id DESC LIMIT 0 OFFSET 1",[],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id,id,id DESC LIMIT 1",[[1,3]],1,0,[[0]],3],
    ["SELECT id,g FROM t ORDER BY id,id,id DESC LIMIT 1 OFFSET 1",[[2,1]],1,0,[[0]],2],
    ["SELECT id,g FROM t ORDER BY id,id,id DESC LIMIT 2 OFFSET 8",[],1,0,[[0]],2],
    ["SELECT id AS x,g AS y FROM t ORDER BY x,t.id DESC",[[1,3],[2,1],[3,1],[4,null]],2,0,[[0]],0],
    ["SELECT id AS x,g AS y FROM t ORDER BY x,t.id DESC LIMIT 0 OFFSET 0",[],2,0,[[0]],1],
    ["SELECT id AS x,g AS y FROM t ORDER BY x,t.id DESC LIMIT 0 OFFSET 1",[],2,0,[[0]],2],
    ["SELECT id AS x,g AS y FROM t ORDER BY x,t.id DESC LIMIT 1",[[1,3]],2,0,[[0]],3],
    ["SELECT id AS x,g AS y FROM t ORDER BY x,t.id DESC LIMIT 1 OFFSET 1",[[2,1]],2,0,[[0]],2],
    ["SELECT id AS x,g AS y FROM t ORDER BY x,t.id DESC LIMIT 2 OFFSET 8",[],2,0,[[0]],2],
    ["SELECT id AS x,g AS y FROM t ORDER BY 1,x DESC",[[1,3],[2,1],[3,1],[4,null]],2,0,[[0]],0],
    ["SELECT id AS x,g AS y FROM t ORDER BY 1,x DESC LIMIT 0 OFFSET 0",[],2,0,[[0]],1],
    ["SELECT id AS x,g AS y FROM t ORDER BY 1,x DESC LIMIT 0 OFFSET 1",[],2,0,[[0]],2],
    ["SELECT id AS x,g AS y FROM t ORDER BY 1,x DESC LIMIT 1",[[1,3]],2,0,[[0]],3],
    ["SELECT id AS x,g AS y FROM t ORDER BY 1,x DESC LIMIT 1 OFFSET 1",[[2,1]],2,0,[[0]],2],
    ["SELECT id AS x,g AS y FROM t ORDER BY 1,x DESC LIMIT 2 OFFSET 8",[],2,0,[[0]],2],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY id,id DESC",[[null,4],[1,2],[1,3],[3,1]],3,0,[[0]],4],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY id,id DESC LIMIT 0 OFFSET 0",[],3,0,[[0]],1],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY id,id DESC LIMIT 0 OFFSET 1",[],3,0,[[0]],5],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY id,id DESC LIMIT 1",[[null,4]],3,0,[[0]],6],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY id,id DESC LIMIT 1 OFFSET 1",[[1,2]],3,0,[[0]],5],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY id,id DESC LIMIT 2 OFFSET 8",[],3,0,[[0]],5],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY t.id,id DESC",[[3,1],[1,2],[1,3],[null,4]],3,0,[[0]],4],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY t.id,id DESC LIMIT 0 OFFSET 0",[],3,0,[[0]],1],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY t.id,id DESC LIMIT 0 OFFSET 1",[],3,0,[[0]],5],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY t.id,id DESC LIMIT 1",[[3,1]],3,0,[[0]],6],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY t.id,id DESC LIMIT 1 OFFSET 1",[[1,2]],3,0,[[0]],5],
    ["SELECT g AS id,t.id AS pk FROM t ORDER BY t.id,id DESC LIMIT 2 OFFSET 8",[],3,0,[[0]],5],
    ["SELECT id,g FROM t ORDER BY id,g DESC",[[1,3],[2,1],[3,1],[4,null]],1,0,[[0]],4],
    ["SELECT id,g FROM t ORDER BY id,g DESC LIMIT 0 OFFSET 0",[],1,0,[[0]],1],
    ["SELECT id,g FROM t ORDER BY id,g DESC LIMIT 0 OFFSET 1",[],1,0,[[0]],5],
    ["SELECT id,g FROM t ORDER BY id,g DESC LIMIT 1",[[1,3]],1,0,[[0]],6],
    ["SELECT id,g FROM t ORDER BY id,g DESC LIMIT 1 OFFSET 1",[[2,1]],1,0,[[0]],5],
    ["SELECT id,g FROM t ORDER BY id,g DESC LIMIT 2 OFFSET 8",[],1,0,[[0]],5],
    ["SELECT id,g FROM t ORDER BY id,CAST(CONCAT(g,'x') AS SIGNED)",[[1,3],[2,1],[3,1],[4,null]],1,1,[[0]],4],
    ["SELECT id,g FROM t ORDER BY id,CAST(CONCAT(g,'x') AS SIGNED) LIMIT 0 OFFSET 0",[],1,0,[[0]],1],
    ["SELECT id,g FROM t ORDER BY id,CAST(CONCAT(g,'x') AS SIGNED) LIMIT 0 OFFSET 1",[],1,1,[[0]],5],
    ["SELECT id,g FROM t ORDER BY id,CAST(CONCAT(g,'x') AS SIGNED) LIMIT 1",[[1,3]],1,1,[[0]],6],
    ["SELECT id,g FROM t ORDER BY id,CAST(CONCAT(g,'x') AS SIGNED) LIMIT 1 OFFSET 1",[[2,1]],1,1,[[0]],5],
    ["SELECT id,g FROM t ORDER BY id,CAST(CONCAT(g,'x') AS SIGNED) LIMIT 2 OFFSET 8",[],1,1,[[0]],5],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id),LAST_INSERT_ID(id) DESC",[[1,3],[2,1],[3,1],[4,null]],1,0,[[4]],4],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id),LAST_INSERT_ID(id) DESC LIMIT 0 OFFSET 0",[],1,0,[[0]],1],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id),LAST_INSERT_ID(id) DESC LIMIT 0 OFFSET 1",[],1,0,[[4]],5],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id),LAST_INSERT_ID(id) DESC LIMIT 1",[[1,3]],1,0,[[4]],6],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id),LAST_INSERT_ID(id) DESC LIMIT 1 OFFSET 1",[[2,1]],1,0,[[4]],5],
    ["SELECT id,g FROM t ORDER BY LAST_INSERT_ID(id),LAST_INSERT_ID(id) DESC LIMIT 2 OFFSET 8",[],1,0,[[4]],5],
    ["SELECT a,b,g FROM m ORDER BY a,a DESC,b DESC",[[1,2,3],[1,1,1],[2,2,1],[2,1,null]],4,0,[[0]],7],
    ["SELECT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 0 OFFSET 1",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 1",[[1,2,3]],4,0,[[0]],9],
    ["SELECT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 1 OFFSET 1",[[1,1,1]],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 2 OFFSET 8",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a DESC,a,b",[[2,1,null],[2,2,1],[1,1,1],[1,2,3]],4,0,[[0]],7],
    ["SELECT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 0 OFFSET 1",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 1",[[2,1,null]],4,0,[[0]],9],
    ["SELECT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 1 OFFSET 1",[[2,2,1]],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 2 OFFSET 8",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,b DESC,b",[[1,2,3],[1,1,1],[2,2,1],[2,1,null]],4,0,[[0]],7],
    ["SELECT a,b,g FROM m ORDER BY a,b DESC,b LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT a,b,g FROM m ORDER BY a,b DESC,b LIMIT 0 OFFSET 1",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,b DESC,b LIMIT 1",[[1,2,3]],4,0,[[0]],9],
    ["SELECT a,b,g FROM m ORDER BY a,b DESC,b LIMIT 1 OFFSET 1",[[1,1,1]],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,b DESC,b LIMIT 2 OFFSET 8",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,a,b DESC,a DESC",[[1,2,3],[1,1,1],[2,2,1],[2,1,null]],4,0,[[0]],7],
    ["SELECT a,b,g FROM m ORDER BY a,a,b DESC,a DESC LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT a,b,g FROM m ORDER BY a,a,b DESC,a DESC LIMIT 0 OFFSET 1",[],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,a,b DESC,a DESC LIMIT 1",[[1,2,3]],4,0,[[0]],9],
    ["SELECT a,b,g FROM m ORDER BY a,a,b DESC,a DESC LIMIT 1 OFFSET 1",[[1,1,1]],4,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,a,b DESC,a DESC LIMIT 2 OFFSET 8",[],4,0,[[0]],8],
    ["SELECT a AS x,b AS y,g FROM m ORDER BY 1,x DESC,2 DESC,y",[[1,2,3],[1,1,1],[2,2,1],[2,1,null]],5,0,[[0]],7],
    ["SELECT a AS x,b AS y,g FROM m ORDER BY 1,x DESC,2 DESC,y LIMIT 0 OFFSET 0",[],5,0,[[0]],1],
    ["SELECT a AS x,b AS y,g FROM m ORDER BY 1,x DESC,2 DESC,y LIMIT 0 OFFSET 1",[],5,0,[[0]],8],
    ["SELECT a AS x,b AS y,g FROM m ORDER BY 1,x DESC,2 DESC,y LIMIT 1",[[1,2,3]],5,0,[[0]],9],
    ["SELECT a AS x,b AS y,g FROM m ORDER BY 1,x DESC,2 DESC,y LIMIT 1 OFFSET 1",[[1,1,1]],5,0,[[0]],8],
    ["SELECT a AS x,b AS y,g FROM m ORDER BY 1,x DESC,2 DESC,y LIMIT 2 OFFSET 8",[],5,0,[[0]],8],
    ["SELECT a,b,g FROM m ORDER BY a,b,b DESC",[[1,1,1],[1,2,3],[2,1,null],[2,2,1]],4,0,[[0]],10],
    ["SELECT a,b,g FROM m ORDER BY a,b,b DESC LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT a,b,g FROM m ORDER BY a,b,b DESC LIMIT 0 OFFSET 1",[],4,0,[[0]],11],
    ["SELECT a,b,g FROM m ORDER BY a,b,b DESC LIMIT 1",[[1,1,1]],4,0,[[0]],12],
    ["SELECT a,b,g FROM m ORDER BY a,b,b DESC LIMIT 1 OFFSET 1",[[1,2,3]],4,0,[[0]],11],
    ["SELECT a,b,g FROM m ORDER BY a,b,b DESC LIMIT 2 OFFSET 8",[],4,0,[[0]],11],
    ["SELECT a,b,g FROM m ORDER BY b,b DESC,a",[[1,1,1],[2,1,null],[1,2,3],[2,2,1]],4,0,[[0]],10],
    ["SELECT a,b,g FROM m ORDER BY b,b DESC,a LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT a,b,g FROM m ORDER BY b,b DESC,a LIMIT 0 OFFSET 1",[],4,0,[[0]],11],
    ["SELECT a,b,g FROM m ORDER BY b,b DESC,a LIMIT 1",[[1,1,1]],4,0,[[0]],12],
    ["SELECT a,b,g FROM m ORDER BY b,b DESC,a LIMIT 1 OFFSET 1",[[2,1,null]],4,0,[[0]],11],
    ["SELECT a,b,g FROM m ORDER BY b,b DESC,a LIMIT 2 OFFSET 8",[],4,0,[[0]],11],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a,a DESC,b DESC",[[1,2,3],[1,1,1],[2,2,1],[2,1,null]],4,0,[[0]],7],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 0 OFFSET 1",[],4,0,[[0]],8],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 1",[[1,2,3]],4,0,[[0]],9],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 1 OFFSET 1",[[1,1,1]],4,0,[[0]],8],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a,a DESC,b DESC LIMIT 2 OFFSET 8",[],4,0,[[0]],8],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a DESC,a,b",[[2,1,null],[2,2,1],[1,1,1],[1,2,3]],4,0,[[0]],7],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 0 OFFSET 0",[],4,0,[[0]],1],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 0 OFFSET 1",[],4,0,[[0]],8],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 1",[[2,1,null]],4,0,[[0]],9],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 1 OFFSET 1",[[2,2,1]],4,0,[[0]],8],
    ["SELECT DISTINCT a,b,g FROM m ORDER BY a DESC,a,b LIMIT 2 OFFSET 8",[],4,0,[[0]],8],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id",[[1,3],[2,1],[3,1],[4,null]],6,0,[[0]],13],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id LIMIT 1",[[1,3]],6,0,[[0]],15],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id LIMIT 1 OFFSET 1",[[2,1]],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g,g DESC,id DESC",[[4,null],[3,1],[2,1],[1,3]],6,0,[[0]],13],
    ["SELECT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 1",[[4,null]],6,0,[[0]],15],
    ["SELECT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 1 OFFSET 1",[[3,1]],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT id AS x,g AS y FROM s ORDER BY y DESC,s.g,1",[[1,3],[2,1],[3,1],[4,null]],7,0,[[0]],13],
    ["SELECT id AS x,g AS y FROM s ORDER BY y DESC,s.g,1 LIMIT 0 OFFSET 0",[],7,0,[[0]],1],
    ["SELECT id AS x,g AS y FROM s ORDER BY y DESC,s.g,1 LIMIT 0 OFFSET 1",[],7,0,[[0]],14],
    ["SELECT id AS x,g AS y FROM s ORDER BY y DESC,s.g,1 LIMIT 1",[[1,3]],7,0,[[0]],15],
    ["SELECT id AS x,g AS y FROM s ORDER BY y DESC,s.g,1 LIMIT 1 OFFSET 1",[[2,1]],7,0,[[0]],14],
    ["SELECT id AS x,g AS y FROM s ORDER BY y DESC,s.g,1 LIMIT 2 OFFSET 8",[],7,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,id,id DESC",[[1,3],[2,1],[3,1],[4,null]],6,0,[[0]],13],
    ["SELECT id,g FROM s ORDER BY g DESC,id,id DESC LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g DESC,id,id DESC LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,id,id DESC LIMIT 1",[[1,3]],6,0,[[0]],15],
    ["SELECT id,g FROM s ORDER BY g DESC,id,id DESC LIMIT 1 OFFSET 1",[[2,1]],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,id,id DESC LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,g",[[1,3],[2,1],[3,1],[4,null]],6,0,[[0]],13],
    ["SELECT id,g FROM s ORDER BY g DESC,g LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g DESC,g LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,g LIMIT 1",[[1,3]],6,0,[[0]],15],
    ["SELECT id,g FROM s ORDER BY g DESC,g LIMIT 1 OFFSET 1",[[2,1]],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,g LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g,g DESC",[[4,null],[3,1],[2,1],[1,3]],6,0,[[0]],13],
    ["SELECT id,g FROM s ORDER BY g,g DESC LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g,g DESC LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g,g DESC LIMIT 1",[[4,null]],6,0,[[0]],15],
    ["SELECT id,g FROM s ORDER BY g,g DESC LIMIT 1 OFFSET 1",[[3,1]],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g,g DESC LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id DESC",[[1,3],[3,1],[2,1],[4,null]],6,0,[[0]],16],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id DESC LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id DESC LIMIT 0 OFFSET 1",[],6,0,[[0]],17],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id DESC LIMIT 1",[[1,3]],6,0,[[0]],18],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id DESC LIMIT 1 OFFSET 1",[[3,1]],6,0,[[0]],17],
    ["SELECT id,g FROM s ORDER BY g DESC,g,id DESC LIMIT 2 OFFSET 8",[],6,0,[[0]],17],
    ["SELECT id,g FROM s ORDER BY g DESC,id,g",[[1,3],[2,1],[3,1],[4,null]],6,0,[[0]],13],
    ["SELECT id,g FROM s ORDER BY g DESC,id,g LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT id,g FROM s ORDER BY g DESC,id,g LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,id,g LIMIT 1",[[1,3]],6,0,[[0]],15],
    ["SELECT id,g FROM s ORDER BY g DESC,id,g LIMIT 1 OFFSET 1",[[2,1]],6,0,[[0]],14],
    ["SELECT id,g FROM s ORDER BY g DESC,id,g LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT DISTINCT id,g FROM s ORDER BY g DESC,g,id",[[1,3],[2,1],[3,1],[4,null]],6,0,[[0]],13],
    ["SELECT DISTINCT id,g FROM s ORDER BY g DESC,g,id LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT DISTINCT id,g FROM s ORDER BY g DESC,g,id LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT DISTINCT id,g FROM s ORDER BY g DESC,g,id LIMIT 1",[[1,3]],6,0,[[0]],15],
    ["SELECT DISTINCT id,g FROM s ORDER BY g DESC,g,id LIMIT 1 OFFSET 1",[[2,1]],6,0,[[0]],14],
    ["SELECT DISTINCT id,g FROM s ORDER BY g DESC,g,id LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
    ["SELECT DISTINCT id,g FROM s ORDER BY g,g DESC,id DESC",[[4,null],[3,1],[2,1],[1,3]],6,0,[[0]],13],
    ["SELECT DISTINCT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 0 OFFSET 0",[],6,0,[[0]],1],
    ["SELECT DISTINCT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 0 OFFSET 1",[],6,0,[[0]],14],
    ["SELECT DISTINCT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 1",[[4,null]],6,0,[[0]],15],
    ["SELECT DISTINCT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 1 OFFSET 1",[[3,1]],6,0,[[0]],14],
    ["SELECT DISTINCT id,g FROM s ORDER BY g,g DESC,id DESC LIMIT 2 OFFSET 8",[],6,0,[[0]],14],
  ]
  try {
    await conn.query('CREATE DATABASE repeated_order')
    await conn.query('USE repeated_order')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,g INT)')
    await conn.query('INSERT INTO t VALUES(1,3),(2,1),(3,1),(4,NULL)')
    await conn.query('CREATE TABLE m(a INT,b INT,g INT,PRIMARY KEY(a ASC,b DESC))')
    await conn.query('INSERT INTO m VALUES(1,2,3),(1,1,1),(2,2,1),(2,1,NULL)')
    await conn.query('CREATE TABLE s(id INT PRIMARY KEY,g INT,KEY kg(g DESC))')
    await conn.query('INSERT INTO s SELECT * FROM t')
    for (const table of ['t', 'm', 's']) await conn.query('ANALYZE TABLE ' + table)
    for (const [sql, expected, layout, diagnostic, calls, plan] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        await conn.query('SELECT LAST_INSERT_ID(0)')
        const options = { sql, rowsAsArray: true }
        const [rows, fields] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, method + ': rows: ' + sql)
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), layouts[layout], method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings[diagnostic], method + ': warnings: ' + sql)
        assert.deepEqual((await conn.query({ sql: 'SELECT LAST_INSERT_ID()', rowsAsArray: true }))[0], calls, method + ': effects: ' + sql)
        const [explain] = await conn.query<mysql.RowDataPacket[]>('EXPLAIN FORMAT=TREE ' + sql)
        assert.equal(planSkeleton(explain[0]?.EXPLAIN), plans[plan], method + ': plan: ' + sql)
        conn.unprepare(options)
      }
    }
    const options = { sql: 'SELECT id,g FROM s ORDER BY g,g DESC LIMIT ? OFFSET ?', rowsAsArray: true }
    const statement = await conn.prepare(options)
    try {
      const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
      assert.deepEqual(columns.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), [["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]], 'prepare source fields')
      const fresh: [number, 'query' | 'execute' | 'statement', unknown, unknown[][], unknown[]][] = [
        [0,"query",[[1,0]],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[]],
        [0,"execute",[[1,0]],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[]],
        [0,"statement",[{"id":1,"g":0}],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[]],
        [9,"query",[[3,1]],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[]],
        [9,"execute",[[3,1]],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[]],
        [9,"statement",[{"id":3,"g":1}],[["id",3,11,20483,0,63,"repeated_order","s","s","id"],["g",3,11,16392,0,63,"repeated_order","s","s","g"]],[]],
      ]
      for (const [g, method, expected, layout, diagnostics] of fresh) {
        await conn.query('UPDATE s SET g=? WHERE id=1', [g])
        const [rows, fields] = method === 'statement' ? await statement.execute([1, 1])
          : method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
        assert.deepEqual(rows, expected, method + ': fresh LIMIT winner')
        assert.deepEqual(fields.map((f) => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName]), layout, method + ': fresh fields')
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], diagnostics, method + ': fresh warnings')
      }
    } finally {
      await statement.close()
      conn.unprepare(options)
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS repeated_order')
    await conn.end()
    await db?.end()
  }
})
