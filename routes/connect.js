const express = require('express');
const connectController = require('../controllers/connectController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.get('/onedrive/auth-url', authRequired, connectController.getAuthUrl);
router.get('/onedrive/callback', connectController.handleCallback);
router.get('/list', authRequired, connectController.listConnections);
router.post('/disconnect/:id', authRequired, connectController.disconnect);

module.exports = router;
