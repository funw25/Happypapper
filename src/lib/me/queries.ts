import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, favorites, papers, readingProgress, users } from "@/db/schema";
import { readablePapers } from "@/lib/papers/access";

function publicCommentFilter() {
  return and(
    eq(comments.status, "visible"),
    eq(comments.visibleInProfile, true),
    eq(comments.isAnonymous, false),
    readablePapers(),
  );
}

export async function profileByName(name: string) {
  const publicStatsFilter = and(eq(comments.userId, users.id), eq(users.profileCommentsVisible, true), publicCommentFilter());
  const publicComments = db.select({ value: sql<number>`count(*)::int` })
    .from(comments).innerJoin(papers, eq(papers.id, comments.paperId)).where(publicStatsFilter);
  const publicLikes = db.select({ value: sql<number>`coalesce(sum(${comments.likeCount}), 0)::int` })
    .from(comments).innerJoin(papers, eq(papers.id, comments.paperId)).where(publicStatsFilter);
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      avatarBg: users.avatarBg,
      avatarFg: users.avatarFg,
      bio: users.bio,
      role: users.role,
      createdAt: users.createdAt,
      mutedUntil: users.mutedUntil,
      profileCommentsVisible: users.profileCommentsVisible,
      commentCount: sql<number>`(${publicComments})`.as("comment_count"),
      receivedLikes: sql<number>`(${publicLikes})`.as("received_likes"),
    })
    .from(users)
    .where(eq(users.name, name))
    .limit(1);
  return row ?? null;
}

export type CommentWithPaper = {
  id: number;
  content: string;
  kind: string;
  page: number;
  createdAt: Date;
  likeCount: number;
  quote: string | null;
  paperId: string;
  paperTitle: string;
  isAnonymous: boolean;
};

/**
 * Comments for the owner's own dashboard, and for the public profile page.
 * `publicProfile` filters out comments the author kept off their public profile
 * (PRIVACY-006) and anonymous ones, which would otherwise unmask their author
 * simply by appearing on that author's page. The owner's own view passes false
 * so nothing seems to have disappeared.
 */
export async function commentsByUser(
  userId: string,
  limit = 50,
  options: { publicProfile?: boolean } = {},
): Promise<CommentWithPaper[]> {
  const visibility = options.publicProfile
    ? publicCommentFilter()
    : and(eq(comments.status, "visible"), readablePapers(userId));

  return db
    .select({
      id: comments.id,
      content: comments.content,
      kind: comments.kind,
      page: comments.page,
      createdAt: comments.createdAt,
      likeCount: comments.likeCount,
      quote: comments.quote,
      paperId: comments.paperId,
      paperTitle: papers.title,
      isAnonymous: comments.isAnonymous,
    })
    .from(comments)
    .innerJoin(papers, eq(papers.id, comments.paperId))
    .where(and(eq(comments.userId, userId), visibility))
    .orderBy(desc(comments.createdAt))
    .limit(limit);
}

export async function favoritesByUser(userId: string) {
  return db
    .select({
      paperId: papers.id,
      title: papers.title,
      authors: papers.authors,
      year: papers.year,
      venue: papers.venue,
      createdAt: favorites.createdAt,
      commentCount: sql<number>`(
        select count(*)::int from "comments" c
        where c.paper_id = "papers"."id" and c.status = 'visible'
      )`.as("comment_count"),
    })
    .from(favorites)
    .innerJoin(papers, eq(papers.id, favorites.paperId))
    .where(and(eq(favorites.userId, userId), readablePapers(userId)))
    .orderBy(desc(favorites.createdAt));
}

export async function readingByUser(userId: string) {
  return db
    .select({
      paperId: papers.id,
      title: papers.title,
      page: readingProgress.page,
      progress: readingProgress.progress,
      updatedAt: readingProgress.updatedAt,
    })
    .from(readingProgress)
    .innerJoin(papers, eq(papers.id, readingProgress.paperId))
    .where(and(eq(readingProgress.userId, userId), readablePapers(userId)))
    .orderBy(desc(readingProgress.updatedAt));
}
