/**
 * 从备份恢复数据库与 PDF 存储。
 *
 *   node scripts/db-restore.mjs --from backups/2026-10-16_09-30-00            # 预演，只校验
 *   node scripts/db-restore.mjs --from backups/... --apply                    # 真正写入
 *   PGLITE_DATA_DIR=./tmp/pgdata STORAGE_DIR=./tmp/pdfs node scripts/db-restore.mjs --from ... --apply
 *
 * 默认是预演：只读取清单、核对每个文件的大小与校验和、打印将写入的位置与行数，不
 * 改动任何现有数据。真正写入需要显式 `--apply`，且目标目录非空时还要 `--force`：
 * 恢复会覆盖当前数据库，误触的代价是丢掉最近的评论与论文。
 *
 * 覆盖前会把现有目录改名成 `<目录>.before-restore-<时间戳>` 而不是删除，恢复错了还
 * 能退回去。
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const from = argValue("--from");
const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

if (!from) {
  console.error("用法：node scripts/db-restore.mjs --from <备份目录> [--apply] [--force]");
  process.exit(2);
}

const backupDir = resolve(from);
const manifestPath = join(backupDir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`备份目录里没有 manifest.json：${backupDir}`);
  process.exit(2);
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const dataDir = resolve(process.env.PGLITE_DATA_DIR ?? manifest.source.pgliteDataDir);
const storageDir = resolve(process.env.STORAGE_DIR ?? manifest.source.storageDir);

console.log(`备份时间：${manifest.createdAt}`);
console.log(`数据库目标：${dataDir}`);
console.log(`PDF 目标：${storageDir}`);
console.log(`模式：${apply ? "写入" : "预演（只校验，不改动数据）"}`);

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** 核对备份内容与清单：文件缺失、大小或校验和不符都算备份损坏。 */
async function verifyTree(root, tree, label) {
  const problems = [];
  for (const [file, expected] of Object.entries(tree.files)) {
    const full = join(root, file);
    if (!existsSync(full)) {
      problems.push(`${file} 缺失`);
      continue;
    }
    const info = await stat(full);
    if (info.size !== expected.size) {
      problems.push(`${file} 大小 ${info.size} != ${expected.size}`);
      continue;
    }
    if ((await digest(full)) !== expected.sha256) problems.push(`${file} 校验和不符`);
  }
  console.log(
    `${label}：${Object.keys(tree.files).length} 个文件，${problems.length === 0 ? "校验通过" : `${problems.length} 个问题`}`,
  );
  return problems;
}

const problems = [
  ...(await verifyTree(join(backupDir, "pgdata"), manifest.pgdata, "数据库")),
  ...(await verifyTree(join(backupDir, "pdfs"), manifest.pdfs, "PDF")),
];
if (problems.length > 0) {
  console.error(`\n备份不完整，已停止：\n  ${problems.slice(0, 10).join("\n  ")}`);
  process.exit(1);
}

console.log("\n行数（来自清单）：", Object.entries(manifest.counts).map(([t, n]) => `${t}=${n}`).join(" "));

if (!apply) {
  console.log("\n预演结束。确认无误后加 --apply 写入，目标非空时再加 --force。");
  process.exit(0);
}

const listening = await fetch("http://127.0.0.1:3100/login")
  .then(() => true)
  .catch(() => false);
if (listening) {
  console.error("3100 端口有服务在运行，先停掉服务再恢复。");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

for (const [target, source] of [
  [dataDir, join(backupDir, "pgdata")],
  [storageDir, join(backupDir, "pdfs")],
]) {
  if (existsSync(target)) {
    const existing = await readdir(target);
    if (existing.length > 0 && !force) {
      console.error(`${target} 已存在且非空。确认要覆盖时加 --force。`);
      process.exit(2);
    }
    const moved = `${target}.before-restore-${stamp}`;
    await rename(target, moved);
    console.log(`原目录已保留为 ${moved}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  console.log(`已恢复 ${target}`);
}

console.log("\n恢复完成。用 npm run dev 启动并检查数据即可；恢复错了就把 .before-restore-<时间戳> 改回原目录名。");
