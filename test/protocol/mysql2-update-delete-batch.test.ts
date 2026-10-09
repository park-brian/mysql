// A bulk UPDATE and DELETE, as 8.4.11 answered each of these statements.
//
// What it pins: without IGNORE, the rows of one UPDATE or DELETE are written
// in batches (M5.32), several to a mini-transaction, and none of that shows.
// A duplicate key, a CHECK or a foreign key that fails partway leaves none
// of the statement's rows changed, cascades included; a duplicate whose
// partner was written earlier in the same batch names the value the server
// names; a key moved in ascending order meets its neighbour (1062) and in
// descending order does not; ROLLBACK takes back statements that spanned
// batches.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'

type Outcome = readonly (readonly (string | null)[])[] | readonly [number, number, string, number] | readonly [number, string]

const SCRIPT: readonly (readonly [string, Outcome])[] = [
  ["CREATE TABLE p (id INT PRIMARY KEY, u INT UNIQUE, v INT, CHECK (v < 1000))", [0,0,"",0]],
  ["CREATE TABLE c (id INT PRIMARY KEY, p INT, FOREIGN KEY (p) REFERENCES p (id))", [0,0,"",0]],
  ["CREATE TABLE k (id INT PRIMARY KEY, p INT, FOREIGN KEY (p) REFERENCES p (id) ON DELETE CASCADE ON UPDATE CASCADE)", [0,0,"",0]],
  ["CREATE TABLE h (a INT, b VARCHAR(10))", [0,0,"",0]],
  ["INSERT INTO p VALUES (1, 1, 1), (2, 2, 2), (3, 3, 3), (4, 4, 4), (5, 5, 5), (6, 6, 6), (7, 7, 7), (8, 8, 8), (9, 9, 9), (10, 10, 10), (11, 11, 11), (12, 12, 12), (13, 13, 13), (14, 14, 14), (15, 15, 15), (16, 16, 16), (17, 17, 17), (18, 18, 18), (19, 19, 19), (20, 20, 20), (21, 21, 21), (22, 22, 22), (23, 23, 23), (24, 24, 24), (25, 25, 25), (26, 26, 26), (27, 27, 27), (28, 28, 28), (29, 29, 29), (30, 30, 30), (31, 31, 31), (32, 32, 32), (33, 33, 33), (34, 34, 34), (35, 35, 35), (36, 36, 36), (37, 37, 37), (38, 38, 38), (39, 39, 39), (40, 40, 40), (41, 41, 41), (42, 42, 42), (43, 43, 43), (44, 44, 44), (45, 45, 45), (46, 46, 46), (47, 47, 47), (48, 48, 48), (49, 49, 49), (50, 50, 50), (51, 51, 51), (52, 52, 52), (53, 53, 53), (54, 54, 54), (55, 55, 55), (56, 56, 56), (57, 57, 57), (58, 58, 58), (59, 59, 59), (60, 60, 60), (61, 61, 61), (62, 62, 62), (63, 63, 63), (64, 64, 64), (65, 65, 65), (66, 66, 66), (67, 67, 67), (68, 68, 68), (69, 69, 69), (70, 70, 70), (71, 71, 71), (72, 72, 72), (73, 73, 73), (74, 74, 74), (75, 75, 75), (76, 76, 76), (77, 77, 77), (78, 78, 78), (79, 79, 79), (80, 80, 80), (81, 81, 81), (82, 82, 82), (83, 83, 83), (84, 84, 84), (85, 85, 85), (86, 86, 86), (87, 87, 87), (88, 88, 88), (89, 89, 89), (90, 90, 90), (91, 91, 91), (92, 92, 92), (93, 93, 93), (94, 94, 94), (95, 95, 95), (96, 96, 96), (97, 97, 97), (98, 98, 98), (99, 99, 99), (100, 100, 100), (101, 101, 101), (102, 102, 102), (103, 103, 103), (104, 104, 104), (105, 105, 105), (106, 106, 106), (107, 107, 107), (108, 108, 108), (109, 109, 109), (110, 110, 110), (111, 111, 111), (112, 112, 112), (113, 113, 113), (114, 114, 114), (115, 115, 115), (116, 116, 116), (117, 117, 117), (118, 118, 118), (119, 119, 119), (120, 120, 120), (121, 121, 121), (122, 122, 122), (123, 123, 123), (124, 124, 124), (125, 125, 125), (126, 126, 126), (127, 127, 127), (128, 128, 128), (129, 129, 129), (130, 130, 130), (131, 131, 131), (132, 132, 132), (133, 133, 133), (134, 134, 134), (135, 135, 135), (136, 136, 136), (137, 137, 137), (138, 138, 138), (139, 139, 139), (140, 140, 140), (141, 141, 141), (142, 142, 142), (143, 143, 143), (144, 144, 144), (145, 145, 145), (146, 146, 146), (147, 147, 147), (148, 148, 148), (149, 149, 149), (150, 150, 150), (151, 151, 151), (152, 152, 152), (153, 153, 153), (154, 154, 154), (155, 155, 155), (156, 156, 156), (157, 157, 157), (158, 158, 158), (159, 159, 159), (160, 160, 160), (161, 161, 161), (162, 162, 162), (163, 163, 163), (164, 164, 164), (165, 165, 165), (166, 166, 166), (167, 167, 167), (168, 168, 168), (169, 169, 169), (170, 170, 170), (171, 171, 171), (172, 172, 172), (173, 173, 173), (174, 174, 174), (175, 175, 175), (176, 176, 176), (177, 177, 177), (178, 178, 178), (179, 179, 179), (180, 180, 180), (181, 181, 181), (182, 182, 182), (183, 183, 183), (184, 184, 184), (185, 185, 185), (186, 186, 186), (187, 187, 187), (188, 188, 188), (189, 189, 189), (190, 190, 190), (191, 191, 191), (192, 192, 192), (193, 193, 193), (194, 194, 194), (195, 195, 195), (196, 196, 196), (197, 197, 197), (198, 198, 198), (199, 199, 199), (200, 200, 200)", [200,0,"Records: 200  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO c VALUES (1, 150)", [1,0,"",0]],
  ["INSERT INTO k VALUES (1, 2), (2, 4), (3, 6), (4, 8), (5, 10), (6, 12), (7, 14), (8, 16), (9, 18), (10, 20), (11, 22), (12, 24), (13, 26), (14, 28), (15, 30), (16, 32), (17, 34), (18, 36), (19, 38), (20, 40), (21, 42), (22, 44), (23, 46), (24, 48), (25, 50), (26, 52), (27, 54), (28, 56), (29, 58), (30, 60), (31, 62), (32, 64), (33, 66), (34, 68), (35, 70), (36, 72), (37, 74), (38, 76), (39, 78), (40, 80), (41, 82), (42, 84), (43, 86), (44, 88), (45, 90), (46, 92), (47, 94), (48, 96), (49, 98), (50, 100), (51, 102), (52, 104), (53, 106), (54, 108), (55, 110), (56, 112), (57, 114), (58, 116), (59, 118), (60, 120), (61, 122), (62, 124), (63, 126), (64, 128), (65, 130), (66, 132), (67, 134), (68, 136), (69, 138), (70, 140), (71, 142), (72, 144), (73, 146), (74, 148), (75, 150), (76, 152), (77, 154), (78, 156), (79, 158), (80, 160), (81, 162), (82, 164), (83, 166), (84, 168), (85, 170), (86, 172), (87, 174), (88, 176), (89, 178), (90, 180), (91, 182), (92, 184), (93, 186), (94, 188), (95, 190), (96, 192), (97, 194), (98, 196), (99, 198), (100, 200)", [100,0,"Records: 100  Duplicates: 0  Warnings: 0",0]],
  ["INSERT INTO h VALUES (1, 'h1'), (2, 'h2'), (3, 'h3'), (4, 'h4'), (5, 'h5'), (6, 'h6'), (7, 'h7'), (8, 'h8'), (9, 'h9'), (10, 'h10'), (11, 'h11'), (12, 'h12'), (13, 'h13'), (14, 'h14'), (15, 'h15'), (16, 'h16'), (17, 'h17'), (18, 'h18'), (19, 'h19'), (20, 'h20'), (21, 'h21'), (22, 'h22'), (23, 'h23'), (24, 'h24'), (25, 'h25'), (26, 'h26'), (27, 'h27'), (28, 'h28'), (29, 'h29'), (30, 'h30'), (31, 'h31'), (32, 'h32'), (33, 'h33'), (34, 'h34'), (35, 'h35'), (36, 'h36'), (37, 'h37'), (38, 'h38'), (39, 'h39'), (40, 'h40'), (41, 'h41'), (42, 'h42'), (43, 'h43'), (44, 'h44'), (45, 'h45'), (46, 'h46'), (47, 'h47'), (48, 'h48'), (49, 'h49'), (50, 'h50'), (51, 'h51'), (52, 'h52'), (53, 'h53'), (54, 'h54'), (55, 'h55'), (56, 'h56'), (57, 'h57'), (58, 'h58'), (59, 'h59'), (60, 'h60'), (61, 'h61'), (62, 'h62'), (63, 'h63'), (64, 'h64'), (65, 'h65'), (66, 'h66'), (67, 'h67'), (68, 'h68'), (69, 'h69'), (70, 'h70'), (71, 'h71'), (72, 'h72'), (73, 'h73'), (74, 'h74'), (75, 'h75'), (76, 'h76'), (77, 'h77'), (78, 'h78'), (79, 'h79'), (80, 'h80'), (81, 'h81'), (82, 'h82'), (83, 'h83'), (84, 'h84'), (85, 'h85'), (86, 'h86'), (87, 'h87'), (88, 'h88'), (89, 'h89'), (90, 'h90'), (91, 'h91'), (92, 'h92'), (93, 'h93'), (94, 'h94'), (95, 'h95'), (96, 'h96'), (97, 'h97'), (98, 'h98'), (99, 'h99'), (100, 'h100'), (101, 'h101'), (102, 'h102'), (103, 'h103'), (104, 'h104'), (105, 'h105'), (106, 'h106'), (107, 'h107'), (108, 'h108'), (109, 'h109'), (110, 'h110'), (111, 'h111'), (112, 'h112'), (113, 'h113'), (114, 'h114'), (115, 'h115'), (116, 'h116'), (117, 'h117'), (118, 'h118'), (119, 'h119'), (120, 'h120'), (121, 'h121'), (122, 'h122'), (123, 'h123'), (124, 'h124'), (125, 'h125'), (126, 'h126'), (127, 'h127'), (128, 'h128'), (129, 'h129'), (130, 'h130'), (131, 'h131'), (132, 'h132'), (133, 'h133'), (134, 'h134'), (135, 'h135'), (136, 'h136'), (137, 'h137'), (138, 'h138'), (139, 'h139'), (140, 'h140'), (141, 'h141'), (142, 'h142'), (143, 'h143'), (144, 'h144'), (145, 'h145'), (146, 'h146'), (147, 'h147'), (148, 'h148'), (149, 'h149'), (150, 'h150')", [150,0,"Records: 150  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE p SET u = u + 1 WHERE id <= 100", [1062,"Duplicate entry '2' for key 'p.u'"]],
  ["UPDATE p SET u = 300 - u ORDER BY id", [1062,"Duplicate entry '200' for key 'p.u'"]],
  ["UPDATE p SET u = IF(id = 120, 50, u + 1000) ORDER BY id", [200,0,"Rows matched: 200  Changed: 200  Warnings: 0",0]],
  ["SELECT COUNT(*), SUM(u), SUM(v) FROM p", [["200","219030","20100"]]],
  ["UPDATE p SET u = IF(id = 70, 5066, id + 5000) ORDER BY id", [1062,"Duplicate entry '5066' for key 'p.u'"]],
  ["SELECT COUNT(*), SUM(u) FROM p", [["200","219030"]]],
  ["UPDATE p SET v = v * 5 ORDER BY id", [3819,"Check constraint 'p_chk_1' is violated."]],
  ["UPDATE p SET v = v + 1 ORDER BY id", [200,0,"Rows matched: 200  Changed: 200  Warnings: 0",0]],
  ["SELECT SUM(v) FROM p", [["20300"]]],
  ["DELETE FROM p WHERE id > 100", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `c_ibfk_1` FOREIGN KEY (`p`) REFERENCES `p` (`id`))"]],
  ["SELECT COUNT(*) FROM p", [["200"]]],
  ["UPDATE p SET id = id + 1000 WHERE id BETWEEN 1 AND 100 AND id <> 150 ORDER BY id DESC", [100,0,"Rows matched: 100  Changed: 100  Warnings: 0",0]],
  ["SELECT COUNT(*), MIN(id), MAX(id) FROM p", [["200","101","1100"]]],
  ["SELECT COUNT(*), MIN(p), MAX(p) FROM k", [["100","102","1100"]]],
  ["DELETE FROM p WHERE id < 1100", [1451,"Cannot delete or update a parent row: a foreign key constraint fails (`app`.`c`, CONSTRAINT `c_ibfk_1` FOREIGN KEY (`p`) REFERENCES `p` (`id`))"]],
  ["SELECT COUNT(*) FROM p", [["200"]]],
  ["SELECT COUNT(*) FROM k", [["100"]]],
  ["UPDATE h SET b = CONCAT(b, 'xxxxxx')", [150,0,"Rows matched: 150  Changed: 150  Warnings: 0",0]],
  ["SELECT COUNT(*), MAX(b) FROM h", [["150","h9xxxxxx"]]],
  ["BEGIN", [0,0,"",0]],
  ["UPDATE h SET a = a * 2", [150,0,"Rows matched: 150  Changed: 150  Warnings: 0",0]],
  ["DELETE FROM h WHERE a > 100", [100,0,"",0]],
  ["SELECT COUNT(*), SUM(a) FROM h", [["50","2550"]]],
  ["ROLLBACK", [0,0,"",0]],
  ["SELECT COUNT(*), SUM(a) FROM h", [["150","11325"]]],
  ["DELETE FROM h ORDER BY a DESC LIMIT 70", [70,0,"",0]],
  ["CREATE TABLE g (id INT PRIMARY KEY, v INT)", [0,0,"",0]],
  ["INSERT INTO g SELECT a, a FROM h", [80,0,"Records: 80  Duplicates: 0  Warnings: 0",0]],
  ["UPDATE g SET id = id + 1 ORDER BY id", [1062,"Duplicate entry '2' for key 'g.PRIMARY'"]],
  ["UPDATE g SET id = id + 1 ORDER BY id DESC", [80,0,"Rows matched: 80  Changed: 80  Warnings: 0",0]],
  ["SELECT COUNT(*), MIN(id), MAX(id) FROM g", [["80","2","81"]]],
  ["SELECT COUNT(*), MAX(a) FROM h", [["80","80"]]],
]

test('a bulk UPDATE and DELETE answer as 8.4.11 does, batched', async () => {
  const db = await MySQL.open(':memory:')
  const conn = await mysql.createConnection({ stream: db.createStream(), user: 'root', password: '', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true })
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
