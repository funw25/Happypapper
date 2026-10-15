/**
 * 检索表单的防抖与结果渲染（docs/03-requirements.md PAPER-001、PAPER-006）。
 *
 *   node scripts/verify-search-ui.mjs     # 需要开发服务器 + 本机 Chrome/Edge
 *
 * 逐字输入如果每次按键都发起检索，等于按字符数放大上游请求量。这里用真实浏览器
 * 快速输入一长串字符，统计落地的跳转次数，并确认结果区最终渲染出内容。
 */
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const IDENTIFIER = process.env.SMOKE_IDENTIFIER ?? "1706.03762";
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
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const navigations = [];
  page.on("request", (request) => {
    const url = request.url();
    // App Router 的同路由跳转会走 RSC 取数（带 _rsc 参数）而不是文档导航，
    // 因此两种都算，判据只看是否带上了关键词。
    if (url.startsWith(`${BASE}/papers?`) && url.includes("q=")) navigations.push(url);
  });

  await page.goto(`${BASE}/papers?mode=remote`, { waitUntil: "networkidle2" });
  await page.waitForSelector('input[name="q"]', { timeout: 10000 });

  const before = navigations.length;
  // 逐字快速输入：防抖为 400ms，因此整串输入应当只落地少量跳转。
  await page.focus('input[name="q"]');
  for (const character of IDENTIFIER) {
    await page.keyboard.type(character);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  await page.waitForFunction(
    () => document.body.innerText.includes("远程检索“"),
    { timeout: 30000 },
  ).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 800));
  const typedNavigations = navigations.length - before;

  check(
    "连续输入只触发少量检索跳转",
    typedNavigations >= 1 && typedNavigations <= 2,
    `${IDENTIFIER.length} 次按键 → ${typedNavigations} 次跳转`,
  );
  check(
    "最后一次跳转带上完整关键词",
    navigations[navigations.length - 1]?.includes(encodeURIComponent(IDENTIFIER)),
    (navigations[navigations.length - 1] ?? "none").replace(BASE, ""),
  );

  const pageText = await page.evaluate(() => document.body.innerText);
  check(
    "结果区渲染出论文或可理解的空状态",
    pageText.includes("远程检索“") &&
      (pageText.includes("仅元数据") ||
        pageText.includes("有公开 PDF") ||
        pageText.includes("没有匹配的论文") ||
        pageText.includes("缓存结果") ||
        pageText.includes("上游")),
    pageText.slice(0, 60).replace(/\s+/g, " "),
  );

  // 结果区稳定后再清空输入框，确认回退到本地库视图。用真实键盘事件：直接改
  // value 不会经过 React 的受控输入，三击选中在这里也不可靠。
  await page.click('input[name="q"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.waitForFunction(
    () => document.body.innerText.includes("本地论文库（"),
    { timeout: 30000 },
  ).catch(() => {});
  const cleared = await page.evaluate(() => document.body.innerText);
  check(
    "清空关键词后回到本地论文库视图",
    cleared.includes("本地论文库（"),
    `${page.url().replace(BASE, "")} · ${cleared.replace(/\s+/g, " ").slice(0, 80)}`,
  );
} finally {
  await browser.close();
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((row) => row.name).join(", "));
  process.exit(1);
}
