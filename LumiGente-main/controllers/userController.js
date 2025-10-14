const sql = require('mssql');
const bcrypt = require('bcrypt');
const { getDatabasePool } = require('../config/db');
const HierarchyManager = require('../services/hierarchyManager');

// Instancia o HierarchyManager para ser usado no controller
const hierarchyManager = new HierarchyManager();


// =================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO
// =================================================================

/**
 * Verifica se um usuário é gestor baseado na tabela HIERARQUIA_CC.
 * @param {object} user - O objeto do usuário da sessão.
 * @returns {Promise<boolean>} - True se for gestor, false caso contrário.
 */
async function isUserManager(user) {
    try {
        const pool = await getDatabasePool();
        console.log(`🔍 Verificando se usuário é gestor: CPF = ${user.CPF}`);

        // Verificar se o usuário aparece como CPF_RESPONSAVEL (gestor direto)
        const directManagerResult = await pool.request()
            .input('cpf', sql.VarChar, user.CPF)
            .query(`SELECT COUNT(*) as count FROM HIERARQUIA_CC WHERE CPF_RESPONSAVEL = @cpf`);
        
        const isDirectManager = directManagerResult.recordset[0].count > 0;

        // Verificar se o usuário está em um nível superior da hierarquia
        const userDeptResult = await pool.request()
            .input('departamento', sql.VarChar, user.Departamento || user.departamento)
            .query(`SELECT DISTINCT HIERARQUIA_COMPLETA FROM HIERARQUIA_CC WHERE DEPTO_ATUAL = @departamento`);

        let isUpperManager = false;
        if (userDeptResult.recordset.length > 0) {
            const userHierarchy = userDeptResult.recordset[0].HIERARQUIA_COMPLETA;
            const subordinatesResult = await pool.request()
                .input('hierarquia', sql.VarChar, `%${userHierarchy}%`)
                .input('departamento', sql.VarChar, user.Departamento || user.departamento)
                .query(`SELECT COUNT(*) as count FROM HIERARQUIA_CC WHERE HIERARQUIA_COMPLETA LIKE @hierarquia AND DEPTO_ATUAL != @departamento`);
            
            if (subordinatesResult.recordset[0].count > 0) {
                isUpperManager = true;
            }
        }

        return isDirectManager || isUpperManager;
    } catch (error) {
        console.error('Erro ao verificar se usuário é gestor:', error);
        return false;
    }
}

/**
 * Obtém informações detalhadas da hierarquia de um gestor.
 * @param {object} user - O objeto do usuário da sessão.
 * @returns {Promise<Array>} - Um array com os departamentos gerenciados.
 */
async function getUserHierarchyInfo(user) {
    try {
        const pool = await getDatabasePool();
        
        // Departamentos onde é responsável direto
        const directResult = await pool.request()
            .input('cpf', sql.VarChar, user.CPF)
            .query(`SELECT *, 'DIRETO' as TIPO_GESTAO FROM HIERARQUIA_CC WHERE CPF_RESPONSAVEL = @cpf`);

        let allManagedDepts = [...directResult.recordset];
        
        // Departamentos subordinados
        const userDept = user.Departamento || user.departamento;
        if (userDept) {
            const subordinatesResult = await pool.request()
                .input('departamento', sql.VarChar, userDept)
                .query(`SELECT *, 'HIERARQUIA' as TIPO_GESTAO FROM HIERARQUIA_CC WHERE HIERARQUIA_COMPLETA LIKE '%' + @departamento + '%' AND DEPTO_ATUAL != @departamento`);
            
            for (const subDept of subordinatesResult.recordset) {
                if (!allManagedDepts.some(d => d.DEPTO_ATUAL === subDept.DEPTO_ATUAL)) {
                    allManagedDepts.push(subDept);
                }
            }
        }

        allManagedDepts.sort((a, b) => b.HIERARQUIA_COMPLETA.length - a.HIERARQUIA_COMPLETA.length);
        return allManagedDepts;
    } catch (error) {
        console.error('Erro ao buscar informações hierárquicas:', error);
        return [];
    }
}

/**
 * Determina as permissões de acesso às abas da interface com base no departamento e hierarquia.
 * @param {object} user - O objeto do usuário da sessão.
 * @returns {Promise<object>} - Um objeto com as permissões.
 */
async function getUserTabPermissions(user) {
    const departmentCode = user.Departamento;
    
    const fullAccessDepartments = ['122134101', '000122134', '121411100', '000121511', '121511100'];

    if (fullAccessDepartments.includes(departmentCode)) {
        console.log(`✅ Usuário tem acesso total (RH/T&D): ${departmentCode}`);
        return {
            dashboard: true, feedbacks: true, recognitions: true, humor: true, objetivos: true,
            pesquisas: true, avaliacoes: true, team: true, analytics: true, historico: true,
            isManager: true, isFullAccess: true, managerType: 'RH/T&D'
        };
    }

    const isManager = await isUserManager(user);
    if (isManager) {
        console.log(`👨‍💼 Usuário identificado como Gestor`);
        return {
            dashboard: true, feedbacks: true, recognitions: true, humor: true, objetivos: true,
            pesquisas: true, avaliacoes: true, team: true, analytics: true, historico: false,
            isManager: true, isFullAccess: false, managerType: 'Gestor'
        };
    }
    
    console.log(`👥 Usuário identificado como colaborador comum`);
    return {
        dashboard: true, feedbacks: true, recognitions: true, humor: true, objetivos: true,
        pesquisas: true, avaliacoes: true, team: false, analytics: false, historico: false,
        isManager: false, isFullAccess: false, managerType: 'Colaborador'
    };
}


