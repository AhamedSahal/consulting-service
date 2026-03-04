const express = require('express');
const { authRequired } = require('../../middleware/auth');
const { streamChat } = require('./ai.controller');

const router = express.Router();

router.post('/chat-stream', authRequired, streamChat);

module.exports = router;

