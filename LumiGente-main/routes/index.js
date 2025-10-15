const express = require('express');
const router = express.Router();

// Importação de todos os arquivos de rota
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const feedbackRoutes = require('./feedbackRoutes');
const recognitionRoutes = require('./recognitionRoutes');
const humorRoutes = require('./humorRoutes');
const objetivoRoutes = require('./objetivoRoutes');
const avaliacaoRoutes = require('./avaliacaoRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const pesquisaRoutes = require('./pesquisaRoutes');

// Definição dos prefixos para cada conjunto de rotas
router.use('/', authRoutes); // Rotas como /login, /logout, /register
router.use('/users', userRoutes);
router.use('/usuario', userRoutes); // Mantendo para compatibilidade
router.use('/feedbacks', feedbackRoutes);
router.use('/recognitions', recognitionRoutes);
router.use('/humor', humorRoutes);
router.use('/objetivos', objetivoRoutes);
router.use('/avaliacoes', avaliacaoRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/manager', analyticsRoutes); // Rotas de manager em analytics
router.use('/pesquisas', pesquisaRoutes);

module.exports = router;