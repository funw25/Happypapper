import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

export type ByteRange = { start: number; end: number };

export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}

/**
 * 本机磁盘适配器（部署时替换为对象存储）。
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

const globalForStorage = globalThis as unknown as { __hpStorage?: StorageAdapter };

export const storage: StorageAdapter = globalForStorage.__hpStorage ?? new LocalDiskStorage();

if (process.env.NODE_ENV !== "production") {
  globalForStorage.__hpStorage = storage;
}
