import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { markNotificationsRead, unreadNotificationCount } from "@/lib/notifications/queries";

/**
 * Marks one notification read, or all of them when no id is supplied. The query
 * is always scoped to the session user, so an id from another account is a no-op.
 */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const raw = body?.id;
    const id = typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : undefined;

    const marked = await markNotificationsRead(user.id, id);
    return NextResponse.json({ marked, unread: await unreadNotificationCount(user.id) });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
