/**
 * Drops the local PGlite data directory and rebuilds it from migrations plus
 * the seed. PGlite aborts on startup when a previous run was killed mid-write,
 * so this is the recovery path after an abrupt stop.
 *
 *   npm run db:reset
 *
 * Run it only while no dev server is holding the data directory.
 */
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const dataDir = process.env.PGLITE_DATA_DIR ?? "../happypaper-data/pgdata";

console.log(`removing ${dataDir}`);
await rm(dataDir, { recursive: true, force: true });

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
