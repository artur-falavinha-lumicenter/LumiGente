const sql = require('mssql');
const { getDatabasePool } = require('../config/db'); // Importa a conexão centralizada
const NodeCache = require('node-cache');
const ExcelJS = require('exceljs');

class AnalyticsManager {
    constructor() {
        // O construtor agora é mais simples e não depende de injeção de dependência
        this.cache = new NodeCache({ stdTTL: 300 }); // Cache de 5 minutos
    }

    /**
     * Obtém o pool de conexão do banco de dados de forma centralizada.
     * @returns {Promise<sql.ConnectionPool>}
     */
    async getPool() {
        return await getDatabasePool();
    }

    /**
     * Retorna um dashboard completo com os principais indicadores de performance.
     */
    async getCompleteDashboard(currentUser, period = 30, department = null, userId = null) {
        const cacheKey = `dashboard_${period}_${department || 'all'}_${userId || 'all'}`;
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
            console.log('CACHE HIT:', cacheKey);
            return cachedData;
        }
        console.log('CACHE MISS:', cacheKey);

        const performance = await this.getPerformanceIndicators(currentUser, period, department);
        const rankings = {
            topUsers: await this.getUserRankings(period, department, 5),
            gamification: await this.getGamificationLeaderboard(period, department, 5)
        };
        const departments = await this.getDepartmentAnalytics(currentUser, period);
        const trends = await this.getTrendAnalytics(currentUser, period, department);
        const satisfaction = await this.getSatisfactionMetrics(period, department);
        const userMetrics = userId ? await this.getUserEngagementMetrics(userId, period) : null;

        const dashboardData = {
            performance,
            rankings,
            departments,
            trends,
            satisfaction,
            userMetrics,
            period,
            department: department || 'Todos',
            generatedAt: new Date().toISOString()
        };

