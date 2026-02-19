const pool = require('../db');
const { generateJobDescription } = require('../services/openaiService');
const { enforceVerbRules } = require('../services/jdGeneratorService');
const { buildPdfBuffer } = require('../services/exportPdfService');
const { buildExcelBuffer } = require('../services/exportExcelService');
const onedriveService = require('../services/onedriveService');

async function createDraft(req, res) {
  const {
    agent_id,
    job_title,
    reports_to,
    job_family,
    level,
    template_type,
    include_percentages,
    role_summary,
    raw_responsibilities
  } = req.body;

  const result = await pool.query(
    `INSERT INTO jd_drafts (company_id, created_by, agent_id, job_title, reports_to, job_family, level,
      template_type, include_percentages, role_summary, raw_responsibilities, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DRAFT')
     RETURNING *`,
    [
      req.user.company_id,
      req.user.id,
      agent_id || null,
      job_title || null,
      reports_to || null,
      job_family || null,
      level || null,
      template_type || 'STANDARD',
      !!include_percentages,
      role_summary || null,
      raw_responsibilities || null
    ]
  );
  res.status(201).json(result.rows[0]);
}

async function getDraft(req, res) {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`,
    [id, req.user.company_id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  res.json(result.rows[0]);
}

async function generateDraft(req, res) {
  const { id } = req.params;
  const draftRes = await pool.query(
    `SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`,
    [id, req.user.company_id]
  );
  if (draftRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  const draft = draftRes.rows[0];

  const inputs = {
    job_title: draft.job_title,
    reports_to: draft.reports_to,
    job_family: draft.job_family,
    level: draft.level,
    role_summary: draft.role_summary,
    template_type: draft.template_type || 'STANDARD',
    include_percentages: draft.include_percentages
  };

  let jdJson;
  try {
    jdJson = await generateJobDescription(inputs);
  } catch (err) {
    return res.status(500).json({ error: 'OpenAI generation failed: ' + (err.message || 'Unknown error') });
  }

  const enforced = enforceVerbRules(jdJson, draft.level);
  const version = (draft.current_version || 0) + 1;

  await pool.query(
    `UPDATE jd_drafts SET generated_jd_json = $1, current_version = $2, updated_at = NOW() WHERE id = $3`,
    [JSON.stringify(enforced), version, id]
  );

  const updated = await pool.query(`SELECT * FROM jd_drafts WHERE id = $1`, [id]);
  res.json(updated.rows[0]);
}

async function updateDraft(req, res) {
  const { id } = req.params;
  const { status, job_title, reports_to, job_family, level, template_type, include_percentages, role_summary, generated_jd_json } = req.body;

  const updates = [];
  const values = [];
  let idx = 1;
  if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
  if (job_title !== undefined) { updates.push(`job_title = $${idx++}`); values.push(job_title); }
  if (reports_to !== undefined) { updates.push(`reports_to = $${idx++}`); values.push(reports_to); }
  if (job_family !== undefined) { updates.push(`job_family = $${idx++}`); values.push(job_family); }
  if (level !== undefined) { updates.push(`level = $${idx++}`); values.push(level); }
  if (template_type !== undefined) { updates.push(`template_type = $${idx++}`); values.push(template_type); }
  if (include_percentages !== undefined) { updates.push(`include_percentages = $${idx++}`); values.push(!!include_percentages); }
  if (role_summary !== undefined) { updates.push(`role_summary = $${idx++}`); values.push(role_summary); }
  if (generated_jd_json !== undefined) { updates.push(`generated_jd_json = $${idx++}`); values.push(JSON.stringify(generated_jd_json)); }

  if (updates.length === 0) {
    const r = await pool.query(`SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`, [id, req.user.company_id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Draft not found' });
    return res.json(r.rows[0]);
  }

  updates.push(`updated_at = NOW()`);
  values.push(id, req.user.company_id);
  const result = await pool.query(
    `UPDATE jd_drafts SET ${updates.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1} RETURNING *`,
    values
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  res.json(result.rows[0]);
}

async function saveVersion(req, res) {
  const { id } = req.params;
  const draftRes = await pool.query(
    `SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`,
    [id, req.user.company_id]
  );
  if (draftRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  const draft = draftRes.rows[0];
  const version = (draft.current_version || 0) + 1;

  await pool.query(
    `INSERT INTO jd_versions (jd_draft_id, version, generated_jd_json, created_by)
     VALUES ($1, $2, $3, $4)`,
    [id, version, JSON.stringify(draft.generated_jd_json || {}), req.user.id]
  );

  await pool.query(
    `UPDATE jd_drafts SET current_version = $1, updated_at = NOW() WHERE id = $2`,
    [version, id]
  );

  const updated = await pool.query(`SELECT * FROM jd_drafts WHERE id = $1`, [id]);
  res.json(updated.rows[0]);
}

async function submitForReview(req, res) {
  const { id } = req.params;
  const result = await pool.query(
    `UPDATE jd_drafts SET status = 'IN_REVIEW', updated_at = NOW()
     WHERE id = $1 AND company_id = $2 RETURNING *`,
    [id, req.user.company_id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  res.json(result.rows[0]);
}

async function exportPdf(req, res) {
  const { id } = req.params;
  const draftRes = await pool.query(
    `SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`,
    [id, req.user.company_id]
  );
  if (draftRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  const jdJson = draftRes.rows[0].generated_jd_json;
  if (!jdJson) {
    return res.status(400).json({ error: 'No generated JD to export' });
  }

  const buffer = await buildPdfBuffer(jdJson);
  const filename = `${(jdJson.job_title || 'JobDescription').replace(/[^a-zA-Z0-9]/g, '_')}_JD.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function exportExcel(req, res) {
  const { id } = req.params;
  const draftRes = await pool.query(
    `SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`,
    [id, req.user.company_id]
  );
  if (draftRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  const jdJson = draftRes.rows[0].generated_jd_json;
  if (!jdJson) {
    return res.status(400).json({ error: 'No generated JD to export' });
  }

  const buffer = await buildExcelBuffer(jdJson);
  const filename = `${(jdJson.job_title || 'JobDescription').replace(/[^a-zA-Z0-9]/g, '_')}_JD.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function exportToOneDrive(req, res) {
  const { id } = req.params;
  const { format, folderPath } = req.body;

  const draftRes = await pool.query(
    `SELECT * FROM jd_drafts WHERE id = $1 AND company_id = $2`,
    [id, req.user.company_id]
  );
  if (draftRes.rows.length === 0) {
    return res.status(404).json({ error: 'Draft not found' });
  }
  const jdJson = draftRes.rows[0].generated_jd_json;
  if (!jdJson) {
    return res.status(400).json({ error: 'No generated JD to export' });
  }

  const folder = folderPath || '/HR Consulting AI/Exports';
  let buffer;
  let filename;
  if (format === 'excel') {
    const ExcelJS = require('exceljs');
    const { buildExcelBuffer } = require('../services/exportExcelService');
    buffer = await buildExcelBuffer(jdJson);
    filename = `${(jdJson.job_title || 'JobDescription').replace(/[^a-zA-Z0-9]/g, '_')}_JD.xlsx`;
  } else {
    const { buildPdfBuffer } = require('../services/exportPdfService');
    buffer = await buildPdfBuffer(jdJson);
    filename = `${(jdJson.job_title || 'JobDescription').replace(/[^a-zA-Z0-9]/g, '_')}_JD.pdf`;
  }

  try {
    const result = await onedriveService.uploadFile(req.user.company_id, buffer, filename, folder);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'OneDrive upload failed' });
  }
}

async function listDrafts(req, res) {
  const result = await pool.query(
    `SELECT j.*, a.name as agent_name FROM jd_drafts j
     LEFT JOIN agents a ON j.agent_id = a.id
     WHERE j.company_id = $1 ORDER BY j.updated_at DESC`,
    [req.user.company_id]
  );
  res.json(result.rows);
}

module.exports = {
  createDraft,
  getDraft,
  generateDraft,
  updateDraft,
  saveVersion,
  submitForReview,
  exportPdf,
  exportExcel,
  exportToOneDrive,
  listDrafts
};