// =================================================================
// CONTROLLERS (Funções exportadas para as rotas)
// =================================================================

/**
 * GET /api/usuario - Retorna os dados do usuário logado na sessão.
 */
exports.getCurrentUser = (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Usuário não autenticado' });
    }
};

/**
 * GET /api/usuario/permissions - Retorna as permissões de abas e hierarquia do usuário.
 */
exports.getUserPermissions = async (req, res) => {
    try {
        const user = req.session.user;
        const permissions = await getUserTabPermissions(user);
        const hierarchyInfo = permissions.isManager ? await getUserHierarchyInfo(user) : [];

        res.json({
            success: true,
            permissions,
            hierarchy: {
                ...permissions,
                hierarchyLevel: user.hierarchyLevel,
                managedDepartments: hierarchyInfo.map(h => h.DEPTO_ATUAL),
                hierarchyPaths: hierarchyInfo.map(h => h.HIERARQUIA_COMPLETA)
            }
        });
    } catch (error) {
        console.error('Erro ao buscar permissões do usuário:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar permissões' });
    }
};

/**
 * GET /api/users - Lista usuários com base na hierarquia e filtros.
 */
exports.getUsers = async (req, res) => {
    try {
        const currentUser = req.session.user;
        const { search, department, hierarchyLevel } = req.query;

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
};

/**
 * GET /api/users/feedback - Lista todos os usuários ativos para seleção em feedbacks, sem restrição de hierarquia.
 */
exports.getUsersForFeedback = async (req, res) => {
    try {
        const users = await hierarchyManager.getUsersForFeedback();
        res.json(users);
    } catch (error) {
        console.error('Erro ao buscar usuários para feedback:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

/**
 * GET /api/subordinates - Lista os subordinados diretos do gestor logado.
 */
exports.getSubordinates = async (req, res) => {
    try {
        const currentUser = req.session.user;
        const pool = await getDatabasePool();
        
        const result = await pool.request()
            .input('matricula', sql.VarChar, currentUser.matricula)
            .input('cpf', sql.VarChar, currentUser.cpf)
            .query(`
                SELECT u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath, u.Matricula, u.CPF, u.LastLogin
                FROM Users u
                JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL AND u.CPF = h.CPF_RESPONSAVEL
                WHERE h.RESPONSAVEL_ATUAL = @matricula AND h.CPF_RESPONSAVEL = @cpf AND u.IsActive = 1
                ORDER BY u.NomeCompleto
            `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar subordinados:', error);
        res.status(500).json({ error: 'Erro ao buscar subordinados' });
    }
};

/**
 * PUT /api/usuario/profile - Atualiza o perfil do usuário logado.
 */
exports.updateProfile = async (req, res) => {
    try {
        const { nomeCompleto, nome, departamento } = req.body;
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        await pool.request()
            .input('userId', sql.Int, userId)
            .input('nomeCompleto', sql.VarChar, nomeCompleto)
            .input('nome', sql.VarChar, nome)
            .input('departamento', sql.VarChar, departamento)
            .query(`
                UPDATE Users SET NomeCompleto = @nomeCompleto, nome = @nome, Departamento = @departamento, updated_at = GETDATE()
                WHERE Id = @userId
            `);
        
        // Atualizar sessão
        req.session.user.nomeCompleto = nomeCompleto;
        req.session.user.nome = nome;
        req.session.user.departamento = departamento;

        res.json({ success: true, message: 'Perfil atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        res.status(500).json({ error: 'Erro ao atualizar perfil' });
    }
};

/**
 * PUT /api/usuario/password - Altera a senha do usuário logado.
 */
exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.session.user.userId;

        if (!currentPassword || !newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: 'Dados inválidos para alteração de senha.' });
        }

        const pool = await getDatabasePool();
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`SELECT PasswordHash FROM Users WHERE Id = @userId`);
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        const user = userResult.recordset[0];
        const isValidPassword = await bcrypt.compare(currentPassword, user.PasswordHash);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Senha atual incorreta' });
        }

        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('passwordHash', sql.VarChar, newPasswordHash)
            .query(`UPDATE Users SET PasswordHash = @passwordHash, updated_at = GETDATE() WHERE Id = @userId`);

        res.json({ success: true, message: 'Senha alterada com sucesso' });
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        res.status(500).json({ error: 'Erro ao alterar senha' });
    }
};

/**
 * PUT /api/usuario/notifications - Salva as preferências de notificação (simulado).
 */
exports.updateNotificationPreferences = async (req, res) => {
    const { feedback, recognition, objectives, surveys } = req.body;
    console.log(`Preferências de notificação salvas para usuário ${req.session.user.userId}:`, { feedback, recognition, objectives, surveys });
    res.json({ success: true, message: 'Preferências salvas com sucesso (simulado)' });
};

/**
 * PUT /api/usuario/privacy - Salva as configurações de privacidade (simulado).
 */
exports.updatePrivacySettings = async (req, res) => {
    const { profileVisible, showDepartment, showPosition } = req.body;
    console.log(`Configurações de privacidade salvas para usuário ${req.session.user.userId}:`, { profileVisible, showDepartment, showPosition });
    res.json({ success: true, message: 'Configurações de privacidade salvas com sucesso (simulado)' });
};