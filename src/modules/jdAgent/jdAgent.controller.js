const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');
const { embedTextsBatched, indexAgentPlaybookChunks } = require('../../ai/tools/vectorStoreService');
const { enqueueJob } = require('../../utils/backgroundJobs');
const { extractTextFromFile } = require('../../utils/extractors');
const { chunkText: chunkPlaybookText } = require('../../utils/chunker');
const { generateJdWithGraph } = require('../../ai/graph/langgraphService');
const { export_jd } = require('../../mcp/jdTools');

const JD_MODULE_KEY = 'JD_AGENT';

async function getPlaybook(req, res) {
  const result = await pool.query(
    `SELECT id, original_filename, uploaded_at
     FROM module_documents
     WHERE company_id = $1
       AND module_key = $2
       AND document_type = 'PLAYBOOK'
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    [req.user.company_id, JD_MODULE_KEY],
  );

  if (result.rows.length === 0) {
    return res.json({
      status: 'not_uploaded',
      fileName: null,
      uploadedAt: null,
      playbookId: null,
    });
  }

  const doc = result.rows[0];

  // Try to find the associated playbook record for this document
  let playbookId = null;
  try {
    const playbookRes = await pool.query(
      `SELECT id
       FROM playbooks
       WHERE (meta->>'document_id')::int = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [doc.id],
    );
    if (playbookRes.rows.length > 0) {
      playbookId = playbookRes.rows[0].id;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to fetch JD playbook id from playbooks table:', err);
  }

  return res.json({
    status: 'uploaded',
    fileName: doc.original_filename,
    uploadedAt: doc.uploaded_at,
    playbookId,
  });
}

