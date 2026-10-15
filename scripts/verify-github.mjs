/**
 * GitHub login wiring (docs/03-requirements.md AUTH-008 to AUTH-010).
 *
 *   node scripts/verify-github.mjs        # requires the dev server
 *
 * Exit codes: 0 the wiring is verified, 1 a check failed, 2 the OAuth app
 * credentials are absent, so the feature is correctly switched off but the
 * GitHub handshake itself is unverified. The distinction matters: a green run
 * here must never be read as "GitHub login works".
 *
 * What this can prove without credentials: the provider is registered, the
 * sign-in endpoint redirects to GitHub with the configured client id, and the
 * login page offers the button. What it cannot prove without a real GitHub
 * account and a browser: the callback, the token exchange, and the account row
 * created on first login.
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";

// Imported directly: this rule is what makes a GitHub display name fit a unique
// not-null column, so it is worth checking even when GitHub is switched off.
import { fallbackEmail, uniqueDisplayName } from "../src/lib/auth/naming.ts";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("failed:", failed.map((f) => f.name).join(", "));
  }
  return failed;
}

// Auth.js binds the CSRF token to a cookie, so the token fetched from
// /api/auth/csrf is only accepted by a request that carries that cookie back.
const jar = new Map();
async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: {
      ...(init.headers ?? {}),
      cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    },
  });
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return response;
}

try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(2);
}

const providers = await (await fetch(`${BASE}/api/auth/providers`)).json().catch(() => ({}));
const hasGithub = Boolean(providers?.github);

const loginHtml = await (await fetch(`${BASE}/login`)).text();
const buttonShown = loginHtml.includes("data-github-signin");

check("密码登录仍然注册", Boolean(providers?.credentials), providers?.credentials ? "present" : "missing");

// ------------------------------------------------- first-login identity rules
const free = await uniqueDisplayName("Alice", () => false);
check("昵称未被占用时保持原样", free === "Alice", free);

const taken = new Set(["Alice", "Alice-2"]);
const deduped = await uniqueDisplayName("Alice", (candidate) => taken.has(candidate));
check("昵称被占用时自动加后缀", deduped === "Alice-3", deduped);

const blank = await uniqueDisplayName("   ", () => false);
check("昵称为空时回落到默认名", blank === "reader", blank);

const longBase = "n".repeat(80);
const long = await uniqueDisplayName(longBase, () => false);
check("昵称长度被截断到列宽内", long.length <= 40 && long.startsWith("n"), `${long.length} 字符`);

const exhausted = await uniqueDisplayName("Alice", () => true);
check(
  "所有编号候选被占用时仍返回可用昵称",
  exhausted.startsWith("Alice-") && exhausted.length <= 40 && exhausted !== "Alice-2",
  exhausted,
);

check(
  "GitHub 不返回邮箱时回落到 noreply 地址",
  fallbackEmail("octocat") === "octocat@users.noreply.github.com" &&
    fallbackEmail("") === "user@users.noreply.github.com",
  fallbackEmail("octocat"),
);

if (!hasGithub) {
  check("未配置凭据时不注册 GitHub provider", !hasGithub, "providers 不含 github");
  check("未配置凭据时不显示 GitHub 按钮", !buttonShown, "登录页无按钮");
  summarize();
  console.log(
    "\nAUTH-008 未验证：没有 AUTH_GITHUB_ID / AUTH_GITHUB_SECRET，GitHub 登录被正确关闭。" +
      "放入真实凭据后重跑本脚本才能得到结论；此退出码 2 表示待定，不是通过也不是回归。",
  );
  process.exit(2);
}

check("已配置凭据时注册 GitHub provider", hasGithub, String(providers.github?.id ?? "github"));
check("登录页显示 GitHub 按钮", buttonShown, buttonShown ? "data-github-signin" : "missing");

const { csrfToken } = await (await call("/api/auth/csrf")).json();
const signinResponse = await call("/api/auth/signin/github", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ csrfToken, callbackUrl: BASE }),
});
const location = signinResponse.headers.get("location") ?? "";
const body = location ? "" : await signinResponse.text();
const authorizeUrl = location || (body.match(/https:\/\/github\.com\/login\/oauth\/authorize[^"'\s]*/) ?? [""])[0];

check(
  "发起登录会跳转到 GitHub 授权页",
  authorizeUrl.startsWith("https://github.com/login/oauth/authorize"),
  authorizeUrl ? authorizeUrl.slice(0, 80) + "…" : `status ${signinResponse.status}`,
);
check(
  "授权地址带 client_id",
  authorizeUrl.includes("client_id=") && !authorizeUrl.includes("client_id=&"),
  authorizeUrl.match(/client_id=([^&]*)/)?.[1]?.slice(0, 8) ?? "missing",
);
check(
  "授权地址的回调指向本应用",
  decodeURIComponent(authorizeUrl).includes("/api/auth/callback/github"),
  decodeURIComponent(authorizeUrl).match(/redirect_uri=([^&]*)/)?.[1] ?? "missing",
);
// Auth.js v5 secures the authorization request with PKCE rather than a `state`
// parameter: it sends code_challenge and stores the verifier in a cookie.
check(
  "授权地址使用 PKCE",
  authorizeUrl.includes("code_challenge=") && authorizeUrl.includes("code_challenge_method=S256"),
  authorizeUrl.includes("code_challenge_method=S256") ? "S256" : "missing",
);
check(
  "授权流程下发 PKCE 与 CSRF cookie",
  jar.has("authjs.pkce.code_verifier") && jar.has("authjs.csrf-token"),
  [...jar.keys()].filter((k) => k.startsWith("authjs.")).join(", ") || "none",
);

const failed = summarize();
console.log(
  "\n注意：OAuth 回调、token 交换与首次登录建号需要真实 GitHub 账号与浏览器，本脚本不覆盖。",
);
process.exit(failed.length === 0 ? 0 : 1);
