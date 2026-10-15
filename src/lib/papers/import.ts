import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { papers, type Paper } from "@/db/schema";
import { storage } from "@/lib/storage";
import { fetchMetadata, OpenAlexError, parseIdentifier, type PaperMetadata } from "./openalex";

const MAX_PDF_BYTES = 60 * 1024 * 1024;

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * A text layer is what sentence-level anchoring depends on. Compressed content
 * streams make operator sniffing unreliable, so look for a font dictionary,
 * which only a text-bearing PDF carries.
 */
export function detectTextLayer(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 512 * 1024));
  const marker = [0x2f, 0x46, 0x6f, 0x6e, 0x74]; // "/Font"
  let matched = 0;
  for (let i = 0; i < sample.length && matched < marker.length; i++) {
    matched = sample[i] === marker[matched] ? matched + 1 : sample[i] === marker[0] ? 1 : 0;
  }
  return matched === marker.length;
}

async function downloadPdf(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "HappyPaper/0.1 (research reader; contact: happypaper-dev@example.com)" },
    });
  } catch {
    throw new ImportError("PDF 下载失败：网络不可达", "PDF_UNREACHABLE", 502);
  }

  if (!response.ok) {
    throw new ImportError(`PDF 下载失败：HTTP ${response.status}`, "PDF_FETCH_FAILED", 502);
  }

  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_PDF_BYTES) {
    throw new ImportError("PDF 超过 60MB 限制", "PDF_TOO_LARGE", 413);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new ImportError("PDF 超过 60MB 限制", "PDF_TOO_LARGE", 413);
  }
  if (buffer.byteLength < 1024) {
    throw new ImportError("下载内容不是有效 PDF", "PDF_INVALID", 502);
  }
  return buffer;
}

async function downloadFirstAvailable(urls: string[]): Promise<{ bytes: Uint8Array; url: string }> {
  if (urls.length === 0) {
    throw new ImportError(
      "该论文没有可用的开放获取 PDF，请改用上传 PDF 的方式添加",
      "NO_OPEN_PDF",
      422,
    );
  }

  let lastError: unknown = null;
  for (const url of urls.slice(0, 5)) {
    try {
      return { bytes: await downloadPdf(url), url };
    } catch (error) {
      lastError = error;
      console.warn(`pdf candidate failed: ${url}`);
    }
  }

  if (lastError instanceof ImportError) throw lastError;
  throw new ImportError("开放获取 PDF 全部下载失败", "PDF_FETCH_FAILED", 502);
}

