const express = require('express');
const router = express.Router();
const humorController = require('../controllers/humorController');
const { requireAuth, requireManagerAccess } = require('../middleware/authMiddleware');

// Aplica o middleware de autenticação para TODAS as rotas de humor
router.use(requireAuth);

// =================================================================
// ROTAS PARA O USUÁRIO INDIVIDUAL
// =================================================================

// Rota principal para obter e registrar o humor do dia do usuário logado
router.route('/')
    .get(humorController.getHumorDoDia)
    .post(humorController.registrarHumor);

// Rota para obter o histórico de humor do usuário logado
router.get('/history', humorController.getHumorHistory);


// =================================================================
// ROTAS DE GESTÃO E ANÁLISE (Acesso restrito a Gestores/RH)
// =================================================================

// Aplica o middleware de verificação de gestor para todas as rotas abaixo
router.use(requireManagerAccess);

// Rota para buscar métricas agregadas da equipe do gestor
router.get('/team-metrics', humorController.getTeamMetrics);

// Rota para buscar o histórico de humor detalhado da equipe do gestor
router.get('/team-history', humorController.getTeamHistory);

// Rota para buscar dados de humor de toda a empresa (com filtros)
router.get('/empresa', humorController.getHumorEmpresa);

// Rota para buscar métricas gerais de humor (média, por departamento, etc.)
router.get('/metrics', humorController.getHumorMetrics);


module.exports = router;