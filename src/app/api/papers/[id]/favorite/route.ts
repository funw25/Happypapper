import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { favorites, readingProgress } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { getReadablePaper } from "@/lib/papers/access";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!await getReadablePaper(id, user?.id)) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    await db
      .insert(favorites)
      .values({ userId: user.id, paperId: id })
      .onConflictDoNothing();

    return NextResponse.json({ favorited: true });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!await getReadablePaper(id, user?.id)) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录");

    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, user.id), eq(favorites.paperId, id)));

    return NextResponse.json({ favorited: false });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!await getReadablePaper(id, user?.id)) return jsonError("NOT_FOUND", 404);
    if (!user) return NextResponse.json({ favorited: false, progress: null }, { headers: PRIVATE_RESPONSE_HEADERS });

    const [favorite] = await db
      .select({ paperId: favorites.paperId })
      .from(favorites)
      .where(and(eq(favorites.userId, user.id), eq(favorites.paperId, id)))
      .limit(1);

    const [progress] = await db
      .select({ page: readingProgress.page, yNorm: readingProgress.yNorm, progress: readingProgress.progress })
      .from(readingProgress)
      .where(and(eq(readingProgress.userId, user.id), eq(readingProgress.paperId, id)))
      .limit(1);

    return NextResponse.json({ favorited: Boolean(favorite), progress: progress ?? null }, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    return errorFromUnknown(error);
  }
}
