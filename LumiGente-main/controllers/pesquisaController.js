const sql = require('mssql');
const { getDatabasePool } = require('../config/db');
const { updateSurveyStatus } = require('../jobs/updateStatus');

// =================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO (Helpers)
// =================================================================

/**
 * Converte uma string de data/hora do frontend para um formato compatível com o SQL Server.
 * @param {string} dateString - A data vinda do cliente (ex: '2025-10-20T10:00').
 * @returns {string|null} - A string formatada ou null.
 */
function convertToLocalTime(dateString) {
    if (!dateString) return null;
    let formattedString;
    if (dateString.includes('T')) {
        formattedString = dateString.replace('T', ' ') + ':00.000';
    } else {
        formattedString = dateString + ' 00:00:00.000';
    }
    return formattedString;
}

/**
 * Processa as respostas de uma pergunta específica para gerar estatísticas.
 * @param {object} pergunta - O objeto da pergunta, incluindo suas opções.
 * @param {Array} respostas - Um array com as respostas para essa pergunta.
 * @param {number} totalElegiveis - O número total de usuários elegíveis para a pesquisa.
 * @returns {object} - Um objeto com as estatísticas processadas.
 */
function processarEstatisticas(pergunta, respostas, totalElegiveis) {
    const totalRespostasPergunta = respostas.length;
    let estatisticas = {
        total_respostas: totalRespostasPergunta,
        porcentagem_responderam: totalElegiveis > 0 ? Math.round((totalRespostasPergunta / totalElegiveis) * 100) : 0
    };

    if (pergunta.tipo === 'multipla_escolha') {
        const contagem_opcoes = {};
        const opcoesDaPergunta = pergunta.opcoes || [];
        opcoesDaPergunta.forEach(opt => {
            contagem_opcoes[opt.opcao] = { count: 0, porcentagem: 0 };
        });
        respostas.forEach(r => {
            if (r.opcao_selecionada && contagem_opcoes.hasOwnProperty(r.opcao_selecionada)) {
                contagem_opcoes[r.opcao_selecionada].count++;
            }
        });
        Object.keys(contagem_opcoes).forEach(opcao => {
            if (totalRespostasPergunta > 0) {
                contagem_opcoes[opcao].porcentagem = Math.round((contagem_opcoes[opcao].count / totalRespostasPergunta) * 100);
            }
        });
        estatisticas.opcoes = contagem_opcoes;
    } else if (pergunta.tipo === 'escala') {
        const valores = respostas.filter(r => r.resposta_numerica !== null).map(r => r.resposta_numerica);
        if (valores.length > 0) {
            estatisticas.media = (valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2);
            estatisticas.distribuicao = {};
            for (let i = pergunta.escala_min; i <= pergunta.escala_max; i++) {
                const count = valores.filter(v => v === i).length;
                estatisticas.distribuicao[i] = {
                    count: count,
                    porcentagem: Math.round((count / valores.length) * 100)
                };
            }
        }
    }
    return estatisticas;
}

// =================================================================
// CONTROLLERS
// =================================================================

/**
 * GET /api/pesquisas - Lista pesquisas com base no perfil do usuário.
 */
