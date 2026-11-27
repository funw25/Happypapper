CREATE TABLE paper_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version_label text NOT NULL,
  source_type text NOT NULL,
  source_url text,
  pdf_key text NOT NULL,
  sha256 text,
  page_count integer CHECK (page_count > 0),
  processing_state text NOT NULL CHECK (processing_state IN ('ready', 'legacy', 'unavailable')),
  parser_version text,
  rights_confirmation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, id),
  UNIQUE (paper_id, sha256)
);

CREATE TABLE paper_pages (
  version_id uuid NOT NULL REFERENCES paper_versions(id) ON DELETE CASCADE,
  page integer NOT NULL CHECK (page > 0),
  width real NOT NULL CHECK (width > 0),
  height real NOT NULL CHECK (height > 0),
  rotation smallint NOT NULL CHECK (rotation IN (0, 90, 180, 270)),
  text_status text NOT NULL CHECK (text_status IN ('text', 'image')),
  normalized_text text NOT NULL,
  PRIMARY KEY (version_id, page)
);

ALTER TABLE papers ADD COLUMN default_version_id uuid;
ALTER TABLE papers ADD CONSTRAINT papers_default_version_fk
  FOREIGN KEY (id, default_version_id) REFERENCES paper_versions(paper_id, id);

ALTER TABLE comments ADD COLUMN paper_version_id uuid;
ALTER TABLE comments ADD COLUMN anchor_v2 jsonb;
ALTER TABLE comments ADD CONSTRAINT comments_paper_version_fk
  FOREIGN KEY (paper_id, paper_version_id) REFERENCES paper_versions(paper_id, id);
CREATE INDEX comments_version_page_idx ON comments(paper_id, paper_version_id, page);

CREATE TABLE reading_progress_by_version (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  page integer NOT NULL,
  y_norm real NOT NULL,
  progress real NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, paper_id, version_id),
  FOREIGN KEY (paper_id, version_id) REFERENCES paper_versions(paper_id, id) ON DELETE CASCADE
);

INSERT INTO paper_versions (paper_id, version_label, source_type, source_url, pdf_key, processing_state, created_at)
SELECT id, '历史版本', source, pdf_url, pdf_path, 'legacy', created_at
FROM papers WHERE pdf_path IS NOT NULL;

UPDATE papers AS p SET default_version_id = v.id FROM paper_versions AS v WHERE v.paper_id = p.id;

UPDATE comments AS c
SET paper_version_id = p.default_version_id,
    anchor_v2 = jsonb_strip_nulls(jsonb_build_object(
      'type', CASE WHEN nullif(c.quote, '') IS NULL THEN 'page' ELSE 'text' END,
      'version', 2, 'paperVersionId', p.default_version_id, 'page', c.page, 'rects', '[]'::jsonb,
      'quote', c.quote, 'prefix', c.quote_prefix, 'suffix', c.quote_suffix
    ))
FROM papers AS p WHERE p.id = c.paper_id AND p.default_version_id IS NOT NULL;

INSERT INTO reading_progress_by_version (user_id, paper_id, version_id, page, y_norm, progress, updated_at)
SELECT r.user_id, r.paper_id, p.default_version_id, r.page, r.y_norm, r.progress, r.updated_at
FROM reading_progress AS r JOIN papers AS p ON p.id = r.paper_id WHERE p.default_version_id IS NOT NULL;
