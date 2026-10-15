/**
 * End-to-end smoke test against a running dev server.
 *
 *   node scripts/smoke.mjs
 *
 * Covers the M0-M4 acceptance criteria: credential login, paper import from
 * arXiv, paper listing, PDF serving with HTTP Range, reading progress,
 * favorites, position-anchored comments, likes, replies, reports, deletion,
 * the banned-word filter, the posting rate limit, and anonymous rejection.
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const IDENTIFIER = process.env.SMOKE_IDENTIFIER ?? "1706.03762";

const QUOTE = "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms";

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

  return { call, login, jar };
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function json(response) {
  return response.json().catch(() => ({}));
}

// ---------------------------------------------------------------- phase A
const reader = makeClient();
const readerUser = await reader.login(
  process.env.SMOKE_EMAIL ?? "reader@happypaper.local",
  process.env.SMOKE_PASSWORD ?? "reader12345",
);
check("reader 登录并拿到会话", Boolean(readerUser?.id), readerUser?.name ?? "no session");

const importResponse = await reader.call("/api/papers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier: IDENTIFIER }),
});
const importBody = await json(importResponse);
const paper = importBody.paper;
check(
  `导入 ${IDENTIFIER}`,
  importResponse.ok && Boolean(paper?.id),
  importResponse.ok ? `created=${importBody.created}, ${paper?.title}` : JSON.stringify(importBody),
);

if (!paper) {
  console.log("\ncannot continue without a paper");
  process.exit(1);
}

check("元数据含作者", Array.isArray(paper.authors) && paper.authors.length > 0, `${paper.authors?.length} 位`);
check("PDF 已缓存到本站", Boolean(paper.pdfPath), paper.pdfPath ?? "");

const list = await json(await reader.call("/api/papers"));
check("列表接口返回该论文", list.papers?.some((p) => p.id === paper.id), `${list.papers?.length ?? 0} 篇`);

const fullPdf = await reader.call(`/api/papers/${paper.id}/pdf`);
const pdfBytes = new Uint8Array(await fullPdf.arrayBuffer());
check(
  "PDF 完整下载",
  fullPdf.status === 200 && new TextDecoder().decode(pdfBytes.subarray(0, 5)) === "%PDF-",
  `${fullPdf.status}, ${pdfBytes.length} bytes`,
);

const ranged = await reader.call(`/api/papers/${paper.id}/pdf`, { headers: { range: "bytes=0-1023" } });
const rangedBytes = new Uint8Array(await ranged.arrayBuffer());
check(
  "PDF Range 请求返回 206",
  ranged.status === 206 && rangedBytes.length === 1024,
  `${ranged.status}, ${rangedBytes.length} bytes, ${ranged.headers.get("content-range")}`,
);

const progressPut = await reader.call(`/api/papers/${paper.id}/progress`, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ page: 4, yNorm: 0.42, progress: 0.3 }),
});
check("保存阅读进度", progressPut.ok, `status ${progressPut.status}`);

const favoriteState = await json(await reader.call(`/api/papers/${paper.id}/favorite`));
check(
  "读回阅读进度",
  favoriteState.progress?.page === 4 && Math.abs((favoriteState.progress?.yNorm ?? 0) - 0.42) < 0.001,
  JSON.stringify(favoriteState.progress ?? null),
);

await reader.call(`/api/papers/${paper.id}/favorite`, { method: "POST" });
check("收藏生效", (await json(await reader.call(`/api/papers/${paper.id}/favorite`))).favorited === true);
await reader.call(`/api/papers/${paper.id}/favorite`, { method: "DELETE" });
check("取消收藏生效", (await json(await reader.call(`/api/papers/${paper.id}/favorite`))).favorited === false);

// ---------------------------------------------------------------- phase B
const ANCHOR = {
  page: 4,
  yNorm: 0.31,
  xNorm: 0.12,
  quote: QUOTE,
  quotePrefix: "the first sequence transduction model",
  quoteSuffix: "dispensing with recurrence and convolutions",
  charStart: 120,
  charEnd: 240,
};

const firstPost = await reader.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    content: "这里的 attention 复杂度写成了 O(n^2 d)，请确认 d 的定义。",
    kind: "question",
    displayMode: "position",
    anchor: ANCHOR,
  }),
});
const firstBody = await json(firstPost);
const comment = firstBody.comment;
check(
  "发布定位评论",
  firstPost.status === 201 && Boolean(comment?.id),
  firstPost.status === 201 ? `id=${comment.id}, page=${comment.page}` : JSON.stringify(firstBody),
);

if (!comment?.id) {
  console.log(
    firstBody?.error === "RATE_LIMITED"
      ? "\n无法继续：reader 账号的发评论配额已用完（本项目为每账号 60 秒 5 条）。\n等一分钟再跑，或 npm run db:reset 清除计数。退出码 2 表示结论待定，不是回归。"
      : "\n无法继续：reader 账号没能发布评论。",
  );
  process.exit(2);
}

const listed = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4&spread=1&kind=all&sort=time`));
const storedComment = listed.roots?.find((c) => c.id === comment?.id);
check("侧栏查询能读回该评论", Boolean(storedComment), `${listed.roots?.length ?? 0} 条 root`);
check(
  "文本引用与锚点被完整保存",
  storedComment?.quote === QUOTE &&
    storedComment?.quotePrefix === ANCHOR.quotePrefix &&
    storedComment?.quoteSuffix === ANCHOR.quoteSuffix &&
    storedComment?.charStart === 120,
  `quote=${(storedComment?.quote ?? "").slice(0, 32)}…`,
);

const likeResponse = await reader.call(`/api/comments/${comment.id}/like`, { method: "POST" });
check("点赞成功", likeResponse.ok, `status ${likeResponse.status}`);
const afterLike = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4`));
check(
  "点赞数被重算",
  afterLike.roots?.find((c) => c.id === comment.id)?.likeCount === 1 &&
    afterLike.roots?.find((c) => c.id === comment.id)?.likedByMe === true,
  `likeCount=${afterLike.roots?.find((c) => c.id === comment.id)?.likeCount}`,
);

const replyResponse = await reader.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    content: "d 是模型维度，n 是序列长度。",
    kind: "explain",
    displayMode: "position",
    parentId: comment.id,
    anchor: ANCHOR,
  }),
});
const replyBody = await json(replyResponse);
const reply = replyBody.comment;
check("发布回复", replyResponse.status === 201, `status ${replyResponse.status}, id=${reply?.id}`);
const afterReply = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4`));
check(
  "回复挂在父评论下且计数正确",
  afterReply.replies?.some((r) => r.parentId === comment.id) &&
    afterReply.roots?.find((c) => c.id === comment.id)?.replyCount === 1,
  `replies=${afterReply.replies?.length ?? 0}`,
);

// moderation paths
const admin = makeClient();
const adminUser = await admin.login("admin@happypaper.local", "admin12345");
check("admin 登录", adminUser?.role === "admin", adminUser?.role ?? "no session");

// docs/03-requirements.md section 2.3 names two administrators. They have to be
// in seed data with admin rights, not just the generic admin account.
for (const [email, password, label] of [
  ["florence@happypaper.com", "florence12345", "Florence"],
  ["alpha@happypaper.com", "alpha12345", "α"],
]) {
  const client = makeClient();
  const user = await client.login(email, password);
  const reports = user ? await client.call("/api/admin/reports?status=open") : null;
  check(
    `${label} 是管理员并可访问后台`,
    user?.role === "admin" && reports?.status === 200,
    user ? `role=${user.role}, name=${user.name}, reports=${reports?.status}` : "no session",
  );
}

const reportResponse = await admin.call(`/api/comments/${comment.id}/report`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reason: "offtopic", detail: "smoke test" }),
});
check("举报他人评论", reportResponse.status === 201, `status ${reportResponse.status}`);

const selfReport = await reader.call(`/api/comments/${comment.id}/report`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reason: "spam" }),
});
check("举报自己的评论被拒绝", selfReport.status === 400, `status ${selfReport.status}`);

const foreignDelete = await admin.call(`/api/comments/${comment.id}`, { method: "DELETE" });
check("管理员删除他人评论", foreignDelete.ok, `status ${foreignDelete.status}`);
const afterModeration = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4`));
check("被管理员删除后不再出现在侧栏", !afterModeration.roots?.some((c) => c.id === comment.id));

// a second, unrelated normal user must not be able to moderate
const suffix = Date.now().toString(36);
const other = makeClient();
const registerResponse = await other.call("/api/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `smoke-${suffix}@happypaper.local`,
    name: `smoke${suffix}`.slice(0, 24),
    password: "smoke12345",
  }),
});
check("注册新用户", registerResponse.status === 201, `status ${registerResponse.status}`);
const otherUser = await other.login(`smoke-${suffix}@happypaper.local`, "smoke12345");
check("新用户登录", Boolean(otherUser?.id), otherUser?.name ?? "no session");
const otherDelete = await other.call(`/api/comments/${reply.id}`, { method: "DELETE" });
check("非作者非管理员删除他人评论被拒绝", otherDelete.status === 403, `status ${otherDelete.status}`);

// content filters
const banned = await reader.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "加微信 代写论文", kind: "other", anchor: ANCHOR }),
});
const bannedBody = await json(banned);
check("敏感词被拦截", banned.status === 422 && bannedBody.error === "BANNED_WORD", JSON.stringify(bannedBody));

const shortContent = await reader.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "   ", kind: "other", anchor: ANCHOR }),
});
check("空内容被拒绝", shortContent.status === 400, `status ${shortContent.status}`);

const badAnchor = await reader.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "缺页码", kind: "other", anchor: { yNorm: 0.5 } }),
});
check("缺少页码的锚点被拒绝", badAnchor.status === 400, `status ${badAnchor.status}`);

// rate limit: a dedicated account, so repeated runs inside one 60s window do
// not depend on the reader account's budget.
const rlSuffix = Date.now().toString(36);
const rl = makeClient();
await rl.call("/api/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `rl-${rlSuffix}@happypaper.local`,
    name: `rl${rlSuffix}`.slice(0, 24),
    password: "ratelimit12345",
  }),
});
await rl.login(`rl-${rlSuffix}@happypaper.local`, "ratelimit12345");

let lastAccepted = 0;
for (let i = 0; i < 5; i++) {
  const response = await rl.call(`/api/papers/${paper.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `限流填充 ${i}`, kind: "other", anchor: ANCHOR }),
  });
  if (response.status === 201) lastAccepted += 1;
}
check("限流窗口内前 5 条被接受", lastAccepted === 5, `accepted=${lastAccepted}`);

const limited = await rl.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "第 6 条", kind: "other", anchor: ANCHOR }),
});
const limitedBody = await json(limited);
check(
  "60 秒内第 6 条被限流",
  limited.status === 429 && limitedBody.error === "RATE_LIMITED",
  `status ${limited.status} ${JSON.stringify(limitedBody)}`,
);

// deletion of one's own comment (the reply is still authored by reader)
const deleteResponse = await reader.call(`/api/comments/${reply.id}`, { method: "DELETE" });
check("删除自己的评论", deleteResponse.ok, `status ${deleteResponse.status}`);
const afterDelete = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4`));
check("删除后不再出现在侧栏", !afterDelete.replies?.some((c) => c.id === reply.id));
const reloaded = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4`));
check("已删除的评论不会复活", !reloaded.replies?.some((c) => c.id === reply.id));

// ---------------------------------------------------------------- phase C
const anon = makeClient();
const anonPost = await anon.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "匿名", kind: "other", anchor: ANCHOR }),
});
check("匿名发布被拒绝", anonPost.status === 401, `status ${anonPost.status}`);

const anonLike = await anon.call(`/api/comments/1/like`, { method: "POST" });
check("匿名点赞被拒绝", anonLike.status === 401, `status ${anonLike.status}`);

// ---------------------------------------------------------------- phase D
// realtime channel
async function readUntil(streamReader, predicate, timeoutMs = 10_000) {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const outcome = await Promise.race([
      streamReader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), remaining)),
    ]);
    if (outcome.timedOut || outcome.done) return { ok: false, buffer };
    buffer += decoder.decode(outcome.value, { stream: true });
    if (predicate(buffer)) return { ok: true, buffer };
  }
  return { ok: false, buffer };
}

const live = makeClient();
await live.login(process.env.SMOKE_EMAIL ?? "reader@happypaper.local", process.env.SMOKE_PASSWORD ?? "reader12345");
const streamAbort = new AbortController();
const streamResponse = await live.call(`/api/papers/${paper.id}/stream`, {
  signal: streamAbort.signal,
});
check(
  "SSE 通道返回 event-stream",
  streamResponse.status === 200 &&
    (streamResponse.headers.get("content-type") ?? "").includes("text/event-stream"),
  `${streamResponse.status}, ${streamResponse.headers.get("content-type")}`,
);

const streamReader = streamResponse.body.getReader();
const presence = await readUntil(streamReader, (buffer) => buffer.includes("event: presence"));
check("SSE 收到在线阅读人数", presence.ok, presence.buffer.split("\n").slice(0, 2).join(" "));

const pusher = makeClient();
await pusher.login(`smoke-${suffix}@happypaper.local`, "smoke12345");
await pusher.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    content: "实时推送测试",
    kind: "question",
    displayMode: "immediate",
    anchor: ANCHOR,
  }),
});
const pushed = await readUntil(streamReader, (buffer) => buffer.includes("comment:new"));
check("SSE 收到新评论推送", pushed.ok, pushed.buffer.includes("comment:new") ? "comment:new" : "no event");
streamAbort.abort();

// pages
const readPage = await reader.call(`/read/${paper.id}?page=4`);
check("阅读器页可访问", readPage.status === 200, `status ${readPage.status}`);
const mePage = await reader.call("/me?tab=comments");
check("我的页面可访问", mePage.status === 200, `status ${mePage.status}`);
const meAnon = await anon.call("/me");
check("未登录访问我的页面被重定向", meAnon.status >= 300 && meAnon.status < 400, `status ${meAnon.status}`);
const profilePage = await reader.call(`/u/${encodeURIComponent(readerUser.name)}`);
check("用户主页可访问", profilePage.status === 200, `status ${profilePage.status}`);
const takedownPage = await anon.call("/legal/takedown");
check("侵权投诉页可访问", takedownPage.status === 200, `status ${takedownPage.status}`);

// admin access control
const adminReportsAnon = await anon.call("/api/admin/reports");
check("匿名访问管理接口被拒绝", adminReportsAnon.status === 401, `status ${adminReportsAnon.status}`);
const adminReportsReader = await reader.call("/api/admin/reports");
check("普通用户访问管理接口被拒绝", adminReportsReader.status === 403, `status ${adminReportsReader.status}`);
const adminPageReader = await reader.call("/admin");
check("普通用户访问管理页被拒绝", adminPageReader.status === 404, `status ${adminPageReader.status}`);

const adminReports = await admin.call("/api/admin/reports?status=open");
const reportList = await json(adminReports);
check(
  "管理员读取举报队列",
  adminReports.status === 200 && (reportList.reports?.length ?? 0) >= 1,
  `${reportList.reports?.length ?? 0} 条`,
);

const adminPage = await admin.call("/admin?tab=reports");
check("管理员访问管理页", adminPage.status === 200, `status ${adminPage.status}`);

// moderation round trip on a live comment
const moderationComment = await json(
  await pusher.call(`/api/papers/${paper.id}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "待审核内容", kind: "other", anchor: ANCHOR }),
  }),
);

async function appearsInSidebar(id) {
  const payload = await json(await reader.call(`/api/papers/${paper.id}/comments?page=4&spread=1`));
  return [...(payload.roots ?? []), ...(payload.replies ?? [])].some((c) => c.id === id);
}

check("隐藏前评论可见", await appearsInSidebar(moderationComment.comment.id));
await admin.call(`/api/admin/comments/${moderationComment.comment.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "hidden" }),
});
check("管理员隐藏后侧栏不再显示", !(await appearsInSidebar(moderationComment.comment.id)));
await admin.call(`/api/admin/comments/${moderationComment.comment.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "visible" }),
});
check("管理员恢复后重新显示", await appearsInSidebar(moderationComment.comment.id));

const resolveReport = await admin.call(`/api/admin/reports?id=${reportList.reports[0].id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "resolved" }),
});
check("处理举报", resolveReport.status === 200, `status ${resolveReport.status}`);

// mute round trip
const muteResponse = await admin.call(`/api/admin/users/${otherUser.id}/mute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ minutes: 30 }),
});
check("管理员禁言用户", muteResponse.status === 200, `status ${muteResponse.status}`);
const mutedPost = await other.call(`/api/papers/${paper.id}/comments`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "禁言期间发言", kind: "other", anchor: ANCHOR }),
});
const mutedBody = await json(mutedPost);
check("被禁言用户无法发言", mutedPost.status === 403 && mutedBody.error === "MUTED", JSON.stringify(mutedBody));

const selfMute = await admin.call(`/api/admin/users/${adminUser.id}/mute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ minutes: 30 }),
});
check("管理员不能禁言自己", selfMute.status === 403, `status ${selfMute.status}`);

const unmuteResponse = await admin.call(`/api/admin/users/${otherUser.id}/mute`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ minutes: null }),
});
check("解除禁言", unmuteResponse.status === 200, `status ${unmuteResponse.status}`);

// copyright takedown round trip
const unpublish = await admin.call(`/api/admin/papers/${paper.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ visibility: "private" }),
});
check("管理员把论文转为私有", unpublish.status === 200, `status ${unpublish.status}`);
const hiddenDetail = await other.call(`/papers/${paper.id}`);
check("私有论文对他人不可见", hiddenDetail.status === 404, `status ${hiddenDetail.status}`);
const republish = await admin.call(`/api/admin/papers/${paper.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ visibility: "public" }),
});
check("管理员恢复公开", republish.status === 200, `status ${republish.status}`);
const publicDetail = await other.call(`/papers/${paper.id}`);
check("恢复后他人可访问", publicDetail.status === 200, `status ${publicDetail.status}`);

// Remote paper search is verified by scripts/verify-search.mjs instead of here:
// every search costs two upstream OpenAlex requests, and OpenAlex throttles by
// IP, so keeping those checks in this suite made the main baseline depend on a
// rate-limited external service.

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((f) => f.name).join(", "));
}
process.exit(failed.length === 0 ? 0 : 1);
