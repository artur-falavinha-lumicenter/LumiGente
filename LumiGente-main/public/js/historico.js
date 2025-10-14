/**
 * Módulo de Histórico - Sistema de visualização de dados históricos
 * Gerencia a exibição e filtros dos relatórios do sistema anterior
 */

class HistoricoManager {
    constructor() {
        this.dadosHistorico = {};
        this.filtrosAtivos = {
            periodo: 'todos',
            tipo: 'todos',
            departamento: 'todos'
        };
        this.paginacao = {
            paginaAtual: 1,
            itensPorPagina: 50,
            totalItens: 0
        };
        this.cacheManager = window.CacheManager ? new window.CacheManager() : null;
        this.init();
    }

    /**
     * Inicializa o módulo de histórico
     */
    init() {
        this.setupEventListeners();
        this.carregarDepartamentos();
        this.verificarPermissoes();
        this.inicializarSecoesFechadas();
    }

    /**
     * Inicializa todas as seções como fechadas
     */
    inicializarSecoesFechadas() {
        const secoes = document.querySelectorAll('.historico-section');
        secoes.forEach(secao => {
            secao.classList.add('collapsed');
        });
    }

    /**
     * Configura os event listeners para a aba de histórico
     */
    setupEventListeners() {
        // Event listener para mudança de abas
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-tab="historico"]')) {
                this.carregarDadosHistorico();
            }
        });

        // Event listeners para filtros
        const filtros = ['historico-periodo', 'historico-tipo', 'historico-departamento'];
        filtros.forEach(id => {
            const elemento = document.getElementById(id);
            if (elemento) {
                elemento.addEventListener('change', () => {
                    this.aplicarFiltros();
                });
            }
        });

        // Event listeners para seções colapsáveis
        document.addEventListener('click', (e) => {
            if (e.target.closest('.historico-section .card-header')) {
                this.toggleSecao(e.target.closest('.historico-section'));
            }
        });

        // Monitora tentativas de bypass por manipulação do DOM
        this.iniciarMonitoramentoSeguranca();
    }

    /**
     * Verifica se o usuário tem permissão para acessar o histórico
     */
    verificarPermissoes() {
        // Simula verificação de permissões - em produção, isso viria do backend
        const usuarioAtual = this.obterUsuarioAtual();
        const temPermissao = this.verificarPermissaoUsuario(usuarioAtual);
        
        const historicoTab = document.getElementById('historico-tab');
        if (historicoTab) {
            historicoTab.style.display = temPermissao ? 'flex' : 'none';
        }
    }

    /**
     * Obtém informações do usuário atual
     */
    obterUsuarioAtual() {
        // Simula obtenção do usuário atual - em produção, isso viria do localStorage ou API
        return {
            id: 1,
            nome: 'Usuário Teste',
            departamento: 'RH',
            cargo: 'Analista de RH',
            permissoes: ['rh', 'treinamento']
        };
    }

    /**
     * Verifica se o usuário tem permissão para acessar o histórico
     * Apenas usuários dos setores "RH" ou "DEPARTAMENTO TREINAM&DESENVOLV" têm acesso
     */
    verificarPermissaoUsuario(usuario) {
        const setoresPermitidos = ['RH', 'DEPARTAMENTO TREINAM&DESENVOLV'];
        
        // Verifica se o departamento/setor do usuário está na lista permitida
        if (usuario.departamento) {
            const departamentoUsuario = usuario.departamento.toUpperCase().trim();
            
            // Verifica correspondência exata ou parcial para variações do nome
            for (let setor of setoresPermitidos) {
                if (departamentoUsuario === setor || 
                    departamentoUsuario.includes('TREINAM') && departamentoUsuario.includes('DESENVOLV') ||
                    departamentoUsuario === 'RH' ||
                    departamentoUsuario === 'RECURSOS HUMANOS') {
                    return true;
                }
            }
        }
        
        // Verifica permissões específicas como fallback
        if (usuario.permissoes) {
            return usuario.permissoes.includes('rh') || 
                   usuario.permissoes.includes('treinamento') ||
                   usuario.permissoes.includes('historico');
        }
        
        return false;
    }

    /**
     * Mostra erro de permissão quando usuário não autorizado tenta acessar
     */
    mostrarErroPermissao() {
        const container = document.getElementById('historico-content');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: #dc2626;">
                    <div style="font-size: 64px; margin-bottom: 20px;">🚫</div>
                    <h2 style="color: #dc2626; margin-bottom: 16px;">Acesso Negado</h2>
                    <p style="color: #6b7280; margin-bottom: 24px;">
                        Você não tem permissão para acessar o histórico de feedbacks.<br>
                        Apenas usuários dos setores <strong>RH</strong> ou <strong>Departamento de Treinamento e Desenvolvimento</strong> podem acessar esta funcionalidade.
                    </p>
                    <button onclick="window.location.reload()" style="
                        background: #dc2626; 
                        color: white; 
                        border: none; 
                        padding: 12px 24px; 
                        border-radius: 6px; 
                        cursor: pointer;
                        font-weight: 500;
                    ">
                        Recarregar Página
                    </button>
                </div>
            `;
        }
        
        // Oculta a aba novamente
        const historicoTab = document.querySelector('[data-tab="historico"]');
        if (historicoTab) {
            historicoTab.style.display = 'none';
        }
    }

    /**
     * Inicia monitoramento de segurança para detectar tentativas de bypass
     */
    iniciarMonitoramentoSeguranca() {
        // Monitora mudanças no DOM da aba histórico
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const target = mutation.target;
                    
                    // Verifica se alguém está tentando tornar a aba histórico visível
                    if (target.getAttribute('data-tab') === 'historico' || 
                        target.closest('[data-tab="historico"]')) {
                        
                        const usuarioAtual = this.obterUsuarioAtual();
                        if (!this.verificarPermissaoUsuario(usuarioAtual)) {
                            console.warn('🚨 Tentativa de bypass detectada - ocultando aba novamente');
                            target.style.display = 'none';
                            this.mostrarErroPermissao();
                        }
                    }
                }
            });
        });

        // Observa mudanças na aba histórico
        const historicoTab = document.querySelector('[data-tab="historico"]');
        if (historicoTab) {
            observer.observe(historicoTab, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }

        // Verifica periodicamente se a aba foi manipulada
        setInterval(() => {
            const usuarioAtual = this.obterUsuarioAtual();
            if (!this.verificarPermissaoUsuario(usuarioAtual)) {
                const historicoTab = document.querySelector('[data-tab="historico"]');
                const historicoContent = document.getElementById('historico-content');
                
                if (historicoTab && window.getComputedStyle(historicoTab).display !== 'none') {
                    console.warn('🚨 Bypass detectado - aba histórico visível sem permissão');
                    historicoTab.style.display = 'none';
                    this.mostrarErroPermissao();
                }
                
                if (historicoContent && window.getComputedStyle(historicoContent).display !== 'none') {
                    console.warn('🚨 Bypass detectado - conteúdo histórico visível sem permissão');
                    this.mostrarErroPermissao();
                }
            }
        }, 2000); // Verifica a cada 2 segundos
    }

    /**
     * Carrega a lista de departamentos para o filtro baseado nos dados reais
     */
    carregarDepartamentos() {
        const select = document.getElementById('historico-departamento');
        if (!select) return;

        // Limpa opções existentes (exceto "Todos os Departamentos")
        const opcoesPadrao = select.querySelector('option[value="todos"]');
        select.innerHTML = '';
        if (opcoesPadrao) {
            select.appendChild(opcoesPadrao);
        } else {
            const optionTodos = document.createElement('option');
            optionTodos.value = 'todos';
            optionTodos.textContent = 'Todos os Departamentos';
            select.appendChild(optionTodos);
        }

        // Extrai departamentos únicos dos dados reais
        const departamentosSet = new Set();
        
        Object.values(this.dadosHistorico).forEach(dadosSecao => {
            const dados = dadosSecao.dados || dadosSecao;
            if (Array.isArray(dados)) {
                dados.forEach(item => {
                    // Busca em diferentes possíveis nomes de colunas de departamento
                    const possiveisColunasDep = [
                        'Departamento', 'departamento', 'Para Departamento', 'Depto', 'Setor'
                    ];
                    
                    possiveisColunasDep.forEach(coluna => {
                        if (item[coluna] && item[coluna].toString().trim()) {
                            departamentosSet.add(item[coluna].toString().trim());
                        }
                    });
                });
            }
        });

        // Adiciona departamentos únicos ao select
        Array.from(departamentosSet).sort().forEach(dept => {
            const option = document.createElement('option');
            option.value = dept.toLowerCase();
            option.textContent = dept;
            select.appendChild(option);
        });
    }

    /**
     * Carrega a lista de períodos para o filtro baseado nos dados reais
     */
    carregarPeriodos() {
        const select = document.getElementById('historico-periodo');
        if (!select) return;

        // Limpa opções existentes (exceto "Todos os Períodos")
        const opcoesPadrao = select.querySelector('option[value="todos"]');
        select.innerHTML = '';
        if (opcoesPadrao) {
            select.appendChild(opcoesPadrao);
        } else {
            const optionTodos = document.createElement('option');
            optionTodos.value = 'todos';
            optionTodos.textContent = 'Todos os Períodos';
            select.appendChild(optionTodos);
        }

        // Extrai anos únicos dos dados reais
        const anosSet = new Set();
        
        Object.values(this.dadosHistorico).forEach(dadosSecao => {
            const dados = dadosSecao.dados || dadosSecao;
            if (Array.isArray(dados)) {
                dados.forEach(item => {
                    // Busca em diferentes possíveis nomes de colunas de data
                    const possiveisColunasData = [
                        'Data', 'data', 'Data Admissão', 'Data de Nascimento', 'Data de Cadastro',
                        'Último Acesso', 'Data do turnover', 'Data Ínicio', 'Data Final',
                        'Data de criação', 'Última atualização'
                    ];
                    
                    possiveisColunasData.forEach(coluna => {
                        if (item[coluna]) {
                            const valorData = item[coluna].toString().trim();
                            if (valorData && valorData !== '-' && valorData !== 'N/A') {
                                // Usa a mesma função de extração de anos
                                const anosEncontrados = this.extrairAnosDaData(valorData);
                                anosEncontrados.forEach(ano => anosSet.add(ano));
                            }
                        }
                    });
                });
            }
        });

        // Adiciona anos únicos ao select em ordem decrescente
        Array.from(anosSet).sort((a, b) => b - a).forEach(ano => {
            const option = document.createElement('option');
            option.value = ano;
            option.textContent = ano;
            select.appendChild(option);
        });
    }

    /**
     * Carrega os dados históricos quando a aba é acessada
     */
    async carregarDadosHistorico() {
        try {
            // Verificação adicional de segurança no momento do carregamento
            const usuarioAtual = this.obterUsuarioAtual();
            if (!this.verificarPermissaoUsuario(usuarioAtual)) {
                console.error('🚫 Acesso negado: Usuário não autorizado para histórico');
                this.mostrarErroPermissao();
                return;
            }

            // Verifica se há dados em cache
            if (this.cacheManager) {
                const dadosCache = this.cacheManager.obterDadosHistorico('todos', this.filtrosAtivos);
                if (dadosCache) {
                    console.log('Carregando dados do cache');
                    this.dadosHistorico = dadosCache;
                    // Carrega filtros dinamicamente baseado nos dados
                    this.carregarDepartamentos();
                    this.carregarPeriodos();
                    this.aplicarFiltros();
                    return;
                }
            }
            
            // Carrega dados se não estiver em cache
            await this.simularCarregamentoDados();
            
            // Armazena no cache
            if (this.cacheManager) {
                this.cacheManager.armazenarDadosHistorico('todos', this.dadosHistorico, this.filtrosAtivos);
            }
            
            // Carrega filtros dinamicamente baseado nos dados
            this.carregarDepartamentos();
            this.carregarPeriodos();
            
            this.aplicarFiltros();
        } catch (error) {
            console.error('Erro ao carregar dados históricos:', error);
            this.mostrarErro('Erro ao carregar dados históricos');
        }
    }

    /**
     * Carrega dados históricos do backend (Python)
     */
    async simularCarregamentoDados() {
        try {
            console.log('🔄 Carregando dados históricos do backend...');
            
            // Faz requisição para o endpoint do backend
            const response = await fetch('/api/historico/dados', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                if (response.status === 403) {
                    // Usuário não autorizado - mostra erro de permissão
                    const errorData = await response.json().catch(() => ({}));
                    console.error('🚫 Acesso negado pelo servidor:', errorData);
                    this.mostrarErroPermissao();
                    return;
                }
                throw new Error(`Erro HTTP: ${response.status}`);
            }
            
            const resultado = await response.json();
            
            if (resultado.success) {
                this.dadosHistorico = resultado.dados;
                console.log(`✅ Dados históricos carregados via ${resultado.processado_por}`);
                console.log(`📅 Processado em: ${resultado.timestamp}`);
                
                // Log de estatísticas
                Object.keys(this.dadosHistorico).forEach(tipo => {
                    const registros = this.dadosHistorico[tipo].length;
                    console.log(`📊 ${tipo}: ${registros} registros`);
                });
            } else {
                throw new Error('Resposta do servidor indicou falha');
            }
            
        } catch (error) {
            console.error('❌ Erro ao carregar dados históricos do backend:', error);
            console.log('🔄 Usando dados simulados como fallback...');
            
            // Fallback para dados simulados em caso de erro
            this.dadosHistorico = {
                avaliacao: this.gerarDadosAvaliacao(),
                feedback: this.gerarDadosFeedback(),
                humor: this.gerarDadosHumor(),
                colaboradores: this.gerarDadosColaboradores(),
                medias: this.gerarDadosMedias(),
                ranking: this.gerarDadosRanking(),
                resumo: this.gerarDadosResumo(),
                turnover: this.gerarDadosTurnover(),
                pdi: this.gerarDadosPDI(),
                pesquisas: this.gerarDadosPesquisas()
            };
        }
    }

    /**
     * Gera dados simulados para avaliação de desempenho
     */
    gerarDadosAvaliacao() {
        const colaboradores = ['João Silva', 'Maria Santos', 'Pedro Costa', 'Ana Oliveira', 'Carlos Lima'];
        const departamentos = ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'];
        const dados = [];

        for (let i = 0; i < 50; i++) {
            dados.push({
                id: i + 1,
                colaborador: colaboradores[Math.floor(Math.random() * colaboradores.length)],
                departamento: departamentos[Math.floor(Math.random() * departamentos.length)],
                avaliador: colaboradores[Math.floor(Math.random() * colaboradores.length)],
                nota: (Math.random() * 4 + 1).toFixed(1),
                dataAvaliacao: this.gerarDataAleatoria(),
                status: Math.random() > 0.2 ? 'Concluída' : 'Pendente',
                observacoes: 'Avaliação de desempenho trimestral'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para feedbacks
     */
    gerarDadosFeedback() {
        const tipos = ['Positivo', 'Desenvolvimento', 'Sugestão', 'Outros'];
        const categorias = ['Técnico', 'Atendimento', 'Vendas', 'Design', 'Liderança'];
        const dados = [];

        for (let i = 0; i < 100; i++) {
            dados.push({
                id: i + 1,
                remetente: `Colaborador ${i + 1}`,
                destinatario: `Colaborador ${Math.floor(Math.random() * 50) + 1}`,
                tipo: tipos[Math.floor(Math.random() * tipos.length)],
                categoria: categorias[Math.floor(Math.random() * categorias.length)],
                mensagem: `Feedback de exemplo ${i + 1}`,
                dataEnvio: this.gerarDataAleatoria(),
                visualizado: Math.random() > 0.3,
                util: Math.random() > 0.4
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para humor
     */
    gerarDadosHumor() {
        const humores = ['Muito Triste', 'Triste', 'Neutro', 'Feliz', 'Muito Feliz'];
        const dados = [];

        for (let i = 0; i < 200; i++) {
            dados.push({
                id: i + 1,
                colaborador: `Colaborador ${Math.floor(Math.random() * 30) + 1}`,
                humor: humores[Math.floor(Math.random() * humores.length)],
                pontuacao: Math.floor(Math.random() * 5) + 1,
                dataRegistro: this.gerarDataAleatoria(),
                descricao: Math.random() > 0.5 ? 'Descrição do humor' : null
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para colaboradores
     */
    gerarDadosColaboradores() {
        const departamentos = ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'];
        const cargos = ['Analista', 'Gerente', 'Coordenador', 'Supervisor', 'Assistente'];
        const status = ['Ativo', 'Inativo', 'Férias', 'Licença'];
        const dados = [];

        for (let i = 0; i < 80; i++) {
            dados.push({
                id: i + 1,
                nome: `Colaborador ${i + 1}`,
                email: `colaborador${i + 1}@empresa.com`,
                departamento: departamentos[Math.floor(Math.random() * departamentos.length)],
                cargo: cargos[Math.floor(Math.random() * cargos.length)],
                dataAdmissao: this.gerarDataAleatoria(),
                status: status[Math.floor(Math.random() * status.length)],
                salario: (Math.random() * 10000 + 2000).toFixed(2)
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para médias de feedback
     */
    gerarDadosMedias() {
        const departamentos = ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'];
        const dados = [];

        for (let i = 0; i < 20; i++) {
            dados.push({
                id: i + 1,
                departamento: departamentos[Math.floor(Math.random() * departamentos.length)],
                mediaGeral: (Math.random() * 2 + 3).toFixed(1),
                totalFeedbacks: Math.floor(Math.random() * 50) + 10,
                periodo: '2024',
                tendencia: Math.random() > 0.5 ? 'Positiva' : 'Negativa'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para ranking de gamificação
     */
    gerarDadosRanking() {
        const dados = [];

        for (let i = 0; i < 30; i++) {
            dados.push({
                posicao: i + 1,
                colaborador: `Colaborador ${i + 1}`,
                departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][Math.floor(Math.random() * 5)],
                pontos: Math.floor(Math.random() * 1000) + 100,
                lumicoins: Math.floor(Math.random() * 500) + 50,
                atividades: Math.floor(Math.random() * 100) + 10
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para resumo de atividades
     */
    gerarDadosResumo() {
        const dados = [];

        for (let i = 0; i < 12; i++) {
            dados.push({
                id: i + 1,
                mes: this.obterNomeMes(i + 1),
                totalFeedbacks: Math.floor(Math.random() * 200) + 50,
                totalReconhecimentos: Math.floor(Math.random() * 100) + 20,
                totalAvaliacoes: Math.floor(Math.random() * 50) + 10,
                engajamento: (Math.random() * 20 + 70).toFixed(1) + '%'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para turnovers
     */
    gerarDadosTurnover() {
        const dados = [];

        for (let i = 0; i < 15; i++) {
            dados.push({
                id: i + 1,
                colaborador: `Colaborador ${i + 1}`,
                departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][Math.floor(Math.random() * 5)],
                dataSaida: this.gerarDataAleatoria(),
                motivo: ['Demissão', 'Pedido de demissão', 'Aposentadoria', 'Término de contrato'][Math.floor(Math.random() * 4)],
                tempoEmpresa: Math.floor(Math.random() * 60) + 1 + ' meses'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para PDI
     */
    gerarDadosPDI() {
        const status = ['Ativo', 'Concluído', 'Pausado', 'Cancelado'];
        const dados = [];

        for (let i = 0; i < 40; i++) {
            dados.push({
                id: i + 1,
                colaborador: `Colaborador ${i + 1}`,
                objetivo: `Objetivo de desenvolvimento ${i + 1}`,
                status: status[Math.floor(Math.random() * status.length)],
                dataInicio: this.gerarDataAleatoria(),
                dataFim: this.gerarDataAleatoria(),
                progresso: Math.floor(Math.random() * 100) + 1,
                responsavel: `Gestor ${Math.floor(Math.random() * 10) + 1}`
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para pesquisas rápidas
     */
    gerarDadosPesquisas() {
        const tipos = ['Múltipla Escolha', 'Escala', 'Texto Livre'];
        const status = ['Ativa', 'Concluída', 'Pausada'];
        const dados = [];

        for (let i = 0; i < 25; i++) {
            dados.push({
                id: i + 1,
                titulo: `Pesquisa ${i + 1}`,
                tipo: tipos[Math.floor(Math.random() * tipos.length)],
                status: status[Math.floor(Math.random() * status.length)],
                dataInicio: this.gerarDataAleatoria(),
                dataFim: this.gerarDataAleatoria(),
                totalRespostas: Math.floor(Math.random() * 100) + 10,
                departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][Math.floor(Math.random() * 5)]
            });
        }

        return dados;
    }

    /**
     * Gera uma data aleatória
     */
    gerarDataAleatoria() {
        const inicio = new Date(2023, 0, 1);
        const fim = new Date();
        const data = new Date(inicio.getTime() + Math.random() * (fim.getTime() - inicio.getTime()));
        return data.toLocaleDateString('pt-BR');
    }

    /**
     * Obtém o nome do mês
     */
    obterNomeMes(numero) {
        const meses = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        return meses[numero - 1];
    }

    /**
     * Aplica os filtros selecionados
     */
    aplicarFiltros() {
        this.filtrosAtivos.periodo = document.getElementById('historico-periodo')?.value || 'todos';
        this.filtrosAtivos.tipo = document.getElementById('historico-tipo')?.value || 'todos';
        this.filtrosAtivos.departamento = document.getElementById('historico-departamento')?.value || 'todos';

        this.atualizarExibicao();
    }

    /**
     * Atualiza a exibição das seções baseado nos filtros
     */
    atualizarExibicao() {
        const secoes = document.querySelectorAll('.historico-section');
        
        secoes.forEach(secao => {
            const tipoSecao = secao.getAttribute('data-tipo');
            const deveExibir = this.deveExibirSecao(tipoSecao);
            
            if (deveExibir) {
                secao.classList.remove('hidden');
                this.carregarDadosSecao(tipoSecao);
            } else {
                secao.classList.add('hidden');
            }
        });
    }

    /**
     * Verifica se uma seção deve ser exibida baseado nos filtros
     */
    deveExibirSecao(tipoSecao) {
        if (this.filtrosAtivos.tipo === 'todos') {
            return true;
        }
        
        return this.filtrosAtivos.tipo === tipoSecao;
    }

    /**
     * Carrega os dados de uma seção específica
     */
    carregarDadosSecao(tipoSecao) {
        const dados = this.dadosHistorico[tipoSecao];
        if (!dados) return;

        const loadingElement = document.getElementById(`${tipoSecao}-loading`);
        const tableElement = document.getElementById(`${tipoSecao}-table`);

        if (loadingElement) loadingElement.style.display = 'none';
        if (tableElement) {
            tableElement.style.display = 'block';
            this.renderizarTabela(tipoSecao, dados, tableElement);
        }
    }

    /**
     * Renderiza uma tabela com os dados fornecidos
     */
    renderizarTabela(tipoSecao, dados, container) {
        // Verifica se os dados têm a nova estrutura com metadados
        const dadosProcessados = dados.dados || dados;
        const metadados = dados.metadados || {};
        const colunas = metadados.colunas || (dadosProcessados.length > 0 ? Object.keys(dadosProcessados[0]) : []);
        
        const dadosFiltrados = this.filtrarDados(dadosProcessados, tipoSecao);
        
        if (dadosFiltrados.length === 0) {
            container.innerHTML = `
                <div class="historico-empty">
                    <i class="fas fa-inbox"></i>
                    <h4>Nenhum dado encontrado</h4>
                    <p>Não há dados para exibir com os filtros selecionados.</p>
                </div>
            `;
            return;
        }

        // Aplica paginação
        const dadosPaginados = this.paginarDados(dadosFiltrados, tipoSecao);

        // Determina se precisa de scroll horizontal (mais de 6 colunas)
        const precisaScroll = colunas.length > 6;
        const classeScroll = precisaScroll ? 'table-scroll-horizontal' : '';

        let html = `
            <div class="table-wrapper ${classeScroll}">
                <table class="historico-table">
                    <thead>
                        <tr>
                            ${colunas.map(col => `<th>${col}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        dadosPaginados.forEach(item => {
            html += '<tr>';
            colunas.forEach(col => {
                const valor = item[col] || '';
                html += `<td>${valor}</td>`;
            });
            html += '</tr>';
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        // Adiciona controles de paginação
        html += this.renderizarPaginacao(dadosFiltrados.length, tipoSecao);

        container.innerHTML = html;
    }

    /**
     * Pagina os dados para exibição
     */
    paginarDados(dados, tipoSecao) {
        const inicio = (this.paginacao.paginaAtual - 1) * this.paginacao.itensPorPagina;
        const fim = inicio + this.paginacao.itensPorPagina;
        return dados.slice(inicio, fim);
    }

    /**
     * Renderiza os controles de paginação
     */
    renderizarPaginacao(totalItens, tipoSecao) {
        const totalPaginas = Math.ceil(totalItens / this.paginacao.itensPorPagina);
        
        if (totalPaginas <= 1) {
            return '';
        }

        const paginaAtual = this.paginacao.paginaAtual;
        const inicio = (paginaAtual - 1) * this.paginacao.itensPorPagina + 1;
        const fim = Math.min(paginaAtual * this.paginacao.itensPorPagina, totalItens);

        let html = `
            <div class="pagination-container">
                <div class="pagination-info">
                    Mostrando ${inicio}-${fim} de ${totalItens} registros
                </div>
                <div class="pagination-controls">
        `;

        // Botão anterior
        if (paginaAtual > 1) {
            html += `<button class="pagination-btn" onclick="historicoManager.irParaPagina('${tipoSecao}', ${paginaAtual - 1})">
                <i class="fas fa-chevron-left"></i> Anterior
            </button>`;
        }

        // Números das páginas
        const inicioPagina = Math.max(1, paginaAtual - 2);
        const fimPagina = Math.min(totalPaginas, paginaAtual + 2);

        if (inicioPagina > 1) {
            html += `<button class="pagination-btn" onclick="historicoManager.irParaPagina('${tipoSecao}', 1)">1</button>`;
            if (inicioPagina > 2) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
        }

        for (let i = inicioPagina; i <= fimPagina; i++) {
            const classeAtiva = i === paginaAtual ? 'active' : '';
            html += `<button class="pagination-btn ${classeAtiva}" onclick="historicoManager.irParaPagina('${tipoSecao}', ${i})">${i}</button>`;
        }

        if (fimPagina < totalPaginas) {
            if (fimPagina < totalPaginas - 1) {
                html += `<span class="pagination-ellipsis">...</span>`;
            }
            html += `<button class="pagination-btn" onclick="historicoManager.irParaPagina('${tipoSecao}', ${totalPaginas})">${totalPaginas}</button>`;
        }

        // Botão próximo
        if (paginaAtual < totalPaginas) {
            html += `<button class="pagination-btn" onclick="historicoManager.irParaPagina('${tipoSecao}', ${paginaAtual + 1})">
                Próximo <i class="fas fa-chevron-right"></i>
            </button>`;
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    /**
     * Vai para uma página específica
     */
    irParaPagina(tipoSecao, pagina) {
        this.paginacao.paginaAtual = pagina;
        const dados = this.dadosHistorico[tipoSecao];
        if (dados) {
            const container = document.getElementById(`${tipoSecao}-table`);
            if (container) {
                this.renderizarTabela(tipoSecao, dados, container);
            }
        }
    }

    /**
     * Obtém as colunas para cada tipo de tabela
     */
    obterColunasTabela(tipoSecao) {
        const colunas = {
            avaliacao: [
                { campo: 'colaborador', titulo: 'Colaborador', tipo: 'texto' },
                { campo: 'departamento', titulo: 'Departamento', tipo: 'departamento' },
                { campo: 'avaliador', titulo: 'Avaliador', tipo: 'texto' },
                { campo: 'nota', titulo: 'Nota', tipo: 'numero', classe: 'number' },
                { campo: 'dataAvaliacao', titulo: 'Data', tipo: 'data', classe: 'date' },
                { campo: 'status', titulo: 'Status', tipo: 'status', classe: 'status' }
            ],
            feedback: [
                { campo: 'remetente', titulo: 'Remetente', tipo: 'texto' },
                { campo: 'destinatario', titulo: 'Destinatário', tipo: 'texto' },
                { campo: 'tipo', titulo: 'Tipo', tipo: 'texto' },
                { campo: 'categoria', titulo: 'Categoria', tipo: 'texto' },
                { campo: 'dataEnvio', titulo: 'Data Envio', tipo: 'data', classe: 'date' },
                { campo: 'visualizado', titulo: 'Visualizado', tipo: 'boolean' },
                { campo: 'util', titulo: 'Útil', tipo: 'boolean' }
            ],
            humor: [
                { campo: 'colaborador', titulo: 'Colaborador', tipo: 'texto' },
                { campo: 'humor', titulo: 'Humor', tipo: 'texto' },
                { campo: 'pontuacao', titulo: 'Pontuação', tipo: 'numero', classe: 'number' },
                { campo: 'dataRegistro', titulo: 'Data', tipo: 'data', classe: 'date' },
                { campo: 'descricao', titulo: 'Descrição', tipo: 'texto' }
            ],
            colaboradores: [
                { campo: 'nome', titulo: 'Nome', tipo: 'texto' },
                { campo: 'email', titulo: 'Email', tipo: 'texto' },
                { campo: 'departamento', titulo: 'Departamento', tipo: 'departamento' },
                { campo: 'cargo', titulo: 'Cargo', tipo: 'texto' },
                { campo: 'dataAdmissao', titulo: 'Admissão', tipo: 'data', classe: 'date' },
                { campo: 'status', titulo: 'Status', tipo: 'status', classe: 'status' }
            ],
            medias: [
                { campo: 'departamento', titulo: 'Departamento', tipo: 'departamento' },
                { campo: 'mediaGeral', titulo: 'Média Geral', tipo: 'numero', classe: 'number' },
                { campo: 'totalFeedbacks', titulo: 'Total Feedbacks', tipo: 'numero', classe: 'number' },
                { campo: 'periodo', titulo: 'Período', tipo: 'texto' },
                { campo: 'tendencia', titulo: 'Tendência', tipo: 'texto' }
            ],
            ranking: [
                { campo: 'posicao', titulo: 'Posição', tipo: 'numero', classe: 'number' },
                { campo: 'colaborador', titulo: 'Colaborador', tipo: 'texto' },
                { campo: 'departamento', titulo: 'Departamento', tipo: 'departamento' },
                { campo: 'pontos', titulo: 'Pontos', tipo: 'numero', classe: 'number' },
                { campo: 'lumicoins', titulo: 'Lumicoins', tipo: 'numero', classe: 'number' },
                { campo: 'atividades', titulo: 'Atividades', tipo: 'numero', classe: 'number' }
            ],
            resumo: [
                { campo: 'mes', titulo: 'Mês', tipo: 'texto' },
                { campo: 'totalFeedbacks', titulo: 'Total Feedbacks', tipo: 'numero', classe: 'number' },
                { campo: 'totalReconhecimentos', titulo: 'Total Reconhecimentos', tipo: 'numero', classe: 'number' },
                { campo: 'totalAvaliacoes', titulo: 'Total Avaliações', tipo: 'numero', classe: 'number' },
                { campo: 'engajamento', titulo: 'Engajamento', tipo: 'texto' }
            ],
            turnover: [
                { campo: 'colaborador', titulo: 'Colaborador', tipo: 'texto' },
                { campo: 'departamento', titulo: 'Departamento', tipo: 'departamento' },
                { campo: 'dataSaida', titulo: 'Data Saída', tipo: 'data', classe: 'date' },
                { campo: 'motivo', titulo: 'Motivo', tipo: 'texto' },
                { campo: 'tempoEmpresa', titulo: 'Tempo Empresa', tipo: 'texto' }
            ],
            pdi: [
                { campo: 'colaborador', titulo: 'Colaborador', tipo: 'texto' },
                { campo: 'objetivo', titulo: 'Objetivo', tipo: 'texto' },
                { campo: 'status', titulo: 'Status', tipo: 'status', classe: 'status' },
                { campo: 'dataInicio', titulo: 'Data Início', tipo: 'data', classe: 'date' },
                { campo: 'dataFim', titulo: 'Data Fim', tipo: 'data', classe: 'date' },
                { campo: 'progresso', titulo: 'Progresso', tipo: 'numero', classe: 'number' }
            ],
            pesquisas: [
                { campo: 'titulo', titulo: 'Título', tipo: 'texto' },
                { campo: 'tipo', titulo: 'Tipo', tipo: 'texto' },
                { campo: 'status', titulo: 'Status', tipo: 'status', classe: 'status' },
                { campo: 'dataInicio', titulo: 'Data Início', tipo: 'data', classe: 'date' },
                { campo: 'dataFim', titulo: 'Data Fim', tipo: 'data', classe: 'date' },
                { campo: 'totalRespostas', titulo: 'Total Respostas', tipo: 'numero', classe: 'number' }
            ]
        };

        return colunas[tipoSecao] || [];
    }

    /**
     * Filtra os dados baseado nos filtros ativos
     */
    filtrarDados(dados, tipoSecao) {
        let dadosFiltrados = [...dados];

        // Filtro por departamento - busca em várias colunas possíveis
        if (this.filtrosAtivos.departamento !== 'todos') {
            dadosFiltrados = dadosFiltrados.filter(item => {
                // Busca em diferentes possíveis nomes de colunas de departamento
                const possiveisColunasDep = [
                    'Departamento', 'departamento', 'Para Departamento', 'Depto', 'Setor'
                ];
                
                for (let coluna of possiveisColunasDep) {
                    if (item[coluna]) {
                        const valorDep = item[coluna].toString().toLowerCase();
                        if (valorDep.includes(this.filtrosAtivos.departamento.toLowerCase())) {
                            return true;
                        }
                    }
                }
                return false;
            });
        }

        // Filtro por período - busca em várias colunas possíveis de data
        if (this.filtrosAtivos.periodo !== 'todos') {
            dadosFiltrados = dadosFiltrados.filter(item => {
                return this.itemContemAno(item, this.filtrosAtivos.periodo);
            });
        }

        return dadosFiltrados;
    }

    /**
     * Verifica se um item contém o ano especificado em qualquer coluna de data
     */
    itemContemAno(item, ano) {
        // Lista abrangente de possíveis colunas de data
        const possiveisColunasData = [
            'Data', 'data', 'Data Admissão', 'Data de Nascimento', 'Data de Cadastro',
            'Último Acesso', 'Data do turnover', 'Data Ínicio', 'Data Final',
            'Data de criação', 'Última atualização', 
            'Período inicial avaliado da última avaliação de desempenho',
            'Período final avaliado da última avaliação de desempenho'
        ];
        
        for (let coluna of possiveisColunasData) {
            if (item[coluna]) {
                const valorData = item[coluna].toString().trim();
                
                if (valorData && valorData !== '-' && valorData !== 'N/A') {
                    // Extrai ano da data usando diferentes padrões
                    const anosEncontrados = this.extrairAnosDaData(valorData);
                    
                    if (anosEncontrados.includes(ano)) {
                        return true;
                    }
                }
            }
        }
        
        return false; // Se não encontrar o ano em nenhuma coluna de data
    }

    /**
     * Extrai todos os anos possíveis de uma string de data
     */
    extrairAnosDaData(valorData) {
        const anos = [];
        
        // Padrão 1: Anos de 4 dígitos (2020-2030)
        const matchAnos = valorData.match(/20[0-9]{2}/g);
        if (matchAnos) {
            anos.push(...matchAnos);
        }
        
        // Padrão 2: Data no formato DD/MM/YYYY ou DD-MM-YYYY
        const matchDataCompleta = valorData.match(/\d{1,2}[\/\-]\d{1,2}[\/\-](20\d{2})/);
        if (matchDataCompleta) {
            anos.push(matchDataCompleta[1]);
        }
        
        // Padrão 3: Data no formato YYYY-MM-DD
        const matchDataISO = valorData.match(/(20\d{2})\-\d{1,2}\-\d{1,2}/);
        if (matchDataISO) {
            anos.push(matchDataISO[1]);
        }
        
        // Padrão 4: Data no formato MM/YYYY ou MM-YYYY
        const matchMesAno = valorData.match(/\d{1,2}[\/\-](20\d{2})/);
        if (matchMesAno) {
            anos.push(matchMesAno[1]);
        }
        
        // Padrão 5: Apenas ano (YYYY)
        const matchAnoSozinho = valorData.match(/^(20\d{2})$/);
        if (matchAnoSozinho) {
            anos.push(matchAnoSozinho[1]);
        }
        
        // Padrão 6: Data por extenso que contenha ano
        const matchAnoTexto = valorData.match(/\b(20\d{2})\b/);
        if (matchAnoTexto) {
            anos.push(matchAnoTexto[1]);
        }
        
        // Remove duplicatas e filtra anos válidos
        const anosUnicos = [...new Set(anos)].filter(ano => {
            const anoNum = parseInt(ano);
            return anoNum >= 2020 && anoNum <= 2030; // Range válido
        });
        
        return anosUnicos;
    }

    /**
     * Formata um valor baseado no tipo
     */
    formatarValor(valor, tipo) {
        if (valor === null || valor === undefined) return '-';

        switch (tipo) {
            case 'numero':
                return typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor;
            case 'data':
                return valor;
            case 'boolean':
                return valor ? 
                    '<span class="status ativo">Sim</span>' : 
                    '<span class="status inativo">Não</span>';
            case 'status':
                const classe = this.obterClasseStatus(valor);
                return `<span class="status ${classe}">${valor}</span>`;
            case 'departamento':
                const classeDept = this.obterClasseDepartamento(valor);
                return `<span class="department-badge ${classeDept}">${valor}</span>`;
            default:
                return valor;
        }
    }

    /**
     * Obtém a classe CSS para um status
     */
    obterClasseStatus(status) {
        const statusMap = {
            'Ativo': 'ativo',
            'Inativo': 'inativo',
            'Pendente': 'pendente',
            'Concluído': 'concluido',
            'Concluída': 'concluido',
            'Ativa': 'ativo',
            'Pausada': 'pendente',
            'Cancelado': 'inativo'
        };
        return statusMap[status] || 'neutral';
    }

    /**
     * Obtém a classe CSS para um departamento
     */
    obterClasseDepartamento(departamento) {
        const deptMap = {
            'RH': 'department-rh',
            'TI': 'department-ti',
            'Vendas': 'department-vendas',
            'Financeiro': 'department-financeiro',
            'Operações': 'department-operacoes'
        };
        return deptMap[departamento] || '';
    }

    /**
     * Alterna a exibição de uma seção
     */
    toggleSecao(secao) {
        secao.classList.toggle('collapsed');
    }

    /**
     * Exporta dados de uma seção específica
     */
    exportHistoricoData(tipoSecao) {
        const dados = this.dadosHistorico[tipoSecao];
        if (!dados) {
            this.mostrarNotificacao('Nenhum dado disponível para exportar', 'warning');
            return;
        }

        // Verifica se os dados têm a nova estrutura com metadados
        const dadosProcessados = dados.dados || dados;
        const metadados = dados.metadados || {};
        
        if (!dadosProcessados || dadosProcessados.length === 0) {
            this.mostrarNotificacao('Nenhum dado disponível para exportar', 'warning');
            return;
        }

        try {
            const dadosFiltrados = this.filtrarDados(dadosProcessados, tipoSecao);
            // Usa as colunas dos metadados ou obtém dinamicamente
            const colunas = metadados.colunas || (dadosProcessados.length > 0 ? Object.keys(dadosProcessados[0]) : []);
            
            // Cria CSV com encoding UTF-8 e BOM para compatibilidade com Excel
            let csv = '\uFEFF'; // BOM para UTF-8
            csv += colunas.map(col => this.escapeCSV(col)).join(',') + '\n';
            
            dadosFiltrados.forEach(item => {
                const linha = colunas.map(col => {
                    const valor = item[col] || '';
                    return this.escapeCSV(valor);
                }).join(',');
                csv += linha + '\n';
            });

            // Download do arquivo
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            
            // Nome do arquivo com data e hora
            const agora = new Date();
            const dataHora = agora.toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                           agora.toTimeString().split(' ')[0].replace(/:/g, '-');
            link.setAttribute('download', `historico_${tipoSecao}_${dataHora}.csv`);
            
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            // Limpa o URL
            setTimeout(() => URL.revokeObjectURL(url), 100);
            
            this.mostrarNotificacao(`Dados de ${tipoSecao} exportados com sucesso! (${dadosFiltrados.length} registros)`, 'success');
            
        } catch (error) {
            console.error('Erro ao exportar dados:', error);
            this.mostrarNotificacao('Erro ao exportar dados', 'error');
        }
    }

    /**
     * Escapa valores para CSV
     * @param {*} value - Valor a ser escapado
     * @returns {string} - Valor escapado
     */
    escapeCSV(value) {
        if (value === null || value === undefined) return '';
        
        const str = String(value);
        
        // Se contém vírgula, quebra de linha ou aspas, envolve em aspas
        if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        
        return str;
    }

    /**
     * Mostra notificação para o usuário
     * @param {string} mensagem - Mensagem a ser exibida
     * @param {string} tipo - Tipo da notificação (success, warning, error)
     */
    mostrarNotificacao(mensagem, tipo = 'info') {
        // Remove notificação anterior se existir
        const notificacaoAnterior = document.querySelector('.historico-notification');
        if (notificacaoAnterior) {
            notificacaoAnterior.remove();
        }

        // Cria nova notificação
        const notificacao = document.createElement('div');
        notificacao.className = `historico-notification historico-notification-${tipo}`;
        notificacao.innerHTML = `
            <i class="fas fa-${tipo === 'success' ? 'check-circle' : tipo === 'warning' ? 'exclamation-triangle' : tipo === 'error' ? 'times-circle' : 'info-circle'}"></i>
            <span>${mensagem}</span>
        `;

        // Adiciona ao DOM
        document.body.appendChild(notificacao);

        // Remove após 3 segundos
        setTimeout(() => {
            if (notificacao.parentNode) {
                notificacao.remove();
            }
        }, 3000);
    }

    /**
     * Mostra uma mensagem de erro
     */
    mostrarErro(mensagem) {
        console.error(mensagem);
        // Em produção, isso mostraria uma notificação para o usuário
    }
}

// Funções globais para compatibilidade
window.loadHistoricoData = function() {
    if (window.historicoManager) {
        window.historicoManager.aplicarFiltros();
    }
};

window.exportHistoricoData = function(tipoSecao) {
    if (window.historicoManager) {
        window.historicoManager.exportHistoricoData(tipoSecao);
    }
};

// Inicializa o módulo quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', function() {
    window.historicoManager = new HistoricoManager();
});

// Função global para navegação de páginas
window.irParaPagina = function(tipoSecao, pagina) {
    if (window.historicoManager) {
        window.historicoManager.irParaPagina(tipoSecao, pagina);
    }
};
