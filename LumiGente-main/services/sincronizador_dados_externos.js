/**
 * Sincronizador de Dados Externos
 * Sistema LumiGente - Lumicenter
 * 
 * LÓGICA:
 * - Considera registro mais recente por CPF (maior DTA_ADMISSAO)
 * - DescricaoDepartamento buscado da VIEW HIERARQUIA_CC
 * - FirstLogin para definir se precisa de cadastro
 * - Filial ao invés de Unidade
 * - Sem HierarchyLevel (só HierarchyPath)
 */

const sql = require('mssql');
const HierarchyManager = require('../utils/hierarchyManager');

class SincronizadorDadosExternosV2 {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
        this.feedbacksDbConfig = {
            ...dbConfig,
            database: 'LUMICENTER_FEEDBACKS'
        };
        this.hierarchyManager = new HierarchyManager(this.feedbacksDbConfig);
        this.isRunning = false;
        this.syncInterval = null;
    }

    /**
     * Conexão com retry
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
     * Pool de conexão com banco de Feedbacks (LUMICENTER_FEEDBACKS)
     */
    async getDatabasePool() {
        try {
            return await this.connectWithRetry(this.feedbacksDbConfig);
        } catch (error) {
            const dbConfigFallback = {
                ...this.feedbacksDbConfig,
                options: {
                    ...this.feedbacksDbConfig.options,
                    requestTimeout: 60000,
                    connectionTimeout: 60000,
                    pool: { max: 5, min: 0, idleTimeoutMillis: 60000 }
                }
            };
            return await this.connectWithRetry(dbConfigFallback);
        }
    }

    /**
     * Pool de conexão com banco externo (TAB_HIST_SRA, VIEW HIERARQUIA_CC, etc)
     */
    async getExternalPool() {
        try {
            return await this.connectWithRetry(this.dbConfig);
        } catch (error) {
            const dbConfigFallback = {
                ...this.dbConfig,
                options: {
                    ...this.dbConfig.options,
                    requestTimeout: 60000,
                    connectionTimeout: 60000,
                    pool: { max: 5, min: 0, idleTimeoutMillis: 60000 }
                }
            };
            return await this.connectWithRetry(dbConfigFallback);
        }
    }

    /**
     * Inicia sincronização automática
     */
    async startAutoSync(intervalMinutes = 30) {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log(`🔄 Sincronizador iniciado (intervalo: ${intervalMinutes} minutos)`);
        
        await this.syncAllData();

        this.syncInterval = setInterval(async () => {
            await this.syncAllData();
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Para a sincronização
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.isRunning = false;
        console.log('⏸️ Sincronizador parado');
    }

    /**
     * Sincroniza todos os dados
     */
    async syncAllData() {
        try {
            await this.syncFuncionarios();
            console.log('\n✅ Sincronização concluída com sucesso!');
        } catch (error) {
            console.error('\n❌ Erro na sincronização:', error);
            throw error;
        }
    }

    /**
     * NOVA LÓGICA: Sincroniza funcionários
     * Usa mesma lógica do script SQL com CTE e priorização
     */
    async syncFuncionarios() {
        const externalPool = await this.getExternalPool();
        const feedbacksPool = await this.getDatabasePool();
        
        try {
            console.log('👥 Sincronizando funcionários...');

            // 1️⃣ Buscar funcionários ativos priorizados do banco externo
            console.log('   📝 Buscando funcionários ativos com priorização...');
            
            const funcionariosAtivosResult = await externalPool.request().query(`
                WITH FuncionarioAtivo AS (
                    SELECT
                        CPF,
                        MATRICULA,
                        DEPARTAMENTO,
                        FILIAL,
                        CENTRO_CUSTO,
                        NOME,
                        STATUS_GERAL,
                        SITUACAO_FOLHA,
                        DTA_ADMISSAO,
                        ROW_NUMBER() OVER (
                            PARTITION BY CPF
                            ORDER BY
                                -- Prioridade 1: STATUS_GERAL = 'ATIVO'
                                CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                                -- Prioridade 2: SITUACAO_FOLHA vazia ou NULL (funcionário ativo)
                                CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                                -- Prioridade 3: Data de admissão mais recente
                                DTA_ADMISSAO DESC,
                                -- Prioridade 4: Matrícula mais recente
                                MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA
                    WHERE CPF IS NOT NULL AND CPF != ''
                )
                SELECT 
                    CPF,
                    MATRICULA,
                    DEPARTAMENTO,
                    FILIAL,
                    NOME,
                    STATUS_GERAL
                FROM FuncionarioAtivo
                WHERE rn = 1
                ORDER BY CPF
            `);

            const funcionariosAtivos = funcionariosAtivosResult.recordset;
            console.log(`   ℹ️ Encontrados ${funcionariosAtivos.length} funcionários para processar`);

            let novos = 0, atualizados = 0, erros = 0;

            // 2️⃣ Processar cada funcionário
            for (let i = 0; i < funcionariosAtivos.length; i++) {
                const func = funcionariosAtivos[i];
                
                if (i % 100 === 0) {
                    console.log(`   Processando ${i + 1}/${funcionariosAtivos.length}...`);
                }

                try {
                    // Verificar se usuário existe
                    const userCheck = await feedbacksPool.request()
                        .input('cpf', sql.VarChar, func.CPF)
                        .query('SELECT Id FROM Users WHERE CPF = @cpf');

                    if (userCheck.recordset.length > 0) {
                        // Atualizar usuário existente
                        if (func.STATUS_GERAL === 'ATIVO') {
                            await feedbacksPool.request()
                                .input('cpf', sql.VarChar, func.CPF)
                                .input('matricula', sql.VarChar, func.MATRICULA)
                                .input('nome', sql.VarChar, func.NOME)
                                .input('departamento', sql.VarChar, func.DEPARTAMENTO)
                                .input('filial', sql.VarChar, func.FILIAL)
                                .query(`
                                    UPDATE Users 
                                    SET 
                                        Matricula = @matricula,
                                        NomeCompleto = @nome,
                                        Departamento = @departamento,
                                        Filial = @filial,
                                        IsActive = 1,
                                        updated_at = GETDATE()
                                    WHERE CPF = @cpf AND IsActive = 1
                                `);
                            atualizados++;
                        }
                    } else {
                        // Criar novo usuário
                        if (func.STATUS_GERAL === 'ATIVO') {
                            await this.criarUsuario(func);
                            novos++;
                        }
                    }
                } catch (error) {
                    console.error(`   ❌ Erro ao processar ${func.MATRICULA}:`, error.message);
                    erros++;
                }
            }

            // 3️⃣ Inativar usuários que não têm mais registro ATIVO
            console.log('\n🔍 Verificando usuários para inativação...');
            
            const usuariosParaInativarResult = await feedbacksPool.request().query(`
                SELECT u.Id, u.NomeCompleto, u.CPF, u.Matricula
                FROM Users u
                WHERE u.IsActive = 1
                AND NOT EXISTS (
                    SELECT 1 
                    FROM TAB_HIST_SRA s 
                    WHERE s.CPF = u.CPF 
                    AND s.STATUS_GERAL = 'ATIVO'
                )
            `);

            const usuariosParaInativar = usuariosParaInativarResult.recordset;
            let inativados = 0;

            if (usuariosParaInativar.length > 0) {
                console.log(`   ⚠️ Encontrados ${usuariosParaInativar.length} usuários para inativar:`);
                
                for (const usuario of usuariosParaInativar) {
                    console.log(`   📝 Inativando: ${usuario.NomeCompleto} (${usuario.CPF})`);
                }

                // Inativar todos os usuários de uma vez
                const inativacaoResult = await feedbacksPool.request().query(`
                    UPDATE Users 
                    SET IsActive = 0, updated_at = GETDATE()
                    WHERE IsActive = 1
                    AND NOT EXISTS (
                        SELECT 1 
                        FROM TAB_HIST_SRA s 
                        WHERE s.CPF = Users.CPF 
                        AND s.STATUS_GERAL = 'ATIVO'
                    )
                `);

                inativados = inativacaoResult.rowsAffected[0];
                console.log(`   ✅ ${inativados} usuários inativados com sucesso`);
            } else {
                console.log('   ✅ Nenhum usuário precisa ser inativado');
            }

            console.log('\n📈 Resultados da sincronização:');
            console.log(`   ✨ Novos: ${novos}`);
            console.log(`   🔄 Atualizados: ${atualizados}`);
            console.log(`   ⏸️ Inativados: ${inativados}`);
            if (erros > 0) console.log(`   ❌ Erros: ${erros}`);

        } catch (error) {
            console.error('❌ Erro ao sincronizar funcionários:', error);
            throw error;
        }
    }

    /**
     * Busca o funcionário ATIVO mais recente usando mesma lógica do script SQL
     * Prioriza: 1) STATUS_GERAL='ATIVO', 2) SITUACAO_FOLHA vazia, 3) DTA_ADMISSAO DESC, 4) MATRICULA DESC
     */
    async buscarFuncionarioAtivo(cpf) {
        const pool = await this.getExternalPool();
        
        try {
            const result = await pool.request()
                .input('cpf', sql.VarChar, cpf)
                .query(`
                    WITH FuncionarioAtivo AS (
                        SELECT 
                            CPF, MATRICULA, DEPARTAMENTO, FILIAL, CENTRO_CUSTO,
                            NOME, STATUS_GERAL, SITUACAO_FOLHA, DTA_ADMISSAO,
                            ROW_NUMBER() OVER (
                                PARTITION BY CPF 
                                ORDER BY 
                                    CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                                    CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                                    DTA_ADMISSAO DESC,
                                    MATRICULA DESC
                            ) as rn
                        FROM TAB_HIST_SRA
                        WHERE CPF = @cpf
                    )
                    SELECT 
                        CPF, MATRICULA, DEPARTAMENTO, FILIAL, CENTRO_CUSTO,
                        NOME, STATUS_GERAL, SITUACAO_FOLHA, DTA_ADMISSAO
                    FROM FuncionarioAtivo
                    WHERE rn = 1
                `);
            
            return result.recordset[0] || null;
        } catch (error) {
            console.error(`Erro ao buscar funcionário ativo ${cpf}:`, error.message);
            return null;
        }
    }

    /**
     * Processa um funcionário individual
     * MODIFICADO: Agora busca sempre o registro ATIVO mais recente
     */
    async processarFuncionario(func) {
        const pool = await this.getDatabasePool();
        
        try {
            // Buscar o registro ATIVO mais recente do funcionário
            const funcAtivo = await this.buscarFuncionarioAtivo(func.CPF);
            
            // Verificar se usuário já existe
            const userResult = await pool.request()
                .input('cpf', sql.VarChar, func.CPF)
                .query(`SELECT Id, FirstLogin, PasswordHash FROM Users WHERE CPF = @cpf`);

            const userExiste = userResult.recordset.length > 0;
            const user = userExiste ? userResult.recordset[0] : null;
            
            // Se não encontrou funcionário ativo e usuário existe, inativar
            if (!funcAtivo && userExiste) {
                return await this.inativarUsuario(func.CPF);
            }
            
            // Se não encontrou funcionário ativo, ignorar
            if (!funcAtivo) {
                return 'ignorado';
            }

            // Se STATUS_GERAL = 'ATIVO', criar ou atualizar com dados do registro ativo
            if (funcAtivo.STATUS_GERAL === 'ATIVO') {
                if (userExiste) {
                    return await this.atualizarUsuario(funcAtivo, user);
                } else {
                    return await this.criarUsuario(funcAtivo);
                }
            } 
            // Se não está ativo e usuário existe, inativar
            else if (userExiste) {
                return await this.inativarUsuario(funcAtivo.CPF);
            }

            return 'ignorado';

        } catch (error) {
            console.error(`❌ Erro ao processar funcionário ${func.MATRICULA}:`, error.message);
            return 'erro';
        }
    }

    /**
     * Cria novo usuário
     */
    async criarUsuario(func) {
        const pool = await this.getDatabasePool();

        try {
            // Buscar hierarquia
            const hierarchyData = await this.hierarchyManager.getHierarchyInfo(
                func.MATRICULA,
                func.CPF
            );
            const hierarchyPath = hierarchyData.path || '';

            // Buscar DescricaoDepartamento da VIEW
            const descricaoDepartamento = await this.buscarDescricaoDepartamento(func.DEPARTAMENTO);

            // Extrair primeiro nome
            const primeiroNome = func.NOME ? func.NOME.split(' ')[0] : func.MATRICULA;

            await pool.request()
                .input('cpf', sql.VarChar, func.CPF)
                .input('userName', sql.VarChar, func.CPF)  // UserName = CPF
                .input('matricula', sql.VarChar, func.MATRICULA)
                .input('nome', sql.VarChar, primeiroNome)
                .input('nomeCompleto', sql.VarChar, func.NOME)
                .input('departamento', sql.VarChar, func.DEPARTAMENTO)
                .input('filial', sql.VarChar, func.FILIAL)
                .input('descricaoDepartamento', sql.VarChar, descricaoDepartamento)
                .input('hierarchyPath', sql.VarChar, hierarchyPath)
                .input('isAdmin', sql.Bit, 0)
                .input('isActive', sql.Bit, 1)
                .input('firstLogin', sql.Bit, 1)
                .query(`
                    INSERT INTO Users (
                        CPF, UserName, Matricula, nome, NomeCompleto, Departamento, 
                        Filial, DescricaoDepartamento, HierarchyPath,
                        is_admin, IsActive, FirstLogin,
                        PasswordHash, created_at, updated_at
                    ) VALUES (
                        @cpf, @userName, @matricula, @nome, @nomeCompleto, @departamento,
                        @filial, @descricaoDepartamento, @hierarchyPath,
                        @isAdmin, @isActive, @firstLogin,
                        NULL, GETDATE(), GETDATE()
                    )
                `);

            console.log(`   ✨ Novo usuário criado: ${func.NOME} (${func.MATRICULA})`);
            return 'novo';

        } catch (error) {
            console.error(`   ❌ Erro ao criar usuário ${func.MATRICULA}:`, error.message);
            throw error;
        }
    }

    /**
     * Atualiza usuário existente
     */
    async atualizarUsuario(func, user) {
        const pool = await this.getDatabasePool();

        try {
            // Buscar hierarquia
            const hierarchyData = await this.hierarchyManager.getHierarchyInfo(
                func.MATRICULA,
                func.CPF
            );
            const hierarchyPath = hierarchyData.path || '';

            // Buscar DescricaoDepartamento
            const descricaoDepartamento = await this.buscarDescricaoDepartamento(func.DEPARTAMENTO);

            // Extrair primeiro nome
            const primeiroNome = func.NOME ? func.NOME.split(' ')[0] : func.MATRICULA;

            // NÃO atualizar PasswordHash para preservar senhas existentes
            // O PasswordHash só deve ser alterado durante o cadastro/login, não na sincronização
            
            await pool.request()
                .input('cpf', sql.VarChar, func.CPF)
                .input('userName', sql.VarChar, func.CPF)  // UserName = CPF sempre
                .input('matricula', sql.VarChar, func.MATRICULA)
                .input('nome', sql.VarChar, primeiroNome)
                .input('nomeCompleto', sql.VarChar, func.NOME)
                .input('departamento', sql.VarChar, func.DEPARTAMENTO)
                .input('filial', sql.VarChar, func.FILIAL)
                .input('descricaoDepartamento', sql.VarChar, descricaoDepartamento)
                .input('hierarchyPath', sql.VarChar, hierarchyPath)
                .input('isActive', sql.Bit, 1)
                .query(`
                    UPDATE Users 
                    SET UserName = @userName,
                        Matricula = @matricula,
                        nome = @nome,
                        NomeCompleto = @nomeCompleto,
                        Departamento = @departamento,
                        Filial = @filial,
                        DescricaoDepartamento = @descricaoDepartamento,
                        HierarchyPath = @hierarchyPath,
                        IsActive = @isActive,
                        updated_at = GETDATE()
                    WHERE CPF = @cpf
                `);

            return 'atualizado';

        } catch (error) {
            console.error(`   ❌ Erro ao atualizar usuário ${func.MATRICULA}:`, error.message);
            throw error;
        }
    }

    /**
     * Inativa usuário
     */
    async inativarUsuario(cpf) {
        const pool = await this.getDatabasePool();

        try {
            await pool.request()
                .input('cpf', sql.VarChar, cpf)
                .query(`
                    UPDATE Users 
                    SET IsActive = 0,
                        updated_at = GETDATE()
                    WHERE CPF = @cpf
                `);

            return 'inativado';

        } catch (error) {
            console.error(`   ❌ Erro ao inativar usuário ${cpf}:`, error.message);
            throw error;
        }
    }

    /**
     * Busca DescricaoDepartamento da VIEW HIERARQUIA_CC
     * Regra: DEPTO_ATUAL = DEPARTAMENTO → pegar DESCRICAO_ATUAL
     */
    async buscarDescricaoDepartamento(departamento) {
        if (!departamento || departamento.trim() === '') {
            return 'Não definido';
        }

        const pool = await this.getExternalPool();

        try {
            const result = await pool.request()
                .input('departamento', sql.VarChar, departamento)
                .query(`
                    SELECT TOP 1 DESCRICAO_ATUAL
                    FROM HIERARQUIA_CC
                    WHERE TRIM(DEPTO_ATUAL) = TRIM(@departamento)
                    ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
                `);

            if (result.recordset.length > 0) {
                return result.recordset[0].DESCRICAO_ATUAL || departamento;
            }

            return departamento; // Se não encontrar, usa o próprio departamento

        } catch (error) {
            console.error(`   ⚠️ Erro ao buscar descrição do departamento ${departamento}:`, error.message);
            return departamento;
        }
    }

    /**
     * Sincronização manual de um funcionário específico
     */
    async syncFuncionarioEspecifico(cpf) {
        const pool = await this.getDatabasePool();

        try {
            console.log(`🔍 Sincronizando funcionário CPF: ${cpf}`);

            // Buscar registro mais recente desse CPF
            const result = await pool.request()
                .input('cpf', sql.VarChar, cpf)
                .query(`
                    SELECT TOP 1
                        CPF, MATRICULA, NOME, FILIAL, CENTRO_CUSTO,
                        DEPARTAMENTO, SITUACAO_FOLHA, STATUS_GERAL
                    FROM TAB_HIST_SRA
                    WHERE CPF = @cpf
                    ORDER BY DTA_ADMISSAO DESC, MATRICULA DESC
                `);

            if (result.recordset.length === 0) {
                console.log(`   ❌ CPF ${cpf} não encontrado na TAB_HIST_SRA`);
                return false;
            }

            const func = result.recordset[0];
            const resultado = await this.processarFuncionario(func);

            console.log(`   ✅ Funcionário sincronizado: ${resultado}`);
            return true;

        } catch (error) {
            console.error(`❌ Erro ao sincronizar funcionário ${cpf}:`, error);
            return false;
        }
    }
}

module.exports = SincronizadorDadosExternosV2;

