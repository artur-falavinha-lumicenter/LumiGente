/**
 * NOVO SISTEMA DE PESQUISAS - ENDPOINTS API
 * Sistema completamente refeito para maior robustez e confiabilidade
 */

const express = require('express');
const sql = require('mssql');
const router = express.Router();

// Função para converter data/hora para timezone local brasileiro
function convertToLocalTime(dateString) {
    if (!dateString) return null;
    
    console.log('🕒 Input do usuário:', dateString);
    
    // SOLUÇÃO SIMPLES E DIRETA: Retornar string formatada para o SQL Server interpretar como DATETIME local
    // Evitar qualquer conversão de timezone - deixar o SQL Server tratar como horário local brasileiro
    
    let formattedString;
    
    if (dateString.includes('T')) {
        // Converter "2025-09-19T14:16" para "2025-09-19 14:16:00"
        formattedString = dateString.replace('T', ' ') + ':00.000';
    } else {
        // Converter "2025-09-19" para "2025-09-19 00:00:00"
        formattedString = dateString + ' 00:00:00.000';
    }
    
    console.log('🕒 String formatada para SQL Server:', formattedString);
    
    // Retornar string - SQL Server interpretará como DATETIME local (brasileiro)
    return formattedString;
}

// Função para atualizar status das pesquisas do novo sistema baseado nas datas
async function updateSurveyStatus() {
    try {
        const pool = await sql.connect();
        
        // 1. Encerrar pesquisas que passaram da data de encerramento
        const encerrarQuery = `
            UPDATE Surveys 
            SET status = 'Encerrada'
            WHERE status = 'Ativa' 
            AND data_encerramento IS NOT NULL 
            AND data_encerramento <= GETDATE()
        `;
        
        const resultEncerrar = await pool.request().query(encerrarQuery);
        if (resultEncerrar.rowsAffected && resultEncerrar.rowsAffected[0] > 0) {
            console.log(`🔄 ${resultEncerrar.rowsAffected[0]} pesquisas foram automaticamente encerradas`);
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
            console.log(`📅 ${resultAgendar.rowsAffected[0]} pesquisas foram marcadas como agendadas`);
        }
        
        // 3. Ativar pesquisas agendadas que chegaram na data de início
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
            console.log(`✅ ${resultAtivar.rowsAffected[0]} pesquisas foram automaticamente ativadas`);
        }
        
    } catch (error) {
        console.error('Erro ao atualizar status das pesquisas:', error);
    }
}

// Middleware para verificar autenticação
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
    }
    next();
};

// Middleware para verificar se é RH/T&D
const requireHRAccess = (req, res, next) => {
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
            error: 'Acesso negado. Apenas usuários do RH e T&D podem realizar esta ação.',
            userDepartment: user.departamento
        });
    }
    next();
};

// =====================================================
// 1. LISTAR PESQUISAS
// =====================================================

router.get('/', requireAuth, async (req, res) => {
    try {
        const { search, status, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        const user = req.session.user;
        
        // Verificar se é RH/T&D (vê todas) ou usuário comum (vê apenas as elegíveis)
        const departamento = user.departamento ? user.departamento.toUpperCase() : '';
        const isHRorTD = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS') ||
                        departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                        departamento.includes('TREINAMENTO') || 
                        departamento.includes('DESENVOLVIMENTO') ||
                        departamento.includes('T&D');
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (search) {
            whereClause += ' AND (s.titulo LIKE @search OR s.descricao LIKE @search)';
            params.push({ name: 'search', value: `%${search}%` });
        }
        
        if (status) {
            whereClause += ' AND s.status_calculado = @status';
            params.push({ name: 'status', value: status });
        }
        
        // Para usuários comuns, mostrar apenas pesquisas elegíveis (ativas ou encerradas)
        if (!isHRorTD) {
            whereClause += ` AND EXISTS (
                SELECT 1 FROM SurveyEligibleUsers seu 
                WHERE seu.survey_id = s.Id AND seu.user_id = @userId
            ) AND (s.status_calculado = 'Ativa' OR s.status_calculado = 'Encerrada')`;
        }
        
        // Sempre adicionar userId para as queries (mesmo para HR/TD para a verificação de "ja_respondeu")
        params.push({ name: 'userId', value: user.userId });
        
        const pool = await sql.connect();
        let request = pool.request();
        
        // Adicionar parâmetros com tipos corretos
        params.forEach(param => {
            if (param.name === 'userId') {
                request.input(param.name, sql.Int, param.value);
            } else {
            request.input(param.name, sql.VarChar, param.value);
            }
        });
        
        const query = `
            SELECT 
                s.*,
                -- Informações de resposta para usuário atual
                ${!isHRorTD ? `
                CASE WHEN EXISTS (
                    SELECT 1 FROM SurveyResponses sr 
                    WHERE sr.survey_id = s.Id AND sr.user_id = @userId
                ) THEN 1 ELSE 0 END as ja_respondeu,` : '0 as ja_respondeu,'}
                -- Verificar se pode responder
                ${!isHRorTD ? `
                CASE WHEN s.status_calculado = 'Ativa' AND NOT EXISTS (
                    SELECT 1 FROM SurveyResponses sr 
                    WHERE sr.survey_id = s.Id AND sr.user_id = @userId
                ) THEN 1 ELSE 0 END as pode_responder` : '0 as pode_responder'}
            FROM vw_SurveysSummary s
            ${whereClause}
            ORDER BY s.data_criacao DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `;
        
        const result = await request.query(query);
        
        // Buscar total de registros
        const countQuery = `SELECT COUNT(*) as total FROM vw_SurveysSummary s ${whereClause}`;
        let countRequest = pool.request();
        
        // Adicionar parâmetros para a query de contagem também
        params.forEach(param => {
            if (param.name === 'userId') {
                countRequest.input(param.name, sql.Int, param.value);
            } else {
                countRequest.input(param.name, sql.VarChar, param.value);
            }
        });
        
        const countResult = await countRequest.query(countQuery);
        
        res.json({
            surveys: result.recordset,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult.recordset[0].total,
                pages: Math.ceil(countResult.recordset[0].total / limit)
            },
            user_info: {
                is_hr_td: isHRorTD,
                can_create: isHRorTD
            }
        });
        
    } catch (error) {
        console.error('Erro ao listar pesquisas:', error);
        res.status(500).json({ error: 'Erro ao listar pesquisas' });
    }
});

