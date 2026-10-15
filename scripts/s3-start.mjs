/**
 * 本地起一个 S3 兼容服务端，用于验证对象存储驱动。
 *
 *   npm run s3:start       # 前台运行，Ctrl+C 停止；数据留在 .s3-dev/
 *
 * s3rver 用 Node 实现了 S3 的常用子集（PUT/GET/HEAD/DELETE、Range、路径风格），
 * 因此 `STORAGE_DRIVER=s3` 的代码可以端到端验证，而不是只靠读代码。生产不经过它：
 * 那边连的是 AWS S3、R2、MinIO 或其它兼容端点。
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import S3rver from "s3rver";

const port = Number(process.env.S3_PORT ?? "4568");
const directory = resolve(process.env.S3_DATA_DIR ?? ".s3-dev");
const bucket = process.env.S3_BUCKET ?? "happypaper-pdfs";
const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "S3RVER";
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "S3RVER";

await mkdir(directory, { recursive: true });

const server = new S3rver({
  port,
  address: "127.0.0.1",
  silent: true,
  directory,
  configureBuckets: [{ name: bucket }],
});

const { address, port: actualPort } = await server.run();

console.log(`S3 兼容服务端已启动：http://${address}:${actualPort}（桶 ${bucket}，数据目录 ${directory}）`);
console.log("\n在另一个终端里：");
console.log(`  $env:STORAGE_DRIVER = "s3"`);
console.log(`  $env:S3_BUCKET = "${bucket}"`);
console.log(`  $env:S3_ENDPOINT = "http://${address}:${actualPort}"`);
console.log(`  $env:S3_ACCESS_KEY_ID = "${accessKeyId}"`);
console.log(`  $env:S3_SECRET_ACCESS_KEY = "${secretAccessKey}"`);
console.log("  npm run dev");
console.log("\n本窗口保持运行；Ctrl+C 停止。");

async function shutdown() {
  await new Promise((done) => server.close(done));
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
