const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');
const {
  getCompanyDocumentsDir,
  getCompanyLogosDir,
  enqueueCompanyDocumentEmbedding,
} = require('../../ai/tools/companyEmbeddingService');

function parseJsonField(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normaliseStatus(raw) {
  const value = String(raw || '').toUpperCase();
  if (value === 'ACTIVE' || value === 'INACTIVE') return value;
  return 'ACTIVE';
}

// User only provides document title when creating; we always store as COMPANY_DOC
function normaliseDocType(raw) {
  if (!raw) return 'COMPANY_DOC';
  const value = String(raw).toUpperCase();
  const allowed = ['COMPANY_DOC', 'STRATEGY_DOC', 'ORG_STRUCTURE', 'OLD_JD', 'POLICY'];
  return allowed.includes(value) ? value : 'COMPANY_DOC';
}

async function listCompanies(req, res) {
  const result = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.industry,
       c.country,
       c.status,
       c.logo_url,
       COUNT(d.id)::int AS documents_count
     FROM companies c
     LEFT JOIN company_documents d ON d.company_id = c.id
     GROUP BY c.id
     ORDER BY c.name`,
  );
  res.json(result.rows);
}

async function getCompany(req, res) {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT
       id,
       name,
       industry,
       country,
       status,
       logo_url,
       tags,
       notes,
       created_at
     FROM companies
     WHERE id = $1`,
    [id],
  );

  if (!result.rows || result.rows.length === 0) {
    return res.status(404).json({ error: 'Company not found' });
  }

  return res.json(result.rows[0]);
}

