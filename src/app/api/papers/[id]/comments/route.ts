import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, users } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { getPrivacySettings } from "@/lib/me/settings";
import { errorFromUnknown, jsonError } from "@/lib/api";
import { broadcast } from "@/lib/realtime";
import { notifyReply } from "@/lib/notifications/queries";
import type { CommentDTO } from "@/lib/comments/types";
import {
  COMMENT_KINDS,
  CommentError,
  assertCanPost,
  listComments,
  recountComment,
} from "@/lib/comments/queries";

const anchorSchema = z.object({
  page: z.number().int().min(1),
  yNorm: z.number().min(0).max(1),
  xNorm: z.number().min(0).max(1).nullable().optional(),
  quote: z.string().max(2000).nullable().optional(),
  quotePrefix: z.string().max(200).nullable().optional(),
  quoteSuffix: z.string().max(200).nullable().optional(),
  charStart: z.number().int().min(0).nullable().optional(),
  charEnd: z.number().int().min(0).nullable().optional(),
  blockId: z.string().max(120).nullable().optional(),
});

const bodySchema = z.object({
  content: z.string().min(1).max(1000),
  kind: z.enum(COMMENT_KINDS),
  anchor: anchorSchema,
  displayMode: z.enum(["immediate", "position"]).default("position"),
  parentId: z.number().int().positive().nullable().optional(),
  // Omitted means "use my account default"; the reader sends an explicit value
  // when the composer checkbox is toggled (PRIVACY-001).
  anonymous: z.boolean().optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const spread = Number(url.searchParams.get("spread") ?? "1") || 1;
    const kind = url.searchParams.get("kind");
    const sort = url.searchParams.get("sort") === "hot" ? "hot" : "time";
    const user = await currentUser();

    const result = await listComments({
      paperId: id,
      fromPage: Math.max(1, page - spread),
      toPage: page + spread,
      kind,
      sort,
      viewerId: user?.id ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录后发布评论");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("INVALID_INPUT", 400, "评论内容或位置数据无效");
    }

    const content = parsed.data.content.trim();
    if (!content) return jsonError("INVALID_INPUT", 400, "评论内容不能为空");

    await assertCanPost(user.id, content);

    // Visibility is copied onto the comment at publish time; later changes to
    // the account settings apply only to new comments (docs/03-requirements.md 6).
    const privacy = await getPrivacySettings(user.id);
    const isAnonymous = parsed.data.anonymous ?? privacy?.anonymousDefault ?? false;

    const { anchor } = parsed.data;
    const [created] = await db
      .insert(comments)
      .values({
        paperId: id,
        userId: user.id,
        parentId: parsed.data.parentId ?? null,
        content,
        kind: parsed.data.kind,
        page: anchor.page,
        yNorm: anchor.yNorm,
        xNorm: anchor.xNorm ?? null,
        quote: anchor.quote ?? null,
        quotePrefix: anchor.quotePrefix ?? null,
        quoteSuffix: anchor.quoteSuffix ?? null,
        charStart: anchor.charStart ?? null,
        charEnd: anchor.charEnd ?? null,
        blockId: anchor.blockId ?? null,
        anchorDegraded: !anchor.quote,
        displayMode: parsed.data.displayMode,
        isAnonymous,
        visibleInProfile: privacy?.profileCommentsVisible ?? true,
        visibleInDanmaku: privacy?.danmakuVisible ?? true,
      })
      .returning();

    if (created.parentId) {
      await recountComment(created.parentId);
      // The reply chain was previously invisible to the person being replied to.
      await notifyReply({
        parentId: created.parentId,
        commentId: created.id,
        paperId: id,
        actorId: user.id,
      });
    }

    await db
      .update(users)
      .set({ reputation: sql`${users.reputation} + 1` })
      .where(eq(users.id, user.id));

    const dto: CommentDTO = {
      ...created,
      createdAt: created.createdAt.toISOString(),
      // Mirrors the read path: an anonymous comment ships without its author.
      authorName: isAnonymous ? null : user.name,
      likedByMe: false,
    };

    // Other readers on this paper refresh their page; the payload carries the
    // new comment so an immediate-display comment can enter the danmaku layer
    // without waiting for a round trip.
    broadcast(id, { type: "comment:new", comment: dto });

    return NextResponse.json({ comment: dto }, { status: 201 });
  } catch (error) {
    if (error instanceof CommentError) {
      return jsonError(error.code, error.status, error.message);
    }
    return errorFromUnknown(error);
  }
}
