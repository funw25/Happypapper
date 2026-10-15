/**
 * 本地假 GitHub OAuth 提供方，用于验证登录与绑定两条链路。
 *
 *   npm run github:fake           # 前台运行，默认 127.0.0.1:4569
 *
 * 为什么需要它：真实 OAuth 握手需要别人给的 client id / secret，而握手之后的代码
 * （state 校验、换令牌、读取身份、首次登录建号、绑定写入、解绑保护）全在本地。用
 * 一个实现同样 HTTP 契约的假提供方，可以把这些路径端到端跑通，而不是只读代码。
 *
 * 实现的端点（与 GitHub Enterprise 的路径一致，因此走 `GITHUB_BASE_URL` 即可切换）：
 *   GET  /login/oauth/authorize        → 302 回 redirect_uri，带 code 与 state
 *   POST /login/oauth/access_token     → 返回 access_token
 *   GET  /api/v3/user                  → 返回固定身份
 *   GET  /api/v3/user/emails           → 公开邮箱缺失时 Auth.js 会来取
 *
 * 身份用查询参数 `identity` 选择（默认 alice），三个身份供不同用例区分：
 *   alice  —— 有邮箱与昵称，用于首次登录建号
 *   bob    —— 有邮箱，昵称与已有用户重名，用于验证昵称去重
 *   carol  —— 无公开邮箱、无昵称，用于验证回落规则
 */
import { createServer } from "node:http";

const port = Number(process.env.FAKE_GITHUB_PORT ?? "4569");
const host = process.env.FAKE_GITHUB_HOST ?? "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

const IDENTITIES = {
  alice: { id: 100001, login: "alice-gh", name: "Alice GitHub", email: "alice@github.example" },
  bob: { id: 100002, login: "bob-gh", name: "reader", email: "bob@github.example" },
  carol: { id: 100003, login: "carol-gh", name: null, email: null },
  dave: { id: 100004, login: "dave-gh", name: "Dave GitHub", email: "dave@github.example" },
};

/** 下一次授权使用的身份；由 `POST /__identity` 设置，避免依赖浏览器 cookie 隔离。 */
let pendingIdentity = process.env.FAKE_GITHUB_IDENTITY ?? "alice";

function pickIdentity(request, url) {
  const cookies = request.headers.cookie ?? "";
  const fromCookie = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("fake_github_identity="))
    ?.split("=")[1];
  return fromCookie ?? url.searchParams.get("identity") ?? pendingIdentity;
}

/** code → identity，token → identity；两者都是进程内的临时映射。 */
const codes = new Map();
const tokens = new Map();

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, baseUrl);
  console.log(`${request.method} ${url.pathname}${url.search}`);

  // 控制端点：验证脚本用它指定「下一次授权用哪个身份」。cookie 在不同浏览器上下文
  // 之间的隔离并不总是可靠，把身份切换放在提供方这一侧就没有歧义。
  if (url.pathname === "/__identity") {
    if (request.method === "POST") {
      const raw = await readBody(request);
      const parsed = JSON.parse(raw || "{}");
      if (!IDENTITIES[parsed.identity]) {
        json(response, 400, { error: `unknown identity ${parsed.identity}` });
        return;
      }
      pendingIdentity = parsed.identity;
    }
    json(response, 200, { identity: pendingIdentity, identities: Object.keys(IDENTITIES) });
    return;
  }

  if (url.pathname === "/login/oauth/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") ?? "";
    const identityName = pickIdentity(request, url);
    console.log(`  身份：${identityName}`);
    if (!redirectUri) {
      json(response, 400, { error: "missing redirect_uri" });
      return;
    }
    if (!IDENTITIES[identityName]) {
      json(response, 400, { error: `unknown identity ${identityName}` });
      return;
    }

    const code = `code-${identityName}-${Math.random().toString(36).slice(2, 10)}`;
    codes.set(code, identityName);
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    response.writeHead(302, { location: target.toString() });
    response.end();
    return;
  }

  if (url.pathname === "/login/oauth/access_token") {
    const raw = await readBody(request);
    const params = new URLSearchParams(raw);
    const code = params.get("code") ?? url.searchParams.get("code") ?? "";
    const identityName = codes.get(code);
    if (!identityName) {
      json(response, 200, { error: "bad_verification_code" });
      return;
    }
    codes.delete(code);
    const token = `token-${identityName}-${Math.random().toString(36).slice(2, 10)}`;
    tokens.set(token, identityName);
    json(response, 200, {
      access_token: token,
      token_type: "bearer",
      scope: params.get("scope") ?? "read:user user:email",
    });
    return;
  }

  if (url.pathname === "/api/v3/user" || url.pathname === "/api/v3/user/emails") {
    const authorization = request.headers.authorization ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const identityName = tokens.get(token);
    if (!identityName) {
      json(response, 401, { message: "Bad credentials" });
      return;
    }
    const identity = IDENTITIES[identityName];

    if (url.pathname.endsWith("/emails")) {
      json(
        response,
        200,
        identity.email
          ? [{ email: identity.email, primary: true, verified: true }]
          : [{ email: `${identity.login}@users.noreply.github.example`, primary: true, verified: true }],
      );
      return;
    }

    json(response, 200, {
      id: identity.id,
      login: identity.login,
      name: identity.name,
      email: identity.email,
      avatar_url: `${baseUrl}/avatars/${identity.login}.png`,
    });
    return;
  }

  json(response, 404, { message: "Not Found" });
});

server.listen(port, host, () => {
  console.log(`假 GitHub 提供方已启动：${baseUrl}`);
  console.log("\n重启应用时设置：");
  console.log(`  $env:GITHUB_BASE_URL = "${baseUrl}"`);
  console.log(`  $env:AUTH_GITHUB_ID = "fake-client-id"`);
  console.log(`  $env:AUTH_GITHUB_SECRET = "fake-client-secret"`);
  console.log(`\n可用身份：${Object.keys(IDENTITIES).join(", ")}`);
});
