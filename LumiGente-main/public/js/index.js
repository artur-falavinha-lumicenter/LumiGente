// Global variables
let currentUser;
let users = [];
let selectedBadge = null;
let currentEvaluation = null;
let activeFilters = { type: null, category: null };
let searchTimeout = null;
let currentFeedbackTab = 'received'; // Nova variável para controlar a aba ativa
let selectedHumorScore = null;
let currentObjetivo = null;
let activeObjetivosFilters = { departamento: null, status: null, tipo: null };
let currentPesquisa = null;
let selectedPesquisaResposta = null;
let activePesquisasFilters = { status: null, tipo: null };

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
        if (input) input.value = input.placeholder || '';
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

            if (tab === 'feedback') {
                currentFeedbackTab = 'received'; // Reset to received tab
                document.querySelectorAll('.feedback-tab').forEach(tabEl => {
                    tabEl.classList.remove('active');
                });
                document.querySelector('[data-feedback-tab="received"]').classList.add('active');
                loadFeedbacks();
                loadFilters();
            } else if (tab === 'team') {
                loadTeamData();
                loadPendingEvaluations();
            } else if (tab === 'analytics') {
                loadAnalyticsData();
            } else if (tab === 'recognition') {
                loadMyRecognitions();
            } else if (tab === 'humor') {
                loadHumorData();
            } else if (tab === 'objetivos') {
                loadObjetivos();
                loadObjetivosFilters();
            } else if (tab === 'pesquisas') {
                loadPesquisas();
                loadPesquisasFilters();
                checkPesquisaPermissions();
            }
        });
    });



    // ESC key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const objetivoModal = document.getElementById('objetivo-modal');
            const feedbackModal = document.getElementById('feedback-modal');
            const recognitionModal = document.getElementById('recognition-modal');
            const checkinModal = document.getElementById('checkin-modal');

            if (objetivoModal && !objetivoModal.classList.contains('hidden')) {
                closeObjetivoModal();
            } else if (feedbackModal && !feedbackModal.classList.contains('hidden')) {
                closeFeedbackModal();
            } else if (recognitionModal && !recognitionModal.classList.contains('hidden')) {
                closeRecognitionModal();
            } else if (checkinModal && !checkinModal.classList.contains('hidden')) {
                closeCheckinModal();
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

    document.getElementById('pesquisa-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closePesquisaModal();
        }
    });

    document.getElementById('responder-pesquisa-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeResponderPesquisaModal();
        }
    });



    document.getElementById('checkin-modal').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeCheckinModal();
        }
    });

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

// Setup sidebar access based on user hierarchy
function setupSidebarAccess() {
    if (!currentUser) return;

    const hierarchyLevel = currentUser.hierarchyLevel || 0;
    const isAdmin = currentUser.role === 'Administrador' || currentUser.is_admin;

    // Define access rules based on hierarchy level
    let allowedTabs = [];

    if (isAdmin) {
        // Administrador: acesso total
        allowedTabs = ['dashboard', 'feedback', 'recognition', 'team', 'analytics', 'humor', 'objetivos', 'pesquisas', 'settings'];
    } else if (hierarchyLevel >= 1) {
        // Gestor de Equipe (Level 1+): acesso a equipe e relatórios
        allowedTabs = ['dashboard', 'feedback', 'recognition', 'team', 'analytics', 'humor', 'objetivos', 'pesquisas'];
    } else {
        // Colaborador (Level 0): acesso restrito
        allowedTabs = ['dashboard', 'feedback', 'recognition', 'humor', 'objetivos', 'pesquisas'];
    }

    // Hide/show sidebar items based on access
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        const tabName = item.dataset.tab;
        if (allowedTabs.includes(tabName)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });

    // If current active tab is not allowed, switch to dashboard
    const activeTab = document.querySelector('.nav-item.active');
    if (activeTab && !allowedTabs.includes(activeTab.dataset.tab)) {
        // Switch to dashboard
        const dashboardTab = document.querySelector('[data-tab="dashboard"]');
        if (dashboardTab) {
            dashboardTab.click();
        }
    }

    console.log(`Sidebar configurado para usuário Level ${hierarchyLevel} (${isAdmin ? 'Admin' : 'Usuário'}). Tabs permitidos:`, allowedTabs);
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
        loadEvaluations(),
        loadUserRankings(),
        loadGamificationData(),
        checkPesquisaPermissions()
    ]);

    // Carregar dados específicos baseado na aba ativa
    const activeTab = document.querySelector('.tab-content:not(.hidden)');
    if (activeTab) {
        const tabId = activeTab.id;
        if (tabId === 'team-content') {
            await loadTeamData();
            await loadPendingEvaluations();
        } else if (tabId === 'analytics-content') {
            await loadAnalyticsData();
        }
    }

    // Mostrar botão de criar avaliação para gestores
    if (currentUser && currentUser.hierarchyLevel >= 3) {
        const createEvaluationBtn = document.getElementById('create-evaluation-btn');
        if (createEvaluationBtn) {
            createEvaluationBtn.style.display = 'inline-block';
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

            // Update changes
            updateMetricChange('feedbacks-change', metrics.changes.feedbacks);
            updateMetricChange('recognitions-change', metrics.changes.recognitions);
            updateMetricChange('participation-change', metrics.changes.participation);
            updateMetricChange('score-change', metrics.changes.avgScore);
        }
    } catch (error) {
        console.error('Erro ao carregar métricas:', error);
    }
}

