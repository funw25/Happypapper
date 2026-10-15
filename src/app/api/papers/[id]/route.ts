import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { papers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";

const bodySchema = z.object({
  tags: z.array(z.string().min(1).max(24)).max(8),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "标签无效（最多 8 个）");

    const tags = Array.from(new Set(parsed.data.tags.map((t) => t.trim()).filter(Boolean)));

    const [updated] = await db
      .update(papers)
      .set({ tags })
      .where(eq(papers.id, id))
      .returning({ id: papers.id, tags: papers.tags });

    if (!updated) return jsonError("NOT_FOUND", 404);
    return NextResponse.json({ paper: updated });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
