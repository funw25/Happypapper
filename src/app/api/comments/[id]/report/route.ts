import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, reports } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";

const REASONS = ["spam", "abuse", "offtopic", "copyright", "other"] as const;

const bodySchema = z.object({
  reason: z.enum(REASONS),
  detail: z.string().max(500).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return jsonError("INVALID_INPUT", 400);

    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "举报理由无效");

    const [comment] = await db
      .select({ id: comments.id, userId: comments.userId })
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    if (!comment) return jsonError("NOT_FOUND", 404);
    if (comment.userId === user.id) {
      return jsonError("INVALID_INPUT", 400, "不能举报自己的评论");
    }

    await db
      .insert(reports)
      .values({
        commentId: id,
        reporterId: user.id,
        reason: parsed.data.reason,
        detail: parsed.data.detail ?? null,
      })
      .onConflictDoNothing();

    return NextResponse.json({ reported: true }, { status: 201 });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
