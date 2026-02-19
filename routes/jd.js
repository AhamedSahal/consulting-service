const express = require('express');
const jdController = require('../controllers/jdController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.post('/drafts', jdController.createDraft);
router.get('/drafts', jdController.listDrafts);
router.get('/drafts/:id', jdController.getDraft);
router.patch('/drafts/:id', jdController.updateDraft);
router.post('/drafts/:id/generate', jdController.generateDraft);
router.post('/drafts/:id/save-version', jdController.saveVersion);
router.post('/drafts/:id/submit-review', jdController.submitForReview);
router.get('/drafts/:id/export/pdf', jdController.exportPdf);
router.get('/drafts/:id/export/excel', jdController.exportExcel);
router.post('/drafts/:id/export/onedrive', jdController.exportToOneDrive);

module.exports = router;
