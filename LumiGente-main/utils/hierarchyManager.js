/**
 * Gerenciador de Hierarquia Organizacional
 * Sistema Feedz - Lumicenter
 */

const sql = require('mssql');

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

    /**
     * Função para obter pool de conexão com fallback
     */
    async getDatabasePool() {
        try {
            return await this.connectWithRetry(this.dbConfig);
        } catch (error) {
            console.log('🔄 Tentando configuração alternativa...');
            try {
                // Configuração alternativa para fallback
                const dbConfigFallback = {
                    ...this.dbConfig,
                    options: {
                        ...this.dbConfig.options,
                        requestTimeout: 60000, // 60 segundos para requests
                        connectionTimeout: 60000, // 60 segundos para conexão
                        pool: {
                            max: 5,
                            min: 0,
                            idleTimeoutMillis: 60000
                        }
                    }
                };
                return await this.connectWithRetry(dbConfigFallback);
            } catch (fallbackError) {
                console.error('❌ Ambas as configurações falharam:', fallbackError.message);
                throw fallbackError;
            }
        }
    }

    /**
     * Determina o nível hierárquico baseado na matrícula
     * @param {string} matricula - Matrícula do funcionário
     * @returns {Promise<Object>} - Objeto com nível e caminho hierárquico
     */
    async getHierarchyLevel(matricula) {
        console.log(`=== getHierarchyLevel chamado para matrícula: ${matricula} ===`);
        
        try {
            const pool = await this.getDatabasePool();
            
            // Primeiro, buscar dados do funcionário na TAB_HIST_SRA
            const funcionarioResult = await pool.request()
                .input('matricula', sql.VarChar, matricula)
                .query(`
                    SELECT TOP 1 CENTRO_CUSTO, DEPARTAMENTO, NOME
                    FROM TAB_HIST_SRA 
                    WHERE MATRICULA = @matricula 
                    ORDER BY CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END, MATRICULA DESC
                `);
            
            if (funcionarioResult.recordset.length === 0) {
                console.log(`Nenhum funcionário encontrado para matrícula ${matricula}`);
                return {
                    level: 0,
                    path: '',
                    departamento: 'Não definido'
                };
            }
            
            const funcionario = funcionarioResult.recordset[0];
            console.log(`Dados do funcionário:`, funcionario);
            
            // Buscar hierarquia onde o funcionário é responsável
            const hierarquiaResult = await pool.request()
                .input('matricula', sql.VarChar, matricula)
                .query(`
                    SELECT TOP 1 
                        DEPTO_ATUAL, DESCRICAO_ATUAL, RESPONSAVEL_ATUAL, HIERARQUIA_COMPLETA
                    FROM HIERARQUIA_CC 
                    WHERE RESPONSAVEL_ATUAL = @matricula
                    ORDER BY LEN(HIERARQUIA_COMPLETA) DESC
                `);
            
            console.log(`Hierarquia onde é responsável:`, hierarquiaResult.recordset);
            
            let level = 0;
            let path = '';
            let departamento = funcionario.DEPARTAMENTO || 'Não definido';
            
            if (hierarquiaResult.recordset.length > 0) {
                const hierarquia = hierarquiaResult.recordset[0];
                console.log(`Funcionário é responsável por:`, hierarquia);
                
                // O funcionário é responsável por este departamento
                level = 4; // Gerente/Supervisor
                path = hierarquia.HIERARQUIA_COMPLETA;
                departamento = hierarquia.DESCRICAO_ATUAL;
            } else {
                console.log(`Funcionário não é responsável, buscando onde trabalha...`);
                
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
                
                console.log(`Hierarquia onde trabalha:`, hierarquiaTrabalhoResult.recordset);
                
                if (hierarquiaTrabalhoResult.recordset.length > 0) {
                    const hierarquiaTrabalho = hierarquiaTrabalhoResult.recordset[0];
                    console.log(`Funcionário trabalha em:`, hierarquiaTrabalho);
                    
                    // LÓGICA ESPECIAL: Se trabalha em GERENCIA TI, é gestor
                    if (hierarquiaTrabalho.DESCRICAO_ATUAL && 
                        hierarquiaTrabalho.DESCRICAO_ATUAL.includes('GERENCIA TI')) {
                        level = 4; // Gerente TI
                        console.log(`🎯 Usuário ${matricula} reconhecido como Gerente TI`);
                    } else {
                        level = 0; // Funcionário comum
                    }
                    
                    path = hierarquiaTrabalho.HIERARQUIA_COMPLETA;
                    departamento = hierarquiaTrabalho.DESCRICAO_ATUAL;
                } else {
                    console.log(`Não encontrou hierarquia para departamento: ${funcionario.DEPARTAMENTO}`);
                    
                    // Se não encontrou na hierarquia, usar dados básicos
                    level = 0;
                    path = '';
                    departamento = funcionario.DEPARTAMENTO || 'Não definido';
                }
            }

            console.log(`Resultado final para ${matricula}:`, {
                level,
                path,
                departamento,
                departamentoOriginal: funcionario.DEPARTAMENTO
            });

            return {
                level,
                path,
                departamento
            };
        } catch (error) {
            console.error('Erro ao determinar hierarquia:', error);
            return {
                level: 0,
                path: '',
                departamento: 'Erro'
            };
        }
    }

    /**
     * Verifica se um usuário pode acessar dados de outro usuário
     * @param {Object} currentUser - Usuário atual
     * @param {Object} targetUser - Usuário alvo
     * @returns {boolean} - True se pode acessar
     */
    canAccessUser(currentUser, targetUser) {
        // Administradores podem acessar tudo
        if (currentUser.role === 'Administrador') {
            return true;
        }

        // Verificar hierarquia
        if (currentUser.hierarchyLevel > targetUser.HierarchyLevel) {
            // Superior pode acessar subordinados
            return true;
        } else if (currentUser.hierarchyLevel === targetUser.HierarchyLevel) {
            // Mesmo nível só pode acessar se for do mesmo departamento
            return currentUser.departamento === targetUser.Departamento;
        }

        return false;
    }

    /**
     * Busca subordinados de um usuário
     * @param {string} matricula - Matrícula do usuário
     * @returns {Promise<Array>} - Lista de subordinados
     */
    async getSubordinates(matricula) {
        try {
            const pool = await this.getDatabasePool();
            
            const result = await pool.request()
                .input('matricula', sql.VarChar, matricula)
                .query(`
                    SELECT DISTINCT
                        u.Id, u.NomeCompleto, u.Departamento, u.Cargo, 
                        u.HierarchyLevel, u.Matricula, u.CPF, u.LastLogin
                    FROM Users u
                    JOIN HIERARQUIA_CC h ON u.Matricula = h.RESPONSAVEL_ATUAL
                    WHERE h.RESPONSAVEL_ATUAL = @matricula
                    AND u.IsActive = 1
                    ORDER BY u.HierarchyLevel DESC, u.NomeCompleto
                `);

            return result.recordset;
        } catch (error) {
            console.error('Erro ao buscar subordinados:', error);
            throw error;
        }
    }

    /**
     * Busca superiores de um usuário
     * @param {string} matricula - Matrícula do usuário
     * @returns {Promise<Array>} - Lista de superiores
     */
    async getSuperiors(matricula) {
        try {
            const pool = await this.getDatabasePool();
            
            const result = await pool.request()
                .input('matricula', sql.VarChar, matricula)
                .query(`
                    SELECT DISTINCT
                        u.Id, u.NomeCompleto, u.Departamento, u.Cargo, 
                        u.HierarchyLevel, u.Matricula, u.CPF
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
                    ORDER BY u.HierarchyLevel DESC, u.NomeCompleto
                `);

            return result.recordset;
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
    async getAccessibleUsers(currentUser) {
        console.log(`🔍 Buscando usuários acessíveis para ${currentUser.nomeCompleto} (nível ${currentUser.hierarchyLevel})`);
        console.log(`   Dados do usuário:`, {
            userId: currentUser.userId,
            hierarchyLevel: currentUser.hierarchyLevel,
            hierarchyPath: currentUser.hierarchyPath,
            departamento: currentUser.departamento,
            matricula: currentUser.matricula
        });
        
        try {
            const pool = await this.getDatabasePool();
            
            if (currentUser.hierarchyLevel >= 3) {
                console.log(`Usuário ${currentUser.nomeCompleto} é gestor (nível ${currentUser.hierarchyLevel}), buscando subordinados...`);
                
                // LÓGICA CORRIGIDA: Buscar todos os usuários que estão sob a responsabilidade deste gestor
                const result = await pool.request()
                    .input('userMatricula', sql.VarChar, currentUser.matricula)
                    .query(`
                        SELECT DISTINCT
                            u.Id as userId,
                            u.NomeCompleto as nomeCompleto,
                            u.Departamento as departamento,
                            u.Cargo as cargo,
                            u.HierarchyLevel as hierarchyLevel,
                            u.HierarchyPath as hierarchyPath,
                            u.Matricula,
                            'SUBORDINADO' as TipoRelacao
                        FROM Users u
                        INNER JOIN TAB_HIST_SRA s ON u.Matricula = s.MATRICULA
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
                        SELECT DISTINCT
                            u.Id as userId,
                            u.NomeCompleto as nomeCompleto,
                            u.Departamento as departamento,
                            u.Cargo as cargo,
                            u.HierarchyLevel as hierarchyLevel,
                            u.HierarchyPath as hierarchyPath,
                            u.Matricula,
                            'DEPARTAMENTO_GERENCIADO' as TipoRelacao
                        FROM Users u
                        INNER JOIN TAB_HIST_SRA s ON u.Matricula = s.MATRICULA
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
                            u.Cargo as cargo,
                            u.HierarchyLevel as hierarchyLevel,
                            u.HierarchyPath as hierarchyPath,
                            u.Matricula,
                            'PROPRIO_USUARIO' as TipoRelacao
                        FROM Users u
                        WHERE u.Matricula = @userMatricula
                          AND u.IsActive = 1
                        
                        ORDER BY nomeCompleto
                    `);
                
                console.log(`✅ Encontrados ${result.recordset.length} usuários acessíveis para ${currentUser.nomeCompleto}`);
                
                // Debug: mostrar os usuários encontrados
                if (result.recordset.length > 0) {
                    console.log(`   Usuários encontrados:`);
                    result.recordset.forEach((user, index) => {
                        console.log(`   ${index + 1}. ${user.nomeCompleto} - ${user.departamento} - Tipo: ${user.TipoRelacao}`);
                    });
                }
                
                return result.recordset;
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
                            Cargo as cargo,
                            HierarchyLevel as hierarchyLevel,
                            HierarchyPath as hierarchyPath
                        FROM Users
                        WHERE IsActive = 1
                        AND Id = @currentUserId
                        ORDER BY NomeCompleto
                    `);
                console.log(`✅ Encontrados ${result.recordset.length} usuários acessíveis para ${currentUser.nomeCompleto}`);
                return result.recordset;
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
                    Cargo as cargo,
                    HierarchyLevel as hierarchyLevel,
                    HierarchyPath as hierarchyPath
                FROM Users
                WHERE IsActive = 1
                ORDER BY NomeCompleto
            `;
            
            const result = await pool.request().query(query);
            console.log(`✅ Encontrados ${result.recordset.length} usuários para feedback`);
            
            // Debug: mostrar alguns usuários
            if (result.recordset.length > 0) {
                console.log('   Primeiros usuários:');
                result.recordset.slice(0, 3).forEach(user => {
                    console.log(`   - ${user.nomeCompleto} (${user.departamento})`);
                });
            }
            
            return result.recordset;
            
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
                    HierarchyLevel,
                    COUNT(*) as count,
                    Departamento
                FROM Users 
                WHERE IsActive = 1
                GROUP BY HierarchyLevel, Departamento
                ORDER BY HierarchyLevel DESC
            `);
            
            return result.recordset;
        } catch (error) {
            console.error('Erro ao buscar estatísticas da hierarquia:', error);
            throw error;
        }
    }
}

module.exports = HierarchyManager;
