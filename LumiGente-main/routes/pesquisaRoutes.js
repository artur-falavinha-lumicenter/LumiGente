const express = require('express');
const router = express.Router();
// Importa do novo e único controller com os nomes de função corretos
const pesquisaController = require('../controllers/pesquisaController');
const { requireAuth, requireHRAccess } = require('../middleware/authMiddleware');

// =====================================================
// ROTAS DO SISTEMA UNIFICADO DE PESQUISAS (/api/pesquisas)
// =====================================================

// Rotas com acesso para todos os usuários autenticados
router.get('/', requireAuth, pesquisaController.listPesquisas);
router.get('/stats', requireAuth, pesquisaController.getPesquisaStats);
router.get('/:id', requireAuth, pesquisaController.getPesquisaById);
router.get('/:id/my-response', requireAuth, pesquisaController.getMyResponse);
router.post('/:id/responder', requireAuth, pesquisaController.responderPesquisa);

// Rotas com acesso restrito para RH/T&D
router.post('/', requireAuth, requireHRAccess, pesquisaController.createPesquisa);
router.get('/meta/filtros', requireAuth, requireHRAccess, pesquisaController.getMetaFiltros);
router.get('/:id/resultados', requireAuth, requireHRAccess, pesquisaController.getPesquisaResultados);
router.post('/:id/reabrir', requireAuth, requireHRAccess, pesquisaController.reabrirPesquisa);

module.exports = router;