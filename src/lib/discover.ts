import { and, count, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { commentLikeHistory, commentLikes, comments, papers, paperVisits, users } from "@/db/schema";
import { readablePapers } from "./papers/access";

/** Today's board closes at 00:00 Beijing time and covers the previous day. */
export function rankingWindow(now = new Date()) {
  const cutoffDate = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  const cutoff = new Date(cutoffDate + "T00:00:00+08:00");
  const start = new Date(cutoff.getTime() - 24 * 3600_000);
  return { start, cutoff, day: new Date(start.getTime() + 8 * 3600_000).toISOString().slice(0, 10), cutoffDate };
}

export async function discoverRankings(period: "all" | "today", now = new Date()) {
  const window = rankingWindow(now);
  const publicOnly = readablePapers(null);
  const rankedLikes = period === "today" ? commentLikeHistory : commentLikes;
  const during = (column: typeof comments.createdAt | typeof commentLikes.createdAt | typeof commentLikeHistory.createdAt) =>
    period === "today" ? and(gte(column, window.start), lt(column, window.cutoff)) : undefined;
  const [danmaku, likes, visits] = await Promise.all([
    db.select({ id: papers.id, title: papers.title, total: count() }).from(comments)
      .innerJoin(papers, eq(papers.id, comments.paperId))
      .where(and(publicOnly, eq(comments.status, "visible"), isNull(comments.parentId),
        eq(comments.visibleInDanmaku, true), isNotNull(comments.danmakuText),
        sql`length(trim(${comments.danmakuText})) > 0`, during(comments.createdAt)))
      .groupBy(papers.id, papers.title).orderBy(desc(count()), desc(papers.id)).limit(20),
    db.select({ id: comments.id, paperId: papers.id, title: papers.title, content: comments.content,
      page: comments.page, versionId: comments.paperVersionId, total: count(),
      authorName: sql<string | null>`case when ${comments.isAnonymous} then null else author.name end`,
    }).from(rankedLikes).innerJoin(comments, eq(comments.id, rankedLikes.commentId))
      .innerJoin(papers, eq(papers.id, comments.paperId))
      .innerJoin(users, eq(users.id, rankedLikes.userId))
      .leftJoin(sql`users author`, sql`author.id = ${comments.userId}`)
      .where(and(publicOnly, eq(comments.status, "visible"), isNotNull(users.emailVerified),
        ne(rankedLikes.userId, comments.userId), during(rankedLikes.createdAt),
        period === "today" ? or(isNull(commentLikeHistory.endedAt), gte(commentLikeHistory.endedAt, window.cutoff)) : undefined,
        sql`not exists (select 1 from comments parent where parent.id = ${comments.parentId} and parent.status <> 'visible')`))
      .groupBy(comments.id, papers.id, papers.title, sql`author.name`)
      .orderBy(desc(count()), desc(comments.id)).limit(20),
    db.select({ id: papers.id, title: papers.title, total: count() }).from(paperVisits)
      .innerJoin(papers, eq(papers.id, paperVisits.paperId))
      .where(and(publicOnly, period === "today" ? eq(paperVisits.visitDay, window.day) : undefined))
      .groupBy(papers.id, papers.title).orderBy(desc(count()), desc(papers.id)).limit(20),
  ]);
  return { period, dataDate: period === "today" ? window.day : null,
    cutoff: period === "today" ? window.cutoff.toISOString() : null,
    cutoffLabel: window.cutoffDate + " 00:00（北京时间）", danmaku, likes, visits };
}
