/**
 * ================================================================
 * GERENCIADOR DE AVALIAÇÕES AUTOMÁTICAS
 * ================================================================
 * Responsável por:
 * - Verificar automaticamente funcionários que precisam de avaliação
 * - Criar avaliações de 45 e 90 dias
 * - Gerenciar questionários padrão
 * - Processar respostas de avaliações
 * ================================================================
 */

const sql = require('mssql');
const { getHierarchyLevel } = require('../utils/hierarchyHelper');

/**
 * Verifica todos os funcionários e cria avaliações quando necessário
 * @param {Object} pool - Pool de conexão do SQL Server
 * @returns {Object} Resultado da verificação
 */
async function verificarECriarAvaliacoes(pool) {
    try {
        console.log('🔍 Iniciando verificação automática de avaliações...');
        
        // Buscar todos os funcionários ativos com data de admissão nos últimos 90 dias
        const funcionariosResult = await pool.request().query(`
            SELECT DISTINCT
                h.CPF,
                h.MATRICULA,
                h.NOME,
                h.DTA_ADMISSAO,
                h.DEPARTAMENTO,
                h.CENTRO_CUSTO,
                h.FILIAL,
                DATEDIFF(DAY, h.DTA_ADMISSAO, GETDATE()) as DiasDesdeAdmissao,
                u.Id as UserId
            FROM TAB_HIST_SRA h
            LEFT JOIN Users u ON REPLACE(REPLACE(REPLACE(h.CPF, '.', ''), '-', ''), '/', '') = REPLACE(REPLACE(REPLACE(u.CPF, '.', ''), '-', ''), '/', '')
            WHERE h.STATUS_GERAL = 'ATIVO'
                AND h.DTA_ADMISSAO IS NOT NULL
                AND DATEDIFF(DAY, h.DTA_ADMISSAO, GETDATE()) BETWEEN 0 AND 90
                AND u.Id IS NOT NULL  -- Apenas funcionários que já têm cadastro no sistema
            ORDER BY h.DTA_ADMISSAO DESC
        `);
        
        const funcionarios = funcionariosResult.recordset;
        let avaliacoesGeradas = 0;
        let erros = [];
        
        console.log(`📊 Encontrados ${funcionarios.length} funcionários elegíveis para avaliação`);
        
        for (const func of funcionarios) {
            // Usar try-catch individual para cada funcionário
            let funcionarioTransaction = new sql.Transaction(pool);
            
            try {
                await funcionarioTransaction.begin();
                
                const diasDesdeAdmissao = func.DiasDesdeAdmissao;
                
                // Determinar tipo de avaliação necessária
                let tipoAvaliacaoId = null;
                let tipoNome = '';
                
                if (diasDesdeAdmissao <= 45) {
                    tipoAvaliacaoId = 1; // 45 dias
                    tipoNome = '45 dias';
                } else if (diasDesdeAdmissao > 45 && diasDesdeAdmissao <= 90) {
                    tipoAvaliacaoId = 2; // 90 dias
                    tipoNome = '90 dias';
                }
                
                if (!tipoAvaliacaoId) {
                    await funcionarioTransaction.rollback();
                    continue;
                }
                
                // Verificar se já existe avaliação deste tipo para este funcionário
                const avaliacaoExistenteResult = await funcionarioTransaction.request()
                    .input('userId', sql.Int, func.UserId)
                    .input('tipoAvaliacaoId', sql.Int, tipoAvaliacaoId)
                    .input('matricula', sql.VarChar, func.MATRICULA)
                    .query(`
                        SELECT Id FROM Avaliacoes
                        WHERE UserId = @userId
                            AND TipoAvaliacaoId = @tipoAvaliacaoId
                            AND Matricula = @matricula
                    `);
                
                if (avaliacaoExistenteResult.recordset.length > 0) {
                    console.log(`ℹ️ Avaliação ${tipoNome} já existe para ${func.NOME} (${func.MATRICULA})`);
                    await funcionarioTransaction.rollback();
                    continue;
                }
                
                // Buscar o gestor do usuário
                // Lógica: Pega o penúltimo código do HierarchyPath e busca quem tem esse código como Cargo com HierarchyLevel superior
                let gestorId = null;
                try {
                    // Primeiro buscar o HierarchyPath do usuário
                    const userHierarchyResult = await funcionarioTransaction.request()
                        .input('userId', sql.Int, func.UserId)
                        .query(`
                            SELECT HierarchyPath, Matricula, Departamento
                            FROM Users
                            WHERE Id = @userId
                        `);
                    
                    if (userHierarchyResult.recordset.length > 0) {
                        const userHierarchy = userHierarchyResult.recordset[0];
                        const hierarchyPath = userHierarchy.HierarchyPath || '';
                        // Calcular HierarchyLevel dinamicamente
                        const userLevel = getHierarchyLevel(hierarchyPath, userHierarchy.Matricula, userHierarchy.Departamento);
                        
                        // Dividir o HierarchyPath por " > "
                        const pathParts = hierarchyPath.split(' > ').map(p => p.trim()).filter(p => p);
                        
                        if (pathParts.length > 1) {
                            // Pegar o penúltimo código (departamento do gestor)
                            const gestorDepartamentoCodigo = pathParts[pathParts.length - 2];
                            
                            // Buscar o gestor responsável por esse departamento na HIERARQUIA_CC
                            const gestorResult = await funcionarioTransaction.request()
                                .input('deptoCodigo', sql.VarChar, gestorDepartamentoCodigo)
                                .query(`
                                    SELECT TOP 1 
                                        u.Id as GestorId, 
                                        u.NomeCompleto, 
                                        u.HierarchyPath, 
                                        u.Matricula, 
                                        u.Departamento
                                    FROM HIERARQUIA_CC h
                                    INNER JOIN Users u ON h.RESPONSAVEL_ATUAL = u.Matricula
                                        AND h.CPF_RESPONSAVEL = u.CPF
                                    WHERE TRIM(h.DEPTO_ATUAL) = TRIM(@deptoCodigo)
                                        AND u.IsActive = 1
                                    ORDER BY LEN(u.HierarchyPath) DESC
                                `);
                            
                            if (gestorResult.recordset.length > 0) {
                                const gestor = gestorResult.recordset[0];
                                gestorId = gestor.GestorId;
                                const gestorLevel = getHierarchyLevel(gestor.HierarchyPath, gestor.Matricula, gestor.Departamento);
                                console.log(`   ✓ Gestor identificado: ${gestor.NomeCompleto} (ID: ${gestorId}, Level: ${gestorLevel})`);
                            } else {
                                console.log(`   ⚠️ Gestor não encontrado para cargo ${gestorDepartamento}`);
                            }
                        } else {
                            console.log(`   ⚠️ HierarchyPath muito curto: ${hierarchyPath}`);
                        }
                    }
                } catch (gestorError) {
                    console.log(`   ⚠️ Erro ao buscar gestor: ${gestorError.message}`);
                }
                
                // Calcular data limite baseada na data de admissão + dias do tipo + 10 dias
                const dataAdmissao = new Date(func.DTA_ADMISSAO);
                const dataLimite = new Date(dataAdmissao);
                
                // Determinar status inicial baseado nos dias desde admissão
                let statusInicial;
                const diasPeriodo = tipoAvaliacaoId === 1 ? 45 : 90;
                
                if (diasDesdeAdmissao < diasPeriodo) {
                    // Ainda não chegou no período de resposta
                    statusInicial = 'Agendada';
                } else {
                    // Já está no período de resposta
                    statusInicial = 'Pendente';
                }
                
                if (tipoAvaliacaoId === 1) {
                    // Avaliação de 45 dias: admissão + 45 + 10 = 55 dias
                    dataLimite.setDate(dataAdmissao.getDate() + 55);
                } else {
                    // Avaliação de 90 dias: admissão + 90 + 10 = 100 dias
                    dataLimite.setDate(dataAdmissao.getDate() + 100);
                }
                
                // Criar avaliação
                const criarAvaliacaoResult = await funcionarioTransaction.request()
                    .input('userId', sql.Int, func.UserId)
                    .input('tipoAvaliacaoId', sql.Int, tipoAvaliacaoId)
                    .input('matricula', sql.VarChar, func.MATRICULA)
                    .input('dataAdmissao', sql.Date, func.DTA_ADMISSAO)
                    .input('dataLimite', sql.DateTime, dataLimite)
                    .input('gestorId', sql.Int, gestorId)
                    .input('statusInicial', sql.VarChar, statusInicial)
                    .query(`
                        INSERT INTO Avaliacoes (
                            UserId, TipoAvaliacaoId, Matricula, DataAdmissao,
                            DataLimiteResposta, StatusAvaliacao, GestorId
                        ) 
                        OUTPUT INSERTED.Id
                        VALUES (
                            @userId, @tipoAvaliacaoId, @matricula, @dataAdmissao,
                            @dataLimite, @statusInicial, @gestorId
                        )
                    `);
                
                const avaliacaoId = criarAvaliacaoResult.recordset[0].Id;
                
                // Criar snapshot das perguntas do template
                await criarSnapshotPerguntas(funcionarioTransaction, avaliacaoId, tipoAvaliacaoId);
                
                // Commit da transação individual
                await funcionarioTransaction.commit();
                
                avaliacoesGeradas++;
                console.log(`✅ Avaliação ${tipoNome} criada para ${func.NOME} (${func.MATRICULA}) - ${diasDesdeAdmissao} dias desde admissão${gestorId ? ' - Gestor: ' + gestorId : ' - Sem gestor'}`);
                
            } catch (error) {
                // Rollback da transação individual se houver erro
                try {
                    await funcionarioTransaction.rollback();
                } catch (rollbackError) {
                    // Ignorar erro de rollback
                }
                
                const erro = `Erro ao processar ${func.NOME} (${func.MATRICULA}): ${error.message}`;
                erros.push(erro);
                console.error(`❌ ${erro}`);
            }
        }
        
        // Registrar log da verificação
        await pool.request()
            .input('funcionariosVerificados', sql.Int, funcionarios.length)
            .input('avaliacoesGeradas', sql.Int, avaliacoesGeradas)
            .input('erros', sql.VarChar, erros.length > 0 ? JSON.stringify(erros) : null)
            .input('sucesso', sql.Bit, erros.length === 0 ? 1 : 0)
            .query(`
                INSERT INTO LogVerificacoesAvaliacoes (
                    FuncionariosVerificados, AvaliacoesGeradas, Erros, Sucesso
                ) VALUES (
                    @funcionariosVerificados, @avaliacoesGeradas, @erros, @sucesso
                )
            `);
        
        console.log('✅ Verificação de avaliações concluída com sucesso');
        console.log(`📊 Resumo: ${funcionarios.length} funcionários verificados, ${avaliacoesGeradas} avaliações geradas`);
        
        return {
            sucesso: true,
            funcionariosVerificados: funcionarios.length,
            avaliacoesGeradas,
            erros
        };
        
    } catch (error) {
        console.error('❌ Erro ao verificar avaliações:', error);
        throw error;
    }
}

