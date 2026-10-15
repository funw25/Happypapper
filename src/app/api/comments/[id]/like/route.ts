import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { commentLikes, comments, users } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { recountComment } from "@/lib/comments/queries";
import { notifyLike, removeLikeNotification } from "@/lib/notifications/queries";
import { broadcastCommentCounts } from "@/lib/comments/broadcast";
import { sql } from "drizzle-orm";

async function resolveId(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Number(id);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(ctx);
    if (id === null) return jsonError("INVALID_INPUT", 400);

    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const [comment] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!comment || comment.status !== "visible") return jsonError("NOT_FOUND", 404);

    const inserted = await db
      .insert(commentLikes)
      .values({ userId: user.id, commentId: id })
      .onConflictDoNothing()
      .returning({ commentId: commentLikes.commentId });

    if (inserted.length > 0) {
      if (comment.userId) {
        await db
          .update(users)
          .set({ reputation: sql`${users.reputation} + 1` })
          .where(eq(users.id, comment.userId));
      }
      // Only a newly created like notifies; re-posting an existing like is a
      // no-op above and must not touch the author's inbox.
      await notifyLike({ commentId: id, paperId: comment.paperId, actorId: user.id });
    }

    await recountComment(id);
    await broadcastCommentCounts(comment.paperId, id);
    return NextResponse.json({ liked: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(ctx);
    if (id === null) return jsonError("INVALID_INPUT", 400);

    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const [comment] = await db
      .select({ paperId: comments.paperId })
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);

    await db
      .delete(commentLikes)
      .where(and(eq(commentLikes.userId, user.id), eq(commentLikes.commentId, id)));

    // Taking the like back also withdraws the notification it produced.
    await removeLikeNotification({ commentId: id, actorId: user.id });

    await recountComment(id);
    if (comment) await broadcastCommentCounts(comment.paperId, id);
    return NextResponse.json({ liked: false });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
