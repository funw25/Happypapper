import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { papers, type Paper } from "@/db/schema";
import { storage } from "@/lib/storage";
import { canReadPaper, getReadablePaper, readablePapers } from "./access";
import { attachPdfVersion, insertPdfVersion, preparePdfVersion } from "./versions";
import { PdfFormatError } from "@/lib/pdf/inspection";
import { MAX_PDF_BYTES } from "@/lib/pdf/limits";
import { fetchMetadata, OpenAlexError, parseIdentifier, type PaperMetadata } from "./openalex";

export class ImportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
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
  if (new TextDecoder().decode(buffer.subarray(0, 5)) !== "%PDF-") {
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
  uploadedBy: string,
): Promise<ImportResult> {
  const parsed = parseIdentifier(identifier);
  if (!parsed) {
    throw new ImportError("无法识别该标识符，请填写 arXiv ID 或 DOI", "INVALID_IDENTIFIER");
  }

  const existing = await findExisting(parsed.source, parsed.id);
  if (existing) {
    if (!canReadPaper(existing, uploadedBy)) throw new ImportError("论文不可用", "NOT_FOUND", 404);
    return result(existing, false);
  }

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

  const [created] = await db
    .insert(papers)
    .values({
      source: metadata.source,
      externalId: metadata.externalId,
      doi: metadata.doi,
      title: metadata.title,
      abstract: metadata.abstract,
      authors: metadata.authors,
      year: metadata.year,
      venue: metadata.venue,
      pdfUrl: metadata.pdfCandidates[0] ?? null,
      license: metadata.license,
      visibility: "public",
      uploadedBy,
    })
    .returning();


  const attached = await attachRemotePdf(created.id, uploadedBy, metadata.pdfCandidates);
  return { ...attached, created: true };
}

/**
 * Retries the remote fetch for a paper whose PDF is missing (PAPER-006). The
 * candidate list is rebuilt from the stored metadata rather than trusted from
 * the request, so a retry cannot be pointed at an arbitrary URL.
 */
export async function attachRemotePdf(
  paperId: string, viewerId: string, initialCandidates: readonly string[] = [],
): Promise<ImportResult> {
  const paper = await getReadablePaper(paperId, viewerId);
  if (!paper) throw new ImportError("论文不存在", "NOT_FOUND", 404);
  if (paper.pdfPath) return result(paper, false);

  const candidates = [...initialCandidates];
  if (paper.source === "arxiv" && paper.externalId) candidates.push("https://arxiv.org/pdf/" + paper.externalId);
  if (paper.pdfUrl) candidates.push(paper.pdfUrl);
  const downloaded = await fetchPdfForCandidates(Array.from(new Set(candidates)));

  let failure: string;
  if ("error" in downloaded) {
    failure = downloaded.error.code;
  } else {
    try {
      const updated = await attachPdfVersion(paperId, viewerId, downloaded.bytes, downloaded.url, paper.source);
      const latest = updated ?? await getReadablePaper(paperId, viewerId);
      if (!latest) throw new ImportError("论文不可用", "NOT_FOUND", 404);
      return result(latest, false);
    } catch (error) {
      if (!(error instanceof PdfFormatError)) throw error;
      failure = error.code;
    }
  }

  const [updated] = await db.update(papers)
    .set({ pdfFetchError: failure, pdfCheckedAt: new Date() })
    .where(and(eq(papers.id, paperId), readablePapers(viewerId), isNull(papers.pdfPath))).returning();
  const latest = updated ?? await getReadablePaper(paperId, viewerId);
  if (!latest) throw new ImportError("论文不可用", "NOT_FOUND", 404);
  return result(latest, false);
}

export async function importFromUpload(
  file: File,
  uploadedBy: string,
  meta: { title?: string; authors?: string; year?: number | null; visibility: "public" | "private"; rightsClaimed: boolean },
): Promise<Paper> {
  if (!file.name.toLowerCase().endsWith(".pdf") ||
      !["", "application/pdf", "application/octet-stream"].includes(file.type.toLowerCase())) {
    throw new ImportError("请上传 PDF 文件", "NOT_PDF", 415);
  }
  if (file.size > MAX_PDF_BYTES) throw new ImportError("PDF 超过 60 MiB 上限", "PDF_TOO_LARGE", 413);
  if (meta.visibility === "public" && !meta.rightsClaimed) {
    throw new ImportError("请先确认你拥有此文件的公开分发权利", "RIGHTS_REQUIRED", 422);
  }

  const paperId = crypto.randomUUID();
  let version;
  try {
    version = await preparePdfVersion(paperId, new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof PdfFormatError) throw new ImportError(error.message, error.code, error.status);
    throw error;
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(papers).values({
        id: paperId, source: "upload",
        title: meta.title?.trim() || file.name.replace(/\.pdf$/i, ""),
        authors: meta.authors?.split(",").map((name) => name.trim()).filter(Boolean) ?? [],
        year: meta.year ?? null, pdfPath: version.pdfKey, visibility: meta.visibility,
        uploadedBy, hasTextLayer: version.hasTextLayer,
      });
      await insertPdfVersion(tx, paperId, version, {
        sourceType: "upload",
        rights: meta.visibility === "public" ? {
          actorId: uploadedBy, statementVersion: 1, confirmedAt: new Date().toISOString(),
        } : undefined,
      });
      const [paper] = await tx.update(papers).set({ defaultVersionId: version.id })
        .where(eq(papers.id, paperId)).returning();
      return paper;
    });
  } catch (error) {
    await storage.delete(version.pdfKey).catch(() => {});
    throw error;
  }
}
