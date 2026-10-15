import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { MAX_AVATAR_BYTES, saveAvatar } from "@/lib/avatars";

/**
 * 头像上传（docs/03-requirements.md 第 5.2 节）。表单字段固定为 `avatar`，
 * 类型与大小都在服务端按文件头判断，不信任文件名与请求里的 content-type。
 */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const form = await request.formData().catch(() => null);
    const file = form?.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      return jsonError("NO_FILE", 400, "请选择图片文件");
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return jsonError("TOO_LARGE", 413, "头像不能超过 2MB");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = await saveAvatar(user.id, bytes);
    return NextResponse.json({ image, detail: "头像已更新" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNSUPPORTED_TYPE") {
      return jsonError("UNSUPPORTED_TYPE", 400, "只支持 PNG、JPEG、WebP 或 GIF 图片");
    }
    if (message === "TOO_LARGE") return jsonError("TOO_LARGE", 413, "头像不能超过 2MB");
    if (message === "EMPTY_FILE") return jsonError("NO_FILE", 400, "文件是空的");
    return errorFromUnknown(error);
  }
}
