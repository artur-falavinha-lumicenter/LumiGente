const sql = require('mssql');
const { getDatabasePool } = require('../config/db');

// =================================================================
// FUNÇÕES DE LÓGICA DE NEGÓCIO (Helpers)
// =================================================================

/**
 * Garante que as tabelas necessárias para o sistema de objetivos existam no banco de dados.
 * @param {object} pool - A instância do pool de conexão com o banco de dados.
 */
async function ensureObjetivosTablesExist(pool) {
    try {
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Objetivos')
            BEGIN
                CREATE TABLE Objetivos (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    titulo NVARCHAR(255) NOT NULL,
                    descricao NTEXT,
                    responsavel_id INT,
                    criado_por INT NOT NULL,
                    data_inicio DATE NOT NULL,
                    data_fim DATE NOT NULL,
                    status NVARCHAR(50) DEFAULT 'Ativo',
                    progresso DECIMAL(5,2) DEFAULT 0,
                    created_at DATETIME DEFAULT GETDATE(),
                    updated_at DATETIME DEFAULT GETDATE()
                );
            END;

            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ObjetivoCheckins')
            BEGIN
                CREATE TABLE ObjetivoCheckins (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    objetivo_id INT NOT NULL,
                    user_id INT NOT NULL,
                    progresso DECIMAL(5,2) NOT NULL,
                    observacoes NTEXT,
                    created_at DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (objetivo_id) REFERENCES Objetivos(Id) ON DELETE CASCADE
                );
            END;

            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ObjetivoResponsaveis')
            BEGIN
                CREATE TABLE ObjetivoResponsaveis (
                    Id INT IDENTITY(1,1) PRIMARY KEY,
                    objetivo_id INT NOT NULL,
                    responsavel_id INT NOT NULL,
                    created_at DATETIME DEFAULT GETDATE(),
                    FOREIGN KEY (objetivo_id) REFERENCES Objetivos(Id) ON DELETE CASCADE,
                    UNIQUE (objetivo_id, responsavel_id)
                );
            END;
        `);
    } catch (error) {
        console.error('Erro ao verificar/criar tabelas de objetivos:', error.message);
        throw new Error('Falha ao inicializar as tabelas de objetivos.');
    }
}

async function addPointsToUser(pool, userId, action, points) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const alreadyEarnedResult = await pool.request()
            .input('userId', sql.Int, userId)
            .input('action', sql.VarChar, action)
            .input('today', sql.Date, today)
            .query(`SELECT COUNT(*) as count FROM Gamification WHERE UserId = @userId AND Action = @action AND CAST(CreatedAt AS DATE) = @today`);

        if (alreadyEarnedResult.recordset[0].count > 0) {
            return { success: false, points: 0, message: 'Pontos já concedidos hoje.' };
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
                    UPDATE UserPoints SET TotalPoints = TotalPoints + @points WHERE UserId = @userId
                ELSE
                    INSERT INTO UserPoints (UserId, TotalPoints) VALUES (@userId, @points)
            `);
            
        return { success: true, points, message: `+${points} pontos!` };
    } catch (err) {
        console.error(`Erro ao adicionar pontos para '${action}':`, err);
        return { success: false, points: 0, message: 'Erro ao adicionar pontos.' };
    }
}


// =================================================================
// CONTROLLERS (Funções exportadas para as rotas)
// =================================================================

/**
 * POST /api/objetivos - Cria um novo objetivo.
 */
