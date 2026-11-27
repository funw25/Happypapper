import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { paperPages, papers, paperVersions, type Paper } from "@/db/schema";
import { isPaperId, readablePapers } from "@/lib/papers/access";
import { inspectPdf } from "@/lib/pdf/inspection";
import { storage } from "@/lib/storage";

type VersionDb = Pick<typeof db, "insert" | "update">;

export async function preparePdfVersion(paperId: string, bytes: Uint8Array) {
  const checked = await inspectPdf(bytes);
  const id = crypto.randomUUID();
  const pdfKey = "papers/" + paperId + "/versions/" + id + "/document.pdf";
  await storage.put(pdfKey, bytes);
  return { ...checked, id, pdfKey, hasTextLayer: checked.pages.some((page) => page.textStatus === "text") };
}

type Prepared = Awaited<ReturnType<typeof preparePdfVersion>>;
type RightsConfirmation = { actorId: string; confirmedAt: string; statementVersion: number };

export async function insertPdfVersion(
  tx: VersionDb,
  paperId: string,
  file: Prepared,
  options: { sourceType: string; sourceUrl?: string | null; rights?: RightsConfirmation; label?: string },
) {
  await tx.insert(paperVersions).values({
    id: file.id, paperId, versionLabel: options.label ?? "版本 1", sourceType: options.sourceType,
    sourceUrl: options.sourceUrl, pdfKey: file.pdfKey, pageCount: file.pages.length,
    sha256: file.sha256, parserVersion: file.parserVersion, processingState: "ready",
    rightsConfirmation: options.rights,
  });
  await tx.insert(paperPages).values(file.pages.map((page) => ({ ...page, versionId: file.id })));
}

export async function attachPdfVersion(paperId: string, viewerId: string, bytes: Uint8Array, url: string, source: string) {
  const file = await preparePdfVersion(paperId, bytes);
  let result: Paper | undefined;
  try {
    result = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(papers)
        .set({ pdfPath: file.pdfKey, pdfUrl: url, pdfCheckedAt: new Date(), pdfFetchError: null, hasTextLayer: file.hasTextLayer })
        .where(and(eq(papers.id, paperId), isNull(papers.pdfPath), readablePapers(viewerId))).returning();
      if (!claimed) return;
      await insertPdfVersion(tx, paperId, file, { sourceType: source, sourceUrl: url });
      const [updated] = await tx.update(papers).set({ defaultVersionId: file.id })
        .where(eq(papers.id, paperId)).returning();
      return updated;
    });
  } catch (error) {
    await storage.delete(file.pdfKey).catch(() => {});
    throw error;
  }
  if (!result) await storage.delete(file.pdfKey);
  return result;
}

export async function getPaperVersion(paper: Pick<Paper, "id" | "defaultVersionId">, requested?: string | null) {
  const versionId = requested ?? paper.defaultVersionId;
  if (!versionId || !isPaperId(versionId)) return null;
  const [row] = await db.select().from(paperVersions)
    .where(and(eq(paperVersions.paperId, paper.id), eq(paperVersions.id, versionId))).limit(1);
  return row ?? null;
}

export async function listPaperVersions(paperId: string) {
  return db.select({
    id: paperVersions.id, label: paperVersions.versionLabel,
    pageCount: paperVersions.pageCount, state: paperVersions.processingState,
  }).from(paperVersions).where(eq(paperVersions.paperId, paperId)).orderBy(desc(paperVersions.createdAt));
}

export async function getVersionPage(versionId: string, page: number) {
  const [row] = await db.select().from(paperPages)
    .where(and(eq(paperPages.versionId, versionId), eq(paperPages.page, page))).limit(1);
  return row ?? null;
}
