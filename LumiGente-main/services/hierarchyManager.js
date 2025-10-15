const sql = require('mssql');
const { getDatabasePool } = require('../config/db'); // Importa a função de conexão centralizada
const { getHierarchyLevel } = require('../utils/hierarchyHelper'); // Mantém a importação do helper

class HierarchyManager {
    constructor() {
        // com a modularização agora a gente não precisa mais injetar o 'dbConfig'
    }

    /**
     * Obtém o pool de conexão do banco de dados de forma centralizada.
     * @returns {Promise<sql.ConnectionPool>}
     */
    async getPool() {
        // Utiliza a função importada para garantir uma única fonte de conexão.
        return await getDatabasePool();
    }

    /**
     * Determina a hierarquia baseada na matrícula e CPF.
     * @param {string} matricula - Matrícula do funcionário.
     * @param {string} cpf - CPF do funcionário (opcional, mas recomendado).
     * @returns {Promise<Object>} - Objeto com path, departamento e um getter 'level'.
     */
    async getHierarchyInfo(matricula, cpf = null) {
        try {
            const pool = await this.getPool();
            
            const funcionarioQuery = cpf 
                ? `SELECT TOP 1 CENTRO_CUSTO, DEPARTAMENTO, NOME, CPF FROM TAB_HIST_SRA WHERE MATRICULA = @matricula AND CPF = @cpf ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END, MATRICULA DESC`
                : `SELECT TOP 1 CENTRO_CUSTO, DEPARTAMENTO, NOME, CPF FROM TAB_HIST_SRA WHERE MATRICULA = @matricula ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END, MATRICULA DESC`;
            
            const funcionarioRequest = pool.request().input('matricula', sql.VarChar, matricula);
            if (cpf) {
                funcionarioRequest.input('cpf', sql.VarChar, cpf);
            }
            
            const funcionarioResult = await funcionarioRequest.query(funcionarioQuery);
            
            if (funcionarioResult.recordset.length === 0) {
                return { path: '', departamento: 'Não definido', get level() { return 0; } };
            }
            
            const funcionario = funcionarioResult.recordset[0];
            const cpfParaUsar = cpf || funcionario.CPF;
            
            const hierarquiaResult = await pool.request()
                .input('matricula', sql.VarChar, matricula)
                .input('cpf', sql.VarChar, cpfParaUsar)
                .query(`
                    SELECT TOP 1 DEPTO_ATUAL, DESCRICAO_ATUAL, HIERARQUIA_COMPLETA
                    FROM HIERARQUIA_CC 
                    WHERE RESPONSAVEL_ATUAL = @matricula AND (CPF_RESPONSAVEL = @cpf OR CPF_RESPONSAVEL IS NULL)
                    ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
                `);
            
            let path = '';
            let departamento = funcionario.DEPARTAMENTO || 'Não definido';
            
            if (hierarquiaResult.recordset.length > 0) {
                const hierarquia = hierarquiaResult.recordset[0];
                path = hierarquia.HIERARQUIA_COMPLETA;
                departamento = hierarquia.DEPTO_ATUAL;
            } else {
                const hierarquiaTrabalhoResult = await pool.request()
                    .input('deptoAtual', sql.VarChar, funcionario.DEPARTAMENTO)
                    .query(`
                        SELECT TOP 1 DEPTO_ATUAL, HIERARQUIA_COMPLETA
                        FROM HIERARQUIA_CC 
                        WHERE TRIM(DEPTO_ATUAL) = TRIM(@deptoAtual)
                        ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
                    `);
                
                if (hierarquiaTrabalhoResult.recordset.length > 0) {
                    path = hierarquiaTrabalhoResult.recordset[0].HIERARQUIA_COMPLETA;
                    departamento = hierarquiaTrabalhoResult.recordset[0].DEPTO_ATUAL;
                }
            }

            return {
                path,
                departamento,
                get level() { return getHierarchyLevel(this.path); }
            };
        } catch (error) {
            console.error('Erro ao determinar hierarquia:', error);
            return { path: '', departamento: 'Erro', get level() { return 0; } };
        }
    }
    
    /**
     * Alias para getHierarchyInfo() para manter compatibilidade com código legado.
     * @deprecated Use getHierarchyInfo()
     */
    async getHierarchyLevel(matricula, cpf = null) {
        return this.getHierarchyInfo(matricula, cpf);
    }

    /**
     * Verifica se um usuário pode aceder aos dados de outro.
     */
    canAccessUser(currentUser, targetUser) {
        if (currentUser.role === 'Administrador') return true;

        const currentLevel = getHierarchyLevel(currentUser.hierarchyPath || currentUser.HierarchyPath);
        const targetLevel = getHierarchyLevel(targetUser.hierarchyPath || targetUser.HierarchyPath);

        if (currentLevel > targetLevel) return true;
        if (currentLevel === targetLevel) return currentUser.departamento === targetUser.Departamento;

        return false;
    }

