// ========================================
// VERSÃO DO ARQUIVO: 20251001-FIX-MULTIPLA-ESCOLHA
// ========================================
console.log('🚀 index.js carregado - VERSÃO: 20251001-FIX-MULTIPLA-ESCOLHA');

// Global variables
let currentUser;
let users = [];
let selectedBadge = null;
let activeFilters = { type: null, category: null };
let searchTimeout = null;
let currentFeedbackTab = 'received'; // Nova variável para controlar a aba ativa
let selectedHumorScore = null;
let currentObjetivo = null;
let activeObjetivosFilters = { departamento: null, status: null, tipo: null };
let currentPesquisa = null;
let selectedPesquisaResposta = null;
let activePesquisasFilters = { status: null, tipo: null };
let departamentosMap = new Map(); // Mapa para converter códigos em descrições

// Função para carregar mapeamento de departamentos
async function loadDepartamentosMap() {
    try {
        const response = await fetch('/api/pesquisas/departamentos');
        const departamentos = await response.json();
        
        // Criar mapa de códigos para descrições
        departamentos.forEach(dept => {
            if (dept.codigo && dept.descricao) {
                departamentosMap.set(dept.codigo, dept.descricao);
            }
        });
    } catch (error) {
        console.error('Erro ao carregar mapeamento de departamentos:', error);
    }
}

// Função para obter descrição do departamento pelo código
function getDepartamentoDescricao(codigo) {
    if (!codigo || codigo === 'Todos') return 'Todos';
    return departamentosMap.get(codigo) || codigo;
}

// Função para obter descrições de múltiplos departamentos
function getDepartamentosDescricao(departamentosStr) {
    if (!departamentosStr || departamentosStr === 'Todos') return 'Todos';
    
    const departamentos = departamentosStr.split(',').map(d => d.trim());
    const descricoes = departamentos.map(dept => getDepartamentoDescricao(dept));
    
    if (descricoes.length === 1) {
        return descricoes[0];
    } else if (descricoes.length <= 3) {
        return descricoes.join(', ');
    } else {
        return `${descricoes.slice(0, 2).join(', ')} e mais ${descricoes.length - 2}`;
    }
}

// Global function to clear modal fields
function clearModalFields(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Clear all input fields
    modal.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="date"], input[type="datetime-local"]').forEach(input => {
        if (input) input.value = '';
    });

    // Clear all textareas
    modal.querySelectorAll('textarea').forEach(textarea => {
        if (textarea) textarea.value = '';
    });

    // Reset all selects to first option
    modal.querySelectorAll('select').forEach(select => {
        if (select) select.selectedIndex = 0;
    });

    // Clear hidden inputs
    modal.querySelectorAll('input[type="hidden"]').forEach(input => {
        if (input) input.value = '';
    });

    // Reset searchable selects
    modal.querySelectorAll('.searchable-select input').forEach(input => {
        if (input) input.value = '';
    });

    // Hide all dropdowns
    modal.querySelectorAll('.select-dropdown').forEach(dropdown => {
        if (dropdown) dropdown.classList.remove('show');
    });

    // Clear badge selections
    modal.querySelectorAll('.badge-option').forEach(badge => {
        if (badge) badge.classList.remove('selected');
    });

    // Reset global variables
    selectedBadge = null;
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // BLOQUEIO IMEDIATO se sessão foi invalidada
    const sessionInvalidated = sessionStorage.getItem('sessionInvalidated');
    if (sessionInvalidated) {
        console.log('🚫 Sessão invalidada - bloqueando acesso');
        sessionStorage.clear();
        window.location.replace('/login');
        return;
    }
    
    // Verificar autenticação ANTES de qualquer coisa
    try {
        const authCheck = await fetch('/api/usuario', { credentials: 'include' });
        if (!authCheck.ok) {
            console.log('🚫 Sem autenticação válida - redirecionando');
            sessionStorage.setItem('sessionInvalidated', 'true');
            window.location.replace('/login');
            return;
        }
    } catch (error) {
        console.log('🚫 Erro de autenticação - redirecionando');
        sessionStorage.setItem('sessionInvalidated', 'true');
        window.location.replace('/login');
        return;
    }
    
    setupNavigationProtection();
    await checkAuth();
    if (currentUser) {
        await loadInitialData();
        setupEventListeners();
    }
});

// Função para configurar proteção de navegação
function setupNavigationProtection() {
    // Substituir estado atual no histórico
    history.replaceState({ authenticated: true, page: 'app' }, null, window.location.href);

    // Adicionar uma entrada extra no histórico para dificultar o retorno
    history.pushState({ authenticated: true, page: 'app' }, null, window.location.href);

    // Interceptar tentativas de navegação para trás
    window.addEventListener('popstate', (event) => {
        // Sempre verificar autenticação primeiro
        checkAuthAndRedirect();

        // Se tentar voltar para login, bloquear
        if (event.state && event.state.page === 'login') {
            event.preventDefault();
            event.stopPropagation();
            history.pushState({ authenticated: true, page: 'app' }, null, window.location.href);
            return false;
        }

        // Se não há estado ou é uma tentativa de sair da aplicação
        if (!event.state || !event.state.authenticated) {
            event.preventDefault();
            checkAuthAndRedirect();
            return false;
        }
    });

    // Interceptar tentativas de mudança de URL
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const url = args[2];
        if (url && (url.includes('login') || url === '/login.html')) {
            // Bloquear navegação para login se autenticado
            return;
        }
        return originalPushState.apply(history, args);
    };

    history.replaceState = function (...args) {
        const url = args[2];
        if (url && (url.includes('login') || url === '/login.html')) {
            // Bloquear navegação para login se autenticado
            return;
        }
        return originalReplaceState.apply(history, args);
    };

    // Interceptar tentativas de sair da página
    window.addEventListener('beforeunload', (event) => {
        // Limpar dados temporários se necessário
        sessionStorage.removeItem('justLoggedIn');
    });

    // Monitorar mudanças na URL
    setInterval(() => {
        if (window.location.pathname.includes('login')) {
            window.location.replace('/index.html');
        }
    }, 1000);
}

// Função para verificar autenticação e redirecionar se necessário
/**
 * Verifica se o usuário tem permissão para acessar o histórico
 * Setores com acesso: RH, DEPARTAMENTO TREINAM&DESENVOLV, COORDENACAO ADM/RH/SESMT MAO, DEPARTAMENTO ADM/RH/SESMT
 * @param {Object} usuario - Objeto com dados do usuário
 * @returns {boolean} - True se tem permissão, false caso contrário
 */
function verificarPermissaoHistorico(usuario) {
    if (!usuario) return false;
    
    const setoresPermitidos = [
        'RH', 
        'DEPARTAMENTO TREINAM&DESENVOLV',
        'COORDENACAO ADM/RH/SESMT MAO',
        'DEPARTAMENTO ADM/RH/SESMT'
    ];
    
    // Verifica se o departamento/setor do usuário está na lista permitida
    if (usuario.departamento) {
        const departamentoUsuario = usuario.departamento.toUpperCase().trim();
        
        // Verifica correspondência exata ou parcial para variações do nome
        for (let setor of setoresPermitidos) {
            if (departamentoUsuario === setor || 
                (departamentoUsuario.includes('TREINAM') && departamentoUsuario.includes('DESENVOLV')) ||
                departamentoUsuario === 'RH' ||
                departamentoUsuario === 'RECURSOS HUMANOS' ||
                departamentoUsuario.includes('COORDENACAO ADM') ||
                (departamentoUsuario.includes('COORDENACAO') && departamentoUsuario.includes('SESMT')) ||
                (departamentoUsuario.includes('DEPARTAMENTO ADM') && departamentoUsuario.includes('SESMT')) ||
                (departamentoUsuario.startsWith('DEPARTAMENTO ADM/RH'))) {
                return true;
            }
        }
    }
    
    // Verifica por permissões específicas
    if (usuario.permissoes && Array.isArray(usuario.permissoes)) {
        return usuario.permissoes.includes('rh') || 
               usuario.permissoes.includes('treinamento') ||
               usuario.permissoes.includes('historico');
    }
    
    // Para desenvolvimento: permitir acesso se for admin
    if (usuario.role === 'Administrador' || usuario.is_admin) {
        return true;
    }
    
    return false;
}

async function checkAuthAndRedirect() {
    try {
        const response = await fetch('/api/usuario', {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            // Usuário não está mais autenticado, fazer logout completo
            performSecureLogout();
        }
    } catch (error) {
        // Erro de conexão, fazer logout por segurança
        performSecureLogout();
    }
}

// Função para fazer logout seguro
function performSecureLogout() {
    console.log('🧹 Executando limpeza local completa...');

    // Marcar que o logout foi feito pelo botão
    sessionStorage.setItem('logoutByButton', 'true');
    
    // Marcar que a sessão foi invalidada
    sessionStorage.setItem('sessionInvalidated', 'true');

    // Limpar todos os dados de armazenamento
    try {
        localStorage.clear();
        console.log('✅ Storage limpo');
    } catch (e) {
        console.log('⚠️ Erro ao limpar storage:', e);
    }

    // Limpar cookies de sessão de forma mais robusta
    try {
        const cookies = ['connect.sid', 'lumigente.sid', 'session'];
        cookies.forEach(cookieName => {
            document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
            document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
        });

        // Limpar todos os cookies como fallback
        document.cookie.split(";").forEach(function (c) {
            const eqPos = c.indexOf("=");
            const name = eqPos > -1 ? c.substr(0, eqPos).trim() : c.trim();
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
        });
        console.log('✅ Cookies limpos');
    } catch (e) {
        console.log('⚠️ Erro ao limpar cookies:', e);
    }

    console.log('🔄 Redirecionando para login...');

    // Forçar redirecionamento imediato para login
    try {
        // Usar replace para evitar histórico
        window.location.replace('/login');
    } catch (e) {
        console.log('⚠️ Erro no redirecionamento replace, tentando href:', e);
        // Fallback: redirecionamento direto
        window.location.href = '/login';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Analytics filters - evento change simples
    const periodSelect = document.getElementById('analytics-period');
    const departmentSelect = document.getElementById('analytics-department');
    
    if (periodSelect) {
        periodSelect.addEventListener('change', () => loadAnalytics());
    }
    
    if (departmentSelect) {
        departmentSelect.addEventListener('change', () => loadAnalytics());
    }
    
    // Search functionality
    document.getElementById('feedback-search').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadFeedbacks();
        }, 300);
    });

    // Tab change listeners
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');

            // Carregar dados específicos baseado na aba
            if (targetId === 'team-content') {
                setTimeout(() => loadTeamData(), 100);
            } else if (targetId === 'analytics-content') {
                setTimeout(() => loadAnalyticsData(), 100);
            }
        });
    });

    // Objetivos search functionality
    const objetivosSearch = document.getElementById('objetivos-search');
    if (objetivosSearch) {
        objetivosSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadObjetivos();
            }, 300);
        });
    }
    
    // Busca por responsável nos objetivos
    const objetivosResponsavelSearch = document.getElementById('objetivos-responsavel-search');
    if (objetivosResponsavelSearch) {
        objetivosResponsavelSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadObjetivos();
            }, 300);
        });
    }

    // Pesquisas search functionality
    const pesquisasSearch = document.getElementById('pesquisas-search');
    if (pesquisasSearch) {
        pesquisasSearch.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadPesquisas();
            }, 300);
        });
    }

    // Badge selection
    document.querySelectorAll('.badge-option').forEach(badge => {
        badge.addEventListener('click', () => {
            document.querySelectorAll('.badge-option').forEach(b => {
                b.classList.remove('selected');
            });
            badge.classList.add('selected');
            selectedBadge = badge.dataset.badge;
        });
    });

    // Humor selection
    document.querySelectorAll('.humor-option').forEach(option => {
        option.addEventListener('click', () => {
            const score = parseInt(option.dataset.score);
            selectHumor(score);
        });
    });

    // Navigation
    const navItems = document.querySelectorAll('.nav-item');
    const tabContents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('page-title');

    const tabTitles = {
        'dashboard': 'Dashboard',
        'feedback': 'Central de Feedbacks',
        'recognition': 'Reconhecimentos',
        'team': 'Gestão de Equipe',
        'analytics': 'Relatórios e Análises',
        'humor': 'Humor do Dia',
        'objetivos': 'Gestão de Objetivos',
        'pesquisas': 'Pesquisa Rápida',
        'avaliacoes': 'Avaliações',
        'novo-sistema': 'Novo Sistema de Pesquisas',
        'historico': 'Histórico de Feedbacks',
        'settings': 'Configurações'
    };

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const tab = item.dataset.tab;

            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            tabContents.forEach(content => content.classList.add('hidden'));
            document.getElementById(tab + '-content').classList.remove('hidden');

            pageTitle.textContent = tabTitles[tab];

            if (tab === 'dashboard') {
                console.log('🎯 Aba de dashboard acessada - carregando dados...');
                loadGamificationData(); // Carregar ranking e dados de gamificação
                loadMetrics(); // Carregar métricas
            } else if (tab === 'feedback') {
                currentFeedbackTab = 'received'; // Reset to received tab
                document.querySelectorAll('.feedback-tab').forEach(tabEl => {
                    tabEl.classList.remove('active');
                });
                document.querySelector('[data-feedback-tab="received"]').classList.add('active');
                loadFeedbacks();
                loadFilters();
            } else if (tab === 'team') {
                loadTeamData();
            } else if (tab === 'analytics') {
                loadAnalyticsData();
            } else if (tab === 'recognition') {
                console.log('🎯 Aba de reconhecimentos acessada - carregando dados...');
                loadMyRecognitions();
            } else if (tab === 'humor') {
                loadHumorData();
            } else if (tab === 'objetivos') {
                loadObjetivos();
            } else if (tab === 'pesquisas') {
                loadPesquisas();
                checkPesquisaPermissions();
            } else if (tab === 'avaliacoes') {
                checkAvaliacoesPermissions();
                loadAvaliacoes();
            }
        });
    });



    // ESC key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const objetivoModal = document.getElementById('objetivo-modal');
            const feedbackModal = document.getElementById('feedback-modal');
            const recognitionModal = document.getElementById('recognition-modal');
            if (objetivoModal && !objetivoModal.classList.contains('hidden')) {
                closeObjetivoModal();
            } else if (feedbackModal && !feedbackModal.classList.contains('hidden')) {
                closeFeedbackModal();
            } else if (recognitionModal && !recognitionModal.classList.contains('hidden')) {
                closeRecognitionModal();
            }
        }
    });

    // Otimização: Pré-carrega dados dos modais mais usados
    setTimeout(() => {
        preloadModalData();
    }, 2000); // Carrega após 2 segundos da inicialização
}

// Função para pré-carregar dados dos modais
async function preloadModalData() {
    try {
        // Pré-carrega usuários se ainda não foram carregados
        if (users.length === 0) {
            await loadUsers();
        }
    } catch (error) {
        console.error('Erro ao pré-carregar dados dos modais:', error);
    }

    const pesquisaModal = document.getElementById('pesquisa-modal');
    if (pesquisaModal) {
        pesquisaModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closePesquisaModal();
        }
    });
    }

    const responderPesquisaModal = document.getElementById('responder-pesquisa-modal');
    if (responderPesquisaModal) {
        responderPesquisaModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeResponderPesquisaModal();
        }
    });
    }



    const checkinModal = document.getElementById('checkin-modal');
    if (checkinModal) {
        checkinModal.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeCheckinModal();
        }
    });
    }

    // Close filter menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-dropdown')) {
            document.getElementById('filter-menu').classList.add('hidden');
        }
    });
}

// Show welcome message in header
function showWelcomeMessage(nome) {
    const headerRight = document.querySelector('.header-right');
    if (!headerRight) return;

    const welcomeAlert = document.createElement('div');
    welcomeAlert.className = 'welcome-alert';
    welcomeAlert.innerHTML = `
                <i class="fas fa-hand-wave"></i>
                Bem-vindo de volta, ${nome}!
            `;

    headerRight.appendChild(welcomeAlert);

    // Mostrar alerta de bem vindo instantaneamente ao logar
    setTimeout(() => {
        welcomeAlert.classList.add('show');
    }, 0);

    // Esconder suavemente para a esquerda após 2 segundos
    setTimeout(() => {
        welcomeAlert.classList.add('hide');

        // Remover do DOM após a animação
        setTimeout(() => {
            if (welcomeAlert.parentNode) {
                welcomeAlert.parentNode.removeChild(welcomeAlert);
            }
        }, 400);
    }, 3000);
}

// Authentication
async function checkAuth() {
    try {
        const response = await fetch('/api/usuario');
        if (response.ok) {
            currentUser = await response.json();
            document.querySelector('.user-info span').textContent = currentUser.nomeCompleto || currentUser.userName;

            // Status de autenticação atualizado

            setupSidebarAccess(); // Configurar acesso do sidebar baseado na hierarquia

            // Show welcome message only if coming from login (not page reload)
            const isFromLogin = sessionStorage.getItem('justLoggedIn');
            if (isFromLogin && currentUser.nome) {
                showWelcomeMessage(currentUser.nome);
                sessionStorage.removeItem('justLoggedIn'); // Remove flag after showing message
            }
        } else {
            // Status de autenticação atualizado
            showLoginModal();
        }
    } catch (error) {
        // Não mostrar erro no console quando é esperado (usuário não logado)
        if (error.name !== 'TypeError') {
            console.error('Erro na verificação de autenticação:', error);
        }
        // Status de autenticação atualizado
        showLoginModal();
    }
}

// Setup sidebar access based on user permissions from API
async function setupSidebarAccess() {
    if (!currentUser) return;

    try {
        // Buscar permissões do servidor
        const response = await fetch('/api/usuario/permissions');
        if (!response.ok) {
            console.error('Erro ao buscar permissões:', response.status);
            return;
        }

        const data = await response.json();
        const permissions = data.permissions;

        // Hide/show tabs based on permissions
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            const tab = item.dataset.tab;
            
            // Settings tab is always visible
            if (tab === 'settings') {
                item.style.display = 'flex';
                return;
            }

            // Map tab names to permission keys
            const permissionMap = {
                'dashboard': 'dashboard',
                'feedback': 'feedbacks',
                'recognition': 'recognitions',
                'team': 'team',
                'analytics': 'analytics',
                'humor': 'humor',
                'objetivos': 'objetivos',
                'pesquisas': 'pesquisas',
                'avaliacoes': 'avaliacoes',
                'historico': 'historico'
            };

            const permissionKey = permissionMap[tab];
            if (permissionKey && permissions[permissionKey]) {
                item.style.display = 'flex';
                if (tab === 'historico') {
                    console.log('🔓 Aba Histórico LIBERADA para este usuário');
                }
            } else {
                item.style.display = 'none';
                if (tab === 'historico') {
                    console.log('🔒 Aba Histórico BLOQUEADA para este usuário');
                    console.log('   Permissão historico:', permissions[permissionKey]);
                }
            }
        });

        // If current active tab is not allowed, switch to dashboard
        const activeTab = document.querySelector('.nav-item.active');
        const activeTabName = activeTab?.dataset.tab;
        const permissionMap = {
            'dashboard': 'dashboard',
            'feedback': 'feedbacks',
            'recognition': 'recognitions',
            'team': 'team',
            'analytics': 'analytics',
            'humor': 'humor',
            'objetivos': 'objetivos',
            'pesquisas': 'pesquisas',
            'avaliacoes': 'avaliacoes',
            'historico': 'historico'
        };
        
        if (activeTabName && activeTabName !== 'settings') {
            const permissionKey = permissionMap[activeTabName];
            if (!permissionKey || !permissions[permissionKey]) {
                // Switch to dashboard
                const dashboardTab = document.querySelector('[data-tab="dashboard"]');
                if (dashboardTab) {
                    dashboardTab.click();
                }
            }
        }

        // Log para debug
        console.log('🔐 Permissões de acesso configuradas:', {
            user: data.user.nome,
            departamento: data.user.departamento,
            hierarchyLevel: data.user.hierarchyLevel,
            permissions: permissions,
            hierarchy: data.hierarchy
        });
        
        // Log detalhado de cada aba
        console.log('📋 Status das abas:');
        Object.keys(permissions).forEach(key => {
            console.log(`   ${key}: ${permissions[key] ? '✅ VISÍVEL' : '❌ OCULTA'}`);
        });

    } catch (error) {
        console.error('Erro ao configurar permissões de acesso:', error);
    }
}

function showLoginModal() {
    // Redirecionar para a página de login dedicada
    window.location.href = '/login';
}

async function logout() {
    console.log('🚪 Iniciando logout...');

    const logoutBtn = document.querySelector('.notification-btn');
    if (logoutBtn) {
        logoutBtn.innerHTML = '<div class="spinner"></div>';
        logoutBtn.style.pointerEvents = 'none';
    }

    try {
        // Chamar API de logout para destruir sessão no servidor
        await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (error) {
        console.log('Erro na API de logout:', error);
    }
    
    // Executar limpeza local e redirecionamento
    performSecureLogout();
}

// Load initial data
async function loadInitialData() {
    await Promise.all([
        loadMetrics(),
        loadUsers(),
        loadFeedbacks(),
        loadRecognitions(),
        loadGamificationData(),
        checkPesquisaPermissions()
    ]);

    // Carregar dados específicos baseado na aba ativa
    const activeTab = document.querySelector('.tab-content:not(.hidden)');
    if (activeTab) {
        const tabId = activeTab.id;
        if (tabId === 'objetivos-content') {
            await loadObjetivos();
        } else if (tabId === 'team-content') {
            await loadTeamData();
        } else if (tabId === 'analytics-content') {
            await loadAnalyticsData();
        }
    }
}

// Load metrics
async function loadMetrics() {
    try {
        const response = await fetch('/api/metrics');
        if (response.ok) {
            const metrics = await response.json();

            // Update counts
            document.getElementById('feedbacks-received-count').textContent = metrics.feedbacksReceived;
            document.getElementById('recognitions-received-count').textContent = metrics.recognitionsReceived;
            document.getElementById('feedbacks-sent-count').textContent = metrics.feedbacksSent;
            document.getElementById('avg-score').textContent = metrics.avgScore;

            // Indicadores de comparação removidos - apenas números principais são exibidos
        }
    } catch (error) {
        console.error('Erro ao carregar métricas:', error);
    }
}

// Load users for feedback (universal access)
async function loadUsers() {
    try {
        console.log('Carregando usuários para feedback...');
        const response = await fetch('/api/users/feedback');
        if (response.ok) {
            users = await response.json();
            console.log('Usuários carregados:', users.length, 'usuários'); // Debug
            console.log('Primeiro usuário:', users[0]); // Debug
            updateUserSelects();
        } else {
            console.error('Erro na resposta da API:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Erro ao carregar usuários:', error);
    }
}

function updateUserSelects() {
    const feedbackList = document.getElementById('feedback-to-user-list');
    const recognitionList = document.getElementById('recognition-to-user-list');
    const objetivoList = document.getElementById('objetivo-responsavel-list');

    // Atualizar dropdown pesquisável de feedback
    if (feedbackList) {
        feedbackList.innerHTML = '<div class="select-option" data-value="" onclick="selectUser(\'\', \'Selecionar colaborador...\', \'feedback-to-user\')">Selecionar colaborador...</div>';
        users.forEach(user => {
            if (user.userId !== currentUser.userId) {
                const nomeCompleto = user.nomeCompleto || user.NomeCompleto || 'Nome não informado';
                const departamento = user.descricaoDepartamento || user.DescricaoDepartamento || user.departamento || user.Departamento || 'Departamento não informado';
                feedbackList.innerHTML += `<div class="select-option" data-value="${user.userId}" onclick="selectUser('${user.userId}', '${nomeCompleto} - ${departamento}', 'feedback-to-user')">${nomeCompleto} - ${departamento}</div>`;
            }
        });
    }

    // Atualizar dropdown pesquisável de reconhecimento
    if (recognitionList) {
        recognitionList.innerHTML = '<div class="select-option" data-value="" onclick="selectUser(\'\', \'Selecionar colaborador...\', \'recognition-to-user\')">Selecionar colaborador...</div>';
        users.forEach(user => {
            if (user.userId !== currentUser.userId) {
                const nomeCompleto = user.nomeCompleto || user.NomeCompleto || 'Nome não informado';
                const departamento = user.descricaoDepartamento || user.DescricaoDepartamento || user.departamento || user.Departamento || 'Departamento não informado';
                recognitionList.innerHTML += `<div class="select-option" data-value="${user.userId}" onclick="selectUser('${user.userId}', '${nomeCompleto} - ${departamento}', 'recognition-to-user')">${nomeCompleto} - ${departamento}</div>`;
            }
        });
    }

    // Atualizar dropdown pesquisável de objetivo
    if (objetivoList) {
        objetivoList.innerHTML = '<div class="select-option" data-value="" onclick="selectUser(\'\', \'Selecionar responsável...\', \'objetivo-responsavel\')">Selecionar responsável...</div>';
        users.forEach(user => {
            const nomeCompleto = user.nomeCompleto || user.NomeCompleto || 'Nome não informado';
            const departamento = user.descricaoDepartamento || user.DescricaoDepartamento || user.departamento || user.Departamento || 'Departamento não informado';
            objetivoList.innerHTML += `<div class="select-option" data-value="${user.userId}" onclick="selectUser('${user.userId}', '${nomeCompleto} - ${departamento}', 'objetivo-responsavel')">${nomeCompleto} - ${departamento}</div>`;
        });
    }
}

function filterUsers(searchId, listId) {
    const searchInput = document.getElementById(searchId);
    const list = document.getElementById(listId);
    const searchTerm = searchInput.value.toLowerCase();

    const options = list.querySelectorAll('.select-option');
    options.forEach(option => {
        const text = option.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
            option.style.display = 'block';
        } else {
            option.style.display = 'none';
        }
    });

    list.classList.add('show');
}

function selectUser(value, text, inputId) {
    const input = document.getElementById(inputId);
    const searchInput = document.getElementById(inputId + '-search');
    const list = document.getElementById(inputId + '-list');

    input.value = value;
    if (searchInput) {
        // Se o valor estiver vazio, deixar o campo vazio em vez de mostrar texto padrão
        searchInput.value = value ? text : '';
    }

    list.classList.remove('show');
}

// NOVA FUNCIONALIDADE: Seleção múltipla para responsáveis
let selectedResponsaveis = [];

function selectMultipleUser(userId, userName) {
    // Não permitir seleção de usuário vazio
    if (!userId || userId === '') {
        return;
    }
    
    // Converter userId para o mesmo tipo (string ou int) para comparação adequada
    const userIdNum = parseInt(userId, 10);
    const isAlreadySelected = selectedResponsaveis.some(user => {
        const existingId = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
        return existingId === userIdNum || parseInt(user.id) === userIdNum;
    });
    
    if (isAlreadySelected) {
        console.log(`⚠️ Usuário ${userName} já está selecionado como responsável`);
        return; // Já está selecionado
    }
    
    // Adicionar à lista de selecionados
    selectedResponsaveis.push({
        id: userIdNum,
        name: userName
    });
    
    console.log(`✅ Responsável adicionado: ${userName} (ID: ${userIdNum})`);
    
    // Atualizar interface
    updateSelectedResponsaveisUI();
    
    // Limpar campo de busca
    const searchInput = document.getElementById('objetivo-responsavel-search');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Fechar dropdown
    const list = document.getElementById('objetivo-responsavel-list');
    if (list) {
        list.classList.remove('show');
    }
}

function removeSelectedResponsavel(userId) {
    console.log('🔍 [REMOVE] Removendo responsável ID:', userId, 'Tipo:', typeof userId);
    console.log('🔍 [REMOVE] Responsáveis atuais antes:', selectedResponsaveis);
    
    // Normalizar o ID recebido para comparação (lidar com string ou number)
    const userIdToRemove = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    
    // Salvar array inicial para debug
    const initialLength = selectedResponsaveis.length;
    
    // Filtrar removendo o responsável especificado (comparação normalizada por tipo)
    selectedResponsaveis = selectedResponsaveis.filter(user => {
        const userComparand = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
        const isMatch = userComparand === userIdToRemove;
        
        console.log(`🔍 [FILTER] Comparando: ${userComparand} === ${userIdToRemove} = ${isMatch} (Manter? ${!isMatch})`);
        
        return !isMatch; // Manter apenas se NÃO for match (false para remover)
    });
    
    console.log('🔍 [REMOVE] Responsáveis após filtro:', selectedResponsaveis);
    console.log('🔍 [REMOVE] Removidos:', initialLength - selectedResponsaveis.length);
    
    updateSelectedResponsaveisUI();
    
    // Re-popular lista para re-inserir o usuário removido nos disponíveis
    if (currentUser && currentUser.hierarchyLevel >= 3 && typeof populateObjetivoForm === 'function') {
        populateObjetivoForm();
    }
}

function updateSelectedResponsaveisUI() {
    const container = document.getElementById('selected-responsaveis-container');
    if (!container) return;
    
    // Limpar container
    container.innerHTML = '';
    
    if (selectedResponsaveis.length === 0) {
        container.innerHTML = '<div class="no-responsavel-placeholder" style="color: #dc3545; border: 1px dashed #dc3545; padding: 8px; border-radius: 4px; text-align: center;">⚠️ Nenhum responsável selecionado (obrigatório pelo menos um)</div>';
        return;
    }
    
    // Adicionar cada responsável selecionado
    selectedResponsaveis.forEach(responsavel => {
        const responsavelElement = document.createElement('div');
        responsavelElement.className = 'selected-responsavel';
        
        // Garantir que o ID seja string para o onclick funcionar corretamente
        const responsavelId = String(responsavel.id);
        console.log(`🔍 Criando botão removo para: ${responsavel.name} (ID: ${responsavelId})`);
        
        responsavelElement.innerHTML = `
            ${responsavel.name}
            <button type="button" class="remove-btn" onclick="removeSelectedResponsavel('${responsavelId}')">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(responsavelElement);
    });
}

function clearSelectedResponsaveis() {
    selectedResponsaveis = [];
    updateSelectedResponsaveisUI();
}

function getSelectedResponsaveisIds() {
    console.log('🎯 getSelectedResponsaveisIds chamada');
    console.log('🎯 selectedResponsaveis array:', selectedResponsaveis);
    console.log('🎯 selectedResponsaveis length:', selectedResponsaveis.length);
    
    const ids = selectedResponsaveis.map(user => user.id);
    console.log('🎯 IDs extraídos:', ids);
    
    return ids;
}

// Event listeners para dropdown pesquisável
document.addEventListener('click', function (e) {
    if (!e.target.closest('.searchable-select')) {
        document.querySelectorAll('.select-dropdown').forEach(dropdown => {
            dropdown.classList.remove('show');
        });
    }
});

document.addEventListener('focusin', function (e) {
    if (e.target.id === 'feedback-to-user-search') {
        document.getElementById('feedback-to-user-list').classList.add('show');
    } else if (e.target.id === 'recognition-to-user-search') {
        document.getElementById('recognition-to-user-list').classList.add('show');
    } else if (e.target.id === 'objetivo-responsavel-search') {
        document.getElementById('objetivo-responsavel-list').classList.add('show');
    }
});

// Load feedbacks
async function loadFeedbacks() {
    try {
        const searchValue = document.getElementById('feedback-search')?.value || '';
        const queryParams = new URLSearchParams({
            search: searchValue,
            ...(activeFilters.type && { type: activeFilters.type }),
            ...(activeFilters.category && { category: activeFilters.category })
        });

        const endpoint = currentFeedbackTab === 'sent' ? '/api/feedbacks/sent' : '/api/feedbacks/received';
        const response = await fetch(`${endpoint}?${queryParams}`);
        if (response.ok) {
            const feedbacks = await response.json();
            updateFeedbackList(feedbacks);
        }
    } catch (error) {
        console.error('Erro ao carregar feedbacks:', error);
    }
}

// Switch feedback tabs
function switchFeedbackTab(tab) {
    currentFeedbackTab = tab;

    // Update tab UI
    document.querySelectorAll('.feedback-tab').forEach(tabEl => {
        tabEl.classList.remove('active');
    });
    document.querySelector(`[data-feedback-tab="${tab}"]`).classList.add('active');

    // Reset filters and search
    activeFilters = { type: null, category: null };
    document.getElementById('feedback-search').value = '';
    document.querySelectorAll('.filter-option').forEach(el => {
        el.classList.remove('active');
    });

    // Load appropriate feedbacks
    loadFeedbacks();
}

function updateFeedbackList(feedbacks) {
    const container = document.getElementById('feedback-list');
    if (!container) return;

    if (feedbacks.length === 0) {
        const message = currentFeedbackTab === 'sent' ?
            'Você ainda não enviou nenhum feedback.' :
            'Você ainda não recebeu nenhum feedback.';
        container.innerHTML = `<div class="loading">${message}</div>`;
        return;
    }

    container.innerHTML = feedbacks.map(feedback => {
        const displayName = currentFeedbackTab === 'sent' ?
            `Você → ${feedback.to_name}` :
            `${feedback.from_name} → Você`;

        const actionButtons = currentFeedbackTab === 'sent' ?
            `<button class="action-btn ${feedback.has_reactions ? 'status-visualizado' : 'status-nao-visualizado'}" title="Status de visualização">
                        <i class="fas fa-eye"></i>
                        ${feedback.has_reactions ? 'Visualizado' : 'Não visualizado'}
                    </button>
                    <button class="action-btn status-uteis" title="Reações úteis">
                        <i class="fas fa-thumbs-up"></i>
                        <span class="counter">${feedback.useful_count || 0}</span> úteis
                    </button>
                    <button class="action-btn status-respostas ${feedback.replies_count > 0 ? 'has-activity' : ''}" onclick="toggleReplies(${feedback.Id})" title="Respostas">
                        <i class="fas fa-comment"></i>
                        <span class="counter">${feedback.replies_count || 0}</span> respostas
                    </button>` :
            `<button class="action-btn status-uteis ${feedback.user_reacted ? 'active' : ''}" onclick="toggleReaction(${feedback.Id}, 'useful')" data-feedback-id="${feedback.Id}" data-reaction="useful" title="Marcar como útil">
                        <i class="fas fa-thumbs-up"></i>
                        Útil <span class="counter">${feedback.useful_count || 0}</span>
                    </button>
                    <button class="action-btn status-respostas ${feedback.replies_count > 0 ? 'has-activity' : ''}" onclick="toggleReplies(${feedback.Id})" title="Responder feedback">
                        <i class="fas fa-comment"></i>
                        Responder <span class="counter">${feedback.replies_count || 0}</span>
                    </button>`;

        return `
                    <div class="feedback-item" data-feedback-id="${feedback.Id}">
                        <div class="feedback-header-info">
                            <div class="feedback-user">
                                <div class="user-avatar">
                                    <i class="fas fa-user"></i>
                                </div>
                                <div>
                                    <strong>${displayName}</strong>
                                    <p style="color: #6b7280; font-size: 14px;">${new Date(feedback.created_at).toLocaleDateString('pt-BR')}</p>
                                </div>
                            </div>
                            <div class="feedback-badges">
                                <span class="badge ${feedback.type === 'Positivo' ? 'badge-positive' : 'badge-development'}">${feedback.type}</span>
                                <span class="badge badge-category">${feedback.category}</span>
                                ${currentFeedbackTab === 'sent' && feedback.has_reactions ? '<span class="badge badge-positive">Interagido</span>' : ''}
                            </div>
                        </div>
                        <p class="feedback-message">${feedback.message}</p>
                        <div class="feedback-points">
                            <span class="points-info ${feedback.earned_points ? 'earned' : ''}">${feedback.earned_points ? '+10 pontos' : 'Sem pontos'}</span>
                        </div>
                        <div class="feedback-actions">
                            ${actionButtons}
                        </div>
                        <div class="feedback-replies hidden" id="replies-${feedback.Id}">
                            <!-- Container para thread será criado dinamicamente -->
                        </div>
                    </div>
                `;
    }).join('');
}

// Load recognitions for dashboard (both sent and received, last 3)
async function loadRecognitions() {
    try {
        // Buscar reconhecimentos recebidos
        const receivedResponse = await fetch('/api/recognitions');
        const receivedRecognitions = receivedResponse.ok ? await receivedResponse.json() : [];
        
        // Buscar reconhecimentos enviados
        const sentResponse = await fetch('/api/recognitions/given');
        const sentRecognitions = sentResponse.ok ? await sentResponse.json() : [];
        
        // Combinar e ordenar por data
        const allRecognitions = [...receivedRecognitions, ...sentRecognitions]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 3);
        
        updateRecognitionsList(allRecognitions);
    } catch (error) {
        console.error('Erro ao carregar reconhecimentos:', error);
    }
}

// Load all recognitions for recognition tab
async function loadMyRecognitions() {
    try {
        console.log('🎯 Carregando reconhecimentos...');
        const response = await fetch('/api/recognitions/all');
        if (response.ok) {
            const recognitions = await response.json();
            console.log('🎯 Reconhecimentos carregados:', recognitions.length, 'itens');
            updateMyRecognitionsList(recognitions);
        } else {
            console.error('❌ Erro na resposta da API:', response.status);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar meus reconhecimentos:', error);
    }
}

function updateMyRecognitionsList(recognitions) {
    console.log('🎯 Atualizando lista de reconhecimentos...');
    const container = document.getElementById('my-recognitions-list');
    if (!container) {
        console.error('❌ Container my-recognitions-list não encontrado');
        return;
    }
    
    console.log('🎯 Container encontrado, atualizando com', recognitions.length, 'reconhecimentos');

    if (recognitions.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum reconhecimento encontrado.</div>';
        console.log('🎯 Lista vazia - mostrando mensagem de nenhum reconhecimento');
        return;
    }

    container.innerHTML = recognitions.map(recognition => {
        const isReceived = recognition.direction === 'received';
        const displayText = isReceived ?
            `${recognition.from_name} reconheceu você` :
            `Você reconheceu ${recognition.to_name}`;
        const badgeColor = isReceived ? '#10b981' : '#3b82f6';
        const iconClass = isReceived ? 'fa-award' : 'fa-gift';

        return `
                    <div class="recognition-item" style="border-color: ${badgeColor};">
                        <div class="recognition-icon" style="background: ${badgeColor};">
                            <i class="fas ${iconClass}"></i>
                        </div>
                        <div class="recognition-content">
                            <div class="recognition-header">
                                <strong>${displayText}</strong>
                                <span class="recognition-badge" style="background: ${badgeColor}33; color: ${badgeColor};">${recognition.badge}</span>
                            </div>
                            <p class="recognition-message">${recognition.message}</p>
                            <p class="recognition-points">${recognition.earned_points ? '+5 pontos' : 'Sem pontos'} • ${new Date(recognition.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                    </div>
                `;
    }).join('');
    
    console.log('🎯 Lista de reconhecimentos atualizada com sucesso');
}

function updateRecognitionsList(recognitions) {
    const container = document.getElementById('recognitions-list');
    if (!container) return;

    if (recognitions.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum reconhecimento encontrado.</div>';
        return;
    }

    container.innerHTML = recognitions.map(recognition => {
        // Determinar se foi enviado ou recebido
        const isReceived = recognition.to_user_id === currentUser.userId;
        const isSent = recognition.from_user_id === currentUser.userId;
        
        let directionText = '';
        let directionIcon = '';
        let directionColor = '';
        
        if (isReceived) {
            directionText = `${recognition.from_name} → Você`;
            directionIcon = 'fas fa-arrow-down';
            directionColor = '#10b981'; // Verde para recebido
        } else if (isSent) {
            directionText = `Você → ${recognition.to_name}`;
            directionIcon = 'fas fa-arrow-up';
            directionColor = '#3b82f6'; // Azul para enviado
        } else {
            directionText = `${recognition.from_name} → ${recognition.to_name}`;
            directionIcon = 'fas fa-exchange-alt';
            directionColor = '#6b7280'; // Cinza para outros
        }

        return `
                <div class="recognition-item">
                    <div class="recognition-icon" style="color: ${directionColor};">
                        <i class="fas fa-award"></i>
                    </div>
                    <div class="recognition-content">
                        <div class="recognition-header">
                            <span style="color: ${directionColor};">
                                <i class="${directionIcon}"></i>
                                ${directionText}
                            </span>
                            <span class="recognition-badge">${recognition.badge}</span>
                        </div>
                        <p class="recognition-message">${recognition.message}</p>
                        <p class="recognition-points">+${recognition.points} pontos</p>
                    </div>
                </div>
            `;
    }).join('');
}

// Load gamification data
async function loadGamificationData() {
    try {
        console.log('🎯 Carregando dados de gamificação...');
        
        // Carregar dados do usuário atual
        const userResponse = await fetch('/api/gamification/points');
        if (userResponse.ok) {
            const userData = await userResponse.json();
            console.log('🎯 Dados do usuário carregados:', userData);
            updateUserGamificationStats(userData);
        } else {
            console.error('❌ Erro ao carregar dados do usuário:', userResponse.status);
        }

        // Carregar top 10 usuários e posição do usuário atual
        const leaderboardResponse = await fetch('/api/gamification/leaderboard?topUsers=10');
        if (leaderboardResponse.ok) {
            const data = await leaderboardResponse.json();
            console.log('🎯 Dados do leaderboard recebidos:', data);
            console.log('🎯 Ranking atualizado com', data.leaderboard?.length || 0, 'usuários');
            updateLeaderboardPreview(data.leaderboard);
            updateUserRankingInfo(data.userRanking);
        } else {
            console.error('❌ Erro ao carregar leaderboard:', leaderboardResponse.status);
        }
        
        console.log('🎯 Dados de gamificação carregados com sucesso');
    } catch (error) {
        console.error('❌ Erro ao carregar dados de gamificação:', error);
    }
}

function updateUserGamificationStats(userData) {
    const pointsElement = document.getElementById('user-points');

    if (pointsElement) {
        pointsElement.textContent = userData.TotalPoints || 0;
    }
}

function updateUserRankingInfo(userRanking) {
    const userRankingInfo = document.getElementById('user-ranking-info');
    const userPosition = document.getElementById('user-position');
    const userTotalPoints = document.getElementById('user-total-points');

    if (userRanking && userRankingInfo) {
        userRankingInfo.style.display = 'block';
        
        // Verificar se o usuário tem pontos
        if (userRanking.hasPoints === false || userRanking.totalPoints === 0) {
            // Usuário sem pontos - mostrar mensagem informativa
            userRankingInfo.innerHTML = `
                <div class="user-ranking-card no-points">
                    <div class="user-ranking-details">
                        <div class="user-ranking-message">
                            <p>Você ainda não possui pontos</p>
                            <p class="points-info">Para ganhar pontos, explore as funcionalidades do sistema:</p>
                            <ul class="points-actions">
                                <li><i class="fas fa-comment"></i> Envie e responda feedbacks</li>
                                <li><i class="fas fa-award"></i> Envie e receba reconhecimentos</li>
                                <li><i class="fas fa-bullseye"></i> Conclua objetivos</li>
                                <li><i class="fas fa-smile"></i> Responda o humor do dia</li>
                                <li><i class="fas fa-poll"></i> Participe de pesquisas</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Usuário com pontos - mostrar posição normal
            if (userPosition) {
                userPosition.textContent = userRanking.position || '-';
            }
            
            if (userTotalPoints) {
                userTotalPoints.textContent = `${userRanking.totalPoints || 0} pontos`;
            }
        }
    } else {
        userRankingInfo.style.display = 'none';
    }
}

function updateLeaderboardPreview(leaderboard) {
    const container = document.getElementById('leaderboard-preview');
    if (!container) return;

    if (!leaderboard || leaderboard.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum dado disponível.</div>';
        return;
    }

    container.innerHTML = leaderboard.map((user, index) => {
        const position = index + 1;
        const positionClass = position === 1 ? 'top-1' : position === 2 ? 'top-2' : position === 3 ? 'top-3' : 'other';

        return `
                    <div class="leaderboard-item">
                        <div class="leaderboard-position ${positionClass}">
                            ${position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : position}
                        </div>
                        <div class="leaderboard-user">
                            <div class="leaderboard-user-name">${user.NomeCompleto || user.UserName}</div>
                            <div class="leaderboard-user-department">${user.DescricaoDepartamento || 'Departamento não informado'}</div>
                        </div>
                        <div class="leaderboard-score">${user.TotalPoints || 0} pts</div>
                    </div>
                `;
    }).join('');
}

// Load filters
async function loadFilters() {
    try {
        const response = await fetch('/api/filters');
        if (response.ok) {
            const filters = await response.json();

            // Update type filters
            const typeContainer = document.getElementById('type-filters');
            typeContainer.innerHTML = filters.types.map(type => `
                        <div class="filter-option" onclick="toggleFilter('type', '${type}')" data-filter="type" data-value="${type}">
                            ${type}
                        </div>
                    `).join('');

            // Update category filters
            const categoryContainer = document.getElementById('category-filters');
            categoryContainer.innerHTML = filters.categories.map(category => `
                        <div class="filter-option" onclick="toggleFilter('category', '${category}')" data-filter="category" data-value="${category}">
                            ${category}
                        </div>
                    `).join('');
        }
    } catch (error) {
        console.error('Erro ao carregar filtros:', error);
    }
}

// Modal functions
function openFeedbackModal() {
    document.getElementById('feedback-modal').classList.remove('hidden');
}

function closeFeedbackModal() {
    clearModalFields('feedback-modal');
    document.getElementById('feedback-modal').classList.add('hidden');
}

function openRecognitionModal() {
    document.getElementById('recognition-modal').classList.remove('hidden');
}

function closeRecognitionModal() {
    clearModalFields('recognition-modal');
    document.getElementById('recognition-modal').classList.add('hidden');
}

// Submit feedback
async function submitFeedback() {
    const toUserId = document.getElementById('feedback-to-user').value;
    const type = document.getElementById('feedback-type').value;
    const category = document.getElementById('feedback-category').value;
    const message = document.getElementById('feedback-message').value;

    if (!toUserId || !type || !category || !message) {
        alert('Todos os campos são obrigatórios');
        return;
    }

    try {
        const response = await fetch('/api/feedbacks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                to_user_id: parseInt(toUserId),
                type,
                category,
                message
            })
        });

        if (response.ok) {
            const result = await response.json();
            closeFeedbackModal();
            loadFeedbacks();
            loadMetrics();
            loadGamificationData(); // Recarregar dados de gamificação
            
            // Mostrar notificação elegante se ganhou pontos
            if (result.pointsEarned > 0) {
                showPointsNotification(result.pointsEarned, 'enviar feedback');
            } else if (result.pointsMessage) {
                showInfoNotification(result.pointsMessage);
            } else {
                showSuccessNotification('Feedback enviado com sucesso!');
            }
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao enviar feedback');
        }
    } catch (error) {
        console.error('Erro ao enviar feedback:', error);
        alert('Erro ao enviar feedback');
    }
}

