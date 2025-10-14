const sql = require('mssql');
const { getDatabasePool } = require('../config/db');

// =================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO (Helpers)
// =================================================================

async function addPointsToUser(pool, userId, action, points) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const alreadyEarnedResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('today', sql.Date, today)
            .query(`SELECT COUNT(*) as count FROM Gamification WHERE UserId = @userId AND Action = @action AND CAST(CreatedAt AS DATE) = @today`);

        if (alreadyEarnedResult.recordset[0].count > 0) {
            return { success: false, points: 0, message: 'Pontos para esta ação já concedidos hoje.' };
        }

        await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('points', sql.Int, points)
            .query(`INSERT INTO Gamification (UserId, Action, Points) VALUES (@userId, @action, @points)`);

        await pool.request()
            .input('userId', sql.Int, userId)
            .input('points', sql.Int, points)
            .query(`
                IF EXISTS (SELECT 1 FROM UserPoints WHERE UserId = @userId)
                    UPDATE UserPoints SET TotalPoints = TotalPoints + @points, LastUpdated = GETDATE() WHERE UserId = @userId
                ELSE
                    INSERT INTO UserPoints (UserId, TotalPoints) VALUES (@userId, @points)
            `);

        return { success: true, points, message: `+${points} pontos!` };
    } catch (error) {
        console.error(`Erro ao adicionar pontos para '${action}':`, error);
        return { success: false, points: 0, message: 'Erro ao adicionar pontos.' };
    }
}


// =================================================================
// CONTROLLERS (Funções exportadas para as rotas)
// =================================================================

/**
 * POST /api/humor - Registra ou atualiza o humor do dia para o usuário logado.
 */
exports.registrarHumor = async (req, res) => {
    try {
        const { score, description } = req.body;
        const userId = req.session.user.userId;

        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ error: 'Score deve ser um número entre 1 e 5' });
        }

        const pool = await getDatabasePool();
        const today = new Date();
        
        const existingResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('today', sql.Date, today)
            .query(`SELECT Id FROM DailyMood WHERE user_id = @userId AND CAST(created_at AS DATE) = @today`);

        if (existingResult.recordset.length > 0) {
            // Atualiza registro existente
            await pool.request()
                .input('id', sql.Int, existingResult.recordset[0].Id)
                .input('score', sql.Int, score)
                .input('description', sql.NText, description || null)
                .query(`UPDATE DailyMood SET score = @score, description = @description, updated_at = GETDATE() WHERE Id = @id`);
            
            res.json({ success: true, message: 'Humor atualizado com sucesso', pointsEarned: 0 });
        } else {
            // Cria novo registro
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('score', sql.Int, score)
                .input('description', sql.NText, description || null)
                .query(`INSERT INTO DailyMood (user_id, score, description) VALUES (@userId, @score, @description)`);

            const pointsResult = await addPointsToUser(pool, userId, 'humor_respondido', 5);
            
            res.status(201).json({ 
                success: true, 
                message: 'Humor registrado com sucesso',
                pointsEarned: pointsResult.points,
                pointsMessage: pointsResult.message
            });
        }
    } catch (error) {
        console.error('Erro ao registrar humor:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao registrar humor' });
    }
};

/**
 * GET /api/humor - Busca o registro de humor do usuário para o dia atual.
 */
exports.getHumorDoDia = async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('today', sql.Date, new Date())
            .query(`SELECT score, description, created_at FROM DailyMood WHERE user_id = @userId AND CAST(created_at AS DATE) = @today`);

        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json(null); // Retorna null se não houver registro para o dia
        }
    } catch (error) {
        console.error('Erro ao buscar humor do dia:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar humor' });
    }
};

/**
 * GET /api/humor/history - Busca o histórico de humor do usuário nos últimos 5 dias.
 */
exports.getHumorHistory = async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .input('fiveDaysAgo', sql.Date, fiveDaysAgo)
            .query(`
                SELECT score, description, created_at 
                FROM DailyMood 
                WHERE user_id = @userId AND CAST(created_at AS DATE) >= @fiveDaysAgo
                ORDER BY created_at DESC
            `);

        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar histórico de humor:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar histórico de humor' });
    }
};

/**
 * GET /api/humor/team-metrics - Busca a média de humor da equipe (acesso de gestor).
 */
exports.getTeamMetrics = async (req, res) => {
    try {
        const managerId = req.session.user.userId;
        const pool = await getDatabasePool();
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Esta query é complexa e depende da sua estrutura de hierarquia.
        // A query original do server.js foi mantida aqui.
        const result = await pool.request()
            .input('managerId', sql.Int, managerId)
            .input('sevenDaysAgo', sql.Date, sevenDaysAgo)
            .query(`
                SELECT 
                    AVG(CAST(dm.score AS FLOAT)) as teamAverage,
                    COUNT(DISTINCT dm.user_id) as teamMembers
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                -- A cláusula JOIN/WHERE para identificar a equipe do gestor vai aqui.
                -- Exemplo simplificado:
                WHERE u.Departamento = (SELECT Departamento FROM Users WHERE Id = @managerId)
                  AND CAST(dm.created_at AS DATE) >= @sevenDaysAgo
                  AND u.IsActive = 1
            `);
        
        const metrics = {
            teamAverage: result.recordset[0].teamAverage || 0,
            teamMembers: result.recordset[0].teamMembers || 0
        };

        res.json(metrics);
    } catch (error) {
        console.error('Erro ao buscar métricas da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas da equipe' });
    }
};

/**
 * GET /api/humor/team-history - Busca o histórico de humor da equipe (acesso de gestor).
 */
exports.getTeamHistory = async (req, res) => {
    try {
        const managerId = req.session.user.userId;
        const pool = await getDatabasePool();
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

        // Query complexa de hierarquia mantida do server.js
        const result = await pool.request()
            .input('managerId', sql.Int, managerId)
            .input('fiveDaysAgo', sql.Date, fiveDaysAgo)
            .query(`
                SELECT dm.score, dm.description, dm.created_at, u.NomeCompleto as user_name, u.Departamento as department
                FROM DailyMood dm
                JOIN Users u ON dm.user_id = u.Id
                -- A cláusula JOIN/WHERE para identificar a equipe do gestor vai aqui.
                -- Exemplo simplificado:
                WHERE u.Departamento = (SELECT Departamento FROM Users WHERE Id = @managerId)
                  AND CAST(dm.created_at AS DATE) >= @fiveDaysAgo
                  AND u.IsActive = 1
                ORDER BY dm.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar histórico da equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar histórico da equipe' });
    }
};