const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

// Rotas públicas
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/check-cpf', authController.checkCpf);

// Rota protegida
router.post('/logout', requireAuth, authController.logout);

module.exports = router;