exports.listPesquisas = async (req, res) => {
    try {
        const { search, status, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        const user = req.session.user;

        const departamento = user.departamento ? user.departamento.toUpperCase() : '';
        const isHRorTD = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS') || departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || departamento.includes('T&D');

        let whereClause = 'WHERE 1=1';
        const pool = await getDatabasePool();
        const request = pool.request();

        if (search) {
            whereClause += ' AND (s.titulo LIKE @search OR s.descricao LIKE @search)';
            request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (status) {
            whereClause += ' AND s.status_calculado = @status';
            request.input('status', sql.NVarChar, status);
        }
        if (!isHRorTD) {
            whereClause += ` AND EXISTS (SELECT 1 FROM SurveyEligibleUsers seu WHERE seu.survey_id = s.Id AND seu.user_id = @userId) AND s.status_calculado IN ('Ativa', 'Encerrada')`;
        }
        request.input('userId', sql.Int, user.userId);

        const query = `
            SELECT s.*,
                   CASE WHEN EXISTS (SELECT 1 FROM SurveyResponses sr WHERE sr.survey_id = s.Id AND sr.user_id = @userId) THEN 1 ELSE 0 END as ja_respondeu,
                   CASE WHEN s.status_calculado = 'Ativa' AND NOT EXISTS (SELECT 1 FROM SurveyResponses sr WHERE sr.survey_id = s.Id AND sr.user_id = @userId) THEN 1 ELSE 0 END as pode_responder
            FROM vw_SurveysSummary s
            ${whereClause}
            ORDER BY s.data_criacao DESC
            OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
        const result = await request.query(query);

        const countRequest = pool.request();
        countRequest.input('userId', sql.Int, user.userId);
        if (search) countRequest.input('search', sql.NVarChar, `%${search}%`);
        if (status) countRequest.input('status', sql.NVarChar, status);
        const countResult = await countRequest.query(`SELECT COUNT(*) as total FROM vw_SurveysSummary s ${whereClause}`);
        const total = countResult.recordset[0].total;

        res.json({
            surveys: result.recordset,
            pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) },
            user_info: { is_hr_td: isHRorTD }
        });
    } catch (error) {
        console.error('Erro ao listar pesquisas:', error);
        res.status(500).json({ error: 'Erro ao listar pesquisas' });
    }
};

/**
 * POST /api/pesquisas - Cria uma nova pesquisa.
 */
exports.createPesquisa = async (req, res) => {
    const pool = await getDatabasePool();
    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        const { titulo, descricao, perguntas, filiais_filtro = [], departamentos_filtro = [], data_inicio, data_encerramento, anonima = false } = req.body;

        if (!titulo || !perguntas || !Array.isArray(perguntas) || perguntas.length === 0) {
            return res.status(400).json({ error: 'Título e pelo menos uma pergunta são obrigatórios' });
        }

        const surveyResult = await new sql.Request(transaction)
            .input('titulo', sql.NVarChar, titulo)
            .input('descricao', sql.NText, descricao)
            .input('anonima', sql.Bit, anonima)
            .input('data_inicio', sql.DateTime, data_inicio ? convertToLocalTime(data_inicio) : null)
            .input('data_encerramento', sql.DateTime, data_encerramento ? convertToLocalTime(data_encerramento) : null)
            .input('criado_por', sql.Int, req.session.user.userId)
            .query(`INSERT INTO Surveys (titulo, descricao, anonima, data_inicio, data_encerramento, criado_por) OUTPUT INSERTED.Id VALUES (@titulo, @descricao, @anonima, @data_inicio, @data_encerramento, @criado_por)`);
        
        const surveyId = surveyResult.recordset[0].Id;

        for (let i = 0; i < perguntas.length; i++) {
            const p = perguntas[i];
            const questionResult = await new sql.Request(transaction)
                .input('survey_id', sql.Int, surveyId)
                .input('pergunta', sql.NText, p.texto)
                .input('tipo', sql.NVarChar, p.tipo)
                .input('obrigatoria', sql.Bit, p.obrigatoria || false)
                .input('ordem', sql.Int, i + 1)
                .input('escala_min', sql.Int, p.escala_min || null)
                .input('escala_max', sql.Int, p.escala_max || null)
                .query(`INSERT INTO SurveyQuestions (survey_id, pergunta, tipo, obrigatoria, ordem, escala_min, escala_max) OUTPUT INSERTED.Id VALUES (@survey_id, @pergunta, @tipo, @obrigatoria, @ordem, @escala_min, @escala_max)`);
            
            const questionId = questionResult.recordset[0].Id;

            if (p.tipo === 'multipla_escolha' && p.opcoes) {
                for (let j = 0; j < p.opcoes.length; j++) {
                    await new sql.Request(transaction)
                        .input('question_id', sql.Int, questionId)
                        .input('opcao', sql.NVarChar, p.opcoes[j])
                        .input('ordem', sql.Int, j + 1)
                        .query(`INSERT INTO SurveyQuestionOptions (question_id, opcao, ordem) VALUES (@question_id, @opcao, @ordem)`);
                }
            }
        }
        
        if (filiais_filtro.length > 0) {
            for (const filial of filiais_filtro) {
                 await new sql.Request(transaction).input('survey_id', sql.Int, surveyId).input('filial_codigo', sql.NVarChar, filial.codigo).input('filial_nome', sql.NVarChar, filial.nome).query(`INSERT INTO SurveyFilialFilters (survey_id, filial_codigo, filial_nome) VALUES (@survey_id, @filial_codigo, @filial_nome)`);
            }
        }
        
        if (departamentos_filtro.length > 0) {
            for (const depto of departamentos_filtro) {
                await new sql.Request(transaction).input('survey_id', sql.Int, surveyId).input('depto_codigo', sql.NVarChar, depto.codigo).input('depto_nome', sql.NVarChar, depto.nome).query(`INSERT INTO SurveyDepartamentoFilters (survey_id, departamento_codigo, departamento_nome) VALUES (@survey_id, @depto_codigo, @depto_nome)`);
            }
        }
        
        await new sql.Request(transaction).input('survey_id', sql.Int, surveyId).execute('sp_CalculateSurveyEligibleUsers');
        
        await transaction.commit();
        
        const createdSurvey = await pool.request().input('surveyId', sql.Int, surveyId).query('SELECT * FROM vw_SurveysSummary WHERE Id = @surveyId');
        
        res.status(201).json({ success: true, message: 'Pesquisa criada com sucesso', survey: createdSurvey.recordset[0] });

    } catch (error) {
        if (transaction.rolledBack === false) await transaction.rollback();
        console.error('Erro ao criar pesquisa:', error);
        res.status(500).json({ error: 'Erro ao criar pesquisa: ' + error.message });
    }
};

/**
 * GET /api/pesquisas/:id - Busca detalhes de uma pesquisa específica.
 */
exports.getPesquisaById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;
        if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID da pesquisa inválido' });

        const pool = await getDatabasePool();
        const surveyResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT * FROM vw_SurveysSummary WHERE Id = @surveyId`);
        if (surveyResult.recordset.length === 0) return res.status(404).json({ error: 'Pesquisa não encontrada' });
        
        const survey = surveyResult.recordset[0];
        
        const isHRorTD = (user.departamento || '').toUpperCase().includes('RH') || (user.departamento || '').toUpperCase().includes('TREINAM');
        if (!isHRorTD) {
            const eligibilityResult = await pool.request().input('surveyId', sql.Int, id).input('userId', sql.Int, user.userId).query(`SELECT 1 FROM SurveyEligibleUsers WHERE survey_id = @surveyId AND user_id = @userId`);
            if (eligibilityResult.recordset.length === 0) return res.status(403).json({ error: 'Acesso negado a esta pesquisa' });
        }

        const questionsResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT q.*, (SELECT Id, opcao, ordem FROM SurveyQuestionOptions WHERE question_id = q.Id ORDER BY ordem FOR JSON PATH) as opcoes_json FROM SurveyQuestions q WHERE q.survey_id = @surveyId ORDER BY q.ordem`);
        const perguntas = questionsResult.recordset.map(q => ({...q, opcoes: q.opcoes_json ? JSON.parse(q.opcoes_json) : null }));
        
        const responseResult = await pool.request().input('surveyId', sql.Int, id).input('userId', sql.Int, user.userId).query(`SELECT 1 FROM SurveyResponses WHERE survey_id = @surveyId AND user_id = @userId`);
        const ja_respondeu = responseResult.recordset.length > 0;
        
        const pode_responder = !ja_respondeu && survey.status_calculado === 'Ativa';

        res.json({ ...survey, perguntas, ja_respondeu, pode_responder });
    } catch (error) {
        console.error('Erro ao buscar pesquisa por ID:', error);
        res.status(500).json({ error: 'Erro ao buscar pesquisa' });
    }
};

/**
 * POST /api/pesquisas/:id/responder - Salva as respostas de um usuário para uma pesquisa.
 */
exports.responderPesquisa = async (req, res) => {
    const pool = await getDatabasePool();
    const transaction = new sql.Transaction(pool);
    try {
        const { id } = req.params;
        const { respostas } = req.body;
        const user = req.session.user;
        if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID da pesquisa inválido' });
        if (!respostas || respostas.length === 0) return res.status(400).json({ error: 'Respostas são obrigatórias' });

        await transaction.begin();
        
        const request = new sql.Request(transaction);
        const existingResponse = await request.input('surveyId', sql.Int, id).input('userId', sql.Int, user.userId).query(`SELECT 1 FROM SurveyResponses WHERE survey_id = @surveyId AND user_id = @userId`);
        if (existingResponse.recordset.length > 0) {
            await transaction.rollback();
            return res.status(400).json({ error: 'Você já respondeu esta pesquisa' });
        }
        
        const surveyStatusResult = await request.input('surveyId', sql.Int, id).query(`SELECT status_calculado FROM vw_SurveysSummary WHERE Id = @surveyId`);
        if (surveyStatusResult.recordset.length === 0 || surveyStatusResult.recordset[0].status_calculado !== 'Ativa') {
            await transaction.rollback();
            return res.status(403).json({ error: 'Esta pesquisa não está mais ativa' });
        }

        for (const resposta of respostas) {
            await new sql.Request(transaction)
                .input('survey_id', sql.Int, id)
                .input('question_id', sql.Int, resposta.question_id)
                .input('user_id', sql.Int, user.userId)
                .input('resposta_texto', sql.NText, resposta.resposta_texto || null)
                .input('resposta_numerica', sql.Int, resposta.resposta_numerica || null)
                .input('option_id', sql.Int, resposta.option_id || null)
                .query(`INSERT INTO SurveyResponses (survey_id, question_id, user_id, resposta_texto, resposta_numerica, option_id) VALUES (@survey_id, @question_id, @user_id, @resposta_texto, @resposta_numerica, @option_id)`);
        }

        await transaction.commit();
        res.json({ success: true, message: 'Respostas enviadas com sucesso' });
    } catch (error) {
        if (transaction.rolledBack === false) await transaction.rollback();
        console.error('Erro ao responder pesquisa:', error);
        res.status(500).json({ error: 'Erro ao enviar respostas' });
    }
};

/**
 * GET /api/pesquisas/:id/resultados - Busca os resultados consolidados de uma pesquisa (acesso restrito).
 */
exports.getPesquisaResultados = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID da pesquisa inválido' });

        const pool = await getDatabasePool();
        const surveyResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT * FROM vw_SurveysSummary WHERE Id = @surveyId`);
        if (surveyResult.recordset.length === 0) return res.status(404).json({ error: 'Pesquisa não encontrada' });
        
        const survey = surveyResult.recordset[0];

        const questionsResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT q.*, (SELECT Id, opcao, ordem FROM SurveyQuestionOptions WHERE question_id = q.Id ORDER BY ordem FOR JSON PATH) as opcoes_json FROM SurveyQuestions q WHERE q.survey_id = @surveyId ORDER BY q.ordem`);
        
        const responsesResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT sr.*, so.opcao as opcao_selecionada, u.NomeCompleto as usuario_nome FROM SurveyResponses sr LEFT JOIN SurveyQuestionOptions so ON sr.option_id = so.Id LEFT JOIN Users u ON sr.user_id = u.Id WHERE sr.survey_id = @surveyId`);

        const perguntas = questionsResult.recordset.map(q => {
            const respostasDaPergunta = responsesResult.recordset.filter(r => r.question_id === q.Id);
            const opcoes = q.opcoes_json ? JSON.parse(q.opcoes_json) : [];
            const perguntaComOpcoes = {...q, opcoes};
            return {
                ...perguntaComOpcoes,
                respostas: respostasDaPergunta.map(r => ({
                    usuario_nome: survey.anonima ? 'Anônimo' : r.usuario_nome,
                    resposta_texto: r.resposta_texto,
                    resposta_numerica: r.resposta_numerica,
                    opcao_selecionada: r.opcao_selecionada,
                    data_resposta: r.data_resposta
                })),
                estatisticas: processarEstatisticas(perguntaComOpcoes, respostasDaPergunta, survey.total_usuarios_elegiveis)
            };
        });

        res.json({ ...survey, perguntas });
    } catch (error) {
        console.error('Erro ao buscar resultados da pesquisa:', error);
        res.status(500).json({ error: 'Erro ao buscar resultados' });
    }
};

