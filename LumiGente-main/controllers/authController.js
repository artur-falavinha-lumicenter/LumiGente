// LumiGente-main/controllers/authController.js

// Importa o serviço que contém a lógica de negócio
const authService = require('../services/authService.js');

/**
 * @description Realiza o login do usuário.
 * @route POST /api/login
 */
exports.login = async (req, res) => {
    try {
        const { cpf, password } = req.body;
        
        // 1. Chama o serviço para executar a lógica de login
        const result = await authService.loginUser(cpf, password);

        // 2. O serviço retorna se o usuário precisa se registrar
        if (result.needsRegistration) {
            return res.status(200).json(result);
        }

        // 3. Se o login for bem-sucedido, cria a sessão do usuário
        req.session.user = result;

        // 4. Retorna os dados do usuário para o frontend
        res.status(200).json(result);

    } catch (error) {
        // 5. Em caso de erro (ex: senha errada), retorna o status e a mensagem de erro do serviço
        console.error('Erro no controller de login:', error.message);
        res.status(401).json({ error: error.message });
    }
};

/**
 * @description Registra um novo usuário no sistema.
 * @route POST /api/register
 */
exports.register = async (req, res) => {
    try {
        const { cpf, password, nomeCompleto } = req.body;
        
        // Chama o serviço para executar a lógica de registro
        const result = await authService.registerUser({ cpf, password, nomeCompleto });
        
        // Retorna sucesso (201 Created)
        res.status(201).json(result);

    } catch (error) {
        console.error('Erro no controller de registro:', error.message);
        // Retorna erro (400 Bad Request) com a mensagem específica
        res.status(400).json({ error: error.message });
    }
};

/**
 * @description Realiza o logout do usuário, destruindo a sessão.
 * @route POST /api/logout
 */
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao destruir a sessão:', err);
            return res.status(500).json({ error: 'Erro ao fazer logout' });
        }
        
        // Limpa o cookie e envia a resposta de sucesso
        res.clearCookie('lumigente.sid');
        res.status(200).json({ success: true, message: 'Logout realizado com sucesso' });
    });
};

/**
 * @description Verifica se um CPF é válido para cadastro.
 * @route POST /api/check-cpf
 */
exports.checkCpf = async (req, res) => {
    try {
        const { cpf } = req.body;
        
        // Chama o serviço para verificar o CPF
        const result = await authService.checkCpfStatus(cpf);
        
        res.status(200).json(result);
    } catch (error) {
        console.error('Erro no controller de verificação de CPF:', error.message);
        res.status(400).json({ error: error.message });
    }
};