/**
 * Buscar avaliações de um usuário
 * @param {Object} pool - Pool de conexão
 * @param {number} userId - ID do usuário
 * @param {boolean} incluirEquipe - Se true, inclui avaliações da equipe (para gestores)
 * @returns {Array} Lista de avaliações
 */
async function buscarAvaliacoesUsuario(pool, userId, incluirEquipe = false) {
    try {
        let query = `
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
                a.Observacoes,
                t.Nome as TipoAvaliacao,
                t.DiasMinimos,
                t.DiasMaximos,
                u.NomeCompleto,
                u.Departamento,
                g.NomeCompleto as NomeGestor,
                CASE 
                    WHEN a.UserId = @userId THEN 'Própria'
                    WHEN a.GestorId = @userId THEN 'Equipe'
                    ELSE 'Equipe'
                END as OrigemAvaliacao
            FROM Avaliacoes a
            INNER JOIN TiposAvaliacao t ON a.TipoAvaliacaoId = t.Id
            INNER JOIN Users u ON a.UserId = u.Id
            LEFT JOIN Users g ON a.GestorId = g.Id
            WHERE (a.UserId = @userId OR a.GestorId = @userId)
        `;
        
        query += ` ORDER BY a.DataCriacao DESC`;
        
        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(query);
        
        return result.recordset;
        
    } catch (error) {
        console.error('Erro ao buscar avaliações do usuário:', error);
        throw error;
    }
}