/**
 * POST /api/pesquisas/:id/reabrir - Reabre uma pesquisa encerrada (acesso restrito).
 */
exports.reabrirPesquisa = async (req, res) => {
    try {
        const { id } = req.params;
        const { nova_data_encerramento } = req.body;
        if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID da pesquisa inválido' });
        if (!nova_data_encerramento) return res.status(400).json({ error: 'Nova data de encerramento é obrigatória' });

        const pool = await getDatabasePool();
        const surveyCheck = await pool.request().input('surveyId', sql.Int, id).query(`SELECT status_calculado FROM vw_SurveysSummary WHERE Id = @surveyId`);
        if (surveyCheck.recordset.length === 0) return res.status(404).json({ error: 'Pesquisa não encontrada' });
        if (surveyCheck.recordset[0].status_calculado !== 'Encerrada') return res.status(400).json({ error: 'Apenas pesquisas encerradas podem ser reabertas' });

        const dataFormatada = convertToLocalTime(nova_data_encerramento);
        await pool.request().input('surveyId', sql.Int, id).input('nova_data', sql.DateTime, dataFormatada).query(`UPDATE Surveys SET data_encerramento = @nova_data, status = 'Ativa' WHERE Id = @surveyId`);
        
        res.json({ success: true, message: 'Pesquisa reaberta com sucesso', nova_data_encerramento: dataFormatada });
    } catch (error) {
        console.error('Erro ao reabrir pesquisa:', error);
        res.status(500).json({ error: 'Erro ao reabrir pesquisa' });
    }
};

