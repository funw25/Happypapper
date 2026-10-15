import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { AccountError, loginMethods, unlinkGithub } from "@/lib/auth/account";

/** 当前可用的登录方式，账号安全页据此决定解绑按钮是否可用（AUTH-012）。 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    const methods = await loginMethods(user.id);
    return NextResponse.json({ methods });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

/**
 * 解绑 GitHub。账号必须保留至少一种可登录方式：只绑定 GitHub 且没有本地密码时
 * 返回 409 并提示先设置密码，而不是把账号变成无法登录的孤岛。
 */
export async function POST() {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    await unlinkGithub(user.id);
    const methods = await loginMethods(user.id);
    return NextResponse.json({ ok: true, methods, detail: "已解绑 GitHub" });
  } catch (error) {
    if (error instanceof AccountError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}
