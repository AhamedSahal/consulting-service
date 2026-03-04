-- Companies & company document embeddings
-- This migration is additive on top of 001_init.sql and 002_embeddings_and_jd.sql.

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'company_status') THEN
    CREATE TYPE company_status AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'company_document_type') THEN
    CREATE TYPE company_document_type AS ENUM ('STRATEGY_DOC', 'ORG_STRUCTURE', 'OLD_JD', 'POLICY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'company_embedding_status') THEN
    CREATE TYPE company_embedding_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
  END IF;
END$$;

-- Companies table – extend existing table with additional fields if needed
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS status company_status DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS tags jsonb,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Company documents
CREATE TABLE IF NOT EXISTS company_documents (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  doc_type company_document_type,
  title text NOT NULL,
  file_url text NOT NULL,
  original_filename text,
  mime_type text,
  embedding_status company_embedding_status DEFAULT 'PENDING',
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_documents_company ON company_documents (company_id);
CREATE INDEX IF NOT EXISTS idx_company_documents_company_type ON company_documents (company_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_company_documents_status ON company_documents (embedding_status);

-- Company document chunks (pgvector-backed)
CREATE TABLE IF NOT EXISTS company_document_chunks (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_document_id bigint NOT NULL REFERENCES company_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_document_chunks_company
  ON company_document_chunks (company_id, company_document_id, chunk_index);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'idx_company_document_chunks_embedding_cosine'
      AND n.nspname = 'public'
  ) THEN
    CREATE INDEX idx_company_document_chunks_embedding_cosine
      ON company_document_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END$$;

