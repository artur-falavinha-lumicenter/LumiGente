const express = require('express');
const router = express.Router();
const recognitionController = require('../controllers/recognitionController');
const { requireAuth } = require('../middleware/authMiddleware');

// Aplica o middleware de autenticação para TODAS as rotas de reconhecimento
router.use(requireAuth);

// =================================================================
// ROTAS DE RECONHECIMENTOS
// =================================================================

// Rota para criar um novo reconhecimento
router.post('/', recognitionController.createRecognition);

// Rota para listar todos os reconhecimentos do usuário (enviados e recebidos)
router.get('/all', recognitionController.getAllRecognitions);

// Rota para listar apenas os reconhecimentos enviados pelo usuário
router.get('/given', recognitionController.getGivenRecognitions);

// Rota para listar apenas os reconhecimentos recebidos pelo usuário
// Esta substitui a antiga rota GET /api/recognitions
router.get('/received', recognitionController.getReceivedRecognitions);


module.exports = router;