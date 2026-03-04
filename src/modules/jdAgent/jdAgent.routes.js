const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authRequired } = require('../../middleware/auth');
const jdAgentController = require('./jdAgent.controller');

const router = express.Router();

const UPLOAD_TMP_DIR = path.join(__dirname, '..', '..', 'uploads', 'tmp');
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_TMP_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '') || '.bin';
    cb(null, `jd_agent_playbook_${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only PDF, DOCX, or TXT files are allowed for playbooks'));
  },
});

router.use(authRequired);

router.get('/playbook', jdAgentController.getPlaybook);
router.post('/playbook', upload.single('playbook_file'), jdAgentController.uploadPlaybook);
router.post('/jds/generate', jdAgentController.generateJd);
router.get('/jds', jdAgentController.listJds);
router.get('/jds/:id/export', jdAgentController.exportJd);

module.exports = router;