    /**
     * Busca os subordinados de um utilizador.
     */
    async getSubordinates(matricula, cpf = null) {
        try {
            const pool = await this.getPool();
            const query = cpf
                ? `SELECT DISTINCT u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath, u.Matricula, u.CPF, u.LastLogin FROM Users u JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL AND u.CPF = h.CPF_RESPONSAVEL WHERE h.RESPONSAVEL_ATUAL = @matricula AND h.CPF_RESPONSAVEL = @cpf AND u.IsActive = 1 ORDER BY u.NomeCompleto`
                : `SELECT DISTINCT u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath, u.Matricula, u.CPF, u.LastLogin FROM Users u JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL WHERE h.RESPONSAVEL_ATUAL = @matricula AND u.IsActive = 1 ORDER BY u.NomeCompleto`;
            
            const request = pool.request().input('matricula', sql.VarChar, matricula);
            if (cpf) request.input('cpf', sql.VarChar, cpf);
            
            const result = await request.query(query);

            const recordsWithLevel = result.recordset.map(record => ({
                ...record,
                HierarchyLevel: getHierarchyLevel(record.HierarchyPath, record.Matricula, record.Departamento)
            })).sort((a, b) => b.HierarchyLevel - a.HierarchyLevel || a.NomeCompleto.localeCompare(b.NomeCompleto));

            return recordsWithLevel;
        } catch (error) {
            console.error('Erro ao buscar subordinados:', error);
            throw error;
        }
    }

    /**
     * Busca os superiores de um utilizador.
     */
    async getSuperiors(matricula, cpf = null) {
        try {
            const pool = await this.getPool();
            const query = cpf 
                ? `SELECT DISTINCT u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath, u.Matricula, u.CPF FROM Users u JOIN HIERARQUIA_CC h ON ((u.Matricula = h.NIVEL_1_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL) OR (u.Matricula = h.NIVEL_2_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL) OR (u.Matricula = h.NIVEL_3_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL) OR (u.Matricula = h.NIVEL_4_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL)) WHERE h.RESPONSAVEL_ATUAL = @matricula AND h.CPF_RESPONSAVEL = @cpf AND u.IsActive = 1 AND u.Matricula != @matricula ORDER BY u.NomeCompleto`
                : `SELECT DISTINCT u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath, u.Matricula, u.CPF FROM Users u JOIN HIERARQUIA_CC h ON (u.Matricula = h.NIVEL_1_MATRICULA_RESP OR u.Matricula = h.NIVEL_2_MATRICULA_RESP OR u.Matricula = h.NIVEL_3_MATRICULA_RESP OR u.Matricula = h.NIVEL_4_MATRICULA_RESP) WHERE h.RESPONSAVEL_ATUAL = @matricula AND u.IsActive = 1 AND u.Matricula != @matricula ORDER BY u.NomeCompleto`;

            const request = pool.request().input('matricula', sql.VarChar, matricula);
            if (cpf) request.input('cpf', sql.VarChar, cpf);
            
            const result = await request.query(query);
            
            const recordsWithLevel = result.recordset.map(record => ({
                ...record,
                HierarchyLevel: getHierarchyLevel(record.HierarchyPath, record.Matricula, record.Departamento)
            })).sort((a, b) => b.HierarchyLevel - a.HierarchyLevel || a.NomeCompleto.localeCompare(b.NomeCompleto));

            return recordsWithLevel;
        } catch (error) {
            console.error('Erro ao buscar superiores:', error);
            throw error;
        }
    }

