-- 个人资料、匿名与内容可见性设置（docs/03-requirements.md 5、6 节）
alter table "users" add column if not exists "bio" text;
alter table "users" add column if not exists "anonymous_default" boolean not null default false;
alter table "users" add column if not exists "profile_comments_visible" boolean not null default true;
alter table "users" add column if not exists "danmaku_visible" boolean not null default true;

-- 评论级快照：发布时的署名方式与可见性，之后改设置不影响历史评论
alter table "comments" add column if not exists "is_anonymous" boolean not null default false;
alter table "comments" add column if not exists "visible_in_profile" boolean not null default true;
alter table "comments" add column if not exists "visible_in_danmaku" boolean not null default true;

create index if not exists "comments_user_visible_idx"
  on "comments" ("user_id", "visible_in_profile", "created_at");
