const sql = require('mssql');
const { getDatabasePool } = require('../config/db');
const AnalyticsManager = require('../services/analyticsManager');
const HierarchyManager = require('../services/hierarchyManager');

// Instancia os services para serem usados pelo controller
const analyticsManager = new AnalyticsManager();
const hierarchyManager = new HierarchyManager();

/**
 * GET /api/metrics - Retorna métricas simples para o dashboard do usuário individual.
 */
exports.getUserMetrics = async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        const feedbacksResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE to_user_id = @userId AND created_at >= DATEADD(day, -30, GETDATE())
            `);

        const recognitionsResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Recognitions 
                WHERE to_user_id = @userId AND created_at >= DATEADD(day, -30, GETDATE())
            `);

        const sentFeedbacksResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT COUNT(*) as count FROM Feedbacks 
                WHERE from_user_id = @userId AND created_at >= DATEADD(day, -30, GETDATE())
            `);

        res.json({
            feedbacksReceived: feedbacksResult.recordset[0].count || 0,
            recognitionsReceived: recognitionsResult.recordset[0].count || 0,
            feedbacksSent: sentFeedbacksResult.recordset[0].count || 0,
        });
    } catch (error) {
        console.error('Erro ao buscar métricas do usuário:', error);
        res.status(500).json({ error: 'Erro ao buscar métricas' });
    }
};

/**
 * GET /api/analytics/dashboard - Retorna um dashboard completo com todos os indicadores.
 */
exports.getCompleteDashboard = async (req, res) => {
    try {
        const { period = 30, department, userId } = req.query;
        const currentUser = req.session.user;

        // O AnalyticsManager já lida com a lógica de permissão internamente
        const dashboardData = await analyticsManager.getCompleteDashboard(
            currentUser,
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            userId ? parseInt(userId) : null
        );

        res.json(dashboardData);
    } catch (error) {
        console.error('Erro ao buscar dashboard completo:', error);
        res.status(500).json({ error: 'Erro ao buscar dashboard completo' });
    }
};

/**
 * GET /api/analytics/rankings - Retorna os rankings de usuários.
 */
exports.getUserRankings = async (req, res) => {
    try {
        const { period = 30, department, topUsers = 50 } = req.query;
        
        const rankings = await analyticsManager.getUserRankings(
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            parseInt(topUsers)
        );

        res.json(rankings);
    } catch (error) {
        console.error('Erro ao buscar rankings:', error);
        res.status(500).json({ error: 'Erro ao buscar rankings' });
    }
};

/**
 * GET /api/analytics/gamification-leaderboard - Retorna o leaderboard de gamificação.
 */
exports.getGamificationLeaderboard = async (req, res) => {
    try {
        const { period = 30, department, topUsers = 100 } = req.query;
        
        const leaderboard = await analyticsManager.getGamificationLeaderboard(
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            parseInt(topUsers)
        );

        res.json(leaderboard);
    } catch (error) {
        console.error('Erro ao buscar leaderboard de gamificação:', error);
        res.status(500).json({ error: 'Erro ao buscar leaderboard de gamificação' });
    }
};

/**
 * GET /api/analytics/department-analytics - Retorna dados de analytics agrupados por departamento.
 */
exports.getDepartmentAnalytics = async (req, res) => {
    try {
        const { period = 30 } = req.query;
        const currentUser = req.session.user;

        const deptAnalytics = await analyticsManager.getDepartmentAnalytics(
            currentUser,
            parseInt(period)
        );

        res.json(deptAnalytics);
    } catch (error) {
        console.error('Erro ao buscar analytics por departamento:', error);
        res.status(500).json({ error: 'Erro ao buscar analytics por departamento' });
    }
};

/**
 * GET /api/analytics/trends - Retorna dados de tendências para gráficos.
 */
exports.getTrendAnalytics = async (req, res) => {
    try {
        const { period = 30, department } = req.query;
        const currentUser = req.session.user;

        const trends = await analyticsManager.getTrendAnalytics(
            currentUser,
            parseInt(period),
            department && department !== 'Todos' ? department : null
        );

        res.json(trends);
    } catch (error) {
        console.error('Erro ao buscar tendências:', error);
        res.status(500).json({ error: 'Erro ao buscar tendências' });
    }
};

/**
 * GET /api/analytics/export - Exporta dados de analytics em formato CSV ou Excel.
 */
exports.exportAnalytics = async (req, res) => {
    try {
        const { period = 30, department, format = 'excel' } = req.query;
        const currentUser = req.session.user;

        const dataBuffer = await analyticsManager.exportAnalyticsData(
            currentUser,
            parseInt(period),
            department && department !== 'Todos' ? department : null,
            format
        );

        const filename = `relatorio_analytics_${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : 'csv'}`;
        
        if (format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        } else {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        }
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(dataBuffer);

    } catch (error) {
        console.error('Erro ao exportar relatório de analytics:', error);
        res.status(500).json({ error: 'Erro ao exportar relatório' });
    }
};


/**
 * GET /api/manager/team-management - Retorna uma lista detalhada dos membros da equipe para gestão.
 */
exports.getTeamManagementData = async (req, res) => {
    try {
        const currentUser = req.session.user;
        const { status, departamento } = req.query;

        // Usar HierarchyManager para obter os IDs dos usuários acessíveis
        const accessibleUsers = await hierarchyManager.getAccessibleUsers(currentUser, {
            department: departamento && departamento !== 'Todos' ? departamento : null
        });
        
        // Inclui o próprio gestor na lista para visualização
        const allUserIds = [...new Set([currentUser.userId, ...accessibleUsers.map(user => user.userId)])];
        
        if (allUserIds.length === 0) {
            return res.json([]);
        }

        const teamMembers = await analyticsManager.getTeamManagementDetails(allUserIds, status);

        res.json(teamMembers);
    } catch (error) {
        console.error('Erro ao buscar dados de gestão de equipe:', error);
        res.status(500).json({ error: 'Erro ao buscar dados de gestão de equipe' });
    }
};

/**
 * GET /api/manager/employee-info/:employeeId - Retorna informações de um colaborador específico.
 */
exports.getEmployeeInfo = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const pool = await getDatabasePool();
        
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`SELECT Id, NomeCompleto, Departamento, LastLogin, IsActive FROM Users WHERE Id = @employeeId`);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Colaborador não encontrado' });
        }
        
        res.json(result.recordset[0]);
    } catch (error) {
        console.error('Erro ao buscar dados do colaborador:', error);
        res.status(500).json({ error: 'Erro ao buscar dados do colaborador' });
    }
};

/**
 * GET /api/manager/employee-feedbacks/:employeeId - Retorna feedbacks de um colaborador.
 */
exports.getEmployeeFeedbacks = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const pool = await getDatabasePool();
        
        const result = await pool.request()
            .input('employeeId', sql.Int, employeeId)
            .query(`
                SELECT f.*, u1.NomeCompleto as from_name, u2.NomeCompleto as to_name,
                       CASE WHEN f.to_user_id = @employeeId THEN 'received' ELSE 'sent' END as direction
                FROM Feedbacks f
                JOIN Users u1 ON f.from_user_id = u1.Id
                JOIN Users u2 ON f.to_user_id = u2.Id
                WHERE f.to_user_id = @employeeId OR f.from_user_id = @employeeId
                ORDER BY f.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar feedbacks do colaborador:', error);
        res.status(500).json({ error: 'Erro ao buscar feedbacks do colaborador' });
    }
};