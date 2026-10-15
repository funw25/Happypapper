import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { jsonError } from "@/lib/api";
import {
  GITHUB_LINK_COOKIE,
  GITHUB_LINK_STATE_TTL_SECONDS,
  githubCallbackUrl,
  githubCredentials,
  githubEnabled,
} from "@/lib/auth/github";

/**
 * 把 GitHub 身份绑定到当前账号（docs/03-requirements.md AUTH-011）。
 *
 * 为什么自己走一遍 OAuth 而不是用 Auth.js 的登录流程：Auth.js 不支持「把身份绑到
 * 当前已登录的账号」，它的 OAuth 回调只会按 provider_account_id 或邮箱解析出一个
 * 用户并登录，遇到邮箱冲突时直接报 OAuthAccountNotLinked。绑定与登录是两件事，
 * 因此绑定用独立的 state 与回调，写的是同一张 accounts 表；绑好之后 GitHub 登录
 * 依然由 Auth.js 正常解析到该账号。
 *
 * state 与用户 id 一起放进 HttpOnly cookie：回调时既要 state 匹配，也要发起绑定
 * 的人就是当前登录的人，避免他人诱导的账号串联。
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

  if (!githubEnabled()) {
    return jsonError(
      "GITHUB_NOT_CONFIGURED",
      503,
      "本站还没有配置 GitHub OAuth 应用，绑定功能暂不可用",
    );
  }

  const credentials = githubCredentials();
  const state = randomBytes(16).toString("base64url");
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", credentials!.id);
  authorize.searchParams.set("redirect_uri", githubCallbackUrl());
  // 只读取公开资料与邮箱，绑定不需要仓库权限。
  authorize.searchParams.set("scope", "read:user user:email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "false");

  const response = NextResponse.redirect(authorize.toString());
  response.cookies.set(GITHUB_LINK_COOKIE, `${state}.${user.id}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: GITHUB_LINK_STATE_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
