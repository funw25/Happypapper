import { NextResponse } from "next/server";
import { z } from "zod";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { AccountError, resetPassword } from "@/lib/auth/account";

const bodySchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1).max(200),
});

/** 用邮件里的令牌重设密码（AUTH-006）。令牌一次性，成功后同用户其它重置令牌作废。 */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "链接无效或密码格式不正确");

    await resetPassword(parsed.data.token, parsed.data.password);
    return NextResponse.json({ ok: true, detail: "密码已更新，请用新密码登录" });
  } catch (error) {
    if (error instanceof AccountError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}
