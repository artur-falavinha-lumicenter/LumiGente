const sql = require('mssql');
const { getDatabasePool } = require('../config/db'); // Importa a conexão centralizada

/**
 * Classe estática para gerenciar toda a lógica de negócio das Avaliações de Desempenho.
 */
class AvaliacoesManager {

    /**
     * Verifica e cria automaticamente avaliações de 45 e 90 dias para novos colaboradores.
     */
    static async verificarECriarAvaliacoes() {
        try {
            const pool = await getDatabasePool();
            const diasParaVerificar = 100;
            const novosFuncionarios = await pool.request()
                .input('dias', sql.Int, diasParaVerificar)
                .query(`
                    SELECT Id, Matricula, NomeCompleto, DataAdmissao, GestorId 
                    FROM Users 
                    WHERE IsActive = 1 AND DataAdmissao >= DATEADD(day, -@dias, GETDATE())
                `);

            let criadas45 = 0;
            let criadas90 = 0;

            for (const func of novosFuncionarios.recordset) {
                const avaliacao45existente = await pool.request()
                    .input('userId', sql.Int, func.Id)
                    .input('tipoId', sql.Int, 1)
                    .query('SELECT Id FROM Avaliacoes WHERE UserId = @userId AND TipoAvaliacaoId = @tipoId');

                if (avaliacao45existente.recordset.length === 0) {
                    await this.criarAvaliacao(func, 1);
                    criadas45++;
                }

                const avaliacao90existente = await pool.request()
                    .input('userId', sql.Int, func.Id)
                    .input('tipoId', sql.Int, 2)
                    .query('SELECT Id FROM Avaliacoes WHERE UserId = @userId AND TipoAvaliacaoId = @tipoId');

                if (avaliacao90existente.recordset.length === 0) {
                    await this.criarAvaliacao(func, 2);
                    criadas90++;
                }
            }
            
            return {
                message: "Verificação concluída.",
                criadas45dias: criadas45,
                criadas90dias: criadas90
            };
        } catch (error) {
            console.error('❌ Erro no job de verificar e criar avaliações:', error);
            throw error;
        }
    }

    /**
     * Cria uma nova entrada de avaliação para um funcionário.
     */
    static async criarAvaliacao(funcionario, tipoAvaliacaoId) {
        const pool = await getDatabasePool();
        const diasPrazo = tipoAvaliacaoId === 1 ? 45 : 90;
        const dataLimite = new Date(funcionario.DataAdmissao);
        dataLimite.setDate(dataLimite.getDate() + diasPrazo + 15);

        await pool.request()
            .input('userId', sql.Int, funcionario.Id)
            .input('gestorId', sql.Int, funcionario.GestorId)
            .input('matricula', sql.VarChar, funcionario.Matricula)
            .input('dataAdmissao', sql.Date, funcionario.DataAdmissao)
            .input('tipoId', sql.Int, tipoAvaliacaoId)
            .input('dataLimite', sql.Date, dataLimite)
            .query(`
                INSERT INTO Avaliacoes (UserId, GestorId, Matricula, DataAdmissao, TipoAvaliacaoId, DataLimiteResposta, StatusAvaliacao)
                VALUES (@userId, @gestorId, @matricula, @dataAdmissao, @tipoId, @dataLimite, 'Agendada')
            `);
        
        console.log(`-> Avaliação de ${diasPrazo} dias criada para: ${funcionario.NomeCompleto}`);
    }

    /**
     * Busca as avaliações associadas a um usuário (como avaliado ou avaliador).
     */
    static async buscarAvaliacoesUsuario(userId, temPermissaoAdmin) {
        const pool = await getDatabasePool();
        let query = `
            SELECT a.*, t.Nome as TipoAvaliacao, u.NomeCompleto, g.NomeCompleto as NomeGestor
            FROM Avaliacoes a
            JOIN TiposAvaliacao t ON a.TipoAvaliacaoId = t.Id
            JOIN Users u ON a.UserId = u.Id
            LEFT JOIN Users g ON a.GestorId = g.Id
        `;
        if (!temPermissaoAdmin) {
            query += ` WHERE a.UserId = @userId OR a.GestorId = @userId`;
        }
        query += ` ORDER BY a.StatusAvaliacao, a.DataLimiteResposta ASC`;

        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(query);
            
        return result.recordset;
    }
    
