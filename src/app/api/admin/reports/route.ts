import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { listReports } from "@/lib/admin/queries";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const raw = url.searchParams.get("status") ?? "open";
    const status = ["open", "resolved", "rejected", "all"].includes(raw)
      ? (raw as "open" | "resolved" | "rejected" | "all")
      : "open";
    return NextResponse.json({ reports: await listReports(status) });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

const patchSchema = z.object({ status: z.enum(["open", "resolved", "rejected"]) });

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id)) return jsonError("INVALID_INPUT", 400);

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "状态无效");

    await db
      .update(reports)
      .set({
        status: parsed.data.status,
        handledBy: admin.id,
        handledAt: parsed.data.status === "open" ? null : new Date(),
      })
      .where(eq(reports.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
