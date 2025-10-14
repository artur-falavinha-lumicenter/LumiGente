const sql = require('mssql');
const { getDatabasePool } = require('../config/db');
const AvaliacoesManager = require('../services/avaliacoesManager');

// =================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO (Helpers)
// =================================================================

/**
 * Verifica se o usuário tem permissão de administrador sobre as avaliações.
 * Acesso concedido para RH, T&D, e administradores do sistema.
 * @param {object} usuario - O objeto do usuário da sessão.
 * @returns {boolean}
 */
function verificarPermissaoAvaliacoesAdmin(usuario) {
    if (!usuario) return false;

    const departamento = usuario.departamento ? usuario.departamento.toUpperCase().trim() : '';

    const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
    const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') ||
                 departamento.includes('TREINAMENTO') ||
                 departamento.includes('DESENVOLVIMENTO') ||
                 departamento.includes('T&D');
    const isDeptAdm = (departamento.includes('DEPARTAMENTO ADM') && departamento.includes('SESMT')) ||
                      (departamento.startsWith('DEPARTAMENTO ADM/RH'));
    const isAdmin = usuario.role === 'Administrador';

    return isAdmin || isHR || isTD || isDeptAdm;
}


// =================================================================
// CONTROLLERS (Funções exportadas para as rotas)
// =================================================================

/**
 * GET /api/avaliacoes/minhas - Lista as avaliações pendentes e concluídas do usuário logado.
 */
exports.getMinhasAvaliacoes = async (req, res) => {
    try {
        const user = req.session.user;
        const pool = await getDatabasePool();
        const temPermissaoAdmin = verificarPermissaoAvaliacoesAdmin(user);
        
        const avaliacoes = await AvaliacoesManager.buscarAvaliacoesUsuario(pool, user.userId, temPermissaoAdmin);
        
        res.json(avaliacoes);
    } catch (error) {
        console.error('Erro ao buscar minhas avaliações:', error);
        res.status(500).json({ error: 'Erro ao buscar suas avaliações' });
    }
};

/**
 * GET /api/avaliacoes/todas - Lista todas as avaliações do sistema (Acesso restrito).
 */