    /**
     * Busca uma avaliação específica pelo ID.
     */
    static async getAvaliacao(avaliacaoId) {
        const pool = await getDatabasePool();
        const result = await pool.request()
            .input('id', sql.Int, avaliacaoId)
            .query('SELECT * FROM Avaliacoes WHERE Id = @id');
        return result.recordset[0];
    }

    /**
     * Valida se um usuário pode responder a uma avaliação e retorna os dados da avaliação.
     */
    static async validarPermissaoResposta(avaliacaoId, userId, tipoRespondente) {
        const avaliacao = await this.getAvaliacao(avaliacaoId);

        if (!avaliacao) {
            const err = new Error('Avaliação não encontrada');
            err.statusCode = 404;
            throw err;
        }
        if (avaliacao.StatusAvaliacao !== 'Pendente') {
            const err = new Error(`Esta avaliação está com status "${avaliacao.StatusAvaliacao}" e não pode ser respondida.`);
            err.statusCode = 400;
            throw err;
        }
        if (new Date() > new Date(avaliacao.DataLimiteResposta)) {
            const err = new Error('O prazo para responder esta avaliação expirou.');
            err.statusCode = 400;
            throw err;
        }

        if (tipoRespondente === 'Colaborador' && avaliacao.UserId !== userId) throw new Error('Permissão negada para responder como colaborador.');
        if (tipoRespondente === 'Gestor' && avaliacao.GestorId !== userId) throw new Error('Permissão negada para responder como gestor.');
        if (tipoRespondente === 'Colaborador' && avaliacao.RespostaColaboradorConcluida) throw new Error('Você já concluiu esta avaliação.');
        if (tipoRespondente === 'Gestor' && avaliacao.RespostaGestorConcluida) throw new Error('Você já concluiu esta avaliação como gestor.');

        return avaliacao;
    }

    /**
     * Busca as perguntas que foram salvas para uma avaliação específica no momento da sua criação.
     */
    static async buscarPerguntasAvaliacao(avaliacaoId) {
        const pool = await getDatabasePool();
        const result = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .query('SELECT * FROM PerguntasSalvasAvaliacao WHERE AvaliacaoId = @avaliacaoId ORDER BY Ordem');
        return result.recordset;
    }
    
    /**
     * Busca as respostas que um determinado usuário deu para uma avaliação.
     */
    static async buscarRespostasPorUsuario(avaliacaoId, userId) {
        const pool = await getDatabasePool();
        const result = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('userId', sql.Int, userId)
            .query('SELECT * FROM RespostasAvaliacoes WHERE AvaliacaoId = @avaliacaoId AND RespondidoPor = @userId ORDER BY PerguntaId');
        return result.recordset;
    }
    
    /**
     * Busca as respostas da "outra parte" em uma avaliação (a do gestor se quem pede é o colaborador, e vice-versa).
     */
    static async buscarRespostasOutraParte(avaliacaoId, userId) {
        const pool = await getDatabasePool();
        const result = await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('userId', sql.Int, userId)
            .query('SELECT * FROM RespostasAvaliacoes WHERE AvaliacaoId = @avaliacaoId AND RespondidoPor != @userId ORDER BY PerguntaId');
        return result.recordset;
    }

    /**
     * Salva uma resposta individual de uma avaliação no banco de dados.
     */
    static async salvarRespostaAvaliacao(respostaData) {
        const pool = await getDatabasePool();
        const { avaliacaoId, perguntaId, resposta, respondidoPor, tipoRespondente } = respostaData;
        
        await pool.request()
            .input('avaliacaoId', sql.Int, avaliacaoId)
            .input('perguntaId', sql.Int, perguntaId)
            .input('resposta', sql.NText, resposta)
            .input('respondidoPor', sql.Int, respondidoPor)
            .input('tipoRespondente', sql.NVarChar, tipoRespondente)
            .query(`
                INSERT INTO RespostasAvaliacoes (AvaliacaoId, PerguntaId, Resposta, RespondidoPor, TipoRespondente)
                VALUES (@avaliacaoId, @perguntaId, @resposta, @respondidoPor, @tipoRespondente)
            `);
    }

