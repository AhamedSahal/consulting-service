const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authRequired } = require('../../middleware/auth');
const companiesController = require('./companies.controller');

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
    cb(null, `company_${file.fieldname}_${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const docMimes = [
      // PDF
      'application/pdf',
      // Word
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // PowerPoint
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Excel
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // Plain text
      'text/plain',
    ];
    const logoMimes = ['image/png', 'image/jpeg', 'image/svg+xml'];

    if (file.fieldname === 'logo') {
      if (logoMimes.includes(file.mimetype)) return cb(null, true);
      return cb(new Error('Only PNG, JPEG, or SVG are allowed for logos'));
    }

    if (file.fieldname === 'documents') {
      if (docMimes.includes(file.mimetype)) return cb(null, true);
      return cb(new Error('Only PDF, Word, PowerPoint, Excel, or TXT documents are allowed'));
    }

    return cb(new Error('Unexpected file field'));
  },
});

router.use(authRequired);

router.get('/', companiesController.listCompanies);
router.post(
  '/',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'documents', maxCount: 50 },
  ]),
  companiesController.createCompany,
);
router.get('/:id/documents', companiesController.listCompanyDocuments);
router.post(
  '/:id/documents',
  upload.fields([{ name: 'documents', maxCount: 50 }]),
  companiesController.addCompanyDocuments,
);
router.get('/:id', companiesController.getCompany);

router.delete('/:id', companiesController.deleteCompany);

module.exports = router;

