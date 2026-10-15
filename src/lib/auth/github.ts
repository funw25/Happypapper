import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { fallbackEmail, uniqueDisplayName } from "@/lib/auth/naming";
import { appUrl } from "@/lib/mailer";

/**
 * GitHub OAuth is registered only when both variables are present, so a checkout
 * without credentials keeps working exactly as before instead of offering a
 * button that cannot complete. The names follow the Auth.js v5 convention.
 */
export function githubCredentials(): { id: string; secret: string } | null {
  const id = process.env.AUTH_GITHUB_ID?.trim();
  const secret = process.env.AUTH_GITHUB_SECRET?.trim();
  if (!id || !secret) return null;
  return { id, secret };
}

export function githubEnabled(): boolean {
  return githubCredentials() !== null;
}

/**
 * 端点基址。默认 github.com；`GITHUB_BASE_URL` 指向 GitHub Enterprise（或验证用
 * 的本地假提供方）时，授权、换令牌与用户信息三个地址随之改变。
 *
 * 登录与绑定两条链路共用它：Auth.js 的 GitHub provider 走内置的 `enterprise.baseUrl`
 * 选项，自建的绑定流程直接读这里的地址，否则两者会一个连 github.com、一个连别处。
 */
export function githubBaseUrl(): string {
  const configured = process.env.GITHUB_BASE_URL?.trim();
  return (configured || "https://github.com").replace(/\/$/, "");
}

export function githubApiBaseUrl(): string {
  const base = githubBaseUrl();
  return base === "https://github.com" ? "https://api.github.com" : `${base}/api/v3`;
}

export type GithubEndpoints = { authorize: string; token: string; user: string };

export function githubEndpoints(): GithubEndpoints {
  const base = githubBaseUrl();
  return {
    authorize: `${base}/login/oauth/authorize`,
    token: `${base}/login/oauth/access_token`,
    user: `${githubApiBaseUrl()}/user`,
  };
}

/** Auth.js 的 GitHub provider 配置：非 github.com 时改用 enterprise 基址。 */
export function githubProviderOptions(): {
  clientId: string;
  clientSecret: string;
  enterprise?: { baseUrl: string };
} {
  const credentials = githubCredentials();
  const base = githubBaseUrl();
  return {
    clientId: credentials!.id,
    clientSecret: credentials!.secret,
    ...(base === "https://github.com" ? {} : { enterprise: { baseUrl: base } }),
  };
}

/**
 * 绑定 GitHub 用的 state cookie（AUTH-011）。放在这里而不是路由文件里：Next 的
 * 路由只允许导出 HTTP 处理方法，回调路由与发起路由要共用这两个常量。
 */
export const GITHUB_LINK_COOKIE = "hp_github_link";
export const GITHUB_LINK_STATE_TTL_SECONDS = 600;

export function githubCallbackUrl(): string {
  return `${appUrl()}/api/me/github/callback`;
}

/** A GitHub profile cannot be inserted as-is: this table requires a unique
 *  display name and a non-null email, and GitHub guarantees neither. */
export async function resolveGithubIdentity(profile: {
  id: number | string;
  login?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}): Promise<{ id: string; name: string; email: string; image: string | null }> {
  const login = profile.login?.trim() || `github${profile.id}`;
  const email = profile.email?.trim() || fallbackEmail(login);

  const name = await uniqueDisplayName(profile.name?.trim() || login, async (candidate) => {
    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.name, candidate))
      .limit(1);
    return taken.length > 0;
  });

  return {
    id: String(profile.id),
    name,
    email,
    image: profile.avatar_url ?? null,
  };
}