/**
 * Buscar questionário padrão
 * @param {Object} pool - Pool de conexão
 * @param {string} tipo - '45' ou '90'
 * @returns {Array} Perguntas do questionário
 */
async function buscarQuestionarioPadrao(pool, tipo) {
    try {
        const tabela = tipo === '45' ? 'QuestionarioPadrao45' : 'QuestionarioPadrao90';
        const tabelaOpcoes = tipo === '45' ? 'OpcoesQuestionario45' : 'OpcoesQuestionario90';
        
        // Buscar perguntas
        const perguntasResult = await pool.request().query(`
            SELECT 
                Id,
                Ordem,
                TipoPergunta,
                Pergunta,
                Obrigatoria,
                Ativo,
                EscalaMinima,
                EscalaMaxima,
                EscalaLabelMinima,
                EscalaLabelMaxima
            FROM ${tabela}
            WHERE Ativo = 1
            ORDER BY Ordem
        `);
        
        const perguntas = perguntasResult.recordset;
        
        // Para cada pergunta de múltipla escolha, buscar as opções
        for (const pergunta of perguntas) {
            if (pergunta.TipoPergunta === 'multipla_escolha') {
                const opcoesResult = await pool.request()
                    .input('perguntaId', sql.Int, pergunta.Id)
                    .query(`
                        SELECT 
                            Id,
                            TextoOpcao,
                            Ordem
                        FROM ${tabelaOpcoes}
                        WHERE PerguntaId = @perguntaId
                        ORDER BY Ordem
                    `);
                
                pergunta.Opcoes = opcoesResult.recordset;
            }
        }
        
        return perguntas;
        
    } catch (error) {
        console.error('Erro ao buscar questionário padrão:', error);
        throw error;
    }
}

