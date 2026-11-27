import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { verificationClient } from "./lib/verification-client.mjs";
import { withVerificationRuntime } from "./lib/verification-runtime.mjs";

const executablePath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error("Set CHROME_PATH to a local Chromium browser");

const editionFixture = {
  paperId: crypto.randomUUID(),
  oldId: crypto.randomUUID(),
  latestId: crypto.randomUUID(),
  oldTitle: "旧版原文评论",
  latestTitle: "新版原文评论",
};

async function seedTwoVersions(db, storageDir) {
  const { paperId, oldId, latestId, oldTitle, latestTitle } = editionFixture;
  const editions = [
    { id: oldId, label: "版本 1", pages: 5, file: "F01-reading-notes.pdf", title: oldTitle, page: 4 },
    { id: latestId, label: "版本 2", pages: 1, file: "F08-image-only.pdf", title: latestTitle, page: 1 },
  ];
  await mkdir(storageDir, { recursive: true });
  await db.query("insert into papers (id, title, source, pdf_path) values ($1, $2, 'upload', $3)",
    [paperId, "双版本验收论文", editions[1].file]);
  for (const edition of editions) {
    await copyFile(new URL("../tests/fixtures/" + edition.file, import.meta.url), join(storageDir, edition.file));
    await db.query(`insert into paper_versions
      (id, paper_id, version_label, source_type, pdf_key, page_count, processing_state)
      values ($1, $2, $3, 'upload', $4, $5, 'legacy')`,
      [edition.id, paperId, edition.label, edition.file, edition.pages]);
    const anchor = { version: 2, type: "region", paperVersionId: edition.id, page: edition.page,
      rects: [{ x: 0.2, y: 0.2, width: 0.3, height: 0.05 }] };
    const { rows: [comment] } = await db.query(`insert into comments
      (paper_id, paper_version_id, content, page, y_norm, anchor_v2, anchor_version)
      values ($1, $2, $3, $4, 0.2, $5, 2) returning id`,
      [paperId, edition.id, edition.title, edition.page, JSON.stringify(anchor)]);
    if (edition.id === oldId) editionFixture.oldComment = comment.id;
  }
  await db.query("update papers set default_version_id = $1 where id = $2", [latestId, paperId]);
  await db.query(`insert into comments (paper_id, paper_version_id, content, page, y_norm, visible_in_danmaku)
    select $1, $2, '旧版第三页 ' || n, 3, 0, false from generate_series(1, 200) n`, [paperId, oldId]);
}

