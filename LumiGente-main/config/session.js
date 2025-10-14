const session = require('express-session');

const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'lumicenter-feedback-secret',
    resave: false,
    saveUninitialized: false,
    name: 'lumigente.sid', // Nome personalizado para o cookie de sessão
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Usar cookies seguros em produção (HTTPS)
        httpOnly: true, // Impede que o cookie seja acessado por JavaScript no cliente
        maxAge: parseInt(process.env.SESSION_COOKIE_MAX_AGE) || 8 * 60 * 60 * 1000, // Duração da sessão: 8 horas
        sameSite: 'strict' // Proteção contra ataques de falsificação de solicitação entre sites (CSRF)
    },
    rolling: true // Renova o cookie de sessão a cada requisição, resetando o tempo de expiração
};

module.exports = session(sessionConfig);