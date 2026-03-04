const path = require('path');

const fs = require('fs');
const pool = require('../../config/db');
const { extractText, chunkTextForCompanyDoc, cleanText, detectFileType } = require('./agentRagService');
const { embedTextsBatched } = require('./vectorStoreService');
const { enqueueJob } = require('../../utils/backgroundJobs');

const COMPANY_OWNER_TYPE = 'COMPANY';

function getCompanyDocumentsDir(companyId) {
  const uploadsRoot = path.join(__dirname, '..', '..', '..', 'uploads');
  return path.join(uploadsRoot, 'companies', String(companyId), 'documents');
}

function getCompanyLogosDir(companyId) {
  const uploadsRoot = path.join(__dirname, '..', '..', '..', 'uploads');
  return path.join(uploadsRoot, 'companies', String(companyId), 'logos');
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Schedule background embedding for a single company document.
 * This must NOT block the HTTP request.
 */
function enqueueCompanyDocumentEmbedding({ companyId, documentId, filePath, mimeType, title, docType }) {
  if (!companyId || !documentId || !filePath) return;

  const meta = {
    title: title || '',
    doc_type: docType || 'COMPANY_DOC',
    mime_type: mimeType || '',
  };

  enqueueJob('embed-company-document', async () => {
    const markClient = await pool.connect();
    try {
      await markClient.query(
        `UPDATE company_documents
         SET embedding_status = 'PROCESSING', error_message = NULL
         WHERE id = $1`,
        [documentId],
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to mark company document as PROCESSING', err);
    } finally {
      markClient.release();
    }

    try {
      const rawText = await extractText(filePath, mimeType);
      const cleanedText = cleanText(rawText);
      const chunks = chunkTextForCompanyDoc(cleanedText);
      if (!chunks || chunks.length === 0) {
        const detectedType = detectFileType(filePath, mimeType);
        const hint =
          detectedType === 'unknown' || detectedType === 'doc' || detectedType === 'ppt'
            ? 'Unsupported format. Use .docx, .pptx, .xlsx, .pdf or .txt'
            : 'File may be empty or image-only (e.g. scanned PDF).';
        throw new Error(`No text extracted. ${hint}`);
      }

      const embeddings = await embedTextsBatched(chunks);
      if (!embeddings || embeddings.length === 0) {
        throw new Error('Failed to generate embeddings for document');
      }

      await storeCompanyDocumentChunks({
        companyId,
        documentId,
        chunks,
        embeddings,
        meta,
      });

      const doneClient = await pool.connect();
      try {
        await doneClient.query(
          `UPDATE company_documents
           SET embedding_status = 'COMPLETED', error_message = NULL
           WHERE id = $1`,
          [documentId],
        );
      } finally {
        doneClient.release();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Embedding pipeline failed for company document', err);
      const failClient = await pool.connect();
      try {
        await failClient.query(
          `UPDATE company_documents
           SET embedding_status = 'FAILED', error_message = $2
           WHERE id = $1`,
          [documentId, (err.message || 'Embedding pipeline failed').substring(0, 1000)],
        );
      } finally {
        failClient.release();
      }
    }
  });
}

async function storeCompanyDocumentChunks({ companyId, documentId, chunks, embeddings, meta = {} }) {
  if (!companyId || !documentId || !Array.isArray(chunks) || chunks.length === 0) return;
  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) return;

  const metaJson = JSON.stringify({
    title: meta.title || '',
    doc_type: meta.doc_type || 'COMPANY_DOC',
    mime_type: meta.mime_type || '',
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const chunkValues = [];
    const chunkPlaceholders = [];
    const embedValues = [];
    const embedPlaceholders = [];

    chunks.forEach((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) {
        return;
      }

      // company_document_chunks
      chunkValues.push(companyId, documentId, idx, chunk, JSON.stringify(embedding), metaJson);
      const base = chunkValues.length - 5;
      chunkPlaceholders.push(
        `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5}::jsonb)`,
      );

      // embeddings table for generic vector_search / LangGraph RAG
      // 8 values: owner_type, owner_id, document_id, doc_type,
      //           chunk_index, chunk_text, embedding, metadata
      embedValues.push(
        COMPANY_OWNER_TYPE,
        companyId,         // owner_id = companyId
        documentId,
        meta.doc_type || 'COMPANY_DOC',
        idx,
        chunk,
        JSON.stringify(embedding),
        metaJson,
      );
      const eBase = embedValues.length - 7; // first of the 8 params we just pushed
      embedPlaceholders.push(
        `($${eBase}, $${eBase + 1}, $${eBase + 2}, $${eBase + 3}, $${eBase + 4}, $${eBase + 5}, $${eBase + 6}::vector, $${eBase + 7}::jsonb)`,
      );
    });

    if (chunkPlaceholders.length > 0) {
      await client.query(
        `INSERT INTO company_document_chunks
           (company_id, company_document_id, chunk_index, chunk_text, embedding, metadata)
         VALUES ${chunkPlaceholders.join(', ')}`,
        chunkValues,
      );
    }

    if (embedPlaceholders.length > 0) {
      await client.query(
        `INSERT INTO embeddings
           (owner_type, owner_id, document_id, doc_type, chunk_index, chunk_text, embedding, metadata)
         VALUES ${embedPlaceholders.join(', ')}`,
        embedValues,
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function searchCompanyContext(companyId, queryText, limit = 10) {
  const trimmed = (queryText || '').trim();
  if (!companyId || !trimmed) return [];

  const embeddings = await embedTexts([trimmed]);
  const [embedding] = embeddings || [];
  if (!embedding) return [];

  const client = await pool.connect();
  try {
    const sql = `
      SELECT company_document_id, chunk_index, chunk_text, metadata, created_at
      FROM company_document_chunks
      WHERE company_id = $1
      ORDER BY embedding <-> $2::vector
      LIMIT $3
    `;
    const result = await client.query(sql, [companyId, JSON.stringify(embedding), limit]);
    return result.rows || [];
  } finally {
    client.release();
  }
}

module.exports = {
  getCompanyDocumentsDir,
  getCompanyLogosDir,
  enqueueCompanyDocumentEmbedding,
  searchCompanyContext,
};

