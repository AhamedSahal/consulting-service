const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./modules/auth/auth.routes');
const connectRoutes = require('./modules/connect/connect.routes');
const companiesRoutes = require('./modules/companies/companies.routes');
const jdAgentRoutes = require('./modules/jdAgent/jdAgent.routes');
const aiRoutes = require('./modules/ai/ai.routes');
const { authRequired } = require('./middleware/auth');
const agentTemplatesController = require('./modules/agentTemplates/agentTemplates.controller');

const app = express();

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded files (logos, documents, etc.)
// This makes paths like /uploads/companies/... accessible to the frontend.
app.use('/uploads', express.static(uploadsDir));
// Also expose under /api/uploads for local dev when the frontend
// proxies /api to this backend.
app.use('/api/uploads', express.static(uploadsDir));

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:5173',
].filter(Boolean);

const isVercelOrigin = (origin) =>
  origin && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin) || isVercelOrigin(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    credentials: true,
    // Expose custom headers (like X-JD-Id) so the frontend
    // can read them via fetch(...).headers.get().
    exposedHeaders: ['X-JD-Id', 'x-jd-id'],
  }),
);

app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/connect', connectRoutes);
app.use('/companies', companiesRoutes);
app.use('/modules/jd-agent', jdAgentRoutes);
app.use('/ai', aiRoutes);

app.get('/agent-templates', authRequired, agentTemplatesController.listAgentTemplates);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

module.exports = { app };

