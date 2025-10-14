/**
 * Gerenciador de Hierarquia Organizacional
 * Sistema Feedz - Lumicenter
 * 
 * REFATORADO: Removido campo HierarchyLevel redundante.
 * Agora usa apenas HierarchyPath com funções auxiliares.
 */

const sql = require('mssql');
const { getHierarchyLevel } = require('./hierarchyHelper');

class HierarchyManager {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
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
                // Configuração alternativa para fallback
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
     * Determina a hierarquia baseada na matrícula e CPF
     * 
     * REFATORADO: Não retorna mais o campo 'level' separado.
     * Use getHierarchyLevel(path) do hierarchyHelper para calcular o nível.
     * 
     * @param {string} matricula - Matrícula do funcionário
     * @param {string} cpf - CPF do funcionário (OBRIGATÓRIO para chave composta)
     * @returns {Promise<Object>} - Objeto com path, departamento e level (calculado)
     * @property {string} path - Caminho hierárquico completo
     * @property {string} departamento - Nome do departamento
     * @property {number} level - Nível calculado automaticamente do path (getter)
     */
    async getHierarchyInfo(matricula, cpf = null) {
        try {
            const pool = await this.getDatabasePool();
            
            // Primeiro, buscar dados do funcionário na TAB_HIST_SRA
            // CORREÇÃO: Busca usando MATRÍCULA + CPF (chave composta)
            const funcionarioQuery = cpf 
                ? `SELECT TOP 1 CENTRO_CUSTO, DEPARTAMENTO, NOME, CPF
                   FROM TAB_HIST_SRA 
                   WHERE MATRICULA = @matricula AND CPF = @cpf
                   ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END, MATRICULA DESC`
                : `SELECT TOP 1 CENTRO_CUSTO, DEPARTAMENTO, NOME, CPF
                   FROM TAB_HIST_SRA 
                   WHERE MATRICULA = @matricula 
                   ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END, MATRICULA DESC`;
            
            const funcionarioRequest = pool.request().input('matricula', sql.VarChar, matricula);
            if (cpf) {
                funcionarioRequest.input('cpf', sql.VarChar, cpf);
            }
            
            const funcionarioResult = await funcionarioRequest.query(funcionarioQuery);
            
            if (funcionarioResult.recordset.length === 0) {
                return {
                    level: 0,
                    path: '',
                    departamento: 'Não definido'
                };
            }
            
            const funcionario = funcionarioResult.recordset[0];
            // Se CPF não foi passado, usar o CPF encontrado no TAB_HIST_SRA
            const cpfParaUsar = cpf || funcionario.CPF;
            
            // Buscar hierarquia onde o funcionário é responsável
            // CORREÇÃO: Validar também o CPF para evitar pegar hierarquia de pessoa diferente com mesma matrícula
            const hierarquiaResult = await pool.request()
                .input('matricula', sql.VarChar, matricula)
                .input('cpf', sql.VarChar, cpfParaUsar)
                .query(`
                    SELECT TOP 1 
                        DEPTO_ATUAL, DESCRICAO_ATUAL, RESPONSAVEL_ATUAL, 
                        CPF_RESPONSAVEL, HIERARQUIA_COMPLETA
                    FROM HIERARQUIA_CC 
                    WHERE RESPONSAVEL_ATUAL = @matricula
                      AND (CPF_RESPONSAVEL = @cpf OR CPF_RESPONSAVEL IS NULL)
                    ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
                `);
            
            let path = '';
            let departamento = funcionario.DEPARTAMENTO || 'Não definido';
            
            if (hierarquiaResult.recordset.length > 0) {
                const hierarquia = hierarquiaResult.recordset[0];
                
                // O funcionário é responsável por este departamento
                path = hierarquia.HIERARQUIA_COMPLETA;
                departamento = hierarquia.DEPTO_ATUAL; // ✅ Usar código, não descrição
            } else {
                // Se não é responsável, buscar onde ele trabalha usando o DEPARTAMENTO (com TRIM)
                const hierarquiaTrabalhoResult = await pool.request()
                    .input('deptoAtual', sql.VarChar, funcionario.DEPARTAMENTO)
                    .query(`
                        SELECT TOP 1 
                            DEPTO_ATUAL, DESCRICAO_ATUAL, RESPONSAVEL_ATUAL, HIERARQUIA_COMPLETA
                        FROM HIERARQUIA_CC 
                        WHERE TRIM(DEPTO_ATUAL) = TRIM(@deptoAtual)
                        ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
                    `);
                
                if (hierarquiaTrabalhoResult.recordset.length > 0) {
                    const hierarquiaTrabalho = hierarquiaTrabalhoResult.recordset[0];
                    
                    path = hierarquiaTrabalho.HIERARQUIA_COMPLETA;
                    departamento = hierarquiaTrabalho.DEPTO_ATUAL; // ✅ Usar código, não descrição
                } else {
                    // Se não encontrou na hierarquia, usar dados básicos
                    path = '';
                    departamento = funcionario.DEPARTAMENTO || 'Não definido';
                }
            }

            // Retornar objeto com propriedade level calculada
            return {
                path,
                departamento,
                // Propriedade calculada: level é derivado do path
                get level() {
                    return getHierarchyLevel(this.path);
                }
            };
        } catch (error) {
            console.error('Erro ao determinar hierarquia:', error);
            return {
                path: '',
                departamento: 'Erro',
                get level() {
                    return 0;
                }
            };
        }
    }
    
