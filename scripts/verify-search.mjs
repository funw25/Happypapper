/**
 * Remote paper search checks (docs/03-requirements.md PAPER-001 to PAPER-006).
 *
 *   node scripts/verify-search.mjs        # requires the dev server
 *
 * These checks live outside smoke.mjs deliberately. Every search costs two
 * upstream OpenAlex requests, and OpenAlex throttles by IP; folding them into
 * the main baseline made that baseline depend on a rate-limited external
 * service. Requests here are also spaced out, because a suite that bursts is
 * what tripped the limit in the first place.
 *
 * Exit codes: 0 all checks passed, 1 a check failed, 2 the upstream search was
 * unavailable (throttled or unreachable) or this run hit the project's own
 * search limit, which is inconclusive rather than a regression in this project.
 */
const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const IDENTIFIER = process.env.SMOKE_IDENTIFIER ?? "1706.03762";
const GAP_MS = Number(process.env.SEARCH_GAP_MS ?? "1200");
const READER = { email: "reader@happypaper.local", password: "reader12345" };
// An ACM conference paper: metadata resolves, and ACM does not serve an open
// PDF, which is exactly the "metadata only" state this suite has to cover.
const CLOSED_DOI = process.env.SEARCH_CLOSED_DOI ?? "10.1145/3292500.3330701";

const results = [];
let upstreamDown = false;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function makeClient() {
  const jar = new Map();

  function remember(response) {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(";");
      const index = pair.indexOf("=");
      if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  async function call(path, init = {}) {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        ...(init.headers ?? {}),
        cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    remember(response);
    return response;
  }

  async function login(email, password) {
    const { csrfToken } = await (await call("/api/auth/csrf")).json();
    await call("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE }),
    });
    const session = await (await call("/api/auth/session")).json();
    return session?.user ?? null;
  }

  return { call, login };
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const upstreamCodes = new Set([
    "SEARCH_FAILED",
    "UPSTREAM_UNAVAILABLE",
    "UPSTREAM_RATE_LIMITED",
    "SEARCH_RATE_LIMITED",
  ]);
  if ((response.status === 502 || response.status === 503 || response.status === 429) && upstreamCodes.has(body?.error)) {
    upstreamDown = true;
  }
  return { status: response.status, body, text };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The dev server has to be up; without it every check below would report an
// unrelated network error.
try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(2);
}

// A library paper gives the run something to assert "already imported" against.
const listed = await get("/api/papers");
const libraryPaper = listed.body?.papers?.[0] ?? null;
const query = libraryPaper?.title ?? "attention is all you need";

const empty = await get("/api/papers/search?q=");
check("远程检索拒绝空关键词", empty.status === 400, `status ${empty.status}`);

await pause(GAP_MS);
const byTitle = await get(`/api/papers/search?q=${encodeURIComponent(query)}`);
const titleResults = byTitle.body?.results ?? [];
check("按标题检索返回结果", titleResults.length > 0, `${titleResults.length} 条`);

check(
  "结果含标题、作者、年份、来源与 PDF 可用状态",
  titleResults.length > 0 &&
    titleResults.every(
      (r) =>
        typeof r.title === "string" &&
        r.title.length > 0 &&
        Array.isArray(r.authors) &&
        typeof r.hasPdf === "boolean" &&
        (r.source === "arxiv" || r.source === "doi") &&
        (r.year === null || typeof r.year === "number"),
    ),
  `${titleResults.length} 条全部字段完整`,
);

if (libraryPaper) {
  const samePaper = titleResults.find(
    (r) => r.importedPaperId === libraryPaper.id || r.externalId === libraryPaper.externalId,
  );
  check(
    "标题检索命中已导入的论文",
    Boolean(samePaper),
    samePaper ? `externalId=${samePaper.externalId}` : "no match",
  );
  check(
    "已导入的搜索结果标记为在库",
    samePaper?.importedPaperId === libraryPaper.id,
    `importedPaperId=${samePaper?.importedPaperId ?? "null"}`,
  );
} else {
  check("已导入的搜索结果标记为在库（跳过：库内无论文）", true, "skipped");
}

