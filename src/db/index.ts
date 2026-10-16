import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { PgDatabase } from "drizzle-orm/pg-core";
import { mkdirSync, readFileSync } from "node:fs";
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

/**
 * TLS 选项。连接串里的 `sslmode` / `sslrootcert` 会被驱动忽略：实测把
 * `sslmode=verify-full` 写进 URL，连接照样是明文的（`pg_stat_ssl.ssl = false`），
 * 因此必须显式传 `ssl`。
 *
 * - `DATABASE_SSL_CA`：CA 文件路径，开启校验。托管服务商常用私有根证书，例如
 *   Supabase 的 Supabase Root 2021 CA（仓库里带了一份 `certs/supabase-prod-ca-2021.crt`）。
 * - `DATABASE_SSL_NO_VERIFY=1`：加密但不校验证书，用于无法固定 CA 的环境。
 * - 都不设：不加密；主机不是本机时打印一行提示。
 */
function databaseSsl(): PoolConfig["ssl"] {
  const ca = process.env.DATABASE_SSL_CA?.trim();
  const noVerify = /^(1|true|yes)$/i.test(process.env.DATABASE_SSL_NO_VERIFY ?? "");
  if (ca) return { ca: readFileSync(ca, "utf8"), rejectUnauthorized: !noVerify };
  if (noVerify) return { rejectUnauthorized: false };
  return undefined;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function createDb(): Db {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const ssl = databaseSsl();
    if (!ssl) {
      const host = safeHost(url);
      if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
        console.warn(
          `[db] ${host} 的连接未加密：设置 DATABASE_SSL_CA=./certs/… 或 DATABASE_SSL_NO_VERIFY=1。`,
        );
      }
    }
    const pool = new Pool({ connectionString: url, max: 10, ssl });
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