async function findExisting(source: string, externalId: string): Promise<Paper | null> {
  const [row] = await db
    .select()
    .from(papers)
    .where(and(eq(papers.source, source), eq(papers.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

export type ImportResult = {
  paper: Paper;
  created: boolean;
  pdfCached: boolean;
  pdfError: string | null;
};

function result(paper: Paper, created: boolean): ImportResult {
  return {
    paper,
    created,
    pdfCached: Boolean(paper.pdfPath),
    pdfError: paper.pdfFetchError,
  };
}

async function fetchPdfForCandidates(
  urls: string[],
): Promise<{ bytes: Uint8Array; url: string } | { error: ImportError }> {
  try {
    return await downloadFirstAvailable(urls);
  } catch (error) {
    if (error instanceof ImportError) return { error };
    return { error: new ImportError("开放获取 PDF 下载失败", "ALL_CANDIDATES_FAILED", 502) };
  }
}

/**
 * Imports a paper from an arXiv ID or DOI.
 *
 * Metadata and the PDF are separate steps on purpose (docs/03-requirements.md
 * 第 28 行): a record is created as soon as metadata resolves, and a PDF that
 * cannot be fetched leaves `pdfPath` empty with `pdfFetchError` set, so the
 * paper is searchable, linkable and retryable instead of being rejected.
 */
export async function importFromIdentifier(
  identifier: string,
  uploadedBy: string | null,
): Promise<ImportResult> {
  const parsed = parseIdentifier(identifier);
  if (!parsed) {
    throw new ImportError("无法识别该标识符，请填写 arXiv ID 或 DOI", "INVALID_IDENTIFIER");
  }

  const existing = await findExisting(parsed.source, parsed.id);
  if (existing) return result(existing, false);

  let metadata: PaperMetadata;
  try {
    metadata = await fetchMetadata(parsed);
  } catch (error) {
    if (error instanceof OpenAlexError) {
      if (error.kind === "not_found") {
        throw new ImportError("在 OpenAlex 中未找到该论文", "NOT_FOUND", 404);
      }
      if (error.kind === "rate_limited") {
        throw new ImportError("上游检索服务已限流，请稍后再试", "METADATA_RATE_LIMITED", 503);
      }
    }
    throw new ImportError("论文元数据获取失败", "METADATA_FETCH_FAILED", 502);
  }

  const paperId = crypto.randomUUID();
  const downloaded = await fetchPdfForCandidates(metadata.pdfCandidates);
  const failed = "error" in downloaded;

  let pdfPath: string | null = null;
  let hasTextLayer = true;
  if (!failed) {
    pdfPath = `${paperId}.pdf`;
    await storage.put(pdfPath, downloaded.bytes);
    hasTextLayer = detectTextLayer(downloaded.bytes);
  }

  const [created] = await db
    .insert(papers)
    .values({
      id: paperId,
      source: metadata.source,
      externalId: metadata.externalId,
      doi: metadata.doi,
      title: metadata.title,
      abstract: metadata.abstract,
      authors: metadata.authors,
      year: metadata.year,
      venue: metadata.venue,
      pdfPath,
      // The first candidate is what the retry button will try again, and it is
      // labelled as unverified while no copy is cached. When nothing was found,
      // the column stays null and the page says so.
      pdfUrl: failed ? (metadata.pdfCandidates[0] ?? null) : downloaded.url,
      pdfFetchError: failed ? downloaded.error.code : null,
      pdfCheckedAt: new Date(),
      license: metadata.license,
      visibility: "public",
      uploadedBy,
      hasTextLayer,
    })
    .returning();

  return result(created, true);
}

/**
 * Retries the remote fetch for a paper whose PDF is missing (PAPER-006). The
 * candidate list is rebuilt from the stored metadata rather than trusted from
 * the request, so a retry cannot be pointed at an arbitrary URL.
 */
export async function attachRemotePdf(paperId: string): Promise<ImportResult> {
  const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1);
  if (!paper) throw new ImportError("论文不存在", "NOT_FOUND", 404);
  if (paper.pdfPath) return result(paper, false);

  const candidates: string[] = [];
  if (paper.source === "arxiv" && paper.externalId) {
    candidates.push(`https://arxiv.org/pdf/${paper.externalId.replace(/v\d+$/i, "")}`);
  }
  if (paper.pdfUrl) candidates.push(paper.pdfUrl);

  const downloaded = await fetchPdfForCandidates(Array.from(new Set(candidates)));
  const now = new Date();

  if ("error" in downloaded) {
    const [updated] = await db
      .update(papers)
      .set({ pdfFetchError: downloaded.error.code, pdfCheckedAt: now })
      .where(eq(papers.id, paperId))
      .returning();
    return result(updated, false);
  }

  const pdfPath = `${paperId}.pdf`;
  await storage.put(pdfPath, downloaded.bytes);
  const [updated] = await db
    .update(papers)
    .set({
      pdfPath,
      pdfUrl: downloaded.url,
      pdfFetchError: null,
      pdfCheckedAt: now,
      hasTextLayer: detectTextLayer(downloaded.bytes),
    })
    .where(eq(papers.id, paperId))
    .returning();

  return result(updated, false);
}

export async function importFromUpload(
  file: File,
  uploadedBy: string,
  meta: { title?: string; authors?: string; year?: number | null; visibility: "public" | "private" },
): Promise<Paper> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new ImportError("只接受 PDF 文件", "NOT_PDF");
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new ImportError("PDF 超过 60MB 限制", "PDF_TOO_LARGE", 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  if (head !== "%PDF-") {
    throw new ImportError("文件内容不是有效 PDF", "PDF_INVALID");
  }

  const paperId = crypto.randomUUID();
  const pdfPath = `${paperId}.pdf`;
  await storage.put(pdfPath, bytes);

  const [created] = await db
    .insert(papers)
    .values({
      id: paperId,
      source: "upload",
      externalId: null,
      title: meta.title?.trim() || file.name.replace(/\.pdf$/i, ""),
      abstract: null,
      authors: meta.authors
        ? meta.authors.split(",").map((a) => a.trim()).filter(Boolean)
        : [],
      year: meta.year ?? null,
      pdfPath,
      pdfUrl: null,
      pdfFetchError: null,
      pdfCheckedAt: null,
      visibility: meta.visibility,
      uploadedBy,
      hasTextLayer: detectTextLayer(bytes),
    })
    .returning();

  return created;
}
