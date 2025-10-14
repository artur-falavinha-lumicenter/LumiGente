/**
 * NOVO SISTEMA DE PESQUISAS - JAVASCRIPT
 * Interface completamente redesenhada
 */

class NovaPesquisa {
    constructor() {
        this.filtros = {
            filiais: [],
            departamentos: []
        };
        this.perguntas = [];
        this.departamentosFiltrados = [];
        this.searchTerm = '';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadFiltros();
        this.addFirstQuestion();
    }

    setupEventListeners() {
        // Tipo de público alvo
        document.querySelectorAll('input[name="target_type"]').forEach(radio => {
            radio.addEventListener('change', () => this.handleTargetTypeChange());
        });

        // Adicionar pergunta
        document.getElementById('add-question').addEventListener('click', () => {
            this.addQuestion();
        });

        // Submit do formulário
        document.getElementById('surveyForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitSurvey();
        });

        // Input de pesquisa de departamentos
        const searchInput = document.getElementById('departamento-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleDepartamentoSearch(e.target.value);
            });
        }

        // Botão de limpar pesquisa
        const clearBtn = document.getElementById('clear-search');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearDepartamentoSearch();
            });
        }
    }

    async loadFiltros() {
        try {
            const response = await fetch('/api/surveys/meta/filtros');
            if (response.ok) {
                this.filtros = await response.json();
                this.renderFiliais();
                this.renderDepartamentos();
            }
        } catch (error) {
            console.error('Erro ao carregar filtros:', error);
            this.showError('Erro ao carregar filtros disponíveis');
        }
    }

    renderFiliais() {
        const container = document.getElementById('filiais-list');
        if (!this.filtros.filiais || this.filtros.filiais.length === 0) {
            container.innerHTML = '<div class="loading-filters">Nenhuma filial encontrada</div>';
            return;
        }

        container.innerHTML = this.filtros.filiais.map(filial => `
            <div class="filter-item">
                <label class="checkbox-label">
                    <input type="checkbox" name="filiais" value="${filial.codigo}" data-nome="${filial.nome}">
                    <span class="checkmark"></span>
                    ${filial.nome} (${filial.codigo})
                </label>
            </div>
        `).join('');

        // Adicionar event listeners
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => this.updateTargetSummary());
        });
    }

    renderDepartamentos() {
        const container = document.getElementById('departamentos-list');
        if (!this.filtros.departamentos || this.filtros.departamentos.length === 0) {
            container.innerHTML = '<div class="loading-filters">Nenhum departamento encontrado</div>';
            return;
        }

        // Inicializar lista filtrada com todos os departamentos
        this.departamentosFiltrados = [...this.filtros.departamentos];
        this.renderDepartamentosList();
    }

    renderDepartamentosList() {
        const container = document.getElementById('departamentos-list');
        
        if (this.departamentosFiltrados.length === 0) {
            container.innerHTML = '<div class="loading-filters">Nenhum departamento encontrado</div>';
            return;
        }

        container.innerHTML = this.departamentosFiltrados.map(dept => `
            <div class="filter-item">
                <label class="checkbox-label">
                    <input type="checkbox" name="departamentos" value="${dept.codigo}" data-nome="${dept.nome}">
                    <span class="checkmark"></span>
                    ${this.highlightSearchTerm(dept.nome, this.searchTerm)}
                </label>
            </div>
        `).join('');

        // Adicionar event listeners
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => this.updateTargetSummary());
        });
    }

    highlightSearchTerm(text, searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') {
            return text;
        }
        
        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    handleTargetTypeChange() {
        const targetType = document.querySelector('input[name="target_type"]:checked').value;
        
        // Mostrar/ocultar seções
        document.getElementById('filiais-section').style.display = 
            (targetType === 'filiais' || targetType === 'ambos') ? 'block' : 'none';
        
        document.getElementById('departamentos-section').style.display = 
            (targetType === 'departamentos' || targetType === 'ambos') ? 'block' : 'none';

        // Limpar pesquisa quando mudar o tipo
        if (targetType !== 'departamentos' && targetType !== 'ambos') {
            this.clearDepartamentoSearch();
        } else if (targetType === 'departamentos' || targetType === 'ambos') {
            // Garantir que a lista seja renderizada quando a seção for exibida
            if (this.filtros.departamentos && this.filtros.departamentos.length > 0) {
                this.departamentosFiltrados = [...this.filtros.departamentos];
                this.renderDepartamentosList();
            }
        }

        this.updateTargetSummary();
    }

    handleDepartamentoSearch(searchTerm) {
        this.searchTerm = searchTerm.trim();
        
        // Atualizar botão de limpar
        const clearBtn = document.getElementById('clear-search');
        if (clearBtn) {
            clearBtn.style.display = this.searchTerm ? 'block' : 'none';
        }

        // Filtrar departamentos
        if (this.searchTerm === '') {
            this.departamentosFiltrados = [...this.filtros.departamentos];
        } else {
            this.departamentosFiltrados = this.filtros.departamentos.filter(dept => 
                dept.nome.toLowerCase().includes(this.searchTerm.toLowerCase())
            );
        }

        // Atualizar contador de resultados
        this.updateSearchResultsInfo();

        // Re-renderizar lista
        this.renderDepartamentosList();
    }

    clearDepartamentoSearch() {
        const searchInput = document.getElementById('departamento-search');
        if (searchInput) {
            searchInput.value = '';
        }
        
        const clearBtn = document.getElementById('clear-search');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }

        this.handleDepartamentoSearch('');
    }

    updateSearchResultsInfo() {
        const resultsInfo = document.getElementById('search-results-info');
        const searchCount = document.getElementById('search-count');
        
        if (this.searchTerm) {
            resultsInfo.style.display = 'block';
            searchCount.textContent = this.departamentosFiltrados.length;
        } else {
            resultsInfo.style.display = 'none';
        }
    }

    updateTargetSummary() {
        const targetType = document.querySelector('input[name="target_type"]:checked').value;
        const descriptionEl = document.getElementById('target-description');
        const countEl = document.getElementById('target-count');

        let description = '';
        let selectedFiliais = [];
        let selectedDepartamentos = [];

        switch (targetType) {
            case 'todos':
                description = 'Todos os funcionários';
                break;
            
            case 'filiais':
                selectedFiliais = Array.from(document.querySelectorAll('input[name="filiais"]:checked'))
                    .map(cb => cb.dataset.nome);
                description = selectedFiliais.length > 0 
                    ? `${selectedFiliais.length} filiais selecionadas`
                    : 'Nenhuma filial selecionada';
                break;
            
            case 'departamentos':
                selectedDepartamentos = Array.from(document.querySelectorAll('input[name="departamentos"]:checked'))
                    .map(cb => cb.dataset.nome);
                description = selectedDepartamentos.length > 0 
                    ? `${selectedDepartamentos.length} departamentos selecionados`
                    : 'Nenhum departamento selecionado';
                break;
            
            case 'ambos':
                selectedFiliais = Array.from(document.querySelectorAll('input[name="filiais"]:checked'))
                    .map(cb => cb.dataset.nome);
                selectedDepartamentos = Array.from(document.querySelectorAll('input[name="departamentos"]:checked'))
                    .map(cb => cb.dataset.nome);
                
                const parts = [];
                if (selectedFiliais.length > 0) parts.push(`${selectedFiliais.length} filiais`);
                if (selectedDepartamentos.length > 0) parts.push(`${selectedDepartamentos.length} departamentos`);
                
                description = parts.length > 0 ? parts.join(' e ') + ' selecionados' : 'Nenhum filtro selecionado';
                break;
        }

        descriptionEl.textContent = description;
        
        // Mostrar detalhes se houver seleções específicas
        let details = [];
        if (selectedFiliais.length > 0 && selectedFiliais.length <= 5) {
            details.push('Filiais: ' + selectedFiliais.join(', '));
        }
        if (selectedDepartamentos.length > 0 && selectedDepartamentos.length <= 5) {
            details.push('Departamentos: ' + selectedDepartamentos.join(', '));
        }
        
        countEl.innerHTML = details.length > 0 ? details.map(d => `<div>${d}</div>`).join('') : '';
    }

    addFirstQuestion() {
        this.addQuestion();
    }

    addQuestion() {
        const questionId = Date.now();
        const questionNumber = this.perguntas.length + 1;
        
        const questionHtml = `
            <div class="question-card" data-question-id="${questionId}">
                <div class="question-header">
                    <div class="question-number">${questionNumber}</div>
                    <div class="question-title">Pergunta ${questionNumber}</div>
                    <div class="question-actions">
                        ${this.perguntas.length > 0 ? `
                            <button type="button" class="btn-icon btn-danger" onclick="novaPesquisa.removeQuestion(${questionId})">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <div class="question-content">
                    <div class="form-group">
                        <label>Texto da Pergunta *</label>
                        <textarea name="pergunta_texto_${questionId}" required rows="2" 
                                  placeholder="Digite sua pergunta aqui..."></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label>Tipo de Pergunta</label>
                        <div class="question-type-selector">
                            <div class="type-option active" data-type="texto_livre" onclick="novaPesquisa.setQuestionType(${questionId}, 'texto_livre')">
                                <i class="fas fa-edit"></i><br>Texto Livre
                            </div>
                            <div class="type-option" data-type="multipla_escolha" onclick="novaPesquisa.setQuestionType(${questionId}, 'multipla_escolha')">
                                <i class="fas fa-list"></i><br>Múltipla Escolha
                            </div>
                            <div class="type-option" data-type="escala" onclick="novaPesquisa.setQuestionType(${questionId}, 'escala')">
                                <i class="fas fa-star"></i><br>Escala
                            </div>
                            <div class="type-option" data-type="sim_nao" onclick="novaPesquisa.setQuestionType(${questionId}, 'sim_nao')">
                                <i class="fas fa-check"></i><br>Sim/Não
                            </div>
                        </div>
                    </div>
                    
                    <div id="question-options-${questionId}" class="question-options">
                        <!-- Opções específicas do tipo serão inseridas aqui -->
                    </div>
                    
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" name="pergunta_obrigatoria_${questionId}">
                            <span class="checkmark"></span>
                            Pergunta obrigatória
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        document.getElementById('perguntas-container').insertAdjacentHTML('beforeend', questionHtml);
        
        this.perguntas.push({
            id: questionId,
            tipo: 'texto_livre'
        });
        
        this.updateQuestionNumbers();
    }

    removeQuestion(questionId) {
        if (this.perguntas.length <= 1) {
            this.showError('Deve haver pelo menos uma pergunta');
            return;
        }
        
        document.querySelector(`[data-question-id="${questionId}"]`).remove();
        this.perguntas = this.perguntas.filter(q => q.id !== questionId);
        this.updateQuestionNumbers();
    }

    setQuestionType(questionId, tipo) {
        const questionCard = document.querySelector(`[data-question-id="${questionId}"]`);
        
        // Atualizar visual dos tipos
        questionCard.querySelectorAll('.type-option').forEach(option => {
            option.classList.toggle('active', option.dataset.type === tipo);
        });
        
        // Atualizar array de perguntas
        const pergunta = this.perguntas.find(q => q.id === questionId);
        if (pergunta) pergunta.tipo = tipo;
        
        // Renderizar opções específicas do tipo
        this.renderQuestionOptions(questionId, tipo);
    }

    renderQuestionOptions(questionId, tipo) {
        const container = document.getElementById(`question-options-${questionId}`);
        
        switch (tipo) {
            case 'multipla_escolha':
                container.innerHTML = `
                    <div class="form-group">
                        <label>Opções de Resposta</label>
                        <div class="options-container" id="options-${questionId}">
                            <div class="option-input">
                                <input type="text" name="opcao_${questionId}_1" placeholder="Opção 1" required>
                                <button type="button" class="btn-icon btn-danger" onclick="this.parentElement.remove()">
                                    <i class="fas fa-minus"></i>
                                </button>
                            </div>
                            <div class="option-input">
                                <input type="text" name="opcao_${questionId}_2" placeholder="Opção 2" required>
                                <button type="button" class="btn-icon btn-danger" onclick="this.parentElement.remove()">
                                    <i class="fas fa-minus"></i>
                                </button>
                            </div>
                        </div>
                        <button type="button" class="btn btn-outline" onclick="novaPesquisa.addOption(${questionId})">
                            <i class="fas fa-plus"></i> Adicionar Opção
                        </button>
                    </div>
                `;
                break;
            
            case 'escala':
                container.innerHTML = `
                    <div class="form-group">
                        <label>Configuração da Escala</label>
                        <div class="scale-inputs">
                            <div>
                                <label>Valor Mínimo</label>
                                <input type="number" name="escala_min_${questionId}" value="1" min="1" max="10" required>
                            </div>
                            <div>
                                <label>Valor Máximo</label>
                                <input type="number" name="escala_max_${questionId}" value="5" min="1" max="10" required>
                            </div>
                        </div>
                        <small>Exemplo: 1 a 5 (muito insatisfeito a muito satisfeito)</small>
                    </div>
                `;
                break;
            
            default:
                container.innerHTML = '';
                break;
        }
    }

    addOption(questionId) {
        const container = document.getElementById(`options-${questionId}`);
        const optionCount = container.children.length + 1;
        
        const optionHtml = `
            <div class="option-input">
                <input type="text" name="opcao_${questionId}_${optionCount}" placeholder="Opção ${optionCount}" required>
                <button type="button" class="btn-icon btn-danger" onclick="this.parentElement.remove()">
                    <i class="fas fa-minus"></i>
                </button>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', optionHtml);
    }

    updateQuestionNumbers() {
        const questionCards = document.querySelectorAll('.question-card');
        questionCards.forEach((card, index) => {
            const number = index + 1;
            card.querySelector('.question-number').textContent = number;
            card.querySelector('.question-title').textContent = `Pergunta ${number}`;
        });
    }

    async submitSurvey() {
        try {
            this.showLoading(true);
            this.hideMessages();
            
            const formData = this.collectFormData();
            
            // Validar dados
            const validation = this.validateFormData(formData);
            if (!validation.valid) {
                this.showError(validation.message);
                return;
            }
            
            const response = await fetch('/api/surveys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (response.ok) {
                this.showSuccess('Pesquisa criada com sucesso!');
                
                // Notificar janela pai para atualizar a listagem de pesquisas
                if (window.opener && !window.opener.closed) {
                    try {
                        window.opener.postMessage({
                            type: 'SURVEY_CREATED',
                            survey: result.survey
                        }, '*');
                        console.log('✅ Mensagem de atualização enviada para a janela pai');
                    } catch (error) {
                        console.warn('⚠️ Não foi possível notificar a janela pai:', error);
                    }
                }
                
                setTimeout(() => {
                    window.close();
                }, 2000);
                
            } else {
                this.showError(result.error || 'Erro ao criar pesquisa');
            }
            
        } catch (error) {
            console.error('Erro ao enviar pesquisa:', error);
            this.showError('Erro ao enviar pesquisa. Tente novamente.');
        } finally {
            this.showLoading(false);
        }
    }

    collectFormData() {
        const form = document.getElementById('surveyForm');
        const formData = new FormData(form);
        
        const data = {
            titulo: formData.get('titulo'),
            descricao: formData.get('descricao'),
            data_inicio: formData.get('data_inicio') || null,
            data_encerramento: formData.get('data_encerramento') || null,
            anonima: formData.has('anonima'),
            perguntas: [],
            filiais_filtro: [],
            departamentos_filtro: []
        };
        
        // Coletar filtros baseado no tipo selecionado
        const targetType = document.querySelector('input[name="target_type"]:checked').value;
        
        if (targetType === 'filiais' || targetType === 'ambos') {
            data.filiais_filtro = Array.from(document.querySelectorAll('input[name="filiais"]:checked'))
                .map(cb => ({
                    codigo: cb.value,
                    nome: cb.dataset.nome
                }));
        }
        
        if (targetType === 'departamentos' || targetType === 'ambos') {
            data.departamentos_filtro = Array.from(document.querySelectorAll('input[name="departamentos"]:checked'))
                .map(cb => ({
                    codigo: cb.value,
                    nome: cb.dataset.nome
                }));
        }
        
        // Coletar perguntas
        this.perguntas.forEach(pergunta => {
            const perguntaData = {
                texto: formData.get(`pergunta_texto_${pergunta.id}`),
                tipo: pergunta.tipo,
                obrigatoria: formData.has(`pergunta_obrigatoria_${pergunta.id}`)
            };
            
            if (pergunta.tipo === 'multipla_escolha') {
                perguntaData.opcoes = [];
                let i = 1;
                while (formData.get(`opcao_${pergunta.id}_${i}`)) {
                    perguntaData.opcoes.push(formData.get(`opcao_${pergunta.id}_${i}`));
                    i++;
                }
            } else if (pergunta.tipo === 'escala') {
                perguntaData.escala_min = parseInt(formData.get(`escala_min_${pergunta.id}`)) || 1;
                perguntaData.escala_max = parseInt(formData.get(`escala_max_${pergunta.id}`)) || 5;
            }
            
            data.perguntas.push(perguntaData);
        });
        
        return data;
    }

    validateFormData(data) {
        if (!data.titulo || data.titulo.trim() === '') {
            return { valid: false, message: 'Título é obrigatório' };
        }
        
        if (data.perguntas.length === 0) {
            return { valid: false, message: 'Adicione pelo menos uma pergunta' };
        }
        
        for (let i = 0; i < data.perguntas.length; i++) {
            const pergunta = data.perguntas[i];
            
            if (!pergunta.texto || pergunta.texto.trim() === '') {
                return { valid: false, message: `Pergunta ${i + 1}: Texto é obrigatório` };
            }
            
            if (pergunta.tipo === 'multipla_escolha') {
                if (!pergunta.opcoes || pergunta.opcoes.length < 2) {
                    return { valid: false, message: `Pergunta ${i + 1}: Adicione pelo menos 2 opções` };
                }
            }
            
            if (pergunta.tipo === 'escala') {
                if (pergunta.escala_max <= pergunta.escala_min) {
                    return { valid: false, message: `Pergunta ${i + 1}: Valor máximo deve ser maior que o mínimo` };
                }
            }
        }
        
        // Validar filtros se não for "todos"
        const targetType = document.querySelector('input[name="target_type"]:checked').value;
        if (targetType === 'filiais' && data.filiais_filtro.length === 0) {
            return { valid: false, message: 'Selecione pelo menos uma filial' };
        }
        if (targetType === 'departamentos' && data.departamentos_filtro.length === 0) {
            return { valid: false, message: 'Selecione pelo menos um departamento' };
        }
        if (targetType === 'ambos' && data.filiais_filtro.length === 0 && data.departamentos_filtro.length === 0) {
            return { valid: false, message: 'Selecione pelo menos uma filial ou um departamento' };
        }
        
        return { valid: true };
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
        document.getElementById('surveyForm').style.display = show ? 'none' : 'block';
    }

    showError(message) {
        const errorEl = document.getElementById('error');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        errorEl.scrollIntoView({ behavior: 'smooth' });
    }

    showSuccess(message) {
        const successEl = document.getElementById('success');
        successEl.textContent = message;
        successEl.style.display = 'block';
        successEl.scrollIntoView({ behavior: 'smooth' });
    }

    hideMessages() {
        document.getElementById('error').style.display = 'none';
        document.getElementById('success').style.display = 'none';
    }
}

// Inicializar quando a página carregar
let novaPesquisa;
document.addEventListener('DOMContentLoaded', () => {
    novaPesquisa = new NovaPesquisa();
});
