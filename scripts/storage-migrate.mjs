/**
 * 把本机磁盘上的 PDF 复制到对象存储（docs/02-roadmap.md B3 的切换步骤）。
 *
 *   npm run storage:migrate
 *
 * 为什么需要它：`pdf_path` 存的是对象键，不含驱动信息。把 STORAGE_DRIVER 从 local
 * 切到 s3 之后，库里的键指向的正是这个桶里的对象——原来的文件不会自己跟过去。少了
 * 这一步，页面显示「可在线阅读」，点开却是 404。
 *
 * 幂等：已存在且大小相同的对象跳过；大小不同则重传并在末尾列出。
 *
 * 需要 S3_BUCKET 与（自建端点的）S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY。
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const sourceDir = resolve(process.env.STORAGE_DIR ?? "./storage/pdfs");
const bucket = process.env.S3_BUCKET?.trim();
if (!bucket) {
  console.error("S3_BUCKET 未配置，无法确定目标桶。");
  process.exit(2);
}

const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
const forcePathStyleEnv = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase();

const client = new S3Client({
  region: process.env.S3_REGION?.trim() || "us-east-1",
  endpoint,
  forcePathStyle: forcePathStyleEnv ? forcePathStyleEnv === "true" : Boolean(endpoint),
  ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
});

console.log(`源目录：${sourceDir}`);
console.log(`目标桶：${bucket}${endpoint ? `（${endpoint}）` : ""}`);

const entries = (await readdir(sourceDir, { withFileTypes: true })).filter((entry) => entry.isFile());
if (entries.length === 0) {
  console.log("源目录里没有文件，无需迁移。");
  process.exit(0);
}

let uploaded = 0;
let skipped = 0;
const replaced = [];

for (const entry of entries) {
  const full = join(sourceDir, entry.name);
  const local = await stat(full);

  let remoteSize = null;
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: entry.name }));
    remoteSize = head.ContentLength ?? null;
  } catch {
    remoteSize = null;
  }

  if (remoteSize === local.size) {
    skipped += 1;
    continue;
  }
  if (remoteSize !== null) replaced.push(`${entry.name}（${remoteSize} → ${local.size} 字节）`);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: entry.name,
      Body: await readFile(full),
      ContentType: "application/pdf",
    }),
  );
  uploaded += 1;
  console.log(`已上传 ${entry.name}（${local.size} 字节）`);
}

console.log(`\n新上传 ${uploaded} 个，跳过（大小相同）${skipped} 个，共 ${entries.length} 个`);
if (replaced.length > 0) {
  console.log(`覆盖了大小不同的同名对象：\n  ${replaced.join("\n  ")}`);
}
console.log("\n迁移完成后可直接切换 STORAGE_DRIVER=s3 启动，无需改动数据库。");
