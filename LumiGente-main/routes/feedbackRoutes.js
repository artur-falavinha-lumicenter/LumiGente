const express = require('express');
const router = express.Router();
const feedbackController = require('../controllers/feedbackController');
const { requireAuth } = require('../middleware/authMiddleware');

// Aplica o middleware de autenticação para todas as rotas neste arquivo
router.use(requireAuth);

// Rotas de Feedbacks
router.get('/received', feedbackController.getReceivedFeedbacks);
router.get('/sent', feedbackController.getSentFeedbacks);
router.post('/', feedbackController.createFeedback);

// Rotas do Chat/Thread de um feedback
router.get('/:id/info', feedbackController.getFeedbackInfo);
router.get('/:id/messages', feedbackController.getFeedbackMessages);
router.post('/:id/messages', feedbackController.postFeedbackMessage);

// Rotas de Reações
router.post('/messages/:messageId/react', feedbackController.reactToMessage);

// Rota de filtros
router.get('/filters', feedbackController.getFeedbackFilters);


module.exports = router;