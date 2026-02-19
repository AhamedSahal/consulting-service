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

app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:5173'
  ].filter(Boolean),
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
