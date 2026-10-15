import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export type ByteRange = { start: number; end: number };

export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}

/**
 * 存储驱动（docs/02-roadmap.md B3）。
 *
 * - `local`：本机磁盘，路径由 `STORAGE_DIR` 决定，开发与验证的默认值。
 * - `s3`：任意 S3 兼容对象存储（AWS S3、Cloudflare R2、MinIO、阿里云 OSS 的
 *   S3 兼容端点）。生产用这个：PDF 放在能独立扩容与备份的地方，不跟应用进程绑在
 *   一起。
 *
 * 选择规则：`STORAGE_DRIVER` 显式指定优先；否则配置了 `S3_BUCKET` 就用 s3，没有
 * 就用 local。规则与数据库那边的 `DATABASE_URL` 一致：环境变量在，就走托管后端。
 */
export type StorageDriver = "local" | "s3";

export function storageDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "s3") return "s3";
  if (explicit === "local") return "local";
  return process.env.S3_BUCKET?.trim() ? "s3" : "local";
}

/**
 * 本机磁盘适配器。
 *
 * 路径由 `STORAGE_DIR` 决定，因此对 Turbopack 来说它是动态的：不做标注时静态分析
 * 会认为整个项目都可能被读取，从而把全部源码与 public 目录一起追踪进构建产物。
 * `turbopackIgnore` 注释是 Turbopack 为此提供的出口，只关掉「追踪整个项目」这一条
 * 推断，不改变运行时的真实路径。
 */
function rootDir() {
  return resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "./storage/pdfs");
}

function safePath(key: string) {
  const root = rootDir();
  const full = resolve(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, key));
  // 前缀比较要带分隔符：否则 `storage/pdfs-other` 会被当成根目录内部。
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`storage key escapes root: ${key}`);
  }
  return full;
}

class LocalDiskStorage implements StorageAdapter {
  async put(key: string, data: Uint8Array) {
    const target = safePath(key);
    await mkdir(/* turbopackIgnore: true */ dirname(target), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ target, data);
  }

  async getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const target = safePath(key);
    if (!existsSync(/* turbopackIgnore: true */ target)) {
      throw new Error(`storage object not found: ${key}`);
    }
    const nodeStream = createReadStream(
      /* turbopackIgnore: true */ target,
      range ? { start: range.start, end: range.end } : {},
    );
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async stat(key: string) {
    const target = safePath(key);
    try {
      const info = await stat(/* turbopackIgnore: true */ target);
      return { size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(/* turbopackIgnore: true */ safePath(key), { force: true });
  }
}

type S3Config = {
  bucket: string;
  client: S3Client;
};

function s3Config(): S3Config {
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET 未配置：STORAGE_DRIVER=s3 时需要它");
  }

  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const forcePathStyleEnv = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase();

  return {
    bucket,
    client: new S3Client({
      region: process.env.S3_REGION?.trim() || "us-east-1",
      endpoint,
      // 自建端点（MinIO 等）几乎都要 path-style；AWS 用 virtual-hosted。
      forcePathStyle: forcePathStyleEnv ? forcePathStyleEnv === "true" : Boolean(endpoint),
      // 没给静态密钥时走 SDK 默认链（环境变量、实例角色、SSO 等）。
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    }),
  };
}

class S3Storage implements StorageAdapter {
  private config: S3Config | null = null;

  private s3(): S3Config {
    // 延迟到第一次使用再建客户端：`next build` 会导入路由模块，那时不该连存储。
    this.config ??= s3Config();
    return this.config;
  }

  async put(key: string, data: Uint8Array) {
    const { bucket, client } = this.s3();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: "application/pdf",
      }),
    );
  }

  async getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const { bucket, client } = this.s3();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    const body = response.Body;
    if (!body) throw new Error(`storage object not found: ${key}`);
    // Node 下 Body 是 Readable；SDK 提供 transformToWebStream，未提供时退回 toWeb。
    if (typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function") {
      return (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
    }
    return Readable.toWeb(body as Readable) as ReadableStream<Uint8Array>;
  }

  async stat(key: string) {
    const { bucket, client } = this.s3();
    try {
      const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const size = response.ContentLength;
      return typeof size === "number" ? { size } : null;
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "NotFound" || name === "NoSuchKey" || name === "404") return null;
      throw error;
    }
  }

  async delete(key: string) {
    const { bucket, client } = this.s3();
    // S3 的删除是幂等的：对象不存在也返回成功，与本地适配器的 rm --force 一致。
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

const globalForStorage = globalThis as unknown as {
  __hpStorage?: StorageAdapter;
  __hpStorageLogged?: boolean;
};

function createStorage(): StorageAdapter {
  return storageDriver() === "s3" ? new S3Storage() : new LocalDiskStorage();
}

export const storage: StorageAdapter = globalForStorage.__hpStorage ?? createStorage();

if (!globalForStorage.__hpStorage) {
  globalForStorage.__hpStorage = storage;
  if (!globalForStorage.__hpStorageLogged) {
    globalForStorage.__hpStorageLogged = true;
    // 一行启动日志：验证脚本与运维靠它确认这次跑的是哪个驱动，而不是靠猜。
    const driver = storageDriver();
    console.log(
      driver === "s3"
        ? `[storage] driver=s3 bucket=${process.env.S3_BUCKET} endpoint=${process.env.S3_ENDPOINT ?? "aws"}`
        : `[storage] driver=local dir=${resolve(process.env.STORAGE_DIR ?? "./storage/pdfs")}`,
    );
  }
}
