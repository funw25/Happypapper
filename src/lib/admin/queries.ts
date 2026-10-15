import { desc, eq, sql, and, count } from "drizzle-orm";
import { db } from "@/db";
import { comments, papers, reports, users } from "@/db/schema";

const commentAuthor = sql<string | null>`(select u.name from "users" u where u.id = "comments"."user_id")`;

export async function listReports(status: "open" | "resolved" | "rejected" | "all" = "open") {
  const filters = status === "all" ? [] : [eq(reports.status, status)];

  return db
    .select({
      id: reports.id,
      reason: reports.reason,
      detail: reports.detail,
      status: reports.status,
      createdAt: reports.createdAt,
      handledAt: reports.handledAt,
      commentId: reports.commentId,
      commentContent: comments.content,
      commentStatus: comments.status,
      commentPage: comments.page,
      commentQuote: comments.quote,
      commentAuthor: commentAuthor.as("comment_author"),
      reporterName: users.name,
      paperId: comments.paperId,
      paperTitle: papers.title,
    })
    .from(reports)
    .innerJoin(comments, eq(comments.id, reports.commentId))
    .innerJoin(papers, eq(papers.id, comments.paperId))
    .leftJoin(users, eq(users.id, reports.reporterId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(100);
}

export async function listFlaggedComments() {
  return db
    .select({
      id: comments.id,
      content: comments.content,
      kind: comments.kind,
      page: comments.page,
      status: comments.status,
      createdAt: comments.createdAt,
      likeCount: comments.likeCount,
      authorName: commentAuthor.as("comment_author"),
      paperId: comments.paperId,
      paperTitle: papers.title,
      openReports: sql<number>`(
        select count(*)::int from "reports" r
        where r.comment_id = "comments"."id" and r.status = 'open'
      )`.as("open_reports"),
    })
    .from(comments)
    .innerJoin(papers, eq(papers.id, comments.paperId))
    .orderBy(desc(comments.createdAt))
    .limit(100);
}

export async function listUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      reputation: users.reputation,
      mutedUntil: users.mutedUntil,
      createdAt: users.createdAt,
      commentCount: sql<number>`(
        select count(*)::int from "comments" c
        where c.user_id = "users"."id" and c.status = 'visible'
      )`.as("comment_count"),
      receivedLikes: sql<number>`(
        select coalesce(sum(c.like_count), 0)::int from "comments" c
        where c.user_id = "users"."id" and c.status = 'visible'
      )`.as("received_likes"),
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200);
}

export async function listPapersForAdmin() {
  return db
    .select({
      id: papers.id,
      title: papers.title,
      source: papers.source,
      visibility: papers.visibility,
      hasTextLayer: papers.hasTextLayer,
      hasFile: sql<boolean>`("papers"."pdf_path" is not null)`.as("has_file"),
      createdAt: papers.createdAt,
      commentCount: sql<number>`(
        select count(*)::int from "comments" c where c.paper_id = "papers"."id"
      )`.as("comment_count"),
    })
    .from(papers)
    .orderBy(desc(papers.createdAt))
    .limit(200);
}

export async function adminStats() {
  const [openReports] = await db
    .select({ total: count() })
    .from(reports)
    .where(eq(reports.status, "open"));
  const [hiddenComments] = await db
    .select({ total: count() })
    .from(comments)
    .where(eq(comments.status, "hidden"));
  const [allComments] = await db.select({ total: count() }).from(comments);
  const [allPapers] = await db.select({ total: count() }).from(papers);
  const [allUsers] = await db.select({ total: count() }).from(users);

  return {
    openReports: openReports?.total ?? 0,
    hiddenComments: hiddenComments?.total ?? 0,
    comments: allComments?.total ?? 0,
    papers: allPapers?.total ?? 0,
    users: allUsers?.total ?? 0,
  };
}

export async function muteUser(userId: string, minutes: number) {
  const until = new Date(Date.now() + minutes * 60_000);
  await db.update(users).set({ mutedUntil: until }).where(eq(users.id, userId));
  return until;
}

export async function unmuteUser(userId: string) {
  await db.update(users).set({ mutedUntil: null }).where(eq(users.id, userId));
}
