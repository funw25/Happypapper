import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";

export type ByteRange = { start: number; end: number };

export interface StorageAdapter {
  put(key: string, data: Uint8Array): Promise<void>;
  getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
  stat(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
}

function rootDir() {
  return resolve(process.env.STORAGE_DIR ?? "./storage/pdfs");
}

function safePath(key: string) {
  const full = resolve(join(rootDir(), key));
  if (!full.startsWith(rootDir())) {
    throw new Error(`storage key escapes root: ${key}`);
  }
  return full;
}

class LocalDiskStorage implements StorageAdapter {
  async put(key: string, data: Uint8Array) {
    const target = safePath(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async getStream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>> {
    const target = safePath(key);
    if (!existsSync(target)) {
      throw new Error(`storage object not found: ${key}`);
    }
    const nodeStream = createReadStream(target, range ? { start: range.start, end: range.end } : {});
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  }

  async stat(key: string) {
    const target = safePath(key);
    try {
      const info = await stat(target);
      return { size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(safePath(key), { force: true });
  }
}

const globalForStorage = globalThis as unknown as { __hpStorage?: StorageAdapter };

export const storage: StorageAdapter = globalForStorage.__hpStorage ?? new LocalDiskStorage();

if (process.env.NODE_ENV !== "production") {
  globalForStorage.__hpStorage = storage;
}
