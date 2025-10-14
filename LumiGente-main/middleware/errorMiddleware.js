/**
 * Middleware para tratar rotas não encontradas (404).
 * Este é o primeiro a ser acionado se nenhuma outra rota corresponder à requisição.
 * @param {object} req - Objeto de requisição do Express.
 * @param {object} res - Objeto de resposta do Express.
 * @param {function} next - Função para chamar o próximo middleware.
 */
const notFound = (req, res, next) => {
    // Cria um novo erro com uma mensagem indicando a rota não encontrada.
    const error = new Error(`Rota não encontrada - ${req.originalUrl}`);
    res.status(404);
    // Passa o erro para o próximo middleware, que será o errorHandler.
    next(error);
};

/**
 * Middleware genérico para tratamento de erros.
 * Ele captura qualquer erro que ocorra nos controllers e envia uma resposta JSON padronizada.
 * Por ter 4 argumentos (err, req, res, next), o Express o reconhece como um middleware de erro.
 * @param {Error} err - O objeto de erro capturado.
 * @param {object} req - Objeto de requisição do Express.
 * @param {object} res - Objeto de resposta do Express.
 * @param {function} next - Função para chamar o próximo middleware (geralmente não usada aqui).
 */
const errorHandler = (err, req, res, next) => {
    // Determina o status code da resposta. Se já foi definido, usa-o, senão, default para 500 (Erro Interno do Servidor).
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);

    // Loga o erro completo no console do servidor para fins de depuração.
    // É importante ter este log para poder investigar problemas em produção.
    console.error('❌ [ERRO CAPTURADO PELO MIDDLEWARE]:', err.stack);

    // Envia a resposta de erro formatada em JSON para o cliente.
    res.json({
        error: err.message,
        // Em ambiente de produção, é uma boa prática de segurança não expor o stack trace do erro.
        // Em desenvolvimento, o stack é útil para depuração.
        stack: process.env.NODE_ENV === 'production' ? '🥞' : err.stack,
    });
};

module.exports = { notFound, errorHandler };