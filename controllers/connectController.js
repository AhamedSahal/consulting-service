const pool = require('../db');
const onedriveService = require('../services/onedriveService');

async function getAuthUrl(req, res) {
  try {
    const state = req.user.company_id;
    const url = await onedriveService.getAuthUrl(state);
    res.json({ authUrl: url });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to get auth URL' });
  }
}

async function handleCallback(req, res) {
  const { code, state: companyId } = req.query;
  if (!code) {
    return res.redirect((process.env.FRONTEND_URL || 'http://localhost:3000') + '/connect?error=no_code');
  }
  try {
    const cid = companyId || (await pool.query('SELECT id FROM companies LIMIT 1')).rows[0]?.id;
    if (!companyId) {
      return res.redirect((process.env.FRONTEND_URL || 'http://localhost:3000') + '/connect?error=no_company');
    }
    await onedriveService.exchangeCodeForTokens(cid, code);
    res.redirect((process.env.FRONTEND_URL || 'http://localhost:3000') + '/connect?success=1');
  } catch (err) {
    res.redirect((process.env.FRONTEND_URL || 'http://localhost:3000') + '/connect?error=' + encodeURIComponent(err.message));
  }
}

async function listConnections(req, res) {
  const result = await pool.query(
    `SELECT id, provider, status, created_at, updated_at FROM connections
     WHERE company_id = $1 ORDER BY updated_at DESC`,
    [req.user.company_id]
  );
  const rows = result.rows.map(r => ({
    ...r,
    name: r.provider === 'ONEDRIVE' ? 'OneDrive' : r.provider,
    last_updated: r.updated_at || r.created_at
  }));
  res.json(rows);
}

async function disconnect(req, res) {
  const { id } = req.params;
  const result = await pool.query(
    `UPDATE connections SET status = 'DISCONNECTED', access_token = NULL, refresh_token = NULL, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, req.user.company_id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Connection not found' });
  }
  res.json({ message: 'Disconnected' });
}

module.exports = { getAuthUrl, handleCallback, listConnections, disconnect };
