import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, papers } from "@/db/schema";
import { readablePapers } from "@/lib/papers/access";
import type { DanmakuItem, DanmakuPage } from "./danmaku-types";

const TTL = 10 * 60_000;
const MAX_CANDIDATES = 10_000;
const MAX_SNAPSHOTS = 40;
const MAX_SNAPSHOTS_PER_FILTER = 2;

type Filter = {
  paperId: string;
  viewerId: string | null;
  versionId: string | null;
  page: number | null;
  kind: string;
};
type Cursor =
  | { mode: "latest"; expiry: number; watermark: string; created: string; beforeId: string }
  | { mode: "hot"; expiry: number; snapshotId: string; offset: number };
type Snapshot = { binding: string; expiry: number; ids: string[]; truncated: boolean };

const globalState = globalThis as typeof globalThis & {
  happypaperDanmaku?: { key: Buffer; snapshots: Map<string, Snapshot> };
};
const state = globalState.happypaperDanmaku ??= { key: randomBytes(32), snapshots: new Map<string, Snapshot>() };

function signature(binding: string, payload: string) {
  return createHmac("sha256", state.key).update(binding).update("\n").update(payload).digest();
}

function encodeCursor(binding: string, cursor: Cursor) {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return payload + "." + signature(binding, payload).toString("base64url");
}

function readCursor(binding: string, token: string | undefined, mode: Cursor["mode"]) {
  if (!token) return undefined;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(mac)) return null;
  const actual = Buffer.from(mac, "base64url");
  if (actual.toString("base64url") !== mac || actual.length !== 32 || !timingSafeEqual(actual, signature(binding, payload))) return null;
  const cursor: Cursor = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return cursor.mode === mode && cursor.expiry > Date.now() ? cursor : null;
}

const isWholePaper = sql<boolean>`${comments.anchorV2}->>'type' = 'paper'`;
const fields = {
  id: sql<string>`${comments.id}::text`,
  text: sql<string>`btrim(${comments.danmakuText})`,
  page: sql<number | null>`case when ${isWholePaper} then null else ${comments.page} end`,
};

function candidates(query: Filter) {
  const version = query.versionId ? eq(comments.paperVersionId, query.versionId) : isNull(comments.paperVersionId);
  return and(
    eq(comments.paperId, query.paperId), readablePapers(query.viewerId),
    eq(comments.status, "visible"), isNull(comments.parentId), eq(comments.visibleInDanmaku, true),
    sql`char_length(btrim(${comments.danmakuText})) between 1 and 80`,
    query.kind === "all" ? undefined : eq(comments.kind, query.kind),
    query.page === null ? or(isWholePaper, version) : and(
      version, eq(comments.page, query.page), sql`${isWholePaper} is not true`,
    ),
  );
}

async function latest(query: Filter, binding: string, limit: number, cursor?: Extract<Cursor, { mode: "latest" }>): Promise<DanmakuPage> {
  const where = candidates(query);
  // Comment creation locks the paper row before assigning its ID. The first
  // page captures the highest eligible ID, while the keyset orders by time.
  const watermark = cursor?.watermark ?? (await db.select({ id: fields.id }).from(comments)
    .innerJoin(papers, eq(papers.id, comments.paperId)).where(where).orderBy(desc(comments.id)).limit(1))[0]?.id ?? "0";
  const expiry = cursor?.expiry ?? Date.now() + TTL;
  const rows = await db.select({ ...fields, created: sql<string>`${comments.createdAt}::text` }).from(comments)
    .innerJoin(papers, eq(papers.id, comments.paperId))
    .where(and(where, sql`${comments.id} <= ${watermark}::bigint`, cursor
      ? sql`(${comments.createdAt}, ${comments.id}) < (${cursor.created}::timestamptz, ${cursor.beforeId}::bigint)` : undefined))
    .orderBy(desc(comments.createdAt), desc(comments.id)).limit(limit + 1);
  const end = rows[limit - 1];
  return {
    items: rows.slice(0, limit).map(({ id, text, page }) => ({ id, text, page })),
    nextCursor: rows.length > limit ? encodeCursor(binding, {
      mode: "latest", expiry, watermark, created: end.created, beforeId: end.id,
    }) : null,
    truncated: false,
  };
}

