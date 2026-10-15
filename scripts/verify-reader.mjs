/**
 * Drives a real browser through the reader to verify the product's core claim:
 * a comment published against a text selection is found again at the same place
 * after a reload and after a zoom change.
 *
 *   node scripts/verify-reader.mjs
 *
 * Uses an already-installed Chrome or Edge (puppeteer-core, no bundled
 * browser). Requires the dev server to be running.
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

// Use the host the dev server advertises. Next 16 refuses /_next/* dev
// resources for other origins unless allowedDevOrigins lists them, and a page
// whose chunks are refused renders but never hydrates.
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3100";
const BROWSERS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const executablePath = BROWSERS.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error("no Chrome or Edge found; set CHROME_PATH");
  process.exit(1);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-first-run", "--disable-extensions", "--window-size=1440,960"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 960 });

  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  // ---- authenticate -----------------------------------------------------
  // The login form is a client component; driving it would test React
  // hydration rather than the reader. The session cookie is obtained through
  // the same API the form uses and handed to the browser, and the check below
  // confirms the browser is recognised as logged in.
  const jar = new Map();
  async function authCall(path, init = {}) {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers ?? {}),
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    return response;
  }

  const { csrfToken } = await (await authCall("/api/auth/csrf")).json();
  await authCall("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      csrfToken,
      email: process.env.SMOKE_EMAIL ?? "reader@happypaper.local",
      password: process.env.SMOKE_PASSWORD ?? "reader12345",
      callbackUrl: BASE,
    }),
  });

  const sessionCookie = jar.get("authjs.session-token");
  check("取得会话 cookie", Boolean(sessionCookie), sessionCookie ? "authjs.session-token" : "missing");
  await browser.setCookie({
    name: "authjs.session-token",
    value: sessionCookie,
    url: BASE,
    path: "/",
    httpOnly: true,
  });

  // ---- open the reader --------------------------------------------------
  const papers = await (await fetch(`${BASE}/api/papers`)).json();
  const paper = papers.papers?.[0];
  if (!paper) throw new Error("no paper available; run scripts/smoke.mjs first");

  await page.goto(`${BASE}/read/${paper.id}?page=4`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hp-text-layer span[data-i]", { timeout: 60_000 });
  const spanCount = await page.$$eval(".hp-text-layer span[data-i]", (nodes) => nodes.length);
  check("阅读器渲染出 PDF 文本层", spanCount > 50, `${spanCount} 个文本项`);

  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session");
    return response.json();
  });
  check("浏览器被识别为已登录读者", Boolean(session?.user?.id), session?.user?.name ?? "no session");

  const canvasBox = await page.$eval("canvas", (node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
  }));
  check("画布已按页面尺寸渲染", canvasBox.width > 200 && canvasBox.height > 200, JSON.stringify(canvasBox));

  // ---- select a sentence and publish ------------------------------------
  const selection = await page.evaluate(() => {
    const layer = document.querySelector(".hp-text-layer");
    const spans = [...layer.querySelectorAll("span[data-i]")];
    const from = spans[38];
    const to = spans[45];
    if (!from || !to) return null;

    const range = document.createRange();
    range.setStart(from.firstChild, 0);
    range.setEnd(to.firstChild, to.textContent.length);
    const windowSelection = window.getSelection();
    windowSelection.removeAllRanges();
    windowSelection.addRange(range);

    layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { text: range.toString(), startTop: from.getBoundingClientRect().top };
  });
  check("在文本层上能建立选区", Boolean(selection?.text), (selection?.text ?? "").slice(0, 50));

  const anchorLabel = await page
    .waitForFunction(
      () => {
        const node = [...document.querySelectorAll("span")].find((el) =>
          el.textContent?.startsWith("锚点："),
        );
        return node ? node.textContent : false;
      },
      { timeout: 10_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  check("选区被转成锚点草稿", Boolean(anchorLabel), anchorLabel ?? "未出现锚点标签");

  const marker = `浏览器验证-${Date.now().toString(36)}`;
  await page.type('input[placeholder^="写下你的问题"]', marker);
  // A rejected publish (this project allows 5 comments per 60s per account) would
  // otherwise surface as an opaque wait timeout instead of a diagnosable failure.
  let publishFailed = null;
  await Promise.all([
    page
      .waitForFunction((text) => document.body.innerText.includes(text), { timeout: 20_000 }, marker)
      .catch(async () => {
        const body = await page.evaluate(() => document.body.innerText);
        publishFailed = /频繁|限流|失败/.test(body)
          ? "页面提示发送过于频繁：本项目限流为每账号 60 秒 5 条，请等一分钟再跑"
          : "点击发送后 20 秒内没有看到评论出现";
      }),
    page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        el.textContent?.includes("发送"),
      );
      button.click();
    }),
  ]);
  check(
    "发布评论成功",
    publishFailed === null,
    publishFailed ?? "侧栏已出现该评论",
  );
  if (publishFailed !== null) {
    console.log("\n发布未成功，后续锚点检查无法进行。");
    const failedSoFar = results.filter((r) => !r.ok);
    console.log(`${results.length - failedSoFar.length}/${results.length} checks passed`);
    process.exit(2);
  }
  check("发布后在侧栏可见", await page.evaluate((text) => document.body.innerText.includes(text), marker));

  // ---- what did the server store? ---------------------------------------
  const stored = await page.evaluate(async (paperId) => {
    const response = await fetch(`/api/papers/${paperId}/comments?page=4&spread=1`);
    return response.json();
  }, paper.id);

  const mine = [...(stored.roots ?? []), ...(stored.replies ?? [])].find(
    (comment) => comment.content === marker,
  );
  check("服务端保存了锚点", Boolean(mine), mine ? `page=${mine.page}, y=${mine.yNorm?.toFixed(3)}` : "未找到");
  check(
    "评论绑定了引用文本而非仅页面位置",
    Boolean(mine?.quote && mine.quote.length > 5) && mine?.anchorDegraded === false,
    `${(mine?.quote ?? "").slice(0, 40)}…`,
  );
  check("引用带有前后文", Boolean(mine?.quotePrefix) && Boolean(mine?.quoteSuffix), `${mine?.quotePrefix?.slice(-20)} | ${mine?.quoteSuffix?.slice(0, 20)}`);

  // ---- reload: the marker must land at the same place -------------------
  async function markerTop(id) {
    return page.evaluate((commentId) => {
      const sidebarAnchor = document.getElementById(`c${commentId}`);
      const dots = [...document.querySelectorAll("button[title]")].filter((el) =>
        (el.getAttribute("title") ?? "").includes("浏览器验证"),
      );
      const dot = dots[0];
      if (!dot) return { dotCenter: null, sidebarPresent: Boolean(sidebarAnchor) };
      const rect = dot.getBoundingClientRect();
      // The marker is centred on the anchor position via -translate-y-1/2.
      return { dotCenter: rect.top + rect.height / 2, sidebarPresent: Boolean(sidebarAnchor) };
    }, id);
  }

  async function pageTopFor(comment) {
    return page.evaluate((yNorm) => {
      const wrap = document.querySelector("canvas")?.parentElement;
      return wrap ? yNorm * wrap.getBoundingClientRect().height : null;
    }, comment.yNorm);
  }

  const wrapTop = await page.evaluate(
    () => document.querySelector("canvas").parentElement.getBoundingClientRect().top,
  );
  const expectedTop = await pageTopFor(mine);

  const before = await markerTop(mine.id);
  const deltaBefore =
    before?.dotCenter == null ? null : Math.abs(before.dotCenter - (wrapTop + expectedTop));
  check(
    "刷新前位置标记落在锚点 y 处",
    deltaBefore !== null && deltaBefore < 6,
    `偏差 ${deltaBefore === null ? "无标记" : `${deltaBefore.toFixed(1)}px`}`,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".hp-text-layer span[data-i]", { timeout: 60_000 });
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    { timeout: 60_000 },
    marker,
  );

  const wrapTopAfter = await page.evaluate(
    () => document.querySelector("canvas").parentElement.getBoundingClientRect().top,
  );
  const after = await markerTop(mine.id);
  const deltaAfter =
    after?.dotCenter == null ? null : Math.abs(after.dotCenter - (wrapTopAfter + expectedTop));
  check(
    "刷新后位置标记仍在同一处",
    deltaAfter !== null && deltaAfter < 6,
    `偏差 ${deltaAfter === null ? "无标记" : `${deltaAfter.toFixed(1)}px`}`,
  );

  // ---- zoom: the marker must follow the text, not a fixed pixel ---------
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === "+");
    button.click();
    button.click();
  });
  await page.waitForFunction(
    () => {
      const label = [...document.querySelectorAll("span")].find((el) => /^\d+%$/.test(el.textContent ?? ""));
      return label && Number.parseInt(label.textContent, 10) >= 160;
    },
    { timeout: 15_000 },
  );

  // The zoom label flips before the page finishes re-rendering at the new
  // scale. Measuring at that moment compared the marker's new position against
  // the old canvas height, which showed up as a fixed 54.6px偏差. Wait for the
  // canvas box to stop changing first.
  async function stableCanvasHeight(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    let stableSince = null;
    while (Date.now() < deadline) {
      const height = await page.evaluate(() => {
        const wrap = document.querySelector("canvas")?.parentElement;
        return wrap ? Math.round(wrap.getBoundingClientRect().height * 100) / 100 : null;
      });
      if (height !== last) {
        last = height;
        stableSince = Date.now();
      } else if (stableSince !== null && Date.now() - stableSince > 250) {
        return height;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return last;
  }

  const heightAtLabel = await page.evaluate(
    () => document.querySelector("canvas")?.parentElement.getBoundingClientRect().height ?? null,
  );
  const stableHeight = await stableCanvasHeight();

  const wrapTopZoom = await page.evaluate(
    () => document.querySelector("canvas").parentElement.getBoundingClientRect().top,
  );
  const expectedZoom = await pageTopFor(mine);
  const zoomed = await markerTop(mine.id);
  const deltaZoom =
    zoomed?.dotCenter == null ? null : Math.abs(zoomed.dotCenter - (wrapTopZoom + expectedZoom));
  check(
    "缩放后位置标记跟随文本重新定位",
    deltaZoom !== null && deltaZoom < 6,
    `偏差 ${deltaZoom === null ? "无标记" : `${deltaZoom.toFixed(1)}px`}` +
      `，画布高度 ${heightAtLabel} → ${stableHeight}`,
  );

  check("阅读过程中没有前端异常", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) console.log("failed:", failed.map((f) => f.name).join(", "));
process.exit(failed.length === 0 ? 0 : 1);
