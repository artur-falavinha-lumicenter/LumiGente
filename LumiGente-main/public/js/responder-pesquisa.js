/**
 * FORMULÁRIO DE RESPOSTA DE PESQUISA
 * Sistema focado apenas em responder pesquisas
 */

class SurveyResponseForm {
    constructor() {
        this.surveyId = null;
        this.survey = null;
        this.responses = {};
        this.init();
    }

    init() {
        // Extrair ID da pesquisa da URL
        const urlParams = new URLSearchParams(window.location.search);
        this.surveyId = urlParams.get('id');
        
        if (!this.surveyId) {
            this.showError('ID da pesquisa não encontrado na URL');
            return;
        }

        this.loadSurvey();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Listener para envio do formulário
        document.getElementById('response-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.submitResponse();
        });
    }

    async loadSurvey() {
        try {
            console.log('🔄 Carregando pesquisa ID:', this.surveyId);
            
            const response = await fetch(`/api/surveys/${this.surveyId}`);
            
            if (!response.ok) {
                if (response.status === 403) {
                    throw new Error('Você não tem permissão para acessar esta pesquisa');
                } else if (response.status === 404) {
                    throw new Error('Pesquisa não encontrada');
                } else {
                    throw new Error('Erro ao carregar pesquisa');
                }
            }

            this.survey = await response.json();
            
            // Verificar se pode responder
            if (!this.survey.pode_responder) {
                throw new Error('Você não pode responder esta pesquisa');
            }

            // Verificar se já respondeu
            if (this.survey.ja_respondeu) {
                this.showAlreadyResponded();
                return;
            }

            // Verificar se está ativa
            if (this.survey.status !== 'Ativa') {
                throw new Error('Esta pesquisa não está mais ativa');
            }

            this.renderSurvey();
            
        } catch (error) {
            console.error('❌ Erro ao carregar pesquisa:', error);
            this.showError(error.message);
        }
    }

    renderSurvey() {
        // Atualizar cabeçalho
        document.getElementById('survey-title').textContent = this.survey.titulo;
        document.getElementById('survey-status').textContent = 
            `${this.survey.total_perguntas} pergunta(s) • ${this.survey.anonima ? 'Anônima' : 'Identificada'}`;

        // Mostrar descrição se houver
        if (this.survey.descricao) {
            document.getElementById('survey-description').textContent = this.survey.descricao;
            document.getElementById('survey-description').style.display = 'block';
        }

        // Renderizar perguntas
        const questionsContainer = document.getElementById('questions-container');
        questionsContainer.innerHTML = '';

        this.survey.perguntas.forEach((pergunta, index) => {
            const questionDiv = this.renderQuestion(pergunta, index);
            questionsContainer.appendChild(questionDiv);
        });

        // Mostrar formulário
        document.getElementById('loading').style.display = 'none';
        document.getElementById('survey-content').style.display = 'block';
    }

    renderQuestion(pergunta, index) {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'question-group';
        questionDiv.dataset.questionId = pergunta.Id;

        const titleDiv = document.createElement('div');
        titleDiv.className = 'question-title';
        titleDiv.innerHTML = `
            <div class="question-number">${index + 1}</div>
            <div class="question-text">
                ${pergunta.texto}
                ${pergunta.obrigatoria ? '<span class="question-required">*</span>' : ''}
            </div>
        `;
        questionDiv.appendChild(titleDiv);

        const inputContainer = document.createElement('div');
        
        switch (pergunta.tipo) {
            case 'texto':
                inputContainer.innerHTML = `
                    <input type="text" 
                           class="question-input" 
                           name="question_${pergunta.Id}"
                           placeholder="Digite sua resposta..."
                           ${pergunta.obrigatoria ? 'required' : ''}>
                `;
                break;

            case 'texto_longo':
                inputContainer.innerHTML = `
                    <textarea class="question-input" 
                              name="question_${pergunta.Id}"
                              placeholder="Digite sua resposta..."
                              ${pergunta.obrigatoria ? 'required' : ''}></textarea>
                `;
                break;

            case 'multipla_escolha':
                inputContainer.className = 'radio-group';
                console.log(`🔵 Renderizando opções para pergunta ${pergunta.Id}:`, pergunta.opcoes);
                pergunta.opcoes.forEach((opcao, optIndex) => {
                    const optionDiv = document.createElement('div');
                    optionDiv.className = 'radio-option';
                    
                    const radioId = `q${pergunta.Id}_opt${optIndex}`;
                    const radioInput = document.createElement('input');
                    radioInput.type = 'radio';
                    radioInput.id = radioId;
                    radioInput.name = `question_${pergunta.Id}`;
                    // FIX: opcao é um objeto {Id, opcao, ordem}, não apenas string
                    radioInput.value = opcao.Id || opcao;
                    if (pergunta.obrigatoria) radioInput.required = true;
                    
                    console.log(`   → Opção ${optIndex}: ID=${opcao.Id || opcao}, Texto="${opcao.opcao || opcao}"`);
                    
                    const radioLabel = document.createElement('label');
                    radioLabel.htmlFor = radioId;
                    radioLabel.textContent = opcao.opcao || opcao;
                    
                    optionDiv.appendChild(radioInput);
                    optionDiv.appendChild(radioLabel);
                    
                    // Event listener para visual feedback
                    optionDiv.addEventListener('click', (e) => {
                        e.preventDefault();
                        inputContainer.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
                        optionDiv.classList.add('selected');
                        radioInput.checked = true;
                    });
                    
                    // Event listener para o input radio
                    radioInput.addEventListener('change', () => {
                        inputContainer.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
                        optionDiv.classList.add('selected');
                    });
                    
                    inputContainer.appendChild(optionDiv);
                });
                break;

            case 'escala':
                const escalaMin = pergunta.escala_min || 1;
                const escalaMax = pergunta.escala_max || 5;
                inputContainer.className = 'radio-group';
                
                for (let i = escalaMin; i <= escalaMax; i++) {
                    const optionDiv = document.createElement('div');
                    optionDiv.className = 'radio-option';
                    
                    const radioId = `q${pergunta.Id}_scale${i}`;
                    const radioInput = document.createElement('input');
                    radioInput.type = 'radio';
                    radioInput.id = radioId;
                    radioInput.name = `question_${pergunta.Id}`;
                    radioInput.value = i;
                    if (pergunta.obrigatoria) radioInput.required = true;
                    
                    const radioLabel = document.createElement('label');
                    radioLabel.htmlFor = radioId;
                    radioLabel.textContent = i;
                    
                    optionDiv.appendChild(radioInput);
                    optionDiv.appendChild(radioLabel);
                    
                    optionDiv.addEventListener('click', (e) => {
                        e.preventDefault();
                        inputContainer.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
                        optionDiv.classList.add('selected');
                        radioInput.checked = true;
                    });
                    
                    radioInput.addEventListener('change', () => {
                        inputContainer.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
                        optionDiv.classList.add('selected');
                    });
                    
                    inputContainer.appendChild(optionDiv);
                }
                break;

            default:
                inputContainer.innerHTML = `
                    <input type="text" 
                           class="question-input" 
                           name="question_${pergunta.Id}"
                           placeholder="Digite sua resposta..."
                           ${pergunta.obrigatoria ? 'required' : ''}>
                `;
        }

        questionDiv.appendChild(inputContainer);
        return questionDiv;
    }

    async submitResponse() {
        try {
            // Coletar respostas
            const formData = new FormData(document.getElementById('response-form'));
            const responses = [];

            this.survey.perguntas.forEach(pergunta => {
                const fieldName = `question_${pergunta.Id}`;
                const value = formData.get(fieldName);
                
                console.log(`📝 Processando pergunta ${pergunta.Id} (${pergunta.tipo}): valor="${value}"`);
                
                if (value) {
                    const response = {
                        question_id: pergunta.Id
                    };
                    
                    // Determinar como salvar baseado no tipo da pergunta
                    if (pergunta.tipo === 'escala') {
                        response.resposta_numerica = parseInt(value);
                        console.log(`   → Salvando como resposta_numerica: ${parseInt(value)}`);
                    } else if (pergunta.tipo === 'multipla_escolha') {
                        response.option_id = parseInt(value);
                        console.log(`   → Salvando como option_id: ${parseInt(value)}`);
                    } else {
                        // texto_livre, sim_nao
                        response.resposta_texto = value;
                        console.log(`   → Salvando como resposta_texto: "${value}"`);
                    }
                    
                    responses.push(response);
                } else if (pergunta.obrigatoria) {
                    throw new Error(`A pergunta "${pergunta.texto}" é obrigatória`);
                }
            });

            if (responses.length === 0) {
                throw new Error('Você deve responder pelo menos uma pergunta');
            }

            // Enviar respostas
            console.log('📤 Enviando respostas:', responses);
            
            const response = await fetch(`/api/surveys/${this.surveyId}/responder`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ respostas: responses })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Erro ao enviar respostas');
            }

            this.showSuccess();

        } catch (error) {
            console.error('❌ Erro ao enviar resposta:', error);
            this.showError(error.message);
        }
    }

    showError(message) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('survey-content').style.display = 'none';
        document.getElementById('success-message').style.display = 'none';
        
        const errorElement = document.getElementById('error-message');
        errorElement.textContent = message;
        errorElement.style.display = 'block';
    }

    showSuccess() {
        document.getElementById('survey-content').style.display = 'none';
        document.getElementById('error-message').style.display = 'none';
        
        const successElement = document.getElementById('success-message');
        successElement.innerHTML = `
            <i class="fas fa-check-circle" style="font-size: 24px; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-weight: 600;">Resposta enviada com sucesso!</p>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.8;">Obrigado por participar da pesquisa.</p>
            <button onclick="window.close()" class="btn btn-primary" style="margin-top: 16px;">
                <i class="fas fa-times"></i> Fechar
            </button>
        `;
        successElement.style.display = 'block';

        // Notificar a janela pai para atualizar a interface
        if (window.opener && !window.opener.closed) {
            window.opener.postMessage({
                type: 'SURVEY_RESPONSE_SUBMITTED',
                surveyId: this.surveyId
            }, '*');
        }

        // Fechar automaticamente após 3 segundos
        setTimeout(() => {
            window.close();
        }, 3000);
    }

    showAlreadyResponded() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('survey-content').style.display = 'none';
        document.getElementById('error-message').style.display = 'none';
        
        const successElement = document.getElementById('success-message');
        successElement.innerHTML = `
            <i class="fas fa-info-circle" style="font-size: 24px; margin-bottom: 8px;"></i>
            <p style="margin: 0; font-weight: 600;">Você já respondeu esta pesquisa</p>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.8;">Obrigado por sua participação!</p>
            <button onclick="window.close()" class="btn btn-primary" style="margin-top: 16px;">
                <i class="fas fa-times"></i> Fechar
            </button>
        `;
        successElement.style.display = 'block';
    }
}

// Inicializar quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', () => {
    new SurveyResponseForm();
});
