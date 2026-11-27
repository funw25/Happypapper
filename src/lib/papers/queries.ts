import { and, desc, eq, ilike, or, sql, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { comments, favorites, papers, readingProgress, readingProgressByVersion } from "@/db/schema";
import { isPaperId, readablePapers } from "./access";

export type PaperListItem = Awaited<ReturnType<typeof listPapers>>[number];

const commentCountSql = sql<number>`(
  select count(*)::int from "comments" c
  where c.paper_id = "papers"."id" and c.status = 'visible'
)`;

export async function listPapers(options: { q?: string; tag?: string; limit?: number } = {}) {
  const filters = [readablePapers()];

  if (options.q) {
    const needle = `%${options.q}%`;
    const search = or(
      ilike(papers.title, needle),
      ilike(papers.abstract, needle),
      ilike(papers.venue, needle),
    );
    if (search) filters.push(search);
  }

  if (options.tag) {
    filters.push(sql`${options.tag} = any(${papers.tags})`);
  }

  return db
    .select({
      ...getTableColumns(papers),
      commentCount: commentCountSql.as("comment_count"),
    })
    .from(papers)
    .where(and(...filters))
    .orderBy(desc(papers.createdAt))
    .limit(options.limit ?? 30);
}

export type ImportedRef = { source: string; externalId: string; doi: string | null };

/**
 * Maps remote search results onto rows already in the library. OpenAlex gives
 * some papers a mirror DOI while the stored row was imported from the arXiv ID,
 * so a DOI match counts as the same paper and suppresses a duplicate import.
 */
export async function findImported(refs: ImportedRef[]): Promise<Map<string, string>> {
  const conditions = [
    ...refs
      .filter((ref) => ref.externalId)
      .map((ref) => and(eq(papers.source, ref.source), eq(papers.externalId, ref.externalId))),
    ...refs.filter((ref) => ref.doi).map((ref) => eq(papers.doi, ref.doi as string)),
  ];

  if (conditions.length === 0) return new Map();
  const condition = or(...conditions);
  if (!condition) return new Map();

  const rows = await db
    .select({ id: papers.id, source: papers.source, externalId: papers.externalId, doi: papers.doi })
    .from(papers)
    .where(and(condition, readablePapers()));

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.externalId) map.set(`${row.source}:${row.externalId}`, row.id);
    if (row.doi) map.set(`doi:${row.doi}`, row.id);
  }
  return map;
}

export async function getPaper(id: string) {
  if (!isPaperId(id)) return null;
  const [row] = await db
    .select({
      ...getTableColumns(papers),
      commentCount: commentCountSql.as("comment_count"),
    })
    .from(papers)
    .where(eq(papers.id, id))
    .limit(1);
  return row ?? null;
}

export async function getFavorite(userId: string | null, paperId: string) {
  if (!userId) return false;
  const rows = await db
    .select({ paperId: favorites.paperId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.paperId, paperId)))
    .limit(1);
  return rows.length > 0;
}

export async function getProgress(userId: string | null, paperId: string, versionId?: string | null) {
  if (!userId) return null;
  if (versionId) {
    const [row] = await db.select()
      .from(readingProgressByVersion)
      .where(and(eq(readingProgressByVersion.userId, userId), eq(readingProgressByVersion.paperId, paperId), eq(readingProgressByVersion.versionId, versionId)))
      .limit(1);
    return row ?? null;
  }
  const [row] = await db
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.paperId, paperId)))
    .limit(1);
  return row ?? null;
}

export async function listRecentComments(limit = 8) {
  return db
    .select({
      id: comments.id,
      paperId: comments.paperId,
      content: comments.content,
      kind: comments.kind,
      page: comments.page,
      createdAt: comments.createdAt,
      paperTitle: papers.title,
      userName: sql<string | null>`case when ${comments.isAnonymous} then null
        else (select u.name from users u where u.id = ${comments.userId}) end`,
    })
    .from(comments)
    .innerJoin(papers, eq(papers.id, comments.paperId))
    .where(and(eq(comments.status, "visible"), readablePapers()))
    .orderBy(desc(comments.createdAt))
    .limit(limit);
}
