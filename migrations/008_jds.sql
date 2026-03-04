-- Migration 008: Strict JD storage table
--
-- Stores final, validated job descriptions generated via the strict JD
-- LangGraph workflow. This is separate from jd_drafts/jd_versions, which
-- represent editable drafts inside the JD Agent module.

CREATE TABLE IF NOT EXISTS jds (
  id          bigserial PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  playbook_id bigint REFERENCES playbooks(id) ON DELETE SET NULL,
  title       text   NOT NULL,
  user_prompt text,
  jd_json     jsonb  NOT NULL,
  jd_markdown text   NOT NULL,
  sources     jsonb,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jds_company_created
  ON jds (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jds_playbook_created
  ON jds (playbook_id, created_at DESC);

