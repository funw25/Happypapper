import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { readingProgress, readingProgressByVersion } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { getReadablePaper } from "@/lib/papers/access";
import { getPaperVersion } from "@/lib/papers/versions";
import { getProgress } from "@/lib/papers/queries";
import { PRIVATE_RESPONSE_HEADERS } from "@/lib/api";

const bodySchema = z.object({
  versionId: z.uuid().optional(),
  page: z.number().int().min(1),
  yNorm: z.number().min(0).max(1).optional(),
  progress: z.number().min(0).max(1).optional(),
});

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "进度数据无效");

    const version = await getPaperVersion(paper, parsed.data.versionId);
    if (parsed.data.versionId && !version) return jsonError("NOT_FOUND", 404);
    if (version?.pageCount && parsed.data.page > version.pageCount) return jsonError("INVALID_PAGE", 400);

    const values = {
      userId: user.id,
      paperId: id,
      page: parsed.data.page,
      yNorm: parsed.data.yNorm ?? 0,
      progress: parsed.data.progress ?? 0,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      if (version) {
        await tx.insert(readingProgressByVersion).values({ ...values, versionId: version.id })
          .onConflictDoUpdate({
            target: [readingProgressByVersion.userId, readingProgressByVersion.paperId, readingProgressByVersion.versionId],
            set: { page: values.page, yNorm: values.yNorm, progress: values.progress, updatedAt: values.updatedAt },
          });
      }
      if (!version || version.id === paper.defaultVersionId) {
        await tx.insert(readingProgress).values(values).onConflictDoUpdate({
          target: [readingProgress.userId, readingProgress.paperId],
          set: { page: values.page, yNorm: values.yNorm, progress: values.progress, updatedAt: values.updatedAt },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}


export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    const requested = new URL(request.url).searchParams.get("version");
    const version = await getPaperVersion(paper, requested);
    if (requested && !version) return jsonError("NOT_FOUND", 404);
    const row = await getProgress(user.id, id, version?.id);
    return NextResponse.json({
      progress: row ? { page: row.page, yNorm: row.yNorm, progress: row.progress, updatedAt: row.updatedAt } : null,
    }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
