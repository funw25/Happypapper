import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verificationClient } from "./lib/verification-client.mjs";
import { withVerificationRuntime } from "./lib/verification-runtime.mjs";

const burst = crypto.randomUUID(), gap = crypto.randomUUID();
async function seed(db) {
  await db.query("insert into papers (id,title,source) values ($1,'Replay overflow','upload'),($2,'Replay retention gap','upload')", [burst, gap]);
  await db.query(`insert into comments (paper_id,content,page,y_norm)
    select $1,'overflow ' || i,1,0 from generate_series(1,1001) i`, [burst]);
  await db.query("insert into comments (paper_id,content,page,y_norm) values ($1,'gone event',1,0),($1,'kept event',1,0)", [gap]);
  await db.query("delete from paper_events where paper_id=$1 and revision=1", [gap]);
  const before = (await db.query("select content_revision::text from papers where id=$1", [gap])).rows[0].content_revision;
  await db.exec("begin");
  await db.query("insert into comments (paper_id,content,page,y_norm) values ($1,'rolled back',1,0)", [gap]);
  await db.exec("rollback");
  const after = (await db.query("select content_revision::text from papers where id=$1", [gap])).rows[0].content_revision;
  assert.equal(after, before);
  assert.equal((await db.query("select count(*)::int n from paper_events where paper_id=$1", [gap])).rows[0].n, 1);
  console.log("PASS rolled-back writes leave neither a revision increment nor an event");
}

await withVerificationRuntime(async ({ base, actors, restart }) => {
  async function login(name) {
    const client = verificationClient(base), actor = actors[name];
    assert.ok(await client.login(actor.email, actor.password));
    return client;
  }
  const author = await login("reader-a"), reader = await login("reader-b"), admin = await login("test-admin");
  const guest = verificationClient(base);
  const bytes = await readFile(new URL("../tests/fixtures/F01-reading-notes.pdf", import.meta.url));
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "application/pdf" }), "replay.pdf");
  form.set("visibility", "public"); form.set("rightsClaimed", "true");
  const uploaded = await author.request("/api/papers", { method: "POST", body: form });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const paper = (await uploaded.json()).paper;
  async function connect(id, after, headers = {}) {
    const abort = new AbortController();
    const path = `/api/papers/${id}/stream` + (after === undefined ? "" : `?after=${encodeURIComponent(after)}`);
    const response = await guest.request(path, { signal: abort.signal, headers });
    if (response.status !== 200) assert.fail(await response.text());
    const streamReader = response.body.getReader(), decoder = new TextDecoder();
    const events = [];
    let buffer = "";
    async function until(predicate) {
      const timeout = setTimeout(() => abort.abort(), 15_000);
      try {
        while (true) {
          const found = events.find(predicate);
          if (found) return found;
          const next = await streamReader.read();
          if (next.done) throw new Error("Stream ended before expected event");
          buffer += decoder.decode(next.value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const line = packet.split("\n").find((entry) => entry.startsWith("data: "));
            if (line) events.push(JSON.parse(line.slice(6)));
          }
        }
      } finally { clearTimeout(timeout); }
    }
    return { events, until, close: () => { abort.abort(); return streamReader.cancel().catch(() => {}); } };
  }
  async function post(client, text, parentId, key) {
    const response = await client.request(`/api/papers/${paper.id}/comments`, { method: "POST",
      headers: key ? { "idempotency-key": key } : {}, json: {
        content: text, kind: "question", anchor: { type: "paper", version: 2 }, anonymous: true, parentId,
      } });
    assert.ok(response.status === 201 || response.status === 200, await response.clone().text());
    return (await response.json()).comment;
  }
  const live = await connect(paper.id);
  const baseline = await live.until((event) => event.type === "stream.ready");
  const requestKey = crypto.randomUUID();
  const root = await post(author, "private-to-DTO-only anonymous text", undefined, requestKey);
  const created = await live.until((event) => event.type === "comment.created" && event.commentId === String(root.id));
  assert.equal(created.eventId, paper.id + ":" + created.revision);
  assert.ok(BigInt(created.revision) > BigInt(baseline.revision));
  assert.deepEqual(Object.keys(created).sort(), ["commentId", "eventId", "occurredAt", "paperId", "paperVersionId", "revision", "type"]);
  assert.ok(!JSON.stringify(live.events).includes(root.content));
  assert.equal((await (await reader.request(`/api/comments/${root.id}`)).json()).comment.authorName, null);
  await post(author, root.content, undefined, requestKey);
  await live.close();
  console.log("PASS live events are ordered minimal envelopes; anonymous content is fetched through authorized DTOs");

  const reply = await post(reader, "reply while disconnected", root.id);
  assert.equal((await reader.request(`/api/comments/${root.id}/like`, { method: "POST" })).status, 200);
  const resumed = await connect(paper.id, "0", { "last-event-id": created.eventId });
  const caught = await resumed.until((event) => event.type === "stream.ready");
  const replay = resumed.events.filter((event) => event.eventId);
  assert.ok(replay.some((event) => event.commentId === String(reply.id)));
  assert.ok(replay.some((event) => event.type === "comment.metrics"));
  assert.ok(replay.every((event, index) => BigInt(event.revision) === BigInt(created.revision) + BigInt(index + 1)));
  assert.ok(!replay.some((event) => event.type === "comment.created" && event.commentId === String(root.id)));
  await resumed.close();
  await restart();
  const restarted = await connect(paper.id, created.eventId);
  const restartReady = await restarted.until((event) => event.type === "stream.ready");
  assert.equal(restartReady.revision, caught.revision);
  assert.deepEqual(restarted.events.filter((event) => event.eventId), replay);
  await restarted.close();
  console.log("PASS Last-Event-ID overrides URL cursor; disconnect and Web-process restart replay the same committed events without duplicates");

  for (const [id, after] of [[burst, "0"], [gap, "0"], [paper.id, "9223372036854775807"]]) {
    const reset = await connect(id, after);
    await reset.until((event) => event.type === "stream.reset");
    await reset.close();
  }
  for (const cursor of [gap + ":1", "-1", "1e2", "9223372036854775808"]) {
    assert.equal((await guest.request(`/api/papers/${paper.id}/stream?after=${encodeURIComponent(cursor)}`)).status, 400);
  }
  console.log("PASS overflow, missing retained events and future revisions reset; malformed and cross-paper cursors are rejected");

  const removal = await connect(paper.id, caught.revision);
  await removal.until((event) => event.type === "stream.ready");
  assert.equal((await author.request(`/api/comments/${root.id}`, { method: "DELETE" })).status, 200);
  await removal.until((event) => event.type === "comment.removed" && event.commentId === String(root.id));
  assert.equal((await guest.request(`/api/comments/${root.id}`)).status, 404);
  assert.equal((await admin.request(`/api/admin/papers/${paper.id}`, { method: "PATCH", json: { status: "removed" } })).status, 200);
  await removal.until((event) => event.type === "stream.revoked");
  await removal.close();
  assert.equal((await guest.request(`/api/papers/${paper.id}/stream`)).status, 404);
  console.log("PASS removals propagate and revoked access invalidates an open stream and blocks reconnection");
}, { seed });
