    const express = require('express');
const router = express.Router();
const avaliacaoController = require('../controllers/avaliacaoController');
const { requireAuth, requireManagerAccess } = require('../middleware/authMiddleware'); // Usaremos um genérico para admin/RH

// Aplica o middleware de autenticação para todas as rotas de avaliações
router.use(requireAuth);

// =================================================================
// ROTAS PARA USUÁRIOS (Colaborador e seu Gestor)
// =================================================================

// Lista as avaliações do usuário logado (seja como avaliado ou avaliador)
router.get('/minhas', avaliacaoController.getMinhasAvaliacoes);

// Salva as respostas de uma avaliação (autoavaliação ou do gestor)
router.post('/responder', avaliacaoController.responderAvaliacao);

// Busca o questionário padrão para um tipo de avaliação (45 ou 90 dias)
router.get('/questionario/:tipo', avaliacaoController.getQuestionarioPadrao);

// Busca os detalhes e respostas de uma avaliação específica que o usuário tem acesso
router.get('/:id/respostas', avaliacaoController.getRespostasAvaliacao);

// Busca os dados de uma avaliação específica (deve ser uma das últimas rotas para não conflitar)
router.get('/:id', avaliacaoController.getAvaliacaoById);


// =================================================================
// ROTAS ADMINISTRATIVAS (Acesso restrito a Gestores, RH, T&D)
// =================================================================

// Middleware para proteger as rotas administrativas abaixo
router.use(requireManagerAccess);

// Lista TODAS as avaliações do sistema
router.get('/todas', avaliacaoController.getAllAvaliacoes);

// Atualiza o questionário padrão de um tipo de avaliação
router.put('/questionario/:tipo', avaliacaoController.updateQuestionarioPadrao);

// Reabre uma avaliação que estava expirada, definindo uma nova data limite
router.post('/:id/reabrir', avaliacaoController.reabrirAvaliacao);

// Endpoint para acionar manualmente a verificação e criação de novas avaliações
router.post('/verificar', avaliacaoController.verificarAvaliacoes);


module.exports = router;