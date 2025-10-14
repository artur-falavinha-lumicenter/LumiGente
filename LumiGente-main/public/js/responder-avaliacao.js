/**
 * ================================================================
 * MÓDULO DE RESPOSTA E VISUALIZAÇÃO DE AVALIAÇÕES
 * ================================================================
 * Funções para carregar questionário, renderizar perguntas,
 * salvar respostas e visualizar respostas de avaliações
 * ================================================================
 */

/**
 * Troca entre abas do modal de avaliação
 */
function trocarAbaAvaliacao(aba) {
    // Atualizar abas
    document.querySelectorAll('.avaliacao-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-avaliacao-tab="${aba}"]`)?.classList.add('active');
    
    // Mostrar conteúdo correspondente
    if (aba === 'responder') {
        document.getElementById('aba-responder-avaliacao').classList.remove('hidden');
        document.getElementById('aba-visualizar-respostas').classList.add('hidden');
        document.getElementById('btn-enviar-avaliacao').style.display = 'inline-flex';
    } else {
        document.getElementById('aba-responder-avaliacao').classList.add('hidden');
        document.getElementById('aba-visualizar-respostas').classList.remove('hidden');
        document.getElementById('btn-enviar-avaliacao').style.display = 'none';
        carregarRespostasAvaliacao(avaliacaoAtual.Id);
    }
}

/**
 * Carrega questionário da avaliação
 */
async function carregarQuestionarioAvaliacao(avaliacao) {
    const container = document.getElementById('formulario-avaliacao');
    container.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando questionário...</div>';
    
    try {
        // Buscar perguntas específicas da avaliação (snapshot)
        const tipo = avaliacao.TipoAvaliacao.includes('45') ? '45' : '90';
        const response = await fetch(`/api/avaliacoes/${avaliacao.Id}/respostas`);
        if (!response.ok) throw new Error('Erro ao carregar questionário');
        
        const dadosRespostas = await response.json();
        const perguntas = dadosRespostas.perguntas;
        renderizarQuestionario(perguntas, tipo);
        
    } catch (error) {
        console.error('Erro ao carregar questionário:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <i class="fas fa-exclamation-circle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h4>Erro ao carregar questionário</h4>
                <p>${error.message}</p>
            </div>
        `;
    }
}

/**
 * Renderiza questionário completo
 */
function renderizarQuestionario(perguntas, tipo) {
    const container = document.getElementById('formulario-avaliacao');
    
    if (perguntas.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h4>Nenhuma pergunta cadastrada</h4>
            </div>
        `;
        return;
    }
    
    const html = perguntas.map((pergunta, index) => `
        <div class="pergunta-avaliacao" data-pergunta-id="${pergunta.Id}">
            <div class="pergunta-avaliacao-header">
                <span class="pergunta-numero-badge">${pergunta.Ordem}</span>
                <div class="pergunta-titulo">
                    ${pergunta.Pergunta}
                    ${pergunta.Obrigatoria ? '<span class="pergunta-obrigatoria-badge">*</span>' : ''}
                </div>
            </div>
            ${renderizarCampoPergunta(pergunta, tipo)}
        </div>
    `).join('');
    
    container.innerHTML = html;
}

/**
 * Renderiza campo específico baseado no tipo de pergunta
 */
function renderizarCampoPergunta(pergunta, tipoQuestionario) {
    const perguntaId = pergunta.Id;
    
    switch (pergunta.TipoPergunta) {
        case 'texto':
            return `
                <textarea 
                    class="form-textarea" 
                    id="resposta-${perguntaId}" 
                    placeholder="Digite sua resposta..."
                    rows="4"
                    ${pergunta.Obrigatoria ? 'required' : ''}
                ></textarea>
            `;
        
        case 'multipla_escolha':
            return `
                <div class="opcoes-resposta">
                    ${pergunta.Opcoes.map(opcao => `
                        <label class="opcao-resposta-item" onclick="selecionarOpcao(this, ${perguntaId}, ${opcao.Id})">
                            <input 
                                type="radio" 
                                name="resposta-${perguntaId}" 
                                value="${opcao.Id}" 
                                ${pergunta.Obrigatoria ? 'required' : ''}
                            />
                            <span>${opcao.TextoOpcao}</span>
                        </label>
                    `).join('')}
                </div>
            `;
        
        case 'escala':
            const min = pergunta.EscalaMinima || 1;
            const max = pergunta.EscalaMaxima || 5;
            const opcoes = [];
            
            for (let i = min; i <= max; i++) {
                opcoes.push(i);
            }
            
            return `
                <div class="escala-resposta">
                    ${opcoes.map(valor => `
                        <div class="escala-opcao" onclick="selecionarEscala(this, ${perguntaId}, ${valor})">
                            <span class="escala-numero">${valor}</span>
                            ${valor === min && pergunta.EscalaLabelMinima ? 
                                `<span class="escala-label">${pergunta.EscalaLabelMinima}</span>` : 
                                valor === max && pergunta.EscalaLabelMaxima ? 
                                `<span class="escala-label">${pergunta.EscalaLabelMaxima}</span>` : 
                                ''}
                        </div>
                    `).join('')}
                </div>
                <input type="hidden" id="resposta-${perguntaId}" ${pergunta.Obrigatoria ? 'required' : ''} />
            `;
        
        case 'sim_nao':
            return `
                <div class="simnao-resposta">
                    <div class="simnao-opcao" onclick="selecionarSimNao(this, ${perguntaId}, 'Sim')">
                        <i class="fas fa-check-circle" style="font-size: 20px; margin-right: 8px;"></i>
                        Sim
                    </div>
                    <div class="simnao-opcao nao" onclick="selecionarSimNao(this, ${perguntaId}, 'Não')">
                        <i class="fas fa-times-circle" style="font-size: 20px; margin-right: 8px;"></i>
                        Não
                    </div>
                </div>
                <input type="hidden" id="resposta-${perguntaId}" ${pergunta.Obrigatoria ? 'required' : ''} />
            `;
        
        default:
            return '<p style="color: #ef4444;">Tipo de pergunta não suportado</p>';
    }
}

/**
 * Seleciona opção de múltipla escolha
 */
function selecionarOpcao(elemento, perguntaId, opcaoId) {
    // Remover seleção anterior
    const parent = elemento.parentElement;
    parent.querySelectorAll('.opcao-resposta-item').forEach(item => {
        item.classList.remove('selecionada');
    });
    
    // Adicionar seleção
    elemento.classList.add('selecionada');
    
    // Marcar o radio
    const radio = elemento.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    
    // Armazenar resposta
    respostasAvaliacao[perguntaId] = {
        tipo: 'multipla_escolha',
        opcaoId: opcaoId,
        valor: opcaoId
    };
    
    console.log(`✓ Opção ${opcaoId} selecionada para pergunta ${perguntaId}`);
}

/**
 * Seleciona valor da escala
 */
function selecionarEscala(elemento, perguntaId, valor) {
    // Remover seleção anterior
    const parent = elemento.parentElement;
    parent.querySelectorAll('.escala-opcao').forEach(item => {
        item.classList.remove('selecionada');
    });
    
    // Adicionar seleção
    elemento.classList.add('selecionada');
    
    // Armazenar valor no input hidden
    document.getElementById(`resposta-${perguntaId}`).value = valor;
    
    // Armazenar resposta
    respostasAvaliacao[perguntaId] = {
        tipo: 'escala',
        valor: valor
    };
    
    console.log(`✓ Valor ${valor} selecionado para pergunta ${perguntaId}`);
}

/**
 * Seleciona Sim ou Não
 */
function selecionarSimNao(elemento, perguntaId, valor) {
    // Remover seleção anterior
    const parent = elemento.parentElement;
    parent.querySelectorAll('.simnao-opcao').forEach(item => {
        item.classList.remove('selecionada');
    });
    
    // Adicionar seleção
    elemento.classList.add('selecionada');
    
    // Armazenar valor no input hidden
    document.getElementById(`resposta-${perguntaId}`).value = valor;
    
    // Armazenar resposta
    respostasAvaliacao[perguntaId] = {
        tipo: 'sim_nao',
        valor: valor
    };
    
    console.log(`✓ "${valor}" selecionado para pergunta ${perguntaId}`);
}

/**
 * Envia respostas da avaliação
 */
async function enviarRespostasAvaliacao() {
    if (!avaliacaoAtual) {
        alert('Erro: Avaliação não encontrada');
        return;
    }
    
    try {
        // Coletar respostas de texto que ainda não foram coletadas
        const textareas = document.querySelectorAll('#formulario-avaliacao textarea');
        textareas.forEach(textarea => {
            const perguntaId = parseInt(textarea.id.replace('resposta-', ''));
            const valor = textarea.value.trim();
            
            // Sempre atualizar respostas de texto
            if (valor || textarea.hasAttribute('required')) {
                respostasAvaliacao[perguntaId] = {
                    tipo: 'texto',
                    valor: valor
                };
            }
        });
        
        console.log('📋 Respostas coletadas:', respostasAvaliacao);
        
        // Buscar perguntas específicas da avaliação (snapshot)
        const tipo = avaliacaoAtual.TipoAvaliacao.includes('45') ? '45' : '90';
        const responseRespostas = await fetch(`/api/avaliacoes/${avaliacaoAtual.Id}/respostas`);
        const dadosRespostas = await responseRespostas.json();
        const perguntas = dadosRespostas.perguntas;
        
        // Validar perguntas obrigatórias
        const perguntasNaoRespondidas = [];
        
        for (const pergunta of perguntas) {
            if (pergunta.Obrigatoria) {
                const resposta = respostasAvaliacao[pergunta.Id];
                
                console.log(`Validando pergunta ${pergunta.Ordem} (ID: ${pergunta.Id}):`, resposta);
                
                if (!resposta || !resposta.valor || resposta.valor.toString().trim() === '') {
                    console.log(`  ❌ Pergunta ${pergunta.Ordem} não respondida ou vazia`);
                    perguntasNaoRespondidas.push({
                        ordem: pergunta.Ordem,
                        pergunta: pergunta.Pergunta.substring(0, 50)
                    });
                } else {
                    console.log(`  ✅ Pergunta ${pergunta.Ordem} OK - Valor: ${resposta.valor}`);
                }
            }
        }
        
        if (perguntasNaoRespondidas.length > 0) {
            const detalhes = perguntasNaoRespondidas.map(p => `  ${p.ordem}. ${p.pergunta}...`).join('\n');
            alert(`Por favor, responda todas as perguntas obrigatórias (marcadas com *).\n\nPerguntas pendentes:\n${detalhes}`);
            return;
        }
        
        // Preparar dados para envio
        const eColaborador = avaliacaoAtual.UserId === currentUser.userId;
        const tipoRespondente = eColaborador ? 'Colaborador' : 'Gestor';
        
        // Montar array de respostas
        const respostasArray = perguntas.map(pergunta => {
            const resposta = respostasAvaliacao[pergunta.Id];
            
            return {
                perguntaId: pergunta.Id,
                perguntaAvaliacaoId: pergunta.Id, // ID da pergunta específica da avaliação (snapshot)
                tipoQuestionario: tipo,
                pergunta: pergunta.Pergunta,
                tipoPergunta: pergunta.TipoPergunta,
                resposta: resposta?.valor?.toString() || '',
                opcaoSelecionadaId: resposta?.opcaoId || null,
                opcoes: pergunta.Opcoes || [] // Incluir opções para contexto
            };
        });
        
        console.log('📤 Enviando respostas:', respostasArray);
        
        // Enviar respostas
        const saveResponse = await fetch('/api/avaliacoes/responder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                avaliacaoId: avaliacaoAtual.Id,
                tipoRespondente: tipoRespondente,
                respostas: respostasArray
            })
        });
        
        if (!saveResponse.ok) {
            const errorData = await saveResponse.json();
            
            // Se a avaliação expirou, mostrar mensagem específica
            if (errorData.error && errorData.error.includes('expirada')) {
                alert('⏰ ' + errorData.error + '\n\n' + (errorData.message || 'Entre em contato com o RH se necessário.'));
                fecharModalResponderAvaliacao();
                loadAvaliacoes(); // Recarregar para atualizar o status
                return;
            }
            
            throw new Error(errorData.error || 'Erro ao salvar respostas');
        }
        
        alert('✅ Avaliação respondida com sucesso!');
        fecharModalResponderAvaliacao();
        
        // Recarregar lista de avaliações
        loadAvaliacoes();
        
    } catch (error) {
        console.error('Erro ao enviar respostas:', error);
        alert('❌ Erro ao enviar respostas: ' + error.message);
    }
}

