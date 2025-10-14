const sql = require('mssql');
const { getDatabasePool } = require('../config/db');

/**
 * Atualiza o status das pesquisas no novo sistema (tabela Surveys) e no sistema legado.
 * - 'Agendada' -> 'Ativa' quando a data de início é alcançada.
 * - 'Ativa' -> 'Encerrada' quando a data de encerramento é ultrapassada.
 */
async function updatePesquisaStatus() {
    try {
        const pool = await getDatabasePool();
        const now = new Date();
        let changed = false;

        // --- NOVO SISTEMA DE PESQUISAS (Tabela Surveys) ---
        // Ativar pesquisas agendadas
        const ativarResult = await pool.request().query(`
            UPDATE Surveys 
            SET status = 'Ativa'
            WHERE status = 'Agendada' AND data_inicio IS NOT NULL AND data_inicio <= GETDATE()
        `);
        if (ativarResult.rowsAffected[0] > 0) {
            console.log(`🕒 [JOB] ${ativarResult.rowsAffected[0]} nova(s) pesquisa(s) foram ativadas.`);
            changed = true;
        }

        // Encerrar pesquisas ativas que passaram do prazo
        const encerrarResult = await pool.request().query(`
            UPDATE Surveys 
            SET status = 'Encerrada'
            WHERE status = 'Ativa' AND data_encerramento IS NOT NULL AND data_encerramento <= GETDATE()
        `);
        if (encerrarResult.rowsAffected[0] > 0) {
            console.log(`🕒 [JOB] ${encerrarResult.rowsAffected[0]} pesquisa(s) foram encerradas.`);
            changed = true;
        }
        
        if (changed) {
             const nowStr = new Date().toLocaleTimeString('pt-BR');
             console.log(`🕒 [${nowStr}] Status das pesquisas verificado e atualizado.`);
        }

    } catch (error) {
        // Ignora erro se a tabela 'Surveys' não existir ainda
        if (!error.message.toLowerCase().includes("invalid object name 'surveys'")) {
            console.error('❌ [JOB] Erro ao atualizar status das pesquisas:', error);
        }
    }
}


/**
 * Atualiza o status dos objetivos com base em suas datas.
 * - 'Agendado' -> 'Ativo' quando a data de início é alcançada.
 * - 'Ativo' -> 'Expirado' quando a data de fim é ultrapassada.
 */
async function updateObjetivoStatus() {
    try {
        const pool = await getDatabasePool();

        // Ativar objetivos agendados
        const ativarResult = await pool.request().query(`
            UPDATE Objetivos 
            SET status = 'Ativo', updated_at = GETDATE()
            WHERE status = 'Agendado' AND data_inicio <= GETDATE()
        `);
        
        if (ativarResult.rowsAffected[0] > 0) {
            console.log(`🎯 [JOB] ${ativarResult.rowsAffected[0]} objetivo(s) foram ativados automaticamente.`);
        }

        // Expirar objetivos ativos que passaram do prazo
        const expirarResult = await pool.request().query(`
            UPDATE Objetivos 
            SET status = 'Expirado', updated_at = GETDATE()
            WHERE status = 'Ativo' AND data_fim < GETDATE()
        `);

        if (expirarResult.rowsAffected[0] > 0) {
            console.log(`🎯 [JOB] ${expirarResult.rowsAffected[0]} objetivo(s) foram marcados como expirados.`);
        }
    } catch (error) {
         // Ignora erro se a tabela 'Objetivos' não existir ainda
        if (!error.message.toLowerCase().includes("invalid object name 'objetivos'")) {
            console.error('❌ [JOB] Erro ao atualizar status dos objetivos:', error);
        }
    }
}


module.exports = {
    updatePesquisaStatus,
    updateObjetivoStatus
};