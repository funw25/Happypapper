/**
 * Applies every SQL file in ./drizzle in name order, recording each in
 * _migrations. Runs on PGlite directly so the project needs no external
 * database server and no esbuild-based tooling.
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dataDir = process.env.PGLITE_DATA_DIR ?? "../happypaper-data/pgdata";
const migrationsDir = resolve("drizzle");

await mkdir(dataDir, { recursive: true });
const db = new PGlite(dataDir);

await db.exec(`
  create table if not exists "_migrations" (
    "name" text primary key,
    "applied_at" timestamp with time zone not null default now()
  )
`);

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
let applied = 0;

for (const file of files) {
  const seen = await db.query(`select 1 from "_migrations" where "name" = $1`, [file]);
  if (seen.rows.length > 0) continue;

  const sqlText = await readFile(join(migrationsDir, file), "utf8");
  await db.exec(sqlText);
  await db.query(`insert into "_migrations" ("name") values ($1)`, [file]);
  console.log(`applied ${file}`);
  applied += 1;
}

const tables = await db.query(
  `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
);

console.log(`\n${applied} migration(s) applied this run`);
console.log("tables:", tables.rows.map((r) => r.table_name).join(", "));

await db.close();
