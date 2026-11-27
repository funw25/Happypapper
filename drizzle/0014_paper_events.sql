BEGIN;

ALTER TABLE papers ADD COLUMN content_revision bigint NOT NULL DEFAULT 0 CHECK (content_revision >= 0);

-- Deliberately contains no comment body or author information. Keep at least
-- seven days; an absent revision is handled by stream.reset during replay.
CREATE TABLE paper_events (
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  type text NOT NULL CHECK (type IN ('comment.created', 'comment.updated', 'comment.removed',
    'comment.metrics', 'paper.access_changed', 'paper.version_ready')),
  comment_id bigint,
  paper_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, revision)
);
CREATE INDEX paper_events_retention_idx ON paper_events (created_at);

-- Application writers lock paper -> comment -> user rows. The update below
-- serializes revision allocation with the business commit, including workers
-- that do not share the Web process. Rollbacks also roll back the event.
CREATE FUNCTION hp_append_paper_event(p_id uuid, event_type text, c_id bigint, v_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE next_revision bigint;
BEGIN
  UPDATE papers SET content_revision = content_revision + 1
    WHERE id = p_id RETURNING content_revision INTO next_revision;
  INSERT INTO paper_events (paper_id, revision, type, comment_id, paper_version_id)
    VALUES (p_id, next_revision, event_type, c_id, v_id);
END;
$$;

CREATE FUNCTION hp_comment_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type := CASE WHEN NEW.status = 'visible' THEN 'comment.created' ELSE 'comment.removed' END;
  ELSIF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  ELSIF NEW.status <> 'visible' THEN
    event_type := 'comment.removed';
  ELSIF (to_jsonb(NEW) - ARRAY['like_count', 'reply_count']) IS NOT DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['like_count', 'reply_count']) THEN
    event_type := 'comment.metrics';
  ELSE
    event_type := 'comment.updated';
  END IF;
  PERFORM hp_append_paper_event(NEW.paper_id, event_type, NEW.id, NEW.paper_version_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER comments_persistent_event AFTER INSERT OR UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION hp_comment_event();

CREATE FUNCTION hp_paper_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.visibility, NEW.status) IS DISTINCT FROM ROW(OLD.visibility, OLD.status) THEN
    PERFORM hp_append_paper_event(NEW.id, 'paper.access_changed', NULL, NULL);
  END IF;
  IF NEW.default_version_id IS DISTINCT FROM OLD.default_version_id THEN
    PERFORM hp_append_paper_event(NEW.id, 'paper.version_ready', NULL, NEW.default_version_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER papers_persistent_event AFTER UPDATE OF visibility, status, default_version_id ON papers
  FOR EACH ROW EXECUTE FUNCTION hp_paper_event();

COMMIT;
