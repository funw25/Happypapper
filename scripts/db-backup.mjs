/**
 * 备份数据库与 PDF 存储（docs/02-roadmap.md B3 的部署前置项）。
 *
 *   npm run db:backup                 # 默认备份到 backups/<UTC 时间戳>/
 *   BACKUP_DIR=D:\hp-backups npm run db:backup
 *
 * PGlite 是一个进程独占数据目录的嵌入式数据库，运行中的服务器可能正在写 WAL 与
 * 统计文件，因此本脚本在检测到 3100 端口有监听时直接拒绝，而不是生成一份可能在
 * 恢复时打不开的备份。
 *
 * 迁移到真实 PostgreSQL 后，数据库部分换成 `pg_dump`（大版本一致才能恢复），本脚本
 * 的清单、校验和与「先停服务」这两条约束仍然适用。
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { databaseUrl, openRawClient, pgliteDataDir, usingPostgres } from "./lib/db-client.mjs";

const storageDir = resolve(process.env.STORAGE_DIR ?? "./storage/pdfs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const backupRoot = resolve(process.env.BACKUP_DIR ?? "backups", stamp);

// PostgreSQL 的备份要交给 pg_dump：逻辑转储涉及权限、序列、扩展与并发快照，
// 复制数据目录在真实部署里是错的（而且版本之间不能互换）。
if (usingPostgres()) {
  const url = new URL(databaseUrl());
  console.error(
    [
      `检测到 DATABASE_URL，当前指向 ${url.host}${url.pathname}。`,
      "PostgreSQL 请用 pg_dump，本脚本只负责 PGlite 的数据目录：",
      "",
      `  pg_dump --format=custom --file=backups/${stamp}.dump "${databaseUrl().replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@")}"`,
      `  pg_restore --clean --if-exists --dbname="<目标库>" "backups/${stamp}.dump"`,
      "",
      "PDF 目录仍然可以直接复制：storage/pdfs 与数据库无耦合。",
    ].join("\n"),
  );
  process.exit(2);
}

const dataDir = resolve(pgliteDataDir());

const COUNTED_TABLES = [
  "users",
  "accounts",
  "papers",
  "comments",
  "comment_likes",
  "favorites",
  "reading_progress",
  "notifications",
  "reports",
  "account_tokens",
  "banned_words",
];

async function listFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, base)));
    else if (entry.isFile()) files.push(relative(base, full).replace(/\\/g, "/"));
  }
  return files;
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** 逐个文件记录大小与校验和：恢复时要靠它判断备份是否完整。 */
async function describeTree(root) {
  const files = await listFiles(root);
  const manifest = {};
  let bytes = 0;
  for (const file of files) {
    const full = join(root, file);
    const info = await stat(full);
    bytes += info.size;
    manifest[file] = { size: info.size, sha256: await digest(full) };
  }
  return { files: manifest, count: files.length, bytes };
}

const listening = await fetch("http://127.0.0.1:3100/login")
  .then(() => true)
  .catch(() => false);
if (listening) {
  console.error(
    "3100 端口有服务在运行，数据库目录可能正在被写入。先停掉服务再备份（npm run dev 或 npm start）。",
  );
  process.exit(2);
}

console.log(`数据目录：${dataDir}`);
console.log(`PDF 目录：${storageDir}`);
console.log(`备份目标：${backupRoot}`);

// 表计数在停服状态下直接读一次，便于恢复后对照。
const client = await openRawClient();
const counts = {};
for (const table of COUNTED_TABLES) {
  try {
    const result = await client.query(`select count(*)::int as n from "${table}"`);
    counts[table] = result.rows[0].n;
  } catch {
    counts[table] = null;
  }
}
await client.close();

await mkdir(backupRoot, { recursive: true });
await cp(dataDir, join(backupRoot, "pgdata"), { recursive: true });
await cp(storageDir, join(backupRoot, "pdfs"), { recursive: true });

const manifest = {
  createdAt: new Date().toISOString(),
  source: { pgliteDataDir: dataDir, storageDir },
  counts,
  pgdata: await describeTree(join(backupRoot, "pgdata")),
  pdfs: await describeTree(join(backupRoot, "pdfs")),
};
await writeFile(join(backupRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`\n已备份 ${manifest.pgdata.count} 个数据库文件 / ${manifest.pdfs.count} 个 PDF`);
console.log(`清单：${join(backupRoot, "manifest.json")}`);
console.log("行数：", Object.entries(counts).map(([table, n]) => `${table}=${n}`).join(" "));