function updateMetricChange(elementId, change) {
    const element = document.getElementById(elementId);
    const isPositive = change >= 0;
    const icon = isPositive ? 'fas fa-trending-up' : 'fas fa-trending-down';
    const text = isPositive ? `+${change}` : `${change}`;

    element.className = `metric-change ${isPositive ? '' : 'negative'}`;
    element.innerHTML = `
                <i class="${icon}"></i>
                ${text}% vs mês anterior
            `;
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
                const departamento = user.departamento || user.Departamento || 'Departamento não informado';
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
                const departamento = user.departamento || user.Departamento || 'Departamento não informado';
                recognitionList.innerHTML += `<div class="select-option" data-value="${user.userId}" onclick="selectUser('${user.userId}', '${nomeCompleto} - ${departamento}', 'recognition-to-user')">${nomeCompleto} - ${departamento}</div>`;
            }
        });
    }

    // Atualizar dropdown pesquisável de objetivo
    if (objetivoList) {
        objetivoList.innerHTML = '<div class="select-option" data-value="" onclick="selectUser(\'\', \'Selecionar responsável...\', \'objetivo-responsavel\')">Selecionar responsável...</div>';
        users.forEach(user => {
            const nomeCompleto = user.nomeCompleto || user.NomeCompleto || 'Nome não informado';
            const departamento = user.departamento || user.Departamento || 'Departamento não informado';
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
        searchInput.value = text;
    }

    list.classList.remove('show');
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

// Load recognitions for dashboard (only received ones, last 3)
async function loadRecognitions() {
    try {
        const response = await fetch('/api/recognitions');
        if (response.ok) {
            const recognitions = await response.json();
            updateRecognitionsList(recognitions.slice(0, 3));
        }
    } catch (error) {
        console.error('Erro ao carregar reconhecimentos:', error);
    }
}

// Load all recognitions for recognition tab
async function loadMyRecognitions() {
    try {
        const response = await fetch('/api/recognitions/all');
        if (response.ok) {
            const recognitions = await response.json();
            updateMyRecognitionsList(recognitions);
        }
    } catch (error) {
        console.error('Erro ao carregar meus reconhecimentos:', error);
    }
}

function updateMyRecognitionsList(recognitions) {
    const container = document.getElementById('my-recognitions-list');
    if (!container) return;

    if (recognitions.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum reconhecimento encontrado.</div>';
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
                            <p class="recognition-points">+${recognition.points} pontos • ${new Date(recognition.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                    </div>
                `;
    }).join('');
}

function updateRecognitionsList(recognitions) {
    const container = document.getElementById('recognitions-list');
    if (!container) return;

    if (recognitions.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum reconhecimento encontrado.</div>';
        return;
    }

    container.innerHTML = recognitions.map(recognition => `
                <div class="recognition-item">
                    <div class="recognition-icon">
                        <i class="fas fa-award"></i>
                    </div>
                    <div class="recognition-content">
                        <div class="recognition-header">
                            <strong>${recognition.from_name}</strong>
                            <span>→</span>
                            <span>${recognition.to_name}</span>
                            <span class="recognition-badge">${recognition.badge}</span>
                        </div>
                        <p class="recognition-message">${recognition.message}</p>
                        <p class="recognition-points">+${recognition.points} pontos</p>
                    </div>
                </div>
            `).join('');
}

// Load evaluations
async function loadEvaluations() {
    try {
        const response = await fetch('/api/avaliacoes/pendentes');
        if (response.ok) {
            const evaluations = await response.json();
            updateEvaluationsList(evaluations);
        } else {
            console.error('Erro ao carregar avaliações:', response.statusText);
            document.getElementById('evaluations-list').innerHTML = '<div class="loading">Erro ao carregar avaliações.</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar avaliações:', error);
        document.getElementById('evaluations-list').innerHTML = '<div class="loading">Erro ao carregar avaliações.</div>';
    }
}

// Load user rankings
async function loadUserRankings() {
    try {
        const period = document.getElementById('ranking-period').value;
        const response = await fetch(`/api/analytics/rankings?period=${period}&topUsers=10`);

        if (response.ok) {
            const rankings = await response.json();
            updateRankingsList(rankings);
        } else {
            console.error('Erro ao carregar rankings:', response.statusText);
            document.getElementById('rankings-list').innerHTML =
                '<div class="loading">Erro ao carregar rankings. Tente novamente.</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar rankings:', error);
        document.getElementById('rankings-list').innerHTML =
            '<div class="loading">Erro ao carregar rankings. Tente novamente.</div>';
    }
}

function updateRankingsList(rankings) {
    const container = document.getElementById('rankings-list');
    if (!container) return;

    if (!rankings || rankings.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum ranking disponível.</div>';
        return;
    }

    container.innerHTML = rankings.map((user, index) => {
        const position = index + 1;
        const positionClass = position === 1 ? 'top-1' : position === 2 ? 'top-2' : position === 3 ? 'top-3' : 'other';
        const itemClass = position <= 3 ? `top-${position}` : '';

        return `
                    <div class="ranking-item ${itemClass}">
                        <div class="ranking-position ${positionClass}">
                            ${position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : position}
                        </div>
                        <div class="ranking-user-info">
                            <div class="ranking-user-name">${user.NomeCompleto || user.UserName}</div>
                            <div class="ranking-user-department">${user.Departamento || 'Departamento não informado'}</div>
                        </div>
                        <div class="ranking-stats">
                            <div class="ranking-points">${user.TotalPontos || 0} pts</div>
                            <div class="ranking-lumicoins">${user.LumicoinBalance || 0} Lumicoins</div>
                            <div class="ranking-activities">${user.TotalAtividades || 0} atividades</div>
                        </div>
                    </div>
                `;
    }).join('');
}

// Load gamification data
async function loadGamificationData() {
    try {
        // Carregar dados do usuário atual
        const userResponse = await fetch('/api/gamification/points');
        if (userResponse.ok) {
            const userData = await userResponse.json();
            updateUserGamificationStats(userData);
        }

        // Carregar leaderboard
        const leaderboardResponse = await fetch('/api/analytics/gamification-leaderboard?period=30&topUsers=5');
        if (leaderboardResponse.ok) {
            const leaderboard = await leaderboardResponse.json();
            updateLeaderboardPreview(leaderboard);
        }
    } catch (error) {
        console.error('Erro ao carregar dados de gamificação:', error);
    }
}

function updateUserGamificationStats(userData) {
    const lumicoinsElement = document.getElementById('user-lumicoins');
    const pointsElement = document.getElementById('user-points');

    if (lumicoinsElement) {
        lumicoinsElement.textContent = userData.LumicoinBalance || 0;
    }

    if (pointsElement) {
        pointsElement.textContent = userData.TotalPoints || 0;
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
                            <div class="leaderboard-user-department">${user.Departamento || 'Departamento não informado'}</div>
                        </div>
                        <div class="leaderboard-score">${user.TotalPontos || 0} pts</div>
                    </div>
                `;
    }).join('');
}

// Load pending evaluations
async function loadPendingEvaluations() {
    try {
        const response = await fetch('/api/avaliacoes/pendentes');
        if (response.ok) {
            const evaluations = await response.json();
            updatePendingEvaluationsList(evaluations);
        } else {
            console.error('Erro ao carregar avaliações pendentes:', response.statusText);
            const container = document.getElementById('pending-evaluations');
            if (container) {
                container.innerHTML = '<div class="loading">Erro ao carregar avaliações. Tente novamente.</div>';
            }
        }
    } catch (error) {
        console.error('Erro ao carregar avaliações pendentes:', error);
        const container = document.getElementById('pending-evaluations');
        if (container) {
            container.innerHTML = '<div class="loading">Erro ao carregar avaliações. Tente novamente.</div>';
        }
    }
}

// Update pending evaluations list
function updatePendingEvaluationsList(evaluations) {
    const container = document.getElementById('pending-evaluations');
    if (!container) return;

    if (!evaluations || evaluations.length === 0) {
        container.innerHTML = '<div class="loading">Nenhuma avaliação pendente.</div>';
        return;
    }

    container.innerHTML = evaluations.map(evaluation => `
                <div class="evaluation-item pending" onclick="window.location.href='/responder-avaliacao.html?id=${evaluation.Id}'" style="cursor: pointer;">
                    <div class="evaluation-info">
                        <h4>${evaluation.titulo}</h4>
                        <p>${evaluation.descricao || 'Sem descrição'}</p>
                        <div style="margin-top: 8px; font-size: 14px; color: #6b7280;">
                            <span class="badge badge-category">${evaluation.tipo}</span>
                            <span style="margin-left: 12px;">Prazo: ${new Date(evaluation.data_fim).toLocaleDateString('pt-BR')}</span>
                        </div>
                    </div>
                    <button class="btn btn-amber btn-sm" onclick="event.stopPropagation(); window.location.href='/responder-avaliacao.html?id=${evaluation.Id}'">
                        <i class="fas fa-edit"></i>
                        Responder
                    </button>
                </div>
            `).join('');
}

function updateEvaluationsList(evaluations) {
    const container = document.getElementById('evaluations-list');
    if (!container) return;

    if (evaluations.length === 0) {
        container.innerHTML = '<div class="loading">Nenhuma avaliação pendente.</div>';
        return;
    }

    container.innerHTML = evaluations.map(evaluation => `
                <div class="evaluation-item ${evaluation.status === 'Pendente' ? 'pending' : ''}" onclick="window.location.href='/responder-avaliacao.html?id=${evaluation.Id}'" style="cursor: pointer;">
                    <div class="evaluation-info">
                        <h4>${evaluation.titulo}</h4>
                        <p>${new Date(evaluation.data_fim).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <span class="status-badge status-${evaluation.status.toLowerCase().replace('ê', 'e').replace('ã', 'a')}">${evaluation.status}</span>
                </div>
            `).join('');
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

function openEvaluationModal() {
    document.getElementById('create-evaluation-modal').classList.remove('hidden');
    loadColaboradoresForEvaluation();
    setDefaultDates();
}

function openEvaluationResponseModal(evaluationId) {
    document.getElementById('evaluation-modal').classList.remove('hidden');
    loadEvaluationQuestions(evaluationId);
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
            closeFeedbackModal();
            loadFeedbacks();
            loadMetrics();
            alert('Feedback enviado com sucesso!');
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
            closeRecognitionModal();
            loadRecognitions();
            loadMetrics();
            alert('Reconhecimento enviado com sucesso!');
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
    if (window.feedbackChat) {
        window.feedbackChat.openChat(feedbackId);
    } else {
        console.error('Sistema de chat não carregado');
    }
}

// Evaluation functions
function openEvaluation(evaluationId) {
    currentEvaluation = evaluationId;
    generateEvaluationQuestions();
    document.getElementById('evaluation-modal').classList.remove('hidden');
}

function closeEvaluationModal() {
    document.getElementById('evaluation-modal').classList.add('hidden');
    currentEvaluation = null;
}

function closeCreateEvaluationModal() {
    document.getElementById('create-evaluation-modal').classList.add('hidden');
    clearCreateEvaluationForm();
}

function clearCreateEvaluationForm() {
    document.getElementById('evaluation-title-input').value = '';
    document.getElementById('evaluation-description-input').value = '';
    document.getElementById('evaluation-start-date').value = '';
    document.getElementById('evaluation-end-date').value = '';
    document.getElementById('colaboradores-search').value = '';
    selectedColaboradores = [];
    updateSelectedColaboradores();
    document.getElementById('colaboradores-dropdown').classList.remove('show');
    document.getElementById('evaluation-questions-container').innerHTML = `
                <div class="question-item">
                    <input type="text" class="form-input" placeholder="Digite a pergunta..." data-question-id="1">
                    <select class="form-select" data-question-type="1" onchange="toggleQuestionOptions(this)">
                        <option value="texto">Texto</option>
                        <option value="escala">Escala</option>
                        <option value="sim_nao">Sim/Não</option>
                        <option value="multipla">Múltipla Escolha</option>
                    </select>
                    <div class="question-options" style="display: none; margin-top: 8px;">
                        <div class="escala-config" style="display: none;">
                            <div style="display: flex; gap: 12px;">
                                <div>
                                    <label class="form-label">Mínimo:</label>
                                    <input type="number" class="form-input" value="1" style="width: 80px;">
                                </div>
                                <div>
                                    <label class="form-label">Máximo:</label>
                                    <input type="number" class="form-input" value="5" style="width: 80px;">
                                </div>
                            </div>
                        </div>
                        <div class="multipla-config" style="display: none;">
                            <div class="opcoes-list"></div>
                            <div style="display: flex; gap: 8px; margin-top: 8px;">
                                <input type="text" class="form-input nova-opcao" placeholder="Digite a opção..." style="flex: 1;">
                                <button type="button" class="btn btn-secondary btn-sm" onclick="addOpcao(this)">Adicionar</button>
                            </div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-danger btn-sm" onclick="removeQuestion(this)">Remover</button>
                </div>
            `;
}

function setDefaultDates() {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(today.getDate() + 30);

    document.getElementById('evaluation-start-date').value = today.toISOString().split('T')[0];
    document.getElementById('evaluation-end-date').value = endDate.toISOString().split('T')[0];
}

let allColaboradores = [];
let selectedColaboradores = [];

async function loadColaboradoresForEvaluation() {
    try {
        const response = await fetch('/api/users/feedback');
        if (response.ok) {
            allColaboradores = await response.json();
            setupColaboradoresSearch();
        }
    } catch (error) {
        console.error('Erro ao carregar colaboradores:', error);
    }
}

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

function addQuestion() {
    const container = document.getElementById('evaluation-questions-container');
    const questionCount = container.children.length + 1;

    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    questionDiv.innerHTML = `
                <input type="text" class="form-input" placeholder="Digite a pergunta..." data-question-id="${questionCount}">
                <select class="form-select" data-question-type="${questionCount}" onchange="toggleQuestionOptions(this)">
                    <option value="texto">Texto</option>
                    <option value="escala">Escala</option>
                    <option value="sim_nao">Sim/Não</option>
                    <option value="multipla">Múltipla Escolha</option>
                </select>
                <div class="question-options" style="display: none; margin-top: 8px;">
                    <div class="escala-config" style="display: none;">
                        <div style="display: flex; gap: 12px;">
                            <div>
                                <label class="form-label">Mínimo:</label>
                                <input type="number" class="form-input" value="1" style="width: 80px;">
                            </div>
                            <div>
                                <label class="form-label">Máximo:</label>
                                <input type="number" class="form-input" value="5" style="width: 80px;">
                            </div>
                        </div>
                    </div>
                    <div class="multipla-config" style="display: none;">
                        <div class="opcoes-list"></div>
                        <div style="display: flex; gap: 8px; margin-top: 8px;">
                            <input type="text" class="form-input nova-opcao" placeholder="Digite a opção..." style="flex: 1;">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="addOpcao(this)">Adicionar</button>
                        </div>
                    </div>
                </div>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeQuestion(this)">Remover</button>
            `;

    container.appendChild(questionDiv);
}

function toggleQuestionOptions(selectElement) {
    const questionItem = selectElement.closest('.question-item');
    const optionsContainer = questionItem.querySelector('.question-options');
    const escalaConfig = questionItem.querySelector('.escala-config');
    const multiplaConfig = questionItem.querySelector('.multipla-config');
    const selectedType = selectElement.value;

    // Hide all configs first
    optionsContainer.style.display = 'none';
    escalaConfig.style.display = 'none';
    multiplaConfig.style.display = 'none';

    if (selectedType === 'escala') {
        optionsContainer.style.display = 'block';
        escalaConfig.style.display = 'block';
    } else if (selectedType === 'multipla') {
        optionsContainer.style.display = 'block';
        multiplaConfig.style.display = 'block';
    }
}

function addOpcao(button) {
    const multiplaConfig = button.closest('.multipla-config');
    const input = multiplaConfig.querySelector('.nova-opcao');
    const opcoesList = multiplaConfig.querySelector('.opcoes-list');
    const opcaoText = input.value.trim();

    if (!opcaoText) {
        alert('Digite o texto da opção');
        return;
    }

    const opcaoDiv = document.createElement('div');
    opcaoDiv.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 8px; background: #f9fafb; border-radius: 4px;';
    opcaoDiv.innerHTML = `
                <span style="flex: 1;">${opcaoText}</span>
                <button type="button" class="btn btn-danger btn-sm" onclick="removeOpcao(this)" style="padding: 4px 8px;">×</button>
            `;

    opcoesList.appendChild(opcaoDiv);
    input.value = '';
}

function removeOpcao(button) {
    button.closest('div').remove();
}

function removeQuestion(button) {
    const container = document.getElementById('evaluation-questions-container');
    if (container.children.length > 1) {
        button.parentElement.remove();
    }
}

async function submitCreateEvaluation() {
    const title = document.getElementById('evaluation-title-input').value.trim();
    const description = document.getElementById('evaluation-description-input').value.trim();
    const type = document.getElementById('evaluation-type-input').value;
    const startDate = document.getElementById('evaluation-start-date').value;
    const endDate = document.getElementById('evaluation-end-date').value;

    const colaboradores = selectedColaboradores.map(user => user.userId);

    const questions = [];
    const questionItems = document.querySelectorAll('#evaluation-questions-container .question-item');
    questionItems.forEach((item, index) => {
        const questionText = item.querySelector('input').value.trim();
        const questionType = item.querySelector('select').value;

        if (questionText) {
            questions.push({
                texto: questionText,
                tipo: questionType,
                ordem: index + 1
            });
        }
    });

    if (!title || !type || colaboradores.length === 0 || questions.length === 0) {
        alert('Preencha todos os campos obrigatórios');
        return;
    }

    try {
        const response = await fetch('/api/avaliacoes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo: title,
                descricao: description,
                tipo: type,
                colaboradores: colaboradores,
                dataInicio: startDate,
                dataFim: endDate,
                perguntas: questions
            })
        });

        if (response.ok) {
            closeCreateEvaluationModal();
            loadEvaluations();
            alert('Avaliação criada com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao criar avaliação');
        }
    } catch (error) {
        console.error('Erro ao criar avaliação:', error);
        alert('Erro ao criar avaliação');
    }
}

async function loadEvaluationQuestions(evaluationId) {
    try {
        if (!evaluationId || isNaN(parseInt(evaluationId)) || parseInt(evaluationId) <= 0) {
            console.error('ID da avaliação inválido:', evaluationId);
            alert('Erro: ID da avaliação inválido');
            return;
        }

        const response = await fetch(`/api/avaliacoes/${parseInt(evaluationId)}/perguntas`);
        if (response.ok) {
            const perguntas = await response.json();
            const container = document.getElementById('evaluation-questions');

            container.innerHTML = perguntas.map((pergunta, index) => {
                let questionHTML = `
                            <div class="question-group">
                                <div class="question-text">${pergunta.pergunta}</div>
                        `;

                // Parse configurações JSON se existir
                let config = {};
                if (pergunta.configuracoes) {
                    try {
                        config = JSON.parse(pergunta.configuracoes);
                    } catch (e) {
                        console.error('Erro ao parsear configurações:', e);
                    }
                }

                if (pergunta.tipo === 'escala') {
                    const min = config.escala_min || 1;
                    const max = config.escala_max || 5;
                    const options = [];
                    for (let i = min; i <= max; i++) {
                        options.push(i);
                    }
                    questionHTML += `
                                <div class="rating-scale">
                                    ${options.map(num => `
                                        <div class="rating-option" data-question="${index}" data-score="${num}" onclick="selectRating(${index}, ${num})">
                                            ${num}
                                        </div>
                                    `).join('')}
                                </div>
                            `;
                } else if (pergunta.tipo === 'sim_nao') {
                    questionHTML += `
                                <div class="rating-scale">
                                    <div class="rating-option" data-question="${index}" data-score="sim" onclick="selectRating(${index}, 'sim')">
                                        Sim
                                    </div>
                                    <div class="rating-option" data-question="${index}" data-score="nao" onclick="selectRating(${index}, 'nao')">
                                        Não
                                    </div>
                                </div>
                            `;
                } else if (pergunta.tipo === 'multipla') {
                    const opcoes = config.opcoes ? config.opcoes.split('\n').filter(op => op.trim()) : [];
                    questionHTML += `
                                <div class="opcoes-multipla">
                                    ${opcoes.map((opcao, opIndex) => `
                                        <div class="opcao-option" data-question="${index}" data-opcao="${opcao.trim()}" onclick="selectMultiplaOpcao(${index}, '${opcao.trim()}')">
                                            <input type="radio" name="question_${index}" value="${opcao.trim()}">
                                            ${opcao.trim()}
                                        </div>
                                    `).join('')}
                                </div>
                            `;
                }

                if (pergunta.tipo === 'texto') {
                    questionHTML += `<textarea class="form-textarea" data-question="${index}" placeholder="Sua resposta..."></textarea>`;
                }

                questionHTML += `</div>`;
                return questionHTML;
            }).join('');

            currentEvaluation = parseInt(evaluationId);
        } else {
            console.error('Erro ao carregar perguntas:', response.statusText);
            const container = document.getElementById('evaluation-questions');
            container.innerHTML = '<div class="loading">Erro ao carregar perguntas. Tente novamente.</div>';
        }
    } catch (error) {
        console.error('Erro ao carregar perguntas da avaliação:', error);
        const container = document.getElementById('evaluation-questions');
        container.innerHTML = '<div class="loading">Erro ao carregar perguntas. Tente novamente.</div>';
    }
}

function generateEvaluationQuestions() {
    const questions = [
        "Como você avalia seu desempenho geral no período?",
        "Quais foram suas principais conquistas?",
        "Em que áreas você gostaria de se desenvolver mais?",
        "Como foi sua colaboração com a equipe?",
        "Qual seu nível de satisfação com o trabalho atual?"
    ];

    const container = document.getElementById('evaluation-questions');
    container.innerHTML = questions.map((question, index) => `
                <div class="question-group">
                    <div class="question-text">${question}</div>
                    <div class="rating-scale">
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => `
                            <div class="rating-option" data-question="${index}" data-score="${num}" onclick="selectRating(${index}, ${num})">
                                ${num}
                            </div>
                        `).join('')}
                    </div>
                    <textarea class="form-textarea" data-question="${index}" placeholder="Comentários adicionais (opcional)"></textarea>
                </div>
            `).join('');
}

function selectRating(questionIndex, score) {
    // Remove previous selection
    document.querySelectorAll(`[data-question="${questionIndex}"][data-score]`).forEach(el => {
        el.classList.remove('selected');
    });

    // Add new selection
    document.querySelector(`[data-question="${questionIndex}"][data-score="${score}"]`).classList.add('selected');
}

function selectMultiplaOpcao(questionIndex, opcao) {
    // Remove previous selection
    document.querySelectorAll(`[data-question="${questionIndex}"][data-opcao]`).forEach(el => {
        el.classList.remove('selected');
        el.querySelector('input').checked = false;
    });

    // Add new selection
    const selectedElement = document.querySelector(`[data-question="${questionIndex}"][data-opcao="${opcao}"]`);
    selectedElement.classList.add('selected');
    selectedElement.querySelector('input').checked = true;
}

async function submitEvaluation() {
    const responses = [];
    const questions = document.querySelectorAll('.question-group');

    questions.forEach((group, index) => {
        const questionText = group.querySelector('.question-text').textContent;
        const selectedRating = group.querySelector('.rating-option.selected');
        const answer = group.querySelector('textarea').value;

        if (selectedRating) {
            responses.push({
                question: questionText,
                answer: answer || 'Sem comentários adicionais',
                score: parseInt(selectedRating.dataset.score)
            });
        } else if (answer.trim()) {
            responses.push({
                question: questionText,
                answer: answer,
                score: null
            });
        }
    });

    if (responses.length === 0) {
        alert('Responda pelo menos uma pergunta');
        return;
    }

    try {
        const response = await fetch(`/api/avaliacoes/${currentEvaluation}/responder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ responses })
        });

        if (response.ok) {
            closeEvaluationModal();
            loadEvaluations();
            alert('Avaliação concluída com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao enviar avaliação');
        }
    } catch (error) {
        console.error('Erro ao enviar avaliação:', error);
        alert('Erro ao enviar avaliação');
    }
}

// ===== FUNÇÕES DE OBJETIVOS =====

// Abrir modal de objetivo
function openObjetivoModal() {
    document.getElementById('objetivo-modal').classList.remove('hidden');
}

function closeObjetivoModal() {
    clearModalFields('objetivo-modal');
    document.getElementById('objetivo-modal').classList.add('hidden');
}

// Submeter objetivo
async function submitObjetivo() {
    const titulo = document.getElementById('objetivo-titulo')?.value?.trim();
    const descricao = document.getElementById('objetivo-descricao')?.value?.trim();
    const responsavel_id = document.getElementById('objetivo-responsavel')?.value;
    const data_inicio = document.getElementById('objetivo-data-inicio')?.value;
    const data_fim = document.getElementById('objetivo-data-fim')?.value;

    // Debug: verificar se os elementos existem
    console.log('Elementos encontrados:', {
        titulo: document.getElementById('objetivo-titulo'),
        descricao: document.getElementById('objetivo-descricao'),
        responsavel: document.getElementById('objetivo-responsavel'),
        data_inicio: document.getElementById('objetivo-data-inicio'),
        data_fim: document.getElementById('objetivo-data-fim')
    });

    if (!titulo || !responsavel_id || !data_inicio || !data_fim) {
        alert('Todos os campos são obrigatórios');
        return;
    }

    if (new Date(data_fim) <= new Date(data_inicio)) {
        alert('A data de fim deve ser posterior à data de início');
        return;
    }

    try {
        const response = await fetch('/api/objetivos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo,
                descricao,
                responsavel_id: parseInt(responsavel_id),
                data_inicio,
                data_fim
            })
        });

        if (response.ok) {
            closeObjetivoModal();
            loadObjetivos();
            alert('Objetivo criado com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao criar objetivo');
        }
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        alert('Erro ao criar objetivo');
    }
}

// Carregar objetivos
async function loadObjetivos() {
    try {
        const container = document.getElementById('objetivos-list');
        if (!container) return;

        container.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando objetivos...</div>';

        const response = await fetch('/api/objetivos');
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
        const dataFim = new Date(objetivo.data_fim).toLocaleDateString('pt-BR');
        const isOverdue = new Date(objetivo.data_fim) < new Date() && objetivo.status === 'Ativo';

        return `
                    <div class="objetivo-item">
                        <div class="objetivo-header">
                            <div class="objetivo-info">
                                <h4>${objetivo.titulo}</h4>
                                <p>${objetivo.descricao || 'Sem descrição'}</p>
                                <div style="margin-top: 8px; font-size: 14px; color: #6b7280;">
                                    <span>Responsável: ${objetivo.responsavel_nome}</span>
                                    <span style="margin-left: 16px;">Prazo: ${dataFim}</span>
                                    ${isOverdue ? '<span style="margin-left: 16px; color: #ef4444;">⚠️ Atrasado</span>' : ''}
                                </div>
                            </div>
                            <div class="objetivo-badges">
                                <span class="badge ${objetivo.status === 'Ativo' ? 'badge-positive' : 'badge-category'}">${objetivo.status}</span>
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
                            <button class="btn btn-secondary btn-sm" onclick="openCheckinModal(${objetivo.Id})">
                                <i class="fas fa-check-circle"></i>
                                Check-in
                            </button>
                            <button class="btn btn-amber btn-sm" onclick="viewObjetivoDetails(${objetivo.Id})">
                                <i class="fas fa-eye"></i>
                                Ver Detalhes
                            </button>
                        </div>
                    </div>
                `;
    }).join('');
}

// Abrir modal de check-in
function openCheckinModal(objetivoId) {
    currentObjetivo = objetivoId;
    document.getElementById('checkin-modal').classList.remove('hidden');
}

// Fechar modal de check-in
function closeCheckinModal() {
    document.getElementById('checkin-modal').classList.add('hidden');
    document.getElementById('checkin-progresso').value = '';
    document.getElementById('checkin-observacoes').value = '';
    currentObjetivo = null;
}

// Submeter check-in
async function submitCheckin() {
    const progresso = document.getElementById('checkin-progresso').value;
    const observacoes = document.getElementById('checkin-observacoes').value;

    if (!progresso || progresso < 0 || progresso > 100) {
        alert('Por favor, informe um progresso entre 0 e 100.');
        return;
    }

    try {
        const response = await fetch(`/api/objetivos/${currentObjetivo}/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                progresso: parseFloat(progresso),
                observacoes
            })
        });

        if (response.ok) {
            closeCheckinModal();
            loadObjetivos();
            alert('Check-in registrado com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao registrar check-in');
        }
    } catch (error) {
        console.error('Erro ao registrar check-in:', error);
        alert('Erro ao registrar check-in');
    }
}

