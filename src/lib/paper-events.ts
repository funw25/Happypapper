import { and, asc, eq, gt, lte } from "drizzle-orm";
import { db } from "@/db";
import { paperEvents, papers } from "@/db/schema";
import type { PaperEvent } from "./realtime-types";

export const MAX_REPLAY = 1000;

export function parseRevision(value: string, paperId: string): bigint | null {
  const revision = value.startsWith(paperId + ":") ? value.slice(paperId.length + 1) : value;
  if (!/^(0|[1-9]\d{0,18})$/.test(revision)) return null;
  const parsed = BigInt(revision);
  return parsed <= 9223372036854775807n ? parsed : null;
}

export async function paperRevision(paperId: string) {
  const [paper] = await db.select({ revision: papers.contentRevision }).from(papers)
    .where(eq(papers.id, paperId)).limit(1);
  return paper ? BigInt(paper.revision) : null;
}

export async function eventsAfter(paperId: string, after: bigint, head: bigint) {
  const rows = await db.select().from(paperEvents)
    .where(and(eq(paperEvents.paperId, paperId), gt(paperEvents.revision, String(after)), lte(paperEvents.revision, String(head))))
    .orderBy(asc(paperEvents.revision)).limit(MAX_REPLAY + 1);
  const reset = after > head || rows.length > MAX_REPLAY || BigInt(rows.length) !== head - after ||
    rows.some((row, index) => BigInt(row.revision) !== after + BigInt(index + 1));
  return { reset, events: reset ? [] : rows.map((row): PaperEvent => ({
    eventId: paperId + ":" + row.revision, paperId, revision: String(row.revision),
    type: row.type as PaperEvent["type"], commentId: row.commentId === null ? null : String(row.commentId),
    paperVersionId: row.paperVersionId, occurredAt: row.createdAt.toISOString(),
  })) };
}
