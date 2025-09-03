let pesquisaId = null;
let pesquisaData = null;
let resultados = null;

document.addEventListener('DOMContentLoaded', function () {
    const urlParams = new URLSearchParams(window.location.search);
    pesquisaId = urlParams.get('id');

    if (!pesquisaId) {
        showError('ID da pesquisa não fornecido');
        return;
    }

    carregarResultados();
});

async function carregarResultados() {
    try {
        // Carregar dados da pesquisa
        const pesquisaResponse = await fetch(`/api/pesquisas/${pesquisaId}`);
        if (!pesquisaResponse.ok) {
            throw new Error('Pesquisa não encontrada');
        }
        pesquisaData = await pesquisaResponse.json();

        // Carregar resultados
        const resultadosResponse = await fetch(`/api/pesquisas/${pesquisaId}/resultados`);
        if (!resultadosResponse.ok) {
            throw new Error('Erro ao carregar resultados');
        }
        resultados = await resultadosResponse.json();

        renderizarResultados();
    } catch (error) {
        console.error('Erro ao carregar resultados:', error);
        showError(error.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

function renderizarResultados() {
    // Informações da pesquisa
    renderizarInfoPesquisa();

    // Estatísticas gerais
    renderizarEstatisticas();

    // Resultados específicos por tipo
    renderizarResultadosPorTipo();

    document.getElementById('resultsContent').style.display = 'block';
}

function renderizarInfoPesquisa() {
    const container = document.getElementById('pesquisaInfo');
    const dataCriacao = new Date(pesquisaData.created_at).toLocaleDateString('pt-BR');
    const dataEncerramento = pesquisaData.data_encerramento ?
        new Date(pesquisaData.data_encerramento).toLocaleDateString('pt-BR') : 'Sem prazo';

    container.innerHTML = `
                <h2>${pesquisaData.titulo}</h2>
                ${pesquisaData.descricao ? `<p style="color: #6b7280; margin: 10px 0;">${pesquisaData.descricao}</p>` : ''}
                <div class="pesquisa-meta">
                    <div class="meta-item">
                        <i class="fas fa-user"></i>
                        <span>Criado por: ${pesquisaData.criador_nome}</span>
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-calendar"></i>
                        <span>Data: ${dataCriacao}</span>
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-clock"></i>
                        <span>Encerramento: ${dataEncerramento}</span>
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-building"></i>
                        <span>Alvo: ${pesquisaData.departamentos_alvo || 'Todos os departamentos'}</span>
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-tag"></i>
                        <span>Tipo: ${getTipoLabel(pesquisaData.tipo_pergunta)}</span>
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-shield-alt"></i>
                        <span>${pesquisaData.anonima ? 'Anônima' : 'Identificada'}</span>
                    </div>
                </div>
            `;
}

function renderizarEstatisticas() {
    const container = document.getElementById('statsGrid');
    const totalRespostas = resultados.totalRespostas || 0;
    const taxaResposta = resultados.taxaResposta || 0;
    const mediaScore = resultados.mediaScore || 0;

    container.innerHTML = `
                <div class="stat-card">
                    <div class="stat-value">${totalRespostas}</div>
                    <div class="stat-label">Total de Respostas</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${taxaResposta.toFixed(1)}%</div>
                    <div class="stat-label">Taxa de Resposta</div>
                </div>
                ${mediaScore > 0 ? `
                    <div class="stat-card">
                        <div class="stat-value">${mediaScore.toFixed(1)}</div>
                        <div class="stat-label">Média de Avaliação</div>
                    </div>
                ` : ''}
                <div class="stat-card">
                    <div class="stat-value">${pesquisaData.status}</div>
                    <div class="stat-label">Status</div>
                </div>
            `;
}

function renderizarResultadosPorTipo() {
    const container = document.getElementById('resultsContainer');

    if (pesquisaData.perguntas && pesquisaData.perguntas.length > 0) {
        // Pesquisa com múltiplas perguntas
        container.innerHTML = pesquisaData.perguntas.map((pergunta, index) => {
            const perguntaResultados = resultados.perguntas ? resultados.perguntas[pergunta.Id] : null;
            return renderizarPergunta(pergunta, perguntaResultados, index + 1);
        }).join('');
    } else {
        // Pesquisa antiga com pergunta única
        container.innerHTML = renderizarPerguntaUnica();
    }
}

function renderizarPergunta(pergunta, perguntaResultados, numero) {
    let conteudo = '';

    if (pergunta.tipo === 'multipla_escolha') {
        conteudo = renderizarMultiplaEscolha(perguntaResultados);
    } else if (pergunta.tipo === 'escala') {
        conteudo = renderizarEscala(perguntaResultados);
    } else if (pergunta.tipo === 'texto') {
        conteudo = renderizarTexto(perguntaResultados);
    } else if (pergunta.tipo === 'sim_nao') {
        conteudo = renderizarSimNao(perguntaResultados);
    }

    return `
                <div class="results-section">
                    <h3>
                        <i class="fas fa-question-circle"></i>
                        Pergunta ${numero}: ${pergunta.pergunta}
                    </h3>
                    ${conteudo}
                </div>
            `;
}

function renderizarPerguntaUnica() {
    if (pesquisaData.tipo_pergunta === 'multipla_escolha') {
        return `
                    <div class="results-section">
                        <h3><i class="fas fa-chart-pie"></i> Distribuição de Respostas</h3>
                        ${renderizarMultiplaEscolha(resultados)}
                    </div>
                `;
    } else if (pesquisaData.tipo_pergunta === 'escala') {
        return `
                    <div class="results-section">
                        <h3><i class="fas fa-star"></i> Avaliações</h3>
                        ${renderizarEscala(resultados)}
                    </div>
                `;
    } else {
        return `
                    <div class="results-section">
                        <h3><i class="fas fa-comments"></i> Respostas</h3>
                        ${renderizarTexto(resultados)}
                    </div>
                `;
    }
}

function renderizarMultiplaEscolha(dados) {
    if (!dados || !dados.opcoes) {
        return '<p>Nenhuma resposta encontrada.</p>';
    }

    const total = dados.total || 0;

    return `
                <div class="chart-container">
                    <i class="fas fa-chart-pie" style="font-size: 48px; color: #667eea;"></i>
                    <p style="margin-left: 20px; color: #6b7280;">Gráfico de distribuição</p>
                </div>
                ${dados.opcoes.map(opcao => {
        const percentual = total > 0 ? (opcao.count / total * 100) : 0;
        return `
                        <div class="opcao-result">
                            <div class="opcao-info">
                                <div class="opcao-texto">${opcao.opcao}</div>
                                <div class="opcao-stats">
                                    <span>${opcao.count} respostas</span>
                                    <span>${percentual.toFixed(1)}%</span>
                                </div>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentual}%"></div>
                            </div>
                            <div style="font-weight: bold; color: #667eea;">${percentual.toFixed(1)}%</div>
                        </div>
                    `;
    }).join('')}
            `;
}

function renderizarEscala(dados) {
    if (!dados || !dados.escala) {
        return '<p>Nenhuma resposta encontrada.</p>';
    }

    const cores = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

    return `
                <div class="chart-container">
                    <i class="fas fa-chart-bar" style="font-size: 48px; color: #667eea;"></i>
                    <p style="margin-left: 20px; color: #6b7280;">Distribuição de notas</p>
                </div>
                <div class="escala-visual">
                    ${dados.escala.map((item, index) => `
                        <div class="escala-item">
                            <div class="escala-numero" style="background: ${cores[index] || '#667eea'}">
                                ${item.valor}
                            </div>
                            <div class="escala-count">${item.count} votos</div>
                        </div>
                    `).join('')}
                </div>
                <div style="text-align: center; margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <strong>Média: ${dados.media ? dados.media.toFixed(1) : '0.0'}</strong>
                </div>
            `;
}

function renderizarTexto(dados) {
    if (!dados || !dados.respostas || dados.respostas.length === 0) {
        return '<p>Nenhuma resposta encontrada.</p>';
    }

    return dados.respostas.map(resposta => `
                <div class="resposta-texto">
                    ${!pesquisaData.anonima ? `<div class="resposta-autor">${resposta.autor || 'Usuário'} - ${new Date(resposta.data).toLocaleDateString('pt-BR')}</div>` : ''}
                    <div class="resposta-conteudo">${resposta.texto}</div>
                </div>
            `).join('');
}

function renderizarSimNao(dados) {
    if (!dados) {
        return '<p>Nenhuma resposta encontrada.</p>';
    }

    const sim = dados.sim || 0;
    const nao = dados.nao || 0;
    const total = sim + nao;
    const percentualSim = total > 0 ? (sim / total * 100) : 0;
    const percentualNao = total > 0 ? (nao / total * 100) : 0;

    return `
                <div class="chart-container">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #22c55e;"></i>
                    <i class="fas fa-times-circle" style="font-size: 48px; color: #ef4444; margin-left: 20px;"></i>
                </div>
                <div class="opcao-result">
                    <div class="opcao-info">
                        <div class="opcao-texto">Sim</div>
                        <div class="opcao-stats">
                            <span>${sim} respostas</span>
                            <span>${percentualSim.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentualSim}%; background: #22c55e;"></div>
                    </div>
                    <div style="font-weight: bold; color: #22c55e;">${percentualSim.toFixed(1)}%</div>
                </div>
                <div class="opcao-result">
                    <div class="opcao-info">
                        <div class="opcao-texto">Não</div>
                        <div class="opcao-stats">
                            <span>${nao} respostas</span>
                            <span>${percentualNao.toFixed(1)}%</span>
                        </div>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentualNao}%; background: #ef4444;"></div>
                    </div>
                    <div style="font-weight: bold; color: #ef4444;">${percentualNao.toFixed(1)}%</div>
                </div>
            `;
}

function getTipoLabel(tipo) {
    const labels = {
        'multipla_escolha': 'Múltipla Escolha',
        'escala': 'Escala de Avaliação',
        'texto_livre': 'Texto Livre',
        'sim_nao': 'Sim/Não'
    };
    return labels[tipo] || tipo;
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('errorMessage').style.display = 'block';
}

async function exportarResultados(formato) {
    try {
        const response = await fetch(`/api/pesquisas/${pesquisaId}/export?formato=${formato}`, {
            method: 'GET'
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `resultados-pesquisa-${pesquisaId}.${formato}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } else {
            alert('Erro ao exportar resultados');
        }
    } catch (error) {
        console.error('Erro ao exportar:', error);
        alert('Erro ao exportar resultados');
    }
}