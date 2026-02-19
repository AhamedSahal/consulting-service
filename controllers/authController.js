const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

async function register(req, res) {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password required' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const companyRes = await pool.query('SELECT id FROM companies LIMIT 1');
    if (companyRes.rows.length === 0) {
      return res.status(500).json({ error: 'No company configured. Run: npm run seed' });
    }
    const companyId = companyRes.rows[0].id;
    const result = await pool.query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'CONSULTANT')
       RETURNING id, company_id, name, email, role, created_at`,
      [companyId, name, email, passwordHash]
    );
    const user = result.rows[0];
    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
    const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
    res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
    res.status(201).json({ user: { id: user.id, company_id: user.company_id, name: user.name, email: user.email, role: user.role }, accessToken });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Email already registered' });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(503).json({ error: 'Database connection failed. Check DATABASE_URL and that PostgreSQL is running.' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const userRes = await pool.query(
    `SELECT id, company_id, name, email, password_hash, role FROM users WHERE email = $1`,
    [email]
  );
  if (userRes.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const user = userRes.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
  const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
  res.cookie('refreshToken', refreshToken, COOKIE_OPTIONS);
  res.json({ user: { id: user.id, company_id: user.company_id, name: user.name, email: user.email, role: user.role }, accessToken });
}

async function refresh(req, res) {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const userRes = await pool.query(
      `SELECT id, company_id, name, email, role FROM users WHERE id = $1`,
      [decoded.userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const user = userRes.rows[0];
    const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
    const newRefreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
    res.cookie('refreshToken', newRefreshToken, COOKIE_OPTIONS);
    res.json({ user: { id: user.id, company_id: user.company_id, name: user.name, email: user.email, role: user.role }, accessToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
}

async function logout(req, res) {
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
}

async function me(req, res) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userRes = await pool.query(
      `SELECT id, company_id, name, email, role FROM users WHERE id = $1`,
      [decoded.userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json(userRes.rows[0]);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { register, login, refresh, logout, me };
