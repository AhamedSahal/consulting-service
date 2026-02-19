CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- NOTE: pgvector (vector) is optional. Enable later when installed.
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'CONSULTANT',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agent templates (global)
CREATE TABLE IF NOT EXISTS agent_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  badge TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Agents (per company)
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id UUID REFERENCES agent_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT NOW()
);

-- JD Drafts
CREATE TABLE IF NOT EXISTS jd_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  job_title TEXT,
  reports_to TEXT,
  job_family TEXT,
  level TEXT,
  template_type TEXT DEFAULT 'STANDARD',
  include_percentages BOOLEAN DEFAULT false,
  role_summary TEXT,
  raw_responsibilities TEXT,
  generated_jd_json JSONB,
  current_version INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- JD Versions (for history)
CREATE TABLE IF NOT EXISTS jd_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  jd_draft_id UUID NOT NULL REFERENCES jd_drafts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  generated_jd_json JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Connections (OneDrive, etc.)
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Files (PPT templates, etc.)
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Embeddings (future - pgvector)
-- When pgvector is installed, uncomment this block and re-run a migration:
-- CREATE TABLE IF NOT EXISTS embeddings (
--   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
--   company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
--   source_type TEXT NOT NULL,
--   source_id UUID NOT NULL,
--   chunk_text TEXT NOT NULL,
--   embedding vector(1536),
--   created_at TIMESTAMP DEFAULT NOW()
-- );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_agents_company ON agents(company_id);
CREATE INDEX IF NOT EXISTS idx_jd_drafts_company ON jd_drafts(company_id);
CREATE INDEX IF NOT EXISTS idx_jd_drafts_created_by ON jd_drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_connections_company ON connections(company_id);
CREATE INDEX IF NOT EXISTS idx_files_company ON files(company_id);