    /**
     * COMPATIBILIDADE: Alias para getHierarchyInfo()
     * Mantido para compatibilidade com código legado
     * @deprecated Use getHierarchyInfo() no lugar
     */
    async getHierarchyLevel(matricula, cpf = null) {
        return this.getHierarchyInfo(matricula, cpf);
    }

    /**
     * Verifica se um usuário pode acessar dados de outro usuário
     * 
     * REFATORADO: Usa hierarchyPath ao invés de hierarchyLevel
     * 
     * @param {Object} currentUser - Usuário atual
     * @param {Object} targetUser - Usuário alvo
     * @returns {boolean} - True se pode acessar
     */
    canAccessUser(currentUser, targetUser) {
        // Administradores podem acessar tudo
        if (currentUser.role === 'Administrador') {
            return true;
        }

        // Calcular níveis a partir dos paths
        const currentLevel = getHierarchyLevel(currentUser.hierarchyPath || currentUser.HierarchyPath);
        const targetLevel = getHierarchyLevel(targetUser.hierarchyPath || targetUser.HierarchyPath);

        // Verificar hierarquia
        if (currentLevel > targetLevel) {
            // Superior pode acessar subordinados
            return true;
        } else if (currentLevel === targetLevel) {
            // Mesmo nível só pode acessar se for do mesmo departamento
            return currentUser.departamento === targetUser.Departamento;
        }

        return false;
    }

    /**
     * Busca subordinados de um usuário
     * CORRIGIDO: Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF)
     * @param {string} matricula - Matrícula do usuário
     * @param {string} cpf - CPF do usuário (para validação de chave composta)
     * @returns {Promise<Array>} - Lista de subordinados
     */
    async getSubordinates(matricula, cpf = null) {
        try {
            const pool = await this.getDatabasePool();
            
            // CORREÇÃO: Validar CPF no JOIN para garantir que estamos pegando subordinados da pessoa certa
            // Importante quando há matrículas duplicadas (ex: Dr. CHEN e Nazaré com matrícula 000001)
            const query = cpf 
                ? `SELECT DISTINCT
                    u.Id, u.NomeCompleto, u.Departamento, 
                    u.HierarchyPath, u.Matricula, u.CPF, u.LastLogin
                FROM Users u
                JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL
                    AND u.CPF = h.CPF_RESPONSAVEL
                WHERE h.RESPONSAVEL_ATUAL = @matricula
                    AND h.CPF_RESPONSAVEL = @cpf
                    AND u.IsActive = 1
                ORDER BY u.NomeCompleto`
                : `SELECT DISTINCT
                    u.Id, u.NomeCompleto, u.Departamento, 
                    u.HierarchyPath, u.Matricula, u.CPF, u.LastLogin
                FROM Users u
                JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL
                WHERE h.RESPONSAVEL_ATUAL = @matricula
                    AND u.IsActive = 1
                ORDER BY u.NomeCompleto`;
            
            const request = pool.request().input('matricula', sql.VarChar, matricula);
            if (cpf) {
                request.input('cpf', sql.VarChar, cpf);
            }
            
            const result = await request.query(query);

            // Calcular HierarchyLevel usando a função JavaScript
            const recordsWithLevel = result.recordset.map(record => ({
                ...record,
                HierarchyLevel: getHierarchyLevel(record.HierarchyPath, record.Matricula, record.Departamento)
            }));

            // Ordenar por HierarchyLevel DESC, depois por NomeCompleto
            recordsWithLevel.sort((a, b) => {
                if (b.HierarchyLevel !== a.HierarchyLevel) {
                    return b.HierarchyLevel - a.HierarchyLevel;
                }
                return a.NomeCompleto.localeCompare(b.NomeCompleto);
            });

            return recordsWithLevel;
        } catch (error) {
            console.error('Erro ao buscar subordinados:', error);
            throw error;
        }
    }

