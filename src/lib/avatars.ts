import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storage } from "@/lib/storage";

/**
 * 头像上传（docs/03-requirements.md 第 5.2 节：头像可编辑）。
 *
 * 头像与 PDF 共用同一个 StorageAdapter，因此本机磁盘与对象存储两种驱动都能用。
 * 对外只暴露 `/api/avatars/<key>`：桶通常是私有的，直链需要额外的公开读配置或签名
 * URL，而头像很小，由应用代理一次更简单，也让两种驱动的行为完全一致。
 */
export const AVATAR_PREFIX = "avatars/";
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** 对外地址：`/api/avatars/<文件>`；对象键在此基础上加 `avatars/` 前缀。 */
export function avatarUrlFor(fileName: string): string {
  return `/api/avatars/${fileName}`;
}

/** 从 `/api/avatars/<文件>` 还原对象键；不是本站头像地址时返回 null。 */
export function avatarKeyFromUrl(url: string): string | null {
  const prefix = "/api/avatars/";
  if (!url.startsWith(prefix)) return null;
  const fileName = url.slice(prefix.length);
  if (!fileName || fileName.includes("/") || fileName.includes("..")) return null;
  return `${AVATAR_PREFIX}${fileName}`;
}

const MAGIC: { ext: string; contentType: string; match: (bytes: Uint8Array) => boolean }[] = [
  {
    ext: "png",
    contentType: "image/png",
    match: (bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  },
  {
    ext: "jpg",
    contentType: "image/jpeg",
    match: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    ext: "webp",
    contentType: "image/webp",
    match: (bytes) =>
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
  },
  {
    ext: "gif",
    contentType: "image/gif",
    match: (bytes) => bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46,
  },
];

/**
 * 按文件头判断类型，不看文件名也不看请求里的 content-type：两者都由客户端提供，
 * 冒充一个 .png 后缀就能把任意内容塞进存储并让浏览器按图片解释。
 */
export function detectImageType(
  bytes: Uint8Array,
): { ext: string; contentType: string } | null {
  for (const candidate of MAGIC) {
    if (candidate.match(bytes)) return { ext: candidate.ext, contentType: candidate.contentType };
  }
  return null;
}

export function isAvatarKey(key: string): boolean {
  return (
    key.startsWith(AVATAR_PREFIX) &&
    !key.includes("..") &&
    !key.includes("\\") &&
    !key.slice(AVATAR_PREFIX.length).includes("/")
  );
}

/**
 * 对象键带时间戳：头像地址变了但内容可能同名，浏览器与 CDN 会拿缓存里的旧图；
 * 换键即换地址，旧对象顺手删掉，不会越攒越多。
 */
export async function saveAvatar(userId: string, bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength === 0) throw new Error("EMPTY_FILE");
  if (bytes.byteLength > MAX_AVATAR_BYTES) throw new Error("TOO_LARGE");

  const type = detectImageType(bytes);
  if (!type) throw new Error("UNSUPPORTED_TYPE");

  const [current] = await db
    .select({ image: users.image })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const fileName = `${userId}-${Date.now()}.${type.ext}`;
  const key = `${AVATAR_PREFIX}${fileName}`;
  await storage.put(key, bytes, { contentType: type.contentType });
  await db.update(users).set({ image: avatarUrlFor(fileName) }).where(eq(users.id, userId));

  const previous = current?.image;
  if (previous) {
    const previousKey = avatarKeyFromUrl(previous);
    // 只删自己名下的旧头像：键里包含用户 id，避免误删别人的对象。
    if (previousKey?.startsWith(`${AVATAR_PREFIX}${userId}-`)) {
      await storage.delete(previousKey).catch(() => {});
    }
  }

  return avatarUrlFor(fileName);
}
