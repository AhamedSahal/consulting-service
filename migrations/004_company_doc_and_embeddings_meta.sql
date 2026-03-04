-- Add COMPANY_DOC to company_document_type enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'company_document_type' AND e.enumlabel = 'COMPANY_DOC'
  ) THEN
    ALTER TYPE company_document_type ADD VALUE 'COMPANY_DOC';
  END IF;
END$$;

-- Add size_bytes to company_documents
ALTER TABLE company_documents ADD COLUMN IF NOT EXISTS size_bytes bigint;

-- Add metadata JSONB to embeddings for per-chunk meta (title, doc_type, mime_type)
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS metadata jsonb;
