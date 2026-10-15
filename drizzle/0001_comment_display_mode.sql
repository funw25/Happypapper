-- The reader lets an author choose whether a comment floats immediately on the
-- page or only appears once the reader reaches its vertical position.
alter table "comments"
  add column if not exists "display_mode" text default 'position' not null;
