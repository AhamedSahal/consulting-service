const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const filesController = require('../controllers/filesController');
const { authRequired } = require('../middleware/auth');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.pptx';
    cb(null, 'ppt_' + unique + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.ppt', '.pptx'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only PPT/PPTX files allowed'));
  }
});

const router = express.Router();
router.use(authRequired);

router.post('/upload/ppt', upload.single('file'), filesController.uploadPpt);
router.get('/', filesController.listFiles);

module.exports = router;
