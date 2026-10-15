import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { comments } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { broadcastCommentCounts } from "@/lib/comments/broadcast";

const patchSchema = z.object({ status: z.enum(["visible", "hidden"]) });

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id: rawId } = await ctx.params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return jsonError("INVALID_INPUT", 400);

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "状态无效");

    const [updated] = await db
      .update(comments)
      .set({ status: parsed.data.status })
      .where(eq(comments.id, id))
      .returning({ paperId: comments.paperId });

    if (!updated) return jsonError("NOT_FOUND", 404);

    await broadcastCommentCounts(updated.paperId, id);
    return NextResponse.json({ ok: true, status: parsed.data.status });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