// =====================================================
// 2. CRIAR PESQUISA
// =====================================================

router.post('/', requireAuth, requireHRAccess, async (req, res) => {
    const transaction = new sql.Transaction();
    
    try {
        const {
            titulo,
            descricao,
            perguntas,
            filiais_filtro = [], // Array de códigos de filiais
            departamentos_filtro = [], // Array de códigos de departamentos
            data_inicio,
            data_encerramento,
            anonima = false
        } = req.body;
        
        // Validações
        if (!titulo || !perguntas || perguntas.length === 0) {
            return res.status(400).json({ 
                error: 'Título e pelo menos uma pergunta são obrigatórios' 
            });
        }
        
        await transaction.begin();
        
        // 1. Criar a pesquisa principal
        const surveyResult = await transaction.request()
            .input('titulo', sql.NVarChar, titulo)
            .input('descricao', sql.NText, descricao)
            .input('anonima', sql.Bit, anonima)
            .input('data_inicio', sql.VarChar, data_inicio ? convertToLocalTime(data_inicio) : null)
            .input('data_encerramento', sql.VarChar, data_encerramento ? convertToLocalTime(data_encerramento) : null)
            .input('criado_por', sql.Int, req.session.user.userId)
            .query(`
                INSERT INTO Surveys (titulo, descricao, anonima, data_inicio, data_encerramento, criado_por)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @anonima, @data_inicio, @data_encerramento, @criado_por)
            `);
        
        const surveyId = surveyResult.recordset[0].Id;
        
        // 2. Inserir perguntas
        for (let i = 0; i < perguntas.length; i++) {
            const pergunta = perguntas[i];
            
            const questionResult = await transaction.request()
                .input('survey_id', sql.Int, surveyId)
                .input('pergunta', sql.NText, pergunta.texto)
                .input('tipo', sql.NVarChar, pergunta.tipo)
                .input('obrigatoria', sql.Bit, pergunta.obrigatoria || false)
                .input('ordem', sql.Int, i + 1)
                .input('escala_min', sql.Int, pergunta.escala_min || null)
                .input('escala_max', sql.Int, pergunta.escala_max || null)
                .query(`
                    INSERT INTO SurveyQuestions (survey_id, pergunta, tipo, obrigatoria, ordem, escala_min, escala_max)
                    OUTPUT INSERTED.Id
                    VALUES (@survey_id, @pergunta, @tipo, @obrigatoria, @ordem, @escala_min, @escala_max)
                `);
            
            const questionId = questionResult.recordset[0].Id;
            
            // 3. Inserir opções para múltipla escolha
            if (pergunta.tipo === 'multipla_escolha' && pergunta.opcoes) {
                for (let j = 0; j < pergunta.opcoes.length; j++) {
                    await transaction.request()
                        .input('question_id', sql.Int, questionId)
                        .input('opcao', sql.NVarChar, pergunta.opcoes[j])
                        .input('ordem', sql.Int, j + 1)
                        .query(`
                            INSERT INTO SurveyQuestionOptions (question_id, opcao, ordem)
                            VALUES (@question_id, @opcao, @ordem)
                        `);
                }
            }
        }
        
        // 4. Inserir filtros de filiais
        if (filiais_filtro.length > 0) {
            for (const filial of filiais_filtro) {
                await transaction.request()
                    .input('survey_id', sql.Int, surveyId)
                    .input('filial_codigo', sql.NVarChar, filial.codigo)
                    .input('filial_nome', sql.NVarChar, filial.nome)
                    .query(`
                        INSERT INTO SurveyFilialFilters (survey_id, filial_codigo, filial_nome)
                        VALUES (@survey_id, @filial_codigo, @filial_nome)
                    `);
            }
        }
        
        // 5. Inserir filtros de departamentos
        if (departamentos_filtro.length > 0) {
            for (const departamento of departamentos_filtro) {
                await transaction.request()
                    .input('survey_id', sql.Int, surveyId)
                    .input('departamento_codigo', sql.NVarChar, departamento.codigo)
                    .input('departamento_nome', sql.NVarChar, departamento.nome)
                    .query(`
                        INSERT INTO SurveyDepartamentoFilters (survey_id, departamento_codigo, departamento_nome)
                        VALUES (@survey_id, @departamento_codigo, @departamento_nome)
                    `);
            }
        }
        
        // 6. Calcular usuários elegíveis
        await transaction.request()
            .input('survey_id', sql.Int, surveyId)
            .execute('sp_CalculateSurveyEligibleUsers');
        
        await transaction.commit();
        
        // 7. Buscar dados completos da pesquisa criada
        const pool = await sql.connect();
        const createdSurvey = await pool.request()
            .input('surveyId', sql.Int, surveyId)
            .query('SELECT * FROM vw_SurveysSummary WHERE Id = @surveyId');
        
        res.json({
            success: true,
            message: 'Pesquisa criada com sucesso',
            survey: createdSurvey.recordset[0]
        });
        
    } catch (error) {
        await transaction.rollback();
        console.error('Erro ao criar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao criar pesquisa: ' + error.message });
    }
});

