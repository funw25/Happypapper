/**
 * Reply notifications (docs/02-roadmap.md B2).
 *
 *   node scripts/verify-notify.mjs        # requires the dev server
 *
 * The point of B2 is that a reply used to be invisible to the person replied
 * to. This drives the whole chain over HTTP: post a comment, reply to it from
 * another account, then read the recipient's inbox, the header badge and the
 * mark-as-read endpoint.
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const IDENTIFIER = process.env.SMOKE_IDENTIFIER ?? "1706.03762";
const AUTHOR = { email: "florence@happypaper.com", password: "florence12345" };
const REPLIER = { email: "reader@happypaper.local", password: "reader12345" };
const BYSTANDER = { email: "admin@happypaper.local", password: "admin12345" };

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

  async function postComment(paperId, body) {
    const response = await call(`/api/papers/${paperId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // 5 comments per 60s per user is this project's own posting limit. Running
    // the suite repeatedly inside one window hits it, which says nothing about
    // the notification code.
    if (response.status === 429) rateLimited = true;
    return response;
  }

  return { call, login, postComment };
}

const results = [];
let rateLimited = false;
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function anchor(page = 1) {
  return {
    content: `notify probe ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "question",
    anchor: { page, yNorm: 0.5, quote: null },
    displayMode: "position",
  };
}

try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(1);
}

const author = makeClient();
const authorUser = await author.login(AUTHOR.email, AUTHOR.password);
const replier = makeClient();
const replierUser = await replier.login(REPLIER.email, REPLIER.password);
check(
  "两个账号登录成功",
  Boolean(authorUser?.id) && Boolean(replierUser?.id),
  `${authorUser?.name ?? "?"} / ${replierUser?.name ?? "?"}`,
);

// A paper has to exist before a comment can be anchored to it.
let paperId = (await (await author.call("/api/papers")).json()).papers?.[0]?.id ?? null;
if (!paperId) {
  const imported = await author.call("/api/papers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: IDENTIFIER }),
  });
  paperId = (await imported.json().catch(() => ({})))?.paper?.id ?? null;
}
check("库内有可用于评论的论文", Boolean(paperId), paperId ?? "none");
if (!paperId) {
  console.log("\ncannot continue without a paper");
  process.exit(1);
}

const anonymous = await fetch(`${BASE}/api/me/notifications`);
check("匿名访问通知接口被拒绝", anonymous.status === 401, `status ${anonymous.status}`);

const before = await (await author.call("/api/me/notifications")).json();
const unreadBefore = before.unread ?? 0;

// The author posts the comment that will be replied to.
const parentResponse = await author.postComment(paperId, anchor());
const parent = (await parentResponse.json().catch(() => ({}))).comment;
check("发布被回复的父评论", parentResponse.status === 201 && Boolean(parent?.id), `status ${parentResponse.status}`);

// Someone else replies to it.
const replyResponse = await replier.postComment(paperId, { ...anchor(), parentId: parent?.id });
const reply = (await replyResponse.json().catch(() => ({}))).comment;
check("他人回复该评论", replyResponse.status === 201 && Boolean(reply?.id), `status ${replyResponse.status}`);

// Without these two comments the rest of the run has nothing to read, and a
// throttled post would otherwise surface as a TypeError on reply.id.
if (!parent?.id || !reply?.id) {
  console.log(
    rateLimited
      ? "\n发评论被限流（每账号 60 秒 5 条），后续检查无法进行。等一分钟再跑，或 npm run db:reset 清除计数。"
      : "\n评论没有建立，后续检查无法进行。",
  );
  const failedSoFar = results.filter((r) => !r.ok);
  console.log(`${results.length - failedSoFar.length}/${results.length} checks passed`);
  process.exit(2);
}

const inbox = await (await author.call("/api/me/notifications")).json();
const items = inbox.items ?? [];
const notification = items.find((item) => item.commentId === reply?.id);
check(
  "被回复者收到通知",
  Boolean(notification),
  `unread ${unreadBefore} -> ${inbox.unread}`,
);
check(
  "未读数增加一条",
  inbox.unread === unreadBefore + 1,
  `unread ${unreadBefore} -> ${inbox.unread}`,
);
check(
  "通知带回复者、论文与页码",
  notification?.actorName === replierUser?.name &&
    notification?.paperId === paperId &&
    typeof notification?.page === "number" &&
    typeof notification?.commentContent === "string",
  notification
    ? `actor=${notification.actorName}, page=${notification.page}, paper=${notification.paperTitle}`
    : "no notification",
);
check("通知初始为未读", notification?.readAt === null, `readAt=${notification?.readAt ?? "null"}`);

// Reply to your own comment: nobody to tell, and telling yourself is noise.
const selfReply = await author.postComment(paperId, { ...anchor(), parentId: parent?.id });
const selfReplyBody = await selfReply.json().catch(() => ({}));
const afterSelf = await (await author.call("/api/me/notifications")).json();
check(
  "回复自己的评论不产生通知",
  selfReply.status === 201 &&
    !(afterSelf.items ?? []).some((item) => item.commentId === selfReplyBody.comment?.id),
  `status ${selfReply.status}, unread ${afterSelf.unread}`,
);

// The header badge is what makes the notification discoverable.
const home = await author.call("/");
const homeHtml = await home.text();
check(
  "站点头部显示未读角标",
  home.status === 200 && homeHtml.includes(`data-unread="${afterSelf.unread}"`) && afterSelf.unread > 0,
  `data-unread="${afterSelf.unread}"`,
);

const mePage = await author.call("/me?tab=notifications");
const meHtml = await mePage.text();
check(
  "/me 通知分页可访问并渲染通知",
  mePage.status === 200 && meHtml.includes("通知") && meHtml.includes(replierUser?.name ?? "reader"),
  `status ${mePage.status}`,
);

// Another account must not be able to mark this notification read.
const bystander = makeClient();
await bystander.login(BYSTANDER.email, BYSTANDER.password);
const foreign = await bystander.call("/api/me/notifications/read", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: notification?.id }),
});
const foreignBody = await foreign.json().catch(() => ({}));
check("不能标记他人的通知为已读", foreignBody.marked === 0, `marked=${foreignBody.marked ?? "?"}`);

const single = await author.call("/api/me/notifications/read", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: notification?.id }),
});
const singleBody = await single.json().catch(() => ({}));
check("按 id 标为已读只影响一条", singleBody.marked === 1, `marked=${singleBody.marked ?? "?"}`);

const cleared = await author.call("/api/me/notifications/read", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
const clearedBody = await cleared.json().catch(() => ({}));
const afterClear = await (await author.call("/api/me/notifications")).json();
check(
  "标记全部已读后未读数归零",
  clearedBody.unread === 0 && afterClear.unread === 0,
  `unread=${afterClear.unread}`,
);

// ------------------------------------------------- like notifications
const settingsBefore = await (await author.call("/api/me/notifications/settings")).json();
check(
  "点赞通知默认开启",
  settingsBefore.likeNotifications === true,
  `likeNotifications=${settingsBefore.likeNotifications}`,
);

const likePath = `/api/comments/${parent.id}/like`;
const likeResponse = await replier.call(likePath, { method: "POST" });
check("点赞他人评论成功", likeResponse.status === 200, `status ${likeResponse.status}`);

// Scoped to this run's parent comment: the database is not reset between runs,
// so an absolute count would depend on leftovers from previous invocations.
const likesOf = (inbox) =>
  (inbox.items ?? []).filter((item) => item.type === "like" && item.commentId === parent.id);
const afterLike = await (await author.call("/api/me/notifications")).json();
const likeItems = likesOf(afterLike);
check(
  "点赞产生 like 通知",
  likeItems.length === 1 &&
    likeItems[0].actorName === replierUser?.name &&
    likeItems[0].commentId === parent?.id,
  `${likeItems.length} 条, actor=${likeItems[0]?.actorName ?? "-"}`,
);

const relike = await replier.call(likePath, { method: "POST" });
const afterRelike = await (await author.call("/api/me/notifications")).json();
check(
  "重复点赞不堆积通知",
  relike.status === 200 && likesOf(afterRelike).length === 1,
  `${likesOf(afterRelike).length} 条`,
);

// Liking your own comment must not land in your own inbox.
const selfLike = await replier.call(`/api/comments/${reply.id}/like`, { method: "POST" });
const replierInbox = await (await replier.call("/api/me/notifications")).json();
const selfLiked = (replierInbox.items ?? []).filter((item) => item.commentId === reply.id);
check(
  "点赞自己的评论不产生通知",
  selfLike.status === 200 && selfLiked.length === 0,
  `status ${selfLike.status}, 自身评论通知 ${selfLiked.length} 条`,
);

const offResponse = await author.call("/api/me/notifications/settings", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ likeNotifications: false }),
});
const offBody = await offResponse.json().catch(() => ({}));
check(
  "可以关闭点赞通知",
  offResponse.status === 200 && offBody.likeNotifications === false,
  `likeNotifications=${offBody.likeNotifications}`,
);

const adminLike = await bystander.call(likePath, { method: "POST" });
const afterAdminLike = await (await author.call("/api/me/notifications")).json();
check(
  "关闭后新的点赞不再通知",
  adminLike.status === 200 && likesOf(afterAdminLike).length === 1,
  `${likesOf(afterAdminLike).length} 条`,
);

// Re-enable, then a fresh like has to arrive again. The previous like has to be
// withdrawn first, otherwise re-posting it is a no-op in the like table and
// nothing would be asserted.
await bystander.call(likePath, { method: "DELETE" });
const onResponse = await author.call("/api/me/notifications/settings", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ likeNotifications: true }),
});
const onBody = await onResponse.json().catch(() => ({}));
const adminLikeAgain = await bystander.call(likePath, { method: "POST" });
const afterOn = await (await author.call("/api/me/notifications")).json();
check(
  "重新开启后恢复通知",
  onBody.likeNotifications === true &&
    adminLikeAgain.status === 200 &&
    likesOf(afterOn).length === 2,
  `${likesOf(afterOn).length} 条`,
);

await replier.call(likePath, { method: "DELETE" });
const afterUnlike = await (await author.call("/api/me/notifications")).json();
check(
  "取消点赞撤回通知",
  likesOf(afterUnlike).length === 1 &&
    !likesOf(afterUnlike).some((item) => item.actorName === replierUser?.name),
  `${likesOf(afterUnlike).length} 条`,
);

const badSetting = await author.call("/api/me/notifications/settings", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ likeNotifications: "yes" }),
});
check("非法设置值被拒绝", badSetting.status === 400, `status ${badSetting.status}`);

const anonSetting = await fetch(`${BASE}/api/me/notifications/settings`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ likeNotifications: false }),
});
check("匿名修改通知设置被拒绝", anonSetting.status === 401, `status ${anonSetting.status}`);

const mePageAgain = await author.call("/me?tab=notifications");
const meHtmlToggle = await mePageAgain.text();
check(
  "通知页渲染点赞通知开关",
  mePageAgain.status === 200 && meHtmlToggle.includes("data-like-notifications"),
  `status ${mePageAgain.status}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((f) => f.name).join(", "));
}
if (rateLimited) {
  console.log(
    "\n本项目的发评论限流（每用户 60 秒 5 条）被触发，本次结论待定。" +
      "等一分钟再跑，或对数据库执行 npm run db:reset 清除计数。退出码 2 表示待定，不是回归。",
  );
  process.exit(2);
}
process.exit(failed.length === 0 ? 0 : 1);
