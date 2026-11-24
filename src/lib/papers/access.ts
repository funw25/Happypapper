import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { papers, type Paper } from "@/db/schema";

type PaperAccess = Pick<Paper, "status" | "visibility" | "uploadedBy">;
type Actor = { id: string; role: string };

export function readablePapers(viewerId: string | null = null) {
  const isPublic = eq(papers.visibility, "public");
  return and(
    eq(papers.status, "active"),
    viewerId ? or(isPublic, and(eq(papers.visibility, "private"), eq(papers.uploadedBy, viewerId))) : isPublic,
  );
}

export function canReadPaper(paper: PaperAccess | null | undefined, viewerId?: string | null) {
  return !!paper && paper.status === "active" && (
    paper.visibility === "public" || (paper.visibility === "private" && !!viewerId && paper.uploadedBy === viewerId)
  );
}

export function canModerate(actor: Actor | null) {
  return actor?.role === "admin";
}

export function canManagePaper(paper: PaperAccess, actor: Actor | null) {
  return !!actor && paper.status === "active" && (actor.id === paper.uploadedBy || canModerate(actor));
}

export function canInteract(actor: (Actor & { emailVerified: Date | null }) | null) {
  return !!actor?.emailVerified;
}

export function isPaperId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function getReadablePaper(id: string, viewerId?: string | null) {
  if (!isPaperId(id)) return null;
  const [paper] = await db.select().from(papers).where(and(eq(papers.id, id), readablePapers(viewerId))).limit(1);
  return paper ?? null;
}
