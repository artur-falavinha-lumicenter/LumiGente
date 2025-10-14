const express = require('express');
const path = require('path');
const sql = require('mssql');

// Função simples de autenticação
function requireAuth(req, res, next) {
    if (!req.session.user) {
        // Se é uma requisição de página HTML, redirecionar para login
        if (req.accepts('html') && !req.xhr) {
            return res.redirect('/login');
        }
        // Se é uma requisição AJAX/API, retornar erro JSON
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    next();
}

// Lazy loading para módulos não essenciais na inicialização
let cors, bcrypt, validator, session, schedule;
let HierarchyManager, SincronizadorDadosExternos, AnalyticsManager, AvaliacoesManager;
let { spawn } = require('child_process');

// Importar função para calcular HierarchyLevel
const { getHierarchyLevel } = require('./utils/hierarchyHelper');

// Função para verificar e corrigir estrutura da tabela Users
async function verificarEstruturaTabelaUsers() {
    try {
        const pool = await getDatabasePool();
        
        // Verificar se a coluna PasswordHash existe e tem tamanho suficiente
        const checkColumnResult = await pool.request()
            .query(`
                SELECT 
                    COLUMN_NAME,
                    DATA_TYPE,
                    CHARACTER_MAXIMUM_LENGTH,
                    IS_NULLABLE
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'PasswordHash'
            `);
        
        if (checkColumnResult.recordset.length === 0) {
            console.log('⚠️ Coluna PasswordHash não encontrada. Criando...');
            await pool.request()
                .query(`
                    ALTER TABLE Users 
                    ADD PasswordHash VARCHAR(255) NULL
                `);
            console.log('✅ Coluna PasswordHash criada com sucesso');
        } else {
            const column = checkColumnResult.recordset[0];
            
            // Verificar se o tamanho é suficiente (bcrypt gera hashes de ~60 caracteres)
            if (column.CHARACTER_MAXIMUM_LENGTH < 255) {
                console.log('⚠️ Tamanho da coluna PasswordHash pode ser insuficiente. Atualizando...');
                await pool.request()
                    .query(`
                        ALTER TABLE Users 
                        ALTER COLUMN PasswordHash VARCHAR(255)
                    `);
                console.log('✅ Tamanho da coluna PasswordHash atualizado para 255 caracteres');
            }
        }
        
    } catch (error) {
        console.error('❌ Erro ao verificar estrutura da tabela Users:', error);
    }
}

// Função para carregar dependências quando necessário
function loadDependencies() {
    if (!cors) {
        cors = require('cors');
        bcrypt = require('bcrypt');
        validator = require('validator');
        session = require('express-session');
        schedule = require('node-schedule');
        HierarchyManager = require('./utils/hierarchyManager');
        SincronizadorDadosExternos = require('./sincronizador_dados_externos');
        AnalyticsManager = require('./utils/analyticsManager');
        AvaliacoesManager = require('./utils/avaliacoesManager');
    }
}

// Função para verificar se o usuário é gestor baseado na HIERARQUIA_CC e HierarchyPath
async function isUserManager(user) {
    try {
        const pool = await sql.connect(dbConfig);
        
        console.log(`🔍 Verificando se usuário é gestor: CPF = ${user.CPF}, Nome = ${user.nomeCompleto || user.NomeCompleto}, Departamento = ${user.Departamento || user.departamento}`);
        
        // Verificar se o usuário aparece como CPF_RESPONSAVEL na HIERARQUIA_CC (gestor direto)
        const directManagerResult = await pool.request()
            .input('cpf', sql.VarChar, user.CPF)
            .query(`
                SELECT 
                    COUNT(*) as count
                FROM HIERARQUIA_CC 
                WHERE CPF_RESPONSAVEL = @cpf
            `);
        
        const isDirectManager = directManagerResult.recordset[0].count > 0;
        
        // Verificar se o usuário está em um nível superior da hierarquia
        // Buscar o departamento do usuário na HIERARQUIA_CC
        const userDeptResult = await pool.request()
            .input('departamento', sql.VarChar, user.Departamento || user.departamento)
            .query(`
                SELECT DISTINCT HIERARQUIA_COMPLETA, FILIAL
                FROM HIERARQUIA_CC 
                WHERE DEPTO_ATUAL = @departamento
            `);
        
        let isUpperManager = false;
        
        // Se o usuário tem departamento na hierarquia, verificar se outros departamentos
        // têm esse departamento em sua hierarquia (ou seja, são subordinados)
        if (userDeptResult.recordset.length > 0) {
            const userHierarchies = userDeptResult.recordset;
            
            for (const userHier of userHierarchies) {
                const userDept = user.Departamento || user.departamento;
                
                // Verificar se existem departamentos que têm este departamento na hierarquia
                const subordinatesResult = await pool.request()
                    .input('departamento', sql.VarChar, userDept)
                    .input('filial', sql.VarChar, userHier.FILIAL)
                    .query(`
                        SELECT COUNT(*) as count
                        FROM HIERARQUIA_CC 
                        WHERE HIERARQUIA_COMPLETA LIKE '%' + @departamento + '%'
                        AND FILIAL = @filial
                        AND DEPTO_ATUAL != @departamento
                    `);
                
                if (subordinatesResult.recordset[0].count > 0) {
                    isUpperManager = true;
                    console.log(`👨‍💼 Usuário é gestor de nível superior - departamento ${userDept} está na hierarquia de outros departamentos`);
                    break;
                }
            }
        }
        
        const isManager = isDirectManager || isUpperManager;
        
        console.log(`🔍 Resultado da verificação: isDirectManager = ${isDirectManager}, isUpperManager = ${isUpperManager}, isManager = ${isManager}`);
        
        if (isManager) {
            // Buscar departamentos gerenciados
            const deptoResult = await pool.request()
                .input('cpf', sql.VarChar, user.CPF)
                .query(`
                    SELECT DISTINCT DEPTO_ATUAL
                    FROM HIERARQUIA_CC 
                    WHERE CPF_RESPONSAVEL = @cpf
                `);
            
            if (deptoResult.recordset.length > 0) {
                const departamentos = deptoResult.recordset.map(r => r.DEPTO_ATUAL).join(', ');
                console.log(`👨‍💼 Usuário ${user.nomeCompleto || user.NomeCompleto} é gestor direto de: ${departamentos}`);
            }
        } else {
            console.log(`👥 Usuário ${user.nomeCompleto || user.NomeCompleto} não é gestor`);
        }
        
        return isManager;
    } catch (error) {
        console.error('Erro ao verificar se usuário é gestor:', error);
        return false;
    }
}

// Função para obter informações detalhadas da hierarquia do usuário
async function getUserHierarchyInfo(user) {
    try {
        const pool = await sql.connect(dbConfig);
        
        // 1. Buscar departamentos onde o usuário é responsável direto
        const directResult = await pool.request()
            .input('cpf', sql.VarChar, user.CPF)
            .query(`
                SELECT 
                    DEPTO_ATUAL,
                    DESCRICAO_ATUAL,
                    HIERARQUIA_COMPLETA,
                    RESPONSAVEL_ATUAL,
                    CPF_RESPONSAVEL,
                    FILIAL,
                    'DIRETO' as TIPO_GESTAO
                FROM HIERARQUIA_CC 
                WHERE CPF_RESPONSAVEL = @cpf
            `);
        
        let allManagedDepts = [...directResult.recordset];
        
        // 2. Buscar departamentos subordinados (onde o departamento do usuário está na hierarquia)
        const userDept = user.Departamento || user.departamento;
        
        if (userDept) {
            const subordinatesResult = await pool.request()
                .input('departamento', sql.VarChar, userDept)
                .query(`
                    SELECT 
                        DEPTO_ATUAL,
                        DESCRICAO_ATUAL,
                        HIERARQUIA_COMPLETA,
                        RESPONSAVEL_ATUAL,
                        CPF_RESPONSAVEL,
                        FILIAL,
                        'HIERARQUIA' as TIPO_GESTAO
                    FROM HIERARQUIA_CC 
                    WHERE HIERARQUIA_COMPLETA LIKE '%' + @departamento + '%'
                    AND DEPTO_ATUAL != @departamento
                `);
            
            // Adicionar departamentos subordinados que não sejam gerenciados diretamente
            for (const subDept of subordinatesResult.recordset) {
                const alreadyExists = allManagedDepts.some(d => 
                    d.DEPTO_ATUAL === subDept.DEPTO_ATUAL && d.FILIAL === subDept.FILIAL
                );
                if (!alreadyExists) {
                    allManagedDepts.push(subDept);
                }
            }
        }
        
        // Ordenar por comprimento da hierarquia (mais profundo primeiro)
        allManagedDepts.sort((a, b) => b.HIERARQUIA_COMPLETA.length - a.HIERARQUIA_COMPLETA.length);
        
        console.log(`📊 Departamentos gerenciados por ${user.nomeCompleto || user.NomeCompleto}:`);
        console.log(`   - Gestão direta: ${directResult.recordset.length} departamentos`);
        console.log(`   - Total (incluindo hierarquia): ${allManagedDepts.length} departamentos`);
        
        return allManagedDepts;
    } catch (error) {
        console.error('Erro ao buscar informações hierárquicas:', error);
        return [];
    }
}

// Função para determinar permissões de acesso às abas baseado na hierarquia e departamento
async function getUserTabPermissions(user) {
    const departmentCode = user.Departamento;
    
    console.log(`🔍 Analisando permissões para usuário: ${user.nomeCompleto || user.NomeCompleto}, Departamento: ${departmentCode}`);
    
    // Departamentos com acesso total (todas as abas)
    const fullAccessDepartments = [
        '122134101', // COORDENACAO ADM/RH/SESMT MAO (código antigo)
        '000122134', // COORDENACAO ADM/RH/SESMT MAO (código correto)
        '121411100', // DEPARTAMENTO TREINAM&DESENVOLV
        '000121511', // SUPERVISAO RH
        '121511100'  // DEPARTAMENTO RH
    ];
    
    console.log(`🔍 Departamentos com acesso total: ${fullAccessDepartments.join(', ')}`);
    
    // Verificar se usuário é de departamento com acesso total
    if (fullAccessDepartments.includes(departmentCode)) {
        console.log(`✅ Usuário tem acesso total (RH/T&D): ${departmentCode}`);
        console.log(`   🔓 Liberando acesso a TODAS as abas (incluindo Histórico)`);
        
        // Buscar informações de hierarquia mesmo para usuários de RH/T&D
        const isManager = await isUserManager(user);
        const hierarchyInfo = await getUserHierarchyInfo(user);
        
        // Determinar nível hierárquico
        let hierarchyLevel = 1;
        if (hierarchyInfo.length > 0) {
            const longestPath = hierarchyInfo.reduce((prev, current) => 
                current.HIERARQUIA_COMPLETA.length > prev.HIERARQUIA_COMPLETA.length ? current : prev
            );
            const levels = longestPath.HIERARQUIA_COMPLETA.split(' > ').length;
            hierarchyLevel = levels;
            console.log(`   📊 Nível hierárquico: ${hierarchyLevel}, Departamentos gerenciados: ${hierarchyInfo.length}`);
        }
        
        return {
            dashboard: true,
            feedbacks: true,
            recognitions: true,
            humor: true,
            objetivos: true,
            pesquisas: true,
            avaliacoes: true,
            team: true,
            analytics: true,
            historico: true,
            isManager: true,
            isFullAccess: true,
            managerType: 'RH/T&D',
            hierarchyLevel: hierarchyLevel,
            managedDepartments: hierarchyInfo.map(h => h.DEPTO_ATUAL),
            managedDepartmentsDetails: hierarchyInfo.map(h => ({
                departamento: h.DEPTO_ATUAL,
                descricao: h.DESCRICAO_ATUAL,
                filial: h.FILIAL,
                hierarquia: h.HIERARQUIA_COMPLETA,
                tipoGestao: h.TIPO_GESTAO
            })),
            hierarchyPaths: hierarchyInfo.map(h => h.HIERARQUIA_COMPLETA)
        };
    }
    
    // Verificar se usuário é gestor baseado na HIERARQUIA_CC
    const isManager = await isUserManager(user);
    const hierarchyInfo = isManager ? await getUserHierarchyInfo(user) : [];
    
    if (isManager) {
        // Analisar o HierarchyPath para determinar o nível de gestão
        let managerType = 'Gestor';
        let hierarchyLevel = 1;
        
        if (hierarchyInfo.length > 0) {
            // Analisar o HierarchyPath mais longo para determinar o nível
            const longestPath = hierarchyInfo.reduce((prev, current) => 
                current.HIERARQUIA_COMPLETA.length > prev.HIERARQUIA_COMPLETA.length ? current : prev
            );
            
            // Contar níveis na hierarquia (separados por ' > ')
            const levels = longestPath.HIERARQUIA_COMPLETA.split(' > ').length;
            hierarchyLevel = levels;
            
            if (levels >= 4) {
                managerType = 'Diretor/Gerente Geral';
            } else if (levels >= 3) {
                managerType = 'Gerente';
            } else if (levels >= 2) {
                managerType = 'Supervisor/Coordenador';
            }
        }
        
        console.log(`👨‍💼 ${user.nomeCompleto || user.NomeCompleto} identificado como ${managerType} (nível ${hierarchyLevel})`);
        console.log(`   📋 Gerencia ${hierarchyInfo.length} departamento(s)`);
        
        // Gestores - todas as abas exceto Histórico
        return {
            dashboard: true,
            feedbacks: true,
            recognitions: true,
            humor: true,
            objetivos: true,
            pesquisas: true,
            avaliacoes: true,
            team: true,
            analytics: true,
            historico: false,
            isManager: true,
            isFullAccess: false,
            managerType: managerType,
            hierarchyLevel: hierarchyLevel,
            managedDepartments: hierarchyInfo.map(h => h.DEPTO_ATUAL),
            managedDepartmentsDetails: hierarchyInfo.map(h => ({
                departamento: h.DEPTO_ATUAL,
                descricao: h.DESCRICAO_ATUAL,
                filial: h.FILIAL,
                hierarquia: h.HIERARQUIA_COMPLETA,
                tipoGestao: h.TIPO_GESTAO
            })),
            hierarchyPaths: hierarchyInfo.map(h => h.HIERARQUIA_COMPLETA)
        };
    }
    
    console.log(`👥 ${user.nomeCompleto || user.NomeCompleto} identificado como colaborador comum`);
    
    // Usuários comuns - abas limitadas
    return {
        dashboard: true,
        feedbacks: true,
        recognitions: true,
        humor: true,
        objetivos: true,
        pesquisas: true,
        avaliacoes: true,
        team: false,
        analytics: false,
        historico: false,
        isManager: false,
        isFullAccess: false,
        managerType: 'Colaborador',
        hierarchyLevel: 0,
        managedDepartments: [],
        hierarchyPaths: []
    };
}

// Carregar variáveis de ambiente
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database config usando variáveis de ambiente
const dbConfig = {
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    driver: process.env.DB_DRIVER,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITH_ABORT === 'true',
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT) || 30000,
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000,
        pool: {
            max: parseInt(process.env.DB_POOL_MAX) || 10,
            min: parseInt(process.env.DB_POOL_MIN) || 0,
            idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000
        }
    }
};

// Configuração alternativa para fallback usando variáveis de ambiente
const dbConfigFallback = {
    user: process.env.DB_USER || undefined,
    password: process.env.DB_PASSWORD || undefined,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    driver: process.env.DB_DRIVER,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITH_ABORT === 'true',
        requestTimeout: parseInt(process.env.DB_FALLBACK_REQUEST_TIMEOUT) || 60000,
        connectionTimeout: parseInt(process.env.DB_FALLBACK_CONNECTION_TIMEOUT) || 60000,
        pool: {
            max: parseInt(process.env.DB_FALLBACK_POOL_MAX) || 5,
            min: parseInt(process.env.DB_FALLBACK_POOL_MIN) || 0,
            idleTimeoutMillis: parseInt(process.env.DB_FALLBACK_POOL_IDLE_TIMEOUT) || 60000
        }
    }
};

// Função utilitária para conexão com retry logic
async function connectWithRetry(config, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔌 Tentativa ${attempt}/${maxRetries} de conexão com banco de dados...`);
            const pool = await sql.connect(config);
            return pool;
        } catch (error) {
            lastError = error;
            console.error(`❌ Tentativa ${attempt} falhou:`, error.message);
            
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
                console.log(`⏳ Aguardando ${delay}ms antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw new Error(`Falha na conexão após ${maxRetries} tentativas. Último erro: ${lastError.message}`);
}

// Função para obter pool de conexão com fallback
async function getDatabasePool() {
    try {
        return await connectWithRetry(dbConfig);
    } catch (error) {
        console.log('🔄 Tentando configuração alternativa...');
        try {
            return await connectWithRetry(dbConfigFallback);
        } catch (fallbackError) {
            console.error('❌ Ambas as configurações falharam:', fallbackError.message);
            throw fallbackError;
        }
    }
}

// Função para garantir que as tabelas de chat existam
async function ensureChatTablesExist(pool) {
    try {
        // Primeiro, verificar e criar tabela FeedbackReplies se não existir
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'FeedbackReplies')
            BEGIN
                CREATE TABLE FeedbackReplies (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    feedback_id INT NOT NULL,
                    user_id INT NOT NULL,
                    reply_text NTEXT NOT NULL,
                    reply_to_id INT NULL,
                    reply_to_message NTEXT NULL,
                    reply_to_user NVARCHAR(255) NULL,
                    created_at DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (feedback_id) REFERENCES Feedbacks(Id),
                    FOREIGN KEY (user_id) REFERENCES Users(Id)
                );
                PRINT 'Tabela FeedbackReplies criada com sucesso';
            END
        `);
        
        // Verificar e criar tabela FeedbackReplyReactions se não existir
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'FeedbackReplyReactions')
            BEGIN
                CREATE TABLE FeedbackReplyReactions (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    reply_id INT NOT NULL,
                    user_id INT NOT NULL,
                    emoji NVARCHAR(10) NOT NULL,
                    created_at DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (reply_id) REFERENCES FeedbackReplies(Id),
                    FOREIGN KEY (user_id) REFERENCES Users(Id)
                );
                PRINT 'Tabela FeedbackReplyReactions criada com sucesso';
            END
        `);
        
        // Criar índices para melhor performance
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_FeedbackReplies_feedback_id')
            BEGIN
                CREATE INDEX IX_FeedbackReplies_feedback_id ON FeedbackReplies(feedback_id);
                PRINT 'Índice IX_FeedbackReplies_feedback_id criado';
            END
            
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_FeedbackReplyReactions_reply_id')
            BEGIN
                CREATE INDEX IX_FeedbackReplyReactions_reply_id ON FeedbackReplyReactions(reply_id);
                PRINT 'Índice IX_FeedbackReplyReactions_reply_id criado';
            END
            
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_FeedbackReplyReactions_user_id')
            BEGIN
                CREATE INDEX IX_FeedbackReplyReactions_user_id ON FeedbackReplyReactions(user_id);
                PRINT 'Índice IX_FeedbackReplyReactions_user_id criado';
            END
        `);
        
    } catch (error) {
        console.error('❌ Erro ao criar tabelas de chat:', error.message);
        // Não falhar se as tabelas já existirem
    }
}

// Instanciar gerenciadores (lazy loading)
let hierarchyManager, sincronizador, analyticsManager;

function initializeManagers() {
    if (!hierarchyManager) {
        loadDependencies();
        hierarchyManager = new HierarchyManager(dbConfig);
        sincronizador = new SincronizadorDadosExternos(dbConfig);
        analyticsManager = new AnalyticsManager(dbConfig);
    }
}

// Middleware (com lazy loading)
function setupMiddleware() {
    loadDependencies();
    app.use(cors({ credentials: true, origin: true }));
    app.use(express.json());
    app.use(session({
        secret: process.env.SESSION_SECRET || 'lumicenter-feedback-secret',
        resave: false,
        saveUninitialized: false,
        name: 'lumigente.sid', // Nome personalizado para o cookie
        cookie: { 
            secure: process.env.NODE_ENV === 'production', // HTTPS em produção
            httpOnly: true, // Sempre true para segurança
            maxAge: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 8 * 60 * 60 * 1000, // 8 horas
            sameSite: 'strict' // Proteção contra ataques de cross-site
        },
        rolling: true // Renovar cookie a cada requisição
    }));
}

// Configurar middleware
setupMiddleware();

// Home route - redireciona diretamente para login ou app
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/index.html');
    } else {
        return res.redirect('/login');
    }
});

// Rota específica para index.html com proteção TOTAL
app.get('/index.html', (req, res, next) => {
    if (!req.session.user) {
        console.log('❌ BLOQUEADO: Acesso negado ao index.html');
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate, private',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Frame-Options': 'DENY'
        });
        return res.redirect('/login');
    }
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate, private',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    next();
});

// Login route
app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
});

// Middleware para proteger TODAS as páginas HTML autenticadas
const protectedPages = [
    '/index.html',
    '/autoavaliacao.html', 
    '/avaliacao-gestor.html',
    '/criar-pesquisa.html',
    '/responder-pesquisa.html',
    '/resultados-pesquisa.html'
];

// Aplicar proteção para cada página
protectedPages.forEach(page => {
    app.get(page, (req, res, next) => {
        if (!req.session.user) {
            return res.redirect('/login');
        }
        next();
    });
});

// Middleware personalizado para interceptar todas as requisições de arquivos HTML
app.use((req, res, next) => {
    const requestedFile = req.originalUrl;
    
    // Verificar apenas arquivos HTML
    if (requestedFile.endsWith('.html')) {
        
        // BLOQUEIO TOTAL do index.html sem sessão válida
        if (requestedFile === '/index.html' && !req.session.user) {
            console.log('🚫 BLOQUEADO: Acesso ao index.html sem sessão válida');
            res.set({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            return res.redirect('/login');
        }
        
        // BLOQUEIO ESPECÍFICO para páginas de pesquisa (apenas RH e T&D)
        if (requestedFile === '/resultados-pesquisa.html' || requestedFile === '/criar-pesquisa.html') {
            if (!req.session.user) {
    
                res.set('Content-Security-Policy', "default-src 'none'");
                return res.status(404).send('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET ' + requestedFile + '</pre>\n</body>\n</html>\n');
            }
            
            const user = req.session.user;
            const departamento = user.departamento ? user.departamento.toUpperCase() : '';
            const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
            const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                         departamento.includes('TREINAMENTO') || 
                         departamento.includes('DESENVOLVIMENTO') ||
                         departamento.includes('T&D');
            
            if (!isHR && !isTD) {
                console.log(`🚫 BLOQUEADO: ${requestedFile} - ${user.nomeCompleto} (${user.departamento})`);
                res.set('Content-Security-Policy', "default-src 'none'");
                return res.status(404).send('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET ' + requestedFile + '</pre>\n</body>\n</html>\n');
            }
        }
        
        // Se é uma página protegida e usuário não está autenticado
        if (protectedPages.includes(requestedFile) && !req.session.user) {
            console.log('❌ Página protegida sem sessão - redirecionando');
            return res.redirect('/login');
        }
        
        // Se é login.html e usuário já está autenticado
        if (requestedFile === '/login.html' && req.session.user) {
            console.log('🔄 Usuário logado tentando acessar login - redirecionando para app');
            return res.redirect('/index.html');
        }
    }
    
    next();
});

// Static files - deve vir DEPOIS das rotas específicas
// Middleware adicional para arquivos estáticos protegidos
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('index.html')) {
            res.set({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
        }
    }
}));

// Rota para favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Connect to database
sql.connect(dbConfig).then(async () => {
    console.log('✅ Conectado ao SQL Server');
    
    // Garantir que as tabelas de chat existam
    try {
        const pool = await sql.connect(dbConfig);
        await ensureChatTablesExist(pool);
    } catch (error) {
        console.log('⚠️ Erro ao verificar tabelas de chat:', error.message);
    }
    
    // ========================================
    // AGENDAMENTO AUTOMÁTICO DE ATUALIZAÇÃO DE STATUS DAS PESQUISAS
    // ========================================
    
    // Executar uma vez ao iniciar o servidor
    console.log('🔄 Executando primeira verificação de status das pesquisas...');
    await updatePesquisaStatus();
    
    // Configurar verificação para minutos cheios (00s) - menos sobrecarga
    const syncToNextMinute = () => {
        const now = new Date();
        const secondsToNextMinute = 60 - now.getSeconds();
        const millisecondsToNextMinute = secondsToNextMinute * 1000;
        
        setTimeout(() => {
            // Executar imediatamente quando chegar no minuto cheio
            const now = new Date().toLocaleTimeString('pt-BR');
            console.log(`🕒 [${now}] Verificação automática de status das pesquisas...`);
            updatePesquisaStatus();
            
            // Configurar intervalo de 60 segundos exatos a partir de agora (minuto cheio)
    setInterval(async () => {
        const now = new Date().toLocaleTimeString('pt-BR');
        console.log(`🕒 [${now}] Verificação automática de status das pesquisas...`);
        await updatePesquisaStatus();
            }, 60 * 1000);
        }, millisecondsToNextMinute);
    };
    
    syncToNextMinute();
    
    // ========================================
    // AGENDAMENTO AUTOMÁTICO DE ATUALIZAÇÃO DE STATUS DOS OBJETIVOS
    // ========================================
    
    // Carregar dependências necessárias
    loadDependencies();
    
    // Configurar horário de verificação (padrão: meia-noite)
    const objetivoCheckTime = process.env.OBJETIVO_CHECK_TIME || '0 0 * * *'; // 00:00 todos os dias
    
    // Executar uma vez ao iniciar o servidor
    console.log('🔄 Executando primeira verificação de status dos objetivos...');
    await updateObjetivoStatus();
    
    // Agendar verificação diária
    schedule.scheduleJob(objetivoCheckTime, async () => {
        const now = new Date().toLocaleString('pt-BR');
        console.log(`🕛 [${now}] Verificação automática de status dos objetivos...`);
        await updateObjetivoStatus();
    });
    
    console.log(`⏰ Agendamento automático de objetivos configurado: ${objetivoCheckTime}`);
    
    // ========================================
    // AGENDAMENTO AUTOMÁTICO DE VERIFICAÇÃO DE AVALIAÇÕES
    // ========================================
    // Executar verificação diariamente às 08:00 (horário de chegada dos funcionários)
    const avaliacaoCheckTime = '0 8 * * *'; // Todo dia às 08:00
    
    // Função para verificar e criar avaliações automaticamente
    async function verificarAvaliacoesAutomaticamente() {
        try {
            loadDependencies();
            const pool = await sql.connect(dbConfig);
            
            const resultado = await AvaliacoesManager.verificarECriarAvaliacoes(pool);
            
            console.log('✅ Verificação automática de avaliações concluída:', resultado);
            
        } catch (error) {
            console.error('❌ Erro na verificação automática de avaliações:', error);
        }
    }
    
    // Agendar verificação diária
    schedule.scheduleJob(avaliacaoCheckTime, verificarAvaliacoesAutomaticamente);
    
    console.log(`⏰ Agendamento automático de avaliações configurado: ${avaliacaoCheckTime}`);
    console.log('📋 Sistema de avaliações automáticas ativado - Verificação diária às 08:00');
    
    // Executar verificação na inicialização do servidor (opcional)
    setTimeout(async () => {
        console.log('🚀 Executando primeira verificação de avaliações na inicialização...');
        await verificarAvaliacoesAutomaticamente();
    }, 10000); // Aguardar 10 segundos após inicialização
    
    // ========================================
    // VERIFICAÇÃO AUTOMÁTICA DE AVALIAÇÕES EXPIRADAS
    // ========================================
    // Atualizar status de avaliações expiradas diariamente
    async function verificarStatusAvaliacoes() {
        try {
            const pool = await sql.connect(dbConfig);
            
            // PASSO 1: Mudar avaliações AGENDADAS para PENDENTE quando chegar no período correto
            // Para 45 dias: quando tiver >= 45 dias desde admissão
            const resultAgendada45 = await pool.request().query(`
                UPDATE Avaliacoes
                SET StatusAvaliacao = 'Pendente',
                    AtualizadoEm = GETDATE()
                WHERE StatusAvaliacao = 'Agendada'
                    AND TipoAvaliacaoId = 1
                    AND DATEDIFF(DAY, DataAdmissao, GETDATE()) >= 45
            `);
            
            if (resultAgendada45.rowsAffected[0] > 0) {
                console.log(`📅 ${resultAgendada45.rowsAffected[0]} avaliação(ões) de 45 dias ativada(s) (Agendada → Pendente)`);
            }
            
            // Para 90 dias: quando tiver >= 90 dias desde admissão
            const resultAgendada90 = await pool.request().query(`
                UPDATE Avaliacoes
                SET StatusAvaliacao = 'Pendente',
                    AtualizadoEm = GETDATE()
                WHERE StatusAvaliacao = 'Agendada'
                    AND TipoAvaliacaoId = 2
                    AND DATEDIFF(DAY, DataAdmissao, GETDATE()) >= 90
            `);
            
            if (resultAgendada90.rowsAffected[0] > 0) {
                console.log(`📅 ${resultAgendada90.rowsAffected[0]} avaliação(ões) de 90 dias ativada(s) (Agendada → Pendente)`);
            }
            
            // PASSO 2: Marcar avaliações PENDENTES como EXPIRADAS quando passar do prazo
            const resultExpirada = await pool.request().query(`
                UPDATE Avaliacoes
                SET StatusAvaliacao = 'Expirada',
                    AtualizadoEm = GETDATE()
                WHERE StatusAvaliacao = 'Pendente'
                    AND DataLimiteResposta < GETDATE()
            `);
            
            if (resultExpirada.rowsAffected[0] > 0) {
                console.log(`⏰ ${resultExpirada.rowsAffected[0]} avaliação(ões) marcada(s) como expirada(s) (Pendente → Expirada)`);
            }
            
        } catch (error) {
            console.error('❌ Erro ao verificar status de avaliações:', error);
        }
    }
    
    // Agendar verificação diária de status de avaliações (00:00)
    schedule.scheduleJob('0 0 * * *', verificarStatusAvaliacoes);
    
    // Executar verificação inicial
    setTimeout(verificarStatusAvaliacoes, 15000); // 15 segundos após inicialização
    
    console.log('📅 Verificação automática de status de avaliações agendada');
    
}).catch(err => console.error('Erro ao conectar ao SQL Server:', err));



// Middleware para verificar permissões hierárquicas
const requireHierarchyAccess = (minLevel = 1) => {
    return (req, res, next) => {
        if (!req.session.user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }
        
        if (req.session.user.hierarchyLevel < minLevel) {
            return res.status(403).json({ error: 'Acesso negado. Nível hierárquico insuficiente.' });
        }
        
        next();
    };
};

// Middleware para verificar se pode acessar dados de outro usuário
const canAccessUser = async (req, res, next) => {
    try {
        const targetUserId = req.params.userId || req.body.userId;
        if (!targetUserId) {
            return next();
        }
        
        const pool = await sql.connect(dbConfig);
        const targetUserResult = await pool.request()
            .input('userId', sql.Int, targetUserId)
            .query(`
                SELECT HierarchyPath, Departamento, Matricula
                FROM Users WHERE Id = @userId
            `);
        
        const targetUser = targetUserResult.recordset[0];
        if (!targetUser) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        // Calcular HierarchyLevel do target dinamicamente
        targetUser.HierarchyLevel = getHierarchyLevel(targetUser.HierarchyPath, targetUser.Matricula, targetUser.Departamento);
        
        const currentUser = req.session.user;
        
        // Administradores podem acessar tudo
        if (currentUser.role === 'Administrador') {
            return next();
        }
        
        // Verificar hierarquia
        if (currentUser.hierarchyLevel > targetUser.HierarchyLevel) {
            // Superior pode acessar subordinados
            return next();
        } else if (currentUser.hierarchyLevel === targetUser.HierarchyLevel) {
            // Mesmo nível só pode acessar se for do mesmo departamento
            if (currentUser.departamento === targetUser.Departamento) {
                return next();
            }
        }
        
        return res.status(403).json({ error: 'Acesso negado. Permissão insuficiente.' });
    } catch (error) {
        console.error('Erro ao verificar permissões:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

// Middleware para verificar acesso baseado em hierarquia
const requireHierarchyLevel = (minLevel) => {
    return (req, res, next) => {
        const user = req.session.user;
        
        if (!user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }
        
        // Administradores sempre têm acesso
        if (user.role === 'Administrador') {
            return next();
        }
        
        // Verificar se o usuário tem o nível hierárquico mínimo
        if (user.hierarchyLevel >= minLevel) {
            return next();
        }
        
        return res.status(403).json({ 
            error: `Acesso negado. Nível hierárquico mínimo requerido: ${minLevel}` 
        });
    };
};

// Middleware para verificar se é gestor ou superior
const requireManagerAccess = async (req, res, next) => {
    const user = req.session.user;
    
    if (!user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    console.log(`🔐 Verificando acesso de gestor para ${user.nomeCompleto} (nível ${user.hierarchyLevel})`);
    
    // Administradores sempre têm acesso
    if (user.role === 'Administrador') {
        console.log('✅ Acesso liberado: Administrador');
        return next();
    }
    
    // Verificar se é RH ou T&D
    const departamento = user.departamento ? user.departamento.toUpperCase() : '';
    const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
    const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                 departamento.includes('TREINAMENTO') || 
                 departamento.includes('DESENVOLVIMENTO') ||
                 departamento.includes('T&D');
    
    if (isHR || isTD) {
        console.log('✅ Acesso liberado: RH/T&D -', user.departamento);
        return next();
    }
    
    // Verificar se é gestor (aparece como responsável na HIERARQUIA_CC)
    try {
        const pool = await sql.connect(dbConfig);
        const isManagerCheck = await pool.request()
            .input('userMatricula', sql.VarChar, user.matricula)
            .query(`
                SELECT COUNT(*) as count
                FROM HIERARQUIA_CC
                WHERE RESPONSAVEL_ATUAL = @userMatricula
                   OR NIVEL_1_MATRICULA_RESP = @userMatricula
                   OR NIVEL_2_MATRICULA_RESP = @userMatricula
                   OR NIVEL_3_MATRICULA_RESP = @userMatricula
                   OR NIVEL_4_MATRICULA_RESP = @userMatricula
            `);
        
        const isManager = isManagerCheck.recordset[0].count > 0;
        
        if (isManager) {
            console.log('✅ Acesso liberado: Gestor (matrícula:', user.matricula, ')');
            return next();
        }
        
        console.log('❌ Acesso negado: Nível insuficiente');
        return res.status(403).json({ 
            error: 'Acesso negado. Apenas gestores, RH e T&D podem acessar este recurso.' 
        });
    } catch (error) {
        console.error('Erro ao verificar acesso de gestor:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

// Função para validar CPF
function validarCPF(cpf) {
    // Remove caracteres não numéricos
    cpf = cpf.replace(/[^\d]/g, '');
    
    // Verifica se tem 11 dígitos
    if (cpf.length !== 11) return false;
    
    // Verifica se todos os dígitos são iguais
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    
    // Validação do primeiro dígito verificador
    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let resto = soma % 11;
    let dv1 = resto < 2 ? 0 : 11 - resto;
    
    // Validação do segundo dígito verificador
    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    resto = soma % 11;
    let dv2 = resto < 2 ? 0 : 11 - resto;
    
    return parseInt(cpf.charAt(9)) === dv1 && parseInt(cpf.charAt(10)) === dv2;
}

// Função para formatar CPF
function formatarCPF(cpf) {
    cpf = cpf.replace(/[^\d]/g, '');
    return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

// Verificar CPF para cadastro
app.post('/api/check-cpf', async (req, res) => {
    initializeManagers();
    const { cpf } = req.body;
    
    try {
        // Validar entrada
        if (!cpf) {
            return res.status(400).json({ error: 'CPF é obrigatório' });
        }
        
        // Validar formato do CPF
        if (!validarCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido' });
        }
        
        // Remover formatação do CPF para busca no banco
        const cpfSemFormatacao = cpf.replace(/[^\d]/g, '');
        const cpfFormatado = formatarCPF(cpf);
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se já existe usuário com este CPF
        const userResult = await pool.request()
            .input('cpf', sql.VarChar, cpfFormatado)
            .query(`SELECT Id FROM Users WHERE CPF = @cpf`);
        
        if (userResult.recordset.length > 0) {
            return res.json({ exists: true, message: 'CPF já cadastrado' });
        }
        
        // Verificar se existe na base de funcionários (usando CPF sem formatação)
        const funcionarioResult = await pool.request()
            .input('cpf', sql.VarChar, cpfSemFormatacao)
            .query(`
                SELECT TOP 1 MATRICULA, FILIAL, CENTRO_CUSTO, CPF, SITUACAO_FOLHA, STATUS_GERAL
                FROM TAB_HIST_SRA 
                WHERE CPF = @cpf
                ORDER BY 
                    CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                    MATRICULA DESC
            `);
        
        if (funcionarioResult.recordset.length === 0) {
            return res.json({ exists: false, employee: null, message: 'CPF não encontrado na base de funcionários' });
        }
        
        const funcionario = funcionarioResult.recordset[0];
        
        if (funcionario.STATUS_GERAL !== 'ATIVO') {
            return res.json({ 
                exists: false, 
                employee: null, 
                message: 'Funcionário inativo no sistema' 
            });
        }
        
        // Buscar informações de hierarquia usando o HierarchyManager
        const { path: hierarchyPath, departamento: departamentoDesc } = 
            await hierarchyManager.getHierarchyLevel(funcionario.MATRICULA);
        
        res.json({
            exists: false,
            employee: {
                cpf: cpfFormatado,
                matricula: funcionario.MATRICULA,
                filial: funcionario.FILIAL,
                centroCusto: funcionario.CENTRO_CUSTO,
                status: funcionario.STATUS_GERAL,
                departamento: departamentoDesc,
                hierarchyPath: hierarchyPath,
                nome: `Funcionário ${funcionario.MATRICULA}` // Nome será preenchido no cadastro
            },
            message: 'CPF válido para cadastro'
        });
        
    } catch (error) {
        console.error('Erro ao verificar CPF:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Cadastro de usuário
app.post('/api/register', async (req, res) => {
    initializeManagers();
    const { cpf, password, nomeCompleto } = req.body;
    
    try {
        // Validar entrada
        if (!cpf || !password) {
            return res.status(400).json({ error: 'CPF e senha são obrigatórios' });
        }
        
        // Validar formato do CPF
        if (!validarCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido' });
        }
        
        // Validar senha
        if (password.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
        }
        
        // Remover formatação do CPF para busca no banco
        const cpfSemFormatacao = cpf.replace(/[^\d]/g, '');
        const cpfFormatado = formatarCPF(cpf);
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se usuário existe e se já tem senha cadastrada (buscar com e sem formatação)
        const existingUserResult = await pool.request()
            .input('cpfFormatado', sql.VarChar, cpfFormatado)
            .input('cpfSemFormatacao', sql.VarChar, cpfSemFormatacao)
            .query(`SELECT Id, PasswordHash, FirstLogin, CPF FROM Users WHERE CPF = @cpfFormatado OR CPF = @cpfSemFormatacao`);
        
        if (existingUserResult.recordset.length === 0) {
            return res.status(400).json({ error: 'CPF não encontrado no sistema' });
        }
        
        const existingUser = existingUserResult.recordset[0];
        
        // Permitir cadastro apenas se FirstLogin = 1 (precisa fazer cadastro)
        if (existingUser.FirstLogin === 0 || existingUser.FirstLogin === false) {
            return res.status(400).json({ error: 'Usuário já possui cadastro realizado' });
        }
        
        // Verificar se existe na base de funcionários (usando CPF sem formatação)
        const funcionarioResult = await pool.request()
            .input('cpf', sql.VarChar, cpfSemFormatacao)
            .query(`
                SELECT TOP 1 MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL
                FROM TAB_HIST_SRA 
                WHERE CPF = @cpf
                ORDER BY 
                    CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                    MATRICULA DESC
            `);
        
        if (funcionarioResult.recordset.length === 0) {
            return res.status(400).json({ error: 'CPF não encontrado na base de funcionários' });
        }
        
        const funcionario = funcionarioResult.recordset[0];
        
        // Verificar se é usuário especial (definido por variável de ambiente)
        const specialCPFs = process.env.SPECIAL_USERS_CPF ? process.env.SPECIAL_USERS_CPF.split(',').map(cpf => cpf.trim()) : [];
        const isSpecialUser = specialCPFs.includes(cpfSemFormatacao);
        
        if (funcionario.STATUS_GERAL !== 'ATIVO' && !isSpecialUser) {
            return res.status(400).json({ error: 'Funcionário inativo no sistema' });
        }
        
        // Buscar hierarquia do funcionário usando o HierarchyManager
        initializeManagers();
        console.log(`Chamando getHierarchyLevel para matrícula: ${funcionario.MATRICULA}`);
        const hierarchyData = await hierarchyManager.getHierarchyLevel(funcionario.MATRICULA);
        const { path: hierarchyPath, departamento: departamentoDesc } = hierarchyData;
        
        // Log para debug
        console.log(`Hierarquia para cadastro ${funcionario.MATRICULA}:`, hierarchyData);
        console.log(`Valores extraídos: path=${hierarchyPath}, departamento=${departamentoDesc}`);
        
        // Hash da senha fornecida pelo usuário
        loadDependencies();
        const senhaHash = await bcrypt.hash(password, 10);
        
        // Atualizar usuário existente com senha e dados atualizados
        const nomeCompletoFinal = nomeCompleto || funcionario.NOME || `Funcionário ${funcionario.MATRICULA}`;
        const nomeFinal = nomeCompleto ? nomeCompleto.split(' ')[0] : (funcionario.NOME ? funcionario.NOME.split(' ')[0] : funcionario.MATRICULA);
        
        const cpfNoBanco = existingUser.CPF; // Usar o CPF como está no banco
        
        const updateResult = await pool.request()
            .input('cpf', sql.VarChar, cpfNoBanco)
            .input('passwordHash', sql.VarChar, senhaHash)
            .input('nomeCompleto', sql.VarChar, nomeCompletoFinal)
            .input('nome', sql.VarChar, nomeFinal)
            .query(`
                UPDATE Users 
                SET PasswordHash = @passwordHash,
                    FirstLogin = 0,
                    NomeCompleto = @nomeCompleto,
                    nome = @nome,
                    IsActive = 1,
                    UpdatedAt = GETDATE()
                WHERE CPF = @cpf
            `);
        
        // Buscar o usuário atualizado
        const userResult = await pool.request()
            .input('cpf', sql.VarChar, cpfNoBanco)
            .query(`
                SELECT Id, CPF, Matricula, HierarchyPath, Departamento, NomeCompleto, Filial
                FROM Users WHERE CPF = @cpf
            `);
        
        const updatedUser = userResult.recordset[0];
        
        // Calcular HierarchyLevel dinamicamente
        const hierarchyLevel = getHierarchyLevel(updatedUser.HierarchyPath);
        
        res.json({
            success: true,
            message: 'Cadastro realizado com sucesso',
            userId: updatedUser.Id,
            cpf: updatedUser.CPF,
            matricula: updatedUser.Matricula,
            nomeCompleto: updatedUser.NomeCompleto,
            departamento: updatedUser.Departamento,
            hierarchyLevel: hierarchyLevel,
            hierarchyPath: updatedUser.HierarchyPath
        });
        
    } catch (error) {
        console.error('Erro no cadastro:', error);
        
        // Verificar se é erro de CPF duplicado (constraint violation)
        if (error.message && error.message.includes('UQ_Users_CPF')) {
            return res.status(400).json({ error: 'CPF já cadastrado no sistema' });
        }
        
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Auth routes
app.post('/api/login', async (req, res) => {
    initializeManagers();
    const { cpf, password } = req.body;
    
    try {
        // Validar entrada
        if (!cpf || !password) {
            return res.status(400).json({ error: 'CPF e senha são obrigatórios' });
        }
        
        // Validar formato do CPF
        if (!validarCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido' });
        }
        
        // Remover formatação do CPF para busca no banco
        const cpfSemFormatacao = cpf.replace(/[^\d]/g, '');
        const cpfFormatado = formatarCPF(cpf);
        
        const pool = await getDatabasePool();
        
        // Primeiro, verificar se o funcionário está ativo na TAB_HIST_SRA (usando CPF sem formatação)
        // Buscar pela matrícula com data de admissão mais recente
        const funcionarioResult = await pool.request()
            .input('cpf', sql.VarChar, cpfSemFormatacao)
            .query(`
                WITH FuncionarioMaisRecente AS (
                    SELECT 
                        MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, SITUACAO_FOLHA, STATUS_GERAL, DTA_ADMISSAO, DEPARTAMENTO,
                        ROW_NUMBER() OVER (ORDER BY 
                            CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                            CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                            DTA_ADMISSAO DESC, 
                            MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA 
                    WHERE CPF = @cpf
                )
                SELECT TOP 1 MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, SITUACAO_FOLHA, STATUS_GERAL, DEPARTAMENTO
                FROM FuncionarioMaisRecente
                WHERE rn = 1
            `);

        const funcionario = funcionarioResult.recordset[0];

        if (!funcionario) {
            return res.status(401).json({ error: 'CPF não encontrado na base de funcionários' });
        }
        
        // Verificar se é usuário especial (definido por variável de ambiente)
        const specialCPFs = process.env.SPECIAL_USERS_CPF ? process.env.SPECIAL_USERS_CPF.split(',').map(cpf => cpf.trim()) : [];
        const isSpecialUser = specialCPFs.includes(cpfSemFormatacao) || specialCPFs.includes(cpfFormatado);
        
        if (funcionario.STATUS_GERAL !== 'ATIVO' && !isSpecialUser) {
            return res.status(401).json({ error: 'Funcionário inativo no sistema' });
        }
        
        // Buscar hierarquia do funcionário usando o HierarchyManager com a matrícula mais recente
        initializeManagers();
        const { path: hierarchyPath, departamento: departamentoDesc } = 
            await hierarchyManager.getHierarchyLevel(funcionario.MATRICULA);
        
        // Buscar usuário no sistema (com ou sem formatação)
        let userResult = await pool.request()
            .input('cpfFormatado', sql.VarChar, cpfFormatado)
            .input('cpfSemFormatacao', sql.VarChar, cpfSemFormatacao)
            .query(`
                SELECT u.Id AS userId, u.UserName, u.PasswordHash, u.FirstLogin,
                       u.NomeCompleto, u.nome, u.Departamento, u.IsActive,
                       u.Matricula, u.HierarchyPath
                FROM Users u
                WHERE u.CPF = @cpfFormatado OR u.CPF = @cpfSemFormatacao
            `);

        let user = userResult.recordset[0];

        // Se usuário não existe, retornar erro específico
        if (!user) {
            return res.status(401).json({ 
                error: 'CPF não encontrado ou você não possui permissão para acessar o sistema.',
                userNotFound: true 
            });
        }

        // Calcular HierarchyLevel dinamicamente usando a função JavaScript
        user.HierarchyLevel = getHierarchyLevel(user.HierarchyPath, user.Matricula, user.Departamento);

        // Se FirstLogin = 1, usuário precisa fazer cadastro primeiro
        if (user.FirstLogin === 1 || user.FirstLogin === true) {
            return res.status(200).json({ 
                success: false,
                error: 'Você não possui cadastro ainda. Crie uma conta primeiro.',
                needsRegistration: true 
            });
        }

        // Verificar se usuário está ativo no sistema
        if (user.IsActive !== 1 && user.IsActive !== true) {
            return res.status(401).json({ 
                error: 'Usuário inativo no sistema. Entre em contato com o administrador.',
                userInactive: true 
            });
        }
        
        // SEMPRE buscar dados atualizados do banco para garantir hierarquia correta
        const updatedUserResult = await pool.request()
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT Matricula, NomeCompleto, Departamento, HierarchyPath, Filial
                FROM Users WHERE Id = @userId
            `);
        
        if (updatedUserResult.recordset.length > 0) {
            const updatedUser = updatedUserResult.recordset[0];
            user.Matricula = updatedUser.Matricula;
            user.NomeCompleto = updatedUser.NomeCompleto;
            user.Departamento = updatedUser.Departamento;
            user.HierarchyPath = updatedUser.HierarchyPath;
            user.Filial = updatedUser.Filial;
            // Recalcular HierarchyLevel com dados atualizados
            user.HierarchyLevel = getHierarchyLevel(user.HierarchyPath, user.Matricula, user.Departamento);
        }
        
        // Verificar se dados do funcionário precisam ser atualizados
        // Usar o departamento correto da TAB_HIST_SRA, não o do HierarchyPath
        const departamentoCorreto = funcionario.DEPARTAMENTO;
        
        const needsUpdate = 
            user.Matricula !== funcionario.MATRICULA ||
            user.NomeCompleto !== funcionario.NOME ||
            user.Departamento !== departamentoCorreto ||
            user.HierarchyPath !== hierarchyPath ||
            user.Filial !== funcionario.FILIAL;

        if (needsUpdate) {
            console.log(`Atualizando dados do usuário: ${funcionario.NOME}`);
            console.log(`📋 Departamento atual: ${user.Departamento}, Departamento correto (TAB_HIST_SRA): ${departamentoCorreto}`);
            await pool.request()
                .input('userId', sql.Int, user.userId)
                .input('matricula', sql.VarChar, funcionario.MATRICULA)
                .input('nomeCompleto', sql.VarChar, funcionario.NOME)
                .input('departamento', sql.VarChar, departamentoCorreto)
                .input('hierarchyPath', sql.VarChar, hierarchyPath)
                .input('filial', sql.VarChar, funcionario.FILIAL)
                .query(`
                    UPDATE Users 
                    SET Matricula = @matricula,
                        NomeCompleto = @nomeCompleto,
                        Departamento = @departamento,
                        HierarchyPath = @hierarchyPath,
                        Filial = @filial,
                        updated_at = GETDATE()
                    WHERE Id = @userId
                `);
            
            // Atualizar objeto user para sessão
            user.Matricula = funcionario.MATRICULA;
            user.NomeCompleto = funcionario.NOME;
            user.Departamento = departamentoCorreto;
            user.HierarchyLevel = getHierarchyLevel(hierarchyPath, funcionario.MATRICULA, departamentoCorreto);
            user.HierarchyPath = hierarchyPath;
            user.Filial = funcionario.FILIAL;
        }
        
        // Verificar senha
        loadDependencies();
        
        // Verificar se o hash existe antes de comparar
        if (!user.PasswordHash || user.PasswordHash === '') {
            return res.status(401).json({ error: 'Senha não configurada. Faça o cadastro primeiro.' });
        }
        
        const senhaValida = await bcrypt.compare(password, user.PasswordHash);
        
        if (!senhaValida) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        
        // Atualizar último login
        try {
            await pool.request()
                .input('userId', sql.Int, user.userId)
                .query(`UPDATE Users SET LastLogin = GETDATE() WHERE Id = @userId`);
        } catch (error) {
            console.log('Coluna LastLogin não encontrada, continuando...');
        }
        
        // Determinar role baseado na hierarquia
        let role = 'Funcionário';
        if (user.HierarchyLevel >= 4) role = 'Diretor';
        else if (user.HierarchyLevel >= 3) role = 'Gerente';
        else if (user.HierarchyLevel >= 2) role = 'Coordenador';
        else if (user.HierarchyLevel >= 1) role = 'Supervisor';
        
        // Criar sessão com informações de hierarquia
        const nomeCompletoSessao = user.NomeCompleto || funcionario.NOME || 'Funcionário';
        const nomeSessao = user.nome || (user.NomeCompleto ? user.NomeCompleto.split(' ')[0] : (funcionario.NOME ? funcionario.NOME.split(' ')[0] : user.Matricula));
        
        req.session.user = {
            userId: user.userId,
            userName: user.UserName || `user_${user.Matricula}`,
            role: role,
            nomeCompleto: nomeCompletoSessao,
            nome: nomeSessao,
            Departamento: user.Departamento || 'Funcionário',
            departamento: user.Departamento || 'Funcionário',
            filial: user.Filial || funcionario.FILIAL, // Adicionar filial do usuário
            Filial: user.Filial || funcionario.FILIAL,
            CPF: cpfFormatado,
            cpf: cpfFormatado,
            Matricula: user.Matricula,
            matricula: user.Matricula,
            NomeCompleto: nomeCompletoSessao,
            HierarchyLevel: user.HierarchyLevel,
            hierarchyLevel: user.HierarchyLevel,
            HierarchyPath: user.HierarchyPath,
            hierarchyPath: user.HierarchyPath,
            isFirstAccess: false
        };

        res.json(req.session.user);
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/api/usuario', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Usuário não autenticado' });
    }
});

// API para retornar permissões de acesso às abas
app.get('/api/usuario/permissions', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const permissions = await getUserTabPermissions(user);
        
        console.log(`📋 Retornando permissões para ${user.nomeCompleto || user.NomeCompleto}:`);
        console.log(`   - Histórico: ${permissions.historico ? '✅ PERMITIDO' : '❌ BLOQUEADO'}`);
        console.log(`   - isFullAccess: ${permissions.isFullAccess}`);
        console.log(`   - isManager: ${permissions.isManager}`);
        
        res.json({
            success: true,
            permissions: {
                dashboard: permissions.dashboard,
                feedbacks: permissions.feedbacks,
                recognitions: permissions.recognitions,
                humor: permissions.humor,
                objetivos: permissions.objetivos,
                pesquisas: permissions.pesquisas,
                avaliacoes: permissions.avaliacoes,
                team: permissions.team,
                analytics: permissions.analytics,
                historico: permissions.historico
            },
            user: {
                nome: user.nomeCompleto || user.NomeCompleto,
                departamento: user.Departamento,
                hierarchyLevel: user.HierarchyLevel,
                cpf: user.CPF
            },
            hierarchy: {
                isManager: permissions.isManager,
                isFullAccess: permissions.isFullAccess,
                managerType: permissions.managerType,
                hierarchyLevel: permissions.hierarchyLevel,
                managedDepartments: permissions.managedDepartments,
                hierarchyPaths: permissions.hierarchyPaths
            }
        });
    } catch (error) {
        console.error('Erro ao buscar permissões:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API de debug para verificar se usuário é gestor
app.get('/api/debug/manager-check', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se usuário é gestor
        const isManager = await isUserManager(user);
        const hierarchyInfo = isManager ? await getUserHierarchyInfo(user) : [];
        const permissions = await getUserTabPermissions(user);
        
        // Verificar departamento do usuário
        const userResult = await pool.request()
            .input('cpf', sql.VarChar, user.CPF)
            .query(`
                SELECT Departamento, DescricaoDepartamento, HierarchyPath, Filial
                FROM Users 
                WHERE CPF = @cpf
            `);
        
        // Buscar subordinados diretos
        const subordinatesResult = await pool.request()
            .input('departamento', sql.VarChar, user.Departamento)
            .query(`
                SELECT COUNT(*) as count
                FROM Users 
                WHERE Departamento IN (
                    SELECT DEPTO_ATUAL 
                    FROM HIERARQUIA_CC 
                    WHERE HIERARQUIA_COMPLETA LIKE '%' + @departamento + '%'
                )
                AND IsActive = 1
            `);
        
        res.json({
            success: true,
            user: {
                nome: user.nomeCompleto || user.NomeCompleto,
                cpf: user.CPF,
                departamento: user.Departamento,
                hierarchyPath: user.HierarchyPath,
                filial: user.Filial
            },
            isManager: isManager,
            hierarchyInfo: hierarchyInfo,
            permissions: permissions,
            userRecords: userResult.recordset,
            subordinatesCount: subordinatesResult.recordset[0].count,
            debug: {
                cpfUsed: user.CPF,
                departamentoUsado: user.Departamento,
                totalDepartamentosGerenciados: hierarchyInfo.length
            }
        });
    } catch (error) {
        console.error('Erro no debug de gestor:', error);
        res.status(500).json({ error: 'Erro interno do servidor', details: error.message });
    }
});

// Endpoint para corrigir troca de matrícula
app.post('/api/fix-matricula-change', requireAuth, async (req, res) => {
    try {
        const { cpf } = req.body;
        
        if (!cpf) {
            return res.status(400).json({ error: 'CPF é obrigatório' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Buscar funcionário na TAB_HIST_SRA
        const funcionarioResult = await pool.request()
            .input('cpf', sql.VarChar, cpf.replace(/[^\d]/g, ''))
            .query(`
                WITH FuncionarioMaisRecente AS (
                    SELECT 
                        MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, 
                        DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL, DTA_ADMISSAO,
                        ROW_NUMBER() OVER (ORDER BY 
                            CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                            CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                            DTA_ADMISSAO DESC, 
                            MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA 
                    WHERE CPF = @cpf
                )
                SELECT TOP 1 MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL
                FROM FuncionarioMaisRecente
                WHERE rn = 1
            `);
        
        if (funcionarioResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Funcionário não encontrado' });
        }
        
        const funcionario = funcionarioResult.recordset[0];
        
        // Buscar usuário no sistema
        const userResult = await pool.request()
            .input('cpf', sql.VarChar, cpf)
            .query('SELECT Id, Matricula, IsActive FROM Users WHERE CPF = @cpf');
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado no sistema' });
        }
        
        const user = userResult.recordset[0];
        
        // Verificar se houve mudança de matrícula
        const matriculaChanged = user.Matricula !== funcionario.MATRICULA;
        
        if (matriculaChanged && funcionario.STATUS_GERAL === 'ATIVO') {
            // Reativar usuário e atualizar matrícula
            await pool.request()
                .input('userId', sql.Int, user.Id)
                .input('novaMatricula', sql.VarChar, funcionario.MATRICULA)
                .input('nomeCompleto', sql.VarChar, funcionario.NOME)
                .input('departamento', sql.VarChar, funcionario.DEPARTAMENTO)
                .input('unidade', sql.VarChar, funcionario.FILIAL)
                .query(`
                    UPDATE Users 
                    SET Matricula = @novaMatricula,
                        NomeCompleto = @nomeCompleto,
                        Departamento = @departamento,
                        Unidade = @unidade,
                        IsActive = 1,
                        updated_at = GETDATE()
                    WHERE Id = @userId
                `);
            
            res.json({ 
                success: true, 
                message: `Usuário reativado com nova matrícula: ${funcionario.MATRICULA}`,
                oldMatricula: user.Matricula,
                newMatricula: funcionario.MATRICULA
            });
        } else {
            res.json({ 
                success: false, 
                message: 'Nenhuma alteração necessária',
                matriculaChanged: matriculaChanged,
                status: funcionario.STATUS_GERAL
            });
        }
    } catch (error) {
        console.error('Erro ao corrigir troca de matrícula:', error);
        res.status(500).json({ error: error.message });
    }
});

// Logout route
app.post('/api/logout', requireAuth, async (req, res) => {
    try {
        console.log('🚪 Processando logout para usuário:', req.session.user.userId);
        
        // Destruir a sessão COMPLETAMENTE
        req.session.destroy((err) => {
            if (err) {
                console.error('Erro ao destruir sessão:', err);
                return res.status(500).json({ error: 'Erro ao fazer logout' });
            }
            
            // Limpar TODOS os cookies possíveis
            res.clearCookie('lumigente.sid', { path: '/' });
            res.clearCookie('connect.sid', { path: '/' });
            res.clearCookie('session', { path: '/' });
            
            // Headers adicionais para garantir que não seja cacheado
            res.set({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            
            console.log('✅ Logout realizado com sucesso - sessão destruída');
            res.json({ success: true, message: 'Logout realizado com sucesso' });
        });
    } catch (error) {
        console.error('Erro no logout:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// API routes
app.get('/api/metrics', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Feedbacks RECEBIDOS pelo usuário no último mês
        const feedbacksResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE to_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Reconhecimentos RECEBIDOS pelo usuário no último mês
        const recognitionsResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Recognitions 
                WHERE to_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Feedbacks ENVIADOS pelo usuário (para participação)
        const sentFeedbacksResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE from_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Pontuação média dos feedbacks RECEBIDOS
        const avgScoreResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT AVG(CASE 
                    WHEN type = 'Positivo' THEN 10.0 
                    WHEN type = 'Desenvolvimento' THEN 7.0 
                    ELSE 8.0 
                END) as avg_score 
                FROM Feedbacks
                WHERE to_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);

        const feedbacksReceived = feedbacksResult.recordset[0].count || 0;
        const recognitionsReceived = recognitionsResult.recordset[0].count || 0;
        const feedbacksSent = sentFeedbacksResult.recordset[0].count || 0;
        const avgScore = (avgScoreResult.recordset[0].avg_score || 7.0);

        // Indicadores de comparação removidos - apenas números principais são retornados
        res.json({
            feedbacksReceived,
            recognitionsReceived,
            feedbacksSent,
            avgScore: avgScore.toFixed(1)
        });
    } catch (error) {
        console.error('Erro ao buscar métricas:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas' });
    }
});

// Buscar usuários baseado na hierarquia
app.get('/api/users', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        const currentUser = req.session.user;
        const { search, department, hierarchyLevel } = req.query;
        
        // Usar HierarchyManager para buscar usuários acessíveis na hierarquia
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            search,
            department,
            hierarchyLevel: hierarchyLevel ? parseInt(hierarchyLevel) : null
        });
        
        res.json(accessibleUsers);
    } catch (error) {
        console.error('Erro ao buscar usuários:', error);
        res.status(500).json({ error: 'Erro ao buscar usuários' });
    }
});

// Buscar hierarquia do usuário atual
app.get('/api/hierarchy', requireAuth, async (req, res) => {
    try {
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('matricula', sql.VarChar, currentUser.matricula)
            .query(`
                SELECT 
                    NIVEL_1_DIRETORIA, NIVEL_1_DIRETORIA_DESC, NIVEL_1_MATRICULA_RESP,
                    NIVEL_2_GERENCIA, NIVEL_2_GERENCIA_DESC, NIVEL_2_MATRICULA_RESP,
                    NIVEL_3_COORDENACAO, NIVEL_3_COORDENACAO_DESC, NIVEL_3_MATRICULA_RESP,
                    NIVEL_4_DEPARTAMENTO, NIVEL_4_DEPARTAMENTO_DESC, NIVEL_4_MATRICULA_RESP,
                    DEPTO_ATUAL, DESCRICAO_ATUAL, RESPONSAVEL_ATUAL, FILIAL, HIERARQUIA_COMPLETA
                FROM HIERARQUIA_CC 
                WHERE RESPONSAVEL_ATUAL = @matricula
                ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar hierarquia:', error);
        res.status(500).json({ error: 'Erro ao buscar hierarquia' });
    }
});

// Buscar subordinados do usuário atual
app.get('/api/subordinates', requireAuth, async (req, res) => {
    try {
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // CORREÇÃO: Buscar funcionários que têm o usuário atual como responsável
        // Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF) para evitar confusão com matrículas duplicadas
        const result = await pool.request()
            .input('matricula', sql.VarChar, currentUser.matricula)
            .input('cpf', sql.VarChar, currentUser.cpf)  // ✅ Adicionar CPF para validação
            .query(`
                SELECT 
                    u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath,
                    u.Matricula, u.CPF, u.LastLogin
                FROM Users u
                JOIN HIERARQUIA_CC h 
                    ON u.Matricula = h.RESPONSAVEL_ATUAL
                    AND u.CPF = h.CPF_RESPONSAVEL  -- ✅ Chave composta: MATRÍCULA + CPF
                WHERE h.RESPONSAVEL_ATUAL = @matricula
                    AND h.CPF_RESPONSAVEL = @cpf  -- ✅ Validar CPF do gestor
                    AND u.IsActive = 1
                ORDER BY u.NomeCompleto
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar subordinados:', error);
        res.status(500).json({ error: 'Erro ao buscar subordinados' });
    }
});

// Feedbacks recebidos pelo usuário
app.get('/api/feedbacks/received', requireAuth, async (req, res) => {
    try {
        const { search, type, category } = req.query;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT f.*, 
                   u1.NomeCompleto as from_name, u1.Departamento as from_dept,
                   u2.NomeCompleto as to_name, u2.Departamento as to_dept,
                   (SELECT COUNT(*) FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id AND fr.reaction_type = 'useful') as useful_count,
                   (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count,
                   CASE WHEN EXISTS(SELECT 1 FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id AND fr.reaction_type = 'viewed') THEN 1 ELSE 0 END as has_reactions,
                   CASE WHEN EXISTS(
                       SELECT 1 FROM Gamification g 
                       WHERE g.UserId = @userId 
                       AND g.Action = 'feedback_respondido' 
                       AND CAST(g.CreatedAt AS DATE) = CAST(f.created_at AS DATE)
                       AND EXISTS(SELECT 1 FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id AND fr.user_id = @userId)
                   ) THEN 1 ELSE 0 END as earned_points
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE f.to_user_id = @userId
        `;
        
        const request = pool.request().input('userId', sql.Int, userId);
        
        if (search) {
            query += " AND (f.message LIKE @search OR u1.NomeCompleto LIKE @search)";
            request.input('search', sql.VarChar, `%${search}%`);
        }
        
        if (type) {
            query += " AND f.type = @type";
            request.input('type', sql.VarChar, type);
        }
        
        if (category) {
            query += " AND f.category = @category";
            request.input('category', sql.VarChar, category);
        }
        
        query += " ORDER BY f.created_at DESC";
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar feedbacks recebidos:', error);
        res.status(500).json({ error: 'Erro ao buscar feedbacks recebidos' });
    }
});

// Feedbacks enviados pelo usuário
app.get('/api/feedbacks/sent', requireAuth, async (req, res) => {
    try {
        const { search, type, category } = req.query;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT f.*, 
                   u1.NomeCompleto as from_name, u1.Departamento as from_dept,
                   u2.NomeCompleto as to_name, u2.Departamento as to_dept,
                   (SELECT COUNT(*) FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id AND fr.reaction_type = 'useful') as useful_count,
                   (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count,
                   CASE WHEN EXISTS(SELECT 1 FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id AND fr.reaction_type = 'viewed') THEN 1 ELSE 0 END as has_reactions,
                   CASE WHEN f.created_at = (
                       SELECT MIN(f2.created_at) 
                       FROM Feedbacks f2 
                       WHERE f2.from_user_id = @userId 
                       AND CAST(f2.created_at AS DATE) = CAST(f.created_at AS DATE)
                   ) THEN 1 ELSE 0 END as earned_points
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE f.from_user_id = @userId
        `;
        
        const request = pool.request().input('userId', sql.Int, userId);
        
        if (search) {
            query += " AND (f.message LIKE @search OR u2.NomeCompleto LIKE @search)";
            request.input('search', sql.VarChar, `%${search}%`);
        }
        
        if (type) {
            query += " AND f.type = @type";
            request.input('type', sql.VarChar, type);
        }
        
        if (category) {
            query += " AND f.category = @category";
            request.input('category', sql.VarChar, category);
        }
        
        query += " ORDER BY f.created_at DESC";
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar feedbacks enviados:', error);
        res.status(500).json({ error: 'Erro ao buscar feedbacks enviados' });
    }
});

// Mantém rota para compatibilidade (agora retorna feedbacks recebidos)
app.get('/api/feedbacks', requireAuth, async (req, res) => {
    // Redireciona para feedbacks recebidos
    const { search, type, category } = req.query;
    const userId = req.session.user.userId;
    const pool = await sql.connect(dbConfig);
    
    let query = `
        SELECT f.*, 
               u1.NomeCompleto as from_name, u1.Departamento as from_dept,
               u2.NomeCompleto as to_name, u2.Departamento as to_dept,
               (SELECT COUNT(*) FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id AND fr.reaction_type = 'useful') as useful_count,
               (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count,
               CASE WHEN EXISTS(SELECT 1 FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id) THEN 1 ELSE 0 END as has_reactions
        FROM Feedbacks f
        JOIN Users u1 ON f.from_user_id = u1.Id
        JOIN Users u2 ON f.to_user_id = u2.Id
        WHERE f.to_user_id = @userId
    `;
    
    const request = pool.request().input('userId', sql.Int, userId);
    
    if (search) {
        query += " AND (f.message LIKE @search OR u1.NomeCompleto LIKE @search)";
        request.input('search', sql.VarChar, `%${search}%`);
    }
    
    if (type) {
        query += " AND f.type = @type";
        request.input('type', sql.VarChar, type);
    }
    
    if (category) {
        query += " AND f.category = @category";
        request.input('category', sql.VarChar, category);
    }
    
    query += " ORDER BY f.created_at DESC";
    
    try {
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar feedbacks:', error);
        res.status(500).json({ error: 'Erro ao buscar feedbacks' });
    }
});

app.post('/api/feedbacks', requireAuth, async (req, res) => {
    try {
        const { to_user_id, type, category, message } = req.body;
        const from_user_id = req.session.user.userId;
        
        if (!to_user_id || !type || !category || !message) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('from_user_id', sql.Int, from_user_id)
            .input('to_user_id', sql.Int, to_user_id)
            .input('type', sql.VarChar, type)
            .input('category', sql.VarChar, category)
            .input('message', sql.Text, message)
            .query(`
                INSERT INTO Feedbacks (from_user_id, to_user_id, type, category, message, created_at)
                OUTPUT INSERTED.Id
                VALUES (@from_user_id, @to_user_id, @type, @category, @message, GETDATE())
            `);

        // Adicionar pontos por enviar feedback (primeira vez no dia)
        const pointsResult = await addPointsToUser(from_user_id, 'feedback_enviado', 10, pool);
        
        res.json({ 
            success: true, 
            id: result.recordset[0].Id,
            pointsEarned: pointsResult.success ? pointsResult.points : 0,
            pointsMessage: pointsResult.message
        });
    } catch (error) {
        console.error('Erro ao criar feedback:', error);
        res.status(500).json({ error: 'Erro ao criar feedback' });
    }
});

// Reconhecimentos recebidos pelo usuário (para dashboard)
app.get('/api/recognitions', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT r.*, 
                       u1.NomeCompleto as from_name,
                       u2.NomeCompleto as to_name
                FROM Recognitions r
                JOIN Users u1 ON r.from_user_id = u1.Id
                JOIN Users u2 ON r.to_user_id = u2.Id
                WHERE r.to_user_id = @userId
                ORDER BY r.created_at DESC
            `);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar reconhecimentos recebidos:', error);
        res.status(500).json({ error: 'Erro ao buscar reconhecimentos recebidos' });
    }
});

// Reconhecimentos dados pelo usuário (para aba reconhecimentos)
app.get('/api/recognitions/given', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT r.*, 
                       u1.NomeCompleto as from_name,
                       u2.NomeCompleto as to_name
                FROM Recognitions r
                JOIN Users u1 ON r.from_user_id = u1.Id
                JOIN Users u2 ON r.to_user_id = u2.Id
                WHERE r.from_user_id = @userId
                ORDER BY r.created_at DESC
            `);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar reconhecimentos dados:', error);
        res.status(500).json({ error: 'Erro ao buscar reconhecimentos dados' });
    }
});

// Todos os reconhecimentos do usuário (recebidos + dados)
app.get('/api/recognitions/all', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Reconhecimentos recebidos
        const receivedResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT r.*, 
                       u1.NomeCompleto as from_name,
                       u2.NomeCompleto as to_name,
                       'received' as direction,
                       CASE WHEN r.created_at = (
                           SELECT MIN(r2.created_at) 
                           FROM Recognitions r2 
                           WHERE r2.to_user_id = @userId 
                           AND CAST(r2.created_at AS DATE) = CAST(r.created_at AS DATE)
                       ) THEN 1 ELSE 0 END as earned_points
                FROM Recognitions r
                JOIN Users u1 ON r.from_user_id = u1.Id
                JOIN Users u2 ON r.to_user_id = u2.Id
                WHERE r.to_user_id = @userId
            `);
        
        // Reconhecimentos dados
        const givenResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT r.*, 
                       u1.NomeCompleto as from_name,
                       u2.NomeCompleto as to_name,
                       'given' as direction,
                       CASE WHEN r.created_at = (
                           SELECT MIN(r2.created_at) 
                           FROM Recognitions r2 
                           WHERE r2.from_user_id = @userId 
                           AND CAST(r2.created_at AS DATE) = CAST(r.created_at AS DATE)
                       ) THEN 1 ELSE 0 END as earned_points
                FROM Recognitions r
                JOIN Users u1 ON r.from_user_id = u1.Id
                JOIN Users u2 ON r.to_user_id = u2.Id
                WHERE r.from_user_id = @userId
            `);
        
        // Combinar e ordenar por data
        const allRecognitions = [
            ...receivedResult.recordset,
            ...givenResult.recordset
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        console.log('Reconhecimentos encontrados:', allRecognitions.length);
        console.log('Primeiro reconhecimento:', allRecognitions[0]);
        
        res.json(allRecognitions);
    } catch (error) {
        console.error('Erro ao buscar todos os reconhecimentos:', error);
        res.status(500).json({ error: 'Erro ao buscar reconhecimentos' });
    }
});

app.post('/api/recognitions', requireAuth, async (req, res) => {
    try {
        const { to_user_id, badge, message } = req.body;
        const from_user_id = req.session.user.userId;
        
        if (!to_user_id || !badge || !message) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        const points = 5; // Sempre 5 pontos para reconhecimentos

        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('from_user_id', sql.Int, from_user_id)
            .input('to_user_id', sql.Int, to_user_id)
            .input('badge', sql.VarChar, badge)
            .input('message', sql.Text, message)
            .input('points', sql.Int, points)
            .query(`
                INSERT INTO Recognitions (from_user_id, to_user_id, badge, message, points, created_at)
                OUTPUT INSERTED.Id
                VALUES (@from_user_id, @to_user_id, @badge, @message, @points, GETDATE())
            `);

        // Adicionar pontos por enviar reconhecimento (primeira vez no dia)
        const pointsResult = await addPointsToUser(from_user_id, 'reconhecimento_enviado', 5, pool);
        
        // Adicionar pontos para quem recebeu o reconhecimento (primeira vez no dia)
        const pointsResultReceived = await addPointsToUser(to_user_id, 'reconhecimento_recebido', 5, pool);
        
        res.json({ 
            success: true, 
            id: result.recordset[0].Id,
            pointsEarned: pointsResult.success ? pointsResult.points : 0,
            pointsMessage: pointsResult.message,
            pointsEarnedReceived: pointsResultReceived.success ? pointsResultReceived.points : 0,
            pointsMessageReceived: pointsResultReceived.message
        });
    } catch (error) {
        console.error('Erro ao criar reconhecimento:', error);
        res.status(500).json({ error: 'Erro ao criar reconhecimento' });
    }
});

// Reações aos feedbacks
app.post('/api/feedbacks/:id/react', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { reaction } = req.body;
        const userId = req.session.user.userId;
        
        if (!['useful', 'like', 'dislike'].includes(reaction)) {
            return res.status(400).json({ error: 'Tipo de reação inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se já reagiu
        const existingReaction = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('reaction', sql.VarChar, reaction)
            .query(`
                SELECT Id FROM FeedbackReactions 
                WHERE feedback_id = @feedbackId AND user_id = @userId AND reaction_type = @reaction
            `);
        
        if (existingReaction.recordset.length > 0) {
            // Remover reação existente
            await pool.request()
                .input('feedbackId', sql.Int, id)
                .input('userId', sql.Int, userId)
                .input('reaction', sql.VarChar, reaction)
                .query(`
                    DELETE FROM FeedbackReactions 
                    WHERE feedback_id = @feedbackId AND user_id = @userId AND reaction_type = @reaction
                `);
            
            res.json({ success: true, action: 'removed' });
        } else {
            // Adicionar nova reação
            await pool.request()
                .input('feedbackId', sql.Int, id)
                .input('userId', sql.Int, userId)
                .input('reaction', sql.VarChar, reaction)
                .query(`
                    INSERT INTO FeedbackReactions (feedback_id, user_id, reaction_type)
                    VALUES (@feedbackId, @userId, @reaction)
                `);
            
            res.json({ success: true, action: 'added' });
        }
    } catch (error) {
        console.error('Erro ao reagir ao feedback:', error);
        res.status(500).json({ error: 'Erro ao reagir ao feedback' });
    }
});

// ===== SISTEMA DE THREADS PARA FEEDBACKS =====

// Configurar estrutura de threads no banco
app.post('/api/feedbacks/setup-threads', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Executar configurações de thread
        await pool.request().query(`
            -- Adicionar colunas para threads se não existirem
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'parent_reply_id')
            BEGIN
                ALTER TABLE FeedbackReplies ADD parent_reply_id INT NULL;
                PRINT 'Coluna parent_reply_id adicionada';
            END
            
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'mentioned_reply_id')
            BEGIN
                ALTER TABLE FeedbackReplies ADD mentioned_reply_id INT NULL;
                PRINT 'Coluna mentioned_reply_id adicionada';
            END
            
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'message_type')
            BEGIN
                ALTER TABLE FeedbackReplies ADD message_type VARCHAR(20) DEFAULT 'text';
                PRINT 'Coluna message_type adicionada';
            END
            
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'mention_data')
            BEGIN
                ALTER TABLE FeedbackReplies ADD mention_data NTEXT NULL;
                PRINT 'Coluna mention_data adicionada';
            END
            
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'thread_level')
            BEGIN
                ALTER TABLE FeedbackReplies ADD thread_level INT DEFAULT 0;
                PRINT 'Coluna thread_level adicionada';
            END
        `);
        
        // Criar tabela de reações se não existir
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'FeedbackReplyReactions')
            BEGIN
                CREATE TABLE FeedbackReplyReactions (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    reply_id INT NOT NULL,
                    user_id INT NOT NULL,
                    emoji VARCHAR(10) NOT NULL,
                    created_at DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (reply_id) REFERENCES FeedbackReplies(Id),
                    FOREIGN KEY (user_id) REFERENCES Users(Id)
                );
                PRINT 'Tabela FeedbackReplyReactions criada';
            END
        `);
        
        // Adicionar índices para melhor performance
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_FeedbackReplies_parent_reply_id')
            BEGIN
                CREATE INDEX IX_FeedbackReplies_parent_reply_id ON FeedbackReplies(parent_reply_id);
                PRINT 'Índice IX_FeedbackReplies_parent_reply_id criado';
            END
            
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_FeedbackReplies_mentioned_reply_id')
            BEGIN
                CREATE INDEX IX_FeedbackReplies_mentioned_reply_id ON FeedbackReplies(mentioned_reply_id);
                PRINT 'Índice IX_FeedbackReplies_mentioned_reply_id criado';
            END
            
            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_FeedbackReplyReactions_reply_id')
            BEGIN
                CREATE INDEX IX_FeedbackReplyReactions_reply_id ON FeedbackReplyReactions(reply_id);
                PRINT 'Índice IX_FeedbackReplyReactions_reply_id criado';
            END
        `);
        
        res.json({ success: true, message: 'Sistema de threads configurado com sucesso! Todas as colunas e tabelas necessárias foram criadas.' });
    } catch (error) {
        console.error('Erro ao configurar threads:', error);
        res.status(500).json({ error: 'Erro ao configurar threads: ' + error.message });
    }
});

// Buscar thread completa de um feedback
app.get('/api/feedbacks/:id/thread', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT fr.Id, fr.message, fr.user_id, fr.created_at, fr.parent_reply_id, fr.mentioned_reply_id,
                       u.NomeCompleto as user_name
                FROM FeedbackReplies fr
                JOIN Users u ON fr.user_id = u.Id
                WHERE fr.feedback_id = @feedbackId
                ORDER BY fr.created_at ASC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar thread:', error);
        res.status(500).json({ error: 'Erro ao buscar thread' });
    }
});

// Enviar resposta na thread
app.post('/api/feedbacks/:id/thread/reply', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { message, parentReplyId, mentionedReplyId } = req.body;
        const userId = req.session.user.userId;
        
        if (!message) {
            return res.status(400).json({ error: 'Mensagem é obrigatória' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('message', sql.Text, message)
            .input('parentReplyId', sql.Int, parentReplyId || null)
            .input('mentionedReplyId', sql.Int, mentionedReplyId || null)
            .query(`
                INSERT INTO FeedbackReplies (feedback_id, user_id, message, parent_reply_id, mentioned_reply_id, created_at)
                OUTPUT INSERTED.Id, INSERTED.message, INSERTED.user_id, INSERTED.created_at
                VALUES (@feedbackId, @userId, @message, @parentReplyId, @mentionedReplyId, GETDATE())
            `);
        
        const newReply = result.recordset[0];
        
        // Buscar nome do usuário
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query('SELECT NomeCompleto FROM Users WHERE Id = @userId');
        
        newReply.user_name = userResult.recordset[0].NomeCompleto;
        
        res.json({ success: true, reply: newReply });
    } catch (error) {
        console.error('Erro ao enviar resposta:', error);
        res.status(500).json({ error: 'Erro ao enviar resposta' });
    }
});

// Reagir a uma mensagem
app.post('/api/feedbacks/:feedbackId/messages/:messageId/react', requireAuth, async (req, res) => {
    try {
        const { feedbackId, messageId } = req.params;
        const messageIdInt = parseInt(messageId);
        
        if (!messageIdInt || isNaN(messageIdInt) || messageIdInt <= 0) {
            return res.status(400).json({ error: 'ID da mensagem inválido' });
        }
        
        const { emoji } = req.body;
        const userId = req.session.user.userId;
        
        if (!emoji || typeof emoji !== 'string') {
            return res.status(400).json({ error: 'Emoji é obrigatório' });
        }
        
        console.log('Reagindo à mensagem:', messageId, 'Emoji:', emoji);
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se já reagiu com este emoji
        const existing = await pool.request()
            .input('replyId', sql.Int, messageIdInt)
            .input('userId', sql.Int, userId)
            .input('emoji', sql.NVarChar, emoji)
            .query(`
                SELECT Id FROM FeedbackReplyReactions 
                WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji
            `);
        
        if (existing.recordset.length > 0) {
            // Remover reação
            await pool.request()
                .input('replyId', sql.Int, messageIdInt)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.NVarChar, emoji)
                .query(`
                    DELETE FROM FeedbackReplyReactions 
                    WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji
                `);
        } else {
            // Adicionar reação
            await pool.request()
                .input('replyId', sql.Int, messageIdInt)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.NVarChar, emoji)
                .query(`
                    INSERT INTO FeedbackReplyReactions (reply_id, user_id, emoji)
                    VALUES (@replyId, @userId, @emoji)
                `);
        }
        
        // Buscar reações atualizadas
        const reactionsResult = await pool.request()
            .input('replyId', sql.Int, messageIdInt)
            .query(`
                SELECT 
                    frr.emoji,
                    frr.user_id,
                    u.nome as user_name
                FROM FeedbackReplyReactions frr
                LEFT JOIN Users u ON frr.user_id = u.Id
                WHERE frr.reply_id = @replyId
            `);
        
        res.json({ 
            success: true, 
            action: existing.recordset.length > 0 ? 'removed' : 'added',
            messageId: messageIdInt,
            reactions: reactionsResult.recordset
        });
    } catch (error) {
        console.error('Erro ao reagir:', error);
        res.status(500).json({ error: 'Erro ao reagir' });
    }
});

// Buscar thread completa de um feedback
app.get('/api/feedbacks/:id/thread', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT 
                    fr.Id,
                    fr.feedback_id,
                    fr.user_id,
                    fr.reply_text as message,
                    fr.created_at,
                    0 as parent_reply_id,
                    0 as mentioned_reply_id,
                    'text' as message_type,
                    NULL as mention_data,
                    0 as thread_level,
                    COALESCE(u.NomeCompleto, 'Usuário') as user_name,
                    u.nome as user_first_name,
                    NULL as mentioned_text,
                    NULL as mentioned_user_name
                FROM FeedbackReplies fr
                LEFT JOIN Users u ON fr.user_id = u.Id
                WHERE fr.feedback_id = @feedbackId
                ORDER BY fr.created_at ASC
            `);
        
        // Organizar em estrutura de thread
        const messages = result.recordset;
        const threadMap = new Map();
        const rootMessages = [];
        
        // Criar mapa de todas as mensagens
        messages.forEach(msg => {
            msg.replies = [];
            msg.reactions = [];
            threadMap.set(msg.Id, msg);
        });
        
        // Organizar hierarquia
        messages.forEach(msg => {
            if (msg.parent_reply_id && msg.parent_reply_id > 0) {
                const parent = threadMap.get(msg.parent_reply_id);
                if (parent) {
                    parent.replies.push(msg);
                }
            } else {
                rootMessages.push(msg);
            }
        });
        
        res.json(rootMessages);
    } catch (error) {
        console.error('Erro ao buscar thread:', error);
        res.status(500).json({ error: 'Erro ao buscar thread' });
    }
});

// Enviar mensagem na thread
app.post('/api/feedbacks/:id/thread/reply', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { message, parentReplyId, mentionedReplyId, messageType = 'text', mentionData } = req.body;
        const userId = req.session.user.userId;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Mensagem é obrigatória' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Calcular nível da thread
        let threadLevel = 0;
        if (parentReplyId) {
            const parentResult = await pool.request()
                .input('parentId', sql.Int, parentReplyId)
                .query('SELECT ISNULL(thread_level, 0) as thread_level FROM FeedbackReplies WHERE Id = @parentId');
            
            if (parentResult.recordset.length > 0) {
                threadLevel = parentResult.recordset[0].thread_level + 1;
            }
        }
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('message', sql.NVarChar(sql.MAX), message.trim())
            .query(`
                INSERT INTO FeedbackReplies (feedback_id, user_id, reply_text)
                OUTPUT INSERTED.Id, INSERTED.created_at
                VALUES (@feedbackId, @userId, @message)
            `);
        
        const newReply = result.recordset[0];
        
        // Buscar dados completos da nova mensagem
        const fullReplyResult = await pool.request()
            .input('replyId', sql.Int, newReply.Id)
            .query(`
                SELECT 
                    fr.Id,
                    fr.feedback_id,
                    fr.user_id,
                    fr.reply_text as message,
                    fr.created_at,
                    0 as parent_reply_id,
                    0 as mentioned_reply_id,
                    'text' as message_type,
                    NULL as mention_data,
                    0 as thread_level,
                    COALESCE(u.NomeCompleto, 'Usuário') as user_name,
                    u.nome as user_first_name,
                    NULL as mentioned_text,
                    NULL as mentioned_user_name
                FROM FeedbackReplies fr
                LEFT JOIN Users u ON fr.user_id = u.Id
                WHERE fr.Id = @replyId
            `);
        
        const fullReply = fullReplyResult.recordset[0];
        fullReply.replies = [];
        fullReply.reactions = [];
        
        res.json({ success: true, reply: fullReply });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

// Reagir com emoji a uma mensagem
app.post('/api/feedbacks/replies/:replyId/react', requireAuth, async (req, res) => {
    try {
        const { replyId } = req.params;
        const { emoji } = req.body;
        const userId = req.session.user.userId;
        
        if (!emoji) {
            return res.status(400).json({ error: 'Emoji é obrigatório' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se já reagiu com este emoji
        const existingReaction = await pool.request()
            .input('replyId', sql.Int, replyId)
            .input('userId', sql.Int, userId)
            .input('emoji', sql.VarChar, emoji)
            .query(`
                SELECT Id FROM FeedbackReplyReactions 
                WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji
            `);
        
        if (existingReaction.recordset.length > 0) {
            // Remover reação existente
            await pool.request()
                .input('replyId', sql.Int, replyId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.VarChar, emoji)
                .query(`
                    DELETE FROM FeedbackReplyReactions 
                    WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji
                `);
            
            res.json({ success: true, action: 'removed', emoji });
        } else {
            // Adicionar nova reação
            await pool.request()
                .input('replyId', sql.Int, replyId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.VarChar, emoji)
                .query(`
                    INSERT INTO FeedbackReplyReactions (reply_id, user_id, emoji)
                    VALUES (@replyId, @userId, @emoji)
                `);
            
            res.json({ success: true, action: 'added', emoji });
        }
    } catch (error) {
        console.error('Erro ao reagir:', error);
        res.status(500).json({ error: 'Erro ao reagir' });
    }
});

// Buscar reações de uma mensagem
app.get('/api/feedbacks/replies/:replyId/reactions', requireAuth, async (req, res) => {
    try {
        const { replyId } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('replyId', sql.Int, replyId)
            .query(`
                SELECT 
                    frr.emoji,
                    COUNT(*) as count,
                    STRING_AGG(u.nome, ', ') as users
                FROM FeedbackReplyReactions frr
                JOIN Users u ON frr.user_id = u.Id
                WHERE frr.reply_id = @replyId
                GROUP BY frr.emoji
                ORDER BY count DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar reações:', error);
        res.status(500).json({ error: 'Erro ao buscar reações' });
    }
});

// Compatibilidade com sistema antigo
app.get('/api/feedbacks/:id/replies', requireAuth, async (req, res) => {
    const { id } = req.params;
    const pool = await sql.connect(dbConfig);
    
    try {
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT 
                    fr.Id,
                    fr.feedback_id,
                    fr.user_id,
                    fr.reply_text as message,
                    fr.created_at,
                    COALESCE(u.NomeCompleto, 'Usuário') as user_name
                FROM FeedbackReplies fr
                LEFT JOIN Users u ON fr.user_id = u.Id
                WHERE fr.feedback_id = @feedbackId
                ORDER BY fr.created_at ASC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar respostas:', error);
        res.status(500).json({ error: 'Erro ao buscar respostas' });
    }
});

app.post('/api/feedbacks/:id/reply', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const userId = req.session.user.userId;
        
        if (!message) {
            return res.status(400).json({ error: 'Mensagem é obrigatória' });
        }
        
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('message', sql.Text, message)
            .query(`
                INSERT INTO FeedbackReplies (feedback_id, user_id, reply_text)
                OUTPUT INSERTED.Id
                VALUES (@feedbackId, @userId, @message)
            `);
        
        res.json({ success: true, id: result.recordset[0].Id });
    } catch (error) {
        console.error('Erro ao responder feedback:', error);
        res.status(500).json({ error: 'Erro ao responder feedback' });
    }
});

// Filtros disponíveis
app.get('/api/filters', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const typesResult = await pool.request().query(`
            SELECT DISTINCT type FROM Feedbacks ORDER BY type
        `);
        
        const categoriesResult = await pool.request().query(`
            SELECT DISTINCT category FROM Feedbacks ORDER BY category
        `);
        
        res.json({
            types: typesResult.recordset.map(r => r.type),
            categories: categoriesResult.recordset.map(r => r.category)
        });
    } catch (error) {
        console.error('Erro ao buscar filtros:', error);
        res.status(500).json({ error: 'Erro ao buscar filtros' });
    }
});

// ===== SISTEMA DE HUMOR DO DIA =====

// Registrar humor do dia
app.post('/api/humor', requireAuth, async (req, res) => {
    try {
        const { score, description } = req.body;
        const userId = req.session.user.userId;
        
        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ error: 'Score deve ser entre 1 e 5' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se já existe registro para hoje
        const existingResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('today', sql.Date, new Date())
            .query(`
                SELECT Id FROM DailyMood 
                WHERE user_id = @userId 
                AND CAST(created_at AS DATE) = @today
            `);
        
        if (existingResult.recordset.length > 0) {
            // Atualizar registro existente
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('score', sql.Int, score)
                .input('description', sql.Text, description || '')
                .input('today', sql.Date, new Date())
                .query(`
                    UPDATE DailyMood 
                    SET score = @score, description = @description, updated_at = GETDATE()
                    WHERE user_id = @userId AND CAST(created_at AS DATE) = @today
                `);
            
            // Retornar com pointsEarned: 0 explicitamente para evitar notificação de pontos
            res.json({ 
                success: true, 
                message: 'Humor atualizado com sucesso',
                pointsEarned: 0
            });
        } else {
            // Criar novo registro
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('score', sql.Int, score)
                .input('description', sql.Text, description || '')
                .query(`
                    INSERT INTO DailyMood (user_id, score, description)
                    VALUES (@userId, @score, @description)
                `);
            
            // Adicionar pontos por responder humor (primeira vez no dia)
            const pointsResult = await addPointsToUser(userId, 'humor_respondido', 5, pool);
            
            res.json({ 
                success: true, 
                message: 'Humor registrado com sucesso',
                pointsEarned: pointsResult.success ? pointsResult.points : 0,
                pointsMessage: pointsResult.message
            });
        }
    } catch (error) {
        console.error('Erro ao registrar humor:', error);
        res.status(500).json({ error: 'Erro ao registrar humor' });
    }
});

// Buscar humor do usuário
app.get('/api/humor', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('today', sql.Date, new Date())
            .query(`
                SELECT score, description, 
                       updated_at as created_at
                FROM DailyMood 
                WHERE user_id = @userId 
                AND CAST(created_at AS DATE) = @today
            `);
        
        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json(null);
        }
    } catch (error) {
        console.error('Erro ao buscar humor:', error);
        res.status(500).json({ error: 'Erro ao buscar humor' });
    }
});

// Buscar métricas da equipe (apenas para gestores e admins)
app.get('/api/humor/team-metrics', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const userDepartment = req.session.user.departamento;
        const pool = await sql.connect(dbConfig);
        
        // CORREÇÃO: Buscar média de humor da equipe nos últimos 7 dias
        // Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF) para garantir dados corretos
        const result = await pool.request()
            .input('managerId', sql.Int, userId)
            .input('department', sql.NVarChar, userDepartment)
            .input('sevenDaysAgo', sql.Date, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            .query(`
                SELECT 
                    AVG(CAST(dm.score AS FLOAT)) as teamAverage,
                    COUNT(DISTINCT dm.user_id) as teamMembers
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                INNER JOIN TAB_HIST_SRA s 
                    ON u.Matricula = s.MATRICULA
                    AND u.CPF = s.CPF  -- ✅ Chave composta: MATRÍCULA + CPF
                INNER JOIN HIERARQUIA_CC h ON (
                    (h.RESPONSAVEL_ATUAL = (SELECT Matricula FROM Users WHERE Id = @managerId)
                     AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_1_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_2_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_3_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_4_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                )
                WHERE u.Departamento = @department
                AND CAST(dm.created_at AS DATE) >= @sevenDaysAgo
                AND u.IsActive = 1
                AND s.STATUS_GERAL = 'ATIVO'
                AND (
                    TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL)
                    OR TRIM(s.DEPARTAMENTO) = TRIM(h.DESCRICAO_ATUAL)
                    OR s.MATRICULA = h.RESPONSAVEL_ATUAL
                )
            `);
        
        const metrics = {
            teamAverage: result.recordset[0].teamAverage || 0,
            teamMembers: result.recordset[0].teamMembers || 0
        };
        
        res.json(metrics);
    } catch (error) {
        console.error('Erro ao buscar métricas da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas da equipe' });
    }
});

// Buscar histórico de humor individual (últimos 5 dias)
app.get('/api/humor/history', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('fiveDaysAgo', sql.Date, new Date(Date.now() - 5 * 24 * 60 * 60 * 1000))
            .query(`
                SELECT score, description, 
                       updated_at as created_at
                FROM DailyMood 
                WHERE user_id = @userId 
                AND CAST(created_at AS DATE) >= @fiveDaysAgo
                ORDER BY created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar histórico de humor:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de humor' });
    }
});

// Buscar histórico de humor da equipe (últimos 5 dias)
app.get('/api/humor/team-history', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const userDepartment = req.session.user.departamento;
        const pool = await sql.connect(dbConfig);
        
        // CORREÇÃO: Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF)
        const result = await pool.request()
            .input('managerId', sql.Int, userId)
            .input('department', sql.NVarChar, userDepartment)
            .input('fiveDaysAgo', sql.Date, new Date(Date.now() - 5 * 24 * 60 * 60 * 1000))
            .query(`
                SELECT 
                    dm.score,
                    dm.description,
                    dm.updated_at as created_at,
                    u.NomeCompleto as user_name,
                    u.Departamento as department
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                INNER JOIN TAB_HIST_SRA s 
                    ON u.Matricula = s.MATRICULA
                    AND u.CPF = s.CPF  -- ✅ Chave composta
                INNER JOIN HIERARQUIA_CC h ON (
                    (h.RESPONSAVEL_ATUAL = (SELECT Matricula FROM Users WHERE Id = @managerId)
                     AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_1_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_2_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_3_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_4_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                )
                WHERE u.Departamento = @department
                AND CAST(dm.created_at AS DATE) >= @fiveDaysAgo
                AND u.IsActive = 1
                AND s.STATUS_GERAL = 'ATIVO'
                AND (
                    TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL)
                    OR TRIM(s.DEPARTAMENTO) = TRIM(h.DESCRICAO_ATUAL)
                    OR s.MATRICULA = h.RESPONSAVEL_ATUAL
                )
                ORDER BY dm.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar histórico da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico da equipe' });
    }
});

// Buscar humor da empresa (apenas para gestores e admins)
app.get('/api/humor/empresa', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { startDate, endDate, department, unit } = req.query;
        const userId = req.session.user.userId;
        const userHierarchy = req.session.user.hierarchyLevel;
        const userDepartment = req.session.user.departamento;
        
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT 
                dm.score,
                dm.description,
                dm.created_at,
                u.NomeCompleto as user_name,
                u.Departamento as department,
                u.Departamento as position
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE 1=1
        `;
        
        const request = pool.request();
        
        // Filtrar por hierarquia - gestores veem apenas sua equipe
        if (userHierarchy < 3) { // Se não for diretor ou superior
            query += " AND u.Departamento = @userDepartment";
            request.input('userDepartment', sql.VarChar, userDepartment);
        }
        
        if (startDate) {
            query += " AND CAST(dm.created_at AS DATE) >= @startDate";
            request.input('startDate', sql.Date, new Date(startDate));
        }
        
        if (endDate) {
            query += " AND CAST(dm.created_at AS DATE) <= @endDate";
            request.input('endDate', sql.Date, new Date(endDate));
        }
        
        if (department) {
            query += " AND u.Departamento = @department";
            request.input('department', sql.VarChar, department);
        }
        
        if (unit) {
            query += " AND u.Unidade = @unit";
            request.input('unit', sql.VarChar, unit);
        }
        
        query += " ORDER BY dm.created_at DESC";
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar humor da empresa:', error);
        res.status(500).json({ error: 'Erro ao buscar humor da empresa' });
    }
});

// Métricas de humor (apenas para gestores e admins)
app.get('/api/humor/metrics', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const userHierarchy = req.session.user.hierarchyLevel;
        const userDepartment = req.session.user.departamento;
        
        const pool = await sql.connect(dbConfig);
        
        // Filtrar por hierarquia
        let departmentFilter = '';
        if (userHierarchy < 3) { // Se não for diretor ou superior
            departmentFilter = "AND u.Departamento = @userDepartment";
        }
        
        // Média geral da empresa hoje (filtrada por hierarquia)
        const todayAvgResult = await pool.request()
            .input('today', sql.Date, new Date())
            .input('userDepartment', sql.VarChar, userDepartment)
            .query(`
                SELECT AVG(CAST(dm.score AS FLOAT)) as avg_score, COUNT(*) as total_count
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                WHERE CAST(dm.created_at AS DATE) = @today ${departmentFilter}
            `);
        
        // Média por departamento (filtrada por hierarquia)
        const deptAvgResult = await pool.request()
            .input('today', sql.Date, new Date())
            .input('userDepartment', sql.VarChar, userDepartment)
            .query(`
                SELECT 
                    u.Departamento,
                    AVG(CAST(dm.score AS FLOAT)) as avg_score,
                    COUNT(*) as count
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                WHERE CAST(dm.created_at AS DATE) = @today ${departmentFilter}
                GROUP BY u.Departamento
                ORDER BY avg_score DESC
            `);
        
        // Histórico dos últimos 7 dias (filtrado por hierarquia)
        const historyResult = await pool.request()
            .input('weekAgo', sql.Date, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
            .input('userDepartment', sql.VarChar, userDepartment)
            .query(`
                SELECT 
                    CAST(dm.created_at AS DATE) as date,
                    AVG(CAST(dm.score AS FLOAT)) as avg_score,
                    COUNT(*) as count
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                WHERE CAST(dm.created_at AS DATE) >= @weekAgo ${departmentFilter}
                GROUP BY CAST(dm.created_at AS DATE)
                ORDER BY date DESC
            `);
        
        res.json({
            today: {
                average: todayAvgResult.recordset[0]?.avg_score || 0,
                total: todayAvgResult.recordset[0]?.total_count || 0
            },
            byDepartment: deptAvgResult.recordset,
            history: historyResult.recordset
        });
    } catch (error) {
        console.error('Erro ao buscar métricas de humor:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas de humor' });
    }
});

// ===== SISTEMA DE OBJETIVOS =====

// Criar objetivo
app.post('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const { titulo, descricao, responsavel_id, responsaveis_ids, data_inicio, data_fim } = req.body;
        const userId = req.session.user.userId;
        
        // Suportar tanto responsavel_id (modo único) quanto responsaveis_ids (modo múltiplo)
        let responsaveis = [];
        if (responsaveis_ids && responsaveis_ids.length > 0) {
            responsaveis = responsaveis_ids;
        } else if (responsavel_id) {
            responsaveis = [responsavel_id];
        } else {
            return res.status(400).json({ error: 'Campos obrigatórios: título, responsável(es), data início e data fim' });
        }
        
        if (!titulo || responsaveis.length === 0 || !data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Campos obrigatórios: título, pelo menos um responsável, data início e data fim' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar permissões para cada responsável
        for (const responsavelId of responsaveis) {
            if (responsavelId != userId) {
                // CORREÇÃO: Verificar se o usuário é gestor e se o responsável está na sua equipe
                // Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF)
                const teamCheck = await pool.request()
                    .input('managerId', sql.Int, userId)
                    .input('responsavelId', sql.Int, responsavelId)
            .query(`
                        SELECT COUNT(*) as count
                        FROM Users u
                        INNER JOIN TAB_HIST_SRA s 
                            ON u.Matricula = s.MATRICULA
                            AND u.CPF = s.CPF  -- ✅ Chave composta
                        INNER JOIN HIERARQUIA_CC h ON (
                            (h.RESPONSAVEL_ATUAL = (SELECT Matricula FROM Users WHERE Id = @managerId)
                             AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                            OR (h.NIVEL_1_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                                AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                            OR (h.NIVEL_2_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                                AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                            OR (h.NIVEL_3_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                                AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                            OR (h.NIVEL_4_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                                AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                        )
                        WHERE u.Id = @responsavelId 
                        AND u.IsActive = 1
                        AND s.STATUS_GERAL = 'ATIVO'
                        AND (
                            TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL)
                            OR TRIM(s.DEPARTAMENTO) = TRIM(h.DESCRICAO_ATUAL)
                            OR s.MATRICULA = h.RESPONSAVEL_ATUAL
                        )
                    `);
                
                if (teamCheck.recordset[0].count === 0) {
                    return res.status(403).json({ error: 'Você só pode criar objetivos para si mesmo ou para membros da sua equipe' });
                }
            }
        }
        
        // Definir status baseado na data de início
        const hoje = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const dataInicioStr = data_inicio.split('T')[0]; // YYYY-MM-DD
        
        const status = dataInicioStr > hoje ? 'Agendado' : 'Ativo';
        
        console.log('Criando objetivo compartilhado:', { titulo, descricao, responsaveis, data_inicio, data_fim, userId, status });
        
        // Criar UM único objetivo
        const objetivoResult = await pool.request()
            .input('titulo', sql.NVarChar(255), titulo)
            .input('descricao', sql.Text, descricao || '')
            .input('dataInicio', sql.Date, data_inicio)
            .input('dataFim', sql.Date, data_fim)
            .input('criadoPor', sql.Int, userId)
            .input('status', sql.NVarChar(50), status)
            .input('primeiroResponsavel', sql.Int, responsaveis[0]) // Primeiro responsável para compatibilidade
            .query(`
                INSERT INTO Objetivos (titulo, descricao, data_inicio, data_fim, criado_por, status, progresso, responsavel_id, created_at, updated_at)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @dataInicio, @dataFim, @criadoPor, @status, 0, @primeiroResponsavel, GETDATE(), GETDATE())
            `);
        
        const objetivoId = objetivoResult.recordset[0].Id;
        
        // Criar relacionamentos para cada responsável
        for (const responsavelId of responsaveis) {
            try {
                await pool.request()
                    .input('objetivoId', sql.Int, objetivoId)
                    .input('responsavelId', sql.Int, responsavelId)
                    .query(`
                        INSERT INTO ObjetivoResponsaveis (objetivo_id, responsavel_id, created_at)
                        VALUES (@objetivoId, @responsavelId, GETDATE())
                    `);
            } catch (foreignKeyError) {
                // Se a tabela ObjetivoResponsaveis não existir ainda, vamos criá-la
                console.log('Tabela ObjetivoResponsaveis ainda não existe, criando...');
                await ensureObjetivosTablesExist(pool);
                
                await pool.request()
                    .input('objetivoId', sql.Int, objetivoId)
                    .input('responsavelId', sql.Int, responsavelId)
                    .query(`
                        INSERT INTO ObjetivoResponsaveis (objetivo_id, responsavel_id, created_at)
                        VALUES (@objetivoId, @responsavelId, GETDATE())
                    `);
            }
        }
        
        res.json({ success: true, id: objetivoId, shared: true, responsaveis: responsaveis });
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        res.status(500).json({ error: 'Erro ao criar objetivo' });
    }
});

// Buscar filtros de objetivos
app.get('/api/objetivos/filtros', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Buscar status únicos
        const statusResult = await pool.request().query(`
            SELECT DISTINCT status FROM Objetivos WHERE status IS NOT NULL ORDER BY status
        `);
        
        // Buscar responsáveis únicos
        const responsaveisResult = await pool.request().query(`
            SELECT DISTINCT u.Id, u.NomeCompleto 
            FROM Objetivos o
            JOIN Users u ON o.responsavel_id = u.Id
            WHERE u.IsActive = 1
            ORDER BY u.NomeCompleto
        `);
        
        res.json({
            status: statusResult.recordset.map(r => r.status),
            responsaveis: responsaveisResult.recordset.map(r => ({
                id: r.Id,
                nome: r.NomeCompleto
            }))
        });
    } catch (error) {
        console.error('Erro ao buscar filtros de objetivos:', error);
        res.status(500).json({ error: 'Erro ao buscar filtros de objetivos' });
    }
});

// Listar objetivos
app.get('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Obter parâmetros de busca e filtros
        const { search, responsavel, status } = req.query;
        
        // Parâmetros de busca recebidos: search (título/descrição) e responsavel (nome)
        
        // Garantir que todas as tabelas existam antes de usar
        await ensureObjetivosTablesExist(pool);
        
        // Primeiro, atualizar status de objetivos expirados
        await pool.request().query(`
            UPDATE Objetivos 
            SET status = 'Expirado' 
            WHERE data_fim < CAST(GETDATE() AS DATE) 
            AND status = 'Ativo'
        `);
        
        // Construir cláusulas de filtro
        let whereConditions = ['(o.responsavel_id = @userId OR o.criado_por = @userId OR orl.responsavel_id = @userId)'];
        
        // Filtro de busca de texto (título ou descrição)
        if (search) {
            whereConditions.push(`(o.titulo LIKE @searchTerm OR o.descricao LIKE @searchTerm)`);
        }
        
        // Filtro de busca por responsável (incluindo responsáveis compartilhados)
        if (responsavel) {
            whereConditions.push(`(
                u.NomeCompleto LIKE @responsavelTerm 
                OR EXISTS (
                    SELECT 1 FROM ObjetivoResponsaveis orresp 
                    INNER JOIN Users uresp ON orresp.responsavel_id = uresp.Id 
                    WHERE orresp.objetivo_id = o.Id 
                    AND uresp.NomeCompleto LIKE @responsavelTerm
                )
            )`);
        }
        
        // Filtro por status dos objetivos
        if (status) {
            whereConditions.push(`o.status = @statusFilter`);
        }
        
        // Buscar objetivos com responsáveis compartilhados
        let query;
        try {
            // Tentar usar a query com ObjetivoResponsaveis
            query = `
                SELECT DISTINCT
                    o.Id, o.titulo, o.data_inicio, o.data_fim, o.status, o.progresso, o.created_at, o.updated_at,
                    o.responsavel_id, o.criado_por,
                    CONVERT(NVARCHAR(MAX), o.descricao) as descricao,
                    u.NomeCompleto as responsavel_nome,
                    c.NomeCompleto as criador_nome,
                    CASE 
                        WHEN o.criado_por = @userId THEN 1 
                        ELSE 0 
                    END as can_edit,
                    CASE 
                        WHEN o.responsavel_id = @userId 
                        OR EXISTS (SELECT 1 FROM ObjetivoResponsaveis oesp WHERE oesp.objetivo_id = o.Id AND oesp.responsavel_id = @userId)
                        THEN 1 
                        ELSE 0 
                    END as is_responsible
                FROM Objetivos o
                LEFT JOIN Users u ON o.responsavel_id = u.Id
                LEFT JOIN Users c ON o.criado_por = c.Id
                LEFT JOIN ObjetivoResponsaveis orl ON orl.objetivo_id = o.Id
                ${whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''}
                ORDER BY o.created_at DESC
            `;
            
            const request = pool.request()
                .input('userId', sql.Int, userId);
            
            // Adicionar parâmetros dinamicamente baseados nos filtros
            if (search) {
                request.input('searchTerm', sql.NVarChar, `%${search}%`);
            }
            if (responsavel) {
                request.input('responsavelTerm', sql.NVarChar, `%${responsavel}%`);
            }
            if (status) {
                request.input('statusFilter', sql.NVarChar, status);
            }
            
            console.log('🔍 Query final construída:', query);
            console.log('🔍 Condições WHERE:', whereConditions);
            
            const result = await request.query(query);
            
            // Buscar responsáveis compartilhados para cada objetivo
            for (let objetivo of result.recordset) {
                try {
                    const sharedResponsaveis = await pool.request()
                        .input('objetivoId', sql.Int, objetivo.Id)
                        .query(`
                            SELECT u.NomeCompleto as nome_responsavel, orr.responsavel_id
                            FROM ObjetivoResponsaveis orr
                            JOIN Users u ON orr.responsavel_id = u.Id
                            WHERE orr.objetivo_id = @objetivoId
                        `);
                    objetivo.shared_responsaveis = sharedResponsaveis.recordset;
                } catch (error) {
                    console.log('Tabela ObjetivoResponsaveis não encontrada ao buscar responsáveis compartilhados para objetivo:', objetivo.Id);
                    objetivo.shared_responsaveis = [];
                }
            }
                
            res.json(result.recordset);
            return;
        } catch (error) {
            // Fallback para busca sem responsáveis compartilhados
            console.log('Usando fallback para objetivos sem responsáveis compartilhados');
        
        // Construir query de fallback com filtros
        let fallbackWhereConditions = ['(o.responsavel_id = @userId OR o.criado_por = @userId)'];
        
        // Aplicar filtro de status no fallback
        if (status) {
            fallbackWhereConditions.push('o.status = @statusFilter');
        }
        
        const baseQuery = `
                    SELECT DISTINCT
                        o.Id, o.titulo, o.data_inicio, o.data_fim, o.status, o.progresso, o.created_at, o.updated_at,
                        o.responsavel_id, o.criado_por,
                        CONVERT(NVARCHAR(MAX), o.descricao) as descricao,
                        u.NomeCompleto as responsavel_nome,
                        c.NomeCompleto as criador_nome,
                        CASE 
                            WHEN o.criado_por = @userId THEN 1 
                            ELSE 0 
                        END as can_edit,
                        CASE 
                            WHEN o.responsavel_id = @userId THEN 1 
                            ELSE 0 
                        END as is_responsible
                FROM Objetivos o
                    LEFT JOIN Users u ON o.responsavel_id = u.Id
                    LEFT JOIN Users c ON o.criado_por = c.Id
                    WHERE ${fallbackWhereConditions.join(' AND ')}
                ORDER BY o.created_at DESC
            `;
        
        const request = pool.request().input('userId', sql.Int, userId);
        if (status) {
            request.input('statusFilter', sql.NVarChar, status);
        }
        
        const result = await request.query(baseQuery);
            
            // Adicionar lista vazia para responsáveis compartilhados no fallback
            result.recordset.forEach(objetivo => {
                objetivo.shared_responsaveis = [];
            });
        
        res.json(result.recordset);
        }
    } catch (error) {
        console.error('Erro ao buscar objetivos:', error);
        res.status(500).json({ error: 'Erro ao buscar objetivos' });
    }
});

// Buscar objetivo específico
app.get('/api/objetivos/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('objetivoId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    o.*,
                    u.NomeCompleto as responsavel_nome,
                    c.NomeCompleto as criador_nome
                FROM Objetivos o
                LEFT JOIN Users u ON o.responsavel_id = u.Id
                LEFT JOIN Users c ON o.criado_por = c.Id
                WHERE o.Id = @objetivoId
            `);
        
        // Buscar responsáveis adicionais da tabela ObjetivoResponsaveis (se a tabela existir)
        if (result.recordset.length > 0) {
            try {
                const sharedResponsaveis = await pool.request()
                    .input('objetivoId', sql.Int, parseInt(id))
                    .query(`
                        SELECT u.NomeCompleto as nome_responsavel, orr.responsavel_id
                        FROM ObjetivoResponsaveis orr
                        JOIN Users u ON orr.responsavel_id = u.Id
                        WHERE orr.objetivo_id = @objetivoId
                    `);
                
                // Adicionar informações dos responsáveis compartilhados ao resultado
                console.log('📋 Responsáveis compartilhados encontrados:', sharedResponsaveis.recordset);
                result.recordset[0].shared_responsaveis = sharedResponsaveis.recordset;
                console.log('✅ Dados do objetivo com responsáveis compartilhados:', result.recordset[0]);
            } catch (error) {
                console.log('Tabela ObjetivoResponsaveis não encontrada ao buscar responsáveis compartilhados');
                result.recordset[0].shared_responsaveis = [];
            }
        }
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Erro ao buscar objetivo:', error);
        res.status(500).json({ error: 'Erro ao buscar objetivo' });
    }
});

// Registrar check-in
app.post('/api/objetivos/:id/checkin', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { progresso, observacoes } = req.body;
        const userId = req.session.user.userId;
        
        console.log('🔍 Check-in - Parâmetros recebidos:', { id, progresso, observacoes, userId });
        console.log('🔍 Check-in - Tipo do ID:', typeof id, 'Valor:', id);
        
        // Validar se o ID é um número válido
        const objetivoId = parseInt(id);
        if (isNaN(objetivoId)) {
            console.error('❌ Check-in - ID inválido:', id);
            return res.status(400).json({ error: 'ID do objetivo inválido' });
        }
        
        if (progresso === undefined || progresso < 0 || progresso > 100) {
            return res.status(400).json({ error: 'Progresso deve ser entre 0 e 100' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar e criar tabelas se necessário
        await ensureObjetivosTablesExist(pool);
        
        // Verificar se o objetivo existe e obter informações
        const objetivoInfo = await pool.request()
            .input('objetivoId', sql.Int, objetivoId)
            .query(`
                SELECT Id, data_inicio, status, responsavel_id, criado_por
                FROM Objetivos 
                WHERE Id = @objetivoId
            `);
        
        if (objetivoInfo.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        const objetivo = objetivoInfo.recordset[0];
        
        // Verificar se o objetivo já começou (data de início <= hoje)
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const dataInicio = new Date(objetivo.data_inicio);
        dataInicio.setHours(0, 0, 0, 0);
        
        if (dataInicio > hoje) {
            return res.status(400).json({ 
                error: 'Não é possível fazer check-in em objetivos que ainda não começaram. Data de início: ' + 
                       new Date(objetivo.data_inicio).toLocaleDateString('pt-BR')
            });
        }
        
        // Verificar se o usuário é responsável pelo objetivo (do campo direto ou da tabela de relacionamento)
        const isResponsableDirect = objetivo.responsavel_id === userId;
        let isResponsableShared = false;
        
        // Tentar verificar se existe na tabela de responsáveis compartilhados se ela existir
        try {
            const responsavelSharedResult = await pool.request()
                .input('objetivoId', sql.Int, objetivoId)
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT COUNT(*) as count
                    FROM ObjetivoResponsaveis 
                    WHERE objetivo_id = @objetivoId AND responsavel_id = @userId
                `);
            
            isResponsableShared = responsavelSharedResult.recordset[0].count > 0;
        } catch (error) {
            console.log('Tabela ObjetivoResponsaveis não encontrada, ignorando responsáveis compartilhados no check-in');
        }
        
        if (!isResponsableDirect && !isResponsableShared) {
            return res.status(403).json({ error: 'Apenas os responsáveis pelo objetivo podem fazer check-in' });
        }
        
        // Verificar se já fez check-in hoje neste objetivo
        const today = new Date().toISOString().split('T')[0];
        const checkinToday = await pool.request()
            .input('objetivoId', sql.Int, objetivoId)
            .input('userId', sql.Int, userId)
            .input('today', sql.Date, today)
            .query(`
                SELECT COUNT(*) as count
                FROM ObjetivoCheckins 
                WHERE objetivo_id = @objetivoId 
                AND user_id = @userId 
                AND CAST(created_at AS DATE) = @today
            `);
        
        const isFirstCheckinToday = checkinToday.recordset[0].count === 0;
        
        // Registrar check-in
        await pool.request()
            .input('objetivoId', sql.Int, objetivoId)
            .input('userId', sql.Int, userId)
            .input('progresso', sql.Decimal, progresso)
            .input('observacoes', sql.Text, observacoes || '')
            .query(`
                INSERT INTO ObjetivoCheckins (objetivo_id, user_id, progresso, observacoes)
                VALUES (@objetivoId, @userId, @progresso, @observacoes)
            `);
        
        // Atualizar progresso do objetivo
        await pool.request()
            .input('objetivoId', sql.Int, objetivoId)
            .input('progresso', sql.Decimal, progresso)
            .query(`
                UPDATE Objetivos 
                SET progresso = @progresso, updated_at = GETDATE()
                WHERE Id = @objetivoId
            `);
        
        // Verificar se o objetivo deve ser concluído
        let statusUpdate = '';
        if (progresso >= 100) {
            // Buscar informações do objetivo para verificar quem criou
            const objetivoInfo = await pool.request()
                .input('objetivoId', sql.Int, objetivoId)
                .query(`
                    SELECT criado_por, responsavel_id, status
                    FROM Objetivos 
                    WHERE Id = @objetivoId
                `);
            
            const objetivo = objetivoInfo.recordset[0];
            
            if (objetivo.criado_por === userId) {
                // Objetivo criado pelo próprio usuário - concluir automaticamente
                await pool.request()
                    .input('objetivoId', sql.Int, objetivoId)
                    .query(`UPDATE Objetivos SET status = 'Concluído' WHERE Id = @objetivoId`);
                statusUpdate = 'Objetivo concluído automaticamente!';
            } else {
                // Objetivo criado por gestor - solicitar aprovação
                await pool.request()
                    .input('objetivoId', sql.Int, objetivoId)
                    .query(`UPDATE Objetivos SET status = 'Aguardando Aprovação' WHERE Id = @objetivoId`);
                statusUpdate = 'Objetivo marcado para aprovação do gestor!';
            }
        }
        
        // Adicionar pontos por check-in (primeira vez no dia) - 5 pontos
        let pointsResult = { success: false, points: 0, message: '' };
        if (isFirstCheckinToday) {
            pointsResult = await addPointsToUser(userId, 'checkin_objetivo', 5, pool);
        }
        
        res.json({ 
            success: true, 
            message: 'Check-in registrado com sucesso',
            statusUpdate: statusUpdate,
            pointsEarned: pointsResult.success ? pointsResult.points : 0,
            pointsMessage: pointsResult.message
        });
    } catch (error) {
        console.error('Erro ao registrar check-in:', error);
        res.status(500).json({ error: 'Erro ao registrar check-in: ' + error.message });
    }
});

// Buscar check-ins de um objetivo
app.get('/api/objetivos/:id/checkins', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`
                SELECT 
                    oc.*,
                    u.NomeCompleto as user_name
                FROM ObjetivoCheckins oc
                JOIN Users u ON oc.user_id = u.Id
                WHERE oc.objetivo_id = @objetivoId
                ORDER BY oc.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar check-ins:', error);
        res.status(500).json({ error: 'Erro ao buscar check-ins' });
    }
});

// Atualizar objetivo

// Aprovar conclusão de objetivo (apenas para gestores)
app.post('/api/objetivos/:id/approve', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o objetivo existe e se o usuário é o criador (gestor)
        const objetivoCheck = await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT criado_por, status, responsavel_id
                FROM Objetivos 
                WHERE Id = @objetivoId
            `);
        
        if (objetivoCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        const objetivo = objetivoCheck.recordset[0];
        
        if (objetivo.criado_por !== userId) {
            return res.status(403).json({ error: 'Apenas o gestor que criou o objetivo pode aprová-lo' });
        }
        
        if (objetivo.status !== 'Aguardando Aprovação') {
            return res.status(400).json({ error: 'Este objetivo não está aguardando aprovação' });
        }
        
        // Aprovar objetivo
        await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`UPDATE Objetivos SET status = 'Concluído' WHERE Id = @objetivoId`);
        
        // Dar pontos ao responsável pelo objetivo (10 pontos)
        let pointsResult = { success: false, points: 0, message: '' };
        if (objetivo.responsavel_id) {
            pointsResult = await addPointsToUser(objetivo.responsavel_id, 'objetivo_aprovado', 10, pool);
        }
        
        res.json({ 
            success: true, 
            message: 'Objetivo aprovado e concluído com sucesso',
            pointsEarned: pointsResult.success ? pointsResult.points : 0,
            pointsMessage: pointsResult.message
        });
    } catch (error) {
        console.error('Erro ao aprovar objetivo:', error);
        res.status(500).json({ error: 'Erro ao aprovar objetivo' });
    }
});

// Rejeitar objetivo
app.post('/api/objetivos/:id/reject', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o objetivo existe e se o usuário é o criador (gestor)
        const objetivoCheck = await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT criado_por, status, progresso
                FROM Objetivos 
                WHERE Id = @objetivoId
            `);
        
        if (objetivoCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        const objetivo = objetivoCheck.recordset[0];
        
        if (objetivo.criado_por !== userId) {
            return res.status(403).json({ error: 'Apenas o gestor que criou o objetivo pode rejeitá-lo' });
        }
        
        if (objetivo.status !== 'Aguardando Aprovação') {
            return res.status(400).json({ error: 'Este objetivo não está aguardando aprovação' });
        }
        
        // Buscar todos os check-ins para debug
        const allCheckins = await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`
                SELECT progresso, created_at
                FROM ObjetivoCheckins 
                WHERE objetivo_id = @objetivoId
                ORDER BY created_at DESC
            `);
        
        console.log('🔍 Rejeição - Todos os check-ins:', allCheckins.recordset);
        
        // Buscar o último check-in que não seja 100% (ignorando todas as solicitações de conclusão)
        // Isso garante que mesmo se o usuário solicitar aprovação múltiplas vezes, sempre volta para o progresso real anterior
        const previousCheckin = await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`
                SELECT TOP 1 progresso, created_at
                FROM ObjetivoCheckins 
                WHERE objetivo_id = @objetivoId 
                AND progresso < 100
                ORDER BY created_at DESC
            `);
        
        // Definir o progresso anterior (ou 0 se não houver check-ins anteriores)
        const previousProgress = previousCheckin.recordset.length > 0 ? previousCheckin.recordset[0].progresso : 0;
        
        console.log('🔄 Rejeição - Check-in anterior encontrado:', previousCheckin.recordset[0] || 'Nenhum');
        console.log('🔄 Rejeição - Progresso anterior encontrado:', previousProgress);
        
        // Rejeitar objetivo - reverter progresso e voltar para Ativo
        await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('previousProgress', sql.Decimal(5,2), previousProgress)
            .query(`
                UPDATE Objetivos 
                SET status = 'Ativo', progresso = @previousProgress, updated_at = GETDATE()
                WHERE Id = @objetivoId
            `);
        
        res.json({ 
            success: true, 
            message: `Objetivo rejeitado. Progresso revertido para ${previousProgress}%`,
            previousProgress: previousProgress
        });
    } catch (error) {
        console.error('Erro ao rejeitar objetivo:', error);
        res.status(500).json({ error: 'Erro ao rejeitar objetivo' });
    }
});

// Excluir objetivo
app.delete('/api/objetivos/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o objetivo existe e se o usuário tem permissão para excluí-lo
        const objetivoCheck = await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT criado_por, status
                FROM Objetivos 
                WHERE Id = @objetivoId
            `);
        
        if (objetivoCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        const objetivo = objetivoCheck.recordset[0];
        
        // Apenas o criador pode excluir
        if (objetivo.criado_por !== userId) {
            return res.status(403).json({ error: 'Apenas o criador do objetivo pode excluí-lo' });
        }
        
        // Excluir check-ins primeiro
        await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`DELETE FROM ObjetivoCheckins WHERE objetivo_id = @objetivoId`);
        
        // Excluir objetivo
        await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`DELETE FROM Objetivos WHERE Id = @objetivoId`);
        
        res.json({ success: true, message: 'Objetivo excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao excluir objetivo:', error);
        res.status(500).json({ error: 'Erro ao excluir objetivo' });
    }
});

// ===== SISTEMA DE GAMIFICAÇÃO =====

// Função para verificar se o usuário já ganhou pontos por uma ação no dia
async function hasEarnedPointsToday(userId, action, pool) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('today', sql.Date, today)
            .query(`
                SELECT COUNT(*) as count
                FROM Gamification 
                WHERE UserId = @userId 
                AND Action = @action 
                AND CAST(CreatedAt AS DATE) = @today
            `);
        
        return result.recordset[0].count > 0;
    } catch (error) {
        console.error('Erro ao verificar pontos do dia:', error);
        return false;
    }
}

// Função para adicionar pontos ao usuário
async function addPointsToUser(userId, action, points, pool) {
    try {
        // Verificar se já ganhou pontos por esta ação hoje
        const alreadyEarned = await hasEarnedPointsToday(userId, action, pool);
        if (alreadyEarned) {
            return { success: false, message: 'Você já ganhou pontos por esta ação hoje' };
        }

        // Adicionar pontos na tabela de gamificação
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('points', sql.Int, points)
            .query(`
                INSERT INTO Gamification (UserId, Action, Points, CreatedAt)
                VALUES (@userId, @action, @points, GETDATE())
            `);

        // Atualizar total de pontos do usuário
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('points', sql.Int, points)
            .query(`
                IF EXISTS (SELECT 1 FROM UserPoints WHERE UserId = @userId)
                    UPDATE UserPoints 
                    SET TotalPoints = TotalPoints + @points, LastUpdated = GETDATE()
                    WHERE UserId = @userId
                ELSE
                    INSERT INTO UserPoints (UserId, TotalPoints, LastUpdated)
                    VALUES (@userId, @points, GETDATE())
            `);

        return { success: true, points: points };
    } catch (error) {
        console.error('Erro ao adicionar pontos:', error);
        return { success: false, message: 'Erro ao adicionar pontos' };
    }
}

// Buscar pontos do usuário
app.get('/api/gamification/points', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT TotalPoints, LastUpdated
                FROM UserPoints 
                WHERE UserId = @userId
            `);
        
        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json({ TotalPoints: 0, LastUpdated: null });
        }
    } catch (error) {
        console.error('Erro ao buscar pontos:', error);
        res.status(500).json({ error: 'Erro ao buscar pontos' });
    }
});

// Buscar leaderboard de gamificação (top 10 + posição do usuário)
app.get('/api/gamification/leaderboard', requireAuth, async (req, res) => {
    try {
        const { topUsers = 10 } = req.query;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Buscar top usuários
        const topUsersResult = await pool.request()
            .input('topUsers', sql.Int, parseInt(topUsers))
            .query(`
                SELECT TOP (@topUsers) 
                    u.Id,
                    u.NomeCompleto,
                    u.Departamento,
                    u.DescricaoDepartamento,
                    up.TotalPoints
                FROM UserPoints up
                JOIN Users u ON up.UserId = u.Id
                ORDER BY up.TotalPoints DESC
            `);
        
        console.log('Top usuários encontrados:', topUsersResult.recordset);
        
        // Verificar se há dados na tabela UserPoints
        const checkUserPoints = await pool.request()
            .query(`
                SELECT COUNT(*) as total FROM UserPoints
            `);
        console.log('Total de registros na tabela UserPoints:', checkUserPoints.recordset[0].total);
        
        // Buscar posição do usuário atual entre todos os usuários com pontos
        const userRankingResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                WITH UserRanking AS (
                    SELECT 
                        up.UserId,
                        up.TotalPoints,
                        ROW_NUMBER() OVER (ORDER BY up.TotalPoints DESC) as Position
                    FROM UserPoints up
                    WHERE up.TotalPoints > 0
                )
                SELECT 
                    ur.TotalPoints,
                    ur.Position
                FROM UserRanking ur
                WHERE ur.UserId = @userId
            `);
        
        const userRanking = userRankingResult.recordset.length > 0 ? {
            position: userRankingResult.recordset[0].Position,
            totalPoints: userRankingResult.recordset[0].TotalPoints
        } : {
            position: null,
            totalPoints: 0,
            hasPoints: false
        };
        
        res.json({
            leaderboard: topUsersResult.recordset,
            userRanking: userRanking
        });
    } catch (error) {
        console.error('Erro ao buscar leaderboard:', error);
        res.status(500).json({ error: 'Erro ao buscar leaderboard' });
    }
});

// Buscar histórico de ações
app.get('/api/gamification/history', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT Action, Points, LumicoinEarned, CreatedAt
                FROM Gamification 
                WHERE UserId = @userId
                ORDER BY CreatedAt DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
});

// ===== SISTEMA DE NOTIFICAÇÕES =====

// Buscar notificações do usuário
app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT *
                FROM Notifications 
                WHERE UserId = @userId
                ORDER BY CreatedAt DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar notificações:', error);
        res.status(500).json({ error: 'Erro ao buscar notificações' });
    }
});

// Marcar notificação como lida
app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input('notificationId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                UPDATE Notifications 
                SET IsRead = 1
                WHERE Id = @notificationId AND UserId = @userId
            `);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao marcar notificação:', error);
        res.status(500).json({ error: 'Erro ao marcar notificação' });
    }
});

// ===== REMOÇÃO SISTEMA DE PESQUISA RÁPIDA =====
app.post('/api/pesquisas/migrate', requireAuth, async (req, res) => {
    try {
        // Verificar se é administrador
        if (req.session.user.role !== 'Administrador') {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem executar migrações.' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se a coluna já existe
        const checkResult = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'PesquisasRapidas' 
            AND COLUMN_NAME = 'pergunta'
        `);
        
        if (checkResult.recordset[0].count > 0) {
            return res.json({ 
                success: true, 
                message: 'Coluna "pergunta" já existe na tabela PesquisasRapidas',
                alreadyExists: true
            });
        }
        
        // Adicionar a coluna
        await pool.request().query(`
            ALTER TABLE PesquisasRapidas 
            ADD pergunta NTEXT NULL
        `);
        
        res.json({ 
            success: true, 
            message: 'Coluna "pergunta" adicionada com sucesso na tabela PesquisasRapidas'
        });
    } catch (error) {
        console.error('Erro na migração:', error);
        res.status(500).json({ error: 'Erro ao executar migração: ' + error.message });
    }
});

// Função para verificar se uma coluna existe na tabela PesquisasRapidas
async function checkColumnExists(columnName) {
    try {
        const pool = await sql.connect(dbConfig);
        const result = await pool.request().query(`
            SELECT COUNT(*) as column_exists
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'PesquisasRapidas' 
            AND COLUMN_NAME = '${columnName}'
        `);
        return result.recordset[0].column_exists > 0;
    } catch (error) {
        console.error(`Erro ao verificar coluna ${columnName}:`, error);
        return false;
    }
}

// Função para atualizar status das pesquisas baseado nas datas
async function updatePesquisaStatus() {
    try {
        const pool = await sql.connect(dbConfig);
        const now = new Date();
        
        // ========================================
        // NOVO SISTEMA DE PESQUISAS (Tabela Surveys)
        // ========================================
        
        // Primeiro, verificar quantas pesquisas precisam de atualização
        const statusCheck = await pool.request().query(`
            SELECT 
                status,
                COUNT(*) as total,
                COUNT(CASE WHEN data_inicio IS NOT NULL AND data_inicio <= GETDATE() AND status = 'Agendada' THEN 1 END) as devem_ativar,
                COUNT(CASE WHEN data_inicio IS NOT NULL AND data_inicio > GETDATE() AND status = 'Ativa' THEN 1 END) as devem_agendar,
                COUNT(CASE WHEN data_encerramento IS NOT NULL AND data_encerramento <= GETDATE() AND status = 'Ativa' THEN 1 END) as devem_encerrar
            FROM Surveys
            GROUP BY status
        `);
        
        const shouldActivate = statusCheck.recordset.reduce((sum, row) => sum + (row.devem_ativar || 0), 0);
        const shouldSchedule = statusCheck.recordset.reduce((sum, row) => sum + (row.devem_agendar || 0), 0);
        const shouldClose = statusCheck.recordset.reduce((sum, row) => sum + (row.devem_encerrar || 0), 0);
        
        if (shouldActivate > 0 || shouldSchedule > 0 || shouldClose > 0) {
            console.log(`   🎯 Ações necessárias: ${shouldActivate} ativar, ${shouldSchedule} agendar, ${shouldClose} encerrar`);
        }
        
        // 1. Ativar pesquisas agendadas que chegaram na data de início
        const ativarQuery = `
            UPDATE Surveys 
            SET status = 'Ativa'
            WHERE status = 'Agendada' 
            AND data_inicio IS NOT NULL 
            AND data_inicio <= GETDATE()
            AND (data_encerramento IS NULL OR data_encerramento > GETDATE())
        `;
        
        const resultAtivar = await pool.request().query(ativarQuery);
        if (resultAtivar.rowsAffected && resultAtivar.rowsAffected[0] > 0) {
            console.log(`✅ ${resultAtivar.rowsAffected[0]} pesquisas foram ATIVADAS automaticamente`);
            
            // Mostrar quais pesquisas foram ativadas
            const ativatedSurveys = await pool.request().query(`
                SELECT titulo, data_inicio, 
                       DATEDIFF(minute, data_inicio, GETDATE()) as minutos_atraso
                FROM Surveys 
                WHERE status = 'Ativa' 
                AND data_inicio IS NOT NULL 
                AND data_inicio <= GETDATE()
                AND DATEDIFF(minute, data_inicio, GETDATE()) >= 0
                ORDER BY data_inicio DESC
            `);
            ativatedSurveys.recordset.slice(0, 3).forEach(survey => {
                console.log(`   📋 "${survey.titulo}" (início: ${new Date(survey.data_inicio).toLocaleString('pt-BR')}, atraso: ${survey.minutos_atraso}min)`);
            });
        }
        
        // 2. Agendar pesquisas que ainda não chegaram na data de início
        const agendarQuery = `
            UPDATE Surveys 
            SET status = 'Agendada'
            WHERE status = 'Ativa' 
            AND data_inicio IS NOT NULL 
            AND data_inicio > GETDATE()
        `;
        
        const resultAgendar = await pool.request().query(agendarQuery);
        if (resultAgendar.rowsAffected && resultAgendar.rowsAffected[0] > 0) {
            console.log(`📅 ${resultAgendar.rowsAffected[0]} pesquisas foram AGENDADAS (início futuro)`);
        }
        
        // 3. Encerrar pesquisas que passaram da data de encerramento
        const encerrarQuery = `
            UPDATE Surveys 
            SET status = 'Encerrada'
            WHERE status = 'Ativa' 
            AND data_encerramento IS NOT NULL 
            AND data_encerramento <= GETDATE()
        `;
        
        const resultEncerrar = await pool.request().query(encerrarQuery);
        if (resultEncerrar.rowsAffected && resultEncerrar.rowsAffected[0] > 0) {
            console.log(`🔴 ${resultEncerrar.rowsAffected[0]} pesquisas foram ENCERRADAS automaticamente`);
        }
        
        // Log detalhado apenas se houve mudanças ou a cada 60 segundos
        const shouldLogDetails = resultAtivar.rowsAffected[0] > 0 || 
                               resultAgendar.rowsAffected[0] > 0 || 
                               resultEncerrar.rowsAffected[0] > 0 ||
                               Math.floor(now.getSeconds() / 10) % 6 === 0; // A cada 60s
        
        if (shouldLogDetails) {
            const summaryResult = await pool.request().query(`
                SELECT 
                    status,
                    COUNT(*) as total,
                    STRING_AGG(titulo, ', ') as titulos
                FROM Surveys
                GROUP BY status
            `);
            
            console.log(`   📊 Status atual:`);
            summaryResult.recordset.forEach(row => {
                console.log(`      ${row.status}: ${row.total} pesquisa(s)`);
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao atualizar status das pesquisas:', error);
    }
}

// Função para atualizar status dos objetivos baseado nas datas
async function updateObjetivoStatus() {
    try {
        const pool = await sql.connect(dbConfig);
        const now = new Date();
        
        console.log('🎯 Verificando status dos objetivos...');
        
        // 1. Ativar objetivos agendados que chegaram na data de início
        const ativarResult = await pool.request().query(`
            UPDATE Objetivos 
            SET status = 'Ativo', updated_at = GETDATE()
            WHERE status = 'Agendado' 
            AND data_inicio <= CAST(GETDATE() AS DATE)
        `);
        
        if (ativarResult.rowsAffected && ativarResult.rowsAffected[0] > 0) {
            console.log(`✅ ${ativarResult.rowsAffected[0]} objetivos foram ATIVADOS automaticamente`);
            
            // Mostrar quais objetivos foram ativados
            const ativadosResult = await pool.request().query(`
                SELECT titulo, data_inicio, responsavel_id
                FROM Objetivos 
                WHERE status = 'Ativo' 
                AND data_inicio <= CAST(GETDATE() AS DATE)
                AND DATEDIFF(day, updated_at, GETDATE()) = 0
                ORDER BY updated_at DESC
            `);
            
            ativadosResult.recordset.slice(0, 3).forEach(objetivo => {
                console.log(`   🎯 "${objetivo.titulo}" (início: ${new Date(objetivo.data_inicio).toLocaleDateString('pt-BR')})`);
            });
        }
        
        // 2. Expirar objetivos ativos que passaram da data de fim
        const expirarResult = await pool.request().query(`
            UPDATE Objetivos 
            SET status = 'Expirado', updated_at = GETDATE()
            WHERE status = 'Ativo' 
            AND data_fim < CAST(GETDATE() AS DATE)
        `);
        
        if (expirarResult.rowsAffected && expirarResult.rowsAffected[0] > 0) {
            console.log(`🔴 ${expirarResult.rowsAffected[0]} objetivos foram EXPIRADOS automaticamente`);
            
            // Mostrar quais objetivos foram expirados
            const expiradosResult = await pool.request().query(`
                SELECT titulo, data_fim, responsavel_id
                FROM Objetivos 
                WHERE status = 'Expirado' 
                AND data_fim < CAST(GETDATE() AS DATE)
                AND DATEDIFF(day, updated_at, GETDATE()) = 0
                ORDER BY updated_at DESC
            `);
            
            expiradosResult.recordset.slice(0, 3).forEach(objetivo => {
                console.log(`   ⏰ "${objetivo.titulo}" (fim: ${new Date(objetivo.data_fim).toLocaleDateString('pt-BR')})`);
            });
        }
        
        // Log resumo se houve mudanças
        if ((ativarResult.rowsAffected && ativarResult.rowsAffected[0] > 0) || 
            (expirarResult.rowsAffected && expirarResult.rowsAffected[0] > 0)) {
            
            const summaryResult = await pool.request().query(`
                SELECT status, COUNT(*) as total
                FROM Objetivos
                GROUP BY status
                ORDER BY status
            `);
            
            console.log('📊 Resumo dos objetivos:');
            summaryResult.recordset.forEach(row => {
                console.log(`   ${row.status}: ${row.total} objetivo(s)`);
            });
        }
        
    } catch (error) {
        console.error('❌ Erro ao atualizar status dos objetivos:', error);
    }
}

// Função para verificar se a coluna data_inicio existe
async function checkDataInicioColumnExists() {
    return await checkColumnExists('data_inicio');
}

// Função para verificar se a coluna filial_alvo existe
async function checkFilialAlvoColumnExists() {
    return await checkColumnExists('filial_alvo');
}

// Middleware para verificar se é do RH ou T&D
const requireHRAccess = (req, res, next) => {
    const user = req.session.user;
    
    if (!user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    // Verificar se é do departamento RH ou Treinamento & Desenvolvimento
    const departamento = user.departamento ? user.departamento.toUpperCase() : '';
    const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
    const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                 departamento.includes('TREINAMENTO') || 
                 departamento.includes('DESENVOLVIMENTO') ||
                 departamento.includes('T&D');
    
    if (!isHR && !isTD) {
        console.log('🚫 ACESSO NEGADO RH/T&D:', user.nomeCompleto, '-', user.departamento);
        return res.status(403).json({ 
            error: 'Acesso negado. Apenas usuários do RH e Treinamento & Desenvolvimento podem realizar esta ação.',
            userDepartment: user.departamento
        });
    }
    next();
};

// Endpoint para corrigir uma pesquisa específica (definir data_inicio como agora)
app.post('/api/pesquisas/:id/fix-date', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Atualizar a data_inicio para agora (início imediato)
        const result = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .query(`
                UPDATE PesquisasRapidas 
                SET data_inicio = GETDATE(),
                    status = 'Ativa'
                WHERE Id = @pesquisaId
            `);
        
        if (result.rowsAffected && result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Data de início da pesquisa foi corrigida para agora' });
        } else {
            res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
    } catch (error) {
        console.error('Erro ao corrigir data da pesquisa:', error);
        res.status(500).json({ error: 'Erro ao corrigir data da pesquisa' });
    }
});

// Criar pesquisa rápida (apenas RH)
app.post('/api/pesquisas', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { 
            titulo, 
            descricao, 
            perguntas,
            departamentos_alvo, 
            filial_alvo,
            data_inicio,
            data_encerramento,
            anonima
        } = req.body;
        
        if (!titulo || !perguntas || perguntas.length === 0) {
            return res.status(400).json({ error: 'Título e pelo menos uma pergunta são obrigatórios' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Processar departamentos alvo (CORRIGIDO)
        // Bug: quando era "Todos", estava salvando NULL, mas filtros esperavam "Todos"
        let departamentosAlvo = departamentos_alvo;
        if (!departamentos_alvo || departamentos_alvo.trim() === '') {
            departamentosAlvo = 'Todos'; // Valor padrão
        }

        // Verificar se as colunas existem
        const hasDataInicioColumn = await checkDataInicioColumnExists();
        const hasFilialAlvoColumn = await checkFilialAlvoColumnExists();
        
        // Criar a pesquisa principal com base nas colunas disponíveis
        let result;
        let columns = ['titulo', 'descricao', 'departamentos_alvo'];
        let values = ['@titulo', '@descricao', '@departamentosAlvo'];
        let inputs = [
            { name: 'titulo', type: sql.VarChar, value: titulo },
            { name: 'descricao', type: sql.Text, value: descricao },
            { name: 'departamentosAlvo', type: sql.VarChar, value: departamentosAlvo }
        ];
        
        // Adicionar filial_alvo se a coluna existir
        if (hasFilialAlvoColumn) {
            columns.push('filial_alvo');
            values.push('@filialAlvo');
            inputs.push({ name: 'filialAlvo', type: sql.VarChar, value: filial_alvo === 'Todas' ? null : filial_alvo });
        }
        
        // Adicionar data_inicio se a coluna existir
        if (hasDataInicioColumn) {
            columns.push('data_inicio');
            values.push('@dataInicio');
            // Se não foi informada data_inicio, usar data atual (início imediato)
            const dataInicioValue = data_inicio ? new Date(data_inicio) : new Date();
            inputs.push({ name: 'dataInicio', type: sql.DateTime, value: dataInicioValue });
            console.log('📅 Data de início definida:', dataInicioValue);
        }
        
        // Adicionar data_encerramento (sempre existe)
        columns.push('data_encerramento');
        values.push('@dataEncerramento');
        inputs.push({ name: 'dataEncerramento', type: sql.DateTime, value: data_encerramento ? new Date(data_encerramento) : null });
        
        // Adicionar campos obrigatórios
        columns.push('anonima', 'criado_por', 'status', 'ativa');
        values.push('@anonima', '@criadoPor', "'Ativa'", '1');
        inputs.push(
            { name: 'anonima', type: sql.Bit, value: anonima || false },
            { name: 'criadoPor', type: sql.Int, value: req.session.user.userId }
        );
        
        // Construir query dinamicamente
        const query = `
            INSERT INTO PesquisasRapidas (${columns.join(', ')})
            OUTPUT INSERTED.Id
            VALUES (${values.join(', ')})
        `;
        
        console.log('Criando pesquisa com colunas:', columns);
        
        // Executar query
        const request = pool.request();
        inputs.forEach(input => {
            request.input(input.name, input.type, input.value);
        });
        
        result = await request.query(query);
        
        const pesquisaId = result.recordset[0].Id;
        console.log('✅ Pesquisa criada com sucesso! ID:', pesquisaId);
        console.log('📝 Título:', titulo);
        console.log('🎯 Departamentos alvo:', departamentosAlvo);
        console.log('👤 Criado por:', req.session.user.nomeCompleto);
        
        // Inserir as perguntas
        for (let i = 0; i < perguntas.length; i++) {
            const pergunta = perguntas[i];
            await pool.request()
                .input('pesquisaId', sql.Int, pesquisaId)
                .input('pergunta', sql.Text, pergunta.texto)
                .input('tipo', sql.VarChar, pergunta.tipo)
                .input('opcoes', sql.Text, pergunta.opcoes ? JSON.stringify(pergunta.opcoes) : null)
                .input('escalaMin', sql.Int, pergunta.escala_min || null)
                .input('escalaMax', sql.Int, pergunta.escala_max || null)
                .input('obrigatoria', sql.Bit, pergunta.obrigatoria || false)
                .input('ordem', sql.Int, i + 1)
                .query(`
                    INSERT INTO PesquisaPerguntas (pesquisa_id, pergunta, tipo, opcoes, escala_min, escala_max, obrigatoria, ordem)
                    VALUES (@pesquisaId, @pergunta, @tipo, @opcoes, @escalaMin, @escalaMax, @obrigatoria, @ordem)
                `);
        }
        
        res.json({ 
            success: true, 
            id: pesquisaId,
            message: 'Pesquisa criada com sucesso',
            data: {
                titulo: titulo,
                departamentos_alvo: departamentosAlvo,
                filial_alvo: filial_alvo,
                criado_por: req.session.user.nomeCompleto
            }
        });
    } catch (error) {
        console.error('Erro ao criar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao criar pesquisa' });
    }
});

// Listar pesquisas (RH vê todas, outros veem apenas as disponíveis para eles)
app.get('/api/pesquisas', requireAuth, async (req, res) => {
    try {
        // Atualizar status das pesquisas antes de buscar
        await updatePesquisaStatus();
        
        const { search, status, departamento } = req.query;
        const pool = await sql.connect(dbConfig);
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (search) {
            whereClause += ' AND (pr.titulo LIKE @search OR pr.descricao LIKE @search)';
            params.push({ name: 'search', value: `%${search}%` });
        }
        
        if (status) {
            whereClause += ' AND pr.status = @status';
            params.push({ name: 'status', value: status });
        }
        
        if (departamento) {
            whereClause += ' AND pr.departamentos_alvo LIKE @departamento';
            params.push({ name: 'departamento', value: `%${departamento}%` });
        }
        
        let request = pool.request();
        params.forEach(param => {
            request.input(param.name, sql.VarChar, param.value);
        });
        
        // Verificar se é do RH ou T&D
        const currentUser = req.session.user;
        const isHR = currentUser.departamento && (currentUser.departamento.toUpperCase().includes('RH') || currentUser.departamento.toUpperCase().includes('RECURSOS HUMANOS'));
        const isTD = currentUser.departamento && (currentUser.departamento.toUpperCase().includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     currentUser.departamento.toUpperCase().includes('TREINAMENTO') || 
                     currentUser.departamento.toUpperCase().includes('DESENVOLVIMENTO') ||
                     currentUser.departamento.toUpperCase().includes('T&D'));
        const isHRorTD = isHR || isTD;
        
        // Se não for RH nem T&D, filtrar apenas pesquisas disponíveis para o departamento e filial do usuário
        if (!isHRorTD) {
            // CORREÇÃO: Buscar o código do departamento do usuário para comparação correta
            // Agora usa CPF para evitar ambiguidade com matrículas duplicadas
            let userDeptCode = null;
            try {
                const deptCodeResult = await pool.request()
                    .input('departamento', sql.VarChar, currentUser.departamento)
                    .input('userCpf', sql.VarChar, currentUser.cpf)  // ✅ Adicionar CPF
                    .query(`
                        SELECT TOP 1 
                            CASE 
                                WHEN h.NIVEL_4_DEPARTAMENTO IS NOT NULL THEN h.NIVEL_4_DEPARTAMENTO
                                WHEN h.DEPTO_ATUAL IS NOT NULL THEN h.DEPTO_ATUAL
                                WHEN ISNUMERIC(s.DEPARTAMENTO) = 1 THEN s.DEPARTAMENTO
                                ELSE NULL
                            END as DEPARTAMENTO_CODIGO
                        FROM TAB_HIST_SRA s
                        LEFT JOIN HIERARQUIA_CC h ON (
                            s.DEPARTAMENTO = h.NIVEL_4_DEPARTAMENTO 
                            OR s.DEPARTAMENTO = h.DEPTO_ATUAL
                        )
                        WHERE s.STATUS_GERAL = 'ATIVO'
                        AND s.CPF = @userCpf  -- ✅ Filtro por CPF para evitar ambiguidade
                        AND (
                            h.NIVEL_4_DEPARTAMENTO_DESC = @departamento
                            OR h.DESCRICAO_ATUAL = @departamento
                            OR s.DEPARTAMENTO = @departamento
                        )
                    `);
                
                if (deptCodeResult.recordset.length > 0) {
                    userDeptCode = deptCodeResult.recordset[0].DEPARTAMENTO_CODIGO;
                }
            } catch (error) {
                console.log('Erro ao buscar código do departamento:', error);
            }
            
            // Construir filtro de departamentos (CORRIGIDO)
            // Problema: LIKE '%${userDeptCode}%' pode não funcionar corretamente com códigos numéricos
            // Solução: Usar comparações mais precisas e considerar tanto códigos quanto descrições
            let deptFilter = '(pr.departamentos_alvo IS NULL OR pr.departamentos_alvo = \'Todos\'';
            
            if (userDeptCode) {
                // Comparação exata com o código do departamento
                deptFilter += ` OR pr.departamentos_alvo = '${userDeptCode}'`;
                // Comparação com LIKE para casos onde há múltiplos códigos separados por vírgula
                deptFilter += ` OR pr.departamentos_alvo LIKE '%${userDeptCode}%'`;
            }
            
            // Também verificar por descrição do departamento para maior compatibilidade
            if (currentUser.departamento) {
                deptFilter += ` OR pr.departamentos_alvo LIKE '%${currentUser.departamento}%'`;
            }
            
            deptFilter += ')';
            
            whereClause += ` AND ${deptFilter} AND (
                pr.filial_alvo IS NULL 
                OR pr.filial_alvo = 'Todas' 
                OR pr.filial_alvo = '${currentUser.unidade || ''}'
            )`;
        }
        
        // Verificar se as colunas existem
        const hasDataInicioColumn = await checkDataInicioColumnExists();
        const hasFilialAlvoColumn = await checkFilialAlvoColumnExists();
        
        let finalWhereClause = whereClause;
        
        // Aplicar filtros de data apenas para usuários não-RH/T&D
        if (!isHRorTD) {
            if (hasDataInicioColumn) {
                finalWhereClause += ` AND (pr.data_inicio IS NULL OR pr.data_inicio <= GETDATE())`;
            }
            finalWhereClause += ` AND (pr.data_encerramento IS NULL OR pr.data_encerramento > GETDATE())`;
            
            // Adicionar filtro de filial se a coluna existir
            if (hasFilialAlvoColumn) {
                finalWhereClause += ` AND (
                    pr.filial_alvo IS NULL 
                    OR pr.filial_alvo = 'Todas' 
                    OR pr.filial_alvo = '${currentUser.unidade || ''}'
                )`;
            }
        } else {
            // Para RH/T&D, aplicar apenas filtros de data se especificamente solicitado
            // mas não filtrar por status ativo/inativo automaticamente
            console.log('👑 Usuário RH/T&D - mostrando todas as pesquisas sem filtros de data');
        }
        
        const result = await request.query(`
            SELECT 
                pr.*,
                u.NomeCompleto as criador_nome,
                (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id) as total_respostas,
                (SELECT TOP 1 pp.tipo FROM PesquisaPerguntas pp WHERE pp.pesquisa_id = pr.Id ORDER BY pp.ordem) as tipo_pergunta
            FROM PesquisasRapidas pr
            JOIN Users u ON pr.criado_por = u.Id
            ${finalWhereClause}
            ORDER BY pr.Id DESC
        `);
        
        console.log('🔍 Pesquisas encontradas:', result.recordset.length);
        console.log('👤 Usuário atual:', currentUser.nomeCompleto, '-', currentUser.departamento);
        console.log('🔐 É RH/T&D:', isHRorTD);
        console.log('📋 Query executada:', finalWhereClause);
        console.log('📊 Filtros aplicados:');
        console.log('  - Search:', search || 'nenhum');
        console.log('  - Status:', status || 'nenhum');
        console.log('  - Departamento:', departamento || 'nenhum');
        console.log('  - Filtros de data:', !isHRorTD ? 'sim' : 'não (RH/T&D)');
        console.log('  - Filtros de filial:', !isHRorTD ? 'sim' : 'não (RH/T&D)');
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao listar pesquisas:', error);
        res.status(500).json({ error: 'Erro ao listar pesquisas' });
    }
});

// Buscar filtros para pesquisas
app.get('/api/pesquisas/filtros', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const statusResult = await pool.request().query(`
            SELECT DISTINCT status FROM PesquisasRapidas ORDER BY status
        `);
        
        const tiposResult = await pool.request().query(`
            SELECT DISTINCT pp.tipo FROM PesquisaPerguntas pp
            JOIN PesquisasRapidas pr ON pp.pesquisa_id = pr.Id
            ORDER BY pp.tipo
        `);
        
        res.json({
            status: statusResult.recordset.map(r => r.status),
            tipos: tiposResult.recordset.map(r => r.tipo)
        });
    } catch (error) {
        console.error('Erro ao buscar filtros de pesquisas:', error);
        res.status(500).json({ error: 'Erro ao buscar filtros de pesquisas' });
    }
});

// Buscar filiais para pesquisas
app.get('/api/pesquisas/filiais', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request().query(`
            SELECT DISTINCT FILIAL 
            FROM TAB_HIST_SRA 
            WHERE STATUS_GERAL = 'ATIVO' 
            AND FILIAL IS NOT NULL 
            AND FILIAL != ''
            ORDER BY FILIAL
        `);
        
        const filiais = ['Todas', ...result.recordset.map(r => r.FILIAL)];
        res.json(filiais);
    } catch (error) {
        console.error('Erro ao buscar filiais:', error);
        res.status(500).json({ error: 'Erro ao buscar filiais' });
    }
});

// Buscar departamentos para pesquisas (todos ou por filial)
app.get('/api/pesquisas/departamentos', requireAuth, async (req, res) => {
    try {
        const { filial } = req.query;
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT DISTINCT 
                CASE 
                    WHEN h.NIVEL_4_DEPARTAMENTO_DESC IS NOT NULL THEN h.NIVEL_4_DEPARTAMENTO_DESC
                    WHEN h.DESCRICAO_ATUAL IS NOT NULL THEN h.DESCRICAO_ATUAL
                    WHEN ISNUMERIC(s.DEPARTAMENTO) = 0 THEN s.DEPARTAMENTO
                    ELSE NULL
                END as DEPARTAMENTO_DESC,
                s.DEPARTAMENTO as DEPARTAMENTO_CODIGO
            FROM TAB_HIST_SRA s
            LEFT JOIN HIERARQUIA_CC h ON (
                s.DEPARTAMENTO = h.NIVEL_4_DEPARTAMENTO 
                OR s.DEPARTAMENTO = h.DEPTO_ATUAL
            )
            WHERE s.STATUS_GERAL = 'ATIVO' 
            AND s.DEPARTAMENTO IS NOT NULL 
            AND s.DEPARTAMENTO != ''
            AND (
                h.NIVEL_4_DEPARTAMENTO_DESC IS NOT NULL 
                OR h.DESCRICAO_ATUAL IS NOT NULL
                OR ISNUMERIC(s.DEPARTAMENTO) = 0
            )
            AND (
                CASE 
                    WHEN h.NIVEL_4_DEPARTAMENTO_DESC IS NOT NULL THEN h.NIVEL_4_DEPARTAMENTO_DESC
                    WHEN h.DESCRICAO_ATUAL IS NOT NULL THEN h.DESCRICAO_ATUAL
                    WHEN ISNUMERIC(s.DEPARTAMENTO) = 0 THEN s.DEPARTAMENTO
                    ELSE NULL
                END
            ) IS NOT NULL
        `;
        
        // Se filial for especificada e não for 'Todas', filtrar por ela
        if (filial && filial !== 'Todas') {
            query += ` AND s.FILIAL = @filial`;
        }
        
        query += ` ORDER BY DEPARTAMENTO_DESC`;
        
        const request = pool.request();
        if (filial && filial !== 'Todas') {
            request.input('filial', sql.VarChar, filial);
        }
        
        const result = await request.query(query);
        
        // Retornar objeto com descrição e código para cada departamento
        const departamentos = [
            { descricao: 'Todos', codigo: 'Todos' },
            ...result.recordset.map(r => ({
                descricao: r.DEPARTAMENTO_DESC,
                codigo: r.DEPARTAMENTO_CODIGO
            }))
        ];
        res.json(departamentos);
    } catch (error) {
        console.error('Erro ao buscar departamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar departamentos' });
    }
});

// Verificar se usuário pode criar pesquisas (RH e T&D)
app.get('/api/pesquisas/can-create', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const departamento = user.departamento ? user.departamento.toUpperCase() : '';
        const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
        const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     departamento.includes('TREINAMENTO') || 
                     departamento.includes('DESENVOLVIMENTO') ||
                     departamento.includes('T&D');
        

        
        res.json({ canCreate: isHR || isTD });
    } catch (error) {
        console.error('Erro ao verificar permissões:', error);
        res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
});

// Middleware adicional para verificar acesso a resultados de pesquisa
const requireSurveyResultsAccess = (req, res, next) => {
    const user = req.session.user;
    
    if (!user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    // Verificar se é do departamento RH ou Treinamento & Desenvolvimento
    const departamento = user.departamento ? user.departamento.toUpperCase() : '';
    const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
    const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                 departamento.includes('TREINAMENTO') || 
                 departamento.includes('DESENVOLVIMENTO') ||
                 departamento.includes('T&D');
    
    console.log('🔍 Verificando acesso aos resultados de pesquisa:');
    console.log('👤 Usuário:', user.nomeCompleto);
    console.log('🏢 Departamento:', user.departamento);
    console.log('✅ É RH:', isHR);
    console.log('✅ É T&D:', isTD);
    
    if (!isHR && !isTD) {
        console.log('🚫 ACESSO NEGADO: Usuário não é do RH nem T&D');
        return res.status(403).json({ 
            error: 'Acesso negado. Apenas usuários do RH e Treinamento & Desenvolvimento podem acessar relatórios de pesquisa.',
            userDepartment: user.departamento,
            requiredDepartments: ['RH', 'Recursos Humanos', 'Departamento Treinam&Desenvolv', 'Treinamento', 'Desenvolvimento']
        });
    }
    
    console.log('✅ ACESSO LIBERADO: Usuário autorizado');
    next();
};

// Buscar resultados da pesquisa (apenas RH e T&D)
app.get('/api/pesquisas/:id/resultados', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Buscar dados da pesquisa
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(`
                SELECT pr.*, u.NomeCompleto as criador_nome,
                       (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id) as total_respostas
                FROM PesquisasRapidas pr
                JOIN Users u ON pr.criado_por = u.Id
                WHERE pr.Id = @pesquisaId
            `);
        
        if (pesquisaResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const pesquisa = pesquisaResult.recordset[0];
        
        // Buscar perguntas se existirem
        const perguntasResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(`
                SELECT * FROM PesquisaPerguntas 
                WHERE pesquisa_id = @pesquisaId 
                ORDER BY ordem
            `);
        
        // Calcular taxa de resposta baseada no público-alvo
        let publicoAlvo = 0;
        if (pesquisa.departamentos_alvo && pesquisa.departamentos_alvo !== 'Todos' && pesquisa.departamentos_alvo !== null && pesquisa.departamentos_alvo.trim() !== '') {
            // Para departamentos específicos
            try {
                const deptResult = await pool.request()
                    .input('departamento', sql.VarChar, `%${pesquisa.departamentos_alvo}%`)
                    .query(`
                        SELECT COUNT(*) as total FROM Users 
                        WHERE Departamento LIKE @departamento AND IsActive = 1
                    `);
                publicoAlvo = deptResult.recordset[0].total;
                console.log(`Público alvo para departamento '${pesquisa.departamentos_alvo}': ${publicoAlvo} usuários`);
            } catch (error) {
                // Se a coluna IsActive não existir
                console.log('Coluna IsActive não encontrada para departamento, contando sem filtro IsActive');
                const deptResult = await pool.request()
                    .input('departamento', sql.VarChar, `%${pesquisa.departamentos_alvo}%`)
                    .query(`
                        SELECT COUNT(*) as total FROM Users 
                        WHERE Departamento LIKE @departamento
                    `);
                publicoAlvo = deptResult.recordset[0].total;
                console.log(`Público alvo para departamento '${pesquisa.departamentos_alvo}' (sem IsActive): ${publicoAlvo} usuários`);
            }
        } else {
            // Para todos os departamentos
            try {
                const totalResult = await pool.request().query(`
                    SELECT COUNT(*) as total FROM Users WHERE IsActive = 1
                `);
                publicoAlvo = totalResult.recordset[0].total;
                console.log(`Público alvo para 'Todos': ${publicoAlvo} usuários ativos`);
            } catch (error) {
                // Se a coluna IsActive não existir, contar todos os usuários
                console.log('Coluna IsActive não encontrada, contando todos os usuários');
                const totalResult = await pool.request().query(`
                    SELECT COUNT(*) as total FROM Users
                `);
                publicoAlvo = totalResult.recordset[0].total;
                console.log(`Público alvo para 'Todos' (sem IsActive): ${publicoAlvo} usuários`);
            }
        }
        
        // Garantir que temos valores válidos
        const totalRespostas = pesquisa.total_respostas || 0;
        const publicoAlvoFinal = Math.max(publicoAlvo, 1); // Evitar divisão por zero
        
        const taxaResposta = Math.round((totalRespostas / publicoAlvoFinal) * 100);
        
        // Log para debug
        console.log(`Taxa de resposta calculada: ${totalRespostas}/${publicoAlvoFinal} = ${taxaResposta}%`);
        console.log(`Departamentos alvo: '${pesquisa.departamentos_alvo}'`);
        console.log(`Tipo: ${typeof pesquisa.departamentos_alvo}`);
        
        let resultados = {
            totalRespostas: totalRespostas,
            taxaResposta: Math.min(Math.max(taxaResposta, 0), 100), // Entre 0 e 100%
            mediaScore: 0,
            publicoAlvo: publicoAlvoFinal
        };
        
        if (perguntasResult.recordset.length > 0) {
            // Pesquisa com múltiplas perguntas
            resultados.perguntas = {};
            
            for (const pergunta of perguntasResult.recordset) {
                const respostasResult = await pool.request()
                    .input('perguntaId', sql.Int, pergunta.Id)
                    .query(`
                        SELECT pr.resposta, pr.score, GETDATE() as data_resposta,
                               CASE WHEN p.anonima = 1 THEN NULL ELSE u.NomeCompleto END as autor
                        FROM PesquisaRespostas pr
                        LEFT JOIN Users u ON pr.user_id = u.Id
                        JOIN PesquisasRapidas p ON pr.pesquisa_id = p.Id
                        WHERE pr.pergunta_id = @perguntaId
                        ORDER BY pr.Id DESC
                    `);
                
                resultados.perguntas[pergunta.Id] = processarRespostasPergunta(pergunta, respostasResult.recordset);
            }
        } else {
            // Pesquisa antiga com pergunta única
            const respostasResult = await pool.request()
                .input('pesquisaId', sql.Int, parseInt(id))
                .query(`
                    SELECT pr.resposta, pr.score, GETDATE() as data_resposta,
                           CASE WHEN p.anonima = 1 THEN NULL ELSE u.NomeCompleto END as autor
                    FROM PesquisaRespostas pr
                    LEFT JOIN Users u ON pr.user_id = u.Id
                    JOIN PesquisasRapidas p ON pr.pesquisa_id = p.Id
                    WHERE pr.pesquisa_id = @pesquisaId
                    ORDER BY pr.Id DESC
                `);
            
            resultados = processarRespostasLegacy(pesquisa, respostasResult.recordset, publicoAlvo);
        }
        
        res.json(resultados);
    } catch (error) {
        console.error('Erro ao buscar resultados da pesquisa:', error);
        res.status(500).json({ error: 'Erro ao buscar resultados da pesquisa' });
    }
});

function processarRespostasPergunta(pergunta, respostas) {
    const resultado = {
        total: respostas.length
    };
    
    if (pergunta.tipo === 'multipla_escolha') {
        const opcoes = JSON.parse(pergunta.opcoes || '[]');
        resultado.opcoes = opcoes.map(opcao => ({
            opcao: opcao,
            count: respostas.filter(r => r.resposta === opcao).length
        }));
    } else if (pergunta.tipo === 'escala') {
        const min = pergunta.escala_min || 1;
        const max = pergunta.escala_max || 5;
        resultado.escala = [];
        
        for (let i = min; i <= max; i++) {
            resultado.escala.push({
                valor: i,
                count: respostas.filter(r => r.score === i).length
            });
        }
        
        const scores = respostas.filter(r => r.score).map(r => r.score);
        resultado.media = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    } else if (pergunta.tipo === 'sim_nao') {
        resultado.sim = respostas.filter(r => r.resposta === 'Sim').length;
        resultado.nao = respostas.filter(r => r.resposta === 'Não').length;
    } else {
        resultado.respostas = respostas.map(r => ({
            texto: r.resposta,
            autor: r.autor,
            data: r.data_resposta
        }));
    }
    
    return resultado;
}

function processarRespostasLegacy(pesquisa, respostas, publicoAlvo = 0) {
    // Se publicoAlvo não foi calculado corretamente, usar um valor padrão
    if (publicoAlvo === 0 && (!pesquisa.departamentos_alvo || pesquisa.departamentos_alvo === 'Todos' || pesquisa.departamentos_alvo === null)) {
        // Para pesquisas "Todos os departamentos", assumir um público mínimo
        publicoAlvo = Math.max(respostas.length, 100); // Mínimo de 100 ou o número de respostas
    }
    
    const taxaResposta = publicoAlvo > 0 ? Math.round((respostas.length / publicoAlvo) * 100) : 0;
    
    const resultado = {
        totalRespostas: respostas.length,
        taxaResposta: taxaResposta,
        mediaScore: 0,
        publicoAlvo: publicoAlvo
    };
    
    if (pesquisa.tipo_pergunta === 'multipla_escolha') {
        const opcoes = JSON.parse(pesquisa.opcoes || '[]');
        resultado.opcoes = opcoes.map(opcao => ({
            opcao: opcao,
            count: respostas.filter(r => r.resposta === opcao).length
        }));
    } else if (pesquisa.tipo_pergunta === 'escala') {
        resultado.escala = [];
        for (let i = 1; i <= 5; i++) {
            resultado.escala.push({
                valor: i,
                count: respostas.filter(r => r.score === i).length
            });
        }
        
        const scores = respostas.filter(r => r.score).map(r => r.score);
        resultado.media = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        resultado.mediaScore = resultado.media;
    } else {
        resultado.respostas = respostas.map(r => ({
            texto: r.resposta,
            autor: r.autor,
            data: r.data_resposta
        }));
    }
    
    return resultado;
}

// Buscar pesquisa específica
app.get('/api/pesquisas/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validar se o ID é um número válido
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se as colunas existem
        const hasDataInicioColumn = await checkDataInicioColumnExists();
        
        // Buscar pesquisa com filtros de data (igual ao endpoint de resposta)
        let query = `
            SELECT 
                pr.*,
                u.NomeCompleto as criador_nome,
                (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id) as total_respostas
            FROM PesquisasRapidas pr
            JOIN Users u ON pr.criado_por = u.Id
            WHERE pr.Id = @pesquisaId 
            AND pr.status = 'Ativa'
        `;
        
        if (hasDataInicioColumn) {
            query += ` AND (pr.data_inicio IS NULL OR pr.data_inicio <= GETDATE())`;
        }
        query += ` AND (pr.data_encerramento IS NULL OR pr.data_encerramento > GETDATE())`;
        
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(query);
        
        if (pesquisaResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada ou não está ativa no momento' });
        }
        
        const pesquisa = pesquisaResult.recordset[0];
        
        // Buscar perguntas da pesquisa
        const perguntasResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(`
                SELECT * FROM PesquisaPerguntas 
                WHERE pesquisa_id = @pesquisaId 
                ORDER BY ordem
            `);
        
        // Processar opções das perguntas
        const perguntas = perguntasResult.recordset.map(pergunta => {
            if (pergunta.opcoes) {
                try {
                    pergunta.opcoes = JSON.parse(pergunta.opcoes);
                } catch (e) {
                    pergunta.opcoes = [];
                }
            }
            return pergunta;
        });
        
        pesquisa.perguntas = perguntas;
        
        // Manter compatibilidade com código antigo
        if (pesquisa.opcoes) {
            try {
                pesquisa.opcoes = JSON.parse(pesquisa.opcoes);
            } catch (e) {
                pesquisa.opcoes = [];
            }
        }
        
        res.json(pesquisa);
    } catch (error) {
        console.error('Erro ao buscar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao buscar pesquisa' });
    }
});

// Responder pesquisa
app.post('/api/pesquisas/:id/responder', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { respostas } = req.body;
        const userId = req.session.user.userId;
        
        if (!respostas || respostas.length === 0) {
            return res.status(400).json({ error: 'Pelo menos uma resposta é obrigatória' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se a coluna data_inicio existe
        const hasDataInicioColumn = await checkDataInicioColumnExists();
        
        // Verificar se pesquisa existe e está ativa
        let query = `
            SELECT * FROM PesquisasRapidas 
            WHERE Id = @pesquisaId 
            AND status = 'Ativa'
        `;
        
        if (hasDataInicioColumn) {
            query += ` AND (data_inicio IS NULL OR data_inicio <= GETDATE())`;
        }
        query += ` AND (data_encerramento IS NULL OR data_encerramento > GETDATE())`;
        
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .query(query);
        
        if (pesquisaResult.recordset.length === 0) {
            return res.status(400).json({ error: 'Pesquisa não encontrada ou não está ativa' });
        }
        
        const pesquisa = pesquisaResult.recordset[0];
        
        // Verificar se usuário já respondeu (se não for anônima)
        if (!pesquisa.anonima) {
            const existingResult = await pool.request()
                .input('pesquisaId', sql.Int, id)
                .input('userId', sql.Int, userId)
                .query(`
                    SELECT Id FROM PesquisaRespostas 
                    WHERE pesquisa_id = @pesquisaId AND user_id = @userId
                `);
            
            if (existingResult.recordset.length > 0) {
                return res.status(400).json({ error: 'Você já respondeu esta pesquisa' });
            }
        }
        
        // Inserir respostas
        for (const resposta of respostas) {
            const request = pool.request()
                .input('pesquisaId', sql.Int, id)
                .input('perguntaId', sql.Int, resposta.perguntaId)
                .input('userId', sql.Int, pesquisa.anonima ? null : userId);
            
            // Validar e inserir resposta
            const respostaTexto = resposta.resposta ? String(resposta.resposta).trim() : '';
            request.input('resposta', sql.NVarChar(sql.MAX), respostaTexto || 'Sem resposta');
            
            // Validar e inserir score
            if (resposta.score !== null && resposta.score !== undefined) {
                request.input('score', sql.Int, resposta.score);
            } else {
                request.input('score', sql.Int, null);
            }
            
            await request.query(`
                INSERT INTO PesquisaRespostas (pesquisa_id, pergunta_id, user_id, resposta, score)
                VALUES (@pesquisaId, @perguntaId, @userId, @resposta, @score)
            `);
        }
        
        // Adicionar pontos por responder pesquisa (primeira vez no dia)
        let pointsResult = { success: false, points: 0, message: '' };
        if (!pesquisa.anonima) {
            pointsResult = await addPointsToUser(userId, 'pesquisa_respondida', 10, pool);
        }
        
        res.json({ 
            success: true, 
            message: 'Respostas registradas com sucesso',
            pointsEarned: pointsResult.success ? pointsResult.points : 0,
            pointsMessage: pointsResult.message
        });
    } catch (error) {
        console.error('Erro ao responder pesquisa:', error);
        res.status(500).json({ error: 'Erro ao responder pesquisa' });
    }
});

// Buscar resultados de uma pesquisa (duplicada - removendo)
// Esta rota está duplicada e será removida
/*
app.get('/api/pesquisas/:id/resultados', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Buscar pesquisa
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .query(`
                SELECT * FROM PesquisasRapidas WHERE Id = @pesquisaId
            `);
        
        if (pesquisaResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const pesquisa = pesquisaResult.recordset[0];
        
        // Buscar respostas
        const respostasResult = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .query(`
                SELECT 
                    pr.*,
                    u.NomeCompleto as user_name,
                    u.Departamento as user_department
                FROM PesquisaRespostas pr
                LEFT JOIN Users u ON pr.user_id = u.Id
                WHERE pr.pesquisa_id = @pesquisaId
                ORDER BY pr.Id DESC
            `);
        
        const respostas = respostasResult.recordset;
        
        // Calcular estatísticas baseadas no tipo de pergunta
        let estatisticas = {};
        
        if (pesquisa.tipo_pergunta === 'escala') {
            const scores = respostas.filter(r => r.score).map(r => r.score);
            estatisticas = {
                total: scores.length,
                media: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0,
                min: scores.length > 0 ? Math.min(...scores) : 0,
                max: scores.length > 0 ? Math.max(...scores) : 0
            };
        } else if (pesquisa.tipo_pergunta === 'multipla_escolha') {
            const opcoes = JSON.parse(pesquisa.opcoes || '[]');
            const contadores = {};
            
            opcoes.forEach(opcao => {
                contadores[opcao] = respostas.filter(r => r.resposta === opcao).length;
            });
            
            estatisticas = {
                total: respostas.length,
                opcoes: contadores
            };
        } else {
            estatisticas = {
                total: respostas.length
            };
        }
        
        res.json({
            pesquisa,
            respostas,
            estatisticas
        });
    } catch (error) {
        console.error('Erro ao buscar resultados:', error);
        res.status(500).json({ error: 'Erro ao buscar resultados' });
    }
});
*/

// Exportar resultados da pesquisa (apenas RH e T&D)
app.get('/api/pesquisas/:id/export', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const { formato = 'csv' } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // Buscar dados da pesquisa
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(`
                SELECT pr.*, u.NomeCompleto as criador_nome
                FROM PesquisasRapidas pr
                JOIN Users u ON pr.criado_por = u.Id
                WHERE pr.Id = @pesquisaId
            `);
        
        if (pesquisaResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const pesquisa = pesquisaResult.recordset[0];
        
        // Buscar respostas
        const respostasResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    pr.resposta,
                    pr.score,
                    pr.created_at,
                    CASE WHEN p.anonima = 1 THEN 'Anônimo' ELSE u.NomeCompleto END as autor,
                    u.Departamento
                FROM PesquisaRespostas pr
                LEFT JOIN Users u ON pr.user_id = u.Id
                JOIN PesquisasRapidas p ON pr.pesquisa_id = p.Id
                WHERE pr.pesquisa_id = @pesquisaId
                ORDER BY pr.created_at DESC
            `);
        
        const respostas = respostasResult.recordset;
        
        if (formato === 'csv') {
            let csvContent = 'Resposta,Score,Data,Autor,Departamento\n';
            respostas.forEach(resposta => {
                const data = new Date(resposta.created_at).toLocaleDateString('pt-BR');
                csvContent += `"${resposta.resposta || ''}",${resposta.score || ''},${data},"${resposta.autor || ''}","${resposta.Departamento || ''}"\n`;
            });
            
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="resultados-${pesquisa.titulo}-${new Date().toISOString().split('T')[0]}.csv"`);
            res.send('\uFEFF' + csvContent); // BOM para UTF-8
        } else if (formato === 'excel') {
            // Para Excel, usar CSV com separador de ponto e vírgula
            let csvContent = 'Resposta;Score;Data;Autor;Departamento\n';
            respostas.forEach(resposta => {
                const data = new Date(resposta.created_at).toLocaleDateString('pt-BR');
                csvContent += `"${resposta.resposta || ''}";${resposta.score || ''};${data};"${resposta.autor || ''}";"${resposta.Departamento || ''}"\n`;
            });
            
            res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="resultados-${pesquisa.titulo}-${new Date().toISOString().split('T')[0]}.xls"`);
            res.send('\uFEFF' + csvContent); // BOM para UTF-8
        } else {
            res.status(400).json({ error: 'Formato não suportado' });
        }
    } catch (error) {
        console.error('Erro ao exportar resultados:', error);
        res.status(500).json({ error: 'Erro ao exportar resultados' });
    }
});

// Encerrar pesquisa (apenas RH)
app.put('/api/pesquisas/:id/encerrar', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // RH pode encerrar qualquer pesquisa, não apenas as que criou
        const result = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .query(`
                UPDATE PesquisasRapidas 
                SET status = 'Encerrada'
                WHERE Id = @pesquisaId
            `);
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        res.json({ success: true, message: 'Pesquisa encerrada com sucesso' });
    } catch (error) {
        console.error('Erro ao encerrar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao encerrar pesquisa' });
    }
});

// Buscar pesquisas disponíveis para o usuário
app.get('/api/pesquisas/disponiveis', requireAuth, async (req, res) => {
    try {
        // Atualizar status das pesquisas antes de buscar
        await updatePesquisaStatus();
        
        const userId = req.session.user.userId;
        const userDepartment = req.session.user.departamento;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se as colunas existem
        const hasDataInicioColumn = await checkDataInicioColumnExists();
        const hasFilialAlvoColumn = await checkFilialAlvoColumnExists();
        
        let query = `
            SELECT 
                pr.*,
                u.NomeCompleto as criador_nome,
                (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id) as total_respostas,
                CASE 
                    WHEN pr.anonima = 1 THEN NULL
                    ELSE (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id AND user_id = @userId)
                END as ja_respondeu
            FROM PesquisasRapidas pr
            JOIN Users u ON pr.criado_por = u.Id
            WHERE pr.status = 'Ativa'
        `;
        
        if (hasDataInicioColumn) {
            query += ` AND (pr.data_inicio IS NULL OR pr.data_inicio <= GETDATE())`;
        }
        query += ` AND (pr.data_encerramento IS NULL OR pr.data_encerramento > GETDATE())`;
        // CORREÇÃO: Buscar o código do departamento do usuário para comparação correta
        // Agora usa CPF para evitar ambiguidade
        let userDeptCode = null;
        try {
            const deptCodeResult = await pool.request()
                .input('departamento', sql.VarChar, userDepartment)
                .input('userCpf', sql.VarChar, req.session.user.cpf)  // ✅ Adicionar CPF
                .query(`
                    SELECT TOP 1 
                        CASE 
                            WHEN h.NIVEL_4_DEPARTAMENTO IS NOT NULL THEN h.NIVEL_4_DEPARTAMENTO
                            WHEN h.DEPTO_ATUAL IS NOT NULL THEN h.DEPTO_ATUAL
                            WHEN ISNUMERIC(s.DEPARTAMENTO) = 1 THEN s.DEPARTAMENTO
                            ELSE NULL
                        END as DEPARTAMENTO_CODIGO
                    FROM TAB_HIST_SRA s
                    LEFT JOIN HIERARQUIA_CC h ON (
                        s.DEPARTAMENTO = h.NIVEL_4_DEPARTAMENTO 
                        OR s.DEPARTAMENTO = h.DEPTO_ATUAL
                    )
                    WHERE s.STATUS_GERAL = 'ATIVO'
                    AND s.CPF = @userCpf  -- ✅ Filtro por CPF para evitar ambiguidade
                    AND (
                        h.NIVEL_4_DEPARTAMENTO_DESC = @departamento
                        OR h.DESCRICAO_ATUAL = @departamento
                        OR s.DEPARTAMENTO = @departamento
                    )
                `);
            
            if (deptCodeResult.recordset.length > 0) {
                userDeptCode = deptCodeResult.recordset[0].DEPARTAMENTO_CODIGO;
            }
        } catch (error) {
            console.log('Erro ao buscar código do departamento:', error);
        }
        
        // Construir filtro de departamentos (CORRIGIDO)
        // Problema: LIKE '%${userDeptCode}%' pode não funcionar corretamente com códigos numéricos
        // Solução: Usar comparações mais precisas e considerar tanto códigos quanto descrições
        let deptFilter = '(pr.departamentos_alvo IS NULL OR pr.departamentos_alvo = \'Todos\'';
        
        if (userDeptCode) {
            // Comparação exata com o código do departamento
            deptFilter += ` OR pr.departamentos_alvo = '${userDeptCode}'`;
            // Comparação com LIKE para casos onde há múltiplos códigos separados por vírgula
            deptFilter += ` OR pr.departamentos_alvo LIKE '%${userDeptCode}%'`;
        }
        
        // Também verificar por descrição do departamento para maior compatibilidade
        if (userDepartment) {
            deptFilter += ` OR pr.departamentos_alvo LIKE '%${userDepartment}%'`;
        }
        
        deptFilter += ')';
        
        console.log('🏢 Filtro de departamento construído:', deptFilter);
        console.log('🔍 Código do departamento do usuário:', userDeptCode);
        console.log('👤 Departamento do usuário (descrição):', userDepartment);
        
        query += ` AND ${deptFilter}`;
        
        // Adicionar filtro de filial se a coluna existir
        if (hasFilialAlvoColumn) {
            const currentUser = req.session.user;
            const userUnidade = currentUser.unidade || '';
            console.log('🏢 Filtro de filial - Usuário unidade:', userUnidade);
            query += ` AND (
                pr.filial_alvo IS NULL 
                OR pr.filial_alvo = 'Todas' 
                OR pr.filial_alvo = '${userUnidade}'
            )`;
        }
        
        query += ` ORDER BY pr.Id DESC`;
        
        // Primeiro, vamos ver todas as pesquisas ativas sem filtros para debug
        const allPesquisasQuery = `
            SELECT pr.*, u.NomeCompleto as criador_nome
            FROM PesquisasRapidas pr
            JOIN Users u ON pr.criado_por = u.Id
            WHERE pr.status = 'Ativa'
        `;
        
        const allPesquisasResult = await pool.request().query(allPesquisasQuery);
        console.log('📋 TODAS as pesquisas ativas:', allPesquisasResult.recordset.length);
        allPesquisasResult.recordset.forEach(p => {
            console.log(`  - ID: ${p.Id}, Título: ${p.titulo}, Departamentos: ${p.departamentos_alvo}, Filial: ${p.filial_alvo}`);
        });
        
        console.log('🔍 Query final para pesquisas disponíveis:', query);
        console.log('👤 Usuário:', req.session.user.nomeCompleto, '- Departamento:', userDepartment, '- Unidade:', req.session.user.unidade);
        console.log('🏢 Código do departamento encontrado:', userDeptCode);
        
        let result;
        try {
            console.log('🚀 Executando query final...');
            result = await pool.request()
                .input('userId', sql.Int, userId)
                .query(query);
            
            console.log('📊 Pesquisas encontradas após filtros:', result.recordset.length);
            if (result.recordset.length > 0) {
                result.recordset.forEach(p => {
                    console.log(`  ✅ ID: ${p.Id}, Título: ${p.titulo}, Departamentos: ${p.departamentos_alvo}, Filial: ${p.filial_alvo}`);
                });
            }
        } catch (queryError) {
            console.error('❌ Erro na execução da query:', queryError);
            console.error('🔍 Query que falhou:', query);
            throw queryError;
        }
        
        const pesquisas = result.recordset.map(p => {
            if (p.opcoes) {
                p.opcoes = JSON.parse(p.opcoes);
            }
            return p;
        });
        
        res.json(pesquisas);
    } catch (error) {
        console.error('Erro ao buscar pesquisas disponíveis:', error);
        res.status(500).json({ error: 'Erro ao buscar pesquisas disponíveis' });
    }
});

// ===== DASHBOARD GERENCIAL =====

// Dashboard gerencial para gestores
app.get('/api/manager/dashboard', requireAuth, async (req, res) => {
    try {
        console.log('🔍 Iniciando /api/manager/dashboard');
        const userId = req.session.user.userId;
        console.log('👤 UserId:', userId);
        
        const pool = await sql.connect(dbConfig);
        console.log('✅ Conexão com banco estabelecida');
        
        // Verificar se é gestor
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT RoleId FROM Users WHERE Id = @userId
            `);
        
        console.log('👤 RoleId encontrado:', userResult.recordset[0]?.RoleId);
        const isManager = userResult.recordset[0]?.RoleId === 2; // Assumindo que RoleId 2 é manager
        
        if (!isManager) {
            console.log('❌ Usuário não é gestor');
            return res.status(403).json({ error: 'Acesso negado. Apenas gestores podem acessar este dashboard.' });
        }
        
        console.log('✅ Usuário é gestor, buscando equipe...');
        
        // Buscar equipe do gestor usando hierarquia
        const userInfo = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT u.Matricula, u.HierarchyPath, u.Departamento
                FROM Users u
                WHERE u.Id = @userId
            `);
        
        const userData = userInfo.recordset[0];
        if (!userData) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        console.log('👤 Dados do usuário:', userData);
        
        // Buscar membros da equipe baseado na hierarquia
        let teamQuery = '';
        let teamParams = {};
        
        if (userData.HierarchyPath) {
            // Se tem hierarquia definida, buscar usuários que trabalham sob essa hierarquia
            teamQuery = `
                SELECT u.Id, u.NomeCompleto, u.Departamento, u.Departamento, u.LastLogin
                FROM Users u
                WHERE u.HierarchyPath LIKE @hierarchyPath + '%'
                AND u.Id != @userId
                AND u.IsActive = 1
            `;
            teamParams = {
                hierarchyPath: userData.HierarchyPath,
                userId: userId
            };
        } else {
            // Se não tem hierarquia, buscar por departamento
            teamQuery = `
                SELECT u.Id, u.NomeCompleto, u.Departamento, u.Departamento, u.LastLogin
                FROM Users u
                WHERE u.Departamento = @departamento
                AND u.Id != @userId
                AND u.IsActive = 1
            `;
            teamParams = {
                departamento: userData.Departamento,
                userId: userId
            };
        }
        
        const teamResult = await pool.request()
            .input('hierarchyPath', sql.VarChar, teamParams.hierarchyPath)
            .input('departamento', sql.VarChar, teamParams.departamento)
            .input('userId', sql.Int, teamParams.userId)
            .query(teamQuery);
        
        const team = teamResult.recordset;
        const teamIds = team.map(member => member.Id);
        console.log('👥 Equipe encontrada:', teamIds.length, 'membros');
        
        if (teamIds.length === 0) {
            console.log('ℹ️ Nenhum membro na equipe, retornando dados vazios');
            return res.json({
                teamSize: 0,
                teamMembers: [],
                metrics: {
                    totalFeedbacks: 0,
                    totalRecognitions: 0,
                    averageMood: 0,
                    activeObjectives: 0
                }
            });
        }
        
        console.log('📊 Calculando métricas da equipe...');
        
        // Métricas da equipe - versão simplificada para evitar problemas com colunas
        const teamIdsList = teamIds.join(',');
        console.log('🔢 TeamIds para query:', teamIdsList);
        
        // Query simplificada para evitar problemas com colunas inexistentes
        const metricsResult = await pool.request()
            .query(`
                SELECT 
                    0 as totalFeedbacks,
                    0 as totalRecognitions,
                    0 as averageMood,
                    0 as activeObjectives
            `);
        
        const metrics = metricsResult.recordset[0];
        console.log('📈 Métricas calculadas:', metrics);
        
        const response = {
            teamSize: team.length,
            teamMembers: team,
            metrics: {
                totalFeedbacks: metrics.totalFeedbacks || 0,
                totalRecognitions: metrics.totalRecognitions || 0,
                averageMood: metrics.averageMood || 0,
                activeObjectives: metrics.activeObjectives || 0
            }
        };
        
        console.log('✅ Dashboard gerencial concluído com sucesso');
        res.json(response);
    } catch (error) {
        console.error('❌ Erro ao buscar dashboard gerencial:', error);
        res.status(500).json({ error: 'Erro ao buscar dashboard gerencial', details: error.message });
    }
});

// Gestão de humor da equipe
app.get('/api/manager/team-mood', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const { startDate, endDate, department } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se é gestor
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT RoleId FROM Users WHERE Id = @userId
            `);
        
        const isManager = userResult.recordset[0]?.RoleId === 2;
        
        if (!isManager) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        // CORREÇÃO: Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF)
        let query = `
            SELECT 
                dm.Score,
                dm.Description,
                dm.CreatedAt,
                u.NomeCompleto,
                u.Departamento,
                u.Departamento
            FROM DailyMood dm
            JOIN Users u ON dm.UserId = u.Id
            INNER JOIN TAB_HIST_SRA s 
                ON u.Matricula = s.MATRICULA
                AND u.CPF = s.CPF  -- ✅ Chave composta
            INNER JOIN HIERARQUIA_CC h ON (
                (h.RESPONSAVEL_ATUAL = (SELECT Matricula FROM Users WHERE Id = @managerId)
                 AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                OR (h.NIVEL_1_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                    AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                OR (h.NIVEL_2_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                    AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                OR (h.NIVEL_3_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                    AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                OR (h.NIVEL_4_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                    AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
            )
            WHERE u.IsActive = 1
            AND s.STATUS_GERAL = 'ATIVO'
            AND (
                TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL)
                OR TRIM(s.DEPARTAMENTO) = TRIM(h.DESCRICAO_ATUAL)
                OR s.MATRICULA = h.RESPONSAVEL_ATUAL
            )
        `;
        
        const request = pool.request().input('managerId', sql.Int, userId);
        
        if (startDate) {
            query += " AND CAST(dm.CreatedAt AS DATE) >= @startDate";
            request.input('startDate', sql.Date, new Date(startDate));
        }
        
        if (endDate) {
            query += " AND CAST(dm.CreatedAt AS DATE) <= @endDate";
            request.input('endDate', sql.Date, new Date(endDate));
        }
        
        if (department) {
            query += " AND u.Departamento = @department";
            request.input('department', sql.VarChar, department);
        }
        
        query += " ORDER BY dm.CreatedAt DESC";
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar humor da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar humor da equipe' });
    }
});

// ===== NOVAS APIs PARA RELATÓRIOS =====

// API para relatórios e análises
app.get('/api/analytics', requireAuth, async (req, res) => {
    try {
        const { period = 30, department = '', type = 'engagement' } = req.query;
        const userId = req.session.user.userId;
        const userHierarchy = req.session.user.hierarchyLevel;
        const userDepartment = req.session.user.departamento;
        const pool = await sql.connect(dbConfig);
        
        // Calcular datas baseado no período
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(period));
        
        // Filtro de departamento baseado na hierarquia e função
        let departmentFilter = '';
        const userRole = req.session.user.role || '';
        
        // Detectar RH e T&D baseado no departamento (mais confiável que role)
        const isRH = userDepartment.toUpperCase().includes('RH') || 
                     userDepartment.toUpperCase().includes('RECURSOS HUMANOS');
        const isTD = userDepartment.toUpperCase().includes('T&D') || 
                     userDepartment.toUpperCase().includes('TREINAMENTO') || 
                     userDepartment.toUpperCase().includes('DESENVOLVIMENTO') ||
                     userDepartment.toUpperCase().includes('TREINAM&DESENVOLV');
        
        
        if (department && department !== '') {
            departmentFilter = `AND u.Departamento = '${department}'`;
        } else if (!isRH && !isTD) {
            // Gestores e usuários comuns veem apenas seu departamento (independente do hierarchyLevel)
            departmentFilter = `AND u.Departamento = '${userDepartment}'`;
        }
        // RH e T&D não têm filtro adicional - veem todos os departamentos
        
        // Buscar métricas de participação
        const participationResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    COUNT(DISTINCT u.Id) as totalUsers,
                    COUNT(DISTINCT CASE WHEN dm.user_id IS NOT NULL THEN u.Id END) as usersWithMood,
                    COUNT(DISTINCT CASE WHEN f.from_user_id IS NOT NULL THEN u.Id END) as usersWithFeedback,
                    COUNT(DISTINCT CASE WHEN r.from_user_id IS NOT NULL THEN u.Id END) as usersWithRecognition
                FROM Users u
                LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                    AND CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
                LEFT JOIN Feedbacks f ON u.Id = f.from_user_id 
                    AND CAST(f.created_at AS DATE) BETWEEN @startDate AND @endDate
                LEFT JOIN Recognitions r ON u.Id = r.from_user_id 
                    AND CAST(r.created_at AS DATE) BETWEEN @startDate AND @endDate
                WHERE u.IsActive = 1 ${departmentFilter}
            `);
        
        // Buscar métricas de satisfação (eNPS baseado em humor)
        const satisfactionResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    AVG(CAST(dm.score AS FLOAT)) as averageMood,
                    COUNT(CASE WHEN dm.score >= 4 THEN 1 END) as promoters,
                    COUNT(CASE WHEN dm.score <= 2 THEN 1 END) as detractors,
                    COUNT(dm.score) as totalResponses
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                WHERE CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
                AND u.IsActive = 1 ${departmentFilter}
            `);
        
        // Buscar métricas de tendências
        const trendsResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    COUNT(f.Id) as totalFeedbacks,
                    COUNT(r.Id) as totalRecognitions,
                    COUNT(dm.Id) as totalMoodEntries
                FROM Users u
                LEFT JOIN Feedbacks f ON u.Id = f.from_user_id 
                    AND CAST(f.created_at AS DATE) BETWEEN @startDate AND @endDate
                LEFT JOIN Recognitions r ON u.Id = r.from_user_id 
                    AND CAST(r.created_at AS DATE) BETWEEN @startDate AND @endDate
                LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                    AND CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
                WHERE u.IsActive = 1 ${departmentFilter}
            `);
        
        // Buscar distribuição por departamento
        const distributionResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    u.Departamento,
                    COUNT(DISTINCT u.Id) as totalUsers,
                    AVG(CAST(dm.score AS FLOAT)) as avgMood,
                    COUNT(f.Id) as totalFeedbacks,
                    COUNT(r.Id) as totalRecognitions
                FROM Users u
                LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                    AND CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
                LEFT JOIN Feedbacks f ON u.Id = f.from_user_id 
                    AND CAST(f.created_at AS DATE) BETWEEN @startDate AND @endDate
                LEFT JOIN Recognitions r ON u.Id = r.from_user_id 
                    AND CAST(r.created_at AS DATE) BETWEEN @startDate AND @endDate
                WHERE u.IsActive = 1 ${departmentFilter}
                GROUP BY u.Departamento
                ORDER BY totalUsers DESC
            `);
        
        const participation = participationResult.recordset[0];
        const satisfaction = satisfactionResult.recordset[0];
        const trends = trendsResult.recordset[0];
        const distribution = distributionResult.recordset;
        
        // Calcular eNPS
        const totalResponses = satisfaction.totalResponses || 0;
        const promoters = satisfaction.promoters || 0;
        const detractors = satisfaction.detractors || 0;
        const eNPS = totalResponses > 0 ? Math.round(((promoters - detractors) / totalResponses) * 100) : 0;
        
        res.json({
            participation: {
                totalUsers: participation.totalUsers || 0,
                usersWithMood: participation.usersWithMood || 0,
                usersWithFeedback: participation.usersWithFeedback || 0,
                usersWithRecognition: participation.usersWithRecognition || 0,
                moodParticipationRate: participation.totalUsers > 0 ? 
                    Math.round((participation.usersWithMood / participation.totalUsers) * 100) : 0,
                feedbackParticipationRate: participation.totalUsers > 0 ? 
                    Math.round((participation.usersWithFeedback / participation.totalUsers) * 100) : 0,
                recognitionParticipationRate: participation.totalUsers > 0 ? 
                    Math.round((participation.usersWithRecognition / participation.totalUsers) * 100) : 0
            },
            satisfaction: {
                averageMood: Math.round((satisfaction.averageMood || 0) * 10) / 10,
                eNPS: eNPS,
                promoters: promoters,
                detractors: detractors,
                totalResponses: totalResponses
            },
            trends: {
                totalFeedbacks: trends.totalFeedbacks || 0,
                totalRecognitions: trends.totalRecognitions || 0,
                totalMoodEntries: trends.totalMoodEntries || 0
            },
            distribution: distribution.map(dept => ({
                department: dept.Departamento || 'Sem departamento',
                totalUsers: dept.totalUsers || 0,
                avgMood: Math.round((dept.avgMood || 0) * 10) / 10,
                totalFeedbacks: dept.totalFeedbacks || 0,
                totalRecognitions: dept.totalRecognitions || 0
            }))
        });
    } catch (error) {
        console.error('Erro ao buscar analytics:', error);
        res.status(500).json({ error: 'Erro ao buscar analytics' });
    }
});

// API para análise temporal (últimos 3 meses, média semanal) - REMOVIDA (duplicada)
// A implementação correta está na linha 7648 com hierarchyManager

// API simples para lista de departamentos (para pesquisa inteligente)
app.get('/api/departments', requireAuth, async (req, res) => {
    try {
        const userDepartment = req.session.user.departamento;
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT DISTINCT u.Departamento
            FROM Users u
            WHERE u.IsActive = 1 AND u.Departamento IS NOT NULL AND u.Departamento != ''
        `;
        
        // RH e T&D veem todos os departamentos
        const isRH = userDepartment.toUpperCase().includes('RH') || 
                     userDepartment.toUpperCase().includes('RECURSOS HUMANOS');
        const isTD = userDepartment.toUpperCase().includes('T&D') || 
                     userDepartment.toUpperCase().includes('TREINAMENTO') || 
                     userDepartment.toUpperCase().includes('DESENVOLVIMENTO') ||
                     userDepartment.toUpperCase().includes('TREINAM&DESENVOLV');
        
        if (!isRH && !isTD) {
            // Gestores e usuários comuns veem apenas seu departamento
            query += ` AND u.Departamento = '${userDepartment}'`;
        }
        
        query += ` ORDER BY u.Departamento`;
        
        const result = await pool.request().query(query);
        const departments = result.recordset.map(row => row.Departamento);
        
        res.json(departments);
    } catch (error) {
        console.error('Erro ao buscar departamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar departamentos' });
    }
});

// API para lista de departamentos
app.get('/api/analytics/departments-list', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const userHierarchy = req.session.user.hierarchyLevel;
        const userDepartment = req.session.user.departamento;
        const userRole = req.session.user.role || '';
        const pool = await sql.connect(dbConfig);
        
        let query = `
            SELECT DISTINCT 
                u.Departamento as codigo,
                COALESCE(h.DESCRICAO_ATUAL, u.Departamento) as descricao
            FROM Users u
            LEFT JOIN HIERARQUIA_CC h ON u.Departamento = h.DEPTO_ATUAL
            WHERE u.IsActive = 1 AND u.Departamento IS NOT NULL AND u.Departamento != ''
        `;
        
        // RH e T&D veem todos os departamentos
        // Gestores veem apenas seu departamento
        // Outros usuários veem apenas seu departamento
        const isRH = userDepartment.toUpperCase().includes('RH') || 
                     userDepartment.toUpperCase().includes('RECURSOS HUMANOS');
        const isTD = userDepartment.toUpperCase().includes('T&D') || 
                     userDepartment.toUpperCase().includes('TREINAMENTO') || 
                     userDepartment.toUpperCase().includes('DESENVOLVIMENTO') ||
                     userDepartment.toUpperCase().includes('TREINAM&DESENVOLV');
        
        if (!isRH && !isTD) {
            // Gestores e usuários comuns veem apenas seu departamento (independente do hierarchyLevel)
            query += ` AND u.Departamento = '${userDepartment}'`;
        }
        // RH e T&D não têm filtro adicional - veem todos os departamentos
        
        query += ` ORDER BY descricao`;
        
        const result = await pool.request().query(query);
        const departments = result.recordset.map(row => ({
            codigo: row.codigo,
            descricao: row.descricao
        }));
        
        res.json(departments);
    } catch (error) {
        console.error('Erro ao buscar departamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar departamentos' });
    }
});

// Função auxiliar para buscar dados de analytics
async function getAnalyticsData(pool, startDate, endDate, departmentFilter) {
    // Buscar métricas de participação
    const participationResult = await pool.request()
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .query(`
            SELECT 
                COUNT(DISTINCT u.Id) as totalUsers,
                COUNT(DISTINCT CASE WHEN dm.user_id IS NOT NULL THEN u.Id END) as usersWithMood,
                COUNT(DISTINCT CASE WHEN f.from_user_id IS NOT NULL THEN u.Id END) as usersWithFeedback,
                COUNT(DISTINCT CASE WHEN r.from_user_id IS NOT NULL THEN u.Id END) as usersWithRecognition
            FROM Users u
            LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                AND CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
            LEFT JOIN Feedbacks f ON u.Id = f.from_user_id 
                AND CAST(f.created_at AS DATE) BETWEEN @startDate AND @endDate
            LEFT JOIN Recognitions r ON u.Id = r.from_user_id 
                AND CAST(r.created_at AS DATE) BETWEEN @startDate AND @endDate
            WHERE u.IsActive = 1 ${departmentFilter}
        `);
    
    // Buscar métricas de satisfação
    const satisfactionResult = await pool.request()
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .query(`
            SELECT 
                AVG(CAST(dm.score AS FLOAT)) as averageMood,
                COUNT(CASE WHEN dm.score >= 4 THEN 1 END) as promoters,
                COUNT(CASE WHEN dm.score <= 2 THEN 1 END) as detractors,
                COUNT(dm.score) as totalResponses
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
            AND u.IsActive = 1 ${departmentFilter}
        `);
    
    return {
        participation: participationResult.recordset[0],
        satisfaction: satisfactionResult.recordset[0]
    };
}

// Função auxiliar para buscar dados temporais
async function getTemporalData(pool, startDate, endDate, departmentFilter) {
    const moodResult = await pool.request()
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .query(`
            SELECT 
                DATEPART(year, dm.created_at) as year,
                DATEPART(week, dm.created_at) as week,
                AVG(CAST(dm.score AS FLOAT)) as averageMood,
                COUNT(DISTINCT dm.user_id) as participants,
                MIN(CAST(dm.created_at AS DATE)) as weekStart,
                MAX(CAST(dm.created_at AS DATE)) as weekEnd
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
            AND u.IsActive = 1 ${departmentFilter}
            GROUP BY DATEPART(year, dm.created_at), DATEPART(week, dm.created_at)
            ORDER BY year, week
        `);
    
    return moodResult.recordset;
}

// Função auxiliar para buscar dados brutos para exportação
async function getRawDataForExport(pool, startDate, endDate, departmentFilter) {
    // Função auxiliar para adaptar o filtro de departamento ao alias usado
    function adaptDepartmentFilter(filter, alias) {
        if (!filter || filter.trim() === '') return '';
        // Substituir 'u.Departamento' pelo alias correto
        return filter.replace(/u\./g, `${alias}.`);
    }

    // Buscar dados de humor (usa alias 'u')
    const moodResult = await pool.request()
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .query(`
            SELECT 
                u.NomeCompleto as usuario,
                u.Departamento as departamento,
                dm.score as humor_score,
                dm.description as humor_descricao,
                dm.created_at as data_registro
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
            AND u.IsActive = 1 ${departmentFilter}
            ORDER BY dm.created_at DESC
        `);
    
    // Buscar dados de feedbacks (usa aliases 'u1' e 'u2', aplicar filtro em 'u1')
    const feedbackResult = await pool.request()
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .query(`
            SELECT 
                u1.NomeCompleto as remetente,
                u2.NomeCompleto as destinatario,
                u1.Departamento as dept_remetente,
                u2.Departamento as dept_destinatario,
                f.message as mensagem,
                f.created_at as data_envio
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE CAST(f.created_at AS DATE) BETWEEN @startDate AND @endDate
            AND u1.IsActive = 1 AND u2.IsActive = 1 ${adaptDepartmentFilter(departmentFilter, 'u1')}
            ORDER BY f.created_at DESC
        `);
    
    // Buscar dados de reconhecimentos (usa aliases 'u1' e 'u2', aplicar filtro em 'u1')
    const recognitionResult = await pool.request()
        .input('startDate', sql.Date, startDate)
        .input('endDate', sql.Date, endDate)
        .query(`
            SELECT 
                u1.NomeCompleto as remetente,
                u2.NomeCompleto as destinatario,
                u1.Departamento as dept_remetente,
                u2.Departamento as dept_destinatario,
                r.badge as badge,
                r.message as mensagem,
                r.created_at as data_envio
            FROM Recognitions r
            JOIN Users u1 ON r.from_user_id = u1.Id
            JOIN Users u2 ON r.to_user_id = u2.Id
            WHERE CAST(r.created_at AS DATE) BETWEEN @startDate AND @endDate
            AND u1.IsActive = 1 AND u2.IsActive = 1 ${adaptDepartmentFilter(departmentFilter, 'u1')}
            ORDER BY r.created_at DESC
        `);
    
    return {
        humor: moodResult.recordset,
        feedbacks: feedbackResult.recordset,
        recognitions: recognitionResult.recordset
    };
}

// Analytics avançados
app.get('/api/manager/analytics', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const { period } = req.query; // 'week', 'month', 'quarter'
        const pool = await sql.connect(dbConfig);
        
        // Verificar se é gestor
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT RoleId FROM Users WHERE Id = @userId
            `);
        
        const isManager = userResult.recordset[0]?.RoleId === 2;
        
        if (!isManager) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        // CORREÇÃO: Buscar equipe do gestor com CHAVE COMPOSTA (MATRÍCULA + CPF)
        const teamResult = await pool.request()
            .input('managerId', sql.Int, userId)
            .query(`
                SELECT DISTINCT u.Id 
                FROM Users u
                INNER JOIN TAB_HIST_SRA s 
                    ON u.Matricula = s.MATRICULA
                    AND u.CPF = s.CPF  -- ✅ Chave composta
                INNER JOIN HIERARQUIA_CC h ON (
                    (h.RESPONSAVEL_ATUAL = (SELECT Matricula FROM Users WHERE Id = @managerId)
                     AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_1_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_2_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_3_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                    OR (h.NIVEL_4_MATRICULA_RESP = (SELECT Matricula FROM Users WHERE Id = @managerId)
                        AND h.CPF_RESPONSAVEL = (SELECT CPF FROM Users WHERE Id = @managerId))
                )
                WHERE u.IsActive = 1
                AND s.STATUS_GERAL = 'ATIVO'
                AND (
                    TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL)
                    OR TRIM(s.DEPARTAMENTO) = TRIM(h.DESCRICAO_ATUAL)
                    OR s.MATRICULA = h.RESPONSAVEL_ATUAL
                )
            `);
        
        const teamIds = teamResult.recordset.map(member => member.Id);
        
        if (teamIds.length === 0) {
            return res.json({
                eNPS: 0,
                totalCelebrations: 0,
                totalFeedbacks: 0,
                averageMood: 0,
                trends: []
            });
        }
        
        // Calcular período
        let dateFilter = '';
        switch (period) {
            case 'week':
                dateFilter = "AND CAST(CreatedAt AS DATE) >= CAST(DATEADD(day, -7, GETDATE()) AS DATE)";
                break;
            case 'month':
                dateFilter = "AND CAST(CreatedAt AS DATE) >= CAST(DATEADD(month, -1, GETDATE()) AS DATE)";
                break;
            case 'quarter':
                dateFilter = "AND CAST(CreatedAt AS DATE) >= CAST(DATEADD(month, -3, GETDATE()) AS DATE)";
                break;
            default:
                dateFilter = "AND CAST(CreatedAt AS DATE) >= CAST(DATEADD(month, -1, GETDATE()) AS DATE)";
        }
        
        // Métricas principais
        const metricsResult = await pool.request()
            .input('teamIds', sql.VarChar, teamIds.join(','))
            .query(`
                SELECT 
                    (SELECT COUNT(*) FROM Recognitions WHERE ToUserId IN (${teamIds.map(() => '?').join(',')}) ${dateFilter}) as totalCelebrations,
                    (SELECT COUNT(*) FROM Feedbacks WHERE ToUserId IN (${teamIds.map(() => '?').join(',')}) ${dateFilter}) as totalFeedbacks,
                    (SELECT AVG(CAST(Score AS FLOAT)) FROM DailyMood WHERE UserId IN (${teamIds.map(() => '?').join(',')}) ${dateFilter}) as averageMood
            `);
        
        const metrics = metricsResult.recordset[0];
        
        // Calcular E-NPS (simplificado)
        const enpsResult = await pool.request()
            .input('teamIds', sql.VarChar, teamIds.join(','))
            .query(`
                SELECT 
                    COUNT(CASE WHEN Score >= 4 THEN 1 END) as promoters,
                    COUNT(CASE WHEN Score <= 2 THEN 1 END) as detractors,
                    COUNT(*) as total
                FROM DailyMood 
                WHERE UserId IN (${teamIds.map(() => '?').join(',')}) ${dateFilter}
            `);
        
        const enpsData = enpsResult.recordset[0];
        const eNPS = enpsData.total > 0 ? 
            ((enpsData.promoters - enpsData.detractors) / enpsData.total) * 100 : 0;
        
        // Tendências (últimos 7 dias)
        const trendsResult = await pool.request()
            .input('teamIds', sql.VarChar, teamIds.join(','))
            .query(`
                SELECT 
                    CAST(CreatedAt AS DATE) as date,
                    COUNT(*) as feedbacks,
                    AVG(CAST(Score AS FLOAT)) as mood
                FROM (
                    SELECT CreatedAt, NULL as Score FROM Feedbacks 
                    WHERE ToUserId IN (${teamIds.map(() => '?').join(',')})
                    UNION ALL
                    SELECT CreatedAt, Score FROM DailyMood 
                    WHERE UserId IN (${teamIds.map(() => '?').join(',')})
                ) combined
                WHERE CAST(CreatedAt AS DATE) >= CAST(DATEADD(day, -7, GETDATE()) AS DATE)
                GROUP BY CAST(CreatedAt AS DATE)
                ORDER BY date DESC
            `);
        
        res.json({
            eNPS: Math.round(eNPS),
            totalCelebrations: metrics.totalCelebrations || 0,
            totalFeedbacks: metrics.totalFeedbacks || 0,
            averageMood: metrics.averageMood || 0,
            trends: trendsResult.recordset
        });
    } catch (error) {
        console.error('Erro ao buscar analytics:', error);
        res.status(500).json({ error: 'Erro ao buscar analytics' });
    }
});

// Métricas da equipe
app.get('/api/manager/team-metrics', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const currentUser = req.session.user;
        const { departamento } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis com filtro de departamento
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: departamento && departamento !== '' ? departamento : null
        });
        
        console.log('📊 Team Metrics - Departamento filtrado:', departamento);
        console.log('📊 Team Metrics - Usuários acessíveis (subordinados):', accessibleUsers.length);
        
        // Incluir o próprio gestor na lista de usuários
        const currentUserId = currentUser.userId;
        const allUserIds = [...new Set([currentUserId, ...accessibleUsers.map(user => user.userId)])];
        
        console.log('📊 Team Metrics - Total de usuários (incluindo gestor):', allUserIds.length);
        
        if (allUserIds.length === 0) {
            return res.json({
                totalMembers: 0,
                activeMembers: 0,
                averageMood: 0,
                totalFeedbacks: 0
            });
        }
        
        // Buscar métricas da equipe (incluindo o gestor)
        const request = pool.request();
        allUserIds.forEach((userId, index) => {
            request.input(`userId${index}`, sql.Int, userId);
        });
        
        const metricsResult = await request.query(`
            SELECT 
                COUNT(DISTINCT u.Id) as totalMembers,
                COUNT(DISTINCT CASE WHEN u.IsActive = 1 THEN u.Id END) as activeMembers,
                AVG(CAST(dm.score AS FLOAT)) as averageMood,
                COUNT(DISTINCT f.Id) as totalFeedbacks
            FROM Users u
            LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                AND CAST(dm.created_at AS DATE) = CAST(GETDATE() AS DATE)
            LEFT JOIN Feedbacks f ON u.Id = f.to_user_id
                AND CAST(f.created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            WHERE u.Id IN (${allUserIds.map((_, i) => `@userId${i}`).join(',')})
        `);
        
        const metrics = metricsResult.recordset[0];
        res.json({
            totalMembers: metrics.totalMembers || 0,
            activeMembers: metrics.activeMembers || 0,
            averageMood: metrics.averageMood || 0,
            totalFeedbacks: metrics.totalFeedbacks || 0
        });
    } catch (error) {
        console.error('Erro ao buscar métricas da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas da equipe' });
    }
});

// Status da equipe
app.get('/api/manager/team-status', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const currentUser = req.session.user;
        const { departamento } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis com filtro de departamento
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: departamento && departamento !== '' ? departamento : null
        });
        
        console.log('👥 Team Status - Departamento filtrado:', departamento);
        console.log('👥 Team Status - Usuários acessíveis (subordinados):', accessibleUsers.length);
        
        // Incluir o próprio gestor na lista de usuários
        const currentUserId = currentUser.userId;
        const allUserIds = [...new Set([currentUserId, ...accessibleUsers.map(user => user.userId)])];
        
        console.log('👥 Team Status - Total de usuários (incluindo gestor):', allUserIds.length);
        
        if (allUserIds.length === 0) {
            return res.json({
                online: 0,
                offline: 0,
                active: 0,
                inactive: 0
            });
        }
        
        // Buscar status da equipe (incluindo o gestor)
        const request = pool.request();
        allUserIds.forEach((userId, index) => {
            request.input(`userId${index}`, sql.Int, userId);
        });
        
        const statusResult = await request.query(`
            SELECT 
                COUNT(DISTINCT CASE WHEN u.IsActive = 1 THEN u.Id END) as active,
                COUNT(DISTINCT CASE WHEN u.IsActive = 0 THEN u.Id END) as inactive,
                COUNT(DISTINCT CASE WHEN u.LastLogin >= DATEADD(minute, -30, GETDATE()) THEN u.Id END) as online,
                COUNT(DISTINCT CASE WHEN u.LastLogin < DATEADD(minute, -30, GETDATE()) OR u.LastLogin IS NULL THEN u.Id END) as offline
            FROM Users u
            WHERE u.Id IN (${allUserIds.map((_, i) => `@userId${i}`).join(',')})
        `);
        
        const status = statusResult.recordset[0];
        res.json({
            online: status.online || 0,
            offline: status.offline || 0,
            active: status.active || 0,
            inactive: status.inactive || 0
        });
    } catch (error) {
        console.error('Erro ao buscar status da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar status da equipe' });
    }
});

// Gestão de equipe
app.get('/api/manager/team-management', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        console.log('🔍 Iniciando /api/manager/team-management');
        const currentUser = req.session.user;
        const { status, departamento } = req.query;
        
        console.log('Current user:', currentUser);
        console.log('Query params:', { status, departamento });
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: departamento && departamento !== 'Todos' ? departamento : null
        });
        
        console.log('Accessible users (subordinados):', accessibleUsers.length);
        
        // Incluir o próprio gestor na lista de usuários
        const currentUserId = currentUser.userId;
        const allUserIds = [...new Set([currentUserId, ...accessibleUsers.map(user => user.userId)])];
        
        console.log('Total de usuários (incluindo gestor):', allUserIds.length);
        
        if (allUserIds.length === 0) {
            console.log('Nenhum usuário acessível encontrado');
            return res.json([]);
        }
        
        // Buscar dados detalhados dos usuários acessíveis (incluindo o gestor)
        const pool = await sql.connect(dbConfig);
        const userIds = allUserIds;
        
        // Query com estatísticas reais incluindo objetivos
        let query = `
            SELECT 
                u.Id,
                u.NomeCompleto,
                u.Departamento,
                u.DescricaoDepartamento,
                u.LastLogin,
                u.IsActive,
                COALESCE(dm.avg_score, 0) as lastMood,
                COALESCE(fb.total_feedbacks, 0) as recentFeedbacks,
                COALESCE(obj.objective_stats, '0,0,0,0,0') as objectiveStats,
                0 as pendingEvaluations
            FROM Users u
            LEFT JOIN (
                SELECT 
                    dm.user_id,
                    AVG(CAST(dm.score AS FLOAT)) as avg_score
                FROM DailyMood dm
                GROUP BY dm.user_id
            ) dm ON u.Id = dm.user_id
            LEFT JOIN (
                SELECT 
                    user_id,
                    SUM(feedback_count) as total_feedbacks
                FROM (
                    SELECT 
                        f.to_user_id as user_id,
                        COUNT(*) as feedback_count
                    FROM Feedbacks f
                    GROUP BY f.to_user_id
                    UNION ALL
                    SELECT 
                        f.from_user_id as user_id,
                        COUNT(*) as feedback_count
                    FROM Feedbacks f
                    GROUP BY f.from_user_id
                ) combined
                GROUP BY user_id
            ) fb ON u.Id = fb.user_id
            LEFT JOIN (
                SELECT 
                    user_id,
                    (
                        CAST(SUM(CASE WHEN status = 'Ativo' THEN 1 ELSE 0 END) AS VARCHAR) + ',' +
                        CAST(SUM(CASE WHEN status = 'Agendado' THEN 1 ELSE 0 END) AS VARCHAR) + ',' +
                        CAST(SUM(CASE WHEN status = 'Concluído' THEN 1 ELSE 0 END) AS VARCHAR) + ',' +
                        CAST(SUM(CASE WHEN status = 'Expirado' THEN 1 ELSE 0 END) AS VARCHAR) + ',' +
                        CAST(COUNT(DISTINCT objetivo_id) AS VARCHAR)
                    ) as objective_stats
                FROM (
                    SELECT DISTINCT 
                        o.Id as objetivo_id,
                        o.responsavel_id as user_id,
                        o.status
                    FROM Objetivos o
                    WHERE o.responsavel_id IS NOT NULL
                    UNION
                    SELECT DISTINCT
                        o.Id as objetivo_id,
                        orr.responsavel_id as user_id,
                        o.status
                    FROM Objetivos o
                    INNER JOIN ObjetivoResponsaveis orr ON o.Id = orr.objetivo_id
                ) userobjectives
                GROUP BY user_id
            ) obj ON u.Id = obj.user_id
            WHERE u.Id IN (${userIds.map((_, i) => `@userId${i}`).join(',')})
        `;
        
        if (status === 'ativo') {
            query += ' AND u.IsActive = 1';
        } else if (status === 'inativo') {
            query += ' AND u.IsActive = 0';
        }
        
        query += ' ORDER BY u.NomeCompleto';
        
        console.log('Query:', query);
        console.log('UserIds:', userIds);
        
        const request = pool.request();
        userIds.forEach((userId, index) => {
            request.input(`userId${index}`, sql.Int, userId);
        });
        
        const result = await request.query(query);
        const teamMembers = result.recordset.map(member => {
            // Parse das estatísticas de objetivos
            const objectiveStats = member.objectiveStats;
            let statistics = {
                active: 0,
                scheduled: 0,
                completed: 0,
                expired: 0,
                total: 0,
                activeObjectives: 0
            };
            
            if (objectiveStats && objectiveStats !== '0,0,0,0,0') {
                const statsArray = objectiveStats.split(',');
                if (statsArray.length === 5) {
                    statistics = {
                        active: parseInt(statsArray[0]) || 0,
                        scheduled: parseInt(statsArray[1]) || 0,
                        completed: parseInt(statsArray[2]) || 0,
                        expired: parseInt(statsArray[3]) || 0,
                        total: parseInt(statsArray[4]) || 0,
                        activeObjectives: parseInt(statsArray[0]) || 0 // Ativo = activeObjectives
                    };
                }
            }
            
            return {
            ...member,
                LastLogin: member.LastLogin ? member.LastLogin.toISOString() : null,
                activeObjectives: statistics.activeObjectives,
                objectiveStatistics: statistics
            };
        });
        
        res.json(teamMembers);
    } catch (error) {
        console.error('Erro ao buscar gestão de equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar gestão de equipe' });
    }
});

// =============================================
// ROTAS PARA GESTÃO DE FEEDBACKS DE COLABORADORES
// =============================================

// Buscar informações de um colaborador específico
app.get('/api/manager/employee-info/:employeeId', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT Id, NomeCompleto, Departamento, LastLogin, IsActive
                FROM Users 
                WHERE Id = @employeeId
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Colaborador não encontrado' });
        }
        
        const employee = result.recordset[0];
        employee.LastLogin = employee.LastLogin ? employee.LastLogin.toISOString() : null;
        
        res.json(employee);
    } catch (error) {
        console.error('Erro ao buscar dados do colaborador:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do colaborador' });
    }
});

// Buscar feedbacks de um colaborador específico (enviados e recebidos)
app.get('/api/manager/employee-feedbacks/:employeeId', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Feedbacks recebidos pelo colaborador
        const receivedResult = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT f.*, 
                       u1.NomeCompleto as from_name,
                       u2.NomeCompleto as to_name,
                       'received' as direction,
                       (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count
                FROM Feedbacks f
                JOIN Users u1 ON f.from_user_id = u1.Id
                JOIN Users u2 ON f.to_user_id = u2.Id
                WHERE f.to_user_id = @employeeId
            `);
        
        // Feedbacks enviados pelo colaborador
        const sentResult = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT f.*, 
                       u1.NomeCompleto as from_name,
                       u2.NomeCompleto as to_name,
                       'sent' as direction,
                       (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count
                FROM Feedbacks f
                JOIN Users u1 ON f.from_user_id = u1.Id
                JOIN Users u2 ON f.to_user_id = u2.Id
                WHERE f.from_user_id = @employeeId
            `);
        
        // Combinar e ordenar por data
        const allFeedbacks = [
            ...receivedResult.recordset,
            ...sentResult.recordset
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        res.json(allFeedbacks);
    } catch (error) {
        console.error('Erro ao buscar feedbacks do colaborador:', error);
        res.status(500).json({ error: 'Erro ao buscar feedbacks do colaborador' });
    }
});

// =============================================
// ROTAS ESPECÍFICAS DE ANALYTICS (DEVEM VIR ANTES DA ROTA GENÉRICA)
// =============================================

// Dashboard completo com todos os indicadores
app.get('/api/analytics/dashboard', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department, userId } = req.query;
        const currentUser = req.session.user;
        
        // Usar HierarchyManager para verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({
                performance: {},
                rankings: { topUsers: [], gamification: [] },
                departments: [],
                trends: { daily: [], weekly: [] },
                satisfaction: [],
                userMetrics: null,
                period: parseInt(period),
                department: department || 'Todos',
                generatedAt: new Date().toISOString()
            });
        }
        
        const dashboardData = await analyticsManager.getCompleteDashboard(
            parseInt(period), 
            department && department !== 'Todos' ? department : null,
            userId ? parseInt(userId) : null
        );
        
        res.json(dashboardData);
    } catch (error) {
        console.error('Erro ao buscar dashboard completo:', error);
        res.status(500).json({ error: 'Erro ao buscar dashboard completo' });
    }
});

// Rankings de usuários (acesso para todos os usuários autenticados)
app.get('/api/analytics/rankings', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department, topUsers = 50 } = req.query;
        const currentUser = req.session.user;
        
        // Verificar se é RH ou T&D
        const departamento = currentUser.departamento ? currentUser.departamento.toUpperCase() : '';
        const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
        const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     departamento.includes('TREINAMENTO') || 
                     departamento.includes('DESENVOLVIMENTO') ||
                     departamento.includes('T&D');
        
        // Para usuários comuns, limitar a visualização
        const isManager = currentUser.hierarchyLevel >= 3 || currentUser.role === 'Administrador' || isHR || isTD;
        
        let accessibleUsers = [];
        if (isManager) {
            // Gestores, RH e T&D podem ver todos os usuários
            accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
                department: department && department !== 'Todos' ? department : null
            });
        } else {
            // Usuários comuns podem ver apenas o ranking geral
            accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {});
        }
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const rankings = await analyticsManager.getUserRankings(
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            parseInt(topUsers)
        );
        
        res.json(rankings);
    } catch (error) {
        console.error('Erro ao buscar rankings:', error);
        res.status(500).json({ error: 'Erro ao buscar rankings' });
    }
});

// Leaderboard de gamificação (acesso para todos os usuários autenticados)
app.get('/api/analytics/gamification-leaderboard', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department, topUsers = 100 } = req.query;
        const currentUser = req.session.user;
        
        // Para usuários comuns, limitar a visualização
        const isManager = currentUser.hierarchyLevel >= 3 || currentUser.role === 'Administrador';
        
        let accessibleUsers = [];
        if (isManager) {
            // Gestores podem ver todos os usuários
            accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
                department: department && department !== 'Todos' ? department : null
            });
        } else {
            // Usuários comuns podem ver apenas o leaderboard geral
            accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {});
        }
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const leaderboard = await analyticsManager.getGamificationLeaderboard(
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            parseInt(topUsers)
        );
        
        res.json(leaderboard);
    } catch (error) {
        console.error('Erro ao buscar leaderboard de gamificação:', error);
        res.status(500).json({ error: 'Erro ao buscar leaderboard de gamificação' });
    }
});

// Analytics por departamento (mantém o endpoint original)
app.get('/api/analytics/departments', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const deptAnalytics = await analyticsManager.getDepartmentAnalytics(
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );
        
        res.json(deptAnalytics);
    } catch (error) {
        console.error('Erro ao buscar analytics por departamento:', error);
        res.status(500).json({ error: 'Erro ao buscar analytics por departamento' });
    }
});

// Analytics por departamento
app.get('/api/analytics/department-analytics', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const deptAnalytics = await analyticsManager.getDepartmentAnalytics(
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );
        
        res.json(deptAnalytics);
    } catch (error) {
        console.error('Erro ao buscar analytics por departamento:', error);
        res.status(500).json({ error: 'Erro ao buscar analytics por departamento' });
    }
});

// Análise de tendências
app.get('/api/analytics/trends', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({ daily: [], weekly: [] });
        }
        
        const trends = await analyticsManager.getTrendAnalytics(
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );
        
        res.json(trends);
    } catch (error) {
        console.error('Erro ao buscar tendências:', error);
        res.status(500).json({ error: 'Erro ao buscar tendências' });
    }
});

// Função auxiliar para obter número da semana
function getWeekNumber(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

// Análise temporal
app.get('/api/analytics/temporal', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se a tabela DailyMood existe
        const tableCheck = await pool.request().query(`
            SELECT COUNT(*) as tableExists 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'DailyMood'
        `);
        
        if (tableCheck.recordset[0].tableExists === 0) {
            console.log('⚠️ Tabela DailyMood não existe - retornando dados vazios');
            return res.json({
                moodData: [],
                dailyMood: [],
                feedbacks: [],
                recognitions: [],
                message: 'Sistema de humor ainda não configurado'
            });
        }
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({
                moodData: [],
                dailyMood: [],
                feedbacks: [],
                recognitions: [],
                message: 'Nenhum dado disponível'
            });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        console.log('🔍 Análise temporal - Usuários incluídos:', userIds.length);
        console.log('🔍 Análise temporal - Departamento filtrado:', department);
        
        // Buscar dados de humor diário
        const moodResult = await pool.request()
            .input('period', sql.Int, parseInt(period))
            .query(`
                SELECT 
                    CAST(dm.created_at AS DATE) as date,
                    AVG(CAST(dm.score AS FLOAT)) as average,
                    COUNT(*) as count
                FROM DailyMood dm
                WHERE dm.user_id IN (${userIdsParam})
                    AND CAST(dm.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                GROUP BY CAST(dm.created_at AS DATE)
                ORDER BY date DESC
            `);
        
        console.log('🔍 Análise temporal - Dados de humor encontrados:', moodResult.recordset.length, 'dias');
        if (moodResult.recordset.length === 0) {
            console.log('⚠️ Nenhum dado de humor encontrado para o período e usuários selecionados');
        }
        
        // Buscar dados de feedbacks
        const feedbacksResult = await pool.request()
            .input('period', sql.Int, parseInt(period))
            .query(`
                SELECT 
                    f.Id,
                    f.message,
                    f.type,
                    f.category,
                    f.created_at,
                    u.NomeCompleto as from_user_name,
                    u2.NomeCompleto as to_user_name
                FROM Feedbacks f
                JOIN Users u ON f.from_user_id = u.Id
                JOIN Users u2 ON f.to_user_id = u2.Id
                WHERE f.from_user_id IN (${userIdsParam}) OR f.to_user_id IN (${userIdsParam})
                    AND CAST(f.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                ORDER BY f.created_at DESC
            `);
        
        // Buscar dados de reconhecimentos
        const recognitionsResult = await pool.request()
            .input('period', sql.Int, parseInt(period))
            .query(`
                SELECT 
                    r.Id,
                    r.message,
                    r.badge,
                    r.created_at,
                    u.NomeCompleto as from_user_name,
                    u2.NomeCompleto as to_user_name
                FROM Recognitions r
                JOIN Users u ON r.from_user_id = u.Id
                JOIN Users u2 ON r.to_user_id = u2.Id
                WHERE r.from_user_id IN (${userIdsParam}) OR r.to_user_id IN (${userIdsParam})
                    AND CAST(r.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                ORDER BY r.created_at DESC
            `);
        
        res.json({
            moodData: moodResult.recordset.map(row => ({
                year: new Date(row.date).getFullYear(),
                week: getWeekNumber(row.date),
                averageMood: Math.round(row.average * 10) / 10,
                participants: row.count,
                weekStart: row.date.toISOString().split('T')[0],
                weekEnd: row.date.toISOString().split('T')[0]
            })),
            dailyMood: moodResult.recordset.map(row => ({
                date: row.date.toISOString().split('T')[0],
                average: Math.round(row.average * 10) / 10,
                count: row.count
            })),
            feedbacks: feedbacksResult.recordset,
            recognitions: recognitionsResult.recordset
        });
    } catch (error) {
        console.error('Erro ao buscar análise temporal:', error);
        res.status(500).json({ error: 'Erro ao buscar análise temporal' });
    }
});

// Métricas de satisfação
app.get('/api/analytics/satisfaction', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const satisfaction = await analyticsManager.getSatisfactionMetrics(
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );
        
        res.json(satisfaction);
    } catch (error) {
        console.error('Erro ao buscar métricas de satisfação:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas de satisfação' });
    }
});

// Métricas de engajamento por usuário
app.get('/api/analytics/user-engagement', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department, userId } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const engagement = await analyticsManager.getUserEngagementMetrics(
            userId ? parseInt(userId) : null,
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );
        
        res.json(engagement);
    } catch (error) {
        console.error('Erro ao buscar métricas de engajamento:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas de engajamento' });
    }
});

// Indicadores de performance gerais
app.get('/api/analytics/performance', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({});
        }
        
        const performance = await analyticsManager.getPerformanceIndicators(
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );
        
        res.json(performance);
    } catch (error) {
        console.error('Erro ao buscar indicadores de performance:', error);
        res.status(500).json({ error: 'Erro ao buscar indicadores de performance' });
    }
});

// Atualizar rankings mensais
app.post('/api/analytics/update-rankings', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { month, year } = req.body;
        
        const result = await analyticsManager.updateUserRankings(month, year);
        
        res.json(result);
    } catch (error) {
        console.error('Erro ao atualizar rankings:', error);
        res.status(500).json({ error: 'Erro ao atualizar rankings' });
    }
});

// ===== SISTEMA DE CHAT PARA FEEDBACKS =====

// Rota para criar tabelas de chat manualmente
app.post('/api/chat/setup-tables', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        await ensureChatTablesExist(pool);
        
        // Adicionar colunas de referência se não existirem
        try {
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'reply_to_id')
                BEGIN
                    ALTER TABLE FeedbackReplies ADD reply_to_id INT NULL;
                    PRINT 'Coluna reply_to_id adicionada';
                END
                
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'reply_to_message')
                BEGIN
                    ALTER TABLE FeedbackReplies ADD reply_to_message NTEXT NULL;
                    PRINT 'Coluna reply_to_message adicionada';
                END
                
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'FeedbackReplies' AND COLUMN_NAME = 'reply_to_user')
                BEGIN
                    ALTER TABLE FeedbackReplies ADD reply_to_user NVARCHAR(255) NULL;
                    PRINT 'Coluna reply_to_user adicionada';
                END
            `);
        } catch (error) {
            console.log('Erro ao adicionar colunas de referência:', error.message);
        }
        
        res.json({ success: true, message: 'Tabelas de chat criadas/verificadas com sucesso' });
    } catch (error) {
        console.error('Erro ao configurar tabelas de chat:', error);
        res.status(500).json({ error: 'Erro ao configurar tabelas de chat: ' + error.message });
    }
});

// Buscar informações do feedback para o chat
app.get('/api/feedbacks/:id/info', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT 
                    f.Id,
                    f.type,
                    f.category,
                    f.message,
                    u1.NomeCompleto as from_name,
                    u2.NomeCompleto as to_name
                FROM Feedbacks f
                JOIN Users u1 ON f.from_user_id = u1.Id
                JOIN Users u2 ON f.to_user_id = u2.Id
                WHERE f.Id = @feedbackId
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Feedback não encontrado' });
        }
        
        const feedback = result.recordset[0];
        res.json({
            title: `${feedback.type} - ${feedback.category}`,
            from: feedback.from_name,
            to: feedback.to_name,
            message: feedback.message
        });
    } catch (error) {
        console.error('Erro ao buscar info do feedback:', error);
        res.status(500).json({ error: 'Erro ao buscar informações do feedback' });
    }
});

// Buscar mensagens do chat de um feedback
app.get('/api/feedbacks/:id/messages', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const feedbackId = parseInt(id);
        
        if (!feedbackId || isNaN(feedbackId) || feedbackId <= 0) {
            return res.status(400).json({ error: 'ID do feedback inválido' });
        }
        
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Garantir que as tabelas existam
        await ensureChatTablesExist(pool);
        
        // Marcar feedback como visualizado quando o chat é aberto
        await pool.request()
            .input('feedbackId', sql.Int, feedbackId)
            .input('userId', sql.Int, userId)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM FeedbackReactions WHERE feedback_id = @feedbackId AND user_id = @userId AND reaction_type = 'viewed')
                BEGIN
                    INSERT INTO FeedbackReactions (feedback_id, user_id, reaction_type, created_at)
                    VALUES (@feedbackId, @userId, 'viewed', GETDATE())
                END
            `);
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, feedbackId)
            .query(`
                SELECT 
                    fr.Id,
                    fr.feedback_id,
                    fr.user_id,
                    fr.reply_text as message,
                    fr.created_at,
                    fr.reply_to_id,
                    fr.reply_to_message,
                    fr.reply_to_user,
                    COALESCE(u.NomeCompleto, 'Usuário') as user_name,
                    u.nome as user_first_name
                FROM FeedbackReplies fr
                LEFT JOIN Users u ON fr.user_id = u.Id
                WHERE fr.feedback_id = @feedbackId
                ORDER BY fr.created_at ASC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar mensagens do chat:', error);
        res.status(500).json({ error: 'Erro ao buscar mensagens do chat: ' + error.message });
    }
});

// Endpoint duplicado removido - usando apenas o endpoint com pontuação abaixo

// Reagir com emoji a uma mensagem
app.post('/api/feedbacks/:feedbackId/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
        const { feedbackId, messageId } = req.params;
        const { emoji } = req.body;
        const userId = req.session.user.userId;
        
        if (!emoji) {
            return res.status(400).json({ error: 'Emoji é obrigatório' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Garantir que as tabelas existam
        await ensureChatTablesExist(pool);
        
        // Verificar se já reagiu com este emoji
        const existingReaction = await pool.request()
            .input('replyId', sql.Int, messageId)
            .input('userId', sql.Int, userId)
            .input('emoji', sql.VarChar, emoji)
            .query(`
                SELECT Id FROM FeedbackReplyReactions 
                WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji
            `);
        
        if (existingReaction.recordset.length > 0) {
            // Remover reação existente
            await pool.request()
                .input('replyId', sql.Int, messageId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.VarChar, emoji)
                .query(`
                    DELETE FROM FeedbackReplyReactions 
                    WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji
                `);
            
            res.json({ success: true, action: 'removed', emoji });
        } else {
            // Adicionar nova reação
            await pool.request()
                .input('replyId', sql.Int, messageId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.VarChar, emoji)
                .query(`
                    INSERT INTO FeedbackReplyReactions (reply_id, user_id, emoji)
                    VALUES (@replyId, @userId, @emoji)
                `);
            
            res.json({ success: true, action: 'added', emoji });
        }
    } catch (error) {
        console.error('Erro ao reagir:', error);
        res.status(500).json({ error: 'Erro ao reagir: ' + error.message });
    }
});

// Buscar reações de uma mensagem
app.get('/api/feedbacks/:feedbackId/messages/:messageId/reactions', requireAuth, async (req, res) => {
    try {
        const { messageId } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('replyId', sql.Int, messageId)
            .query(`
                SELECT 
                    frr.emoji,
                    COUNT(*) as count,
                    STRING_AGG(u.nome, ', ') as users
                FROM FeedbackReplyReactions frr
                JOIN Users u ON frr.user_id = u.Id
                WHERE frr.reply_id = @replyId
                GROUP BY frr.emoji
                ORDER BY count DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar reações:', error);
        res.status(500).json({ error: 'Erro ao buscar reações' });
    }
});

// Rota de compatibilidade - buscar mensagens antigas
app.get('/api/feedbacks/:id/replies', requireAuth, async (req, res) => {
    // Redirecionar para a nova rota de mensagens
    req.url = `/api/feedbacks/${req.params.id}/messages`;
    return app._router.handle(req, res);
});

// Rota de compatibilidade - enviar resposta antiga
app.post('/api/feedbacks/:id/reply', requireAuth, async (req, res) => {
    // Redirecionar para a nova rota de mensagens
    req.url = `/api/feedbacks/${req.params.id}/messages`;
    return app._router.handle(req, res);
});

app.get('/api/feedbacks/:id/messages', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário tem acesso ao feedback
        const accessCheck = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT Id FROM Feedbacks 
                WHERE Id = @feedbackId 
                AND (from_user_id = @userId OR to_user_id = @userId)
            `);
        
        if (accessCheck.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a este feedback' });
        }
        
        // Buscar mensagens do chat
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT 
                    fr.Id,
                    fr.user_id,
                    fr.reply_text as message,
                    fr.created_at,
                    u.NomeCompleto as user_name,
                    u.nome as user_first_name
                FROM FeedbackReplies fr
                JOIN Users u ON fr.user_id = u.Id
                WHERE fr.feedback_id = @feedbackId
                ORDER BY fr.created_at ASC
            `);
        
        // Buscar reações para cada mensagem
        const messages = [];
        for (const msg of result.recordset) {
            const reactionsResult = await pool.request()
                .input('replyId', sql.Int, msg.Id)
                .query(`
                    SELECT 
                        frr.emoji,
                        frr.user_id,
                        u.nome as user_name
                    FROM FeedbackReplyReactions frr
                    JOIN Users u ON frr.user_id = u.Id
                    WHERE frr.reply_id = @replyId
                    ORDER BY frr.created_at ASC
                `);
            
            messages.push({
                id: msg.Id,
                user_id: msg.user_id,
                message: msg.message,
                created_at: msg.created_at,
                user_name: msg.user_name,
                user_first_name: msg.user_first_name,
                reactions: reactionsResult.recordset
            });
        }
        
        res.json(messages);
    } catch (error) {
        console.error('Erro ao buscar mensagens do chat:', error);
        res.status(500).json({ error: 'Erro ao buscar mensagens do chat' });
    }
});

// Enviar mensagem no chat
app.post('/api/feedbacks/:id/messages', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { message, reply_to } = req.body;
        const userId = req.session.user.userId;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'Mensagem é obrigatória' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário tem acesso ao feedback
        const accessCheck = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT Id FROM Feedbacks 
                WHERE Id = @feedbackId 
                AND (from_user_id = @userId OR to_user_id = @userId)
            `);
        
        if (accessCheck.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a este feedback' });
        }
        
        // Buscar informações da mensagem original se reply_to foi fornecido
        let replyToMessage = null;
        let replyToUser = null;
        
        if (reply_to) {
            const replyInfo = await pool.request()
                .input('replyId', sql.Int, reply_to)
                .query(`
                    SELECT fr.reply_text, u.NomeCompleto as user_name
                    FROM FeedbackReplies fr
                    LEFT JOIN Users u ON fr.user_id = u.Id
                    WHERE fr.Id = @replyId
                `);
            
            if (replyInfo.recordset.length > 0) {
                replyToMessage = replyInfo.recordset[0].reply_text;
                replyToUser = replyInfo.recordset[0].user_name;
            }
        }

        // Inserir nova mensagem
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('message', sql.NVarChar(sql.MAX), message.trim())
            .input('replyToId', sql.Int, reply_to || null)
            .input('replyToMessage', sql.NVarChar(sql.MAX), replyToMessage)
            .input('replyToUser', sql.NVarChar(255), replyToUser)
            .query(`
                INSERT INTO FeedbackReplies (feedback_id, user_id, reply_text, reply_to_id, reply_to_message, reply_to_user, created_at)
                OUTPUT INSERTED.Id, INSERTED.created_at
                VALUES (@feedbackId, @userId, @message, @replyToId, @replyToMessage, @replyToUser, GETDATE())
            `);
        
        const newMessage = result.recordset[0];
        
        // Buscar dados completos da nova mensagem
        const messageResult = await pool.request()
            .input('messageId', sql.Int, newMessage.Id)
            .query(`
                SELECT 
                    fr.Id,
                    fr.user_id,
                    fr.reply_text as message,
                    fr.created_at,
                    u.NomeCompleto as user_name,
                    u.nome as user_first_name
                FROM FeedbackReplies fr
                JOIN Users u ON fr.user_id = u.Id
                WHERE fr.Id = @messageId
            `);
        
        const fullMessage = messageResult.recordset[0];
        fullMessage.reactions = [];
        
        // Verificar se o usuário é o destinatário do feedback para dar pontos
        // Só deve ganhar pontos se for o destinatário (to_user_id), não o remetente (from_user_id)
        const feedbackCheck = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT from_user_id, to_user_id 
                FROM Feedbacks 
                WHERE Id = @feedbackId
            `);
        
        let pointsResult = { success: false, points: 0, message: '' };
        
        if (feedbackCheck.recordset.length > 0) {
            const feedback = feedbackCheck.recordset[0];
            const isRecipient = feedback.to_user_id === userId;
            
            if (isRecipient) {
                // Usuário é o destinatário - pode ganhar pontos por responder
                pointsResult = await addPointsToUser(userId, 'feedback_respondido', 10, pool);
                console.log('✅ Usuário é destinatário do feedback - pontos concedidos');
            } else {
                // Usuário é o remetente - não deve ganhar pontos
                pointsResult = { 
                    success: false, 
                    points: 0, 
                    message: 'Você não ganha pontos respondendo seu próprio feedback' 
                };
                console.log('ℹ️ Usuário é remetente do feedback - pontos não concedidos');
            }
        }
        
        res.json({ 
            success: true, 
            message: fullMessage,
            pointsEarned: pointsResult.success ? pointsResult.points : 0,
            pointsMessage: pointsResult.message
        });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
});

// Reagir a uma mensagem do chat
app.post('/api/feedbacks/messages/:messageId/react', requireAuth, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { emoji } = req.body;
        const userId = req.session.user.userId;
        
        if (!emoji) {
            return res.status(400).json({ error: 'Emoji é obrigatório' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se a mensagem existe e se o usuário tem acesso
        const messageCheck = await pool.request()
            .input('messageId', sql.Int, messageId)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT fr.feedback_id
                FROM FeedbackReplies fr
                JOIN Feedbacks f ON fr.feedback_id = f.Id
                WHERE fr.Id = @messageId
                AND (f.from_user_id = @userId OR f.to_user_id = @userId)
            `);
        
        if (messageCheck.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta mensagem' });
        }
        
        // Verificar se já reagiu com este emoji
        const existingReaction = await pool.request()
            .input('messageId', sql.Int, messageId)
            .input('userId', sql.Int, userId)
            .input('emoji', sql.VarChar, emoji)
            .query(`
                SELECT Id FROM FeedbackReplyReactions 
                WHERE reply_id = @messageId AND user_id = @userId AND emoji = @emoji
            `);
        
        if (existingReaction.recordset.length > 0) {
            // Remover reação existente
            await pool.request()
                .input('messageId', sql.Int, messageId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.VarChar, emoji)
                .query(`
                    DELETE FROM FeedbackReplyReactions 
                    WHERE reply_id = @messageId AND user_id = @userId AND emoji = @emoji
                `);
            
            res.json({ success: true, action: 'removed', emoji });
        } else {
            // Adicionar nova reação
            await pool.request()
                .input('messageId', sql.Int, messageId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.VarChar, emoji)
                .query(`
                    INSERT INTO FeedbackReplyReactions (reply_id, user_id, emoji, created_at)
                    VALUES (@messageId, @userId, @emoji, GETDATE())
                `);
            
            res.json({ success: true, action: 'added', emoji });
        }
    } catch (error) {
        console.error('Erro ao reagir à mensagem:', error);
        res.status(500).json({ error: 'Erro ao reagir à mensagem' });
    }
});

// Exportar dados completos
app.get('/api/analytics/export-complete', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department, format = 'json' } = req.query;
        const currentUser = req.session.user;
        
        // Verificar acesso
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.status(404).json({ error: 'Nenhum dado encontrado para exportação' });
        }
        
        const data = await analyticsManager.exportAnalyticsData(
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            format
        );
        
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=analytics_complete_${new Date().toISOString().split('T')[0]}.csv`);
            res.send(data);
        } else {
            res.json(data);
        }
    } catch (error) {
        console.error('Erro ao exportar dados completos:', error);
        res.status(500).json({ error: 'Erro ao exportar dados completos' });
    }
});

// Limpar cache de analytics
app.post('/api/analytics/clear-cache', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        analyticsManager.clearCache();
        res.json({ success: true, message: 'Cache limpo com sucesso' });
    } catch (error) {
        console.error('Erro ao limpar cache:', error);
        res.status(500).json({ error: 'Erro ao limpar cache' });
    }
});

// Estatísticas do cache
app.get('/api/analytics/cache-stats', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const stats = analyticsManager.getCacheStats();
        res.json(stats);
    } catch (error) {
        console.error('Erro ao buscar estatísticas do cache:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas do cache' });
    }
});

// Nova API abrangente para relatórios
app.get('/api/analytics/comprehensive', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const currentUser = req.session.user;
        const { period = 30, department } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({
                engagement: { participationRate: 0, activeUsers: 0, totalUsers: 0, moodEntries: 0, feedbackCount: 0 },
                mood: { averageMood: 0, totalEntries: 0, positiveMood: 0, negativeMood: 0 },
                feedback: { totalFeedbacks: 0, totalRecognitions: 0, positiveFeedbacks: 0, constructiveFeedbacks: 0, suggestionFeedbacks: 0, otherFeedbacks: 0 },
                gamification: { totalPoints: 0, activeUsers: 0, topUser: null, badgesEarned: 0 },
                objectives: { totalObjectives: 0, completedObjectives: 0, inProgressObjectives: 0 },
                performance: { averageScore: 0, totalEvaluations: 0, highPerformers: 0, improvementNeeded: 0 },
                topUsers: []
            });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        // Calcular datas baseado no período
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(period));
        
        // Buscar todos os dados em paralelo
        const [
            engagementData,
            moodData,
            feedbackData,
            gamificationData,
            objectivesData,
            performanceData,
            topUsersData
        ] = await Promise.all([
            getEngagementData(pool, userIdsParam, startDate, endDate),
            getMoodData(pool, userIdsParam, startDate, endDate),
            getFeedbackData(pool, userIdsParam, startDate, endDate),
            getGamificationData(pool, userIdsParam, startDate, endDate),
            getObjectivesData(pool, userIdsParam, startDate, endDate),
            getPerformanceData(pool, userIdsParam, startDate, endDate),
            getTopUsersData(pool, userIdsParam, startDate, endDate)
        ]);
        
        res.json({
            engagement: engagementData,
            mood: moodData,
            feedback: feedbackData,
            gamification: gamificationData,
            objectives: objectivesData,
            performance: performanceData,
            topUsers: topUsersData
        });
        
    } catch (error) {
        console.error('Erro ao buscar dados abrangentes:', error);
        res.status(500).json({ error: 'Erro ao buscar dados abrangentes' });
    }
});

// Funções auxiliares para buscar dados específicos
async function getEngagementData(pool, userIdsParam, startDate, endDate) {
    try {
        // Total de usuários ativos
        const totalUsersResult = await pool.request().query(`
            SELECT COUNT(*) as total
            FROM Users 
            WHERE Id IN (${userIdsParam}) AND IsActive = 1
        `);
        
        // Usuários engajados (que fizeram TODAS as 3 ações: humor E feedback E reconhecimento)
        const activeUsersResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT COUNT(DISTINCT u.Id) as active
                FROM Users u
                WHERE u.Id IN (${userIdsParam})
                AND u.IsActive = 1
                -- Registrou humor no período
                AND EXISTS (
                    SELECT 1 
                    FROM DailyMood dm 
                    WHERE dm.user_id = u.Id
                    AND CAST(dm.created_at AS DATE) BETWEEN @startDate AND @endDate
                )
                -- Enviou feedback no período
                AND EXISTS (
                    SELECT 1 
                    FROM Feedbacks f 
                    WHERE f.from_user_id = u.Id
                    AND CAST(f.created_at AS DATE) BETWEEN @startDate AND @endDate
                )
                -- Enviou reconhecimento no período
                AND EXISTS (
                    SELECT 1 
                    FROM Recognitions r 
                    WHERE r.from_user_id = u.Id
                    AND CAST(r.created_at AS DATE) BETWEEN @startDate AND @endDate
                )
            `);
        
        // Detalhamento por tipo de ação
        const moodEntriesResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as users
                FROM DailyMood 
                WHERE user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const feedbackCountResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT COUNT(*) as total, COUNT(DISTINCT from_user_id) as users
                FROM Feedbacks 
                WHERE from_user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const recognitionCountResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT COUNT(*) as total, COUNT(DISTINCT from_user_id) as users
                FROM Recognitions 
                WHERE from_user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const totalUsers = totalUsersResult.recordset[0].total;
        const activeUsers = activeUsersResult.recordset[0].active;
        const participationRate = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
        
        return {
            participationRate,
            activeUsers,
            totalUsers,
            moodEntries: moodEntriesResult.recordset[0].total,
            moodUsers: moodEntriesResult.recordset[0].users,
            feedbackCount: feedbackCountResult.recordset[0].total,
            feedbackUsers: feedbackCountResult.recordset[0].users,
            recognitionCount: recognitionCountResult.recordset[0].total,
            recognitionUsers: recognitionCountResult.recordset[0].users
        };
    } catch (error) {
        console.error('Erro ao buscar dados de engajamento:', error);
        return { 
            participationRate: 0, 
            activeUsers: 0, 
            totalUsers: 0, 
            moodEntries: 0, 
            moodUsers: 0,
            feedbackCount: 0,
            feedbackUsers: 0,
            recognitionCount: 0,
            recognitionUsers: 0
        };
    }
}

async function getMoodData(pool, userIdsParam, startDate, endDate) {
    try {
        const result = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    AVG(CAST(score AS FLOAT)) as averageMood,
                    COUNT(*) as totalEntries,
                    SUM(CASE WHEN score >= 4 THEN 1 ELSE 0 END) as positiveMood,
                    SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) as negativeMood
                FROM DailyMood 
                WHERE user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const data = result.recordset[0];
        return {
            averageMood: data.averageMood || 0,
            totalEntries: data.totalEntries || 0,
            positiveMood: data.positiveMood || 0,
            negativeMood: data.negativeMood || 0
        };
    } catch (error) {
        console.error('Erro ao buscar dados de humor:', error);
        return { averageMood: 0, totalEntries: 0, positiveMood: 0, negativeMood: 0 };
    }
}

async function getFeedbackData(pool, userIdsParam, startDate, endDate) {
    try {
        const feedbacksResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    COUNT(*) as totalFeedbacks,
                    SUM(CASE WHEN type = 'Positivo' THEN 1 ELSE 0 END) as positiveFeedbacks,
                    SUM(CASE WHEN type = 'Desenvolvimento' THEN 1 ELSE 0 END) as constructiveFeedbacks,
                    SUM(CASE WHEN type = 'Sugestão' THEN 1 ELSE 0 END) as suggestionFeedbacks,
                    SUM(CASE WHEN type = 'Outros' THEN 1 ELSE 0 END) as otherFeedbacks
                FROM Feedbacks 
                WHERE from_user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const recognitionsResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT COUNT(*) as totalRecognitions
                FROM Recognitions 
                WHERE from_user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const feedbacks = feedbacksResult.recordset[0];
        const recognitions = recognitionsResult.recordset[0];
        
        return {
            totalFeedbacks: feedbacks.totalFeedbacks || 0,
            totalRecognitions: recognitions.totalRecognitions || 0,
            positiveFeedbacks: feedbacks.positiveFeedbacks || 0,
            constructiveFeedbacks: feedbacks.constructiveFeedbacks || 0,
            suggestionFeedbacks: feedbacks.suggestionFeedbacks || 0,
            otherFeedbacks: feedbacks.otherFeedbacks || 0
        };
    } catch (error) {
        console.error('Erro ao buscar dados de feedback:', error);
        return { totalFeedbacks: 0, totalRecognitions: 0, positiveFeedbacks: 0, constructiveFeedbacks: 0, suggestionFeedbacks: 0, otherFeedbacks: 0 };
    }
}

async function getGamificationData(pool, userIdsParam, startDate, endDate) {
    try {
        // Buscar pontos totais da tabela UserPoints (pontos acumulados)
        const pointsResult = await pool.request().query(`
            SELECT 
                SUM(TotalPoints) as totalPoints,
                COUNT(DISTINCT UserId) as activeUsers
            FROM UserPoints 
            WHERE UserId IN (${userIdsParam})
            AND TotalPoints > 0
        `);
        
        // Buscar badges da tabela Gamification
        const badgesResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT COUNT(*) as badgesEarned
                FROM Gamification 
                WHERE UserId IN (${userIdsParam})
                AND Action LIKE '%badge%'
                AND CAST(CreatedAt AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        // Buscar top usuário da tabela UserPoints
        const topUserResult = await pool.request().query(`
            SELECT TOP 1
                u.NomeCompleto as name,
                up.TotalPoints as points
            FROM UserPoints up
            JOIN Users u ON up.UserId = u.Id
            WHERE up.UserId IN (${userIdsParam})
            AND up.TotalPoints > 0
            ORDER BY up.TotalPoints DESC
        `);
        
        const points = pointsResult.recordset[0];
        const badges = badgesResult.recordset[0];
        const topUser = topUserResult.recordset[0];
        
        return {
            totalPoints: points.totalPoints || 0,
            activeUsers: points.activeUsers || 0,
            topUser: topUser ? { name: topUser.name, points: topUser.points } : null,
            badgesEarned: badges.badgesEarned || 0
        };
    } catch (error) {
        console.error('Erro ao buscar dados de gamificação:', error);
        return { totalPoints: 0, activeUsers: 0, topUser: null, badgesEarned: 0 };
    }
}

async function getObjectivesData(pool, userIdsParam, startDate, endDate) {
    try {
        // Verificar se a tabela Objetivos existe
        const tableCheck = await pool.request().query(`
            SELECT COUNT(*) as tableExists 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'Objetivos'
        `);
        
        if (tableCheck.recordset[0].tableExists === 0) {
            console.log('⚠️ Tabela Objetivos não existe ainda');
            return { totalObjectives: 0, completedObjectives: 0, inProgressObjectives: 0 };
        }
        
        const result = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    COUNT(*) as totalObjectives,
                    SUM(CASE WHEN status = 'Concluído' THEN 1 ELSE 0 END) as completedObjectives,
                    SUM(CASE WHEN status = 'Ativo' THEN 1 ELSE 0 END) as inProgressObjectives
                FROM Objetivos 
                WHERE responsavel_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const data = result.recordset[0];
        return {
            totalObjectives: data.totalObjectives || 0,
            completedObjectives: data.completedObjectives || 0,
            inProgressObjectives: data.inProgressObjectives || 0
        };
    } catch (error) {
        console.log('⚠️ Erro ao buscar dados de objetivos (retornando dados vazios):', error.message);
        return { totalObjectives: 0, completedObjectives: 0, inProgressObjectives: 0 };
    }
}

async function getPerformanceData(pool, userIdsParam, startDate, endDate) {
    try {
        // Verificar se a tabela DailyMood existe
        const tableCheck = await pool.request().query(`
            SELECT COUNT(*) as tableExists 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'DailyMood'
        `);
        
        if (tableCheck.recordset[0].tableExists === 0) {
            console.log('⚠️ Tabela DailyMood não existe ainda');
            return { averageScore: 0, totalEvaluations: 0, highPerformers: 0, improvementNeeded: 0 };
        }
        
        // Simular dados de performance baseados em humor e engajamento
        const moodResult = await pool.request()
            .input('startDate', sql.Date, startDate)
            .input('endDate', sql.Date, endDate)
            .query(`
                SELECT 
                    AVG(CAST(score AS FLOAT)) as averageScore,
                    COUNT(*) as totalEvaluations,
                    SUM(CASE WHEN score >= 4 THEN 1 ELSE 0 END) as highPerformers,
                    SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) as improvementNeeded
                FROM DailyMood 
                WHERE user_id IN (${userIdsParam})
                AND CAST(created_at AS DATE) BETWEEN @startDate AND @endDate
            `);
        
        const data = moodResult.recordset[0];
        return {
            averageScore: (data.averageScore || 0) * 20, // Converter para escala 0-100
            totalEvaluations: data.totalEvaluations || 0,
            highPerformers: data.highPerformers || 0,
            improvementNeeded: data.improvementNeeded || 0
        };
    } catch (error) {
        console.log('⚠️ Erro ao buscar dados de performance (retornando dados vazios):', error.message);
        return { averageScore: 0, totalEvaluations: 0, highPerformers: 0, improvementNeeded: 0 };
    }
}

async function getTopUsersData(pool, userIdsParam, startDate, endDate) {
    try {
        // Verificar se a tabela UserPoints existe
        const tableCheck = await pool.request().query(`
            SELECT COUNT(*) as tableExists 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'UserPoints'
        `);
        
        if (tableCheck.recordset[0].tableExists === 0) {
            console.log('⚠️ Tabela UserPoints não existe ainda');
            return [];
        }
        
        const result = await pool.request().query(`
            SELECT TOP 10
                u.NomeCompleto as name,
                u.Departamento as department,
                up.TotalPoints as points
            FROM UserPoints up
            JOIN Users u ON up.UserId = u.Id
            WHERE up.UserId IN (${userIdsParam})
            AND up.TotalPoints > 0
            ORDER BY up.TotalPoints DESC
        `);
        
        return result.recordset.map(user => ({
            name: user.name,
            department: user.department,
            points: user.points || 0
        }));
    } catch (error) {
        console.log('⚠️ Erro ao buscar top usuários (retornando lista vazia):', error.message);
        return [];
    }
}

// Analytics e relatórios (API antiga para compatibilidade)
app.get('/api/analytics', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const currentUser = req.session.user;
        const { period = 30, department, type = 'engagement' } = req.query;
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({
                participation: { percentage: 0, active: 0, total: 0 },
                satisfaction: { average: 0, trend: 'stable' },
                trends: { mood: 'stable', participation: 'stable' },
                distribution: { total: 0, categories: 0 }
            });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        // Buscar dados reais de analytics filtrados por hierarquia
        const analytics = {};
        
        // Participação
        const participationResult = await pool.request().query(`
            SELECT 
                COUNT(DISTINCT u.Id) as total,
                COUNT(DISTINCT CASE WHEN dm.Id IS NOT NULL THEN u.Id END) as active
            FROM Users u
            LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                AND CAST(dm.created_at AS DATE) = CAST(GETDATE() AS DATE)
            WHERE u.Id IN (${userIdsParam}) AND u.IsActive = 1
        `);
        
        const participation = participationResult.recordset[0];
        analytics.participation = {
            percentage: participation.total > 0 ? Math.round((participation.active / participation.total) * 100) : 0,
            active: participation.active,
            total: participation.total
        };
        
        // Satisfação (média do humor)
        const satisfactionResult = await pool.request().query(`
            SELECT 
                AVG(CAST(dm.score AS FLOAT)) as average,
                COUNT(*) as total
            FROM DailyMood dm
            WHERE dm.user_id IN (${userIdsParam})
                AND CAST(dm.created_at AS DATE) = CAST(GETDATE() AS DATE)
        `);
        
        const satisfaction = satisfactionResult.recordset[0];
        analytics.satisfaction = {
            average: satisfaction.average ? Math.round(satisfaction.average * 10) / 10 : 0,
            total: satisfaction.total || 0
        };
        
        // Tendências (comparação com ontem)
        const trendsResult = await pool.request().query(`
            SELECT 
                AVG(CAST(today.score AS FLOAT)) as today_avg,
                AVG(CAST(yesterday.score AS FLOAT)) as yesterday_avg
            FROM DailyMood today
            LEFT JOIN DailyMood yesterday ON today.user_id = yesterday.user_id 
                AND CAST(yesterday.created_at AS DATE) = CAST(DATEADD(day, -1, GETDATE()) AS DATE)
            WHERE today.user_id IN (${userIdsParam})
                AND CAST(today.created_at AS DATE) = CAST(GETDATE() AS DATE)
        `);
        
        const trends = trendsResult.recordset[0];
        const todayAvg = trends.today_avg || 0;
        const yesterdayAvg = trends.yesterday_avg || 0;
        const change = yesterdayAvg > 0 ? ((todayAvg - yesterdayAvg) / yesterdayAvg) * 100 : 0;
        
        analytics.trends = {
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
            percentage: Math.abs(Math.round(change))
        };
        
        // Distribuição por categoria
        const distributionResult = await pool.request()
            .input('period', sql.Int, parseInt(period))
            .query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(DISTINCT category) as categories
                FROM Feedbacks f
                WHERE f.to_user_id IN (${userIdsParam})
                    AND CAST(f.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
            `);
        
        const distribution = distributionResult.recordset[0];
        analytics.distribution = {
            total: distribution.total || 0,
            categories: distribution.categories || 0
        };
        
        res.json(analytics);
    } catch (error) {
        console.error('Erro ao buscar analytics:', error);
        res.status(500).json({ error: 'Erro ao buscar analytics' });
    }
});

// Exportar relatórios
app.get('/api/analytics/export', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department, format = 'csv' } = req.query;
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        console.log('📊 Exportando relatório:', { period, department, format });
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.status(404).json({ error: 'Nenhum dado encontrado para exportação' });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        // Buscar dados de engajamento (padrão)
            const result = await pool.request()
                .input('period', sql.Int, parseInt(period))
                .query(`
                    SELECT 
                        u.NomeCompleto,
                        u.Departamento,
                    u.Departamento,
                    COUNT(DISTINCT f_received.Id) as FeedbacksRecebidos,
                    COUNT(DISTINCT f_sent.Id) as FeedbacksEnviados,
                    COUNT(DISTINCT r_received.Id) as ReconhecimentosRecebidos,
                    COUNT(DISTINCT r_sent.Id) as ReconhecimentosEnviados,
                    COUNT(DISTINCT dm.Id) as EntradasHumor,
                    AVG(CAST(dm.score AS FLOAT)) as HumorMedio
                    FROM Users u
                LEFT JOIN Feedbacks f_received ON u.Id = f_received.to_user_id 
                    AND CAST(f_received.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                LEFT JOIN Feedbacks f_sent ON u.Id = f_sent.from_user_id 
                    AND CAST(f_sent.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                LEFT JOIN Recognitions r_received ON u.Id = r_received.to_user_id 
                    AND CAST(r_received.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                LEFT JOIN Recognitions r_sent ON u.Id = r_sent.from_user_id 
                    AND CAST(r_sent.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                        AND CAST(dm.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    WHERE u.Id IN (${userIdsParam})
                GROUP BY u.Id, u.NomeCompleto, u.Departamento, u.Departamento
                ORDER BY u.NomeCompleto
            `);
        
        // Formato Excel (arquivo .xlsx real com formatação)
        if (format === 'excel') {
            const ExcelJS = require('exceljs');
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Relatório de Analytics');
            
            // Configurar propriedades do workbook
            workbook.creator = 'LumiGente - Lumicenter';
            workbook.created = new Date();
            workbook.modified = new Date();
            
            // Adicionar título
            worksheet.mergeCells('A1:I1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = '📊 RELATÓRIO DE ANÁLISES - LUMIGENTE';
            titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
            titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
            titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(1).height = 30;
            
            // Adicionar informações do relatório
            worksheet.mergeCells('A2:I2');
            const infoCell = worksheet.getCell('A2');
            infoCell.value = `Período: Últimos ${period} dias | Departamento: ${department || 'Todos'} | Gerado em: ${new Date().toLocaleString('pt-BR')}`;
            infoCell.font = { name: 'Arial', size: 10, italic: true };
            infoCell.alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(2).height = 20;
            
            // Definir cabeçalhos
            worksheet.getRow(4).values = [
                'Nome',
                'Departamento',
                'Departamento',
                'Feedbacks Recebidos',
                'Feedbacks Enviados',
                'Reconhecimentos Recebidos',
                'Reconhecimentos Enviados',
                'Entradas de Humor',
                'Humor Médio'
            ];
            
            // Estilizar cabeçalhos
            worksheet.getRow(4).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            worksheet.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
            worksheet.getRow(4).alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(4).height = 25;
            
            // Adicionar bordas aos cabeçalhos
            for (let col = 1; col <= 9; col++) {
                const cell = worksheet.getRow(4).getCell(col);
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF000000' } },
                    left: { style: 'thin', color: { argb: 'FF000000' } },
                    bottom: { style: 'thin', color: { argb: 'FF000000' } },
                    right: { style: 'thin', color: { argb: 'FF000000' } }
                };
            }
            
            // Adicionar dados
            let rowIndex = 5;
            result.recordset.forEach((row, index) => {
                const dataRow = worksheet.getRow(rowIndex);
                dataRow.values = [
                    row.NomeCompleto || '',
                    row.Departamento || '',
                    row.Departamento || '',
                    row.FeedbacksRecebidos || 0,
                    row.FeedbacksEnviados || 0,
                    row.ReconhecimentosRecebidos || 0,
                    row.ReconhecimentosEnviados || 0,
                    row.EntradasHumor || 0,
                    row.HumorMedio ? parseFloat(row.HumorMedio.toFixed(2)) : 0
                ];
                
                // Alternar cores das linhas
                if (index % 2 === 0) {
                    dataRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
                }
                
                // Alinhar células
                dataRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
                dataRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
                dataRow.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
                for (let col = 4; col <= 9; col++) {
                    dataRow.getCell(col).alignment = { vertical: 'middle', horizontal: 'center' };
                }
                
                // Adicionar bordas
                for (let col = 1; col <= 9; col++) {
                    const cell = dataRow.getCell(col);
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
                        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
                    };
                }
                
                dataRow.font = { name: 'Arial', size: 10 };
                dataRow.height = 20;
                rowIndex++;
            });
            
            // Ajustar largura das colunas
            worksheet.getColumn(1).width = 30; // Nome
            worksheet.getColumn(2).width = 20; // Departamento
                worksheet.getColumn(3).width = 20; // Departamento
            worksheet.getColumn(4).width = 18; // Feedbacks Recebidos
            worksheet.getColumn(5).width = 18; // Feedbacks Enviados
            worksheet.getColumn(6).width = 22; // Reconhecimentos Recebidos
            worksheet.getColumn(7).width = 22; // Reconhecimentos Enviados
            worksheet.getColumn(8).width = 18; // Entradas de Humor
            worksheet.getColumn(9).width = 15; // Humor Médio
            
            // Formatação numérica para Humor Médio
            for (let i = 5; i < rowIndex; i++) {
                worksheet.getRow(i).getCell(9).numFmt = '0.00';
            }
            
            // Gerar buffer do arquivo Excel
            const buffer = await workbook.xlsx.writeBuffer();
            
            // Enviar arquivo
            const filename = `relatorio_analytics_${new Date().toISOString().split('T')[0]}.xlsx`;
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(buffer);
            
            console.log('✅ Relatório Excel exportado com sucesso:', filename);
        } else if (format === 'csv') {
            // Formato CSV
            const BOM = '\uFEFF';
            let reportData = BOM + 'Nome,Departamento,Feedbacks Recebidos,Feedbacks Enviados,Reconhecimentos Recebidos,Reconhecimentos Enviados,Entradas de Humor,Humor Médio\n';
            
                result.recordset.forEach(row => {
                const nome = `"${(row.NomeCompleto || '').replace(/"/g, '""')}"`;
                const dept = `"${(row.Departamento || '').replace(/"/g, '""')}"`;
                const humorMedio = row.HumorMedio ? row.HumorMedio.toFixed(2) : '0.00';
                
                reportData += `${nome},${dept},${row.FeedbacksRecebidos || 0},${row.FeedbacksEnviados || 0},${row.ReconhecimentosRecebidos || 0},${row.ReconhecimentosEnviados || 0},${row.EntradasHumor || 0},${humorMedio}\n`;
            });
            
            const filename = `relatorio_analytics_${new Date().toISOString().split('T')[0]}.csv`;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(reportData);
            
            console.log('✅ Relatório CSV exportado com sucesso:', filename);
            } else {
            // Formato texto plano
            let reportData = `═══════════════════════════════════════════════════\n`;
            reportData += `  RELATÓRIO DE ANÁLISES - LUMIGENTE\n`;
            reportData += `═══════════════════════════════════════════════════\n\n`;
            reportData += `Período: Últimos ${period} dias\n`;
                reportData += `Departamento: ${department || 'Todos'}\n`;
            reportData += `Gerado em: ${new Date().toLocaleString('pt-BR')}\n`;
            reportData += `Total de colaboradores: ${result.recordset.length}\n\n`;
            reportData += `═══════════════════════════════════════════════════\n\n`;
            
            result.recordset.forEach((row, index) => {
                reportData += `${index + 1}. ${row.NomeCompleto}\n`;
                reportData += `   Departamento: ${row.Departamento || 'N/A'}\n`;
                reportData += `   Cargo: ${row.Departamento || 'N/A'}\n`;
                reportData += `   📥 Feedbacks Recebidos: ${row.FeedbacksRecebidos || 0}\n`;
                reportData += `   📤 Feedbacks Enviados: ${row.FeedbacksEnviados || 0}\n`;
                reportData += `   🏆 Reconhecimentos Recebidos: ${row.ReconhecimentosRecebidos || 0}\n`;
                reportData += `   🎯 Reconhecimentos Enviados: ${row.ReconhecimentosEnviados || 0}\n`;
                reportData += `   😊 Entradas de Humor: ${row.EntradasHumor || 0}\n`;
                reportData += `   📊 Humor Médio: ${row.HumorMedio ? row.HumorMedio.toFixed(2) : 'N/A'}\n`;
                reportData += `\n`;
            });
            
            const filename = `relatorio_analytics_${new Date().toISOString().split('T')[0]}.txt`;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(reportData);
            
            console.log('✅ Relatório TXT exportado com sucesso:', filename);
        }
    } catch (error) {
        console.error('❌ Erro ao exportar relatório:', error);
        res.status(500).json({ error: 'Erro ao exportar relatório' });
    }
});



// Atualizar perfil do usuário
app.put('/api/usuario/profile', requireAuth, async (req, res) => {
    try {
        const { nomeCompleto, nome, departamento } = req.body;
        const userId = req.session.user.userId;
        
        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('nomeCompleto', sql.VarChar, nomeCompleto)
            .input('nome', sql.VarChar, nome)
            .input('departamento', sql.VarChar, departamento)
            .query(`
                UPDATE Users 
                SET NomeCompleto = @nomeCompleto,
                    nome = @nome,
                    Departamento = @departamento,
                    updated_at = GETDATE()
                WHERE Id = @userId
            `);
        
        res.json({ success: true, message: 'Perfil atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
});

// Alterar senha do usuário
app.put('/api/usuario/password', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const { currentPassword, newPassword } = req.body;
        const userId = req.session.user.userId;
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar senha atual
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT PasswordHash FROM Users WHERE Id = @userId
            `);
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        const isValidPassword = await bcrypt.compare(currentPassword, userResult.recordset[0].PasswordHash);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Senha atual incorreta' });
        }
        
        // Gerar nova senha hash
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        
        // Atualizar senha
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('passwordHash', sql.VarChar, newPasswordHash)
            .query(`
                UPDATE Users 
                SET PasswordHash = @passwordHash,
                    updated_at = GETDATE()
                WHERE Id = @userId
            `);
        
        res.json({ success: true, message: 'Senha alterada com sucesso' });
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(500).json({ error: 'Erro ao alterar senha' });
    }
});

// Salvar preferências de notificação
app.put('/api/usuario/notifications', requireAuth, async (req, res) => {
    try {
        const { feedback, recognition, objectives, surveys } = req.body;
        const userId = req.session.user.userId;
        
        // Simular salvamento de preferências
        console.log(`Preferências salvas para usuário ${userId}:`, { feedback, recognition, objectives, surveys });
        
        res.json({ success: true, message: 'Preferências salvas com sucesso' });
    } catch (error) {
        console.error('Erro ao salvar preferências:', error);
        res.status(500).json({ error: 'Erro ao salvar preferências' });
    }
});

// Salvar configurações de privacidade
app.put('/api/usuario/privacy', requireAuth, async (req, res) => {
    try {
        const { profileVisible, showDepartment, showPosition } = req.body;
        const userId = req.session.user.userId;
        
        // Simular salvamento de configurações
        console.log(`Configurações de privacidade salvas para usuário ${userId}:`, { profileVisible, showDepartment, showPosition });
        
        res.json({ success: true, message: 'Configurações salvas com sucesso' });
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});



// Rotas de sincronização (apenas para administradores)
app.post('/api/sync/start', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        const { intervalMinutes = 30 } = req.body;
        
        // Verificar se é administrador
        if (req.session.user.role !== 'Administrador') {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar sincronização.' });
        }
        
        await sincronizador.startAutoSync(intervalMinutes);
        res.json({ 
            success: true, 
            message: `Sincronização automática iniciada (intervalo: ${intervalMinutes} minutos)`,
            status: sincronizador.getStatus()
        });
    } catch (error) {
        console.error('Erro ao iniciar sincronização:', error);
        res.status(500).json({ error: 'Erro ao iniciar sincronização' });
    }
});

app.post('/api/sync/stop', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        // Verificar se é administrador
        if (req.session.user.role !== 'Administrador') {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem gerenciar sincronização.' });
        }
        
        sincronizador.stopAutoSync();
        res.json({ 
            success: true, 
            message: 'Sincronização automática parada',
            status: sincronizador.getStatus()
        });
    } catch (error) {
        console.error('Erro ao parar sincronização:', error);
        res.status(500).json({ error: 'Erro ao parar sincronização' });
    }
});

app.post('/api/sync/manual', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        // Verificar se é administrador
        if (req.session.user.role !== 'Administrador') {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem executar sincronização manual.' });
        }
        
        await sincronizador.syncManual();
        res.json({ 
            success: true, 
            message: 'Sincronização manual executada com sucesso',
            status: sincronizador.getStatus()
        });
    } catch (error) {
        console.error('Erro na sincronização manual:', error);
        res.status(500).json({ error: 'Erro na sincronização manual' });
    }
});

app.get('/api/sync/status', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        // Verificar se é administrador
        if (req.session.user.role !== 'Administrador') {
            return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem verificar status da sincronização.' });
        }
        
        res.json({ 
            success: true, 
            status: sincronizador.getStatus()
        });
    } catch (error) {
        console.error('Erro ao obter status da sincronização:', error);
        res.status(500).json({ error: 'Erro ao obter status da sincronização' });
    }
});



// =====================================================
// NOVO SISTEMA DE PESQUISAS - INTEGRAÇÃO
// =====================================================

// Importar e usar as novas rotas de pesquisas
const surveysRouter = require('./routes/surveys');
app.use('/api/surveys', surveysRouter);

// Endpoint para verificar permissões de migração
app.get('/api/migrate-surveys/check-permissions', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        
        const departamento = user.departamento ? user.departamento.toUpperCase() : '';
        const isAdmin = user.role === 'Administrador';
        const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
        const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     departamento.includes('TREINAMENTO') || 
                     departamento.includes('DESENVOLVIMENTO') ||
                     departamento.includes('T&D');
        
        const canMigrate = isAdmin || isHR || isTD;
        
        res.json({
            canMigrate,
            user: {
                nome: user.nomeCompleto,
                departamento: user.departamento,
                role: user.role,
                isAdmin,
                isHR,
                isTD
            },
            requirements: {
                message: canMigrate ? 
                    'Usuário tem permissões para executar a migração' : 
                    'Usuário não tem permissões para executar a migração',
                requiredRoles: ['Administrador', 'RH (Recursos Humanos)', 'T&D (Treinamento & Desenvolvimento)']
            }
        });
        
    } catch (error) {
        console.error('Erro ao verificar permissões:', error);
        res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
});

// Endpoint para migrar para o novo sistema
app.post('/api/migrate-surveys', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        
        // Verificar se é administrador, RH ou T&D
        const departamento = user.departamento ? user.departamento.toUpperCase() : '';
        const isAdmin = user.role === 'Administrador';
        const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
        const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     departamento.includes('TREINAMENTO') || 
                     departamento.includes('DESENVOLVIMENTO') ||
                     departamento.includes('T&D');
        
        if (!isAdmin && !isHR && !isTD) {
            return res.status(403).json({ 
                error: 'Acesso negado. Apenas administradores, usuários de RH e T&D podem executar a migração.',
                userInfo: {
                    departamento: user.departamento,
                    role: user.role,
                    isAdmin,
                    isHR,
                    isTD
                }
            });
        }
        
        console.log(`🔧 Migração iniciada por: ${user.nomeCompleto} (${user.departamento})`);
        
        const { migrarSistema } = require('./migrate_to_new_surveys');
        await migrarSistema();
        
        res.json({ 
            success: true, 
            message: 'Migração para o novo sistema de pesquisas concluída com sucesso!' 
        });
        
    } catch (error) {
        console.error('Erro na migração:', error);
        res.status(500).json({ 
            error: 'Erro na migração: ' + error.message 
        });
    }
});

// Rota para buscar usuários para feedback (SEM limitações hierárquicas)
app.get('/api/users/feedback', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        const users = await hierarchyManager.getUsersForFeedback();
        res.json(users);
    } catch (error) {
        console.error('❌ Erro ao buscar usuários para feedback:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota de debug específica para objetivos
app.get('/api/debug/objetivos', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Verificar e criar tabelas se necessário
        await ensureObjetivosTablesExist(pool);
        
        // Verificar estrutura das tabelas
        const objetivosCount = await pool.request().query('SELECT COUNT(*) as count FROM Objetivos');
        const checkinsCount = await pool.request().query('SELECT COUNT(*) as count FROM ObjetivoCheckins');
        
        // Buscar alguns objetivos de exemplo
        const objetivos = await pool.request().query(`
            SELECT TOP 5 o.*, u.NomeCompleto as responsavel_nome 
            FROM Objetivos o 
            LEFT JOIN Users u ON o.responsavel_id = u.Id 
            ORDER BY o.created_at DESC
        `);
        
        res.json({
            tabelas_criadas: true,
            total_objetivos: objetivosCount.recordset[0].count,
            total_checkins: checkinsCount.recordset[0].count,
            objetivos_exemplo: objetivos.recordset,
            status: 'Sistema de objetivos funcionando'
        });
    } catch (error) {
        console.error('Erro ao verificar objetivos:', error);
        res.status(500).json({ 
            error: 'Erro ao verificar objetivos: ' + error.message,
            tabelas_criadas: false
        });
    }
});

// Debug da hierarquia do usuário (GET)
// CORREÇÃO: Agora suporta CPF como query parameter para casos de matrícula duplicada
app.get('/api/debug/hierarchy/:matricula', requireAuth, async (req, res) => {
    try {
        const { matricula } = req.params;
        const { cpf } = req.query;  // ✅ Suportar CPF como query parameter opcional
        const pool = await sql.connect(dbConfig);
        
        console.log(`🔍 Verificando hierarquia para matrícula: ${matricula}${cpf ? ' (CPF: ' + cpf + ')' : ''}`);
        
        // CORREÇÃO: Buscar dados do funcionário com filtro de CPF se disponível
        const funcionarioQuery = cpf 
            ? `SELECT TOP 1 MATRICULA, NOME, CPF, DEPARTAMENTO, CENTRO_CUSTO, STATUS_GERAL
               FROM TAB_HIST_SRA 
               WHERE MATRICULA = @matricula AND CPF = @cpf
               ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END`
            : `SELECT TOP 1 MATRICULA, NOME, CPF, DEPARTAMENTO, CENTRO_CUSTO, STATUS_GERAL
               FROM TAB_HIST_SRA 
               WHERE MATRICULA = @matricula 
               ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END`;
        
        const funcionarioRequest = pool.request().input('matricula', sql.VarChar, matricula);
        if (cpf) funcionarioRequest.input('cpf', sql.VarChar, cpf);
        const funcionarioResult = await funcionarioRequest.query(funcionarioQuery);
        
        // CORREÇÃO: Buscar dados do usuário com filtro de CPF se disponível
        const userQuery = cpf
            ? `SELECT Id, NomeCompleto, CPF, HierarchyPath, Departamento
               FROM Users WHERE Matricula = @matricula AND CPF = @cpf`
            : `SELECT Id, NomeCompleto, CPF, HierarchyPath, Departamento
               FROM Users WHERE Matricula = @matricula`;
        
        const userRequest = pool.request().input('matricula', sql.VarChar, matricula);
        if (cpf) userRequest.input('cpf', sql.VarChar, cpf);
        const userResult = await userRequest.query(userQuery);
        
        // CORREÇÃO: Buscar hierarquias com filtro de CPF se disponível
        const cpfParaUsar = cpf || (funcionarioResult.recordset[0]?.CPF);
        const hierarquiaQuery = cpfParaUsar
            ? `SELECT * FROM HIERARQUIA_CC 
               WHERE (RESPONSAVEL_ATUAL = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_1_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_2_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_3_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_4_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
               ORDER BY LEN(HIERARQUIA_COMPLETA) DESC`
            : `SELECT * FROM HIERARQUIA_CC 
               WHERE RESPONSAVEL_ATUAL = @matricula
                  OR NIVEL_1_MATRICULA_RESP = @matricula
                  OR NIVEL_2_MATRICULA_RESP = @matricula
                  OR NIVEL_3_MATRICULA_RESP = @matricula
                  OR NIVEL_4_MATRICULA_RESP = @matricula
               ORDER BY LEN(HIERARQUIA_COMPLETA) DESC`;
        
        const hierarquiaRequest = pool.request().input('matricula', sql.VarChar, matricula);
        if (cpfParaUsar) hierarquiaRequest.input('cpfBusca', sql.VarChar, cpfParaUsar);
        const hierarquiaResult = await hierarquiaRequest.query(hierarquiaQuery);
        
        res.json({
            funcionario: funcionarioResult.recordset[0] || null,
            usuario: userResult.recordset[0] || null,
            hierarquias: hierarquiaResult.recordset,
            recomendacao: hierarquiaResult.recordset.length > 0 ? 'Deveria ser gestor (nível 3+)' : 'Funcionário comum (nível 0)',
            aviso: !cpf && funcionarioResult.recordset.length > 1 ? 'ATENÇÃO: Matrícula duplicada! Passe CPF como query parameter para resultado específico' : null
        });
    } catch (error) {
        console.error('Erro ao verificar hierarquia:', error);
        res.status(500).json({ error: error.message });
    }
});

// Debug e correção da hierarquia do usuário
// CORREÇÃO: Agora suporta CPF via body para casos de matrícula duplicada
app.post('/api/debug/fix-hierarchy/:matricula', requireAuth, async (req, res) => {
    try {
        const { matricula } = req.params;
        const { cpf } = req.body;  // ✅ Suportar CPF via body
        const pool = await sql.connect(dbConfig);
        
        console.log(`🔧 Corrigindo hierarquia para matrícula: ${matricula}${cpf ? ' (CPF: ' + cpf + ')' : ''}`);
        
        // CORREÇÃO: Buscar dados do funcionário com filtro de CPF se disponível
        const funcionarioQuery = cpf
            ? `SELECT TOP 1 MATRICULA, NOME, CPF, DEPARTAMENTO, CENTRO_CUSTO, STATUS_GERAL
               FROM TAB_HIST_SRA 
               WHERE MATRICULA = @matricula AND CPF = @cpf
               ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END`
            : `SELECT TOP 1 MATRICULA, NOME, CPF, DEPARTAMENTO, CENTRO_CUSTO, STATUS_GERAL
               FROM TAB_HIST_SRA 
               WHERE MATRICULA = @matricula 
               ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END`;
        
        const funcionarioRequest = pool.request().input('matricula', sql.VarChar, matricula);
        if (cpf) funcionarioRequest.input('cpf', sql.VarChar, cpf);
        const funcionarioResult = await funcionarioRequest.query(funcionarioQuery);
        
        if (funcionarioResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Funcionário não encontrado' });
        }
        
        const funcionario = funcionarioResult.recordset[0];
        console.log('Dados do funcionário:', funcionario);
        
        // CORREÇÃO: Buscar hierarquia onde é responsável com filtro de CPF
        const cpfParaUsar = cpf || funcionario.CPF;
        const hierarquiaQuery = cpfParaUsar
            ? `SELECT * FROM HIERARQUIA_CC 
               WHERE (RESPONSAVEL_ATUAL = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_1_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_2_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_3_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
                  OR (NIVEL_4_MATRICULA_RESP = @matricula AND CPF_RESPONSAVEL = @cpfBusca)
               ORDER BY LEN(HIERARQUIA_COMPLETA) DESC`
            : `SELECT * FROM HIERARQUIA_CC 
               WHERE RESPONSAVEL_ATUAL = @matricula
                  OR NIVEL_1_MATRICULA_RESP = @matricula
                  OR NIVEL_2_MATRICULA_RESP = @matricula
                  OR NIVEL_3_MATRICULA_RESP = @matricula
                  OR NIVEL_4_MATRICULA_RESP = @matricula
               ORDER BY LEN(HIERARQUIA_COMPLETA) DESC`;
        
        const hierarquiaRespRequest = pool.request().input('matricula', sql.VarChar, matricula);
        if (cpfParaUsar) hierarquiaRespRequest.input('cpfBusca', sql.VarChar, cpfParaUsar);
        const hierarquiaRespResult = await hierarquiaRespRequest.query(hierarquiaQuery);
        
        console.log('Hierarquias onde aparece:', hierarquiaRespResult.recordset);
        
        // Determinar nível correto
        let level = 0;
        let path = '';
        let departamento = funcionario.DEPARTAMENTO;
        
        if (hierarquiaRespResult.recordset.length > 0) {
            const hierarquia = hierarquiaRespResult.recordset[0];
            
            // Verificar em que nível está
            if (hierarquia.RESPONSAVEL_ATUAL === matricula) {
                level = 4; // Responsável direto
            } else if (hierarquia.NIVEL_4_MATRICULA_RESP === matricula) {
                level = 4; // Nível 4
            } else if (hierarquia.NIVEL_3_MATRICULA_RESP === matricula) {
                level = 3; // Nível 3
            } else if (hierarquia.NIVEL_2_MATRICULA_RESP === matricula) {
                level = 2; // Nível 2
            } else if (hierarquia.NIVEL_1_MATRICULA_RESP === matricula) {
                level = 1; // Nível 1
            }
            
            path = hierarquia.HIERARQUIA_COMPLETA;
            departamento = hierarquia.DESCRICAO_ATUAL;
        }
        
        // Atualizar usuário
        const updateResult = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .input('hierarchyPath', sql.VarChar, path)
            .input('departamento', sql.VarChar, departamento)
            .query(`
                UPDATE Users 
                SET HierarchyPath = @hierarchyPath,
                    Departamento = @departamento,
                    updated_at = GETDATE()
                WHERE Matricula = @matricula
            `);
        
        console.log(`✅ Hierarquia atualizada para ${matricula}: nível ${level}`);
        
        res.json({
            success: true,
            matricula: matricula,
            funcionario: funcionario,
            hierarquias: hierarquiaRespResult.recordset,
            novoNivel: level,
            novoCaminho: path,
            novoDepartamento: departamento,
            rowsAffected: updateResult.rowsAffected[0]
        });
    } catch (error) {
        console.error('Erro ao corrigir hierarquia:', error);
        res.status(500).json({ error: 'Erro ao corrigir hierarquia: ' + error.message });
    }
});

// === ROTAS DO SISTEMA DE OBJETIVOS ===

// Buscar filtros para objetivos
app.get('/api/objetivos/filtros', requireAuth, async (req, res) => {
    try {
        console.log('🔍 Buscando filtros para objetivos...');
        const pool = await sql.connect(dbConfig);
        
        // Verificar e criar tabelas se necessário
        await ensureObjetivosTablesExist(pool);
        
        // Buscar usuários para filtro de responsável
        const usuarios = await pool.request().query(`
            SELECT DISTINCT u.Id, u.NomeCompleto 
            FROM Users u
            WHERE u.Id IN (
                SELECT DISTINCT o.responsavel_id 
                FROM Objetivos o 
                WHERE o.responsavel_id IS NOT NULL
            )
            ORDER BY u.NomeCompleto
        `);
        
        console.log('👥 Usuários encontrados:', usuarios.recordset.length);
        
        // Buscar status únicos
        const status = await pool.request().query(`
            SELECT DISTINCT status 
            FROM Objetivos 
            WHERE status IS NOT NULL AND status != ''
            ORDER BY status
        `);
        
        console.log('📊 Status encontrados:', status.recordset.length);
        
        const response = {
            responsaveis: usuarios.recordset || [],
            status: status.recordset ? status.recordset.map(s => s.status) : ['Ativo', 'Concluído', 'Pausado', 'Cancelado']
        };
        
        console.log('✅ Filtros retornados:', response);
        res.json(response);
    } catch (error) {
        console.error('❌ Erro ao buscar filtros:', error);
        
        // Se as tabelas não existirem, retornar filtros padrão
        if (error.message && error.message.includes('Invalid object name')) {
            console.log('⚠️ Tabelas não existem, retornando filtros padrão');
            return res.json({
                responsaveis: [],
                status: ['Ativo', 'Concluído', 'Pausado', 'Cancelado']
            });
        }
        
        res.status(500).json({ error: 'Erro ao buscar filtros: ' + error.message });
    }
});

// Listar objetivos
app.get('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        const { responsavel, status, search } = req.query;
        
        let query = `
            SELECT 
                o.*,
                u1.NomeCompleto as responsavel_nome,
                u2.NomeCompleto as criado_por_nome
            FROM Objetivos o
            LEFT JOIN Users u1 ON o.responsavel_id = u1.Id
            LEFT JOIN Users u2 ON o.criado_por = u2.Id
            WHERE 1=1
        `;
        
        const request = pool.request();
        
        if (responsavel) {
            query += ' AND o.responsavel_id = @responsavel';
            request.input('responsavel', sql.Int, responsavel);
        }
        
        if (status) {
            query += ' AND o.status = @status';
            request.input('status', sql.NVarChar, status);
        }
        
        if (search) {
            query += ' AND (o.titulo LIKE @search OR o.descricao LIKE @search)';
            request.input('search', sql.NVarChar, `%${search}%`);
        }
        
        query += ' ORDER BY o.created_at DESC';
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar objetivos:', error);
        res.status(500).json({ error: 'Erro ao buscar objetivos' });
    }
});

// Função para verificar e criar tabelas de objetivos
async function ensureObjetivosTablesExist(pool) {
    try {
        // Verificar se tabela Objetivos existe
        const objetivosExists = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'Objetivos'
        `);
        
        if (objetivosExists.recordset[0].count === 0) {
            console.log('Criando tabela Objetivos...');
            await pool.request().query(`
                CREATE TABLE Objetivos (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    titulo NVARCHAR(255) NOT NULL,
                    descricao NTEXT,
                    responsavel_id INT NOT NULL,
                    criado_por INT NOT NULL,
                    data_inicio DATE NOT NULL,
                    data_fim DATE NOT NULL,
                    status NVARCHAR(50) DEFAULT 'Ativo',
                    progresso DECIMAL(5,2) DEFAULT 0,
                    created_at DATETIME DEFAULT GETDATE(),
                    updated_at DATETIME DEFAULT GETDATE()
                )
            `);
            console.log('✅ Tabela Objetivos criada com sucesso');
        }
        
        // Verificar se tabela ObjetivoCheckins existe
        const checkinsExists = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'ObjetivoCheckins'
        `);
        
        if (checkinsExists.recordset[0].count === 0) {
            console.log('Criando tabela ObjetivoCheckins...');
            await pool.request().query(`
                CREATE TABLE ObjetivoCheckins (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    objetivo_id INT NOT NULL,
                    user_id INT NOT NULL,
                    progresso DECIMAL(5,2) NOT NULL,
                    observacoes NTEXT,
                    created_at DATETIME DEFAULT GETDATE()
                )
            `);
            console.log('✅ Tabela ObjetivoCheckins criada com sucesso');
        }
        
        // Verificar se tabela ObjetivoResponsaveis existe (para objetivos compartilhados)
        const responsaveisExists = await pool.request().query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'ObjetivoResponsaveis'
        `);
        
        if (responsaveisExists.recordset[0].count === 0) {
            console.log('Criando tabela ObjetivoResponsaveis...');
            try {
                // Primeiro criar a tabela básica
                await pool.request().query(`
                    CREATE TABLE ObjetivoResponsaveis (
                        Id INT IDENTITY(1,1) PRIMARY KEY,
                        objetivo_id INT NOT NULL,
                        responsavel_id INT NOT NULL,
                        created_at DATETIME DEFAULT GETDATE()
                    )
                `);
                
                // Adicionar constraints separadamente
                await pool.request().query(`
                    ALTER TABLE ObjetivoResponsaveis 
                    ADD CONSTRAINT FK_ObjetivoResponsaveis_Objetivo 
                        FOREIGN KEY (objetivo_id) REFERENCES Objetivos(Id) ON DELETE CASCADE
                `);
                
                await pool.request().query(`
                    ALTER TABLE ObjetivoResponsaveis 
                    ADD CONSTRAINT FK_ObjetivoResponsaveis_User 
                        FOREIGN KEY (responsavel_id) REFERENCES Users(Id) ON DELETE CASCADE
                `);
                
                await pool.request().query(`
                    ALTER TABLE ObjetivoResponsaveis 
                    ADD CONSTRAINT UQ_ObjetivoResponsaveis 
                        UNIQUE (objetivo_id, responsavel_id)
                `);
                
                console.log('✅ Tabela ObjetivoResponsaveis criada com sucesso');
            } catch (fkError) {
                console.log('⚠️ Erro ao criar constraints FK, mas tabela básica criada:', fkError.message);
                console.log('✅ Tabela ObjetivoResponsaveis criada (sem algumas constraints)');
            }
        }
    } catch (error) {
        console.error('Erro ao verificar/criar tabelas de objetivos:', error);
    }
}

// Criar objetivo
app.post('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const { titulo, descricao, responsavel_id, data_inicio, data_fim } = req.body;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar e criar tabelas se necessário
        await ensureObjetivosTablesExist(pool);
        
        // Validar campos obrigatórios
        if (!titulo || !responsavel_id || !data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }
        
        // Inserir objetivo
        const result = await pool.request()
            .input('titulo', sql.NVarChar(255), titulo)
            .input('descricao', sql.Text, descricao || '')
            .input('responsavel_id', sql.Int, responsavel_id)
            .input('criado_por', sql.Int, userId)
            .input('data_inicio', sql.Date, data_inicio)
            .input('data_fim', sql.Date, data_fim)
            .query(`
                INSERT INTO Objetivos (titulo, descricao, responsavel_id, criado_por, data_inicio, data_fim, status, progresso, created_at)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @responsavel_id, @criado_por, @data_inicio, @data_fim, 'Ativo', 0, GETDATE())
            `);
        
        const objetivoId = result.recordset[0].Id;
        res.json({ success: true, message: 'Objetivo criado com sucesso', id: objetivoId });
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        res.status(500).json({ error: 'Erro ao criar objetivo: ' + error.message });
    }
});

// Buscar objetivos
app.get('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar e criar tabelas se necessário
        await ensureObjetivosTablesExist(pool);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    o.*,
                    u.NomeCompleto as responsavel_nome
                FROM Objetivos o
                JOIN Users u ON o.responsavel_id = u.Id
                WHERE o.responsavel_id = @userId OR o.criado_por = @userId
                ORDER BY o.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar objetivos:', error);
        
        // Se for erro de tabela não existir, retornar array vazio
        if (error.message && error.message.includes('Invalid object name')) {
            return res.json([]);
        }
        
        res.status(500).json({ error: 'Erro ao buscar objetivos: ' + error.message });
    }
});

// Criar objetivo
app.post('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const { titulo, descricao, responsavel_id, data_inicio, data_fim } = req.body;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('titulo', sql.NVarChar, titulo)
            .input('descricao', sql.NText, descricao)
            .input('responsavel_id', sql.Int, responsavel_id)
            .input('criado_por', sql.Int, userId)
            .input('data_inicio', sql.Date, data_inicio)
            .input('data_fim', sql.Date, data_fim)
            .query(`
                INSERT INTO Objetivos (titulo, descricao, responsavel_id, criado_por, data_inicio, data_fim)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @responsavel_id, @criado_por, @data_inicio, @data_fim)
            `);
        
        res.json({ success: true, id: result.recordset[0].Id });
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        res.status(500).json({ error: 'Erro ao criar objetivo' });
    }
});

// Buscar objetivo específico
app.get('/api/objetivos/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT 
                    o.*,
                    u1.NomeCompleto as responsavel_nome,
                    u2.NomeCompleto as criado_por_nome
                FROM Objetivos o
                LEFT JOIN Users u1 ON o.responsavel_id = u1.Id
                LEFT JOIN Users u2 ON o.criado_por = u2.Id
                WHERE o.Id = @id
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Erro ao buscar objetivo:', error);
        res.status(500).json({ error: 'Erro ao buscar objetivo' });
    }
});

// Atualizar objetivo
app.put('/api/objetivos/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, descricao, responsavel_id, responsaveis_ids, data_inicio, data_fim, status, progresso } = req.body;
        const userId = req.session.user.userId;
        
        console.log('🔄 Atualizando objetivo:', { id, titulo, descricao, responsavel_id, responsaveis_ids, data_inicio, data_fim, userId });
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o objetivo existe e se o usuário tem permissão para editá-lo
        const objetivoCheck = await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT criado_por, responsavel_id, status
                FROM Objetivos 
                WHERE Id = @objetivoId
            `);
        
        if (objetivoCheck.recordset.length === 0) {
            console.log('❌ Objetivo não encontrado:', id);
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        const objetivo = objetivoCheck.recordset[0];
        console.log('📋 Objetivo encontrado:', objetivo);
        
        // Verificar permissões de edição
        let canEdit = false;
        let canEditDate = false;
        
        if (objetivo.criado_por === userId) {
            // Criador pode editar tudo
            canEdit = true;
            canEditDate = true;
        } else if (objetivo.responsavel_id === userId) {
            // Responsável pode editar apenas conteúdo, não data
            canEdit = true;
            canEditDate = false;
        }
        
        if (!canEdit) {
            console.log('❌ Sem permissão para editar:', { canEdit, canEditDate, userId, criado_por: objetivo.criado_por, responsavel_id: objetivo.responsavel_id });
            return res.status(403).json({ error: 'Você não tem permissão para editar este objetivo' });
        }
        
        console.log('✅ Permissões OK:', { canEdit, canEditDate });
        
        // Construir query de atualização
        let updateFields = [];
        let statusChanged = false;
        let novoStatus = null;
        
        if (titulo) {
            updateFields.push('titulo = @titulo');
        }
        
        if (descricao !== undefined) {
            updateFields.push('descricao = @descricao');
        }
        
        if (responsavel_id && canEdit) {
            updateFields.push('responsavel_id = @responsavel_id');
        }
        
        if (data_inicio && canEditDate) {
            updateFields.push('data_inicio = @data_inicio');
            
            // Recalcular status se data de início foi alterada
            const hoje = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const novaDataInicioStr = data_inicio.split('T')[0]; // YYYY-MM-DD
            
            novoStatus = novaDataInicioStr > hoje ? 'Agendado' : 'Ativo';
            updateFields.push('status = @novoStatus');
            statusChanged = true;
        }
        
        if (data_fim && canEditDate) {
            updateFields.push('data_fim = @data_fim');
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar' });
        }
        
        updateFields.push('updated_at = GETDATE()');
        
        const request = pool.request();
        request.input('id', sql.Int, id);
        
        if (titulo) {
            request.input('titulo', sql.NVarChar(255), titulo);
        }
        
        if (descricao !== undefined) {
            request.input('descricao', sql.Text, descricao);
        }
        
        if (responsavel_id && canEdit) {
            request.input('responsavel_id', sql.Int, responsavel_id);
        }
        
        if (data_inicio && canEditDate) {
            request.input('data_inicio', sql.Date, new Date(data_inicio));
        }
        
        if (data_fim && canEditDate) {
            request.input('data_fim', sql.Date, new Date(data_fim));
        }
        
        if (statusChanged) {
            request.input('novoStatus', sql.NVarChar(50), novoStatus);
        }
        
        const query = `UPDATE Objetivos SET ${updateFields.join(', ')} WHERE Id = @id`;
        
        console.log('🔧 Query de atualização:', query);
        console.log('📊 Campos a atualizar:', updateFields);
        
        await request.query(query);
        
        // Atualizar responsáveis múltiplos se fornecidos
        if (responsaveis_ids && Array.isArray(responsaveis_ids) && responsaveis_ids.length > 0) {
            console.log('🔄 Atualizando responsáveis múltiplos:', responsaveis_ids);
            
            try {
                // Remover responsáveis existentes no ObjetivoResponsaveis
        await pool.request()
                    .input('objetivoId', sql.Int, id)
                    .query('DELETE FROM ObjetivoResponsaveis WHERE objetivo_id = @objetivoId');
                
                // Adicionar novos responsáveis
                for (const responsavelId of responsaveis_ids) {
                    if (responsavelId) {
                        await pool.request()
                            .input('objetivoId', sql.Int, id)
                            .input('responsavelId', sql.Int, responsavelId)
            .query(`
                                INSERT INTO ObjetivoResponsaveis (objetivo_id, responsavel_id, created_at) 
                                VALUES (@objetivoId, @responsavelId, GETDATE())
                            `);
                    }
                }
                
                // Atualizar responsável principal na tabela Objetivos (primeiro da lista para backward compatibility)
                if (responsaveis_ids[0]) {
                    await pool.request()
                        .input('objid', sql.Int, id)
                        .input('newResponsavelId', sql.Int, responsaveis_ids[0])
                        .query('UPDATE Objetivos SET responsavel_id = @newResponsavelId WHERE Id = @objid');
                }
                
                console.log('✅ Responsáveis múltiplos atualizados com sucesso');
            } catch (error) {
                console.log('⚠️ Erro ao atualizar responsáveis múltiplos (tabela pode não existir):', error);
                // Não falhar a operação se a tabela não existir
            }
        }
        
        res.json({ success: true, message: 'Objetivo atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar objetivo:', error);
        res.status(500).json({ error: 'Erro ao atualizar objetivo' });
    }
});

// Deletar objetivo
app.delete('/api/objetivos/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Deletar checkins relacionados primeiro
        await pool.request()
            .input('objetivo_id', sql.Int, id)
            .query('DELETE FROM ObjetivoCheckins WHERE objetivo_id = @objetivo_id');
        
        // Deletar objetivo
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Objetivos WHERE Id = @id');
        
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao deletar objetivo:', error);
        res.status(500).json({ error: 'Erro ao deletar objetivo' });
    }
});

// Endpoint para dados históricos processados
app.get('/api/historico/dados', requireAuth, async (req, res) => {
    try {
        console.log('📊 Processando dados históricos...');
        
        // Verifica se o usuário tem permissão para acessar histórico
        const user = req.session.user;
        const temPermissao = verificarPermissaoHistorico(user);
        
        if (!temPermissao) {
            // Log de tentativa de acesso não autorizado
            console.warn('🚨 Tentativa de acesso não autorizado ao histórico:', {
                usuario: user?.nome || user?.email || 'Desconhecido',
                departamento: user?.departamento || 'N/A',
                ip: req.ip || req.connection.remoteAddress,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({ 
                error: 'Acesso negado. Apenas usuários dos setores RH ou Departamento de Treinamento e Desenvolvimento podem acessar os dados históricos.',
                code: 'HISTORICO_ACCESS_DENIED'
            });
        }
        
        // Executa o script Python para processar os arquivos Excel
        const pythonScript = path.join(__dirname, 'scripts', 'processar_historico_excel.py');
        
        return new Promise((resolve, reject) => {
            const python = spawn('python', [pythonScript], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Dados históricos processados com sucesso');
                    
                    // Tenta carregar o cache gerado pelo Python
                    const cacheFile = path.join(__dirname, 'public', 'historico_feedz', 'cache_dados_historico.json');
                    
                    try {
                        const fs = require('fs');
                        if (fs.existsSync(cacheFile)) {
                            const dados = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                            res.json({
                                success: true,
                                dados: dados,
                                timestamp: new Date().toISOString(),
                                processado_por: 'python'
                            });
                        } else {
                            // Fallback: retorna dados simulados
                            res.json({
                                success: true,
                                dados: gerarDadosSimulados(),
                                timestamp: new Date().toISOString(),
                                processado_por: 'fallback'
                            });
                        }
                    } catch (error) {
                        console.error('Erro ao carregar cache:', error);
                        res.json({
                            success: true,
                            dados: gerarDadosSimulados(),
                            timestamp: new Date().toISOString(),
                            processado_por: 'fallback'
                        });
                    }
                    
                    resolve();
                } else {
                    console.error('❌ Erro ao processar dados históricos:', stderr);
                    res.status(500).json({
                        error: 'Erro ao processar dados históricos',
                        details: stderr
                    });
                    reject(new Error(stderr));
                }
            });
            
            python.on('error', (error) => {
                console.error('❌ Erro ao executar script Python:', error);
                res.status(500).json({
                    error: 'Erro ao executar processamento',
                    details: error.message
                });
                reject(error);
            });
        });
        
    } catch (error) {
        console.error('❌ Erro no endpoint de histórico:', error);
        res.status(500).json({
            error: 'Erro interno do servidor',
            details: error.message
        });
    }
});

// Função para verificar permissão de histórico
// Setores com acesso: RH, DEPARTAMENTO TREINAM&DESENVOLV, COORDENACAO ADM/RH/SESMT MAO, DEPARTAMENTO ADM/RH/SESMT
function verificarPermissaoHistorico(usuario) {
    if (!usuario) return false;
    
    const setoresPermitidos = [
        'RH', 
        'DEPARTAMENTO TREINAM&DESENVOLV',
        'COORDENACAO ADM/RH/SESMT MAO',
        'DEPARTAMENTO ADM/RH/SESMT'
    ];
    
    // Verifica se o departamento/setor do usuário está na lista permitida
    if (usuario.departamento) {
        const departamentoUsuario = usuario.departamento.toUpperCase().trim();
        
        // Verifica correspondência exata ou parcial para variações do nome
        for (let setor of setoresPermitidos) {
            if (departamentoUsuario === setor || 
                (departamentoUsuario.includes('TREINAM') && departamentoUsuario.includes('DESENVOLV')) ||
                departamentoUsuario === 'RH' ||
                departamentoUsuario === 'RECURSOS HUMANOS' ||
                departamentoUsuario.includes('COORDENACAO ADM') ||
                (departamentoUsuario.includes('COORDENACAO') && departamentoUsuario.includes('SESMT')) ||
                (departamentoUsuario.includes('DEPARTAMENTO ADM') && departamentoUsuario.includes('SESMT')) ||
                (departamentoUsuario.startsWith('DEPARTAMENTO ADM/RH'))) {
                return true;
            }
        }
    }
    
    // Verifica por permissões específicas
    if (usuario.permissoes && Array.isArray(usuario.permissoes)) {
        return usuario.permissoes.includes('rh') || 
               usuario.permissoes.includes('treinamento') ||
               usuario.permissoes.includes('historico');
    }
    
    // Para desenvolvimento: permitir acesso se for admin
    if (usuario.role === 'Administrador' || usuario.is_admin) {
        return true;
    }
    
    return false;
}

// ================================================================
// ROTAS DE AVALIAÇÕES
// ================================================================

/**
 * Verifica permissões de avaliações
 * RH, T&D e DEPARTAMENTO ADM/RH/SESMT podem ver todas as avaliações
 */
function verificarPermissaoAvaliacoesAdmin(usuario) {
    if (!usuario) return false;
    
    const departamento = usuario.departamento ? usuario.departamento.toUpperCase().trim() : '';
    
    const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
    const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                 departamento.includes('TREINAMENTO') || 
                 departamento.includes('DESENVOLVIMENTO') ||
                 departamento.includes('T&D');
    const isDeptAdm = (departamento.includes('DEPARTAMENTO ADM') && departamento.includes('SESMT')) ||
                      (departamento.startsWith('DEPARTAMENTO ADM/RH'));
    const isAdmin = usuario.role === 'Administrador' || usuario.is_admin;
    
    return isAdmin || isHR || isTD || isDeptAdm;
}

// Listar avaliações do usuário
app.get('/api/avaliacoes/minhas', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Buscar avaliações do usuário
        const temPermissaoAdmin = verificarPermissaoAvaliacoesAdmin(user);
        const avaliacoes = await AvaliacoesManager.buscarAvaliacoesUsuario(pool, user.userId, temPermissaoAdmin);
        
        res.json(avaliacoes);
        
    } catch (error) {
        console.error('Erro ao buscar avaliações:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliações' });
    }
});

// Buscar todas as avaliações (apenas para RH, T&D e DEPARTAMENTO ADM/RH/SESMT)
app.get('/api/avaliacoes/todas', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        
        // Verificar permissão
        if (!verificarPermissaoAvaliacoesAdmin(user)) {
            return res.status(403).json({ 
                error: 'Acesso negado. Apenas RH, T&D e DEPARTAMENTO ADM/RH/SESMT podem visualizar todas as avaliações.' 
            });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Buscar todas as avaliações
        const result = await pool.request().query(`
            SELECT 
                a.Id,
                a.UserId,
                a.GestorId,
                a.Matricula,
                a.DataAdmissao,
                a.DataCriacao,
                a.DataLimiteResposta,
                a.StatusAvaliacao,
                a.RespostaColaboradorConcluida,
                a.RespostaGestorConcluida,
                a.DataRespostaColaborador,
                a.DataRespostaGestor,
                t.Nome as TipoAvaliacao,
                u.NomeCompleto,
                u.Departamento,
                u.Departamento,
                g.NomeCompleto as NomeGestor
            FROM Avaliacoes a
            INNER JOIN TiposAvaliacao t ON a.TipoAvaliacaoId = t.Id
            INNER JOIN Users u ON a.UserId = u.Id
            LEFT JOIN Users g ON a.GestorId = g.Id
            ORDER BY a.DataCriacao DESC
        `);
        
        res.json(result.recordset);
        
    } catch (error) {
        console.error('Erro ao buscar todas as avaliações:', error);
        res.status(500).json({ error: 'Erro ao buscar todas as avaliações' });
    }
});

// Buscar respostas de uma avaliação
app.get('/api/avaliacoes/:id/respostas', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Buscar avaliação
        const avaliacaoResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT * FROM Avaliacoes WHERE Id = @id');
        
        if (avaliacaoResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        const avaliacao = avaliacaoResult.recordset[0];
        
        // Verificar permissão
        const temPermissao = avaliacao.UserId === user.userId || 
                            avaliacao.GestorId === user.userId ||
                            verificarPermissaoAvaliacoesAdmin(user);
        
        if (!temPermissao) {
            return res.status(403).json({ error: 'Sem permissão' });
        }
        
        // Buscar perguntas específicas da avaliação (snapshot)
        const perguntas = await AvaliacoesManager.buscarPerguntasAvaliacao(pool, id);
        
        // Determinar se usuário é participante ou RH/Admin
        const eParticipante = avaliacao.UserId === user.userId || avaliacao.GestorId === user.userId;
        
        let minhasRespostas, respostasOutraParte;
        
        if (eParticipante) {
            // Usuário é participante: minhas respostas e respostas da outra parte
            const minhasRespostasResult = await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .input('userId', sql.Int, user.userId)
                .query(`
                    SELECT * FROM RespostasAvaliacoes
                    WHERE AvaliacaoId = @avaliacaoId
                        AND RespondidoPor = @userId
                    ORDER BY PerguntaId
                `);
            
            const respostasOutraParteResult = await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .input('userId', sql.Int, user.userId)
                .query(`
                    SELECT * FROM RespostasAvaliacoes
                    WHERE AvaliacaoId = @avaliacaoId
                        AND RespondidoPor != @userId
                    ORDER BY PerguntaId
                `);
            
            minhasRespostas = minhasRespostasResult.recordset;
            respostasOutraParte = respostasOutraParteResult.recordset;
        } else {
            // RH/Admin: mostrar respostas do colaborador primeiro, depois do gestor
            const respostasColaboradorResult = await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .query(`
                    SELECT * FROM RespostasAvaliacoes
                    WHERE AvaliacaoId = @avaliacaoId
                        AND TipoRespondente = 'Colaborador'
                    ORDER BY PerguntaId
                `);
            
            const respostasGestorResult = await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .query(`
                    SELECT * FROM RespostasAvaliacoes
                    WHERE AvaliacaoId = @avaliacaoId
                        AND TipoRespondente = 'Gestor'
                    ORDER BY PerguntaId
                `);
            
            minhasRespostas = respostasColaboradorResult.recordset;
            respostasOutraParte = respostasGestorResult.recordset;
        }
        
        res.json({
            perguntas: perguntas,
            minhasRespostas: minhasRespostas,
            respostasOutraParte: respostasOutraParte
        });
        
    } catch (error) {
        console.error('Erro ao buscar respostas:', error);
        res.status(500).json({ error: 'Erro ao buscar respostas' });
    }
});

// Buscar questionário padrão
app.get('/api/avaliacoes/questionario/:tipo', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const { tipo } = req.params; // '45' ou '90'
        
        if (tipo !== '45' && tipo !== '90') {
            return res.status(400).json({ error: 'Tipo de questionário inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        const questionario = await AvaliacoesManager.buscarQuestionarioPadrao(pool, tipo);
        
        res.json(questionario);
        
    } catch (error) {
        console.error('Erro ao buscar questionário:', error);
        res.status(500).json({ error: 'Erro ao buscar questionário' });
    }
});

// Salvar resposta de avaliação
app.post('/api/avaliacoes/responder', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        const { avaliacaoId, respostas, tipoRespondente } = req.body;
        
        // Validar dados
        if (!avaliacaoId || !respostas || !Array.isArray(respostas) || !tipoRespondente) {
            return res.status(400).json({ error: 'Dados inválidos' });
        }
        
        if (tipoRespondente !== 'Colaborador' && tipoRespondente !== 'Gestor') {
            return res.status(400).json({ error: 'Tipo de respondente inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se a avaliação existe e se o usuário tem permissão
        const avaliacaoResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .query('SELECT * FROM Avaliacoes WHERE Id = @avaliacaoId');
        
        const avaliacao = avaliacaoResult.recordset[0];
        if (!avaliacao) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        // Verificar se a avaliação está agendada (ainda não chegou no período de resposta)
        if (avaliacao.StatusAvaliacao === 'Agendada') {
            const dataAdmissao = new Date(avaliacao.DataAdmissao);
            const hoje = new Date();
            const diasDesdeAdmissao = Math.floor((hoje - dataAdmissao) / (1000 * 60 * 60 * 24));
            const diasNecessarios = avaliacao.TipoAvaliacaoId === 1 ? 45 : 90;
            const diasFaltantes = diasNecessarios - diasDesdeAdmissao;
            
            return res.status(400).json({ 
                error: 'Esta avaliação ainda não está disponível',
                message: `Faltam aproximadamente ${diasFaltantes} dia(s) para que você possa responder esta avaliação.`,
                diasFaltantes: diasFaltantes
            });
        }
        
        // Verificar se a avaliação está expirada
        const agora = new Date();
        const dataLimite = new Date(avaliacao.DataLimiteResposta);
        
        if (agora > dataLimite) {
            return res.status(400).json({ 
                error: 'Esta avaliação está expirada',
                message: 'O prazo para responder esta avaliação expirou. Entre em contato com o RH se necessário.',
                dataLimite: dataLimite.toISOString()
            });
        }
        
        // Verificar se avaliação está com status Expirada
        if (avaliacao.StatusAvaliacao === 'Expirada') {
            return res.status(400).json({ 
                error: 'Esta avaliação está expirada',
                message: 'Esta avaliação foi marcada como expirada. Entre em contato com o RH se necessário.'
            });
        }
        
        // Se for colaborador, verificar se é o próprio
        if (tipoRespondente === 'Colaborador' && avaliacao.UserId !== user.userId) {
            return res.status(403).json({ error: 'Você não tem permissão para responder esta avaliação' });
        }
        
        // Se for gestor, verificar se é gestor do usuário avaliado
        if (tipoRespondente === 'Gestor' && avaliacao.GestorId !== user.userId) {
            return res.status(403).json({ error: 'Você não é o gestor responsável por esta avaliação' });
        }
        
        // Verificar se já respondeu
        if (tipoRespondente === 'Colaborador' && avaliacao.RespostaColaboradorConcluida) {
            return res.status(400).json({ error: 'Você já respondeu esta avaliação' });
        }
        
        if (tipoRespondente === 'Gestor' && avaliacao.RespostaGestorConcluida) {
            return res.status(400).json({ error: 'Você já respondeu esta avaliação' });
        }
        
        // Salvar cada resposta
        for (const resposta of respostas) {
            await AvaliacoesManager.salvarRespostaAvaliacao(pool, {
                avaliacaoId,
                perguntaId: resposta.perguntaId,
                tipoQuestionario: resposta.tipoQuestionario,
                pergunta: resposta.pergunta,
                tipoPergunta: resposta.tipoPergunta,
                resposta: resposta.resposta,
                respondidoPor: user.userId,
                tipoRespondente,
                opcaoSelecionadaId: resposta.opcaoSelecionadaId || null
            });
        }
        
        // Marcar avaliação como concluída
        await AvaliacoesManager.concluirAvaliacao(pool, avaliacaoId, tipoRespondente);
        
        res.json({ success: true, message: 'Respostas salvas com sucesso' });
        
    } catch (error) {
        console.error('Erro ao salvar respostas:', error);
        res.status(500).json({ error: 'Erro ao salvar respostas' });
    }
});

// Atualizar questionário padrão (apenas RH, T&D e DEPARTAMENTO ADM/RH/SESMT)
app.put('/api/avaliacoes/questionario/:tipo', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        const { tipo } = req.params;
        const { perguntas } = req.body;
        
        console.log('📝 Requisição para atualizar questionário tipo:', tipo);
        console.log('👤 Usuário:', user.nome, 'Departamento:', user.departamento);
        console.log('📋 Perguntas recebidas:', perguntas ? perguntas.length : 0);
        
        // Verificar permissão
        if (!verificarPermissaoAvaliacoesAdmin(user)) {
            console.log('🚫 Acesso negado para usuário:', user.nome);
            return res.status(403).json({ 
                error: 'Acesso negado. Apenas RH, T&D e DEPARTAMENTO ADM/RH/SESMT podem editar questionários.' 
            });
        }
        
        if (tipo !== '45' && tipo !== '90') {
            console.log('❌ Tipo inválido:', tipo);
            return res.status(400).json({ error: 'Tipo de questionário inválido' });
        }
        
        if (!perguntas || !Array.isArray(perguntas)) {
            console.log('❌ Perguntas inválidas ou não é array');
            return res.status(400).json({ error: 'Perguntas inválidas' });
        }
        
        console.log('✅ Validações passaram, iniciando atualização...');
        
        const pool = await sql.connect(dbConfig);
        const resultado = await AvaliacoesManager.atualizarQuestionarioPadrao(pool, tipo, perguntas);
        
        console.log('✅ Questionário atualizado com sucesso:', resultado);
        
        res.json({ success: true, message: 'Questionário atualizado com sucesso' });
        
    } catch (error) {
        console.error('❌ Erro ao atualizar questionário:', error);
        res.status(500).json({ error: 'Erro ao atualizar questionário: ' + error.message });
    }
});

// Reabrir avaliação expirada (apenas RH, T&D, DEPARTAMENTO ADM/RH/SESMT)
app.post('/api/avaliacoes/:id/reabrir', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        const { id } = req.params;
        const { novaDataLimite } = req.body;
        
        // Verificar permissão (apenas RH/T&D/DEPARTAMENTO ADM/RH/SESMT)
        if (!verificarPermissaoAvaliacoesAdmin(user)) {
            return res.status(403).json({ 
                error: 'Acesso negado. Apenas RH, T&D e DEPARTAMENTO ADM/RH/SESMT podem reabrir avaliações.' 
            });
        }
        
        if (!novaDataLimite) {
            return res.status(400).json({ error: 'Nova data limite é obrigatória' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se avaliação está expirada
        const avaliacaoResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT * FROM Avaliacoes WHERE Id = @id');
        
        if (avaliacaoResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        const avaliacao = avaliacaoResult.recordset[0];
        
        // Atualizar data limite e status
        await pool.request()
            .input('id', sql.Int, id)
            .input('novaDataLimite', sql.DateTime, new Date(novaDataLimite))
            .query(`
                UPDATE Avaliacoes
                SET DataLimiteResposta = @novaDataLimite,
                    StatusAvaliacao = 'Pendente',
                    AtualizadoEm = GETDATE()
                WHERE Id = @id
            `);
        
        console.log(`✅ Avaliação ${id} reaberta. Nova data limite: ${novaDataLimite}`);
        
        res.json({ success: true, message: 'Avaliação reaberta com sucesso' });
        
    } catch (error) {
        console.error('Erro ao reabrir avaliação:', error);
        res.status(500).json({ error: 'Erro ao reabrir avaliação' });
    }
});

// Executar verificação manual de avaliações (apenas admins)
app.post('/api/avaliacoes/verificar', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        
        // Apenas administradores podem executar verificação manual
        if (user.role !== 'Administrador' && !user.is_admin) {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const pool = await sql.connect(dbConfig);
        const resultado = await AvaliacoesManager.verificarECriarAvaliacoes(pool);
        
        res.json(resultado);
        
    } catch (error) {
        console.error('Erro ao verificar avaliações:', error);
        res.status(500).json({ error: 'Erro ao verificar avaliações' });
    }
});

// Buscar avaliação específica por ID (DEVE SER A ÚLTIMA ROTA DE AVALIAÇÕES)
app.get('/api/avaliacoes/:id', requireAuth, async (req, res) => {
    try {
        loadDependencies();
        const user = req.session.user;
        const { id } = req.params;
        
        // Validar que id é um número
        if (isNaN(id) || !Number.isInteger(Number(id))) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Buscar avaliação
        const result = await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    a.Id,
                    a.UserId,
                    a.GestorId,
                    a.Matricula,
                    a.DataAdmissao,
                    a.DataCriacao,
                    a.DataLimiteResposta,
                    a.StatusAvaliacao,
                    a.RespostaColaboradorConcluida,
                    a.RespostaGestorConcluida,
                    a.DataRespostaColaborador,
                    a.DataRespostaGestor,
                    a.TipoAvaliacaoId,
                    t.Nome as TipoAvaliacao,
                    u.NomeCompleto,
                    u.Departamento,
                    u.Departamento,
                    g.NomeCompleto as NomeGestor
                FROM Avaliacoes a
                INNER JOIN TiposAvaliacao t ON a.TipoAvaliacaoId = t.Id
                INNER JOIN Users u ON a.UserId = u.Id
                LEFT JOIN Users g ON a.GestorId = g.Id
                WHERE a.Id = @id
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        const avaliacao = result.recordset[0];
        
        // Verificar se usuário tem permissão para ver esta avaliação
        const temPermissao = avaliacao.UserId === user.userId || 
                            avaliacao.GestorId === user.userId ||
                            verificarPermissaoAvaliacoesAdmin(user);
        
        if (!temPermissao) {
            return res.status(403).json({ error: 'Você não tem permissão para visualizar esta avaliação' });
        }
        
        res.json(avaliacao);
        
    } catch (error) {
        console.error('Erro ao buscar avaliação:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliação' });
    }
});

// Função para gerar dados simulados como fallback
function gerarDadosSimulados() {
    return {
        avaliacao: Array.from({length: 50}, (_, i) => ({
            id: i + 1,
            colaborador: `Colaborador ${i + 1}`,
            departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][i % 5],
            avaliador: `Gestor ${Math.floor(i / 10) + 1}`,
            nota: (Math.random() * 4 + 1).toFixed(1),
            dataAvaliacao: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            status: Math.random() > 0.2 ? 'Concluída' : 'Pendente',
            observacoes: 'Avaliação de desempenho trimestral'
        })),
        feedback: Array.from({length: 100}, (_, i) => ({
            id: i + 1,
            remetente: `Colaborador ${Math.floor(Math.random() * 30) + 1}`,
            destinatario: `Colaborador ${Math.floor(Math.random() * 30) + 1}`,
            tipo: ['Positivo', 'Desenvolvimento', 'Sugestão', 'Outros'][Math.floor(Math.random() * 4)],
            categoria: ['Técnico', 'Atendimento', 'Vendas', 'Design', 'Liderança'][Math.floor(Math.random() * 5)],
            mensagem: `Feedback de exemplo ${i + 1}`,
            dataEnvio: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            visualizado: Math.random() > 0.3,
            util: Math.random() > 0.4
        })),
        humor: Array.from({length: 200}, (_, i) => ({
            id: i + 1,
            colaborador: `Colaborador ${Math.floor(Math.random() * 30) + 1}`,
            humor: ['Muito Triste', 'Triste', 'Neutro', 'Feliz', 'Muito Feliz'][Math.floor(Math.random() * 5)],
            pontuacao: Math.floor(Math.random() * 5) + 1,
            dataRegistro: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            descricao: Math.random() > 0.5 ? 'Descrição do humor' : null
        })),
        colaboradores: Array.from({length: 80}, (_, i) => ({
            id: i + 1,
            nome: `Colaborador ${i + 1}`,
            email: `colaborador${i + 1}@empresa.com`,
            departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][i % 5],
            cargo: ['Analista', 'Gerente', 'Coordenador', 'Supervisor', 'Assistente'][Math.floor(Math.random() * 5)],
            dataAdmissao: new Date(2020 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            status: ['Ativo', 'Inativo', 'Férias', 'Licença'][Math.floor(Math.random() * 4)],
            salario: (Math.random() * 10000 + 2000).toFixed(2)
        })),
        medias: Array.from({length: 20}, (_, i) => ({
            id: i + 1,
            departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][i % 5],
            mediaGeral: (Math.random() * 2 + 3).toFixed(1),
            totalFeedbacks: Math.floor(Math.random() * 50) + 10,
            periodo: '2024',
            tendencia: Math.random() > 0.5 ? 'Positiva' : 'Negativa'
        })),
        ranking: Array.from({length: 30}, (_, i) => ({
            posicao: i + 1,
            colaborador: `Colaborador ${i + 1}`,
            departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][i % 5],
            pontos: Math.floor(Math.random() * 1000) + 100,
            lumicoins: Math.floor(Math.random() * 500) + 50,
            atividades: Math.floor(Math.random() * 100) + 10
        })),
        turnover: Array.from({length: 15}, (_, i) => ({
            id: i + 1,
            colaborador: `Colaborador ${i + 1}`,
            departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][i % 5],
            dataSaida: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            motivo: ['Demissão', 'Pedido de demissão', 'Aposentadoria', 'Término de contrato'][Math.floor(Math.random() * 4)],
            tempoEmpresa: Math.floor(Math.random() * 60) + 1 + ' meses'
        })),
        pdi: Array.from({length: 40}, (_, i) => ({
            id: i + 1,
            colaborador: `Colaborador ${i + 1}`,
            objetivo: `Objetivo de desenvolvimento ${i + 1}`,
            status: ['Ativo', 'Concluído', 'Pausado', 'Cancelado'][Math.floor(Math.random() * 4)],
            dataInicio: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            dataFim: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            progresso: Math.floor(Math.random() * 100) + 1,
            responsavel: `Gestor ${Math.floor(Math.random() * 10) + 1}`
        })),
        pesquisas: Array.from({length: 25}, (_, i) => ({
            id: i + 1,
            titulo: `Pesquisa ${i + 1}`,
            tipo: ['Múltipla Escolha', 'Escala', 'Texto Livre'][Math.floor(Math.random() * 3)],
            status: ['Ativa', 'Concluída', 'Pausada'][Math.floor(Math.random() * 3)],
            dataInicio: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            dataFim: new Date(2024, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toLocaleDateString('pt-BR'),
            totalRespostas: Math.floor(Math.random() * 100) + 10,
            departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][i % 5]
        }))
    };
}

// Iniciar servidor
app.listen(PORT, async () => {
    try {
        // Iniciar sincronização automática
        console.log('🚀 Iniciando sincronização automática...');
        console.log('🔐 Sincronização configurada para NÃO sobrescrever PasswordHash');
        initializeManagers();
        
        await sincronizador.startAutoSync(30);
        
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
        console.log(`📱 Acesse: http://localhost:${PORT}`);
        
        // Verificar estrutura da tabela Users
        console.log('🔍 Verificando estrutura da tabela Users...');
        await verificarEstruturaTabelaUsers();
        
    } catch (error) {
        console.error('❌ Erro ao inicializar servidor:', error);
    }
});