// Submit recognition
async function submitRecognition() {
    const toUserId = document.getElementById('recognition-to-user').value;
    const message = document.getElementById('recognition-message').value;

    if (!toUserId || !selectedBadge || !message) {
        alert('Todos os campos são obrigatórios');
        return;
    }

    try {
        const response = await fetch('/api/recognitions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                to_user_id: parseInt(toUserId),
                badge: selectedBadge,
                message
            })
        });

        if (response.ok) {
            const result = await response.json();
            closeRecognitionModal();
            loadRecognitions(); // Para o dashboard
            loadMyRecognitions(); // Para a aba de reconhecimentos
            loadMetrics();
            loadGamificationData(); // Recarregar dados de gamificação
            
            // Forçar atualização da aba de reconhecimentos se estiver ativa
            const currentTab = document.querySelector('.tab.active');
            if (currentTab && currentTab.getAttribute('data-tab') === 'recognition') {
                console.log('🎯 Aba de reconhecimentos está ativa - forçando atualização');
                setTimeout(() => {
                    loadMyRecognitions();
                }, 500); // Pequeno delay para garantir que o backend processou
            }
            
            // Mostrar notificação elegante se ganhou pontos
            if (result.pointsEarned > 0) {
                showPointsNotification(result.pointsEarned, 'dar reconhecimento');
            } else if (result.pointsMessage) {
                showInfoNotification(result.pointsMessage);
            } else {
                showSuccessNotification('Reconhecimento enviado com sucesso!');
            }
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao enviar reconhecimento');
        }
    } catch (error) {
        console.error('Erro ao enviar reconhecimento:', error);
        alert('Erro ao enviar reconhecimento');
    }
}

// Filter functions
function toggleFilters() {
    const filterMenu = document.getElementById('filter-menu');
    filterMenu.classList.toggle('hidden');
}

function toggleFilter(type, value) {
    if (activeFilters[type] === value) {
        activeFilters[type] = null;
    } else {
        activeFilters[type] = value;
    }

    // Update UI
    document.querySelectorAll(`[data-filter="${type}"]`).forEach(el => {
        el.classList.toggle('active', el.dataset.value === activeFilters[type]);
    });

    // Reload feedbacks
    loadFeedbacks();
}

// Reaction functions
async function toggleReaction(feedbackId, reactionType) {
    try {
        const response = await fetch(`/api/feedbacks/${feedbackId}/react`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ reaction: reactionType })
        });

        if (response.ok) {
            const result = await response.json();
            const button = document.querySelector(`[data-feedback-id="${feedbackId}"][data-reaction="${reactionType}"]`);

            if (result.action === 'added') {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }

            // Reload feedbacks to update counts
            loadFeedbacks();
        }
    } catch (error) {
        console.error('Erro ao reagir:', error);
    }
}

// Sistema de Chat Melhorado
function toggleReplies(feedbackId) {
    console.log('toggleReplies chamado com ID:', feedbackId);
    console.log('window.feedbackChat existe?', !!window.feedbackChat);
    console.log('window.feedbackChat:', window.feedbackChat);
    
    if (window.feedbackChat) {
        console.log('Chamando openChat...');
        window.feedbackChat.openChat(feedbackId);
    } else {
        console.error('Sistema de chat não carregado');
        console.log('Tentando inicializar FeedbackChat...');
        
        // Tentar inicializar se não existir
        if (typeof FeedbackChat !== 'undefined') {
            window.feedbackChat = new FeedbackChat();
            console.log('FeedbackChat inicializado:', window.feedbackChat);
            window.feedbackChat.openChat(feedbackId);
        } else {
            console.error('Classe FeedbackChat não está disponível');
        }
    }
}

let allColaboradores = [];
let selectedColaboradores = [];

function setupColaboradoresSearch() {
    const searchInput = document.getElementById('colaboradores-search');
    const dropdown = document.getElementById('colaboradores-dropdown');

    if (!searchInput || !dropdown) return;

    searchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase();
        if (searchTerm.length < 2) {
            dropdown.classList.remove('show');
            return;
        }

        const filteredColaboradores = allColaboradores.filter(user => {
            const nome = (user.NomeCompleto || user.nomeCompleto || '').toLowerCase();
            const dept = (user.Departamento || user.departamento || '').toLowerCase();
            return nome.includes(searchTerm) || dept.includes(searchTerm);
        }).filter(user => !selectedColaboradores.find(selected => selected.userId === user.userId));

        if (filteredColaboradores.length > 0) {
            dropdown.innerHTML = filteredColaboradores.map(user => `
                        <div class="colaborador-option" data-user-id="${user.userId}" onclick="selectColaborador(${user.userId})">
                            <i class="fas fa-user"></i>
                            <div>
                                <div style="font-weight: 500;">${user.NomeCompleto || user.nomeCompleto}</div>
                                <div style="font-size: 12px; color: #6b7280;">${user.Departamento || user.departamento}</div>
                            </div>
                        </div>
                    `).join('');
            dropdown.classList.add('show');
        } else {
            dropdown.classList.remove('show');
        }
    });

    // Fechar dropdown ao clicar fora
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.colaboradores-search-container')) {
            dropdown.classList.remove('show');
        }
    });
}

function selectColaborador(userId) {
    const user = allColaboradores.find(u => u.userId === userId);
    if (user && !selectedColaboradores.find(selected => selected.userId === userId)) {
        selectedColaboradores.push(user);
        updateSelectedColaboradores();
        document.getElementById('colaboradores-search').value = '';
        document.getElementById('colaboradores-dropdown').classList.remove('show');
    }
}

function removeColaborador(userId) {
    selectedColaboradores = selectedColaboradores.filter(user => user.userId !== userId);
    updateSelectedColaboradores();
}

function updateSelectedColaboradores() {
    const container = document.getElementById('selected-colaboradores');
    container.innerHTML = selectedColaboradores.map(user => `
                <div class="colaborador-card">
                    <i class="fas fa-user"></i>
                    <span>${user.NomeCompleto || user.nomeCompleto}</span>
                    <button type="button" class="remove-btn" onclick="removeColaborador(${user.userId})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
}

// ===== FUNÇÕES DE OBJETIVOS =====

// Variável para controlar o modo do modal de objetivos
let objetivoModalMode = 'create'; // 'create', 'edit', 'checkin', 'details'
let currentObjetivoId = null;

// Abrir modal de objetivo
function openObjetivoModal() {
    document.getElementById('objetivo-modal').classList.remove('hidden');
    populateObjetivoForm();
}

function closeObjetivoModal() {
    document.getElementById('objetivo-modal').classList.add('hidden');
    clearObjetivoForm();
}

// Submeter objetivo
async function submitObjetivo() {
    // Verificar o modo do modal
    if (objetivoModalMode === 'details') {
        closeObjetivoModal();
        return;
    }
    
    if (objetivoModalMode === 'checkin') {
        await submitCheckin();
        return;
    }
    
    if (objetivoModalMode === 'edit') {
        await submitEditObjetivo();
        return;
    }
    
    // Modo 'create' - criar novo objetivo
    const titulo = document.getElementById('objetivo-titulo')?.value?.trim();
    const descricao = document.getElementById('objetivo-descricao')?.value?.trim();
    const data_inicio = document.getElementById('objetivo-data-inicio')?.value;
    const data_fim = document.getElementById('objetivo-data-fim')?.value;
    
    // Obter responsáveis selecionados
    const selectedRespIds = getSelectedResponsaveisIds();

    // Debug: verificar se os elementos existem
    console.log('🎯 Elementos encontrados:', {
        titulo: document.getElementById('objetivo-titulo'),
        descricao: document.getElementById('objetivo-descricao'),
        data_inicio: document.getElementById('objetivo-data-inicio'),
        data_fim: document.getElementById('objetivo-data-fim')
    });

    // Debug: verificar valores capturados
    console.log('🎯 Valores capturados:', {
        titulo: titulo,
        descricao: descricao,
        data_inicio: data_inicio,
        data_fim: data_fim,
        selectedRespIds: selectedRespIds,
        selectedRespIdsLength: selectedRespIds.length
    });

    // Debug: verificar cada condição da validação
    console.log('🎯 Validação dos campos:');
    console.log('  - titulo:', !!titulo, '(valor:', titulo, ')');
    console.log('  - selectedRespIds.length > 0:', selectedRespIds.length > 0, '(length:', selectedRespIds.length, ')');
    console.log('  - data_inicio:', !!data_inicio, '(valor:', data_inicio, ')');
    console.log('  - data_fim:', !!data_fim, '(valor:', data_fim, ')');
    console.log('  - currentUser.hierarchyLevel:', currentUser?.hierarchyLevel);
    console.log('  - isGestor:', currentUser?.hierarchyLevel >= 3);

    // Validação baseada no nível de hierarquia do usuário
    const isGestor = currentUser && currentUser.hierarchyLevel >= 3;
    let validationFailed = false;
    let missingFields = [];

    if (!titulo) {
        missingFields.push('título');
        validationFailed = true;
    }
    
    if (!data_inicio) {
        missingFields.push('data de início');
        validationFailed = true;
    }
    
    if (!data_fim) {
        missingFields.push('data de fim');
        validationFailed = true;
    }
    
    // Para gestores, validar responsáveis selecionados
    // Para usuários comuns, não validar (eles são automaticamente responsáveis)
    if (isGestor && selectedRespIds.length === 0) {
        missingFields.push('responsável');
        validationFailed = true;
    }

    if (validationFailed) {
        console.error('❌ Validação falhou - campos obrigatórios não preenchidos:', missingFields);
        alert(`⚠️ Campos obrigatórios não preenchidos: ${missingFields.join(', ')}`);
        return;
    }

    if (new Date(data_fim) <= new Date(data_inicio)) {
        alert('A data de fim deve ser posterior à data de início');
        return;
    }

    try {
        // Para usuários não-gestores, usar o ID do usuário atual como responsável
        let responsaveisIds = selectedRespIds;
        if (!isGestor) {
            responsaveisIds = [currentUser.userId];
            console.log('🎯 Usuário não-gestor - definindo como responsável:', currentUser.userId);
        }

        console.log('Enviando dados:', {
            titulo,
            descricao,
            responsaveis_ids: responsaveisIds,
            data_inicio,
            data_fim,
            isGestor: isGestor
        });

        const response = await fetch('/api/objetivos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo,
                descricao,
                responsaveis_ids: responsaveisIds,
                data_inicio,
                data_fim
            })
        });

        console.log('Resposta do servidor:', response.status, response.statusText);

        if (response.ok) {
            const result = await response.json();
            console.log('Objetivo criado com sucesso:', result);
            closeObjetivoModal();
            loadObjetivos();
            alert('Objetivo criado com sucesso!');
        } else {
            const error = await response.json();
            console.error('Erro do servidor:', error);
            alert(error.error || 'Erro ao criar objetivo');
        }
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        alert('Erro ao criar objetivo: ' + error.message);
    }
}

// Função para submeter check-in
async function submitCheckin() {
    const progresso = parseInt(document.getElementById('checkin-progresso').value);
    const observacoes = document.getElementById('checkin-observacoes').value;
    
    console.log('🔍 SubmitCheckin - currentObjetivoId:', currentObjetivoId, 'Tipo:', typeof currentObjetivoId);
    console.log('🔍 SubmitCheckin - progresso:', progresso, 'observacoes:', observacoes);
    
    if (progresso < 0 || progresso > 100) {
        alert('Progresso deve ser entre 0 e 100');
        return;
    }
    
    if (!currentObjetivoId) {
        console.error('❌ SubmitCheckin - currentObjetivoId é null ou undefined');
        alert('Erro: ID do objetivo não encontrado');
        return;
    }
    
    try {
        const response = await fetch(`/api/objetivos/${currentObjetivoId}/checkin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                progresso: progresso,
                observacoes: observacoes
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            reabilitarCamposObjetivo();
            closeObjetivoModal();
            await loadObjetivos();
            
            if (result.pointsEarned) {
                showPointsNotification(result.pointsEarned, 'fazer check-in');
                loadGamificationData(); // Atualizar ranking após ganhar pontos com check-in
            } else {
                showSuccessNotification('Check-in registrado com sucesso!');
            }
            
            if (result.statusUpdate) {
                alert(result.statusUpdate);
            }
        } else {
            alert(result.error || 'Erro ao registrar check-in');
        }
    } catch (error) {
        console.error('Erro ao registrar check-in:', error);
        alert('Erro ao registrar check-in');
    }
}


// Função para reabilitar campos do modal
function reabilitarCamposObjetivo() {
    document.getElementById('objetivo-titulo').disabled = false;
    document.getElementById('objetivo-descricao').disabled = false;
    document.getElementById('objetivo-data-inicio').disabled = false;
    document.getElementById('objetivo-data-fim').disabled = false;
    document.getElementById('objetivo-responsavel-search').disabled = false;
}

// Função para abrir modal de novo objetivo (resetar completamente)
async function openNewObjetivoModal() {
    objetivoModalMode = 'create';
    currentObjetivoId = null;
    await configureObjetivoModal('create');
}

// Função para editar objetivo
async function editObjetivo(objetivoId) {
    console.log('🔧 Editando objetivo:', objetivoId);
    try {
        await configureObjetivoModal('edit', objetivoId);
    } catch (error) {
        console.error('❌ Erro ao abrir modal de edição:', error);
    }
}

// Função para check-in de objetivo
async function checkinObjetivo(objetivoId) {
    console.log('✅ Fazendo check-in do objetivo:', objetivoId, 'Tipo:', typeof objetivoId);
    
    // Converter para número se necessário
    const id = parseInt(objetivoId);
    if (isNaN(id)) {
        console.error('❌ ID do objetivo inválido:', objetivoId);
        alert('Erro: ID do objetivo inválido');
        return;
    }
    
    try {
        await configureObjetivoModal('checkin', id);
    } catch (error) {
        console.error('❌ Erro ao abrir modal de check-in:', error);
    }
}

// Função para visualizar detalhes do objetivo
async function viewObjetivoDetails(objetivoId) {
    console.log('👁️ Visualizando detalhes do objetivo:', objetivoId);
    try {
        await configureObjetivoModal('details', objetivoId);
    } catch (error) {
        console.error('❌ Erro ao abrir modal de detalhes:', error);
    }
}

// Carregar objetivos
async function loadObjetivos() {
    try {
        const container = document.getElementById('objetivos-list');
        if (!container) return;

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando objetivos...</div>';

        // Obter parâmetros de busca e filtros
        const searchTerms = {};
        
        // Busca de texto do objetivo
        const objetivosSearch = document.getElementById('objetivos-search');
        if (objetivosSearch && objetivosSearch.value.trim()) {
            searchTerms.search = objetivosSearch.value.trim();
        }
        
        // Busca por responsável
        const responsavelSearch = document.getElementById('objetivos-responsavel-search');
        if (responsavelSearch && responsavelSearch.value.trim()) {
            searchTerms.responsavel = responsavelSearch.value.trim();
        }
        
        // Filtro por status
        const statusFilter = document.getElementById('objetivos-status-filter');
        if (statusFilter && statusFilter.value.trim()) {
            searchTerms.status = statusFilter.value.trim();
        }
        

        // Construir URL com parâmetros
        const queryParams = new URLSearchParams(searchTerms);
        const url = `/api/objetivos${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        
        console.log('🔍 Carregando objetivos com filtros:', searchTerms);
        console.log('🔍 URL construída:', url);
        console.log('🔍 QueryParams.toString():', queryParams.toString());
        
        const response = await fetch(url);
        if (response.ok) {
            const objetivos = await response.json();
            updateObjetivosList(objetivos);
        } else {
            container.innerHTML = '<div class="loading">Erro ao carregar objetivos.</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar objetivos:', error);
        const container = document.getElementById('objetivos-list');
        if (container) {
            container.innerHTML = '<div class="loading">Erro ao carregar objetivos.</div>';
        }
    }
}

// Atualizar lista de objetivos
function updateObjetivosList(objetivos) {
    const container = document.getElementById('objetivos-list');
    if (!container) return;

    if (objetivos.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum objetivo encontrado.</div>';
        return;
    }

    container.innerHTML = objetivos.map(objetivo => {
        const progresso = objetivo.progresso || 0;
        // Formatar data sem conversão de timezone
        const dataFim = objetivo.data_fim ? formatarDataParaExibicao(objetivo.data_fim) : '';
        // Comparar datas sem conversão de timezone
        const isOverdue = objetivo.data_fim ? new Date(objetivo.data_fim + 'T00:00:00') < new Date() && objetivo.status === 'Ativo' : false;
        const isExpired = objetivo.status === 'Expirado';
        const isWaitingApproval = objetivo.status === 'Aguardando Aprovação';
        const isCompleted = objetivo.status === 'Concluído';
        const isScheduled = objetivo.status === 'Agendado';
        
        // Processar responsáveis únicos (sem duplicação)
        let responsaveisLista = [];
        
        // Adicionar responsável principal se existir
        if (objetivo.responsavel_nome) {
            responsaveisLista.push(objetivo.responsavel_nome.trim());
        }
        
        // Adicionar responsáveis compartilhados se existirem
        if (objetivo.shared_responsaveis && objetivo.shared_responsaveis.length > 0) {
            objetivo.shared_responsaveis.forEach(resp => {
                if (resp.nome_responsavel) {
                    const nome = resp.nome_responsavel.trim();
                    if (nome && !responsaveisLista.includes(nome)) {
                        responsaveisLista.push(nome);
                    }
                }
            });
        }
        
        // Criar string dos responsáveis
        const responsaveisTexto = responsaveisLista.length > 0 
            ? responsaveisLista.join(', ')
            : 'Nenhum responsável';
        
        // Determinar cor do status
        let statusColor = '#6b7280'; // padrão
        let statusIcon = 'fas fa-circle';
        
        switch(objetivo.status) {
            case 'Ativo':
                statusColor = '#10b981';
                statusIcon = 'fas fa-play-circle';
                break;
            case 'Agendado':
                statusColor = '#3b82f6';
                statusIcon = 'fas fa-calendar-alt';
                break;
            case 'Concluído':
                statusColor = '#059669';
                statusIcon = 'fas fa-check-circle';
                break;
            case 'Aguardando Aprovação':
                statusColor = '#f59e0b';
                statusIcon = 'fas fa-clock';
                break;
            case 'Expirado':
                statusColor = '#ef4444';
                statusIcon = 'fas fa-times-circle';
                break;
        }

        return `
                    <div class="objetivo-item">
                        <div class="objetivo-header">
                            <div class="objetivo-info">
                                <h4>${objetivo.titulo}</h4>
                                <p>${objetivo.descricao || 'Sem descrição'}</p>
                                <div style="margin-top: 8px; font-size: 14px; color: #6b7280;">
                                    <span>Responsáveis: ${responsaveisTexto}</span>
                                    <span style="margin-left: 16px;">Prazo: ${dataFim}</span>
                                    ${isOverdue ? '<span style="margin-left: 16px; color: #ef4444;">⚠️ Atrasado</span>' : ''}
                                    ${isExpired ? '<span style="margin-left: 16px; color: #ef4444;">⏰ Expirado</span>' : ''}
                                </div>
                            </div>
                            <div class="objetivo-badges">
                                <span class="badge" style="background-color: ${statusColor}; color: white;">
                                    <i class="${statusIcon}"></i>
                                    ${objetivo.status}
                                </span>
                            </div>
                        </div>
                        <div class="objetivo-progresso">
                            <div class="progresso-bar">
                                <div class="progresso-fill" style="width: ${progresso}%"></div>
                            </div>
                            <div class="progresso-text">
                                <span>Progresso</span>
                                <span>${progresso}%</span>
                            </div>
                        </div>
                        <div class="objetivo-actions">
                            ${objetivo.is_responsible && objetivo.status === 'Ativo' ? `
                            <button class="btn btn-secondary btn-sm" onclick="checkinObjetivo(${objetivo.Id})">
                                <i class="fas fa-check-circle"></i>
                                Check-in
                            </button>
                            ` : ''}
                            ${objetivo.is_responsible && objetivo.status === 'Agendado' ? `
                            <button class="btn btn-secondary btn-sm" disabled title="Check-in disponível apenas após a data de início">
                                <i class="fas fa-calendar-alt"></i>
                                Agendado
                            </button>
                            ` : ''}
                            ${objetivo.can_edit ? `
                                <button class="btn btn-amber btn-sm" onclick="editObjetivo(${objetivo.Id})">
                                    <i class="fas fa-edit"></i>
                                    Editar
                                </button>
                            ` : ''}
                            ${objetivo.status === 'Aguardando Aprovação' && objetivo.criado_por === currentUser.userId ? `
                                <button class="btn btn-success btn-sm" onclick="approveObjetivo(${objetivo.Id})">
                                    <i class="fas fa-check"></i>
                                    Aprovar
                                </button>
                                <button class="btn btn-danger btn-sm" onclick="rejectObjetivo(${objetivo.Id})">
                                    <i class="fas fa-times"></i>
                                    Rejeitar
                                </button>
                            ` : ''}
                            <button class="btn btn-secondary btn-sm" onclick="viewObjetivoDetails(${objetivo.Id})">
                                <i class="fas fa-eye"></i>
                                Ver Detalhes
                            </button>
                            ${objetivo.can_edit ? `
                                <button class="btn btn-danger btn-sm" onclick="deleteObjetivo(${objetivo.Id})">
                                    <i class="fas fa-trash"></i>
                                    Excluir
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
    }).join('');
}

// Submeter edição de objetivo
async function submitEditObjetivo() {
    const objetivoId = currentObjetivoId;
    const titulo = document.getElementById('objetivo-titulo').value;
    const descricao = document.getElementById('objetivo-descricao').value;
    const dataInicio = document.getElementById('objetivo-data-inicio').value;
    const dataFim = document.getElementById('objetivo-data-fim').value;
    
    // Obter responsáveis selecionados
    const selectedRespIds = getSelectedResponsaveisIds();
    
    console.log('📝 Dados para edição:', { 
        objetivoId, 
        titulo, 
        descricao, 
        dataInicio, 
        dataFim, 
        selectedRespIds 
    });
    
    if (!titulo.trim()) {
        alert('Título é obrigatório');
        return;
    }
    
    // Validar campos obrigatórios
    if (!dataInicio) {
        alert('⚠️ Data de início é obrigatória');
        return;
    }
    
    if (!dataFim) {
        alert('⚠️ Data de fim é obrigatória');
        return;
    }
    
    // Validar que a data de fim seja posterior à data de início
    if (new Date(dataFim) <= new Date(dataInicio)) {
        alert('⚠️ A data de fim deve ser posterior à data de início');
        return;
    }
    
    // Validar que há pelo menos um responsável
    if (!selectedRespIds || selectedRespIds.length === 0) {
        alert('⚠️ Não é possível salvar o objetivo sem responsável.\n\nPor favor, selecione pelo menos um responsável para o objetivo.');
        return;
    }
    
    try {
        const requestData = {
            titulo: titulo,
            descricao: descricao,
            data_inicio: dataInicio,
            data_fim: dataFim,
            responsaveis_ids: selectedRespIds
        };
        
        console.log('🚀 Enviando dados para atualização:', requestData);
        
        const response = await fetch(`/api/objetivos/${objetivoId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            closeObjetivoModal();
            loadObjetivos();
            alert('Objetivo atualizado com sucesso!');
        } else {
            alert(result.error || 'Erro ao atualizar objetivo');
        }
    } catch (error) {
        console.error('Erro ao atualizar objetivo:', error);
        alert('Erro ao atualizar objetivo');
    }
}

// Aprovar objetivo
async function approveObjetivo(objetivoId) {
    if (!confirm('Tem certeza que deseja aprovar a conclusão deste objetivo?')) {
        return;
    }

    try {
        const response = await fetch(`/api/objetivos/${objetivoId}/approve`, {
            method: 'POST'
        });
        
        const result = await response.json();

        if (response.ok) {
            loadObjetivos();
            loadGamificationData(); // Atualizar ranking após aprovar objetivo
            
            if (result.pointsEarned > 0) {
                showPointsNotification(result.pointsEarned, 'aprovar objetivo');
            } else {
                showSuccessNotification(result.message);
            }
        } else {
            alert(result.error || 'Erro ao aprovar objetivo');
        }
    } catch (error) {
        console.error('Erro ao aprovar objetivo:', error);
        alert('Erro ao aprovar objetivo');
    }
}

// Rejeitar objetivo
async function rejectObjetivo(objetivoId) {
    if (!confirm('Tem certeza que deseja rejeitar a conclusão deste objetivo? O progresso será revertido para o valor anterior.')) {
        return;
    }

    try {
        const response = await fetch(`/api/objetivos/${objetivoId}/reject`, {
            method: 'POST'
        });
        
        const result = await response.json();

        if (response.ok) {
            loadObjetivos();
            alert('Objetivo rejeitado. O progresso foi revertido para o valor anterior.');
        } else {
            alert(result.error || 'Erro ao rejeitar objetivo');
        }
    } catch (error) {
        console.error('Erro ao rejeitar objetivo:', error);
        alert('Erro ao rejeitar objetivo');
    }
}

// Excluir objetivo
async function deleteObjetivo(objetivoId) {
    if (!confirm('Tem certeza que deseja excluir este objetivo? Esta ação não pode ser desfeita.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/objetivos/${objetivoId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            loadObjetivos();
            alert('Objetivo excluído com sucesso!');
        } else {
            alert(result.error || 'Erro ao excluir objetivo');
        }
    } catch (error) {
        console.error('Erro ao excluir objetivo:', error);
        alert('Erro ao excluir objetivo');
    }
}

function getStatusColor(status) {
    switch(status) {
        case 'Ativo': return '#10b981';
        case 'Agendado': return '#3b82f6';
        case 'Concluído': return '#059669';
        case 'Aguardando Aprovação': return '#f59e0b';
        case 'Expirado': return '#ef4444';
        default: return '#6b7280';
    }
}

// Função para formatar data para exibição sem problemas de timezone
function formatarDataParaExibicao(dataString) {
    if (!dataString) return '';
    
    try {
        // Se a data já está no formato YYYY-MM-DD, usar diretamente
        if (dataString.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [ano, mes, dia] = dataString.split('-');
            return `${dia}/${mes}/${ano}`;
        }
        
        // Se tem timestamp, extrair apenas a data
        const dataPart = dataString.split('T')[0];
        const [ano, mes, dia] = dataPart.split('-');
        return `${dia}/${mes}/${ano}`;
    } catch (error) {
        console.error('Erro ao formatar data:', error, dataString);
        return 'Data inválida';
    }
}

// ===== FUNÇÕES DE HUMOR =====


// Carregar filtros de objetivos
// Função loadObjetivosFilters removida

// Função updateObjetivosStatusFilters removida

// Função toggleObjetivosFilters removida

// Função toggleObjetivosFilter para filtros de status removida

// Funções para objetivos

// ===== FUNÇÕES DE HUMOR =====

// Selecionar humor
function selectHumor(score) {
    selectedHumorScore = score;
    document.querySelectorAll('.humor-option').forEach(option => {
        option.classList.remove('selected');
    });
    document.querySelector(`[data-score="${score}"]`).classList.add('selected');
}

// Registrar humor
async function submitHumor() {
    if (!selectedHumorScore) {
        alert('Selecione um humor');
        return;
    }

    const description = document.getElementById('humor-description').value;

    try {
        const response = await fetch('/api/humor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                score: selectedHumorScore,
                description: description
            })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.pointsEarned > 0) {
                showPointsNotification(result.pointsEarned, 'registrar humor');
                loadGamificationData(); // Atualizar ranking após ganhar pontos com humor
            } else {
                showSuccessNotification('Humor registrado com sucesso!');
            }
            selectedHumorScore = null;
            document.getElementById('humor-description').value = '';
            document.querySelectorAll('.humor-option').forEach(option => {
                option.classList.remove('selected');
            });
            loadHumorData();
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao registrar humor');
        }
    } catch (error) {
        console.error('Erro ao registrar humor:', error);
        alert('Erro ao registrar humor');
    }
}