    /**
     * Busca superiores de um usuário
     * CORRIGIDO: Agora usa CHAVE COMPOSTA (MATRÍCULA + CPF)
     * @param {string} matricula - Matrícula do usuário
     * @param {string} cpf - CPF do usuário (para validação de chave composta)
     * @returns {Promise<Array>} - Lista de superiores
     */
    async getSuperiors(matricula, cpf = null) {
        try {
            const pool = await this.getDatabasePool();
            
            // CORREÇÃO: Validar CPF nos JOINs para garantir que estamos pegando superiores corretos
            // Quando há matrículas duplicadas, sem CPF poderia retornar superiores da pessoa errada
            const query = cpf
                ? `SELECT DISTINCT
                    u.Id, u.NomeCompleto, u.Departamento, 
                    u.HierarchyPath, u.Matricula, u.CPF
                FROM Users u
                JOIN HIERARQUIA_CC h ON (
                    (u.Matricula = h.NIVEL_1_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL) OR
                    (u.Matricula = h.NIVEL_2_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL) OR
                    (u.Matricula = h.NIVEL_3_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL) OR
                    (u.Matricula = h.NIVEL_4_MATRICULA_RESP AND u.CPF = h.CPF_RESPONSAVEL)
                )
                WHERE h.RESPONSAVEL_ATUAL = @matricula
                    AND h.CPF_RESPONSAVEL = @cpf
                    AND u.IsActive = 1
                    AND u.Matricula != @matricula
                ORDER BY u.NomeCompleto`
                : `SELECT DISTINCT
                    u.Id, u.NomeCompleto, u.Departamento, 
                    u.HierarchyPath, u.Matricula, u.CPF
                FROM Users u
                JOIN HIERARQUIA_CC h ON (
                    u.Matricula = h.NIVEL_1_MATRICULA_RESP OR
                    u.Matricula = h.NIVEL_2_MATRICULA_RESP OR
                    u.Matricula = h.NIVEL_3_MATRICULA_RESP OR
                    u.Matricula = h.NIVEL_4_MATRICULA_RESP
                )
                WHERE h.RESPONSAVEL_ATUAL = @matricula
                    AND u.IsActive = 1
                    AND u.Matricula != @matricula
                ORDER BY u.NomeCompleto`;
            
            const request = pool.request().input('matricula', sql.VarChar, matricula);
            if (cpf) {
                request.input('cpf', sql.VarChar, cpf);
            }
            
            const result = await request.query(query);

            // Calcular HierarchyLevel usando a função JavaScript
            const recordsWithLevel = result.recordset.map(record => ({
                ...record,
                HierarchyLevel: getHierarchyLevel(record.HierarchyPath, record.Matricula, record.Departamento)
            }));

            // Ordenar por HierarchyLevel DESC, depois por NomeCompleto
            recordsWithLevel.sort((a, b) => {
                if (b.HierarchyLevel !== a.HierarchyLevel) {
                    return b.HierarchyLevel - a.HierarchyLevel;
                }
                return a.NomeCompleto.localeCompare(b.NomeCompleto);
            });

            return recordsWithLevel;
        } catch (error) {
            console.error('Erro ao buscar superiores:', error);
            throw error;
        }
    }



