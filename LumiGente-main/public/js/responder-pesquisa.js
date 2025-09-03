let pesquisa = null;
let respostas = {};

document.addEventListener('DOMContentLoaded', function () {
    const urlParams = new URLSearchParams(window.location.search);
    const pesquisaId = urlParams.get('id');

    if (!pesquisaId) {
        showError('ID da pesquisa não fornecido');
        return;
    }

    carregarPesquisa(pesquisaId);
});

async function carregarPesquisa(id) {
    try {
        const response = await fetch(`/api/pesquisas/${id}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar pesquisa');
        }

        pesquisa = data;
        renderizarPesquisa();
    } catch (error) {
        console.error('Erro ao carregar pesquisa:', error);
        showError(error.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

function renderizarPesquisa() {
    // Informações da pesquisa
    const infoDiv = document.getElementById('pesquisaInfo');
    infoDiv.innerHTML = `
                <h2>${pesquisa.titulo}</h2>
                ${pesquisa.descricao ? `<p>${pesquisa.descricao}</p>` : ''}
                <div style="margin-top: 15px; color: #718096; font-size: 14px;">
                    <i class="fas fa-user"></i> ${pesquisa.criador_nome} • 
                    <i class="fas fa-calendar"></i> ${new Date(pesquisa.created_at).toLocaleDateString('pt-BR')}
                </div>
            `;

    // Perguntas
    const container = document.getElementById('perguntasContainer');
    container.innerHTML = '';

    if (pesquisa.perguntas && pesquisa.perguntas.length > 0) {
        pesquisa.perguntas.forEach((pergunta, index) => {
            const perguntaDiv = document.createElement('div');
            perguntaDiv.className = 'pergunta-container';
            perguntaDiv.innerHTML = renderizarPergunta(pergunta, index + 1);
            container.appendChild(perguntaDiv);
        });
    }

    document.getElementById('pesquisaContent').style.display = 'block';
}

function renderizarPergunta(pergunta, numero) {
    let inputHtml = '';

    switch (pergunta.tipo) {
        case 'texto':
            inputHtml = `<textarea class="texto-resposta" name="resposta_${pergunta.Id}" placeholder="Digite sua resposta..."></textarea>`;
            break;

        case 'multipla_escolha':
            inputHtml = '<div class="opcoes-container">';
            if (pergunta.opcoes && pergunta.opcoes.length > 0) {
                pergunta.opcoes.forEach((opcao, idx) => {
                    inputHtml += `
                                <div class="opcao-item" onclick="selecionarOpcao(${pergunta.Id}, '${opcao}')">
                                    <input type="radio" name="resposta_${pergunta.Id}" value="${opcao}" id="opcao_${pergunta.Id}_${idx}">
                                    <label for="opcao_${pergunta.Id}_${idx}">${opcao}</label>
                                </div>
                            `;
                });
            }
            inputHtml += '</div>';
            break;

        case 'escala':
            const min = pergunta.escala_min || 1;
            const max = pergunta.escala_max || 5;
            inputHtml = '<div class="escala-container">';
            for (let i = min; i <= max; i++) {
                inputHtml += `
                            <div class="escala-item" onclick="selecionarEscala(${pergunta.Id}, ${i})">
                                <div class="escala-numero" id="escala_${pergunta.Id}_${i}">${i}</div>
                                <small>${i === min ? 'Mín' : i === max ? 'Máx' : ''}</small>
                            </div>
                        `;
            }
            inputHtml += '</div>';
            break;

        case 'sim_nao':
            inputHtml = `
                        <div class="sim-nao-container">
                            <div class="sim-nao-item" onclick="selecionarSimNao(${pergunta.Id}, 'Sim')">
                                <i class="fas fa-check"></i> Sim
                            </div>
                            <div class="sim-nao-item" onclick="selecionarSimNao(${pergunta.Id}, 'Não')">
                                <i class="fas fa-times"></i> Não
                            </div>
                        </div>
                    `;
            break;
    }

    return `
                <div class="pergunta-numero">${numero}</div>
                <div class="pergunta-texto">${pergunta.pergunta}</div>
                ${inputHtml}
                ${pergunta.obrigatoria ? '<div class="obrigatoria">* Campo obrigatório</div>' : ''}
            `;
}

function selecionarOpcao(perguntaId, valor) {
    respostas[perguntaId] = valor;
    document.querySelector(`input[name="resposta_${perguntaId}"][value="${valor}"]`).checked = true;
}

function selecionarEscala(perguntaId, valor) {
    respostas[perguntaId] = valor;

    // Remover seleção anterior
    document.querySelectorAll(`[id^="escala_${perguntaId}_"]`).forEach(el => {
        el.classList.remove('selected');
    });

    // Adicionar nova seleção
    document.getElementById(`escala_${perguntaId}_${valor}`).classList.add('selected');
}

function selecionarSimNao(perguntaId, valor) {
    respostas[perguntaId] = valor;

    // Remover seleção anterior
    document.querySelectorAll('.sim-nao-item').forEach(el => {
        if (el.onclick.toString().includes(`${perguntaId}`)) {
            el.classList.remove('selected');
        }
    });

    // Adicionar nova seleção
    event.target.classList.add('selected');
}

document.getElementById('formResposta').addEventListener('submit', async function (e) {
    e.preventDefault();

    // Coletar respostas de texto
    document.querySelectorAll('.texto-resposta').forEach(textarea => {
        const perguntaId = textarea.name.replace('resposta_', '');
        if (textarea.value.trim()) {
            respostas[perguntaId] = textarea.value.trim();
        }
    });

    // Validar campos obrigatórios
    const perguntasObrigatorias = pesquisa.perguntas.filter(p => p.obrigatoria);
    for (const pergunta of perguntasObrigatorias) {
        if (!respostas[pergunta.Id]) {
            showError(`A pergunta "${pergunta.pergunta}" é obrigatória`);
            return;
        }
    }

    // Enviar respostas
    try {
        const response = await fetch(`/api/pesquisas/${pesquisa.Id}/responder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                respostas: Object.entries(respostas).map(([perguntaId, resposta]) => ({
                    perguntaId: parseInt(perguntaId),
                    resposta: resposta,
                    score: typeof resposta === 'number' ? resposta : null
                }))
            })
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Respostas enviadas com sucesso!');
            setTimeout(() => {
                window.close();
            }, 2000);
        } else {
            showError(result.error || 'Erro ao enviar respostas');
        }
    } catch (error) {
        console.error('Erro ao enviar respostas:', error);
        showError('Erro ao enviar respostas');
    }
});

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