// =====================================================
// 3. ESTATÍSTICAS PARA USUÁRIOS
// =====================================================

router.get('/stats', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const pool = await sql.connect();
        
        // Atualizar status das pesquisas antes de buscar estatísticas
        console.log('🔄 Atualizando status das pesquisas...');
        await updateSurveyStatus();
        
        console.log('📊 Buscando estatísticas para usuário:', user.userId);
        
        // Pesquisas ativas no sistema (usando tabela direta)
        const activeSurveysResult = await pool.request().query(`
            SELECT COUNT(*) as count FROM Surveys 
            WHERE status = 'Ativa'
            AND (data_inicio IS NULL OR data_inicio <= GETDATE())
            AND (data_encerramento IS NULL OR data_encerramento > GETDATE())
        `);
        
        // Pesquisas que o usuário já respondeu
        const userResponsesResult = await pool.request()
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT COUNT(DISTINCT survey_id) as count 
                FROM SurveyResponses 
                WHERE user_id = @userId
            `);
        
        // Pesquisas pendentes para o usuário
        const pendingSurveysResult = await pool.request()
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT COUNT(*) as count 
                FROM Surveys s
                WHERE s.status = 'Ativa'
                AND (s.data_inicio IS NULL OR s.data_inicio <= GETDATE())
                AND (s.data_encerramento IS NULL OR s.data_encerramento > GETDATE())
                AND EXISTS (
                    SELECT 1 FROM SurveyEligibleUsers seu 
                    WHERE seu.survey_id = s.Id AND seu.user_id = @userId
                )
                AND NOT EXISTS (
                    SELECT 1 FROM SurveyResponses sr 
                    WHERE sr.survey_id = s.Id AND sr.user_id = @userId
                )
            `);
        
        const stats = {
            activeSurveys: activeSurveysResult.recordset[0].count,
            userResponses: userResponsesResult.recordset[0].count,
            pendingSurveys: pendingSurveysResult.recordset[0].count
        };
        
        console.log('📊 Estatísticas encontradas:', stats);
        res.json(stats);
        
    } catch (error) {
        console.error('❌ Erro ao buscar estatísticas:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ error: 'Erro ao buscar estatísticas', details: error.message });
    }
});

// =====================================================
// 4. PESQUISAS DISPONÍVEIS PARA O USUÁRIO
// =====================================================

