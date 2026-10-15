import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { clientIdentity, errorFromUnknown, jsonError } from "@/lib/api";
import { consume } from "@/lib/rate-limit";
import {
  AccountError,
  cancelEmailChange,
  requestEmailChange,
  sendEmailVerification,
} from "@/lib/auth/account";

const changeSchema = z.object({ email: z.string().min(3).max(254) });

/** 给自己当前地址重发验证邮件。已验证的地址默认不重发，`force` 用于换邮箱前的自检。 */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const decision = consume(`verify-mail:${clientIdentity(request, user.id)}`, {
      limit: 3,
      windowMs: 15 * 60 * 1000,
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "RATE_LIMITED", detail: `发送过于频繁，请 ${decision.retryAfterSeconds} 秒后再试` },
        { status: 429, headers: { "retry-after": String(decision.retryAfterSeconds) } },
      );
    }

    const body = (await request.json().catch(() => null)) as { force?: unknown } | null;
    const sent = await sendEmailVerification(user.id, body?.force === true);
    return NextResponse.json({
      ok: true,
      sent,
      detail: sent ? "验证链接已发出" : "当前邮箱已经验证过，无需重复发送",
    });
  } catch (error) {
    if (error instanceof AccountError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}

/** 修改邮箱：新地址先进入待验证状态，确认后旧地址才失效（AUTH-007、PROFILE-008）。 */
export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = changeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "请填写新的邮箱地址");

    const pending = await requestEmailChange(user.id, parsed.data.email);
    return NextResponse.json({
      ok: true,
      pendingEmail: pending,
      detail: `确认链接已发到 ${pending}，在链接被打开前旧邮箱仍然有效`,
    });
  } catch (error) {
    if (error instanceof AccountError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}

/** 取消尚未确认的邮箱修改。 */
export async function DELETE() {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    await cancelEmailChange(user.id);
    return NextResponse.json({ ok: true, detail: "已取消邮箱修改" });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
