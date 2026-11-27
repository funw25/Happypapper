import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { papers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { canManagePaper, getReadablePaper, readablePapers } from "@/lib/papers/access";

import { listPaperVersions } from "@/lib/papers/versions";
import { paperAvailability } from "@/lib/papers/availability";

const bodySchema = z.object({
  tags: z.array(z.string().min(1).max(24)).max(8),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    if (!canManagePaper(paper, user)) return jsonError("FORBIDDEN", 403, "仅论文管理者可以编辑标签");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "标签无效（最多 8 个）");

    const tags = Array.from(new Set(parsed.data.tags.map((t) => t.trim()).filter(Boolean)));

    const [updated] = await db
      .update(papers)
      .set({ tags })
      .where(and(eq(papers.id, id), paper.uploadedBy ? eq(papers.uploadedBy, paper.uploadedBy) : isNull(papers.uploadedBy), readablePapers(user.id)))
      .returning({ id: papers.id, tags: papers.tags });

    if (!updated) return jsonError("NOT_FOUND", 404);
    return NextResponse.json({ paper: updated });
  } catch (error) {
    return errorFromUnknown(error);
  }
}


export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    return NextResponse.json({
      data: {
        id: paper.id, title: paper.title, authors: paper.authors, year: paper.year,
        source: paper.source, doi: paper.doi, externalId: paper.externalId, tags: paper.tags,
        defaultVersionId: paper.defaultVersionId, visibility: paper.visibility,
        versions: await listPaperVersions(id),
        availability: paperAvailability(paper),
        viewer: { canManage: canManagePaper(paper, user) },
      },
    }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
