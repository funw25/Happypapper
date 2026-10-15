-- HappyPaper MVP initial schema.
-- Kept in sync by hand with src/db/schema.ts.

create table if not exists "users" (
  "id" uuid primary key default gen_random_uuid() not null,
  "email" text not null,
  "name" text not null,
  "avatar_url" text,
  "password_hash" text not null,
  "role" text default 'user' not null,
  "reputation" integer default 0 not null,
  "muted_until" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  constraint "users_email_unique" unique ("email"),
  constraint "users_name_unique" unique ("name")
);

create table if not exists "papers" (
  "id" uuid primary key default gen_random_uuid() not null,
  "source" text not null,
  "external_id" text,
  "title" text not null,
  "abstract" text,
  "authors" jsonb default '[]'::jsonb not null,
  "year" integer,
  "venue" text,
  "tags" text[] default '{}' not null,
  "pdf_path" text,
  "pdf_url" text,
  "license" text,
  "visibility" text default 'public' not null,
  "uploaded_by" uuid references "users"("id") on delete set null,
  "has_text_layer" boolean default true not null,
  "created_at" timestamp with time zone default now() not null
);

create index if not exists "papers_title_idx" on "papers" ("title");
create index if not exists "papers_created_idx" on "papers" ("created_at");
create index if not exists "papers_external_idx" on "papers" ("source", "external_id");

create table if not exists "comments" (
  "id" bigserial primary key not null,
  "paper_id" uuid not null references "papers"("id") on delete cascade,
  "user_id" uuid references "users"("id") on delete set null,
  "parent_id" bigint references "comments"("id") on delete cascade,
  "content" text not null,
  "kind" text default 'other' not null,
  "page" integer not null,
  "y_norm" real not null,
  "x_norm" real,
  "quote" text,
  "quote_prefix" text,
  "quote_suffix" text,
  "char_start" integer,
  "char_end" integer,
  "block_id" text,
  "anchor_version" smallint default 1 not null,
  "anchor_degraded" boolean default false not null,
  "status" text default 'visible' not null,
  "like_count" integer default 0 not null,
  "reply_count" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create index if not exists "comments_paper_page_idx" on "comments" ("paper_id", "page", "y_norm");
create index if not exists "comments_paper_created_idx" on "comments" ("paper_id", "created_at");
create index if not exists "comments_parent_idx" on "comments" ("parent_id");

create table if not exists "comment_likes" (
  "user_id" uuid not null references "users"("id") on delete cascade,
  "comment_id" bigint not null references "comments"("id") on delete cascade,
  "created_at" timestamp with time zone default now() not null,
  constraint "comment_likes_pk" primary key ("user_id", "comment_id")
);

create table if not exists "reports" (
  "id" bigserial primary key not null,
  "comment_id" bigint not null references "comments"("id") on delete cascade,
  "reporter_id" uuid not null references "users"("id") on delete cascade,
  "reason" text not null,
  "detail" text,
  "status" text default 'open' not null,
  "handled_by" uuid references "users"("id") on delete set null,
  "handled_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create unique index if not exists "reports_comment_reporter_idx" on "reports" ("comment_id", "reporter_id");
create index if not exists "reports_status_idx" on "reports" ("status", "created_at");

create table if not exists "reading_progress" (
  "user_id" uuid not null references "users"("id") on delete cascade,
  "paper_id" uuid not null references "papers"("id") on delete cascade,
  "page" integer default 1 not null,
  "y_norm" real default 0 not null,
  "progress" real default 0 not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "reading_progress_pk" primary key ("user_id", "paper_id")
);

create table if not exists "favorites" (
  "user_id" uuid not null references "users"("id") on delete cascade,
  "paper_id" uuid not null references "papers"("id") on delete cascade,
  "created_at" timestamp with time zone default now() not null,
  constraint "favorites_pk" primary key ("user_id", "paper_id")
);

create table if not exists "banned_words" (
  "word" text primary key not null
);