exports.createObjetivo = async (req, res) => {
    try {
        const { titulo, descricao, responsaveis_ids, data_inicio, data_fim } = req.body;
        const criado_por = req.session.user.userId;

        if (!titulo || !responsaveis_ids || responsaveis_ids.length === 0 || !data_inicio || !data_fim) {
            return res.status(400).json({ error: 'Título, responsável(is), data de início e data de fim são obrigatórios.' });
        }

        const pool = await getDatabasePool();
        await ensureObjetivosTablesExist(pool);

        const status = new Date(data_inicio) > new Date() ? 'Agendado' : 'Ativo';

        const objetivoResult = await pool.request()
            .input('titulo', sql.NVarChar, titulo)
            .input('descricao', sql.NText, descricao || '')
            .input('data_inicio', sql.Date, data_inicio)
            .input('data_fim', sql.Date, data_fim)
            .input('criado_por', sql.Int, criado_por)
            .input('status', sql.NVarChar, status)
            .input('primeiroResponsavel', sql.Int, responsaveis_ids[0])
            .query(`
                INSERT INTO Objetivos (titulo, descricao, data_inicio, data_fim, criado_por, status, responsavel_id)
                OUTPUT INSERTED.Id
                VALUES (@titulo, @descricao, @data_inicio, @data_fim, @criado_por, @status, @primeiroResponsavel)
            `);
        
        const objetivoId = objetivoResult.recordset[0].Id;

        for (const responsavelId of responsaveis_ids) {
            await pool.request()
                .input('objetivoId', sql.Int, objetivoId)
                .input('responsavelId', sql.Int, responsavelId)
                .query(`INSERT INTO ObjetivoResponsaveis (objetivo_id, responsavel_id) VALUES (@objetivoId, @responsavelId)`);
        }

        res.status(201).json({ success: true, id: objetivoId, message: 'Objetivo criado com sucesso.' });
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao criar objetivo.' });
    }
};

/**
 * GET /api/objetivos - Lista os objetivos do usuário e de sua equipe.
 */
exports.getObjetivos = async (req, res) => {
    try {
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();
        await ensureObjetivosTablesExist(pool);

        const result = await pool.request()
            .input('userId', sql.Int, userId)
            .query(`
                SELECT DISTINCT o.*, u.NomeCompleto as responsavel_nome, c.NomeCompleto as criador_nome
                FROM Objetivos o
                LEFT JOIN ObjetivoResponsaveis orl ON orl.objetivo_id = o.Id
                LEFT JOIN Users u ON o.responsavel_id = u.Id
                LEFT JOIN Users c ON o.criado_por = c.Id
                WHERE o.criado_por = @userId OR orl.responsavel_id = @userId
                ORDER BY o.created_at DESC
            `);

        for (let objetivo of result.recordset) {
            const responsaveisResult = await pool.request()
                .input('objetivoId', sql.Int, objetivo.Id)
                .query(`
                    SELECT u.Id, u.NomeCompleto 
                    FROM Users u JOIN ObjetivoResponsaveis orr ON u.Id = orr.responsavel_id
                    WHERE orr.objetivo_id = @objetivoId
                `);
            objetivo.shared_responsaveis = responsaveisResult.recordset;
        }

        res.json(result.recordset);
    } catch (error) {
        if (error.message.includes("Invalid object name")) {
            console.warn("Tabelas de objetivos não encontradas, retornando array vazio.");
            return res.json([]);
        }
        console.error('Erro ao buscar objetivos:', error);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar objetivos.' });
    }
};

/**
 * GET /api/objetivos/:id - Busca um objetivo específico por ID.
 */
exports.getObjetivoById = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getDatabasePool();
        
        const result = await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`
                SELECT o.*, u.NomeCompleto as responsavel_nome, c.NomeCompleto as criador_nome
                FROM Objetivos o
                LEFT JOIN Users u ON o.responsavel_id = u.Id
                LEFT JOIN Users c ON o.criado_por = c.Id
                WHERE o.Id = @objetivoId
            `);
        
        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        
        const objetivo = result.recordset[0];

        // Buscar responsáveis compartilhados
        const responsaveisResult = await pool.request()
            .input('objetivoId', sql.Int, objetivo.Id)
            .query(`SELECT u.Id, u.NomeCompleto FROM Users u JOIN ObjetivoResponsaveis orr ON u.Id = orr.responsavel_id WHERE orr.objetivo_id = @objetivoId`);
        objetivo.shared_responsaveis = responsaveisResult.recordset;

        res.json(objetivo);
    } catch (error) {
        console.error('Erro ao buscar objetivo por ID:', error);
        res.status(500).json({ error: 'Erro ao buscar objetivo' });
    }
};

/**
 * PUT /api/objetivos/:id - Atualiza um objetivo existente.
 */
