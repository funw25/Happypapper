import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIdentity, errorFromUnknown, jsonError } from "@/lib/api";
import { consume } from "@/lib/rate-limit";
import { requestPasswordReset } from "@/lib/auth/account";

const bodySchema = z.object({ email: z.string().min(3).max(254) });

/**
 * 忘记密码（AUTH-006）。无论邮箱是否存在都返回同一条响应：响应差异会变成站点
 * 用户枚举接口。限流按来源地址计，避免用这个接口批量探测或刷邮件。
 */
export async function POST(request: Request) {
  try {
    const decision = consume(`forgot:${clientIdentity(request, null)}`, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", detail: `请求过于频繁，请 ${decision.retryAfterSeconds} 秒后再试` },
        { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "请填写邮箱地址");

    await requestPasswordReset(parsed.data.email);
    return NextResponse.json({
      ok: true,
      detail: "如果该邮箱在我们的记录里，重置链接已经发出。",
    });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
