import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { listNotifications } from "@/lib/notifications/queries";

/** Paged notification list for the signed-in user (docs/02-roadmap.md B2). */
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));

    const result = await listNotifications(user.id, limit, (page - 1) * limit);
    return NextResponse.json({ ...result, page, limit });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