exports.updateObjetivo = async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, descricao, data_inicio, data_fim, status } = req.body;
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        const objetivoCheck = await pool.request().input('id', sql.Int, id).query(`SELECT criado_por FROM Objetivos WHERE Id = @id`);
        if (objetivoCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        if (objetivoCheck.recordset[0].criado_por !== userId) {
            return res.status(403).json({ error: 'Apenas o criador pode editar o objetivo.' });
        }

        await pool.request()
            .input('id', sql.Int, id)
            .input('titulo', sql.NVarChar, titulo)
            .input('descricao', sql.NText, descricao)
            .input('data_inicio', sql.Date, data_inicio)
            .input('data_fim', sql.Date, data_fim)
            .input('status', sql.NVarChar, status)
            .query(`
                UPDATE Objetivos SET 
                titulo = @titulo, descricao = @descricao, data_inicio = @data_inicio,
                data_fim = @data_fim, status = @status, updated_at = GETDATE()
                WHERE Id = @id
            `);

        res.json({ success: true, message: 'Objetivo atualizado com sucesso' });
    } catch (error) {
        console.error('Erro ao atualizar objetivo:', error);
        res.status(500).json({ error: 'Erro ao atualizar objetivo' });
    }
};

/**
 * DELETE /api/objetivos/:id - Exclui um objetivo.
 */
exports.deleteObjetivo = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.userId;
        const pool = await getDatabasePool();

        const objetivoCheck = await pool.request().input('id', sql.Int, id).query(`SELECT criado_por FROM Objetivos WHERE Id = @id`);
        if (objetivoCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Objetivo não encontrado' });
        }
        if (objetivoCheck.recordset[0].criado_por !== userId) {
            return res.status(403).json({ error: 'Apenas o criador pode excluir o objetivo.' });
        }
        
        // A constraint ON DELETE CASCADE cuidará de excluir os check-ins e responsáveis
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Objetivos WHERE Id = @id');
        
        res.json({ success: true, message: 'Objetivo excluído com sucesso' });
    } catch (error) {
        console.error('Erro ao deletar objetivo:', error);
        res.status(500).json({ error: 'Erro ao deletar objetivo' });
    }
};

/**
 * POST /api/objetivos/:id/checkin - Registra o progresso (check-in) de um objetivo.
 */
exports.createCheckin = async (req, res) => {
    try {
        const { id } = req.params;
        const { progresso, observacoes } = req.body;
        const userId = req.session.user.userId;
        
        const objetivoId = parseInt(id);
        if (isNaN(objetivoId)) return res.status(400).json({ error: 'ID do objetivo inválido' });
        if (progresso === undefined || progresso < 0 || progresso > 100) return res.status(400).json({ error: 'Progresso deve ser entre 0 e 100' });
        
        const pool = await getDatabasePool();
        
        await pool.request()
            .input('objetivoId', sql.Int, objetivoId)
            .input('userId', sql.Int, userId)
            .input('progresso', sql.Decimal(5, 2), progresso)
            .input('observacoes', sql.NText, observacoes || '')
            .query(`INSERT INTO ObjetivoCheckins (objetivo_id, user_id, progresso, observacoes) VALUES (@objetivoId, @userId, @progresso, @observacoes)`);

        await pool.request()
            .input('objetivoId', sql.Int, objetivoId)
            .input('progresso', sql.Decimal(5, 2), progresso)
            .query(`UPDATE Objetivos SET progresso = @progresso, updated_at = GETDATE() WHERE Id = @objetivoId`);

        let statusUpdateMessage = '';
        if (progresso >= 100) {
            await pool.request().input('objetivoId', sql.Int, objetivoId).query(`UPDATE Objetivos SET status = 'Concluído' WHERE Id = @objetivoId`);
            statusUpdateMessage = 'Objetivo concluído!';
        }

        const pointsResult = await addPointsToUser(pool, userId, 'checkin_objetivo', 5);

        res.json({ 
            success: true, 
            message: 'Check-in registrado com sucesso',
            statusUpdate: statusUpdateMessage,
            ...pointsResult
        });
    } catch (error) {
        console.error('Erro ao registrar check-in:', error);
        res.status(500).json({ error: 'Erro ao registrar check-in' });
    }
};

/**
 * GET /api/objetivos/:id/checkins - Lista todos os check-ins de um objetivo.
 */
exports.getCheckins = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getDatabasePool();
        
        const result = await pool.request()
            .input('objetivoId', sql.Int, id)
            .query(`
                SELECT oc.*, u.NomeCompleto as user_name
                FROM ObjetivoCheckins oc
                JOIN Users u ON oc.user_id = u.Id
                WHERE oc.objetivo_id = @objetivoId
                ORDER BY oc.created_at DESC
            `);
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Erro ao buscar check-ins:', error);
        res.status(500).json({ error: 'Erro ao buscar check-ins' });
    }
};