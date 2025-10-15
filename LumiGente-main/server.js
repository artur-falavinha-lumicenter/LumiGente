// LumiGente-main/server.js

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const { connectToDatabase } = require('./config/db');
const allRoutes = require('./routes');
const SincronizadorDadosExternos = require('./services/sincronizador_dados_externos');
const scheduleJobs = require('./jobs/schedule');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares essenciais
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'lumicenter-feedback-secret',
    resave: false,
    saveUninitialized: false,
    name: 'lumigente.sid',
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 8 * 60 * 60 * 1000,
        sameSite: 'strict'
    },
    rolling: true
}));

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Carregar todas as rotas da aplicação
app.use('/api', allRoutes);

// Rota principal que redireciona para o login ou para a aplicação
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

// Iniciar o servidor e serviços
async function startServer() {
    try {
        await connectToDatabase();
        console.log('✅ Conectado ao SQL Server');

        // Iniciar o sincronizador de dados
        const sincronizador = new SincronizadorDadosExternos();
        sincronizador.startAutoSync(30); // Sincroniza a cada 30 minutos

        // Agendar tarefas recorrentes
        scheduleJobs();

        app.listen(PORT, () => {
            console.log(`🚀 Servidor rodando na porta ${PORT}`);
            console.log(`📱 Acesse: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar o servidor:', error);
        process.exit(1); // Encerra a aplicação em caso de erro na inicialização
    }
}

startServer();