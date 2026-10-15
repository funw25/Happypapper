import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { muteUser, unmuteUser } from "@/lib/admin/queries";

const bodySchema = z.object({
  minutes: z.number().int().min(1).max(60 * 24 * 30).nullable(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "禁言时长无效");

    const [target] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!target) return jsonError("NOT_FOUND", 404);
    if (target.role === "admin") return jsonError("FORBIDDEN", 403, "不能禁言管理员");
    if (target.id === admin.id) return jsonError("FORBIDDEN", 403, "不能禁言自己");

    if (parsed.data.minutes === null) {
      await unmuteUser(id);
      return NextResponse.json({ mutedUntil: null });
    }

    const until = await muteUser(id, parsed.data.minutes);
    return NextResponse.json({ mutedUntil: until.toISOString() });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
