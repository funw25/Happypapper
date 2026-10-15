/**
 * 生产运行时的负载回归检查（docs/02-roadmap.md B1 遗留项）。
 *
 *   npm start                                    # 另开一个终端
 *   npm run verify:load
 *
 * 为什么单独一个脚本：生产模式曾出现 `EMFILE: too many open files`——开发服务器
 * 把 PGlite 实例缓存在模块作用域里，而生产分支没有缓存，于是每次属性访问（也就是
 * 每次查询）都新建一个实例、重新打开 `pglite.data` 与数据目录，几十个请求后文件
 * 描述符耗尽，页面开始 500。`verify:smoke` 的请求量不足以触发它，所以这里跑一批
 * 混合请求（页面、接口、PDF Range、静态资源）并盯住 5xx。
 *
 * 退出码：0 无 5xx，1 出现 5xx 或连接错误。
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const REQUESTS = Number(process.env.LOAD_REQUESTS ?? "160");
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? "8");

async function paperIds() {
  const response = await fetch(`${BASE}/api/papers`);
  const body = await response.json().catch(() => ({}));
  return (body.papers ?? []).map((paper) => paper.id);
}

const ids = await paperIds();
if (ids.length === 0) {
  console.error("库里没有论文，脚本无法覆盖阅读器与 PDF 路径；先跑 npm run db:seed 或导入一篇。");
  process.exit(2);
}

const targets = [
  { path: "/", expect: [200] },
  { path: "/papers", expect: [200] },
  { path: "/login", expect: [200] },
  { path: "/papers/new", expect: [200] },
  { path: "/legal/takedown", expect: [200] },
  { path: `/papers/${ids[0]}`, expect: [200] },
  { path: `/read/${ids[0]}`, expect: [200] },
  { path: "/api/papers", expect: [200] },
  // 详情路由只提供写操作，GET 返回 405 是预期行为。
  { path: `/api/papers/${ids[0]}`, expect: [200, 405] },
  { path: "/me", expect: [307] },
  { path: "/settings/privacy", expect: [307] },
  { path: "/pdf.worker.min.mjs", expect: [200] },
  { path: `/api/papers/${ids[0]}/pdf`, expect: [200, 206, 404], headers: { range: "bytes=0-1023" } },
];

const results = [];
let inFlight = 0;
let issued = 0;
let cursor = 0;

function record(target, status, ms, error) {
  results.push({ path: target.path, status, ms, error, expect: target.expect });
}

async function worker() {
  while (issued < REQUESTS) {
    const target = targets[cursor++ % targets.length];
    issued += 1;
    const started = Date.now();
    try {
      const response = await fetch(`${BASE}${target.path}`, {
        redirect: "manual",
        headers: target.headers ?? {},
      });
      await response.arrayBuffer();
      record(target, response.status, Date.now() - started, null);
    } catch (error) {
      record(target, 0, Date.now() - started, String(error?.message ?? error));
    }
  }
}

console.log(`对 ${BASE} 发起 ${REQUESTS} 个请求，并发 ${CONCURRENCY}…`);
const startedAt = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const totalMs = Date.now() - startedAt;

const errors = results.filter((row) => row.error !== null);
const serverErrors = results.filter((row) => row.status >= 500);
const unexpected = results.filter(
  (row) => row.status !== 0 && !row.expect.includes(row.status),
);

const timings = results.map((row) => row.ms).sort((a, b) => a - b);
const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor((p / 100) * timings.length))];

console.log(`\n完成 ${results.length} 个请求，用时 ${(totalMs / 1000).toFixed(1)}s`);
console.log(`状态分布：`, Object.entries(
  results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {}),
).map(([status, count]) => `${status}×${count}`).join(" "));
console.log(`延迟：p50 ${percentile(50)}ms，p95 ${percentile(95)}ms，max ${timings[timings.length - 1]}ms`);

function report(label, rows) {
  if (rows.length === 0) {
    console.log(`${label}：无`);
    return;
  }
  console.log(`${label}：${rows.length} 条`);
  for (const row of rows.slice(0, 8)) {
    console.log(`  ${row.path} → ${row.status || row.error}`);
  }
}

report("5xx", serverErrors);
report("预期之外的状态码", unexpected);
report("请求失败", errors);

const failed = serverErrors.length + unexpected.length + errors.length;
if (failed > 0) {
  console.log(`\n${failed} 个请求异常：生产运行时的问题要在这里暴露，而不是等读者碰到。`);
  process.exit(1);
}
console.log("\n无 5xx、无连接错误：文件描述符与数据库实例没有随请求增长。");
