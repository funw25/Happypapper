import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { getComment, getVisibleCommentDTO, recountComment } from "@/lib/comments/queries";
import { canModerate } from "@/lib/papers/access";
import { broadcastCommentCounts } from "@/lib/comments/broadcast";
import { lockComment } from "@/lib/comments/mutation";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await ctx.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError("INVALID_INPUT", 400);
    const comment = await getVisibleCommentDTO(id, (await currentUser())?.id ?? null);
    return comment ? Response.json({ comment }, { headers: PRIVATE_RESPONSE_HEADERS }) : jsonError("NOT_FOUND", 404);
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1) return jsonError("INVALID_INPUT", 400);

    const user = await currentUser();
    const comment = await getComment(id, user?.id);
    if (!comment) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    if (comment.userId !== user.id && !canModerate(user)) {
      return jsonError("FORBIDDEN", 403, "只能删除自己的评论");
    }

    await db.transaction(async (tx) => {
      await lockComment(tx, comment.paperId, id, user.id);
      await tx.update(comments).set({ status: "deleted" }).where(eq(comments.id, id));
      if (comment.parentId) await recountComment(comment.parentId, tx);
    });
    await broadcastCommentCounts(comment.paperId, id);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
