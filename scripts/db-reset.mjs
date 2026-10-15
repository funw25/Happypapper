/**
 * Rebuilds the database from migrations plus the seed.
 *
 * PGlite: drops the local data directory. PGlite aborts on startup when a
 * previous run was killed mid-write, so this is the recovery path after an
 * abrupt stop. Run it only while no server holds the data directory.
 *
 * Postgres（配置了 DATABASE_URL 时）: drops and recreates the `public` schema of
 * that database. It does not touch roles, other schemas or other databases, but
 * it does delete every row in the target database — check the printed target
 * before confirming.
 *
 *   npm run db:reset
 */
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  databaseUrl,
  describeBackend,
  openRawClient,
  pgliteDataDir,
  usingPostgres,
} from "./lib/db-client.mjs";

console.log(`目标：${describeBackend()}`);

if (usingPostgres()) {
  const url = new URL(databaseUrl());
  console.log(`即将清空数据库 ${url.pathname.replace(/^\//, "")}（schema public）`);
  const client = await openRawClient();
  await client.exec(`drop schema if exists public cascade; create schema public;`);
  await client.close();
  console.log("schema public 已重建");
} else {
  const dataDir = pgliteDataDir();
  console.log(`removing ${dataDir}`);
  await rm(dataDir, { recursive: true, force: true });
}

for (const script of ["scripts/db-migrate.mjs", "scripts/db-seed.mjs"]) {
  const result = spawnSync(process.execPath, ["--env-file-if-exists=.env.local", script], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`${script} failed with status ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log("database reset");
