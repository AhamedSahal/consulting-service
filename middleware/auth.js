const jwt = require('jsonwebtoken');
const pool = require('../db');

async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const userRes = await pool.query(
      `SELECT id, company_id, name, email, role FROM users WHERE id = $1`,
      [decoded.userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    req.user = userRes.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authRequired };