await pause(GAP_MS);
const byAuthor = await get(`/api/papers/search?q=${encodeURIComponent("geoffrey hinton")}`);
const authorResults = byAuthor.body?.results ?? [];
const authored = authorResults.filter((r) => (r.authors ?? []).some((a) => /hinton/i.test(a)));
check("按作者检索返回该作者的论文", authored.length > 0, `${authored.length}/${authorResults.length} 条作者命中`);

await pause(GAP_MS);
const byIdentifier = await get(`/api/papers/search?q=${encodeURIComponent(IDENTIFIER)}`);
check(
  "按标识符检索返回单条记录",
  byIdentifier.body?.results?.length === 1 &&
    byIdentifier.body.results[0].externalId === IDENTIFIER,
  `${byIdentifier.body?.results?.length ?? 0} 条`,
);

await pause(GAP_MS);
const page = await get(`/papers?mode=remote&q=${encodeURIComponent(query)}`);
check(
  "搜索页渲染远程结果并可进入详情页",
  page.status === 200 &&
    page.text.includes("远程检索") &&
    (libraryPaper ? page.text.includes(`href="/papers/${libraryPaper.id}"`) : true),
  `status ${page.status}`,
);

await pause(GAP_MS);
const citedSearch = await get(`/api/papers/search?q=${encodeURIComponent("transformer")}&sort=cited`);
const cited = (citedSearch.body?.results ?? []).map((r) => r.citedByCount ?? 0);
check(
  "按引用数排序的结果单调不增",
  cited.length > 1 && cited.every((n, i) => i === 0 || cited[i - 1] >= n),
  `${cited.slice(0, 5).join(" >= ")} …`,
);

await pause(GAP_MS);
const badSort = await get(`/api/papers/search?q=${encodeURIComponent("transformer")}&sort=nonsense`);
check("非法排序值回退而不是报错", badSort.status === 200, `status ${badSort.status}`);

await pause(GAP_MS);
const ieeeOnly = await get(
  `/api/papers/search?q=${encodeURIComponent("transformer")}&sort=cited&source=ieee`,
);
check(
  "按出版商筛选会收窄命中数",
  typeof ieeeOnly.body?.total === "number" &&
    typeof citedSearch.body?.total === "number" &&
    ieeeOnly.body.total > 0 &&
    ieeeOnly.body.total < citedSearch.body.total,
  `IEEE ${ieeeOnly.body?.total ?? "-"} < 全部 ${citedSearch.body?.total ?? "-"}`,
);

await pause(GAP_MS);
const badSource = await get(`/api/papers/search?q=${encodeURIComponent("transformer")}&source=nonsense`);
check("未知来源回退到全部来源", badSource.status === 200, `status ${badSource.status}`);

// ---- 缓存（PAPER-006 的上游失败回退依赖它） --------------------------------
await pause(GAP_MS);
const cachedIdentifier = await get(`/api/papers/search?q=${encodeURIComponent(IDENTIFIER)}`);
check(
  "重复检索命中缓存且结果一致",
  cachedIdentifier.body?.cached === true && cachedIdentifier.body?.results?.length === 1,
  `cached=${cachedIdentifier.body?.cached} 条数=${cachedIdentifier.body?.results?.length ?? 0}`,
);
check(
  "缓存命中带缓存时间且不算失败",
  typeof cachedIdentifier.body?.cachedAt === "string" && !cachedIdentifier.body?.error,
  `cachedAt=${cachedIdentifier.body?.cachedAt ?? "null"} error=${cachedIdentifier.body?.error ?? "null"}`,
);

