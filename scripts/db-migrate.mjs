/**
 * Applies every SQL file in ./drizzle in name order, recording each in
 * _migrations. Runs against whichever backend `DATABASE_URL` selects:
 * node-postgres when it is set, otherwise the in-process PGlite so a checkout
 * needs no external database server.
 *
 * The same SQL files serve both. They are written in plain PostgreSQL, so the
 * only difference between the two backends is who executes them.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describeBackend, openRawClient } from "./lib/db-client.mjs";

const migrationsDir = resolve("drizzle");
const client = await openRawClient();

console.log(`目标：${describeBackend()}`);

await client.exec(`
  create table if not exists "_migrations" (
    "name" text primary key,
    "applied_at" timestamp with time zone not null default now()
  )
`);

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
let applied = 0;

for (const file of files) {
  const seen = await client.query(`select 1 from "_migrations" where "name" = $1`, [file]);
  if (seen.rows.length > 0) continue;

  const sqlText = await readFile(join(migrationsDir, file), "utf8");
  await client.exec(sqlText);
  await client.query(`insert into "_migrations" ("name") values ($1)`, [file]);
  console.log(`applied ${file}`);
  applied += 1;
}

const tables = await client.query(
  `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
);

console.log(`\n${applied} migration(s) applied this run`);
console.log("tables:", tables.rows.map((row) => row.table_name).join(", "));

await client.close();
