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
router.use('/api', authRoutes);
router.use('/api/users', userRoutes);
router.use('/api/usuario', userRoutes);
router.use('/api/feedbacks', feedbackRoutes);
router.use('/api/recognitions', recognitionRoutes);
router.use('/api/humor', humorRoutes);
router.use('/api/objetivos', objetivoRoutes);
router.use('/api/avaliacoes', avaliacaoRoutes);
router.use('/api/analytics', analyticsRoutes);
router.use('/api/manager', analyticsRoutes);
router.use('/api/pesquisas', pesquisaRoutes);

module.exports = router;