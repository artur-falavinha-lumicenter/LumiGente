/**
 * NOVO SISTEMA DE PESQUISAS - INTERFACE DE LISTAGEM
 */

class PesquisasNovo {
    constructor() {
        this.currentPage = 1;
        this.totalPages = 1;
        this.userInfo = {};
        this.surveys = [];
        this.init();
    }

    init() {
        // Verificar se está em modo de visualização de resultados
        const urlParams = new URLSearchParams(window.location.search);
        const viewMode = urlParams.get('view');
        const surveyId = urlParams.get('id');
        
        if (viewMode === 'true' && surveyId) {
            console.log('👁️ Modo de visualização de resultados - Survey ID:', surveyId);
            this.loadResultsView(parseInt(surveyId));
            return; // Não carregar lista de pesquisas
        }
        
        this.setupEventListeners();
        this.loadSurveys();
        
        // Verificar se deve abrir modal de resposta automaticamente
        const shouldRespond = urlParams.get('respond');
        
        if (shouldRespond === 'true' && surveyId) {
            console.log('📝 Abrindo modal de resposta automaticamente para pesquisa:', surveyId);
            // Aguardar um pouco para garantir que a lista foi carregada
            setTimeout(() => {
                this.openResponseModal(parseInt(surveyId));
            }, 500);
        }
        
        // Escutar mensagens da janela de criação para atualizar automaticamente
        window.addEventListener('message', (event) => {
            console.log('📩 Mensagem recebida:', event.data);
            if (event.data.type === 'SURVEY_CREATED') {
                console.log('🔄 Pesquisa criada - Atualizando listagem automaticamente...');
                
                // Mostrar feedback visual de atualização
                this.showUpdateNotification('Nova pesquisa criada! Atualizando lista...');
                
                // Recarregar lista
                this.loadSurveys();
            }
        });
    }

