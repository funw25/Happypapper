import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import {
  SettingsError,
  getAccountSettings,
  normaliseAvatarUrl,
  updateProfile,
} from "@/lib/me/settings";

const bodySchema = z.object({
  name: z.string().min(1).max(24),
  avatarUrl: z.string().max(500).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
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
      avatarUrl: normaliseAvatarUrl(parsed.data.avatarUrl),
      bio: parsed.data.bio ?? null,
    });
    return NextResponse.json({ profile: saved });
  } catch (error) {
    if (error instanceof SettingsError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
