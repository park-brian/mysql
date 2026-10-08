import mysql from 'mysql2/promise'
import { MySQL } from '@myjs/core'
const db = await MySQL.open(':memory:')
const c = await mysql.createConnection({ stream: db.createStream() as never, user: 'root', password: '' })
await c.query('CREATE DATABASE app'); await c.query('USE app')
await c.query('CREATE TABLE `User` (`id` VARCHAR(191) NOT NULL, `email` VARCHAR(191) NOT NULL, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
await c.query('CREATE TABLE `Post` (`id` VARCHAR(191) NOT NULL, `updatedAt` DATETIME(3) NOT NULL, `author` VARCHAR(191) NULL, PRIMARY KEY (`id`)) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
await c.query('ALTER TABLE `Post` ADD CONSTRAINT `Post_author_fkey` FOREIGN KEY (`author`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE')
await c.query("INSERT INTO User VALUES ('u1', 'a@b')")
for (let i = 0; i < 10; i++) await c.query(`INSERT INTO Post VALUES ('p${i}', NOW(), NULL)`)
await c.query('BEGIN')
console.log(await c.execute('UPDATE `Post` SET `author` = ?, `updatedAt` = ? WHERE (`id` = ? AND 1=1)', ['u1', new Date(), 'p3']))
await c.query('ROLLBACK')
await c.end(); await db.end()