// Ver detalhes do objetivo
function viewObjetivoDetails(objetivoId) {
    alert('Funcionalidade de detalhes em desenvolvimento.');
}

// Carregar filtros de objetivos
async function loadObjetivosFilters() {
    try {
        const response = await fetch('/api/objetivos/filtros');
        if (response.ok) {
            const filters = await response.json();
            // Implementar filtros quando necessário
        }
    } catch (error) {
        console.error('Erro ao carregar filtros de objetivos:', error);
    }
}

// Toggle filtros de objetivos
function toggleObjetivosFilters() {
    const filterMenu = document.getElementById('objetivos-filter-menu');
    if (filterMenu) {
        filterMenu.classList.toggle('hidden');
    }
}

// Funções para objetivos
async function loadObjetivos() {
    try {
        const container = document.getElementById('objetivos-list');
        if (!container) return;

        // Simula carregamento de objetivos
        container.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando objetivos...</div>';

        // Por enquanto, mostra mensagem de desenvolvimento
        setTimeout(() => {
            container.innerHTML = `
                        <div class="development-section">
                            <i class="fas fa-bullseye"></i>
                            <h3>Gestão de Objetivos</h3>
                            <p>Esta funcionalidade está em desenvolvimento. Em breve você poderá visualizar e gerenciar seus objetivos aqui.</p>
                        </div>
                    `;
        }, 1000);
    } catch (error) {
        console.error('Erro ao carregar objetivos:', error);
    }
}

