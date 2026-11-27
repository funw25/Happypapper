ALTER TABLE comments ADD COLUMN danmaku_text text;
ALTER TABLE comments ADD COLUMN client_request_id uuid;
ALTER TABLE comments ADD COLUMN request_hash text;
CREATE UNIQUE INDEX comments_user_request_idx ON comments(user_id, client_request_id);

UPDATE comments
SET danmaku_text = CASE WHEN char_length(content) <= 80 THEN content ELSE left(content, 79) || '…' END
WHERE visible_in_danmaku AND parent_id IS NULL;
UPDATE comments SET visible_in_danmaku = false WHERE parent_id IS NOT NULL;
