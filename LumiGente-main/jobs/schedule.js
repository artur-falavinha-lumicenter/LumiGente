const schedule = require('node-schedule');
const sql = require('mssql');
const { getDatabasePool } = require('../config/db');
const { updatePesquisaStatus, updateObjetivoStatus } = require('./updateStatus'); // Funções de atualização
const AvaliacoesManager = require('../services/avaliacoesManager');

/**
 * Função para verificar e criar avaliações de experiência automaticamente.
 * Executada diariamente.
 */
async function verificarAvaliacoesAutomaticamente() {
    try {
        console.log('📋 [JOB] Executando verificação automática de criação de avaliações...');
        const pool = await getDatabasePool();
        const resultado = await AvaliacoesManager.verificarECriarAvaliacoes(pool);
        console.log('✅ [JOB] Verificação automática de avaliações concluída:', resultado);
    } catch (error) {
        console.error('❌ [JOB] Erro na verificação automática de avaliações:', error);
    }
}

/**
 * Função para atualizar o status de avaliações (Agendada -> Pendente, Pendente -> Expirada).
 * Executada diariamente à meia-noite.
 */
async function verificarStatusAvaliacoes() {
    try {
        console.log('📅 [JOB] Executando verificação de status de avaliações (expiradas/pendentes)...');
        const pool = await getDatabasePool();

        // PASSO 1: Mudar avaliações AGENDADAS para PENDENTE quando chega o período
        const resultAgendada45 = await pool.request().query(`
            UPDATE Avaliacoes SET StatusAvaliacao = 'Pendente', AtualizadoEm = GETDATE()
            WHERE StatusAvaliacao = 'Agendada' AND TipoAvaliacaoId = 1 AND DATEDIFF(DAY, DataAdmissao, GETDATE()) >= 45
        `);
        if (resultAgendada45.rowsAffected[0] > 0) {
            console.log(`   -> ${resultAgendada45.rowsAffected[0]} avaliação(ões) de 45 dias ativadas.`);
        }

        const resultAgendada90 = await pool.request().query(`
            UPDATE Avaliacoes SET StatusAvaliacao = 'Pendente', AtualizadoEm = GETDATE()
            WHERE StatusAvaliacao = 'Agendada' AND TipoAvaliacaoId = 2 AND DATEDIFF(DAY, DataAdmissao, GETDATE()) >= 90
        `);
        if (resultAgendada90.rowsAffected[0] > 0) {
            console.log(`   -> ${resultAgendada90.rowsAffected[0]} avaliação(ões) de 90 dias ativadas.`);
        }

        // PASSO 2: Marcar avaliações PENDENTES como EXPIRADAS quando passa o prazo
        const resultExpirada = await pool.request().query(`
            UPDATE Avaliacoes SET StatusAvaliacao = 'Expirada', AtualizadoEm = GETDATE()
            WHERE StatusAvaliacao = 'Pendente' AND DataLimiteResposta < GETDATE()
        `);
        if (resultExpirada.rowsAffected[0] > 0) {
            console.log(`   -> ${resultExpirada.rowsAffected[0]} avaliação(ões) marcadas como expiradas.`);
        }
    } catch (error) {
        console.error('❌ [JOB] Erro ao verificar status de avaliações:', error);
    }
}


/**
 * Inicializa e configura todas as tarefas agendadas da aplicação.
 */
function setupScheduledJobs() {
    console.log('⏰ Configurando tarefas agendadas...');

    // --- Job de Atualização de Status de Pesquisas (a cada minuto) ---
    // Executa uma vez na inicialização e depois a cada minuto.
    console.log('🔄 [PESQUISAS] Executando primeira verificação de status...');
    updatePesquisaStatus();
    setInterval(updatePesquisaStatus, 60 * 1000); // Roda a cada 60 segundos
    console.log('   -> Tarefa de status de pesquisas agendada para rodar a cada minuto.');

    // --- Job de Atualização de Status de Objetivos (diariamente) ---
    const objetivoCheckTime = process.env.OBJETIVO_CHECK_TIME || '0 0 * * *'; // Meia-noite
    console.log('🔄 [OBJETIVOS] Executando primeira verificação de status...');
    updateObjetivoStatus();
    schedule.scheduleJob(objetivoCheckTime, updateObjetivoStatus);
    console.log(`   -> Tarefa de status de objetivos agendada para: ${objetivoCheckTime}`);

    // --- Job de Criação de Avaliações de Experiência (diariamente às 08:00) ---
    const avaliacaoCreateTime = '0 8 * * *'; // Todo dia às 08:00
    console.log('🔄 [AVALIAÇÕES] Executando primeira verificação para criação de avaliações...');
    setTimeout(verificarAvaliacoesAutomaticamente, 10000); // Roda 10s após o início
    schedule.scheduleJob(avaliacaoCreateTime, verificarAvaliacoesAutomaticamente);
    console.log(`   -> Tarefa de criação de avaliações agendada para: ${avaliacaoCreateTime}`);

    // --- Job de Atualização de Status de Avaliações (diariamente à meia-noite) ---
    const avaliacaoStatusTime = '0 0 * * *'; // Meia-noite
    console.log('🔄 [AVALIAÇÕES] Executando primeira verificação de status de avaliações...');
    setTimeout(verificarStatusAvaliacoes, 15000); // Roda 15s após o início
    schedule.scheduleJob(avaliacaoStatusTime, verificarStatusAvaliacoes);
    console.log(`   -> Tarefa de status de avaliações agendada para: ${avaliacaoStatusTime}`);

    console.log('✅ Todas as tarefas agendadas foram configuradas.');
}

module.exports = setupScheduledJobs;