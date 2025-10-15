const sql = require('mssql');
const { getDatabasePool } = require('../config/db'); // Importa a função de conexão centralizada
const HierarchyManager = require('./hierarchyManager'); // Importa o HierarchyManager já refatorado

class SincronizadorDadosExternos {
    constructor() {
        // Construtor agora é limpo e não depende de 'dbConfig'.
        // O HierarchyManager também não precisa mais de config no seu construtor.
        this.hierarchyManager = new HierarchyManager();
        this.isRunning = false;
        this.syncInterval = null;
    }

    /**
     * Inicia o processo de sincronização automática em um intervalo definido.
     * @param {number} intervalMinutes - O intervalo em minutos entre cada sincronização.
     */
    async startAutoSync(intervalMinutes = 30) {
        if (this.isRunning) {
            console.log('🔄 Sincronizador já está em execução.');
            return;
        }

        this.isRunning = true;
        console.log(`🔄 Sincronizador automático iniciado (intervalo: ${intervalMinutes} minutos)`);

        // Executa a primeira sincronização imediatamente
        await this.syncAllData();

        // Agenda as próximas execuções
        this.syncInterval = setInterval(async () => {
            await this.syncAllData();
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Para a sincronização automática.
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.isRunning = false;
        console.log('⏸️ Sincronizador automático parado.');
    }

    /**
     * Orquestra a execução de todas as tarefas de sincronização.
     */
    async syncAllData() {
        console.log('\n================================================');
        console.log(`[SYNC START] Início do ciclo: ${new Date().toLocaleString('pt-BR')}`);
        try {
            await this.syncFuncionarios();
            console.log(`[SYNC END] Ciclo concluído com sucesso: ${new Date().toLocaleString('pt-BR')}`);
        } catch (error) {
            console.error('\n❌ Erro fatal durante o ciclo de sincronização:', error);
        }
        console.log('================================================\n');
    }

    /**
     * Sincroniza os dados dos funcionários entre o banco de dados externo e o da aplicação.
     * Esta é a lógica central do seu sincronizador original.
     */
    async syncFuncionarios() {
        const pool = await getDatabasePool(); // Usa a conexão centralizada
        
        try {
            console.log('👥 Sincronizando funcionários...');

            // 1. Busca os registros de funcionários mais relevantes do banco externo
            console.log('   - Buscando funcionários priorizados da fonte de dados externa...');
            const funcionariosExternosResult = await pool.request().query(`
                WITH FuncionarioPriorizado AS (
                    SELECT *,
                        ROW_NUMBER() OVER (
                            PARTITION BY CPF
                            ORDER BY
                                CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                                CASE WHEN SITUACAO_FOLHA = '' OR SITUACAO_FOLHA IS NULL THEN 0 ELSE 1 END,
                                DTA_ADMISSAO DESC,
                                MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA
                    WHERE CPF IS NOT NULL AND CPF != ''
                )
                SELECT CPF, MATRICULA, DEPARTAMENTO, FILIAL, NOME, STATUS_GERAL
                FROM FuncionarioPriorizado
                WHERE rn = 1
                ORDER BY CPF;
            `);
            const funcionariosExternos = funcionariosExternosResult.recordset;
            console.log(`   - ${funcionariosExternos.length} registros únicos de funcionários encontrados para processar.`);

            let criados = 0, atualizados = 0, inativados = 0, erros = 0;

            // 2. Processa cada funcionário encontrado
            for (let i = 0; i < funcionariosExternos.length; i++) {
                const func = funcionariosExternos[i];
                if (i > 0 && i % 200 === 0) {
                    console.log(`   - Processando ${i}/${funcionariosExternos.length}...`);
                }
                try {
                    const userCheck = await pool.request().input('cpf', sql.VarChar, func.CPF).query('SELECT Id, Matricula, Departamento, NomeCompleto, Filial FROM Users WHERE CPF = @cpf');
                    
                    if (userCheck.recordset.length > 0) { // Usuário já existe
                        const userAtual = userCheck.recordset[0];
                        if (func.STATUS_GERAL === 'ATIVO') {
                             if (userAtual.Matricula !== func.MATRICULA || userAtual.NomeCompleto !== func.NOME || userAtual.Departamento !== func.DEPARTAMENTO || userAtual.Filial !== func.FILIAL) {
                                await this.atualizarUsuario(pool, func);
                                atualizados++;
                            }
                        }
                    } else { // Usuário não existe
                        if (func.STATUS_GERAL === 'ATIVO') {
                            await this.criarUsuario(pool, func);
                            criados++;
                        }
                    }
                } catch (error) {
                    console.error(`   - ❌ Erro ao processar CPF ${func.CPF}:`, error.message);
                    erros++;
                }
            }

            // 3. Inativa usuários que estão na base da aplicação, mas não estão mais ativos na base externa
            console.log('   - Verificando usuários para inativação...');
            const inativacaoResult = await pool.request().query(`
                UPDATE Users 
                SET IsActive = 0, updated_at = GETDATE()
                WHERE IsActive = 1
                  AND CPF NOT IN (SELECT CPF FROM TAB_HIST_SRA WHERE STATUS_GERAL = 'ATIVO')
            `);
            inativados = inativacaoResult.rowsAffected[0];

            console.log('\n📈 Resultados da sincronização de funcionários:');
            console.log(`   ✨ Novos: ${criados}`);
            console.log(`   🔄 Atualizados: ${atualizados}`);
            console.log(`   ⏸️ Inativados: ${inativados}`);
            if (erros > 0) console.log(`   ❌ Erros: ${erros}`);

        } catch (error) {
            console.error('❌ Erro crítico no método syncFuncionarios:', error);
            throw error;
        }
    }

    /**
     * Cria um novo usuário na base de dados da aplicação.
     */
    async criarUsuario(pool, func) {
        const { path, departamento } = await this.hierarchyManager.getHierarchyInfo(func.MATRICULA, func.CPF);
        const descricaoDepartamento = await this.buscarDescricaoDepartamento(pool, departamento);
        const primeiroNome = func.NOME ? func.NOME.split(' ')[0] : func.MATRICULA;

        await pool.request()
            .input('cpf', sql.VarChar, func.CPF)
            .input('matricula', sql.VarChar, func.MATRICULA)
            .input('nome', sql.VarChar, primeiroNome)
            .input('nomeCompleto', sql.VarChar, func.NOME)
            .input('departamento', sql.VarChar, departamento)
            .input('descricaoDepartamento', sql.VarChar, descricaoDepartamento)
            .input('filial', sql.VarChar, func.FILIAL)
            .input('hierarchyPath', sql.VarChar, path)
            .query(`
                INSERT INTO Users (CPF, UserName, Matricula, nome, NomeCompleto, Departamento, DescricaoDepartamento, Filial, HierarchyPath, IsActive, FirstLogin, created_at, updated_at) 
                VALUES (@cpf, @cpf, @matricula, @nome, @nomeCompleto, @departamento, @descricaoDepartamento, @filial, @hierarchyPath, 1, 1, GETDATE(), GETDATE())
            `);
    }

    /**
     * Atualiza os dados de um usuário existente na aplicação.
     */
    async atualizarUsuario(pool, func) {
        const { path, departamento } = await this.hierarchyManager.getHierarchyInfo(func.MATRICULA, func.CPF);
        const descricaoDepartamento = await this.buscarDescricaoDepartamento(pool, departamento);
        const primeiroNome = func.NOME ? func.NOME.split(' ')[0] : func.MATRICULA;

        await pool.request()
            .input('cpf', sql.VarChar, func.CPF)
            .input('matricula', sql.VarChar, func.MATRICULA)
            .input('nome', sql.VarChar, primeiroNome)
            .input('nomeCompleto', sql.VarChar, func.NOME)
            .input('departamento', sql.VarChar, departamento)
            .input('descricaoDepartamento', sql.VarChar, descricaoDepartamento)
            .input('filial', sql.VarChar, func.FILIAL)
            .input('hierarchyPath', sql.VarChar, path)
            .query(`
                UPDATE Users 
                SET 
                    Matricula = @matricula, nome = @nome, NomeCompleto = @nomeCompleto,
                    Departamento = @departamento, DescricaoDepartamento = @descricaoDepartamento,
                    Filial = @filial, HierarchyPath = @hierarchyPath, IsActive = 1, updated_at = GETDATE()
                WHERE CPF = @cpf
            `);
    }

    /**
     * Busca a descrição de um departamento na tabela de hierarquia.
     */
    async buscarDescricaoDepartamento(pool, departamento) {
        if (!departamento || departamento.trim() === '') return 'Não definido';

        try {
            const result = await pool.request()
                .input('departamento', sql.VarChar, departamento)
                .query(`SELECT TOP 1 DESCRICAO_ATUAL FROM HIERARQUIA_CC WHERE TRIM(DEPTO_ATUAL) = TRIM(@departamento) ORDER BY LEN(HIERARQUIA_COMPLETA) DESC`);

            return result.recordset.length > 0 ? result.recordset[0].DESCRICAO_ATUAL : departamento;
        } catch (error) {
            console.error(`   - ⚠️ Erro ao buscar descrição do depto ${departamento}:`, error.message);
            return departamento; // Retorna o código como fallback
        }
    }
}

module.exports = SincronizadorDadosExternos;