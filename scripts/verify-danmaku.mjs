import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { verificationClient } from "./lib/verification-client.mjs";
import { withVerificationRuntime } from "./lib/verification-runtime.mjs";

const fixture = { paper: crypto.randomUUID(), private: crypto.randomUUID(), version: crypto.randomUUID(), old: crypto.randomUUID() };

async function seed(db, storage) {
  await mkdir(storage, { recursive: true });
  await copyFile(new URL("../tests/fixtures/F01-reading-notes.pdf", import.meta.url), join(storage, "feed.pdf"));
  const { rows: actors } = await db.query("select id, name from users");
  const actor = (name) => actors.find((row) => row.name === name).id;
  await db.query(`insert into papers (id, title, source, pdf_path, visibility, uploaded_by)
    values ($1, 'Danmaku fixture', 'upload', 'feed.pdf', 'public', $3),
           ($2, 'Private fixture', 'upload', null, 'private', $3)`, [fixture.paper, fixture.private, actor("reader-a")]);
  await db.query(`insert into paper_versions (id, paper_id, version_label, source_type, pdf_key, page_count, processing_state)
    values ($1, $3, 'Current', 'upload', 'feed.pdf', 5, 'legacy'),
           ($2, $3, 'Old', 'upload', 'feed.pdf', 5, 'legacy')`, [fixture.version, fixture.old, fixture.paper]);
  await db.query("update papers set default_version_id = $1 where id = $2", [fixture.version, fixture.paper]);

  async function root(text, { page = 1, version = fixture.version, whole = false, status = "visible", enabled = true, time } = {}) {
    const { rows: [row] } = await db.query(`insert into comments
      (paper_id, paper_version_id, content, danmaku_text, page, y_norm, kind, user_id, created_at, anchor_v2, status, visible_in_danmaku)
      values ($1,$2,$3,$3,$4,0.4,'question',$5,$6,$7,$8,$9) returning id::text`,
    [fixture.paper, whole ? null : version, text, page, actor("reader-a"), time ?? "2026-11-01T00:00:00Z",
      whole ? '{"type":"paper","version":2}' : null, status, enabled]);
    return row.id;
  }
  await db.query(`insert into comments (paper_id, paper_version_id, content, danmaku_text, page, y_norm, kind, user_id, created_at)
    select $1, $2, 'Queue ' || i, 'Queue ' || i, 1, 0.4, 'question', $3,
      '2026-11-01T00:00:00Z'::timestamptz + i * interval '1 microsecond' from generate_series(1, 100) i`,
  [fixture.paper, fixture.version, actor("reader-a")]);
  fixture.wide = await root("A wide message with enough text to exercise the measured track width", { page: 5, time: "2026-11-01T00:00:00.000102Z" });
  fixture.whole = await root("Whole paper", { whole: true, time: "2026-11-01T00:00:00.000102Z" });
  fixture.hot = await root("A real like and two distinct readers", { time: "2026-11-01T00:00:00.000101Z" });
  fixture.repeats = await root("Many replies from one reader", { time: "2026-11-01T00:00:00.000101Z" });
  fixture.oldOnly = await root("Old edition only", { version: fixture.old });
  fixture.hidden = await root("Hidden", { status: "hidden" });
  fixture.disabled = await root("Disabled", { enabled: false });
  await root(" ");
  await db.query(`insert into comment_likes (comment_id, user_id) values ($1,$3),($2,$4)`,
    [fixture.hot, fixture.repeats, actor("reader-b"), actor("reader-a")]);
  await db.query(`insert into comments (paper_id, parent_id, user_id, content, danmaku_text, page, y_norm, created_at)
    select $1,$2,$3,'repeated reply','reply should be invisible',1,0,'2026-11-01T00:00:00Z' from generate_series(1, 7)`,
  [fixture.paper, fixture.repeats, actor("reader-b")]);
  await db.query(`insert into comments (paper_id, parent_id, user_id, content, danmaku_text, page, y_norm)
    values ($1,$2,$3,'reply a','reply a',1,0),($1,$2,$4,'reply b','reply b',1,0),($1,$2,$5,'self reply','self reply',1,0)`,
  [fixture.paper, fixture.hot, actor("reader-b"), actor("test-admin"), actor("reader-a")]);
}