async function createCompany(req, res) {
  const { name, industry, country, notes, tags } = req.body || {};
  const status = normaliseStatus(req.body?.status);

  if (!name || !industry || !country) {
    return res.status(400).json({ error: 'name, industry and country are required' });
  }

  const tagsJson = parseJsonField(tags);

  const client = await pool.connect();
    const logoFiles = (req.files && req.files.logo) || [];
    const documentFiles = (req.files && req.files.documents) || [];

    // documents_meta: single JSON string array aligned by index with documents[]
    let metaArray = parseJsonField(req.body?.documents_meta);
    if (!Array.isArray(metaArray)) metaArray = [];
    if (documentFiles.length > 0 && metaArray.length !== documentFiles.length) {
      return res.status(400).json({
        error: `documents_meta length (${metaArray.length}) must match documents count (${documentFiles.length})`,
      });
    }

    try {
    await client.query('BEGIN');

    const companyRes = await client.query(
      `INSERT INTO companies (name, industry, country, status, tags, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, industry, country, status, logo_url`,
      [name, industry, country, status, tagsJson, notes || null],
    );

    const company = companyRes.rows[0];
    const companyId = company.id;

    // Persist logo (optional)
    if (logoFiles.length > 0) {
      const logoFile = logoFiles[0];
      const logosDir = getCompanyLogosDir(companyId);
      await fs.promises.mkdir(logosDir, { recursive: true });

      const ext = path.extname(logoFile.originalname || logoFile.filename) || '.bin';
      const destFilename = `logo${ext}`;
      const destPath = path.join(logosDir, destFilename);

      await fs.promises.rename(logoFile.path, destPath);

      // Build a URL path using forward slashes so it works in the browser
      const relativeUrl = ['','uploads','companies', String(companyId), 'logos', destFilename].join('/');
      await client.query(
        `UPDATE companies
         SET logo_url = $2
         WHERE id = $1`,
        [companyId, relativeUrl],
      );
      company.logo_url = relativeUrl;
    }

    // Persist documents (optional)
    const docsDir = getCompanyDocumentsDir(companyId);
    await fs.promises.mkdir(docsDir, { recursive: true });

    const documents = [];

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < documentFiles.length; i++) {
      const file = documentFiles[i];
      const parsedMeta = metaArray[i] || {};
      const title = parsedMeta.title || file.originalname || file.filename;
      const docType = normaliseDocType(parsedMeta.doc_type || parsedMeta.docType);

      const ext = path.extname(file.originalname || file.filename) || '.bin';
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const destFilename = `${unique}${ext}`;
      const destPath = path.join(docsDir, destFilename);

      await fs.promises.rename(file.path, destPath);

      // URL-safe path with forward slashes
      const relativeUrl = [
        '',
        'uploads',
        'companies',
        String(companyId),
        'documents',
        destFilename,
      ].join('/');

      const sizeBytes = file.size != null ? file.size : null;

      const docRes = await client.query(
        `INSERT INTO company_documents
           (company_id, doc_type, title, file_url, original_filename, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, doc_type, embedding_status, created_at`,
        [
          companyId,
          docType,
          title,
          relativeUrl,
          file.originalname || destFilename,
          file.mimetype,
          sizeBytes,
        ],
      );

      const document = docRes.rows[0];
      documents.push(document);

      enqueueCompanyDocumentEmbedding({
        companyId,
        documentId: document.id,
        filePath: destPath,
        mimeType: file.mimetype,
        title,
        docType,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      companyId,
      company,
      documents,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Failed to create company', err);
    if (err.code === '23505' && err.constraint === 'companies_name_key') {
      return res.status(409).json({ error: 'A company with this name already exists' });
    }
    return res.status(500).json({ error: err.message || 'Failed to create company' });
  } finally {
    client.release();
  }
}

async function listCompanyDocuments(req, res) {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT
       id,
       title,
       doc_type,
       embedding_status,
       original_filename,
       mime_type,
       created_at
     FROM company_documents
     WHERE company_id = $1
     ORDER BY created_at DESC`,
    [id],
  );
  res.json(result.rows);
}

async function addCompanyDocuments(req, res) {
  const { id } = req.params;
  const companyId = id;

  const documentFiles = (req.files && req.files.documents) || [];
  if (!companyId || documentFiles.length === 0) {
    return res.status(400).json({ error: 'At least one document is required' });
  }

  let metaArray = parseJsonField(req.body?.documents_meta);
  if (!Array.isArray(metaArray)) metaArray = [];
  if (metaArray.length !== documentFiles.length) {
    return res.status(400).json({
      error: `documents_meta length (${metaArray.length}) must match documents count (${documentFiles.length})`,
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const docsDir = getCompanyDocumentsDir(companyId);
    await fs.promises.mkdir(docsDir, { recursive: true });

    const documents = [];

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < documentFiles.length; i++) {
      const file = documentFiles[i];
      const parsedMeta = metaArray[i] || {};
      const title = parsedMeta.title || file.originalname || file.filename;
      const docType = normaliseDocType(parsedMeta.doc_type || parsedMeta.docType);

      const ext = path.extname(file.originalname || file.filename) || '.bin';
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const destFilename = `${unique}${ext}`;
      const destPath = path.join(docsDir, destFilename);

      await fs.promises.rename(file.path, destPath);

      // URL-safe path with forward slashes
      const relativeUrl = [
        '',
        'uploads',
        'companies',
        String(companyId),
        'documents',
        destFilename,
      ].join('/');

      const sizeBytes = file.size != null ? file.size : null;

      const docRes = await client.query(
        `INSERT INTO company_documents
           (company_id, doc_type, title, file_url, original_filename, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, title, doc_type, embedding_status, created_at`,
        [
          companyId,
          docType,
          title,
          relativeUrl,
          file.originalname || destFilename,
          file.mimetype,
          sizeBytes,
        ],
      );

      const document = docRes.rows[0];
      documents.push(document);

      enqueueCompanyDocumentEmbedding({
        companyId,
        documentId: document.id,
        filePath: destPath,
        mimeType: file.mimetype,
        title,
        docType,
      });
    }

    await client.query('COMMIT');

    return res.status(201).json({
      companyId,
      documents,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Failed to add company documents', err);
    return res.status(500).json({ error: err.message || 'Failed to add documents' });
  } finally {
    client.release();
  }
}

async function deleteCompany(req, res) {
  const { id } = req.params;
  const companyId = id;

  if (!companyId) {
    return res.status(400).json({ error: 'Company id is required' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clean up embeddings linked to this company
    await client.query(
      "DELETE FROM embeddings WHERE owner_type = 'COMPANY' AND owner_id = $1",
      [companyId],
    );

    // Deleting from companies will cascade to company_documents and company_document_chunks
    const result = await client.query('DELETE FROM companies WHERE id = $1', [companyId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Company not found' });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Failed to delete company', err);
    return res.status(500).json({ error: err.message || 'Failed to delete company' });
  } finally {
    client.release();
  }

  // Best-effort filesystem cleanup (logos + documents)
  try {
    const uploadsRoot = path.join(__dirname, '..', '..', '..', 'uploads');
    const companyDir = path.join(uploadsRoot, 'companies', String(companyId));
    if (fs.existsSync(companyDir)) {
      await fs.promises.rm(companyDir, { recursive: true, force: true });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to remove company files', err);
  }

  return res.status(204).send();
}

module.exports = {
  listCompanies,
  getCompany,
  createCompany,
  listCompanyDocuments,
  addCompanyDocuments,
  deleteCompany,
};


