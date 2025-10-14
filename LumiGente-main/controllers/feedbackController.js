const sql = require('mssql');
const { getDatabasePool } = require('../config/db');

// =================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO (Helpers)
// =================================================================

/**
 * Adiciona pontos de gamificação a um usuário por uma ação específica, uma vez por dia.
 * @param {object} pool - A instância do pool de conexão com o banco de dados.
 * @param {number} userId - ID do usuário que receberá os pontos.
 * @param {string} action - Ação que gerou os pontos (ex: 'feedback_enviado').
 * @param {number} points - Quantidade de pontos a serem adicionados.
 * @returns {Promise<object>} - Objeto com o resultado da operação.
 */
async function addPointsToUser(pool, userId, action, points) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const alreadyEarnedResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('today', sql.Date, today)
            .query(`
                SELECT COUNT(*) as count
                FROM Gamification 
                WHERE UserId = @userId AND Action = @action AND CAST(CreatedAt AS DATE) = @today
            `);

        if (alreadyEarnedResult.recordset[0].count > 0) {
            return { success: false, message: 'Você já ganhou pontos por esta ação hoje' };
        }

        await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('points', sql.Int, points)
            .query(`
                INSERT INTO Gamification (UserId, Action, Points, CreatedAt)
                VALUES (@userId, @action, @points, GETDATE())
            `);

        await pool.request()
            .input('userId', sql.Int, userId)
            .input('points', sql.Int, points)
            .query(`
                IF EXISTS (SELECT 1 FROM UserPoints WHERE UserId = @userId)
                    UPDATE UserPoints SET TotalPoints = TotalPoints + @points, LastUpdated = GETDATE() WHERE UserId = @userId
                ELSE
                    INSERT INTO UserPoints (UserId, TotalPoints, LastUpdated) VALUES (@userId, @points, GETDATE())
            `);

        return { success: true, points: points, message: `+${points} pontos por ${action.replace('_', ' ')}!` };
    } catch (error) {
        console.error(`Erro ao adicionar pontos para a ação '${action}':`, error);
        // Não falha a operação principal se a gamificação falhar
        return { success: false, message: 'Erro ao adicionar pontos' };
    }
}


// =================================================================
// CONTROLLERS (Funções exportadas para as rotas)
// =================================================================

/**
 * GET /api/feedbacks/received - Lista os feedbacks recebidos pelo usuário logado.
 */
