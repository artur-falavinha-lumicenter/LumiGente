let colaboradores = [];
let avaliacoesGestor = [];
let avaliacoesColaborador = [];

document.addEventListener('DOMContentLoaded', function () {
    console.log('DOM carregado, inicializando sistema de avaliações...');
    console.log('Verificando elementos da página...');

    // Verificar se os elementos existem
    const templatePadrao = document.getElementById('template-padrao');
    const templatePersonalizado = document.getElementById('template-personalizado');
    const templateOptions = document.querySelector('.template-options');

    console.log('Template padrão:', templatePadrao);
    console.log('Template personalizado:', templatePersonalizado);
    console.log('Template options:', templateOptions);

    carregarColaboradores();
    carregarAvaliacoesGestor();
    carregarAvaliacoesColaborador();

    // Carregar colaboradores para ambos os formulários
    carregarColaboradoresPersonalizado();

    // Garantir que o template padrão seja exibido inicialmente

    if (templatePadrao) {
        templatePadrao.style.setProperty('display', 'block', 'important');
        console.log('Template padrão exibido');
    } else {
        console.error('Template padrão não encontrado');
    }

    if (templatePersonalizado) {
        templatePersonalizado.style.setProperty('display', 'none', 'important');
        console.log('Template personalizado escondido');
    } else {
        console.error('Template personalizado não encontrado');
    }

    // Forçar reflow e verificar se os templates estão visíveis
    setTimeout(() => {
        console.log('Verificando visibilidade dos templates...');
        console.log('Template padrão display:', templatePadrao ? getComputedStyle(templatePadrao).display : 'não encontrado');
        console.log('Template personalizado display:', templatePersonalizado ? getComputedStyle(templatePersonalizado).display : 'não encontrado');

        // Se o template padrão não estiver visível, forçar
        if (templatePadrao && getComputedStyle(templatePadrao).display === 'none') {
            console.log('Forçando exibição do template padrão...');
            templatePadrao.style.setProperty('display', 'block', 'important');
        }

        // Verificar se o template padrão está visível
        if (templatePadrao) {
            const isVisible = getComputedStyle(templatePadrao).display !== 'none';
            console.log('Template padrão está visível:', isVisible);

            if (!isVisible) {
                console.log('Tentando corrigir visibilidade do template padrão...');
                templatePadrao.style.setProperty('display', 'block', 'important');
                templatePadrao.style.setProperty('opacity', '1', 'important');
                templatePadrao.style.setProperty('visibility', 'visible', 'important');
                templatePadrao.style.setProperty('position', 'relative', 'important');
                templatePadrao.style.setProperty('z-index', '1', 'important');
            }
        }

        // Verificar se o template personalizado está escondido
        if (templatePersonalizado) {
            const isHidden = getComputedStyle(templatePersonalizado).display === 'none';
            console.log('Template personalizado está escondido:', isHidden);

            if (!isHidden) {
                console.log('Tentando esconder template personalizado...');
                templatePersonalizado.style.setProperty('display', 'none', 'important');
                templatePersonalizado.style.setProperty('opacity', '0', 'important');
                templatePersonalizado.style.setProperty('visibility', 'hidden', 'important');
                templatePersonalizado.style.setProperty('position', 'absolute', 'important');
                templatePersonalizado.style.setProperty('z-index', '-1', 'important');
            }
        }
    }, 100);
});

function showTab(tabName) {
    // Esconder todas as tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });

    // Mostrar tab selecionada
    document.getElementById(`tab-${tabName}`).classList.add('active');

    // Ativar a tab clicada
    const clickedTab = event.target.closest('.tab');
    if (clickedTab) {
        clickedTab.classList.add('active');
    }
}

