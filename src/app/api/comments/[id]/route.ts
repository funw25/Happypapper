import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { recountComment } from "@/lib/comments/queries";
import { broadcastCommentCounts } from "@/lib/comments/broadcast";

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return jsonError("INVALID_INPUT", 400);

    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const [comment] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!comment) return jsonError("NOT_FOUND", 404);
    if (comment.userId !== user.id && user.role !== "admin") {
      return jsonError("FORBIDDEN", 403, "只能删除自己的评论");
    }

    await db.update(comments).set({ status: "deleted" }).where(eq(comments.id, id));
    if (comment.parentId) await recountComment(comment.parentId);
    await broadcastCommentCounts(comment.paperId, id);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
