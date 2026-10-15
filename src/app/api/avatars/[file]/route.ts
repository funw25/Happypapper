import { storage } from "@/lib/storage";
import { AVATAR_PREFIX, isAvatarKey } from "@/lib/avatars";

/**
 * 头像读取。对象键里带时间戳，内容不会原地变化，因此可以长期缓存。
 * 只服务 `avatars/` 前缀下的对象：存储适配器同时放着论文 PDF，不能让它当通用文件服务。
 */
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const objectKey = `${AVATAR_PREFIX}${decodeURIComponent(file)}`;

  if (!isAvatarKey(objectKey)) {
    return new Response("Not found", { status: 404 });
  }

  const info = await storage.stat(objectKey);
  if (!info) return new Response("Not found", { status: 404 });

  const extension = objectKey.split(".").pop()?.toLowerCase() ?? "";
  const stream = await storage.getStream(objectKey);
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "content-length": String(info.size),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
