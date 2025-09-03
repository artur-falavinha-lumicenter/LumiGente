const express = require('express');
const path = require('path');
const sql = require('mssql');

// Função simples de autenticação
function requireAuth(req, res, next) {
    console.log('🔐 Verificando autenticação - Sessão:', !!req.session.user, 'URL:', req.originalUrl);
    
    if (!req.session.user) {
        console.log('❌ Usuário não autenticado');
        // Se é uma requisição de página HTML, redirecionar para login
        if (req.accepts('html') && !req.xhr) {
            return res.redirect('/login');
        }
        // Se é uma requisição AJAX/API, retornar erro JSON
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    
    console.log('✅ Usuário autenticado:', req.session.user.userId);
    next();
}

// Lazy loading para módulos não essenciais na inicialização
let cors, bcrypt, validator, session;
let HierarchyManager, SincronizadorDadosExternos, AnalyticsManager;

// Função para carregar dependências quando necessário
function loadDependencies() {
    if (!cors) {
        cors = require('cors');
        bcrypt = require('bcrypt');
        validator = require('validator');
        session = require('express-session');
        HierarchyManager = require('./utils/hierarchyManager');
        SincronizadorDadosExternos = require('./sincronizador_dados_externos');
        AnalyticsManager = require('./utils/analyticsManager');
    }
}

// Carregar variáveis de ambiente
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database config usando variáveis de ambiente
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
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
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
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
            console.log('✅ Conexão com banco de dados estabelecida com sucesso');
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
    console.log('🔒 Verificando acesso ao index.html - Sessão:', !!req.session.user);
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
    console.log('✅ Acesso autorizado ao index.html');
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
    '/avaliacoes-periodicas.html',
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
        console.log('🔍 Interceptando requisição HTML:', requestedFile, 'Sessão:', !!req.session.user);
        
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
    
    // Manter usuários especiais sempre ativos (definidos por variável de ambiente)
    if (process.env.SPECIAL_USERS_CPF) {
        try {
            const specialCPFs = process.env.SPECIAL_USERS_CPF.split(',');
            const pool = await sql.connect(dbConfig);
            
            for (const cpf of specialCPFs) {
                const cleanCPF = cpf.trim();
                await pool.request()
                    .input('cpf', sql.VarChar, cleanCPF)
                    .query(`
                        UPDATE Users 
                        SET IsActive = 1, updated_at = GETDATE()
                        WHERE CPF = @cpf
                    `);
            }
            console.log('🔧 Usuários especiais mantidos ativos');
        } catch (error) {
            console.log('⚠️ Erro ao ativar usuários especiais:', error.message);
        }
    }
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
                SELECT HierarchyLevel, HierarchyPath, Departamento, Matricula
                FROM Users WHERE Id = @userId
            `);
        
        const targetUser = targetUserResult.recordset[0];
        if (!targetUser) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
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
const requireManagerAccess = (req, res, next) => {
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
    
    // Gestores (Level 3+) têm acesso (gerentes e superiores)
    if (user.hierarchyLevel >= 3) {
        console.log('✅ Acesso liberado: Gestor nível', user.hierarchyLevel);
        return next();
    }
    
    console.log('❌ Acesso negado: Nível insuficiente');
    return res.status(403).json({ 
        error: 'Acesso negado. Apenas gestores e superiores podem acessar este recurso.' 
    });
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
        const { level: hierarchyLevel, path: hierarchyPath, departamento: departamentoDesc } = 
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
                hierarchyLevel: hierarchyLevel,
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
            .query(`SELECT Id, PasswordHash, PasswordTemporary, CPF FROM Users WHERE CPF = @cpfFormatado OR CPF = @cpfSemFormatacao`);
        
        if (existingUserResult.recordset.length === 0) {
            return res.status(400).json({ error: 'CPF não encontrado no sistema' });
        }
        
        const existingUser = existingUserResult.recordset[0];
        
        // Permitir cadastro se não tem senha OU se tem senha temporária
        if (existingUser.PasswordHash && existingUser.PasswordTemporary === 0) {
            return res.status(400).json({ error: 'Usuário já possui senha cadastrada' });
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
        const { level: hierarchyLevel, path: hierarchyPath, departamento: departamentoDesc } = hierarchyData;
        
        // Log para debug
        console.log(`Hierarquia para cadastro ${funcionario.MATRICULA}:`, hierarchyData);
        console.log(`Valores extraídos: level=${hierarchyLevel}, path=${hierarchyPath}, departamento=${departamentoDesc}`);
        
        // Hash da senha fornecida pelo usuário
        loadDependencies();
        const senhaHash = await bcrypt.hash(password, 10);
        
        // Atualizar usuário existente com senha e dados atualizados
        const nomeCompletoFinal = nomeCompleto || funcionario.NOME || `Funcionário ${funcionario.MATRICULA}`;
        const nomeFinal = nomeCompleto ? nomeCompleto.split(' ')[0] : (funcionario.NOME ? funcionario.NOME.split(' ')[0] : funcionario.MATRICULA);
        
        const cpfNoBanco = existingUser.CPF; // Usar o CPF como está no banco
        await pool.request()
            .input('cpf', sql.VarChar, cpfNoBanco)
            .input('passwordHash', sql.VarChar, senhaHash)
            .input('nomeCompleto', sql.VarChar, nomeCompletoFinal)
            .input('nome', sql.VarChar, nomeFinal)
            .query(`
                UPDATE Users 
                SET PasswordHash = @passwordHash,
                    PasswordTemporary = 0,
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
                SELECT Id, CPF, Matricula, HierarchyLevel, HierarchyPath, Departamento, NomeCompleto, Unidade, Cargo
                FROM Users WHERE CPF = @cpf
            `);
        
        const updatedUser = userResult.recordset[0];
        
        res.json({
            success: true,
            message: 'Cadastro realizado com sucesso',
            userId: updatedUser.Id,
            cpf: updatedUser.CPF,
            matricula: updatedUser.Matricula,
            nomeCompleto: updatedUser.NomeCompleto,
            departamento: updatedUser.Departamento,
            hierarchyLevel: updatedUser.HierarchyLevel,
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
                        MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, SITUACAO_FOLHA, STATUS_GERAL, DTA_ADMISSAO,
                        ROW_NUMBER() OVER (ORDER BY 
                            CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                            CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                            DTA_ADMISSAO DESC, 
                            MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA 
                    WHERE CPF = @cpf
                )
                SELECT TOP 1 MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, SITUACAO_FOLHA, STATUS_GERAL
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
        const { level: hierarchyLevel, path: hierarchyPath, departamento: departamentoDesc } = 
            await hierarchyManager.getHierarchyLevel(funcionario.MATRICULA);
        
        // Buscar usuário no sistema (com ou sem formatação)
        let userResult = await pool.request()
            .input('cpfFormatado', sql.VarChar, cpfFormatado)
            .input('cpfSemFormatacao', sql.VarChar, cpfSemFormatacao)
            .query(`
                SELECT u.Id AS userId, u.UserName, u.PasswordHash, u.PasswordTemporary,
                       u.NomeCompleto, u.nome, u.Cargo, u.Departamento, u.IsActive,
                       u.Matricula, u.HierarchyLevel, u.HierarchyPath
                FROM Users u
                WHERE u.CPF = @cpfFormatado OR u.CPF = @cpfSemFormatacao
            `);

        let user = userResult.recordset[0];

        // Se usuário não existe ou foi resetado (PasswordTemporary = 1 ou true), retornar erro específico
        if (!user || user.PasswordTemporary === 1 || user.PasswordTemporary === true) {
            return res.status(401).json({ 
                error: 'Usuário inexistente. Faça seu cadastro primeiro.',
                userNotFound: true 
            });
        }
        
        // SEMPRE buscar dados atualizados do banco para garantir hierarquia correta
        const updatedUserResult = await pool.request()
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT Matricula, NomeCompleto, Departamento, HierarchyLevel, HierarchyPath, Unidade, Cargo
                FROM Users WHERE Id = @userId
            `);
        
        if (updatedUserResult.recordset.length > 0) {
            const updatedUser = updatedUserResult.recordset[0];
            user.Matricula = updatedUser.Matricula;
            user.NomeCompleto = updatedUser.NomeCompleto;
            user.Departamento = updatedUser.Departamento;
            user.HierarchyLevel = updatedUser.HierarchyLevel;
            user.HierarchyPath = updatedUser.HierarchyPath;
            user.Unidade = updatedUser.Unidade;
            user.Cargo = updatedUser.Cargo;
            console.log(`🔄 Dados atualizados do banco - HierarchyLevel: ${user.HierarchyLevel}`);
        }
        
        // Verificar se dados do funcionário precisam ser atualizados
        const needsUpdate = 
            user.Matricula !== funcionario.MATRICULA ||
            user.NomeCompleto !== funcionario.NOME ||
            user.Departamento !== departamentoDesc ||
            user.HierarchyLevel !== hierarchyLevel ||
            user.HierarchyPath !== hierarchyPath ||
            user.Unidade !== funcionario.FILIAL ||
            user.Cargo !== funcionario.DEPARTAMENTO;

        if (needsUpdate) {
            console.log(`Atualizando dados do usuário: ${funcionario.NOME}`);
            await pool.request()
                .input('userId', sql.Int, user.userId)
                .input('matricula', sql.VarChar, funcionario.MATRICULA)
                .input('nomeCompleto', sql.VarChar, funcionario.NOME)
                .input('departamento', sql.VarChar, departamentoDesc)
                .input('hierarchyLevel', sql.Int, hierarchyLevel)
                .input('hierarchyPath', sql.VarChar, hierarchyPath)
                .input('unidade', sql.VarChar, funcionario.FILIAL)
                .input('cargo', sql.VarChar, funcionario.DEPARTAMENTO)
                .query(`
                    UPDATE Users 
                    SET Matricula = @matricula,
                        NomeCompleto = @nomeCompleto,
                        Departamento = @departamento,
                        HierarchyLevel = @hierarchyLevel,
                        HierarchyPath = @hierarchyPath,
                        Unidade = @unidade,
                        Cargo = @cargo,
                        updated_at = GETDATE()
                    WHERE Id = @userId
                `);
            
            // Atualizar objeto user para sessão
            user.Matricula = funcionario.MATRICULA;
            user.NomeCompleto = funcionario.NOME;
            user.Departamento = departamentoDesc;
            user.HierarchyLevel = hierarchyLevel;
            user.HierarchyPath = hierarchyPath;
            user.Unidade = funcionario.FILIAL;
            user.Cargo = funcionario.DEPARTAMENTO;
        }
        
        // Ativar usuário especial se estiver inativo
        if (isSpecialUser && user.IsActive === 0) {
            await pool.request()
                .input('userId', sql.Int, user.userId)
                .query(`UPDATE Users SET IsActive = 1 WHERE Id = @userId`);
            user.IsActive = 1;
        }
        
        // Verificar senha
        loadDependencies();
        console.log('🔐 Verificando senha...');
        const senhaValida = await bcrypt.compare(password, user.PasswordHash);
        
        if (!senhaValida) {
            console.log('❌ Senha incorreta');
            return res.status(401).json({ error: 'Senha incorreta' });
        }
        
        console.log('✅ Senha correta, login autorizado');

        
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
            cargo: user.Cargo || 'Funcionário',
            departamento: user.Departamento,
            cpf: cpfFormatado,
            matricula: user.Matricula,
            hierarchyLevel: user.HierarchyLevel,
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

