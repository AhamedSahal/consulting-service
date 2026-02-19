const express = require('express');
const { authRequired } = require('../middleware/auth');
const aiController = require('../controllers/aiController');

const router = express.Router();

router.use(authRequired);

router.post('/chat', aiController.chat);
router.post('/chat-stream', aiController.chatStream);

module.exports = router;