/**
 * Salvar resposta de avaliação
 * @param {Object} pool - Pool de conexão
 * @param {Object} dados - Dados da resposta
 * @returns {Object} Resultado da operação
 */
async function salvarRespostaAvaliacao(pool, dados) {
    const transaction = new sql.Transaction(pool);
    
    try {
        await transaction.begin();
        
        const { 
            avaliacaoId, 
            perguntaId, 
            perguntaAvaliacaoId,
            tipoQuestionario, 
            pergunta, 
            tipoPergunta, 
            resposta, 
            respondidoPor, 
            tipoRespondente, 
            opcaoSelecionadaId,
            opcoes
        } = dados;
        
        // Converter opções para JSON se existirem
        const opcoesJSON = opcoes ? JSON.stringify(opcoes) : null;
        
        // Salvar resposta com contexto completo
        await transaction.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('perguntaId', sql.Int, perguntaId)
            .input('perguntaAvaliacaoId', sql.Int, perguntaAvaliacaoId)
            .input('tipoQuestionario', sql.VarChar, tipoQuestionario)
            .input('pergunta', sql.VarChar, pergunta)
            .input('tipoPergunta', sql.VarChar, tipoPergunta)
            .input('resposta', sql.VarChar, typeof resposta === 'object' ? JSON.stringify(resposta) : resposta)
            .input('respondidoPor', sql.Int, respondidoPor)
            .input('tipoRespondente', sql.VarChar, tipoRespondente)
            .input('opcaoSelecionadaId', sql.Int, opcaoSelecionadaId || null)
            .input('textoPergunta', sql.NVarChar, pergunta)
            .input('tipoPerguntaResposta', sql.VarChar, tipoPergunta)
            .input('opcoesJSON', sql.NVarChar, opcoesJSON)
            .query(`
                INSERT INTO RespostasAvaliacoes (
                    AvaliacaoId, PerguntaId, PerguntaAvaliacaoId, TipoQuestionario, Pergunta, TipoPergunta,
                    Resposta, RespondidoPor, TipoRespondente, OpcaoSelecionadaId,
                    TextoPergunta, TipoPerguntaResposta, OpcoesJSON
                ) VALUES (
                    @avaliacaoId, @perguntaId, @perguntaAvaliacaoId, @tipoQuestionario, @pergunta, @tipoPergunta,
                    @resposta, @respondidoPor, @tipoRespondente, @opcaoSelecionadaId,
                    @textoPergunta, @tipoPerguntaResposta, @opcoesJSON
                )
            `);
        
        await transaction.commit();
        
        return { sucesso: true, message: 'Resposta salva com sucesso' };
        
    } catch (error) {
        await transaction.rollback();
        console.error('Erro ao salvar resposta de avaliação:', error);
        throw error;
    }
}

