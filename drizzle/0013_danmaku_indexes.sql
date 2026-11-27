CREATE INDEX comments_danmaku_latest_idx ON comments (paper_id, created_at DESC, id DESC)
  WHERE status = 'visible' AND parent_id IS NULL AND visible_in_danmaku;

CREATE INDEX comment_likes_comment_idx ON comment_likes (comment_id);