router.get('/user', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const pool = await sql.connect();
        
        // Atualizar status das pesquisas antes de buscar
        console.log('🔄 Atualizando status das pesquisas...');
        await updateSurveyStatus();
        
        console.log('👤 Buscando pesquisas para usuário:', user.userId);
        
        // Buscar pesquisas disponíveis para o usuário atual (usando tabelas diretas)
        const surveysResult = await pool.request()
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 
                    s.Id,
                    s.titulo,
                    s.descricao,
                    s.status,
                    s.anonima,
                    s.data_inicio,
                    s.data_encerramento,
                    s.data_criacao,
                    (SELECT COUNT(*) FROM SurveyQuestions WHERE survey_id = s.Id) as total_perguntas,
                    CASE WHEN EXISTS (
                        SELECT 1 FROM SurveyResponses sr 
                        WHERE sr.survey_id = s.Id AND sr.user_id = @userId
                    ) THEN 1 ELSE 0 END as user_responded
                FROM Surveys s
                WHERE (s.status = 'Ativa' OR s.status = 'Encerrada')
                AND (s.data_inicio IS NULL OR s.data_inicio <= GETDATE())
                AND EXISTS (
                    SELECT 1 FROM SurveyEligibleUsers seu 
                    WHERE seu.survey_id = s.Id AND seu.user_id = @userId
                )
                ORDER BY s.data_criacao DESC
            `);
        
        console.log('👤 Pesquisas encontradas:', surveysResult.recordset.length);
        res.json(surveysResult.recordset);
        
    } catch (error) {
        console.error('❌ Erro ao buscar pesquisas do usuário:', error);
        console.error('❌ Stack trace:', error.stack);
        res.status(500).json({ error: 'Erro ao buscar pesquisas do usuário', details: error.message });
    }
});

// =====================================================
// 5. BUSCAR PESQUISA ESPECÍFICA
// =====================================================

router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;
        
        // Validar se o ID é um número válido
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            console.error('SurveyId inválido:', id);
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        const pool = await sql.connect();
        
        // Buscar dados da pesquisa (usando tabela direta em vez da view)
        const surveyResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT s.*, 
                       (SELECT COUNT(*) FROM SurveyQuestions WHERE survey_id = s.Id) as total_perguntas,
                       (SELECT COUNT(*) FROM SurveyEligibleUsers WHERE survey_id = s.Id) as total_usuarios_elegiveis,
                       (SELECT COUNT(DISTINCT user_id) FROM SurveyResponses WHERE survey_id = s.Id) as total_respostas,
                       CASE 
                           WHEN s.status = 'Ativa' AND 
                                (s.data_inicio IS NULL OR s.data_inicio <= GETDATE()) AND 
                                (s.data_encerramento IS NULL OR s.data_encerramento > GETDATE()) 
                           THEN 'Ativa' 
                           ELSE s.status 
                       END as status_calculado
                FROM Surveys s 
                WHERE s.Id = @surveyId
            `);
        
        if (surveyResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const survey = surveyResult.recordset[0];
        
        // Verificar se usuário pode ver esta pesquisa
        const departamento = user.departamento ? user.departamento.toUpperCase() : '';
        const isHRorTD = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS') ||
                        departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                        departamento.includes('TREINAMENTO') || 
                        departamento.includes('DESENVOLVIMENTO') ||
                        departamento.includes('T&D');
        
        if (!isHRorTD) {
            // Verificar se usuário é elegível
            const eligibilityResult = await pool.request()
                .input('surveyId', sql.Int, parseInt(id))
                .input('userId', sql.Int, user.userId)
                .query(`
                    SELECT 1 FROM SurveyEligibleUsers 
                    WHERE survey_id = @surveyId AND user_id = @userId
                `);
            
            if (eligibilityResult.recordset.length === 0) {
                return res.status(403).json({ error: 'Acesso negado a esta pesquisa' });
            }
        }
        
        // Buscar perguntas
        const questionsResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT q.*, 
                       (SELECT Id, opcao, ordem FROM SurveyQuestionOptions 
                        WHERE question_id = q.Id ORDER BY ordem FOR JSON PATH) as opcoes_json
                FROM SurveyQuestions q
                WHERE q.survey_id = @surveyId
                ORDER BY q.ordem
            `);
        
        console.log('🔍 DEBUG - Perguntas carregadas do banco:', questionsResult.recordset);
        
        // Processar opções
        const perguntas = questionsResult.recordset.map(q => {
            const perguntaProcessada = {
                ...q,
                opcoes: q.opcoes_json ? JSON.parse(q.opcoes_json) : null
            };
            
            if (q.tipo === 'multipla_escolha') {
                console.log(`🔍 DEBUG - Pergunta ${q.Id} opções:`, perguntaProcessada.opcoes);
            }
            
            return perguntaProcessada;
        });
        
        // Verificar se usuário já respondeu
        const responseResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 1 FROM SurveyResponses 
                WHERE survey_id = @surveyId AND user_id = @userId
            `);
        const ja_respondeu = responseResult.recordset.length > 0;
        
        // Verificar se usuário é elegível para responder (independente de ser RH/T&D)
        // RH/T&D pode responder SE estiver na lista de elegíveis
        const isElegivel = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 1 FROM SurveyEligibleUsers 
                WHERE survey_id = @surveyId AND user_id = @userId
            `);
        const e_elegivel = isElegivel.recordset.length > 0;
        
        // Pode responder se: é elegível, não respondeu ainda e a pesquisa está ativa
        const pode_responder = e_elegivel && !ja_respondeu && survey.status_calculado === 'Ativa';
        
        console.log(`🔍 DEBUG - Permissões de resposta:`, {
            usuario: user.nomeCompleto,
            isHRorTD,
            e_elegivel,
            ja_respondeu,
            status: survey.status_calculado,
            pode_responder
        });
        
        res.json({
            ...survey,
            perguntas,
            ja_respondeu,
            pode_responder
        });
        
    } catch (error) {
        console.error('Erro ao buscar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao buscar pesquisa' });
    }
});

// =====================================================
// 5. VER MINHA RESPOSTA
// =====================================================
router.get('/:id/my-response', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;
        
        // Validar se o ID é um número válido
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            console.error('SurveyId inválido para minha resposta:', id);
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        const pool = await sql.connect();
        
        // Buscar dados da pesquisa
        const surveyResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT titulo, descricao, anonima
                FROM Surveys 
                WHERE Id = @surveyId
            `);
        
        if (surveyResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const survey = surveyResult.recordset[0];
        
        // 1. Buscar TODAS as perguntas da pesquisa
        const questionsResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    Id as pergunta_id,
                    pergunta as pergunta_texto,
                    tipo as pergunta_tipo,
                    escala_min,
                    escala_max,
                    ordem
                FROM SurveyQuestions
                WHERE survey_id = @surveyId
                ORDER BY ordem
            `);
        
        if (questionsResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não possui perguntas' });
        }
        
        // 2. Buscar respostas do usuário
        const userResponsesResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 
                    sr.question_id,
                    sr.resposta_texto,
                    sr.resposta_numerica,
                    sr.option_id,
                    sr.data_resposta,
                    sqo.opcao as opcao_selecionada
                FROM SurveyResponses sr
                LEFT JOIN SurveyQuestionOptions sqo ON sr.option_id = sqo.Id
                WHERE sr.survey_id = @surveyId AND sr.user_id = @userId
            `);
        
        console.log('🔍 DEBUG - Respostas do banco:', JSON.stringify(userResponsesResult.recordset, null, 2));
        
        // Verificar se o usuário respondeu pelo menos uma pergunta
        if (userResponsesResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Você ainda não respondeu esta pesquisa' });
        }
        
        // 3. Buscar opções de cada pergunta
        const optionsResult = await pool.request()
            .query(`
                SELECT 
                    question_id,
                    opcao,
                    ordem
                FROM SurveyQuestionOptions
                WHERE question_id IN (${questionsResult.recordset.map(q => q.pergunta_id).join(',')})
                ORDER BY question_id, ordem
            `);
        
        // 4. Organizar dados
        const responses = questionsResult.recordset.map(question => {
            // Encontrar resposta do usuário para esta pergunta
            const userResponse = userResponsesResult.recordset.find(r => r.question_id === question.pergunta_id);
            
            // Encontrar opções desta pergunta
            const questionOptions = optionsResult.recordset
                .filter(o => o.question_id === question.pergunta_id)
                .map(o => o.opcao);
            
            // Para múltipla escolha, usar opcao_selecionada se disponível
            let respostaFinal = userResponse ? userResponse.resposta_texto : null;
            if (question.pergunta_tipo === 'multipla_escolha' && userResponse && userResponse.opcao_selecionada) {
                respostaFinal = userResponse.opcao_selecionada;
            }
            
            return {
                pergunta_id: question.pergunta_id,
                pergunta_texto: question.pergunta_texto,
                pergunta_tipo: question.pergunta_tipo,
                escala_min: question.escala_min,
                escala_max: question.escala_max,
                ordem: question.ordem,
                opcoes: questionOptions.length > 0 ? questionOptions.join('|') : null,
                resposta_texto: respostaFinal,
                resposta_numerica: userResponse ? userResponse.resposta_numerica : null,
                option_id: userResponse ? userResponse.option_id : null,
                data_resposta: userResponse ? userResponse.data_resposta : null
            };
        });
        
        // Pegar a data da primeira resposta
        const responseDate = userResponsesResult.recordset[0].data_resposta;
        
        const responseData = {
            survey: survey,
            responses: responses,
            response_date: responseDate
        };
        
        console.log('📤 DEBUG - Dados sendo enviados ao frontend:', JSON.stringify(responseData, null, 2));
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ Erro ao buscar minha resposta:', error);
        res.status(500).json({ error: 'Erro ao buscar sua resposta', details: error.message });
    }
});