await withVerificationRuntime(async ({ base, actors }) => {
  const guest = verificationClient(base);
  const owner = verificationClient(base);
  const reader = verificationClient(base);
  const { paper, private: privateId, version, old, wide, whole, hot, repeats, oldOnly, hidden, disabled } = fixture;
  const paperApi = `/api/papers/${paper}`;
  const feed = (client, params = {}) => client.request(`${paperApi}/danmaku?${new URLSearchParams({ version, ...params })}`);
  async function read(client, params) {
    const response = await feed(client, params);
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    return response.json();
  }
  assert.ok(await owner.login(actors["reader-a"].email, actors["reader-a"].password));
  assert.ok(await reader.login(actors["reader-b"].email, actors["reader-b"].password));

  const initial = await read(guest, { limit: 1 });
  assert.equal(initial.items[0].id, whole);
  assert.equal(initial.items[0].page, null);
  assert.deepEqual(Object.keys(initial.items[0]).sort(), ["id", "page", "text"]);
  const posted = await reader.request(`${paperApi}/comments`, { method: "POST", json: {
    anchor: { version: 2, type: "paper" }, kind: "question", content: "Published during latest pagination",
    danmaku: { enabled: true, text: "New live entry" },
  } });
  assert.equal(posted.status, 201, await posted.clone().text());
  const newId = String((await posted.json()).comment.id);
  let cursor = initial.nextCursor;
  const all = [...initial.items];
  while (cursor) {
    const next = await read(guest, { limit: 25, cursor });
    all.push(...next.items);
    cursor = next.nextCursor;
  }
  assert.deepEqual(all.slice(0, 4).map(({ id }) => id), [whole, wide, repeats, hot]);
  assert.equal(all.length, 104);
  assert.equal(new Set(all.map(({ id }) => id)).size, all.length);
  assert.ok(!all.some(({ id }) => [newId, oldOnly, hidden, disabled].includes(id)));
  assert.equal((await read(guest, { limit: 1 })).items[0].id, newId);
  console.log("PASS latest preserves timestamp precision and IDs across pages and concurrent publishing");

  const scoped = await read(guest, { scope: "page", page: 5 });
  assert.deepEqual(scoped.items.map(({ id }) => id), [wide]);
  assert.deepEqual((await read(guest, { version: old })).items.map(({ id }) => id), [newId, whole, oldOnly]);
  assert.deepEqual((await read(guest, { kind: "method" })).items, []);
  assert.equal((await guest.request(`/api/papers/${privateId}/danmaku`)).status, 404);
  assert.equal((await reader.request(`/api/papers/${privateId}/danmaku`)).status, 404);
  assert.equal((await guest.request(`/api/comments/${hidden}`)).status, 404);
  assert.equal((await feed(guest, { cursor: initial.nextCursor.slice(0, -1) + "!" })).status, 410);
  assert.equal((await feed(guest, { cursor: initial.nextCursor, scope: "page", page: 1 })).status, 410);
  assert.equal((await feed(reader, { cursor: initial.nextCursor })).status, 410);
  console.log("PASS page, version, kind, privacy and signed cursor isolation");

  const ranked = await read(guest, { sort: "hot", limit: 1 });
  assert.equal(ranked.items[0].id, hot);
  const like = (client, id) => client.request(`/api/comments/${id}/like`, { method: "POST" });
  assert.equal((await like(owner, hot)).status, 403);
  const admin = verificationClient(base);
  assert.ok(await admin.login(actors["test-admin"].email, actors["test-admin"].password));
  assert.ok((await like(admin, repeats)).ok);
  assert.ok((await like(reader, repeats)).ok);
  assert.ok((await like(reader, repeats)).ok);
  assert.ok((await owner.request(`/api/comments/${whole}`, { method: "DELETE" })).ok);
  const oldRanking = await read(guest, { sort: "hot", limit: 2, cursor: ranked.nextCursor });
  assert.deepEqual(oldRanking.items.map(({ id }) => id), [repeats, newId]);
  assert.equal((await read(guest, { sort: "hot", limit: 1 })).items[0].id, repeats);
  await read(guest, { sort: "hot", limit: 1 });
  assert.equal((await feed(guest, { sort: "hot", cursor: ranked.nextCursor })).status, 410);
  console.log("PASS hot uses effective likes and distinct repliers, preserves rank, skips withdrawals and evicts old snapshots");

  const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
  if (!executablePath) throw new Error("Set CHROME_PATH to a local Chromium browser");
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run", "--disable-gpu",
    "--disable-software-rasterizer", ...(process.env.HAPPYPAPER_TEST_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])] });
  try {
    const page = await browser.newPage();
    await page.bringToFront();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewport({ width: 1440, height: 960 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
    await page.goto(`${base}/read/${paper}?version=${version}&page=1`);
    try {
      await page.waitForSelector(`[data-danmaku-id="${wide}"]`, { timeout: 25_000 });
    } catch (error) {
      const state = await page.evaluate(() => {
        const overlay = document.querySelector("[data-danmaku-overlay]");
        return { visibility: document.visibilityState, dimensions: [overlay?.clientWidth, overlay?.clientHeight],
          status: document.querySelector("[data-pdf-status]")?.dataset.pdfStatus,
          alert: document.querySelector("[role=alert]")?.textContent,
          buttons: [...document.querySelectorAll("button")].map((button) => button.textContent).slice(0, 18) };
      });
      console.error({ state, errors });
      throw error;
    }
    await button(page, "暂停弹幕");
    await page.waitForFunction(() => document.querySelector(".hp-danmaku")?.getAnimations()[0]?.playState === "paused");
    await button(page, "播放弹幕");
    const seen = new Set();
    for (let batch = 0; batch < 24 && seen.size < 104; batch++) {
      await page.waitForSelector("[data-danmaku-id]", { timeout: 12_000 });
      const active = await page.$$eval("[data-danmaku-id]", (nodes) => nodes.map((node) => ({
        id: node.dataset.danmakuId, lane: node.dataset.danmakuLane, top: node.offsetTop,
        width: node.offsetWidth, area: node.parentElement.clientWidth,
        duration: node.getAnimations()[0]?.effect?.getTiming().duration,
      })));
      assert.ok(active.length <= 6);
      assert.equal(new Set(active.map(({ lane }) => lane)).size, active.length);
      for (const entry of active) {
        assert.ok(!seen.has(entry.id), `Repeated animation for ${entry.id}`);
        assert.ok(entry.width <= entry.area * 0.75 + 1);
        assert.ok(Math.abs(entry.duration - (entry.width + entry.area) / 130 * 1000) < 1);
        seen.add(entry.id);
      }
      await page.$$eval("[data-danmaku-id]", (nodes) => nodes.forEach((node) => node.getAnimations()[0]?.finish()));
      await page.waitForFunction((ids) => [...document.querySelectorAll("[data-danmaku-id]")]
        .every((node) => !ids.includes(node.dataset.danmakuId)), {}, active.map(({ id }) => id));
    }
    assert.equal(seen.size, 104);
    await delay(400);
    assert.equal(await page.$("[data-danmaku-id]"), null);
    await button(page, "重播本范围");
    await page.waitForSelector(`[data-danmaku-id="${wide}"]`);
    console.log("PASS 104 browser items play once across the viewport with six lanes, measured width and explicit replay");

    await page.select("select[aria-label='弹幕范围']", "page");
    await page.waitForFunction((wideId) => !document.querySelector(`[data-danmaku-id="${wideId}"]`), {}, wide);
    await button(page, "下一页");
    await page.waitForSelector('[data-pdf-page="2"][data-pdf-status="ready"]');
    assert.equal(await page.$("[data-danmaku-id]"), null);

    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.reload();
    await button(page, "弹幕列表");
    const list = await page.waitForSelector('section[aria-label="弹幕列表"] ul');
    assert.equal(await page.$("[data-danmaku-id]"), null);
    assert.ok((await list.evaluate((node) => node.textContent)).includes("A wide message"));
    await button(page, "P5 · A wide message with enough text to exercise the measured track width");
    await page.waitForSelector('section[aria-label="弹幕详情"] article');
    await button(page, "定位原文");
    await page.waitForSelector('[data-pdf-page="5"][data-pdf-status="ready"]');
    assert.deepEqual(errors, []);
    console.log("PASS page scope cancels prior lanes, reduced motion shows a static list and details jump to the source");
  } finally {
    await browser.close();
  }
}, { seed });

async function button(page, label) {
  const found = await page.waitForFunction((text) => [...document.querySelectorAll("button")].find((node) =>
    (node.getAttribute("aria-label") === text || node.textContent.trim() === text) && node.getBoundingClientRect().width > 0), {}, label);
  try { await found.asElement().click(); } finally { await found.dispose(); }
}