exports.getReceivedFeedbacks = async (req, res) => {
    try {
        const { search, type, category } = req.query;
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        let query = `
            SELECT f.*, u1.NomeCompleto as from_name, u2.NomeCompleto as to_name,
                   (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count,
                   (SELECT COUNT(*) FROM FeedbackReactions WHERE feedback_id = f.Id AND reaction_type = 'viewed' AND user_id = @userId) as viewed
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE f.to_user_id = @userId
        `;

        const request = pool.request().input('userId', sql.Int, userId);

        if (search) {
            query += " AND (f.message LIKE @search OR u1.NomeCompleto LIKE @search)";
            request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (type) {
            query += " AND f.type = @type";
            request.input('type', sql.NVarChar, type);
        }
        if (category) {
            query += " AND f.category = @category";
            request.input('category', sql.NVarChar, category);
        }

        query += " ORDER BY f.created_at DESC";

        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar feedbacks recebidos:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

/**
 * GET /api/feedbacks/sent - Lista os feedbacks enviados pelo usuário logado.
 */
exports.getSentFeedbacks = async (req, res) => {
    try {
        const { search, type, category } = req.query;
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        let query = `
            SELECT f.*, u1.NomeCompleto as from_name, u2.NomeCompleto as to_name,
                   (SELECT COUNT(*) FROM FeedbackReplies fr WHERE fr.feedback_id = f.Id) as replies_count
            FROM Feedbacks f
            JOIN Users u1 ON f.from_user_id = u1.Id
            JOIN Users u2 ON f.to_user_id = u2.Id
            WHERE f.from_user_id = @userId
        `;
        
        const request = pool.request().input('userId', sql.Int, userId);
        
        if (search) {
            query += " AND (f.message LIKE @search OR u2.NomeCompleto LIKE @search)";
            request.input('search', sql.NVarChar, `%${search}%`);
        }
        if (type) {
            query += " AND f.type = @type";
            request.input('type', sql.NVarChar, type);
        }
        if (category) {
            query += " AND f.category = @category";
            request.input('category', sql.NVarChar, category);
        }

        query += " ORDER BY f.created_at DESC";
        
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar feedbacks enviados:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

/**
 * POST /api/feedbacks - Cria um novo feedback.
 */
exports.createFeedback = async (req, res) => {
    try {
        const { to_user_id, type, category, message } = req.body;
        const from_user_id = req.session.user.userId;

        if (!to_user_id || !type || !category || !message) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        const pool = await getDatabasePool();
        const result = await pool.request()
            .input('from_user_id', sql.Int, from_user_id)
            .input('to_user_id', sql.Int, to_user_id)
            .input('type', sql.NVarChar, type)
            .input('category', sql.NVarChar, category)
            .input('message', sql.NText, message)
            .query(`
                INSERT INTO Feedbacks (from_user_id, to_user_id, type, category, message, created_at)
                OUTPUT INSERTED.Id
                VALUES (@from_user_id, @to_user_id, @type, @category, @message, GETDATE())
            `);

        const pointsResult = await addPointsToUser(pool, from_user_id, 'feedback_enviado', 10);

        res.status(201).json({ 
            success: true, 
            id: result.recordset[0].Id,
            ...pointsResult
        });
    } catch (error) {
        console.error('Erro ao criar feedback:', error);
        res.status(500).json({ error: 'Erro ao criar feedback' });
    }
};

/**
 * GET /api/feedbacks/:id/info - Busca informações básicas de um feedback para o chat.
 */
exports.getFeedbackInfo = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getDatabasePool();
        
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT f.type, f.category, f.message, u1.NomeCompleto as from_name, u2.NomeCompleto as to_name
                FROM Feedbacks f
                JOIN Users u1 ON f.from_user_id = u1.Id
                JOIN Users u2 ON f.to_user_id = u2.Id
                WHERE f.Id = @feedbackId
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Feedback não encontrado' });
        }
        
        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Erro ao buscar info do feedback:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

/**
 * GET /api/feedbacks/:id/messages - Busca todas as mensagens (chat) de um feedback.
 */
exports.getFeedbackMessages = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        // Marcar feedback como visualizado
        await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM FeedbackReactions WHERE feedback_id = @feedbackId AND user_id = @userId AND reaction_type = 'viewed')
                BEGIN
                    INSERT INTO FeedbackReactions (feedback_id, user_id, reaction_type) VALUES (@feedbackId, @userId, 'viewed')
                END
            `);

        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .query(`
                SELECT fr.Id, fr.user_id, fr.reply_text as message, fr.created_at, u.NomeCompleto as user_name, u.nome as user_first_name
                FROM FeedbackReplies fr
                JOIN Users u ON fr.user_id = u.Id
                WHERE fr.feedback_id = @feedbackId
                ORDER BY fr.created_at ASC
            `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar mensagens do chat:', error);
        res.status(500).json({ error: 'Erro ao buscar mensagens' });
    }
};

/**
 * POST /api/feedbacks/:id/messages - Envia uma nova mensagem no chat de um feedback.
 */
exports.postFeedbackMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        const userId = req.session.user.userId;

        if (!message || message.trim() === '') {
            return res.status(400).json({ error: 'A mensagem não pode estar vazia' });
        }

        const pool = await getDatabasePool();
        
        // Inserir a nova mensagem
        const result = await pool.request()
            .input('feedbackId', sql.Int, id)
            .input('userId', sql.Int, userId)
            .input('message', sql.NText, message.trim())
            .query(`
                INSERT INTO FeedbackReplies (feedback_id, user_id, reply_text, created_at)
                OUTPUT INSERTED.Id, INSERTED.created_at
                VALUES (@feedbackId, @userId, @message, GETDATE())
            `);
        
        const newMessage = result.recordset[0];

        // Buscar a mensagem completa com o nome do usuário para retornar ao front-end
        const fullMessageResult = await pool.request()
            .input('messageId', sql.Int, newMessage.Id)
            .query(`
                SELECT fr.Id, fr.user_id, fr.reply_text as message, fr.created_at, u.NomeCompleto as user_name, u.nome as user_first_name
                FROM FeedbackReplies fr
                JOIN Users u ON fr.user_id = u.Id
                WHERE fr.Id = @messageId
            `);

        // Gamificação: Adicionar pontos se o destinatário do feedback original estiver respondendo
        const feedbackInfo = await pool.request().input('feedbackId', sql.Int, id).query('SELECT to_user_id FROM Feedbacks WHERE Id = @feedbackId');
        let pointsResult = {};
        if (feedbackInfo.recordset[0]?.to_user_id === userId) {
            pointsResult = await addPointsToUser(pool, userId, 'feedback_respondido', 10);
        }
        
        res.status(201).json({
            success: true,
            message: fullMessageResult.recordset[0],
            ...pointsResult
        });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Erro ao enviar mensagem' });
    }
};

/**
 * POST /api/feedbacks/messages/:messageId/react - Adiciona ou remove uma reação a uma mensagem do chat.
 */
exports.reactToMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { emoji } = req.body;
        const userId = req.session.user.userId;

        if (!emoji) {
            return res.status(400).json({ error: 'Emoji é obrigatório' });
        }

        const pool = await getDatabasePool();
        
        const existingReaction = await pool.request()
            .input('replyId', sql.Int, messageId)
            .input('userId', sql.Int, userId)
            .input('emoji', sql.NVarChar, emoji)
            .query(`SELECT Id FROM FeedbackReplyReactions WHERE reply_id = @replyId AND user_id = @userId AND emoji = @emoji`);

        if (existingReaction.recordset.length > 0) {
            // Remove a reação
            await pool.request()
                .input('reactionId', sql.Int, existingReaction.recordset[0].Id)
                .query(`DELETE FROM FeedbackReplyReactions WHERE Id = @reactionId`);
            res.json({ success: true, action: 'removed', emoji });
        } else {
            // Adiciona a reação
            await pool.request()
                .input('replyId', sql.Int, messageId)
                .input('userId', sql.Int, userId)
                .input('emoji', sql.NVarChar, emoji)
                .query(`INSERT INTO FeedbackReplyReactions (reply_id, user_id, emoji) VALUES (@replyId, @userId, @emoji)`);
            res.json({ success: true, action: 'added', emoji });
        }
    } catch (error) {
        console.error('Erro ao reagir à mensagem:', error);
        res.status(500).json({ error: 'Erro ao reagir à mensagem' });
    }
};


/**
 * GET /api/filters - Retorna os tipos e categorias de feedback existentes para usar em filtros.
 */
exports.getFeedbackFilters = async (req, res) => {
    try {
        const pool = await getDatabasePool();

        const typesPromise = pool.request().query(`SELECT DISTINCT type FROM Feedbacks WHERE type IS NOT NULL ORDER BY type`);
        const categoriesPromise = pool.request().query(`SELECT DISTINCT category FROM Feedbacks WHERE category IS NOT NULL ORDER BY category`);

        const [typesResult, categoriesResult] = await Promise.all([typesPromise, categoriesPromise]);

        res.json({
            types: typesResult.recordset.map(r => r.type),
            categories: categoriesResult.recordset.map(r => r.category)
        });
    } catch (error) {
        console.error('Erro ao buscar filtros de feedback:', error);
        res.status(500).json({ error: 'Erro ao buscar filtros' });
    }
};