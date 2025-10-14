const sql = require('mssql');

class AnalyticsManager {
    constructor(dbConfig) {
        this.dbConfig = dbConfig;
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutos
    }

    // Função para obter pool de conexão com retry
    async getPool() {
        try {
            return await sql.connect(this.dbConfig);
        } catch (error) {
            console.error('Erro ao conectar com banco:', error);
            throw error;
        }
    }

    // Função para limpar cache expirado
    clearExpiredCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTimeout) {
                this.cache.delete(key);
            }
        }
    }

    // Função para obter dados do cache ou executar query
    async getCachedData(key, queryFunction) {
        this.clearExpiredCache();
        
        if (this.cache.has(key)) {
            const cached = this.cache.get(key);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }

        const data = await queryFunction();
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });

        return data;
    }

    // Rankings de usuários
    async getUserRankings(period = 30, department = null, topUsers = 50) {
        const cacheKey = `rankings_${period}_${department}_${topUsers}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .input('TopUsers', sql.Int, topUsers)
                .execute('sp_GetUserRankings');
            
            return result.recordset;
        });
    }

    // Analytics por departamento
    async getDepartmentAnalytics(period = 30, department = null) {
        const cacheKey = `dept_analytics_${period}_${department}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .execute('sp_GetDepartmentAnalytics');
            
            return result.recordset;
        });
    }

    // Métricas de engajamento por usuário
    async getUserEngagementMetrics(userId = null, period = 30, department = null) {
        const cacheKey = `engagement_${userId}_${period}_${department}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('UserId', sql.Int, userId)
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .execute('sp_GetUserEngagementMetrics');
            
            return result.recordset;
        });
    }

    // Análise de tendências
    async getTrendAnalytics(period = 30, department = null) {
        const cacheKey = `trends_${period}_${department}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .execute('sp_GetTrendAnalytics');
            
            // Retorna múltiplos resultados
            const datasets = [];
            for (let i = 0; i < result.recordsets.length; i++) {
                datasets.push(result.recordsets[i]);
            }
            
            return {
                daily: datasets[0] || [],
                weekly: datasets[1] || []
            };
        });
    }

    // Leaderboard de gamificação
    async getGamificationLeaderboard(period = 30, department = null, topUsers = 100) {
        const cacheKey = `gamification_${period}_${department}_${topUsers}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .input('TopUsers', sql.Int, topUsers)
                .execute('sp_GetGamificationLeaderboard');
            
            return result.recordset;
        });
    }

    // Métricas de satisfação
    async getSatisfactionMetrics(period = 30, department = null) {
        const cacheKey = `satisfaction_${period}_${department}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .execute('sp_GetSatisfactionMetrics');
            
            return result.recordset;
        });
    }

    // Indicadores de performance gerais
    async getPerformanceIndicators(period = 30, department = null) {
        const cacheKey = `performance_${period}_${department}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const pool = await this.getPool();
            const result = await pool.request()
                .input('Period', sql.Int, period)
                .input('Department', sql.NVarChar, department)
                .execute('sp_GetPerformanceIndicators');
            
            return result.recordset[0];
        });
    }

    // Dashboard completo com todos os indicadores
    async getCompleteDashboard(period = 30, department = null, userId = null) {
        const cacheKey = `dashboard_${period}_${department}_${userId}`;
        
        return await this.getCachedData(cacheKey, async () => {
            const [
                performance,
                rankings,
                deptAnalytics,
                trends,
                satisfaction,
                gamification
            ] = await Promise.all([
                this.getPerformanceIndicators(period, department),
                this.getUserRankings(period, department, 10),
                this.getDepartmentAnalytics(period, department),
                this.getTrendAnalytics(period, department),
                this.getSatisfactionMetrics(period, department),
                this.getGamificationLeaderboard(period, department, 10)
            ]);

            // Dados do usuário específico se fornecido
            let userMetrics = null;
            if (userId) {
                const userEngagement = await this.getUserEngagementMetrics(userId, period, department);
                userMetrics = userEngagement[0] || null;
            }

            return {
                performance,
                rankings: {
                    topUsers: rankings,
                    gamification: gamification
                },
                departments: deptAnalytics,
                trends,
                satisfaction,
                userMetrics,
                period,
                department,
                generatedAt: new Date().toISOString()
            };
        });
    }

    // Atualizar rankings mensais
    async updateUserRankings(month = null, year = null) {
        try {
            const pool = await this.getPool();
            await pool.request()
                .input('Month', sql.Int, month)
                .input('Year', sql.Int, year)
                .execute('sp_UpdateUserRankings');
            
            // Limpar cache relacionado a rankings
            for (const [key] of this.cache.entries()) {
                if (key.includes('rankings') || key.includes('gamification')) {
                    this.cache.delete(key);
                }
            }
            
            return { success: true, message: 'Rankings atualizados com sucesso' };
        } catch (error) {
            console.error('Erro ao atualizar rankings:', error);
            throw error;
        }
    }

    // Exportar dados para relatório
    async exportAnalyticsData(period = 30, department = null, format = 'json') {
        const data = await this.getCompleteDashboard(period, department);
        
        if (format === 'csv') {
            return this.convertToCSV(data);
        }
        
        return data;
    }

    // Converter dados para CSV
    convertToCSV(data) {
        const csvRows = [];
        
        // Headers
        csvRows.push(['Métrica', 'Valor', 'Departamento', 'Período']);
        
        // Performance indicators
        if (data.performance) {
            Object.entries(data.performance).forEach(([key, value]) => {
                csvRows.push([key, value, data.department || 'Todos', data.period + ' dias']);
            });
        }
        
        // Rankings
        if (data.rankings.topUsers) {
            csvRows.push([]);
            csvRows.push(['Ranking - Top Usuários']);
            csvRows.push(['Rank', 'Nome', 'Departamento', 'Pontos', 'Lumicoins']);
            
            data.rankings.topUsers.forEach((user, index) => {
                csvRows.push([
                    index + 1,
                    user.NomeCompleto,
                    user.Departamento,
                    user.TotalPoints,
                    user.LumicoinBalance
                ]);
            });
        }
        
        return csvRows.map(row => row.join(',')).join('\n');
    }

    // Limpar cache
    clearCache() {
        this.cache.clear();
        console.log('Cache de analytics limpo');
    }

    // Obter estatísticas do cache
    getCacheStats() {
        this.clearExpiredCache();
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys()),
            timeout: this.cacheTimeout
        };
    }
}

module.exports = AnalyticsManager;
