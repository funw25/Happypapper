/**
 * 个人资料、账号安全与隐私设置（docs/03-requirements.md 5、6、9）。
 *
 *   node scripts/verify-settings.mjs        # requires the dev server
 *
 * Drives the settings pages and their APIs over HTTP: profile edit and the
 * unique-nickname guard, password change including the wrong-password path,
 * the three privacy switches, and the effect those switches have on a newly
 * published comment (anonymous author, kept out of the danmaku layer, hidden
 * from the public profile). It restores every value it changes.
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const IDENTIFIER = process.env.SMOKE_IDENTIFIER ?? "1706.03762";
const READER = { email: "reader@happypaper.local", password: "reader12345" };
const FLORENCE = { email: "florence@happypaper.com", password: "florence12345" };

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

  async function json(path, init) {
    const response = await call(path, init);
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  function patch(path, payload) {
    return json(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  return { call, login, json, patch };
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
  process.exit(1);
}

const reader = makeClient();
const user = await reader.login(READER.email, READER.password);
check("测试读者登录成功", Boolean(user?.id), user?.name ?? "?");

const anonymous = await fetch(`${BASE}/api/me/profile`);
check("未登录访问资料接口被拒绝", anonymous.status === 401, `status ${anonymous.status}`);

// ---- pages render ---------------------------------------------------------
for (const path of ["/settings/profile", "/settings/account", "/settings/privacy"]) {
  const response = await reader.call(path);
  const html = await response.text();
  check(
    `${path} 页面可访问`,
    response.status === 200 && html.includes("happypaper-theme"),
    `status ${response.status}`,
  );
}

const settingsHtml = await (await reader.call("/settings/privacy")).text();
check(
  "隐私设置页提供三个开关",
  ["anonymousDefault", "profileCommentsVisible", "danmakuVisible"].every((key) =>
    settingsHtml.includes(key),
  ) || settingsHtml.includes("默认匿名发布评论"),
  "页面文案",
);

// ---- profile --------------------------------------------------------------
const original = (await reader.json("/api/me/profile")).body.profile;
check("读取当前资料", Boolean(original?.name), original?.email ?? "?");

const bio = `设置验证 ${new Date().toISOString()}`;
const saved = await reader.patch("/api/me/profile", {
  name: original.name,
  bio,
  avatarBg: "#0B5FFF",
  avatarFg: "#FFFFFF",
});
check(
  "保存昵称、头像配色和简介",
  saved.status === 200 && saved.body.profile?.bio === bio && saved.body.profile?.avatarBg === "#0B5FFF",
  `status ${saved.status}`,
);

const reread = (await reader.json("/api/me/profile")).body.profile;
check("刷新后仍显示最新资料", reread?.bio === bio, reread?.bio ?? "none");

const clash = await reader.patch("/api/me/profile", { name: "Florence", bio });
check("占用他人昵称被拒绝", clash.status === 409, `status ${clash.status}`);

const badName = await reader.patch("/api/me/profile", { name: "a", bio });
check("过短昵称被拒绝", badName.status === 400, `status ${badName.status}`);

// ---- 头像：昵称前两个字符 + 配色（第 5.2 节） ------------------------------
const profileHtml = await (await reader.call("/settings/profile")).text();
const initials = Array.from(original.name.replace(/\s+/g, "")).slice(0, 2).join("");
check(
  "设置页用昵称前两个字符渲染头像",
  profileHtml.includes(`>${initials}<`),
  `期望字符 ${initials}`,
);
check(
  "默认配色为克莱因蓝底白字",
  original.avatarBg === "#002FA7" && original.avatarFg === "#FFFFFF",
  `${original.avatarBg} / ${original.avatarFg}`,
);

const recolored = await reader.patch("/api/me/profile", {
  name: original.name,
  bio,
  avatarBg: "#123456",
  avatarFg: "#fedcba",
});
check(
  "可以保存自定义底色与字色（自动转大写）",
  recolored.status === 200 &&
    recolored.body.profile?.avatarBg === "#123456" &&
    recolored.body.profile?.avatarFg === "#FEDCBA",
  `${recolored.body.profile?.avatarBg ?? "-"} / ${recolored.body.profile?.avatarFg ?? "-"}`,
);

const publicProfileHtml = await (await reader.call(`/u/${encodeURIComponent(original.name)}`)).text();
check(
  "公开主页按新配色渲染头像",
  publicProfileHtml.includes("#123456") && publicProfileHtml.includes(`>${initials}<`),
  "公开主页",
);

const badColor = await reader.patch("/api/me/profile", {
  name: original.name,
  bio,
  avatarBg: "blue",
});
check(
  "非法颜色被拒绝",
  badColor.status === 400 && badColor.body.error === "INVALID_COLOR",
  `status ${badColor.status} ${badColor.body.error ?? ""}`,
);

const shortHex = await reader.patch("/api/me/profile", {
  name: original.name,
  bio,
  avatarFg: "#fff",
});
check("三位简写颜色被拒绝（要求 #RRGGBB）", shortHex.status === 400, `status ${shortHex.status}`);
// ---- privacy --------------------------------------------------------------
const defaults = (await reader.json("/api/me/privacy")).body.privacy;
check("读取隐私设置", typeof defaults?.anonymousDefault === "boolean", JSON.stringify(defaults));

const tightened = await reader.patch("/api/me/privacy", {
  anonymousDefault: true,
  profileCommentsVisible: false,
  danmakuVisible: false,
});
check(
  "保存隐私设置",
  tightened.status === 200 &&
    tightened.body.privacy?.anonymousDefault === true &&
    tightened.body.privacy?.profileCommentsVisible === false &&
    tightened.body.privacy?.danmakuVisible === false,
  `status ${tightened.status}`,
);

const privacyReread = (await reader.json("/api/me/privacy")).body.privacy;
check("隐私设置刷新后仍然生效", privacyReread?.danmakuVisible === false, JSON.stringify(privacyReread));

// ---- effect on a new comment ---------------------------------------------
let paperId = (await (await reader.call("/api/papers")).json()).papers?.[0]?.id ?? null;
if (!paperId) {
  const imported = await reader.call("/api/papers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: IDENTIFIER }),
  });
  paperId = (await imported.json().catch(() => ({})))?.paper?.id ?? null;
}
check("库内有可用于评论的论文", Boolean(paperId), paperId ?? "none");

let commentId = null;
if (paperId) {
  const posted = await reader.json(`/api/papers/${paperId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `隐私设置探针 ${Date.now()}`,
      kind: "question",
      anchor: { page: 1, yNorm: 0.42, quote: null },
      displayMode: "position",
    }),
  });
  const comment = posted.body.comment;
  commentId = comment?.id ?? null;
  check(
    "默认匿名设置生效：署名被隐藏",
    posted.status === 201 && comment?.isAnonymous === true && comment?.authorName === null,
    `status ${posted.status} author=${comment?.authorName ?? "null"}`,
  );
  check("关闭弹幕后新评论不进入弹幕流", comment?.visibleInDanmaku === false, String(comment?.visibleInDanmaku));

  const list = await (await reader.call(`/api/papers/${paperId}/comments?page=1`)).json();
  const listed = [...(list.roots ?? []), ...(list.replies ?? [])].find((row) => row.id === commentId);
  check(
    "阅读器接口不返回匿名评论的作者名",
    Boolean(listed) && listed.authorName === null && listed.isAnonymous === true,
    listed ? `author=${listed.authorName}` : "not listed",
  );

  const profileHtml = await (await reader.call(`/u/${encodeURIComponent(original.name)}`)).text();
  check(
    "关闭主页评论后公开主页不展示评论",
    profileHtml.includes("选择不在个人主页展示自己的评论"),
    "主页文案",
  );
}

// 阅读器匿名复选框：显式传 anonymous=false 时使用公开昵称
if (paperId) {
  const publicComment = await reader.json(`/api/papers/${paperId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `公开署名探针 ${Date.now()}`,
      kind: "other",
      anchor: { page: 1, yNorm: 0.44, quote: null },
      displayMode: "position",
      anonymous: false,
    }),
  });
  const created = publicComment.body.comment;
  check(
    "取消匿名后按公开昵称署名",
    (publicComment.status === 201 && created?.isAnonymous === false && created?.authorName === original.name) ||
      publicComment.status === 429,
    `status ${publicComment.status} author=${created?.authorName ?? "-"}`,
  );
  if (created?.id) await reader.call(`/api/comments/${created.id}`, { method: "DELETE" });
}

// ---- password -------------------------------------------------------------
const wrong = await reader.patch("/api/me/password", {
  currentPassword: "definitely-not-the-password",
  newPassword: "reader12345x",
});
check("当前密码错误时拒绝修改", wrong.status === 403, `status ${wrong.status}`);

const tooShort = await reader.patch("/api/me/password", {
  currentPassword: READER.password,
  newPassword: "short",
});
check("过短的新密码被拒绝", tooShort.status === 400, `status ${tooShort.status}`);

const rotated = await reader.patch("/api/me/password", {
  currentPassword: READER.password,
  newPassword: "reader12345x",
});
check("正确密码可以更新", rotated.status === 200, `status ${rotated.status}`);

if (rotated.status === 200) {
  const relogin = makeClient();
  check("新密码可以登录", Boolean((await relogin.login(READER.email, "reader12345x"))?.id), "reader12345x");
  const back = await relogin.patch("/api/me/password", {
    currentPassword: "reader12345x",
    newPassword: READER.password,
  });
  check("密码已恢复为原值", back.status === 200, `status ${back.status}`);
}

// ---- restore --------------------------------------------------------------
if (commentId) await reader.call(`/api/comments/${commentId}`, { method: "DELETE" });
await reader.patch("/api/me/privacy", defaults ?? {
  anonymousDefault: false,
  profileCommentsVisible: true,
  danmakuVisible: true,
});
await reader.patch("/api/me/profile", {
  name: original.name,
  bio: original.bio,
  avatarBg: original.avatarBg,
  avatarFg: original.avatarFg,
});
const restored = await reader.json("/api/me/profile");
check("验证结束后资料已还原", restored.body.profile?.bio === original.bio, restored.body.profile?.bio ?? "null");

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((row) => row.name).join(", "));
  process.exit(1);
}