exports.getAllAvaliacoes = async (req, res) => {
    try {
        const user = req.session.user;
        if (!verificarPermissaoAvaliacoesAdmin(user)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        const pool = await getDatabasePool();
        const result = await pool.request().query(`
            SELECT 
                a.Id, a.UserId, a.GestorId, a.Matricula, a.DataAdmissao, a.DataCriacao, 
                a.DataLimiteResposta, a.StatusAvaliacao, a.RespostaColaboradorConcluida,
                a.RespostaGestorConcluida, t.Nome as TipoAvaliacao, u.NomeCompleto,
                u.Departamento, g.NomeCompleto as NomeGestor
            FROM Avaliacoes a
            INNER JOIN TiposAvaliacao t ON a.TipoAvaliacaoId = t.Id
            INNER JOIN Users u ON a.UserId = u.Id
            LEFT JOIN Users g ON a.GestorId = g.Id
            ORDER BY a.DataCriacao DESC
        `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar todas as avaliações:', error);
        res.status(500).json({ error: 'Erro ao buscar todas as avaliações' });
    }
};

/**
 * GET /api/avaliacoes/:id - Busca uma avaliação específica pelo ID.
 */
exports.getAvaliacaoById = async (req, res) => {
    try {
        const user = req.session.user;
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        const pool = await getDatabasePool();
        const result = await pool.request()
            .input('id', sql.Int, parseInt(id))
            .query(`
                SELECT a.*, t.Nome as TipoAvaliacao, u.NomeCompleto, u.Departamento, g.NomeCompleto as NomeGestor
                FROM Avaliacoes a
                INNER JOIN TiposAvaliacao t ON a.TipoAvaliacaoId = t.Id
                INNER JOIN Users u ON a.UserId = u.Id
                LEFT JOIN Users g ON a.GestorId = g.Id
                WHERE a.Id = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }

        const avaliacao = result.recordset[0];
        const temPermissao = avaliacao.UserId === user.userId ||
                            avaliacao.GestorId === user.userId ||
                            verificarPermissaoAvaliacoesAdmin(user);

        if (!temPermissao) {
            return res.status(403).json({ error: 'Você não tem permissão para visualizar esta avaliação' });
        }

        res.json(avaliacao);
    } catch (error) {
        console.error('Erro ao buscar avaliação por ID:', error);
        res.status(500).json({ error: 'Erro ao buscar avaliação' });
    }
};

/**
 * POST /api/avaliacoes/responder - Salva as respostas de uma avaliação.
 */
exports.responderAvaliacao = async (req, res) => {
    try {
        const user = req.session.user;
        const { avaliacaoId, respostas, tipoRespondente } = req.body;

        if (!avaliacaoId || !respostas || !Array.isArray(respostas) || !tipoRespondente) {
            return res.status(400).json({ error: 'Dados de resposta inválidos' });
        }
        
        const pool = await getDatabasePool();

        // Validações de permissão e status da avaliação
        const avaliacao = await AvaliacoesManager.validarPermissaoResposta(pool, avaliacaoId, user.userId, tipoRespondente);

        // Salvar cada resposta
        for (const resposta of respostas) {
            await AvaliacoesManager.salvarRespostaAvaliacao(pool, {
                avaliacaoId,
                perguntaId: resposta.perguntaId,
                resposta: resposta.resposta,
                respondidoPor: user.userId,
                tipoRespondente,
                //... outros campos de resposta
            });
        }

        // Marcar a parte da avaliação como concluída
        await AvaliacoesManager.concluirAvaliacao(pool, avaliacaoId, tipoRespondente);

        res.json({ success: true, message: 'Respostas salvas com sucesso' });
    } catch (error) {
        console.error('Erro ao salvar respostas da avaliação:', error);
        // Retorna o erro específico pego pelo Manager (ex: 'Avaliação expirada')
        res.status(error.statusCode || 500).json({ error: error.message || 'Erro ao salvar respostas' });
    }
};

/**
 * GET /api/avaliacoes/:id/respostas - Busca as perguntas e respostas de uma avaliação.
 */
exports.getRespostasAvaliacao = async (req, res) => {
    try {
        const user = req.session.user;
        const { id } = req.params;
        const pool = await getDatabasePool();
        const avaliacao = await AvaliacoesManager.getAvaliacao(pool, id);

        if (!avaliacao) {
            return res.status(404).json({ error: 'Avaliação não encontrada' });
        }

        // Verificar permissão
        const temPermissao = avaliacao.UserId === user.userId ||
                            avaliacao.GestorId === user.userId ||
                            verificarPermissaoAvaliacoesAdmin(user);

        if (!temPermissao) {
            return res.status(403).json({ error: 'Acesso negado' });
        }

        const [perguntas, minhasRespostas, respostasOutraParte] = await Promise.all([
            AvaliacoesManager.buscarPerguntasAvaliacao(pool, id),
            AvaliacoesManager.buscarRespostasPorUsuario(pool, id, user.userId),
            AvaliacoesManager.buscarRespostasOutraParte(pool, id, user.userId)
        ]);
        
        res.json({ perguntas, minhasRespostas, respostasOutraParte });

    } catch (error) {
        console.error('Erro ao buscar respostas da avaliação:', error);
        res.status(500).json({ error: 'Erro ao buscar respostas' });
    }
};

/**
 * GET /api/avaliacoes/questionario/:tipo - Busca o modelo de questionário padrão.
 */
exports.getQuestionarioPadrao = async (req, res) => {
    try {
        const { tipo } = req.params; // '45' ou '90'
        if (tipo !== '45' && tipo !== '90') {
            return res.status(400).json({ error: 'Tipo de questionário inválido' });
        }
        
        const pool = await getDatabasePool();
        const questionario = await AvaliacoesManager.buscarQuestionarioPadrao(pool, tipo);
        
        res.json(questionario);
    } catch (error) {
        console.error('Erro ao buscar questionário padrão:', error);
        res.status(500).json({ error: 'Erro ao buscar questionário' });
    }
};

/**
 * PUT /api/avaliacoes/questionario/:tipo - Atualiza o questionário padrão (Acesso restrito).
 */
exports.updateQuestionarioPadrao = async (req, res) => {
    try {
        const user = req.session.user;
        if (!verificarPermissaoAvaliacoesAdmin(user)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        const { tipo } = req.params;
        const { perguntas } = req.body;
        
        if ((tipo !== '45' && tipo !== '90') || !Array.isArray(perguntas)) {
            return res.status(400).json({ error: 'Dados inválidos' });
        }

        const pool = await getDatabasePool();
        await AvaliacoesManager.atualizarQuestionarioPadrao(pool, tipo, perguntas);

        res.json({ success: true, message: 'Questionário atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar questionário:', error);
        res.status(500).json({ error: 'Erro ao atualizar questionário' });
    }
};

/**
 * POST /api/avaliacoes/:id/reabrir - Reabre uma avaliação expirada (Acesso restrito).
 */
exports.reabrirAvaliacao = async (req, res) => {
    try {
        const user = req.session.user;
        if (!verificarPermissaoAvaliacoesAdmin(user)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }
        
        const { id } = req.params;
        const { novaDataLimite } = req.body;

        if (!novaDataLimite) {
            return res.status(400).json({ error: 'Nova data limite é obrigatória' });
        }
        
        const pool = await getDatabasePool();
        await AvaliacoesManager.reabrirAvaliacao(pool, id, novaDataLimite);

        res.json({ success: true, message: 'Avaliação reaberta com sucesso' });
    } catch (error) {
        console.error('Erro ao reabrir avaliação:', error);
        res.status(500).json({ error: 'Erro ao reabrir avaliação' });
    }
};