/**
 * Concluir avaliação (marcar como concluída)
 * @param {Object} pool - Pool de conexão
 * @param {number} avaliacaoId - ID da avaliação
 * @param {string} tipoRespondente - 'Colaborador' ou 'Gestor'
 * @returns {Object} Resultado da operação
 */
async function concluirAvaliacao(pool, avaliacaoId, tipoRespondente) {
    try {
        const campoData = tipoRespondente === 'Colaborador' ? 'DataRespostaColaborador' : 'DataRespostaGestor';
        const campoConcluida = tipoRespondente === 'Colaborador' ? 'RespostaColaboradorConcluida' : 'RespostaGestorConcluida';
        
        // Atualizar status
        await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .query(`
                UPDATE Avaliacoes
                SET ${campoConcluida} = 1,
                    ${campoData} = GETDATE(),
                    StatusAvaliacao = CASE 
                        WHEN RespostaColaboradorConcluida = 1 AND RespostaGestorConcluida = 1 THEN 'Concluida'
                        ELSE 'EmAndamento'
                    END,
                    AtualizadoEm = GETDATE()
                WHERE Id = @avaliacaoId
            `);
        
        return { sucesso: true, message: 'Avaliação concluída com sucesso' };
        
    } catch (error) {
        console.error('Erro ao concluir avaliação:', error);
        throw error;
    }
}

/**
 * Atualizar questionário padrão
 * @param {Object} pool - Pool de conexão
 * @param {string} tipo - '45' ou '90'
 * @param {Array} perguntas - Lista de perguntas a atualizar/adicionar
 * @returns {Object} Resultado da operação
 */
