require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const agentsRoutes = require('./routes/agents');
const jdRoutes = require('./routes/jd');
const connectRoutes = require('./routes/connect');
const filesRoutes = require('./routes/files');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:5173'
].filter(Boolean);

// Allow any Vercel preview/production URL (*.vercel.app)
const isVercelOrigin = (origin) => origin && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin or non-browser
    if (allowedOrigins.includes(origin) || isVercelOrigin(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use('/auth', authRoutes);
app.use('/agents', agentsRoutes);
app.use('/jd', jdRoutes);
app.use('/connect', connectRoutes);
app.use('/files', filesRoutes);
app.use('/ai', aiRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`HR Consulting AI API running on port ${PORT}`);
});