// =====================================================
// 6. RESPONDER PESQUISA
// =====================================================

router.post('/:id/responder', requireAuth, async (req, res) => {
    const transaction = new sql.Transaction();
    
    try {
        const { id } = req.params;
        const { respostas } = req.body;
        const user = req.session.user;
        
        console.log('🔵 API /responder chamada - Survey ID:', id);
        console.log('🔵 Usuário:', user.nomeCompleto);
        console.log('🔵 Respostas recebidas:', JSON.stringify(respostas, null, 2));
        
        // Validar se o ID é um número válido
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            console.error('SurveyId inválido para resposta:', id);
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        if (!respostas || respostas.length === 0) {
            return res.status(400).json({ error: 'Respostas são obrigatórias' });
        }
        
        await transaction.begin();
        
        // Verificar se já respondeu
        const existingResponse = await transaction.request()
            .input('surveyId', sql.Int, parseInt(id))
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 1 FROM SurveyResponses 
                WHERE survey_id = @surveyId AND user_id = @userId
            `);
        
        if (existingResponse.recordset.length > 0) {
            await transaction.rollback();
            console.log('❌ Usuário já respondeu esta pesquisa');
            return res.status(400).json({ error: 'Você já respondeu esta pesquisa' });
        }
        
        // Verificar se a pesquisa está ativa
        const surveyStatusResult = await transaction.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT status,
                       CASE 
                           WHEN status = 'Ativa' AND 
                                (data_inicio IS NULL OR data_inicio <= GETDATE()) AND 
                                (data_encerramento IS NULL OR data_encerramento > GETDATE()) 
                           THEN 'Ativa' 
                           ELSE status 
                       END as status_calculado
                FROM Surveys 
                WHERE Id = @surveyId
            `);
        
        if (surveyStatusResult.recordset.length === 0) {
            await transaction.rollback();
            console.log('❌ Pesquisa não encontrada');
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        if (surveyStatusResult.recordset[0].status_calculado !== 'Ativa') {
            await transaction.rollback();
            console.log('❌ Pesquisa não está ativa:', surveyStatusResult.recordset[0].status_calculado);
            return res.status(403).json({ error: 'Esta pesquisa não está mais ativa' });
        }
        
        // Verificar se o usuário é elegível (CRÍTICO: permite RH/T&D responder se elegível)
        const isElegivelResult = await transaction.request()
            .input('surveyId', sql.Int, parseInt(id))
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 1 FROM SurveyEligibleUsers 
                WHERE survey_id = @surveyId AND user_id = @userId
            `);
        
        if (isElegivelResult.recordset.length === 0) {
            await transaction.rollback();
            console.log('❌ Usuário não é elegível para esta pesquisa');
            return res.status(403).json({ error: 'Você não é elegível para responder esta pesquisa' });
        }
        
        console.log('✅ Validações de permissão passaram - usuário pode responder');
        
        // Inserir respostas
        for (const resposta of respostas) {
            console.log('🔵 Salvando resposta:', {
                question_id: resposta.question_id,
                resposta_texto: resposta.resposta_texto || null,
                resposta_numerica: resposta.resposta_numerica || null,
                option_id: resposta.option_id || null
            });
            
            await transaction.request()
                .input('survey_id', sql.Int, id)
                .input('question_id', sql.Int, resposta.question_id)
                .input('user_id', sql.Int, user.userId)
                .input('resposta_texto', sql.NText, resposta.resposta_texto || null)
                .input('resposta_numerica', sql.Int, resposta.resposta_numerica || null)
                .input('option_id', sql.Int, resposta.option_id || null)
                .query(`
                    INSERT INTO SurveyResponses (survey_id, question_id, user_id, resposta_texto, resposta_numerica, option_id)
                    VALUES (@survey_id, @question_id, @user_id, @resposta_texto, @resposta_numerica, @option_id)
                `);
        }
        
        console.log('✅ Todas as respostas foram salvas com sucesso');
        
        await transaction.commit();
        
        res.json({
            success: true,
            message: 'Respostas enviadas com sucesso'
        });
        
    } catch (error) {
        await transaction.rollback();
        console.error('Erro ao responder pesquisa:', error);
        res.status(500).json({ error: 'Erro ao enviar respostas' });
    }
});

// =====================================================
// 7. RESULTADOS DA PESQUISA (APENAS RH/T&D)
// =====================================================

router.get('/:id/resultados', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Validar se o ID é um número válido
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            console.error('SurveyId inválido para resultados:', id);
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        const pool = await sql.connect();
        
        // Buscar dados da pesquisa (usando tabela direta)
        const surveyResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT s.*, 
                       (SELECT COUNT(*) FROM SurveyQuestions WHERE survey_id = s.Id) as total_perguntas,
                       (SELECT COUNT(*) FROM SurveyEligibleUsers WHERE survey_id = s.Id) as total_usuarios_elegiveis,
                       (SELECT COUNT(DISTINCT user_id) FROM SurveyResponses WHERE survey_id = s.Id) as total_respostas
                FROM Surveys s 
                WHERE s.Id = @surveyId
            `);
        
        if (surveyResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const survey = surveyResult.recordset[0];
        
        // Buscar perguntas e respostas
        const questionsResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT q.*,
                       (SELECT 
                            sr.resposta_texto,
                            sr.resposta_numerica,
                            sr.data_resposta,
                            so.opcao as opcao_selecionada,
                            CASE WHEN s.anonima = 1 THEN 'Anônimo' ELSE u.NomeCompleto END as autor
                        FROM SurveyResponses sr
                        LEFT JOIN SurveyQuestionOptions so ON sr.option_id = so.Id
                        LEFT JOIN Users u ON sr.user_id = u.Id
                        JOIN Surveys s ON sr.survey_id = s.Id
                        WHERE sr.question_id = q.Id
                        ORDER BY sr.data_resposta DESC
                        FOR JSON PATH
                       ) as respostas_json
                FROM SurveyQuestions q
                WHERE q.survey_id = @surveyId
                ORDER BY q.ordem
            `);
        
        // Processar resultados
        const perguntas = questionsResult.recordset.map(q => {
            const respostas = q.respostas_json ? JSON.parse(q.respostas_json) : [];
            
            let estatisticas = {};
            
            if (q.tipo === 'multipla_escolha') {
                // Contar opções selecionadas
                estatisticas.opcoes = {};
                respostas.forEach(r => {
                    if (r.opcao_selecionada) {
                        estatisticas.opcoes[r.opcao_selecionada] = 
                            (estatisticas.opcoes[r.opcao_selecionada] || 0) + 1;
                    }
                });
            } else if (q.tipo === 'escala') {
                // Calcular média e distribuição
                const valores = respostas
                    .filter(r => r.resposta_numerica !== null)
                    .map(r => r.resposta_numerica);
                
                if (valores.length > 0) {
                    estatisticas.media = valores.reduce((a, b) => a + b, 0) / valores.length;
                    estatisticas.distribuicao = {};
                    for (let i = q.escala_min; i <= q.escala_max; i++) {
                        estatisticas.distribuicao[i] = valores.filter(v => v === i).length;
                    }
                }
            }
            
            return {
                ...q,
                respostas,
                total_respostas: respostas.length,
                estatisticas
            };
        });
        
        res.json({
            ...survey,
            perguntas
        });
        
    } catch (error) {
        console.error('Erro ao buscar resultados:', error);
        res.status(500).json({ error: 'Erro ao buscar resultados' });
    }
});

// =====================================================
// 7.1. RESULTADOS DETALHADOS DA PESQUISA (PARA VISUALIZAÇÃO COMPLETA)
// =====================================================

router.get('/:id/resultados/detalhado', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            console.error('SurveyId inválido para resultados detalhados:', id);
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        const pool = await sql.connect();
        
        // Buscar dados completos da pesquisa
        const surveyResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT s.*, 
                       u.NomeCompleto as criador_nome,
                       (SELECT COUNT(*) FROM SurveyQuestions WHERE survey_id = s.Id) as total_perguntas,
                       (SELECT COUNT(*) FROM SurveyEligibleUsers WHERE survey_id = s.Id) as total_usuarios_elegiveis,
                       (SELECT COUNT(DISTINCT user_id) FROM SurveyResponses WHERE survey_id = s.Id) as total_respostas,
                       CASE 
                           WHEN s.status = 'Ativa' AND 
                                (s.data_inicio IS NULL OR s.data_inicio <= GETDATE()) AND 
                                (s.data_encerramento IS NULL OR s.data_encerramento > GETDATE()) 
                           THEN 'Ativa' 
                           WHEN s.status = 'Ativa' AND s.data_encerramento <= GETDATE()
                           THEN 'Encerrada'
                           ELSE s.status 
                       END as status_calculado
                FROM Surveys s
                LEFT JOIN Users u ON s.criado_por = u.Id
                WHERE s.Id = @surveyId
            `);
        
        if (surveyResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const survey = surveyResult.recordset[0];
        
        // Buscar perguntas com opções
        const questionsResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT q.*, 
                       (SELECT Id, opcao, ordem FROM SurveyQuestionOptions 
                        WHERE question_id = q.Id ORDER BY ordem FOR JSON PATH) as opcoes_json
                FROM SurveyQuestions q
                WHERE q.survey_id = @surveyId
                ORDER BY q.ordem
            `);
        
        // Buscar todas as respostas com informações do usuário
        const responsesResult = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT 
                    sr.Id,
                    sr.question_id,
                    sr.user_id,
                    sr.resposta_texto,
                    sr.resposta_numerica,
                    sr.option_id,
                    sr.data_resposta,
                    u.NomeCompleto as usuario_nome,
                    u.Matricula as usuario_matricula,
                    u.Departamento as usuario_departamento,
                    so.opcao as opcao_selecionada
                FROM SurveyResponses sr
                LEFT JOIN Users u ON sr.user_id = u.Id
                LEFT JOIN SurveyQuestionOptions so ON sr.option_id = so.Id
                WHERE sr.survey_id = @surveyId
                ORDER BY sr.user_id, sr.question_id
            `);
        
        // Organizar respostas por pergunta
        const perguntas = questionsResult.recordset.map(q => {
            const opcoes = q.opcoes_json ? JSON.parse(q.opcoes_json) : [];
            const respostas_pergunta = responsesResult.recordset.filter(r => r.question_id === q.Id);
            
            // Calcular estatísticas
            let estatisticas = {
                total_respostas: respostas_pergunta.length,
                porcentagem_responderam: Math.round((respostas_pergunta.length / survey.total_usuarios_elegiveis) * 100) || 0
            };
            
            if (q.tipo === 'multipla_escolha') {
                // Contagem por opção
                const contagem_opcoes = {};
                opcoes.forEach(opt => {
                    contagem_opcoes[opt.opcao] = {
                        count: 0,
                        porcentagem: 0
                    };
                });
                
                respostas_pergunta.forEach(r => {
                    if (r.opcao_selecionada && contagem_opcoes[r.opcao_selecionada]) {
                        contagem_opcoes[r.opcao_selecionada].count++;
                    }
                });
                
                // Calcular porcentagens
                Object.keys(contagem_opcoes).forEach(opcao => {
                    if (respostas_pergunta.length > 0) {
                        contagem_opcoes[opcao].porcentagem = Math.round(
                            (contagem_opcoes[opcao].count / respostas_pergunta.length) * 100
                        );
                    }
                });
                
                estatisticas.opcoes = contagem_opcoes;
            } else if (q.tipo === 'escala') {
                // Calcular média e distribuição
                const valores = respostas_pergunta
                    .filter(r => r.resposta_numerica !== null)
                    .map(r => r.resposta_numerica);
                
                if (valores.length > 0) {
                    estatisticas.media = (valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2);
                    estatisticas.distribuicao = {};
                    
                    for (let i = q.escala_min; i <= q.escala_max; i++) {
                        const count = valores.filter(v => v === i).length;
                        estatisticas.distribuicao[i] = {
                            count: count,
                            porcentagem: Math.round((count / valores.length) * 100)
                        };
                    }
                }
            }
            
            return {
                ...q,
                opcoes,
                respostas: respostas_pergunta.map(r => ({
                    usuario_nome: survey.anonima ? 'Anônimo' : r.usuario_nome,
                    usuario_matricula: survey.anonima ? null : r.usuario_matricula,
                    usuario_departamento: survey.anonima ? null : r.usuario_departamento,
                    resposta_texto: r.resposta_texto,
                    resposta_numerica: r.resposta_numerica,
                    opcao_selecionada: r.opcao_selecionada,
                    data_resposta: r.data_resposta
                })),
                estatisticas
            };
        });
        
        // Calcular taxa de resposta geral
        const taxa_resposta = Math.round((survey.total_respostas / survey.total_usuarios_elegiveis) * 100) || 0;
        
        res.json({
            ...survey,
            taxa_resposta,
            perguntas
        });
        
    } catch (error) {
        console.error('Erro ao buscar resultados detalhados:', error);
        res.status(500).json({ error: 'Erro ao buscar resultados detalhados' });
    }
});

