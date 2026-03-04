-- Playbooks table for agent-level documents and owner_id on embeddings

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- Playbooks table
CREATE TABLE IF NOT EXISTS playbooks (
  id BIGSERIAL PRIMARY KEY,
  agent_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  version INT NOT NULL DEFAULT 1,
  embedding_status TEXT NOT NULL DEFAULT 'PENDING',
  error_text TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_agent ON playbooks(agent_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_status ON playbooks(embedding_status);

-- Owner linkage on embeddings table
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS owner_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_embeddings_owner ON embeddings(owner_type, owner_id);

