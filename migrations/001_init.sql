-- Core schema: companies, users, agents, templates

-- Companies
CREATE TABLE IF NOT EXISTS companies (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_company ON users (company_id);

-- Agent templates
CREATE TABLE IF NOT EXISTS agent_templates (
  id bigserial PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  badge text
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  id bigserial PRIMARY KEY,
  company_id bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  template_id bigint NOT NULL REFERENCES agent_templates(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_company ON agents (company_id);
CREATE INDEX IF NOT EXISTS idx_agents_company_template ON agents (company_id, template_id);

