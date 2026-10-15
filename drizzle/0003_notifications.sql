-- Replies were invisible to the person being replied to (docs/02-roadmap.md B2).
-- One row per delivered notification; `read_at` null means unread, which is what
-- the header badge counts.
create table if not exists "notifications" (
  "id"         bigserial primary key,
  "user_id"    uuid        not null references "users"("id") on delete cascade,
  "comment_id" bigint      not null references "comments"("id") on delete cascade,
  "paper_id"   uuid        not null references "papers"("id") on delete cascade,
  "actor_id"   uuid        references "users"("id") on delete set null,
  "type"       text        not null default 'reply',
  "read_at"    timestamptz,
  "created_at" timestamptz not null default now()
);

create index if not exists "notifications_user_read_idx"
  on "notifications" ("user_id", "read_at");
create index if not exists "notifications_user_created_idx"
  on "notifications" ("user_id", "created_at" desc);
