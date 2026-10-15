import { NextResponse } from "next/server";
import { z } from "zod";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { AccountError, confirmEmailToken } from "@/lib/auth/account";

const bodySchema = z.object({ token: z.string().min(10).max(200) });

/**
 * 确认邮箱令牌（AUTH-007）。做成 POST 而不是让邮件里的链接直接生效：邮件网关与
 * 安全扫描器会预取链接，GET 生效会让令牌在用户点开前就被用掉。
 */
export async function POST(request: Request) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "链接无效");

    const confirmed = await confirmEmailToken(parsed.data.token);
    return NextResponse.json({
      ok: true,
      kind: confirmed.kind,
      email: confirmed.email,
      detail:
        confirmed.kind === "changed"
          ? `邮箱已改为 ${confirmed.email}`
          : `${confirmed.email} 已完成验证`,
    });
  } catch (error) {
    if (error instanceof AccountError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}