// Carregar dados de humor
async function loadHumorData() {
    await Promise.all([
        loadMyHumorToday(),
        loadCompanyHumor(),
        loadHumorHistory()
    ]);
}

// Carregar meu humor hoje
async function loadMyHumorToday() {
    try {
        const response = await fetch('/api/humor');
        if (response.ok) {
            const humor = await response.json();
            updateMyHumorToday(humor);
        }
    } catch (error) {
        console.error('Erro ao carregar humor:', error);
    }
}

function updateMyHumorToday(humor) {
    const container = document.getElementById('my-humor-today');
    if (!container) return;

    if (!humor) {
        container.innerHTML = '<p>Você ainda não registrou seu humor hoje.</p>';
        return;
    }

    const humorLabels = ['', 'Muito Triste', 'Triste', 'Neutro', 'Feliz', 'Muito Feliz'];
    const humorIcons = ['', 'fas fa-frown', 'fas fa-meh', 'fas fa-smile', 'fas fa-laugh', 'fas fa-grin-stars'];

    container.innerHTML = `
                <div style="text-align: center;">
                    <i class="${humorIcons[humor.score]}" style="font-size: 48px; color: #f59e0b; margin-bottom: 16px;"></i>
                    <h4>${humorLabels[humor.score]}</h4>
                    ${humor.description ? `<p style="color: #6b7280; margin-top: 8px;">${humor.description}</p>` : ''}
                    <p style="font-size: 12px; color: #9ca3af; margin-top: 16px;">
                        Registrado em ${new Date(new Date(humor.created_at).getTime() + 180 * 60 * 1000).toLocaleString('pt-BR')}
                    </p>
                </div>
            `;
}

// Carregar humor da equipe (apenas para gestores)
async function loadCompanyHumor() {
    try {
        // Verificar se o usuário é gestor
        const isManager = currentUser && currentUser.hierarchyLevel >= 3;
        const companyHumorCard = document.getElementById('company-humor-card');
        const myHumorCard = document.getElementById('my-humor-card');
        const dashboardGrid = document.querySelector('.dashboard-grid');

        if (!isManager) {
            // Usuários comuns não veem a div da equipe
            if (companyHumorCard) {
                companyHumorCard.style.display = 'none';
            }
            // Fazer a div "Seu Humor Hoje" ocupar o espaço completo
            if (myHumorCard) {
                myHumorCard.classList.add('full-width');
            }
            if (dashboardGrid) {
                dashboardGrid.classList.add('single-column');
            }
            return;
        }

        // Mostrar a div para gestores
        if (companyHumorCard) {
            companyHumorCard.style.display = 'block';
        }
        // Remover classe full-width para gestores
        if (myHumorCard) {
            myHumorCard.classList.remove('full-width');
        }
        if (dashboardGrid) {
            dashboardGrid.classList.remove('single-column');
        }

        // Buscar métricas da equipe (últimos 7 dias)
        const response = await fetch('/api/humor/team-metrics');
        if (response.ok) {
            const metrics = await response.json();
            updateCompanyHumor(metrics);
        } else {
            const container = document.getElementById('company-humor');
            if (container) {
                container.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 20px;">Erro ao carregar métricas da equipe.</p>';
            }
        }
    } catch (error) {
        console.error('Erro ao carregar humor da equipe:', error);
        const container = document.getElementById('company-humor');
        if (container) {
            container.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 20px;">Erro ao carregar métricas da equipe.</p>';
        }
    }
}

function updateCompanyHumor(metrics) {
    const container = document.getElementById('company-humor');
    if (!container) return;

    container.innerHTML = `
                <div style="text-align: center;">
                    <h4 style="font-size: 32px; color: #10b981; margin-bottom: 8px;">${metrics.teamAverage.toFixed(1)}</h4>
                    <p style="color: #6b7280;">Média da equipe (últimos 7 dias)</p>
                    <p style="font-size: 12px; color: #9ca3af; margin-top: 8px;">
                        ${metrics.teamMembers} membros da equipe
                    </p>
                </div>
            `;
}

