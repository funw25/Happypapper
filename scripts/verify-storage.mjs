/**
 * 存储驱动验证（docs/02-roadmap.md B3 的对象存储项）。
 *
 *   npm run verify:storage                    # 默认要求服务器用的是 local 驱动
 *   EXPECT_STORAGE_DRIVER=s3 npm run verify:storage
 *
 * 覆盖 PDF 从上传、落库、按 Range 读取到删除的完整链路，并逐字节比对内容：对象存储
 * 最容易出的问题是「能上传能下载，但内容被截断或 Range 偏移一位」，只断言状态码
 * 是发现不了的。
 *
 * 服务器用的是哪个驱动从它的启动日志读（`[storage] driver=…`），不新增对外接口。
 * 驱动不符时以退出码 2 结束：那说明这次跑的不是你想验证的那套存储。
 *
 * 退出码：0 通过，1 失败，2 无法判定（服务器不可达，或驱动不匹配）。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3100";
const DEV_LOG = resolve(process.env.DEV_LOG ?? ".next/dev/logs/next-development.log");
const EXPECTED_DRIVER = process.env.EXPECT_STORAGE_DRIVER ?? "local";
const READER = { email: "reader@happypaper.local", password: "reader12345" };
const ADMIN = { email: "admin@happypaper.local", password: "admin12345" };

const results = [];
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

/**
 * 一个最小但结构完整的 PDF：带 `/Font`（`detectTextLayer` 据此判断能不能做句子级
 * 定位），体量与内容都便于逐字节比对。
 */
function samplePdf(tag) {
  const text = `HappyPaper storage probe ${tag}`;
  const body = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${text.length + 20} >> stream`,
    `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`,
    "endstream endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
  // 补足填充，确保内容长度明显超过 1KB，能暴露截断类问题。
  const padding = `\n% ${"x".repeat(2000)}\n`;
  return new TextEncoder().encode(body + padding);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

try {
  await fetch(`${BASE}/login`);
} catch {
  console.error(`dev server not reachable at ${BASE}; start it with npm run dev`);
  process.exit(2);
}

const reader = makeClient();
check("测试账号登录成功", Boolean((await reader.login(READER.email, READER.password))?.id), READER.email);

const admin = makeClient();
check("管理员登录成功", Boolean((await admin.login(ADMIN.email, ADMIN.password))?.id), ADMIN.email);

/**
 * 存储模块是第一次用到时才加载的，启动日志因此要等一次真实读取之后才出现。
 * 先随便读一篇已有论文的 PDF 把驱动「叫醒」，再读日志，避免把「还没加载」误判成
 * 「驱动未知」。
 */
function lastDriverFromLog() {
  try {
    const lines = readFileSync(DEV_LOG, "utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index--) {
      const match = lines[index].match(/\[storage\] driver=(\w+)/);
      if (match) return match[1];
    }
  } catch {
    return null;
  }
  return null;
}

const warmup = await (await reader.call("/api/papers")).json().catch(() => ({}));
if (warmup.papers?.[0]?.id) {
  await reader.call(`/api/papers/${warmup.papers[0].id}/pdf`).catch(() => {});
}

let driver = lastDriverFromLog();
for (let attempt = 0; driver === null && attempt < 20; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  driver = lastDriverFromLog();
}

check("能从服务器日志确认当前存储驱动", driver !== null, `driver=${driver ?? "unknown"}`);
if (driver !== EXPECTED_DRIVER) {
  console.error(
    `\n服务器当前用的是 ${driver ?? "未知"} 驱动，而这次要验证 ${EXPECTED_DRIVER}。` +
      `${EXPECTED_DRIVER === "s3" ? "请用 STORAGE_DRIVER=s3 与 S3_* 环境变量重启服务器。" : ""}`,
  );
  process.exit(2);
}

// ---- 上传 ----------------------------------------------------------------
const payload = samplePdf(Date.now());
const form = new FormData();
form.set("file", new Blob([payload], { type: "application/pdf" }), "storage-probe.pdf");
form.set("title", `存储探针 ${Date.now()}`);
form.set("visibility", "public");

const uploadResponse = await reader.call("/api/papers", { method: "POST", body: form });
const uploaded = await uploadResponse.json().catch(() => ({}));
const paper = uploaded.paper ?? null;
check(
  "上传 PDF 后建库成功",
  uploadResponse.status === 201 && Boolean(paper?.id) && Boolean(paper?.pdfPath),
  `status ${uploadResponse.status} key=${paper?.pdfPath ?? "-"}`,
);

if (!paper?.id) {
  console.log("\n上传失败，后续检查无法进行。");
  process.exit(1);
}

// ---- 完整下载并逐字节比对 -------------------------------------------------
const fullResponse = await reader.call(`/api/papers/${paper.id}/pdf`);
const fullBytes = new Uint8Array(await fullResponse.arrayBuffer());
check(
  "完整下载的字节与上传内容一致",
  fullResponse.status === 200 && fullBytes.byteLength === payload.byteLength && sha256(fullBytes) === sha256(payload),
  `status ${fullResponse.status} ${fullBytes.byteLength}/${payload.byteLength} bytes`,
);
check(
  "响应头带 content-length 与 accept-ranges",
  fullResponse.headers.get("content-length") === String(payload.byteLength) &&
    fullResponse.headers.get("accept-ranges") === "bytes",
  `content-length=${fullResponse.headers.get("content-length")}`,
);

// ---- Range 读取 -----------------------------------------------------------
const start = 100;
const end = 599;
const rangeResponse = await reader.call(`/api/papers/${paper.id}/pdf`, {
  headers: { range: `bytes=${start}-${end}` },
});
const rangeBytes = new Uint8Array(await rangeResponse.arrayBuffer());
const expectedSlice = payload.slice(start, end + 1);
check(
  "Range 请求返回 206 且字节区间正确",
  rangeResponse.status === 206 &&
    rangeBytes.byteLength === end - start + 1 &&
    sha256(rangeBytes) === sha256(expectedSlice),
  `status ${rangeResponse.status} ${rangeBytes.byteLength} bytes`,
);
check(
  "Range 响应带 content-range",
  rangeResponse.headers.get("content-range") === `bytes ${start}-${end}/${payload.byteLength}`,
  rangeResponse.headers.get("content-range") ?? "-",
);

const openRange = await reader.call(`/api/papers/${paper.id}/pdf`, {
  headers: { range: `bytes=${payload.byteLength + 10}-` },
});
check("越界的 Range 返回 416", openRange.status === 416, `status ${openRange.status}`);

// ---- 删除（管理下架同时删文件） -------------------------------------------
const takedown = await admin.call(`/api/admin/papers/${paper.id}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ visibility: "private", removeFile: true }),
});
const takedownBody = await takedown.json().catch(() => ({}));
check(
  "下架并删除文件后库里不再指向 PDF",
  takedown.status === 200 && takedownBody.pdfPath === null,
  `status ${takedown.status} pdfPath=${String(takedownBody.pdfPath)}`,
);

const afterDelete = await reader.call(`/api/papers/${paper.id}/pdf`);
check("删除后读取返回 404", afterDelete.status === 404, `status ${afterDelete.status}`);

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed（驱动：${driver}）`);
if (failed.length > 0) {
  console.log("failed:", failed.map((row) => row.name).join(", "));
  process.exit(1);
}
