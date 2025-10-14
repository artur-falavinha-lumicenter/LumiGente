/**
 * Configurações do Módulo de Histórico
 * Centraliza todas as configurações e constantes
 */

const HistoricoConfig = {
    // Configurações de Cache
    CACHE: {
        EXPIRY_TIME: 30 * 60 * 1000, // 30 minutos
        MAX_SIZE: 50, // Máximo 50 itens
        ENABLED: true
    },

    // Configurações de Paginação
    PAGINATION: {
        ITEMS_PER_PAGE: 20,
        MAX_PAGES_DISPLAYED: 10
    },

    // Configurações de Filtros
    FILTERS: {
        DEFAULT_PERIOD: 'todos',
        DEFAULT_TYPE: 'todos',
        DEFAULT_DEPARTMENT: 'todos'
    },

    // Configurações de Exportação
    EXPORT: {
        FORMATS: ['csv', 'excel', 'pdf'],
        DEFAULT_FORMAT: 'csv',
        INCLUDE_FILTERS: true
    },

    // Configurações de Gráficos
    CHARTS: {
        COLORS: [
            '#0d556d', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
            '#3b82f6', '#059669', '#dc2626', '#7c3aed', '#0ea5e9'
        ],
        DEFAULT_HEIGHT: 300,
        ANIMATION_DURATION: 300
    },

    // Configurações de Permissões
    PERMISSIONS: {
        ALLOWED_DEPARTMENTS: [
            'RH', 
            'Departamento de Treinamento e Desenvolvimento'
        ],
        ALLOWED_ROLES: [
            'Analista de RH', 
            'Gerente de RH', 
            'Coordenador de Treinamento', 
            'Analista de Treinamento',
            'Diretor de RH',
            'Supervisor de RH',
            'Especialista em Treinamento'
        ],
        ALLOWED_PERMISSIONS: [
            'rh', 
            'treinamento', 
            'historico'
        ]
    },

    // Configurações de URLs
    URLS: {
        EXCEL_FILES_PATH: '/historico_feedz/',
        API_BASE: '/api/historico',
        EXPORT_BASE: '/api/export'
    },

    // Configurações de Arquivos Excel
    EXCEL_FILES: [
        { 
            nome: 'relatorio_avaliacao_desempenho_por_colaborador', 
            tipo: 'avaliacao',
            colunas: ['colaborador', 'departamento', 'avaliador', 'nota', 'dataAvaliacao', 'status']
        },
        { 
            nome: 'relatorio_conteudo_feedbacks', 
            tipo: 'feedback',
            colunas: ['remetente', 'destinatario', 'tipo', 'categoria', 'dataEnvio', 'visualizado']
        },
        { 
            nome: 'relatorio_historico_humor', 
            tipo: 'humor',
            colunas: ['colaborador', 'humor', 'pontuacao', 'dataRegistro', 'descricao']
        },
        { 
            nome: 'relatorio_listagem_colaboradores', 
            tipo: 'colaboradores',
            colunas: ['nome', 'email', 'departamento', 'cargo', 'dataAdmissao', 'status']
        },
        { 
            nome: 'relatorio_medias_feedbacks', 
            tipo: 'medias',
            colunas: ['departamento', 'mediaGeral', 'totalFeedbacks', 'periodo', 'tendencia']
        },
        { 
            nome: 'relatorio_ranking_gamificacao', 
            tipo: 'ranking',
            colunas: ['posicao', 'colaborador', 'departamento', 'pontos', 'lumicoins', 'atividades']
        },
        { 
            nome: 'relatorio_resumo_de_atividades', 
            tipo: 'resumo',
            colunas: ['mes', 'totalFeedbacks', 'totalReconhecimentos', 'totalAvaliacoes', 'engajamento']
        },
        { 
            nome: 'relatorio_turnovers', 
            tipo: 'turnover',
            colunas: ['colaborador', 'departamento', 'dataSaida', 'motivo', 'tempoEmpresa']
        },
        { 
            nome: 'relatorio_plano-de-desenvolvimento-colaboradores-ativos', 
            tipo: 'pdi',
            colunas: ['colaborador', 'objetivo', 'status', 'dataInicio', 'dataFim', 'progresso']
        },
        { 
            nome: 'relatorio_pesquisa_rapida', 
            tipo: 'pesquisas',
            colunas: ['titulo', 'tipo', 'status', 'dataInicio', 'dataFim', 'totalRespostas']
        }
    ],

    // Configurações de Mensagens
    MESSAGES: {
        LOADING: 'Carregando dados...',
        ERROR: 'Erro ao carregar dados',
        NO_DATA: 'Nenhum dado encontrado',
        EXPORT_SUCCESS: 'Dados exportados com sucesso',
        EXPORT_ERROR: 'Erro ao exportar dados',
        CACHE_CLEARED: 'Cache limpo com sucesso',
        PERMISSION_DENIED: 'Você não tem permissão para acessar esta funcionalidade'
    },

    // Configurações de Debug
    DEBUG: {
        ENABLED: true,
        LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
        CONSOLE_LOGS: true
    },

    // Configurações de Performance
    PERFORMANCE: {
        DEBOUNCE_DELAY: 300, // ms
        THROTTLE_DELAY: 100, // ms
        MAX_RENDER_ITEMS: 1000
    },

    // Configurações de Responsividade
    RESPONSIVE: {
        MOBILE_BREAKPOINT: 768,
        TABLET_BREAKPOINT: 1024,
        DESKTOP_BREAKPOINT: 1200
    }
};

// Função para obter configuração
function getConfig(path) {
    return path.split('.').reduce((obj, key) => obj && obj[key], HistoricoConfig);
}

// Função para definir configuração
function setConfig(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((obj, key) => obj[key] = obj[key] || {}, HistoricoConfig);
    target[lastKey] = value;
}

// Função para log de debug
function debugLog(level, message, data = null) {
    if (!HistoricoConfig.DEBUG.ENABLED) return;
    
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevel = levels.indexOf(HistoricoConfig.DEBUG.LOG_LEVEL);
    const messageLevel = levels.indexOf(level);
    
    if (messageLevel >= currentLevel) {
        if (HistoricoConfig.DEBUG.CONSOLE_LOGS) {
            console[level](`[Historico] ${message}`, data || '');
        }
    }
}

// Exporta para uso global
window.HistoricoConfig = HistoricoConfig;
window.getConfig = getConfig;
window.setConfig = setConfig;
window.debugLog = debugLog;
