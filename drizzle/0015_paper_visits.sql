BEGIN;
-- One counted visit per paper, visitor and Beijing calendar day. No IP,
-- account identifier or raw visitor cookie is stored in this table.
CREATE TABLE paper_visits (
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  visit_day date NOT NULL,
  visitor_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, visit_day, visitor_key)
);
CREATE INDEX paper_visits_day_idx ON paper_visits (visit_day, paper_id);
CREATE TABLE comment_like_history (
  id bigserial PRIMARY KEY,
  comment_id bigint NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE INDEX comment_like_history_day_idx ON comment_like_history (created_at, comment_id);
CREATE UNIQUE INDEX comment_like_history_open_idx ON comment_like_history (comment_id, user_id) WHERE ended_at IS NULL;
INSERT INTO comment_like_history (comment_id, user_id, created_at)
  SELECT comment_id, user_id, created_at FROM comment_likes;
CREATE FUNCTION hp_like_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO comment_like_history (comment_id, user_id, created_at)
      VALUES (NEW.comment_id, NEW.user_id, NEW.created_at);
    RETURN NEW;
  END IF;
  UPDATE comment_like_history SET ended_at = now()
    WHERE comment_id = OLD.comment_id AND user_id = OLD.user_id AND ended_at IS NULL;
  RETURN OLD;
END;
$$;
CREATE TRIGGER comment_likes_history AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION hp_like_history();
COMMIT;