    /**
     * Marca a parte de uma avaliação (do colaborador ou do gestor) como concluída.
     */
    static async concluirAvaliacao(avaliacaoId, tipoRespondente) {
        const pool = await getDatabasePool();
        let campoData = tipoRespondente === 'Colaborador' ? 'DataRespostaColaborador' : 'DataRespostaGestor';
        let campoConcluida = tipoRespondente === 'Colaborador' ? 'RespostaColaboradorConcluida' : 'RespostaGestorConcluida';

        await pool.request()
            .input('id', sql.Int, avaliacaoId)
            .query(`
                UPDATE Avaliacoes 
                SET ${campoConcluida} = 1, ${campoData} = GETDATE()
                WHERE Id = @id
            `);
        
        const checkCompletion = await pool.request().input('id', sql.Int, avaliacaoId).query('SELECT RespostaColaboradorConcluida, RespostaGestorConcluida FROM Avaliacoes WHERE Id = @id');
        if (checkCompletion.recordset[0].RespostaColaboradorConcluida && checkCompletion.recordset[0].RespostaGestorConcluida) {
            await pool.request().input('id', sql.Int, avaliacaoId).query(`UPDATE Avaliacoes SET StatusAvaliacao = 'Concluída' WHERE Id = @id`);
        }
    }

    /**
     * Busca o questionário padrão (45 ou 90 dias) para exibição.
     */
    static async buscarQuestionarioPadrao(tipo) { // tipo '45' ou '90'
        const pool = await getDatabasePool();
        const tipoId = tipo === '45' ? 1 : 2;
        const result = await pool.request()
            .input('tipoId', sql.Int, tipoId)
            .query(`
                SELECT * FROM PerguntasAvaliacao 
                WHERE TipoAvaliacaoId = @tipoId AND Ativa = 1 
                ORDER BY Ordem
            `);
        return result.recordset;
    }

    /**
     * Atualiza as perguntas de um questionário padrão.
     */
    static async atualizarQuestionarioPadrao(tipo, perguntas) {
        const pool = await getDatabasePool();
        const tipoId = tipo === '45' ? 1 : 2;
        const transaction = new sql.Transaction(pool);
        try {
            await transaction.begin();
            
            await new sql.Request(transaction)
                .input('tipoId', sql.Int, tipoId)
                .query('UPDATE PerguntasAvaliacao SET Ativa = 0 WHERE TipoAvaliacaoId = @tipoId');

            for (let i = 0; i < perguntas.length; i++) {
                const p = perguntas[i];
                await new sql.Request(transaction)
                    .input('tipoId', sql.Int, tipoId)
                    .input('pergunta', sql.NText, p.Pergunta)
                    .input('tipoResposta', sql.NVarChar, p.TipoResposta)
                    .input('ordem', sql.Int, i + 1)
                    .query(`
                        INSERT INTO PerguntasAvaliacao (TipoAvaliacaoId, Pergunta, TipoResposta, Ordem, Ativa)
                        VALUES (@tipoId, @pergunta, @tipoResposta, @ordem, 1)
                    `);
            }
            
            await transaction.commit();
            return { success: true };
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Reabre uma avaliação que foi expirada.
     */
    static async reabrirAvaliacao(avaliacaoId, novaDataLimite) {
         const pool = await getDatabasePool();
         await pool.request()
            .input('id', sql.Int, avaliacaoId)
            .input('novaData', sql.DateTime, novaDataLimite)
            .query(`
                UPDATE Avaliacoes
                SET DataLimiteResposta = @novaData, StatusAvaliacao = 'Pendente', AtualizadoEm = GETDATE()
                WHERE Id = @id AND StatusAvaliacao = 'Expirada'
            `);
    }
}

module.exports = AvaliacoesManager;