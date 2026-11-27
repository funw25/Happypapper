import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { commentLikes, users } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { CommentError, getComment, recountComment } from "@/lib/comments/queries";
import { lockComment } from "@/lib/comments/mutation";
import { canInteract } from "@/lib/papers/access";
import { notifyLike, removeLikeNotification } from "@/lib/notifications/queries";
import { sql } from "drizzle-orm";

async function resolveId(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Number(id);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(ctx);
    if (id === null) return jsonError("INVALID_INPUT", 400);

    const user = await currentUser();
    const comment = await getComment(id, user?.id);
    if (!comment || comment.status !== "visible") return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    if (!canInteract(user)) return jsonError("EMAIL_UNVERIFIED", 403, "验证邮箱后即可点赞");
    if (comment.userId === user.id) return jsonError("SELF_LIKE", 403, "不能点赞自己的评论");

    await db.transaction(async (tx) => {
      const locked = await lockComment(tx, comment.paperId, id, user.id);
      if (locked.status !== "visible") throw new CommentError("NOT_FOUND", 404, "评论不可用");
      const inserted = await tx
        .insert(commentLikes)
        .values({ userId: user.id, commentId: id })
        .onConflictDoNothing()
        .returning({ commentId: commentLikes.commentId });

      if (inserted.length > 0) {
        if (comment.userId) {
          await tx
            .update(users)
            .set({ reputation: sql`${users.reputation} + 1` })
            .where(eq(users.id, comment.userId));
        }
        // Only a newly created like notifies; re-posting an existing like is a
        // no-op above and must not touch the author's inbox.
        await notifyLike({ commentId: id, paperId: comment.paperId, actorId: user.id }, tx);
      }

      await recountComment(id, tx);
    });
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
    const comment = await getComment(id, user?.id);
    if (!comment || comment.status !== "visible") return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    await db.transaction(async (tx) => {
      const locked = await lockComment(tx, comment.paperId, id, user.id);
      if (locked.status !== "visible") throw new CommentError("NOT_FOUND", 404, "评论不可用");
      await tx
        .delete(commentLikes)
        .where(and(eq(commentLikes.userId, user.id), eq(commentLikes.commentId, id)));

      // Taking the like back also withdraws the notification it produced.
      await removeLikeNotification({ commentId: id, actorId: user.id }, tx);

      await recountComment(id, tx);
    });
    return NextResponse.json({ liked: false });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
