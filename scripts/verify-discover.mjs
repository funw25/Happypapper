import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { verificationClient } from "./lib/verification-client.mjs";
import { withVerificationRuntime } from "./lib/verification-runtime.mjs";

const fixture = { old: crypto.randomUUID(), yesterday: crypto.randomUUID(), today: crypto.randomUUID(),
  private: crypto.randomUUID(), removed: crypto.randomUUID(), visits: crypto.randomUUID() };
const day = (date) => new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
const cutoff = new Date(day(new Date()) + "T00:00:00+08:00");
const start = new Date(cutoff.getTime() - 86400_000);
const old = new Date(start.getTime() - 1);
const last = new Date(cutoff.getTime() - 1);

async function seed(db) {
  const actors = (await db.query("select id,name from users")).rows;
  const actor = (name) => actors.find((row) => row.name === name).id;
  for (const [key, id] of Object.entries(fixture)) {
    await db.query("insert into papers (id,title,source,visibility,status,uploaded_by) values ($1,$2,'upload',$3,$4,$5)",
      [id, key + " ranking paper", key === "private" ? "private" : "public", key === "removed" ? "removed" : "active", actor("reader-a")]);
  }
  async function comment(key, content, at, { visible = true, enabled = true, anonymous = false } = {}) {
    return (await db.query(`insert into comments
      (paper_id,user_id,content,danmaku_text,visible_in_danmaku,is_anonymous,page,y_norm,created_at,status,anchor_v2)
      values ($1,$2,$3,$3,$4,$5,1,0,$6,$7,'{"type":"paper","version":2}') returning id`,
    [fixture[key], actor("reader-a"), content, enabled, anonymous, at, visible ? "visible" : "hidden"])).rows[0].id;
  }
  fixture.oldComment = await comment("old", "old cumulative leader", old);
  await comment("old", "old second", old);
  await comment("old", "old third", old);
  fixture.dailyComment = await comment("yesterday", "anonymous daily leader", start, { anonymous: true });
  await comment("yesterday", "last millisecond of yesterday", last);
  await comment("yesterday", "hidden yesterday excluded", start, { visible: false });
  await comment("yesterday", "disabled yesterday excluded", start, { enabled: false });
  fixture.todayComment = await comment("today", "exact cutoff excluded", cutoff);
  await comment("today", "today second excluded", cutoff);
  await comment("today", "today third excluded", cutoff);
  await comment("today", "today fourth excluded", cutoff);
  fixture.privateComment = await comment("private", "private body excluded", start);
  fixture.hiddenComment = await comment("yesterday", "hidden like excluded", start, { visible: false });
  await comment("removed", "removed body excluded", start);
  async function like(id, name, at) {
    await db.query("insert into comment_likes (comment_id,user_id,created_at) values ($1,$2,$3)", [id, actor(name), at]);
  }
  await like(fixture.oldComment, "reader-b", old);
  await like(fixture.oldComment, "test-admin", old);
  await like(fixture.oldComment, "muted-reader", old);
  await like(fixture.dailyComment, "reader-b", start);
  await like(fixture.dailyComment, "test-admin", last);
  await like(fixture.dailyComment, "reader-a", start); // self-like excluded
  await like(fixture.dailyComment, "unverified-reader", start);
  await like(fixture.todayComment, "reader-b", cutoff);
  await like(fixture.todayComment, "test-admin", cutoff);
  await like(fixture.privateComment, "reader-b", start);
  await like(fixture.hiddenComment, "reader-b", start);
  // Unlike after the cutoff changes cumulative scores but not yesterday's score.
  await db.query("delete from comment_likes where comment_id=$1 and user_id=$2", [fixture.dailyComment, actor("test-admin")]);
  for (const [key, at, total] of [["old", old, 2], ["yesterday", start, 3], ["today", cutoff, 4], ["private", start, 8], ["removed", start, 8]]) {
    await db.query(`insert into paper_visits (paper_id,visit_day,visitor_key,created_at)
      select $1,$2,'seed-' || i,$3 from generate_series(1,$4::int) i`, [fixture[key], day(at), at, total]);
  }
}

