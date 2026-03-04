-- Migration 007: Drop legacy columns from embeddings table
--
-- PREREQUISITE: Migration 006_owner_id_refactor.sql must have been run first
-- so that all rows have owner_type + owner_id populated.
--
-- Verify before running:
--   SELECT COUNT(*) FROM embeddings WHERE owner_id IS NULL;
-- Expected result: 0 rows. If non-zero, re-run 006 first.

-- Drop old single-column indexes that will become invalid
DROP INDEX IF EXISTS idx_embeddings_module_key;
DROP INDEX IF EXISTS idx_embeddings_company_id;
DROP INDEX IF EXISTS idx_embeddings_owner_type;  -- superseded by composite idx_embeddings_owner

-- Drop the legacy columns
ALTER TABLE embeddings DROP COLUMN IF EXISTS module_key;
ALTER TABLE embeddings DROP COLUMN IF EXISTS company_id;
