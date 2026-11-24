import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { papers } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { isPaperId } from "@/lib/papers/access";
import { revokePaperAccess } from "@/lib/realtime";
import { storage } from "@/lib/storage";

const bodySchema = z.object({
  visibility: z.enum(["public", "private"]).optional(),
  status: z.enum(["active", "removed"]).optional(),
  removeFile: z.boolean().optional(),
  rightsClaimed: z.boolean().optional(),
}).refine((body) => body.visibility || body.status || body.removeFile);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    if (!isPaperId(id)) return jsonError("NOT_FOUND", 404);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "参数无效");
    const [paper] = await db.select().from(papers).where(eq(papers.id, id)).limit(1);
    if (!paper) return jsonError("NOT_FOUND", 404);

    const status = parsed.data.status ?? (parsed.data.removeFile ? "removed" : paper.status);
    const visibility = parsed.data.visibility ?? paper.visibility;
    if (parsed.data.removeFile && status !== "removed") return jsonError("INVALID_INPUT", 400);
    if (parsed.data.visibility === "public" && paper.visibility !== "public" &&
        paper.source === "upload" && !parsed.data.rightsClaimed) {
      return jsonError("RIGHTS_REQUIRED", 422, "请先确认此文件有公开分发权利");
    }

    const [updated] = await db.update(papers)
      .set({ status, visibility, ...(parsed.data.removeFile ? { pdfPath: null } : {}) })
      .where(and(
        eq(papers.id, id),
        eq(papers.status, paper.status),
        eq(papers.visibility, paper.visibility),
        paper.pdfPath ? eq(papers.pdfPath, paper.pdfPath) : isNull(papers.pdfPath),
      ))
      .returning({ status: papers.status, visibility: papers.visibility });
    if (!updated) return jsonError("CONFLICT", 409, "论文状态已变化，请刷新后重试");

    if (status === "removed") revokePaperAccess(id);
    else if (visibility === "private") revokePaperAccess(id, paper.uploadedBy);

    if (parsed.data.removeFile && paper.pdfPath) await storage.delete(paper.pdfPath);
    return NextResponse.json({ ok: true, ...updated });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