/**
 * Carrega e exibe respostas da avaliação
 */
async function carregarRespostasAvaliacao(avaliacaoId) {
    const container = document.getElementById('respostas-avaliacao');
    container.innerHTML = '<div class="loading"><div class="spinner"></div>Carregando respostas...</div>';
    
    try {
        const response = await fetch(`/api/avaliacoes/${avaliacaoId}/respostas`);
        if (!response.ok) throw new Error('Erro ao carregar respostas');
        
        const dados = await response.json();
        renderizarRespostas(dados);
        
    } catch (error) {
        console.error('Erro ao carregar respostas:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #ef4444;">
                <i class="fas fa-exclamation-circle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h4>Erro ao carregar respostas</h4>
                <p>${error.message}</p>
            </div>
        `;
    }
}

/**
 * Renderiza respostas salvas (do usuário e do outro participante)
 */
function renderizarRespostas(dados) {
    const container = document.getElementById('respostas-avaliacao');
    
    const { minhasRespostas, respostasOutraParte, perguntas } = dados;
    
    // Para RH/Admin, "minhasRespostas" serão as do colaborador e "respostasOutraParte" as do gestor
    const eParticipante = avaliacaoAtual.UserId === currentUser.userId || 
                         avaliacaoAtual.GestorId === currentUser.userId;
    
    // Verificar se o usuário atual já respondeu
    const jaRespondeu = minhasRespostas && minhasRespostas.length > 0;
    
    // Se o usuário é participante e ainda não respondeu, não mostrar nada
    if (eParticipante && !jaRespondeu) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #f59e0b; background: #fffbeb; border-radius: 8px; border: 2px dashed #fbbf24;">
                <i class="fas fa-lock" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h4>Responda a avaliação primeiro</h4>
                <p style="color: #92400e; margin-bottom: 0;">
                    Você precisa responder a avaliação antes de visualizar as respostas.
                </p>
            </div>
        `;
        return;
    }
    
    // Se não há nenhuma resposta (caso RH/Admin)
    if ((!minhasRespostas || minhasRespostas.length === 0) && 
        (!respostasOutraParte || respostasOutraParte.length === 0)) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #6b7280;">
                <i class="fas fa-info-circle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h4>Nenhuma resposta registrada ainda</h4>
                <p>Aguardando respostas dos participantes</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    perguntas.forEach((pergunta, index) => {
        const minhaResp = minhasRespostas?.find(r => r.PerguntaId === pergunta.Id);
        const outraResp = respostasOutraParte?.find(r => r.PerguntaId === pergunta.Id);
        
        // Só mostrar resposta da outra parte se o usuário já respondeu ou se for RH/Admin
        const mostrarOutraResposta = outraResp && (!eParticipante || jaRespondeu);
        
        html += `
            <div class="pergunta-avaliacao">
                <div class="pergunta-avaliacao-header">
                    <span class="pergunta-numero-badge">${pergunta.Ordem}</span>
                    <div class="pergunta-titulo">${pergunta.Pergunta}</div>
                </div>
                
                <!-- Primeira resposta (pode ser do usuário ou do colaborador se for RH) -->
                ${minhaResp ? `
                    <div style="margin-bottom: ${mostrarOutraResposta ? '16px' : '0'};">
                        <p style="margin: 0 0 8px 0; color: #0d556d; font-weight: 600; font-size: 14px;">
                            <i class="fas fa-${eParticipante ? 'user' : (minhaResp.TipoRespondente === 'Colaborador' ? 'user' : 'user-tie')}"></i> 
                            ${eParticipante ? 'Sua Resposta' : `Resposta do ${minhaResp.TipoRespondente}`}:
                        </p>
                        <div style="padding: 12px; background: #dbeafe; border-left: 4px solid #0d556d; border-radius: 4px;">
                            ${formatarResposta(minhaResp, pergunta)}
                        </div>
                    </div>
                ` : ''}
                
                <!-- Segunda resposta (outra parte) - só mostra se o usuário já respondeu -->
                ${mostrarOutraResposta ? `
                    <div>
                        <p style="margin: 0 0 8px 0; color: #8b5cf6; font-weight: 600; font-size: 14px;">
                            <i class="fas fa-${outraResp.TipoRespondente === 'Gestor' ? 'user-tie' : 'user'}"></i> 
                            Resposta do ${outraResp.TipoRespondente}:
                        </p>
                        <div style="padding: 12px; background: #f3e8ff; border-left: 4px solid #8b5cf6; border-radius: 4px;">
                            ${formatarResposta(outraResp, pergunta)}
                        </div>
                    </div>
                ` : eParticipante && jaRespondeu ? `
                    <div style="padding: 12px; background: #f9fafb; border-left: 4px solid #e5e7eb; border-radius: 4px; text-align: center;">
                        <p style="margin: 0; color: #6b7280; font-size: 14px;">
                            <i class="fas fa-clock"></i> Aguardando resposta do ${minhaResp?.TipoRespondente === 'Colaborador' ? 'Gestor' : 'Colaborador'}
                        </p>
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    container.innerHTML = html;
}

/**
 * Formata resposta para exibição baseado no tipo de pergunta
 */
function formatarResposta(resposta, pergunta) {
    if (!resposta) return '<p style="margin: 0; color: #6b7280;">Não respondida</p>';
    
    switch (pergunta.TipoPergunta) {
        case 'multipla_escolha':
            // Mostrar todas as opções, destacando a selecionada
            if (!pergunta.Opcoes || pergunta.Opcoes.length === 0) {
                return `<p style="margin: 0; color: #111827; font-weight: 500;">${resposta.Resposta}</p>`;
            }
            
            return `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${pergunta.Opcoes.map(opcao => {
                        const selecionada = opcao.Id === resposta.OpcaoSelecionadaId || opcao.TextoOpcao === resposta.Resposta;
                        return `
                            <div style="padding: 10px 12px; border-radius: 6px; background: ${selecionada ? '#fff' : '#f9fafb'}; border: 2px solid ${selecionada ? '#0d556d' : '#e5e7eb'}; display: flex; align-items: center; gap: 8px;">
                                ${selecionada ? '<i class="fas fa-check-circle" style="color: #10b981; font-size: 16px;"></i>' : '<i class="far fa-circle" style="color: #d1d5db; font-size: 16px;"></i>'}
                                <span style="color: ${selecionada ? '#111827' : '#6b7280'}; font-weight: ${selecionada ? '600' : '400'};">${opcao.TextoOpcao}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        
        case 'escala':
            // Mostrar escala completa, destacando o valor selecionado
            const min = pergunta.EscalaMinima || 1;
            const max = pergunta.EscalaMaxima || 5;
            const valorSelecionado = parseInt(resposta.Resposta);
            const opcoes = [];
            
            for (let i = min; i <= max; i++) {
                opcoes.push(i);
            }
            
            return `
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${opcoes.map(valor => {
                        const selecionado = valor === valorSelecionado;
                        return `
                            <div style="flex: 1; min-width: 50px; padding: 12px 8px; border-radius: 6px; text-align: center; background: ${selecionado ? '#0d556d' : '#f9fafb'}; border: 2px solid ${selecionado ? '#0d556d' : '#e5e7eb'}; color: ${selecionado ? 'white' : '#6b7280'};">
                                <div style="font-size: 20px; font-weight: 700; margin-bottom: 4px;">${valor}</div>
                                ${valor === min && pergunta.EscalaLabelMinima ? 
                                    `<div style="font-size: 10px;">${pergunta.EscalaLabelMinima}</div>` : 
                                    valor === max && pergunta.EscalaLabelMaxima ? 
                                    `<div style="font-size: 10px;">${pergunta.EscalaLabelMaxima}</div>` : 
                                    ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        
        case 'sim_nao':
            // Mostrar Sim/Não, destacando o selecionado
            const valorSimNao = resposta.Resposta;
            return `
                <div style="display: flex; gap: 12px;">
                    <div style="flex: 1; padding: 12px; border-radius: 6px; text-align: center; background: ${valorSimNao === 'Sim' ? '#d1fae5' : '#f9fafb'}; border: 2px solid ${valorSimNao === 'Sim' ? '#10b981' : '#e5e7eb'}; color: ${valorSimNao === 'Sim' ? '#065f46' : '#6b7280'}; font-weight: 600;">
                        <i class="fas fa-check-circle" style="font-size: 18px; margin-right: 6px;"></i>
                        Sim
                    </div>
                    <div style="flex: 1; padding: 12px; border-radius: 6px; text-align: center; background: ${valorSimNao === 'Não' ? '#fee2e2' : '#f9fafb'}; border: 2px solid ${valorSimNao === 'Não' ? '#ef4444' : '#e5e7eb'}; color: ${valorSimNao === 'Não' ? '#991b1b' : '#6b7280'}; font-weight: 600;">
                        <i class="fas fa-times-circle" style="font-size: 18px; margin-right: 6px;"></i>
                        Não
                    </div>
                </div>
            `;
        
        case 'texto':
        default:
            // Texto livre
            return `<p style="margin: 0; color: #111827; white-space: pre-wrap;">${resposta.Resposta}</p>`;
    }
}

