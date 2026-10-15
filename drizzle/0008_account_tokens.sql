-- 账号闭环所需的一次性令牌（docs/03-requirements.md AUTH-006、AUTH-007、PROFILE-008）
--
-- 邮箱验证、修改邮箱与密码找回共用一张表：令牌只存 SHA-256 摘要，原始值只出现在
-- 发出的链接里，因此数据库被读到也无法直接使用。一次使用即作废，并带过期时间。
alter table "users" add column if not exists "pending_email" text;

create table if not exists "account_tokens" (
  "id" bigserial primary key,
  "user_id" uuid not null references "users"("id") on delete cascade,
  "purpose" text not null,
  "token_hash" text not null,
  "expires_at" timestamp with time zone not null,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone not null default now()
);

create unique index if not exists "account_tokens_hash_idx" on "account_tokens" ("token_hash");
create index if not exists "account_tokens_user_purpose_idx" on "account_tokens" ("user_id", "purpose");
