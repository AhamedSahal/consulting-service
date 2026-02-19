const express = require('express');
const agentsController = require('../controllers/agentsController');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

router.get('/', agentsController.listAgents);
router.get('/templates', agentsController.listTemplates);
router.post('/', agentsController.createAgent);
router.get('/:id', agentsController.getAgent);

module.exports = router;
