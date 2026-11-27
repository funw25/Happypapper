import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verificationClient } from "./lib/verification-client.mjs";
import { withVerificationRuntime } from "./lib/verification-runtime.mjs";

await withVerificationRuntime(async ({ base, actors }) => {
  async function login(name) {
    const client = verificationClient(base);
    const actor = actors[name];
    assert.ok(await client.login(actor.email, actor.password));
    return client;
  }
  const author = await login("reader-a");
  const reader = await login("reader-b");
  const admin = await login("test-admin");
  const bytes = await readFile(new URL("../tests/fixtures/F01-reading-notes.pdf", import.meta.url));
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "application/pdf" }), "comments.pdf");
  form.set("visibility", "public");
  form.set("rightsClaimed", "true");
  const upload = await author.request("/api/papers", { method: "POST", body: form });
  assert.equal(upload.status, 201, await upload.clone().text());
  const paper = (await upload.json()).paper;
  async function post(client, content, parentId) {
    const response = await client.request(`/api/papers/${paper.id}/comments`, { method: "POST", json: {
      content, kind: "question", anchor: { version: 2, type: "paper" }, parentId,
    } });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).comment;
  }
  const root = await post(author, "Check transactional likes");
  const reply = await post(reader, "Check moderation reply counts", root.id);
  const likeUrl = `/api/comments/${root.id}/like`;
  const duplicateLikes = await Promise.all(Array.from({ length: 12 }, () => reader.request(likeUrl, { method: "POST" })));
  assert.ok(duplicateLikes.every((response) => response.status === 200));
  async function current() { return (await (await reader.request(`/api/comments/${root.id}`)).json()).comment; }
  assert.equal((await current()).likeCount, 1);
  const inbox = (await (await author.request("/api/me/notifications")).json()).items;
  assert.equal(inbox.filter((item) => item.type === "like" && item.commentId === root.id).length, 1);
  console.log("PASS 12 concurrent identical likes produce one count and one notification");

  const duplicateUnlikes = await Promise.all(Array.from({ length: 12 }, () => reader.request(likeUrl, { method: "DELETE" })));
  assert.ok(duplicateUnlikes.every((response) => response.status === 200));
  assert.equal((await current()).likeCount, 0);
  const afterUnlike = (await (await author.request("/api/me/notifications")).json()).items;
  assert.equal(afterUnlike.filter((item) => item.type === "like" && item.commentId === root.id).length, 0);
  console.log("PASS concurrent removal keeps counts and notification withdrawal consistent");

  assert.equal((await current()).replyCount, 1);
  for (const [status, expected] of [["hidden", 0], ["visible", 1]]) {
    const response = await admin.request(`/api/admin/comments/${reply.id}`, { method: "PATCH", json: { status } });
    assert.equal(response.status, 200);
    assert.equal((await current()).replyCount, expected);
  }
  assert.equal((await reader.request(`/api/comments/${reply.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await current()).replyCount, 0);
  assert.equal((await author.request(`/api/comments/${root.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await reader.request(likeUrl, { method: "POST" })).status, 404);
  console.log("PASS hiding, restoring and deleting replies update root counts and deleted roots reject likes");
});
