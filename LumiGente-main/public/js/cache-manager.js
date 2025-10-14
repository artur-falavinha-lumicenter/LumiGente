/**
 * Gerenciador de Cache para o Módulo de Histórico
 * Implementa cache local para melhorar performance
 */

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 30 * 60 * 1000; // 30 minutos
        this.maxCacheSize = 50; // Máximo 50 itens no cache
    }

    /**
     * Gera uma chave de cache baseada nos parâmetros
     * @param {string} tipo - Tipo de dados
     * @param {Object} filtros - Filtros aplicados
     * @returns {string} - Chave de cache
     */
    gerarChaveCache(tipo, filtros = {}) {
        const filtrosStr = JSON.stringify(filtros);
        return `${tipo}_${btoa(filtrosStr)}`;
    }

    /**
     * Verifica se um item está no cache e ainda é válido
     * @param {string} chave - Chave do cache
     * @returns {boolean} - True se válido, false caso contrário
     */
    isValido(chave) {
        const item = this.cache.get(chave);
        if (!item) return false;
        
        const agora = Date.now();
        return (agora - item.timestamp) < this.cacheExpiry;
    }

    /**
     * Obtém um item do cache
     * @param {string} chave - Chave do cache
     * @returns {*} - Dados do cache ou null
     */
    obter(chave) {
        if (this.isValido(chave)) {
            console.log(`Cache hit para: ${chave}`);
            return this.cache.get(chave).dados;
        }
        
        console.log(`Cache miss para: ${chave}`);
        return null;
    }

    /**
     * Armazena um item no cache
     * @param {string} chave - Chave do cache
     * @param {*} dados - Dados para armazenar
     */
    armazenar(chave, dados) {
        // Remove itens antigos se o cache estiver cheio
        if (this.cache.size >= this.maxCacheSize) {
            this.limparItensAntigos();
        }

        this.cache.set(chave, {
            dados: dados,
            timestamp: Date.now()
        });
        
        console.log(`Item armazenado no cache: ${chave}`);
    }

    /**
     * Remove itens antigos do cache
     */
    limparItensAntigos() {
        const agora = Date.now();
        const itensParaRemover = [];
        
        for (const [chave, item] of this.cache.entries()) {
            if ((agora - item.timestamp) > this.cacheExpiry) {
                itensParaRemover.push(chave);
            }
        }
        
        itensParaRemover.forEach(chave => {
            this.cache.delete(chave);
            console.log(`Item removido do cache: ${chave}`);
        });
    }

    /**
     * Limpa todo o cache
     */
    limpar() {
        this.cache.clear();
        console.log('Cache limpo completamente');
    }

    /**
     * Obtém estatísticas do cache
     * @returns {Object} - Estatísticas do cache
     */
    obterEstatisticas() {
        const agora = Date.now();
        let itensValidos = 0;
        let itensExpirados = 0;
        
        for (const [chave, item] of this.cache.entries()) {
            if ((agora - item.timestamp) < this.cacheExpiry) {
                itensValidos++;
            } else {
                itensExpirados++;
            }
        }
        
        return {
            totalItens: this.cache.size,
            itensValidos: itensValidos,
            itensExpirados: itensExpirados,
            tamanhoMaximo: this.maxCacheSize,
            tempoExpiracao: this.cacheExpiry
        };
    }

    /**
     * Armazena dados históricos no cache
     * @param {string} tipo - Tipo de dados
     * @param {Array} dados - Dados para armazenar
     * @param {Object} filtros - Filtros aplicados
     */
    armazenarDadosHistorico(tipo, dados, filtros = {}) {
        const chave = this.gerarChaveCache(tipo, filtros);
        this.armazenar(chave, dados);
    }

    /**
     * Obtém dados históricos do cache
     * @param {string} tipo - Tipo de dados
     * @param {Object} filtros - Filtros aplicados
     * @returns {Array|null} - Dados do cache ou null
     */
    obterDadosHistorico(tipo, filtros = {}) {
        const chave = this.gerarChaveCache(tipo, filtros);
        return this.obter(chave);
    }

    /**
     * Invalida cache para um tipo específico
     * @param {string} tipo - Tipo de dados
     */
    invalidarTipo(tipo) {
        const chavesParaRemover = [];
        
        for (const chave of this.cache.keys()) {
            if (chave.startsWith(`${tipo}_`)) {
                chavesParaRemover.push(chave);
            }
        }
        
        chavesParaRemover.forEach(chave => {
            this.cache.delete(chave);
            console.log(`Cache invalidado para: ${chave}`);
        });
    }

    /**
     * Força atualização do cache
     * @param {string} tipo - Tipo de dados
     * @param {Function} carregador - Função para carregar dados
     * @param {Object} filtros - Filtros aplicados
     * @returns {Promise<Array>} - Dados atualizados
     */
    async forcarAtualizacao(tipo, carregador, filtros = {}) {
        console.log(`Forçando atualização para: ${tipo}`);
        
        // Invalida cache existente
        this.invalidarTipo(tipo);
        
        // Carrega novos dados
        const dados = await carregador();
        
        // Armazena no cache
        this.armazenarDadosHistorico(tipo, dados, filtros);
        
        return dados;
    }
}

// Exporta a classe para uso global
window.CacheManager = CacheManager;
