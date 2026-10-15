import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { papers } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { storage } from "@/lib/storage";

const bodySchema = z.object({
  visibility: z.enum(["public", "private"]),
  /** Copyright takedown: also remove the cached file from local storage. */
  removeFile: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "参数无效");

    const [paper] = await db
      .select({ id: papers.id, pdfPath: papers.pdfPath })
      .from(papers)
      .where(eq(papers.id, id))
      .limit(1);
    if (!paper) return jsonError("NOT_FOUND", 404);

    let pdfPath = paper.pdfPath;
    if (parsed.data.removeFile && paper.pdfPath) {
      await storage.delete(paper.pdfPath);
      pdfPath = null;
    }

    await db
      .update(papers)
      .set({ visibility: parsed.data.visibility, pdfPath })
      .where(eq(papers.id, id));

    return NextResponse.json({ ok: true, visibility: parsed.data.visibility, pdfPath });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
