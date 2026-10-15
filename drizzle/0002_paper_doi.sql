-- OpenAlex reports a DOI for arXiv preprints too (the DataCite 10.48550 form),
-- so it is stored separately from the identifier the user typed.
alter table "papers" add column if not exists "doi" text;
create index if not exists "papers_doi_idx" on "papers" ("doi");