    setupEventListeners() {
        // Busca
        const searchInput = document.getElementById('search');
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.currentPage = 1;
                this.loadSurveys();
            }, 500);
        });

        // Filtro de status
        document.getElementById('status-filter').addEventListener('change', () => {
            this.currentPage = 1;
            this.loadSurveys();
        });

        // Refresh
        document.getElementById('btn-refresh').addEventListener('click', () => {
            this.loadSurveys();
        });

        // Nova pesquisa
        document.getElementById('btn-nova-pesquisa').addEventListener('click', () => {
            window.open('nova-pesquisa.html', '_blank', 'width=1200,height=800');
        });
    }

    async loadSurveys() {
        try {
            this.showLoading(true);

            const params = new URLSearchParams({
                page: this.currentPage,
                limit: 10
            });

            const search = document.getElementById('search').value;
            if (search) params.append('search', search);

            const status = document.getElementById('status-filter').value;
            if (status) params.append('status', status);

            const response = await fetch(`/api/surveys?${params}`);
            
            if (!response.ok) {
                throw new Error('Erro ao carregar pesquisas');
            }

            const data = await response.json();
            
            this.surveys = data.surveys;
            this.userInfo = data.user_info;
            this.totalPages = data.pagination.pages;

            this.renderSurveys();
            this.renderPagination(data.pagination);
            this.updateUI();

        } catch (error) {
            console.error('Erro ao carregar pesquisas:', error);
            this.showError('Erro ao carregar pesquisas: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    renderSurveys() {
        const container = document.getElementById('surveys-container');
        
        if (this.surveys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-poll" style="font-size: 4em; color: #cbd5e0; margin-bottom: 20px;"></i>
                    <h3 style="color: #718096; margin-bottom: 10px;">Nenhuma pesquisa encontrada</h3>
                    <p style="color: #a0aec0;">
                        ${this.userInfo.can_create ? 
                            'Crie sua primeira pesquisa clicando no botão "Nova Pesquisa"' : 
                            'Não há pesquisas disponíveis para você no momento'
                        }
                    </p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.surveys.map(survey => this.renderSurveyCard(survey)).join('');
    }

    renderSurveyCard(survey) {
        const statusClass = `status-${survey.status_calculado.toLowerCase()}`;
        const canRespond = survey.pode_responder;
        const isHRTD = this.userInfo.is_hr_td;
        
        return `
            <div class="survey-card">
                <div class="survey-header">
                    <div>
                        <div class="survey-title">${survey.titulo}</div>
                        ${survey.descricao ? `<div class="survey-description">${survey.descricao}</div>` : ''}
                    </div>
                    <div class="survey-badges">
                        <span class="badge ${statusClass}">${survey.status_calculado}</span>
                        ${survey.anonima ? '<span class="badge anonima">Anônima</span>' : ''}
                        ${survey.ja_respondeu ? 
                            '<span class="badge ja-respondeu">Respondida</span>' : 
                            (survey.status_calculado === 'Encerrada' ? 
                                '<span class="badge nao-respondeu">Não Respondida</span>' : 
                                ''
                            )
                        }
                    </div>
                </div>

                <div class="survey-info">
                    <div class="info-item">
                        <i class="fas fa-user"></i>
                        <span class="info-label">Criado por:</span>
                        <span class="info-value">${survey.criador_nome}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-calendar"></i>
                        <span class="info-label">Criado em:</span>
                        <span class="info-value">${this.formatDateLocal(survey.data_criacao)}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-play-circle"></i>
                        <span class="info-label">Início:</span>
                        <span class="info-value">${survey.data_inicio ? this.formatDateLocal(survey.data_inicio) : 'Não definido'}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-stop-circle"></i>
                        <span class="info-label">Fim:</span>
                        <span class="info-value">${survey.data_encerramento ? this.formatDateLocal(survey.data_encerramento) : 'Não definido'}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-users"></i>
                        <span class="info-label">Público:</span>
                        <span class="info-value">${survey.publico_alvo}</span>
                    </div>
                    <div class="info-item">
                        <i class="fas fa-question-circle"></i>
                        <span class="info-label">Perguntas:</span>
                        <span class="info-value">${survey.total_perguntas}</span>
                    </div>
                </div>

                ${isHRTD ? `
                    <div class="survey-progress">
                        <div class="progress-label">
                            <span>Taxa de Resposta</span>
                            <span>${survey.total_respostas}/${survey.total_usuarios_elegiveis} (${survey.taxa_resposta}%)</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${survey.taxa_resposta}%"></div>
                        </div>
                    </div>
                ` : ''}

                <div class="survey-actions">
                    ${canRespond ? `
                        <button class="btn btn-primary btn-sm" onclick="pesquisasNovo.openResponseModal(${survey.Id})">
                            <i class="fas fa-edit"></i> Responder
                        </button>
                    ` : ''}
                    
                    ${isHRTD ? `
                        <button class="btn btn-success btn-sm" onclick="window.open('pesquisas-novo.html?id=${survey.Id}&view=true', '_blank', 'width=1400,height=900')">
                            <i class="fas fa-chart-bar"></i> Ver Resultados
                        </button>
                        ${survey.status_calculado === 'Encerrada' ? `
                            <button class="btn btn-warning btn-sm" onclick="pesquisasNovo.abrirModalReabrirCard(${survey.Id})" title="Reabrir pesquisa para novas respostas">
                                <i class="fas fa-redo"></i> Abrir Novamente
                            </button>
                        ` : ''}
                    ` : ''}
                </div>
            </div>
        `;
    }

    async abrirModalReabrirCard(surveyId) {
        // Criar modal (mesma lógica)
        const modalHtml = `
            <div id="reabrir-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
                <div style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; width: 90%;">
                    <h3 style="margin: 0 0 16px 0; color: #1f2937;">
                        <i class="fas fa-redo" style="color: #10b981; margin-right: 8px;"></i>
                        Reabrir Pesquisa
                    </h3>
                    <p style="margin: 0 0 20px 0; color: #6b7280;">
                        Selecione a nova data e hora de encerramento para reabrir esta pesquisa:
                    </p>
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; color: #374151; font-weight: 500;">
                            Data e Hora de Encerramento
                        </label>
                        <input type="datetime-local" id="nova-data-encerramento-card" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                    </div>
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button onclick="fecharModalReabrir()" class="btn btn-secondary">
                            Cancelar
                        </button>
                        <button onclick="pesquisasNovo.confirmarReaberturaCard(${surveyId})" class="btn btn-success">
                            <i class="fas fa-check"></i> Reabrir Pesquisa
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Definir data mínima (agora)
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('nova-data-encerramento-card').min = now.toISOString().slice(0, 16);
    }

    async confirmarReaberturaCard(surveyId) {
        try {
            const novaData = document.getElementById('nova-data-encerramento-card').value;
            
            if (!novaData) {
                alert('Por favor, selecione uma data e hora');
                return;
            }
            
            const response = await fetch(`/api/surveys/${surveyId}/reabrir`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ nova_data_encerramento: novaData })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }
            
            alert('Pesquisa reaberta com sucesso!');
            fecharModalReabrir();
            
            // Recarregar lista de pesquisas
            this.loadSurveys();
            
        } catch (error) {
            console.error('Erro ao reabrir pesquisa:', error);
            alert('Erro ao reabrir pesquisa: ' + error.message);
        }
    }

    renderPagination(pagination) {
        const container = document.getElementById('pagination');
        
        if (pagination.pages <= 1) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        
        let html = `
            <button ${pagination.page <= 1 ? 'disabled' : ''} onclick="pesquisasNovo.goToPage(${pagination.page - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;

        // Páginas
        const startPage = Math.max(1, pagination.page - 2);
        const endPage = Math.min(pagination.pages, pagination.page + 2);

        for (let i = startPage; i <= endPage; i++) {
            html += `
                <button class="${i === pagination.page ? 'active' : ''}" onclick="pesquisasNovo.goToPage(${i})">
                    ${i}
                </button>
            `;
        }

        html += `
            <button ${pagination.page >= pagination.pages ? 'disabled' : ''} onclick="pesquisasNovo.goToPage(${pagination.page + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        container.innerHTML = html;
    }

    updateUI() {
        // Mostrar/ocultar botão de nova pesquisa
        document.getElementById('btn-nova-pesquisa').style.display = 
            this.userInfo.can_create ? 'flex' : 'none';
    }

    goToPage(page) {
        this.currentPage = page;
        this.loadSurveys();
    }

    async openResponseModal(surveyId) {
        try {
            const response = await fetch(`/api/surveys/${surveyId}`);
            if (!response.ok) throw new Error('Erro ao carregar pesquisa');
            
            const survey = await response.json();
            
            console.log('🔵 Survey carregada:', survey);
            console.log('🔵 Perguntas:', survey.perguntas);
            survey.perguntas.forEach(p => {
                console.log(`🔵 Pergunta ${p.Id} (${p.tipo}):`, p);
                if (p.tipo === 'multipla_escolha') {
                    console.log(`   → Opções:`, p.opcoes);
                }
            });
            
            if (!survey.pode_responder) {
                alert('Você não pode responder esta pesquisa');
                return;
            }

            this.renderResponseModal(survey);
            document.getElementById('response-modal').style.display = 'flex';
            
        } catch (error) {
            console.error('Erro ao abrir modal de resposta:', error);
            alert('Erro ao carregar pesquisa: ' + error.message);
        }
    }

    renderResponseModal(survey) {
        document.getElementById('modal-title').textContent = survey.titulo;
        
        // Verificar se há perguntas de escala com valores grandes
        const maxEscala = Math.max(...survey.perguntas
            .filter(p => p.tipo === 'escala')
            .map(p => (p.escala_max || 5) - (p.escala_min || 1) + 1)
        );
        
        // Aplicar classe apropriada ao modal baseado no tamanho da escala
        const modalContent = document.querySelector('#response-modal .modal-content');
        if (modalContent) {
            modalContent.classList.remove('wide-scale', 'extra-wide-scale');
            if (maxEscala > 10) {
                modalContent.classList.add('extra-wide-scale');
                console.log('📏 Modal ajustado para escala extra larga (>10 opções)');
            } else if (maxEscala > 7) {
                modalContent.classList.add('wide-scale');
                console.log('📏 Modal ajustado para escala larga (8-10 opções)');
            }
        }
        
        const formHtml = `
            <form id="response-form" class="response-form">
                ${survey.descricao ? `<p style="color: #718096; margin-bottom: 20px;">${survey.descricao}</p>` : ''}
                
                ${survey.perguntas.map((pergunta, index) => this.renderQuestion(pergunta, index)).join('')}
                
                <div style="display: flex; gap: 15px; justify-content: flex-end; margin-top: 30px;">
                    <button type="button" class="btn btn-secondary" onclick="closeResponseModal()">
                        Cancelar
                    </button>
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-paper-plane"></i> Enviar Respostas
                    </button>
                </div>
            </form>
        `;
        
        document.getElementById('modal-body').innerHTML = formHtml;
        
        // Adicionar event listener para o form
        document.getElementById('response-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitResponse(survey.Id, survey.perguntas);
        });
    }

    renderQuestion(pergunta, index) {
        const required = pergunta.obrigatoria ? 'required' : '';
        const requiredMark = pergunta.obrigatoria ? '<span class="question-required">*</span>' : '';
        
        console.log(`🔵 Renderizando pergunta ${pergunta.Id} (${pergunta.tipo})`);
        
        let inputHtml = '';
        
        switch (pergunta.tipo) {
            case 'texto_livre':
                inputHtml = `
                    <textarea name="resposta_${pergunta.Id}" class="response-input response-textarea" 
                              placeholder="Digite sua resposta..." ${required}></textarea>
                `;
                break;
                
            case 'multipla_escolha':
                console.log(`🔵 Opções para pergunta ${pergunta.Id}:`, pergunta.opcoes);
                if (!pergunta.opcoes || pergunta.opcoes.length === 0) {
                    console.error(`❌ ERRO: Pergunta ${pergunta.Id} não tem opções!`);
                    inputHtml = `<p style="color: red;">Erro: Opções não disponíveis</p>`;
                } else {
                    inputHtml = `
                        <div class="response-options">
                            ${pergunta.opcoes.map(opcao => {
                                console.log(`   → Renderizando opção - ID: ${opcao.Id}, Texto: ${opcao.opcao}`);
                                return `
                                    <label class="option-label">
                                        <input type="radio" name="resposta_${pergunta.Id}" value="${opcao.Id}" ${required}>
                                        <span>${opcao.opcao}</span>
                                    </label>
                                `;
                            }).join('')}
                        </div>
                    `;
                }
                break;
                
            case 'escala':
                const options = [];
                for (let i = pergunta.escala_min; i <= pergunta.escala_max; i++) {
                    options.push(`
                        <label class="scale-option">
                            <input type="radio" name="resposta_${pergunta.Id}" value="${i}" ${required} style="display: none;">
                            <div class="scale-number">${i}</div>
                        </label>
                    `);
                }
                inputHtml = `
                    <div class="scale-options">
                        ${options.join('')}
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px; color: #718096; font-size: 0.9em;">
                        <span>Mínimo (${pergunta.escala_min})</span>
                        <span>Máximo (${pergunta.escala_max})</span>
                    </div>
                `;
                break;
                
            case 'sim_nao':
                inputHtml = `
                    <div class="response-options">
                        <label class="option-label">
                            <input type="radio" name="resposta_${pergunta.Id}" value="sim" ${required}>
                            <span>Sim</span>
                        </label>
                        <label class="option-label">
                            <input type="radio" name="resposta_${pergunta.Id}" value="nao" ${required}>
                            <span>Não</span>
                        </label>
                    </div>
                `;
                break;
        }
        
        return `
            <div class="question-item">
                <div class="question-title">
                    ${index + 1}. ${pergunta.pergunta} ${requiredMark}
                </div>
                ${inputHtml}
            </div>
        `;
    }

    async submitResponse(surveyId, perguntas) {
        try {
            const formData = new FormData(document.getElementById('response-form'));
            const respostas = [];
            
            console.log('📝🔵 VERSÃO NOVA - submitResponse chamada');
            console.log('📝 Enviando respostas para pesquisa:', surveyId);
            console.log('📝 Total de perguntas:', perguntas.length);
            
            for (const pergunta of perguntas) {
                const fieldName = `resposta_${pergunta.Id}`;
                const valor = formData.get(fieldName);
                
                console.log(`📝 === Pergunta ${pergunta.Id} (${pergunta.tipo}) ===`);
                console.log(`📝 Campo buscado: "${fieldName}"`);
                console.log(`📝 Valor capturado:`, valor);
                console.log(`📝 Tipo do valor:`, typeof valor);
                
                // Debug: mostrar todos os campos do FormData
                console.log(`📝 Todos os campos do form:`);
                for (let pair of formData.entries()) {
                    console.log(`   ${pair[0]}: ${pair[1]}`);
                }
                
                if (pergunta.obrigatoria && !valor) {
                    alert(`Por favor, responda a pergunta: ${pergunta.pergunta}`);
                    return;
                }
                
                if (valor) {
                    const resposta = {
                        question_id: pergunta.Id
                    };
                    
                    if (pergunta.tipo === 'texto_livre' || pergunta.tipo === 'sim_nao') {
                        resposta.resposta_texto = valor;
                        console.log(`   ✅ Salvando como resposta_texto:`, valor);
                    } else if (pergunta.tipo === 'escala') {
                        resposta.resposta_numerica = parseInt(valor);
                        console.log(`   ✅ Salvando como resposta_numerica:`, parseInt(valor));
                    } else if (pergunta.tipo === 'multipla_escolha') {
                        resposta.option_id = parseInt(valor);
                        console.log(`   ✅ Salvando como option_id:`, parseInt(valor));
                        console.log(`   ✅ Tipo de option_id:`, typeof resposta.option_id);
                        console.log(`   ✅ isNaN:`, isNaN(resposta.option_id));
                    }
                    
                    respostas.push(resposta);
                } else {
                    console.log(`   ⚠️ Pergunta ${pergunta.Id} NÃO tem valor - pulando`);
                }
            }
            
            console.log('📝 Respostas a serem enviadas:', respostas);
            
            const response = await fetch(`/api/surveys/${surveyId}/responder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ respostas })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }
            
            alert('Respostas enviadas com sucesso!');
            closeResponseModal();
            
            // Notificar janela pai (se foi aberta do index.html) para atualizar
            if (window.opener && !window.opener.closed) {
                try {
                    window.opener.postMessage({
                        type: 'SURVEY_RESPONSE_SUBMITTED',
                        surveyId: surveyId
                    }, '*');
                    console.log('✅ Notificação enviada para janela pai');
                } catch (error) {
                    console.warn('⚠️ Não foi possível notificar janela pai:', error);
                }
            }
            
            this.loadSurveys(); // Recarregar para atualizar status
            
        } catch (error) {
            console.error('Erro ao enviar respostas:', error);
            alert('Erro ao enviar respostas: ' + error.message);
        }
    }

    async openResultsModal(surveyId) {
        try {
            const response = await fetch(`/api/surveys/${surveyId}/resultados`);
            if (!response.ok) throw new Error('Erro ao carregar resultados');
            
            const data = await response.json();
            this.renderResultsModal(data);
            document.getElementById('results-modal').style.display = 'flex';
            
        } catch (error) {
            console.error('Erro ao abrir resultados:', error);
            alert('Erro ao carregar resultados: ' + error.message);
        }
    }

    renderResultsModal(data) {
        document.getElementById('results-title').textContent = `Resultados: ${data.titulo}`;
        
        const html = `
            <div class="results-section">
                <h4>Resumo Geral</h4>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">${data.total_usuarios_elegiveis}</div>
                        <div class="stat-label">Usuários Elegíveis</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.total_respostas}</div>
                        <div class="stat-label">Respostas</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.taxa_resposta}%</div>
                        <div class="stat-label">Taxa de Resposta</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.total_perguntas}</div>
                        <div class="stat-label">Perguntas</div>
                    </div>
                </div>
            </div>
            
            ${data.perguntas.map((pergunta, index) => `
                <div class="results-section">
                    <h4>${index + 1}. ${pergunta.pergunta}</h4>
                    <p><strong>Total de respostas:</strong> ${pergunta.total_respostas}</p>
                    
                    ${this.renderQuestionResults(pergunta)}
                </div>
            `).join('')}
        `;
        
        document.getElementById('results-body').innerHTML = html;
    }

    renderQuestionResults(pergunta) {
        if (pergunta.tipo === 'multipla_escolha' && pergunta.estatisticas.opcoes) {
            const total = pergunta.total_respostas;
            return `
                <div class="stats-grid">
                    ${Object.entries(pergunta.estatisticas.opcoes).map(([opcao, count]) => `
                        <div class="stat-card">
                            <div class="stat-number">${count}</div>
                            <div class="stat-label">${opcao} (${Math.round(count/total*100)}%)</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (pergunta.tipo === 'escala' && pergunta.estatisticas.media !== undefined) {
            return `
                <div class="stat-card" style="margin-bottom: 20px;">
                    <div class="stat-number">${pergunta.estatisticas.media.toFixed(1)}</div>
                    <div class="stat-label">Média</div>
                </div>
                <div class="stats-grid">
                    ${Object.entries(pergunta.estatisticas.distribuicao).map(([valor, count]) => `
                        <div class="stat-card">
                            <div class="stat-number">${count}</div>
                            <div class="stat-label">Nota ${valor}</div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            // Mostrar algumas respostas de texto
            const respostasTexto = pergunta.respostas
                .filter(r => r.resposta_texto)
                .slice(0, 5);
            
            if (respostasTexto.length === 0) return '<p>Nenhuma resposta de texto disponível.</p>';
            
            return `
                <div class="responses-list">
                    ${respostasTexto.map(resposta => `
                        <div class="response-item">
                            <div class="response-text">${resposta.resposta_texto}</div>
                            <div class="response-meta">
                                ${resposta.autor} - ${this.formatDate(resposta.data_resposta)}
                            </div>
                        </div>
                    `).join('')}
                </div>
                ${pergunta.respostas.length > 5 ? `<p style="color: #718096; text-align: center; margin-top: 10px;">E mais ${pergunta.respostas.length - 5} respostas...</p>` : ''}
            `;
        }
    }

    viewDetails(surveyId) {
        // Implementar visualização de detalhes
        alert('Funcionalidade em desenvolvimento');
    }

    exportResults(surveyId) {
        // Implementar exportação
        alert('Funcionalidade em desenvolvimento');
    }

    async viewMyResponse(surveyId) {
        try {
            console.log('👤 Visualizando minha resposta para pesquisa:', surveyId);
            
            const response = await fetch(`/api/surveys/${surveyId}/my-response`);
            if (!response.ok) {
                throw new Error('Erro ao carregar sua resposta');
            }
            
            const data = await response.json();
            console.log('📦 Dados recebidos do backend:', data);
            console.log('📦 Respostas:', data.responses);
            
            // Usar a mesma função do index.js para padronizar o modal
            showMyResponseModalPesquisas(data);
            
        } catch (error) {
            console.error('❌ Erro ao carregar resposta:', error);
            alert('Erro ao carregar sua resposta: ' + error.message);
        }
    }

    // Função auxiliar para formatar resposta baseada no tipo
    formatResponse(resposta, tipo) {
        if (!resposta) return 'Sem resposta';
        
        switch (tipo) {
            case 'escala':
                const num = parseInt(resposta);
                const stars = '★'.repeat(num) + '☆'.repeat(Math.max(0, 5 - num));
                return `${stars} (${resposta}/5)`;
            case 'multipla_escolha':
                return resposta;
            default:
                return resposta;
        }
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('pt-BR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatDateLocal(dateString) {
        if (!dateString) return 'Não definido';
        
        // Solução simples: Interpretar a data como está salva no banco (horário brasileiro)
        // e exibir sem conversões de timezone
        
        // Se a string vem no formato ISO, converter para format local brasileiro
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

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
        document.getElementById('surveys-container').style.display = show ? 'none' : 'block';
    }

    showError(message) {
        console.error(message);
        document.getElementById('surveys-container').innerHTML = `
            <div style="text-align: center; padding: 40px; color: #e53e3e;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3em; margin-bottom: 20px;"></i>
                <h3>Erro ao carregar pesquisas</h3>
                <p>${message}</p>
                <button class="btn btn-primary" onclick="pesquisasNovo.loadSurveys()">
                    Tentar Novamente
                </button>
            </div>
        `;
    }

    showUpdateNotification(message) {
        // Criar elemento de notificação se não existir
        let notification = document.getElementById('update-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'update-notification';
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
            
            // Adicionar animação
            const style = document.createElement('style');
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
        
        notification.innerHTML = `
            <i class="fas fa-sync-alt fa-spin"></i>
            <span>${message}</span>
        `;
        notification.style.display = 'flex';
        
        // Remover após 3 segundos
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => {
                notification.style.display = 'none';
            }, 300);
        }, 3000);
    }

    // =====================================================
    // VISUALIZAÇÃO DE RESULTADOS DETALHADOS
    // =====================================================

    async loadResultsView(surveyId) {
        try {
            // Ocultar elementos da lista
            document.getElementById('loading').style.display = 'block';
            document.getElementById('surveys-container').style.display = 'none';
            document.getElementById('pagination').style.display = 'none';
            document.querySelector('.filters-section').style.display = 'none';
            
            // Atualizar header
            const headerLeft = document.querySelector('.header-left');
            headerLeft.innerHTML = `
                <h1><i class="fas fa-chart-bar"></i> Resultados da Pesquisa</h1>
                <p>Visualização detalhada de respostas e estatísticas</p>
            `;
            
            // Carregar dados da API
            const response = await fetch(`/api/surveys/${surveyId}/resultados/detalhado`);
            if (!response.ok) {
                throw new Error('Erro ao carregar resultados');
            }
            
            const data = await response.json();
            this.renderResultsView(data);
            
        } catch (error) {
            console.error('❌ Erro ao carregar visualização de resultados:', error);
            document.getElementById('loading').innerHTML = `
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444;"></i>
                <p style="color: #ef4444; margin-top: 16px;">Erro ao carregar resultados: ${error.message}</p>
            `;
        }
    }

    renderResultsView(data) {
        document.getElementById('loading').style.display = 'none';
        
        const container = document.getElementById('surveys-container');
        container.style.display = 'block';
        
        container.innerHTML = `
            <!-- Cabeçalho da Pesquisa -->
            <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
                    <div>
                        <h2 style="margin: 0 0 8px 0; color: #1f2937; font-size: 24px;">${data.titulo}</h2>
                        ${data.descricao ? `<p style="margin: 0; color: #6b7280;">${data.descricao}</p>` : ''}
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <button onclick="pesquisasNovo.exportarResultadosPDF()" class="btn btn-primary">
                            <i class="fas fa-file-pdf"></i> Exportar PDF
                        </button>
                        ${data.status_calculado === 'Encerrada' ? `
                            <button onclick="pesquisasNovo.abrirModalReabrir(${data.Id})" class="btn btn-success">
                                <i class="fas fa-redo"></i> Abrir Novamente
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <!-- Estatísticas Gerais -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 20px;">
                    <div style="background: linear-gradient(135deg, #0d556d, #1a7a99); padding: 20px; border-radius: 8px; color: white;">
                        <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Status</div>
                        <div style="font-size: 24px; font-weight: 700;">${data.status_calculado}</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 20px; border-radius: 8px; color: white;">
                        <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Taxa de Resposta</div>
                        <div style="font-size: 24px; font-weight: 700;">${data.taxa_resposta}%</div>
                        <div style="font-size: 12px; opacity: 0.9;">${data.total_respostas}/${data.total_usuarios_elegiveis} usuários</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); padding: 20px; border-radius: 8px; color: white;">
                        <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Total de Perguntas</div>
                        <div style="font-size: 24px; font-weight: 700;">${data.total_perguntas}</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 20px; border-radius: 8px; color: white;">
                        <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Criado por</div>
                        <div style="font-size: 16px; font-weight: 600;">${data.criador_nome}</div>
                    </div>
                </div>
            </div>
            
            <!-- Perguntas e Respostas -->
            <div id="questions-results">
                ${data.perguntas.map((pergunta, index) => this.renderQuestionResults(pergunta, index, data)).join('')}
            </div>
        `;
        
        // Armazenar dados para exportação
        this.currentResultsData = data;
    }

    renderQuestionResults(pergunta, index, surveyData) {
        const tipoIcones = {
            'texto_livre': 'fa-font',
            'multipla_escolha': 'fa-list-ul',
            'escala': 'fa-star',
            'sim_nao': 'fa-check-circle'
        };
        
        return `
            <div style="background: white; padding: 24px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <!-- Cabeçalho da Pergunta -->
                <div style="display: flex; align-items: start; gap: 16px; margin-bottom: 20px;">
                    <div style="background: #dbeafe; color: #0d556d; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;">
                        ${index + 1}
                    </div>
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                            <i class="fas ${tipoIcones[pergunta.tipo] || 'fa-question'}" style="color: #0d556d;"></i>
                            <span style="font-size: 12px; color: #6b7280; text-transform: uppercase; font-weight: 600;">${pergunta.tipo.replace('_', ' ')}</span>
                        </div>
                        <h3 style="margin: 0; color: #1f2937; font-size: 18px; line-height: 1.5;">${pergunta.pergunta}</h3>
                    </div>
                </div>
                
                <!-- Estatísticas da Pergunta -->
                <div style="background: #f9fafb; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="color: #6b7280; font-size: 14px;">Total de respostas:</span>
                            <span style="color: #1f2937; font-weight: 600; margin-left: 8px;">${pergunta.estatisticas.total_respostas}</span>
                        </div>
                        <div>
                            <span style="color: #6b7280; font-size: 14px;">Taxa de resposta:</span>
                            <span style="color: #10b981; font-weight: 700; margin-left: 8px;">${pergunta.estatisticas.porcentagem_responderam}%</span>
                        </div>
                    </div>
                    <div style="background: #e5e7eb; height: 8px; border-radius: 4px; margin-top: 12px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, #10b981, #059669); height: 100%; width: ${pergunta.estatisticas.porcentagem_responderam}%; transition: width 0.3s;"></div>
                    </div>
                </div>
                
                <!-- Visualização Específica por Tipo -->
                ${this.renderQuestionVisualization(pergunta, surveyData)}
                
                <!-- Respostas Individuais (se não for anônima) -->
                ${!surveyData.anonima && pergunta.respostas.length > 0 ? `
                    <div style="margin-top: 24px;">
                        <h4 style="margin: 0 0 16px 0; color: #374151; font-size: 16px;">
                            <i class="fas fa-users" style="margin-right: 8px; color: #0d556d;"></i>
                            Respostas Individuais
                        </h4>
                        <div style="display: flex; flex-direction: column; gap: 12px; max-height: 400px; overflow-y: auto;">
                            ${pergunta.respostas.map(r => `
                                <div style="background: #f9fafb; padding: 12px 16px; border-radius: 6px; border-left: 3px solid #0d556d;">
                                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                        <div>
                                            <strong style="color: #1f2937;">${r.usuario_nome}</strong>
                                            ${r.usuario_matricula ? `<span style="color: #6b7280; font-size: 12px; margin-left: 8px;">(${r.usuario_matricula})</span>` : ''}
                                        </div>
                                        <span style="color: #9ca3af; font-size: 12px;">${this.formatDateLocal(r.data_resposta)}</span>
                                    </div>
                                    <div style="color: #374151; ${pergunta.tipo === 'texto_livre' ? 'white-space: pre-wrap;' : ''}">
                                        ${r.resposta_texto || r.opcao_selecionada || r.resposta_numerica || 'Sem resposta'}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderQuestionVisualization(pergunta, surveyData) {
        if (pergunta.tipo === 'multipla_escolha' && pergunta.estatisticas.opcoes) {
            const opcoes = Object.entries(pergunta.estatisticas.opcoes);
            const maxCount = Math.max(...opcoes.map(([_, data]) => data.count));
            
            return `
                <div style="margin-top: 16px;">
                    <h4 style="margin: 0 0 16px 0; color: #374151; font-size: 16px;">
                        <i class="fas fa-chart-bar" style="margin-right: 8px; color: #0d556d;"></i>
                        Distribuição de Respostas
                    </h4>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        ${opcoes.map(([opcao, data]) => `
                            <div>
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                    <span style="color: #374151; font-weight: 500;">${opcao}</span>
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <span style="color: #6b7280; font-size: 14px;">${data.count} respostas</span>
                                        <span style="background: #dbeafe; color: #0d556d; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 700;">${data.porcentagem}%</span>
                                    </div>
                                </div>
                                <div style="background: #e5e7eb; height: 24px; border-radius: 6px; overflow: hidden; position: relative;">
                                    <div style="background: linear-gradient(90deg, #0d556d, #1a7a99); height: 100%; width: ${data.porcentagem}%; transition: width 0.5s; display: flex; align-items: center; justify-content: flex-end; padding-right: 8px;">
                                        ${data.porcentagem > 10 ? `<span style="color: white; font-size: 12px; font-weight: 600;">${data.count}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (pergunta.tipo === 'escala' && pergunta.estatisticas.media) {
            const distribuicao = Object.entries(pergunta.estatisticas.distribuicao);
            const maxCount = Math.max(...distribuicao.map(([_, data]) => data.count));
            
            return `
                <div style="margin-top: 16px;">
                    <div style="background: linear-gradient(135deg, #0d556d, #1a7a99); padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center; color: white;">
                        <div style="font-size: 14px; opacity: 0.9; margin-bottom: 8px;">Média Geral</div>
                        <div style="font-size: 48px; font-weight: 700;">${pergunta.estatisticas.media}</div>
                        <div style="font-size: 14px; opacity: 0.9;">Escala de ${pergunta.escala_min} a ${pergunta.escala_max}</div>
                    </div>
                    
                    <h4 style="margin: 0 0 16px 0; color: #374151; font-size: 16px;">
                        <i class="fas fa-chart-line" style="margin-right: 8px; color: #0d556d;"></i>
                        Distribuição das Notas
                    </h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 12px;">
                        ${distribuicao.map(([nota, data]) => `
                            <div style="background: #f9fafb; border: 2px solid ${data.count > 0 ? '#0d556d' : '#e5e7eb'}; border-radius: 8px; padding: 12px; text-align: center;">
                                <div style="font-size: 24px; font-weight: 700; color: ${data.count > 0 ? '#0d556d' : '#9ca3af'}; margin-bottom: 4px;">${nota}</div>
                                <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">${data.count} votos</div>
                                <div style="font-size: 12px; font-weight: 600; color: ${data.count > 0 ? '#0d556d' : '#9ca3af'};">${data.porcentagem}%</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else {
            return `
                <div style="color: #6b7280; font-size: 14px; font-style: italic;">
                    <i class="fas fa-info-circle" style="margin-right: 6px;"></i>
                    Respostas de texto livre - veja abaixo as respostas individuais
                </div>
            `;
        }
    }

    async abrirModalReabrir(surveyId) {
        // Criar modal
        const modalHtml = `
            <div id="reabrir-modal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
                <div style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; width: 90%;">
                    <h3 style="margin: 0 0 16px 0; color: #1f2937;">
                        <i class="fas fa-redo" style="color: #10b981; margin-right: 8px;"></i>
                        Reabrir Pesquisa
                    </h3>
                    <p style="margin: 0 0 20px 0; color: #6b7280;">
                        Selecione a nova data e hora de encerramento para reabrir esta pesquisa:
                    </p>
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; color: #374151; font-weight: 500;">
                            Data e Hora de Encerramento
                        </label>
                        <input type="datetime-local" id="nova-data-encerramento" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
                    </div>
                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button onclick="fecharModalReabrir()" class="btn btn-secondary">
                            Cancelar
                        </button>
                        <button onclick="pesquisasNovo.confirmarReabertura(${surveyId})" class="btn btn-success">
                            <i class="fas fa-check"></i> Reabrir Pesquisa
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Definir data mínima (agora)
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('nova-data-encerramento').min = now.toISOString().slice(0, 16);
    }

    async confirmarReabertura(surveyId) {
        try {
            const novaData = document.getElementById('nova-data-encerramento').value;
            
            if (!novaData) {
                alert('Por favor, selecione uma data e hora');
                return;
            }
            
            const response = await fetch(`/api/surveys/${surveyId}/reabrir`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ nova_data_encerramento: novaData })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }
            
            alert('Pesquisa reaberta com sucesso!');
            fecharModalReabrir();
            
            // Recarregar visualização
            const urlParams = new URLSearchParams(window.location.search);
            const surveyIdParam = urlParams.get('id');
            this.loadResultsView(parseInt(surveyIdParam));
            
        } catch (error) {
            console.error('Erro ao reabrir pesquisa:', error);
            alert('Erro ao reabrir pesquisa: ' + error.message);
        }
    }

    async exportarResultadosPDF() {
        try {
            if (!this.currentResultsData) {
                alert('Erro: Dados não encontrados');
                return;
            }
            
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const data = this.currentResultsData;
            
            let y = 20; // Posição vertical inicial
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 15;
            const maxWidth = pageWidth - (margin * 2);
            
            // Título do relatório
            doc.setFontSize(18);
            doc.setTextColor(13, 85, 109); // #0d556d
            doc.text('Relatório de Resultados da Pesquisa', margin, y);
            y += 10;
            
            // Título da pesquisa
            doc.setFontSize(14);
            doc.setTextColor(31, 41, 55);
            const tituloLines = doc.splitTextToSize(data.titulo, maxWidth);
            doc.text(tituloLines, margin, y);
            y += tituloLines.length * 7 + 5;
            
            // Descrição (se houver)
            if (data.descricao) {
                doc.setFontSize(10);
                doc.setTextColor(107, 114, 128);
                const descLines = doc.splitTextToSize(data.descricao, maxWidth);
                doc.text(descLines, margin, y);
                y += descLines.length * 5 + 10;
            }
            
            // Linha divisória
            doc.setDrawColor(229, 231, 235);
            doc.line(margin, y, pageWidth - margin, y);
            y += 10;
            
            // Estatísticas gerais
            doc.setFontSize(12);
            doc.setTextColor(13, 85, 109);
            doc.text('Estatísticas Gerais', margin, y);
            y += 8;
            
            doc.setFontSize(10);
            doc.setTextColor(55, 65, 81);
            doc.text(`Status: ${data.status_calculado}`, margin, y);
            doc.text(`Taxa de Resposta: ${data.taxa_resposta}%`, margin + 60, y);
            y += 6;
            doc.text(`Respostas: ${data.total_respostas}/${data.total_usuarios_elegiveis} usuários`, margin, y);
            doc.text(`Total de Perguntas: ${data.total_perguntas}`, margin + 60, y);
            y += 6;
            doc.text(`Criado por: ${data.criador_nome}`, margin, y);
            y += 15;
            
            // Perguntas e respostas
            data.perguntas.forEach((pergunta, index) => {
                // Verificar se precisa de nova página
                if (y > 250) {
                    doc.addPage();
                    y = 20;
                }
                
                // Cabeçalho da pergunta
                doc.setFontSize(12);
                doc.setTextColor(13, 85, 109);
                const perguntaText = `${index + 1}. ${pergunta.pergunta}`;
                const perguntaLines = doc.splitTextToSize(perguntaText, maxWidth);
                doc.text(perguntaLines, margin, y);
                y += perguntaLines.length * 7 + 5;
                
                // Tipo da pergunta
                doc.setFontSize(9);
                doc.setTextColor(107, 114, 128);
                doc.text(`Tipo: ${pergunta.tipo.replace('_', ' ').toUpperCase()}`, margin, y);
                y += 6;
                
                // Estatísticas da pergunta
                doc.setFontSize(10);
                doc.setTextColor(55, 65, 81);
                doc.text(`Respostas: ${pergunta.estatisticas.total_respostas} (${pergunta.estatisticas.porcentagem_responderam}%)`, margin, y);
                y += 8;
                
                // Visualização específica por tipo
                if (pergunta.tipo === 'multipla_escolha' && pergunta.estatisticas.opcoes) {
                    doc.setFontSize(10);
                    doc.setTextColor(13, 85, 109);
                    doc.text('Distribuição de Respostas:', margin, y);
                    y += 6;
                    
                    Object.entries(pergunta.estatisticas.opcoes).forEach(([opcao, stats]) => {
                        if (y > 270) {
                            doc.addPage();
                            y = 20;
                        }
                        
                        doc.setFontSize(9);
                        doc.setTextColor(55, 65, 81);
                        const opcaoText = `• ${opcao}: ${stats.count} (${stats.porcentagem}%)`;
                        doc.text(opcaoText, margin + 5, y);
                        y += 5;
                    });
                    y += 5;
                } else if (pergunta.tipo === 'escala' && pergunta.estatisticas.media) {
                    doc.setFontSize(10);
                    doc.setTextColor(13, 85, 109);
                    doc.text(`Média: ${pergunta.estatisticas.media} (Escala de ${pergunta.escala_min} a ${pergunta.escala_max})`, margin, y);
                    y += 8;
                }
                
                // Respostas individuais (se não for anônima e houver respostas)
                if (!data.anonima && pergunta.respostas.length > 0 && pergunta.tipo === 'texto_livre') {
                    if (y > 250) {
                        doc.addPage();
                        y = 20;
                    }
                    
                    doc.setFontSize(10);
                    doc.setTextColor(13, 85, 109);
                    doc.text('Respostas de texto:', margin, y);
                    y += 6;
                    
                    // Limitar a 5 respostas de texto para não ficar muito grande
                    const respostasTexto = pergunta.respostas.slice(0, 5);
                    respostasTexto.forEach(r => {
                        if (y > 260) {
                            doc.addPage();
                            y = 20;
                        }
                        
                        doc.setFontSize(8);
                        doc.setTextColor(107, 114, 128);
                        doc.text(`• ${r.usuario_nome}:`, margin + 5, y);
                        y += 4;
                        
                        doc.setFontSize(8);
                        doc.setTextColor(55, 65, 81);
                        const respostaText = r.resposta_texto || r.opcao_selecionada || r.resposta_numerica || 'Sem resposta';
                        const respostaLines = doc.splitTextToSize(respostaText, maxWidth - 10);
                        doc.text(respostaLines, margin + 8, y);
                        y += respostaLines.length * 4 + 3;
                    });
                    
                    if (pergunta.respostas.length > 5) {
                        doc.setFontSize(8);
                        doc.setTextColor(107, 114, 128);
                        doc.text(`... e mais ${pergunta.respostas.length - 5} respostas`, margin + 5, y);
                        y += 5;
                    }
                }
                
                // Linha divisória entre perguntas
                if (y < 270) {
                    doc.setDrawColor(229, 231, 235);
                    doc.line(margin, y, pageWidth - margin, y);
                    y += 10;
                }
            });
            
            // Rodapé em todas as páginas
            const totalPages = doc.internal.getNumberOfPages();
            for (let i = 1; i <= totalPages; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(156, 163, 175);
                doc.text(
                    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
                    margin,
                    doc.internal.pageSize.getHeight() - 10
                );
                doc.text(
                    `Página ${i} de ${totalPages}`,
                    pageWidth - margin - 30,
                    doc.internal.pageSize.getHeight() - 10
                );
            }
            
            // Salvar o PDF
            const nomeArquivo = `Resultados_${data.titulo.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            doc.save(nomeArquivo);
            
            console.log('✅ PDF gerado com sucesso:', nomeArquivo);
            
        } catch (error) {
            console.error('❌ Erro ao gerar PDF:', error);
            alert('Erro ao gerar PDF: ' + error.message);
        }
    }
}

// Funções globais para os modais
function closeResponseModal() {
    document.getElementById('response-modal').style.display = 'none';
}

function closeResultsModal() {
    document.getElementById('results-modal').style.display = 'none';
}

function fecharModalReabrir() {
    const modal = document.getElementById('reabrir-modal');
    if (modal) {
        modal.remove();
    }
}

// Inicializar quando a página carregar
let pesquisasNovo;
// Funções globais para modais
function closeMyResponseModal() {
    const modal = document.getElementById('my-response-modal');
    if (modal) {
        modal.remove();
    }
}

function closeResponseModal() {
    const modal = document.getElementById('response-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function closeMyResponseModalPesquisas() {
    const modal = document.getElementById('my-response-modal-pesquisas');
    if (modal) {
        modal.remove();
        // Remover classe do body para restaurar scroll
        document.body.classList.remove('modal-open');
    }
}

// Função padronizada para mostrar modal de resposta (mesma do index.js)
function showMyResponseModalPesquisas(data) {
    // Calcular estatísticas da resposta
    const totalPerguntas = data.responses.length;
    
    // Função auxiliar para verificar se uma pergunta foi respondida
    const perguntaFoiRespondida = (r) => {
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
    
    console.log('📊 Completude calculada:', {
        totalPerguntas,
        perguntasRespondidas,
        percentualCompleto
    });
    
    // Adicionar classe ao body para prevenir scroll
    document.body.classList.add('modal-open');
    
    // Criar modal em tela cheia
    const modalHtml = `
        <div class="modal-overlay-fullscreen" id="my-response-modal-pesquisas">
            <div class="modal modal-fullscreen">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 style="margin: 0; color: #1f2937; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                            <i class="fas fa-eye" style="color: #6b7280;"></i>
                            Minha Resposta - ${data.survey.titulo}
                        </h3>
                    </div>
                    
                    <div class="modal-body">
                        <!-- Cards de informações -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
                            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <i class="fas fa-calendar-check" style="color: #10b981; font-size: 16px;"></i>
                                    <span style="font-weight: 600; color: #374151; font-size: 14px;">Data da Resposta</span>
                                </div>
                                <div style="color: #1f2937; font-size: 16px; font-weight: 500;">
                                    ${formatDateLocal(data.response_date)}
                                </div>
                            </div>
                            
                            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <i class="fas fa-chart-bar" style="color: #3b82f6; font-size: 16px;"></i>
                                    <span style="font-weight: 600; color: #374151; font-size: 14px;">Completude</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                    <div style="flex: 1; background: #e5e7eb; height: 8px; border-radius: 4px; overflow: hidden;">
                                        <div style="width: ${percentualCompleto}%; height: 100%; background: #3b82f6; border-radius: 4px;"></div>
                                    </div>
                                    <span style="font-size: 14px; font-weight: 600; color: #3b82f6;">${percentualCompleto}%</span>
                                </div>
                                <div style="color: #6b7280; font-size: 12px;">
                                    ${perguntasRespondidas} de ${totalPerguntas} perguntas
                                </div>
                            </div>
                        </div>
                        
                        <!-- Lista de respostas -->
                        <div style="display: flex; flex-direction: column; gap: 16px; min-height: auto !important; overflow-y: auto;">
                            ${data.responses.map((resp, index) => {
                                // Verificar se há resposta considerando o tipo de pergunta
                                let temResposta = false;
                                if (resp.pergunta_tipo === 'multipla_escolha') {
                                    temResposta = !!(resp.resposta_texto || resp.option_id || resp.opcao_selecionada);
                                } else if (resp.pergunta_tipo === 'escala') {
                                    temResposta = resp.resposta_numerica !== null && resp.resposta_numerica !== undefined;
                                } else {
                                    temResposta = !!(resp.resposta_texto && resp.resposta_texto.trim());
                                }
                                
                                return `
                                <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                                    <div style="background: #f9fafb; padding: 16px; border-bottom: 1px solid #e5e7eb;">
                                        <div style="display: flex; align-items: center; gap: 12px;">
                                            <div style="background: #3b82f6; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; flex-shrink: 0;">
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
                                        ${temResposta ? `
                                            <div style="color: #1f2937; font-size: 14px; line-height: 1.5;">
                                                ${formatResponseForDisplay(resp)}
                                            </div>
                                        ` : `
                                            <div style="color: #9ca3af; font-style: italic; font-size: 14px;">
                                                <i class="fas fa-exclamation-circle" style="margin-right: 6px;"></i>
                                                Não respondida
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
                        <button type="button" onclick="closeMyResponseModalPesquisas()" class="btn btn-secondary">
                            <i class="fas fa-times"></i> Fechar
                        </button>
                        <button type="button" onclick="printModalContentPesquisas()" class="btn btn-primary">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Inserir o modal no DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// Função para formatar resposta para exibição com informações completas
function formatResponseForDisplay(resp) {
    console.log('🎨 formatResponseForDisplay - Dados recebidos:', resp);
    
    // Buscar a resposta de diferentes campos dependendo do tipo
    let resposta = resp.resposta_texto || resp.resposta_numerica;
    
    console.log('🎨 Resposta inicial:', resposta, '| Tipo:', resp.pergunta_tipo);
    
    // Para múltipla escolha, também verificar option_id
    if (resp.pergunta_tipo === 'multipla_escolha' && resp.option_id && !resposta) {
        // Se temos option_id mas não temos resposta_texto, tentar encontrar nas opções
        if (resp.opcoes) {
            const opcoes = typeof resp.opcoes === 'string' ? resp.opcoes.split('|') : resp.opcoes;
            resposta = opcoes[resp.option_id - 1] || 'Opção selecionada';
            console.log('🎨 Resposta de múltipla escolha encontrada:', resposta);
        }
    }
    
    const tipo = resp.pergunta_tipo;
    
    if (!resposta && resposta !== 0) {
        console.log('⚠️ Nenhuma resposta encontrada para exibir');
        return 'Não respondida';
    }
    
    switch (tipo) {
        case 'escala':
            const num = parseInt(resposta);
            if (!isNaN(num)) {
                const escalaMin = resp.escala_min || 1;
                const escalaMax = resp.escala_max || 9;
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
            console.log('🔵 Renderizando múltipla escolha - resposta:', resposta, '| opcoes:', resp.opcoes);
            if (resp.opcoes) {
                try {
                    let opcoes;
                    if (typeof resp.opcoes === 'string') {
                        opcoes = resp.opcoes.includes('|') ? resp.opcoes.split('|') : [resp.opcoes];
                    } else if (Array.isArray(resp.opcoes)) {
                        opcoes = resp.opcoes;
                    } else {
                        opcoes = [];
                    }
                    
                    console.log('🔵 Opções processadas:', opcoes);
                    
                    if (opcoes.length > 0) {
                        return `
                            <div style="margin-bottom: 12px;">
                                <span style="font-size: 11px; color: #6b7280; font-weight: 500;">Opções disponíveis:</span>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                ${opcoes.map(opcao => {
                                    const isSelected = opcao.trim() === String(resposta).trim();
                                    console.log(`🔵 Comparando: "${opcao.trim()}" === "${String(resposta).trim()}" = ${isSelected}`);
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
                    }
                } catch (e) {
                    console.error('Erro ao processar opções:', e);
                }
            }
            return `<strong style="color: #0d556d;">${resposta}</strong>`;
            
        case 'sim_nao':
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

// Função para formatar data local (mesma do index.js)
function formatDateLocal(dateString) {
    if (!dateString) return 'Não definido';
    
    // Corrigir problema de timezone - interpretar como horário local brasileiro
    const date = new Date(dateString);
    
    // Verificar se a data é válida
    if (isNaN(date.getTime())) {
        return 'Data inválida';
    }
    
    // Formatar para o padrão brasileiro
    const options = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo'
    };
    
    return date.toLocaleDateString('pt-BR', options);
}

// Função personalizada para impressão sem duplicação (pesquisas-novo.js)
function printModalContentPesquisas() {
    // Criar uma nova janela para impressão
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    
    // Obter o conteúdo do modal
    const modal = document.getElementById('my-response-modal-pesquisas');
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

document.addEventListener('DOMContentLoaded', () => {
    pesquisasNovo = new PesquisasNovo();
});