async function atualizarQuestionarioPadrao(pool, tipo, perguntas) {
    const transaction = new sql.Transaction(pool);
    
    try {
        console.log(`🔄 Iniciando atualização do questionário tipo ${tipo}...`);
        console.log(`📝 Total de perguntas a processar: ${perguntas.length}`);
        
        await transaction.begin();
        
        const tabela = tipo === '45' ? 'QuestionarioPadrao45' : 'QuestionarioPadrao90';
        const tabelaOpcoes = tipo === '45' ? 'OpcoesQuestionario45' : 'OpcoesQuestionario90';
        
        console.log(`📊 Tabelas: ${tabela} e ${tabelaOpcoes}`);
        
        // Buscar perguntas existentes no banco
        const perguntasExistentesResult = await transaction.request().query(`
            SELECT Id FROM ${tabela}
        `);
        const idsExistentes = perguntasExistentesResult.recordset.map(p => p.Id);
        const idsRecebidos = perguntas.filter(p => p.Id).map(p => p.Id);
        
        // Identificar perguntas que foram removidas (existem no banco mas não vieram na requisição)
        const idsParaDeletar = idsExistentes.filter(id => !idsRecebidos.includes(id));
        
        if (idsParaDeletar.length > 0) {
            console.log(`🗑️ Deletando ${idsParaDeletar.length} perguntas removidas:`, idsParaDeletar);
            
            for (const id of idsParaDeletar) {
                // As opções serão deletadas automaticamente por causa do ON DELETE CASCADE
                await transaction.request()
                    .input('id', sql.Int, id)
                    .query(`DELETE FROM ${tabela} WHERE Id = @id`);
                
                console.log(`   ✓ Pergunta ${id} deletada`);
            }
        }
        
        for (const pergunta of perguntas) {
            console.log(`  ➡️ Processando pergunta: ${pergunta.Pergunta.substring(0, 50)}...`);
            
            // Validar campos de escala
            if (pergunta.TipoPergunta === 'escala') {
                const escMin = pergunta.EscalaMinima || 1;
                const escMax = pergunta.EscalaMaxima || 5;
                
                if (escMin < 1 || escMin > 10) {
                    throw new Error(`Valor mínimo inválido (${escMin}). Deve ser entre 1 e 10.`);
                }
                
                if (escMax < 1 || escMax > 10) {
                    throw new Error(`Valor máximo inválido (${escMax}). Deve ser entre 1 e 10.`);
                }
                
                if (escMin >= escMax) {
                    throw new Error(`Valor mínimo (${escMin}) deve ser menor que o máximo (${escMax}).`);
                }
            }
            
            if (pergunta.Id) {
                // Atualizar pergunta existente
                const request = transaction.request()
                    .input('id', sql.Int, pergunta.Id)
                    .input('ordem', sql.Int, pergunta.Ordem)
                    .input('tipoPergunta', sql.VarChar, pergunta.TipoPergunta)
                    .input('pergunta', sql.VarChar, pergunta.Pergunta)
                    .input('obrigatoria', sql.Bit, pergunta.Obrigatoria);
                
                // Adicionar campos de escala se for tipo escala
                if (pergunta.TipoPergunta === 'escala') {
                    request
                        .input('escalaMinima', sql.Int, pergunta.EscalaMinima || 1)
                        .input('escalaMaxima', sql.Int, pergunta.EscalaMaxima || 5)
                        .input('escalaLabelMinima', sql.VarChar, pergunta.EscalaLabelMinima || null)
                        .input('escalaLabelMaxima', sql.VarChar, pergunta.EscalaLabelMaxima || null);
                    
                    await request.query(`
                        UPDATE ${tabela}
                        SET Ordem = @ordem,
                            TipoPergunta = @tipoPergunta,
                            Pergunta = @pergunta,
                            Obrigatoria = @obrigatoria,
                            EscalaMinima = @escalaMinima,
                            EscalaMaxima = @escalaMaxima,
                            EscalaLabelMinima = @escalaLabelMinima,
                            EscalaLabelMaxima = @escalaLabelMaxima,
                            AtualizadoEm = GETDATE()
                        WHERE Id = @id
                    `);
                } else {
                    await request.query(`
                        UPDATE ${tabela}
                        SET Ordem = @ordem,
                            TipoPergunta = @tipoPergunta,
                            Pergunta = @pergunta,
                            Obrigatoria = @obrigatoria,
                            EscalaMinima = NULL,
                            EscalaMaxima = NULL,
                            EscalaLabelMinima = NULL,
                            EscalaLabelMaxima = NULL,
                            AtualizadoEm = GETDATE()
                        WHERE Id = @id
                    `);
                }
                
                // Se for múltipla escolha, atualizar opções
                if (pergunta.TipoPergunta === 'multipla_escolha' && pergunta.Opcoes) {
                    // Remover opções antigas
                    await transaction.request()
                        .input('perguntaId', sql.Int, pergunta.Id)
                        .query(`DELETE FROM ${tabelaOpcoes} WHERE PerguntaId = @perguntaId`);
                    
                    // Adicionar novas opções
                    for (const opcao of pergunta.Opcoes) {
                        await transaction.request()
                            .input('perguntaId', sql.Int, pergunta.Id)
                            .input('textoOpcao', sql.VarChar, opcao.TextoOpcao)
                            .input('ordem', sql.Int, opcao.Ordem)
                            .query(`
                                INSERT INTO ${tabelaOpcoes} (PerguntaId, TextoOpcao, Ordem)
                                VALUES (@perguntaId, @textoOpcao, @ordem)
                            `);
                    }
                }
            } else {
                // Inserir nova pergunta
                const request = transaction.request()
                    .input('ordem', sql.Int, pergunta.Ordem)
                    .input('tipoPergunta', sql.VarChar, pergunta.TipoPergunta)
                    .input('pergunta', sql.VarChar, pergunta.Pergunta)
                    .input('obrigatoria', sql.Bit, pergunta.Obrigatoria);
                
                let result;
                
                if (pergunta.TipoPergunta === 'escala') {
                    request
                        .input('escalaMinima', sql.Int, pergunta.EscalaMinima || 1)
                        .input('escalaMaxima', sql.Int, pergunta.EscalaMaxima || 5)
                        .input('escalaLabelMinima', sql.VarChar, pergunta.EscalaLabelMinima || null)
                        .input('escalaLabelMaxima', sql.VarChar, pergunta.EscalaLabelMaxima || null);
                    
                    result = await request.query(`
                        INSERT INTO ${tabela} (
                            Ordem, TipoPergunta, Pergunta, Obrigatoria,
                            EscalaMinima, EscalaMaxima, EscalaLabelMinima, EscalaLabelMaxima
                        )
                        OUTPUT INSERTED.Id
                        VALUES (
                            @ordem, @tipoPergunta, @pergunta, @obrigatoria,
                            @escalaMinima, @escalaMaxima, @escalaLabelMinima, @escalaLabelMaxima
                        )
                    `);
                } else {
                    result = await request.query(`
                        INSERT INTO ${tabela} (Ordem, TipoPergunta, Pergunta, Obrigatoria)
                        OUTPUT INSERTED.Id
                        VALUES (@ordem, @tipoPergunta, @pergunta, @obrigatoria)
                    `);
                }
                
                const novaPerguntaId = result.recordset[0].Id;
                
                // Se for múltipla escolha, adicionar opções
                if (pergunta.TipoPergunta === 'multipla_escolha' && pergunta.Opcoes) {
                    for (const opcao of pergunta.Opcoes) {
                        await transaction.request()
                            .input('perguntaId', sql.Int, novaPerguntaId)
                            .input('textoOpcao', sql.VarChar, opcao.TextoOpcao)
                            .input('ordem', sql.Int, opcao.Ordem)
                            .query(`
                                INSERT INTO ${tabelaOpcoes} (PerguntaId, TextoOpcao, Ordem)
                                VALUES (@perguntaId, @textoOpcao, @ordem)
                            `);
                    }
                }
            }
        }
        
        console.log('✅ Todas as perguntas processadas, fazendo commit...');
        await transaction.commit();
        console.log('✅ Commit realizado com sucesso!');
        
        return { sucesso: true, message: 'Questionário atualizado com sucesso' };
        
    } catch (error) {
        console.error('❌ Erro ao atualizar questionário padrão:', error);
        await transaction.rollback();
        console.log('🔙 Rollback realizado');
        throw error;
    }
}

