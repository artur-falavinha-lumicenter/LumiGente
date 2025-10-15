const sql = require('mssql');
const bcrypt = require('bcrypt');
const { getDatabasePool } = require('../config/db');
const { validarCPF, formatarCPF } = require('../utils/cpfValidator');
const { getHierarchyLevel } = require('../utils/hierarchyHelper');
const HierarchyManager = require('../services/hierarchyManager');

const hierarchyManager = new HierarchyManager();

// POST /api/login
exports.login = async (req, res) => {
    const { cpf, password } = req.body;

    try {
        if (!cpf || !password || !validarCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido ou senha não fornecida' });
        }

        const cpfSemFormatacao = cpf.replace(/[^\d]/g, '');
        const cpfFormatado = formatarCPF(cpf);

        const pool = await getDatabasePool();

        const funcionarioResult = await pool.request()
            .input('cpf', sql.VarChar, cpfSemFormatacao)
            .query(`
                WITH FuncionarioMaisRecente AS (
                    SELECT *, ROW_NUMBER() OVER (ORDER BY 
                            CASE WHEN STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                            DTA_ADMISSAO DESC, MATRICULA DESC
                        ) as rn
                    FROM TAB_HIST_SRA WHERE CPF = @cpf
                )
                SELECT TOP 1 * FROM FuncionarioMaisRecente WHERE rn = 1
            `);

        const funcionario = funcionarioResult.recordset[0];
        if (!funcionario) {
            return res.status(401).json({ error: 'CPF não encontrado na base de funcionários' });
        }
        
        const specialCPFs = process.env.SPECIAL_USERS_CPF ? process.env.SPECIAL_USERS_CPF.split(',').map(c => c.trim()) : [];
        const isSpecialUser = specialCPFs.includes(cpfSemFormatacao);

        if (funcionario.STATUS_GERAL !== 'ATIVO' && !isSpecialUser) {
            return res.status(401).json({ error: 'Funcionário inativo no sistema' });
        }

        let userResult = await pool.request()
            .input('cpfFormatado', sql.VarChar, cpfFormatado)
            .input('cpfSemFormatacao', sql.VarChar, cpfSemFormatacao)
            .query(`SELECT * FROM Users WHERE CPF = @cpfFormatado OR CPF = @cpfSemFormatacao`);

        let user = userResult.recordset[0];

        if (!user) {
            return res.status(401).json({ error: 'Utilizador não encontrado no sistema.', userNotFound: true });
        }

        if (user.FirstLogin === 1 || user.FirstLogin === true) {
            return res.status(200).json({ needsRegistration: true, error: 'Você ainda não possui registo. Crie uma conta primeiro.' });
        }

        if (!user.IsActive) {
            return res.status(401).json({ userInactive: true, error: 'Utilizador inativo. Entre em contacto com o administrador.' });
        }

        if (!user.PasswordHash) {
             return res.status(401).json({ error: 'Senha não configurada. Por favor, complete o seu registo.' });
        }

        const senhaValida = await bcrypt.compare(password, user.PasswordHash);
        if (!senhaValida) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }
        
        const { path: hierarchyPath, departamento: deptoHierarchy } = await hierarchyManager.getHierarchyInfo(funcionario.MATRICULA, funcionario.CPF);
        const departamentoCorreto = deptoHierarchy || funcionario.DEPARTAMENTO;
        
        if (user.Matricula !== funcionario.MATRICULA || user.Departamento !== departamentoCorreto || user.HierarchyPath !== hierarchyPath || user.Filial !== funcionario.FILIAL) {
             await pool.request()
                .input('userId', sql.Int, user.Id)
                .input('matricula', sql.VarChar, funcionario.MATRICULA)
                .input('nomeCompleto', sql.VarChar, funcionario.NOME)
                .input('departamento', sql.VarChar, departamentoCorreto)
                .input('hierarchyPath', sql.VarChar, hierarchyPath)
                .input('filial', sql.VarChar, funcionario.FILIAL)
                .query(`
                    UPDATE Users 
                    SET Matricula = @matricula, NomeCompleto = @nomeCompleto, Departamento = @departamento, 
                        HierarchyPath = @hierarchyPath, Filial = @filial, updated_at = GETDATE()
                    WHERE Id = @userId
                `);
            
            // Atualiza o objeto user para a sessão
            user.Matricula = funcionario.MATRICULA;
            user.NomeCompleto = funcionario.NOME;
            user.Departamento = departamentoCorreto;
            user.HierarchyPath = hierarchyPath;
            user.Filial = funcionario.FILIAL;
        }

        try {
            await pool.request().input('userId', sql.Int, user.Id).query(`UPDATE Users SET LastLogin = GETDATE() WHERE Id = @userId`);
        } catch (err) {
            console.warn("Aviso: Coluna 'LastLogin' não encontrada. Continuando sem atualizar o último login.");
        }

        const hierarchyLevel = getHierarchyLevel(user.HierarchyPath, user.Matricula, user.Departamento);
        let role = 'Funcionário';
        if (hierarchyLevel >= 4) role = 'Diretor';
        else if (hierarchyLevel >= 3) role = 'Gerente';
        else if (hierarchyLevel >= 2) role = 'Coordenador';
        else if (hierarchyLevel >= 1) role = 'Supervisor';

        req.session.user = {
            userId: user.Id,
            userName: user.UserName,
            role: role,
            nomeCompleto: user.NomeCompleto,
            nome: user.NomeCompleto.split(' ')[0],
            departamento: user.Departamento,
            filial: user.Filial,
            cpf: cpfFormatado,
            matricula: user.Matricula,
            hierarchyLevel: hierarchyLevel,
            hierarchyPath: user.HierarchyPath,
        };

        res.json(req.session.user);
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

// POST /api/register
exports.register = async (req, res) => {
    const { cpf, password, nomeCompleto } = req.body;

    try {
        if (!cpf || !password || !validarCPF(cpf) || password.length < 6) {
            return res.status(400).json({ error: 'Dados de registo inválidos.' });
        }

        const cpfFormatado = formatarCPF(cpf);
        const pool = await getDatabasePool();
        
        const existingUserResult = await pool.request()
            .input('cpf', sql.VarChar, cpfFormatado)
            .query(`SELECT Id, FirstLogin FROM Users WHERE CPF = @cpf`);

        if (existingUserResult.recordset.length === 0) {
            return res.status(400).json({ error: 'CPF não encontrado no sistema para registo.' });
        }

        const existingUser = existingUserResult.recordset[0];
        if (existingUser.FirstLogin === 0 || existingUser.FirstLogin === false) {
            return res.status(400).json({ error: 'Utilizador já possui registo realizado.' });
        }

        const senhaHash = await bcrypt.hash(password, 10);
        
        await pool.request()
            .input('cpf', sql.VarChar, cpfFormatado)
            .input('passwordHash', sql.VarChar, senhaHash)
            .input('nomeCompleto', sql.VarChar, nomeCompleto)
            .input('nome', sql.VarChar, nomeCompleto.split(' ')[0])
            .query(`
                UPDATE Users SET PasswordHash = @passwordHash, FirstLogin = 0, NomeCompleto = @nomeCompleto, 
                nome = @nome, IsActive = 1, UpdatedAt = GETDATE()
                WHERE CPF = @cpf
            `);
        
        res.json({ success: true, message: 'Registo realizado com sucesso' });
    } catch (error) {
        console.error('Erro no registo:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

// POST /api/logout
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao destruir sessão:', err);
            return res.status(500).json({ error: 'Erro ao fazer logout' });
        }
        res.clearCookie('lumigente.sid'); // Garante que o cookie seja limpo
        res.json({ success: true, message: 'Logout realizado com sucesso' });
    });
};

// POST /api/check-cpf
exports.checkCpf = async (req, res) => {
    const { cpf } = req.body;
    try {
        if (!cpf || !validarCPF(cpf)) {
            return res.status(400).json({ error: 'CPF inválido' });
        }
        const cpfFormatado = formatarCPF(cpf);
        const pool = await getDatabasePool();
        const userResult = await pool.request()
            .input('cpf', sql.VarChar, cpfFormatado)
            .query(`SELECT Id FROM Users WHERE CPF = @cpf`);

        if (userResult.recordset.length > 0) {
            return res.json({ exists: true, message: 'CPF já registado' });
        }
        
        return res.json({ exists: false, message: 'CPF válido para registo' });
    } catch (error) {
        console.error('Erro ao verificar CPF:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};