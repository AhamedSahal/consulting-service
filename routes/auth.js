const express = require('express');
const authController = require('../controllers/authController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authController.me);

module.exports = router;
