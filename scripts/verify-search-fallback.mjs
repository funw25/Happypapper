/**
 * 缓存回退的分支验证（docs/03-requirements.md PAPER-006）。
 *
 *   node scripts/verify-search-fallback.mjs      # 需要开发服务器，约 12 分钟
 *
 * 为什么单独一个脚本：回退分支要求「同一个关键词先成功缓存、缓存过期、之后又打
 * 不到上游」。真实场景里它由 OpenAlex 限流触发，时间点不可控，所以这里用项目自
 * 身的检索限流当作触发器，走的是同一段回退代码。
 *
 * 步骤：
 * 1. 用一个只属于本脚本的标识符写法检索一次，写入缓存。
 * 2. 再检索一次，确认命中缓存。
 * 3. 等缓存超过新鲜期（默认 10 分钟，加 60 秒余量）。等待期间一次请求都不发，
 *    否则会把缓存重新写热，过期窗口随之消失。
 * 4. 用互不相同、会立刻返回 404 的 DOI 把自身限流额度打满。这些请求很快，因此
 *    能落在同一个 60 秒窗口里；自由文本检索每次要等上游重试，反而打不满。
 * 5. 再检索第 1 步的关键词：应当返回缓存结果，并标记 stale 与限流原因。
 *
 * 退出码：0 通过，1 失败，2 预热或等待期间开发服务器被重启（缓存丢失，无法判定）。
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const ARXIV_ID = process.env.SMOKE_IDENTIFIER ?? "1706.03762";
// 与其它脚本使用的写法不同，这样缓存键不会与 verify:search 的预热互相影响。
const WARM_QUERY = `https://doi.org/10.48550/arxiv.${ARXIV_ID.replace(/v\d+$/i, "")}`;
const FRESH_MS = Number(process.env.SEARCH_CACHE_FRESH_MS ?? String(10 * 60 * 1000));
const WAIT_MS = Number(process.env.FALLBACK_WAIT_MS ?? String(FRESH_MS + 60_000));
const EXHAUST_ATTEMPTS = Number(process.env.FALLBACK_EXHAUST_ATTEMPTS ?? "45");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function search(query) {
  const response = await fetch(`${BASE}/api/papers/search?q=${encodeURIComponent(query)}`);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(2);
}

// 1. 预热缓存：标识符走单篇解析，不依赖自由文本检索。
const warm = await search(WARM_QUERY);
check(
  "标识符检索成功并把结果写入缓存",
  warm.status === 200 && (warm.body?.results?.length ?? 0) === 1,
  `status ${warm.status} cached=${warm.body?.cached} 条数=${warm.body?.results?.length ?? 0}`,
);
if (warm.status !== 200) {
  console.log("\n上游不可用，无法预热缓存；等限流冷却后重跑。");
  process.exit(2);
}

// 2. 命中新鲜缓存，且不计入限流。
const hit = await search(WARM_QUERY);
check("同一关键词立刻再检索命中缓存", hit.body?.cached === true, `cached=${hit.body?.cached}`);

// 3. 等待缓存过期。期间不发请求。
const minutes = Math.round(WAIT_MS / 60000);
console.log(`\n等待 ${minutes} 分钟让缓存进入过期但可回退的窗口（此期间不发起请求）…`);
await pause(WAIT_MS);

// 4. 打满自身限流额度：这些 DOI 都不存在，上游会立刻回 404，因此单次请求很快，
//    能在同一个 60 秒窗口内累积到上限。
let limited = null;
for (let index = 0; index < EXHAUST_ATTEMPTS; index++) {
  const probe = await search(`10.48550/arxiv.1706.9999${index}`);
  if (probe.body?.error === "SEARCH_RATE_LIMITED") {
    limited = probe;
    break;
  }
}
check(
  "连续检索会触发项目自身的限流",
  limited !== null,
  limited
    ? `第 ${results.length} 次探测触发，retryAfter=${limited.body?.retryAfterSeconds ?? "-"} 秒`
    : `${EXHAUST_ATTEMPTS} 次未触发`,
);

// 5. 此时再检索已缓存的关键词：应当回退到缓存并说明原因。
const fallback = await search(WARM_QUERY);
if (fallback.body?.cached !== true) {
  console.log("\n缓存已丢失（开发服务器可能被重启），这次结果不判定。");
  process.exit(2);
}
check(
  "上游/限流失败时返回缓存结果",
  fallback.status === 200 && (fallback.body?.results?.length ?? 0) > 0,
  `status ${fallback.status} 条数=${fallback.body?.results?.length ?? 0}`,
);
if (fallback.body?.stale !== true && limited === null) {
  console.log("\n未能触发限流，且缓存被重新写热，这次结果不判定。");
  process.exit(2);
}
check(
  "回退结果被标记为过期",
  fallback.body?.stale === true,
  `stale=${fallback.body?.stale}`,
);
check(
  "回退结果带上失败原因",
  ["SEARCH_RATE_LIMITED", "UPSTREAM_RATE_LIMITED", "UPSTREAM_UNAVAILABLE"].includes(
    fallback.body?.error,
  ),
  `error=${fallback.body?.error ?? "null"}`,
);

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((row) => row.name).join(", "));
  process.exit(1);
}
