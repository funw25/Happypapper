-- 头像底色与字色（昵称前两个字符生成的头像）
alter table "users" add column if not exists "avatar_bg" text not null default '#002FA7';
alter table "users" add column if not exists "avatar_fg" text not null default '#FFFFFF';
