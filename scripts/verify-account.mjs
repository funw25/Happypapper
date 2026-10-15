/**
 * 账号闭环（docs/03-requirements.md AUTH-006、AUTH-007、AUTH-011 至 AUTH-013）。
 *
 *   node scripts/verify-account.mjs       # requires the dev server
 *
 * 覆盖邮箱验证、修改邮箱、密码找回与解绑保护。邮件通道尚未配置，`src/lib/mailer.ts`
 * 把链接写入开发服务器日志，因此这里从日志里取令牌——走的是真实链路，没有为测试
 * 加旁路；配置 SMTP 后脚本改为从邮箱取链接，其余断言不变。
 *
 * 全过程用一个临时账号，不动种子账号的状态。退出码：0 通过，1 失败，2 无法判定
 * （服务器不可达，或日志里找不到刚发出的令牌）。
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const DEV_LOG = resolve(process.env.DEV_LOG ?? ".next/dev/logs/next-development.log");
const STAMP = Date.now();
const ACCOUNT = {
  email: `account-${STAMP}@happypaper.local`,
  name: `account${String(STAMP).slice(-6)}`,
  password: "verify12345",
};
const NEW_EMAIL = `account-${STAMP}-moved@happypaper.local`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function makeClient() {
  const jar = new Map();
  function remember(response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  async function call(path, init = {}) {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers ?? {}),
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    remember(response);
    return response;
  }
  async function json(path, init) {
    const response = await call(path, init);
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  async function login(email, password) {
    const { csrfToken } = await (await call("/api/auth/csrf")).json();
    await call("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE }),
    });
    const session = await (await call("/api/auth/session")).json();
    return session?.user ?? null;
  }
  return { call, json, login };
}

/**
 * 日志是多个请求共用的追加文件：只认「本次请求之后」写入的那一段，否则会拿到上一
 * 次运行留下的令牌，出现「验证成功了但验证的不是这个账号」这种假通过。
 */
function logMark() {
  try {
    return statSync(DEV_LOG).size;
  } catch {
    return 0;
  }
}

