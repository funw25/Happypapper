import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { readingProgress } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";

const bodySchema = z.object({
  page: z.number().int().min(1),
  yNorm: z.number().min(0).max(1).optional(),
  progress: z.number().min(0).max(1).optional(),
});

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "进度数据无效");

    const values = {
      userId: user.id,
      paperId: id,
      page: parsed.data.page,
      yNorm: parsed.data.yNorm ?? 0,
      progress: parsed.data.progress ?? 0,
      updatedAt: new Date(),
    };

    await db
      .insert(readingProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [readingProgress.userId, readingProgress.paperId],
        set: {
          page: values.page,
          yNorm: values.yNorm,
          progress: values.progress,
          updatedAt: values.updatedAt,
        },
      });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