/**
 * GET /api/pesquisas/stats - Retorna estatísticas de pesquisas para o usuário.
 */
exports.getPesquisaStats = async (req, res) => {
    try {
        const user = req.session.user;
        const pool = await getDatabasePool();
        await updateSurveyStatus();

        const statsResult = await pool.request()
            .input('userId', sql.Int, user.userId)
            .query(`
                SELECT 
                    (SELECT COUNT(*) FROM Surveys s WHERE s.status = 'Ativa' AND (s.data_encerramento IS NULL OR s.data_encerramento > GETDATE())) as activeSurveys,
                    (SELECT COUNT(DISTINCT survey_id) FROM SurveyResponses WHERE user_id = @userId) as userResponses,
                    (SELECT COUNT(*) FROM SurveyEligibleUsers seu JOIN Surveys s ON seu.survey_id = s.Id WHERE seu.user_id = @userId AND s.status = 'Ativa' AND NOT EXISTS (SELECT 1 FROM SurveyResponses sr WHERE sr.survey_id = s.Id AND sr.user_id = @userId)) as pendingSurveys
            `);
        res.json(statsResult.recordset[0]);
    } catch (error) {
        console.error('Erro ao buscar estatísticas de pesquisas:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
};

/**
 * GET /api/pesquisas/meta/filtros - Retorna filtros para criação de pesquisas (acesso restrito).
 */
exports.getMetaFiltros = async (req, res) => {
    try {
        const pool = await getDatabasePool();
        const filiaisPromise = pool.request().query(`SELECT DISTINCT FILIAL as codigo, FILIAL as nome FROM TAB_HIST_SRA WHERE STATUS_GERAL = 'ATIVO' AND FILIAL IS NOT NULL AND FILIAL != '' ORDER BY FILIAL`);
        const departamentosPromise = pool.request().query(`SELECT DISTINCT DEPARTAMENTO as codigo, DESCRICAO_ATUAL as nome FROM HIERARQUIA_CC WHERE DEPARTAMENTO IS NOT NULL AND DESCRICAO_ATUAL IS NOT NULL ORDER BY nome`);
        
        const [filiaisResult, departamentosResult] = await Promise.all([filiaisPromise, departamentosPromise]);

        res.json({ filiais: filiaisResult.recordset, departamentos: departamentosResult.recordset });
    } catch (error) {
        console.error('Erro ao buscar filtros para pesquisas:', error);
        res.status(500).json({ error: 'Erro ao buscar filtros' });
    }
};

/**
 * GET /api/pesquisas/:id/my-response - Busca as respostas que um usuário já deu para uma pesquisa.
 */
exports.getMyResponse = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.session.user;
        if (!id || isNaN(parseInt(id))) return res.status(400).json({ error: 'ID da pesquisa inválido' });

        const pool = await getDatabasePool();
        const surveyResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT titulo, descricao, anonima FROM Surveys WHERE Id = @surveyId`);
        if (surveyResult.recordset.length === 0) return res.status(404).json({ error: 'Pesquisa não encontrada' });

        const survey = surveyResult.recordset[0];
        
        const questionsResult = await pool.request().input('surveyId', sql.Int, id).query(`SELECT Id as pergunta_id, pergunta as pergunta_texto, tipo as pergunta_tipo, ordem FROM SurveyQuestions WHERE survey_id = @surveyId ORDER BY ordem`);
        if (questionsResult.recordset.length === 0) return res.status(404).json({ error: 'Pesquisa não possui perguntas' });

        const userResponsesResult = await pool.request().input('surveyId', sql.Int, id).input('userId', sql.Int, user.userId).query(`SELECT sr.question_id, sr.resposta_texto, sr.resposta_numerica, sr.option_id, sr.data_resposta, sqo.opcao as opcao_selecionada FROM SurveyResponses sr LEFT JOIN SurveyQuestionOptions sqo ON sr.option_id = sqo.Id WHERE sr.survey_id = @surveyId AND sr.user_id = @userId`);
        if (userResponsesResult.recordset.length === 0) return res.status(404).json({ error: 'Você ainda não respondeu esta pesquisa' });
        
        const responses = questionsResult.recordset.map(question => {
            const userResponse = userResponsesResult.recordset.find(r => r.question_id === question.pergunta_id);
            let respostaFinal = userResponse ? userResponse.resposta_texto : null;
            if (question.pergunta_tipo === 'multipla_escolha' && userResponse && userResponse.opcao_selecionada) {
                respostaFinal = userResponse.opcao_selecionada;
            }
            return {
                ...question,
                resposta_texto: respostaFinal,
                resposta_numerica: userResponse ? userResponse.resposta_numerica : null,
                data_resposta: userResponse ? userResponse.data_resposta : null
            };
        });
        
        const responseDate = userResponsesResult.recordset[0].data_resposta;
        res.json({ survey, responses, response_date: responseDate });
    } catch (error) {
        console.error('Erro ao buscar minha resposta:', error);
        res.status(500).json({ error: 'Erro ao buscar sua resposta' });
    }
};