await withVerificationRuntime(async ({ base, actors }) => {
  const guest = verificationClient(base), reader = verificationClient(base), owner = verificationClient(base);
  assert.ok(await reader.login(actors["reader-b"].email, actors["reader-b"].password));
  assert.ok(await owner.login(actors["reader-a"].email, actors["reader-a"].password));
  async function board(period) {
    const response = await guest.request(`/api/discover?period=${period}`);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  const cumulative = await board("all"), daily = await board("today");
  assert.equal(cumulative.danmaku[0].id, fixture.today);
  assert.equal(cumulative.danmaku[0].total, 4);
  assert.equal(daily.dataDate, day(start));
  assert.equal(daily.cutoff, cutoff.toISOString());
  assert.deepEqual(daily.danmaku.map(({ id, total }) => [id, total]), [[fixture.yesterday, 2]]);
  assert.equal(cumulative.likes[0].id, fixture.oldComment);
  assert.equal(cumulative.likes[0].total, 3);
  assert.deepEqual(daily.likes.map(({ id, total }) => [id, total]), [[fixture.dailyComment, 2]]);
  assert.equal(daily.likes[0].authorName, null);
  assert.equal(cumulative.likes.find(({ id }) => id === fixture.dailyComment).total, 1);
  assert.equal(cumulative.visits[0].id, fixture.today);
  assert.deepEqual(daily.visits.map(({ id, total }) => [id, total]), [[fixture.yesterday, 3]]);
  const exposed = JSON.stringify([cumulative, daily]);
  for (const forbidden of [fixture.private, fixture.removed, "private body excluded", "hidden like excluded", "userId", "visitorKey"]) {
    assert.ok(!exposed.includes(forbidden), forbidden);
  }
  assert.equal((await guest.request("/api/discover?period=invalid")).status, 400);
  console.log("PASS all three rankings, exact Beijing midnight boundaries, previous-day cutoff, anonymous projection and private/removed/hidden exclusions");
  console.log("PASS likes use action time rather than comment age; self/unverified likes are excluded and post-cutoff unlikes preserve the daily score");

  const visitUrl = `/api/papers/${fixture.visits}/visit`;
  const repeated = await Promise.all(Array.from({ length: 12 }, () => reader.request(visitUrl, { method: "POST" })));
  for (const response of repeated) if (response.status !== 200) assert.fail(`visit ${response.status}: ${await response.text()}`);
  assert.equal((await Promise.all(repeated.map((response) => response.json()))).filter(({ counted }) => counted).length, 1);
  assert.equal((await (await guest.request(visitUrl, { method: "POST" })).json()).counted, true);
  assert.equal((await (await guest.request(visitUrl, { method: "POST" })).json()).counted, false);
  assert.equal((await (await owner.request(visitUrl, { method: "POST" })).json()).counted, true);
  assert.equal((await guest.request(visitUrl, { method: "POST", headers: { origin: "https://other.example" } })).status, 403);
  assert.equal((await guest.request(`/api/papers/${fixture.private}/visit`, { method: "POST" })).status, 404);
  assert.equal((await guest.request(`/api/papers/${fixture.removed}/visit`, { method: "POST" })).status, 404);
  assert.equal((await board("all")).visits.find(({ id }) => id === fixture.visits).total, 3);
  assert.ok(!(await board("today")).visits.some(({ id }) => id === fixture.visits));
  console.log("PASS concurrent account visits and signed-cookie guest visits deduplicate; current visits do not change today's closed board");

  const executablePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find(existsSync);
  assert.ok(executablePath, "Set CHROME_PATH for the browser acceptance check");
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run", "--disable-gpu",
    "--disable-software-rasterizer", ...(process.env.HAPPYPAPER_TEST_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [])] });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.click('nav a[href="/discover"]');
    await page.waitForSelector('h2#danmaku-ranking');
    assert.ok((await page.$eval("main", (node) => node.textContent)).includes("累计最多"));
    await page.click('a[href="/discover?period=today"]');
    await page.waitForFunction((date) => document.querySelector("main")?.textContent.includes("数据日期：" + date), {}, day(start));
    assert.ok((await page.$eval("main", (node) => node.textContent)).includes("anonymous daily leader"));
    const tracked = page.waitForResponse((response) => response.url().endsWith(`/papers/${fixture.visits}/visit`) && response.status() === 200);
    await page.goto(`${base}/papers/${fixture.visits}`);
    await tracked;
    assert.equal((await board("all")).visits.find(({ id }) => id === fixture.visits).total, 4);
    assert.deepEqual(errors, []);
    console.log("PASS browser home navigation, board switching and hydrated detail-page visit tracking");
  } finally { await browser.close(); }
}, { seed });