function loadObjetivosFilters() {
    // Implementação futura dos filtros
    console.log('Carregando filtros de objetivos...');
}

function toggleObjetivosFilters() {
    const filterMenu = document.getElementById('objetivos-filter-menu');
    if (filterMenu) {
        filterMenu.classList.toggle('hidden');
    }
}

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
            alert('Humor registrado com sucesso!');
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
                        Registrado em ${new Date(humor.created_at).toLocaleString('pt-BR')}
                    </p>
                </div>
            `;
}

// Carregar humor da empresa
async function loadCompanyHumor() {
    try {
        // Verificar se o usuário é gestor
        const isManager = currentUser && currentUser.hierarchyLevel >= 3;

        if (!isManager) {
            // Usuários comuns não veem métricas da empresa
            const container = document.getElementById('company-humor');
            if (container) {
                container.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 20px;">Métricas da empresa disponíveis apenas para gestores.</p>';
            }
            return;
        }

        const response = await fetch('/api/humor/metrics');
        if (response.ok) {
            const metrics = await response.json();
            updateCompanyHumor(metrics);
        }
    } catch (error) {
        console.error('Erro ao carregar humor da empresa:', error);
        // Em caso de erro, mostrar mensagem apropriada
        const container = document.getElementById('company-humor');
        if (container) {
            container.innerHTML = '<p style="color: #6b7280; text-align: center; padding: 20px;">Erro ao carregar métricas da empresa.</p>';
        }
    }
}

function updateCompanyHumor(metrics) {
    const container = document.getElementById('company-humor');
    if (!container) return;

    container.innerHTML = `
                <div style="text-align: center;">
                    <h4 style="font-size: 32px; color: #10b981; margin-bottom: 8px;">${metrics.today.average.toFixed(1)}</h4>
                    <p style="color: #6b7280;">Média da empresa hoje</p>
                    <p style="font-size: 12px; color: #9ca3af; margin-top: 8px;">
                        ${metrics.today.total} colaboradores participaram
                    </p>
                </div>
            `;
}

// Carregar histórico de humor
async function loadHumorHistory() {
    try {
        // Usuários comuns veem apenas seu próprio histórico
        // Gestores veem o histórico da empresa
        const isManager = currentUser && currentUser.hierarchyLevel >= 3;
        const endpoint = isManager ? '/api/humor/empresa' : '/api/humor';

        const response = await fetch(endpoint);
        if (response.ok) {
            const history = await response.json();
            updateHumorHistory(history, isManager);
        } else if (response.status === 403) {
            // Se não tem acesso, mostrar apenas histórico individual
            const individualResponse = await fetch('/api/humor');
            if (individualResponse.ok) {
                const individualHistory = await individualResponse.json();
                updateHumorHistory([individualHistory], false);
            }
        }
    } catch (error) {
        console.error('Erro ao carregar histórico de humor:', error);
        // Em caso de erro, tentar carregar apenas histórico individual
        try {
            const individualResponse = await fetch('/api/humor');
            if (individualResponse.ok) {
                const individualHistory = await individualResponse.json();
                updateHumorHistory([individualHistory], false);
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

    // Se não é manager e tem apenas um registro, é histórico individual
    if (!isManager && history.length === 1 && !history[0].user_name) {
        const entry = history[0];
        container.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #e5e7eb;">
                        <div>
                            <strong>Seu humor</strong>
                            <p style="color: #6b7280; font-size: 14px;">${entry.description || 'Sem descrição'}</p>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-weight: 500; color: #f59e0b;">${entry.score}/5</span>
                            <p style="font-size: 12px; color: #9ca3af;">${new Date(entry.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                    </div>
                `;
        return;
    }

    // Histórico empresarial (para gestores)
    container.innerHTML = history.map(entry => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #e5e7eb;">
                    <div>
                        <strong>${entry.user_name || 'Usuário'}</strong>
                        <p style="color: #6b7280; font-size: 14px;">${entry.department || entry.description || 'Sem descrição'}</p>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-weight: 500; color: #f59e0b;">${entry.score}/5</span>
                        <p style="font-size: 12px; color: #9ca3af;">${new Date(entry.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                </div>
            `).join('');
}

// ===== FUNÇÕES DE OBJETIVOS =====

// Carregar objetivos
async function loadObjetivos() {
    try {
        const searchValue = document.getElementById('objetivos-search')?.value || '';
        const queryParams = new URLSearchParams({
            search: searchValue,
            ...(activeObjetivosFilters.departamento && { departamento: activeObjetivosFilters.departamento }),
            ...(activeObjetivosFilters.status && { status: activeObjetivosFilters.status }),
            ...(activeObjetivosFilters.tipo && { tipo: activeObjetivosFilters.tipo })
        });

        const response = await fetch(`/api/objetivos?${queryParams}`);
        if (response.ok) {
            const objetivos = await response.json();
            updateObjetivosList(objetivos);
        }
    } catch (error) {
        console.error('Erro ao carregar objetivos:', error);
    }
}

function updateObjetivosList(objetivos) {
    const container = document.getElementById('objetivos-list');
    if (!container) return;

    if (objetivos.length === 0) {
        container.innerHTML = '<div class="loading">Nenhum objetivo encontrado.</div>';
        return;
    }

    container.innerHTML = objetivos.map(objetivo => {
        const isResponsavel = objetivo.responsavel_id === currentUser.userId;
        const progresso = objetivo.progresso_atual || 0;
        const dataInicio = new Date(objetivo.data_inicio).toLocaleDateString('pt-BR');
        const dataFim = new Date(objetivo.data_fim).toLocaleDateString('pt-BR');

        return `
                    <div class="objetivo-item">
                        <div class="objetivo-header">
                            <div class="objetivo-info">
                                <h4>${objetivo.titulo}</h4>
                                <p>${objetivo.descricao || 'Sem descrição'}</p>
                                <p><strong>Responsável:</strong> ${objetivo.responsavel_nome} | <strong>Período:</strong> ${dataInicio} - ${dataFim}</p>
                            </div>
                            <div class="objetivo-badges">
                                <span class="badge badge-category">${objetivo.tipo}</span>
                                <span class="badge-prioridade ${objetivo.prioridade.toLowerCase()}">${objetivo.prioridade}</span>
                                <span class="badge ${objetivo.status === 'Ativo' ? 'badge-positive' : 'badge-development'}">${objetivo.status}</span>
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
                            ${isResponsavel ? `
                                <button class="btn btn-sm btn-amber" onclick="openCheckinModal(${objetivo.Id})">
                                    <i class="fas fa-check"></i>
                                    Check-in
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-secondary" onclick="viewObjetivoDetails(${objetivo.Id})">
                                <i class="fas fa-eye"></i>
                                Detalhes
                            </button>
                        </div>
                    </div>
                `;
    }).join('');
}

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
    if (responsavelSearchEl) responsavelSearchEl.value = 'Selecionar responsável...';
    if (dataInicioEl) dataInicioEl.value = '';
    if (dataFimEl) dataFimEl.value = '';
}