async function carregarColaboradores() {
    try {
        console.log('🔄 Carregando colaboradores reais do sistema...');

        // Buscar usuários reais da API do sistema
        const response = await fetch('/api/users/feedback');
        if (response.ok) {
            const users = await response.json();

            // Converter para o formato esperado pelo sistema de avaliações
            // Filtrar usuário atual (não pode avaliar a si mesmo)
            const currentUserId = await getCurrentUserId();
            colaboradores = users
                .filter(user => !currentUserId || user.userId !== currentUserId) // Excluir usuário atual se disponível
                .map(user => ({
                    id: user.userId,
                    nome: user.nomeCompleto,
                    departamento: user.departamento,
                    cargo: user.cargo
                }));

            console.log(`✅ ${colaboradores.length} colaboradores carregados do sistema real`);
            console.log('Primeiros colaboradores:', colaboradores.slice(0, 3));

            // Carregar colaboradores no select pesquisável após um delay
            setTimeout(carregarColaboradoresSelect, 200);
        } else {
            throw new Error(`API retornou status ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar colaboradores reais:', error);
        showError('Erro ao carregar colaboradores do sistema', 'gestor');

        // Fallback: tentar criar lista básica se a API falhar
        try {
            console.log('🔄 Tentando fallback para lista básica...');
            const fallbackResponse = await fetch('/api/users');
            if (fallbackResponse.ok) {
                const fallbackUsers = await fallbackResponse.json();
                colaboradores = fallbackUsers.map(user => ({
                    id: user.Id || user.id,
                    nome: user.NomeCompleto || user.nome || 'Nome não informado',
                    departamento: user.Departamento || user.departamento || 'Departamento não informado'
                }));
                console.log(`✅ ${colaboradores.length} colaboradores carregados do fallback`);
                setTimeout(carregarColaboradoresSelect, 200);
            }
        } catch (fallbackError) {
            console.error('❌ Fallback também falhou:', fallbackError);
            showError('Não foi possível carregar colaboradores do sistema', 'gestor');
        }
    }
}

async function carregarAvaliacoesGestor() {
    try {
        document.getElementById('loadingGestor').style.display = 'block';

        const response = await fetch('/api/avaliacoes/gestor');
        avaliacoesGestor = await response.json();

        renderizarAvaliacoesGestor();
    } catch (error) {
        console.error('Erro ao carregar avaliações:', error);
        showError('Erro ao carregar avaliações', 'gestor');
    } finally {
        document.getElementById('loadingGestor').style.display = 'none';
    }
}

async function carregarAvaliacoesColaborador() {
    try {
        document.getElementById('loadingColaborador').style.display = 'block';

        const response = await fetch('/api/avaliacoes/colaborador');
        avaliacoesColaborador = await response.json();

        renderizarAvaliacoesColaborador();
    } catch (error) {
        console.error('Erro ao carregar avaliações:', error);
        showError('Erro ao carregar avaliações', 'colaborador');
    } finally {
        document.getElementById('loadingColaborador').style.display = 'none';
    }
}

function renderizarAvaliacoesGestor() {
    const container = document.getElementById('avaliacoesGestor');

    if (avaliacoesGestor.length === 0) {
        container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-clipboard-list"></i>
                        <h3>Nenhuma avaliação encontrada</h3>
                        <p>Crie uma nova avaliação para começar</p>
                    </div>
                `;
        return;
    }

    container.innerHTML = avaliacoesGestor.map(avaliacao => `
                <div class="avaliacao-card">
                    <div class="avaliacao-header">
                        <span class="avaliacao-tipo">${avaliacao.tipo_avaliacao === '45_dias' ? '45 Dias' : '90 Dias'}</span>
                        <span class="avaliacao-status status-${avaliacao.status.toLowerCase()}">${getStatusText(avaliacao.status)}</span>
                    </div>
                    
                    <div class="avaliacao-info">
                        <h4>${getColaboradorNome(avaliacao.colaborador_id)}</h4>
                        <p><strong>Data Limite:</strong> ${formatarData(avaliacao.data_limite)}</p>
                        <p><strong>Criada em:</strong> ${formatarData(avaliacao.data_criacao)}</p>
                        ${avaliacao.observacoes_gestor ? `<p><strong>Observações:</strong> ${avaliacao.observacoes_gestor}</p>` : ''}
                    </div>
                    
                    <div class="avaliacao-actions">
                        ${avaliacao.status === 'Pendente' ? `
                            <button class="btn btn-warning btn-small" onclick="enviarLembrete(${avaliacao.id})">
                                <i class="fas fa-bell"></i> Lembrete
                            </button>
                        ` : ''}
                        
                        ${avaliacao.status === 'Autoavaliacao_Concluida' ? `
                            <button class="btn btn-primary btn-small" onclick="realizarAvaliacao(${avaliacao.id})">
                                <i class="fas fa-edit"></i> Avaliar
                            </button>
                        ` : ''}
                        
                        <button class="btn btn-secondary btn-small" onclick="verDetalhes(${avaliacao.id})">
                            <i class="fas fa-eye"></i> Detalhes
                        </button>
                    </div>
                </div>
            `).join('');
}

function renderizarAvaliacoesColaborador() {
    const container = document.getElementById('avaliacoesColaborador');

    if (avaliacoesColaborador.length === 0) {
        container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-clipboard-list"></i>
                        <h3>Nenhuma avaliação pendente</h3>
                        <p>Você não possui avaliações para responder no momento</p>
                    </div>
                `;
        return;
    }

    container.innerHTML = avaliacoesColaborador.map(avaliacao => `
                <div class="avaliacao-card">
                    <div class="avaliacao-header">
                        <span class="avaliacao-tipo">${avaliacao.tipo_avaliacao === '45_dias' ? '45 Dias' : '90 Dias'}</span>
                        <span class="avaliacao-status status-${avaliacao.status.toLowerCase()}">${getStatusText(avaliacao.status)}</span>
                    </div>
                    
                    <div class="avaliacao-info">
                        <h4>Avaliação de ${avaliacao.tipo_avaliacao === '45_dias' ? '45' : '90'} dias</h4>
                        <p><strong>Data Limite:</strong> ${formatarData(avaliacao.data_limite)}</p>
                        <p><strong>Criada em:</strong> ${formatarData(avaliacao.data_criacao)}</p>
                        ${avaliacao.observacoes_gestor ? `<p><strong>Observações:</strong> ${avaliacao.observacoes_gestor}</p>` : ''}
                    </div>
                    
                    <div class="avaliacao-actions">
                        ${avaliacao.status === 'Pendente' ? `
                            <button class="btn btn-primary btn-small" onclick="realizarAutoavaliacao(${avaliacao.id})">
                                <i class="fas fa-edit"></i> Autoavaliação
                            </button>
                        ` : ''}
                        
                        <button class="btn btn-secondary btn-small" onclick="verDetalhes(${avaliacao.id})">
                            <i class="fas fa-eye"></i> Detalhes
                        </button>
                    </div>
                </div>
            `).join('');
}

// Função de teste para verificar templates
function testarTemplates() {
    console.log('=== TESTE DE TEMPLATES ===');

    const templatePadrao = document.getElementById('template-padrao');
    const templatePersonalizado = document.getElementById('template-personalizado');

    console.log('Template padrão encontrado:', !!templatePadrao);
    console.log('Template personalizado encontrado:', !!templatePersonalizado);

    if (templatePadrao) {
        console.log('Template padrão display:', getComputedStyle(templatePadrao).display);
        console.log('Template padrão visibility:', getComputedStyle(templatePadrao).visibility);
        console.log('Template padrão opacity:', getComputedStyle(templatePadrao).opacity);
        console.log('Template padrão position:', getComputedStyle(templatePadrao).position);
        console.log('Template padrão z-index:', getComputedStyle(templatePadrao).zIndex);
    }

    if (templatePersonalizado) {
        console.log('Template personalizado display:', getComputedStyle(templatePersonalizado).display);
        console.log('Template personalizado visibility:', getComputedStyle(templatePersonalizado).visibility);
        console.log('Template personalizado opacity:', getComputedStyle(templatePersonalizado).opacity);
        console.log('Template personalizado position:', getComputedStyle(templatePersonalizado).position);
        console.log('Template personalizado z-index:', getComputedStyle(templatePersonalizado).zIndex);
    }

    // Testar se os templates estão funcionando
    console.log('Testando seleção de templates...');
    selecionarTemplate('padrao', { target: document.querySelector('.btn-outline-primary') });

    setTimeout(() => {
        console.log('Verificando após seleção...');
        if (templatePadrao) {
            console.log('Template padrão display após seleção:', getComputedStyle(templatePadrao).display);
            console.log('Template padrão visibility após seleção:', getComputedStyle(templatePadrao).visibility);
            console.log('Template padrão opacity após seleção:', getComputedStyle(templatePadrao).opacity);
            console.log('Template padrão position após seleção:', getComputedStyle(templatePadrao).position);
            console.log('Template padrão z-index após seleção:', getComputedStyle(templatePadrao).zIndex);
        }
    }, 100);

    // Testar também o template personalizado
    setTimeout(() => {
        console.log('Testando template personalizado...');
        selecionarTemplate('personalizado', { target: document.querySelector('.btn-outline-secondary') });

        setTimeout(() => {
            console.log('Verificando template personalizado após seleção...');
            if (templatePersonalizado) {
                console.log('Template personalizado display após seleção:', getComputedStyle(templatePersonalizado).display);
                console.log('Template personalizado visibility após seleção:', getComputedStyle(templatePersonalizado).visibility);
                console.log('Template personalizado opacity após seleção:', getComputedStyle(templatePersonalizado).opacity);
                console.log('Template personalizado position após seleção:', getComputedStyle(templatePersonalizado).position);
                console.log('Template personalizado z-index após seleção:', getComputedStyle(templatePersonalizado).zIndex);
            }
        }, 100);
    }, 300);

    console.log('=== FIM DO TESTE ===');
}

// Funções para gerenciar templates
function selecionarTemplate(tipo, event) {
    console.log('Selecionando template:', tipo);

    // Esconder todos os templates
    document.querySelectorAll('.template-content').forEach(template => {
        if (tipo === 'padrao') {
            template.style.setProperty('display', 'none', 'important');
            template.style.setProperty('opacity', '0', 'important');
            template.style.setProperty('visibility', 'hidden', 'important');
            template.style.setProperty('position', 'absolute', 'important');
            template.style.setProperty('z-index', '-1', 'important');
        } else {
            template.style.setProperty('display', 'none', 'important');
            template.style.setProperty('opacity', '0', 'important');
            template.style.setProperty('visibility', 'hidden', 'important');
            template.style.setProperty('position', 'absolute', 'important');
            template.style.setProperty('z-index', '-1', 'important');
        }
        console.log('Escondendo template:', template.id);
    });

    // Remover classe active de todos os botões
    document.querySelectorAll('.template-buttons button').forEach(btn => {
        btn.classList.remove('active');
    });

    // Mostrar template selecionado
    const templateSelecionado = document.getElementById(`template-${tipo}`);
    if (templateSelecionado) {
        if (tipo === 'padrao') {
            templateSelecionado.style.setProperty('display', 'block', 'important');
            templateSelecionado.style.setProperty('opacity', '1', 'important');
            templateSelecionado.style.setProperty('visibility', 'visible', 'important');
            templateSelecionado.style.setProperty('position', 'relative', 'important');
            templateSelecionado.style.setProperty('z-index', '1', 'important');
        } else {
            templateSelecionado.style.setProperty('display', 'block', 'important');
            templateSelecionado.style.setProperty('opacity', '1', 'important');
            templateSelecionado.style.setProperty('visibility', 'visible', 'important');
            templateSelecionado.style.setProperty('position', 'relative', 'important');
            templateSelecionado.style.setProperty('z-index', '1', 'important');
        }
        console.log('Mostrando template:', templateSelecionado.id);

        // Forçar reflow
        templateSelecionado.offsetHeight;
    } else {
        console.error('Template não encontrado:', `template-${tipo}`);
    }

    // Ativar botão selecionado
    if (event && event.target) {
        event.target.classList.add('active');
    }

    // Verificar se funcionou
    setTimeout(() => {
        console.log('Verificando se a mudança funcionou...');
        console.log('Template selecionado display:', getComputedStyle(templateSelecionado).display);
    }, 50);
}

function adicionarPergunta() {
    const container = document.getElementById('perguntasContainer');
    const perguntaNum = container.children.length + 1;

    const perguntaDiv = document.createElement('div');
    perguntaDiv.className = 'pergunta-item';
    perguntaDiv.innerHTML = `
                <div class="pergunta-header">
                    <span class="pergunta-numero">Pergunta ${perguntaNum}</span>
                    <button type="button" class="remover-pergunta" onclick="removerPergunta(this)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="categoria_${perguntaNum}">Categoria *</label>
                        <input type="text" id="categoria_${perguntaNum}" name="categoria_${perguntaNum}" placeholder="Ex: Integração, Adaptação, Valores..." required>
                    </div>
                    
                    <div class="form-group">
                        <label for="tipo_${perguntaNum}">Tipo de Resposta *</label>
                        <select id="tipo_${perguntaNum}" name="tipo_${perguntaNum}" required>
                            <option value="">Selecione o tipo...</option>
                            <option value="escala">Escala (1-10)</option>
                            <option value="texto">Texto livre</option>
                            <option value="sim_nao">Sim/Não</option>
                            <option value="multipla_escolha">Múltipla escolha</option>
                        </select>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="pergunta_${perguntaNum}">Pergunta *</label>
                    <textarea id="pergunta_${perguntaNum}" name="pergunta_${perguntaNum}" rows="3" placeholder="Digite a pergunta..." required></textarea>
                </div>
                
                <div class="form-group">
                    <label for="ordem_${perguntaNum}">Ordem</label>
                    <input type="number" id="ordem_${perguntaNum}" name="ordem_${perguntaNum}" value="${perguntaNum}" min="1">
                </div>
            `;

    container.appendChild(perguntaDiv);
}

function removerPergunta(button) {
    button.closest('.pergunta-item').remove();
    // Renumerar perguntas restantes
    const perguntas = document.querySelectorAll('.pergunta-item');
    perguntas.forEach((pergunta, index) => {
        const numero = pergunta.querySelector('.pergunta-numero');
        numero.textContent = `Pergunta ${index + 1}`;

        const ordem = pergunta.querySelector('input[name^="ordem_"]');
        if (ordem) ordem.value = index + 1;
    });
}

async function carregarColaboradoresPersonalizado() {
    try {
        // Esta função não é mais necessária pois os colaboradores são carregados
        // automaticamente na função carregarColaboradoresSelect()
        // Mantida para compatibilidade
    } catch (error) {
        console.error('Erro ao carregar colaboradores para avaliação personalizada:', error);
    }
}

// Formulário de criação de avaliação com template padrão
document.getElementById('formCriarAvaliacao').addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = new FormData(this);
    const data = {
        colaborador_id: parseInt(formData.get('colaborador_id')),
        tipo_avaliacao: formData.get('tipo_avaliacao'),
        data_limite: formData.get('data_limite'),
        observacoes_gestor: formData.get('observacoes_gestor'),
        template: 'padrao', // Indica que é o template padrão
        perguntas: templateAtual // Usar o template atual (editado ou original)
    };

    try {
        // Se o template foi editado, usar a rota de avaliação personalizada
        const url = templateAtual !== templatePadraoOriginal ? '/api/avaliacoes/personalizada' : '/api/avaliacoes';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            const mensagem = templateAtual !== templatePadraoOriginal
                ? 'Avaliação criada com sucesso usando o template editado!'
                : 'Avaliação criada com sucesso usando o template padrão!';
            showSuccess(mensagem, 'gestor');
            this.reset();
            carregarAvaliacoesGestor();
        } else {
            showError('Erro ao criar avaliação: ' + result.error, 'gestor');
        }
    } catch (error) {
        console.error('Erro ao criar avaliação:', error);
        showError('Erro ao criar avaliação', 'gestor');
    }
});

// Formulário de criação de avaliação personalizada
document.getElementById('formAvaliacaoPersonalizada').addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = new FormData(this);
    const data = {
        colaborador_id: parseInt(formData.get('colaborador_id')),
        tipo_avaliacao: formData.get('tipo_avaliacao'),
        data_limite: formData.get('data_limite'),
        observacoes_gestor: formData.get('observacoes_gestor'),
        titulo: formData.get('titulo'),
        descricao: formData.get('descricao'),
        template: 'personalizado',
        perguntas: []
    };

    // Coletar perguntas personalizadas
    const perguntas = document.querySelectorAll('.pergunta-item');
    perguntas.forEach((pergunta, index) => {
        const categoria = pergunta.querySelector('input[name^="categoria_"]').value;
        const tipo = pergunta.querySelector('select[name^="tipo_"]').value;
        const perguntaTexto = pergunta.querySelector('textarea[name^="pergunta_"]').value;
        const ordem = pergunta.querySelector('input[name^="ordem_"]').value;

        if (categoria && tipo && perguntaTexto) {
            data.perguntas.push({
                categoria: categoria,
                tipo: tipo,
                pergunta: perguntaTexto,
                ordem: parseInt(ordem)
            });
        }
    });

    if (data.perguntas.length === 0) {
        showError('Adicione pelo menos uma pergunta para criar a avaliação personalizada', 'gestor');
        return;
    }

    try {
        const response = await fetch('/api/avaliacoes/personalizada', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Avaliação personalizada criada com sucesso!', 'gestor');
            this.reset();
            document.getElementById('perguntasContainer').innerHTML = '';
            carregarAvaliacoesGestor();
        } else {
            showError('Erro ao criar avaliação personalizada: ' + result.error, 'gestor');
        }
    } catch (error) {
        console.error('Erro ao criar avaliação personalizada:', error);
        showError('Erro ao criar avaliação personalizada', 'gestor');
    }
});

// Funções auxiliares
function getStatusText(status) {
    const statusMap = {
        'Pendente': 'Pendente',
        'Autoavaliacao_Concluida': 'Autoavaliação Concluída',
        'Concluida': 'Concluída'
    };
    return statusMap[status] || status;
}

function getColaboradorNome(id) {
    const colaborador = colaboradores.find(c => c.id === id);
    if (!colaborador) return 'Colaborador não encontrado';

    // Retornar nome com departamento se disponível
    return colaborador.departamento ?
        `${colaborador.nome} - ${colaborador.departamento}` :
        colaborador.nome;
}

function formatarData(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    return data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function showError(message, tab) {
    const errorDiv = document.getElementById(`errorMessage${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';

    const successDiv = document.getElementById(`successMessage${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    successDiv.style.display = 'none';
}

function showSuccess(message, tab) {
    const successDiv = document.getElementById(`successMessage${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    successDiv.textContent = message;
    successDiv.style.display = 'block';

    const errorDiv = document.getElementById(`errorMessage${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    errorDiv.style.display = 'none';
}

// Funções das ações (serão implementadas)
function enviarLembrete(avaliacaoId) {
    showSuccess('Lembrete enviado com sucesso!', 'gestor');
}

function realizarAvaliacao(avaliacaoId) {
    // Abrir modal ou página de avaliação
    showSuccess('Redirecionando para avaliação...', 'gestor');
}

function realizarAutoavaliacao(avaliacaoId) {
    // Abrir modal ou página de autoavaliação
    showSuccess('Redirecionando para autoavaliação...', 'colaborador');
}

function verDetalhes(avaliacaoId) {
    // Abrir modal ou página de detalhes
    showSuccess('Carregando detalhes...', 'gestor');
}

// Função para mostrar/ocultar as perguntas do template padrão
function mostrarPerguntasTemplate() {
    const previewDiv = document.getElementById('perguntasTemplatePreview');
    const button = event.target;

    if (previewDiv.style.display === 'none') {
        previewDiv.style.display = 'block';
        button.innerHTML = '<i class="fas fa-eye-slash"></i> Ocultar Perguntas do Template';
        button.classList.remove('btn-outline-primary');
        button.classList.add('btn-outline-secondary');
    } else {
        previewDiv.style.display = 'none';
        button.innerHTML = '<i class="fas fa-eye"></i> Ver Perguntas do Template';
        button.classList.remove('btn-outline-secondary');
        button.classList.add('btn-outline-primary');
    }
}

// Template padrão original (para restaurar se necessário)
const templatePadraoOriginal = [
    {
        categoria: 'Integração',
        texto: 'É acessível e acolhedor com todas as pessoas, tratando a todos com respeito e cordialidade.',
        tipo: 'escala'
    },
    {
        categoria: 'Adaptação',
        texto: 'É pontual no cumprimento de sua jornada de trabalho (faltas, atrasos ou saídas antecipadas).',
        tipo: 'escala'
    },
    {
        categoria: 'Adaptação',
        texto: 'Identifica oportunidades que contribuam para o desenvolvimento do Setor.',
        tipo: 'escala'
    },
    {
        categoria: 'Adaptação',
        texto: 'Mantém a calma frente a diversidade do ambiente e à novos desafios, buscando interagir de forma adequada às mudanças.',
        tipo: 'escala'
    },
    {
        categoria: 'Valores',
        texto: 'É respeitoso com as pessoas contribuindo com um ambiente de trabalho saudável.',
        tipo: 'escala'
    },
    {
        categoria: 'Valores',
        texto: 'Tem caráter inquestionável, age com honestidade e integridade no relacionamento com gestores, colegas, prestadores de serviço, fornecedores e demais profissionais que venha a ter contato na empresa.',
        tipo: 'escala'
    },
    {
        categoria: 'Valores',
        texto: 'Exerce suas atividades com transparência e estrita observância às leis, aos princípios e as diretrizes da empresa.',
        tipo: 'escala'
    },
    {
        categoria: 'Orientação para resultados',
        texto: 'Mantém a produtividade e a motivação diante de situações sobre pressão.',
        tipo: 'escala'
    },
    {
        categoria: 'Orientação para resultados',
        texto: 'Age com engajamento para atingir os objetivos e metas.',
        tipo: 'escala'
    },
    {
        categoria: 'Orientação para resultados',
        texto: 'Capacidade para concretizar as tarefas que lhe são solicitadas, com o alcance de objetivos e de forma comprometida com o resultado de seu Setor.',
        tipo: 'escala'
    }
];

// Template atual (pode ser editado)
let templateAtual = JSON.parse(JSON.stringify(templatePadraoOriginal));

// Função para editar o template padrão
function editarTemplatePadrao() {
    const previewDiv = document.getElementById('perguntasTemplatePreview');
    const editorDiv = document.getElementById('editorTemplatePadrao');
    const editButton = event.target;

    // Esconder a prévia e mostrar o editor
    previewDiv.style.display = 'none';
    editorDiv.style.display = 'block';

    // Alterar o botão de editar
    editButton.innerHTML = '<i class="fas fa-eye"></i> Ver Template';
    editButton.classList.remove('btn-outline-warning');
    editButton.classList.add('btn-outline-primary');
    editButton.onclick = mostrarTemplateEditado;

    // Carregar as perguntas editáveis
    carregarPerguntasEditaveis();
}

// Função para mostrar o template editado
function mostrarTemplateEditado() {
    const previewDiv = document.getElementById('perguntasTemplatePreview');
    const editorDiv = document.getElementById('editorTemplatePadrao');
    const editButton = event.target;

    // Esconder o editor e mostrar a prévia
    editorDiv.style.display = 'none';
    previewDiv.style.display = 'block';

    // Restaurar o botão de editar
    editButton.innerHTML = '<i class="fas fa-edit"></i> Editar Template';
    editButton.classList.remove('btn-outline-primary');
    editButton.classList.add('btn-outline-warning');
    editButton.onclick = editarTemplatePadrao;

    // Atualizar a prévia com as perguntas editadas
    atualizarPreviaTemplate();
}

// Função para carregar as perguntas editáveis
function carregarPerguntasEditaveis() {
    const container = document.getElementById('perguntasEditaveis');
    container.innerHTML = '';

    templateAtual.forEach((pergunta, index) => {
        const perguntaDiv = document.createElement('div');
        perguntaDiv.className = 'pergunta-editavel';
        perguntaDiv.innerHTML = `
                    <div class="pergunta-editavel-header">
                        <span class="pergunta-editavel-numero">${index + 1}</span>
                        <span class="pergunta-editavel-categoria">${pergunta.categoria}</span>
                    </div>
                    <textarea 
                        class="pergunta-editavel-texto" 
                        data-index="${index}"
                        placeholder="Digite a pergunta..."
                    >${pergunta.texto}</textarea>
                `;

        // Adicionar evento para salvar automaticamente as mudanças
        const textarea = perguntaDiv.querySelector('textarea');
        textarea.addEventListener('input', function () {
            const index = parseInt(this.dataset.index);
            templateAtual[index].texto = this.value;
        });

        container.appendChild(perguntaDiv);
    });
}

// Função para atualizar a prévia do template
function atualizarPreviaTemplate() {
    const previewDiv = document.getElementById('perguntasTemplatePreview');

    // Atualizar as perguntas na prévia
    const perguntasItems = previewDiv.querySelectorAll('.pergunta-item .pergunta-texto');
    templateAtual.forEach((pergunta, index) => {
        if (perguntasItems[index]) {
            perguntasItems[index].textContent = pergunta.texto;
        }
    });

    // Atualizar o status visual do template
    atualizarStatusTemplate();
}

// Função para atualizar o status visual do template
function atualizarStatusTemplate() {
    const statusElement = document.getElementById('templateStatus');
    const isEditado = templateAtual !== templatePadraoOriginal;

    if (isEditado) {
        statusElement.textContent = 'Editado';
        statusElement.className = 'template-status editado';
    } else {
        statusElement.textContent = 'Original';
        statusElement.className = 'template-status';
    }
}

// Função para salvar o template editado
function salvarTemplateEditado() {
    // Validar se todas as perguntas têm texto
    const perguntasVazias = templateAtual.filter(p => !p.texto.trim());
    if (perguntasVazias.length > 0) {
        alert('Todas as perguntas devem ter texto. Verifique as perguntas vazias.');
        return;
    }

    // Salvar o template editado
    localStorage.setItem('templatePadraoEditado', JSON.stringify(templateAtual));

    // Mostrar mensagem de sucesso
    showSuccess('Template editado salvo com sucesso!', 'gestor');

    // Voltar para a visualização
    mostrarTemplateEditado();
}

// Função para cancelar a edição do template
function cancelarEdicaoTemplate() {
    // Restaurar o template original
    templateAtual = JSON.parse(JSON.stringify(templatePadraoOriginal));

    // Voltar para a visualização
    mostrarTemplateEditado();

    showSuccess('Edição cancelada. Template restaurado ao original.', 'gestor');
}

// Função para carregar template salvo ao inicializar
function carregarTemplateSalvo() {
    const templateSalvo = localStorage.getItem('templatePadraoEditado');
    if (templateSalvo) {
        try {
            templateAtual = JSON.parse(templateSalvo);
            console.log('Template editado carregado do localStorage');
        } catch (error) {
            console.error('Erro ao carregar template salvo:', error);
            templateAtual = JSON.parse(JSON.stringify(templatePadraoOriginal));
        }
    }
}

// Função para restaurar o template original
function restaurarTemplateOriginal() {
    if (confirm('Tem certeza que deseja restaurar o template original? Todas as edições serão perdidas.')) {
        // Restaurar o template original
        templateAtual = JSON.parse(JSON.stringify(templatePadraoOriginal));

        // Remover do localStorage
        localStorage.removeItem('templatePadraoEditado');

        // Atualizar a prévia
        atualizarPreviaTemplate();

        showSuccess('Template original restaurado com sucesso!', 'gestor');
    }
}

// Carregar template salvo quando a página carregar
document.addEventListener('DOMContentLoaded', function () {
    carregarTemplateSalvo();
    // Atualizar o status visual após carregar
    setTimeout(atualizarStatusTemplate, 100);

    // Configurar eventos para os selects pesquisáveis
    configurarSelectsPesquisaveis();
});

// Função para obter ID do usuário atual
async function getCurrentUserId() {
    // Tentar obter do localStorage ou sessionStorage
    const storedUser = localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
    if (storedUser) {
        try {
            const user = JSON.parse(storedUser);
            return user.userId || user.id;
        } catch (e) {
            console.log('Erro ao parsear usuário armazenado:', e);
        }
    }

    // Tentar obter da API do sistema
    try {
        const response = await fetch('/api/usuario');
        if (response.ok) {
            const currentUser = await response.json();
            console.log('✅ Usuário atual obtido da API:', currentUser);
            return currentUser.userId || currentUser.id;
        }
    } catch (error) {
        console.log('API de usuário atual não disponível:', error);
    }

    // Fallback: retornar null para não filtrar
    console.log('⚠️ Usuário atual não encontrado, mostrando todos os colaboradores');
    return null;
}

// Funções para o select pesquisável
function configurarSelectsPesquisaveis() {
    // Configurar o select de colaborador principal
    const colaboradorSearch = document.getElementById('colaborador-search');
    const colaboradorList = document.getElementById('colaborador-list');

    // Configurar o select de colaborador personalizado
    const colaboradorPersonalizadoSearch = document.getElementById('colaboradorPersonalizado-search');
    const colaboradorPersonalizadoList = document.getElementById('colaboradorPersonalizado-list');

    // Verificar se os elementos existem
    if (!colaboradorSearch || !colaboradorList || !colaboradorPersonalizadoSearch || !colaboradorPersonalizadoList) {
        console.log('Elementos do select pesquisável ainda não foram criados, tentando novamente em 100ms...');
        setTimeout(configurarSelectsPesquisaveis, 100);
        return;
    }

    // Eventos para o select principal
    colaboradorSearch.addEventListener('click', function () {
        colaboradorList.classList.toggle('show');
        this.readOnly = false;
        this.focus();
    });

    colaboradorSearch.addEventListener('blur', function () {
        setTimeout(() => {
            colaboradorList.classList.remove('show');
            this.readOnly = true;
        }, 200);
    });

    // Eventos para o select personalizado
    colaboradorPersonalizadoSearch.addEventListener('click', function () {
        colaboradorPersonalizadoList.classList.toggle('show');
        this.readOnly = false;
        this.focus();
    });

    colaboradorPersonalizadoSearch.addEventListener('blur', function () {
        setTimeout(() => {
            colaboradorPersonalizadoList.classList.remove('show');
            this.readOnly = true;
        }, 200);
    });

    // Fechar dropdowns quando clicar fora
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.searchable-select')) {
            colaboradorList.classList.remove('show');
            colaboradorPersonalizadoList.classList.remove('show');
            colaboradorSearch.readOnly = true;
            colaboradorPersonalizadoSearch.readOnly = true;
        }
    });
}

// Função para filtrar colaboradores
function filterColaboradores(searchId, listId) {
    const searchInput = document.getElementById(searchId);
    const dropdownList = document.getElementById(listId);

    // Verificar se os elementos existem
    if (!searchInput || !dropdownList) {
        console.error('Elementos não encontrados para filtrar colaboradores');
        return;
    }

    const searchTerm = searchInput.value.toLowerCase();

    // Mostrar dropdown
    dropdownList.classList.add('show');

    // Filtrar opções
    const options = dropdownList.querySelectorAll('.select-option');
    options.forEach(option => {
        const text = option.textContent.toLowerCase();
        if (text.includes(searchTerm) || searchTerm === '') {
            option.style.display = 'block';
        } else {
            option.style.display = 'none';
        }
    });
}

// Função para selecionar colaborador
function selectColaborador(value, text, fieldId) {
    const searchInput = document.getElementById(fieldId + '-search');
    const hiddenInput = document.getElementById(fieldId);
    const dropdownList = document.getElementById(fieldId + '-list');

    // Verificar se os elementos existem
    if (!searchInput || !hiddenInput || !dropdownList) {
        console.error('Elementos não encontrados para:', fieldId);
        return;
    }

    // Atualizar campos
    searchInput.value = text;
    hiddenInput.value = value;

    // Fechar dropdown
    dropdownList.classList.remove('show');
    searchInput.readOnly = true;

    // Marcar opção selecionada
    const options = dropdownList.querySelectorAll('.select-option');
    options.forEach(option => {
        option.classList.remove('selected');
        if (option.dataset.value === value) {
            option.classList.add('selected');
        }
    });

    console.log('Colaborador selecionado:', { fieldId, value, text });
}

// Função para carregar colaboradores no select pesquisável
function carregarColaboradoresSelect() {
    const colaboradorList = document.getElementById('colaborador-list');
    const colaboradorPersonalizadoList = document.getElementById('colaboradorPersonalizado-list');

    // Verificar se os elementos existem
    if (!colaboradorList || !colaboradorPersonalizadoList) {
        console.log('Elementos do select pesquisável ainda não foram criados');
        return;
    }

    // Verificar se colaboradores foram carregados
    if (!colaboradores || colaboradores.length === 0) {
        console.log('Lista de colaboradores ainda não foi carregada');
        return;
    }

    // Limpar listas existentes (mantendo a opção padrão)
    colaboradorList.innerHTML = '<div class="select-option" data-value="" onclick="selectColaborador(\'\', \'Selecionar colaborador...\', \'colaborador\')">Selecionar colaborador...</div>';
    colaboradorPersonalizadoList.innerHTML = '<div class="select-option" data-value="" onclick="selectColaborador(\'\', \'Selecionar colaborador...\', \'colaboradorPersonalizado\')">Selecionar colaborador...</div>';

    // Adicionar colaboradores
    colaboradores.forEach(colab => {
        // Criar texto de exibição com nome e departamento
        const displayText = colab.departamento ?
            `${colab.nome} - ${colab.departamento}` :
            colab.nome;

        const option1 = document.createElement('div');
        option1.className = 'select-option';
        option1.dataset.value = colab.id;
        option1.onclick = () => selectColaborador(colab.id, displayText, 'colaborador');
        option1.textContent = displayText;
        colaboradorList.appendChild(option1);

        const option2 = document.createElement('div');
        option2.className = 'select-option';
        option2.dataset.value = colab.id;
        option2.onclick = () => selectColaborador(colab.id, displayText, 'colaboradorPersonalizado');
        option2.textContent = displayText;
        colaboradorPersonalizadoList.appendChild(option2);
    });

    console.log('Colaboradores carregados no select pesquisável:', colaboradores.length);
}