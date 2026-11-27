import type { AnchorV2 } from "@/lib/anchor-v2";
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  bigint,
  bigserial,
  boolean,
  real,
  jsonb,
  timestamp,
  primaryKey,
  index,
  uniqueIndex,
  customType,
  date,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Decimal strings preserve bigint revisions across HTTP boundaries.
const revisionColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "bigint",
  fromDriver: (value) => String(value),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().unique(),
  // Named `image` because @auth/drizzle-adapter reads that property; the column
  // keeps this project's name. Avatars are rendered from the nickname instead
  // (see src/lib/avatar.ts), so this column only records what an OAuth provider
  // supplied and is not used for display.
  image: text("avatar_url"),
  avatarBg: text("avatar_bg").notNull().default("#002FA7"),
  avatarFg: text("avatar_fg").notNull().default("#FFFFFF"),
  // Null for accounts created through GitHub, which have no local password yet.
  passwordHash: text("password_hash"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  // Set while an email change awaits confirmation at the new address; the old
  // address keeps working until the link is opened (AUTH-007).
  pendingEmail: text("pending_email"),
  bio: text("bio"),
  role: text("role").notNull().default("user"),
  reputation: integer("reputation").notNull().default(0),
  notifyLikes: boolean("notify_likes").notNull().default(true),
  // Defaults applied to newly published comments; existing rows keep their own
  // snapshot columns so changing a preference never rewrites history.
  anonymousDefault: boolean("anonymous_default").notNull().default(false),
  profileCommentsVisible: boolean("profile_comments_visible").notNull().default(true),
  danmakuVisible: boolean("danmaku_visible").notNull().default(true),
  mutedUntil: timestamp("muted_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * OAuth identities. The property names are fixed by @auth/drizzle-adapter: it
 * looks columns up by property name, which is why the token fields keep the
 * adapter's snake_case spelling while the rest of the schema is camelCase.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    expires_at: integer("expires_at"),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const papers = pgTable(
  "papers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalId: text("external_id"),
    doi: text("doi"),
    title: text("title").notNull(),
    abstract: text("abstract"),
    authors: jsonb("authors").$type<string[]>().notNull().default([]),
    year: integer("year"),
    venue: text("venue"),
    tags: text("tags").array().notNull().default([]),
    pdfPath: text("pdf_path"),
    pdfUrl: text("pdf_url"),
    // A row exists as soon as metadata is found, so "no PDF yet" is a normal
    // state. `pdfFetchError` carries the last failure code and `pdfCheckedAt`
    // when it was recorded; both drive the retry affordance on the detail page.
    pdfFetchError: text("pdf_fetch_error"),
    pdfCheckedAt: timestamp("pdf_checked_at", { withTimezone: true }),
    license: text("license"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("active"),
    contentRevision: revisionColumn("content_revision").notNull().default("0"),
    defaultVersionId: uuid("default_version_id"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    hasTextLayer: boolean("has_text_layer").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("papers_title_idx").on(t.title),
    index("papers_created_idx").on(t.createdAt),
    index("papers_external_idx").on(t.source, t.externalId),
  ],
);

export const paperVersions = pgTable("paper_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  versionLabel: text("version_label").notNull(),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url"),
  pdfKey: text("pdf_key").notNull(),
  sha256: text("sha256"),
  pageCount: integer("page_count"),
  processingState: text("processing_state").notNull(),
  parserVersion: text("parser_version"),
  rightsConfirmation: jsonb("rights_confirmation").$type<{ actorId: string; confirmedAt: string; statementVersion: number }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paperEvents = pgTable("paper_events", {
  paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  revision: revisionColumn("revision").notNull(),
  type: text("type").notNull(),
  commentId: bigint("comment_id", { mode: "number" }),
  paperVersionId: uuid("paper_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.paperId, t.revision] }), index("paper_events_retention_idx").on(t.createdAt)]);

export const paperPages = pgTable("paper_pages", {
  versionId: uuid("version_id").notNull().references(() => paperVersions.id, { onDelete: "cascade" }),
  page: integer("page").notNull(),
  width: real("width").notNull(),
  height: real("height").notNull(),
  rotation: smallint("rotation").notNull(),
  textStatus: text("text_status").notNull(),
  normalizedText: text("normalized_text").notNull(),
}, (t) => [primaryKey({ columns: [t.versionId, t.page] })]);

export const paperVisits = pgTable("paper_visits", {
  paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  visitDay: date("visit_day", { mode: "string" }).notNull(),
  visitorKey: text("visitor_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.paperId, t.visitDay, t.visitorKey] }),
  index("paper_visits_day_idx").on(t.visitDay, t.paperId)]);

export const readingProgressByVersion = pgTable("reading_progress_by_version", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  paperId: uuid("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  versionId: uuid("version_id").notNull(),
  page: integer("page").notNull(),
  yNorm: real("y_norm").notNull(),
  progress: real("progress").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.paperId, t.versionId] })]);

export const comments = pgTable(
  "comments",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    parentId: bigint("parent_id", { mode: "number" }).references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    kind: text("kind").notNull().default("other"),
    page: integer("page").notNull(),
    yNorm: real("y_norm").notNull(),
    xNorm: real("x_norm"),
    quote: text("quote"),
    quotePrefix: text("quote_prefix"),
    quoteSuffix: text("quote_suffix"),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    blockId: text("block_id"),
    anchorVersion: smallint("anchor_version").notNull().default(1),
    paperVersionId: uuid("paper_version_id"),
    anchorV2: jsonb("anchor_v2").$type<AnchorV2>(),
    anchorDegraded: boolean("anchor_degraded").notNull().default(false),
    displayMode: text("display_mode").notNull().default("position"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    visibleInProfile: boolean("visible_in_profile").notNull().default(true),
    visibleInDanmaku: boolean("visible_in_danmaku").notNull().default(true),
    danmakuText: text("danmaku_text"),
    clientRequestId: uuid("client_request_id"),
    requestHash: text("request_hash"),
    status: text("status").notNull().default("visible"),
    likeCount: integer("like_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_paper_page_idx").on(t.paperId, t.page, t.yNorm),
    index("comments_paper_created_idx").on(t.paperId, t.createdAt),
    index("comments_danmaku_latest_idx").on(t.paperId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'visible' and ${t.parentId} is null and ${t.visibleInDanmaku}`),
    index("comments_parent_idx").on(t.parentId),
    index("comments_user_visible_idx").on(t.userId, t.visibleInProfile, t.createdAt),
  ],
);

export const commentLikes = pgTable(
  "comment_likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: bigint("comment_id", { mode: "number" })
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.commentId] }), index("comment_likes_comment_idx").on(t.commentId)],
);

// Closed intervals preserve the state at a daily board's cutoff.
export const commentLikeHistory = pgTable("comment_like_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  commentId: bigint("comment_id", { mode: "number" }).notNull().references(() => comments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (t) => [index("comment_like_history_day_idx").on(t.createdAt, t.commentId),
  uniqueIndex("comment_like_history_open_idx").on(t.commentId, t.userId).where(sql`${t.endedAt} is null`)]);

export const reports = pgTable(
  "reports",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    commentId: bigint("comment_id", { mode: "number" })
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    detail: text("detail"),
    status: text("status").notNull().default("open"),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reports_comment_reporter_idx").on(t.commentId, t.reporterId),
    index("reports_status_idx").on(t.status, t.createdAt),
  ],
);

export const readingProgress = pgTable(
  "reading_progress",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    page: integer("page").notNull().default(1),
    yNorm: real("y_norm").notNull().default(0),
    progress: real("progress").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.paperId] })],
);

export const favorites = pgTable(
  "favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.paperId] })],
);

export const bannedWords = pgTable("banned_words", {
  word: text("word").primaryKey(),
});

/**
 * One-time tokens for email verification, email change and password reset
 * (AUTH-006, AUTH-007). Only the SHA-256 digest is stored, so a database read
 * does not yield a usable link; `used_at` makes each token single-use.
 */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("account_tokens_hash_idx").on(t.tokenHash),
    index("account_tokens_user_purpose_idx").on(t.userId, t.purpose),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    commentId: bigint("comment_id", { mode: "number" })
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull().default("reply"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_user_read_idx").on(t.userId, t.readAt),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Paper = typeof papers.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type CommentKind = "question" | "explain" | "method" | "result" | "other";