        this.cache.set(cacheKey, dashboardData);
        return dashboardData;
    }

    /**
     * Retorna o ranking de usuários com base no engajamento.
     */
    async getUserRankings(period = 30, department = null, topUsers = 50) {
        const pool = await this.getPool();
        let query = `
            SELECT TOP ${topUsers}
                u.Id as userId, u.NomeCompleto, u.Departamento,
                COUNT(DISTINCT f_sent.Id) as feedbacks_enviados,
                COUNT(DISTINCT r_sent.Id) as reconhecimentos_enviados,
                COUNT(DISTINCT dm.Id) as humor_registrado,
                (COUNT(DISTINCT f_sent.Id) * 10) + (COUNT(DISTINCT r_sent.Id) * 5) + (COUNT(DISTINCT dm.Id) * 2) as score
            FROM Users u
            LEFT JOIN Feedbacks f_sent ON u.Id = f_sent.from_user_id AND f_sent.created_at >= DATEADD(day, -@period, GETDATE())
            LEFT JOIN Recognitions r_sent ON u.Id = r_sent.from_user_id AND r_sent.created_at >= DATEADD(day, -@period, GETDATE())
            LEFT JOIN DailyMood dm ON u.Id = dm.user_id AND dm.created_at >= DATEADD(day, -@period, GETDATE())
            WHERE u.IsActive = 1
        `;

        const request = pool.request().input('period', sql.Int, period);
        if (department) {
            query += ` AND u.Departamento = @department`;
            request.input('department', sql.NVarChar, department);
        }
        query += ` GROUP BY u.Id, u.NomeCompleto, u.Departamento ORDER BY score DESC`;
        
        const result = await request.query(query);
        return result.recordset;
    }

    /**
     * Retorna o leaderboard de gamificação com base nos pontos.
     */
    async getGamificationLeaderboard(period = 30, department = null, topUsers = 100) {
        const pool = await this.getPool();
        let query = `
            SELECT TOP ${topUsers}
                u.Id as userId, u.NomeCompleto, u.Departamento, up.TotalPoints as total_pontos
            FROM UserPoints up
            JOIN Users u ON up.UserId = u.Id
            WHERE u.IsActive = 1
        `;

        const request = pool.request();
        if (department) {
            query += ` AND u.Departamento = @department`;
            request.input('department', sql.NVarChar, department);
        }
        query += ` ORDER BY up.TotalPoints DESC`;
        
        const result = await request.query(query);
        return result.recordset;
    }

    /**
     * Retorna métricas de analytics agrupadas por departamento.
     */
    async getDepartmentAnalytics(currentUser, period = 30) {
        const pool = await this.getPool();
        const request = pool.request().input('period', sql.Int, period);

        // A lógica de permissão (ver todos vs. apenas o seu) deve ser aplicada aqui.
        // Este exemplo assume que o currentUser já foi verificado e tem acesso.
        const query = `
            SELECT 
                u.Departamento,
                COUNT(DISTINCT u.Id) as total_usuarios,
                AVG(CAST(dm.score AS FLOAT)) as media_humor,
                COUNT(DISTINCT f.Id) as total_feedbacks,
                COUNT(DISTINCT r.Id) as total_reconhecimentos
            FROM Users u
            LEFT JOIN DailyMood dm ON u.Id = dm.user_id AND dm.created_at >= DATEADD(day, -@period, GETDATE())
            LEFT JOIN Feedbacks f ON u.Id = f.from_user_id AND f.created_at >= DATEADD(day, -@period, GETDATE())
            LEFT JOIN Recognitions r ON u.Id = r.from_user_id AND r.created_at >= DATEADD(day, -@period, GETDATE())
            WHERE u.IsActive = 1
            GROUP BY u.Departamento
            ORDER BY total_usuarios DESC
        `;

        const result = await request.query(query);
        return result.recordset;
    }

    /**
     * Retorna dados de tendências para gráficos (diário e semanal).
     */
    async getTrendAnalytics(currentUser, period = 30, department = null) {
        const pool = await this.getPool();
        let queryFilter = '';
        const request = pool.request().input('period', sql.Int, period);

        if (department) {
            queryFilter += ` AND u.Departamento = @department`;
            request.input('department', sql.NVarChar, department);
        }

        const dailyQuery = `
            SELECT 
                CAST(created_at AS DATE) as date,
                AVG(CAST(score AS FLOAT)) as avg_mood,
                COUNT(*) as entries
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE dm.created_at >= DATEADD(day, -@period, GETDATE()) ${queryFilter}
            GROUP BY CAST(created_at AS DATE)
            ORDER BY date ASC
        `;
        const dailyResult = await request.query(dailyQuery);

        const weeklyQuery = `
            SELECT 
                DATEPART(year, created_at) as year,
                DATEPART(week, created_at) as week,
                AVG(CAST(score AS FLOAT)) as avg_mood,
                COUNT(*) as entries
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE dm.created_at >= DATEADD(day, -@period, GETDATE()) ${queryFilter}
            GROUP BY DATEPART(year, created_at), DATEPART(week, created_at)
            ORDER BY year, week ASC
        `;
        const weeklyResult = await request.query(weeklyQuery);
        
        return { daily: dailyResult.recordset, weekly: weeklyResult.recordset };
    }

    /**
     * Retorna métricas de satisfação, como eNPS.
     */
    async getSatisfactionMetrics(period = 30, department = null) {
        const pool = await this.getPool();
        let query = `
            SELECT
                (SUM(CASE WHEN score >= 4 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as promotores_perc,
                (SUM(CASE WHEN score <= 2 THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as detratores_perc,
                AVG(CAST(score as FLOAT)) as media_humor
            FROM DailyMood dm
            JOIN Users u ON dm.user_id = u.Id
            WHERE dm.created_at >= DATEADD(day, -@period, GETDATE())
        `;
        const request = pool.request().input('period', sql.Int, period);
        if (department) {
            query += ' AND u.Departamento = @department';
            request.input('department', sql.NVarChar, department);
        }
        const result = await request.query(query);
        return result.recordset;
    }

    /**
     * Retorna métricas de engajamento para um usuário específico.
     */
    async getUserEngagementMetrics(userId, period = 30) {
        const pool = await this.getPool();
        const request = pool.request().input('period', sql.Int, period).input('userId', sql.Int, userId);
        const query = `
            SELECT
                (SELECT COUNT(*) FROM Feedbacks WHERE from_user_id = @userId AND created_at >= DATEADD(day, -@period, GETDATE())) as feedbacks_enviados,
                (SELECT COUNT(*) FROM Feedbacks WHERE to_user_id = @userId AND created_at >= DATEADD(day, -@period, GETDATE())) as feedbacks_recebidos,
                (SELECT COUNT(*) FROM Recognitions WHERE from_user_id = @userId AND created_at >= DATEADD(day, -@period, GETDATE())) as reconhecimentos_enviados,
                (SELECT COUNT(*) FROM Recognitions WHERE to_user_id = @userId AND created_at >= DATEADD(day, -@period, GETDATE())) as reconhecimentos_recebidos,
                (SELECT COUNT(*) FROM DailyMood WHERE user_id = @userId AND created_at >= DATEADD(day, -@period, GETDATE())) as humor_registros
        `;
        const result = await request.query(query);
        return result.recordset[0];
    }

    /**
     * Retorna indicadores gerais de performance da plataforma.
     */
    async getPerformanceIndicators(currentUser, period = 30, department = null) {
        const pool = await this.getPool();
        let queryFilter = '';
        const request = pool.request().input('period', sql.Int, period);
        if (department) {
            queryFilter += ' AND u.Departamento = @department';
            request.input('department', sql.NVarChar, department);
        }
        const query = `
            SELECT
                (SELECT COUNT(DISTINCT user_id) FROM DailyMood dm JOIN Users u ON dm.user_id = u.Id WHERE dm.created_at >= DATEADD(day, -@period, GETDATE()) ${queryFilter}) as usuarios_ativos_humor,
                (SELECT COUNT(DISTINCT from_user_id) FROM Feedbacks f JOIN Users u ON f.from_user_id = u.Id WHERE f.created_at >= DATEADD(day, -@period, GETDATE()) ${queryFilter}) as usuarios_ativos_feedback,
                (SELECT COUNT(*) FROM Users u WHERE u.IsActive = 1 ${queryFilter.replace('dm.', 'u.').replace('f.','u.')}) as total_usuarios
        `;
        const result = await request.query(query);
        return result.recordset[0];
    }
    
    /**
     * Busca detalhes de uma equipe para a página de gestão.
     */
    async getTeamManagementDetails(userIds, status) {
        if (!userIds || userIds.length === 0) return [];
        const pool = await this.getPool();
        let query = `
            SELECT u.Id, u.NomeCompleto, u.Departamento, u.LastLogin, u.IsActive,
                   (SELECT AVG(CAST(score AS FLOAT)) FROM DailyMood WHERE user_id = u.Id AND created_at >= DATEADD(day, -30, GETDATE())) as lastMood,
                   (SELECT COUNT(*) FROM Feedbacks WHERE to_user_id = u.Id AND created_at >= DATEADD(day, -30, GETDATE())) as recentFeedbacks,
                   (SELECT COUNT(*) FROM Objetivos WHERE responsavel_id = u.Id AND status = 'Ativo') as activeObjectives
            FROM Users u
            WHERE u.Id IN (${userIds.join(',')})
        `;
        if (status === 'ativo') query += ' AND u.IsActive = 1';
        if (status === 'inativo') query += ' AND u.IsActive = 0';
        query += ' ORDER BY u.NomeCompleto';
        
        const result = await pool.request().query(query);
        return result.recordset;
    }

    /**
     * Exporta dados de analytics para um arquivo (Excel/CSV).
     */
    async exportAnalyticsData(currentUser, period = 30, department = null, format = 'excel') {
        const pool = await this.getPool();
        const request = pool.request().input('period', sql.Int, period);
        let queryFilter = '';
        if (department) {
            queryFilter += ' AND u.Departamento = @department';
            request.input('department', sql.NVarChar, department);
        }
        
        const result = await request.query(`
            SELECT 
                u.NomeCompleto, u.Departamento,
                (SELECT COUNT(*) FROM Feedbacks WHERE to_user_id = u.Id AND created_at >= DATEADD(day, -@period, GETDATE())) as FeedbacksRecebidos,
                (SELECT COUNT(*) FROM Feedbacks WHERE from_user_id = u.Id AND created_at >= DATEADD(day, -@period, GETDATE())) as FeedbacksEnviados,
                (SELECT COUNT(*) FROM Recognitions WHERE to_user_id = u.Id AND created_at >= DATEADD(day, -@period, GETDATE())) as ReconhecimentosRecebidos,
                (SELECT COUNT(*) FROM Recognitions WHERE from_user_id = u.Id AND created_at >= DATEADD(day, -@period, GETDATE())) as ReconhecimentosEnviados,
                (SELECT COUNT(*) FROM DailyMood WHERE user_id = u.Id AND created_at >= DATEADD(day, -@period, GETDATE())) as EntradasHumor,
                (SELECT AVG(CAST(score AS FLOAT)) FROM DailyMood WHERE user_id = u.Id AND created_at >= DATEADD(day, -@period, GETDATE())) as HumorMedio
            FROM Users u
            WHERE u.IsActive = 1 ${queryFilter}
            GROUP BY u.Id, u.NomeCompleto, u.Departamento
            ORDER BY u.NomeCompleto
        `);

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Relatório de Analytics');
            worksheet.columns = [
                { header: 'Nome', key: 'NomeCompleto', width: 30 },
                { header: 'Departamento', key: 'Departamento', width: 25 },
                { header: 'Feedbacks Recebidos', key: 'FeedbacksRecebidos', width: 20 },
                { header: 'Feedbacks Enviados', key: 'FeedbacksEnviados', width: 20 },
                { header: 'Reconhecimentos Recebidos', key: 'ReconhecimentosRecebidos', width: 25 },
                { header: 'Reconhecimentos Enviados', key: 'ReconhecimentosEnviados', width: 25 },
                { header: 'Entradas de Humor', key: 'EntradasHumor', width: 20 },
                { header: 'Humor Médio', key: 'HumorMedio', width: 15, style: { numFmt: '0.00' } }
            ];
            worksheet.addRows(result.recordset);
            const buffer = await workbook.xlsx.writeBuffer();
            return buffer;
        } else { // CSV
            let csv = 'Nome,Departamento,Feedbacks Recebidos,Feedbacks Enviados,Reconhecimentos Recebidos,Reconhecimentos Enviados,Entradas de Humor,Humor Médio\n';
            result.recordset.forEach(row => {
                csv += `"${row.NomeCompleto}","${row.Departamento}",${row.FeedbacksRecebidos},${row.FeedbacksEnviados},${row.ReconhecimentosRecebidos},${row.ReconhecimentosEnviados},${row.EntradasHumor},${(row.HumorMedio || 0).toFixed(2)}\n`;
            });
            return Buffer.from(csv, 'utf-8');
        }
    }
    
    // Funções de gerenciamento de cache
    clearCache() {
        this.cache.flushAll();
        console.log('Cache do AnalyticsManager limpo.');
    }

    getCacheStats() {
        return this.cache.getStats();
    }
}

module.exports = AnalyticsManager;