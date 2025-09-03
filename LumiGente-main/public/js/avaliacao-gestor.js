let avaliacao = null;
let perguntas = [];
let autoavaliacao = {};
let avaliacaoGestor = {};

document.addEventListener('DOMContentLoaded', function () {
    carregarAvaliacao();
});

async function carregarAvaliacao() {
    try {
        document.getElementById('loading').style.display = 'block';

        // Obter ID da avaliação da URL
        const urlParams = new URLSearchParams(window.location.search);
        const avaliacaoId = urlParams.get('id');

        if (!avaliacaoId) {
            showError('ID da avaliação não fornecido');
            return;
        }

        // Carregar dados da avaliação
        const response = await fetch(`/api/avaliacoes/${avaliacaoId}/completa`);
        const result = await response.json();

        if (result.success) {
            avaliacao = result.avaliacao;
            perguntas = result.perguntas;
            autoavaliacao = result.autoavaliacao;
            renderizarAvaliacao();
        } else {
            showError('Erro ao carregar avaliação: ' + result.error);
        }
    } catch (error) {
        console.error('Erro ao carregar avaliação:', error);
        showError('Erro ao carregar avaliação');
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

function renderizarAvaliacao() {
    // Preencher informações da avaliação
    document.getElementById('nomeColaborador').textContent = avaliacao.nome_colaborador || 'Colaborador';
    document.getElementById('tipoAvaliacao').textContent = avaliacao.tipo_avaliacao === '45_dias' ? '45 Dias' : '90 Dias';
    document.getElementById('dataLimite').textContent = formatarData(avaliacao.data_limite);
    document.getElementById('observacoesIniciais').textContent = avaliacao.observacoes_gestor || 'Nenhuma observação';

    // Renderizar perguntas
    const container = document.getElementById('perguntasContainer');
    container.innerHTML = '';

    // Agrupar perguntas por categoria
    const perguntasPorCategoria = {};
    perguntas.forEach(pergunta => {
        if (!perguntasPorCategoria[pergunta.categoria]) {
            perguntasPorCategoria[pergunta.categoria] = [];
        }
        perguntasPorCategoria[pergunta.categoria].push(pergunta);
    });

    // Renderizar cada categoria
    Object.keys(perguntasPorCategoria).forEach(categoria => {
        const categoriaSection = document.createElement('div');
        categoriaSection.className = 'categoria-section';

        categoriaSection.innerHTML = `
                    <div class="categoria-header">
                        <i class="fas fa-layer-group"></i> ${categoria}
                    </div>
                `;

        perguntasPorCategoria[categoria].forEach(pergunta => {
            const perguntaDiv = document.createElement('div');
            perguntaDiv.className = 'pergunta-container';

            const autoavaliacaoData = autoavaliacao[pergunta.id] || {};

            perguntaDiv.innerHTML = `
                        <div class="pergunta-texto">${pergunta.pergunta}</div>
                        
                        <div class="comparacao-row">
                            <div class="autoavaliacao-col">
                                <div class="col-header">Autoavaliação do Colaborador</div>
                                <div class="score-display">Nota: ${autoavaliacaoData.score || 'Não respondido'}</div>
                                <div class="comentario-display">
                                    ${autoavaliacaoData.comentario || 'Nenhum comentário'}
                                </div>
                            </div>
                            
                            <div class="avaliacao-gestor-col">
                                <div class="col-header">Sua Avaliação</div>
                                <div class="escala-container">
                                    <div class="escala-label">Nota:</div>
                                    <div class="escala-inputs">
                                        ${gerarEscalaInputs(pergunta.id)}
                                    </div>
                                </div>
                                
                                <div class="escala-valores">
                                    <span>1 - Insuficiente</span>
                                    <span>10 - Excelente</span>
                                </div>
                                
                                <div class="comentario-container">
                                    <label for="comentario_${pergunta.id}">Seu comentário:</label>
                                    <textarea 
                                        id="comentario_${pergunta.id}" 
                                        name="comentario_${pergunta.id}" 
                                        placeholder="Adicione seu comentário sobre o desempenho..."
                                        onchange="atualizarAvaliacaoGestor(${pergunta.id}, 'comentario', this.value)"
                                    ></textarea>
                                </div>
                            </div>
                        </div>
                    `;

            categoriaSection.appendChild(perguntaDiv);
        });

        container.appendChild(categoriaSection);
    });

    // Mostrar conteúdo
    document.getElementById('avaliacaoContent').style.display = 'block';

    // Configurar eventos dos inputs de escala
    configurarEventosEscala();
}

function gerarEscalaInputs(perguntaId) {
    let html = '';
    for (let i = 1; i <= 10; i++) {
        html += `
                    <input type="radio" id="escala_${perguntaId}_${i}" name="escala_${perguntaId}" value="${i}" onchange="atualizarAvaliacaoGestor(${perguntaId}, 'score', ${i})">
                    <label for="escala_${perguntaId}_${i}">${i}</label>
                `;
    }
    return html;
}

function configurarEventosEscala() {
    perguntas.forEach(pergunta => {
        const inputs = document.querySelectorAll(`input[name="escala_${pergunta.id}"]`);
        inputs.forEach(input => {
            input.addEventListener('change', function () {
                atualizarAvaliacaoGestor(pergunta.id, 'score', parseInt(this.value));
            });
        });
    });
}

function atualizarAvaliacaoGestor(perguntaId, campo, valor) {
    if (!avaliacaoGestor[perguntaId]) {
        avaliacaoGestor[perguntaId] = {};
    }
    avaliacaoGestor[perguntaId][campo] = valor;
}

// Formulário de avaliação do gestor
document.getElementById('formAvaliacaoGestor').addEventListener('submit', async function (e) {
    e.preventDefault();

    // Validar se todas as perguntas foram respondidas
    const perguntasSemScore = perguntas.filter(pergunta => !avaliacaoGestor[pergunta.id] || !avaliacaoGestor[pergunta.id].score);

    if (perguntasSemScore.length > 0) {
        showError(`Por favor, avalie todas as ${perguntasSemScore.length} perguntas restantes`);
        return;
    }

    // Validar observações finais
    const observacoesFinais = document.getElementById('observacoesFinais').value.trim();
    if (!observacoesFinais) {
        showError('Por favor, adicione observações finais');
        return;
    }

    // Preparar dados para envio
    const dadosAvaliacao = perguntas.map(pergunta => ({
        pergunta_id: pergunta.id,
        score: avaliacaoGestor[pergunta.id].score,
        comentario: avaliacaoGestor[pergunta.id].comentario || ''
    }));

    try {
        const response = await fetch(`/api/avaliacoes/${avaliacao.id}/avaliacao-gestor`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                respostas: dadosAvaliacao,
                observacoes_finais: observacoesFinais
            })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Avaliação concluída com sucesso!');
            setTimeout(() => {
                window.close();
            }, 2000);
        } else {
            showError('Erro ao salvar avaliação: ' + result.error);
        }
    } catch (error) {
        console.error('Erro ao salvar avaliação:', error);
        showError('Erro ao salvar avaliação');
    }
});

function formatarData(dataString) {
    if (!dataString) return 'N/A';
    const data = new Date(dataString);
    return data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('successMessage').style.display = 'none';
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';
}