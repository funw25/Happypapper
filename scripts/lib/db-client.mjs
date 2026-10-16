import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";

/**
 * 脚本侧的数据库连接：同一套 `query` / `exec` 接口，背后按 `DATABASE_URL` 选择
 * node-postgres 或 PGlite。
 *
 * 应用本身走 `src/db/index.ts`，两者共用同一个环境变量，因此「配了 DATABASE_URL
 * 就用真实 Postgres」在脚本与应用里是同一条规则；TLS 配置也共用同一套变量
 * （`DATABASE_SSL_CA`、`DATABASE_SSL_NO_VERIFY`），见 `sslOptions`。
 */
export function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  return url ? url : null;
}

/**
 * TLS 选项。连接串里的 `sslmode` / `sslrootcert` 会被驱动忽略（实测 pg 8 里
 * `sslmode=verify-full` 也会静默变成明文连接），因此必须显式传 `ssl`：
 *
 * - `DATABASE_SSL_CA`：CA 文件路径，开启校验（托管服务商常有私有根证书，
 *   例如 Supabase 的 Supabase Root 2021 CA）。
 * - `DATABASE_SSL_NO_VERIFY=1`：加密但不校验证书，用于无法固定 CA 的环境。
 * - 都不设：不加密。数据库主机不是本机时会打印一行提示。
 */
export function sslOptions() {
  const ca = process.env.DATABASE_SSL_CA?.trim();
  const noVerify = /^(1|true|yes)$/i.test(process.env.DATABASE_SSL_NO_VERIFY ?? "");
  if (ca) return { ca: readFileSync(ca, "utf8"), rejectUnauthorized: !noVerify };
  if (noVerify) return { rejectUnauthorized: false };
  return undefined;
}

function isLocalHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return true;
  }
}

export function usingPostgres() {
  return databaseUrl() !== null;
}

export function pgliteDataDir() {
  return process.env.PGLITE_DATA_DIR ?? "../happypaper-data/pgdata";
}

export async function openRawClient() {
  const url = databaseUrl();
  if (url) {
    const { default: pg } = await import("pg");
    const ssl = sslOptions();
    if (!ssl && !isLocalHost(url)) {
      console.warn(
        "提示：数据库主机不是本机，且没有配置 TLS（DATABASE_SSL_CA 或 DATABASE_SSL_NO_VERIFY=1），连接不加密。",
      );
    }
    const client = new pg.Client({ connectionString: url, ssl });
    await client.connect();
    return {
      kind: "postgres",
      query: (sql, params = []) => client.query(sql, params),
      // 迁移文件是多条语句的脚本，Postgres 的简单查询协议可以一次执行完。
      exec: (sql) => client.query(sql),
      close: () => client.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = pgliteDataDir();
  await mkdir(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await db.waitReady;
  return {
    kind: "pglite",
    query: (sql, params = []) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}

/** 打印当前用的是哪一个后端，避免脚本跑错库还看不出来。 */
export function describeBackend() {
  if (usingPostgres()) {
    const redacted = databaseUrl().replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@");
    return `PostgreSQL（${redacted}）`;
  }
  return `PGlite（${pgliteDataDir()}）`;
}