async function uploadPlaybook(req, res) {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'playbook_file is required' });
  }

  const client = await pool.connect();
  const companyId = req.user.company_id;
  let tempFilePath = file.path;

  try {
    await client.query('BEGIN');

    const modulesUploadRoot = path.join(__dirname, '..', '..', 'uploads', 'modules');
    const moduleDir = path.join(modulesUploadRoot, JD_MODULE_KEY.toLowerCase(), String(companyId));
    await fs.promises.mkdir(moduleDir, { recursive: true });

    const destFilename = file.originalname || file.filename;
    const destPath = path.join(moduleDir, destFilename);
    await fs.promises.rename(file.path, destPath);
    tempFilePath = null;

    const storagePath = path.join('uploads', 'modules', JD_MODULE_KEY.toLowerCase(), String(companyId), destFilename);

    const docRes = await client.query(
      `INSERT INTO module_documents
         (company_id, module_key, document_type, original_filename, storage_path, mime_type, size_bytes)
       VALUES ($1, $2, 'PLAYBOOK', $3, $4, $5, $6)
       RETURNING id, original_filename, uploaded_at`,
      [companyId, JD_MODULE_KEY, file.originalname || destFilename, storagePath, file.mimetype, file.size],
    );

    const document = docRes.rows[0];

    const explicitAgentId = Number(req.body?.agent_id || req.body?.agentId);
    let agentId = Number.isFinite(explicitAgentId) && explicitAgentId > 0 ? explicitAgentId : null;

    if (!agentId) {
      const agentTplRes = await client.query(
        'SELECT id FROM agent_templates WHERE key = $1 ORDER BY id LIMIT 1',
        [JD_MODULE_KEY],
      );
      agentId = agentTplRes.rows[0] && agentTplRes.rows[0].id;
    }

    if (!agentId) {
      throw new Error('JD agent template not configured');
    }

    const title =
      (req.body && (req.body.title || req.body.playbookTitle)) ||
      file.originalname ||
      destFilename;

    const playbookMeta = {
      module_key: JD_MODULE_KEY,
      company_id: companyId,
      document_id: document.id,
    };

    const playbookRes = await client.query(
      `INSERT INTO playbooks
         (agent_id, title, file_url, mime_type, size_bytes, embedding_status, meta)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', $6::jsonb)
       RETURNING id, created_at, embedding_status`,
      [agentId, title, storagePath, file.mimetype, file.size, JSON.stringify(playbookMeta)],
    );

    const playbook = playbookRes.rows[0];

    enqueueJob('embed-jd-agent-playbook', async () => {
        const bgClient = await pool.connect();
        try {
          await bgClient.query(
            `UPDATE playbooks
             SET embedding_status = 'PROCESSING', error_text = NULL
             WHERE id = $1`,
            [playbook.id],
          );
        } catch (markErr) {
          // eslint-disable-next-line no-console
          console.error('Failed to mark playbook as PROCESSING:', markErr);
        } finally {
          bgClient.release();
        }

        const workClient = await pool.connect();
        try {
          const text = await extractTextFromFile(destPath, file.mimetype);
          const cleaned = (text || '').trim();
          if (!cleaned) {
            await workClient.query(
              `UPDATE playbooks
               SET embedding_status = 'FAILED', error_text = $2
               WHERE id = $1`,
              [playbook.id, 'No extractable text'],
            );
            return;
          }

          const chunks = chunkPlaybookText(cleaned);
          if (!chunks || chunks.length === 0) {
            await workClient.query(
              `UPDATE playbooks
               SET embedding_status = 'FAILED', error_text = $2
               WHERE id = $1`,
              [playbook.id, 'No extractable text'],
            );
            return;
          }

          const embeddings = await embedTextsBatched(chunks);
          if (!embeddings || embeddings.length === 0) {
            throw new Error('Failed to generate embeddings for playbook');
          }

          await indexAgentPlaybookChunks({
            agentId,
            playbookId: playbook.id,
            title,
            chunks,
            embeddings,
            mimeType: file.mimetype,
          });

          await workClient.query(
            `UPDATE playbooks
             SET embedding_status = 'DONE', error_text = NULL
             WHERE id = $1`,
            [playbook.id],
          );
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('Failed to embed agent playbook:', err);
          try {
            await workClient.query(
              `UPDATE playbooks
               SET embedding_status = 'FAILED', error_text = $2
               WHERE id = $1`,
              [playbook.id, (err.message || 'Embedding pipeline failed').substring(0, 1000)],
            );
          } catch (updateErr) {
            // eslint-disable-next-line no-console
            console.error('Failed to mark playbook as FAILED:', updateErr);
          }
        } finally {
          workClient.release();
        }
      });

    await client.query('COMMIT');

    return res.json({
      status: 'uploaded',
      fileName: document.original_filename,
      filename: document.original_filename,
      fileUrl: storagePath,
      uploadedAt: document.uploaded_at,
      playbookId: playbook.id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    // eslint-disable-next-line no-console
    console.error('Upload JD playbook failed:', err);
    if (tempFilePath) {
      fs.promises.unlink(tempFilePath).catch(() => {});
    }
    return res.status(500).json({ error: err.message || 'Failed to upload playbook' });
  } finally {
    client.release();
  }
}

async function generateJd(req, res) {
  const { title, companyId: requestedCompanyId, description, strictPlaybook } = req.body || {};
  const companyId = req.user.company_id;

  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'title is required' });
  }

  if (requestedCompanyId && requestedCompanyId !== companyId) {
    return res.status(403).json({ error: 'You can only generate JDs for your own company' });
  }

  const draft = {
    job_title: title,
    reports_to: '',
    job_family: '',
    level: '',
    role_summary: description || '',
    template_type: 'STANDARD',
    include_percentages: false,
    raw_responsibilities: null,
  };

  try {
    // Resolve the agent id the same way uploadPlaybook does so retrieval
    // hits the embeddings written by the JD_AGENT indexing job.
    const agentTplRes = await pool.query(
      'SELECT id FROM agent_templates WHERE key = $1 ORDER BY id LIMIT 1',
      [JD_MODULE_KEY],
    );
    const agentId = agentTplRes.rows[0] ? agentTplRes.rows[0].id : null;

    const result = await generateJdWithGraph({
      draft,
      moduleKey: JD_MODULE_KEY,
      companyId,
      agentId,
      strictPlaybook: !!strictPlaybook,
    });

    if (result.error === 'NO_PLAYBOOK_CONTEXT' && strictPlaybook) {
      return res.status(400).json({
        error: result.error,
        message: result.message,
      });
    }

    const jdJson = result.jdJson;
    const ragChunks = result.ragChunks || [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const draftRes = await client.query(
        `INSERT INTO jd_drafts (company_id, module_key, title, description, content)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, created_at, updated_at`,
        [companyId, JD_MODULE_KEY, title, description || null, JSON.stringify(jdJson)],
      );

      const jdDraft = draftRes.rows[0];

      const versionRes = await client.query(
        `INSERT INTO jd_versions (jd_draft_id, version_number, content)
         VALUES ($1, 1, $2::jsonb)
         RETURNING id, created_at`,
        [jdDraft.id, JSON.stringify(jdJson)],
      );

      const version = versionRes.rows[0];

      await client.query('COMMIT');

      return res.json({
        jdId: jdDraft.id,
        versionId: version.id,
        content: jdJson,
        metadata: {
          title,
          companyId,
          moduleKey: JD_MODULE_KEY,
          ragContext: ragChunks.map((c) => c.chunk_text),
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('JD generation failed:', err);
    return res.status(500).json({ error: err.message || 'JD generation failed' });
  }
}

async function listJds(req, res) {
  const result = await pool.query(
    `SELECT id, title, description, created_at, updated_at
     FROM jd_drafts
     WHERE company_id = $1
       AND module_key = $2
     ORDER BY created_at DESC`,
    [req.user.company_id, JD_MODULE_KEY],
  );
  res.json(result.rows);
}

async function exportJd(req, res) {
  const jdId = Number.parseInt(req.params.id, 10);
  const format = String(req.query.format || 'docx').toLowerCase();

  if (!Number.isFinite(jdId) || jdId <= 0) {
    return res.status(400).json({ error: 'Invalid JD id' });
  }
  if (!['pdf', 'docx'].includes(format)) {
    return res.status(400).json({ error: 'format must be "pdf" or "docx"' });
  }

  try {
    const result = await pool.query(
      'SELECT id FROM jds WHERE id = $1 AND company_id = $2',
      [jdId, req.user.company_id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'JD not found' });
    }

    const exportResult = await export_jd({ jdId, format });
    const relativePath = exportResult.filePath || '';

    const normalised = relativePath.replace(/\\/g, '/');
    const trimmed = normalised.startsWith('uploads/') ? normalised.substring('uploads/'.length) : normalised;
    const url = `/uploads/${trimmed}`;

    return res.json({
      id: exportResult.id,
      format: exportResult.format,
      filePath: relativePath,
      url,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('JD export failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to export JD' });
  }
}

module.exports = {
  getPlaybook,
  uploadPlaybook,
  generateJd,
  listJds,
  exportJd,
};

