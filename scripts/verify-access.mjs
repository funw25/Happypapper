import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verificationClient } from "./lib/verification-client.mjs";
import { withVerificationRuntime } from "./lib/verification-runtime.mjs";

const fixture = await readFile(new URL("../tests/fixtures/F01-reading-notes.pdf", import.meta.url));
const anchor = { page: 4, yNorm: 0.4, xNorm: 0.15, quote: "Reliable experiments use fixed inputs" };

await withVerificationRuntime(async ({ base, actors }) => {
  let count = 0;

  function check(condition, label) {
    assert.ok(condition, label);
    count++;
    console.log("PASS " + label);
  }

  async function signedIn(name) {
    const client = verificationClient(base);
    const account = actors[name];
    const user = await client.login(account.email, account.password);
    check(user?.name === name, "登录 " + name);
    return { ...client, user };
  }

  async function status(client, path, expected, options = {}) {
    const response = await client.request(path, options);
    if (response.status !== expected) {
      throw new Error((options.method ?? "GET") + " " + path + " expected " + expected +
        ", got " + response.status + " " + (await response.text()).slice(0, 500));
    }
    check(true, (options.method ?? "GET") + " " + path + " → " + expected);
    return response;
  }

  function upload(client, title, visibility, claimRights = false) {
    const body = new FormData();
    body.set("title", title);
    body.set("authors", "HappyPaper Fixture");
    body.set("visibility", visibility);
    if (claimRights) body.set("rightsClaimed", "true");
    body.set("file", new Blob([fixture], { type: "application/pdf" }), "reading-notes.pdf");
    return client.request("/api/papers", { method: "POST", body });
  }

  const guest = verificationClient(base);
  const a = await signedIn("reader-a");
  const b = await signedIn("reader-b");
  const unverified = await signedIn("unverified-reader");
  const admin = await signedIn("test-admin");
  const muted = await signedIn("muted-reader");

  const publicUpload = await upload(a, "Fixture public", "public", true);
  check(publicUpload.status === 201, "上传公开 PDF");
  const { paper: publicPaper } = await publicUpload.json();
  const privateUpload = await upload(a, "Fixture private A", "private");
  check(privateUpload.status === 201, "上传私有 PDF A");
  const { paper: privatePaper } = await privateUpload.json();
  const secondPrivateUpload = await upload(b, "Fixture private B", "private");
  check(secondPrivateUpload.status === 201, "上传私有 PDF B");
  const { paper: secondPrivate } = await secondPrivateUpload.json();
  check(secondPrivate.id !== privatePaper.id, "不同作者的上传拥有独立记录");
  check((await upload(unverified, "Fixture unverified", "private")).status === 403, "未验证账号不能上传");
  check((await upload(a, "Fixture without consent", "public")).status === 422, "公开发布要求确认权利");

  const pdf = "/api/papers/" + privatePaper.id + "/pdf";
  const stream = "/api/papers/" + privatePaper.id + "/stream";
  const comments = "/api/papers/" + privatePaper.id + "/comments";
  for (const client of [guest, b, admin]) {
    await status(client, pdf, 404);
    await status(client, pdf, 404, { method: "HEAD" });
    await status(client, comments, 404);
    await status(client, stream, 404);
    await status(client, "/papers/" + privatePaper.id, 404);
    await status(client, "/read/" + privatePaper.id, 404);
  }
  await status(a, "/api/papers/" + secondPrivate.id + "/pdf", 404);
  const ownerPdf = await status(a, pdf, 200);
  assert.deepEqual(Buffer.from(await ownerPdf.arrayBuffer()), fixture);
  check(ownerPdf.headers.get("cache-control") === "private, no-store", "私有文件禁止共享缓存");
  const tail = await status(a, pdf, 206, { headers: { range: "bytes=-40" } });
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), fixture.subarray(-40));
  const head = await status(a, pdf, 206, { method: "HEAD", headers: { range: "bytes=2-11" } });
  check(head.headers.get("content-range") === "bytes 2-11/" + fixture.byteLength && (await head.arrayBuffer()).byteLength === 0, "HEAD 与 GET 范围规则一致");
  await status(a, pdf, 416, { headers: { range: "bytes=1-2,4-5" } });
  await status(b, pdf, 404, { method: "POST" });
  await status(b, "/api/papers/" + privatePaper.id + "/favorite", 404, { method: "POST" });
  await status(b, "/api/papers/" + privatePaper.id + "/progress", 404, { method: "PUT", json: { page: 1 } });
  await status(b, "/api/papers/" + publicPaper.id, 403, { method: "PATCH", json: { tags: ["Test"] } });
  await status(a, "/api/papers/" + publicPaper.id, 200, { method: "PATCH", json: { tags: ["Annotation"] } });
  await status(guest, "/api/papers/invalid-id/comments", 404);

  const publicComments = "/api/papers/" + publicPaper.id + "/comments";
  const body = { content: "fixture-visible-comment", kind: "explain", anchor };
  const privateComment = await (await status(a, comments, 201, {
    method: "POST", json: { ...body, content: "fixture-private-comment" },
  })).json();
  await status(muted, publicComments, 403, { method: "POST", json: body });
  await status(unverified, publicComments, 403, { method: "POST", json: body });
  await status(unverified, publicComments, 200);
  await status(unverified, "/api/papers/" + publicPaper.id + "/favorite", 200, { method: "POST" });
  for (const [path, method, json] of [
    ["/like", "POST"], ["/like", "DELETE"], ["/report", "POST", { reason: "other" }], ["", "DELETE"],
  ]) {
    await status(b, "/api/comments/" + privateComment.comment.id + path, 404, { method, json });
  }
  await status(b, publicComments, 404, { method: "POST", json: { ...body, parentId: privateComment.comment.id } });

  const root = (await (await status(a, publicComments, 201, { method: "POST", json: body })).json()).comment;
  await status(unverified, "/api/comments/" + root.id + "/like", 403, { method: "POST" });
  const livePath = "/api/papers/" + publicPaper.id + "/stream";
  const connection = await status(a, livePath, 200);
  const reader = connection.body.getReader();
  const decoder = new TextDecoder();
  let events = "";
  async function waitFor(value) {
    while (!events.includes(value)) {
      const next = await reader.read();
      if (next.done) throw new Error("Stream closed before " + value);
      events += decoder.decode(next.value, { stream: true });
    }
  }
  await waitFor("event: presence");
  try {
    const reply = (await (await status(b, publicComments, 201, {
      method: "POST",
      json: { ...body, content: "fixture-anonymous-reply", parentId: root.id, anonymous: true, anchor: { ...anchor, page: 1 } },
    })).json()).comment;
    check(reply.page === 4 && reply.quote === root.quote, "回复以服务端父评论锚点为准");
    check(reply.viewer.isMine && reply.viewer.canDelete && reply.authorName === null && !("userId" in reply), "发布响应通过 viewer 表示本人操作并隐藏匿名作者");
    await waitFor('"commentId":"' + reply.id + '"');
    const posted = events.split("\n").find((line) => line.startsWith("data: ") && line.includes('"commentId":"' + reply.id + '"'));
    const realtime = JSON.parse(posted.slice(6));
    check(!events.includes("fixture-anonymous-reply") && !("authorName" in realtime) && !("viewer" in realtime) && !("userId" in realtime), "SSE 仅传 ID，不暴露正文、匿名作者或他人的操作权限");

    const listed = await (await status(a, publicComments + "?page=4", 200)).json();
    const listedReply = listed.replies.find((item) => item.id === reply.id);
    check(listedReply?.authorName === null && !("userId" in listedReply) && !listedReply.viewer.isMine, "评论列表保持匿名");
    const notifications = await (await status(a, "/api/me/notifications", 200)).json();
    const replyNotice = notifications.items.find((item) => item.commentId === reply.id);
    check(replyNotice?.actorName === null && !("actorId" in replyNotice), "接收方收到匿名回复通知");

    const home = await (await status(guest, "/", 200)).text();
    check(home.includes("fixture-anonymous-reply") && !home.includes("reader-b") && !home.includes("fixture-private-comment"), "首页只显示公开内容并隐藏匿名署名");
    const profileA = await (await status(guest, "/u/reader-a", 200)).text();
    check(profileA.includes("fixture-visible-comment") && !profileA.includes("fixture-private-comment") && profileA.includes("1 条评论"), "公开主页列表和统计按同一隐私规则筛选");
    const profileB = await (await status(guest, "/u/reader-b", 200)).text();
    check(!profileB.includes("fixture-anonymous-reply") && profileB.includes("0 条评论"), "公开主页统计排除匿名回复");

    const adminPath = "/api/admin/papers/" + publicPaper.id;
    await status(admin, adminPath, 200, { method: "PATCH", json: { status: "removed" } });
    let ended = false;
    while (!ended) ended = (await reader.read()).done;
    check(ended, "下架时关闭已经打开的 SSE");
    await status(a, livePath, 404);
    await status(a, publicComments, 404);
    await status(a, "/api/papers/" + publicPaper.id + "/pdf", 404, { method: "POST" });
    const revoked = await (await status(a, "/api/me/notifications", 200)).json();
    check(revoked.total === 0 && revoked.unread === 0, "下架内容的通知和未读数同步撤回");
    await status(admin, adminPath, 200, { method: "PATCH", json: { status: "active" } });
    await status(a, publicComments, 200);
  } finally {
    await reader.cancel().catch(() => {});
  }

  console.log("\n" + count + " access and privacy checks passed");
});
