import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { SettingsError, getAccountSettings, updateProfile } from "@/lib/me/settings";

const bodySchema = z.object({
  name: z.string().min(1).max(24),
  bio: z.string().max(2000).nullable().optional(),
  // 头像配色，省略即不改动；格式在服务层统一校验。
  avatarBg: z.string().max(20).optional(),
  avatarFg: z.string().max(20).optional(),
});

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    const settings = await getAccountSettings(user.id);
    if (!settings) return jsonError("NOT_FOUND", 404, "账号不存在");
    return NextResponse.json({ profile: settings });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "昵称需要 2 到 24 个字符");

    const saved = await updateProfile(user.id, {
      name: parsed.data.name,
      bio: parsed.data.bio ?? null,
      ...(parsed.data.avatarBg === undefined ? {} : { avatarBg: parsed.data.avatarBg }),
      ...(parsed.data.avatarFg === undefined ? {} : { avatarFg: parsed.data.avatarFg }),
    });
    return NextResponse.json({ profile: saved });
  } catch (error) {
    if (error instanceof SettingsError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
