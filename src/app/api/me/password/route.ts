import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { SettingsError, changePassword } from "@/lib/me/settings";

const bodySchema = z.object({
  currentPassword: z.string().max(200).default(""),
  newPassword: z.string().min(1).max(200),
});

export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "新密码至少 8 位");

    await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SettingsError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
