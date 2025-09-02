/**
 * Sincronizador de Dados Externos
 * Sistema Feedz - Lumicenter
 * 
 * Responsável por sincronizar dados das tabelas:
 * - HIERARQUIA_CC (hierarquia organizacional)
 * - TAB_HIST_SRA (dados dos funcionários)
 */

const sql = require('mssql');
const HierarchyManager = require('./utils/hierarchyManager');

class SincronizadorDadosExternos {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
        this.hierarchyManager = new HierarchyManager(dbConfig);
        this.isRunning = false;
        this.syncInterval = null;
    }

    /**
     * Função utilitária para conexão com retry logic
     */
    async connectWithRetry(config, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const pool = await sql.connect(config);
                return pool;
            } catch (error) {
                lastError = error;
                
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw new Error(`Falha na conexão após ${maxRetries} tentativas. Último erro: ${lastError.message}`);
    }

    /**
     * Função para obter pool de conexão com fallback
     */
    async getDatabasePool() {
        try {
            return await this.connectWithRetry(this.dbConfig);
        } catch (error) {
            try {
                const dbConfigFallback = {
                    ...this.dbConfig,
                    options: {
                        ...this.dbConfig.options,
                        requestTimeout: 60000,
                        connectionTimeout: 60000,
                        pool: {
                            max: 5,
                            min: 0,
                            idleTimeoutMillis: 60000
                        }
                    }
                };
                return await this.connectWithRetry(dbConfigFallback);
            } catch (fallbackError) {
                throw fallbackError;
            }
        }
    }

    /**
     * Inicia o sincronizador automático
     * @param {number} intervalMinutes - Intervalo em minutos para sincronização
     */
    async startAutoSync(intervalMinutes = 30) {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        await this.syncAllData();

        this.syncInterval = setInterval(async () => {
            await this.syncAllData();
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Para o sincronizador automático
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.isRunning = false;
    }

    /**
     * Sincroniza todos os dados
     */
    async syncAllData() {
        try {
            await this.syncFuncionarios();
            await this.syncHierarquia();
            await this.updateExistingUsers();
        } catch (error) {
            console.error('❌ Erro na sincronização:', error);
        }
    }

    /**
     * Sincroniza dados dos funcionários da TAB_HIST_SRA
     */
    async syncFuncionarios() {
        const pool = await this.getDatabasePool();
        
        try {
            const funcionariosResult = await pool.request().query(`
                WITH FuncionarioMaisRecente AS (
                    SELECT 
                        MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, 
                        DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL, DTA_ADMISSAO,
                        ROW_NUMBER() OVER (PARTITION BY CPF ORDER BY 
                            CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                            DTA_ADMISSAO DESC, 
                            MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA 
                    WHERE STATUS_GERAL = 'ATIVO'
                )
                SELECT 
                    MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, 
                    DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL
                FROM FuncionarioMaisRecente
                WHERE rn = 1
                ORDER BY MATRICULA
            `);

            const funcionarios = funcionariosResult.recordset;

            for (const funcionario of funcionarios) {
                await this.verificarNovoFuncionario(funcionario);
            }

        } catch (error) {
            console.error('❌ Erro ao sincronizar funcionários:', error);
            throw error;
        }
    }

    /**
     * Verifica se um funcionário precisa ser cadastrado no sistema
     */
    async verificarNovoFuncionario(funcionario) {
        const pool = await this.getDatabasePool();
        
        try {
            const existingUserResult = await pool.request()
                .input('matricula', sql.VarChar, funcionario.MATRICULA)
                .query(`SELECT Id FROM Users WHERE Matricula = @matricula`);

            if (existingUserResult.recordset.length === 0) {
                console.log(`Novo funcionário: ${funcionario.NOME}`);
                
                const senhaTemporaria = await this.generateTemporaryPassword();
                const senhaHash = await require('bcrypt').hash(senhaTemporaria, 10);
                
                const hierarchyData = await this.hierarchyManager.getHierarchyLevel(funcionario.MATRICULA);
                const { level: hierarchyLevel, path: hierarchyPath, departamento: departamentoDesc } = hierarchyData;

                await pool.request()
                    .input('cpf', sql.VarChar, funcionario.CPF)
                    .input('matricula', sql.VarChar, funcionario.MATRICULA)
                    .input('hierarchyLevel', sql.Int, hierarchyLevel)
                    .input('hierarchyPath', sql.VarChar, hierarchyPath)
                    .input('departamento', sql.VarChar, departamentoDesc)
                    .input('passwordHash', sql.VarChar, senhaHash)
                    .input('nomeCompleto', sql.VarChar, funcionario.NOME)
                    .input('userName', sql.VarChar, funcionario.CPF)
                    .input('email', sql.VarChar, `${funcionario.CPF}@lumicenter.com`)
                    .input('nome', sql.VarChar, funcionario.NOME.split(' ')[0])
                    .input('unidade', sql.VarChar, funcionario.FILIAL)
                    .input('cargo', sql.VarChar, funcionario.DEPARTAMENTO)
                    .query(`
                        INSERT INTO Users (CPF, Matricula, HierarchyLevel, HierarchyPath, Departamento, 
                                         PasswordHash, IsActive, NomeCompleto, created_at, UserName, 
                                         Email, nome, Unidade, Cargo, PasswordTemporary)
                        VALUES (@cpf, @matricula, @hierarchyLevel, @hierarchyPath, @departamento, 
                               @passwordHash, 1, @nomeCompleto, GETDATE(), @userName, 
                               @email, @nome, @unidade, @cargo, 1)
                    `);
            }

        } catch (error) {
            console.error(`❌ Erro ao verificar funcionário ${funcionario.MATRICULA}:`, error);
        }
    }

    /**
     * Sincroniza dados da hierarquia da HIERARQUIA_CC
     */
    async syncHierarquia() {
        const pool = await this.getDatabasePool();
        
        try {
            const hierarquiaResult = await pool.request().query(`
                SELECT DISTINCT 
                    DEPTO_ATUAL, DESCRICAO_ATUAL, RESPONSAVEL_ATUAL, 
                    HIERARQUIA_COMPLETA, FILIAL
                FROM HIERARQUIA_CC 
                ORDER BY DEPTO_ATUAL
            `);

        } catch (error) {
            console.error('❌ Erro ao sincronizar hierarquia:', error);
            throw error;
        }
    }

    /**
     * Atualiza dados dos usuários existentes baseado nas tabelas externas
     */
    async updateExistingUsers() {
        const pool = await this.getDatabasePool();
        
        try {
            const usersResult = await pool.request().query(`
                SELECT Id, CPF, Matricula, NomeCompleto, Departamento, Unidade, Cargo, 
                       HierarchyLevel, HierarchyPath, IsActive
                FROM Users 
                ORDER BY Matricula
            `);

            const users = usersResult.recordset;

            for (const user of users) {
                await this.updateUserData(user);
            }

        } catch (error) {
            console.error('❌ Erro ao atualizar usuários:', error);
            throw error;
        }
    }

    /**
     * Atualiza dados de um usuário específico
     */
    async updateUserData(user) {
        const pool = await this.getDatabasePool();
        
        try {
            // Buscar dados atualizados do funcionário pela matrícula mais recente do CPF
            const funcionarioResult = await pool.request()
                .input('cpf', sql.VarChar, user.CPF)
                .query(`
                    WITH FuncionarioMaisRecente AS (
                        SELECT 
                            MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, 
                            DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL, DTA_ADMISSAO,
                            ROW_NUMBER() OVER (ORDER BY 
                                CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                                DTA_ADMISSAO DESC, 
                                MATRICULA DESC
                            ) as rn
                        FROM TAB_HIST_SRA 
                        WHERE CPF = @cpf
                    )
                    SELECT TOP 1 MATRICULA, NOME, FILIAL, CENTRO_CUSTO, CPF, 
                           DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL
                    FROM FuncionarioMaisRecente
                    WHERE rn = 1
                `);

            if (funcionarioResult.recordset.length === 0) {
                return;
            }

            const funcionario = funcionarioResult.recordset[0];

            // Buscar hierarquia atualizada usando a matrícula mais recente
            const hierarchyData = await this.hierarchyManager.getHierarchyLevel(funcionario.MATRICULA);
            const { level: hierarchyLevel, path: hierarchyPath, departamento: departamentoDesc } = hierarchyData;

            // Verificar se é usuário especial (definido por variável de ambiente)
            const specialCPFs = process.env.SPECIAL_USERS_CPF ? process.env.SPECIAL_USERS_CPF.split(',').map(cpf => cpf.trim()) : [];
            const isSpecialUser = specialCPFs.includes(funcionario.CPF);
            
            if (funcionario.STATUS_GERAL !== 'ATIVO' && !isSpecialUser) {
                await pool.request()
                    .input('userId', sql.Int, user.Id)
                    .query(`UPDATE Users SET IsActive = 0 WHERE Id = @userId`);
                return;
            } else if (isSpecialUser) {
                await pool.request()
                    .input('userId', sql.Int, user.Id)
                    .input('departamento', sql.VarChar, departamentoDesc || funcionario.DEPARTAMENTO || 'PJ')
                    .input('hierarchyLevel', sql.Int, hierarchyLevel || 4)
                    .input('hierarchyPath', sql.VarChar, hierarchyPath || '000000011')
                    .input('unidade', sql.VarChar, funcionario.FILIAL || 'MATRIZ')
                    .input('cargo', sql.VarChar, funcionario.DEPARTAMENTO || 'PESSOA JURÍDICA')
                    .query(`
                        UPDATE Users 
                        SET IsActive = 1,
                            Departamento = @departamento,
                            HierarchyLevel = @hierarchyLevel,
                            HierarchyPath = @hierarchyPath,
                            Unidade = @unidade,
                            Cargo = @cargo,
                            updated_at = GETDATE()
                        WHERE Id = @userId
                    `);
            }

            // Verificar se houve mudanças (incluindo mudança de matrícula)
            const hasChanges = 
                user.Matricula !== funcionario.MATRICULA ||
                user.NomeCompleto !== funcionario.NOME ||
                user.Departamento !== departamentoDesc ||
                user.HierarchyLevel !== hierarchyLevel ||
                user.HierarchyPath !== hierarchyPath ||
                user.Unidade !== funcionario.FILIAL ||
                user.Cargo !== funcionario.DEPARTAMENTO;

            if (hasChanges) {
                console.log(`Atualizando: ${funcionario.NOME}`);
                
                await pool.request()
                    .input('userId', sql.Int, user.Id)
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
            }

        } catch (error) {
            console.error(`❌ Erro ao atualizar usuário ${user.Matricula}:`, error);
        }
    }

    /**
     * Gera uma senha temporária
     */
    async generateTemporaryPassword() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let password = '';
        for (let i = 0; i < 8; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }

    /**
     * Executa sincronização manual
     */
    async syncManual() {
        await this.syncAllData();
    }

    /**
     * Obtém status do sincronizador
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            hasInterval: this.syncInterval !== null
        };
    }
}

module.exports = SincronizadorDadosExternos;
