const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    driver: process.env.DB_DRIVER,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITH_ABORT === 'true',
        requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT) || 30000,
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000,
        pool: {
            max: parseInt(process.env.DB_POOL_MAX) || 10,
            min: parseInt(process.env.DB_POOL_MIN) || 0,
            idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000
        }
    }
};

let pool;

async function getDatabasePool() {
    if (pool) {
        return pool;
    }
    try {
        pool = await sql.connect(dbConfig);
        console.log('✅ Conectado ao SQL Server');
        return pool;
    } catch (error) {
        console.error('❌ Erro ao conectar ao SQL Server:', error);
        process.exit(1); // Encerrar a aplicação se não conseguir conectar
    }
}

module.exports = { getDatabasePool };