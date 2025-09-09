let pesquisaId = null;
let pesquisaData = null;
let resultados = null;

document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 Iniciando carregamento da página de resultados...');
    
    // Verificar permissões primeiro
    console.log('🔐 Verificando permissões de acesso...');
    verificarPermissoes();
});

async function verificarPermissoes() {
    try {
        console.log('🔍 Verificando permissões de acesso aos resultados...');
        
        const response = await fetch('/api/pesquisas/can-create');
        if (!response.ok) {
            console.error('❌ Erro na verificação de permissões:', response.status, response.statusText);
            throw new Error(`Erro ao verificar permissões: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📊 Resultado da verificação:', data);
        
        if (!data.canCreate) {
            console.log('🚫 Acesso negado - usuário não tem permissão');
            document.documentElement.innerHTML = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /resultados-pesquisa.html</pre>\n</body>\n</html>';
            return;
        }
        
        console.log('✅ Permissão concedida - verificando ID da pesquisa...');
        
        const urlParams = new URLSearchParams(window.location.search);
        pesquisaId = urlParams.get('id');
        
        if (!pesquisaId) {
            console.error('❌ ID da pesquisa não fornecido na URL');
            showError('ID da pesquisa não foi fornecido. O acesso aos resultados específicos de uma pesquisa deve acontecer através da aba Pesquisa Rápida no sistema.');
            return;
        }
        
        carregarResultados();
    } catch (error) {
        console.error('❌ Erro ao verificar permissões:', error);
        showError('Erro ao verificar permissões de acesso. Verifique se você tem autorização para acessar esta página.');
    }
}

async function carregarResultados() {
    try {
        console.log('📄 Carregando dados da pesquisa ID:', pesquisaId);
        
        // Carregar dados da pesquisa
        const pesquisaResponse = await fetch(`/api/pesquisas/${pesquisaId}`);
        if (!pesquisaResponse.ok) {
            if (pesquisaResponse.status === 403) {
                throw new Error('Acesso negado. Você não tem permissão para visualizar esta pesquisa.');
            }
            throw new Error(`Pesquisa não encontrada (${pesquisaResponse.status})`);
        }
        pesquisaData = await pesquisaResponse.json();
        console.log('✅ Dados da pesquisa carregados:', pesquisaData.titulo);

        // Carregar resultados
        console.log('📈 Carregando resultados da pesquisa...');
        const resultadosResponse = await fetch(`/api/pesquisas/${pesquisaId}/resultados`);
        if (!resultadosResponse.ok) {
            if (resultadosResponse.status === 403) {
                const errorData = await resultadosResponse.json().catch(() => ({}));
                throw new Error(errorData.error || 'Acesso negado aos resultados da pesquisa.');
            }
            throw new Error(`Erro ao carregar resultados (${resultadosResponse.status})`);
        }
        resultados = await resultadosResponse.json();
        console.log('✅ Resultados carregados:', resultados);

        renderizarResultados();
    } catch (error) {
        console.error('❌ Erro ao carregar resultados:', error);
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
    console.log('❌ Exibindo erro:', message);
    
    document.getElementById('errorMessage').innerHTML = `
        <div style="text-align: center; padding: 40px; background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; color: #dc2626; max-width: 600px; margin: 0 auto;">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 20px; color: #dc2626;"></i>
            <h3 style="margin-bottom: 15px;">Acesso Restrito</h3>
            <p style="margin-bottom: 20px; line-height: 1.5;">${message}</p>
            <div style="margin-top: 25px;">
                <button onclick="window.close()" style="margin: 5px; padding: 12px 24px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-times"></i> Fechar Janela
                </button>
                <button onclick="window.history.back()" style="margin: 5px; padding: 12px 24px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-arrow-left"></i> Voltar
                </button>
                <button onclick="window.location.href='/index.html'" style="margin: 5px; padding: 12px 24px; background: #059669; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    <i class="fas fa-home"></i> Início
                </button>
            </div>
        </div>
    `;
    document.getElementById('errorMessage').style.display = 'block';
    document.getElementById('loading').style.display = 'none';
}

async function exportarResultados(formato) {
    try {
        console.log('📥 Iniciando exportação no formato:', formato);
        
        const response = await fetch(`/api/pesquisas/${pesquisaId}/export?formato=${formato}`, {
            method: 'GET'
        });

        if (response.ok) {
            console.log('✅ Exportação bem-sucedida');
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
            console.error('❌ Erro na exportação:', response.status, response.statusText);
            if (response.status === 403) {
                const errorData = await response.json().catch(() => ({}));
                alert(errorData.error || 'Acesso negado para exportar resultados.');
            } else {
                alert(`Erro ao exportar resultados (${response.status})`);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao exportar:', error);
        alert('Erro ao exportar resultados: ' + error.message);
    }
}