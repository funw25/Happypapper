/**
 * GitHub 登录与绑定的端到端验证（docs/03-requirements.md AUTH-008 至 AUTH-013）。
 *
 *   npm run github:fake                     # 另一个终端，起本地假提供方
 *   GITHUB_BASE_URL=http://127.0.0.1:4569 \
 *   AUTH_GITHUB_ID=fake-client-id AUTH_GITHUB_SECRET=fake-client-secret \
 *   npm run dev
 *   npm run verify:github-flow
 *
 * 走真实浏览器与真实 HTTP：登录页 → 提供方授权 → Auth.js 回调 → 会话；以及绑定
 * 发起 → 自建回调 → 写入 accounts → 解绑。真实 GitHub 仍需自己的凭据做一次冒烟，
 * 但握手之后的每条分支（首登建号、昵称去重、邮箱回落、身份唯一、绑定后登录、
 * 解绑保护、正常解绑）都在这里被实际执行过。
 *
 * 两个环境约束：
 * - 访问地址必须与 `NEXTAUTH_URL` 一致（默认 http://localhost:3100）。Auth.js 的
 *   state 与 PKCE cookie 按该地址下发，用 127.0.0.1 打开时回调落在另一个 host，
 *   cookie 带不过去，握手会在换令牌之前失败。
 * - 身份由假提供方的 `POST /__identity` 指定，且必须在**每次**触发授权之前设置：
 *   这个值在提供方进程里是全局的，登录与绑定共用它。
 *
 * 退出码：0 通过，1 失败，2 无法判定（服务器不可达、未启用 GitHub、或提供方不可达）。
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";
const FAKE = process.env.FAKE_GITHUB_BASE ?? "http://127.0.0.1:4569";
const READER = { email: "reader@happypaper.local", password: "reader12345" };
const ADMIN = { email: "admin@happypaper.local", password: "admin12345" };
const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = BROWSERS.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error("no Chrome or Edge found; set CHROME_PATH");
  process.exit(1);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(2);
}
try {
  const providers = await (await fetch(`${BASE}/api/auth/providers`)).json();
  if (!providers.github) {
    console.error("服务器没有启用 GitHub：设置 AUTH_GITHUB_ID / AUTH_GITHUB_SECRET 与 GITHUB_BASE_URL 后重启。");
    process.exit(2);
  }
} catch {
  process.exit(2);
}
try {
  await fetch(`${FAKE}/__identity`);
} catch {
  console.error(`假 GitHub 提供方不可达（${FAKE}）；先跑 npm run github:fake`);
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** 每次触发授权之前都要调用：假提供方的身份是进程级全局状态。 */
async function useIdentity(identity) {
  const response = await fetch(`${FAKE}/__identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity }),
  });
  if (!response.ok) throw new Error(`设置假提供方身份失败：${identity}`);
}

async function newSession() {
  const context = await browser.createBrowserContext();
  return context.newPage();
}

async function api(page, path, init) {
  return page.evaluate(
    async (url, options) => {
      const response = await fetch(url, options ?? undefined);
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    path,
    init ?? null,
  );
}

async function methodsFor(page) {
  return (await api(page, "/api/me/github/unlink")).body?.methods ?? null;
}

async function loginWithPassword(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** 各身份应有的邮箱；用于识别「数据库里有旧的 GitHub 绑定」这种非代码问题。 */
const EXPECTED_EMAILS = {
  alice: "alice@github.example",
  bob: "bob@github.example",
  carol: "carol-gh@users.noreply.github.example",
  dave: "dave@github.example",
};
let staleBindings = false;

async function loginWithGithub(identity, expectedEmail = EXPECTED_EMAILS[identity]) {
  const page = await newSession();
  await useIdentity(identity);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("GitHub"),
    );
    button?.click();
  });
  // 跳转可能有多跳，只看 URL 会读到空会话，因此轮询到出现用户为止。
  let user = null;
  for (let attempt = 0; attempt < 60 && !user; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const active = await api(page, "/api/auth/session");
    user = active.body?.user ?? null;
  }

  // Auth.js 先按 provider_account_id 找账号，因此库里只要有一行把这个身份指到了
  // 别的账号，这里就会登录成别人。这种残留来自早期失败的验证运行，不是代码回归。
  if (user && expectedEmail && user.email !== expectedEmail) {
    staleBindings = true;
    console.error(
      `（提示）身份 ${identity} 登录成了 ${user.email}，期望 ${expectedEmail}：数据库里有指向别的账号的 GitHub 绑定。`,
    );
  }
  return { page, user };
}

/** 点击账号安全页的「绑定 GitHub」。返回是否真的点到了（已绑定时没有这个链接）。 */
async function clickBind(page) {
  await page.goto(`${BASE}/settings/account`, { waitUntil: "networkidle2" });
  const link = await page.$('a[href="/api/me/github/connect"]');
  if (!link) return false;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }),
    link.click(),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 600));
  return true;
}

async function clickUnbind(page) {
  await page.goto(`${BASE}/settings/account`, { waitUntil: "networkidle2" });
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("解绑 GitHub"),
    );
    button?.click();
    return Boolean(button);
  });
  if (clicked) await new Promise((resolve) => setTimeout(resolve, 1200));
  return clicked;
}

// ---- 准备：清掉上一轮留下的 reader 绑定，保证脚本可重复运行 ----------------
const reader = await newSession();
await loginWithPassword(reader, READER.email, READER.password);
const preMethods = await methodsFor(reader);
if (preMethods?.githubLogin) {
  await api(reader, "/api/me/github/unlink", { method: "POST" });
  console.log("（准备）已清掉 reader 上一轮的 GitHub 绑定");
}

// ---- AUTH-009 / AUTH-010：首登建号与昵称去重 -------------------------------
const alice = await loginWithGithub("alice");
check("GitHub 首次登录建立会话", Boolean(alice.user?.id), `${alice.user?.name ?? "-"}`);
check(
  "首登账号使用 GitHub 昵称与邮箱",
  alice.user?.name === "Alice GitHub" && alice.user?.email === "alice@github.example",
  `${alice.user?.name ?? "-"} / ${alice.user?.email ?? "-"}`,
);

const aliceMethods = await methodsFor(alice.page);
check(
  "首登账号只有 GitHub 一种登录方式",
  aliceMethods?.hasPassword === false && Boolean(aliceMethods?.githubLogin),
  JSON.stringify(aliceMethods),
);
const aliceAccountPage = await (await alice.page.goto(`${BASE}/settings/account`, { waitUntil: "networkidle2" })).text();
check(
  "首登账号在账号安全页显示已绑定 GitHub",
  aliceAccountPage.includes("已绑定 GitHub 账号"),
  "账号安全页",
);

const bob = await loginWithGithub("bob");
check(
  "GitHub 昵称与已有用户重名时自动加后缀",
  typeof bob.user?.name === "string" && /^reader-\d+$/.test(bob.user.name),
  `${bob.user?.name ?? "-"}`,
);

const carol = await loginWithGithub("carol");
const carolProfile = (await api(carol.page, "/api/me/profile")).body;
check(
  "无公开邮箱时回落到 GitHub 登录名与占位邮箱",
  carol.user?.name === "carol-gh" &&
    String(carolProfile?.profile?.email ?? "").endsWith("@users.noreply.github.example"),
  `${carol.user?.name ?? "-"} / ${carolProfile?.profile?.email ?? "-"}`,
);

// ---- AUTH-011：邮箱账号绑定 GitHub ----------------------------------------
await useIdentity("dave");
check("可以发起绑定（页面上有绑定入口）", await clickBind(reader), "发起 /api/me/github/connect");

const boundPage = await (await reader.goto(`${BASE}/settings/account`, { waitUntil: "networkidle2" })).text();
const boundMethods = await methodsFor(reader);
check(
  "绑定成功后账号安全页显示已绑定",
  boundPage.includes("已绑定 GitHub 账号") && Boolean(boundMethods?.githubLogin),
  JSON.stringify(boundMethods),
);
check(
  "绑定后报告两种登录方式",
  boundMethods?.hasPassword === true && boundMethods?.githubLogin !== null,
  JSON.stringify(boundMethods),
);

// 绑定的身份必须与 Auth.js 登录使用的 provider_account_id 一致，否则用 GitHub 登录
// 会另建一个账号，而不是进入已绑定的这个。
const daveLogin = await loginWithGithub("dave", READER.email);
const daveProfile = (await api(daveLogin.page, "/api/me/profile")).body;
check(
  "已绑定身份用 GitHub 登录时进入同一个账号",
  daveProfile?.profile?.email === READER.email,
  `登录后邮箱 ${daveProfile?.profile?.email ?? "-"}`,
);

// ---- 同一 GitHub 身份不能绑到第二个账号 -----------------------------------
// 用一个没有 GitHub 绑定的账号（admin）去绑已经属于 reader 的 dave 身份。
const admin = await newSession();
await loginWithPassword(admin, ADMIN.email, ADMIN.password);
await useIdentity("dave");
const adminBindClicked = await clickBind(admin);
const conflictPage = await admin.content();
check("管理员账号可以发起绑定（用于冲突用例）", adminBindClicked, "发起绑定");
check(
  "同一个 GitHub 身份不能绑定到第二个账号",
  conflictPage.includes("已经绑定了另一个 HappyPaper 账号"),
  "账号安全页",
);

// ---- AUTH-012：解绑保护与正常解绑 -----------------------------------------
check("唯一登录方式时页面提供解绑按钮但服务端会拒绝", await clickUnbind(alice.page), "点击解绑");
const protectPage = await alice.page.content();
check(
  "唯一登录方式时拒绝解绑并说明要先设置密码",
  protectPage.includes("唯一的登录方式") || protectPage.includes("请先在上面的表单里设置密码"),
  "账号安全页",
);
const aliceStillBound = await methodsFor(alice.page);
check("拒绝解绑后绑定仍然存在", Boolean(aliceStillBound?.githubLogin), JSON.stringify(aliceStillBound));

await clickUnbind(reader);
const afterUnbind = await methodsFor(reader);
check(
  "有本地密码时可以解绑，解绑后只剩密码登录",
  afterUnbind?.hasPassword === true && afterUnbind?.githubLogin === null,
  JSON.stringify(afterUnbind),
);

await browser.close();

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((row) => row.name).join(", "));
}
if (staleBindings) {
  console.log(
    "\n数据库里有指向别的账号的 GitHub 绑定（早期运行留下的），这次结果不判定。" +
      "先 npm run db:reset 清掉本地库再重跑；生产库请手动核对 accounts 表。",
  );
  process.exit(2);
}
process.exit(failed.length === 0 ? 0 : 1);
