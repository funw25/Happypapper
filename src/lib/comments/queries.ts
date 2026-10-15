import { and, asc, between, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bannedWords, commentLikes, comments, users } from "@/db/schema";
import type { CommentDTO } from "./types";

export const COMMENT_KINDS = ["question", "explain", "method", "result", "other"] as const;
export type CommentKindValue = (typeof COMMENT_KINDS)[number];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const MAX_CONTENT_LENGTH = 1000;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export class CommentError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type CommentRow = Omit<CommentDTO, "createdAt"> & { createdAt: Date };

function selection(viewerId: string | null) {
  return {
    id: comments.id,
    parentId: comments.parentId,
    content: comments.content,
    kind: comments.kind,
    page: comments.page,
    yNorm: comments.yNorm,
    xNorm: comments.xNorm,
    quote: comments.quote,
    quotePrefix: comments.quotePrefix,
    quoteSuffix: comments.quoteSuffix,
    charStart: comments.charStart,
    charEnd: comments.charEnd,
    blockId: comments.blockId,
    anchorDegraded: comments.anchorDegraded,
    displayMode: comments.displayMode,
    likeCount: comments.likeCount,
    replyCount: comments.replyCount,
    createdAt: comments.createdAt,
    userId: comments.userId,
    isAnonymous: comments.isAnonymous,
    visibleInDanmaku: comments.visibleInDanmaku,
    // An anonymous comment never leaves the server with its author's name;
    // admins read the real author through lib/admin/queries.ts instead.
    authorName: sql<string | null>`case when ${comments.isAnonymous} then null else ${users.name} end`.as(
      "author_name",
    ),
    likedByMe: sql<boolean>`exists(
      select 1 from "comment_likes" l
      where l.comment_id = ${comments.id} and l.user_id = ${viewerId ?? NIL_UUID}
    )`.as("liked_by_me"),
  };
}

export type CommentQuery = {
  paperId: string;
  fromPage: number;
  toPage: number;
  kind?: string | null;
  sort?: "time" | "hot";
  viewerId?: string | null;
  includeReplies?: boolean;
};

export async function listComments(query: CommentQuery) {
  const filters = [
    eq(comments.paperId, query.paperId),
    eq(comments.status, "visible"),
    isNull(comments.parentId),
    between(comments.page, query.fromPage, query.toPage),
  ];
  if (query.kind && query.kind !== "all") {
    filters.push(eq(comments.kind, query.kind));
  }

  const order =
    query.sort === "hot"
      ? [desc(sql`${comments.likeCount} * 2 + ${comments.replyCount} * 3`), desc(comments.createdAt)]
      : [asc(comments.page), asc(comments.yNorm), desc(comments.createdAt)];

  const roots = (await db
    .select(selection(query.viewerId ?? null))
    .from(comments)
    .leftJoin(users, eq(users.id, comments.userId))
    .where(and(...filters))
    .orderBy(...order)
    .limit(200)) as CommentRow[];

  if (roots.length === 0 || query.includeReplies === false) {
    return { roots, replies: [] as CommentRow[] };
  }

  const replies = (await db
    .select(selection(query.viewerId ?? null))
    .from(comments)
    .leftJoin(users, eq(users.id, comments.userId))
    .where(
      and(
        inArray(
          comments.parentId,
          roots.map((r) => r.id),
        ),
        eq(comments.status, "visible"),
      ),
    )
    .orderBy(asc(comments.createdAt))) as CommentRow[];

  return { roots, replies };
}

export async function getComment(id: number) {
  const [row] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  return row ?? null;
}

export async function loadBannedWords() {
  const words = await db.select({ word: bannedWords.word }).from(bannedWords);
  return words.map((w) => w.word);
}

export async function assertCanPost(userId: string, content: string) {
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new CommentError("TOO_LONG", 422, `评论最多 ${MAX_CONTENT_LENGTH} 字`);
  }

  const words = await loadBannedWords();
  const hit = words.find((word) => word && content.includes(word));
  if (hit) {
    throw new CommentError("BANNED_WORD", 422, `内容包含被禁止的词：${hit}`);
  }

  const [account] = await db
    .select({ mutedUntil: users.mutedUntil })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (account?.mutedUntil && account.mutedUntil.getTime() > Date.now()) {
    throw new CommentError("MUTED", 403, "账号处于禁言状态");
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [recent] = await db
    .select({ total: count() })
    .from(comments)
    .where(and(eq(comments.userId, userId), gte(comments.createdAt, since)));

  if ((recent?.total ?? 0) >= RATE_LIMIT_MAX) {
    throw new CommentError("RATE_LIMITED", 429, "发送过于频繁，请稍后再试");
  }
}

export async function recountComment(commentId: number) {
  const [likes] = await db
    .select({ total: count() })
    .from(commentLikes)
    .where(eq(commentLikes.commentId, commentId));
  const [replies] = await db
    .select({ total: count() })
    .from(comments)
    .where(and(eq(comments.parentId, commentId), eq(comments.status, "visible")));

  await db
    .update(comments)
    .set({ likeCount: likes?.total ?? 0, replyCount: replies?.total ?? 0 })
    .where(eq(comments.id, commentId));
}