// Endpoint para corrigir hierarquia do usuário 999759
app.get('/api/fix-999759', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Atualizar HIERARQUIA_CC para apontar para a nova matrícula
        const updateResult = await pool.request()
            .query(`
                UPDATE HIERARQUIA_CC 
                SET RESPONSAVEL_ATUAL = '999759'
                WHERE RESPONSAVEL_ATUAL = '84059940925'
            `);
        
        // Também atualizar nos níveis hierárquicos
        await pool.request()
            .query(`
                UPDATE HIERARQUIA_CC 
                SET NIVEL_1_MATRICULA_RESP = '999759'
                WHERE NIVEL_1_MATRICULA_RESP = '84059940925'
            `);
        
        await pool.request()
            .query(`
                UPDATE HIERARQUIA_CC 
                SET NIVEL_2_MATRICULA_RESP = '999759'
                WHERE NIVEL_2_MATRICULA_RESP = '84059940925'
            `);
        
        await pool.request()
            .query(`
                UPDATE HIERARQUIA_CC 
                SET NIVEL_3_MATRICULA_RESP = '999759'
                WHERE NIVEL_3_MATRICULA_RESP = '84059940925'
            `);
        
        await pool.request()
            .query(`
                UPDATE HIERARQUIA_CC 
                SET NIVEL_4_MATRICULA_RESP = '999759'
                WHERE NIVEL_4_MATRICULA_RESP = '84059940925'
            `);
        
        // Atualizar hierarquia do usuário 999759
        await pool.request()
            .query(`
                UPDATE Users 
                SET HierarchyLevel = 4,
                    HierarchyPath = '/TI/GERENCIA',
                    Departamento = 'Tecnologia da Informação',
                    updated_at = GETDATE()
                WHERE Matricula = '999759'
            `);
        
        res.json({ 
            success: true, 
            message: `Hierarquia corrigida: ${updateResult.rowsAffected[0]} registros atualizados na HIERARQUIA_CC e usuário definido como Gerente TI`,
            rowsAffected: updateResult.rowsAffected[0]
        });
    } catch (error) {
        console.error('Erro ao corrigir hierarquia:', error);
        res.status(500).json({ error: error.message });
    }
});

// Verificar dados na hierarquia
app.get('/api/check-hierarchy', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Buscar registros relacionados ao departamento TI
        const result = await pool.request()
            .query(`
                SELECT * FROM HIERARQUIA_CC 
                WHERE DESCRICAO_ATUAL LIKE '%TI%' 
                   OR DEPTO_ATUAL = '000001211'
                   OR RESPONSAVEL_ATUAL IN ('84059940925', '999759', '002734')
                ORDER BY DEPTO_ATUAL
            `);
        
        res.json({
            success: true,
            registros: result.recordset,
            total: result.recordset.length
        });
    } catch (error) {
        console.error('Erro ao verificar hierarquia:', error);
        res.status(500).json({ error: error.message });
    }
});

// Definir usuário 999759 como Gerente TI
app.get('/api/set-manager-999759', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Atualizar usuário como Gerente TI nível 4
        await pool.request()
            .query(`
                UPDATE Users 
                SET HierarchyLevel = 4,
                    HierarchyPath = '000000011 > 000000121 > 000001211',
                    Departamento = 'GERENCIA TI',
                    updated_at = GETDATE()
                WHERE Matricula = '999759'
            `);
        
        res.json({ 
            success: true, 
            message: 'Usuário 999759 definido como Gerente TI nível 4'
        });
    } catch (error) {
        console.error('Erro ao definir gestor:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para corrigir hierarquia do usuário 999759
app.get('/api/fix-999759', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        // Atualizar hierarquia do usuário 999759
        await pool.request()
            .query(`
                UPDATE Users 
                SET HierarchyLevel = 4,
                    HierarchyPath = '/TI/GERENCIA',
                    Departamento = 'Tecnologia da Informação',
                    updated_at = GETDATE()
                WHERE Matricula = '999759'
            `);
        
        res.json({ 
            success: true, 
            message: 'Hierarquia do usuário 999759 corrigida para nível 4 (Gerente)' 
        });
    } catch (error) {
        console.error('Erro ao corrigir hierarquia:', error);
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
        
        // Feedbacks RECEBIDOS do mês anterior para comparação
        const feedbacksPrevResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE to_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -60, GETDATE()) AS DATE)
                AND CAST(created_at AS DATE) < CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Reconhecimentos RECEBIDOS pelo usuário no último mês
        const recognitionsResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Recognitions 
                WHERE to_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Reconhecimentos RECEBIDOS do mês anterior
        const recognitionsPrevResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Recognitions 
                WHERE to_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -60, GETDATE()) AS DATE)
                AND CAST(created_at AS DATE) < CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Feedbacks ENVIADOS pelo usuário (para participação)
        const sentFeedbacksResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE from_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
            `);
        
        // Feedbacks ENVIADOS do mês anterior
        const sentFeedbacksPrevResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE from_user_id = @userId
                AND CAST(created_at AS DATE) >= CAST(DATEADD(day, -60, GETDATE()) AS DATE)
                AND CAST(created_at AS DATE) < CAST(DATEADD(day, -30, GETDATE()) AS DATE)
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
        const feedbacksReceivedPrev = feedbacksPrevResult.recordset[0].count || 1;
        const recognitionsReceived = recognitionsResult.recordset[0].count || 0;
        const recognitionsReceivedPrev = recognitionsPrevResult.recordset[0].count || 1;
        const feedbacksSent = sentFeedbacksResult.recordset[0].count || 0;
        const feedbacksSentPrev = sentFeedbacksPrevResult.recordset[0].count || 1;
        const avgScore = (avgScoreResult.recordset[0].avg_score || 7.0);

        // Calcular percentuais de mudança
        const feedbackChange = feedbacksReceivedPrev > 0 ? 
            Math.round(((feedbacksReceived - feedbacksReceivedPrev) / feedbacksReceivedPrev) * 100) : 0;
        const recognitionChange = recognitionsReceivedPrev > 0 ? 
            Math.round(((recognitionsReceived - recognitionsReceivedPrev) / recognitionsReceivedPrev) * 100) : 0;
        const participationChange = feedbacksSentPrev > 0 ? 
            Math.round(((feedbacksSent - feedbacksSentPrev) / feedbacksSentPrev) * 100) : 0;
        const scoreChange = 0.5; // Pode ser calculado com dados históricos

        res.json({
            feedbacksReceived,
            recognitionsReceived,
            feedbacksSent,
            avgScore: avgScore.toFixed(1),
            changes: {
                feedbacks: feedbackChange,
                recognitions: recognitionChange,
                participation: participationChange,
                avgScore: scoreChange
            }
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
        
        // Buscar funcionários que têm o usuário atual como responsável
        const result = await pool.request()
            .input('matricula', sql.VarChar, currentUser.matricula)
            .query(`
                SELECT 
                    u.Id, u.NomeCompleto, u.Departamento, u.Cargo, u.HierarchyLevel,
                    u.Matricula, u.CPF, u.LastLogin
                FROM Users u
                JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL
                WHERE h.RESPONSAVEL_ATUAL = @matricula
                AND u.IsActive = 1
                ORDER BY u.HierarchyLevel DESC, u.NomeCompleto
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
                   (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE f.to_user_id = @userId
        `;
        
        const request = pool.request().input('userId', sql.Int, userId);
        
        if (search) {
            query += " AND (f.content LIKE @search OR u1.NomeCompleto LIKE @search)";
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
                   CASE WHEN EXISTS(SELECT 1 FROM FeedbackReactions fr WHERE fr.feedback_id = f.Id) THEN 1 ELSE 0 END as has_reactions
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE f.from_user_id = @userId
        `;
        
        const request = pool.request().input('userId', sql.Int, userId);
        
        if (search) {
            query += " AND (f.content LIKE @search OR u2.NomeCompleto LIKE @search)";
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
               (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count
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

        res.json({ success: true, id: result.recordset[0].Id });
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
                       'received' as direction
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
                       'given' as direction
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

        const points = {
            'Inovador': 200,
            'Colaborativo': 150,
            'Dedicado': 100,
            'Criativo': 175,
            'Meta Superada': 500
        }[badge] || 100;

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

        res.json({ success: true, id: result.recordset[0].Id });
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

// Respostas aos feedbacks
app.get('/api/feedbacks/:id/replies', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
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
        }
        
        res.json({ success: true, message: 'Humor registrado com sucesso' });
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
                SELECT score, description, created_at
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
                u.Cargo as position
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
        const { titulo, descricao, responsavel_id, data_inicio, data_fim } = req.body;
        
        if (!titulo || !responsavel_id || !data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Campos obrigatórios: título, responsável, data início e data fim' });
        }
        
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('titulo', sql.VarChar, titulo)
            .input('descricao', sql.Text, descricao)
            .input('responsavelId', sql.Int, responsavel_id)
            .input('dataInicio', sql.Date, new Date(data_inicio))
            .input('dataFim', sql.Date, new Date(data_fim))
            .input('criadoPor', sql.Int, req.session.user.userId)
            .query(`
                INSERT INTO Objetivos (titulo, descricao, responsavel_id, data_inicio, data_fim, criado_por)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @responsavelId, @dataInicio, @dataFim, @criadoPor)
            `);
        
        res.json({ success: true, id: result.recordset[0].Id });
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        res.status(500).json({ error: 'Erro ao criar objetivo' });
    }
});

