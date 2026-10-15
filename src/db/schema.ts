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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().unique(),
  // Named `image` because @auth/drizzle-adapter reads that property; the column
  // keeps this project's name.
  image: text("avatar_url"),
  // Null for accounts created through GitHub, which have no local password yet.
  passwordHash: text("password_hash"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
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
    anchorDegraded: boolean("anchor_degraded").notNull().default(false),
    displayMode: text("display_mode").notNull().default("position"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    visibleInProfile: boolean("visible_in_profile").notNull().default(true),
    visibleInDanmaku: boolean("visible_in_danmaku").notNull().default(true),
    status: text("status").notNull().default("visible"),
    likeCount: integer("like_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_paper_page_idx").on(t.paperId, t.page, t.yNorm),
    index("comments_paper_created_idx").on(t.paperId, t.createdAt),
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
  (t) => [primaryKey({ columns: [t.userId, t.commentId] })],
);

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
