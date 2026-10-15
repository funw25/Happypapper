import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import {
  SettingsError,
  getPrivacySettings,
  updatePrivacySettings,
} from "@/lib/me/settings";

const bodySchema = z
  .object({
    anonymousDefault: z.boolean().optional(),
    profileCommentsVisible: z.boolean().optional(),
    danmakuVisible: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "没有需要保存的设置" });

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    const settings = await getPrivacySettings(user.id);
    if (!settings) return jsonError("NOT_FOUND", 404, "账号不存在");
    return NextResponse.json({ privacy: settings });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "设置项无效");

    const saved = await updatePrivacySettings(user.id, parsed.data);
    return NextResponse.json({ privacy: saved });
  } catch (error) {
    if (error instanceof SettingsError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
