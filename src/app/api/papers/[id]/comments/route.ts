import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, papers, users } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { getPrivacySettings } from "@/lib/me/settings";
import { errorFromUnknown, jsonError, PRIVATE_RESPONSE_HEADERS } from "@/lib/api";
import { broadcast } from "@/lib/realtime";
import { notifyReply } from "@/lib/notifications/queries";
import { canInteract, canReadPaper, getReadablePaper } from "@/lib/papers/access";
import { getPaperVersion } from "@/lib/papers/versions";
import { codePointCount } from "@/lib/anchor-v2";
import { anchorV2Schema, legacyAnchorSchema, resolveAnchor } from "@/lib/comments/anchors";
import {
  COMMENT_KINDS, CommentError, assertCanPost, commentViewer, getComment, getCommentDTO, listComments, recountComment,
} from "@/lib/comments/queries";

const bodySchema = z.object({
  content: z.string().trim().min(1).refine((text) => codePointCount(text) <= 2000),
  kind: z.enum(COMMENT_KINDS),
  anchor: z.union([anchorV2Schema, legacyAnchorSchema]),
  displayMode: z.enum(["immediate", "position"]).default("position"),
  parentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  anonymous: z.boolean().optional(),
  danmaku: z.discriminatedUnion("enabled", [
    z.object({ enabled: z.literal(false) }),
    z.object({
      enabled: z.literal(true),
      text: z.string().trim().min(1).refine((text) => codePointCount(text) <= 80),
    }),
  ]).optional(),
});

const viewSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  spread: z.coerce.number().int().min(0).max(10).default(1),
  sort: z.enum(["time", "hot"]).default("time"),
  kind: z.enum(["all", ...COMMENT_KINDS]).default("all"),
  version: z.uuid().optional(),
  focus: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    const parsed = viewSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return jsonError("INVALID_INPUT", 400, "评论列表参数无效");
    const { page, spread, kind, sort, version, focus } = parsed.data;
    const selected = await getPaperVersion(paper, version);
    if (version && (!selected || selected.processingState === "unavailable")) return jsonError("NOT_FOUND", 404);
    const target = focus ? await getComment(focus, user?.id) : null;
    const focusRootId = target?.paperId === paper.id && target.status === "visible"
      ? target.parentId ?? target.id : undefined;

    const result = await listComments({
      paperId: paper.id, fromPage: Math.max(1, page - spread), toPage: page + spread,
      kind, sort, viewerId: user?.id ?? null, versionId: selected?.id, focusRootId,
    });
    return NextResponse.json(result, { headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    return errorFromUnknown(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const user = await currentUser();
    const paper = await getReadablePaper(id, user?.id);
    if (!paper) return jsonError("NOT_FOUND", 404);
    if (!user) return jsonError("UNAUTHORIZED", 401, "请先登录后发布评论");
    if (!canInteract(user)) return jsonError("EMAIL_UNVERIFIED", 403, "验证邮箱后即可发布评论");

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    const requestId = request.headers.get("idempotency-key");
    if (!parsed.success || (requestId !== null && !z.uuid().safeParse(requestId).success)) {
      return jsonError("INVALID_INPUT", 400, "请检查评论、弹幕文案和位置后重试");
    }
    const payload = parsed.data;
    const hash = requestId ? createHash("sha256").update(JSON.stringify({ paperId: paper.id, payload })).digest("hex") : null;
    const anchor = payload.parentId ? null : await resolveAnchor(paper, payload.anchor);
    const privacy = await getPrivacySettings(user.id);

    const saved = await db.transaction(async (tx) => {
      const [currentPaper] = await tx.select().from(papers).where(eq(papers.id, paper.id)).for("update");
      if (!canReadPaper(currentPaper, user.id)) throw new CommentError("NOT_FOUND", 404, "论文不可用");
      const [actor] = await tx.select({ emailVerified: users.emailVerified }).from(users)
        .where(eq(users.id, user.id)).for("update");
      if (!actor?.emailVerified) throw new CommentError("EMAIL_UNVERIFIED", 403, "验证邮箱后即可发布评论");

      if (requestId) {
        const [previous] = await tx.select({ id: comments.id, status: comments.status, requestHash: comments.requestHash })
          .from(comments).where(and(eq(comments.userId, user.id), eq(comments.clientRequestId, requestId))).limit(1);
        if (previous) {
          if (previous.requestHash !== hash) throw new CommentError("IDEMPOTENCY_CONFLICT", 409, "提交内容已变化，请重新发送");
          if (previous.status !== "visible") throw new CommentError("COMMENT_UNAVAILABLE", 410, "该评论已关闭访问");
          return { id: previous.id, created: false };
        }
      }

      const [parent] = payload.parentId ? await tx.select().from(comments)
        .where(and(eq(comments.id, payload.parentId), eq(comments.paperId, paper.id), eq(comments.status, "visible")))
        .limit(1) : [];
      if (payload.parentId && !parent) throw new CommentError("NOT_FOUND", 404, "该回复目标不可用");

      await assertCanPost(user.id, payload.content, tx);

      const target = parent ? {
        page: parent.page, yNorm: parent.yNorm, xNorm: parent.xNorm,
        quote: parent.quote, quotePrefix: parent.quotePrefix, quoteSuffix: parent.quoteSuffix,
        charStart: parent.charStart, charEnd: parent.charEnd, blockId: parent.blockId,
        anchorDegraded: parent.anchorDegraded, anchorVersion: parent.anchorVersion,
        anchorV2: parent.anchorV2, paperVersionId: parent.paperVersionId,
      } : anchor;
      if (!target) throw new CommentError("INVALID_ANCHOR", 400, "评论位置无效");

      const danmakuText = parent ? null : payload.danmaku
        ? (payload.danmaku.enabled ? payload.danmaku.text : null)
        : privacy?.danmakuVisible !== false && codePointCount(payload.content) <= 80 ? payload.content : null;

      const [created] = await tx.insert(comments).values({
        ...target, paperId: paper.id, userId: user.id, parentId: parent?.id ?? null,
        content: payload.content, kind: payload.kind, displayMode: parent?.displayMode ?? payload.displayMode,
        isAnonymous: payload.anonymous ?? privacy?.anonymousDefault ?? false,
        visibleInProfile: privacy?.profileCommentsVisible ?? true, visibleInDanmaku: danmakuText !== null,
        danmakuText, clientRequestId: requestId, requestHash: hash,
      }).returning({ id: comments.id });

      if (parent) {
        await recountComment(parent.id, tx);
        await notifyReply({ parentId: parent.id, commentId: created.id, paperId: paper.id, actorId: user.id }, tx);
      }
      await tx.update(users).set({ reputation: sql`${users.reputation} + 1` }).where(eq(users.id, user.id));
      return { id: created.id, created: true };
    });

    const dto = await getCommentDTO(saved.id, user.id);
    if (!dto) return jsonError("NOT_FOUND", 404);
    if (saved.created) broadcast(paper.id, { type: "comment:new", comment: { ...dto, viewer: commentViewer(false) } });
    return NextResponse.json({ comment: dto }, { status: saved.created ? 201 : 200, headers: PRIVATE_RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof CommentError) return jsonError(error.code, error.status, error.message);
    return errorFromUnknown(error);
  }
}
