// M5.10: COLLATE nullability and explicit coercibility belong to shared type owners.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

async function connect() {
  const host = process.env.MYSQL_REFERENCE_HOST
  const db = host === undefined ? await MySQL.open(':memory:') : undefined
  const conn = await mysql.createConnection(db === undefined
    ? { host: host ?? '127.0.0.1', port: Number(process.env.MYSQL_REFERENCE_PORT ?? 3306), user: 'root', password: process.env.MYSQL_REFERENCE_PASSWORD ?? 'root' }
    : { stream: db.createStream(), user: 'root' })
  return { db, conn }
}

function fields(columns: mysql.FieldPacket[]) {
  return columns.map(f => [f.name, f.columnType, f.columnLength, f.flags, f.decimals, f.characterSet, f.schema, f.table, f.orgTable, f.orgName])
}

const layouts: unknown[][][] = [[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,4,128,31,224,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",5,23,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",8,10,129,0,63,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,1,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,0,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,8,128,31,224,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,2,128,31,63,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,20,128,31,224,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,88,128,31,224,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,40,128,31,224,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,32,128,31,224,"","","",""]],[["id",3,11,20483,0,63,"abs_collate","t","t","id"],["x",253,44,128,31,224,"","","",""]]]
const diagnostics: unknown[][] = [[],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2026-10-11'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2026-10-11'"},{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2026-10-11'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '2026-10-11'"}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-1x'"}]]