    /**
     * Busca utilizadores acessíveis com base na hierarquia e filtros.
     */
    async getAccessibleUsers(currentUser, options = {}) {
        try {
            const pool = await this.getPool();
            
            const departamento = currentUser.departamento ? currentUser.departamento.toUpperCase() : '';
            const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
            const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || departamento.includes('TREINAMENTO') || departamento.includes('T&D');
            
            if (isHR || isTD) {
                let query = `SELECT Id as userId, NomeCompleto as nomeCompleto, Departamento as departamento, HierarchyPath as hierarchyPath, Matricula, 'RH_TD_ACCESS' as TipoRelacao FROM Users WHERE IsActive = 1`;
                if (options.department && options.department !== 'Todos') {
                    query += ` AND Departamento = @department`;
                }
                query += ` ORDER BY NomeCompleto`;
                
                const request = pool.request();
                if (options.department && options.department !== 'Todos') {
                    request.input('department', sql.NVarChar, options.department);
                }
                const result = await request.query(query);
                return result.recordset.map(record => ({ ...record, hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.Matricula, record.departamento) }));
            }
            
            const isManagerCheck = await pool.request().input('userMatricula', sql.VarChar, currentUser.matricula).query(`SELECT COUNT(*) as count FROM HIERARQUIA_CC WHERE RESPONSAVEL_ATUAL = @userMatricula OR NIVEL_1_MATRICULA_RESP = @userMatricula OR NIVEL_2_MATRICULA_RESP = @userMatricula OR NIVEL_3_MATRICULA_RESP = @userMatricula OR NIVEL_4_MATRICULA_RESP = @userMatricula`);
            const isManager = isManagerCheck.recordset[0].count > 0;
            
            if (isManager) {
                const request = pool.request().input('userMatricula', sql.VarChar, currentUser.matricula);
                let query = `
                    WITH UsuariosAcessiveis AS (
                        SELECT DISTINCT u.Id as userId, u.NomeCompleto as nomeCompleto, u.Departamento as departamento, u.HierarchyPath as hierarchyPath, u.Matricula, 'SUBORDINADO' as TipoRelacao
                        FROM Users u INNER JOIN TAB_HIST_SRA s ON u.Matricula = s.MATRICULA AND u.CPF = s.CPF
                        INNER JOIN HIERARQUIA_CC h ON (h.RESPONSAVEL_ATUAL = @userMatricula OR h.NIVEL_1_MATRICULA_RESP = @userMatricula OR h.NIVEL_2_MATRICULA_RESP = @userMatricula OR h.NIVEL_3_MATRICULA_RESP = @userMatricula OR h.NIVEL_4_MATRICULA_RESP = @userMatricula)
                        WHERE u.IsActive = 1 AND s.STATUS_GERAL = 'ATIVO' AND (TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL) OR s.MATRICULA = h.RESPONSAVEL_ATUAL)
                        
                        UNION
                        
                        SELECT u.Id, u.NomeCompleto, u.Departamento, u.HierarchyPath, u.Matricula, 'PROPRIO_USUARIO'
                        FROM Users u WHERE u.Matricula = @userMatricula AND u.IsActive = 1
                    )
                    SELECT DISTINCT userId, nomeCompleto, departamento, hierarchyPath, Matricula, TipoRelacao FROM UsuariosAcessiveis
                `;
                if (options.department && options.department !== 'Todos') {
                    query += ` WHERE departamento = @department OR TipoRelacao = 'PROPRIO_USUARIO'`;
                    request.input('department', sql.NVarChar, options.department);
                }
                query += ` ORDER BY nomeCompleto`;

                const result = await request.query(query);
                return result.recordset.map(record => ({ ...record, hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.userId, record.departamento) }));
            } else {
                const result = await pool.request().input('currentUserId', sql.Int, currentUser.userId).query(`SELECT Id as userId, NomeCompleto as nomeCompleto, Departamento as departamento, HierarchyPath as hierarchyPath FROM Users WHERE IsActive = 1 AND Id = @currentUserId ORDER BY NomeCompleto`);
                return result.recordset.map(record => ({ ...record, hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.userId, record.departamento) }));
            }
        } catch (error) {
            console.error('Erro ao buscar usuários acessíveis:', error);
            throw error;
        }
    }

    /**
     * Busca todos os utilizadores ativos para a funcionalidade de dar feedback (sem restrições).
     */
    async getUsersForFeedback() {
        try {
            const pool = await this.getPool();
            const query = `SELECT Id as userId, NomeCompleto as nomeCompleto, Departamento as departamento, DescricaoDepartamento as descricaoDepartamento, HierarchyPath as hierarchyPath FROM Users WHERE IsActive = 1 ORDER BY NomeCompleto`;
            const result = await pool.request().query(query);
            return result.recordset.map(record => ({ ...record, hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.userId, record.departamento) }));
        } catch (error) {
            console.error('Erro ao buscar usuários para feedback:', error);
            throw error;
        }
    }

    /**
     * Sincroniza a hierarquia de um utilizador específico via Stored Procedure.
     */
    async syncUserHierarchy(userId) {
        try {
            const pool = await this.getPool();
            await pool.request().input('userId', sql.Int, userId).query(`EXEC sp_SyncUserHierarchy @UserId = @userId`);
            return true;
        } catch (error) {
            console.error('Erro ao sincronizar hierarquia do usuário:', error);
            throw error;
        }
    }

    /**
     * Sincroniza a hierarquia de todos os utilizadores via Stored Procedure.
     */
    async syncAllHierarchies() {
        try {
            const pool = await this.getPool();
            await pool.request().query(`EXEC sp_SyncUserHierarchy`);
            return true;
        } catch (error) {
            console.error('Erro ao sincronizar todas as hierarquias:', error);
            throw error;
        }
    }

    /**
     * Obtém estatísticas da hierarquia (contagem de utilizadores por departamento).
     */
    async getHierarchyStats() {
        try {
            const pool = await this.getPool();
            const result = await pool.request().query(`SELECT COUNT(*) as count, Departamento FROM Users WHERE IsActive = 1 GROUP BY Departamento ORDER BY COUNT(*) DESC`);
            return result.recordset;
        } catch (error) {
            console.error('Erro ao buscar estatísticas da hierarquia:', error);
            throw error;
        }
    }
}

module.exports = HierarchyManager;