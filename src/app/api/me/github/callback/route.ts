import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { currentUser } from "@/lib/session";
import {
  GITHUB_LINK_COOKIE,
  githubCallbackUrl,
  githubCredentials,
  githubEndpoints,
} from "@/lib/auth/github";
import { findGithubOwner } from "@/lib/auth/account";
import { appUrl } from "@/lib/mailer";

/**
 * GitHub 绑定的回调（AUTH-011）。校验顺序：登录状态 → state 与用户 id → 换取
 * access token → 读取 GitHub 身份 → 该身份未被其他账号占用 → 写入 accounts。
 *
 * 失败一律回到账号安全页并带上原因码，而不是留在 GitHub 的错误页或返回空响应：
 * 读者需要知道「取消授权」与「这个 GitHub 已绑定别的账号」是两回事。
 */
function back(reason: string, ok = false) {
  const url = new URL(`${appUrl()}/settings/account`);
  url.searchParams.set("github", ok ? "linked" : "error");
  if (!ok) url.searchParams.set("reason", reason);
  const response = NextResponse.redirect(url.toString());
  response.cookies.delete(GITHUB_LINK_COOKIE);
  return response;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return back("unauthorized");

  const credentials = githubCredentials();
  if (!credentials) return back("not_configured");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("cancelled");

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GITHUB_LINK_COOKIE}=`))
    ?.slice(GITHUB_LINK_COOKIE.length + 1);
  if (!cookie) return back("state_missing");

  const separator = cookie.lastIndexOf(".");
  const expectedState = separator > 0 ? cookie.slice(0, separator) : "";
  const startedBy = separator > 0 ? cookie.slice(separator + 1) : "";
  if (expectedState !== state || startedBy !== user.id) return back("state_mismatch");

  const endpoints = githubEndpoints();

  const tokenResponse = await fetch(endpoints.token, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    // 按 OAuth 规范用表单编码：GitHub 两种都接受，但这就是 Auth.js 与其他客户端
    // 发的东西，验证用的假提供方也按这个契约实现。
    body: new URLSearchParams({
      client_id: credentials.id,
      client_secret: credentials.secret,
      code,
      redirect_uri: githubCallbackUrl(),
    }),
  }).catch(() => null);
  if (!tokenResponse?.ok) return back("token_exchange_failed");

  const tokenBody = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
  } | null;
  if (!tokenBody?.access_token) return back("token_exchange_failed");

  const profileResponse = await fetch(endpoints.user, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${tokenBody.access_token}`,
      "user-agent": "HappyPaper/0.1",
    },
  }).catch(() => null);
  if (!profileResponse?.ok) return back("profile_fetch_failed");

  const profile = (await profileResponse.json().catch(() => null)) as {
    id?: number;
    login?: string;
  } | null;
  if (!profile?.id) return back("profile_fetch_failed");

  const providerAccountId = String(profile.id);
  const owner = await findGithubOwner(providerAccountId);
  if (owner && owner !== user.id) return back("already_linked");

  if (!owner) {
    await db.insert(accounts).values({
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId,
      access_token: tokenBody.access_token,
      token_type: tokenBody.token_type ?? "bearer",
      scope: tokenBody.scope ?? null,
    });
  }

  return back("", true);
}