// Listar objetivos
app.get('/api/objetivos', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .query(`
                SELECT 
                    o.*,
                    u.NomeCompleto as responsavel_nome,
                    c.NomeCompleto as criador_nome
                FROM Objetivos o
                JOIN Users u ON o.responsavel_id = u.Id
                JOIN Users c ON o.criado_por = c.Id
                ORDER BY o.created_at DESC
            `);
        
        res.json(result.recordset);
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
                JOIN Users u ON o.responsavel_id = u.Id
                JOIN Users c ON o.criado_por = c.Id
                WHERE o.Id = @objetivoId
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

// Registrar check-in
app.post('/api/objetivos/:id/checkin', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { progresso, observacoes } = req.body;
        const userId = req.session.user.userId;
        
        if (progresso === undefined || progresso < 0 || progresso > 100) {
            return res.status(400).json({ error: 'Progresso deve ser entre 0 e 100' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar e criar tabelas se necessário
        await ensureObjetivosTablesExist(pool);
        
        // Verificar se o objetivo existe
        const objetivoExists = await pool.request()
            .input('objetivoId', sql.Int, id)
            .query('SELECT Id FROM Objetivos WHERE Id = @objetivoId');
        
        if (objetivoExists.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        // Registrar check-in
        await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('progresso', sql.Decimal, progresso)
            .input('observacoes', sql.Text, observacoes || '')
            .query(`
                INSERT INTO ObjetivoCheckins (objetivo_id, user_id, progresso, observacoes)
                VALUES (@objetivoId, @userId, @progresso, @observacoes)
            `);
        
        // Atualizar progresso do objetivo
        await pool.request()
            .input('objetivoId', sql.Int, id)
            .input('progresso', sql.Decimal, progresso)
            .query(`
                UPDATE Objetivos 
                SET progresso = @progresso, updated_at = GETDATE()
                WHERE Id = @objetivoId
            `);
        
        res.json({ success: true, message: 'Check-in registrado com sucesso' });
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

// ===== SISTEMA DE GAMIFICAÇÃO =====

// Buscar pontos do usuário
app.get('/api/gamification/points', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT TotalPoints, LumicoinBalance, LastUpdated
                FROM UserPoints 
                WHERE UserId = @userId
            `);
        
        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json({ TotalPoints: 0, LumicoinBalance: 0, LastUpdated: null });
        }
    } catch (error) {
        console.error('Erro ao buscar pontos:', error);
        res.status(500).json({ error: 'Erro ao buscar pontos' });
    }
});

// Buscar ranking mensal
app.get('/api/gamification/ranking', requireAuth, async (req, res) => {
    try {
        const { month, year } = req.query;
        const currentMonth = month || new Date().getMonth() + 1;
        const currentYear = year || new Date().getFullYear();
        
        const pool = await sql.connect(dbConfig);
        const result = await pool.request()
            .input('month', sql.Int, currentMonth)
            .input('year', sql.Int, currentYear)
            .query(`
                SELECT 
                    ur.Rank,
                    u.NomeCompleto,
                    u.Departamento,
                    ur.TotalPoints,
                    ur.LumicoinEarned
                FROM UserRankings ur
                JOIN Users u ON ur.UserId = u.Id
                WHERE ur.Month = @month AND ur.Year = @year
                ORDER BY ur.Rank ASC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar ranking:', error);
        res.status(500).json({ error: 'Erro ao buscar ranking' });
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



// ===== SISTEMA DE AVALIAÇÕES DE 45 E 90 DIAS =====

// Criar avaliação (apenas gestores)
app.post('/api/avaliacoes', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { 
            colaborador_id, 
            tipo_avaliacao, // '45_dias' ou '90_dias'
            data_limite,
            observacoes_gestor
        } = req.body;
        
        if (!colaborador_id || !tipo_avaliacao) {
            return res.status(400).json({ error: 'Colaborador e tipo de avaliação são obrigatórios' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Criar a avaliação principal
        const result = await pool.request()
            .input('colaboradorId', sql.Int, colaborador_id)
            .input('tipoAvaliacao', sql.VarChar, tipo_avaliacao)
            .input('dataLimite', sql.DateTime, data_limite ? new Date(data_limite) : null)
            .input('observacoesGestor', sql.Text, observacoes_gestor || '')
            .input('criadoPor', sql.Int, req.session.user.userId)
            .input('status', sql.VarChar, 'Pendente')
            .query(`
                INSERT INTO AvaliacoesPeriodicas (colaborador_id, tipo_avaliacao, data_limite, observacoes_gestor, criado_por, status, data_criacao)
                OUTPUT INSERTED.Id
                VALUES (@colaboradorId, @tipoAvaliacao, @dataLimite, @observacoesGestor, @criadoPor, @status, GETDATE())
            `);
        
        const avaliacaoId = result.recordset[0].Id;
        
        // Inserir as perguntas padrão baseadas no tipo de avaliação
        const perguntas = getPerguntasPadrao(tipo_avaliacao);
        
        for (let i = 0; i < perguntas.length; i++) {
            const pergunta = perguntas[i];
            await pool.request()
                .input('avaliacaoId', sql.Int, avaliacaoId)
                .input('categoria', sql.VarChar, pergunta.categoria)
                .input('pergunta', sql.Text, pergunta.texto)
                .input('tipo', sql.VarChar, pergunta.tipo)
                .input('ordem', sql.Int, i + 1)
                .query(`
                    INSERT INTO AvaliacaoPerguntas (avaliacao_id, categoria, pergunta, tipo, ordem)
                    VALUES (@avaliacaoId, @categoria, @pergunta, @tipo, @ordem)
                `);
        }
        
        res.json({ success: true, id: avaliacaoId, message: 'Avaliação criada com sucesso' });
    } catch (error) {
        console.error('Erro ao criar avaliação:', error);
        res.status(500).json({ error: 'Erro ao criar avaliação' });
    }
});

// Função para obter perguntas padrão baseadas no tipo de avaliação
function getPerguntasPadrao(tipoAvaliacao) {
    const perguntas = [
        {
            categoria: 'Integração',
            texto: 'É acessível e acolhedor com todas as pessoas, tratando a todos com respeito e cordialidade.',
            tipo: 'escala'
        },
        {
            categoria: 'Adaptação',
            texto: 'É pontual no cumprimento de sua jornada de trabalho (faltas, atrasos ou saídas antecipadas).',
            tipo: 'escala'
        },
        {
            categoria: 'Adaptação',
            texto: 'Identifica oportunidades que contribuam para o desenvolvimento do Setor.',
            tipo: 'escala'
        },
        {
            categoria: 'Adaptação',
            texto: 'Mantém a calma frente a diversidade do ambiente e à novos desafios, buscando interagir de forma adequada às mudanças.',
            tipo: 'escala'
        },
        {
            categoria: 'Valores',
            texto: 'É respeitoso com as pessoas contribuindo com um ambiente de trabalho saudável.',
            tipo: 'escala'
        },
        {
            categoria: 'Valores',
            texto: 'Tem caráter inquestionável, age com honestidade e integridade no relacionamento com gestores, colegas, prestadores de serviço, fornecedores e demais profissionais que venha a ter contato na empresa.',
            tipo: 'escala'
        },
        {
            categoria: 'Valores',
            texto: 'Exerce suas atividades com transparência e estrita observância às leis, aos princípios e as diretrizes da empresa.',
            tipo: 'escala'
        },
        {
            categoria: 'Orientação para resultados',
            texto: 'Mantém a produtividade e a motivação diante de situações sobre pressão.',
            tipo: 'escala'
        },
        {
            categoria: 'Orientação para resultados',
            texto: 'Age com engajamento para atingir os objetivos e metas.',
            tipo: 'escala'
        },
        {
            categoria: 'Orientação para resultados',
            texto: 'Capacidade para concretizar as tarefas que lhe são solicitadas, com o alcance de objetivos e de forma comprometida com o resultado de seu Setor.',
            tipo: 'escala'
        }
    ];
    
    return perguntas;
}

// Criar avaliação personalizada (apenas gestores)
app.post('/api/avaliacoes/personalizada', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { 
            colaborador_id, 
            tipo_avaliacao,
            data_limite,
            observacoes_gestor,
            titulo,
            descricao,
            perguntas
        } = req.body;
        
        if (!colaborador_id || !tipo_avaliacao || !perguntas || perguntas.length === 0) {
            return res.status(400).json({ error: 'Colaborador, tipo de avaliação e perguntas são obrigatórios' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Criar a avaliação principal
        const result = await pool.request()
            .input('colaboradorId', sql.Int, colaborador_id)
            .input('tipoAvaliacao', sql.VarChar, tipo_avaliacao)
            .input('dataLimite', sql.DateTime, data_limite ? new Date(data_limite) : null)
            .input('observacoesGestor', sql.Text, observacoes_gestor || '')
            .input('criadoPor', sql.Int, req.session.user.userId)
            .input('status', sql.VarChar, 'Pendente')
            .input('titulo', sql.VarChar, titulo || 'Avaliação Personalizada')
            .input('descricao', sql.Text, descricao || '')
            .query(`
                INSERT INTO AvaliacoesPeriodicas (colaborador_id, tipo_avaliacao, data_limite, observacoes_gestor, criado_por, status, data_criacao, titulo, descricao)
                OUTPUT INSERTED.Id
                VALUES (@colaboradorId, @tipoAvaliacao, @dataLimite, @observacoesGestor, @criadoPor, @status, GETDATE(), @titulo, @descricao)
            `);
        
        const avaliacaoId = result.recordset[0].Id;
        
        // Inserir as perguntas personalizadas
        for (let i = 0; i < perguntas.length; i++) {
            const pergunta = perguntas[i];
            await pool.request()
                .input('avaliacaoId', sql.Int, avaliacaoId)
                .input('categoria', sql.VarChar, pergunta.categoria)
                .input('pergunta', sql.Text, pergunta.pergunta)
                .input('tipo', sql.VarChar, pergunta.tipo)
                .input('ordem', sql.Int, pergunta.ordem || i + 1)
                .query(`
                    INSERT INTO AvaliacaoPerguntas (avaliacao_id, categoria, pergunta, tipo, ordem)
                    VALUES (@avaliacaoId, @categoria, @pergunta, @tipo, @ordem)
                `);
        }
        
        res.json({ success: true, id: avaliacaoId, message: 'Avaliação personalizada criada com sucesso' });
    } catch (error) {
        console.error('Erro ao criar avaliação personalizada:', error);
        res.status(500).json({ error: 'Erro ao criar avaliação personalizada' });
    }
});

// Listar avaliações do usuário (como colaborador)
app.get('/api/avaliacoes/colaborador', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    ap.*,
                    u.NomeCompleto as gestor_nome,
                    u.Departamento as gestor_departamento,
                    DATEDIFF(day, GETDATE(), ap.data_limite) as dias_restantes
                FROM AvaliacoesPeriodicas ap
                JOIN Users u ON ap.criado_por = u.Id
                WHERE ap.colaborador_id = @userId
                ORDER BY ap.data_criacao DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar avaliações do colaborador:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliações' });
    }
});

// Listar avaliações criadas pelo gestor
app.get('/api/avaliacoes/gestor', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    ap.*,
                    u.NomeCompleto as colaborador_nome,
                    u.Departamento as colaborador_departamento,
                    u.Cargo as colaborador_cargo,
                    DATEDIFF(day, GETDATE(), ap.data_limite) as dias_restantes
                FROM AvaliacoesPeriodicas ap
                JOIN Users u ON ap.colaborador_id = u.Id
                WHERE ap.criado_por = @userId
                ORDER BY ap.data_criacao DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar avaliações do gestor:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliações' });
    }
});

// Buscar avaliação específica com perguntas
app.get('/api/avaliacoes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário tem acesso à avaliação
        const avaliacaoResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    ap.*,
                    u1.NomeCompleto as colaborador_nome,
                    u1.Departamento as colaborador_departamento,
                    u2.NomeCompleto as gestor_nome
                FROM AvaliacoesPeriodicas ap
                JOIN Users u1 ON ap.colaborador_id = u1.Id
                JOIN Users u2 ON ap.criado_por = u2.Id
                WHERE ap.Id = @avaliacaoId 
                AND (ap.colaborador_id = @userId OR ap.criado_por = @userId)
            `);
        
        if (avaliacaoResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Avaliação não encontrada ou acesso negado' });
        }
        
        const avaliacao = avaliacaoResult.recordset[0];
        
        // Buscar perguntas da avaliação
        const perguntasResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .query(`
                SELECT * FROM AvaliacaoPerguntas 
                WHERE avaliacao_id = @avaliacaoId 
                ORDER BY ordem
            `);
        
        // Buscar respostas existentes
        const respostasResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .query(`
                SELECT * FROM AvaliacaoRespostas 
                WHERE avaliacao_id = @avaliacaoId
                ORDER BY pergunta_id
            `);
        
        res.json({
            avaliacao,
            perguntas: perguntasResult.recordset,
            respostas: respostasResult.recordset
        });
    } catch (error) {
        console.error('Erro ao buscar avaliação:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliação' });
    }
});

// Submeter autoavaliação do colaborador
app.post('/api/avaliacoes/:id/autoavaliacao', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { respostas } = req.body;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário é o colaborador da avaliação
        const avaliacaoResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT status FROM AvaliacoesPeriodicas 
                WHERE Id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        if (avaliacaoResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta avaliação' });
        }
        
        if (avaliacaoResult.recordset[0].status === 'Concluida') {
            return res.status(400).json({ error: 'Esta avaliação já foi concluída' });
        }
        
        // Inserir respostas da autoavaliação
        for (const resposta of respostas) {
            await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .input('colaboradorId', sql.Int, userId)
                .input('perguntaId', sql.Int, resposta.pergunta_id)
                .input('resposta', sql.Text, resposta.resposta)
                .input('score', sql.Int, resposta.score)
                .input('tipo', sql.VarChar, 'autoavaliacao')
                .query(`
                    INSERT INTO AvaliacaoRespostas (avaliacao_id, colaborador_id, pergunta_id, resposta, score, tipo)
                    VALUES (@avaliacaoId, @colaboradorId, @perguntaId, @resposta, @score, @tipo)
                `);
        }
        
        // Atualizar status da avaliação
        await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .query(`
                UPDATE AvaliacoesPeriodicas 
                SET status = 'Autoavaliacao_Concluida', 
                    data_autoavaliacao = GETDATE()
                WHERE Id = @avaliacaoId
            `);
        
        res.json({ success: true, message: 'Autoavaliação enviada com sucesso' });
    } catch (error) {
        console.error('Erro ao enviar autoavaliação:', error);
        res.status(500).json({ error: 'Erro ao enviar autoavaliação' });
    }
});

// Submeter avaliação do gestor
app.post('/api/avaliacoes/:id/avaliacao-gestor', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const { respostas, observacoes_finais } = req.body;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário é o gestor que criou a avaliação
        const avaliacaoResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT status FROM AvaliacoesPeriodicas 
                WHERE Id = @avaliacaoId AND criado_por = @userId
            `);
        
        if (avaliacaoResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta avaliação' });
        }
        
        if (avaliacaoResult.recordset[0].status === 'Concluida') {
            return res.status(400).json({ error: 'Esta avaliação já foi concluída' });
        }
        
        // Inserir respostas da avaliação do gestor
        for (const resposta of respostas) {
            await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .input('gestorId', sql.Int, userId)
                .input('perguntaId', sql.Int, resposta.pergunta_id)
                .input('resposta', sql.Text, resposta.resposta)
                .input('score', sql.Int, resposta.score)
                .input('tipo', sql.VarChar, 'avaliacao_gestor')
                .query(`
                    INSERT INTO AvaliacaoRespostas (avaliacao_id, gestor_id, pergunta_id, resposta, score, tipo)
                    VALUES (@avaliacaoId, @gestorId, @perguntaId, @resposta, @score, @tipo)
                `);
        }
        
        // Atualizar status da avaliação
        await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('observacoesFinais', sql.Text, observacoes_finais || '')
            .query(`
                UPDATE AvaliacoesPeriodicas 
                SET status = 'Concluida', 
                    data_conclusao = GETDATE(),
                    observacoes_finais = @observacoesFinais
                WHERE Id = @avaliacaoId
            `);
        
        res.json({ success: true, message: 'Avaliação concluída com sucesso' });
    } catch (error) {
        console.error('Erro ao concluir avaliação:', error);
        res.status(500).json({ error: 'Erro ao concluir avaliação' });
    }
});

// Buscar colaboradores para criar avaliação (apenas gestores)
app.get('/api/avaliacoes/colaboradores-disponiveis', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Buscar colaboradores que o gestor pode avaliar baseado na hierarquia
        const result = await pool.request()
            .input('gestorId', sql.Int, currentUser.userId)
            .query(`
                SELECT 
                    u.Id, u.NomeCompleto, u.Departamento, u.Cargo, u.Matricula,
                    u.HierarchyLevel, u.HierarchyPath
                FROM Users u
                WHERE u.IsActive = 1 
                AND u.HierarchyLevel < ${currentUser.hierarchyLevel}
                AND u.Id != @gestorId
                ORDER BY u.NomeCompleto
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar colaboradores:', error);
        res.status(500).json({ error: 'Erro ao buscar colaboradores' });
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

// ===== SISTEMA DE PESQUISA RÁPIDA =====

// Endpoint para migração - adicionar coluna pergunta
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

// Criar pesquisa rápida (apenas gerentes+)
app.post('/api/pesquisas', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { 
            titulo, 
            descricao, 
            perguntas,
            departamentos_alvo, 
            data_encerramento,
            anonima
        } = req.body;
        
        if (!titulo || !perguntas || perguntas.length === 0) {
            return res.status(400).json({ error: 'Título e pelo menos uma pergunta são obrigatórios' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Criar a pesquisa principal
        const result = await pool.request()
            .input('titulo', sql.VarChar, titulo)
            .input('descricao', sql.Text, descricao)
            .input('departamentosAlvo', sql.VarChar, departamentos_alvo === 'Todos' ? null : departamentos_alvo)
            .input('dataEncerramento', sql.DateTime, data_encerramento ? new Date(data_encerramento) : null)
            .input('anonima', sql.Bit, anonima || false)
            .input('criadoPor', sql.Int, req.session.user.userId)
            .query(`
                INSERT INTO PesquisasRapidas (titulo, descricao, departamentos_alvo, data_encerramento, anonima, criado_por, status, ativa)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @departamentosAlvo, @dataEncerramento, @anonima, @criadoPor, 'Ativa', 1)
            `);
        
        const pesquisaId = result.recordset[0].Id;
        
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
        
        res.json({ success: true, id: pesquisaId });
    } catch (error) {
        console.error('Erro ao criar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao criar pesquisa' });
    }
});

// Listar pesquisas
app.get('/api/pesquisas', requireAuth, async (req, res) => {
    try {
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
        
        const result = await request.query(`
            SELECT 
                pr.*,
                u.NomeCompleto as criador_nome,
                (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id) as total_respostas,
                (SELECT TOP 1 pp.tipo FROM PesquisaPerguntas pp WHERE pp.pesquisa_id = pr.Id ORDER BY pp.ordem) as tipo_pergunta
            FROM PesquisasRapidas pr
            JOIN Users u ON pr.criado_por = u.Id
            ${whereClause}
            ORDER BY pr.Id DESC
        `);
        
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

// Buscar departamentos para pesquisas
app.get('/api/pesquisas/departamentos', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request().query(`
            SELECT DISTINCT Departamento 
            FROM Users 
            WHERE Departamento IS NOT NULL AND Departamento != ''
            ORDER BY Departamento
        `);
        
        const departamentos = ['Todos', ...result.recordset.map(r => r.Departamento)];
        res.json(departamentos);
    } catch (error) {
        console.error('Erro ao buscar departamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar departamentos' });
    }
});

// Verificar se usuário pode criar pesquisas
app.get('/api/pesquisas/can-create', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const canCreate = user.role === 'Administrador' || user.hierarchyLevel >= 3;
        res.json({ canCreate });
    } catch (error) {
        console.error('Erro ao verificar permissões:', error);
        res.status(500).json({ error: 'Erro ao verificar permissões' });
    }
});

// Buscar resultados da pesquisa
app.get('/api/pesquisas/:id/resultados', requireAuth, async (req, res) => {
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
        
        // Buscar pesquisa
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    pr.*,
                    u.NomeCompleto as criador_nome,
                    (SELECT COUNT(*) FROM PesquisaRespostas WHERE pesquisa_id = pr.Id) as total_respostas
                FROM PesquisasRapidas pr
                JOIN Users u ON pr.criado_por = u.Id
                WHERE pr.Id = @pesquisaId
            `);
        
        if (pesquisaResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
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
        
        // Verificar se pesquisa existe e está ativa
        const pesquisaResult = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .query(`
                SELECT * FROM PesquisasRapidas 
                WHERE Id = @pesquisaId 
                AND status = 'Ativa'
                AND (data_encerramento IS NULL OR data_encerramento > GETDATE())
            `);
        
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
        
        res.json({ success: true, message: 'Respostas registradas com sucesso' });
    } catch (error) {
        console.error('Erro ao responder pesquisa:', error);
        res.status(500).json({ error: 'Erro ao responder pesquisa' });
    }
});

