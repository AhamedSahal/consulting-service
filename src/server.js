require('dotenv').config();

const { app } = require('./app');
const db = require('./config/db');

const PORT = process.env.PORT || 5000;

if (!process.env.DATABASE_URL) {
  // Match the existing startup check behaviour
  console.error(
    'DATABASE_URL is not set. Add a PostgreSQL service and link it (Railway: Variables → Reference).',
  );
  process.exit(1);
}

async function start() {
  try {
    await db.query('SELECT 1');
    console.log('Database connected.');
  } catch (err) {
    console.error(
      'Database connection failed. Check DATABASE_URL and that PostgreSQL is running.',
      err.message,
    );
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`HR Consulting AI API running on port ${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { start };