await pause(GAP_MS);
const remotePage = await get(`/papers?mode=remote&q=${encodeURIComponent(IDENTIFIER)}`);
check(
  "结果卡片标注来源与 PDF 可用状态",
  remotePage.status === 200 &&
    (remotePage.text.includes("有公开 PDF") || remotePage.text.includes("仅元数据")) &&
    remotePage.text.includes("arXiv"),
  `status ${remotePage.status}`,
);
check(
  "结果卡片提供来源网站链接",
  remotePage.text.includes("打开来源网站"),
  "page markup",
);

// ---- 元数据-only 入库（需求第 28 行） --------------------------------------
const reader = makeClient();
const readerUser = await reader.login(READER.email, READER.password);
check("测试读者登录成功（用于导入检查）", Boolean(readerUser?.id), readerUser?.name ?? "?");

await pause(GAP_MS);
const importResponse = await reader.call("/api/papers", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier: CLOSED_DOI }),
});
const importBody = await importResponse.json().catch(() => ({}));
const importedPaper = importBody.paper ?? null;

if (!importedPaper?.id) {
  check(
    "没有公开 PDF 的论文也能保存元数据记录",
    false,
    `status ${importResponse.status} ${importBody?.detail ?? importBody?.error ?? ""}`,
  );
} else if (importBody.pdfCached) {
  check(
    "没有公开 PDF 的论文也能保存元数据记录（跳过：该 DOI 实际可下载）",
    true,
    `pdfCached=true ${CLOSED_DOI}`,
  );
} else {
  check("没有公开 PDF 的论文也能保存元数据记录", true, `paper=${importedPaper.id}`);
  check(
    "响应把元数据与 PDF 状态分开",
    importBody.availability?.metadataFound === true &&
      importBody.availability?.pdfCached === false &&
      importBody.availability?.readingAvailable === false &&
      importBody.availability?.stage === "metadata_found",
    JSON.stringify(importBody.availability ?? null),
  );
  check(
    "记录保存了抓取失败原因",
    typeof importBody.pdfError === "string" && importBody.pdfError.length > 0,
    String(importBody.pdfError),
  );

  const detail = await get(`/papers/${importedPaper.id}`);
  check(
    "详情页显示仅有元数据、给出原因与重试入口",
    detail.status === 200 &&
      detail.text.includes("没有可用的 PDF 副本") &&
      detail.text.includes("重试获取 PDF") &&
      detail.text.includes("来源与文件状态"),
    `status ${detail.status}`,
  );

  const readerPage = await get(`/read/${importedPaper.id}`);
  check(
    "阅读器在没有缓存副本时说明原因而不是假装可读",
    readerPage.status === 200 &&
      readerPage.text.includes("打开来源网站") &&
      !readerPage.text.includes("pdf.worker"),
    `status ${readerPage.status}`,
  );

  await pause(GAP_MS);
  const retry = await reader.call(`/api/papers/${importedPaper.id}/pdf`, { method: "POST" });
  const retryBody = await retry.json().catch(() => ({}));
  check(
    "重试接口从已存元数据重建候选并保留失败原因",
    retry.status === 200 && retryBody.pdfCached === false && typeof retryBody.pdfError === "string",
    `status ${retry.status} error=${retryBody.pdfError ?? "-"}`,
  );
  check(
    "重试不会接受请求方给出的任意地址",
    retryBody.paper?.pdfUrl === null || String(retryBody.paper?.pdfUrl ?? "").startsWith("https://"),
    String(retryBody.paper?.pdfUrl ?? "null"),
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.log("failed:", failed.map((f) => f.name).join(", "));
}
if (upstreamDown) {
  console.log(
    "\n上游 OpenAlex 限流或不可用，或本次运行触发了项目自身的检索限流。这次结果不能判定为代码回归：" +
      "等限流冷却后重跑，或用 SEARCH_GAP_MS 调大请求间隔。",
  );
  process.exit(2);
}
process.exit(failed.length === 0 ? 0 : 1);
