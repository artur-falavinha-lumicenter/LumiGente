const express = require('express');
const router = express.Router();
const objetivoController = require('../controllers/objetivoController');
const { requireAuth, requireManagerAccess } = require('../middleware/authMiddleware');

// Aplica o middleware de autenticação para TODAS as rotas de objetivos
router.use(requireAuth);

// =================================================================
// ROTAS PRINCIPAIS DE CRUD
// =================================================================

// Rota para listar objetivos (do usuário e da sua equipe) e criar um novo objetivo
router.route('/')
    .get(objetivoController.getObjetivos)
    .post(objetivoController.createObjetivo);

// Rota para buscar, atualizar e deletar um objetivo específico pelo ID
router.route('/:id')
    .get(objetivoController.getObjetivoById)
    .put(objetivoController.updateObjetivo) // A lógica no controller já verifica se o usuário é o criador
    .delete(objetivoController.deleteObjetivo); // A lógica no controller já verifica se o usuário é o criador

// =================================================================
// ROTAS DE CHECK-IN E GESTÃO
// =================================================================

// Rota para registrar um check-in de progresso em um objetivo
router.post('/:id/checkin', objetivoController.createCheckin);

// Rota para listar todos os check-ins de um objetivo específico
router.get('/:id/checkins', objetivoController.getCheckins);

// Rota para buscar filtros disponíveis para a página de objetivos (status, responsáveis)
router.get('/filtros', objetivoController.getFiltros);

// =================================================================
// ROTAS DE APROVAÇÃO (Acesso restrito a Gestores/RH)
// =================================================================

// Rota para um gestor aprovar a conclusão de um objetivo
router.post('/:id/approve', requireManagerAccess, objetivoController.approveObjetivo);

// Rota para um gestor rejeitar a conclusão de um objetivo, revertendo o progresso
router.post('/:id/reject', requireManagerAccess, objetivoController.rejectObjetivo);


module.exports = router;