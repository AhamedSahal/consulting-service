-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;

-- Embeddings table for pgvector-backed search
CREATE TABLE IF NOT EXISTS embeddings (
  id bigserial PRIMARY KEY,
  owner_type text NOT NULL, -- e.g. 'MODULE', 'COMPANY'
  module_key text,
  company_id bigint,
  document_id bigint,
  doc_type text,
  chunk_index integer,
  chunk_text text,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_owner_type ON embeddings (owner_type);
CREATE INDEX IF NOT EXISTS idx_embeddings_doc_type ON embeddings (doc_type);

-- Guard index creation on legacy columns so this migration stays
-- compatible with databases where embeddings has already been
-- refactored to use owner_type/owner_id instead of module_key/company_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'embeddings'
      AND column_name = 'module_key'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_embeddings_module_key ON embeddings (module_key);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'embeddings'
      AND column_name = 'company_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_embeddings_company_id ON embeddings (company_id);
  END IF;
END$$;

-- Optional IVFFLAT index for faster similarity search (requires ANALYZE after large inserts)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_embeddings_embedding_cosine'
      AND n.nspname = 'public'
  ) THEN
    CREATE INDEX idx_embeddings_embedding_cosine
      ON embeddings
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END$$;

-- Module documents (e.g. JD playbooks)
CREATE TABLE IF NOT EXISTS module_documents (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL,
  module_key text NOT NULL,
  document_type text NOT NULL,
  original_filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_module_documents_company_module_type
  ON module_documents (company_id, module_key, document_type, uploaded_at DESC);

-- JD drafts and versions
CREATE TABLE IF NOT EXISTS jd_drafts (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL,
  module_key text NOT NULL,
  title text NOT NULL,
  description text,
  content jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jd_versions (
  id bigserial PRIMARY KEY,
  jd_draft_id bigint NOT NULL REFERENCES jd_drafts(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  content jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jd_versions_draft_version
  ON jd_versions (jd_draft_id, version_number DESC);

