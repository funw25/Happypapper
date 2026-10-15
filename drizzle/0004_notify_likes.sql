-- Like notifications. docs/02-roadmap.md B2 point 2 left "whether likes notify,
-- and at what threshold" open; the decision is a per-user opt-out that defaults
-- to on, so a reader who finds them noisy can switch them off.
alter table "users" add column if not exists "notify_likes" boolean not null default true;
