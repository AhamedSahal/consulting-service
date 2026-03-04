const path = require('path');

const pool = require('../config/db');
const { vectorSearch } = require('../ai/tools/vectorStoreService');
const { generatePdfFromMarkdown, generateDocxFromMarkdown } = require('../ai/tools/jdExportService');

async function search_playbook_chunks(args) {
  const { agentId, playbookId, query, topK = 10 } = args || {};
  const trimmed = (query || '').trim();

  if (!agentId) throw new Error('agentId is required');
  if (!playbookId) throw new Error('playbookId is required');
  if (!trimmed) return [];

  const rows = await vectorSearch({
    ownerType: 'JD_AGENT',
    ownerId: Number(agentId),      // ✅ USE ownerId
    query: trimmed,
    topK,
    docTypes: ['PLAYBOOK'],        // ✅ restrict
    documentId: Number(playbookId) // ✅ if your vectorSearch supports it
  });

  const MAX_CHARS = 1500;
  return (rows || []).map((row) => ({
    ...row,
    chunk_text: (row.chunk_text || '').slice(0, MAX_CHARS),
  }));
}

async function search_company_chunks(args) {
  const { companyId, query, topK = 20, docType } = args || {};
  const trimmed = (query || '').trim();

  if (!companyId) {
    throw new Error('companyId is required');
  }
  if (!trimmed) {
    return [];
  }

  const effectiveDocTypes = docType
    ? [docType]
    : [
        'COMPANY_DOC',
        'COMPANY_POLICY',
        'companypolicy',
        'POLICY',
        'policy',
        'OLD_JD',
        'old_jd',
      ];

  const rows = await vectorSearch({
    ownerType: 'COMPANY',
    ownerId: companyId,
    query: trimmed,
    topK,
    docTypes: effectiveDocTypes,
  });

  const MAX_CHARS = 1500;
  return (rows || []).map((row) => ({
    ...row,
    chunk_text: (row.chunk_text || '').slice(0, MAX_CHARS),
  }));
}

async function save_jd(args) {
  const {
    companyId,
    playbookId,
    title,
    prompt,
    jdJson,
    jdMarkdown,
    sources,
  } = args || {};

  if (!companyId || !title || !jdJson || !jdMarkdown) {
    throw new Error('companyId, title, jdJson, and jdMarkdown are required to save a JD');
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO jds
         (company_id, playbook_id, title, user_prompt, jd_json, jd_markdown, sources)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
       RETURNING *`,
      [
        companyId,
        playbookId || null,
        title,
        prompt || null,
        JSON.stringify(jdJson),
        jdMarkdown,
        sources ? JSON.stringify(sources) : null,
      ],
    );
    return result.rows[0];
  } finally {
    client.release();
  }
}

async function export_jd(args) {
  const { jdId, format = 'docx' } = args || {};
  if (!jdId) {
    throw new Error('jdId is required');
  }

  const normalizedFormat = String(format || 'docx').toLowerCase();
  if (!['pdf', 'docx'].includes(normalizedFormat)) {
    throw new Error('format must be "pdf" or "docx"');
  }

  const client = await pool.connect();
  let row;
  try {
    const result = await client.query(
      'SELECT id, jd_markdown FROM jds WHERE id = $1',
      [jdId],
    );
    if (!result.rows.length) {
      throw new Error(`JD with id ${jdId} not found`);
    }
    row = result.rows[0];
  } finally {
    client.release();
  }

  const rootDir = path.join(__dirname, '..', '..');
  const markdown = row.jd_markdown || '';

  if (normalizedFormat === 'pdf') {
    const { relativePath } = await generatePdfFromMarkdown(markdown, rootDir, row.id);
    return { id: row.id, format: 'pdf', filePath: relativePath };
  }

  const { relativePath } = await generateDocxFromMarkdown(markdown, rootDir, row.id);
  return { id: row.id, format: 'docx', filePath: relativePath };
}

module.exports = {
  search_playbook_chunks,
  search_company_chunks,
  save_jd,
  export_jd,
};

