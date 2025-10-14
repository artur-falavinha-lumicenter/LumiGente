const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/authMiddleware');

// Rotas para o usuário logado
router.get('/', requireAuth, userController.getCurrentUser); // Corresponde a /api/usuario
router.get('/permissions', requireAuth, userController.getUserPermissions);
router.put('/profile', requireAuth, userController.updateProfile);
router.put('/password', requireAuth, userController.updatePassword);
router.put('/notifications', requireAuth, userController.updateNotificationPreferences);
router.put('/privacy', requireAuth, userController.updatePrivacySettings);

// Rotas de listagem e consulta
router.get('/list', requireAuth, userController.getUsers); // Nova rota /api/users/list para evitar conflito
router.get('/feedback', requireAuth, userController.getUsersForFeedback);
router.get('/subordinates', requireAuth, userController.getSubordinates);

module.exports = router;