// Counters on older comments can include self likes and multiple replies from
// one account. Rank using the eligible rows at snapshot creation time.
const hotScore = sql`2 * (select count(*) from comment_likes l join users u on u.id = l.user_id
  where l.comment_id = ${comments.id} and l.user_id is distinct from ${comments.userId} and u.email_verified is not null)
  + least(10, (select count(distinct r.user_id) from comments r where r.parent_id = ${comments.id}
    and r.status = 'visible' and r.user_id is distinct from ${comments.userId}))`;

async function createSnapshot(query: Filter, binding: string) {
  const rows = await db.select({ id: fields.id }).from(comments).innerJoin(papers, eq(papers.id, comments.paperId))
    .where(candidates(query)).orderBy(desc(hotScore), desc(comments.createdAt), desc(comments.id)).limit(MAX_CANDIDATES + 1);
  const now = Date.now();
  const matching: string[] = [];
  for (const [id, snapshot] of state.snapshots) {
    if (snapshot.expiry <= now) state.snapshots.delete(id);
    else if (snapshot.binding === binding) matching.push(id);
  }
  for (const id of matching.slice(0, Math.max(0, matching.length - MAX_SNAPSHOTS_PER_FILTER + 1))) state.snapshots.delete(id);
  if (state.snapshots.size >= MAX_SNAPSHOTS) {
    const oldest = state.snapshots.keys().next().value;
    if (oldest) state.snapshots.delete(oldest);
  }
  const snapshotId = randomUUID();
  const snapshot: Snapshot = {
    binding, expiry: now + TTL, ids: rows.slice(0, MAX_CANDIDATES).map(({ id }) => id),
    truncated: rows.length > MAX_CANDIDATES,
  };
  state.snapshots.set(snapshotId, snapshot);
  return { snapshotId, snapshot };
}

async function hot(query: Filter, binding: string, limit: number, cursor?: Extract<Cursor, { mode: "hot" }>): Promise<DanmakuPage | null> {
  const { snapshotId, snapshot } = cursor
    ? { snapshotId: cursor.snapshotId, snapshot: state.snapshots.get(cursor.snapshotId) }
    : await createSnapshot(query, binding);
  if (!snapshot || snapshot.binding !== binding || snapshot.expiry <= Date.now()) return null;

  let offset = cursor?.offset ?? 0;
  const items: DanmakuItem[] = [];
  // A removed item consumes its original slot. Bound work even if a large
  // moderation action has removed most entries from an old snapshot.
  for (let batch = 0; batch < 5 && offset < snapshot.ids.length && items.length < limit; batch++) {
    const ids = snapshot.ids.slice(offset, offset + limit - items.length);
    const rows = await db.select(fields).from(comments).innerJoin(papers, eq(papers.id, comments.paperId)).where(and(
      candidates(query), sql`${comments.id} in (${sql.join(ids.map((id) => sql`${id}::bigint`), sql`, `)})`,
    ));
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (row) items.push(row);
    }
    offset += ids.length;
  }
  return {
    items, truncated: snapshot.truncated,
    nextCursor: offset < snapshot.ids.length ? encodeCursor(binding, {
      mode: "hot", expiry: snapshot.expiry, snapshotId, offset,
    }) : null,
  };
}

export async function listDanmaku(query: Filter, mode: Cursor["mode"], session: string, limit: number, token?: string) {
  const binding = JSON.stringify([query, session, mode]);
  const cursor = readCursor(binding, token, mode);
  if (cursor === null) return null;
  return mode === "hot"
    ? hot(query, binding, limit, cursor?.mode === "hot" ? cursor : undefined)
    : latest(query, binding, limit, cursor?.mode === "latest" ? cursor : undefined);
}
