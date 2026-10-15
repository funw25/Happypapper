import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { PgDatabase } from "drizzle-orm/pg-core";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";

/**
 * 数据库后端由 `DATABASE_URL` 决定：有就是真实 PostgreSQL（部署形态），没有就是
 * 进程内的 PGlite（本地开发与验证形态）。两边的 schema 完全一样，迁移文件是同一批
 * 手写 SQL，因此切换后端不需要改任何查询代码。
 */
/**
 * 两个驱动共有的类型。写成联合（`PgliteDatabase | NodePgDatabase`）会让
 * `.returning({...})` 这类带重载的 builder 方法解析到错误的重载（报「Expected 0
 * arguments, but got 1」），因此对外统一按 PgDatabase 这个基类标注；查询结果的
 * 类型参数只能放宽到 any，两个驱动的 QueryResult 形状不同，收窄会让实现无法赋值。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, typeof schema>;

function createDb(): Db {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const pool = new Pool({ connectionString: url, max: 10 });
    return drizzleNodePostgres(pool, { schema });
  }

  // Kept outside the project tree: the dev watcher would otherwise treat every
  // Postgres write as a source change. See .env.local.
  const dataDir = process.env.PGLITE_DATA_DIR ?? "../happypaper-data/pgdata";
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  return drizzlePglite(client, { schema });
}

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
  // Cached in production too. Without this, every property access on `db` — that
  // is, every query — built a new PGlite instance, each opening `pglite.data`
  // and the data directory again. A production server died with
  // `EMFILE: too many open files` after a few dozen requests; the dev server
  // never showed it because the cache used to be dev-only.
  const created = createDb();
  globalForDb.__hpDb = created;
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