function tokenFromLog(pathFragment, mark) {
  let text = "";
  try {
    // 按字节切片：mark 来自 statSync().size（字节），而字符串下标是 UTF-16 单元，
    // 日志里有中文时两者会逐渐错位，最终切到新内容之后而漏掉刚发出的链接。
    text = readFileSync(DEV_LOG).subarray(mark).toString("utf8");
  } catch {
    return null;
  }
  const pattern = new RegExp(`${pathFragment.replace(/\//g, "\\/")}\\?token=([A-Za-z0-9_-]+)`, "g");
  const matches = [...text.matchAll(pattern)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

/** 日志写入是异步的：发出邮件后要等它落盘，不能读完一次就判定失败。 */
async function waitForToken(pathFragment, mark, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const token = tokenFromLog(pathFragment, mark);
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return null;
}

function postJson(client, path, payload, method = "POST") {
  return client.json(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(2);
}

// ---- 页面可访问 ------------------------------------------------------------
for (const path of ["/forgot-password", "/reset-password", "/verify-email"]) {
  const response = await fetch(`${BASE}${path}`);
  check(`${path} 页面可访问`, response.status === 200, `status ${response.status}`);
}

// ---- 账号安全页展示绑定与邮箱状态（AUTH-011 至 AUTH-013） -------------------
const client = makeClient();
const registered = await postJson(client, "/api/register", {
  email: ACCOUNT.email,
  name: ACCOUNT.name,
  password: ACCOUNT.password,
});
check("临时账号注册成功", registered.status === 201, `status ${registered.status}`);
const session = await client.login(ACCOUNT.email, ACCOUNT.password);
check("临时账号可以登录", Boolean(session?.id), session?.name ?? "?");

const accountPage = await (await client.call("/settings/account")).text();
check(
  "账号安全页包含邮箱验证、修改邮箱与 GitHub 绑定入口",
  accountPage.includes("发送验证邮件") &&
    accountPage.includes("修改邮箱") &&
    accountPage.includes("GitHub 账号") &&
    accountPage.includes("绑定 GitHub"),
  "page markup",
);

const methods = await client.json("/api/me/github/unlink");
check(
  "登录方式接口报告密码可用、GitHub 未绑定",
  methods.status === 200 &&
    methods.body.methods?.hasPassword === true &&
    methods.body.methods?.githubLogin === null &&
    methods.body.methods?.count === 1,
  JSON.stringify(methods.body.methods ?? null),
);

// ---- 邮箱验证（AUTH-007） --------------------------------------------------
const verifyMark = logMark();
const sent = await postJson(client, "/api/me/email", {}, "POST");
check("可以给当前邮箱发送验证邮件", sent.status === 200 && sent.body.sent === true, `status ${sent.status}`);

const verifyToken = await waitForToken("verify-email", verifyMark);
check("邮件链接带着一次性令牌写入日志", Boolean(verifyToken), verifyToken ? `${verifyToken.slice(0, 8)}…` : "none");

if (verifyToken) {
  const confirmed = await postJson(client, "/api/auth/verify-email", { token: verifyToken });
  check(
    "验证令牌确认邮箱",
    confirmed.status === 200 && confirmed.body.kind === "verified",
    `status ${confirmed.status} kind=${confirmed.body.kind ?? "-"}`,
  );
  const reused = await postJson(client, "/api/auth/verify-email", { token: verifyToken });
  check("同一个验证令牌不能重复使用", reused.status === 400, `status ${reused.status}`);

  const profile = await client.json("/api/me/profile");
  check("资料接口显示邮箱已验证", profile.body.profile?.emailVerified === true, String(profile.body.profile?.emailVerified));
} else {
  process.exit(2);
}

// ---- 修改邮箱（AUTH-007、PROFILE-008） -------------------------------------
const taken = await postJson(client, "/api/me/email", { email: "florence@happypaper.com" }, "PATCH");
check("改成他人已占用的邮箱被拒绝", taken.status === 409, `status ${taken.status} ${taken.body.error ?? ""}`);

const changeMark = logMark();
const changed = await postJson(client, "/api/me/email", { email: NEW_EMAIL }, "PATCH");
check(
  "修改邮箱先进入待确认状态",
  changed.status === 200 && changed.body.pendingEmail === NEW_EMAIL,
  `status ${changed.status} pending=${changed.body.pendingEmail ?? "-"}`,
);

const changeToken = await waitForToken("verify-email", changeMark);
const applied = changeToken
  ? await postJson(client, "/api/auth/verify-email", { token: changeToken })
  : { status: 0, body: {} };
check(
  "确认后新邮箱生效",
  applied.status === 200 && applied.body.kind === "changed" && applied.body.email === NEW_EMAIL,
  `status ${applied.status} kind=${applied.body.kind ?? "-"}`,
);

const afterChange = await client.json("/api/me/profile");
check(
  "资料接口显示新邮箱且已验证",
  afterChange.body.profile?.email === NEW_EMAIL && afterChange.body.profile?.emailVerified === true,
  `${afterChange.body.profile?.email ?? "-"}`,
);

const oldLogin = makeClient();
check(
  "旧邮箱不再能登录",
  (await oldLogin.login(ACCOUNT.email, ACCOUNT.password)) === null,
  "旧地址已失效",
);
const newLogin = makeClient();
check(
  "新邮箱可以登录",
  Boolean((await newLogin.login(NEW_EMAIL, ACCOUNT.password))?.id),
  NEW_EMAIL,
);

// ---- 解绑保护（AUTH-012） --------------------------------------------------
const notLinked = await newLogin.json("/api/me/github/unlink", { method: "POST" });
check(
  "未绑定时解绑被拒绝且说明原因",
  notLinked.status === 400 && notLinked.body.error === "NOT_LINKED",
  `status ${notLinked.status} ${notLinked.body.error ?? ""}`,
);

const anonymousUnlink = await fetch(`${BASE}/api/me/github/unlink`, { method: "POST" });
check("未登录不能解绑", anonymousUnlink.status === 401, `status ${anonymousUnlink.status}`);

const anonymousConnect = await fetch(`${BASE}/api/me/github/connect`, { redirect: "manual" });
check("未登录不能发起 GitHub 绑定", anonymousConnect.status === 401, `status ${anonymousConnect.status}`);

// 绑定发起：未配置 OAuth 时说明不可用；配置了（含用假凭据做的接线验证）时检查
// 授权跳转的参数与 state cookie（AUTH-011）。
const connect = await newLogin.call("/api/me/github/connect");
if (connect.status === 503) {
  const body = await connect.json().catch(() => ({}));
  check(
    "未配置 OAuth 时明确说明绑定不可用",
    body.error === "GITHUB_NOT_CONFIGURED",
    `status 503 ${body.error ?? "-"}`,
  );
} else if (connect.status === 307 || connect.status === 302) {
  const location = new URL(connect.headers.get("location"));
  const cookie = (connect.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("hp_github_link="));
  check(
    "绑定跳转到 GitHub 授权页并带上 client_id",
    location.origin === "https://github.com" && Boolean(location.searchParams.get("client_id")),
    `${location.host}${location.pathname}`,
  );
  check(
    "绑定回调指向自建回调地址",
    (location.searchParams.get("redirect_uri") ?? "").endsWith("/api/me/github/callback"),
    location.searchParams.get("redirect_uri") ?? "-",
  );
  check(
    "绑定请求带 state 与只读 scope",
    Boolean(location.searchParams.get("state")) &&
      (location.searchParams.get("scope") ?? "").includes("read:user"),
    location.searchParams.get("scope") ?? "-",
  );
  check(
    "state 与用户 id 写入 HttpOnly cookie",
    Boolean(cookie) && /httponly/i.test(cookie),
    cookie ? "cookie set" : "no cookie",
  );

  // 上一步的 connect 已经在这个会话里留下 state cookie，因此这里命中的是
  // 「state 不匹配」；再用一个不带 cookie 的会话验证「没有 state」。
  const badCallback = await newLogin.call("/api/me/github/callback?code=x&state=y");
  check(
    "回调 state 不匹配时回到账号页并说明原因",
    badCallback.status === 307 &&
      (badCallback.headers.get("location") ?? "").includes("github=error") &&
      (badCallback.headers.get("location") ?? "").includes("reason=state_mismatch"),
    (badCallback.headers.get("location") ?? "-").replace(BASE, ""),
  );

  const freshClient = makeClient();
  await freshClient.login(NEW_EMAIL, ACCOUNT.password);
  const noCookieCallback = await freshClient.call("/api/me/github/callback?code=x&state=y");
  check(
    "回调缺少 state cookie 时拒绝并说明原因",
    noCookieCallback.status === 307 &&
      (noCookieCallback.headers.get("location") ?? "").includes("reason=state_missing"),
    (noCookieCallback.headers.get("location") ?? "-").replace(BASE, ""),
  );
} else {
  check("绑定发起返回预期状态", false, `status ${connect.status}`);
}

// ---- 密码找回（AUTH-006） --------------------------------------------------
// 接口按来源地址限流（5 次/15 分钟）：同机 15 分钟内重复运行会命中，届时这一
// 段不判定，按项目惯例以退出码 2 结束，而不是报成回归。
let resetInconclusive = false;

const unknown = await postJson(makeClient(), "/api/auth/forgot-password", {
  email: `nobody-${STAMP}@happypaper.local`,
});
if (unknown.status === 429) {
  resetInconclusive = true;
} else {
  check(
    "未注册的邮箱申请找回也返回同样的响应（不枚举用户）",
    unknown.status === 200 && unknown.body.ok === true,
    `status ${unknown.status}`,
  );
}

const resetMark = logMark();
const forget = resetInconclusive
  ? { status: 0, body: {} }
  : await postJson(makeClient(), "/api/auth/forgot-password", { email: NEW_EMAIL });
if (forget.status === 429) resetInconclusive = true;
if (!resetInconclusive) {
  check("已注册邮箱可以申请找回", forget.status === 200, `status ${forget.status}`);
}

const resetToken = resetInconclusive ? null : await waitForToken("reset-password", resetMark);
if (!resetInconclusive) {
  check("重置链接带着一次性令牌写入日志", Boolean(resetToken), resetToken ? `${resetToken.slice(0, 8)}…` : "none");
}

if (!resetInconclusive && resetToken) {
  const weak = await postJson(makeClient(), "/api/auth/reset-password", { token: resetToken, password: "short" });
  check("过短的新密码被拒绝", weak.status === 400, `status ${weak.status} ${weak.body.error ?? ""}`);

  const reset = await postJson(makeClient(), "/api/auth/reset-password", {
    token: resetToken,
    password: "verify54321",
  });
  check("可以凭令牌重设密码", reset.status === 200, `status ${reset.status} ${reset.body.detail ?? ""}`);

  const resetAgain = await postJson(makeClient(), "/api/auth/reset-password", {
    token: resetToken,
    password: "verify99999",
  });
  check("同一个重置令牌不能重复使用", resetAgain.status === 400, `status ${resetAgain.status} ${resetAgain.body.error ?? ""}`);

  const rotated = makeClient();
  check("新密码可以登录", Boolean((await rotated.login(NEW_EMAIL, "verify54321"))?.id), "verify54321");
  const staleLogin = makeClient();
  check("旧密码不再能登录", (await staleLogin.login(NEW_EMAIL, ACCOUNT.password)) === null, "旧密码已失效");
}

// ---- 限流（放在最后：触发后同一来源的申请会被拒） --------------------------
let limitedAt = null;
for (let index = 0; index < 8; index++) {
  const probe = await postJson(makeClient(), "/api/auth/forgot-password", {
    email: `probe-${STAMP}-${index}@happypaper.local`,
  });
  if (probe.status === 429) {
    limitedAt = index + 1;
    break;
  }
}
check("找回密码接口有频率限制", limitedAt !== null, limitedAt ? `第 ${limitedAt} 次返回 429` : "8 次未触发");

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((row) => row.name).join(", "));
}
if (resetInconclusive) {
  console.log(
    "\n找回密码接口按来源地址限流（5 次/15 分钟），本次运行开始时额度已被同一台机器的" +
      "上一次运行用掉，密码找回部分未判定。等额度恢复后重跑。",
  );
  process.exit(2);
}
process.exit(failed.length === 0 ? 0 : 1);
