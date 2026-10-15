import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDatabase } from "drizzle-orm/pg-core";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";

function createDb() {
  // Kept outside the project tree: the dev watcher would otherwise treat every
  // Postgres write as a source change. See .env.local.
  const dataDir = process.env.PGLITE_DATA_DIR ?? "../happypaper-data/pgdata";
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  return drizzle(client, { schema });
}

type Db = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __hpDb?: Db };

function instance(): Db {
  // The client is created on first query, not at import. `next build` imports
  // every route module in 30 parallel workers to collect page data; creating a
  // PGlite instance in each of them makes them race for a single data
  // directory, and the ones that lose print `RuntimeError: Aborted()`. A
  // partially initialised instance can also leave the directory unusable for
  // the next start, which then needs `npm run db:reset`.
  const existing = globalForDb.__hpDb;
  if (existing) return existing;
  const created = createDb();
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__hpDb = created;
  }
  return created;
}

// Importing this module must stay side-effect free, so `db` forwards every
// property to the instance that `instance()` builds on first use.
export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const target = instance();
    const value = Reflect.get(target as object, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
  has(_target, property) {
    return property in (instance() as object);
  },
  // @auth/drizzle-adapter identifies the dialect through drizzle's `is()`, which
  // walks the prototype chain. Returning the target's own prototype would look
  // like a plain object, and resolving the real instance here would open the
  // database during `next build` — the race this file exists to avoid. The real
  // instance is a PgDatabase, so naming that prototype is both accurate and
  // side-effect free.
  getPrototypeOf() {
    return PgDatabase.prototype;
  },
});

export { schema };
