-- Migration 006: Standardise embeddings ownership to owner_type + owner_id
--
-- Before this migration:
--   COMPANY rows: owner_type='COMPANY', company_id=X, owner_id=NULL
--   Playbook rows: owner_type='MODULE' (no owner_id) OR owner_type='AGENT' (owner_id=agentId)
--
-- After this migration:
--   COMPANY rows: owner_type='COMPANY', owner_id=companyId
--   Playbook rows: owner_type='JD_AGENT', owner_id=agentId
--
-- New code writes must set owner_id on every INSERT.
-- Old company_id / module_key columns are kept for backward compatibility but
-- are no longer used as primary filters in application queries.

-- 1. Backfill owner_id for existing COMPANY embeddings
-- Guarded so it still works on schemas where company_id has already been
-- removed and only owner_id is used.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'embeddings'
      AND column_name = 'company_id'
  ) THEN
    UPDATE embeddings
    SET owner_type = 'COMPANY',
        owner_id   = company_id
    WHERE (owner_type IS NULL OR owner_type IN ('COMPANY', 'COMPANY_DOCS'))
      AND owner_id IS NULL
      AND company_id IS NOT NULL;
  END IF;
END$$;

-- 2. Rename legacy AGENT → JD_AGENT
UPDATE embeddings
SET owner_type = 'JD_AGENT'
WHERE owner_type = 'AGENT';

-- 3. Remove legacy MODULE-level playbook rows.
--    These were a duplicate of the AGENT (now JD_AGENT) rows.
--    New uploads write a single JD_AGENT row, so these are obsolete.
DELETE FROM embeddings
WHERE owner_type = 'MODULE';

-- 4. Composite index for the new primary filter pattern
CREATE INDEX IF NOT EXISTS idx_embeddings_owner
  ON embeddings (owner_type, owner_id);

-- 5. Index for fast delete/update by document
CREATE INDEX IF NOT EXISTS idx_embeddings_document
  ON embeddings (document_id);

-- 6. HNSW vector index (better recall/speed than IVFFLAT for this scale).
--    On large tables this may take several minutes; run during a maintenance window.
--    The existing IVFFLAT index (idx_embeddings_embedding_cosine) can be dropped
--    once this index is in place and confirmed to be used by the query planner.
CREATE INDEX IF NOT EXISTS idx_embeddings_vec_hnsw
  ON embeddings
  USING hnsw (embedding vector_l2_ops);
