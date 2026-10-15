/**
 * Verifies the position-anchoring algorithm against the real cached PDF.
 *
 *   node scripts/verify-anchor.mjs
 *
 * A comment stores page + normalized y + the quoted text + surrounding context.
 * Recovery has to survive a different PDF.js text layer: different item
 * chunking, different whitespace, hyphenation across a line break, changed
 * case, and typographic quotes. This script loads the cached PDF, extracts a
 * real sentence, and replays those variations through src/lib/anchor.ts.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  buildPageIndex,
  buildQuoteContext,
  findQuote,
  normalizeForMatch,
  partAtOffset,
} from "../src/lib/anchor.ts";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function newestPdf() {
  const dir = resolve(process.env.STORAGE_DIR ?? "./storage/pdfs");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".pdf"));
  if (files.length === 0) throw new Error(`no cached PDF in ${dir}; run scripts/smoke.mjs first`);

  const withTime = await Promise.all(
    files.map(async (file) => ({ file, time: (await stat(join(dir, file))).mtimeMs })),
  );
  withTime.sort((a, b) => b.time - a.time);
  return join(dir, withTime[0].file);
}

const pdfPath = process.env.ANCHOR_PDF ?? (await newestPdf());
console.log(`pdf: ${pdfPath}\n`);

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(await readFile(pdfPath));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
const pageNumber = Number(process.env.ANCHOR_PAGE ?? 4);
const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
const content = await page.getTextContent();

const parts = content.items
  .filter((item) => "str" in item)
  .map((item) => ({ text: item.str }))
  .filter((part) => part.text.length > 0);

check("从真实 PDF 提取到文本项", parts.length > 20, `第 ${pageNumber} 页 ${parts.length} 个文本项`);

const flat = parts.map((p) => p.text).join(" ");
const index = buildPageIndex(parts);

// Pick a sentence in the middle of the page, the way a selection would.
const start = Math.floor(flat.length * 0.35);
const end = Math.min(flat.length, start + 90);
const { quote, quotePrefix, quoteSuffix } = buildQuoteContext(flat, start, end);

check("构造出待锚定的文本引用", quote.length > 20, `“${quote.slice(0, 48)}…”`);

const hit = findQuote(index, quote, quotePrefix, quoteSuffix);
check("在同一文本层上能定位该引用", hit !== null, hit ? `part=${hit.partIndex}` : "未命中");

if (hit) {
  // buildQuoteContext offsets are positions in the raw text; the index is
  // normalized, so map the expectation through the raw parts instead.
  const rawStarts = [];
  let acc = 0;
  for (const part of parts) {
    rawStarts.push(acc);
    acc += part.text.length + 1;
  }
  const expectedPart = rawStarts.findIndex(
    (rawStart, i) => start >= rawStart && start < rawStart + parts[i].text.length + 1,
  );
  check(
    "命中项与选区起始项一致",
    Math.abs(expectedPart - hit.partIndex) <= 1,
    `expected≈${expectedPart}, got=${hit.partIndex}`,
  );
  check(
    "命中区间等于归一化后的引用",
    index.normalized.slice(hit.offset, hit.offset + normalizeForMatch(quote).length) ===
      normalizeForMatch(quote),
  );
}

// ---- re-render: same text, different item chunking ----------------------
const regrouped = [];
for (let i = 0; i < parts.length; i += 3) {
  regrouped.push({ text: parts.slice(i, i + 3).map((p) => p.text).join(" ") });
}
const regroupedIndex = buildPageIndex(regrouped);
const regroupedHit = findQuote(regroupedIndex, quote, quotePrefix, quoteSuffix);
check(
  "文本层分块方式变化后仍能定位",
  regroupedHit !== null &&
    regroupedIndex.normalized.slice(
      regroupedHit.offset,
      regroupedHit.offset + normalizeForMatch(quote).length,
    ) === normalizeForMatch(quote),
  regroupedHit ? `part=${regroupedHit.partIndex}` : "未命中",
);
check(
  "重新分块后仍能映射回具体文本项",
  regroupedHit !== null && partAtOffset(regroupedIndex, regroupedHit.offset) !== null,
);

// ---- re-render: whitespace, hyphenation, case, quotes -------------------
const messy = parts.map((part) => ({
  text: part.text
    .replace(/e/g, "E")
    .replace(/\s+$/, "")
    .replace(/([a-z])-([a-z])/g, "$1- $2")
    .replace(/'/g, "\u2019"),
}));
const messyIndex = buildPageIndex(messy);
const messyQuote = quote.toUpperCase().replace(/\s+/g, "   ").replace(/-/g, "- ");
const messyHit = findQuote(
  messyIndex,
  messyQuote,
  quotePrefix.toUpperCase(),
  quoteSuffix.toUpperCase(),
);
check(
  "大小写、空格差异与连字符换行后仍能定位",
  messyHit !== null,
  messyHit ? `part=${messyHit.partIndex}` : "未命中",
);

// ---- disambiguation: the same sentence twice on one page ----------------
const sentence = "We observed a significant improvement over the baseline.";
const twice = [
  { text: "Intro. " },
  { text: sentence },
  { text: " Some discussion follows here. " },
  { text: sentence },
  { text: " End of section." },
];
const twiceIndex = buildPageIndex(twice);
const firstHit = findQuote(twiceIndex, sentence, "Intro.", "Some discussion");
const secondHit = findQuote(twiceIndex, sentence, "discussion follows here.", "End of section.");
check(
  "同一句出现两次时用前后文选中正确的一处",
  firstHit !== null && secondHit !== null && firstHit.offset !== secondHit.offset,
  `first=${firstHit?.offset}, second=${secondHit?.offset}`,
);
check(
  "选中位置分别落在第 2 项与第 4 项",
  firstHit?.partIndex === 1 && secondHit?.partIndex === 3,
  `first.part=${firstHit?.partIndex}, second.part=${secondHit?.partIndex}`,
);

// ---- degraded cases -----------------------------------------------------
check("空引用返回未命中而不是抛错", findQuote(index, "", null, null) === null);
check("不存在的引用返回未命中", findQuote(index, "zzzz-not-in-this-document-qqqq", null, null) === null);

await doc.destroy?.();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