test('COLLATE literals and columns retain native nullability and explicit coercibility', async () => {
  const { db, conn } = await connect()
  // Complete native groups only. Binary byte conversion and numeric diagnostic escaping remain separate.
  const fixtures: [string, unknown[][], number, number][] = [
    ["SELECT id,'1' COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"1"],[3,"1"]],0,0],
    ["SELECT id,'1' COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],0,0],
    ["SELECT id,'1' COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"1"]],0,0],
    ["SELECT id,'1' COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],0,0],
    ["SELECT id,ABS('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY('1' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,_binary'1' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,_binary'1' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,_binary'1' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,_binary'1' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(_binary'1' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,X'31' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,X'31' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,X'31' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,X'31' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS(X'31' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(X'31' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,b'00110001' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,b'00110001' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,b'00110001' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,b'00110001' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(b'00110001' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,X'' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([])],[2,Buffer.from([])],[3,Buffer.from([])]],4,0],
    ["SELECT id,X'' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4,0],
    ["SELECT id,X'' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([])]],4,0],
    ["SELECT id,X'' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4,0],
    ["SELECT id,ABS(X'' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],1,0],
    ["SELECT id,ABS(X'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(X'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],1,0],
    ["SELECT id,ABS(X'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(X'' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(X'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(X'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(X'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,b'' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([])],[2,Buffer.from([])],[3,Buffer.from([])]],4,0],
    ["SELECT id,b'' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4,0],
    ["SELECT id,b'' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([])]],4,0],
    ["SELECT id,b'' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4,0],
    ["SELECT id,ABS(b'' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],1,0],
    ["SELECT id,ABS(b'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(b'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],1,0],
    ["SELECT id,ABS(b'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(b'' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(b'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(b'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(b'' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,X'80' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([128])],[2,Buffer.from([128])],[3,Buffer.from([128])]],3,0],
    ["SELECT id,X'80' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,X'80' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([128])]],3,0],
    ["SELECT id,X'80' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,COERCIBILITY(X'80' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(X'80' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(X'80' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(X'80' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,b'10000000' COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([128])],[2,Buffer.from([128])],[3,Buffer.from([128])]],3,0],
    ["SELECT id,b'10000000' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,b'10000000' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([128])]],3,0],
    ["SELECT id,b'10000000' COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,COERCIBILITY(b'10000000' COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(b'10000000' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(b'10000000' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(b'10000000' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,1 COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"1"],[3,"1"]],5,0],
    ["SELECT id,1 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],5,0],
    ["SELECT id,1 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"1"]],5,0],
    ["SELECT id,1 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],5,0],
    ["SELECT id,ABS(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(1 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,1 COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],6,0],
    ["SELECT id,1 COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],6,0],
    ["SELECT id,1 COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],6,0],
    ["SELECT id,1 COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],6,0],
    ["SELECT id,ABS(1 COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(1 COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(1 COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(1 COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(1 COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(1 COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(1 COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(1 COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,1.25 COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1.25"],[2,"1.25"],[3,"1.25"]],7,0],
    ["SELECT id,1.25 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],7,0],
    ["SELECT id,1.25 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"1.25"]],7,0],
    ["SELECT id,1.25 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],7,0],
    ["SELECT id,ABS(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1.25],[2,1.25],[3,1.25]],1,0],
    ["SELECT id,ABS(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1.25]],1,0],
    ["SELECT id,ABS(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(1.25 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,1e0 COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"1"],[3,"1"]],8,0],
    ["SELECT id,1e0 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],8,0],
    ["SELECT id,1e0 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"1"]],8,0],
    ["SELECT id,1e0 COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],8,0],
    ["SELECT id,ABS(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(1e0 COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,NULL COLLATE `binary` AS x FROM t ORDER BY id",[[1,null],[2,null],[3,null]],4,0],
    ["SELECT id,NULL COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],4,0],
    ["SELECT id,NULL COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,null]],4,0],
    ["SELECT id,NULL COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],4,0],
    ["SELECT id,ABS(NULL COLLATE `binary`) AS x FROM t ORDER BY id",[[1,null],[2,null],[3,null]],1,0],
    ["SELECT id,ABS(NULL COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(NULL COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,null]],1,0],
    ["SELECT id,ABS(NULL COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(NULL COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(NULL COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(NULL COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(NULL COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,TRUE COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,TRUE COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,TRUE COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,TRUE COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS(TRUE COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(TRUE COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(TRUE COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(TRUE COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(TRUE COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(TRUE COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(TRUE COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(TRUE COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,DATE '2026-10-11' COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"2026-10-11"],[2,"2026-10-11"],[3,"2026-10-11"]],9,0],
    ["SELECT id,DATE '2026-10-11' COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],9,0],
    ["SELECT id,DATE '2026-10-11' COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"2026-10-11"]],9,0],
    ["SELECT id,DATE '2026-10-11' COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],9,0],
    ["SELECT id,ABS(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,2026],[2,2026],[3,2026]],1,1],
    ["SELECT id,ABS(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,2026]],1,2],
    ["SELECT id,ABS(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(DATE '2026-10-11' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(b COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,v COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"-1x"],[3,null]],10,0],
    ["SELECT id,v COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],10,0],
    ["SELECT id,v COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"-1x"]],10,0],
    ["SELECT id,v COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],10,0],
    ["SELECT id,ABS(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,null]],1,3],
    ["SELECT id,ABS(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,3],
    ["SELECT id,ABS(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,i COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"-1"],[3,null]],11,0],
    ["SELECT id,i COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],11,0],
    ["SELECT id,i COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"-1"]],11,0],
    ["SELECT id,i COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],11,0],
    ["SELECT id,ABS(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,null]],1,0],
    ["SELECT id,ABS(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(i COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,(X'31') COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,(X'31') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,(X'31') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,(X'31') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS((X'31') COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS((X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS((X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS((X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY((X'31') COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY((X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY((X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY((X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,(_binary'1') COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,(_binary'1') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,(_binary'1') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,(_binary'1') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY((_binary'1') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,CAST(X'31' AS BINARY) COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,CAST(X'31' AS BINARY) COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,CAST(X'31' AS BINARY) COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,CAST(X'31' AS BINARY) COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(CAST(X'31' AS BINARY) COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,CONCAT(X'31') COLLATE `binary` AS x FROM t ORDER BY id",[[1,Buffer.from([49])],[2,Buffer.from([49])],[3,Buffer.from([49])]],3,0],
    ["SELECT id,CONCAT(X'31') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],3,0],
    ["SELECT id,CONCAT(X'31') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,Buffer.from([49])]],3,0],
    ["SELECT id,CONCAT(X'31') COLLATE `binary` AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],3,0],
    ["SELECT id,ABS(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,1]],1,0],
    ["SELECT id,ABS(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(CONCAT(X'31') COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,COERCIBILITY(bn COLLATE `binary`) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(bn COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(bn COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(bn COLLATE `binary`) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,vn COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"-1x"],[3,"0"]],10,0],
    ["SELECT id,vn COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],10,0],
    ["SELECT id,vn COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"-1x"]],10,0],
    ["SELECT id,vn COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],10,0],
    ["SELECT id,ABS(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,0]],1,3],
    ["SELECT id,ABS(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,3],
    ["SELECT id,ABS(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
    ["SELECT id,ni COLLATE utf8mb4_bin AS x FROM t ORDER BY id",[[1,"1"],[2,"-1"],[3,"0"]],11,0],
    ["SELECT id,ni COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],11,0],
    ["SELECT id,ni COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,"-1"]],11,0],
    ["SELECT id,ni COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],11,0],
    ["SELECT id,ABS(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,1],[2,1],[3,0]],1,0],
    ["SELECT id,ABS(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],1,0],
    ["SELECT id,ABS(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,1]],1,0],
    ["SELECT id,ABS(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],1,0],
    ["SELECT id,COERCIBILITY(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id",[[1,0],[2,0],[3,0]],2,0],
    ["SELECT id,COERCIBILITY(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 0 OFFSET 1",[],2,0],
    ["SELECT id,COERCIBILITY(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 1 OFFSET 1",[[2,0]],2,0],
    ["SELECT id,COERCIBILITY(ni COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT 2 OFFSET 8",[],2,0],
  ]
  try {
    await conn.query('CREATE DATABASE abs_collate')
    await conn.query('USE abs_collate')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,b VARBINARY(8),v VARCHAR(8),i INT,bn VARBINARY(8) NOT NULL,vn VARCHAR(8) NOT NULL,ni INT NOT NULL)')
    await conn.query("INSERT INTO t VALUES(1,X'31','1',1,X'31','1',1),(2,X'80','-1x',-1,X'80','-1x',-1),(3,NULL,NULL,NULL,X'30','0',0)")
    for (const [sql, expected, layout, diagnostic] of fixtures) {
      for (const method of ['query', 'execute'] as const) {
        const options = { sql, rowsAsArray: true }
        const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, method + ': rows: ' + sql)
        assert.deepEqual(fields(columns), layouts[layout], method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], diagnostics[diagnostic], method + ': diagnostics: ' + sql)
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS abs_collate')
    await conn.end()
    await db?.end()
  }
})

test('COLLATE introduced literals preserve values, aggregation and uncollated controls', async () => {
  const { db, conn } = await connect()
  // IF binary derivation remains a separate gap; every admitted control matches in full.
  const fixtures: [string, unknown[][], unknown[][], unknown[]][] = [
    ["SELECT X'31' AS x",[[Buffer.from([49])]],[["x",253,1,161,0,63,"","","",""]],[]],
    ["SELECT b'00110001' AS x",[[Buffer.from([49])]],[["x",253,1,129,0,63,"","","",""]],[]],
    ["SELECT _binary'1' AS x",[[Buffer.from([49])]],[["x",253,1,129,31,63,"","","",""]],[]],
    ["SELECT _binary X'31' AS x",[[Buffer.from([49])]],[["x",253,1,129,31,63,"","","",""]],[]],
    ["SELECT _binary b'00110001' AS x",[[Buffer.from([49])]],[["x",253,1,129,31,63,"","","",""]],[]],
    ["SELECT _latin1 X'E9' AS x",[["é"]],[["x",253,4,1,31,224,"","","",""]],[]],
    ["SELECT _utf8mb4 X'C3A9' AS x",[["é"]],[["x",253,4,1,31,224,"","","",""]],[]],
    ["SELECT _utf8mb4 b'00110001' AS x",[["1"]],[["x",253,4,1,31,224,"","","",""]],[]],
    ["SELECT _latin1 X'E9' COLLATE latin1_bin AS x",[["é"]],[["x",253,4,128,31,224,"","","",""]],[]],
    ["SELECT _utf8mb4 X'C3A9' COLLATE utf8mb4_bin AS x",[["é"]],[["x",253,4,128,31,224,"","","",""]],[]],
    ["SELECT _binary X'31' COLLATE `binary` AS x",[[Buffer.from([49])]],[["x",253,1,128,31,63,"","","",""]],[]],
    ["SELECT _binary b'00110001' COLLATE `binary` AS x",[[Buffer.from([49])]],[["x",253,1,128,31,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(X'31') AS x",[[4]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(_binary'1') AS x",[[4]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(_latin1 X'E9') AS x",[[4]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(_utf8mb4 X'C3A9') AS x",[[4]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(_latin1 X'E9' COLLATE latin1_bin) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(_utf8mb4 X'C3A9' COLLATE utf8mb4_bin) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(_binary X'31' COLLATE `binary`) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(CONCAT(X'31' COLLATE `binary`,X'32')) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COLLATION(CONCAT(X'31' COLLATE `binary`,X'32')) AS x",[["binary"]],[["x",253,256,0,31,224,"","","",""]],[]],
    ["SELECT CONCAT(X'31' COLLATE `binary`,X'32') AS x",[[Buffer.from([49,50])]],[["x",253,2,128,31,63,"","","",""]],[]],
    ["SELECT IF(1,X'31' COLLATE `binary`,X'32') AS x",[[Buffer.from([49])]],[["x",253,1,128,31,63,"","","",""]],[]],
    ["SELECT COERCIBILITY(CONCAT(_latin1 X'E9' COLLATE latin1_bin,'a')) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT COLLATION(CONCAT(_latin1 X'E9' COLLATE latin1_bin,'a')) AS x",[["latin1_bin"]],[["x",253,256,0,31,224,"","","",""]],[]],
    ["SELECT CONCAT(_latin1 X'E9' COLLATE latin1_bin,'a') AS x",[["éa"]],[["x",253,8,128,31,224,"","","",""]],[]],
    ["SELECT (1+1) COLLATE utf8mb4_bin AS x",[["2"]],[["x",253,12,128,31,224,"","","",""]],[]],
    ["SELECT COERCIBILITY((1+1) COLLATE utf8mb4_bin) AS x",[[0]],[["x",8,10,129,0,63,"","","",""]],[]],
    ["SELECT CHARSET(_latin1 X'E9' COLLATE latin1_bin) AS x",[["latin1"]],[["x",253,256,0,31,224,"","","",""]],[]],
    ["SELECT HEX(_latin1 X'E9' COLLATE latin1_bin) AS x",[["E9"]],[["x",253,8,0,31,224,"","","",""]],[]],
  ]
  const refusals: [string, [number, string, string]][] = [
    ["SELECT _utf8mb4 X'80' COLLATE utf8mb4_bin AS x",[1300,"HY000","Invalid utf8mb4 character string: '80'"]],
    ["SELECT CONCAT(_latin1 X'E9' COLLATE latin1_bin,_latin1 X'E9' COLLATE latin1_swedish_ci) AS x",[1267,"HY000","Illegal mix of collations (latin1_bin,EXPLICIT) and (latin1_swedish_ci,EXPLICIT) for operation 'concat'"]],
    ["SELECT _latin1 X'E9' COLLATE latin1_bin = _latin1 X'E9' COLLATE latin1_swedish_ci AS x",[1267,"HY000","Illegal mix of collations (latin1_bin,EXPLICIT) and (latin1_swedish_ci,EXPLICIT) for operation '='"]],
    ["SELECT X'31' COLLATE latin1_bin AS x",[1253,"42000","COLLATION 'latin1_bin' is not valid for CHARACTER SET 'binary'"]],
    ["SELECT NULL COLLATE utf8mb4_bin AS x",[1253,"42000","COLLATION 'utf8mb4_bin' is not valid for CHARACTER SET 'binary'"]],
  ]
  try {
    for (const method of ['query', 'execute'] as const) {
      for (const [sql, expected, expectedFields, warnings] of fixtures) {
        const options = { sql, rowsAsArray: true }
        const [rows, columns] = method === 'query' ? await conn.query(options) : await conn.execute(options)
        assert.deepEqual(rows, expected, method + ': rows: ' + sql)
        assert.deepEqual(fields(columns), expectedFields, method + ': fields: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': warnings: ' + sql)
        conn.unprepare(options)
      }
      for (const [sql, expected] of refusals) {
        const options = { sql, rowsAsArray: true }
        await assert.rejects(() => method === 'query' ? conn.query(options) : conn.execute(options), error => {
          const e = error as { errno: number; sqlState: string; message: string }
          assert.deepEqual([e.errno, e.sqlState, e.message], expected, method + ': refusal: ' + sql)
          return true
        })
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.end()
    await db?.end()
  }
})

test('COLLATE fields and coercibility stay correct in prepared reads after source writes', async () => {
  const { db, conn } = await connect()
  const fixtures: [string, unknown[][], [unknown[], unknown[][], unknown[], unknown[]][]][] = [
    ["SELECT id,v COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",253,32,128,31,224,"","","",""]],[[["2","2"],[[2,"2"]],[{"id":2,"x":"2"}],[]],[["-1x","-1x"],[[2,"-1x"]],[{"id":2,"x":"-1x"}],[]],[[null,"0"],[[2,null]],[{"id":2,"x":null}],[]]]],
    ["SELECT id,vn COLLATE utf8mb4_bin AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",253,32,128,31,224,"","","",""]],[[["2","2"],[[2,"2"]],[{"id":2,"x":"2"}],[]],[["-1x","-1x"],[[2,"-1x"]],[{"id":2,"x":"-1x"}],[]],[[null,"0"],[[2,"0"]],[{"id":2,"x":"0"}],[]]]],
    ["SELECT id,ABS(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],[[["2","2"],[[2,2]],[{"id":2,"x":2}],[]],[["-1x","-1x"],[[2,1]],[{"id":2,"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-1x'"}]],[[null,"0"],[[2,null]],[{"id":2,"x":null}],[]]]],
    ["SELECT id,ABS(vn COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",5,23,128,31,63,"","","",""]],[[["2","2"],[[2,2]],[{"id":2,"x":2}],[]],[["-1x","-1x"],[[2,1]],[{"id":2,"x":1}],[{"Level":"Warning","Code":1292,"Message":"Truncated incorrect DOUBLE value: '-1x'"}]],[[null,"0"],[[2,0]],[{"id":2,"x":0}],[]]]],
    ["SELECT id,COERCIBILITY(v COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",8,10,129,0,63,"","","",""]],[[["2","2"],[[2,0]],[{"id":2,"x":0}],[]],[["-1x","-1x"],[[2,0]],[{"id":2,"x":0}],[]],[[null,"0"],[[2,0]],[{"id":2,"x":0}],[]]]],
    ["SELECT id,COERCIBILITY(_binary X'31' COLLATE `binary`) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",8,10,129,0,63,"","","",""]],[[["2","2"],[[2,0]],[{"id":2,"x":0}],[]],[["-1x","-1x"],[[2,0]],[{"id":2,"x":0}],[]],[[null,"0"],[[2,0]],[{"id":2,"x":0}],[]]]],
    ["SELECT id,_latin1 X'E9' COLLATE latin1_bin AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",253,4,128,31,224,"","","",""]],[[["2","2"],[[2,"é"]],[{"id":2,"x":"é"}],[]],[["-1x","-1x"],[[2,"é"]],[{"id":2,"x":"é"}],[]],[[null,"0"],[[2,"é"]],[{"id":2,"x":"é"}],[]]]],
    ["SELECT id,COERCIBILITY(_utf8mb4 X'C3A9' COLLATE utf8mb4_bin) AS x FROM t ORDER BY id LIMIT ? OFFSET ?",[["id",3,11,20483,0,63,"collate_fresh","t","t","id"],["x",8,10,129,0,63,"","","",""]],[[["2","2"],[[2,0]],[{"id":2,"x":0}],[]],[["-1x","-1x"],[[2,0]],[{"id":2,"x":0}],[]],[[null,"0"],[[2,0]],[{"id":2,"x":0}],[]]]],
  ]
  try {
    await conn.query('CREATE DATABASE collate_fresh')
    await conn.query('USE collate_fresh')
    await conn.query('CREATE TABLE t(id INT PRIMARY KEY,v VARCHAR(8),vn VARCHAR(8) NOT NULL)')
    for (const [sql, expectedFields, states] of fixtures) {
      await conn.query('DELETE FROM t')
      await conn.query("INSERT INTO t VALUES(1,'1','1'),(2,'2','2'),(3,'3','3')")
      const options = { sql, rowsAsArray: true }
      const statement = await conn.prepare(options)
      try {
        const columns = (statement as unknown as { statement: { columns: mysql.FieldPacket[] } }).statement.columns
        assert.deepEqual(fields(columns), expectedFields, 'PREPARE metadata: ' + sql)
        assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], [], 'PREPARE warnings: ' + sql)
        for (const [values, arrayRows, objectRows, warnings] of states) {
          await conn.query('UPDATE t SET v=?,vn=? WHERE id=2', values)
          for (const method of ['query', 'execute', 'statement'] as const) {
            const [rows, columns] = method === 'statement' ? await statement.execute([1, 1])
              : method === 'query' ? await conn.query(options, [1, 1]) : await conn.execute(options, [1, 1])
            assert.deepEqual(rows, method === 'statement' ? objectRows : arrayRows, method + ': fresh rows: ' + sql)
            assert.deepEqual(fields(columns), expectedFields, method + ': fresh fields: ' + sql)
            assert.deepEqual((await conn.query('SHOW WARNINGS'))[0], warnings, method + ': fresh warnings: ' + sql)
          }
        }
      } finally {
        await statement.close()
        conn.unprepare(options)
      }
    }
  } finally {
    await conn.query('DROP DATABASE IF EXISTS collate_fresh')
    await conn.end()
    await db?.end()
  }
})
