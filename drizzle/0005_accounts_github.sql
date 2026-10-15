-- GitHub OAuth login (docs/03-requirements.md AUTH-008 to AUTH-010).
--
-- Three changes are needed to host OAuth accounts next to the existing
-- password accounts:
--   1. an `accounts` table for @auth/drizzle-adapter. The adapter reads that
--      table through drizzle's getTableColumns and accesses its token fields by
--      property name, so those keep the adapter's snake_case names.
--   2. `users.email_verified`, which the adapter's user shape expects.
--   3. `users.password_hash` becomes nullable: a GitHub-created account has no
--      password until the owner sets one. The credentials provider now rejects a
--      null hash instead of comparing against it.
alter table "users" add column if not exists "email_verified" timestamptz;
alter table "users" alter column "password_hash" drop not null;

create table if not exists "accounts" (
  "user_id"             uuid    not null references "users"("id") on delete cascade,
  "type"                text    not null,
  "provider"            text    not null,
  "provider_account_id" text    not null,
  "refresh_token"       text,
  "access_token"        text,
  "token_type"          text,
  "scope"               text,
  "id_token"            text,
  "session_state"       text,
  "expires_at"          integer,
  primary key ("provider", "provider_account_id")
);

create index if not exists "accounts_user_idx" on "accounts" ("user_id");
