/**
 * 本地起一个真实 PostgreSQL（docs/02-roadmap.md B3 的迁移前置）。
 *
 *   npm run pg:start        # 前台运行，Ctrl+C 停止；数据留在 .pgdata-dev/
 *
 * 为什么用它：应用现在支持 `DATABASE_URL` 指向真实 Postgres，但本机不一定装了
 * Postgres。embedded-postgres 直接带着官方二进制，于是「迁移脚本、查询、备份说明」
 * 这些只能在真实 Postgres 上验证的东西可以本地验证，而不是靠读代码猜。
 *
 * 生产不经过这个脚本：那边连的是自己的数据库，二进制与数据目录都由运维管理。
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.PG_PORT ?? "5433");
const databaseDir = resolve(process.env.PG_DATA_DIR ?? ".pgdata-dev");
const database = process.env.PG_DATABASE ?? "happypaper";
const user = process.env.PG_USER ?? "postgres";
const password = process.env.PG_PASSWORD ?? "postgres";

const postgres = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
});

if (!existsSync(resolve(databaseDir, "PG_VERSION"))) {
  console.log(`初始化数据目录 ${databaseDir} …`);
  await postgres.initialise();
}

await postgres.start();
console.log(`PostgreSQL 已启动（端口 ${port}，数据目录 ${databaseDir}）`);

try {
  await postgres.createDatabase(database);
  console.log(`已创建数据库 ${database}`);
} catch {
  console.log(`数据库 ${database} 已存在，跳过创建`);
}

console.log("\n在另一个终端里：");
console.log(`  $env:DATABASE_URL = "postgres://${user}:${password}@127.0.0.1:${port}/${database}"`);
console.log("  npm run db:migrate");
console.log("  npm run db:seed");
console.log("  npm run dev");
console.log("\n本窗口保持运行；Ctrl+C 会在退出时停掉 Postgres。");

async function shutdown() {
  console.log("\n正在停止 PostgreSQL …");
  await postgres.stop().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// 保持进程存活：embedded-postgres 的服务器是独立子进程，Node 退出就会带走它。
setInterval(() => {}, 1 << 30);
