const pool = require('../db');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

async function uploadPpt(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const relPath = path.relative(path.join(__dirname, '..'), req.file.path);
  const result = await pool.query(
    `INSERT INTO files (company_id, type, original_name, storage_path)
     VALUES ($1, 'PPT_TEMPLATE', $2, $3) RETURNING *`,
    [req.user.company_id, req.file.originalname || req.file.filename, relPath]
  );
  res.status(201).json(result.rows[0]);
}

async function listFiles(req, res) {
  const result = await pool.query(
    `SELECT id, type, original_name, storage_path, created_at FROM files
     WHERE company_id = $1 AND type = 'PPT_TEMPLATE' ORDER BY created_at DESC`,
    [req.user.company_id]
  );
  res.json(result.rows);
}

module.exports = { uploadPpt, listFiles };