await withVerificationRuntime(async ({ base, actors }) => {
  let checks = 0;
  function check(condition, name) {
    assert.ok(condition, name);
    checks++;
    console.log("PASS " + name);
  }

  async function client(name) {
    const session = verificationClient(base);
    const { email, password } = actors[name];
    check((await session.login(email, password))?.name === name, "登录 " + name);
    return session;
  }
  const a = await client("reader-a");
  const b = await client("reader-b");
  async function upload(fileName, bytes) {
    const form = new FormData();
    form.set("visibility", "public");
    form.set("rightsClaimed", "true");
    form.set("file", new Blob([bytes], { type: "application/pdf" }), fileName);
    return a.request("/api/papers", { method: "POST", body: form });
  }
  async function sample(name) {
    const bytes = await readFile(new URL("../tests/fixtures/" + name, import.meta.url));
    const result = await upload(name, bytes);
    assert.equal(result.status, 201, await result.clone().text());
    return (await result.json()).paper;
  }
  const paper = await sample("F01-reading-notes.pdf");
  const rotated = await sample("F06-rotated.pdf");
  const image = await sample("F08-image-only.pdf");

  const invalid = await upload("broken.pdf", Buffer.from("%PDF-1.4\nThis is a damaged fixture"));
  check(invalid.status === 422 && (await invalid.json()).error === "PDF_INVALID", "解析拒绝损坏 PDF");
  const detail = (await (await a.request("/api/papers/" + paper.id)).json()).data;
  check(detail.versions[0].pageCount === 5 && detail.defaultVersionId === paper.defaultVersionId,
    "F01 文件解析后固定五页和默认版本");
  const foreignPdf = await b.request("/api/papers/" + paper.id + "/versions/" + rotated.defaultVersionId + "/pdf");
  check(foreignPdf.status === 404, "其他论文的版本不能用于当前论文");
  const validRegion = {
    version: 2, type: "region", paperVersionId: paper.defaultVersionId, page: 1,
    rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
  };
  const rejected = await Promise.all([
    { ...validRegion, page: 6 },
    { ...validRegion, rects: [{ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }] },
    { ...validRegion, paperVersionId: rotated.defaultVersionId },
  ].map((anchor) => b.request("/api/papers/" + paper.id + "/comments", {
    method: "POST", json: { kind: "other", content: "无效的锚点", anchor },
  })));
  const emptyComments = await (await b.request("/api/papers/" + paper.id + "/comments?page=1&spread=10")).json();
  check(rejected.every((response) => response.status === 400) && emptyComments.roots.length === 0,
    "越界页码、越界矩形和其他论文的版本均无法写入评论");

  const browser = await puppeteer.launch({
    executablePath, headless: true,
    args: [
      "--no-first-run", "--disable-extensions", "--disable-gpu", "--disable-software-rasterizer",
      // Opt in only for a restricted runner with the local fixture server and a fresh profile.
      ...(process.env.HAPPYPAPER_TEST_CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ],
  });
  console.log("Browser: " + await browser.version());
  try {
    async function pageFor(client) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 960 });
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
      for (const [name, value] of client.cookies) await context.setCookie({ name, value, url: base });
      return page;
    }
    const authorPage = await pageFor(a);
    const observerPage = await pageFor(b);
    const errors = [];
    for (const page of [authorPage, observerPage]) page.on("pageerror", (error) => errors.push(error.message));

    function readerUrl(row, page, comment) {
      return base + "/read/" + row.id + "?version=" + row.defaultVersionId + "&page=" + page +
        (comment ? "&comment=" + comment : "");
    }
    async function ready(page, number, text = false) {
      await page.waitForSelector('[data-pdf-page="' + number + '"][data-pdf-status="ready"]', { timeout: 60_000 });
      if (text) await page.waitForSelector(".hp-text-layer span[data-i]", { timeout: 15_000 });
    }
    async function selectText(page, first, last) {
      return page.evaluate(([firstIndex, lastIndex]) => {
        const layer = document.querySelector(".hp-text-layer");
        const start = layer.querySelector('[data-i="' + firstIndex + '"]').firstChild;
        const end = layer.querySelector('[data-i="' + lastIndex + '"]').firstChild;
        const range = document.createRange();
        range.setStart(start, 0);
        range.setEnd(end, Math.min(35, end.length));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const rect = range.getClientRects()[0];
        const parent = layer.closest("[data-pdf-page]").getBoundingClientRect();
        layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return { text: selection.toString(), x: rect.left - parent.left, y: rect.top - parent.top, w: rect.width, h: rect.height };
      }, [first, last]);
    }
    async function button(page, label) {
      const handle = await page.waitForFunction((text) => [...document.querySelectorAll("button")]
        .find((node) => node.textContent.trim() === text && node.getBoundingClientRect().width > 0), {}, label);
      try {
        await handle.asElement().click();
      } finally {
        await handle.dispose();
      }
    }
    async function send(page, text, shortText) {
      await page.locator("textarea[aria-label='评论正文']").fill(text, { typingThreshold: text.length + 1 });
      if (shortText) await page.locator("input[aria-label='弹幕短文案']").fill(shortText);
      const created = page.waitForResponse((response) => response.request().method() === "POST" &&
        response.url().endsWith("/comments"), { timeout: 20_000 });
      await button(page, "发送");
      const response = await created;
      assert.equal(response.status(), 201, await response.text());
      return (await response.json()).comment;
    }
    async function highlight(page) {
      await page.waitForSelector("[data-anchor-highlight]");
      return page.$eval("[data-anchor-highlight]", (node) => {
        const rect = node.getBoundingClientRect();
        const parent = node.closest("[data-pdf-page]").getBoundingClientRect();
        return { x: rect.left - parent.left, y: rect.top - parent.top, w: rect.width, h: rect.height };
      });
    }

    await Promise.all([authorPage.goto(readerUrl(paper, 4)), observerPage.goto(readerUrl(paper, 4))]);
    await Promise.all([ready(authorPage, 4, true), ready(observerPage, 4, true)]);
    const selection = await selectText(authorPage, 11, 13);
    check(selection.text.length > 100 && selection.w > 80 && selection.h > 4, "浏览器按实际字宽选中跨文字项原文");
    await authorPage.waitForFunction(() => document.querySelector("[data-anchor-label]")?.textContent.includes("原文选区"));
    await button(authorPage, "发弹幕");
    const shortDanmaku = "短文案经过阅读器播放";
    const body = "从浏览器选中原文后发布的弹幕" + "完整评论。".repeat(20);
    const posted = await send(authorPage, body, shortDanmaku);
    check(posted.anchor?.type === "text" && posted.anchor.rects.length >= 3 &&
      posted.anchor.paperVersionId === paper.defaultVersionId && Number.isInteger(posted.anchor.charStart),
      "发布的评论保存实际版本、矩形和规范化字符坐标");
    await observerPage.waitForSelector("#c" + posted.id, { timeout: 16_000 });
    check(await observerPage.$eval("#c" + posted.id, (card) => card.textContent.includes("从浏览器选中原文")), "另一浏览器收到新评论");
    await observerPage.bringToFront();
    await observerPage.waitForFunction(() => !document.hidden);
    await observerPage.waitForFunction((text) => [...document.querySelectorAll(".hp-danmaku")]
      .some((node) => node.textContent.endsWith(text)), {}, shortDanmaku);
    check(posted.danmakuText === shortDanmaku, "弹幕播放独立短文案，侧栏保留完整正文");
    await observerPage.goto(readerUrl(paper, 1, posted.id));
    const restored = await highlight(observerPage);
    check(Math.abs(selection.x - restored.x) < 5 && Math.abs(selection.y - restored.y) < 5 &&
      Math.abs(selection.w - restored.w) < 5, "重新打开深链接恢复同页原文，偏差小于 5 CSS px");
    for (const zoom of ["80", "100", "160", "200"]) {
      await observerPage.select("select[aria-label='缩放比例']", zoom);
      await observerPage.waitForFunction((width) => {
        const element = document.querySelector('[data-pdf-status="ready"] canvas');
        return element && Math.abs(element.getBoundingClientRect().width - width) < 4;
      }, {}, 612 * Number(zoom) / 100);
      const current = await highlight(observerPage);
      const ratio = Number(zoom) / 130;
      check(Math.abs(selection.x * ratio - current.x) < 5 && Math.abs(selection.y * ratio - current.y) < 5,
        "缩放 " + zoom + "% 保持原文位置");
    }
    await observerPage.select("select[aria-label='缩放比例']", "100");
    await ready(observerPage, 4);
    await mkdir(".verify/screenshots", { recursive: true });
    await observerPage.screenshot({ path: ".verify/screenshots/reader-v1-anchor.png" });

    const reply = await b.request("/api/papers/" + paper.id + "/comments", {
      method: "POST", json: { content: "第二位读者回复选区", kind: "explain", parentId: posted.id, anchor: { type: "paper", version: 2 } },
    });
    check(reply.status === 201 && (await reply.json()).comment.anchor.paperVersionId === paper.defaultVersionId,
      "回复继承原文版本和位置");

    const requestId = crypto.randomUUID();
    const headers = { "Idempotency-Key": requestId };
    const create = { method: "POST", headers, json: { kind: "other", content: "Idempotent draft", anchor: { type: "paper", version: 2 } } };
    const [first, replay] = await Promise.all([
      a.request("/api/papers/" + paper.id + "/comments", create),
      a.request("/api/papers/" + paper.id + "/comments", create),
    ]);
    const [one, two] = await Promise.all([first.json(), replay.json()]);
    check([first.status, replay.status].sort().join(",") === "200,201" && one.comment.id === two.comment.id,
      "并行重试同一个草稿只产生一条全文评论");

    await authorPage.goto(readerUrl(rotated, 1));
    await ready(authorPage, 1, true);
    const rotatedSelection = await selectText(authorPage, 12, 12);
    check(rotatedSelection.h > rotatedSelection.w, "90° 页面文字层与旋转方向一致");
    const rotatedComment = await send(authorPage, "旋转裁边样本");
    await authorPage.goto(readerUrl(rotated, 1, rotatedComment.id));
    const rotatedBack = await highlight(authorPage);
    check(Math.abs(rotatedSelection.x - rotatedBack.x) < 5 && Math.abs(rotatedSelection.y - rotatedBack.y) < 5,
      "非默认 CropBox 和旋转 90° 的坐标可往返");

    await authorPage.goto(readerUrl(image, 1));
    await ready(authorPage, 1);
    await button(authorPage, "框选区域");
    const area = await authorPage.$eval("[data-pdf-page]", (node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    await authorPage.mouse.move(area.left + 150, area.top + 145);
    await authorPage.mouse.down();
    await authorPage.mouse.move(area.left + 300, area.top + 230, { steps: 6 });
    await authorPage.mouse.up();
    await authorPage.waitForFunction(() => document.querySelector("[data-anchor-label]")?.textContent.startsWith("区域"));
    await button(authorPage, "写评论");
    const region = await send(authorPage, "无文本页框选");
    check(region.anchor?.type === "region" && region.anchor.rects.length === 1 && !region.quote, "无文本 PDF 可用区域锚点发评论");

    const { paperId, oldId, latestId, oldTitle, latestTitle, oldComment } = editionFixture;
    const editionsUrl = base + "/read/" + paperId;
    const editionsApi = "/api/papers/" + paperId;
    const oldComments = await (await b.request(editionsApi + "/comments?page=4&version=" + oldId)).json();
    check(oldComments.roots.length === 200 && !oldComments.roots.some((comment) => comment.id === oldComment),
      "普通列表达到上限时不会包含随后由深链接定位的评论");
    await observerPage.goto(editionsUrl + "?version=" + oldId + "&page=5");
    await ready(observerPage, 5, true);
    await observerPage.waitForSelector("#c" + oldComment);
    check(await observerPage.$eval("#reader-comments", (node, [oldText, newText]) =>
      node.textContent.includes(oldText) && !node.textContent.includes(newText), [oldTitle, latestTitle]),
      "旧版阅读页只加载该版本的定位评论");
    const scrollTop = await observerPage.$eval("[data-pdf-page]", (node) => {
      node.parentElement.scrollTop = 150;
      return node.parentElement.scrollTop;
    });
    const focusedList = observerPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === editionsApi + "/comments" && url.searchParams.get("page") === "4" &&
        url.searchParams.get("focus") === String(oldComment) && response.ok();
    });
    await button(observerPage, "定位原文");
    const { roots } = await (await focusedList).json();
    assert.ok(roots.some((comment) => comment.id === oldComment));
    await ready(observerPage, 4);
    await highlight(observerPage);
    await button(observerPage, "返回阅读位置");
    await ready(observerPage, 5);
    await observerPage.waitForFunction((top) => document.querySelector("[data-pdf-page]")?.parentElement.scrollTop === top, {}, scrollTop);
    check(scrollTop > 0, "查看相邻页原文后恢复原来的页码与滚动位置");
    await observerPage.select("select[aria-label='PDF 版本']", latestId);
    await observerPage.waitForFunction((text) => document.querySelector("#reader-comments")?.textContent.includes(text), {}, latestTitle);
    await ready(observerPage, 1);
    check(!(await observerPage.$("#c" + oldComment)), "切到新版后清除旧版评论及标记");
    await observerPage.goto(editionsUrl + "?page=4#c" + oldComment);
    await observerPage.waitForFunction((commentId) => new URL(location.href).searchParams.get("comment") === String(commentId), {}, oldComment);
    await ready(observerPage, 4, true);
    await observerPage.waitForSelector("#c" + oldComment);
    await highlight(observerPage);
    check(await observerPage.$eval("select[aria-label='PDF 版本']", (select) => select.value) === oldId,
      "旧式深链接切回对应版本并定位超出普通列表上限的评论");

    const progress = (versionId, page, yNorm) => a.request(editionsApi + "/progress", {
      method: "PUT", json: { versionId, page, yNorm },
    });
    const [oldSaved, latestSaved] = await Promise.all([progress(oldId, 5, 0.25), progress(latestId, 1, 0)]);
    const [oldProgress, latestProgress] = await Promise.all([oldId, latestId].map(async (version) =>
      (await (await a.request(editionsApi + "/progress?version=" + version)).json()).progress));
    check(oldSaved.ok && latestSaved.ok && oldProgress.page === 5 && oldProgress.yNorm === 0.25 && latestProgress.page === 1,
      "同时保存两个版本的阅读进度时各自保留页码和滚动位置");
    check(errors.length === 0, "浏览器运行无未处理异常" + (errors.length ? " " + errors.join("; ") : ""));
  } finally {
    await browser.close();
  }
  console.log("\n" + checks + " PDF reader checks passed");
}, { seed: seedTwoVersions });