// Carregar histórico de humor (últimos 5 dias)
async function loadHumorHistory() {
    try {
        // Usuários comuns veem apenas seu próprio histórico
        // Gestores veem o histórico da equipe
        const isManager = currentUser && currentUser.hierarchyLevel >= 3;
        const endpoint = isManager ? '/api/humor/team-history' : '/api/humor/history';

        const response = await fetch(endpoint);
        if (response.ok) {
            const history = await response.json();
            updateHumorHistory(history, isManager);
        } else if (response.status === 403) {
            // Se não tem acesso, mostrar apenas histórico individual
            const individualResponse = await fetch('/api/humor/history');
            if (individualResponse.ok) {
                const individualHistory = await individualResponse.json();
                updateHumorHistory(individualHistory, false);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar histórico de humor:', error);
        // Em caso de erro, tentar carregar apenas histórico individual
        try {
            const individualResponse = await fetch('/api/humor/history');
            if (individualResponse.ok) {
                const individualHistory = await individualResponse.json();
                updateHumorHistory(individualHistory, false);
            }
        } catch (fallbackError) {
            console.error('Erro ao carregar histórico individual:', fallbackError);
        }
    }
}

function updateHumorHistory(history, isManager = false) {
    const container = document.getElementById('humor-history');
    if (!container) return;

    if (history.length === 0) {
        container.innerHTML = '<p>Nenhum registro de humor encontrado.</p>';
        return;
    }

    // Histórico individual (para usuários comuns)
    if (!isManager) {
        container.innerHTML = history.map(entry => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #e5e7eb;">
                        <div>
                            <strong>Seu humor</strong>
                            <p style="color: #6b7280; font-size: 14px;">${entry.description || 'Sem descrição'}</p>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-weight: 500; color: #f59e0b;">${entry.score}/5</span>
                            <p style="font-size: 12px; color: #9ca3af;">${new Date(new Date(entry.created_at).getTime() + 180 * 60 * 1000).toLocaleDateString('pt-BR')}</p>
                        </div>
                    </div>
                `).join('');
        return;
    }

    // Histórico da equipe (para gestores)
    container.innerHTML = history.map(entry => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #e5e7eb;">
                    <div>
                        <strong>${entry.user_name || 'Usuário'}</strong>
                        <p style="color: #6b7280; font-size: 14px;">${entry.department || entry.description || 'Sem descrição'}</p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-weight: 500; color: #f59e0b;">${entry.score}/5</span>
                        <p style="font-size: 12px; color: #9ca3af;">${new Date(new Date(entry.created_at).getTime() + 180 * 60 * 1000).toLocaleDateString('pt-BR')}</p>
                    </div>
                </div>
            `).join('');
}

// ===== FUNÇÕES DE OBJETIVOS =====



// Abrir modal de objetivo
function openObjetivoModal() {
    document.getElementById('objetivo-modal').classList.remove('hidden');
    populateObjetivoForm();
}

function closeObjetivoModal() {
    document.getElementById('objetivo-modal').classList.add('hidden');
    clearObjetivoForm();
}

function clearObjetivoForm() {
    const tituloEl = document.getElementById('objetivo-titulo');
    const descricaoEl = document.getElementById('objetivo-descricao');
    const responsavelEl = document.getElementById('objetivo-responsavel');
    const responsavelSearchEl = document.getElementById('objetivo-responsavel-search');
    const dataInicioEl = document.getElementById('objetivo-data-inicio');
    const dataFimEl = document.getElementById('objetivo-data-fim');

    if (tituloEl) tituloEl.value = '';
    if (descricaoEl) descricaoEl.value = '';
    if (responsavelEl) responsavelEl.value = '';
    if (responsavelSearchEl) responsavelSearchEl.value = '';
    if (dataInicioEl) dataInicioEl.value = '';
    if (dataFimEl) dataFimEl.value = '';
    
    // Limpar responsáveis selecionados
    clearSelectedResponsaveis();
}

// Função unificada para limpar o modal
function clearObjetivoModal() {
    clearObjetivoForm();
    
    // Limpar campos de check-in
    const checkinProgresso = document.getElementById('checkin-progresso');
    const checkinObservacoes = document.getElementById('checkin-observacoes');
    if (checkinProgresso) checkinProgresso.value = '';
    if (checkinObservacoes) checkinObservacoes.value = '';
    
    // Limpar campos de detalhes
    const status = document.getElementById('objetivo-status');
    const progressoAtual = document.getElementById('objetivo-progresso-atual');
    const criadoPor = document.getElementById('objetivo-criado-por');
    if (status) status.value = '';
    if (progressoAtual) progressoAtual.value = '';
    if (criadoPor) criadoPor.value = '';
    
    // Resetar visibilidade do campo responsável
    const responsavelField = document.getElementById('responsavel-field');
    if (responsavelField) {
        responsavelField.style.display = 'block'; // Padrão: mostrar
    }
    
    // Mostrar botões de ação por padrão
    const modalActions = document.getElementById('objetivo-modal-actions');
    if (modalActions) {
        modalActions.style.display = 'flex';
    }
}

// Configurar modal de objetivo baseado no modo
async function configureObjetivoModal(mode, objetivoId = null) {
    console.log('🔧 Configurando modal:', { mode, objetivoId });
    
    objetivoModalMode = mode;
    currentObjetivoId = objetivoId;
    
    console.log('🔧 ConfigureObjetivoModal - Modo:', mode, 'ObjetivoId:', objetivoId, 'currentObjetivoId:', currentObjetivoId);
    
    const modal = document.getElementById('objetivo-modal');
    const title = document.getElementById('objetivo-modal-title');
    const submitBtn = document.getElementById('objetivo-submit-btn');
    const checkinFields = document.getElementById('checkin-fields');
    const detalhesFields = document.getElementById('detalhes-fields');
    
    console.log('🔍 Elementos do modal:', { modal, title, submitBtn, checkinFields, detalhesFields });
    
    // Resetar campos e reabilitar todos os campos
    clearObjetivoModal();
    reabilitarCamposObjetivo();
    
    // Configurar visibilidade do campo responsável
    const responsavelField = document.getElementById('responsavel-field');
    
    switch(mode) {
        case 'create':
            title.innerHTML = '<i class="fas fa-bullseye"></i> Novo Objetivo';
            submitBtn.innerHTML = '<i class="fas fa-bullseye"></i> Criar Objetivo';
            submitBtn.className = 'btn btn-amber';
            checkinFields.classList.add('hidden');
            detalhesFields.classList.add('hidden');
            
            // Mostrar botões de ação
            const modalActionsCreate = document.getElementById('objetivo-modal-actions');
            if (modalActionsCreate) {
                modalActionsCreate.style.display = 'flex';
            }
            
            // Mostrar campo responsável apenas para gestores
            if (currentUser && currentUser.hierarchyLevel >= 3) {
                responsavelField.style.display = 'block';
                try {
                    await populateObjetivoForm();
                } catch (error) {
                    console.error('❌ Erro ao popular formulário:', error);
                }
            } else {
                responsavelField.style.display = 'none';
                // Para usuários não-gestores, definir eles mesmos como responsável
                document.getElementById('objetivo-responsavel').value = currentUser.userId;
                document.getElementById('objetivo-responsavel-search').value = currentUser.nomeCompleto || 'Você';
            }
            break;
            
        case 'edit':
            title.innerHTML = '<i class="fas fa-edit"></i> Editar Objetivo';
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Salvar Alterações';
            submitBtn.className = 'btn btn-amber';
            checkinFields.classList.add('hidden');
            detalhesFields.classList.add('hidden');
            
            // Mostrar campo responsável apenas para gestores
            if (currentUser && currentUser.hierarchyLevel >= 3) {
                responsavelField.style.display = 'block';
            } else {
                responsavelField.style.display = 'none';
            }
            
            // Mostrar botões de ação
            const modalActionsEdit = document.getElementById('objetivo-modal-actions');
            if (modalActionsEdit) {
                modalActionsEdit.style.display = 'flex';
            }
            
            // Popular lista de usuários para gestores
            if (currentUser && currentUser.hierarchyLevel >= 3) {
                try {
                    console.log('🔧 Populando lista de usuários para modo edição...');
                    await populateObjetivoForm();
                    console.log('✅ Lista de usuários populada para modo edição');
                } catch (error) {
                    console.error('❌ Erro ao popular lista de usuários:', error);
                }
            }
            
            // Reabilitar todos os campos para modo edit
            reabilitarCamposObjetivo();
            
            try {
                await loadObjetivoForEdit(objetivoId);
            } catch (error) {
                console.error('❌ Erro ao carregar objetivo para edição:', error);
            }
            break;
            
        case 'checkin':
            title.innerHTML = '<i class="fas fa-check-circle"></i> Check-in do Objetivo';
            submitBtn.innerHTML = '<i class="fas fa-check"></i> Registrar Check-in';
            submitBtn.className = 'btn btn-amber';
            checkinFields.classList.remove('hidden');
            detalhesFields.classList.add('hidden');
            
            // Mostrar campo responsável apenas para gestores
            if (currentUser && currentUser.hierarchyLevel >= 3) {
                responsavelField.style.display = 'block';
            } else {
                responsavelField.style.display = 'none';
            }
            
            // Mostrar botões de ação
            const modalActionsCheckin = document.getElementById('objetivo-modal-actions');
            if (modalActionsCheckin) {
                modalActionsCheckin.style.display = 'flex';
            }
            
            // Popular lista de usuários para gestores
            if (currentUser && currentUser.hierarchyLevel >= 3) {
                try {
                    console.log('🔧 Populando lista de usuários para modo check-in...');
                    await populateObjetivoForm();
                    console.log('✅ Lista de usuários populada para modo check-in');
                } catch (error) {
                    console.error('❌ Erro ao popular lista de usuários:', error);
                }
            }
            
            try {
                await loadObjetivoForCheckin(objetivoId);
            } catch (error) {
                console.error('❌ Erro ao carregar objetivo para check-in:', error);
            }
            break;
            
        case 'details':
            title.innerHTML = '<i class="fas fa-eye"></i> Detalhes do Objetivo';
            submitBtn.innerHTML = '<i class="fas fa-times"></i> Fechar';
            submitBtn.className = 'btn btn-secondary';
            checkinFields.classList.add('hidden');
            detalhesFields.classList.remove('hidden');
            
            // Mostrar campo responsável apenas para gestores
            if (currentUser && currentUser.hierarchyLevel >= 3) {
                responsavelField.style.display = 'block';
            } else {
                responsavelField.style.display = 'none';
            }
            
            // Ocultar botões de ação no modo detalhes
            const modalActions = document.getElementById('objetivo-modal-actions');
            console.log('🔍 Elemento modal-actions encontrado:', modalActions);
            if (modalActions) {
                modalActions.style.display = 'none';
                console.log('✅ Botões de ação ocultados no modo detalhes');
        } else {
                console.error('❌ Elemento objetivo-modal-actions não encontrado');
        }
            
            try {
                await loadObjetivoForDetails(objetivoId);
    } catch (error) {
                console.error('❌ Erro ao carregar objetivo para detalhes:', error);
            }
            break;
    }
    
    console.log('✅ Modal configurado, abrindo...');
    modal.classList.remove('hidden');
    console.log('🎉 Modal aberto com sucesso!');
}

// Funções auxiliares para carregar dados nos diferentes modos
async function loadObjetivoForEdit(objetivoId) {
    try {
        console.log('🔍 Carregando objetivo para edição:', objetivoId);
        const response = await fetch(`/api/objetivos/${objetivoId}`);

        if (response.ok) {
            const objetivo = await response.json();
            console.log('📋 Dados do objetivo carregados:', objetivo);
            
            // Preencher campos básicos
            document.getElementById('objetivo-titulo').value = objetivo.titulo || '';
            document.getElementById('objetivo-descricao').value = objetivo.descricao || '';
            
            // Formatar datas para o input type="date" (YYYY-MM-DD)
            const dataInicio = objetivo.data_inicio ? objetivo.data_inicio.split('T')[0] : '';
            const dataFim = objetivo.data_fim ? objetivo.data_fim.split('T')[0] : '';
            
            document.getElementById('objetivo-data-inicio').value = dataInicio;
            document.getElementById('objetivo-data-fim').value = dataFim;
            
            // Configurar responsáveis múltiplos (similar ao modal de detalhes)
            console.log('👥 Processando responsáveis para edição - compartilhados:', objetivo.shared_responsaveis);
            console.log('👤 Responsável principal:', objetivo.responsavel_nome);
            console.log('🔍 Objetivo completo:', objetivo);
            
            // Processar responsáveis únicos (sem duplicação)
            let responsaveisLista = [];
            
            // Adicionar responsável principal se existir
            if (objetivo.responsavel_nome) {
                responsaveisLista.push(objetivo.responsavel_nome.trim());
            }
            
            // Adicionar responsáveis compartilhados se existirem
            if (objetivo.shared_responsaveis && objetivo.shared_responsaveis.length > 0) {
                objetivo.shared_responsaveis.forEach(resp => {
                    console.log('🔍 Responsável compartilhado encontrado:', resp);
                    if (resp.nome_responsavel) {
                        const nome = resp.nome_responsavel.trim();
                        if (nome && !responsaveisLista.includes(nome)) {
                            responsaveisLista.push(nome);
                        }
                    }
                });
            }
            
            console.log('✅ Lista final de responsáveis para edição:', responsaveisLista);
            
            // Preencher o array global de responsáveis selecionados para edit
            selectedResponsaveis = [];
            
            // Primeiro adicionar o responsável principal com seu ID normalize
            if (objetivo.responsavel_nome) {
                selectedResponsaveis.push({
                    id: parseInt(objetivo.responsavel_id, 10),
                    name: objetivo.responsavel_nome.trim()
                });
            }
            
            // Depois adicionar responsáveis compartilhados
            if (objetivo.shared_responsaveis && objetivo.shared_responsaveis.length > 0) {
                objetivo.shared_responsaveis.forEach(resp => {
                    if (resp.nome_responsavel && resp.responsavel_id) {
                        const nomeCompleto = resp.nome_responsavel.trim();
                        const idNormalized = parseInt(resp.responsavel_id, 10);
                        const principalIdNormalized = parseInt(objetivo.responsavel_id, 10);
                        
                        // Verificar se não é duplicado (comparar com responsável principal usando IDs normalizados)
                        if (principalIdNormalized === idNormalized) {
                            // É o responsável principal, não adicionar novamente
                            console.log(`⚠️ Responsável compartilhado ${nomeCompleto} é duplicado do responsável principal`);
        return;
    }

                        selectedResponsaveis.push({
                            id: idNormalized,
                            name: nomeCompleto
                        });
                    }
                });
            }
            
            // Atualizar a UI dos responsáveis
            updateSelectedResponsaveisUI();
            
            // Limpar campo de busca
            document.getElementById('objetivo-responsavel-search').value = '';
            
            console.log('📋 Responsáveis selecionados para edição:', selectedResponsaveis);
            
            // Configurar permissões de edição
            const canEditDate = objetivo.criado_por === currentUser.userId && objetivo.status !== 'Aguardando Aprovação';
            document.getElementById('objetivo-data-inicio').disabled = !canEditDate;
            document.getElementById('objetivo-data-fim').disabled = !canEditDate;
            
            console.log('🔐 Permissões:', { canEditDate, criado_por: objetivo.criado_por, currentUserId: currentUser.userId });
        } else {
            const error = await response.json();
            console.error('❌ Erro na resposta:', error);
            alert('Erro ao carregar dados do objetivo: ' + (error.error || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('❌ Erro ao carregar objetivo para edição:', error);
        alert('Erro ao carregar dados do objetivo');
    }
}

async function loadObjetivoForCheckin(objetivoId) {
    try {
        console.log('🔍 Carregando objetivo para check-in:', objetivoId);
        const response = await fetch(`/api/objetivos/${objetivoId}`);

        if (response.ok) {
            const objetivo = await response.json();
            console.log('📋 Dados do objetivo carregados:', objetivo);
            
            // Preencher campos básicos (somente leitura)
            document.getElementById('objetivo-titulo').value = objetivo.titulo || '';
            document.getElementById('objetivo-descricao').value = objetivo.descricao || '';
            
            // Formatar datas
            const dataInicio = objetivo.data_inicio ? objetivo.data_inicio.split('T')[0] : '';
            const dataFim = objetivo.data_fim ? objetivo.data_fim.split('T')[0] : '';
            
            document.getElementById('objetivo-data-inicio').value = dataInicio;
            document.getElementById('objetivo-data-fim').value = dataFim;
            
            // Configurar responsável
            const responsavelNome = objetivo.responsavel_nome || '';
            document.getElementById('objetivo-responsavel-search').value = responsavelNome;
            document.getElementById('objetivo-responsavel').value = objetivo.responsavel_id || '';
            
            // Desabilitar campos básicos (somente leitura)
            document.getElementById('objetivo-titulo').disabled = true;
            document.getElementById('objetivo-descricao').disabled = true;
            document.getElementById('objetivo-data-inicio').disabled = true;
            document.getElementById('objetivo-data-fim').disabled = true;
            document.getElementById('objetivo-responsavel-search').disabled = true;
            
            // Definir progresso atual como valor inicial
            document.getElementById('checkin-progresso').value = objetivo.progresso || 0;
        } else {
            const error = await response.json();
            console.error('❌ Erro na resposta:', error);
            alert('Erro ao carregar dados do objetivo: ' + (error.error || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('❌ Erro ao carregar objetivo para check-in:', error);
        alert('Erro ao carregar dados do objetivo');
    }
}

async function loadObjetivoForDetails(objetivoId) {
    try {
        console.log('🔍 Carregando objetivo para detalhes:', objetivoId);
        const response = await fetch(`/api/objetivos/${objetivoId}`);

        if (response.ok) {
            const objetivo = await response.json();
            console.log('📋 Dados do objetivo carregados:', objetivo);
            
            // Preencher campos básicos (somente leitura)
            document.getElementById('objetivo-titulo').value = objetivo.titulo || '';
            document.getElementById('objetivo-descricao').value = objetivo.descricao || '';
            
            // Formatar datas
            const dataInicio = objetivo.data_inicio ? objetivo.data_inicio.split('T')[0] : '';
            const dataFim = objetivo.data_fim ? objetivo.data_fim.split('T')[0] : '';
            
            document.getElementById('objetivo-data-inicio').value = dataInicio;
            document.getElementById('objetivo-data-fim').value = dataFim;
            
            // Configurar responsável(s) - possível múltiplos responsáveis
            console.log('👥 Processando responsáveis - compartilhados:', objetivo.shared_responsaveis);
            console.log('👤 Responsável principal:', objetivo.responsavel_nome);
            console.log('🔍 Objetivo completo:', objetivo);
            
            let responsaveisText = '';
            const responsaveisLista = [];
            
            // Processar primeiro todos os responsáveis compartilhados
            if (objetivo.shared_responsaveis && objetivo.shared_responsaveis.length > 0) {
                objetivo.shared_responsaveis.forEach(resp => {
                    console.log('🔍 Responsável compartilhado:', resp);
                    if (resp.nome_responsavel) {
                        const nome = resp.nome_responsavel.trim();
                        if (nome && !responsaveisLista.includes(nome)) {
                            responsaveisLista.push(nome);
                        }
                    }
                });
            }
            
            // Depois adicionar responsável principal se não estiver na lista
            if (objetivo.responsavel_nome) {
                const responsavelPrincipal = objetivo.responsavel_nome.trim();
                if (responsavelPrincipal && !responsaveisLista.includes(responsavelPrincipal)) {
                    responsaveisLista.push(responsavelPrincipal);
                }
            }
            
            console.log('✅ Lista final de responsáveis:', responsaveisLista);
            
            // Combinar responsáveis em texto único
            if (responsaveisLista.length > 0) {
                responsaveisText = responsaveisLista.join(', ');
            }
            
            // Para modal de detalhes, preencher os responsáveis como chips no container apropriado
            const selectedContainer = document.getElementById('selected-responsaveis-container');
            console.log('🏗️ Container detected? ', !!selectedContainer);
            console.log('📋 Responsáveis para chips:', responsaveisLista);
            
            if (selectedContainer && responsaveisLista.length > 0) {
                selectedContainer.innerHTML = '';
                
                // Adicionar todos os responsáveis como chips
                responsaveisLista.forEach((nome, index) => {
                    console.log('🔨 Creating chip for:', nome);
                    const responsavelChip = document.createElement('div');
                    responsavelChip.className = 'selected-responsavel';
                    responsavelChip.style.marginRight = '8px';
                    responsavelChip.style.marginBottom = '8px';
                    responsavelChip.innerHTML = `
                        ${nome} 
                        <i class="fas fa-user" style="pointer-events: none; font-size: 10px; color: rgba(255,255,255,0.5);"></i>
                    `;
                    
                    selectedContainer.appendChild(responsavelChip);
                });
                console.log('✅ Chips adicionados dentro do container');
            } else if (responsaveisLista.length > 0) {
                console.log('⚠️ Container not found, fallback para campo busca');
                // Fallback para o campo de busca caso o container não esteja disponível
                document.getElementById('objetivo-responsavel-search').value = responsaveisText;
            } else {
                console.log('📑 Sem responsáveis na lista, clear field');
                if (selectedContainer) {
                    selectedContainer.innerHTML = '<div class="no-responsavel-placeholder">Nenhum responsável selecionado</div>';
                }
            }
            
            document.getElementById('objetivo-responsavel').value = objetivo.responsavel_id || '';
            
            // Preencher campos de detalhes
            document.getElementById('objetivo-status').value = objetivo.status || '';
            document.getElementById('objetivo-progresso-atual').value = `${objetivo.progresso || 0}%`;
            document.getElementById('objetivo-criado-por').value = objetivo.criador_nome || '';
            
            // Carregar histórico de check-ins
            await loadCheckinsHistory(objetivoId);
            
            // Desabilitar todos os campos (somente leitura)
            document.getElementById('objetivo-titulo').disabled = true;
            document.getElementById('objetivo-descricao').disabled = true;
            document.getElementById('objetivo-data-inicio').disabled = true;
            document.getElementById('objetivo-data-fim').disabled = true;
            const searchField = document.getElementById('objetivo-responsavel-search');
            if (searchField) {
                searchField.disabled = true;
                searchField.value = ''; // Limpar campo de busca já que os responsáveis estão nos chips
            }
        } else {
            const error = await response.json();
            console.error('❌ Erro na resposta:', error);
            alert('Erro ao carregar dados do objetivo: ' + (error.error || 'Erro desconhecido'));
        }
    } catch (error) {
        console.error('❌ Erro ao carregar objetivo para detalhes:', error);
        alert('Erro ao carregar dados do objetivo');
    }
}

async function populateObjetivoForm() {
    console.log('Populando formulário de objetivo...');
    console.log('Usuários disponíveis:', users);
    console.log('Usuário atual:', currentUser);
    
    // Filtrar usuários baseado no tipo de usuário
    let availableUsers = [];
    
    if (currentUser && currentUser.hierarchyLevel >= 3) {
        // Gestor: buscar usuários acessíveis via API
        try {
            console.log('🔍 Buscando usuários acessíveis para gestor...');
            const response = await fetch('/api/users');
            if (response.ok) {
                const allUsers = await response.json();
                console.log('👥 Usuários acessíveis para gestor:', allUsers);
                
                // Remover duplicatas e filtrar usuários únicos
                const uniqueUsers = new Map();
                
                allUsers.forEach(user => {
                    const userId = user.userId || user.id || user.Id;
                    if (userId && !uniqueUsers.has(userId)) {
                        uniqueUsers.set(userId, user);
                    }
                });
                
                availableUsers = Array.from(uniqueUsers.values());
                
                console.log('✅ Usuários únicos para gestor:', availableUsers);
            } else {
                console.error('❌ Erro ao buscar usuários acessíveis');
                // Fallback: usar lista local
                availableUsers = users.filter(user => {
                    const userId = user.userId || user.id || user.Id;
                    const currentUserId = currentUser.userId || currentUser.id || currentUser.Id;
                    return userId == currentUserId;
                });
            }
        } catch (error) {
            console.error('❌ Erro ao buscar usuários acessíveis:', error);
            // Fallback: usar lista local
            availableUsers = users.filter(user => {
                const userId = user.userId || user.id || user.Id;
                const currentUserId = currentUser.userId || currentUser.id || currentUser.Id;
                return userId == currentUserId;
            });
        }
    } else {
        // Usuário comum: apenas ele mesmo
        availableUsers = users.filter(user => {
            const userId = user.userId || user.id || user.Id;
            const currentUserId = currentUser.userId || currentUser.id || currentUser.Id;
            return userId == currentUserId;
        });
    }
    
    console.log('Usuários disponíveis para seleção:', availableUsers);
    
    // Preencher lista de usuários para o searchable select
    const responsavelList = document.getElementById('objetivo-responsavel-list');
    if (responsavelList) {
        responsavelList.innerHTML = `
            <div class="select-option" data-value="" onclick="selectMultipleUser('', '')">
                Selecionar responsáveis...
            </div>
        `;
        
        // Usar Set para evitar duplicatas na renderização
        const renderedUserIds = new Set();
        
        availableUsers.forEach(user => {
            const userId = user.userId || user.id || user.Id;
            const userIdNum = parseInt(userId, 10);
            
            // Verificar se o usuário já está selecionado como responsável
            const isAlreadySelected = selectedResponsaveis.some(selected => {
                const selectedId = typeof selected.id === 'string' ? parseInt(selected.id, 10) : selected.id;
                return selectedId === userIdNum;
            });
            
            if (isAlreadySelected) {
                console.log(`⚠️ Usuário ${userId} já selecionado, pulando...`);
                return; // Não mostrar na lista de usuários disponíveis
            }
            
            const userName = user.nomeCompleto || user.NomeCompleto || user.name || 'Nome não informado';
            const userDept = user.departamento || user.Departamento || user.department || 'Departamento não informado';
            const displayName = `${userName} - ${userDept}`;
            
            // Verificar se já foi renderizado
            if (!renderedUserIds.has(userId)) {
                renderedUserIds.add(userId);
                
                responsavelList.innerHTML += `
                    <div class="select-option" data-value="${userId}" onclick="selectMultipleUser('${userId}', '${displayName}')">
                        ${displayName}
                    </div>
                `;
            }
        });
        
        // Inicializar interface de responsáveis selecionados
        updateSelectedResponsaveisUI();
        
        console.log('Lista de responsáveis populada com', renderedUserIds.size, 'usuários únicos');
        
        // Adicionar funcionalidade para limpar o campo automaticamente
        const responsavelSearch = document.getElementById('objetivo-responsavel-search');
        if (responsavelSearch) {
            // Limpar quando clicar no campo
            responsavelSearch.addEventListener('focus', function() {
                if (this.value === 'Selecionar responsável...') {
                    this.value = '';
                }
            });
            
            // Limpar quando começar a digitar
            responsavelSearch.addEventListener('input', function() {
                if (this.value === 'Selecionar responsável...') {
                    this.value = '';
                }
            });
        }
        } else {
        console.error('Elemento objetivo-responsavel-list não encontrado');
    }
}





// Carregar histórico de check-ins
async function loadCheckinsHistory(objetivoId) {
    try {
        console.log('🔍 Carregando histórico de check-ins para objetivo:', objetivoId);
        const response = await fetch(`/api/objetivos/${objetivoId}/checkins`);

        if (response.ok) {
            const checkins = await response.json();
            console.log('📋 Check-ins carregados:', checkins);
            
            // Encontrar o container do histórico de check-ins
            let checkinsContainer = document.getElementById('checkins-history');
            if (!checkinsContainer) {
                // Criar container se não existir
                checkinsContainer = document.createElement('div');
                checkinsContainer.id = 'checkins-history';
                checkinsContainer.className = 'checkins-history';
                
                // Adicionar título
                const title = document.createElement('h4');
                title.textContent = 'Histórico de Check-ins';
                title.className = 'checkins-title';
                checkinsContainer.appendChild(title);
                
                // Adicionar container dos check-ins
                const checkinsList = document.createElement('div');
                checkinsList.id = 'checkins-list';
                checkinsList.className = 'checkins-list';
                checkinsContainer.appendChild(checkinsList);
                
                // Inserir após os campos de detalhes
                const detalhesFields = document.getElementById('detalhes-fields');
                if (detalhesFields) {
                    detalhesFields.appendChild(checkinsContainer);
                }
            }
            
            // Limpar lista anterior
            const checkinsList = document.getElementById('checkins-list');
            if (checkinsList) {
                checkinsList.innerHTML = '';
                
                if (checkins.length === 0) {
                    checkinsList.innerHTML = '<p class="no-checkins">Nenhum check-in registrado ainda.</p>';
        } else {
                    // Ordenar check-ins por data (mais recente primeiro)
                    checkins.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    
                    checkins.forEach((checkin, index) => {
                        const checkinItem = document.createElement('div');
                        checkinItem.className = 'checkin-item';
                        
                        const date = new Date(checkin.created_at);
                        const formattedDate = date.toLocaleDateString('pt-BR');
                        const formattedTime = date.toLocaleTimeString('pt-BR', { 
                            hour: '2-digit', 
                            minute: '2-digit' 
                        });
                        
                        checkinItem.innerHTML = `
                            <div class="checkin-header">
                                <div class="checkin-date">
                                    <i class="fas fa-calendar-alt"></i>
                                    ${formattedDate} às ${formattedTime}
                                </div>
                                <div class="checkin-progress">
                                    <span class="progress-badge">${checkin.progresso}%</span>
                                </div>
                            </div>
                            ${checkin.observacoes ? `
                                <div class="checkin-observacoes">
                                    <i class="fas fa-comment"></i>
                                    ${checkin.observacoes}
                                </div>
                            ` : ''}
                        `;
                        
                        checkinsList.appendChild(checkinItem);
                    });
                }
            }
        } else {
            console.error('❌ Erro ao carregar check-ins:', response.status);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar histórico de check-ins:', error);
    }
}

// Filtros de objetivos

function toggleObjetivosFilter(type, value) {
    if (activeObjetivosFilters[type] === value) {
        activeObjetivosFilters[type] = null;
    } else {
        activeObjetivosFilters[type] = value;
    }

    // Update UI
    document.querySelectorAll(`[data-objetivo-filter="${type}"]`).forEach(el => {
        el.classList.toggle('active', el.dataset.value === activeObjetivosFilters[type]);
    });

    // Reload objetivos
    loadObjetivos();
}


function updateObjetivosFilters(filters) {
    // Update departamento filters
    const deptContainer = document.getElementById('dept-filters');
    deptContainer.innerHTML = filters.departamentos.map(dept => `
                <div class="filter-option" onclick="toggleObjetivosFilter('departamento', '${dept}')" data-objetivo-filter="departamento" data-value="${dept}">
                    ${dept}
                </div>
            `).join('');

    // Update status filters
    const statusContainer = document.getElementById('status-filters');
    statusContainer.innerHTML = filters.status.map(status => `
                <div class="filter-option" onclick="toggleObjetivosFilter('status', '${status}')" data-objetivo-filter="status" data-value="${status}">
                    ${status}
                </div>
            `).join('');

    // Update tipo filters
    const tipoContainer = document.getElementById('tipo-filters');
    tipoContainer.innerHTML = filters.tipos.map(tipo => `
                <div class="filter-option" onclick="toggleObjetivosFilter('tipo', '${tipo}')" data-objetivo-filter="tipo" data-value="${tipo}">
                    ${tipo}
                </div>
            `).join('');
}

// ===== FUNÇÕES DE PESQUISA RÁPIDA =====

// Verificar permissões para criar pesquisas
async function checkPesquisaPermissions() {
    try {
        // Verificar se o usuário é RH ou T&D
        const user = currentUser;
        const departamento = user?.departamento ? user.departamento.toUpperCase() : '';
        const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
        const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     departamento.includes('TREINAMENTO') || 
                     departamento.includes('DESENVOLVIMENTO') ||
                     departamento.includes('T&D');
        const isAdmin = user?.role === 'Administrador';
        
        const canCreate = isAdmin || isHR || isTD;
        
        const createSurveyBtn = document.getElementById('create-survey-btn');
        if (createSurveyBtn) {
            createSurveyBtn.style.display = canCreate ? 'inline-block' : 'none';
        }
        
        console.log('📝 Permissões de pesquisa:', { canCreate, isHR, isTD, isAdmin });
        
    } catch (error) {
        console.error('Erro ao verificar permissões de pesquisa:', error);
    }
}

// ====================================
// FUNÇÕES PARA ABA DE AVALIAÇÕES
// ====================================

/**
 * Verifica se o usuário tem permissão para ver o botão de alternância na aba de Avaliações
 * Setores com acesso: RH, T&D, DEPARTAMENTO ADM/RH/SESMT
 */
async function checkAvaliacoesPermissions() {
    try {
        const user = currentUser;
        const departamento = user?.departamento ? user.departamento.toUpperCase().trim() : '';
        
        // Verificar se o usuário é RH, T&D ou DEPARTAMENTO ADM/RH/SESMT
        const isHR = departamento.includes('RH') || departamento.includes('RECURSOS HUMANOS');
        const isTD = departamento.includes('DEPARTAMENTO TREINAM&DESENVOLV') || 
                     departamento.includes('TREINAMENTO') || 
                     departamento.includes('DESENVOLVIMENTO') ||
                     departamento.includes('T&D');
        const isDeptAdm = (departamento.includes('DEPARTAMENTO ADM') && departamento.includes('SESMT')) ||
                          (departamento.startsWith('DEPARTAMENTO ADM/RH'));
        const isAdmin = user?.role === 'Administrador';
        
        // Usuários desses setores têm acesso ao botão de alternância
        const canViewAllEvaluations = isAdmin || isHR || isTD || isDeptAdm;
        
        const toggleButtons = document.getElementById('avaliacoes-toggle-buttons');
        if (toggleButtons) {
            toggleButtons.style.display = canViewAllEvaluations ? 'block' : 'none';
        }
        
        // Mostrar/ocultar botão de editar templates
        const btnEditarTemplates = document.getElementById('btn-editar-templates');
        if (btnEditarTemplates) {
            btnEditarTemplates.style.display = canViewAllEvaluations ? 'inline-flex' : 'none';
        }
        
        console.log('📋 Permissões de avaliações:', { 
            canViewAllEvaluations, 
            isHR, 
            isTD, 
            isDeptAdm,
            isAdmin,
            departamento 
        });
        
    } catch (error) {
        console.error('Erro ao verificar permissões de avaliações:', error);
    }
}

/**
 * Alterna entre visualizações de avaliações (Minhas / Todas)
 * @param {string} view - 'minhas' ou 'todas'
 */
function toggleAvaliacoesView(view) {
    // Atualizar botões ativos
    const buttons = document.querySelectorAll('.btn-toggle');
    buttons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-view') === view) {
            btn.classList.add('active');
        }
    });
    
    // Alternar visualizações
    const minhasView = document.getElementById('minhas-avaliacoes-view');
    const todasView = document.getElementById('todas-avaliacoes-view');
    
    if (view === 'minhas') {
        minhasView.style.display = 'block';
        todasView.style.display = 'none';
        console.log('📋 Visualizando: Minhas Avaliações');
        // Carregar minhas avaliações
        carregarMinhasAvaliacoes();
    } else {
        minhasView.style.display = 'none';
        todasView.style.display = 'block';
        console.log('📋 Visualizando: Todas as Avaliações');
        // Carregar todas as avaliações
        carregarTodasAvaliacoes();
    }
}

/**
 * Carrega as avaliações do usuário
 */
async function loadAvaliacoes() {
    try {
        console.log('🔄 Carregando avaliações...');
        
        // Determinar qual visualização carregar
        const minhasView = document.getElementById('minhas-avaliacoes-view');
        const todasView = document.getElementById('todas-avaliacoes-view');
        
        // Carregar "Minhas Avaliações"
        if (minhasView && minhasView.style.display !== 'none') {
            await carregarMinhasAvaliacoes();
        }
        
        // Carregar "Todas as Avaliações" (se visível)
        if (todasView && todasView.style.display !== 'none') {
            await carregarTodasAvaliacoes();
        }
        
    } catch (error) {
        console.error('Erro ao carregar avaliações:', error);
    }
}

/**
 * Carrega as avaliações do usuário logado
 */
async function carregarMinhasAvaliacoes() {
    try {
        const response = await fetch('/api/avaliacoes/minhas');
        if (!response.ok) {
            throw new Error('Erro ao buscar avaliações');
        }
        
        const avaliacoes = await response.json();
        exibirMinhasAvaliacoes(avaliacoes);
        
    } catch (error) {
        console.error('Erro ao carregar minhas avaliações:', error);
        mostrarErroAvaliacoes('minhas-avaliacoes-view', 'Erro ao carregar avaliações');
    }
}

/**
 * Carrega todas as avaliações (para usuários autorizados)
 */
async function carregarTodasAvaliacoes() {
    try {
        const response = await fetch('/api/avaliacoes/todas');
        if (!response.ok) {
            if (response.status === 403) {
                throw new Error('Você não tem permissão para visualizar todas as avaliações');
            }
            throw new Error('Erro ao buscar todas as avaliações');
        }
        
        const avaliacoes = await response.json();
        exibirTodasAvaliacoes(avaliacoes);
        
    } catch (error) {
        console.error('Erro ao carregar todas as avaliações:', error);
        mostrarErroAvaliacoes('todas-avaliacoes-view', error.message);
    }
}

/**
 * Exibe as avaliações do usuário
 */
function exibirMinhasAvaliacoes(avaliacoes) {
    const container = document.querySelector('#minhas-avaliacoes-view .card');
    
    if (!container) return;
    
    if (avaliacoes.length === 0) {
        container.innerHTML = `
            <h3>
                <i class="fas fa-clipboard-check" style="color: #10b981;"></i>
                Minhas Avaliações
            </h3>
            <div style="text-align: center; padding: 40px 20px;">
                <i class="fas fa-check-circle" style="font-size: 64px; color: #10b981; margin-bottom: 16px;"></i>
                <h4 style="color: #6b7280; margin-bottom: 8px;">Nenhuma avaliação pendente</h4>
                <p style="color: #9ca3af;">Você não possui avaliações pendentes no momento.</p>
            </div>
        `;
        return;
    }
    
    // Separar avaliações próprias e de equipe
    const minhas = avaliacoes.filter(a => a.OrigemAvaliacao === 'Própria');
    const equipe = avaliacoes.filter(a => a.OrigemAvaliacao === 'Equipe');
    
    let html = `
        <h3>
            <i class="fas fa-clipboard-check" style="color: #10b981;"></i>
            Minhas Avaliações
        </h3>
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 20px;">
            Total: ${avaliacoes.length} avaliação(ões)
        </p>
    `;
    
    if (minhas.length > 0) {
        html += `<h4 style="margin-top: 20px; margin-bottom: 12px; color: #374151;">Avaliações Pessoais</h4>`;
        html += gerarListaAvaliacoes(minhas, false);
    }
    
    if (equipe.length > 0) {
        html += `<h4 style="margin-top: 30px; margin-bottom: 12px; color: #374151;">Avaliações da Equipe</h4>`;
        html += gerarListaAvaliacoes(equipe, false);
    }
    
    container.innerHTML = html;
}

/**
 * Exibe todas as avaliações (visão administrativa)
 */
function exibirTodasAvaliacoes(avaliacoes) {
    const container = document.getElementById('todas-avaliacoes-conteudo');
    
    if (!container) return;
    
    // Armazenar todas as avaliações para filtragem
    window.todasAvaliacoesData = avaliacoes;
    
    if (avaliacoes.length === 0) {
        container.innerHTML = `
            <div class="card">
                <div style="text-align: center; padding: 40px 20px;">
                    <i class="fas fa-inbox" style="font-size: 64px; color: #e5e7eb; margin-bottom: 16px;"></i>
                    <h4 style="color: #6b7280; margin-bottom: 8px;">Nenhuma avaliação cadastrada</h4>
                    <p style="color: #9ca3af;">Não há avaliações no sistema no momento.</p>
                </div>
            </div>
        `;
        return;
    }
    
    // Contar avaliações por status
    const counts = {
        total: avaliacoes.length,
        agendada: avaliacoes.filter(a => a.StatusAvaliacao === 'Agendada').length,
        pendente: avaliacoes.filter(a => a.StatusAvaliacao === 'Pendente').length,
        concluida: avaliacoes.filter(a => a.StatusAvaliacao === 'Concluida').length,
        expirada: avaliacoes.filter(a => a.StatusAvaliacao === 'Expirada').length
    };
    
    let html = `
        <div class="card" style="margin-bottom: 20px;">
            <!-- Filtros -->
            <div style="display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; align-items: flex-end;">
                <!-- Busca por nome -->
                <div style="flex: 1; min-width: 250px;">
                    <label style="display: block; margin-bottom: 6px; color: #374151; font-weight: 600; font-size: 14px;">
                        <i class="fas fa-search"></i> Buscar Colaborador
                    </label>
                    <input 
                        type="text" 
                        id="filtro-nome-avaliacoes" 
                        class="form-input" 
                        placeholder="Digite o nome do colaborador..."
                        style="width: 100%;"
                        oninput="aplicarFiltrosAvaliacoes()"
                    >
                </div>
                
                <!-- Filtro por status -->
                <div style="min-width: 200px;">
                    <label style="display: block; margin-bottom: 6px; color: #374151; font-weight: 600; font-size: 14px;">
                        <i class="fas fa-filter"></i> Status
                    </label>
                    <select 
                        id="filtro-status-avaliacoes" 
                        class="form-input" 
                        style="width: 100%;"
                        onchange="aplicarFiltrosAvaliacoes()"
                    >
                        <option value="">Todos os status</option>
                        <option value="Agendada">📅 Agendada (${counts.agendada})</option>
                        <option value="Pendente">⏰ Pendente (${counts.pendente})</option>
                        <option value="Concluida">✅ Concluída (${counts.concluida})</option>
                        <option value="Expirada">🔴 Expirada (${counts.expirada})</option>
                    </select>
                </div>
                
                <!-- Botão limpar filtros -->
                <div>
                    <button 
                        type="button" 
                        class="btn btn-secondary btn-sm" 
                        onclick="limparFiltrosAvaliacoes()"
                        style="height: 44px;"
                    >
                        <i class="fas fa-times"></i> Limpar
                    </button>
                </div>
            </div>
            
            <!-- Contador de resultados -->
            <p id="contador-avaliacoes-filtradas" style="color: #6b7280; font-size: 14px; margin-bottom: 20px;">
                <i class="fas fa-info-circle"></i>
                Total: ${avaliacoes.length} avaliação(ões)
            </p>
        </div>
        
        <div id="lista-avaliacoes-container">
            ${gerarListaAvaliacoes(avaliacoes, true)}
        </div>
    `;
    
    container.innerHTML = html;
}

/**
 * Aplica filtros nas avaliações
 */
function aplicarFiltrosAvaliacoes() {
    const todasAvaliacoes = window.todasAvaliacoesData || [];
    const filtroNome = document.getElementById('filtro-nome-avaliacoes')?.value.toLowerCase().trim() || '';
    const filtroStatus = document.getElementById('filtro-status-avaliacoes')?.value || '';
    
    // Filtrar avaliações
    let avaliacoesFiltradas = todasAvaliacoes.filter(avaliacao => {
        // Filtro por nome
        const nomeMatch = !filtroNome || 
                         avaliacao.NomeCompleto.toLowerCase().includes(filtroNome);
        
        // Filtro por status
        const statusMatch = !filtroStatus || 
                           avaliacao.StatusAvaliacao === filtroStatus;
        
        return nomeMatch && statusMatch;
    });
    
    // Atualizar lista
    const listaContainer = document.getElementById('lista-avaliacoes-container');
    if (listaContainer) {
        if (avaliacoesFiltradas.length === 0) {
            listaContainer.innerHTML = `
                <div class="card">
                    <div style="text-align: center; padding: 40px 20px;">
                        <i class="fas fa-search" style="font-size: 64px; color: #e5e7eb; margin-bottom: 16px;"></i>
                        <h4 style="color: #6b7280; margin-bottom: 8px;">Nenhuma avaliação encontrada</h4>
                        <p style="color: #9ca3af;">Tente ajustar os filtros de busca.</p>
                    </div>
                </div>
            `;
        } else {
            listaContainer.innerHTML = gerarListaAvaliacoes(avaliacoesFiltradas, true);
        }
    }
    
    // Atualizar contador
    const contador = document.getElementById('contador-avaliacoes-filtradas');
    if (contador) {
        const textoFiltro = avaliacoesFiltradas.length !== todasAvaliacoes.length 
            ? ` (${avaliacoesFiltradas.length} de ${todasAvaliacoes.length} após filtros)`
            : '';
        contador.innerHTML = `
            <i class="fas fa-info-circle"></i>
            Exibindo: ${avaliacoesFiltradas.length} avaliação(ões)${textoFiltro}
        `;
    }
}

/**
 * Limpa todos os filtros de avaliações
 */
function limparFiltrosAvaliacoes() {
    const filtroNome = document.getElementById('filtro-nome-avaliacoes');
    const filtroStatus = document.getElementById('filtro-status-avaliacoes');
    
    if (filtroNome) filtroNome.value = '';
    if (filtroStatus) filtroStatus.value = '';
    
    aplicarFiltrosAvaliacoes();
}

/**
 * Gera HTML da lista de avaliações
 * @param {Array} avaliacoes - Lista de avaliações
 * @param {Boolean} eRHAdmin - Se true, o usuário é RH/Admin (não pode responder)
 */
function gerarListaAvaliacoes(avaliacoes, eRHAdmin = false) {
    return `
        <div class="avaliacoes-lista">
            ${avaliacoes.map(avaliacao => {
                // Determinar se usuário é participante desta avaliação
                const eParticipante = avaliacao.UserId === currentUser.userId || 
                                     avaliacao.GestorId === currentUser.userId;
                
                // Verificar se o usuário ATUAL já respondeu
                let jaRespondeu = false;
                if (avaliacao.UserId === currentUser.userId) {
                    jaRespondeu = avaliacao.RespostaColaboradorConcluida;
                } else if (avaliacao.GestorId === currentUser.userId) {
                    jaRespondeu = avaliacao.RespostaGestorConcluida;
                }
                
                // Debug
                if (eParticipante) {
                    console.log(`Avaliação ${avaliacao.Id}:`, {
                        userId: currentUser.userId,
                        avaliacaoUserId: avaliacao.UserId,
                        gestorId: avaliacao.GestorId,
                        colaboradorRespondeu: avaliacao.RespostaColaboradorConcluida,
                        gestorRespondeu: avaliacao.RespostaGestorConcluida,
                        jaRespondeu: jaRespondeu,
                        eParticipante: eParticipante
                    });
                }
                
                // Se é RH/Admin, não é participante, ou já respondeu, mostrar "Ver Detalhes"
                // Caso contrário, se está pendente, mostrar "Responder Avaliação"
                const textoBotao = (eRHAdmin || !eParticipante || jaRespondeu) ? 'Ver Detalhes' : 
                                  (avaliacao.StatusAvaliacao === 'Pendente' ? 'Responder Avaliação' : 'Ver Detalhes');
                
                const estaExpirada = avaliacao.StatusAvaliacao === 'Expirada';
                const borderColor = estaExpirada ? '#fca5a5' : '#e5e7eb';
                const backgroundColor = estaExpirada ? '#fef2f2' : 'white';
                
                return `
                    <div class="avaliacao-item" style="border: 2px solid ${borderColor}; border-radius: 8px; padding: 16px; margin-bottom: 12px; background: ${backgroundColor};">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                            <div>
                                <h4 style="margin: 0 0 4px 0; color: #111827;">
                                    ${avaliacao.NomeCompleto}
                                    ${estaExpirada ? '<i class="fas fa-exclamation-triangle" style="color: #dc2626; margin-left: 8px;" title="Avaliação expirada"></i>' : ''}
                                </h4>
                                <p style="margin: 0; color: #6b7280; font-size: 14px;">
                                    ${avaliacao.Departamento || 'N/A'} • Matrícula: ${avaliacao.Matricula}
                                </p>
                            </div>
                            <span class="badge badge-${getStatusColor(avaliacao.StatusAvaliacao)}" style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500;">
                                ${getStatusLabel(avaliacao.StatusAvaliacao)}
                            </span>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px;">
                            <div>
                                <p style="margin: 0; color: #6b7280; font-size: 12px;">Tipo de Avaliação</p>
                                <p style="margin: 4px 0 0 0; color: #111827; font-weight: 500;">${avaliacao.TipoAvaliacao}</p>
                            </div>
                            <div>
                                <p style="margin: 0; color: #6b7280; font-size: 12px;">Data de Admissão</p>
                                <p style="margin: 4px 0 0 0; color: #111827;">${formatarData(avaliacao.DataAdmissao)}</p>
                            </div>
                            <div>
                                <p style="margin: 0; color: #6b7280; font-size: 12px;">Prazo de Resposta</p>
                                <p style="margin: 4px 0 0 0; color: #111827;">${formatarData(avaliacao.DataLimiteResposta)}</p>
                            </div>
                            ${avaliacao.NomeGestor ? `
                            <div>
                                <p style="margin: 0; color: #6b7280; font-size: 12px;">Gestor Responsável</p>
                                <p style="margin: 4px 0 0 0; color: #111827;">${avaliacao.NomeGestor}</p>
                            </div>
                            ` : ''}
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 12px;">
                            ${avaliacao.RespostaColaboradorConcluida ? 
                                '<span style="color: #10b981; font-size: 14px;"><i class="fas fa-check-circle"></i> Colaborador respondeu</span>' : 
                                '<span style="color: #f59e0b; font-size: 14px;"><i class="fas fa-clock"></i> Aguardando colaborador</span>'}
                            <span style="color: #d1d5db;">•</span>
                            ${avaliacao.RespostaGestorConcluida ? 
                                '<span style="color: #10b981; font-size: 14px;"><i class="fas fa-check-circle"></i> Gestor respondeu</span>' : 
                                '<span style="color: #f59e0b; font-size: 14px;"><i class="fas fa-clock"></i> Aguardando gestor</span>'}
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn btn-amber btn-sm" onclick="abrirAvaliacao(${avaliacao.Id})" style="flex: 1;">
                                <i class="fas fa-${textoBotao === 'Ver Detalhes' ? 'eye' : 'clipboard-check'}"></i>
                                ${textoBotao}
                            </button>
                            ${(eRHAdmin || !eParticipante) && avaliacao.StatusAvaliacao === 'Expirada' && (!avaliacao.RespostaColaboradorConcluida || !avaliacao.RespostaGestorConcluida) ? `
                                <button class="btn btn-secondary btn-sm" onclick="abrirModalReabrirAvaliacao(${avaliacao.Id})" title="Abrir novamente">
                                    <i class="fas fa-redo"></i>
                                    Reabrir
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/**
 * Retorna cor do badge baseado no status
 */
function getStatusColor(status) {
    const cores = {
        'Agendada': 'info',
        'Pendente': 'warning',
        'EmAndamento': 'info',
        'Concluida': 'success',
        'Expirada': 'danger'
    };
    return cores[status] || 'secondary';
}

/**
 * Retorna label formatado do status
 */
function getStatusLabel(status) {
    const labels = {
        'Agendada': 'Agendada',
        'Pendente': 'Pendente',
        'EmAndamento': 'Em Andamento',
        'Concluida': 'Concluída',
        'Expirada': 'Expirada'
    };
    return labels[status] || status;
}

/**
 * Formata data para exibição (sem problemas de timezone)
 */
function formatarData(data) {
    if (!data) return 'N/A';
    
    // Se já for um objeto Date válido, formatar diretamente
    if (data instanceof Date && !isNaN(data)) {
        return data.toLocaleDateString('pt-BR');
    }
    
    // Se for string, processar
    try {
        const dateStr = data.toString().split('T')[0];
        const [year, month, day] = dateStr.split('-');
        
        // Criar data usando o construtor com parâmetros locais (evita conversão de timezone)
        const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        
        return d.toLocaleDateString('pt-BR');
    } catch (error) {
        console.error('Erro ao formatar data:', data, error);
        return 'Data inválida';
    }
}

// ====================================
// FUNÇÕES PARA RESPONDER AVALIAÇÃO
// ====================================

let avaliacaoAtual = null; // Avaliação sendo respondida/visualizada
let respostasAvaliacao = {}; // Objeto para armazenar respostas do formulário

/**
 * Abre modal para responder/visualizar avaliação
 */
async function abrirAvaliacao(avaliacaoId) {
    console.log('📋 Abrindo avaliação ID:', avaliacaoId);
    
    const modal = document.getElementById('responder-avaliacao-modal');
    modal.classList.remove('hidden');
    
    respostasAvaliacao = {};
    
    try {
        // Buscar dados da avaliação
        const response = await fetch(`/api/avaliacoes/${avaliacaoId}`);
        if (!response.ok) throw new Error('Erro ao carregar avaliação');
        
        avaliacaoAtual = await response.json();
        
        // Exibir informações da avaliação
        exibirInfoAvaliacao(avaliacaoAtual);
        
        // Verificar se usuário é participante da avaliação (colaborador ou gestor)
        const eParticipante = avaliacaoAtual.UserId === currentUser.userId || 
                             avaliacaoAtual.GestorId === currentUser.userId;
        
        // Verificar se usuário já respondeu
        const jaRespondeu = verificarSeJaRespondeu(avaliacaoAtual);
        
        // Verificar se a avaliação está expirada
        const estaExpirada = avaliacaoAtual.StatusAvaliacao === 'Expirada' || 
                            new Date() > new Date(avaliacaoAtual.DataLimiteResposta);
        
        // Verificar se a avaliação está agendada
        const estaAgendada = avaliacaoAtual.StatusAvaliacao === 'Agendada';
        
        if (estaAgendada && eParticipante) {
            // Avaliação agendada: bloquear acesso para participantes
            document.getElementById('tab-responder').style.display = 'inline-flex';
            document.getElementById('tab-visualizar').style.display = 'none';
            document.getElementById('btn-enviar-avaliacao').style.display = 'none';
            
            // Esconder div de ações (botões Fechar e Enviar Respostas)
            document.getElementById('acoes-avaliacao').style.display = 'none';
            
            // Calcular quantos dias faltam
            const dataAdmissao = new Date(avaliacaoAtual.DataAdmissao);
            const hoje = new Date();
            const diasDesdeAdmissao = Math.floor((hoje - dataAdmissao) / (1000 * 60 * 60 * 24));
            const diasNecessarios = avaliacaoAtual.TipoAvaliacao.includes('45') ? 45 : 90;
            const diasFaltantes = diasNecessarios - diasDesdeAdmissao;
            
            // Calcular data de início do período (quando completa 45 ou 90 dias)
            const dataInicioPeriodo = new Date(dataAdmissao);
            dataInicioPeriodo.setDate(dataAdmissao.getDate() + diasNecessarios);
            
            const container = document.getElementById('formulario-avaliacao');
            container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; background: #eff6ff; border-radius: 12px; border: 2px solid #93c5fd;">
                    <i class="fas fa-calendar-alt" style="font-size: 64px; color: #3b82f6; margin-bottom: 24px;"></i>
                    <h3 style="color: #1e40af; margin-bottom: 12px; display: flex; align-items: center; justify-content: center;">Avaliação Agendada</h3>
                    <p style="color: #1e3a8a; font-size: 16px; margin-bottom: 8px;">
                        Esta avaliação de <strong>${avaliacaoAtual.TipoAvaliacao}</strong> ainda não está disponível.
                    </p>
                    <p style="color: #3b82f6; font-size: 14px; margin-bottom: 24px;">
                        Faltam aproximadamente <strong>${diasFaltantes} dia(s)</strong> para que você possa responder.
                    </p>
                    <p style="color: #60a5fa; font-size: 13px;">
                        📅 Data de admissão: <strong>${formatarData(avaliacaoAtual.DataAdmissao)}</strong><br>
                        ⏰ Período de resposta: do dia <strong>${formatarData(dataInicioPeriodo)}</strong> 
                        até <strong>${formatarData(avaliacaoAtual.DataLimiteResposta)}</strong>
                    </p>
                </div>
            `;
            
            trocarAbaAvaliacao('responder');
            console.log('📅 Avaliação agendada - acesso bloqueado até o período correto');
        } else if (!eParticipante) {
            // RH/Admin: apenas visualização, sem poder responder
            document.getElementById('tab-responder').style.display = 'none';
            document.getElementById('tab-visualizar').style.display = 'inline-flex';
            document.getElementById('btn-enviar-avaliacao').style.display = 'none';
            document.getElementById('acoes-avaliacao').style.display = 'flex'; // Mostrar botões
            trocarAbaAvaliacao('visualizar');
            console.log('👁️ Usuário RH/Admin - apenas visualização');
        } else if (jaRespondeu) {
            // Participante que já respondeu: apenas visualização
            document.getElementById('tab-responder').style.display = 'none';
            document.getElementById('tab-visualizar').style.display = 'inline-flex';
            document.getElementById('btn-enviar-avaliacao').style.display = 'none';
            document.getElementById('acoes-avaliacao').style.display = 'flex'; // Mostrar botões
            trocarAbaAvaliacao('visualizar');
            console.log('✅ Usuário já respondeu - apenas visualização');
        } else if (estaExpirada) {
            // Avaliação expirada: bloquear resposta e esconder todos os botões
            document.getElementById('tab-responder').style.display = 'inline-flex';
            document.getElementById('tab-visualizar').style.display = 'none';
            document.getElementById('btn-enviar-avaliacao').style.display = 'none';
            
            // Esconder div de ações (botões Fechar e Enviar Respostas)
            document.getElementById('acoes-avaliacao').style.display = 'none';
            
            const container = document.getElementById('formulario-avaliacao');
            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; background: #fef2f2; border-radius: 12px; border: 2px solid #fca5a5;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 64px; color: #dc2626; margin-bottom: 24px;"></i>
                    <h3 style="color: #991b1b; margin-bottom: 12px; display: flex; align-items: center; justify-content: center;">Avaliação Expirada</h3>
                    <p style="color: #7f1d1d; font-size: 16px; margin-bottom: 8px;">
                        O prazo para responder esta avaliação expirou em <strong>${formatarData(avaliacaoAtual.DataLimiteResposta)}</strong>.
                    </p>
                    <p style="color: #991b1b; font-size: 14px; margin-bottom: 24px;">
                        Entre em contato com o RH se precisar que esta avaliação seja reaberta.
                    </p>
                </div>
            `;
            
            trocarAbaAvaliacao('responder');
            console.log('⏰ Avaliação expirada - resposta bloqueada');
        } else {
            // Participante que ainda não respondeu: mostrar formulário
            document.getElementById('tab-responder').style.display = 'inline-flex';
            document.getElementById('btn-enviar-avaliacao').style.display = 'inline-flex';
            document.getElementById('acoes-avaliacao').style.display = 'flex'; // Mostrar botões
            
            // NÃO mostrar aba de visualizar até que o usuário responda
            // Isso evita que veja as respostas da outra parte antes de responder
            document.getElementById('tab-visualizar').style.display = 'none';
            
            trocarAbaAvaliacao('responder');
            await carregarQuestionarioAvaliacao(avaliacaoAtual);
            console.log('📝 Usuário pode responder - mostrando formulário (visualização bloqueada até responder)');
        }
        
    } catch (error) {
        console.error('Erro ao abrir avaliação:', error);
        alert('Erro ao carregar avaliação: ' + error.message);
        modal.classList.add('hidden');
    }
}

/**
 * Fecha modal de avaliação
 */
function fecharModalResponderAvaliacao() {
    document.getElementById('responder-avaliacao-modal').classList.add('hidden');
    avaliacaoAtual = null;
    respostasAvaliacao = {};
}

/**
 * Verifica se o usuário logado já respondeu esta avaliação
 */
function verificarSeJaRespondeu(avaliacao) {
    const eColaborador = avaliacao.UserId === currentUser.userId;
    const eGestor = avaliacao.GestorId === currentUser.userId;
    
    if (eColaborador) {
        return avaliacao.RespostaColaboradorConcluida;
    } else if (eGestor) {
        return avaliacao.RespostaGestorConcluida;
    }
    
    return false;
}

/**
 * Verifica se a outra parte da avaliação já respondeu
 */
function verificarSeOutraParteRespondeu(avaliacao) {
    const eColaborador = avaliacao.UserId === currentUser.userId;
    
    if (eColaborador) {
        // Sou colaborador, verificar se gestor respondeu
        return avaliacao.RespostaGestorConcluida;
    } else {
        // Sou gestor, verificar se colaborador respondeu
        return avaliacao.RespostaColaboradorConcluida;
    }
}

/**
 * Exibe informações da avaliação no topo do modal
 */
function exibirInfoAvaliacao(avaliacao) {
    const container = document.getElementById('info-avaliacao');
    const eColaborador = avaliacao.UserId === currentUser.userId;
    const eGestor = avaliacao.GestorId === currentUser.userId;
    const eParticipante = eColaborador || eGestor;
    
    // Determinar o que mostrar no quarto campo
    let quartoCampoLabel, quartoCampoConteudo;
    
    if (eParticipante) {
        // Usuário é participante: mostrar como responde
        quartoCampoLabel = 'Você responde como:';
        quartoCampoConteudo = `
            <p style="margin: 0; color: #0d556d; font-weight: 600;">
                <i class="fas fa-${eColaborador ? 'user' : 'user-tie'}"></i>
                ${eColaborador ? 'Colaborador' : 'Gestor'}
            </p>
        `;
    } else {
        // Usuário é RH/Admin: mostrar gestor responsável
        quartoCampoLabel = 'Gestor Responsável:';
        quartoCampoConteudo = `
            <p style="margin: 0; color: #8b5cf6; font-weight: 600;">
                <i class="fas fa-user-tie"></i>
                ${avaliacao.NomeGestor || 'Não atribuído'}
            </p>
        `;
    }
    
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
            <div>
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 13px; font-weight: 600;">Tipo de Avaliação</p>
                <p style="margin: 0; color: #111827; font-weight: 600;">${avaliacao.TipoAvaliacao}</p>
            </div>
            <div>
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 13px; font-weight: 600;">Colaborador</p>
                <p style="margin: 0; color: #111827;">${avaliacao.NomeCompleto}</p>
            </div>
            <div>
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 13px; font-weight: 600;">Prazo de Resposta</p>
                <p style="margin: 0; color: #111827;">${formatarData(avaliacao.DataLimiteResposta)}</p>
            </div>
            <div>
                <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 13px; font-weight: 600;">${quartoCampoLabel}</p>
                ${quartoCampoConteudo}
            </div>
        </div>
    `;
}

/**
 * Mostra mensagem de erro
 */
function mostrarErroAvaliacoes(viewId, mensagem) {
    const container = document.querySelector(`#${viewId} .card`);
    if (!container) return;
    
    container.innerHTML = `
        <h3>
            <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
            Erro
        </h3>
        <div style="text-align: center; padding: 40px 20px;">
            <i class="fas fa-exclamation-circle" style="font-size: 64px; color: #ef4444; margin-bottom: 16px;"></i>
            <h4 style="color: #6b7280; margin-bottom: 8px;">Ocorreu um erro</h4>
            <p style="color: #9ca3af;">${mensagem}</p>
        </div>
    `;
}

/**
 * Abre modal para reabrir avaliação expirada
 */
function abrirModalReabrirAvaliacao(avaliacaoId) {
    const modal = document.getElementById('reabrir-avaliacao-modal');
    document.getElementById('avaliacao-id-reabrir').value = avaliacaoId;
    
    // Definir data mínima como hoje
    const hoje = new Date();
    const minDate = hoje.toISOString().slice(0, 10); // Apenas data YYYY-MM-DD
    document.getElementById('nova-data-limite-avaliacao').min = minDate;
    
    // Sugerir 7 dias a partir de hoje
    const sugerida = new Date(hoje);
    sugerida.setDate(hoje.getDate() + 7);
    document.getElementById('nova-data-limite-avaliacao').value = sugerida.toISOString().slice(0, 10); // Apenas data YYYY-MM-DD
    
    modal.classList.remove('hidden');
}

/**
 * Fecha modal de reabrir avaliação
 */
function fecharModalReabrirAvaliacao() {
    document.getElementById('reabrir-avaliacao-modal').classList.add('hidden');
    document.getElementById('nova-data-limite-avaliacao').value = '';
    document.getElementById('avaliacao-id-reabrir').value = '';
}

/**
 * Reabre avaliação com nova data limite
 */
async function reabrirAvaliacao() {
    const avaliacaoId = document.getElementById('avaliacao-id-reabrir').value;
    const novaData = document.getElementById('nova-data-limite-avaliacao').value;
    
    if (!novaData) {
        alert('Por favor, selecione uma nova data limite');
        return;
    }
    
    // Adicionar horário 00:00:00 à data selecionada
    const dataComHorario = novaData + 'T00:00:00';
    
    try {
        const response = await fetch(`/api/avaliacoes/${avaliacaoId}/reabrir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ novaDataLimite: dataComHorario })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Erro ao reabrir avaliação');
        }
        
        alert('✅ Avaliação reaberta com sucesso!');
        fecharModalReabrirAvaliacao();
        
        // Recarregar lista de avaliações
        loadAvaliacoes();
        
    } catch (error) {
        console.error('Erro ao reabrir avaliação:', error);
        alert('Erro ao reabrir avaliação: ' + error.message);
    }
}

// ====================================
// FUNÇÕES PARA EDIÇÃO DE QUESTIONÁRIOS
// ====================================

let templateAtualEdicao = '45'; // Template sendo editado atualmente
let perguntasTemplate45 = []; // Array de perguntas do template 45 dias
let perguntasTemplate90 = []; // Array de perguntas do template 90 dias
let perguntaEmEdicao = null; // Pergunta sendo editada no momento
let proximaOrdem = 1; // Próxima ordem disponível
let template45Modificado = false; // Flag para rastrear alterações no template 45
let template90Modificado = false; // Flag para rastrear alterações no template 90

// Getter para pegar o array correto baseado no template atual
function getPerguntasAtual() {
    return templateAtualEdicao === '45' ? perguntasTemplate45 : perguntasTemplate90;
}

// Setter para definir o array correto baseado no template atual
function setPerguntasAtual(perguntas) {
    if (templateAtualEdicao === '45') {
        perguntasTemplate45 = perguntas;
    } else {
        perguntasTemplate90 = perguntas;
    }
}

// Marca template atual como modificado
function marcarComoModificado() {
    if (templateAtualEdicao === '45') {
        template45Modificado = true;
    } else {
        template90Modificado = true;
    }
    console.log(`📝 Template ${templateAtualEdicao} marcado como modificado`);
}

/**
 * Abre modal de edição de questionários
 */
async function abrirModalEditarQuestionarios() {
    const modal = document.getElementById('editar-questionarios-modal');
    modal.classList.remove('hidden');
    
    // Limpar arrays de edição ao abrir
    perguntasTemplate45 = [];
    perguntasTemplate90 = [];
    
    // Resetar flags de modificação
    template45Modificado = false;
    template90Modificado = false;
    
    // Resetar para template de 45 dias
    templateAtualEdicao = '45';
    document.querySelectorAll('.btn-template-selector').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-template') === '45');
    });
    
    // Carregar perguntas do template
    await carregarPerguntasTemplate('45');
}

/**
 * Fecha modal de edição de questionários
 */
function fecharModalEditarQuestionarios() {
    // Verificar se há alterações não salvas usando as flags
    const temAlteracoes = template45Modificado || template90Modificado;
    
    if (temAlteracoes) {
        const msg = [];
        if (template45Modificado) msg.push('45 dias');
        if (template90Modificado) msg.push('90 dias');
        
        if (!confirm(`Você tem alterações não salvas nos templates: ${msg.join(' e ')}.\n\nDeseja realmente fechar sem salvar?`)) {
            return;
        }
    }
    
    const modal = document.getElementById('editar-questionarios-modal');
    modal.classList.add('hidden');
    
    // Limpar arrays e flags ao fechar
    perguntasTemplate45 = [];
    perguntasTemplate90 = [];
    template45Modificado = false;
    template90Modificado = false;
}

/**
 * Seleciona template para edição (45 ou 90 dias)
 */
async function selecionarTemplateEdicao(tipo) {
    templateAtualEdicao = tipo;
    
    // Atualizar botões
    document.querySelectorAll('.btn-template-selector').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-template') === tipo);
    });
    
    // Verificar se já carregou as perguntas deste template
    const perguntasAtual = getPerguntasAtual();
    
    if (perguntasAtual.length === 0) {
        // Carregar do servidor apenas se ainda não foi carregado
        await carregarPerguntasTemplate(tipo);
    } else {
        // Já foi carregado, apenas exibir
        exibirPerguntasEdicao();
    }
}

/**
 * Carrega perguntas do template
 */
async function carregarPerguntasTemplate(tipo) {
    const container = document.getElementById('lista-perguntas-edicao');
    container.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando perguntas...</div>';
    
    try {
        const response = await fetch(`/api/avaliacoes/questionario/${tipo}`);
        if (!response.ok) throw new Error('Erro ao carregar questionário');
        
        const perguntas = await response.json();
        setPerguntasAtual(perguntas);
        exibirPerguntasEdicao();
        
    } catch (error) {
        console.error('Erro ao carregar questionário:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #ef4444;">
                <i class="fas fa-exclamation-circle"></i>
                Erro ao carregar perguntas
            </div>
        `;
    }
}

/**
 * Exibe lista de perguntas para edição
 */
function exibirPerguntasEdicao() {
    const container = document.getElementById('lista-perguntas-edicao');
    const perguntasTemplate = getPerguntasAtual();
    
    if (perguntasTemplate.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 30px; color: #6b7280;">
                <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 12px; display: block;"></i>
                Nenhuma pergunta cadastrada
            </div>
        `;
        return;
    }
    
    const html = perguntasTemplate.map((pergunta, index) => `
        <div class="pergunta-item-edicao" data-pergunta-id="${pergunta.Id}">
            <div class="pergunta-item-header">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                        <span class="pergunta-item-numero">${pergunta.Ordem}</span>
                        <span class="badge-tipo-pergunta badge-tipo-${pergunta.TipoPergunta}">
                            ${getTipoPerguntaLabel(pergunta.TipoPergunta)}
                        </span>
                        ${pergunta.Obrigatoria ? '<span style="color: #ef4444; font-size: 12px;">* Obrigatória</span>' : ''}
                    </div>
                    <p style="margin: 0; color: #111827; font-weight: 500;">${pergunta.Pergunta}</p>
                    ${pergunta.TipoPergunta === 'escala' ? `
                        <div style="margin-top: 8px; padding-left: 44px;">
                            <p style="margin: 0; color: #6b7280; font-size: 13px;">
                                <i class="fas fa-sliders-h"></i> 
                                Escala: ${pergunta.EscalaMinima || 1} a ${pergunta.EscalaMaxima || 5}
                                ${pergunta.EscalaLabelMinima ? ` (${pergunta.EscalaLabelMinima} - ${pergunta.EscalaLabelMaxima || 'Máximo'})` : ''}
                            </p>
                        </div>
                    ` : ''}
                    ${pergunta.Opcoes && pergunta.Opcoes.length > 0 ? `
                        <div style="margin-top: 8px; padding-left: 44px;">
                            <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 12px; font-weight: 600;">Opções:</p>
                            ${pergunta.Opcoes.map(op => `<p style="margin: 0; color: #6b7280; font-size: 13px;">• ${op.TextoOpcao}</p>`).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="pergunta-item-acoes">
                    ${index > 0 ? `<button class="btn-icon btn-up" onclick="moverPergunta(${index}, 'up')" title="Mover para cima"><i class="fas fa-arrow-up"></i></button>` : ''}
                    ${index < perguntasTemplate.length - 1 ? `<button class="btn-icon btn-down" onclick="moverPergunta(${index}, 'down')" title="Mover para baixo"><i class="fas fa-arrow-down"></i></button>` : ''}
                    <button class="btn-icon" onclick="editarPergunta(${index})" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon btn-danger" onclick="removerPergunta(${index})" title="Remover"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>
    `).join('');
    
    container.innerHTML = html;
}

/**
 * Retorna label formatado do tipo de pergunta com ícone
 */
function getTipoPerguntaLabel(tipo) {
    const configs = {
        'texto': { 
            label: 'Texto Livre',
            icone: '<i class="fas fa-align-left"></i>'
        },
        'multipla_escolha': { 
            label: 'Múltipla Escolha',
            icone: '<i class="fas fa-list-ul"></i>'
        },
        'escala': { 
            label: 'Escala',
            icone: '<i class="fas fa-sliders-h"></i>'
        },
        'sim_nao': { 
            label: 'Sim/Não',
            icone: '<i class="fas fa-check-circle"></i>'
        }
    };
    
    const config = configs[tipo];
    if (config) {
        return `${config.icone} ${config.label}`;
    }
    
    return tipo;
}

/**
 * Move pergunta para cima ou para baixo
 */
function moverPergunta(index, direcao) {
    const perguntasTemplate = getPerguntasAtual();
    
    if (direcao === 'up' && index > 0) {
        [perguntasTemplate[index], perguntasTemplate[index - 1]] = 
        [perguntasTemplate[index - 1], perguntasTemplate[index]];
    } else if (direcao === 'down' && index < perguntasTemplate.length - 1) {
        [perguntasTemplate[index], perguntasTemplate[index + 1]] = 
        [perguntasTemplate[index + 1], perguntasTemplate[index]];
    }
    
    // Atualizar ordem
    perguntasTemplate.forEach((p, i) => p.Ordem = i + 1);
    setPerguntasAtual(perguntasTemplate);
    marcarComoModificado(); // Marcar como modificado
    exibirPerguntasEdicao();
}

/**
 * Remove pergunta
 */
function removerPergunta(index) {
    if (confirm('Tem certeza que deseja remover esta pergunta?')) {
        const perguntasTemplate = getPerguntasAtual();
        perguntasTemplate.splice(index, 1);
        // Atualizar ordem
        perguntasTemplate.forEach((p, i) => p.Ordem = i + 1);
        setPerguntasAtual(perguntasTemplate);
        marcarComoModificado(); // Marcar como modificado
        exibirPerguntasEdicao();
    }
}

/**
 * Abre modal para adicionar nova pergunta
 */
function adicionarNovaPergunta() {
    perguntaEmEdicao = null;
    document.getElementById('titulo-modal-pergunta').innerHTML = '<i class="fas fa-plus-circle"></i> Nova Pergunta';
    
    // Limpar campos
    document.getElementById('pergunta-tipo').value = 'texto';
    document.getElementById('pergunta-texto').value = '';
    document.getElementById('pergunta-obrigatoria').checked = true;
    document.getElementById('campo-opcoes-multipla').style.display = 'none';
    document.getElementById('campo-escala').style.display = 'none';
    document.getElementById('lista-opcoes-edicao').innerHTML = '';
    
    // Resetar campos de escala
    document.getElementById('escala-minima').value = 1;
    document.getElementById('escala-maxima').value = 5;
    document.getElementById('escala-label-min').value = '';
    document.getElementById('escala-label-max').value = '';
    
    // Abrir modal
    document.getElementById('editar-pergunta-modal').classList.remove('hidden');
}

/**
 * Abre modal para editar pergunta existente
 */
function editarPergunta(index) {
    perguntaEmEdicao = index;
    const perguntasTemplate = getPerguntasAtual();
    const pergunta = perguntasTemplate[index];
    
    document.getElementById('titulo-modal-pergunta').innerHTML = '<i class="fas fa-edit"></i> Editar Pergunta';
    document.getElementById('pergunta-tipo').value = pergunta.TipoPergunta;
    document.getElementById('pergunta-texto').value = pergunta.Pergunta;
    document.getElementById('pergunta-obrigatoria').checked = pergunta.Obrigatoria;
    
    // Atualizar campos específicos do tipo
    atualizarCamposPergunta();
    
    // Se for múltipla escolha, carregar opções
    if (pergunta.TipoPergunta === 'multipla_escolha' && pergunta.Opcoes) {
        const container = document.getElementById('lista-opcoes-edicao');
        container.innerHTML = pergunta.Opcoes.map((opcao, i) => `
            <div class="opcao-item">
                <input type="text" class="form-input" value="${opcao.TextoOpcao}" data-opcao-index="${i}" />
                <button type="button" class="btn btn-danger btn-sm" onclick="removerOpcao(${i})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }
    
    // Se for escala, carregar valores
    if (pergunta.TipoPergunta === 'escala') {
        document.getElementById('escala-minima').value = pergunta.EscalaMinima || 1;
        document.getElementById('escala-maxima').value = pergunta.EscalaMaxima || 5;
        document.getElementById('escala-label-min').value = pergunta.EscalaLabelMinima || '';
        document.getElementById('escala-label-max').value = pergunta.EscalaLabelMaxima || '';
    }
    
    document.getElementById('editar-pergunta-modal').classList.remove('hidden');
}

/**
 * Fecha modal de edição de pergunta
 */
function fecharModalEditarPergunta() {
    document.getElementById('editar-pergunta-modal').classList.add('hidden');
    perguntaEmEdicao = null;
}

/**
 * Atualiza campos do modal baseado no tipo de pergunta
 */
function atualizarCamposPergunta() {
    const tipo = document.getElementById('pergunta-tipo').value;
    const campoOpcoes = document.getElementById('campo-opcoes-multipla');
    const campoEscala = document.getElementById('campo-escala');
    
    // Ocultar todos os campos específicos
    campoOpcoes.style.display = 'none';
    campoEscala.style.display = 'none';
    
    if (tipo === 'multipla_escolha') {
        campoOpcoes.style.display = 'block';
        if (document.getElementById('lista-opcoes-edicao').children.length === 0) {
            // Adicionar 2 opções padrão
            adicionarOpcao();
            adicionarOpcao();
        }
    } else if (tipo === 'escala') {
        campoEscala.style.display = 'block';
    }
}

/**
 * Adiciona nova opção de múltipla escolha
 */
function adicionarOpcao() {
    const container = document.getElementById('lista-opcoes-edicao');
    const index = container.children.length;
    
    const div = document.createElement('div');
    div.className = 'opcao-item';
    div.innerHTML = `
        <input type="text" class="form-input" placeholder="Digite a opção..." data-opcao-index="${index}" />
        <button type="button" class="btn btn-danger btn-sm" onclick="removerOpcaoNova(this)">
            <i class="fas fa-trash"></i>
        </button>
    `;
    
    container.appendChild(div);
}

/**
 * Remove opção de múltipla escolha (nova ou existente)
 */
function removerOpcaoNova(btn) {
    btn.parentElement.remove();
}

function removerOpcao(index) {
    const container = document.getElementById('lista-opcoes-edicao');
    const items = container.querySelectorAll('.opcao-item');
    if (items[index]) {
        items[index].remove();
    }
}

/**
 * Salva pergunta (nova ou editada)
 */
function salvarPergunta() {
    const tipo = document.getElementById('pergunta-tipo').value;
    const texto = document.getElementById('pergunta-texto').value.trim();
    const obrigatoria = document.getElementById('pergunta-obrigatoria').checked;
    
    if (!texto) {
        alert('Por favor, digite a pergunta');
        return;
    }
    
    // Coletar opções se for múltipla escolha
    let opcoes = null;
    if (tipo === 'multipla_escolha') {
        const inputsOpcoes = document.querySelectorAll('#lista-opcoes-edicao input[type="text"]');
        opcoes = Array.from(inputsOpcoes)
            .map((input, i) => ({
                TextoOpcao: input.value.trim(),
                Ordem: i + 1
            }))
            .filter(op => op.TextoOpcao);
        
        if (opcoes.length < 2) {
            alert('Perguntas de múltipla escolha precisam de pelo menos 2 opções');
            return;
        }
    }
    
    const novaPergunta = {
        TipoPergunta: tipo,
        Pergunta: texto,
        Obrigatoria: obrigatoria,
        Opcoes: opcoes
    };
    
    // Adicionar campos de escala se for tipo escala
    if (tipo === 'escala') {
        const escalaMin = parseInt(document.getElementById('escala-minima').value);
        const escalaMax = parseInt(document.getElementById('escala-maxima').value);
        
        // Validações
        if (isNaN(escalaMin) || isNaN(escalaMax)) {
            alert('Por favor, preencha os valores mínimo e máximo da escala');
            return;
        }
        
        if (escalaMin < 1) {
            alert('O valor mínimo deve ser pelo menos 1');
            return;
        }
        
        if (escalaMax > 10) {
            alert('O valor máximo não pode ser maior que 10');
            return;
        }
        
        if (escalaMin >= escalaMax) {
            alert('O valor máximo deve ser maior que o mínimo');
            return;
        }
        
        novaPergunta.EscalaMinima = escalaMin;
        novaPergunta.EscalaMaxima = escalaMax;
        novaPergunta.EscalaLabelMinima = document.getElementById('escala-label-min').value.trim() || null;
        novaPergunta.EscalaLabelMaxima = document.getElementById('escala-label-max').value.trim() || null;
    }
    
    const perguntasTemplate = getPerguntasAtual();
    
    if (perguntaEmEdicao !== null) {
        // Editar pergunta existente
        novaPergunta.Id = perguntasTemplate[perguntaEmEdicao].Id;
        novaPergunta.Ordem = perguntasTemplate[perguntaEmEdicao].Ordem;
        perguntasTemplate[perguntaEmEdicao] = novaPergunta;
    } else {
        // Nova pergunta
        novaPergunta.Id = null;
        novaPergunta.Ordem = perguntasTemplate.length + 1;
        perguntasTemplate.push(novaPergunta);
    }
    
    setPerguntasAtual(perguntasTemplate);
    marcarComoModificado(); // Marcar como modificado
    fecharModalEditarPergunta();
    exibirPerguntasEdicao();
}

/**
 * Salva questionário completo no servidor (ambos os templates se foram editados)
 */
async function salvarQuestionario() {
    const tem45 = perguntasTemplate45.length > 0;
    const tem90 = perguntasTemplate90.length > 0;
    
    if (!tem45 && !tem90) {
        alert('Nenhuma alteração foi feita');
        return;
    }
    
    console.log('💾 Salvando questionários...');
    console.log(`   45 dias: ${tem45 ? perguntasTemplate45.length + ' perguntas' : 'sem alterações'}`);
    console.log(`   90 dias: ${tem90 ? perguntasTemplate90.length + ' perguntas' : 'sem alterações'}`);
    
    let erros = [];
    let sucessos = [];
    
    try {
        // Salvar template de 45 dias se foi editado
        if (tem45) {
            console.log('💾 Salvando template de 45 dias...');
            
            const response45 = await fetch('/api/avaliacoes/questionario/45', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ perguntas: perguntasTemplate45 })
            });
            
            if (response45.ok) {
                sucessos.push('45 dias');
                console.log('✅ Template de 45 dias salvo');
            } else {
                const error = await response45.json();
                erros.push(`45 dias: ${error.error}`);
                console.error('❌ Erro ao salvar 45 dias:', error);
            }
        }
        
        // Salvar template de 90 dias se foi editado
        if (tem90) {
            console.log('💾 Salvando template de 90 dias...');
            
            const response90 = await fetch('/api/avaliacoes/questionario/90', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ perguntas: perguntasTemplate90 })
            });
            
            if (response90.ok) {
                sucessos.push('90 dias');
                console.log('✅ Template de 90 dias salvo');
            } else {
                const error = await response90.json();
                erros.push(`90 dias: ${error.error}`);
                console.error('❌ Erro ao salvar 90 dias:', error);
            }
        }
        
        // Exibir resultado
        if (erros.length === 0) {
            alert(`✅ Questionário(s) salvo(s) com sucesso!\n\n${sucessos.join('\n')}`);
            
            // Resetar flags de modificação dos templates que foram salvos
            if (sucessos.includes('45 dias')) {
                template45Modificado = false;
                console.log('✅ Flag de modificação do template 45 resetada');
            }
            if (sucessos.includes('90 dias')) {
                template90Modificado = false;
                console.log('✅ Flag de modificação do template 90 resetada');
            }
            
            fecharModalEditarQuestionarios();
        } else if (sucessos.length > 0) {
            alert(`⚠️ Salvamento parcial:\n\n✅ Salvos: ${sucessos.join(', ')}\n❌ Erros: ${erros.join(', ')}`);
            
            // Resetar flags apenas dos que foram salvos com sucesso
            if (sucessos.includes('45 dias')) {
                template45Modificado = false;
            }
            if (sucessos.includes('90 dias')) {
                template90Modificado = false;
            }
        } else {
            throw new Error(erros.join('\n'));
        }
        
    } catch (error) {
        console.error('❌ Erro ao salvar questionários:', error);
        alert('Erro ao salvar questionários: ' + error.message);
    }
}

// Carregar pesquisas do novo sistema
async function loadPesquisas() {
    try {
        console.log('🔄 Carregando pesquisas do novo sistema...');
        
        // Carregar estatísticas gerais
        const statsResponse = await fetch('/api/surveys/stats');
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            updatePesquisasStats(stats);
        }
        
        // Carregar pesquisas disponíveis para o usuário
        const surveysResponse = await fetch('/api/surveys/user');
        if (surveysResponse.ok) {
            const surveys = await surveysResponse.json();
            allSurveys = surveys; // Armazenar para filtros
            updateUserSurveysList(surveys);
        }
        
    } catch (error) {
        console.error('Erro ao carregar pesquisas:', error);
        const container = document.getElementById('user-surveys-list');
        if (container) {
            container.innerHTML = '<div class="error">Erro ao carregar pesquisas. Tente novamente.</div>';
        }
    }
}

// Variável global para armazenar todas as pesquisas
let allSurveys = [];

// Atualizar estatísticas das pesquisas
function updatePesquisasStats(stats) {
    const activeSurveysCount = document.getElementById('active-surveys-count');
    const myResponsesCount = document.getElementById('my-responses-count');
    const pendingSurveysCount = document.getElementById('pending-surveys-count');
    
    if (activeSurveysCount) activeSurveysCount.textContent = stats.activeSurveys || 0;
    if (myResponsesCount) myResponsesCount.textContent = stats.userResponses || 0;
    if (pendingSurveysCount) pendingSurveysCount.textContent = stats.pendingSurveys || 0;
}

// Filtrar pesquisas por nome e status
function filterSurveys() {
    const nameSearch = document.getElementById('survey-name-search');
    const statusFilter = document.getElementById('survey-status-filter');
    
    if (!nameSearch || !statusFilter) return;
    
    const searchTerm = nameSearch.value.trim().toLowerCase();
    const selectedStatus = statusFilter.value.toLowerCase();
    
    console.log('🔍 Filtrando pesquisas - Nome:', searchTerm, '| Status:', selectedStatus);
    
    let filteredSurveys = [...allSurveys];
    
    // Filtrar por nome
    if (searchTerm) {
        filteredSurveys = filteredSurveys.filter(survey => {
            const titulo = (survey.titulo || survey.Titulo || '').toLowerCase();
            const descricao = (survey.descricao || survey.Descricao || '').toLowerCase();
            return titulo.includes(searchTerm) || descricao.includes(searchTerm);
        });
    }
    
    // Filtrar por status
    if (selectedStatus) {
        filteredSurveys = filteredSurveys.filter(survey => {
            const surveyStatus = (survey.status || survey.Status || '').toLowerCase();
            const userAnswered = survey.userAnswered || survey.UserAnswered || false;
            
            if (selectedStatus === 'ativa') {
                return surveyStatus === 'ativa';
            } else if (selectedStatus === 'encerrada') {
                return surveyStatus === 'encerrada';
            } else if (selectedStatus === 'respondida') {
                return userAnswered === true;
            } else if (selectedStatus === 'pendente') {
                return userAnswered === false && surveyStatus === 'ativa';
            }
            return true;
        });
    }
    
    console.log('✅ Pesquisas filtradas:', filteredSurveys.length, 'de', allSurveys.length);
    
    // Atualizar visualização
    updateUserSurveysList(filteredSurveys);
}

// Limpar filtros de pesquisas
function clearSurveyFilters() {
    console.log('🧹 Limpando filtros de pesquisas');
    
    const nameSearch = document.getElementById('survey-name-search');
    if (nameSearch) {
        nameSearch.value = '';
    }
    
    const statusFilter = document.getElementById('survey-status-filter');
    if (statusFilter) {
        statusFilter.value = '';
    }
    
    // Mostrar todas as pesquisas
    updateUserSurveysList(allSurveys);
}

// Abrir modal de responder pesquisa (redireciona para pesquisas-novo.html com modal)
function openSurveyResponseForm(surveyId) {
    // Redirecionar para a página de gerenciar pesquisas com modal de resposta aberto
    window.open(`pesquisas-novo.html?id=${surveyId}&respond=true`, '_blank', 'width=1400,height=900');
}

// Carregar dados da pesquisa no modal
async function loadSurveyIntoModal(survey) {
    // Atualizar título do modal
    const modalTitle = document.getElementById('responder-pesquisa-title');
    if (modalTitle) {
        modalTitle.innerHTML = `
            <i class="fas fa-edit"></i>
            ${survey.titulo || survey.Titulo || 'Responder Pesquisa'}
        `;
    }
    
    // Armazenar pesquisa atual
    window.currentSurveyId = survey.Id || survey.id;
    
    // Atualizar pergunta
    const perguntaElement = document.getElementById('responder-pergunta');
    if (perguntaElement && survey.perguntas && survey.perguntas.length > 0) {
        const pergunta = survey.perguntas[0];
        perguntaElement.textContent = pergunta.texto || pergunta.Texto || '';
        
        // Armazenar pergunta atual
        window.currentPergunta = pergunta;
        
        // Mostrar campos apropriados baseado no tipo
        const opcoesContainer = document.getElementById('responder-opcoes-container');
        const escalaContainer = document.getElementById('responder-escala-container');
        const textoContainer = document.getElementById('responder-texto-container');
        
        // Esconder todos primeiro
        if (opcoesContainer) opcoesContainer.style.display = 'none';
        if (escalaContainer) escalaContainer.style.display = 'none';
        if (textoContainer) textoContainer.style.display = 'none';
        
        const tipoPergunta = (pergunta.tipo || pergunta.Tipo || '').toLowerCase();
        
        if (tipoPergunta === 'multipla_escolha') {
            // Mostrar opções de múltipla escolha
            if (opcoesContainer) {
                const opcoesDiv = document.getElementById('responder-opcoes');
                if (opcoesDiv && pergunta.opcoes) {
                    const opcoes = typeof pergunta.opcoes === 'string' ? 
                        JSON.parse(pergunta.opcoes) : pergunta.opcoes;
                    
                    console.log('🔵 Renderizando opções de múltipla escolha:', opcoes);
                    
                    opcoesDiv.innerHTML = opcoes.map((opcao, index) => {
                        // opcao pode ser objeto {Id, opcao} ou string
                        const optionId = opcao.Id || index + 1;
                        const optionText = opcao.opcao || opcao;
                        console.log(`  → Opção ${index}: ID=${optionId}, Texto="${optionText}"`);
                        return `
                            <div class="opcao-option" data-option-id="${optionId}" onclick="selectOpcao(${optionId}, event)">
                                ${optionText}
                            </div>
                        `;
                    }).join('');
                }
                opcoesContainer.style.display = 'block';
            }
        } else if (tipoPergunta === 'escala') {
            // Mostrar escala dinâmica baseada na configuração da pergunta
            if (escalaContainer) {
                // Determinar escala mínima e máxima
                const escalaMin = pergunta.escala_min || pergunta.EscalaMin || 1;
                const escalaMax = pergunta.escala_max || pergunta.EscalaMax || 9;
                const tamanhoEscala = escalaMax - escalaMin + 1;
                
                // Ajustar largura do modal baseado no tamanho da escala
                const modalOverlay = document.getElementById('responder-pesquisa-modal');
                const modal = modalOverlay ? modalOverlay.querySelector('.modal') : null;
                const modalContent = modalOverlay ? modalOverlay.querySelector('.modal-content') : null;
                
                if (modal) {
                    modal.classList.remove('wide-scale', 'extra-wide-scale');
                    if (tamanhoEscala > 10) {
                        modal.classList.add('extra-wide-scale');
                        console.log('📏 Modal ajustado para escala extra larga (>10 opções)');
                    } else if (tamanhoEscala > 7) {
                        modal.classList.add('wide-scale');
                        console.log('📏 Modal ajustado para escala larga (8-10 opções)');
                    }
                }
                
                if (modalContent) {
                    modalContent.classList.remove('wide-scale', 'extra-wide-scale');
                    if (tamanhoEscala > 10) {
                        modalContent.classList.add('extra-wide-scale');
                    } else if (tamanhoEscala > 7) {
                        modalContent.classList.add('wide-scale');
                    }
                }
                
                // Gerar opções de escala dinamicamente
                const escalaOptionsDiv = escalaContainer.querySelector('.escala-options');
                if (escalaOptionsDiv) {
                    let optionsHtml = '';
                    for (let i = escalaMin; i <= escalaMax; i++) {
                        let label = '';
                        if (i === escalaMin) {
                            label = `Mínimo (${i})`;
                        } else if (i === escalaMax) {
                            label = `Máximo (${i})`;
                        } else {
                            label = String(i);
                        }
                        
                        optionsHtml += `
                            <div class="escala-option" data-score="${i}">
                                <span>${i}</span>
                                ${i === escalaMin || i === escalaMax ? `<small>${label}</small>` : ''}
                            </div>
                        `;
                    }
                    escalaOptionsDiv.innerHTML = optionsHtml;
                    
                    // Reconfigurar event listeners para as novas opções
                    escalaOptionsDiv.querySelectorAll('.escala-option').forEach(option => {
                        option.addEventListener('click', () => {
                            escalaOptionsDiv.querySelectorAll('.escala-option').forEach(opt => {
                                opt.classList.remove('selected');
                            });
                            option.classList.add('selected');
                            selectedPesquisaResposta = parseInt(option.dataset.score);
                        });
                    });
                }
                
                // Atualizar label do container
                const label = escalaContainer.querySelector('.form-label');
                if (label) {
                    label.textContent = `Selecione uma nota (${escalaMin}-${escalaMax}):`;
                }
                
                escalaContainer.style.display = 'block';
            }
        } else {
            // Texto livre
            if (textoContainer) {
                textoContainer.style.display = 'block';
            }
        }
    }
}

// Listener para receber notificações de pesquisas (criadas ou respondidas)
window.addEventListener('message', (event) => {
    console.log('📩 Mensagem recebida no index.js:', event.data);
    
    if (event.data.type === 'SURVEY_RESPONSE_SUBMITTED') {
        console.log('✅ Resposta de pesquisa submetida - Atualizando...');
        // Mostrar notificação visual
        showSurveyNotification('Resposta enviada! Atualizando lista...');
        // Atualizar interface para mostrar que a pesquisa foi respondida
        updateSurveyResponseStatus(event.data.surveyId);
        // Recarregar lista de pesquisas
        loadPesquisas();
    } else if (event.data.type === 'SURVEY_CREATED') {
        console.log('🆕 Nova pesquisa criada - Atualizando...');
        // Mostrar notificação visual
        showSurveyNotification('Nova pesquisa criada! Atualizando lista...');
        // Recarregar lista de pesquisas
        loadPesquisas();
    }
});

// Mostrar notificação visual de atualização de pesquisas
function showSurveyNotification(message) {
    // Criar elemento de notificação se não existir
    let notification = document.getElementById('survey-update-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'survey-update-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #0d556d 0%, #1a7a99 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 12px;
            font-weight: 500;
            animation: slideInRight 0.3s ease-out;
        `;
        document.body.appendChild(notification);
        
        // Adicionar animação se ainda não existir
        if (!document.getElementById('survey-notification-style')) {
            const style = document.createElement('style');
            style.id = 'survey-notification-style';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(400px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOutRight {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(400px); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    notification.innerHTML = `
        <i class="fas fa-sync-alt fa-spin"></i>
        <span>${message}</span>
    `;
    notification.style.display = 'flex';
    notification.style.animation = 'slideInRight 0.3s ease-out';
    
    // Remover após 3 segundos
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 300);
    }, 3000);
}

function updateSurveyResponseStatus(surveyId) {
    // Encontrar e atualizar o botão específico da pesquisa
    const surveyCards = document.querySelectorAll('.survey-card');
    surveyCards.forEach(card => {
        const respondButton = card.querySelector(`button[onclick*="openSurveyResponseForm(${surveyId})"]`);
        if (respondButton) {
            respondButton.disabled = true;
            respondButton.innerHTML = '<i class="fas fa-check"></i> Já Respondida';
            respondButton.className = 'btn btn-secondary';
        }
    });
}

async function openMyResponse(surveyId) {
    try {
        console.log('👤 Abrindo minha resposta para pesquisa:', surveyId);
        
        const response = await fetch(`/api/surveys/${surveyId}/my-response`);
        if (!response.ok) {
            throw new Error('Erro ao carregar sua resposta');
        }
        
        const data = await response.json();
        console.log('📊 Dados da resposta recebidos:', data);
        console.log('📊 Primeira resposta:', data.responses ? data.responses[0] : 'Nenhuma');
        showMyResponseModal(data);
        
    } catch (error) {
        console.error('❌ Erro ao carregar resposta:', error);
        alert('Erro ao carregar sua resposta: ' + error.message);
    }
}

function showMyResponseModal(data) {
    // Calcular estatísticas da resposta
    const totalPerguntas = data.responses.length;
    
    // Função auxiliar para verificar se uma pergunta foi respondida
    const perguntaFoiRespondida = (r) => {
        // Se existe data_resposta, significa que houve uma tentativa de resposta (mesmo com dados corrompidos)
        if (r.data_resposta) {
            // Verificar se há ALGUM dado de resposta
            const temDadosResposta = r.resposta_texto || r.option_id || r.opcao_selecionada || 
                                     r.resposta_numerica !== null || r.resposta_numerica !== undefined;
            
            // Se tem data mas não tem dados, considerar como respondida (dados corrompidos de versão antiga)
            if (!temDadosResposta) {
                console.warn('⚠️ Resposta antiga com dados incompletos detectada:', r);
                return true; // Considerar respondida para não confundir o usuário
            }
        }
        
        // Para múltipla escolha, verificar qualquer indicação de resposta
        if (r.pergunta_tipo === 'multipla_escolha') {
            return !!(r.resposta_texto || r.option_id || r.opcao_selecionada);
        }
        // Para escala, verificar resposta_numerica
        if (r.pergunta_tipo === 'escala') {
            return r.resposta_numerica !== null && r.resposta_numerica !== undefined;
        }
        // Para outros tipos, verificar resposta_texto
        return !!(r.resposta_texto && r.resposta_texto.trim());
    };
    
    const perguntasRespondidas = data.responses.filter(perguntaFoiRespondida).length;
    const percentualCompleto = totalPerguntas > 0 ? Math.round((perguntasRespondidas / totalPerguntas) * 100) : 0;
    
    console.log('📊 Estatísticas calculadas:', {
        totalPerguntas,
        perguntasRespondidas,
        percentualCompleto,
        responses: data.responses.map(r => ({
            tipo: r.pergunta_tipo,
            texto: r.resposta_texto,
            numerica: r.resposta_numerica,
            option_id: r.option_id,
            foi_respondida: perguntaFoiRespondida(r)
        }))
    });
    
    // Adicionar classe ao body para prevenir scroll
    document.body.classList.add('modal-open');
    
    // Criar modal em tela cheia
    const modalHtml = `
        <div class="modal-overlay-fullscreen" id="my-response-modal-index">
            <div class="modal modal-fullscreen">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-eye" style="color: #0d556d;"></i>
                            Minha Resposta - ${data.survey.titulo}
                        </h3>
                    </div>
                    
                    <div class="modal-body">
                        <!-- Cards de informações -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
                            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <i class="fas fa-calendar-check" style="color: #0d556d; font-size: 16px;"></i>
                                    <span style="font-weight: 600; color: #374151; font-size: 14px;">Data da Resposta</span>
                                </div>
                                <p style="margin: 0; color: #6b7280; font-size: 14px;">${formatDateLocal(data.response_date)}</p>
                            </div>
                            
                            <div style="background: #f0f9ff; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <i class="fas fa-chart-pie" style="color: #0d556d; font-size: 16px;"></i>
                                    <span style="font-weight: 600; color: #374151; font-size: 14px;">Completude</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                    <div style="flex: 1; background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden;">
                                        <div style="width: ${percentualCompleto}%; height: 100%; background: linear-gradient(90deg, #0d556d, #f59e0b); border-radius: 4px;"></div>
                                    </div>
                                    <span style="font-size: 14px; font-weight: 600; color: #0d556d;">${percentualCompleto}%</span>
                                </div>
                                <p style="margin: 0; color: #6b7280; font-size: 12px;">${perguntasRespondidas} de ${totalPerguntas} perguntas</p>
                            </div>
                        </div>
                        
                        <!-- Título das respostas -->
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                            <i class="fas fa-list-ol" style="color: #0d556d; font-size: 16px;"></i>
                            <h4 style="margin: 0; color: #374151; font-size: 16px; font-weight: 600;">Suas Respostas</h4>
                        </div>
                        
                        <!-- Lista de respostas -->
                        <div style="display: flex; flex-direction: column; gap: 16px; min-height: auto; overflow-y: auto;">
                            ${data.responses.map((resp, index) => {
                                // Verificar se há resposta considerando o tipo de pergunta
                                let temResposta = false;
                                let dadosIncompletos = false;
                                
                                // Detectar respostas antigas com dados corrompidos
                                if (resp.data_resposta) {
                                    const temDados = resp.resposta_texto || resp.option_id || resp.opcao_selecionada || 
                                                    resp.resposta_numerica !== null || resp.resposta_numerica !== undefined;
                                    
                                    if (!temDados) {
                                        // Tem data_resposta mas sem dados - resposta antiga corrompida
                                        dadosIncompletos = true;
                                        temResposta = true; // Considerar como respondida
                                    }
                                }
                                
                                // Verificação normal
                                if (!dadosIncompletos) {
                                    if (resp.pergunta_tipo === 'multipla_escolha') {
                                        temResposta = !!(resp.resposta_texto || resp.option_id || resp.opcao_selecionada);
                                    } else if (resp.pergunta_tipo === 'escala') {
                                        temResposta = resp.resposta_numerica !== null && resp.resposta_numerica !== undefined;
                                    } else {
                                        temResposta = !!(resp.resposta_texto && resp.resposta_texto.trim());
                                    }
                                }
                                
                                console.log(`🎨 Pergunta ${index + 1}:`, {
                                    texto: resp.pergunta_texto,
                                    tipo: resp.pergunta_tipo,
                                    resposta_texto: resp.resposta_texto,
                                    resposta_numerica: resp.resposta_numerica,
                                    option_id: resp.option_id,
                                    temResposta: temResposta,
                                    opcoes: resp.opcoes,
                                    escala_min: resp.escala_min,
                                    escala_max: resp.escala_max
                                });
                                
                                return `
                                <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                                    <div style="background: #f9fafb; padding: 16px; border-bottom: 1px solid #e5e7eb;">
                                        <div style="display: flex; align-items: center; gap: 12px;">
                                            <div style="background: #0d556d; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; flex-shrink: 0;">
                                                ${index + 1}
                                            </div>
                                            <div style="flex: 1;">
                                                <div style="margin-bottom: 4px;">
                                                    <span style="background: #e5e7eb; color: #6b7280; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; text-transform: uppercase;">${resp.pergunta_tipo.replace('_', ' ')}</span>
                                                </div>
                                                <p style="margin: 0; color: #374151; font-weight: 500; font-size: 14px; line-height: 1.4;">${resp.pergunta_texto}</p>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div style="padding: 16px;">
                                        ${dadosIncompletos ? `
                                            <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px; border-radius: 4px;">
                                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                                    <i class="fas fa-info-circle" style="color: #f59e0b;"></i>
                                                    <span style="color: #92400e; font-weight: 600; font-size: 13px;">Resposta Antiga - Dados Incompletos</span>
                                                </div>
                                                <p style="margin: 0; color: #78350f; font-size: 12px; line-height: 1.5;">
                                                    Esta pergunta foi respondida em <strong>${new Date(resp.data_resposta).toLocaleString('pt-BR')}</strong>, 
                                                    mas os dados detalhados não foram armazenados corretamente devido a uma atualização no sistema.
                                                </p>
                                            </div>
                                        ` : temResposta ? `
                                            <div style="background: #f0f9ff; border-left: 4px solid #0d556d; padding: 12px; border-radius: 4px;">
                                                <div style="color: #374151; font-weight: 400; font-size: 14px;">
                                                    ${formatResponseComplete(resp)}
                                                </div>
                                            </div>
                                        ` : `
                                            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; border-radius: 4px; text-align: center;">
                                                <i class="fas fa-exclamation-triangle" style="color: #ef4444; margin-right: 8px;"></i>
                                                <span style="color: #991b1b; font-weight: 500;">Pergunta não respondida</span>
                                            </div>
                                        `}
                                    </div>
                                </div>
                            `;
                            }).join('')}
                        </div>
                    </div>
                    
                    <!-- Footer com botões -->
                    <div class="modal-footer">
                        <button type="button" onclick="closeMyResponseModalIndex()" class="btn btn-secondary">
                            <i class="fas fa-times"></i> Fechar
                        </button>
                        <button type="button" onclick="printModalContent()" class="btn btn-primary" style="background: #0d556d; border-color: #0d556d;">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remover modal existente se houver
    const existingModal = document.getElementById('my-response-modal-index');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Adicionar novo modal
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Função auxiliar para obter ícone do tipo de pergunta
function getQuestionTypeIcon(tipo) {
    const icons = {
        'texto': { class: 'fas fa-font', color: '#0d556d', bg: '#dbeafe' },
        'texto_longo': { class: 'fas fa-align-left', color: '#0d556d', bg: '#ede9fe' },
        'multipla_escolha': { class: 'fas fa-list-ul', color: '#0d556d', bg: '#dcfce7' },
        'escala': { class: 'fas fa-star', color: '#f59e0b', bg: '#fef3c7' }
    };
    return icons[tipo] || { class: 'fas fa-question-circle', color: '#6b7280', bg: '#f3f4f6' };
}

// Função completa para formatar resposta com todas as informações
function formatResponseComplete(resp) {
    console.log('🎨 Formatando resposta:', resp);
    
    // Buscar a resposta de diferentes campos dependendo do tipo
    let resposta = resp.resposta_texto || resp.resposta_numerica;
    
    // Para múltipla escolha, também verificar option_id
    if (resp.pergunta_tipo === 'multipla_escolha' && resp.option_id && !resposta) {
        // Se temos option_id mas não temos resposta_texto, tentar encontrar nas opções
        if (resp.opcoes) {
            const opcoes = typeof resp.opcoes === 'string' ? resp.opcoes.split('|') : resp.opcoes;
            resposta = opcoes[resp.option_id - 1] || 'Opção selecionada';
        }
    }
    
    const tipo = resp.pergunta_tipo;
    
    console.log('🎨 Resposta:', resposta, '| Tipo:', tipo);
    console.log('🎨 Opções:', resp.opcoes);
    console.log('🎨 Escala:', resp.escala_min, '-', resp.escala_max);
    console.log('🎨 Option ID:', resp.option_id);
    
    if (!resposta && resposta !== 0) {
        console.log('⚠️ Sem resposta detectada');
        return 'Sem resposta';
    }
    
    switch (tipo) {
        case 'escala':
            const num = parseInt(resposta);
            if (!isNaN(num)) {
                // Obter min e max da pergunta
                const escalaMin = resp.escala_min || resp.EscalaMin || 1;
                const escalaMax = resp.escala_max || resp.EscalaMax || 9;
                const percentual = Math.round(((num - escalaMin) / (escalaMax - escalaMin)) * 100);
                
                return `
                    <div>
                        <div style="margin-bottom: 12px;">
                            <span style="font-size: 11px; color: #6b7280; font-weight: 500;">Escala de ${escalaMin} a ${escalaMax}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: 32px; font-weight: 700; color: #0d556d;">${num}</span>
                            <div style="flex: 1;">
                                <div style="background: #e5e7eb; height: 12px; border-radius: 6px; overflow: hidden;">
                                    <div style="width: ${percentual}%; height: 100%; background: linear-gradient(90deg, #0d556d, #f59e0b); border-radius: 6px;"></div>
                                </div>
                                <div style="display: flex; justify-content: space-between; margin-top: 4px;">
                                    <span style="font-size: 10px; color: #9ca3af;">Mínimo (${escalaMin})</span>
                                    <span style="font-size: 10px; color: #9ca3af;">Máximo (${escalaMax})</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
            return resposta;
            
        case 'multipla_escolha':
            // Mostrar opções disponíveis e a selecionada
            let opcoesHtml = '';
            if (resp.opcoes) {
                try {
                    // As opções vêm como string separada por | da API
                    let opcoes;
                    if (typeof resp.opcoes === 'string') {
                        if (resp.opcoes.includes('|')) {
                            opcoes = resp.opcoes.split('|');
                        } else {
                            try {
                                opcoes = JSON.parse(resp.opcoes);
                            } catch {
                                opcoes = [resp.opcoes];
                            }
                        }
                    } else if (Array.isArray(resp.opcoes)) {
                        opcoes = resp.opcoes;
                    } else {
                        opcoes = [];
                    }
                    
                    if (opcoes.length > 0) {
                        opcoesHtml = `
                            <div style="margin-bottom: 12px;">
                                <span style="font-size: 11px; color: #6b7280; font-weight: 500;">Opções disponíveis:</span>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                ${opcoes.map(opcao => {
                                    const isSelected = opcao.trim() === String(resposta).trim();
                                    return `
                                        <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: ${isSelected ? '#dcfce7' : '#f9fafb'}; border: 2px solid ${isSelected ? '#10b981' : '#e5e7eb'}; border-radius: 6px;">
                                            <i class="fas ${isSelected ? 'fa-check-circle' : 'fa-circle'}" style="color: ${isSelected ? '#10b981' : '#d1d5db'};"></i>
                                            <span style="color: #374151; font-weight: ${isSelected ? '600' : '400'};">${opcao}</span>
                                            ${isSelected ? '<span style="margin-left: auto; background: #10b981; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">SELECIONADA</span>' : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    } else {
                        opcoesHtml = `<strong style="color: #0d556d;">${resposta}</strong>`;
                    }
                } catch (e) {
                    console.error('Erro ao processar opções:', e);
                    opcoesHtml = `<strong style="color: #0d556d;">${resposta}</strong>`;
                }
            } else {
                opcoesHtml = `<strong style="color: #0d556d;">${resposta}</strong>`;
            }
            return opcoesHtml;
            
        case 'sim_nao':
            // Mostrar as duas opções com destaque na selecionada
            const isSimSelected = resposta === 'Sim' || resposta === 'sim' || resposta === true || resposta === 'true';
            return `
                <div style="display: flex; gap: 12px;">
                    <div style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px; background: ${isSimSelected ? '#dcfce7' : '#f9fafb'}; border: 2px solid ${isSimSelected ? '#10b981' : '#e5e7eb'}; border-radius: 6px;">
                        <i class="fas ${isSimSelected ? 'fa-check-circle' : 'fa-circle'}" style="color: ${isSimSelected ? '#10b981' : '#d1d5db'}; font-size: 18px;"></i>
                        <span style="color: #374151; font-weight: ${isSimSelected ? '600' : '400'}; font-size: 14px;">Sim</span>
                        ${isSimSelected ? '<span style="margin-left: auto; background: #10b981; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">SELECIONADA</span>' : ''}
                    </div>
                    <div style="flex: 1; display: flex; align-items: center; gap: 8px; padding: 12px; background: ${!isSimSelected ? '#fee2e2' : '#f9fafb'}; border: 2px solid ${!isSimSelected ? '#ef4444' : '#e5e7eb'}; border-radius: 6px;">
                        <i class="fas ${!isSimSelected ? 'fa-times-circle' : 'fa-circle'}" style="color: ${!isSimSelected ? '#ef4444' : '#d1d5db'}; font-size: 18px;"></i>
                        <span style="color: #374151; font-weight: ${!isSimSelected ? '600' : '400'}; font-size: 14px;">Não</span>
                        ${!isSimSelected ? '<span style="margin-left: auto; background: #ef4444; color: white; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600;">SELECIONADA</span>' : ''}
                    </div>
                </div>
            `;
            
        case 'texto_livre':
            return `
                <div style="background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;">
                    <p style="margin: 0; line-height: 1.6; color: #374151; white-space: pre-wrap;">${resposta}</p>
                </div>
            `;
            
        default:
            return resposta;
    }
}

// Função auxiliar para formatar resposta baseada no tipo (mantida para compatibilidade)
function formatResponse(resposta, tipo) {
    if (!resposta && resposta !== 0) return 'Sem resposta';
    
    switch (tipo) {
        case 'escala':
            const num = parseInt(resposta);
            if (!isNaN(num)) {
                // Mostrar número com indicador visual
                const maxEscala = 9; // Escala máxima padrão
                const percentual = Math.round((num / maxEscala) * 100);
                return `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 24px; font-weight: 700; color: #0d556d;">${num}</span>
                        <div style="flex: 1;">
                            <div style="background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden;">
                                <div style="width: ${percentual}%; height: 100%; background: linear-gradient(90deg, #0d556d, #f59e0b); border-radius: 4px;"></div>
                            </div>
                            <p style="margin: 4px 0 0 0; font-size: 11px; color: #6b7280;">Nota ${num} de ${maxEscala}</p>
                        </div>
                    </div>
                `;
            }
            return resposta;
        case 'multipla_escolha':
            return `<strong style="color: #0d556d;">${resposta}</strong>`;
        case 'texto_livre':
            return `<p style="margin: 0; line-height: 1.6; color: #374151;">${resposta}</p>`;
        default:
            return resposta;
    }
}

function closeMyResponseModalIndex() {
    const modal = document.getElementById('my-response-modal-index');
    if (modal) {
        modal.remove();
        // Remover classe do body para restaurar scroll
        document.body.classList.remove('modal-open');
    }
}

// Função personalizada para impressão sem duplicação
function printModalContent() {
    // Criar uma nova janela para impressão
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    
    // Obter o conteúdo do modal
    const modal = document.getElementById('my-response-modal-index');
    if (!modal) return;
    
    // Clonar o conteúdo do modal
    const modalClone = modal.cloneNode(true);
    
    // Remover botões de ação do clone
    const footer = modalClone.querySelector('.modal-footer');
    if (footer) {
        footer.remove();
    }
    
    // Criar HTML para impressão
    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Minha Resposta - Impressão</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: white;
                    color: #333;
                    line-height: 1.6;
                }
                
                .modal-overlay-fullscreen {
                    position: static !important;
                    width: 100% !important;
                    height: auto !important;
                    background: white !important;
                    display: block !important;
                    margin: 0 !important;
                    padding: 0 !important;
                }
                
                .modal-fullscreen {
                    position: static !important;
                    width: 100% !important;
                    height: auto !important;
                    background: white !important;
                    display: block !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                    border: none !important;
                }
                
                .modal-content {
                    display: block !important;
                    width: 100% !important;
                    height: auto !important;
                }
                
                .modal-header {
                    background: white !important;
                    border-bottom: 2px solid #e5e7eb !important;
                    padding: 20px !important;
                    margin-bottom: 20px !important;
                }
                
                .modal-header h3 {
                    color: #1f2937 !important;
                    font-size: 24px !important;
                    font-weight: 600 !important;
                    margin: 0 !important;
                }
                
                .modal-body {
                    padding: 20px !important;
                    background: white !important;
                }
                
                /* Estilos para os cards de informação */
                .info-cards {
                    display: grid !important;
                    grid-template-columns: 1fr 1fr !important;
                    gap: 20px !important;
                    margin-bottom: 30px !important;
                }
                
                .info-card {
                    background: #f8fafc !important;
                    padding: 20px !important;
                    border-radius: 8px !important;
                    border: 1px solid #e5e7eb !important;
                }
                
                .info-card h4 {
                    color: #6b7280 !important;
                    font-size: 14px !important;
                    margin-bottom: 8px !important;
                }
                
                .info-card .value {
                    color: #1f2937 !important;
                    font-size: 18px !important;
                    font-weight: 600 !important;
                }
                
                /* Estilos para as respostas */
                .respostas-section {
                    margin-top: 30px !important;
                }
                
                .respostas-section h4 {
                    color: #1f2937 !important;
                    font-size: 18px !important;
                    font-weight: 600 !important;
                    margin-bottom: 20px !important;
                }
                
                .resposta-item {
                    background: white !important;
                    border: 1px solid #e5e7eb !important;
                    border-radius: 8px !important;
                    margin-bottom: 16px !important;
                    overflow: hidden !important;
                }
                
                .resposta-header {
                    background: #f9fafb !important;
                    padding: 16px !important;
                    border-bottom: 1px solid #e5e7eb !important;
                }
                
                .resposta-content {
                    padding: 16px !important;
                }
                
                .pergunta-texto {
                    color: #374151 !important;
                    font-weight: 500 !important;
                    font-size: 14px !important;
                    line-height: 1.4 !important;
                    margin: 0 !important;
                }
                
                .resposta-texto {
                    color: #1f2937 !important;
                    font-size: 14px !important;
                    margin-top: 8px !important;
                }
                
                @media print {
                    body { margin: 0; padding: 0; }
                    .modal-overlay-fullscreen { 
                        position: static !important; 
                        width: 100% !important; 
                        height: auto !important; 
                    }
                }
            </style>
        </head>
        <body>
            ${modalClone.outerHTML}
        </body>
        </html>
    `;
    
    // Escrever o HTML na nova janela
    printWindow.document.write(printHTML);
    printWindow.document.close();
    
    // Aguardar o carregamento e imprimir
    printWindow.onload = function() {
        printWindow.focus();
        printWindow.print();
        printWindow.close();
    };
}

function formatDateLocal(dateString) {
    if (!dateString) return 'Não definido';
    
    // Corrigir problema de timezone - interpretar como horário local brasileiro
    // Parse manual para evitar conversões automáticas de timezone
    let dateStr = dateString;
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
        // Remover timezone info e tratar como local
        dateStr = dateStr.replace('T', ' ').split('.')[0];
    }
    
    // Parse como data local (sem timezone conversion)
    const parts = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    
    if (parts) {
        // Criar Date como horário local (ano, mês-1, dia, hora, minuto, segundo)
        const date = new Date(
            parseInt(parts[1]), // ano
            parseInt(parts[2]) - 1, // mês (0-indexed)
            parseInt(parts[3]), // dia
            parseInt(parts[4]), // hora
            parseInt(parts[5]), // minuto
            parseInt(parts[6])  // segundo
        );
        
        return date.toLocaleDateString('pt-BR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // Fallback para formato padrão se não conseguir fazer parse
    return new Date(dateString).toLocaleDateString('pt-BR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function updateUserSurveysList(surveys) {
    const container = document.getElementById('user-surveys-list');
    if (!container) return;
    
    if (!surveys || surveys.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-poll"></i>
                <h4>Nenhuma pesquisa disponível</h4>
                <p>Não há pesquisas disponíveis para você no momento.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = surveys
        .filter(survey => survey.Id && !isNaN(survey.Id)) // Filtrar apenas pesquisas com ID válido
        .map(survey => `
        <div class="survey-card">
            <div class="survey-header">
                <h4>${survey.titulo || 'Pesquisa'}</h4>
                <span class="survey-status status-${(survey.status || 'ativa').toLowerCase()}">${survey.status || 'Ativa'}</span>
            </div>
            <div class="survey-content">
                <p>${survey.descricao || 'Sem descrição'}</p>
                       <div class="survey-meta">
                           <span><i class="fas fa-play-circle"></i> Início: ${survey.data_inicio ? formatDateLocal(survey.data_inicio) : 'Não definido'}</span>
                           ${survey.data_encerramento ? `<span><i class="fas fa-stop-circle"></i> Fim: ${formatDateLocal(survey.data_encerramento)}</span>` : ''}
                           ${survey.anonima ? '<span><i class="fas fa-user-secret"></i> Anônima</span>' : ''}
                       </div>
                <div class="survey-progress">
                    <div class="progress-info">
                        <span>Perguntas: ${survey.total_perguntas || 0}</span>
                        ${survey.user_responded ? 
                            '<span class="responded">✓ Respondida</span>' : 
                            (survey.status === 'Encerrada' ? 
                                '<span class="not-responded">✗ Não Respondida</span>' : 
                                '<span class="pending">⏳ Pendente</span>'
                            )
                        }
                    </div>
                </div>
            </div>
            <div class="survey-actions">
                ${survey.user_responded ? 
                    '<button class="btn btn-success" onclick="openMyResponse(' + survey.Id + ')">Ver Minha Resposta</button>' :
                    (survey.status === 'Ativa' ? 
                        '<button class="btn btn-success" onclick="openSurveyResponseForm(' + survey.Id + ')">Responder</button>' :
                        ''
                    )
                }
                <button class="btn btn-info" onclick="window.open('pesquisas-novo.html?id=${survey.Id}&view=true', '_blank', 'width=1400,height=900')">Ver Detalhes</button>
            </div>
        </div>
    `).join('');
}

function updatePesquisasList(pesquisas) {
    const container = document.getElementById('pesquisas-list');
    if (!container) return;

    if (pesquisas.length === 0) {
        container.innerHTML = '<div class="loading">Nenhuma pesquisa encontrada.</div>';
        return;
    }

    // Verificar se o usuário atual é do RH ou DEPARTAMENTO TREINAM&DESENVOLV
    const isHRorTD = currentUser && currentUser.departamento && (
        currentUser.departamento.toUpperCase().includes('RH') || 
        currentUser.departamento.toUpperCase().includes('RECURSOS HUMANOS') ||
        currentUser.departamento.toUpperCase().includes('DEPARTAMENTO TREINAM&DESENVOLV') ||
        currentUser.departamento.toUpperCase().includes('TREINAMENTO') ||
        currentUser.departamento.toUpperCase().includes('DESENVOLVIMENTO') ||
        currentUser.departamento.toUpperCase().includes('T&D')
    );

    container.innerHTML = pesquisas.map(pesquisa => {
        const dataCriacao = new Date(pesquisa.data_criacao).toLocaleDateString('pt-BR');
        const dataInicio = pesquisa.data_inicio ? new Date(pesquisa.data_inicio).toLocaleDateString('pt-BR') : 'Imediato';
        const dataEncerramento = pesquisa.data_encerramento ? new Date(pesquisa.data_encerramento).toLocaleDateString('pt-BR') : 'Sem prazo';
        
        const agora = new Date();
        const dataInicioObj = pesquisa.data_inicio ? new Date(pesquisa.data_inicio) : null;
        const dataEncerramentoObj = pesquisa.data_encerramento ? new Date(pesquisa.data_encerramento) : null;
        
        // Verificar se data_inicio existe antes de usar
        const isAtiva = pesquisa.status === 'Ativa' && 
                       (!pesquisa.data_inicio || !dataInicioObj || dataInicioObj <= agora) && 
                       (!dataEncerramentoObj || dataEncerramentoObj > agora);

        return `
                    <div class="pesquisa-item">
                        <div class="pesquisa-header">
                            <div class="pesquisa-info">
                                <h4>${pesquisa.titulo}</h4>
                                <p>${pesquisa.descricao || 'Sem descrição'}</p>
                                <p><strong>Criado por:</strong> ${pesquisa.criador_nome} | <strong>Data:</strong> ${dataCriacao}</p>
                                <p><strong>Início:</strong> ${dataInicio} | <strong>Encerramento:</strong> ${dataEncerramento}</p>
                                ${pesquisa.filial_alvo ? `<p><strong>Filial:</strong> ${pesquisa.filial_alvo}</p>` : ''}
                            </div>
                            <div class="pesquisa-badges">
                                <span class="badge ${isAtiva ? 'badge-positive' : 'badge-development'}">${pesquisa.status}</span>
                                ${pesquisa.anonima ? '<span class="badge badge-warning">Anônima</span>' : ''}
                            </div>
                        </div>
                        ${isHRorTD ? `
                        <div class="pesquisa-stats">
                            <div class="stat-item">
                                <div class="stat-label">Respostas:</div>
                                <div class="stat-value">${pesquisa.total_respostas}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Departamentos:</div>
                                <div class="stat-value">${getDepartamentosDescricao(pesquisa.departamentos_alvo)}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Filial:</div>
                                <div class="stat-value">${pesquisa.filial_alvo || 'Todas'}</div>
                            </div>
                        </div>
                        ` : ''}
                        <div class="pesquisa-actions">
                            ${isAtiva ? `
                                <button class="btn btn-sm btn-amber" onclick="openResponderPesquisaModal(${pesquisa.Id})">
                                    <i class="fas fa-edit"></i>
                                    Responder
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-secondary" onclick="viewPesquisaResultados(${pesquisa.Id})" style="display: none;" id="resultados-btn-${pesquisa.Id}">
                                <i class="fas fa-chart-bar"></i>
                                Resultados
                            </button>
                            ${isAtiva ? `
                                <button class="btn btn-sm btn-danger" onclick="encerrarPesquisa(${pesquisa.Id})" style="display: none;" id="encerrar-btn-${pesquisa.Id}">
                                    <i class="fas fa-stop"></i>
                                    Encerrar
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
    }).join('');
    
    // Verificar se é RH para mostrar botões de resultados e encerrar
    fetch('/api/pesquisas/can-create')
        .then(response => response.json())
        .then(data => {
            if (data.canCreate) {
                // Mostrar botões para usuários do RH
                pesquisas.forEach(pesquisa => {
                    const resultadosBtn = document.getElementById(`resultados-btn-${pesquisa.Id}`);
                    const encerrarBtn = document.getElementById(`encerrar-btn-${pesquisa.Id}`);
                    if (resultadosBtn) resultadosBtn.style.display = 'inline-block';
                    if (encerrarBtn) encerrarBtn.style.display = 'inline-block';
                });
            }
        })
        .catch(error => console.error('Erro ao verificar permissões RH:', error));
}

function getTipoPerguntaLabel(tipo) {
    const labels = {
        'multipla_escolha': 'Múltipla Escolha',
        'escala': 'Escala',
        'texto_livre': 'Texto Livre'
    };
    return labels[tipo] || tipo;
}

// Modal de pesquisa
async function openPesquisaModal() {
    try {
        const response = await fetch('/api/pesquisas/can-create');
        if (response.ok) {
            const data = await response.json();
            if (data.canCreate) {
                window.open('/criar-pesquisa.html', '_blank');
            } else {
                alert('Acesso negado. Apenas usuários do RH e Treinamento & Desenvolvimento podem criar pesquisas.');
            }
        } else {
            alert('Erro ao verificar permissões.');
        }
    } catch (error) {
        console.error('Erro ao verificar permissões:', error);
        alert('Erro ao verificar permissões.');
    }
}

function closePesquisaModal() {
    document.getElementById('pesquisa-modal').classList.add('hidden');
    clearPesquisaForm();
}

function clearPesquisaForm() {
    document.getElementById('pesquisa-titulo').value = '';
    document.getElementById('pesquisa-descricao').value = '';
    document.getElementById('pesquisa-pergunta').value = '';
    document.getElementById('pesquisa-tipo').value = 'multipla_escolha';
    document.getElementById('pesquisa-departamentos').value = '';
    document.getElementById('pesquisa-opcoes').value = '';
    document.getElementById('pesquisa-data-encerramento').value = '';
    document.getElementById('pesquisa-anonima').value = 'false';
    document.getElementById('opcoes-container').style.display = 'none';
}

function toggleOpcoesField() {
    const tipo = document.getElementById('pesquisa-tipo').value;
    const opcoesContainer = document.getElementById('opcoes-container');

    if (tipo === 'multipla_escolha') {
        opcoesContainer.style.display = 'block';
    } else {
        opcoesContainer.style.display = 'none';
    }
}

async function submitPesquisa() {
    const titulo = document.getElementById('pesquisa-titulo').value;
    const descricao = document.getElementById('pesquisa-descricao').value;
    const pergunta = document.getElementById('pesquisa-pergunta').value;
    const tipo = document.getElementById('pesquisa-tipo').value;
    const departamentos = document.getElementById('pesquisa-departamentos').value;
    const opcoes = document.getElementById('pesquisa-opcoes').value;
    const dataInicio = document.getElementById('pesquisa-data-inicio').value;
    const dataEncerramento = document.getElementById('pesquisa-data-encerramento').value;
    const anonima = document.getElementById('pesquisa-anonima').value === 'true';

    if (!titulo || !pergunta) {
        alert('Título e pergunta são obrigatórios');
        return;
    }

    if (tipo === 'multipla_escolha' && !opcoes.trim()) {
        alert('Para múltipla escolha, é necessário definir as opções');
        return;
    }

    let opcoesArray = [];
    if (tipo === 'multipla_escolha') {
        opcoesArray = opcoes.split('\n').filter(opcao => opcao.trim());
    }

    try {
        // Criar array de perguntas no formato esperado pelo backend
        const perguntas = [{
            texto: pergunta,
            tipo: tipo,
            opcoes: opcoesArray.length > 0 ? opcoesArray : null,
            obrigatoria: true,
            ordem: 1
        }];

        const response = await fetch('/api/pesquisas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo,
                descricao,
                perguntas,
                departamentos_alvo: departamentos,
                data_inicio: dataInicio || null,
                data_encerramento: dataEncerramento || null,
                anonima
            })
        });

        if (response.ok) {
            closePesquisaModal();
            loadPesquisas();
            alert('Pesquisa criada com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao criar pesquisa');
        }
    } catch (error) {
        console.error('Erro ao criar pesquisa:', error);
        alert('Erro ao criar pesquisa');
    }
}

// Redirecionar para página de responder pesquisa
function openResponderPesquisaModal(pesquisaId) {
    window.open(`/responder-pesquisa.html?id=${pesquisaId}`, '_blank');
}

function closeResponderPesquisaModal() {
    document.getElementById('responder-pesquisa-modal').classList.add('hidden');
    currentPesquisa = null;
    selectedPesquisaResposta = null;
    document.getElementById('responder-resposta-texto').value = '';
    document.querySelectorAll('.escala-option').forEach(option => {
        option.classList.remove('selected');
    });
    document.querySelectorAll('.opcao-option').forEach(option => {
        option.classList.remove('selected');
    });
}

function selectOpcao(optionId, evt) {
    document.querySelectorAll('.opcao-option').forEach(option => {
        option.classList.remove('selected');
    });
    if (evt && evt.target) {
        evt.target.closest('.opcao-option').classList.add('selected');
    }
    selectedPesquisaResposta = parseInt(optionId);
    console.log('✅ Opção selecionada - ID:', selectedPesquisaResposta);
}

// Event listeners para escala
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.escala-option').forEach(option => {
        option.addEventListener('click', () => {
            document.querySelectorAll('.escala-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            option.classList.add('selected');
            selectedPesquisaResposta = parseInt(option.dataset.score);
        });
    });
});

async function submitRespostaPesquisa() {
    console.log('🔵 submitRespostaPesquisa CHAMADA - VERSÃO NOVA');
    
    const surveyId = window.currentSurveyId;
    const pergunta = window.currentPergunta;
    
    console.log('🔵 Survey ID:', surveyId);
    console.log('🔵 Pergunta:', pergunta);
    console.log('🔵 selectedPesquisaResposta:', selectedPesquisaResposta);
    
    if (!surveyId || !pergunta) {
        alert('Nenhuma pesquisa selecionada');
        return;
    }

    const tipoPergunta = (pergunta.tipo || pergunta.Tipo || '').toLowerCase();
    console.log('🔵 Tipo de pergunta:', tipoPergunta);
    
    const respostaObj = {
        question_id: pergunta.id || pergunta.Id
    };

    if (tipoPergunta === 'multipla_escolha') {
        console.log('🔵 ENTRANDO NO IF DE MULTIPLA ESCOLHA');
        console.log('🔵 selectedPesquisaResposta antes:', selectedPesquisaResposta);
        
        if (!selectedPesquisaResposta) {
            alert('Selecione uma opção');
            return;
        }
        // Para múltipla escolha, enviar como option_id (ID da opção selecionada)
        respostaObj.option_id = parseInt(selectedPesquisaResposta);
        console.log('📤 Enviando múltipla escolha - option_id:', respostaObj.option_id);
        console.log('📤 Tipo de option_id:', typeof respostaObj.option_id);
    } else if (tipoPergunta === 'escala') {
        if (!selectedPesquisaResposta) {
            alert('Selecione uma nota');
            return;
        }
        respostaObj.resposta_numerica = parseInt(selectedPesquisaResposta);
        console.log('📤 Enviando escala - resposta_numerica:', respostaObj.resposta_numerica);
    } else if (tipoPergunta === 'texto_livre' || tipoPergunta === 'sim_nao') {
        const resposta = document.getElementById('responder-resposta-texto')?.value || selectedPesquisaResposta;
        if (!resposta || !resposta.toString().trim()) {
            alert('Digite sua resposta');
            return;
        }
        respostaObj.resposta_texto = resposta;
        console.log('📤 Enviando texto - resposta_texto:', respostaObj.resposta_texto);
    }

    try {
        console.log('📤 Enviando resposta para survey', surveyId, ':', respostaObj);
        
        // Usar a nova API /responder que aceita array de respostas
        const response = await fetch(`/api/surveys/${surveyId}/responder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                respostas: [respostaObj]
            })
        });

        if (response.ok) {
            closeResponderPesquisaModal();
            loadPesquisas();
            showSuccessNotification('Resposta enviada com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao enviar resposta');
        }
    } catch (error) {
        console.error('Erro ao enviar resposta:', error);
        alert('Erro ao enviar resposta');
    }
}

function viewPesquisaResultados(pesquisaId) {
    // Verificar se usuário é do RH antes de abrir resultados
    fetch('/api/pesquisas/can-create')
        .then(response => response.json())
        .then(data => {
            if (data.canCreate) {
                window.open(`/resultados-pesquisa.html?id=${pesquisaId}`, '_blank');
            } else {
                alert('Apenas usuários do RH podem visualizar os resultados das pesquisas.');
            }
        })
        .catch(error => {
            console.error('Erro ao verificar permissões:', error);
            alert('Erro ao verificar permissões.');
        });
}

function showPesquisaResultados(data) {
    const { pesquisa, respostas, estatisticas } = data;

    let resultadosHTML = `
                <div style="padding: 20px;">
                    <h3>${pesquisa.titulo}</h3>
                    <p><strong>Pergunta:</strong> ${pesquisa.pergunta}</p>
                    <p><strong>Total de respostas:</strong> ${estatisticas.total}</p>
            `;

    if (pesquisa.tipo_pergunta === 'escala') {
        resultadosHTML += `
                    <div style="margin: 20px 0;">
                        <h4>Estatísticas:</h4>
                        <p><strong>Média:</strong> ${estatisticas.media}</p>
                        <p><strong>Mínimo:</strong> ${estatisticas.min}</p>
                        <p><strong>Máximo:</strong> ${estatisticas.max}</p>
                    </div>
                `;
    } else if (pesquisa.tipo_pergunta === 'multipla_escolha') {
        resultadosHTML += `
                    <div style="margin: 20px 0;">
                        <h4>Resultados por opção:</h4>
                        ${Object.entries(estatisticas.opcoes).map(([opcao, count]) => `
                            <p><strong>${opcao}:</strong> ${count} respostas</p>
                        `).join('')}
                    </div>
                `;
    }

    if (respostas.length > 0) {
        resultadosHTML += `
                    <div style="margin: 20px 0;">
                        <h4>Respostas individuais:</h4>
                        ${respostas.map(resposta => `
                            <div style="padding: 10px; border-bottom: 1px solid #eee;">
                                <p><strong>${resposta.user_name || 'Anônimo'}</strong> - ${resposta.resposta}</p>
                                <small>${new Date(resposta.created_at).toLocaleString('pt-BR')}</small>
                            </div>
                        `).join('')}
                    </div>
                `;
    }

    resultadosHTML += '</div>';

    // Criar modal temporário para mostrar resultados
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
                <div class="modal">
                    <div class="modal-content">
                        <h3><i class="fas fa-chart-bar"></i> Resultados da Pesquisa</h3>
                        <div style="max-height: 400px; overflow-y: auto;">
                            ${resultadosHTML}
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            `;
    document.body.appendChild(modal);
}

async function encerrarPesquisa(pesquisaId) {
    if (!confirm('Tem certeza que deseja encerrar esta pesquisa?')) {
        return;
    }

    try {
        const response = await fetch(`/api/pesquisas/${pesquisaId}/encerrar`, {
            method: 'PUT'
        });

        if (response.ok) {
            loadPesquisas();
            alert('Pesquisa encerrada com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao encerrar pesquisa');
        }
    } catch (error) {
        console.error('Erro ao encerrar pesquisa:', error);
        alert('Erro ao encerrar pesquisa');
    }
}

// Filtros de pesquisas
function togglePesquisasFilters() {
    const filterMenu = document.getElementById('pesquisas-filter-menu');
    filterMenu.classList.toggle('hidden');
}

function togglePesquisasFilter(type, value) {
    if (activePesquisasFilters[type] === value) {
        activePesquisasFilters[type] = null;
    } else {
        activePesquisasFilters[type] = value;
    }

    // Update UI
    document.querySelectorAll(`[data-pesquisa-filter="${type}"]`).forEach(el => {
        el.classList.toggle('active', el.dataset.value === activePesquisasFilters[type]);
    });

    // Reload pesquisas
    loadPesquisas();
}

// Carregar filtros de pesquisas
async function loadPesquisasFilters() {
    try {
        const response = await fetch('/api/pesquisas/filtros');
        if (response.ok) {
            const filters = await response.json();
            updatePesquisasFilters(filters);
        }
    } catch (error) {
        console.error('Erro ao carregar filtros de pesquisas:', error);
    }
}

function updatePesquisasFilters(filters) {
    // Update status filters
    const statusContainer = document.getElementById('pesquisa-status-filters');
    statusContainer.innerHTML = filters.status.map(status => `
                <div class="filter-option" onclick="togglePesquisasFilter('status', '${status}')" data-pesquisa-filter="status" data-value="${status}">
                    ${status}
                </div>
            `).join('');

    // Update tipo filters
    const tipoContainer = document.getElementById('pesquisa-tipo-filters');
    tipoContainer.innerHTML = filters.tipos.map(tipo => `
                <div class="filter-option" onclick="togglePesquisasFilter('tipo', '${tipo}')" data-pesquisa-filter="tipo" data-value="${tipo}">
                    ${getTipoPerguntaLabel(tipo)}
                </div>
            `).join('');
}


// ===== FUNÇÕES PARA GESTÃO DE EQUIPE =====

// Carregar todos os dados da equipe
async function loadTeamData() {
    await Promise.all([
        loadTeamMembers(),
        loadTeamMetrics(),
        loadTeamStatus(),
        loadTeamFilters()
    ]);
}

// Variáveis globais para armazenar dados disponíveis
let availableDepartments = [];
let availableUsers = [];
let selectedDepartment = '';
let selectedUserFilter = '';

// Carregar filtros da equipe
async function loadTeamFilters() {
    try {
        // Buscar departamentos disponíveis do servidor
        const deptResponse = await fetch('/api/departments');
        if (deptResponse.ok) {
            availableDepartments = await deptResponse.json();
        }
        
        // Buscar usuários disponíveis do servidor
        const usersResponse = await fetch('/api/manager/team-management');
        if (usersResponse.ok) {
            availableUsers = await usersResponse.json();
            updateTeamUserList();
        }
        
        // Configurar event listeners para fechar sugestões ao clicar fora
        document.addEventListener('click', (e) => {
            const deptSearchInput = document.getElementById('team-department-search');
            const deptSuggestions = document.getElementById('department-suggestions');
            
            if (deptSearchInput && deptSuggestions && !e.target.closest('#team-department-search') && !e.target.closest('#department-suggestions')) {
                deptSuggestions.classList.add('hidden');
            }
        });
    } catch (error) {
        console.error('Erro ao carregar filtros da equipe:', error);
    }
}

// Atualizar lista de usuários no dropdown
function updateTeamUserList() {
    const userList = document.getElementById('team-user-list');
    if (!userList) return;
    
    console.log('📋 Atualizando lista de usuários:', availableUsers.length, 'usuários');
    if (availableUsers.length > 0) {
        console.log('📋 Exemplo de usuário:', availableUsers[0]);
    }
    
    userList.innerHTML = '<div class="select-option" data-value="" onclick="selectTeamUser(\'\', \'Todos os usuários\')">Todos os usuários</div>';
    
    availableUsers.forEach((user, index) => {
        // Tentar múltiplas propriedades possíveis
        const userName = user.nomeCompleto || user.nome || user.NomeCompleto || user.name || `Usuário ${index + 1}`;
        const userDept = user.departamento || user.department || user.Departamento || '';
        const userId = user.id || user.userId || user.Id || '';
        
        const displayText = userDept ? `${userName} - ${userDept}` : userName;
        
        // Escapar aspas e caracteres especiais
        const safeDisplayText = displayText.replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        const safeUserId = String(userId).replace(/'/g, "\\'");
        
        userList.innerHTML += `<div class="select-option" data-value="${userId}" onclick="selectTeamUser('${safeUserId}', '${safeDisplayText}')">
            ${displayText}
        </div>`;
    });
    
    console.log('✅ Lista de usuários atualizada com', availableUsers.length, 'opções');
}

// Filtrar departamentos baseado na pesquisa
function filterDepartmentSearch() {
    const searchInput = document.getElementById('team-department-search');
    const suggestions = document.getElementById('department-suggestions');
    
    if (!searchInput || !suggestions) return;
    
    const searchTerm = searchInput.value.trim().toLowerCase();
    
    // Se o campo estiver vazio, limpar filtro e recarregar todos
    if (searchTerm === '') {
        selectedDepartment = '';
        suggestions.classList.add('hidden');
        
        // Recarregar todos os dados da equipe sem filtro de departamento
        Promise.all([
            loadTeamMembers(),
            loadTeamMetrics(),
            loadTeamStatus()
        ]).then(() => {
            // Aplicar filtro de nome se houver
            applyTeamFilters();
        });
        return;
    }
    
    // Filtrar departamentos que contenham o termo de pesquisa
    const filteredDepartments = availableDepartments.filter(dept => 
        dept.toLowerCase().includes(searchTerm)
    );
    
    // Mostrar sugestões
    if (filteredDepartments.length > 0) {
        suggestions.innerHTML = filteredDepartments.map(dept => `
            <div class="department-suggestion-item ${dept === selectedDepartment ? 'selected' : ''}" 
                 onclick="selectDepartment('${dept.replace(/'/g, "\\'")}')">
                <i class="fas fa-building"></i>
                <span class="suggestion-text">${dept}</span>
            </div>
        `).join('');
        suggestions.classList.remove('hidden');
    } else {
        suggestions.innerHTML = `
            <div class="department-suggestion-item" style="cursor: default; color: #9ca3af;">
                <i class="fas fa-info-circle"></i>
                <span class="suggestion-text">Nenhum departamento encontrado</span>
            </div>
        `;
        suggestions.classList.remove('hidden');
    }
}

// Selecionar departamento da lista de sugestões
function selectDepartment(department) {
    const searchInput = document.getElementById('team-department-search');
    const suggestions = document.getElementById('department-suggestions');
    
    if (searchInput) {
        searchInput.value = department;
    }
    
    selectedDepartment = department;
    
    if (suggestions) {
        suggestions.classList.add('hidden');
    }
    
    // Recarregar todos os dados da equipe com o filtro de departamento
    Promise.all([
        loadTeamMembers(),
        loadTeamMetrics(),
        loadTeamStatus()
    ]).then(() => {
        // Aplicar filtros combinados após carregar
        applyTeamFilters();
    });
}

// Filtrar usuários no dropdown (mesmo padrão do seletor de feedback)
function filterTeamUsers(searchId, listId) {
    const searchInput = document.getElementById(searchId);
    const list = document.getElementById(listId);
    
    if (!searchInput || !list) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    
    const options = list.querySelectorAll('.select-option');
    options.forEach(option => {
        const text = option.textContent.toLowerCase();
        if (text.includes(searchTerm)) {
            option.style.display = 'block';
        } else {
            option.style.display = 'none';
        }
    });
    
    list.classList.add('show');
}

// Selecionar usuário (mesmo padrão do seletor de feedback)
function selectTeamUser(userId, displayText) {
    console.log('👤 Selecionando usuário:', userId, '-', displayText);
    
    const searchInput = document.getElementById('team-user-search');
    const hiddenInput = document.getElementById('team-selected-user');
    const list = document.getElementById('team-user-list');
    
    if (hiddenInput) {
        hiddenInput.value = userId;
    }
    
    if (searchInput) {
        searchInput.value = userId ? displayText : '';
    }
    
    selectedUserFilter = userId;
    
    if (list) {
        list.classList.remove('show');
    }
    
    console.log('👤 selectedUserFilter definido como:', selectedUserFilter);
    
    // Aplicar filtros combinados
    applyTeamFilters();
}

// Aplicar filtros combinados (departamento + usuário)
function applyTeamFilters() {
    console.log('🔍 Aplicando filtros - Usuário selecionado:', selectedUserFilter);
    console.log('🔍 Total de usuários disponíveis:', availableUsers.length);
    
    let filteredUsers = [...availableUsers];
    
    // Aplicar filtro de usuário se selecionado
    if (selectedUserFilter) {
        console.log('🔍 Filtrando por usuário ID:', selectedUserFilter);
        
        filteredUsers = filteredUsers.filter(user => {
            const userId = user.id || user.userId || user.Id;
            const match = String(userId) === String(selectedUserFilter);
            
            if (match) {
                console.log('✅ Usuário encontrado:', user.nomeCompleto || user.NomeCompleto || user.nome);
            }
            
            return match;
        });
        
        console.log('🔍 Usuários após filtro:', filteredUsers.length);
    }
    
    // Verificar se é RH ou T&D e se não há filtros ativos
    const isRHorTD = currentUser && (
        (currentUser.departamento && (
            currentUser.departamento.toUpperCase().includes('RH') ||
            currentUser.departamento.toUpperCase().includes('RECURSOS HUMANOS') ||
            currentUser.departamento.toUpperCase().includes('T&D') ||
            currentUser.departamento.toUpperCase().includes('TREINAMENTO') ||
            currentUser.departamento.toUpperCase().includes('DESENVOLVIMENTO') ||
            currentUser.departamento.toUpperCase().includes('TREINAM&DESENVOLV')
        ))
    );
    
    // Limitar a 10 usuários para RH/T&D quando não há filtros
    if (isRHorTD && !selectedUserFilter && !selectedDepartment && filteredUsers.length > 10) {
        console.log('⚠️ RH/T&D sem filtros - limitando a 10 usuários');
        filteredUsers = filteredUsers.slice(0, 10);
    }
    
    // Atualizar visualização com os usuários filtrados
    updateTeamMembersList(filteredUsers);
}

// Limpar todos os filtros
function clearTeamFilters() {
    console.log('🧹 Limpando todos os filtros');
    
    // Limpar filtro de departamento
    const deptSearchInput = document.getElementById('team-department-search');
    if (deptSearchInput) {
        deptSearchInput.value = '';
    }
    selectedDepartment = '';
    
    // Fechar sugestões de departamento
    const deptSuggestions = document.getElementById('department-suggestions');
    if (deptSuggestions) {
        deptSuggestions.classList.add('hidden');
    }
    
    // Limpar filtro de usuário
    const userSearchInput = document.getElementById('team-user-search');
    if (userSearchInput) {
        userSearchInput.value = '';
    }
    
    const userHiddenInput = document.getElementById('team-selected-user');
    if (userHiddenInput) {
        userHiddenInput.value = '';
    }
    selectedUserFilter = '';
    
    // Fechar dropdown de usuário
    const userList = document.getElementById('team-user-list');
    if (userList) {
        userList.classList.remove('show');
    }
    
    // Recarregar todos os dados da equipe sem filtros
    Promise.all([
        loadTeamMembers(),
        loadTeamMetrics(),
        loadTeamStatus()
    ]);
}

// Carregar métricas da equipe
async function loadTeamMetrics() {
    try {
        const queryParams = new URLSearchParams();
        
        // Adicionar filtro de departamento se selecionado
        if (selectedDepartment) {
            queryParams.append('departamento', selectedDepartment);
        }
        
        const response = await fetch(`/api/manager/team-metrics?${queryParams}`);
        if (response.ok) {
            const metrics = await response.json();
            updateTeamMetrics(metrics);
        }
    } catch (error) {
        console.error('Erro ao carregar métricas da equipe:', error);
        // Mostrar dados vazios em caso de erro
        updateTeamMetrics({
            totalMembers: 0,
            activeMembers: 0,
            averageMood: 0,
            totalFeedbacks: 0
        });
    }
}

// Atualizar métricas da equipe
function updateTeamMetrics(metrics) {
    const container = document.getElementById('team-metrics');
    if (!container) return;

    container.innerHTML = `
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-value">${metrics.totalMembers}</div>
                        <div class="metric-label">Total de Membros</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${metrics.activeMembers}</div>
                        <div class="metric-label">Membros Ativos</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${metrics.averageMood.toFixed(1)}</div>
                        <div class="metric-label">Humor Médio</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-value">${metrics.totalFeedbacks}</div>
                        <div class="metric-label">Feedbacks</div>
                    </div>
                </div>
            `;
}

// Carregar status dos colaboradores
async function loadTeamStatus() {
    try {
        const queryParams = new URLSearchParams();
        
        // Adicionar filtro de departamento se selecionado
        if (selectedDepartment) {
            queryParams.append('departamento', selectedDepartment);
        }
        
        const response = await fetch(`/api/manager/team-status?${queryParams}`);
        if (response.ok) {
            const status = await response.json();
            updateTeamStatus(status);
        }
    } catch (error) {
        console.error('Erro ao carregar status da equipe:', error);
        // Mostrar dados vazios em caso de erro
        updateTeamStatus({
            online: 0,
            offline: 0,
            active: 0,
            inactive: 0
        });
    }
}

// Atualizar status dos colaboradores
function updateTeamStatus(status) {
    const container = document.getElementById('team-status');
    if (!container) return;

    container.innerHTML = `
                <div class="status-grid">
                    <div class="status-card online">
                        <div class="status-value">${status.online}</div>
                        <div class="status-label">Online</div>
                        <div class="status-subtitle">Últimas 30 min</div>
                    </div>
                    <div class="status-card offline">
                        <div class="status-value">${status.offline}</div>
                        <div class="status-label">Offline</div>
                        <div class="status-subtitle">+30 min</div>
                    </div>
                    <div class="status-card active">
                        <div class="status-value">${status.active}</div>
                        <div class="status-label">Ativos</div>
                        <div class="status-subtitle">Contas ativas</div>
                    </div>
                    <div class="status-card inactive">
                        <div class="status-value">${status.inactive}</div>
                        <div class="status-label">Inativos</div>
                        <div class="status-subtitle">Contas inativas</div>
                    </div>
                </div>
            `;
}

async function loadTeamMembers() {
    try {
        const queryParams = new URLSearchParams();
        
        // Usar o departamento selecionado pela pesquisa inteligente
        if (selectedDepartment) {
            queryParams.append('departamento', selectedDepartment);
        }

        const response = await fetch(`/api/manager/team-management?${queryParams}`);
        if (response.ok) {
            const teamMembers = await response.json();
            
            // Atualizar lista de usuários disponíveis
            availableUsers = teamMembers;
            
            // Atualizar dropdown de usuários
            updateTeamUserList();
            
            // Sempre aplicar filtros (isso vai aplicar a limitação de 10 para RH/T&D se necessário)
            applyTeamFilters();
        }
    } catch (error) {
        console.error('Erro ao carregar membros da equipe:', error);
    }
}

function updateTeamMembersList(members) {
    const container = document.getElementById('team-members-list');
    if (!container) return;

    if (members.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum membro encontrado.</div>';
        return;
    }
    
    // Verificar se é RH/T&D e se está limitado
    const isRHorTD = currentUser && (
        (currentUser.departamento && (
            currentUser.departamento.toUpperCase().includes('RH') ||
            currentUser.departamento.toUpperCase().includes('RECURSOS HUMANOS') ||
            currentUser.departamento.toUpperCase().includes('T&D') ||
            currentUser.departamento.toUpperCase().includes('TREINAMENTO') ||
            currentUser.departamento.toUpperCase().includes('DESENVOLVIMENTO') ||
            currentUser.departamento.toUpperCase().includes('TREINAM&DESENVOLV')
        ))
    );
    
    const isLimited = isRHorTD && !selectedUserFilter && !selectedDepartment && availableUsers.length > 10;
    
    let warningHtml = '';
    if (isLimited) {
        warningHtml = `
            <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 16px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
                <i class="fas fa-info-circle" style="font-size: 24px;"></i>
                <div>
                    <strong>Visualização Limitada</strong>
                    <p style="margin: 4px 0 0 0; font-size: 14px; opacity: 0.95;">
                        Mostrando apenas os primeiros 10 colaboradores de ${availableUsers.length} no total. 
                        Use os filtros acima para encontrar colaboradores específicos.
                    </p>
                </div>
            </div>
        `;
    }

    container.innerHTML = warningHtml + members.map(member => {
        const lastLogin = member.LastLogin ? new Date(member.LastLogin).toLocaleDateString('pt-BR') : 'Nunca';
        const moodIcon = member.lastMood ? getMoodIcon(member.lastMood) : 'fas fa-question';
        const moodColor = member.lastMood ? getMoodColor(member.lastMood) : '#6b7280';

        return `
                    <div class="team-member-item">
                        <div class="member-info">
                            <h4>${member.NomeCompleto}</h4>
                            <p><strong>Departamento:</strong> ${member.DescricaoDepartamento || member.Departamento}</p>
                            <p><strong>Último login:</strong> ${lastLogin}</p>
                        </div>
                        <div class="member-metrics">
                            <div class="metric">
                                <i class="${moodIcon}" style="color: ${moodColor};"></i>
                                <span>Humor médio: ${member.lastMood ? member.lastMood.toFixed(1) : 'N/A'}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-comment"></i>
                                <span>Feedbacks: ${member.recentFeedbacks || 0}</span>
                                <button class="view-feedbacks-btn" onclick="viewEmployeeFeedbacks(${member.Id})" title="Ver feedbacks do colaborador">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                            <div class="metric">
                                <i class="fas fa-bullseye" style="color: #10b981;"></i>
                                <span>Objetivos Ativos: ${member.activeObjectives || 0}</span>
                            </div>
                            ${member.objectiveStatistics ? `
                            <div class="metric">
                                <i class="fas fa-circle" style="color: #3b82f6; font-size: 10px;"></i>
                                <span>Agendados: ${member.objectiveStatistics.scheduled || 0}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-check-circle" style="color: #059669; font-size: 10px;"></i>
                                <span>Concluídos: ${member.objectiveStatistics.completed || 0}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-exclamation-circle" style="color: #dc2626; font-size: 10px;"></i>
                                <span>Expirados: ${member.objectiveStatistics.expired || 0}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-chart-line" style="color: #6b7280; font-size: 10px;"></i>
                                <span>Total: ${member.objectiveStatistics.total || 0}</span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                `;
    }).join('');
}

function getMoodIcon(score) {
    const icons = ['', 'fas fa-frown', 'fas fa-meh', 'fas fa-smile', 'fas fa-laugh', 'fas fa-grin-stars'];
    return icons[score] || 'fas fa-question';
}

function getMoodColor(score) {
    const colors = ['', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];
    return colors[score] || '#6b7280';
}

// Visualizar feedbacks de um colaborador específico
async function viewEmployeeFeedbacks(employeeId) {
    try {
        // Buscar dados do colaborador
        const employeeResponse = await fetch(`/api/manager/employee-info/${employeeId}`);
        if (!employeeResponse.ok) {
            console.error('Erro ao buscar dados do colaborador');
            return;
        }
        const employee = await employeeResponse.json();
        
        // Buscar feedbacks do colaborador
        const feedbacksResponse = await fetch(`/api/manager/employee-feedbacks/${employeeId}`);
        if (!feedbacksResponse.ok) {
            console.error('Erro ao buscar feedbacks do colaborador');
            return;
        }
        const feedbacks = await feedbacksResponse.json();
        
        // Criar modal de visualização
        createEmployeeFeedbacksModal(employee, feedbacks);
    } catch (error) {
        console.error('Erro ao visualizar feedbacks do colaborador:', error);
    }
}

// Criar modal de visualização de feedbacks do colaborador
function createEmployeeFeedbacksModal(employee, feedbacks) {
    // Remover modal existente se houver
    const existingModal = document.getElementById('employee-feedbacks-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'employee-feedbacks-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-background">
            <div class="modal-content employee-feedbacks-modal">
                <div class="modal-header">
                    <h3>
                        <i class="fas fa-comment" style="color:rgb(255, 255, 255);"></i>
                        Feedbacks de ${employee.NomeCompleto}
                    </h3>
                    <button class="close-btn" onclick="closeEmployeeFeedbacksModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="employee-info">
                        <p><strong>Departamento:</strong> ${employee.Departamento}</p>
                    </div>
                    <div class="feedbacks-list" id="employee-feedbacks-list">
                        ${feedbacks.length === 0 ? 
                            '<div class="no-feedbacks">Nenhum feedback encontrado.</div>' : 
                            feedbacks.map(feedback => createEmployeeFeedbackItem(feedback)).join('')
                        }
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    
    // Adicionar event listener para fechar com ESC
    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            closeEmployeeFeedbacksModal();
        }
    };
    
    // Armazenar a referência do event listener no modal para poder removê-lo depois
    modal._escHandler = handleKeyDown;
    document.addEventListener('keydown', handleKeyDown);
}

// Criar item de feedback do colaborador
function createEmployeeFeedbackItem(feedback) {
    const isReceived = feedback.direction === 'received';
    const displayName = isReceived ? 
        `${feedback.from_name} → ${feedback.to_name}` : 
        `${feedback.from_name} → ${feedback.to_name}`;
    
    return `
        <div class="employee-feedback-item" data-feedback-id="${feedback.Id}">
            <div class="feedback-header-info">
                <div class="feedback-user">
                    <div class="user-avatar">
                        <i class="fas fa-user"></i>
                    </div>
                    <div>
                        <strong>${displayName}</strong>
                        <p style="color: #6b7280; font-size: 14px;">${new Date(feedback.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                </div>
                <div class="feedback-badges">
                    <span class="badge ${feedback.type === 'Positivo' ? 'badge-positive' : 'badge-development'}">${feedback.type}</span>
                    <span class="badge badge-category">${feedback.category}</span>
                </div>
            </div>
            <p class="feedback-message">${feedback.message}</p>
            <div class="feedback-actions">
                <button class="action-btn status-respostas ${feedback.replies_count > 0 ? 'has-activity' : ''}" 
                        onclick="viewEmployeeFeedbackChat(${feedback.Id})" 
                        title="Ver conversa">
                    <i class="fas fa-comment"></i>
                    Ver conversa <span class="counter">${feedback.replies_count || 0}</span>
                </button>
            </div>
        </div>
    `;
}

// Fechar modal de feedbacks do colaborador
function closeEmployeeFeedbacksModal() {
    const modal = document.getElementById('employee-feedbacks-modal');
    if (modal) {
        // Remover event listener do ESC se existir
        if (modal._escHandler) {
            document.removeEventListener('keydown', modal._escHandler);
        }
        modal.remove();
    }
}

// Visualizar chat de feedback do colaborador (somente leitura)
async function viewEmployeeFeedbackChat(feedbackId) {
    try {
        // Não fechar o modal de histórico de feedbacks
        
        // Usar o sistema de chat existente, mas em modo somente leitura
        if (window.feedbackChat) {
            // Marcar como modo gestor (somente leitura)
            window.feedbackChat.isManagerMode = true;
            await window.feedbackChat.openChat(feedbackId);
        } else {
            console.error('Sistema de chat não disponível');
        }
    } catch (error) {
        console.error('Erro ao abrir chat do feedback:', error);
    }
}

// ===== FUNÇÕES PARA RELATÓRIOS E ANÁLISES =====

// Carregar todos os dados de analytics
async function loadAnalyticsData() {
    await Promise.all([
        loadAnalytics(),
        loadAnalyticsFilters()
    ]);
}

// Carregar filtros de analytics
async function loadAnalyticsFilters() {
    try {
        const response = await fetch('/api/analytics/departments-list');
        if (response.ok) {
            const departments = await response.json();
            console.log('📁 Departamentos recebidos da API:', departments);
            const departmentSelect = document.getElementById('analytics-department');

            if (departmentSelect) {
                departmentSelect.innerHTML = '<option value="">Todos</option>';
                departments.forEach(dept => {
                    // Suportar tanto string quanto objeto
                    const codigo = typeof dept === 'string' ? dept : dept.codigo;
                    const descricao = typeof dept === 'string' ? dept : dept.descricao;
                    console.log('📁 Adicionando departamento:', { codigo, descricao });
                    departmentSelect.innerHTML += `<option value="${codigo}">${descricao}</option>`;
                });
            }
        }
    } catch (error) {
        console.error('Erro ao carregar filtros de analytics:', error);
    }
}

async function loadAnalytics() {
    try {
        const period = document.getElementById('analytics-period').value;
        const department = document.getElementById('analytics-department').value;

        console.log('🔧 Filtros aplicados:', { period, department });

        const queryParams = new URLSearchParams({ period });
        if (department && department !== '' && department !== 'undefined') {
            queryParams.append('department', department);
        }

        const response = await fetch(`/api/analytics/comprehensive?${queryParams}`);
        if (response.ok) {
            const analytics = await response.json();
            console.log('📊 Dados de analytics recebidos:', analytics);
            updateAnalytics(analytics);
        } else {
            console.error('❌ Erro na resposta de analytics:', response.status);
            // Fallback para API antiga se a nova não existir
            const fallbackResponse = await fetch(`/api/analytics?${queryParams}`);
            if (fallbackResponse.ok) {
                const analytics = await fallbackResponse.json();
                console.log('📊 Usando dados de fallback:', analytics);
                updateAnalytics(analytics);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar análises:', error);
    }
}

// Carregar análise temporal
async function loadTemporalAnalysis() {
    try {
        const period = document.getElementById('analytics-period').value;
        const department = document.getElementById('analytics-department').value;

        console.log('📈 Carregando análise temporal com filtros:', { period, department });

        const queryParams = new URLSearchParams({ period });
        if (department && department !== '' && department !== 'undefined') {
            queryParams.append('department', department);
        }

        const response = await fetch(`/api/analytics/temporal?${queryParams}`);
        if (response.ok) {
            const temporalData = await response.json();
            console.log('📈 Dados temporais recebidos:', temporalData);
            console.log('📈 moodData length:', temporalData.moodData ? temporalData.moodData.length : 'undefined');
            console.log('📈 dailyMood length:', temporalData.dailyMood ? temporalData.dailyMood.length : 'undefined');
            updateTemporalAnalysis(temporalData);
        } else {
            console.error('❌ Erro na resposta temporal:', response.status);
            // Fallback: mostrar dados básicos
            updateTemporalAnalysis({
                dailyMood: [],
                feedbacks: [],
                recognitions: [],
                message: 'Dados temporais não disponíveis'
            });
        }
    } catch (error) {
        console.error('Erro ao carregar análise temporal:', error);
        // Fallback: mostrar mensagem de erro
        updateTemporalAnalysis({
            dailyMood: [],
            feedbacks: [],
            recognitions: [],
            message: 'Erro ao carregar dados temporais'
        });
    }
}

function updateTemporalAnalysis(data) {
    const temporalContainer = document.getElementById('temporal-analysis');
    if (!temporalContainer) return;

    if (data.message) {
        temporalContainer.innerHTML = `
                    <div style="text-align: center; padding: 20px;">
                        <i class="fas fa-chart-line" style="font-size: 48px; color: #9ca3af; margin-bottom: 10px;"></i>
                        <p style="color: #9ca3af;">${data.message}</p>
                    </div>
                `;
        return;
    }

        // Criar gráfico temporal com dados reais (últimos 3 meses, média semanal)
        let chartHtml = '';
        if (data.moodData && data.moodData.length > 0) {
            // Definir escala fixa de 1 a 5 (não existe humor 0)
            const minValue = 1;
            const maxValue = 5;
            const range = maxValue - minValue;
            const width = 800;
            const height = 300;
            const padding = 60;
            const chartWidth = width - 2 * padding;
            const chartHeight = height - 2 * padding;
            
            // Ícones Font Awesome correspondentes aos valores de humor
            const humorIcons = {
                1: 'fas fa-frown',      // Muito Triste
                2: 'fas fa-meh',        // Triste
                3: 'fas fa-smile',      // Neutro
                4: 'fas fa-laugh',      // Feliz
                5: 'fas fa-grin-stars'  // Muito Feliz
            };
            
            console.log('📊 Dados de humor para renderização:', data.moodData.length, 'semanas');

        // Calcular pontos com garantia de posicionamento correto dentro do gráfico
        const moodDataLength = data.moodData.length;
        const points = data.moodData.map((item, index) => {
            // Evitar divisão por zero: se há apenas 1 ponto, posicionar no centro
            let x;
            if (moodDataLength === 1) {
                x = padding + (chartWidth / 2);
            } else {
                x = padding + (index / (moodDataLength - 1)) * chartWidth;
            }
            
            // Garantir que X fique dentro dos limites do gráfico
            const clampedX = Math.max(padding, Math.min(width - padding, x));
            
            // Garantir que Y esteja dentro dos limites e respeite a escala 0-5
            const normalizedMood = Math.max(minValue, Math.min(maxValue, item.averageMood));
            const y = height - padding - ((normalizedMood - minValue) / range) * chartHeight;
            
            return `${clampedX},${y}`;
        }).join(' ');

        const areaPoints = points + ` ${width - padding},${height - padding} ${padding},${height - padding}`;

        chartHtml = `
                    <div style="text-align: center; margin: 20px 0;">
                        <h4 style="margin-bottom: 20px; color: #374151;">Evolução do Humor - Últimos 3 Meses</h4>
                        <div style="position: relative; display: inline-block;">
                            <svg width="${width}" height="${height}" style="border: 1px solid #e5e7eb; border-radius: 8px;">
                                <!-- Grid lines com ícones de humor (1-5) -->
                                ${Array.from({length: 5}, (_, i) => {
                                    const value = maxValue - i;  // 5, 4, 3, 2, 1
                                    const y = padding + (i / 4) * chartHeight;  // Dividir por 4 pois temos 5 valores (0 a 4 intervalos)
                                    const iconClass = humorIcons[value];
                                    return `
                                        <line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>
                                        <foreignObject x="${padding - 40}" y="${y - 10}" width="30" height="20">
                                            <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; justify-content: center; align-items: center; height: 100%;">
                                                <i class="${iconClass}" style="font-size: 18px; color: #f59e0b;"></i>
                                            </div>
                                        </foreignObject>
                                    `;
                                }).join('')}
                                
                                <!-- Labels do eixo X (semanas) - último 3 meses -->
                                ${moodDataLength > 0 ? 
                                    data.moodData.filter((_, i) => i === 0 || (i === Math.floor(moodDataLength / 2)) || i === moodDataLength - 1)
                                    .map((item, axisIndex) => {
                                        const isFirst = axisIndex === 0;
                                        const isMiddle = axisIndex === 1;
                                        const isLast = axisIndex === 2;
                                        
                                        let actualDataIndex;
                                        if (isFirst) actualDataIndex = 0;
                                        else if (isMiddle) actualDataIndex = Math.floor(moodDataLength / 2);
                                        else if (isLast) actualDataIndex = moodDataLength - 1;
                                        
                                        let labelX;
                                        if (moodDataLength === 1) {
                                            labelX = padding + (chartWidth / 2);
                                        } else {
                                            labelX = padding + (actualDataIndex / (moodDataLength - 1)) * chartWidth;
                                        }
                                        
                                        // Garantir que o label também esteja dentro dos limites
                                        const clampedLabelX = Math.max(padding, Math.min(width - padding, labelX));
                                        
                                        // Valor do label da semana/mês
                                        let labelText = item.week ? `Sem ${item.week}/${item.year}` : `Sem ${axisIndex + 1}`;
                                        
                                        return `
                                            <text x="${clampedLabelX}" y="${height - padding + 20}" text-anchor="middle" font-size="12" fill="#6b7280">
                                                ${labelText}
                                            </text>
                                            <line x1="${clampedLabelX}" y1="${height - padding}" x2="${clampedLabelX}" y2="${height - padding + 5}" stroke="#6b7280" stroke-width="2"/>
                                        `;
                                    }).join('')
                                : ''}
                                
                                <!-- Area chart -->
                                <polyline points="${areaPoints}" fill="url(#gradient)" stroke="none"/>
                                <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="3"/>
                                
                                <!-- Data points with tooltip -->
                                ${data.moodData.map((item, index) => {
                                    // Usar o mesmo cálculo seguro de X que já implementamos
                                    let x;
                                    if (moodDataLength === 1) {
                                        x = padding + (chartWidth / 2);
                                    } else {
                                        x = padding + (index / (moodDataLength - 1)) * chartWidth;
                                    }
                                    
                                    // Garantir que X fique dentro dos limites do gráfico
                                    const clampedX = Math.max(padding, Math.min(width - padding, x));
                                    
                                    // Garantir que Y esteja dentro dos limites e respeite a escala 0-5
                                    const normalizedMood = Math.max(minValue, Math.min(maxValue, item.averageMood));
                                    const y = height - padding - ((normalizedMood - minValue) / range) * chartHeight;
                                    
                                    const weekLabel = `Semana ${item.week}/${item.year}`;
                                    const tooltipText = `📊 ${weekLabel}\\n💭 Média de humor: ${item.averageMood.toFixed(2)}\\n👥 Participantes: ${item.participants}\\n📅 ${new Date(item.weekStart).toLocaleDateString('pt-BR')} - ${new Date(item.weekEnd).toLocaleDateString('pt-BR')}`;
                                    
                                    return `
                                        <circle cx="${clampedX}" cy="${y}" r="6" fill="#3b82f6" stroke="white" stroke-width="3" 
                                                class="chart-point" 
                                                data-tooltip="${tooltipText.replace(/\n/g, '\\n')}"
                                                style="cursor: pointer; transition: r 0.2s;">
                                        </circle>
                                    `;
                                }).join('')}
                                
                                <!-- Gradient definition -->
                        <defs>
                                    <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                        <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:0.3"/>
                                        <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:0"/>
                            </linearGradient>
                        </defs>
                    </svg>
                            
                            <!-- Tooltip -->
                            <div id="chart-tooltip" style="
                                position: absolute;
                                background: rgba(0, 0, 0, 0.8);
                                color: white;
                                padding: 8px 12px;
                                border-radius: 6px;
                                font-size: 12px;
                                pointer-events: none;
                                opacity: 0;
                                transition: opacity 0.2s;
                                z-index: 1000;
                                white-space: pre-line;
                                max-width: 200px;
                            "></div>
                        </div>
                        <p style="margin-top: 10px; font-size: 12px; color: #6b7280;">
                            Média semanal de humor (últimos 3 meses) - Passe o mouse sobre os pontos para detalhes
                        </p>
                    </div>
                `;
    } else {
        chartHtml = `
                    <div style="text-align: center; padding: 40px;">
                        <i class="fas fa-chart-line" style="font-size: 48px; color: #9ca3af; margin-bottom: 10px;"></i>
                        <p style="color: #9ca3af;">Nenhum dado de humor disponível para o período selecionado</p>
                    </div>
                `;
    }

    temporalContainer.innerHTML = chartHtml;
    
    // Adicionar event listeners para tooltip
    setupChartTooltips();
}

function setupChartTooltips() {
    const tooltip = document.getElementById('chart-tooltip');
    const points = document.querySelectorAll('.chart-point');
    
    points.forEach(point => {
        point.addEventListener('mouseenter', (e) => {
            const tooltipText = e.target.getAttribute('data-tooltip');
            tooltip.textContent = tooltipText.replace(/\\n/g, '\n');
            tooltip.style.opacity = '1';
            
            // Destacar o ponto com hover
            e.target.style.r = '8';
            e.target.setAttribute('stroke-width', '4');
        });
        
        point.addEventListener('mousemove', (e) => {
            const rect = e.target.closest('div').getBoundingClientRect();
            tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 40) + 'px';
        });
        
        point.addEventListener('mouseleave', (e) => {
            tooltip.style.opacity = '0';
            
            // Remover destaque no hover
            e.target.style.r = '6';
            e.target.setAttribute('stroke-width', '3');
        });
    });
}

function updateAnalytics(data) {
    console.log('📊 Atualizando indicadores com dados:', data);
    
    // Engajamento Geral
    updateEngagementMetrics(data.engagement);
    
    // Humor da Equipe
    updateMoodMetrics(data.mood);
    
    // Feedbacks e Reconhecimentos
    updateFeedbackMetrics(data.feedback);
    
    // Gamificação
    updateGamificationMetrics(data.gamification);
    
    // Objetivos
    updateObjectivesMetrics(data.objectives);
    
    // Performance da Equipe
    updatePerformanceMetrics(data.performance);
    
    // Top Colaboradores
    updateTopUsersRanking(data.topUsers);
    
    // Carregar análise temporal
    loadTemporalAnalysis();
}

function updateEngagementMetrics(data) {
    const container = document.getElementById('engagement-metrics');
    if (!container || !data) return;
    
    const participationRate = data.participationRate || 0;
    const activeUsers = data.activeUsers || 0;
    const totalUsers = data.totalUsers || 0;
    const moodEntries = data.moodEntries || 0;
    const moodUsers = data.moodUsers || 0;
    const feedbackCount = data.feedbackCount || 0;
    const feedbackUsers = data.feedbackUsers || 0;
    const recognitionCount = data.recognitionCount || 0;
    const recognitionUsers = data.recognitionUsers || 0;
    
    // Determinar cor baseada na taxa
    let rateColor = '#ef4444'; // Vermelho
    if (participationRate >= 75) rateColor = '#10b981'; // Verde
    else if (participationRate >= 50) rateColor = '#f59e0b'; // Amarelo
    
    container.innerHTML = `
        <div style="text-align: center;">
            <h4 style="font-size: 32px; color: ${rateColor}; margin-bottom: 5px;">${participationRate}%</h4>
            <p style="font-weight: 600; margin-bottom: 8px;">Taxa de Engajamento</p>
            
            <div style="background-color: #fef3c7; border-left: 3px solid #f59e0b; padding: 8px; margin: 10px 0; text-align: left; border-radius: 4px;">
                <div style="font-size: 10px; font-weight: 600; color: #d97706; margin-bottom: 4px;">
                    📊 COMO É CALCULADA:
                </div>
                <div style="font-size: 10px; color: #4b5563; line-height: 1.4;">
                    Usuário considerado <strong>engajado</strong> somente se fez <strong style="color: #d97706;">TODAS as 3 ações</strong> no período:<br>
                    ✅ Registrou humor <strong>E</strong><br>
                    ✅ Enviou feedback <strong>E</strong><br>
                    ✅ Enviou reconhecimento
                </div>
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #fbbf24; font-size: 9px; color: #92400e; font-style: italic;">
                    ⚠️ Critério rigoroso: Todas as ações são obrigatórias!
                </div>
            </div>
            
            <p style="font-size: 12px; color: #6b7280; margin-bottom: 10px;">
                <strong style="color: ${rateColor};">${activeUsers}</strong> de <strong>${totalUsers}</strong> usuários engajados
            </p>
        </div>
    `;
}

function updateMoodMetrics(data) {
    const container = document.getElementById('mood-metrics');
    if (!container || !data) return;
    
    const averageMood = data.averageMood || 0;
    const totalEntries = data.totalEntries || 0;
    const positiveMood = data.positiveMood || 0;
    const negativeMood = data.negativeMood || 0;
    
    const moodEmoji = averageMood >= 4 ? '😊' : averageMood >= 3 ? '😐' : '😔';
    
    // Determinar cor baseada na média
    let moodColor = '#ef4444'; // Vermelho
    if (averageMood >= 4) moodColor = '#10b981'; // Verde
    else if (averageMood >= 3) moodColor = '#f59e0b'; // Amarelo
    
    container.innerHTML = `
        <div style="text-align: center;">
            <h4 style="font-size: 32px; color: ${moodColor}; margin-bottom: 5px;">${averageMood.toFixed(1)} ${moodEmoji}</h4>
            <p style="font-weight: 600; margin-bottom: 8px;">Média do Humor</p>
            
            <div style="background-color: #e0f2fe; border-left: 3px solid #0ea5e9; padding: 8px; margin: 10px 0; text-align: left; border-radius: 4px;">
                <div style="font-size: 10px; font-weight: 600; color: #0369a1; margin-bottom: 4px;">
                    📊 COMO É CALCULADA:
                </div>
                <div style="font-size: 10px; color: #4b5563; line-height: 1.4;">
                    Média simples de todos os registros de humor no período (escala de 1 a 5).
                </div>
            </div>
            
            <p style="font-size: 12px; color: #6b7280; margin-bottom: 26px;">
                ${totalEntries} registro${totalEntries !== 1 ? 's' : ''} no período
            </p>
            
            <div style="margin-top: 10px; font-size: 11px; color: #6b7280; text-align: left; padding: 0 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 4px 0; border-bottom: 1px solid #e5e7eb;">
                    <span>😊 Positivos (4-5):</span>
                    <strong style="color: #10b981;">${positiveMood}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                    <span>😔 Negativos (1-2):</span>
                    <strong style="color: #ef4444;">${negativeMood}</strong>
                </div>
            </div>
        </div>
    `;
}

function updateFeedbackMetrics(data) {
    const container = document.getElementById('feedback-metrics');
    if (!container || !data) return;
    
    const totalFeedbacks = data.totalFeedbacks || 0;
    const totalRecognitions = data.totalRecognitions || 0;
    const positiveFeedbacks = data.positiveFeedbacks || 0;
    const constructiveFeedbacks = data.constructiveFeedbacks || 0;
    const suggestionFeedbacks = data.suggestionFeedbacks || 0;
    const otherFeedbacks = data.otherFeedbacks || 0;
    
    container.innerHTML = `
        <div style="text-align: center;">
            <div style="display: flex; justify-content: center; align-items: baseline; gap: 15px; margin-bottom: 5px;">
                <div>
                    <h4 style="font-size: 32px; color: #3b82f6; margin: 0;">${totalFeedbacks}</h4>
                    <p style="font-size: 11px; color: #6b7280; margin: 0;">Feedbacks</p>
                </div>
                <div>
                    <h4 style="font-size: 32px; color: #8b5cf6; margin: 0;">${totalRecognitions}</h4>
                    <p style="font-size: 11px; color: #6b7280; margin: 0;">Reconhecimentos</p>
                </div>
            </div>
            <p style="font-weight: 600; margin-bottom: 8px;">Feedbacks & Reconhecimentos</p>
            
            <div style="background-color: #ede9fe; border-left: 3px solid #8b5cf6; padding: 8px; margin: 10px 0; text-align: left; border-radius: 4px;">
                <div style="font-size: 10px; font-weight: 600; color: #6b21a8; margin-bottom: 4px;">
                    📊 COMO É CALCULADO:
                </div>
                <div style="font-size: 10px; color: #4b5563; line-height: 1.4;">
                    <strong>Feedbacks:</strong> Total de feedbacks enviados (tipos: Positivo, Desenvolvimento, Sugestão, Outros).<br>
                    <strong>Reconhecimentos:</strong> Total de reconhecimentos/badges enviados.
                </div>
            </div>
            
            <div style="margin-top: 10px; font-size: 11px; color: #6b7280; text-align: left; padding: 0 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 4px 0; border-bottom: 1px solid #e5e7eb;">
                    <span>💬 Tipo "Positivo":</span>
                    <strong style="color: #10b981;">${positiveFeedbacks}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 4px 0; border-bottom: 1px solid #e5e7eb;">
                    <span>📈 Tipo "Desenvolvimento":</span>
                    <strong style="color: #f59e0b;">${constructiveFeedbacks}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; padding: 4px 0; border-bottom: 1px solid #e5e7eb;">
                    <span>💡 Tipo "Sugestão":</span>
                    <strong style="color: #3b82f6;">${suggestionFeedbacks}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                    <span>📝 Tipo "Outros":</span>
                    <strong style="color: #6b7280;">${otherFeedbacks}</strong>
                </div>
            </div>
        </div>
    `;
}

function updateGamificationMetrics(data) {
    const container = document.getElementById('gamification-metrics');
    if (!container || !data) return;
    
    const totalPoints = data.totalPoints || 0;
    const activeUsers = data.activeUsers || 0;
    const topUser = data.topUser || null;
    const badgesEarned = data.badgesEarned || 0;
    
    container.innerHTML = `
        <div style="text-align: center;">
            <h4 style="font-size: 32px; color: #8b5cf6;">${totalPoints.toLocaleString()}</h4>
            <p>Pontos Totais</p>
            <p style="font-size: 12px; color: #9ca3af;">
                ${activeUsers} usuários ativos
            </p>
            <div style="margin-top: 8px; font-size: 11px; color: #6b7280;">
                <div>Badges conquistados: ${badgesEarned}</div>
                ${topUser ? `<div>Top: ${topUser.name} (${topUser.points} pts)</div>` : ''}
            </div>
        </div>
    `;
}

function updateObjectivesMetrics(data) {
    const container = document.getElementById('objectives-metrics');
    if (!container || !data) return;
    
    const totalObjectives = data.totalObjectives || 0;
    const completedObjectives = data.completedObjectives || 0;
    const inProgressObjectives = data.inProgressObjectives || 0;
    const completionRate = totalObjectives > 0 ? Math.round((completedObjectives / totalObjectives) * 100) : 0;
    
    container.innerHTML = `
        <div style="text-align: center;">
            <h4 style="font-size: 32px; color: #10b981;">${completionRate}%</h4>
            <p>Taxa de Conclusão</p>
            <p style="font-size: 12px; color: #9ca3af;">
                ${completedObjectives} de ${totalObjectives} objetivos
            </p>
            <div style="margin-top: 8px; font-size: 11px; color: #6b7280;">
                <div>Em andamento: ${inProgressObjectives}</div>
                <div>Concluídos: ${completedObjectives}</div>
            </div>
        </div>
    `;
}

function updatePerformanceMetrics(data) {
    const container = document.getElementById('performance-metrics');
    if (!container) return;
    
    if (!data || data.totalEvaluations === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #9ca3af;">
                <i class="fas fa-chart-line" style="font-size: 48px; margin-bottom: 10px;"></i>
                <p>Nenhum dado de performance disponível</p>
            </div>
        `;
        return;
    }
    
    const averageScore = data.averageScore || 0;
    const highPerformers = data.highPerformers || 0;
    const improvementNeeded = data.improvementNeeded || 0;
    const totalEvaluations = data.totalEvaluations || 0;
    
    container.innerHTML = `
        <div style="text-align: center;">
            <h4 style="font-size: 32px; color: #06b6d4;">${averageScore.toFixed(1)}%</h4>
            <p>Score Médio da Equipe</p>
            <p style="font-size: 12px; color: #9ca3af;">
                ${totalEvaluations} avaliação(ões)
            </p>
            <div style="margin-top: 8px; font-size: 11px; color: #6b7280;">
                <div style="color: #10b981;">Alto desempenho: ${highPerformers}</div>
                <div style="color: #f59e0b;">Necessita melhoria: ${improvementNeeded}</div>
            </div>
        </div>
    `;
}

function updateTopUsersRanking(data) {
    const container = document.getElementById('top-users-ranking');
    if (!container || !data) return;
    
    if (data.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #9ca3af;">
                <i class="fas fa-trophy" style="font-size: 48px; margin-bottom: 10px;"></i>
                <p>Nenhum dado disponível</p>
            </div>
        `;
        return;
    }
    
    const rankingHtml = data.map((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const points = user.points || 0;
        const name = user.name || 'Usuário';
        const department = user.department || '';
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #e5e7eb;">
                <div style="display: flex; align-items: center;">
                    <span style="font-size: 20px; margin-right: 12px;">${medal}</span>
                    <div>
                        <div style="font-weight: 600; color: #374151;">${name}</div>
                        <div style="font-size: 12px; color: #6b7280;">${department}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; color: #8b5cf6;">${points.toLocaleString()}</div>
                    <div style="font-size: 12px; color: #6b7280;">pontos</div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `
        <div style="max-height: 400px; overflow-y: auto;">
            ${rankingHtml}
        </div>
    `;
}

async function exportReport(format) {
    try {
        // Buscar valores dos filtros (analytics-type não existe na interface)
        const periodElement = document.getElementById('analytics-period');
        const departmentElement = document.getElementById('analytics-department');
        
        const period = periodElement ? periodElement.value : '30';
        const department = departmentElement ? departmentElement.value : '';

        if (format === 'pdf') {
            // Para PDF, capturar a tela filtrada como print
            exportPDFReport(period, department);
        } else {
            // Para Excel/CSV, buscar dados da API
            console.log(`📊 Exportando ${format} com filtros:`, { period, department });
            
            const queryParams = new URLSearchParams({
                period,
                department: department || 'Todos',
                format
            });

            try {
                const response = await fetch(`/api/analytics/export?${queryParams}`);
                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    
                    // Usar nome do arquivo retornado pelo servidor (extrair do header Content-Disposition)
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let fileName = `relatorio_analytics_${period}days_${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : format === 'excel' ? 'xlsx' : 'txt'}`;
                    
                    if (contentDisposition) {
                        const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=["']?([^"'\n]*)["']?/);
                        if (fileNameMatch && fileNameMatch[1]) {
                            fileName = fileNameMatch[1].replace(/['"]/g, '');
                        }
                    }
                    
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    
                    const formatName = format === 'excel' ? 'Excel (.XLSX)' : format.toUpperCase();
                    alert(`✅ Relatório ${formatName} exportado com sucesso!\n\n📊 Período: ${period} dias\n🏢 Departamento: ${department || 'Todos'}\n📁 Arquivo: ${fileName}\n\n${format === 'excel' ? '✨ Arquivo Excel com formatação completa, cores e bordas!' : ''}`);
                } else {
                    const errorText = await response.text();
                    console.error('❌ Erro na resposta da API:', response.status, errorText);
                    alert(`Erro ao exportar relatório ${format.toUpperCase()}:\nStatus: ${response.status}\nTente novamente ou contate o administrador.`);
                }
            } catch (fetchError) {
                console.error('❌ Erro na requisição:', fetchError);
                alert(`Erro ao conectar com o servidor para exportação ${format.toUpperCase()}. Verifique sua conexão e tente novamente.`);
            }
        }
    } catch (error) {
        console.error('Erro ao exportar relatório:', error);
        alert('Erro ao exportar relatório. Tente novamente.');
    }
}

// Função para exportar PDF como print da tela filtrada
function exportPDFReport(period, department) {
    try {
        // Capturar a seção de analytics atual
        const analyticsContent = document.getElementById('analytics-content');
        if (!analyticsContent) {
            alert('Erro: não foi possível encontrar o conteúdo dos relatórios');
            return;
        }

        // Criar uma janela de impressão focada no conteúdo dos relatórios
        const printContent = analyticsContent.innerHTML;
        
        // Adicionar informações dos filtros aplicados
        const reportInfo = `
            <div style="padding: 20px; border-bottom: 2px solid #e5e7eb; margin-bottom: 20px;">
                <h1 style="color: #3b82f6; margin: 0 0 10px 0;">📊 Relatório de Análises - LumiGente</h1>
                <div style="font-size: 14px; color: #6b7280;">
                    <p><strong>Período:</strong> ${period} dias</p>
                    <p><strong>Departamento:</strong> ${department || 'Todos'}</p>
                    <p><strong>Gerado em:</strong> ${new Date().toLocaleString('pt-BR')}</p>
                </div>
            </div>
        `;

        // HTML completo para print
        const fullHtmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Relatório de Análises - LumiGente</title>
                <style>
                    @media print {
                        body { margin: 0; }
                        .btn, button { display: none !important; }
                        .analytics-filters { margin-bottom: 20px; }
                        .card { border: 1px solid #ddd; margin: 10px 0; page-break-inside: avoid; }
                        h3 { color: #3b82f6; }
                        .loading { display: none !important; }
                        * { color: black !important; background: white !important; }
                        @page { margin: 0.5in; }
                    }
                    body { 
                        font-family: Arial, sans-serif; 
                        margin: 20px; 
                        line-height: 1.4; 
                        color: #333;
                    }
                    .header-info {
                        background: #f8fafc;
                        padding: 15px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                    }
                </style>
            </head>
            <body>
                ${reportInfo}
                <div class="analytics-report-content">
                    ${printContent}
                </div>
            </body>
            </html>
        `;

        // Criar nova janela de impressão
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        
        if (!printWindow) {
            alert('Por favor, permita pop-ups para este site para exportar o PDF.');
            return;
        }

        printWindow.document.write(fullHtmlContent);
        printWindow.document.close();
        
        // Aguardar carregamento e imprimir
        printWindow.onload = function() {
            setTimeout(() => {
                printWindow.print();
                printWindow.close();
            }, 500);
        };

    } catch (error) {
        console.error('Erro ao exportar PDF:', error);
        alert('Erro ao exportar PDF. Tente novamente.');
    }
}

function getTypeName(type) {
    const types = {
        'engagement': 'Engajamento',
        'performance': 'Desempenho',
        'feedback': 'Feedbacks',
        'mood': 'Humor'
    };
    return types[type] || type;
}

// Função para gerar PDF com indicadores visuais (manter compatibilidade)
function generatePDFReport(data) {
    // Criar um canvas para renderizar o gráfico
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 400;
    
    // Desenhar o gráfico no canvas
    drawChartOnCanvas(ctx, canvas.width, canvas.height, data.temporal);
    
    // Converter canvas para imagem
    const chartImage = canvas.toDataURL('image/png');
    
    // Criar HTML para o PDF
    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Relatório de Análises</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .header { text-align: center; margin-bottom: 30px; }
                .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
                .metric-card { border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
                .chart-section { text-align: center; margin: 30px 0; }
                .chart-image { max-width: 100%; height: auto; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Relatório de Análises - LumiGente</h1>
                <p>Período: ${data.period} dias | Departamento: ${data.department}</p>
                <p>Gerado em: ${new Date(data.generatedAt).toLocaleString('pt-BR')}</p>
            </div>
            
            <div class="metrics">
                <div class="metric-card">
                    <h3>Participação</h3>
                    <p><strong>Total de usuários:</strong> ${data.analytics.participation.totalUsers}</p>
                    <p><strong>Com humor:</strong> ${data.analytics.participation.usersWithMood}</p>
                    <p><strong>Com feedback:</strong> ${data.analytics.participation.usersWithFeedback}</p>
                    <p><strong>Com reconhecimento:</strong> ${data.analytics.participation.usersWithRecognition}</p>
                </div>
                
                <div class="metric-card">
                    <h3>Satisfação</h3>
                    <p><strong>Média de humor:</strong> ${(data.analytics.satisfaction.averageMood || 0).toFixed(1)}</p>
                    <p><strong>Promotores:</strong> ${data.analytics.satisfaction.promoters || 0}</p>
                    <p><strong>Detratores:</strong> ${data.analytics.satisfaction.detractors || 0}</p>
                    <p><strong>Total de respostas:</strong> ${data.analytics.satisfaction.totalResponses || 0}</p>
                </div>
            </div>
            
            <div class="chart-section">
                <h3>Evolução do Humor - Últimos 3 Meses</h3>
                <img src="${chartImage}" alt="Gráfico de evolução do humor" class="chart-image">
            </div>
        </body>
        </html>
    `;
    
    // Abrir em nova janela para impressão
    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    // Aguardar o carregamento da imagem e imprimir
    printWindow.onload = function() {
        setTimeout(() => {
            printWindow.print();
        }, 1000);
    };
}

// Função para desenhar o gráfico no canvas
function drawChartOnCanvas(ctx, width, height, temporalData) {
    if (!temporalData || temporalData.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Nenhum dado disponível', width / 2, height / 2);
        return;
    }
    
    const padding = 60;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;
    
    // Usar escala fixa de 0 a 5
    const minValue = 0;
    const maxValue = 5;
    const range = maxValue - minValue;
    
    // Desenhar grid com escala 0-5
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding + (i / 5) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
        
        // Labels do eixo Y
        const value = maxValue - (i / 5) * range;
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        ctx.fillText(value.toFixed(1), padding - 10, y + 4);
    }
    
    // Desenhar linha do gráfico
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    
    temporalData.forEach((item, index) => {
        const x = padding + (index / (temporalData.length - 1)) * chartWidth;
        const y = height - padding - ((item.averageMood - minValue) / range) * chartHeight;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Desenhar pontos
    ctx.fillStyle = '#3b82f6';
    temporalData.forEach((item, index) => {
        const x = padding + (index / (temporalData.length - 1)) * chartWidth;
        const y = height - padding - ((item.averageMood - minValue) / range) * chartHeight;
        
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, 2 * Math.PI);
        ctx.fill();
    });
    
    // Título
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Evolução do Humor - Últimos 3 Meses', width / 2, 30);
}

// ===== FUNÇÕES PARA CONFIGURAÇÕES =====

async function loadProfileSettings() {
    try {
        const response = await fetch('/api/usuario');
        if (response.ok) {
            const user = await response.json();

            document.getElementById('profile-name').value = user.nomeCompleto || '';
            document.getElementById('profile-nickname').value = user.nome || '';
            document.getElementById('profile-department').value = user.departamento || '';
        }
    } catch (error) {
        console.error('Erro ao carregar perfil:', error);
    }
}

async function updateProfile() {
    try {
        const name = document.getElementById('profile-name').value;
        const nickname = document.getElementById('profile-nickname').value;
        const department = document.getElementById('profile-department').value;

        const response = await fetch('/api/usuario/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nomeCompleto: name,
                nome: nickname,
                departamento: department
            })
        });

        if (response.ok) {
            alert('Perfil atualizado com sucesso!');
            loadProfileSettings();
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao atualizar perfil');
        }
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);
        alert('Erro ao atualizar perfil');
    }
}

async function changePassword() {
    try {
        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            alert('Todos os campos são obrigatórios');
            return;
        }

        if (newPassword !== confirmPassword) {
            alert('As senhas não coincidem');
            return;
        }

        if (newPassword.length < 6) {
            alert('A nova senha deve ter pelo menos 6 caracteres');
            return;
        }

        const response = await fetch('/api/usuario/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });

        if (response.ok) {
            alert('Senha alterada com sucesso!');
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao alterar senha');
        }
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        alert('Erro ao alterar senha');
    }
}

async function saveNotificationPreferences() {
    try {
        const preferences = {
            feedback: document.getElementById('notify-feedback').checked,
            recognition: document.getElementById('notify-recognition').checked,
            objectives: document.getElementById('notify-objectives').checked,
            surveys: document.getElementById('notify-surveys').checked
        };

        const response = await fetch('/api/usuario/notifications', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preferences)
        });

        if (response.ok) {
            alert('Preferências salvas com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao salvar preferências');
        }
    } catch (error) {
        console.error('Erro ao salvar preferências:', error);
        alert('Erro ao salvar preferências');
    }
}

async function savePrivacySettings() {
    try {
        const settings = {
            profileVisible: document.getElementById('profile-visible').checked,
            showDepartment: document.getElementById('show-department').checked,
            showPosition: document.getElementById('show-position').checked
        };

        const response = await fetch('/api/usuario/privacy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (response.ok) {
            alert('Configurações salvas com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao salvar configurações');
        }
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        alert('Erro ao salvar configurações');
    }
}

function showObjetivoDetails(objetivo) {
    // Formatar datas sem conversão de timezone
    const dataInicio = formatarDataParaExibicao(objetivo.data_inicio);
    const dataFim = formatarDataParaExibicao(objetivo.data_fim);
    const progresso = objetivo.progresso_atual || 0;

    let detalhesHTML = `
                <div style="padding: 20px;">
                    <h3>${objetivo.titulo}</h3>
                    <p><strong>Descrição:</strong> ${objetivo.descricao || 'Sem descrição'}</p>
                    <p><strong>Responsável:</strong> ${objetivo.responsavel_nome}</p>
                    <p><strong>Departamento:</strong> ${objetivo.departamento}</p>
                    <p><strong>Unidade:</strong> ${objetivo.unidade}</p>
                    <p><strong>Período:</strong> ${dataInicio} - ${dataFim}</p>
                    <p><strong>Tipo:</strong> ${objetivo.tipo}</p>
                    <p><strong>Prioridade:</strong> ${objetivo.prioridade}</p>
                    <p><strong>Status:</strong> ${objetivo.status}</p>
                    <p><strong>Progresso Atual:</strong> ${progresso}%</p>
                </div>
            `;

    // Criar modal temporário para mostrar detalhes
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
                <div class="modal">
                    <div class="modal-content">
                        <h3><i class="fas fa-eye"></i> Detalhes do Objetivo</h3>
                        <div style="max-height: 400px; overflow-y: auto;">
                            ${detalhesHTML}
                        </div>
                        <div class="modal-actions">
                            <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            `;
    document.body.appendChild(modal);
}

// ===== INICIALIZAÇÃO DAS NOVAS FUNCIONALIDADES =====

// Adicionar chamadas para carregar dados quando as abas são acessadas
document.addEventListener('DOMContentLoaded', () => {
    // Carregar configurações de perfil quando a aba de configurações for acessada
    const settingsTab = document.querySelector('[data-tab="settings"]');
    if (settingsTab) {
        settingsTab.addEventListener('click', () => {
            loadProfileSettings();
        });
    }
});

// ===== SISTEMA DE NOTIFICAÇÕES ELEGANTES =====

// Função global para mostrar notificação de pontos ganhos
function showPointsNotification(pointsEarned, action = '') {
    // Remover notificação existente se houver
    const existingNotification = document.querySelector('.points-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Criar notificação
    const notification = document.createElement('div');
    notification.className = 'points-notification show';
    
    const actionText = action ? ` por ${action}` : '';
    notification.innerHTML = `
        <div class="points-notification-content">
            <div class="points-notification-icon">
                <i class="fas fa-star"></i>
            </div>
            <div class="points-notification-text">
                <div class="points-notification-title">Pontos Ganhos!</div>
                <div class="points-notification-message">+${pointsEarned} pontos${actionText}</div>
            </div>
            <button class="points-notification-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    // Adicionar ao body
    document.body.appendChild(notification);

    // Auto-remover após 5 segundos
    setTimeout(() => {
        if (notification && notification.parentElement) {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification && notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }
    }, 5000);
}

// Função global para mostrar notificação de sucesso
function showSuccessNotification(message) {
    showGenericNotification(message, 'success', 'fas fa-check-circle');
}

// Função global para mostrar notificação de informação
function showInfoNotification(message) {
    showGenericNotification(message, 'info', 'fas fa-info-circle');
}

// Função global para mostrar notificação de erro
function showErrorNotification(message) {
    showGenericNotification(message, 'error', 'fas fa-exclamation-circle');
}

// Função genérica para criar notificações
function showGenericNotification(message, type, icon) {
    // Remover notificação existente se houver
    const existingNotification = document.querySelector('.generic-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Definir cores baseadas no tipo
    const colors = {
        success: { bg: '#10b981', icon: '#ffffff' },
        info: { bg: '#3b82f6', icon: '#ffffff' },
        error: { bg: '#ef4444', icon: '#ffffff' }
    };

    const color = colors[type] || colors.info;

    // Criar notificação
    const notification = document.createElement('div');
    notification.className = 'generic-notification show';
    notification.style.background = `linear-gradient(135deg, ${color.bg}, ${color.bg}dd)`;
    notification.style.color = 'white';
    
    notification.innerHTML = `
        <div class="points-notification-content">
            <div class="points-notification-icon" style="background: rgba(255, 255, 255, 0.2);">
                <i class="${icon}" style="color: ${color.icon};"></i>
            </div>
            <div class="points-notification-text">
                <div class="points-notification-title">${type === 'success' ? 'Sucesso!' : type === 'error' ? 'Erro!' : 'Informação'}</div>
                <div class="points-notification-message">${message}</div>
            </div>
            <button class="points-notification-close" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    // Adicionar ao body
    document.body.appendChild(notification);

    // Auto-remover após 4 segundos
    setTimeout(() => {
        if (notification && notification.parentElement) {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification && notification.parentElement) {
                    notification.remove();
                }
            }, 300);
        }
    }, 4000);
}