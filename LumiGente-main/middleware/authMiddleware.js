const sql = require('mssql');
const { getDatabasePool } = require('../config/db');
const { getHierarchyLevel } = require('../utils/hierarchyHelper');

/**
 * Middleware que exige que o usuário esteja autenticado.
 * Redireciona para /login se for uma requisição de página, ou retorna 401 para API.
 */
exports.requireAuth = (req, res, next) => {
    if (!req.session.user) {
        // Se é uma requisição de página HTML, redirecionar para login
        if (req.accepts('html') && !req.xhr) {
            return res.redirect('/login');
        }
        // Se é uma requisição AJAX/API, retornar erro JSON
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    next();
};

/**
 * Middleware para verificar se o usuário é gestor, do RH ou T&D.
 */
exports.requireManagerAccess = async (req, res, next) => {
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
        const pool = await getDatabasePool();
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

/**
 * Middleware para verificar se o usuário pertence aos departamentos de RH ou T&D.
 */
exports.requireHRAccess = (req, res, next) => {
    const user = req.session.user;

    if (!user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }

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


/**
 * Middleware para verificar acesso a resultados de pesquisas, restrito a RH e T&D.
 */
exports.requireSurveyResultsAccess = (req, res, next) => {
    const user = req.session.user;

    if (!user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    const departamento = user.departamento ? user.departamento.toUpperCase() : '';
    const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
    const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') ||
                 departamento.includes('TREINAMENTO') ||
                 departamento.includes('DESENVOLVIMENTO') ||
                 departamento.includes('T&D');

    if (!isHR && !isTD) {
        return res.status(403).json({
            error: 'Acesso negado. Apenas usuários do RH e Treinamento & Desenvolvimento podem acessar relatórios de pesquisa.',
        });
    }
    next();
};


/**
 * Middleware que retorna uma função para verificar o nível hierárquico mínimo.
 * @param {number} minLevel - O nível hierárquico mínimo necessário.
 */
exports.requireHierarchyLevel = (minLevel) => {
    return (req, res, next) => {
        const user = req.session.user;

        if (!user) {
            return res.status(401).json({ error: 'Usuário não autenticado' });
        }

        // Administradores sempre têm acesso
        if (user.role === 'Administrador') {
            return next();
        }

        // O 'hierarchyLevel' deve ser calculado no momento do login e armazenado na sessão
        const userLevel = user.hierarchyLevel || 0;

        if (userLevel >= minLevel) {
            return next();
        }

        return res.status(403).json({
            error: `Acesso negado. Nível hierárquico mínimo requerido: ${minLevel}. Seu nível é: ${userLevel}.`
        });
    };
};

/**
 * Middleware para verificar se um usuário pode acessar os dados de outro.
 */
exports.canAccessUser = async (req, res, next) => {
    try {
        const targetUserId = req.params.userId || req.body.userId;
        if (!targetUserId) {
            return next(); // Nenhuma verificação necessária se não houver um ID de destino
        }

        const currentUser = req.session.user;

        // Administradores podem acessar tudo
        if (currentUser.role === 'Administrador') {
            return next();
        }

        const pool = await getDatabasePool();
        const targetUserResult = await pool.request()
            .input('userId', sql.Int, targetUserId)
            .query(`
                SELECT HierarchyPath, Departamento, Matricula
                FROM Users WHERE Id = @userId
            `);

        const targetUser = targetUserResult.recordset[0];
        if (!targetUser) {
            return res.status(404).json({ error: 'Usuário alvo não encontrado' });
        }

        // Calcular HierarchyLevel do alvo dinamicamente
        targetUser.HierarchyLevel = getHierarchyLevel(targetUser.HierarchyPath, targetUser.Matricula, targetUser.Departamento);

        // Verificar hierarquia: um superior pode acessar um subordinado
        if (currentUser.hierarchyLevel > targetUser.HierarchyLevel) {
            return next();
        }

        // Mesmo nível só pode acessar se for do mesmo departamento
        if (currentUser.hierarchyLevel === targetUser.HierarchyLevel && currentUser.departamento === targetUser.Departamento) {
            return next();
        }

        return res.status(403).json({ error: 'Acesso negado. Permissão insuficiente para acessar os dados deste usuário.' });
    } catch (error) {
        console.error('Erro ao verificar permissões de acesso ao usuário:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
};