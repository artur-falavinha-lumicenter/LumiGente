let departamentos = [];
let perguntaCounter = 0;

document.addEventListener('DOMContentLoaded', async function () {
    // Verificar permissões antes de carregar a página
    try {
        console.log('🔍 Verificando permissões para criar pesquisa...');
        const response = await fetch('/api/pesquisas/can-create');
        if (response.ok) {
            const data = await response.json();
            console.log('📊 Resultado da verificação:', data);
            if (!data.canCreate) {
                console.log('🚫 Acesso negado - simulando erro 404');
                document.documentElement.innerHTML = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /criar-pesquisa.html</pre>\n</body>\n</html>';
                return;
            }
        } else {
            console.error('❌ Erro na verificação de permissões:', response.status);
            document.documentElement.innerHTML = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /criar-pesquisa.html</pre>\n</body>\n</html>';
            return;
        }
    } catch (error) {
        console.error('❌ Erro ao verificar permissões:', error);
        document.documentElement.innerHTML = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot GET /criar-pesquisa.html</pre>\n</body>\n</html>';
        return;
    }
    
    carregarDepartamentos();
    adicionarPergunta(); // Adicionar primeira pergunta automaticamente
});

async function carregarDepartamentos() {
    try {
        const response = await fetch('/api/pesquisas/departamentos');
        departamentos = await response.json();

        const select = document.getElementById('departamentos');
        select.innerHTML = '';

        departamentos.forEach(dept => {
            const option = document.createElement('option');
            option.value = dept;
            option.textContent = dept;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Erro ao carregar departamentos:', error);
    }
}

function adicionarPergunta() {
    perguntaCounter++;
    const container = document.getElementById('perguntasContainer');

    const perguntaDiv = document.createElement('div');
    perguntaDiv.className = 'pergunta-item';
    perguntaDiv.id = `pergunta-${perguntaCounter}`;

    perguntaDiv.innerHTML = `
                <div class="pergunta-header">
                    <div class="pergunta-numero">${perguntaCounter}</div>
                    <button type="button" class="btn-remove-pergunta" onclick="removerPergunta(${perguntaCounter})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="form-group">
                    <label>Texto da Pergunta *</label>
                    <input type="text" name="pergunta_texto_${perguntaCounter}" required placeholder="Digite sua pergunta...">
                </div>
                
                <div class="form-group">
                    <label>Tipo de Pergunta</label>
                    <select name="pergunta_tipo_${perguntaCounter}" onchange="alterarTipoPergunta(${perguntaCounter}, this.value)">
                        <option value="texto">Texto Livre</option>
                        <option value="multipla_escolha">Múltipla Escolha</option>
                        <option value="escala">Escala (1-5)</option>
                        <option value="sim_nao">Sim/Não</option>
                    </select>
                </div>
                
                <div id="opcoes-${perguntaCounter}" class="opcoes-container" style="display: none;">
                    <label><strong>Opções de Resposta</strong></label>
                    <div id="opcoes-list-${perguntaCounter}"></div>
                    <button type="button" class="btn-add-opcao" onclick="adicionarOpcao(${perguntaCounter})">
                        <i class="fas fa-plus"></i> Adicionar Opção
                    </button>
                </div>
                
                <div id="escala-${perguntaCounter}" class="escala-container" style="display: none;">
                    <div class="form-group">
                        <label>Valor Mínimo</label>
                        <input type="number" name="escala_min_${perguntaCounter}" value="1" min="1">
                    </div>
                    <div class="form-group">
                        <label>Valor Máximo</label>
                        <input type="number" name="escala_max_${perguntaCounter}" value="5" max="10">
                    </div>
                </div>
                
                <div class="checkbox-group">
                    <input type="checkbox" name="pergunta_obrigatoria_${perguntaCounter}" id="obrigatoria-${perguntaCounter}">
                    <label for="obrigatoria-${perguntaCounter}">Pergunta obrigatória</label>
                </div>
            `;

    container.appendChild(perguntaDiv);
}

function removerPergunta(id) {
    if (document.querySelectorAll('.pergunta-item').length <= 1) {
        showError('Deve haver pelo menos uma pergunta');
        return;
    }

    const pergunta = document.getElementById(`pergunta-${id}`);
    if (pergunta) {
        pergunta.remove();
        renumerarPerguntas();
    }
}

function renumerarPerguntas() {
    const perguntas = document.querySelectorAll('.pergunta-item');
    perguntas.forEach((pergunta, index) => {
        const numero = pergunta.querySelector('.pergunta-numero');
        if (numero) {
            numero.textContent = index + 1;
        }
    });
}

function alterarTipoPergunta(id, tipo) {
    const opcoesDiv = document.getElementById(`opcoes-${id}`);
    const escalaDiv = document.getElementById(`escala-${id}`);

    opcoesDiv.style.display = 'none';
    escalaDiv.style.display = 'none';

    if (tipo === 'multipla_escolha') {
        opcoesDiv.style.display = 'block';
        if (document.getElementById(`opcoes-list-${id}`).children.length === 0) {
            adicionarOpcao(id);
            adicionarOpcao(id);
        }
    } else if (tipo === 'escala') {
        escalaDiv.style.display = 'block';
    }
}

function adicionarOpcao(perguntaId) {
    const container = document.getElementById(`opcoes-list-${perguntaId}`);
    const opcaoDiv = document.createElement('div');
    opcaoDiv.className = 'opcao-item';

    const opcaoCount = container.children.length + 1;
    opcaoDiv.innerHTML = `
                <input type="text" placeholder="Opção ${opcaoCount}" name="opcao_${perguntaId}_${opcaoCount}">
                <button type="button" class="btn-remove-pergunta" onclick="this.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            `;

    container.appendChild(opcaoDiv);
}

document.getElementById('formCriarPesquisa').addEventListener('submit', async function (e) {
    e.preventDefault();

    const formData = new FormData(this);

    // Validar campos obrigatórios
    const titulo = formData.get('titulo');
    if (!titulo) {
        showError('Título é obrigatório');
        return;
    }

    // Coletar perguntas
    const perguntas = [];
    const perguntasElements = document.querySelectorAll('.pergunta-item');

    if (perguntasElements.length === 0) {
        showError('Adicione pelo menos uma pergunta');
        return;
    }

    for (let i = 0; i < perguntasElements.length; i++) {
        const perguntaEl = perguntasElements[i];
        const perguntaId = perguntaEl.id.split('-')[1];
        const texto = formData.get(`pergunta_texto_${perguntaId}`);
        const tipo = formData.get(`pergunta_tipo_${perguntaId}`);
        const obrigatoria = formData.get(`pergunta_obrigatoria_${perguntaId}`) === 'on';

        if (!texto) {
            showError(`Texto da pergunta ${i + 1} é obrigatório`);
            return;
        }

        const pergunta = {
            texto: texto,
            tipo: tipo,
            obrigatoria: obrigatoria
        };

        // Adicionar opções se for múltipla escolha
        if (tipo === 'multipla_escolha') {
            const opcoes = [];
            const opcoesInputs = perguntaEl.querySelectorAll(`input[name^="opcao_${perguntaId}_"]`);
            opcoesInputs.forEach(input => {
                if (input.value.trim()) {
                    opcoes.push(input.value.trim());
                }
            });

            if (opcoes.length < 2) {
                showError(`Pergunta ${i + 1}: Adicione pelo menos 2 opções para múltipla escolha`);
                return;
            }

            pergunta.opcoes = opcoes;
        }

        // Adicionar escala se for tipo escala
        if (tipo === 'escala') {
            pergunta.escala_min = parseInt(formData.get(`escala_min_${perguntaId}`)) || 1;
            pergunta.escala_max = parseInt(formData.get(`escala_max_${perguntaId}`)) || 5;
        }

        perguntas.push(pergunta);
    }

    const pesquisaData = {
        titulo: titulo,
        descricao: formData.get('descricao'),
        perguntas: perguntas,
        departamentos_alvo: formData.get('departamentos_alvo'),
        data_encerramento: formData.get('data_encerramento'),
        anonima: formData.get('anonima') === 'on'
    };

    // Mostrar loading
    document.getElementById('loading').style.display = 'block';

    try {
        const response = await fetch('/api/pesquisas', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(pesquisaData)
        });

        const result = await response.json();

        if (result.success) {
            showSuccess('Pesquisa criada com sucesso!');
            setTimeout(() => {
                window.close();
            }, 2000);
        } else {
            showError('Erro ao criar pesquisa: ' + result.error);
        }
    } catch (error) {
        console.error('Erro ao criar pesquisa:', error);
        showError('Erro ao criar pesquisa');
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
});

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('successMessage').style.display = 'none';

    // Scroll para o topo
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSuccess(message) {
    const successDiv = document.getElementById('successMessage');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';

    // Scroll para o topo
    window.scrollTo({ top: 0, behavior: 'smooth' });
}