const pool = require('../../config/db');

async function listAgentTemplates(req, res) {
  const result = await pool.query(
    `SELECT id, key, name, description, badge
     FROM agent_templates
     ORDER BY name`,
  );
  res.json(result.rows);
}

module.exports = {
  listAgentTemplates,
};

