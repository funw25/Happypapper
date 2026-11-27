import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { broadcastCommentCounts } from "@/lib/comments/broadcast";
import { recountComment } from "@/lib/comments/queries";
import { lockComment } from "@/lib/comments/mutation";

const patchSchema = z.object({ status: z.enum(["visible", "hidden"]) });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return jsonError("INVALID_INPUT", 400);

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "状态无效");

    const [comment] = await db.select({ paperId: comments.paperId }).from(comments).where(eq(comments.id, id)).limit(1);
    if (!comment) return jsonError("NOT_FOUND", 404);
    const updated = await db.transaction(async (tx) => {
      const locked = await lockComment(tx, comment.paperId, id, admin.id, true);
      await tx.update(comments).set({ status: parsed.data.status }).where(eq(comments.id, id));
      if (locked.parentId) await recountComment(locked.parentId, tx);
      return locked;
    });

    await broadcastCommentCounts(updated.paperId, id);
    return NextResponse.json({ ok: true, status: parsed.data.status });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