/**
 * Cria snapshot (cópia) das perguntas do template para uma avaliação específica
 * Garante que edições futuras no template não afetem avaliações já criadas
 * @param {Object} transaction - Transação SQL ativa
 * @param {Number} avaliacaoId - ID da avaliação
 * @param {Number} tipoAvaliacaoId - Tipo de avaliação (1=45 dias, 2=90 dias)
 */
async function criarSnapshotPerguntas(transaction, avaliacaoId, tipoAvaliacaoId) {
    const tabelaTemplate = tipoAvaliacaoId === 1 ? 'QuestionarioPadrao45' : 'QuestionarioPadrao90';
    const tabelaOpcoes = tipoAvaliacaoId === 1 ? 'OpcoesQuestionario45' : 'OpcoesQuestionario90';
    
    console.log(`📸 Criando snapshot de perguntas para avaliação ${avaliacaoId} do template ${tabelaTemplate}...`);
    
    // Buscar perguntas do template
    const perguntasResult = await transaction.request().query(`
        SELECT Id, Ordem, Pergunta, TipoPergunta, Obrigatoria,
               EscalaMinima, EscalaMaxima, EscalaLabelMinima, EscalaLabelMaxima
        FROM ${tabelaTemplate}
        ORDER BY Ordem
    `);
    
    // Copiar cada pergunta para PerguntasAvaliacao
    for (const pergunta of perguntasResult.recordset) {
        const perguntaAvaliacaoResult = await transaction.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('ordem', sql.Int, pergunta.Ordem)
            .input('pergunta', sql.NVarChar, pergunta.Pergunta)
            .input('tipoPergunta', sql.VarChar, pergunta.TipoPergunta)
            .input('obrigatoria', sql.Bit, pergunta.Obrigatoria)
            .input('escalaMinima', sql.Int, pergunta.EscalaMinima)
            .input('escalaMaxima', sql.Int, pergunta.EscalaMaxima)
            .input('escalaLabelMinima', sql.NVarChar, pergunta.EscalaLabelMinima)
            .input('escalaLabelMaxima', sql.NVarChar, pergunta.EscalaLabelMaxima)
            .query(`
                INSERT INTO PerguntasAvaliacao (
                    AvaliacaoId, Ordem, Pergunta, TipoPergunta, Obrigatoria,
                    EscalaMinima, EscalaMaxima, EscalaLabelMinima, EscalaLabelMaxima
                )
                OUTPUT INSERTED.Id
                VALUES (
                    @avaliacaoId, @ordem, @pergunta, @tipoPergunta, @obrigatoria,
                    @escalaMinima, @escalaMaxima, @escalaLabelMinima, @escalaLabelMaxima
                )
            `);
        
        const perguntaAvaliacaoId = perguntaAvaliacaoResult.recordset[0].Id;
        
        // Se for múltipla escolha, copiar opções
        if (pergunta.TipoPergunta === 'multipla_escolha') {
            const opcoesResult = await transaction.request()
                .input('perguntaId', sql.Int, pergunta.Id)
                .query(`
                    SELECT TextoOpcao, Ordem
                    FROM ${tabelaOpcoes}
                    WHERE PerguntaId = @perguntaId
                    ORDER BY Ordem
                `);
            
            for (const opcao of opcoesResult.recordset) {
                await transaction.request()
                    .input('perguntaAvaliacaoId', sql.Int, perguntaAvaliacaoId)
                    .input('textoOpcao', sql.NVarChar, opcao.TextoOpcao)
                    .input('ordem', sql.Int, opcao.Ordem)
                    .query(`
                        INSERT INTO OpcoesPerguntasAvaliacao (PerguntaAvaliacaoId, TextoOpcao, Ordem)
                        VALUES (@perguntaAvaliacaoId, @textoOpcao, @ordem)
                    `);
            }
        }
    }
    
    console.log(`✅ Snapshot de ${perguntasResult.recordset.length} perguntas criado para avaliação ${avaliacaoId}`);
}