function populateObjetivoForm() {
    const responsavelSelect = document.getElementById('objetivo-responsavel');
    responsavelSelect.innerHTML = '<option value="">Selecionar responsável...</option>';
    users.forEach(user => {
        responsavelSelect.innerHTML += `<option value="${user.id}">${user.name} - ${user.department}</option>`;
    });
}

// Submeter objetivo
async function submitObjetivo() {
    const titulo = document.getElementById('objetivo-titulo').value;
    const descricao = document.getElementById('objetivo-descricao').value;
    const responsavelId = document.getElementById('objetivo-responsavel').value;
    const departamento = document.getElementById('objetivo-departamento').value;
    const unidade = document.getElementById('objetivo-unidade').value;
    const tipo = document.getElementById('objetivo-tipo').value;
    const dataInicio = document.getElementById('objetivo-data-inicio').value;
    const dataFim = document.getElementById('objetivo-data-fim').value;
    const prioridade = document.getElementById('objetivo-prioridade').value;

    if (!titulo || !responsavelId || !dataInicio || !dataFim) {
        alert('Preencha todos os campos obrigatórios');
        return;
    }

    try {
        const response = await fetch('/api/objetivos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo,
                descricao,
                responsavel_id: parseInt(responsavelId),
                departamento,
                unidade,
                data_inicio: dataInicio,
                data_fim: dataFim,
                tipo,
                prioridade
            })
        });

        if (response.ok) {
            closeObjetivoModal();
            loadObjetivos();
            alert('Objetivo criado com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao criar objetivo');
        }
    } catch (error) {
        console.error('Erro ao criar objetivo:', error);
        alert('Erro ao criar objetivo');
    }
}