    /**
     * Busca usuários acessíveis baseado na hierarquia (COM limitações hierárquicas)
     * @param {Object} currentUser - Usuário atual
     * @param {Object} filters - Filtros opcionais
     * @returns {Promise<Array>} - Lista de usuários acessíveis na hierarquia
     */
    async getAccessibleUsers(currentUser, options = {}) {
        // Calcular nível a partir do path
        const currentLevel = getHierarchyLevel(currentUser.hierarchyPath || currentUser.HierarchyPath);
        
        console.log(`🔍 Buscando usuários acessíveis para ${currentUser.nomeCompleto} (nível ${currentLevel})`);
        console.log(`   Dados do usuário:`, {
            userId: currentUser.userId,
            hierarchyPath: currentUser.hierarchyPath || currentUser.HierarchyPath,
            hierarchyLevel: currentLevel,
            departamento: currentUser.departamento,
            matricula: currentUser.matricula
        });
        console.log(`   Filtros aplicados:`, options);
        
        try {
            const pool = await this.getDatabasePool();
            
            // Verificar se é RH ou T&D
            const departamento = currentUser.departamento ? currentUser.departamento.toUpperCase() : '';
            const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
            const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                         departamento.includes('TREINAMENTO') || 
                         departamento.includes('DESENVOLVIMENTO') ||
                         departamento.includes('T&D');
            
            if (isHR || isTD) {
                console.log(`Usuário ${currentUser.nomeCompleto} é RH/T&D, buscando todos os usuários...`);
                
                // RH e T&D têm acesso a todos os usuários ativos
                let query = `
                    SELECT 
                        Id as userId,
                        NomeCompleto as nomeCompleto,
                        Departamento as departamento,
                        HierarchyPath as hierarchyPath,
                        Matricula,
                        'RH_TD_ACCESS' as TipoRelacao
                    FROM Users
                    WHERE IsActive = 1
                `;
                
                // Aplicar filtro de departamento se especificado
                if (options.department && options.department !== 'Todos') {
                    query += ` AND Departamento = '${options.department}'`;
                }
                
                query += ` ORDER BY NomeCompleto`;
                
                const result = await pool.request().query(query);
                
                // Calcular HierarchyLevel usando a função JavaScript
                const recordsWithLevel = result.recordset.map(record => ({
                    ...record,
                    hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.Matricula, record.departamento)
                }));
                
                console.log(`✅ Encontrados ${recordsWithLevel.length} usuários acessíveis para RH/T&D ${currentUser.nomeCompleto}`);
                
                // Debug: mostrar os usuários encontrados
                if (recordsWithLevel.length > 0) {
                    console.log(`   Usuários encontrados:`);
                    recordsWithLevel.slice(0, 5).forEach((user, index) => {
                        console.log(`   ${index + 1}. ${user.nomeCompleto} - ${user.departamento}`);
                    });
                    if (recordsWithLevel.length > 5) {
                        console.log(`   ... e mais ${recordsWithLevel.length - 5} usuários`);
                    }
                }
                
                return recordsWithLevel;
            }
            
            // Verificar se o usuário é gestor (aparece como responsável na HIERARQUIA_CC)
            const isManagerCheck = await pool.request()
                .input('userMatricula', sql.VarChar, currentUser.matricula)
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
                console.log(`Usuário ${currentUser.nomeCompleto} é gestor (matrícula: ${currentUser.matricula}), buscando subordinados...`);
                
                // LÓGICA CORRIGIDA: Buscar todos os usuários que estão sob a responsabilidade deste gestor
                const result = await pool.request()
                    .input('userMatricula', sql.VarChar, currentUser.matricula)
                    .query(`
                        WITH UsuariosAcessíveis AS (
                            -- Buscar usuários por hierarquia direta
                            -- CORREÇÃO: Adicionado JOIN com CPF para validar chave composta
                            SELECT DISTINCT
                                u.Id as userId,
                                u.NomeCompleto as nomeCompleto,
                                u.Departamento as departamento,
                                u.HierarchyPath as hierarchyPath,
                                u.Matricula,
                                'SUBORDINADO' as TipoRelacao
                            FROM Users u
                            INNER JOIN TAB_HIST_SRA s ON u.Matricula = s.MATRICULA
                                AND u.CPF = s.CPF  -- ✅ Chave composta: MATRÍCULA + CPF
                            INNER JOIN HIERARQUIA_CC h ON (
                                -- Responsável direto
                                h.RESPONSAVEL_ATUAL = @userMatricula
                                -- Ou está em qualquer nível da hierarquia
                                OR h.NIVEL_1_MATRICULA_RESP = @userMatricula
                                OR h.NIVEL_2_MATRICULA_RESP = @userMatricula  
                                OR h.NIVEL_3_MATRICULA_RESP = @userMatricula
                                OR h.NIVEL_4_MATRICULA_RESP = @userMatricula
                            )
                            WHERE u.IsActive = 1
                              AND s.STATUS_GERAL = 'ATIVO'
                              AND (
                                  -- Funcionário trabalha no departamento gerenciado
                                  TRIM(s.DEPARTAMENTO) = TRIM(h.DEPTO_ATUAL)
                                  OR TRIM(s.DEPARTAMENTO) = TRIM(h.DESCRICAO_ATUAL)
                                  -- Ou está diretamente na hierarquia
                                  OR s.MATRICULA = h.RESPONSAVEL_ATUAL
                                  -- Ou departamento contém palavras-chave relacionadas
                                  OR s.DEPARTAMENTO LIKE '%' + TRIM(h.DEPTO_ATUAL) + '%'
                                  OR s.DEPARTAMENTO LIKE '%' + TRIM(h.DESCRICAO_ATUAL) + '%'
                              )
                            
                            UNION
                            
                            -- Buscar usuários por departamentos onde o gestor tem responsabilidade
                            -- CORREÇÃO: Adicionado JOIN com CPF
                            SELECT DISTINCT
                                u.Id as userId,
                                u.NomeCompleto as nomeCompleto,
                                u.Departamento as departamento,
                                u.HierarchyPath as hierarchyPath,
                                u.Matricula,
                                'DEPARTAMENTO_GERENCIADO' as TipoRelacao
                            FROM Users u
                            INNER JOIN TAB_HIST_SRA s ON u.Matricula = s.MATRICULA
                                AND u.CPF = s.CPF  -- ✅ Chave composta: MATRÍCULA + CPF
                            WHERE u.IsActive = 1
                              AND s.STATUS_GERAL = 'ATIVO'
                              AND EXISTS (
                                  SELECT 1 FROM HIERARQUIA_CC h2
                                  WHERE (
                                      h2.RESPONSAVEL_ATUAL = @userMatricula
                                      OR h2.NIVEL_1_MATRICULA_RESP = @userMatricula
                                      OR h2.NIVEL_2_MATRICULA_RESP = @userMatricula
                                      OR h2.NIVEL_3_MATRICULA_RESP = @userMatricula
                                      OR h2.NIVEL_4_MATRICULA_RESP = @userMatricula
                                  )
                                  AND (
                                      TRIM(s.DEPARTAMENTO) = TRIM(h2.DEPTO_ATUAL)
                                      OR TRIM(s.DEPARTAMENTO) = TRIM(h2.DESCRICAO_ATUAL)
                                      OR s.DEPARTAMENTO LIKE '%' + TRIM(h2.DEPTO_ATUAL) + '%'
                                      OR s.DEPARTAMENTO LIKE '%' + TRIM(h2.DESCRICAO_ATUAL) + '%'
                                  )
                              )
                            
                            UNION
                            
                            -- Incluir o próprio usuário
                            SELECT 
                                u.Id as userId,
                                u.NomeCompleto as nomeCompleto,
                                u.Departamento as departamento,
                                u.HierarchyPath as hierarchyPath,
                                u.Matricula,
                                'PROPRIO_USUARIO' as TipoRelacao
                            FROM Users u
                            WHERE u.Matricula = @userMatricula
                              AND u.IsActive = 1
                        )
                        -- Selecionar apenas usuários únicos (remover duplicatas)
                        SELECT DISTINCT
                            userId,
                            nomeCompleto,
                            departamento,
                            hierarchyPath,
                            Matricula,
                            TipoRelacao
                        FROM UsuariosAcessíveis
                        ${options.department ? `WHERE departamento = '${options.department}' OR TipoRelacao = 'PROPRIO_USUARIO'` : ''}
                        ORDER BY nomeCompleto
                    `);
                
                // Calcular HierarchyLevel usando a função JavaScript
                const recordsWithLevel = result.recordset.map(record => ({
                    ...record,
                    hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.userId, record.departamento)
                }));
                
