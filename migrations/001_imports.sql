BEGIN;
CREATE TABLE IF NOT EXISTS app_sessions (sid text PRIMARY KEY, data jsonb NOT NULL, expires timestamptz NOT NULL);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS raw_hash text;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS content_hash text;
CREATE INDEX IF NOT EXISTS payslips_content_hash ON payslips(username, content_hash);
CREATE TABLE IF NOT EXISTS import_sources (
 id bigserial PRIMARY KEY, owner_id integer NOT NULL REFERENCES users(id), kind text NOT NULL,
 source_key text NOT NULL, filename text NOT NULL, etag text, payslip_id integer REFERENCES payslips(id),
 UNIQUE(owner_id, kind, source_key)
);
CREATE TABLE IF NOT EXISTS import_attempts (
 id bigserial PRIMARY KEY, source_id bigint NOT NULL REFERENCES import_sources(id), etag text,
 status text NOT NULL DEFAULT 'queued', storage_name text, raw_hash text, draft jsonb,
 errors jsonb NOT NULL DEFAULT '[]', tries integer NOT NULL DEFAULT 0,
 next_retry timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
DROP INDEX IF EXISTS import_source_etag;
CREATE INDEX import_source_etag ON import_attempts(source_id, etag);
CREATE TABLE IF NOT EXISTS payslip_versions (
 id bigserial PRIMARY KEY, payslip_id integer NOT NULL REFERENCES payslips(id), attempt_id bigint REFERENCES import_attempts(id),
 data jsonb NOT NULL, storage_name text, raw_hash text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payslip_version_attempt ON payslip_versions(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS sync_state (id integer PRIMARY KEY CHECK(id=1), requested boolean NOT NULL DEFAULT false, last_started timestamptz, last_completed timestamptz, error text);
INSERT INTO sync_state(id) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;
