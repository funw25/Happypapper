import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { likeNotificationsEnabled, setLikeNotifications } from "@/lib/notifications/queries";

/** Notification preferences for the signed-in user (docs/02-roadmap.md B2.2). */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");
    return NextResponse.json({ likeNotifications: await likeNotificationsEnabled(user.id) });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    const body = (await request.json().catch(() => null)) as { likeNotifications?: unknown } | null;
    if (typeof body?.likeNotifications !== "boolean") {
      return jsonError("INVALID_INPUT", 400, "likeNotifications 必须是布尔值");
    }

    const saved = await setLikeNotifications(user.id, body.likeNotifications);
    return NextResponse.json({ likeNotifications: saved });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