// Buscar resultados de uma pesquisa
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

// Encerrar pesquisa
app.put('/api/pesquisas/:id/encerrar', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('pesquisaId', sql.Int, id)
            .input('userId', sql.Int, req.session.user.userId)
            .query(`
                UPDATE PesquisasRapidas 
                SET status = 'Encerrada'
                WHERE Id = @pesquisaId AND criado_por = @userId
            `);
        
        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada ou você não tem permissão' });
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
        const userId = req.session.user.userId;
        const userDepartment = req.session.user.department;
        const pool = await sql.connect(dbConfig);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('userDepartment', sql.VarChar, userDepartment)
            .query(`
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
                AND (pr.data_encerramento IS NULL OR pr.data_encerramento > GETDATE())
                AND (pr.departamentos_alvo IS NULL OR pr.departamentos_alvo LIKE @userDepartment)
                ORDER BY pr.Id DESC
            `);
        
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
                SELECT u.Id, u.NomeCompleto, u.Departamento, u.Cargo, u.LastLogin
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
                SELECT u.Id, u.NomeCompleto, u.Departamento, u.Cargo, u.LastLogin
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
        
        let query = `
            SELECT 
                dm.Score,
                dm.Description,
                dm.CreatedAt,
                u.NomeCompleto,
                u.Departamento,
                u.Cargo
            FROM DailyMood dm
            JOIN Users u ON dm.UserId = u.Id
            WHERE u.ManagerId = @managerId
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
        
        // Buscar equipe do gestor
        const teamResult = await pool.request()
            .input('managerId', sql.Int, userId)
            .query(`
                SELECT Id FROM Users WHERE ManagerId = @managerId AND IsActive = 1
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
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser);
        
        if (accessibleUsers.length === 0) {
            return res.json({
                totalMembers: 0,
                activeMembers: 0,
                averageMood: 0,
                totalFeedbacks: 0
            });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        // Buscar métricas da equipe
        const metricsResult = await pool.request().query(`
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
            WHERE u.Id IN (${userIdsParam})
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
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser);
        
        if (accessibleUsers.length === 0) {
            return res.json({
                online: 0,
                offline: 0,
                active: 0,
                inactive: 0
            });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        // Buscar status da equipe
        const statusResult = await pool.request().query(`
            SELECT 
                COUNT(DISTINCT CASE WHEN u.IsActive = 1 THEN u.Id END) as active,
                COUNT(DISTINCT CASE WHEN u.IsActive = 0 THEN u.Id END) as inactive,
                COUNT(DISTINCT CASE WHEN u.LastLogin >= DATEADD(minute, -30, GETDATE()) THEN u.Id END) as online,
                COUNT(DISTINCT CASE WHEN u.LastLogin < DATEADD(minute, -30, GETDATE()) OR u.LastLogin IS NULL THEN u.Id END) as offline
            FROM Users u
            WHERE u.Id IN (${userIdsParam})
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
        
        console.log('Accessible users:', accessibleUsers);
        
        if (accessibleUsers.length === 0) {
            console.log('Nenhum usuário acessível encontrado');
            return res.json([]);
        }
        
        // Buscar dados detalhados dos usuários acessíveis
        const pool = await sql.connect(dbConfig);
        const userIds = accessibleUsers.map(user => user.userId);
        
        // Query simplificada para debug
        let query = `
            SELECT 
                u.Id,
                u.NomeCompleto,
                u.Departamento,
                u.Cargo,
                u.LastLogin,
                u.IsActive,
                0 as lastMood,
                0 as recentFeedbacks,
                0 as pendingEvaluations
            FROM Users u
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
        const teamMembers = result.recordset.map(member => ({
            ...member,
            activeObjectives: 0, // Por enquanto, não temos tabela Goals
            LastLogin: member.LastLogin ? member.LastLogin.toISOString() : null
        }));
        
        res.json(teamMembers);
    } catch (error) {
        console.error('Erro ao buscar gestão de equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar gestão de equipe' });
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
        
        // Para usuários comuns, limitar a visualização
        const isManager = currentUser.hierarchyLevel >= 3 || currentUser.role === 'Administrador';
        
        let accessibleUsers = [];
        if (isManager) {
            // Gestores podem ver todos os usuários
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

// Listar departamentos para filtros
app.get('/api/analytics/departments-list', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Buscar departamentos dos usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser);
        
        if (accessibleUsers.length === 0) {
            return res.json([]);
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        const result = await pool.request().query(`
            SELECT DISTINCT u.Departamento
            FROM Users u
            WHERE u.Id IN (${userIdsParam}) 
                AND u.Departamento IS NOT NULL 
                AND u.Departamento != ''
            ORDER BY u.Departamento
        `);
        
        const departments = result.recordset.map(row => row.Departamento);
        res.json(departments);
    } catch (error) {
        console.error('Erro ao buscar departamentos:', error);
        res.status(500).json({ error: 'Erro ao buscar departamentos' });
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

// Análise temporal
app.get('/api/analytics/temporal', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        initializeManagers();
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.json({
                dailyMood: [],
                feedbacks: [],
                recognitions: [],
                message: 'Nenhum dado disponível'
            });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
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

// Analytics e relatórios
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
        const { period = 30, department, type = 'engagement', format = 'csv' } = req.query;
        const currentUser = req.session.user;
        const pool = await sql.connect(dbConfig);
        
        // Usar HierarchyManager para buscar usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: department && department !== 'Todos' ? department : null
        });
        
        if (accessibleUsers.length === 0) {
            return res.status(404).json({ error: 'Nenhum dado encontrado para exportação' });
        }
        
        const userIds = accessibleUsers.map(user => user.userId);
        const userIdsParam = userIds.join(',');
        
        let reportData = '';
        let filename = '';
        let contentType = '';
        
        // Gerar relatório baseado no tipo
        if (type === 'engagement') {
            const result = await pool.request()
                .input('period', sql.Int, parseInt(period))
                .query(`
                    SELECT 
                        u.NomeCompleto,
                        u.Departamento,
                        COUNT(DISTINCT f.Id) as totalFeedbacks,
                        COUNT(DISTINCT r.Id) as totalRecognitions,
                        COUNT(DISTINCT dm.Id) as moodEntries,
                        AVG(CAST(dm.score AS FLOAT)) as avgMood
                    FROM Users u
                    LEFT JOIN Feedbacks f ON u.Id = f.to_user_id 
                        AND CAST(f.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    LEFT JOIN Recognitions r ON u.Id = r.to_user_id 
                        AND CAST(r.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                        AND CAST(dm.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    WHERE u.Id IN (${userIdsParam})
                    GROUP BY u.Id, u.NomeCompleto, u.Departamento
                    ORDER BY totalFeedbacks DESC
                `);
            
            if (format === 'csv') {
                reportData = 'Nome,Departamento,Feedbacks,Reconhecimentos,Entradas de Humor,Humor Médio\n';
                result.recordset.forEach(row => {
                    reportData += `${row.NomeCompleto},${row.Departamento},${row.totalFeedbacks},${row.totalRecognitions},${row.moodEntries},${row.avgMood || 0}\n`;
                });
                contentType = 'text/csv';
                filename = `relatorio_engajamento_${new Date().toISOString().split('T')[0]}.csv`;
            } else {
                reportData = `Relatório de Engajamento - Período: ${period} dias\n`;
                reportData += `Departamento: ${department || 'Todos'}\n`;
                reportData += `Gerado em: ${new Date().toLocaleString('pt-BR')}\n\n`;
                result.recordset.forEach(row => {
                    reportData += `${row.NomeCompleto} (${row.Departamento}): ${row.totalFeedbacks} feedbacks, ${row.totalRecognitions} reconhecimentos, humor médio: ${row.avgMood || 0}\n`;
                });
                contentType = 'text/plain';
                filename = `relatorio_engajamento_${new Date().toISOString().split('T')[0]}.txt`;
            }
        } else if (type === 'participation') {
            const result = await pool.request()
                .input('period', sql.Int, parseInt(period))
                .query(`
                    SELECT 
                        u.NomeCompleto,
                        u.Departamento,
                        COUNT(DISTINCT f.Id) as feedbacksEnviados,
                        COUNT(DISTINCT r.Id) as reconhecimentosEnviados,
                        COUNT(DISTINCT dm.Id) as entradasHumor,
                        COUNT(DISTINCT o.Id) as objetivosAtivos
                    FROM Users u
                    LEFT JOIN Feedbacks f ON u.Id = f.from_user_id 
                        AND CAST(f.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    LEFT JOIN Recognitions r ON u.Id = r.from_user_id 
                        AND CAST(r.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    LEFT JOIN DailyMood dm ON u.Id = dm.user_id 
                        AND CAST(dm.created_at AS DATE) >= CAST(DATEADD(day, -@period, GETDATE()) AS DATE)
                    LEFT JOIN Objetivos o ON u.Id = o.responsavel_id 
                        AND o.status = 'Ativo'
                    WHERE u.Id IN (${userIdsParam})
                    GROUP BY u.Id, u.NomeCompleto, u.Departamento
                    ORDER BY feedbacksEnviados DESC
                `);
            
            if (format === 'csv') {
                reportData = 'Nome,Departamento,Feedbacks Enviados,Reconhecimentos Enviados,Entradas de Humor,Objetivos Ativos\n';
                result.recordset.forEach(row => {
                    reportData += `${row.NomeCompleto},${row.Departamento},${row.feedbacksEnviados},${row.reconhecimentosEnviados},${row.entradasHumor},${row.objetivosAtivos}\n`;
                });
                contentType = 'text/csv';
                filename = `relatorio_participacao_${new Date().toISOString().split('T')[0]}.csv`;
            } else {
                reportData = `Relatório de Participação - Período: ${period} dias\n`;
                reportData += `Departamento: ${department || 'Todos'}\n`;
                reportData += `Gerado em: ${new Date().toLocaleString('pt-BR')}\n\n`;
                result.recordset.forEach(row => {
                    reportData += `${row.NomeCompleto} (${row.Departamento}): ${row.feedbacksEnviados} feedbacks enviados, ${row.reconhecimentosEnviados} reconhecimentos enviados\n`;
                });
                contentType = 'text/plain';
                filename = `relatorio_participacao_${new Date().toISOString().split('T')[0]}.txt`;
            }
        } else {
            return res.status(400).json({ error: 'Tipo de relatório não suportado' });
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(reportData);
    } catch (error) {
        console.error('Erro ao exportar relatório:', error);
        res.status(500).json({ error: 'Erro ao exportar relatório' });
    }
});



// Atualizar perfil do usuário
app.put('/api/usuario/profile', requireAuth, async (req, res) => {
    try {
        const { nomeCompleto, nome, departamento, cargo } = req.body;
        const userId = req.session.user.userId;
        
        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('nomeCompleto', sql.VarChar, nomeCompleto)
            .input('nome', sql.VarChar, nome)
            .input('departamento', sql.VarChar, departamento)
            .input('cargo', sql.VarChar, cargo)
            .query(`
                UPDATE Users 
                SET NomeCompleto = @nomeCompleto,
                    nome = @nome,
                    Departamento = @departamento, 
                    Cargo = @cargo,
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



// Rota para buscar usuários para feedback (SEM limitações hierárquicas)
app.get('/api/users/feedback', requireAuth, async (req, res) => {
    try {
        initializeManagers();
        console.log('📋 Buscando usuários para feedback (universal)');
        const users = await hierarchyManager.getUsersForFeedback();
        res.json(users);
    } catch (error) {
        console.error('❌ Erro ao buscar usuários para feedback:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Buscar avaliação para responder
app.get('/api/avaliacoes/:id/responder', requireAuth, async (req, res) => {
    try {
        const avaliacaoId = parseInt(req.params.id);
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário pode responder esta avaliação
        const colaboradorResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT ac.*, a.titulo, a.descricao, a.tipo, a.data_fim
                FROM AvaliacaoColaboradores ac
                INNER JOIN Avaliacoes a ON ac.avaliacao_id = a.Id
                WHERE ac.avaliacao_id = @avaliacaoId AND ac.colaborador_id = @userId
            `);
        
        if (colaboradorResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Você não tem permissão para responder esta avaliação' });
        }
        
        const colaborador = colaboradorResult.recordset[0];
        
        // Verificar se já foi respondida
        if (colaborador.status === 'Concluida') {
            return res.status(400).json({ error: 'Esta avaliação já foi respondida por você' });
        }
        
        // Verificar se ainda está no prazo
        if (new Date() > new Date(colaborador.data_fim)) {
            return res.status(400).json({ error: 'O prazo para responder esta avaliação já expirou' });
        }
        
        // Buscar perguntas da avaliação
        const perguntasResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .query(`
                SELECT Id, pergunta, tipo, ordem, escala_min, escala_max, opcoes
                FROM AvaliacaoPerguntas
                WHERE avaliacao_id = @avaliacaoId
                ORDER BY ordem
            `);
        
        res.json({
            avaliacao: {
                Id: avaliacaoId,
                titulo: colaborador.titulo,
                descricao: colaborador.descricao,
                tipo: colaborador.tipo,
                data_fim: colaborador.data_fim
            },
            perguntas: perguntasResult.recordset
        });
    } catch (error) {
        console.error('Erro ao buscar avaliação:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliação' });
    }
});

// Submeter respostas da avaliação
app.post('/api/avaliacoes/:id/responder', requireAuth, async (req, res) => {
    try {
        const avaliacaoId = parseInt(req.params.id);
        const userId = req.session.user.userId;
        const { respostas } = req.body;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário pode responder
        const colaboradorResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT status FROM AvaliacaoColaboradores
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        if (colaboradorResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Você não tem permissão para responder esta avaliação' });
        }
        
        if (colaboradorResult.recordset[0].status === 'Concluida') {
            return res.status(400).json({ error: 'Esta avaliação já foi respondida por você' });
        }
        
        // Buscar perguntas para obter o texto
        const perguntasResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .query(`
                SELECT Id, pergunta FROM AvaliacaoPerguntas
                WHERE avaliacao_id = @avaliacaoId
            `);
        
        const perguntasMap = {};
        perguntasResult.recordset.forEach(p => {
            perguntasMap[p.Id] = p.pergunta;
        });
        
        // Inserir respostas
        for (const resposta of respostas) {
            const perguntaTexto = perguntasMap[resposta.pergunta_id] || 'Pergunta não encontrada';
            
            await pool.request()
                .input('avaliacaoId', sql.Int, avaliacaoId)
                .input('perguntaId', sql.Int, resposta.pergunta_id)
                .input('colaboradorId', sql.Int, userId)
                .input('pergunta', sql.Text, perguntaTexto)
                .input('resposta', sql.Text, resposta.resposta)
                .query(`
                    INSERT INTO AvaliacaoRespostas (avaliacao_id, avaliacao_pergunta_id, colaborador_id, pergunta, resposta)
                    VALUES (@avaliacaoId, @perguntaId, @colaboradorId, @pergunta, @resposta)
                `);
        }
        
        // Atualizar status do colaborador
        await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('userId', sql.Int, userId)
            .query(`
                UPDATE AvaliacaoColaboradores
                SET status = 'Concluida', data_resposta = GETDATE()
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        res.json({ success: true, message: 'Respostas enviadas com sucesso' });
    } catch (error) {
        console.error('Erro ao enviar respostas:', error);
        res.status(500).json({ error: 'Erro ao enviar respostas' });
    }
});

// Listar avaliações
app.get('/api/avaliacoes', requireAuth, async (req, res) => {
    try {
        const { status, tipo } = req.query;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (status) {
            whereClause += ' AND a.status = @status';
            params.push({ name: 'status', value: status });
        }
        
        if (tipo) {
            whereClause += ' AND a.tipo = @tipo';
            params.push({ name: 'tipo', value: tipo });
        }
        
        // Se não for gestor, mostrar apenas avaliações do usuário
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT hierarchyLevel FROM Users WHERE Id = @userId
            `);
        
        const isManager = userResult.recordset[0]?.hierarchyLevel >= 3;
        
        if (!isManager) {
            whereClause += ' AND ac.colaborador_id = @userId';
            params.push({ name: 'userId', value: userId });
        }
        
        let request = pool.request();
        params.forEach(param => {
            request.input(param.name, sql.VarChar, param.value);
        });
        
        const query = `
            SELECT 
                a.*,
                u.NomeCompleto as criador_nome,
                (SELECT COUNT(*) FROM AvaliacaoColaboradores WHERE avaliacao_id = a.Id) as total_colaboradores,
                (SELECT COUNT(*) FROM AvaliacaoColaboradores WHERE avaliacao_id = a.Id AND status = 'Concluída') as colaboradores_concluidos
            FROM Avaliacoes a
            JOIN Users u ON a.criado_por = u.Id
            ${!isManager ? 'JOIN AvaliacaoColaboradores ac ON a.Id = ac.avaliacao_id' : ''}
            ${whereClause}
            ORDER BY a.created_at DESC
        `;
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao listar avaliações:', error);
        res.status(500).json({ error: 'Erro ao listar avaliações' });
    }
});

// Buscar avaliações pendentes do usuário
app.get('/api/avaliacoes/pendentes', requireAuth, async (req, res) => {
    try {
        // Por enquanto, retornar array vazio já que não temos sistema de avaliações implementado
        res.json([]);
    } catch (error) {
        console.error('Erro ao buscar avaliações pendentes:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliações pendentes' });
    }
});

// Buscar histórico de avaliações do usuário
app.get('/api/avaliacoes/historico', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        await ensureAvaliacaoTablesExist(pool);
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 
                    a.Id,
                    a.titulo,
                    a.descricao,
                    a.tipo,
                    a.data_inicio,
                    a.data_fim,
                    ac.status,
                    ac.data_resposta,
                    ah.periodo,
                    ah.data_avaliacao
                FROM Avaliacoes a
                INNER JOIN AvaliacaoColaboradores ac ON a.Id = ac.avaliacao_id
                LEFT JOIN AvaliacaoHistorico ah ON a.Id = ah.avaliacao_id AND ah.colaborador_id = @userId
                WHERE ac.colaborador_id = @userId
                ORDER BY a.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar histórico de avaliações:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico de avaliações' });
    }
});

// Buscar respostas de uma avaliação específica
app.get('/api/avaliacoes/:id/respostas', requireAuth, async (req, res) => {
    try {
        const avaliacaoId = parseInt(req.params.id);
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        await ensureAvaliacaoTablesExist(pool);
        
        // Verificar se o usuário tem acesso a esta avaliação
        const accessResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 1 FROM AvaliacaoColaboradores 
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        if (accessResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta avaliação' });
        }
        
        // Buscar respostas do colaborador e do gestor
        const respostasResult = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('colaboradorId', sql.Int, userId)
            .query(`
                SELECT 
                    ar.pergunta,
                    ar.resposta,
                    ar.tipo_resposta,
                    ar.created_at,
                    u.NomeCompleto as respondente_nome
                FROM AvaliacaoRespostas ar
                LEFT JOIN Users u ON (ar.tipo_resposta = 'colaborador' AND ar.colaborador_id = u.Id) 
                                  OR (ar.tipo_resposta = 'gestor' AND ar.gestor_id = u.Id)
                WHERE ar.avaliacao_id = @avaliacaoId 
                  AND ar.colaborador_id = @colaboradorId
                ORDER BY ar.avaliacao_pergunta_id, ar.tipo_resposta
            `);
        
        // Organizar respostas por pergunta
        const respostasOrganizadas = {};
        respostasResult.recordset.forEach(resposta => {
            if (!respostasOrganizadas[resposta.pergunta]) {
                respostasOrganizadas[resposta.pergunta] = {
                    pergunta: resposta.pergunta,
                    colaborador: null,
                    gestor: null
                };
            }
            
            if (resposta.tipo_resposta === 'colaborador') {
                respostasOrganizadas[resposta.pergunta].colaborador = {
                    resposta: resposta.resposta,
                    data: resposta.created_at,
                    respondente: resposta.respondente_nome
                };
            } else if (resposta.tipo_resposta === 'gestor') {
                respostasOrganizadas[resposta.pergunta].gestor = {
                    resposta: resposta.resposta,
                    data: resposta.created_at,
                    respondente: resposta.respondente_nome
                };
            }
        });
        
        res.json(Object.values(respostasOrganizadas));
    } catch (error) {
        console.error('Erro ao buscar respostas da avaliação:', error);
        res.status(500).json({ error: 'Erro ao buscar respostas da avaliação' });
    }
});

// Buscar perguntas de uma avaliação
app.get('/api/avaliacoes/:id/perguntas', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário tem acesso à avaliação
        const accessResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 1 FROM AvaliacaoColaboradores 
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        if (accessResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta avaliação' });
        }
        
        // Buscar perguntas
        const result = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .query(`
                SELECT id, pergunta, tipo, ordem
                FROM AvaliacaoPerguntas 
                WHERE avaliacao_id = @avaliacaoId 
                ORDER BY ordem
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar perguntas da avaliação:', error);
        res.status(500).json({ error: 'Erro ao buscar perguntas da avaliação' });
    }
});

// Rota de debug para verificar tabelas
app.get('/api/debug/tables', requireAuth, async (req, res) => {
    try {
        const pool = await sql.connect(dbConfig);
        
        const tables = ['Avaliacoes', 'AvaliacaoPerguntas', 'AvaliacaoColaboradores', 'AvaliacaoRespostas', 'Objetivos', 'ObjetivoCheckins'];
        const results = {};
        
        for (const table of tables) {
            try {
                const result = await pool.request().query(`SELECT TOP 1 * FROM ${table}`);
                results[table.toLowerCase()] = true;
                console.log(`✅ Tabela ${table} existe`);
            } catch (error) {
                results[table.toLowerCase()] = false;
                console.log(`❌ Tabela ${table} não existe:`, error.message);
            }
        }
        
        res.json(results);
    } catch (error) {
        console.error('Erro ao verificar tabelas:', error);
        res.status(500).json({ error: 'Erro ao verificar tabelas' });
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
app.get('/api/debug/hierarchy/:matricula', requireAuth, async (req, res) => {
    try {
        const { matricula } = req.params;
        const pool = await sql.connect(dbConfig);
        
        console.log(`🔍 Verificando hierarquia para matrícula: ${matricula}`);
        
        // Buscar dados do funcionário
        const funcionarioResult = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query(`
                SELECT TOP 1 MATRICULA, NOME, DEPARTAMENTO, CENTRO_CUSTO, STATUS_GERAL
                FROM TAB_HIST_SRA 
                WHERE MATRICULA = @matricula 
                ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END
            `);
        
        // Buscar dados do usuário
        const userResult = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query(`
                SELECT Id, NomeCompleto, HierarchyLevel, HierarchyPath, Departamento
                FROM Users WHERE Matricula = @matricula
            `);
        
        // Buscar hierarquias
        const hierarquiaResult = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query(`
                SELECT * FROM HIERARQUIA_CC 
                WHERE RESPONSAVEL_ATUAL = @matricula
                   OR NIVEL_1_MATRICULA_RESP = @matricula
                   OR NIVEL_2_MATRICULA_RESP = @matricula
                   OR NIVEL_3_MATRICULA_RESP = @matricula
                   OR NIVEL_4_MATRICULA_RESP = @matricula
                ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
            `);
        
        res.json({
            funcionario: funcionarioResult.recordset[0] || null,
            usuario: userResult.recordset[0] || null,
            hierarquias: hierarquiaResult.recordset,
            recomendacao: hierarquiaResult.recordset.length > 0 ? 'Deveria ser gestor (nível 3+)' : 'Funcionário comum (nível 0)'
        });
    } catch (error) {
        console.error('Erro ao verificar hierarquia:', error);
        res.status(500).json({ error: error.message });
    }
});

// Debug e correção da hierarquia do usuário
app.post('/api/debug/fix-hierarchy/:matricula', requireAuth, async (req, res) => {
    try {
        const { matricula } = req.params;
        const pool = await sql.connect(dbConfig);
        
        console.log(`🔧 Corrigindo hierarquia para matrícula: ${matricula}`);
        
        // Buscar dados do funcionário
        const funcionarioResult = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query(`
                SELECT TOP 1 MATRICULA, NOME, DEPARTAMENTO, CENTRO_CUSTO, STATUS_GERAL
                FROM TAB_HIST_SRA 
                WHERE MATRICULA = @matricula 
                ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END
            `);
        
        if (funcionarioResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Funcionário não encontrado' });
        }
        
        const funcionario = funcionarioResult.recordset[0];
        console.log('Dados do funcionário:', funcionario);
        
        // Buscar hierarquia onde é responsável
        const hierarquiaRespResult = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query(`
                SELECT * FROM HIERARQUIA_CC 
                WHERE RESPONSAVEL_ATUAL = @matricula
                   OR NIVEL_1_MATRICULA_RESP = @matricula
                   OR NIVEL_2_MATRICULA_RESP = @matricula
                   OR NIVEL_3_MATRICULA_RESP = @matricula
                   OR NIVEL_4_MATRICULA_RESP = @matricula
                ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
            `);
        
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
            .input('hierarchyLevel', sql.Int, level)
            .input('hierarchyPath', sql.VarChar, path)
            .input('departamento', sql.VarChar, departamento)
            .query(`
                UPDATE Users 
                SET HierarchyLevel = @hierarchyLevel,
                    HierarchyPath = @hierarchyPath,
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

// Responder avaliação
app.post('/api/avaliacoes/:id/responder', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { responses } = req.body;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se o usuário tem acesso à avaliação
        const accessResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT 1 FROM AvaliacaoColaboradores 
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        if (accessResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Acesso negado a esta avaliação' });
        }
        
        // Salvar respostas
        for (const response of responses) {
            await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .input('colaboradorId', sql.Int, userId)
                .input('pergunta', sql.Text, response.question)
                .input('resposta', sql.Text, response.answer)
                .input('pontuacao', sql.Int, response.score)
                .query(`
                    INSERT INTO AvaliacaoRespostas (avaliacao_id, colaborador_id, pergunta, resposta, pontuacao)
                    VALUES (@avaliacaoId, @colaboradorId, @pergunta, @resposta, @pontuacao)
                `);
        }
        
        // Marcar como concluída
        await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('colaboradorId', sql.Int, userId)
            .query(`
                UPDATE AvaliacaoColaboradores 
                SET status = 'Concluída', data_conclusao = GETDATE()
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @colaboradorId
            `);
        
        res.json({ success: true, message: 'Avaliação respondida com sucesso' });
    } catch (error) {
        console.error('Erro ao responder avaliação:', error);
        res.status(500).json({ error: 'Erro ao responder avaliação' });
    }
});

// Buscar avaliação específica
app.get('/api/avaliacoes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        
        // Validar se o ID é um número válido
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            return res.status(400).json({ error: 'ID da avaliação inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se as tabelas existem
        try {
            await pool.request().query('SELECT TOP 1 * FROM Avaliacoes');
        } catch (tableError) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        // Buscar avaliação
        const avaliacaoResult = await pool.request()
            .input('avaliacaoId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    a.*,
                    u.NomeCompleto as criador_nome
                FROM Avaliacoes a
                JOIN Users u ON a.criado_por = u.Id
                WHERE a.Id = @avaliacaoId
            `);
        
        if (avaliacaoResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        const avaliacao = avaliacaoResult.recordset[0];
        
        // Buscar perguntas
        const perguntasResult = await pool.request()
            .input('avaliacaoId', sql.Int, parseInt(id))
            .query(`
                SELECT * FROM AvaliacaoPerguntas 
                WHERE avaliacao_id = @avaliacaoId 
                ORDER BY ordem
            `);
        
        // Buscar colaboradores
        const colaboradoresResult = await pool.request()
            .input('avaliacaoId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    ac.*,
                    u.NomeCompleto,
                    u.Departamento,
                    u.Cargo
                FROM AvaliacaoColaboradores ac
                JOIN Users u ON ac.colaborador_id = u.Id
                WHERE ac.avaliacao_id = @avaliacaoId
                ORDER BY u.NomeCompleto
            `);
        
        avaliacao.perguntas = perguntasResult.recordset;
        avaliacao.colaboradores = colaboradoresResult.recordset;
        
        res.json(avaliacao);
    } catch (error) {
        console.error('Erro ao buscar avaliação:', error);
        
        if (error.message && error.message.includes('Invalid object name')) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }
        
        res.status(500).json({ error: 'Erro ao buscar avaliação' });
    }
});

// Responder avaliação
app.post('/api/avaliacoes/:id/responder', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { respostas } = req.body;
        const userId = req.session.user.userId;
        const pool = await sql.connect(dbConfig);
        
        // Verificar se usuário pode responder esta avaliação
        const colaboradorResult = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                SELECT * FROM AvaliacaoColaboradores 
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @userId
            `);
        
        if (colaboradorResult.recordset.length === 0) {
            return res.status(403).json({ error: 'Você não pode responder esta avaliação' });
        }
        
        if (colaboradorResult.recordset[0].status === 'Concluída') {
            return res.status(400).json({ error: 'Avaliação já foi respondida' });
        }
        
        // Inserir respostas
        for (const resposta of respostas) {
            await pool.request()
                .input('avaliacaoId', sql.Int, id)
                .input('colaboradorId', sql.Int, userId)
                .input('perguntaId', sql.Int, resposta.perguntaId)
                .input('resposta', sql.Text, resposta.resposta)
                .input('score', sql.Int, resposta.score || null)
                .query(`
                    INSERT INTO AvaliacaoRespostas (avaliacao_id, colaborador_id, pergunta_id, resposta, score)
                    VALUES (@avaliacaoId, @colaboradorId, @perguntaId, @resposta, @score)
                `);
        }
        
        // Marcar como concluída
        await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .input('colaboradorId', sql.Int, userId)
            .query(`
                UPDATE AvaliacaoColaboradores 
                SET status = 'Concluída', data_conclusao = GETDATE()
                WHERE avaliacao_id = @avaliacaoId AND colaborador_id = @colaboradorId
            `);
        
        res.json({ success: true, message: 'Avaliação respondida com sucesso' });
    } catch (error) {
        console.error('Erro ao responder avaliação:', error);
        res.status(500).json({ error: 'Erro ao responder avaliação' });
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

// Buscar próximas avaliações do usuário
app.get('/api/avaliacoes/pendentes', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.userId;
        
        // Validar se userId é um número válido
        if (!userId || isNaN(parseInt(userId)) || parseInt(userId) <= 0) {
            console.error('UserId inválido:', userId);
            return res.status(400).json({ error: 'ID do usuário inválido' });
        }
        
        const pool = await sql.connect(dbConfig);
        
        // Verificar se as tabelas existem
        try {
            await pool.request().query('SELECT TOP 1 * FROM Avaliacoes');
        } catch (tableError) {
            console.error('Tabela Avaliacoes não existe:', tableError.message);
            return res.json([]);
        }
        
        const result = await pool.request()
            .input('userId', sql.Int, parseInt(userId))
            .query(`
                SELECT 
                    a.Id,
                    a.titulo,
                    a.descricao,
                    a.tipo,
                    a.data_inicio,
                    a.data_fim,
                    a.status,
                    ac.status as status_colaborador,
                    u.NomeCompleto as criador_nome
                FROM Avaliacoes a
                JOIN AvaliacaoColaboradores ac ON a.Id = ac.avaliacao_id
                JOIN Users u ON a.criado_por = u.Id
                WHERE ac.colaborador_id = @userId 
                AND a.status = 'Ativa'
                AND ac.status = 'Pendente'
                AND a.data_fim >= GETDATE()
                ORDER BY a.data_fim ASC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar avaliações pendentes:', error);
        
        // Se for erro de tabela não existir, retornar array vazio
        if (error.message && error.message.includes('Invalid object name')) {
            return res.json([]);
        }
        
        res.status(500).json({ error: 'Erro ao buscar avaliações pendentes' });
    }
});

// Buscar resultados de avaliação (apenas para gestores)
app.get('/api/avaliacoes/:id/resultados', requireAuth, requireManagerAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await sql.connect(dbConfig);
        
        // Buscar respostas da avaliação
        const result = await pool.request()
            .input('avaliacaoId', sql.Int, id)
            .query(`
                SELECT 
                    ar.*,
                    ap.pergunta,
                    ap.tipo as tipo_pergunta,
                    u.NomeCompleto,
                    u.Departamento
                FROM AvaliacaoRespostas ar
                JOIN AvaliacaoPerguntas ap ON ar.pergunta_id = ap.Id
                JOIN Users u ON ar.colaborador_id = u.Id
                WHERE ar.avaliacao_id = @avaliacaoId
                ORDER BY u.NomeCompleto, ap.ordem
            `);
        
        // Agrupar por colaborador
        const resultados = {};
        result.recordset.forEach(row => {
            if (!resultados[row.colaborador_id]) {
                resultados[row.colaborador_id] = {
                    colaborador: {
                        id: row.colaborador_id,
                        nome: row.NomeCompleto,
                        departamento: row.Departamento
                    },
                    respostas: []
                };
            }
            
            resultados[row.colaborador_id].respostas.push({
                pergunta: row.pergunta,
                tipo: row.tipo_pergunta,
                resposta: row.resposta,
                score: row.score
            });
        });
        
        res.json(Object.values(resultados));
    } catch (error) {
        console.error('Erro ao buscar resultados:', error);
        res.status(500).json({ error: 'Erro ao buscar resultados' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    
    // Iniciar sincronização automática ao iniciar o servidor
    console.log('🚀 Iniciando sincronização automática...');
    initializeManagers();
    sincronizador.startAutoSync(30).catch(error => {
        console.error('❌ Erro ao iniciar sincronização automática:', error);
    });
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
        const { titulo, descricao, responsavel_id, data_inicio, data_fim, status, progresso } = req.body;
        const pool = await sql.connect(dbConfig);
        
        await pool.request()
            .input('id', sql.Int, id)
            .input('titulo', sql.NVarChar, titulo)
            .input('descricao', sql.NText, descricao)
            .input('responsavel_id', sql.Int, responsavel_id)
            .input('data_inicio', sql.Date, data_inicio)
            .input('data_fim', sql.Date, data_fim)
            .input('status', sql.NVarChar, status)
            .input('progresso', sql.Decimal(5,2), progresso)
            .query(`
                UPDATE Objetivos SET
                    titulo = @titulo,
                    descricao = @descricao,
                    responsavel_id = @responsavel_id,
                    data_inicio = @data_inicio,
                    data_fim = @data_fim,
                    status = @status,
                    progresso = @progresso,
                    updated_at = GETDATE()
                WHERE Id = @id
            `);
        
        res.json({ success: true });
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

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    
    // Iniciar sincronização automática
    console.log('🚀 Iniciando sincronização automática...');
    initializeManagers();
    sincronizador.startAutoSync(30).catch(error => {
        console.error('❌ Erro ao iniciar sincronização automática:', error);
    });
});