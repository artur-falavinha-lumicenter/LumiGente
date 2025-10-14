const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { requireAuth, requireManagerAccess } = require('../middleware/authMiddleware');

// Aplica o middleware de autenticação para todas as rotas de analytics e gestão
router.use(requireAuth);

// =================================================================
// ROTAS PÚBLICAS (Acessíveis a todos os usuários logados)
// =================================================================

// Métricas simples para o dashboard individual
router.get('/metrics', analyticsController.getUserMetrics); // Movido para cá, mas poderia ser de /usuario

// Rankings e Leaderboards são geralmente visíveis para todos
router.get('/rankings', analyticsController.getUserRankings);
router.get('/gamification-leaderboard', analyticsController.getGamificationLeaderboard);


// =================================================================
// ROTAS DE GESTÃO E ANALYTICS (Acesso restrito a gestores, RH, T&D)
// =================================================================

// Aplica o middleware de verificação de gestor para as rotas abaixo
router.use(requireManagerAccess);

// --- Rotas de Dashboard e Análise Geral ---
router.get('/dashboard', analyticsController.getCompleteDashboard);
router.get('/department-analytics', analyticsController.getDepartmentAnalytics);
router.get('/trends', analyticsController.getTrendAnalytics);

// --- Rotas de Exportação ---
router.get('/export', analyticsController.exportAnalytics);

// --- Rotas de Gestão de Equipe (prefixo /api/manager) ---
router.get('/team-management', analyticsController.getTeamManagementData);
router.get('/employee-info/:employeeId', analyticsController.getEmployeeInfo);
router.get('/employee-feedbacks/:employeeId', analyticsController.getEmployeeFeedbacks);

module.exports = router;