/**
 * 主题与视觉令牌的浏览器验证（docs/03-requirements.md 3.3）。
 *
 *   node scripts/verify-theme.mjs
 *
 * 这个脚本是临时验证工具：用真实浏览器登录，切换三种主题，检查 <html> 上的
 * 解析结果、刷新后的持久化、以及深色主题下正文与卡片的实际计算颜色。
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const EMAIL = process.env.SMOKE_EMAIL ?? "reader@happypaper.local";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "reader12345";
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

const outDir = resolve(".verify/screenshots");
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type('input[type="email"]', EMAIL);
  await page.type('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click('button[type="submit"]'),
  ]);

  const themeState = () =>
    page.evaluate(() => ({
      resolved: document.documentElement.dataset.theme,
      pref: document.documentElement.dataset.themePref,
      stored: window.localStorage.getItem("happypaper-theme"),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyFg: getComputedStyle(document.body).color,
      surface:
        getComputedStyle(document.querySelector(".hp-card") ?? document.body).backgroundColor,
    }));

  const clickTheme = async (label) => {
    // The switch is a client component: a click that lands before hydration is
    // ignored, so wait until the control reflects the stored preference.
    await page.waitForFunction(
      () => document.querySelector('.hp-theme-switch button[aria-pressed="true"]') !== null,
      { timeout: 10000 },
    );
    await page.$eval(`.hp-theme-switch button[title*="${label}"]`, (button) => button.click());
    await new Promise((r) => setTimeout(r, 250));
  };

  await page.goto(`${BASE}/settings/privacy`, { waitUntil: "networkidle2" });
  check("设置页出现三态主题控件", (await page.$$(".hp-theme-switch button")).length === 3);

  await clickTheme("浅色");
  const light = await themeState();
  await page.screenshot({ path: `${outDir}/settings-light.png` });
  check(
    "浅色主题：<html data-theme=light>，背景为浅色",
    light.resolved === "light" && light.stored === "light",
    `${light.resolved} bg=${light.bodyBg}`,
  );

  await clickTheme("深色");
  const dark = await themeState();
  await page.screenshot({ path: `${outDir}/settings-dark.png` });
  check(
    "深色主题：<html data-theme=dark>，背景与文字颜色互换",
    dark.resolved === "dark" && dark.bodyBg !== light.bodyBg && dark.bodyFg !== light.bodyFg,
    `${dark.resolved} bg=${dark.bodyBg} fg=${dark.bodyFg}`,
  );
  check(
    "深色主题下卡片使用深色表面而不是白底",
    dark.surface !== light.surface && !dark.surface.includes("255, 255, 255"),
    `surface ${light.surface} -> ${dark.surface}`,
  );

  await page.reload({ waitUntil: "networkidle2" });
  const afterReload = await themeState();
  check(
    "刷新后仍然保持深色主题",
    afterReload.resolved === "dark" && afterReload.stored === "dark",
    `${afterReload.resolved} stored=${afterReload.stored}`,
  );

  // 跟随系统：系统偏好为深色时应解析为深色，切换为浅色后无需改设置即跟随。
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await clickTheme("跟随系统");
  const systemDark = await themeState();
  check(
    "跟随系统（系统深色）：偏好为 system，解析为 dark",
    systemDark.pref === "system" && systemDark.resolved === "dark",
    `pref=${systemDark.pref} resolved=${systemDark.resolved}`,
  );

  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await new Promise((r) => setTimeout(r, 250));
  const systemLight = await themeState();
  check(
    "系统改为浅色后自动跟随，无需重新设置",
    systemLight.pref === "system" && systemLight.resolved === "light",
    `pref=${systemLight.pref} resolved=${systemLight.resolved}`,
  );

  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await new Promise((r) => setTimeout(r, 250));
  await page.goto(`${BASE}/papers`, { waitUntil: "networkidle2" });
  const libraryDark = await page.evaluate(() => ({
    resolved: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  await page.screenshot({ path: `${outDir}/papers-dark.png` });
  check(
    "论文库页沿用同一深色主题，无闪烁回退",
    libraryDark.resolved === "dark",
    `papers=${libraryDark.resolved} bg=${libraryDark.bg}`,
  );

  await page.goto(`${BASE}/settings/privacy`, { waitUntil: "networkidle2" });
  await page.screenshot({ path: `${outDir}/settings-dark-final.png` });

  // 恢复到跟随系统以外之前的默认值，避免影响后续手工浏览
  await page.evaluate(() => window.localStorage.removeItem("happypaper-theme"));
} finally {
  await browser.close();
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log(`截图目录：${outDir}`);
if (failed.length > 0) process.exit(1);
