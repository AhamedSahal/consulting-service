const pool = require('../db');

async function listAgents(req, res) {
  const { q } = req.query;
  let sql = `
    SELECT a.id, a.name, a.status, a.template_id, at.name as template_name, at.key as template_key, at.description, at.badge
    FROM agents a
    LEFT JOIN agent_templates at ON a.template_id = at.id
    WHERE a.company_id = $1
  `;
  const params = [req.user.company_id];
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    sql += ` AND (a.name ILIKE $2 OR at.name ILIKE $2)`;
  }
  sql += ` ORDER BY a.name`;
  const result = await pool.query(sql, params);
  res.json(result.rows);
}

async function listTemplates(req, res) {
  const result = await pool.query(
    `SELECT id, key, name, description, badge FROM agent_templates ORDER BY name`
  );
  res.json(result.rows);
}

async function createAgent(req, res) {
  const { name, template_id, purpose, icon_url } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Agent name required' });
  }
  const result = await pool.query(
    `INSERT INTO agents (company_id, template_id, name, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     RETURNING id, company_id, template_id, name, status, created_at`,
    [req.user.company_id, template_id || null, name]
  );
  res.status(201).json(result.rows[0]);
}

async function getAgent(req, res) {
  const { id } = req.params;
  const result = await pool.query(
    `SELECT a.id, a.name, a.status, a.template_id, at.name as template_name, at.key as template_key, at.description, at.badge
     FROM agents a
     LEFT JOIN agent_templates at ON a.template_id = at.id
     WHERE a.id = $1 AND a.company_id = $2`,
    [id, req.user.company_id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(result.rows[0]);
}

module.exports = { listAgents, listTemplates, createAgent, getAgent };
