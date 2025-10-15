// LumiGente-main/services/authService.js

const sql = require('mssql');
const bcrypt = require('bcrypt');
const { getDatabasePool } = require('../config/db');
const { validarCPF, formatarCPF } = require('../utils/cpfValidator');
const { getHierarchyLevel } = require('../utils/hierarchyHelper');
const HierarchyManager = require('./hierarchyManager');

const hierarchyManager = new HierarchyManager();

/**
 * Lógica de negócio para realizar o login de um usuário.
 */
exports.loginUser = async (cpf, password) => {
    if (!cpf || !password || !validarCPF(cpf)) {
        throw new Error('CPF inválido ou senha não fornecida');
    }

    const cpfSemFormatacao = cpf.replace(/[^\d]/g, '');
    const cpfFormatado = formatarCPF(cpf);

    const pool = await getDatabasePool();

    // 1. Busca o funcionário mais recente na base de dados externa
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
        throw new Error('CPF não encontrado na base de funcionários');
    }

    // 2. Verifica se é um usuário especial ou se está ativo
    const specialCPFs = process.env.SPECIAL_USERS_CPF ? process.env.SPECIAL_USERS_CPF.split(',').map(c => c.trim()) : [];
    const isSpecialUser = specialCPFs.includes(cpfSemFormatacao);

    if (funcionario.STATUS_GERAL !== 'ATIVO' && !isSpecialUser) {
        throw new Error('Funcionário inativo no sistema');
    }

    // 3. Busca o usuário no sistema LumiGente
    let userResult = await pool.request()
        .input('cpfFormatado', sql.VarChar, cpfFormatado)
        .input('cpfSemFormatacao', sql.VarChar, cpfSemFormatacao)
        .query(`SELECT * FROM Users WHERE CPF = @cpfFormatado OR CPF = @cpfSemFormatacao`);

    let user = userResult.recordset[0];

    if (!user) {
        throw new Error('Usuário não encontrado no sistema.');
    }

    // 4. Verifica status do usuário no sistema LumiGente
    if (user.FirstLogin === 1 || user.FirstLogin === true) {
        return { needsRegistration: true, error: 'Você ainda não possui registro. Crie uma conta primeiro.' };
    }
    if (!user.IsActive) {
        throw new Error('Usuário inativo. Entre em contato com o administrador.');
    }
    if (!user.PasswordHash) {
        throw new Error('Senha não configurada. Por favor, complete o seu registro.');
    }

    // 5. Compara a senha
    const senhaValida = await bcrypt.compare(password, user.PasswordHash);
    if (!senhaValida) {
        throw new Error('Senha incorreta');
    }

    // 6. Sincroniza dados do usuário (se necessário)
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
                UPDATE Users SET Matricula = @matricula, NomeCompleto = @nomeCompleto, Departamento = @departamento, 
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

    // 7. Atualiza o último login
    try {
        await pool.request().input('userId', sql.Int, user.Id).query(`UPDATE Users SET LastLogin = GETDATE() WHERE Id = @userId`);
    } catch (err) {
        console.warn("Aviso: Coluna 'LastLogin' não encontrada. Continuando...");
    }

    // 8. Monta e retorna o objeto do usuário para a sessão
    const hierarchyLevel = getHierarchyLevel(user.HierarchyPath, user.Matricula, user.Departamento);
    let role = 'Funcionário';
    if (hierarchyLevel >= 4) role = 'Diretor';
    else if (hierarchyLevel >= 3) role = 'Gerente';
    else if (hierarchyLevel >= 2) role = 'Coordenador';
    else if (hierarchyLevel >= 1) role = 'Supervisor';

    return {
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
};

/**
 * Lógica de negócio para registrar um novo usuário.
 */
exports.registerUser = async ({ cpf, password, nomeCompleto }) => {
    if (!cpf || !password || !validarCPF(cpf) || password.length < 6) {
        throw new Error('Dados de registro inválidos.');
    }

    const cpfFormatado = formatarCPF(cpf);
    const pool = await getDatabasePool();

    const existingUserResult = await pool.request()
        .input('cpf', sql.VarChar, cpfFormatado)
        .query(`SELECT Id, FirstLogin FROM Users WHERE CPF = @cpf`);

    if (existingUserResult.recordset.length === 0) {
        throw new Error('CPF não encontrado no sistema para registro.');
    }

    const existingUser = existingUserResult.recordset[0];
    if (existingUser.FirstLogin === 0 || existingUser.FirstLogin === false) {
        throw new Error('Usuário já possui registro realizado.');
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

    return { success: true, message: 'Registro realizado com sucesso' };
};

/**
 * Lógica de negócio para verificar o status de um CPF.
 */
exports.checkCpfStatus = async (cpf) => {
    if (!cpf || !validarCPF(cpf)) {
        throw new Error('CPF inválido');
    }

    const cpfFormatado = formatarCPF(cpf);
    const pool = await getDatabasePool();
    const userResult = await pool.request()
        .input('cpf', sql.VarChar, cpfFormatado)
        .query(`SELECT Id FROM Users WHERE CPF = @cpf`);

    if (userResult.recordset.length > 0) {
        return { exists: true, message: 'CPF já registrado' };
    }

    return { exists: false, message: 'CPF válido para registro' };
};