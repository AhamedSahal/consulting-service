require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function runMigrations() {
  const migrationFile = path.join(MIGRATIONS_DIR, '001_init.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');
  await pool.query(sql);
  console.log('Migrations applied');
}

async function seed() {
  const client = await pool.connect();
  try {
    await runMigrations();

    // Create default company (no unique on name, so check first)
    let companyRes = await client.query(`SELECT id FROM companies WHERE name = 'HR Consulting AI' LIMIT 1`);
    let companyId;
    if (companyRes.rows.length > 0) {
      companyId = companyRes.rows[0].id;
    } else {
      const ins = await client.query(`INSERT INTO companies (name) VALUES ('HR Consulting AI') RETURNING id`);
      companyId = ins.rows[0].id;
    }

    // Create admin user (Ahmed / Admin@12345)
    const passwordHash = await bcrypt.hash('Admin@12345', 10);
    await client.query(
      `INSERT INTO users (company_id, name, email, password_hash, role)
       VALUES ($1, 'Ahmed', 'ahmed@hrconsulting.ai', $2, 'ADMIN')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = 'ADMIN'`,
      [companyId, passwordHash]
    );
    console.log('Admin user seeded: ahmed@hrconsulting.ai / Admin@12345');

    // Seed agent templates
    const templates = [
      { key: 'JD_AGENT', name: 'Job Description Agent', description: 'Generate structured job descriptions', badge: 'PRIORITY' },
      { key: 'WORKFORCE_ANALYTICS', name: 'Workforce Analytics Agent', description: 'Analyze workforce data', badge: null },
      { key: 'ORG_DESIGN', name: 'Organization Design Agent', description: 'Design organizational structures', badge: null },
      { key: 'COMPENSATION_BENCHMARK', name: 'Compensation & Benchmark Agent', description: 'Compensation benchmarking', badge: null },
      { key: 'TALENT_RISK', name: 'Talent Risk Agent', description: 'Identify talent risks', badge: null },
      { key: 'JD_BATCH_GENERATOR', name: 'JD Batch Generator', description: 'Batch job description generation', badge: 'NEW' }
    ];

    for (const t of templates) {
      await client.query(
        `INSERT INTO agent_templates (key, name, description, badge)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET name = $2, description = $3, badge = $4`,
        [t.key, t.name, t.description, t.badge]
      );
    }
    console.log('Agent templates seeded');

    // Create agents from templates for the company
    const templateRows = await client.query('SELECT id, name FROM agent_templates');
    for (const row of templateRows.rows) {
      const agentExists = await client.query(
        `SELECT 1 FROM agents WHERE company_id = $1 AND template_id = $2 LIMIT 1`,
        [companyId, row.id]
      );
      if (agentExists.rows.length === 0) {
        await client.query(
          `INSERT INTO agents (company_id, template_id, name, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [companyId, row.id, row.name]
        );
      }
    }
    console.log('Agents seeded');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
