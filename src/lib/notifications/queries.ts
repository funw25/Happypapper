import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, notifications, papers, users } from "@/db/schema";

export type NotificationItem = {
  id: number;
  type: string;
  commentId: number;
  paperId: string;
  page: number;
  readAt: Date | null;
  createdAt: Date;
  actorName: string | null;
  paperTitle: string;
  commentContent: string;
};

/**
 * Records that `actorId` replied to someone else's comment.
 *
 * Returns false when there is nobody to notify: the parent comment may be
 * anonymous, and a self-reply would only produce noise.
 */
export async function notifyReply(input: {
  parentId: number;
  commentId: number;
  paperId: string;
  actorId: string;
}): Promise<boolean> {
  const [parent] = await db
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, input.parentId))
    .limit(1);

  if (!parent?.userId || parent.userId === input.actorId) return false;

  await db.insert(notifications).values({
    userId: parent.userId,
    commentId: input.commentId,
    paperId: input.paperId,
    actorId: input.actorId,
    type: "reply",
  });
  return true;
}

/**
 * Records that `actorId` liked someone else's comment.
 *
 * Returns false when there is nobody to tell (anonymous author, self-like) or
 * when the author switched like notifications off. Re-liking replaces the
 * previous row instead of stacking, so a like/unlike cycle leaves one entry at
 * most and never grows the inbox.
 */
export async function notifyLike(input: {
  commentId: number;
  paperId: string;
  actorId: string;
}): Promise<boolean> {
  const [comment] = await db
    .select({ userId: comments.userId })
    .from(comments)
    .where(eq(comments.id, input.commentId))
    .limit(1);

  if (!comment?.userId || comment.userId === input.actorId) return false;

  const [author] = await db
    .select({ notifyLikes: users.notifyLikes })
    .from(users)
    .where(eq(users.id, comment.userId))
    .limit(1);
  if (!author?.notifyLikes) return false;

  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.userId, comment.userId),
        eq(notifications.commentId, input.commentId),
        eq(notifications.actorId, input.actorId),
        eq(notifications.type, "like"),
      ),
    );

  await db.insert(notifications).values({
    userId: comment.userId,
    commentId: input.commentId,
    paperId: input.paperId,
    actorId: input.actorId,
    type: "like",
  });
  return true;
}

/** Withdraws the like notification when the like is taken back. */
export async function removeLikeNotification(input: {
  commentId: number;
  actorId: string;
}): Promise<number> {
  const deleted = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.commentId, input.commentId),
        eq(notifications.actorId, input.actorId),
        eq(notifications.type, "like"),
      ),
    )
    .returning({ id: notifications.id });
  return deleted.length;
}

export async function likeNotificationsEnabled(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ notifyLikes: users.notifyLikes })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.notifyLikes ?? true;
}

export async function setLikeNotifications(userId: string, enabled: boolean): Promise<boolean> {
  const [row] = await db
    .update(users)
    .set({ notifyLikes: enabled })
    .where(eq(users.id, userId))
    .returning({ notifyLikes: users.notifyLikes });
  return row?.notifyLikes ?? enabled;
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function listNotifications(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<{ items: NotificationItem[]; unread: number; total: number }> {
  const items = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      commentId: notifications.commentId,
      paperId: notifications.paperId,
      page: comments.page,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorName: users.name,
      paperTitle: papers.title,
      commentContent: comments.content,
    })
    .from(notifications)
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .innerJoin(papers, eq(papers.id, notifications.paperId))
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.userId, userId));

  return {
    items,
    unread: await unreadNotificationCount(userId),
    total: total?.count ?? 0,
  };
}

/**
 * Marks one notification read, or every unread one when no id is given. The
 * `user_id` filter is what stops a crafted id from touching someone else's row.
 */
export async function markNotificationsRead(userId: string, id?: number): Promise<number> {
  const filters = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (id !== undefined) filters.push(eq(notifications.id, id));

  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(...filters))
    .returning({ id: notifications.id });

  return updated.length;
}