                console.log(`✅ Encontrados ${recordsWithLevel.length} usuários acessíveis para ${currentUser.nomeCompleto}`);
                
                // Debug: mostrar os usuários encontrados
                if (recordsWithLevel.length > 0) {
                    console.log(`   Usuários encontrados:`);
                    recordsWithLevel.forEach((user, index) => {
                        console.log(`   ${index + 1}. ${user.nomeCompleto} - ${user.departamento} - Tipo: ${user.TipoRelacao}`);
                    });
                }
                
                return recordsWithLevel;
            } else {
                // Usuário comum vê apenas a si mesmo
                console.log(`Usuário comum, vendo apenas a si mesmo (ID: ${currentUser.userId})`);
                const result = await pool.request()
                    .input('currentUserId', sql.Int, currentUser.userId)
                    .query(`
                        SELECT
                            Id as userId,
                            NomeCompleto as nomeCompleto,
                            Departamento as departamento,
                            HierarchyPath as hierarchyPath
                        FROM Users
                        WHERE IsActive = 1
                        AND Id = @currentUserId
                        ORDER BY NomeCompleto
                    `);
                
                // Calcular HierarchyLevel usando a função JavaScript
                const recordsWithLevel = result.recordset.map(record => ({
                    ...record,
                    hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.userId, record.departamento)
                }));
                
                console.log(`✅ Encontrados ${recordsWithLevel.length} usuários acessíveis para ${currentUser.nomeCompleto}`);
                return recordsWithLevel;
            }
            
        } catch (error) {
            console.error('❌ Erro ao buscar usuários acessíveis:', error);
            throw error;
        }
    }

    async getUsersForFeedback() {
        console.log('🔍 Buscando usuários para feedback (SEM limitações hierárquicas)');
        
        try {
            const pool = await this.getDatabasePool();
            
            const query = `
                SELECT
                    Id as userId,
                    NomeCompleto as nomeCompleto,
                    Departamento as departamento,
                    DescricaoDepartamento as descricaoDepartamento,
                    HierarchyPath as hierarchyPath
                FROM Users
                WHERE IsActive = 1
                ORDER BY NomeCompleto
            `;
            
            const result = await pool.request().query(query);
            
            // Calcular HierarchyLevel usando a função JavaScript
            const recordsWithLevel = result.recordset.map(record => ({
                ...record,
                hierarchyLevel: getHierarchyLevel(record.hierarchyPath, record.userId, record.departamento)
            }));
            
            console.log(`✅ Encontrados ${recordsWithLevel.length} usuários para feedback`);
            
            // Debug: mostrar alguns usuários
            if (recordsWithLevel.length > 0) {
                console.log('   Primeiros usuários:');
                recordsWithLevel.slice(0, 3).forEach(user => {
                    console.log(`   - ${user.nomeCompleto} (${user.departamento})`);
                });
            }
            
            return recordsWithLevel;
            
        } catch (error) {
            console.error('❌ Erro ao buscar usuários para feedback:', error);
            throw error;
        }
    }

    /**
     * Sincroniza hierarquia de um usuário específico
     * @param {number} userId - ID do usuário
     * @returns {Promise<boolean>} - True se sincronizado com sucesso
     */
    async syncUserHierarchy(userId) {
        try {
            const pool = await this.getDatabasePool();
            
            await pool.request()
                .input('userId', sql.Int, userId)
                .query(`
                    EXEC sp_SyncUserHierarchy @UserId = @userId
                `);
            
            return true;
        } catch (error) {
            console.error('Erro ao sincronizar hierarquia:', error);
            throw error;
        }
    }

    /**
     * Sincroniza hierarquia de todos os usuários
     * @returns {Promise<boolean>} - True se sincronizado com sucesso
     */
    async syncAllHierarchies() {
        try {
            const pool = await this.getDatabasePool();
            
            await pool.request().query(`
                EXEC sp_SyncUserHierarchy
            `);
            
            return true;
        } catch (error) {
            console.error('Erro ao sincronizar todas as hierarquias:', error);
            throw error;
        }
    }

    /**
     * Obtém estatísticas da hierarquia
     * @returns {Promise<Object>} - Estatísticas da hierarquia
     */
    async getHierarchyStats() {
        try {
            const pool = await this.getDatabasePool();
            
            const result = await pool.request().query(`
                SELECT 
                    COUNT(*) as count,
                    Departamento
                FROM Users 
                WHERE IsActive = 1
                GROUP BY Departamento
                ORDER BY COUNT(*) DESC
            `);
            
            return result.recordset;
        } catch (error) {
            console.error('Erro ao buscar estatísticas da hierarquia:', error);
            throw error;
        }
    }
}

module.exports = HierarchyManager;