// =====================================================
// 7.2. REABRIR PESQUISA ENCERRADA
// =====================================================

router.post('/:id/reabrir', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const { id } = req.params;
        const { nova_data_encerramento } = req.body;
        
        if (!id || isNaN(parseInt(id)) || parseInt(id) <= 0) {
            return res.status(400).json({ error: 'ID da pesquisa inválido' });
        }
        
        if (!nova_data_encerramento) {
            return res.status(400).json({ error: 'Nova data de encerramento é obrigatória' });
        }
        
        const pool = await sql.connect();
        
        // Verificar se a pesquisa existe e está encerrada
        const surveyCheck = await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .query(`
                SELECT status,
                       CASE 
                           WHEN status = 'Ativa' AND data_encerramento <= GETDATE()
                           THEN 'Encerrada'
                           ELSE status 
                       END as status_calculado
                FROM Surveys 
                WHERE Id = @surveyId
            `);
        
        if (surveyCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Pesquisa não encontrada' });
        }
        
        const survey = surveyCheck.recordset[0];
        
        if (survey.status_calculado !== 'Encerrada') {
            return res.status(400).json({ error: 'Apenas pesquisas encerradas podem ser reabertas' });
        }
        
        // Converter data para formato SQL Server
        const dataFormatada = convertToLocalTime(nova_data_encerramento);
        
        // Atualizar data de encerramento e reativar pesquisa
        await pool.request()
            .input('surveyId', sql.Int, parseInt(id))
            .input('nova_data', sql.VarChar, dataFormatada)
            .query(`
                UPDATE Surveys 
                SET data_encerramento = @nova_data,
                    status = 'Ativa'
                WHERE Id = @surveyId
            `);
        
        console.log(`✅ Pesquisa ${id} reaberta até ${nova_data_encerramento}`);
        
        res.json({
            success: true,
            message: 'Pesquisa reaberta com sucesso',
            nova_data_encerramento: dataFormatada
        });
        
    } catch (error) {
        console.error('Erro ao reabrir pesquisa:', error);
        res.status(500).json({ error: 'Erro ao reabrir pesquisa' });
    }
});