/**
 * Busca perguntas específicas de uma avaliação (snapshot)
 * @param {Object} pool - Pool de conexão
 * @param {Number} avaliacaoId - ID da avaliação
 * @returns {Array} Lista de perguntas com opções
 */
async function buscarPerguntasAvaliacao(pool, avaliacaoId) {
    const perguntasResult = await pool.request()
        .input('avaliacaoId', sql.Int, avaliacaoId)
        .query(`
            SELECT Id, Ordem, Pergunta, TipoPergunta, Obrigatoria,
                   EscalaMinima, EscalaMaxima, EscalaLabelMinima, EscalaLabelMaxima
            FROM PerguntasAvaliacao
            WHERE AvaliacaoId = @avaliacaoId
            ORDER BY Ordem
        `);
    
    const perguntas = perguntasResult.recordset;
    
    // Buscar opções para perguntas de múltipla escolha
    for (const pergunta of perguntas) {
        if (pergunta.TipoPergunta === 'multipla_escolha') {
            const opcoesResult = await pool.request()
                .input('perguntaAvaliacaoId', sql.Int, pergunta.Id)
                .query(`
                    SELECT Id, TextoOpcao, Ordem
                    FROM OpcoesPerguntasAvaliacao
                    WHERE PerguntaAvaliacaoId = @perguntaAvaliacaoId
                    ORDER BY Ordem
                `);
            
            pergunta.Opcoes = opcoesResult.recordset;
        } else {
            pergunta.Opcoes = [];
        }
    }
    
    return perguntas;
}

module.exports = {
    verificarECriarAvaliacoes,
    buscarAvaliacoesUsuario,
    buscarQuestionarioPadrao,
    buscarPerguntasAvaliacao,
    salvarRespostaAvaliacao,
    concluirAvaliacao,
    atualizarQuestionarioPadrao
};