// Modal de check-in
function openCheckinModal(objetivoId) {
    currentObjetivo = objetivoId;
    document.getElementById('checkin-modal').classList.remove('hidden');
}

function closeCheckinModal() {
    document.getElementById('checkin-modal').classList.add('hidden');
    document.getElementById('checkin-progresso').value = '';
    document.getElementById('checkin-observacoes').value = '';
    currentObjetivo = null;
}

async function submitCheckin() {
    const progresso = parseInt(document.getElementById('checkin-progresso').value);
    const observacoes = document.getElementById('checkin-observacoes').value;

    if (progresso < 0 || progresso > 100) {
        alert('Progresso deve ser entre 0 e 100');
        return;
    }

    try {
        const response = await fetch(`/api/objetivos/${currentObjetivo}/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                progresso,
                observacoes
            })
        });

        if (response.ok) {
            closeCheckinModal();
            loadObjetivos();
            alert('Check-in registrado com sucesso!');
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao registrar check-in');
        }
    } catch (error) {
        console.error('Erro ao registrar check-in:', error);
        alert('Erro ao registrar check-in');
    }
}

// Filtros de objetivos
function toggleObjetivosFilters() {
    const filterMenu = document.getElementById('objetivos-filter-menu');
    filterMenu.classList.toggle('hidden');
}

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

// Carregar filtros de objetivos
async function loadObjetivosFilters() {
    try {
        const response = await fetch('/api/objetivos/filtros');
        if (response.ok) {
            const filters = await response.json();
            updateObjetivosFilters(filters);
        }
    } catch (error) {
        console.error('Erro ao carregar filtros de objetivos:', error);
    }
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
        const response = await fetch('/api/pesquisas/can-create');
        if (response.ok) {
            const data = await response.json();
            const novaPesquisaBtn = document.getElementById('nova-pesquisa-btn');
            if (novaPesquisaBtn) {
                novaPesquisaBtn.style.display = data.canCreate ? 'inline-block' : 'none';
            }
        }
    } catch (error) {
        console.error('Erro ao verificar permissões de pesquisa:', error);
    }
}

// Carregar pesquisas
async function loadPesquisas() {
    try {
        const searchValue = document.getElementById('pesquisas-search')?.value || '';
        const queryParams = new URLSearchParams({
            search: searchValue,
            ...(activePesquisasFilters.status && { status: activePesquisasFilters.status }),
            ...(activePesquisasFilters.tipo && { tipo: activePesquisasFilters.tipo })
        });

        const response = await fetch(`/api/pesquisas?${queryParams}`);
        if (response.ok) {
            const pesquisas = await response.json();
            updatePesquisasList(pesquisas);
        }
    } catch (error) {
        console.error('Erro ao carregar pesquisas:', error);
    }
}

function updatePesquisasList(pesquisas) {
    const container = document.getElementById('pesquisas-list');
    if (!container) return;

    if (pesquisas.length === 0) {
        container.innerHTML = '<div class="loading">Nenhuma pesquisa encontrada.</div>';
        return;
    }

    container.innerHTML = pesquisas.map(pesquisa => {
        const dataCriacao = new Date(pesquisa.data_criacao).toLocaleDateString('pt-BR');
        const dataEncerramento = pesquisa.data_encerramento ? new Date(pesquisa.data_encerramento).toLocaleDateString('pt-BR') : 'Sem prazo';
        const isAtiva = pesquisa.status === 'Ativa' && (!pesquisa.data_encerramento || new Date(pesquisa.data_encerramento) > new Date());

        return `
                    <div class="pesquisa-item">
                        <div class="pesquisa-header">
                            <div class="pesquisa-info">
                                <h4>${pesquisa.titulo}</h4>
                                <p>${pesquisa.descricao || 'Sem descrição'}</p>
                                <p><strong>Criado por:</strong> ${pesquisa.criador_nome} | <strong>Data:</strong> ${dataCriacao}</p>
                                <p><strong>Encerramento:</strong> ${dataEncerramento}</p>
                            </div>
                            <div class="pesquisa-badges">
                                <span class="badge ${isAtiva ? 'badge-positive' : 'badge-development'}">${pesquisa.status}</span>
                                ${pesquisa.anonima ? '<span class="badge badge-warning">Anônima</span>' : ''}
                            </div>
                        </div>
                        <div class="pesquisa-stats">
                            <div class="stat-item">
                                <div class="stat-label">Respostas:</div>
                                <div class="stat-value">${pesquisa.total_respostas}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Departamentos:</div>
                                <div class="stat-value">${pesquisa.departamentos_alvo || 'Todos'}</div>
                            </div>
                        </div>
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
        const response = await fetch('/api/pesquisas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                titulo,
                descricao,
                pergunta,
                tipo_pergunta: tipo,
                opcoes: opcoesArray,
                departamentos_alvo: departamentos,
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

function selectOpcao(opcao) {
    document.querySelectorAll('.opcao-option').forEach(option => {
        option.classList.remove('selected');
    });
    event.target.closest('.opcao-option').classList.add('selected');
    selectedPesquisaResposta = opcao;
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
    if (!currentPesquisa) {
        alert('Nenhuma pesquisa selecionada');
        return;
    }

    let resposta = '';
    let score = null;

    if (currentPesquisa.tipo_pergunta === 'multipla_escolha') {
        if (!selectedPesquisaResposta) {
            alert('Selecione uma opção');
            return;
        }
        resposta = selectedPesquisaResposta;
    } else if (currentPesquisa.tipo_pergunta === 'escala') {
        if (!selectedPesquisaResposta) {
            alert('Selecione uma nota');
            return;
        }
        score = selectedPesquisaResposta;
        resposta = `Nota ${selectedPesquisaResposta}`;
    } else if (currentPesquisa.tipo_pergunta === 'texto_livre') {
        resposta = document.getElementById('responder-resposta-texto').value;
        if (!resposta.trim()) {
            alert('Digite sua resposta');
            return;
        }
    }

    try {
        const response = await fetch(`/api/pesquisas/${currentPesquisa.Id}/responder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                resposta,
                score
            })
        });

        if (response.ok) {
            closeResponderPesquisaModal();
            loadPesquisas();
            alert('Resposta enviada com sucesso!');
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

// Carregar filtros da equipe
async function loadTeamFilters() {
    try {
        // Carregar departamentos disponíveis
        const departments = [...new Set(users.map(user => user.department))].filter(Boolean);
        const departmentSelect = document.getElementById('team-department-filter');

        if (departmentSelect) {
            departmentSelect.innerHTML = '<option value="">Todos</option>';
            departments.forEach(dept => {
                departmentSelect.innerHTML += `<option value="${dept}">${dept}</option>`;
            });
        }
    } catch (error) {
        console.error('Erro ao carregar filtros da equipe:', error);
    }
}

// Carregar métricas da equipe
async function loadTeamMetrics() {
    try {
        const response = await fetch('/api/manager/team-metrics');
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
        const response = await fetch('/api/manager/team-status');
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
        const departmentFilter = document.getElementById('team-department-filter').value;
        const statusFilter = document.getElementById('team-status-filter').value;

        const queryParams = new URLSearchParams();
        if (departmentFilter) queryParams.append('departamento', departmentFilter);
        if (statusFilter) queryParams.append('status', statusFilter);

        const response = await fetch(`/api/manager/team-management?${queryParams}`);
        if (response.ok) {
            const teamMembers = await response.json();
            updateTeamMembersList(teamMembers);
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

    container.innerHTML = members.map(member => {
        const lastLogin = member.LastLogin ? new Date(member.LastLogin).toLocaleDateString('pt-BR') : 'Nunca';
        const moodIcon = member.lastMood ? getMoodIcon(member.lastMood) : 'fas fa-question';
        const moodColor = member.lastMood ? getMoodColor(member.lastMood) : '#6b7280';

        return `
                    <div class="team-member-item">
                        <div class="member-info">
                            <h4>${member.NomeCompleto}</h4>
                            <p><strong>Departamento:</strong> ${member.Departamento}</p>
                            <p><strong>Cargo:</strong> ${member.Cargo}</p>
                            <p><strong>Último login:</strong> ${lastLogin}</p>
                        </div>
                        <div class="member-metrics">
                            <div class="metric">
                                <i class="${moodIcon}" style="color: ${moodColor};"></i>
                                <span>Humor: ${member.lastMood || 'N/A'}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-comment"></i>
                                <span>Feedbacks: ${member.recentFeedbacks}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-bullseye"></i>
                                <span>Objetivos: ${member.activeObjectives}</span>
                            </div>
                            <div class="metric">
                                <i class="fas fa-clipboard-check"></i>
                                <span>Avaliações: ${member.pendingEvaluations}</span>
                            </div>
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
        // Carregar departamentos disponíveis
        const response = await fetch('/api/analytics/departments-list');
        if (response.ok) {
            const departments = await response.json();
            const departmentSelect = document.getElementById('analytics-department');

            if (departmentSelect) {
                departmentSelect.innerHTML = '<option value="">Todos</option>';
                departments.forEach(dept => {
                    departmentSelect.innerHTML += `<option value="${dept}">${dept}</option>`;
                });
            }
        } else {
            // Fallback: usar dados locais se a API falhar
            const departments = [...new Set(users.map(user => user.departamento))].filter(Boolean);
            const departmentSelect = document.getElementById('analytics-department');

            if (departmentSelect) {
                departmentSelect.innerHTML = '<option value="">Todos</option>';
                departments.forEach(dept => {
                    departmentSelect.innerHTML += `<option value="${dept}">${dept}</option>`;
                });
            }
        }
    } catch (error) {
        console.error('Erro ao carregar filtros de analytics:', error);
        // Fallback: usar dados locais
        const departments = [...new Set(users.map(user => user.departamento))].filter(Boolean);
        const departmentSelect = document.getElementById('analytics-department');

        if (departmentSelect) {
            departmentSelect.innerHTML = '<option value="">Todos</option>';
            departments.forEach(dept => {
                departmentSelect.innerHTML += `<option value="${dept}">${dept}</option>`;
            });
        }
    }
}

async function loadAnalytics() {
    try {
        const period = document.getElementById('analytics-period').value;
        const department = document.getElementById('analytics-department').value;
        const type = document.getElementById('analytics-type').value;

        console.log('🔧 Filtros aplicados:', { period, department, type });

        const queryParams = new URLSearchParams({
            period,
            department,
            type
        });

        const response = await fetch(`/api/analytics?${queryParams}`);
        if (response.ok) {
            const analytics = await response.json();
            console.log('📊 Dados de analytics recebidos:', analytics);
            updateAnalytics(analytics);
        } else {
            console.error('❌ Erro na resposta de analytics:', response.status);
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

        const queryParams = new URLSearchParams({
            period,
            department
        });

        const response = await fetch(`/api/analytics/temporal?${queryParams}`);
        if (response.ok) {
            const temporalData = await response.json();
            console.log('📈 Dados temporais recebidos:', temporalData);
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

    // Criar gráfico temporal simples usando SVG
    let chartHtml = '';
    if (data.dailyMood && data.dailyMood.length > 0) {
        const maxValue = Math.max(...data.dailyMood.map(item => item.average));
        const minValue = Math.min(...data.dailyMood.map(item => item.average));
        const range = maxValue - minValue || 1;
        const width = 600;
        const height = 200;
        const padding = 40;
        const chartWidth = width - 2 * padding;
        const chartHeight = height - 2 * padding;

        const points = data.dailyMood.map((item, index) => {
            const x = padding + (index / (data.dailyMood.length - 1)) * chartWidth;
            const y = height - padding - ((item.average - minValue) / range) * chartHeight;
            return `${x},${y}`;
        }).join(' ');

        const areaPoints = points + ` ${width - padding},${height - padding} ${padding},${height - padding}`;

        chartHtml = `
                    <svg width="${width}" height="${height}" style="max-width: 100%;">
                        <defs>
                            <linearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:#10b981;stop-opacity:0.3" />
                                <stop offset="100%" style="stop-color:#10b981;stop-opacity:0.1" />
                            </linearGradient>
                        </defs>
                        <polygon points="${areaPoints}" fill="url(#chartGradient)" />
                        <polyline points="${points}" fill="none" stroke="#10b981" stroke-width="3" />
                        ${data.dailyMood.map((item, index) => {
            const x = padding + (index / (data.dailyMood.length - 1)) * chartWidth;
            const y = height - padding - ((item.average - minValue) / range) * chartHeight;
            return `<circle cx="${x}" cy="${y}" r="4" fill="#10b981" />`;
        }).join('')}
                        <text x="${width / 2}" y="${height - 10}" text-anchor="middle" style="font-size: 12px; fill: #6b7280;">
                            ${data.dailyMood.length} dias de dados
                        </text>
                    </svg>
                `;
    } else {
        chartHtml = `
                    <div style="height: 200px; background: #f9fafb; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                        <div style="text-align: center;">
                            <i class="fas fa-chart-line" style="font-size: 32px; color: #9ca3af; margin-bottom: 10px;"></i>
                            <p style="color: #9ca3af;">Nenhum dado disponível</p>
                        </div>
                    </div>
                `;
    }

    temporalContainer.innerHTML = `
                <div style="padding: 20px;">
                    <div style="margin-bottom: 20px;">
                        <h4 style="color: #374151; margin-bottom: 10px;">Evolução do Humor</h4>
                        <div style="text-align: center;">
                            ${chartHtml}
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                            <h5 style="color: #374151; margin-bottom: 8px;">Feedbacks</h5>
                            <p style="font-size: 24px; color: #10b981; font-weight: bold;">${data.feedbacks.length}</p>
                            <p style="font-size: 12px; color: #6b7280;">Total no período</p>
                        </div>
                        <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
                            <h5 style="color: #374151; margin-bottom: 8px;">Reconhecimentos</h5>
                            <p style="font-size: 24px; color: #f59e0b; font-weight: bold;">${data.recognitions.length}</p>
                            <p style="font-size: 12px; color: #6b7280;">Total no período</p>
                        </div>
                    </div>
                </div>
            `;
}

function updateAnalytics(data) {
    // Atualizar métricas de participação
    const participationContainer = document.getElementById('participation-metrics');
    if (participationContainer) {
        participationContainer.innerHTML = `
                    <div style="text-align: center;">
                        <h4 style="font-size: 32px; color: #10b981;">${data.participation.percentage}%</h4>
                        <p>Taxa de participação</p>
                        <p style="font-size: 12px; color: #9ca3af;">
                            ${data.participation.active} de ${data.participation.total} usuários
                        </p>
                    </div>
                `;
    }

    // Atualizar métricas de satisfação
    const satisfactionContainer = document.getElementById('satisfaction-metrics');
    if (satisfactionContainer) {
        satisfactionContainer.innerHTML = `
                    <div style="text-align: center;">
                        <h4 style="font-size: 32px; color: #f59e0b;">${data.satisfaction.average}</h4>
                        <p>Média de satisfação</p>
                        <p style="font-size: 12px; color: #9ca3af;">
                            Baseado em ${data.satisfaction.total} avaliações
                        </p>
                    </div>
                `;
    }

    // Atualizar métricas de tendências
    const trendsContainer = document.getElementById('trends-metrics');
    if (trendsContainer) {
        const trendIcon = data.trends.direction === 'up' ? 'fas fa-trending-up' : 'fas fa-trending-down';
        const trendColor = data.trends.direction === 'up' ? '#10b981' : '#ef4444';

        trendsContainer.innerHTML = `
                    <div style="text-align: center;">
                        <h4 style="font-size: 32px; color: ${trendColor};">
                            <i class="${trendIcon}"></i>
                            ${data.trends.percentage}%
                        </h4>
                        <p>Variação do período</p>
                        <p style="font-size: 12px; color: #9ca3af;">
                            vs período anterior
                        </p>
                    </div>
                `;
    }

    // Atualizar métricas de distribuição
    const distributionContainer = document.getElementById('distribution-metrics');
    if (distributionContainer) {
        distributionContainer.innerHTML = `
                    <div style="text-align: center;">
                        <h4 style="font-size: 32px; color: #8b5cf6;">${data.distribution.total}</h4>
                        <p>Total de registros</p>
                        <p style="font-size: 12px; color: #9ca3af;">
                            Distribuídos em ${data.distribution.categories} categorias
                        </p>
                    </div>
                `;
    }

    // Carregar análise temporal
    loadTemporalAnalysis();
}

async function exportReport(format) {
    try {
        const period = document.getElementById('analytics-period').value;
        const department = document.getElementById('analytics-department').value;
        const type = document.getElementById('analytics-type').value;

        const queryParams = new URLSearchParams({
            period,
            department,
            type,
            format
        });

        const response = await fetch(`/api/analytics/export?${queryParams}`);
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `relatorio_${type}_${new Date().toISOString().split('T')[0]}.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } else {
            console.error('Erro na exportação:', response.statusText);
            alert('Erro ao exportar relatório. Tente novamente.');
        }
    } catch (error) {
        console.error('Erro ao exportar relatório:', error);
        alert('Erro ao exportar relatório. Tente novamente.');
    }
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
            document.getElementById('profile-position').value = user.cargo || '';
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
        const position = document.getElementById('profile-position').value;

        const response = await fetch('/api/usuario/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nomeCompleto: name,
                nome: nickname,
                departamento: department,
                cargo: position
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

// ===== FUNÇÃO FALTANTE: viewObjetivoDetails =====

async function viewObjetivoDetails(objetivoId) {
    try {
        if (!objetivoId || isNaN(parseInt(objetivoId))) {
            alert('ID do objetivo inválido');
            return;
        }

        const response = await fetch(`/api/objetivos/${objetivoId}`);
        if (response.ok) {
            const objetivo = await response.json();
            showObjetivoDetails(objetivo);
        } else {
            const error = await response.json();
            alert(error.error || 'Erro ao carregar detalhes do objetivo');
        }
    } catch (error) {
        console.error('Erro ao buscar detalhes do objetivo:', error);
        alert('Erro ao carregar detalhes do objetivo');
    }
}

function showObjetivoDetails(objetivo) {
    const dataInicio = new Date(objetivo.data_inicio).toLocaleDateString('pt-BR');
    const dataFim = new Date(objetivo.data_fim).toLocaleDateString('pt-BR');
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