// =====================================================
// 8. BUSCAR FILTROS DISPONÍVEIS
// =====================================================

router.get('/meta/filtros', requireAuth, requireHRAccess, async (req, res) => {
    try {
        const pool = await sql.connect();
        
        // Buscar filiais disponíveis
        const filiaisResult = await pool.request().query(`
            SELECT DISTINCT FILIAL as codigo, FILIAL as nome
            FROM TAB_HIST_SRA 
            WHERE STATUS_GERAL = 'ATIVO' 
            AND FILIAL IS NOT NULL 
            AND FILIAL != ''
            ORDER BY FILIAL
        `);
        
        // Buscar departamentos disponíveis
        const departamentosResult = await pool.request().query(`
            SELECT DISTINCT 
                CASE 
                    WHEN h.NIVEL_4_DEPARTAMENTO IS NOT NULL THEN h.NIVEL_4_DEPARTAMENTO
                    WHEN h.DEPTO_ATUAL IS NOT NULL THEN h.DEPTO_ATUAL
                    WHEN ISNUMERIC(s.DEPARTAMENTO) = 1 THEN s.DEPARTAMENTO
                    ELSE s.DEPARTAMENTO
                END as codigo,
                CASE 
                    WHEN h.NIVEL_4_DEPARTAMENTO_DESC IS NOT NULL THEN h.NIVEL_4_DEPARTAMENTO_DESC
                    WHEN h.DESCRICAO_ATUAL IS NOT NULL THEN h.DESCRICAO_ATUAL
                    ELSE s.DEPARTAMENTO
                END as nome
            FROM TAB_HIST_SRA s
            LEFT JOIN HIERARQUIA_CC h ON (
                s.DEPARTAMENTO = h.NIVEL_4_DEPARTAMENTO 
                OR s.DEPARTAMENTO = h.DEPTO_ATUAL
            )
            WHERE s.STATUS_GERAL = 'ATIVO' 
            AND s.DEPARTAMENTO IS NOT NULL 
            AND s.DEPARTAMENTO != ''
            ORDER BY nome
        `);
        
        res.json({
            filiais: filiaisResult.recordset,
            departamentos: departamentosResult.recordset
        });
        
    } catch (error) {
        console.error('Erro ao buscar filtros:', error);
        res.status(500).json({ error: 'Erro ao buscar filtros' });
    }
});


module.exports = router;
