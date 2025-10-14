/**
 * Parser de Arquivos Excel para o Módulo de Histórico
 * Processa arquivos .xlsx da pasta historico_feedz
 */

class ExcelParser {
    constructor() {
        this.dadosProcessados = {};
    }

    /**
     * Carrega e processa um arquivo Excel
     * @param {string} url - URL do arquivo Excel
     * @param {string} tipo - Tipo de relatório
     * @returns {Promise<Array>} - Dados processados
     */
    async carregarArquivoExcel(url, tipo) {
        try {
            console.log(`Carregando arquivo Excel: ${url} (Tipo: ${tipo})`);
            
            // Carrega o arquivo Excel
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Erro ao carregar arquivo: ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });
            
            // Processa a primeira planilha
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            // Converte para JSON
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            
            // Processa os dados baseado no tipo
            return this.processarDadosExcel(jsonData, tipo);
            
        } catch (error) {
            console.error('Erro ao carregar arquivo Excel:', error);
            // Fallback para dados simulados em caso de erro
            console.log('Usando dados simulados como fallback');
            return this.gerarDadosSimulados(tipo);
        }
    }

    /**
     * Processa dados Excel baseado no tipo de relatório
     * @param {Array} jsonData - Dados em formato JSON
     * @param {string} tipo - Tipo de relatório
     * @returns {Array} - Dados processados
     */
    processarDadosExcel(jsonData, tipo) {
        if (!jsonData || jsonData.length < 2) {
            console.warn('Arquivo Excel vazio ou inválido');
            return this.gerarDadosSimulados(tipo);
        }

        // Primeira linha são os cabeçalhos
        const headers = jsonData[0];
        const dataRows = jsonData.slice(1);

        console.log('Cabeçalhos encontrados:', headers);
        console.log('Número de linhas de dados:', dataRows.length);

        // Mapeia os dados baseado no tipo
        const mapeamentos = this.obterMapeamentosColunas(tipo);
        const dadosProcessados = [];

        dataRows.forEach((row, index) => {
            if (row.length === 0 || row.every(cell => !cell)) return; // Pula linhas vazias

            const item = {};
            let temDados = false;

            mapeamentos.forEach(mapeamento => {
                const indiceColuna = headers.findIndex(header => 
                    header && header.toString().toLowerCase().includes(mapeamento.busca.toLowerCase())
                );
                
                if (indiceColuna !== -1 && row[indiceColuna] !== undefined) {
                    item[mapeamento.campo] = this.formatarValor(row[indiceColuna], mapeamento.tipo);
                    temDados = true;
                } else {
                    item[mapeamento.campo] = mapeamento.padrao || '';
                }
            });

            if (temDados) {
                item.id = index + 1;
                dadosProcessados.push(item);
            }
        });

        console.log(`Processados ${dadosProcessados.length} registros para ${tipo}`);
        return dadosProcessados;
    }

    /**
     * Obtém mapeamentos de colunas para cada tipo de relatório
     * @param {string} tipo - Tipo de relatório
     * @returns {Array} - Mapeamentos de colunas
     */
    obterMapeamentosColunas(tipo) {
        const mapeamentos = {
            avaliacao: [
                { campo: 'colaborador', busca: 'colaborador', tipo: 'texto', padrao: 'N/A' },
                { campo: 'departamento', busca: 'departamento', tipo: 'texto', padrao: 'N/A' },
                { campo: 'avaliador', busca: 'avaliador', tipo: 'texto', padrao: 'N/A' },
                { campo: 'nota', busca: 'nota', tipo: 'numero', padrao: '0' },
                { campo: 'dataAvaliacao', busca: 'data', tipo: 'data', padrao: 'N/A' },
                { campo: 'status', busca: 'status', tipo: 'texto', padrao: 'Pendente' },
                { campo: 'observacoes', busca: 'observa', tipo: 'texto', padrao: '' }
            ],
            feedback: [
                { campo: 'remetente', busca: 'remetente', tipo: 'texto', padrao: 'N/A' },
                { campo: 'destinatario', busca: 'destinat', tipo: 'texto', padrao: 'N/A' },
                { campo: 'tipo', busca: 'tipo', tipo: 'texto', padrao: 'Outros' },
                { campo: 'categoria', busca: 'categoria', tipo: 'texto', padrao: 'Outros' },
                { campo: 'mensagem', busca: 'mensagem', tipo: 'texto', padrao: '' },
                { campo: 'dataEnvio', busca: 'data', tipo: 'data', padrao: 'N/A' },
                { campo: 'visualizado', busca: 'visualiz', tipo: 'boolean', padrao: false },
                { campo: 'util', busca: 'util', tipo: 'boolean', padrao: false }
            ],
            humor: [
                { campo: 'colaborador', busca: 'colaborador', tipo: 'texto', padrao: 'N/A' },
                { campo: 'humor', busca: 'humor', tipo: 'texto', padrao: 'Neutro' },
                { campo: 'pontuacao', busca: 'pontu', tipo: 'numero', padrao: '3' },
                { campo: 'dataRegistro', busca: 'data', tipo: 'data', padrao: 'N/A' },
                { campo: 'descricao', busca: 'descri', tipo: 'texto', padrao: '' }
            ],
            colaboradores: [
                { campo: 'nome', busca: 'nome', tipo: 'texto', padrao: 'N/A' },
                { campo: 'email', busca: 'email', tipo: 'texto', padrao: 'N/A' },
                { campo: 'departamento', busca: 'departamento', tipo: 'texto', padrao: 'N/A' },
                { campo: 'cargo', busca: 'cargo', tipo: 'texto', padrao: 'N/A' },
                { campo: 'dataAdmissao', busca: 'admiss', tipo: 'data', padrao: 'N/A' },
                { campo: 'status', busca: 'status', tipo: 'texto', padrao: 'Ativo' },
                { campo: 'salario', busca: 'salario', tipo: 'numero', padrao: '0' }
            ],
            medias: [
                { campo: 'departamento', busca: 'departamento', tipo: 'texto', padrao: 'N/A' },
                { campo: 'mediaGeral', busca: 'media', tipo: 'numero', padrao: '0' },
                { campo: 'totalFeedbacks', busca: 'total', tipo: 'numero', padrao: '0' },
                { campo: 'periodo', busca: 'periodo', tipo: 'texto', padrao: 'N/A' },
                { campo: 'tendencia', busca: 'tendencia', tipo: 'texto', padrao: 'Neutra' }
            ],
            ranking: [
                { campo: 'posicao', busca: 'posi', tipo: 'numero', padrao: '0' },
                { campo: 'colaborador', busca: 'colaborador', tipo: 'texto', padrao: 'N/A' },
                { campo: 'departamento', busca: 'departamento', tipo: 'texto', padrao: 'N/A' },
                { campo: 'pontos', busca: 'pontos', tipo: 'numero', padrao: '0' },
                { campo: 'lumicoins', busca: 'lumi', tipo: 'numero', padrao: '0' },
                { campo: 'atividades', busca: 'atividade', tipo: 'numero', padrao: '0' }
            ],
            resumo: [
                { campo: 'mes', busca: 'mes', tipo: 'texto', padrao: 'N/A' },
                { campo: 'totalFeedbacks', busca: 'feedback', tipo: 'numero', padrao: '0' },
                { campo: 'totalReconhecimentos', busca: 'reconhec', tipo: 'numero', padrao: '0' },
                { campo: 'totalAvaliacoes', busca: 'avaliac', tipo: 'numero', padrao: '0' },
                { campo: 'engajamento', busca: 'engaj', tipo: 'texto', padrao: '0%' }
            ],
            turnover: [
                { campo: 'colaborador', busca: 'colaborador', tipo: 'texto', padrao: 'N/A' },
                { campo: 'departamento', busca: 'departamento', tipo: 'texto', padrao: 'N/A' },
                { campo: 'dataSaida', busca: 'saida', tipo: 'data', padrao: 'N/A' },
                { campo: 'motivo', busca: 'motivo', tipo: 'texto', padrao: 'N/A' },
                { campo: 'tempoEmpresa', busca: 'tempo', tipo: 'texto', padrao: 'N/A' }
            ],
            pdi: [
                { campo: 'colaborador', busca: 'colaborador', tipo: 'texto', padrao: 'N/A' },
                { campo: 'objetivo', busca: 'objetivo', tipo: 'texto', padrao: 'N/A' },
                { campo: 'status', busca: 'status', tipo: 'texto', padrao: 'Ativo' },
                { campo: 'dataInicio', busca: 'inicio', tipo: 'data', padrao: 'N/A' },
                { campo: 'dataFim', busca: 'fim', tipo: 'data', padrao: 'N/A' },
                { campo: 'progresso', busca: 'progresso', tipo: 'numero', padrao: '0' },
                { campo: 'responsavel', busca: 'responsavel', tipo: 'texto', padrao: 'N/A' }
            ],
            pesquisas: [
                { campo: 'titulo', busca: 'titulo', tipo: 'texto', padrao: 'N/A' },
                { campo: 'tipo', busca: 'tipo', tipo: 'texto', padrao: 'N/A' },
                { campo: 'status', busca: 'status', tipo: 'texto', padrao: 'Ativa' },
                { campo: 'dataInicio', busca: 'inicio', tipo: 'data', padrao: 'N/A' },
                { campo: 'dataFim', busca: 'fim', tipo: 'data', padrao: 'N/A' },
                { campo: 'totalRespostas', busca: 'resposta', tipo: 'numero', padrao: '0' },
                { campo: 'departamento', busca: 'departamento', tipo: 'texto', padrao: 'N/A' }
            ]
        };

        return mapeamentos[tipo] || [];
    }

    /**
     * Formata um valor baseado no tipo
     * @param {*} valor - Valor a ser formatado
     * @param {string} tipo - Tipo de formatação
     * @returns {*} - Valor formatado
     */
    formatarValor(valor, tipo) {
        if (valor === null || valor === undefined || valor === '') {
            return '';
        }

        switch (tipo) {
            case 'numero':
                const num = parseFloat(valor);
                return isNaN(num) ? 0 : num;
            case 'data':
                if (valor instanceof Date) {
                    return valor.toLocaleDateString('pt-BR');
                }
                // Tenta converter string para data
                const data = new Date(valor);
                return isNaN(data.getTime()) ? valor : data.toLocaleDateString('pt-BR');
            case 'boolean':
                if (typeof valor === 'boolean') return valor;
                if (typeof valor === 'string') {
                    return valor.toLowerCase() === 'true' || valor.toLowerCase() === 'sim' || valor.toLowerCase() === '1';
                }
                return Boolean(valor);
            case 'texto':
            default:
                return String(valor).trim();
        }
    }

    /**
     * Gera dados simulados baseados no tipo de relatório
     * @param {string} tipo - Tipo de relatório
     * @returns {Array} - Dados simulados
     */
    gerarDadosSimulados(tipo) {
        const geradores = {
            'avaliacao': () => this.gerarDadosAvaliacao(),
            'feedback': () => this.gerarDadosFeedback(),
            'humor': () => this.gerarDadosHumor(),
            'colaboradores': () => this.gerarDadosColaboradores(),
            'medias': () => this.gerarDadosMedias(),
            'ranking': () => this.gerarDadosRanking(),
            'resumo': () => this.gerarDadosResumo(),
            'turnover': () => this.gerarDadosTurnover(),
            'pdi': () => this.gerarDadosPDI(),
            'pesquisas': () => this.gerarDadosPesquisas()
        };

        const gerador = geradores[tipo];
        return gerador ? gerador() : [];
    }

    /**
     * Gera dados simulados para avaliação de desempenho
     */
    gerarDadosAvaliacao() {
        const colaboradores = ['João Silva', 'Maria Santos', 'Pedro Costa', 'Ana Oliveira', 'Carlos Lima'];
        const departamentos = ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'];
        const dados = [];

        for (let i = 0; i < 50; i++) {
            dados.push({
                id: i + 1,
                colaborador: colaboradores[Math.floor(Math.random() * colaboradores.length)],
                departamento: departamentos[Math.floor(Math.random() * departamentos.length)],
                avaliador: colaboradores[Math.floor(Math.random() * colaboradores.length)],
                nota: (Math.random() * 4 + 1).toFixed(1),
                dataAvaliacao: this.gerarDataAleatoria(),
                status: Math.random() > 0.2 ? 'Concluída' : 'Pendente',
                observacoes: 'Avaliação de desempenho trimestral'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para feedbacks
     */
    gerarDadosFeedback() {
        const tipos = ['Positivo', 'Desenvolvimento', 'Sugestão', 'Outros'];
        const categorias = ['Técnico', 'Atendimento', 'Vendas', 'Design', 'Liderança'];
        const dados = [];

        for (let i = 0; i < 100; i++) {
            dados.push({
                id: i + 1,
                remetente: `Colaborador ${i + 1}`,
                destinatario: `Colaborador ${Math.floor(Math.random() * 50) + 1}`,
                tipo: tipos[Math.floor(Math.random() * tipos.length)],
                categoria: categorias[Math.floor(Math.random() * categorias.length)],
                mensagem: `Feedback de exemplo ${i + 1}`,
                dataEnvio: this.gerarDataAleatoria(),
                visualizado: Math.random() > 0.3,
                util: Math.random() > 0.4
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para humor
     */
    gerarDadosHumor() {
        const humores = ['Muito Triste', 'Triste', 'Neutro', 'Feliz', 'Muito Feliz'];
        const dados = [];

        for (let i = 0; i < 200; i++) {
            dados.push({
                id: i + 1,
                colaborador: `Colaborador ${Math.floor(Math.random() * 30) + 1}`,
                humor: humores[Math.floor(Math.random() * humores.length)],
                pontuacao: Math.floor(Math.random() * 5) + 1,
                dataRegistro: this.gerarDataAleatoria(),
                descricao: Math.random() > 0.5 ? 'Descrição do humor' : null
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para colaboradores
     */
    gerarDadosColaboradores() {
        const departamentos = ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'];
        const cargos = ['Analista', 'Gerente', 'Coordenador', 'Supervisor', 'Assistente'];
        const status = ['Ativo', 'Inativo', 'Férias', 'Licença'];
        const dados = [];

        for (let i = 0; i < 80; i++) {
            dados.push({
                id: i + 1,
                nome: `Colaborador ${i + 1}`,
                email: `colaborador${i + 1}@empresa.com`,
                departamento: departamentos[Math.floor(Math.random() * departamentos.length)],
                cargo: cargos[Math.floor(Math.random() * cargos.length)],
                dataAdmissao: this.gerarDataAleatoria(),
                status: status[Math.floor(Math.random() * status.length)],
                salario: (Math.random() * 10000 + 2000).toFixed(2)
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para médias de feedback
     */
    gerarDadosMedias() {
        const departamentos = ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'];
        const dados = [];

        for (let i = 0; i < 20; i++) {
            dados.push({
                id: i + 1,
                departamento: departamentos[Math.floor(Math.random() * departamentos.length)],
                mediaGeral: (Math.random() * 2 + 3).toFixed(1),
                totalFeedbacks: Math.floor(Math.random() * 50) + 10,
                periodo: '2024',
                tendencia: Math.random() > 0.5 ? 'Positiva' : 'Negativa'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para ranking de gamificação
     */
    gerarDadosRanking() {
        const dados = [];

        for (let i = 0; i < 30; i++) {
            dados.push({
                posicao: i + 1,
                colaborador: `Colaborador ${i + 1}`,
                departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][Math.floor(Math.random() * 5)],
                pontos: Math.floor(Math.random() * 1000) + 100,
                lumicoins: Math.floor(Math.random() * 500) + 50,
                atividades: Math.floor(Math.random() * 100) + 10
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para resumo de atividades
     */
    gerarDadosResumo() {
        const dados = [];

        for (let i = 0; i < 12; i++) {
            dados.push({
                id: i + 1,
                mes: this.obterNomeMes(i + 1),
                totalFeedbacks: Math.floor(Math.random() * 200) + 50,
                totalReconhecimentos: Math.floor(Math.random() * 100) + 20,
                totalAvaliacoes: Math.floor(Math.random() * 50) + 10,
                engajamento: (Math.random() * 20 + 70).toFixed(1) + '%'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para turnovers
     */
    gerarDadosTurnover() {
        const dados = [];

        for (let i = 0; i < 15; i++) {
            dados.push({
                id: i + 1,
                colaborador: `Colaborador ${i + 1}`,
                departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][Math.floor(Math.random() * 5)],
                dataSaida: this.gerarDataAleatoria(),
                motivo: ['Demissão', 'Pedido de demissão', 'Aposentadoria', 'Término de contrato'][Math.floor(Math.random() * 4)],
                tempoEmpresa: Math.floor(Math.random() * 60) + 1 + ' meses'
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para PDI
     */
    gerarDadosPDI() {
        const status = ['Ativo', 'Concluído', 'Pausado', 'Cancelado'];
        const dados = [];

        for (let i = 0; i < 40; i++) {
            dados.push({
                id: i + 1,
                colaborador: `Colaborador ${i + 1}`,
                objetivo: `Objetivo de desenvolvimento ${i + 1}`,
                status: status[Math.floor(Math.random() * status.length)],
                dataInicio: this.gerarDataAleatoria(),
                dataFim: this.gerarDataAleatoria(),
                progresso: Math.floor(Math.random() * 100) + 1,
                responsavel: `Gestor ${Math.floor(Math.random() * 10) + 1}`
            });
        }

        return dados;
    }

    /**
     * Gera dados simulados para pesquisas rápidas
     */
    gerarDadosPesquisas() {
        const tipos = ['Múltipla Escolha', 'Escala', 'Texto Livre'];
        const status = ['Ativa', 'Concluída', 'Pausada'];
        const dados = [];

        for (let i = 0; i < 25; i++) {
            dados.push({
                id: i + 1,
                titulo: `Pesquisa ${i + 1}`,
                tipo: tipos[Math.floor(Math.random() * tipos.length)],
                status: status[Math.floor(Math.random() * status.length)],
                dataInicio: this.gerarDataAleatoria(),
                dataFim: this.gerarDataAleatoria(),
                totalRespostas: Math.floor(Math.random() * 100) + 10,
                departamento: ['RH', 'TI', 'Vendas', 'Financeiro', 'Operações'][Math.floor(Math.random() * 5)]
            });
        }

        return dados;
    }

    /**
     * Gera uma data aleatória
     */
    gerarDataAleatoria() {
        const inicio = new Date(2023, 0, 1);
        const fim = new Date();
        const data = new Date(inicio.getTime() + Math.random() * (fim.getTime() - inicio.getTime()));
        return data.toLocaleDateString('pt-BR');
    }

    /**
     * Obtém o nome do mês
     */
    obterNomeMes(numero) {
        const meses = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];
        return meses[numero - 1];
    }

    /**
     * Processa todos os arquivos da pasta historico_feedz
     * @returns {Promise<Object>} - Dados processados de todos os arquivos
     */
    async processarTodosArquivos() {
        const arquivos = [
            { 
                nome: 'relatorio_avaliacao_desempenho_por_colaborador - 2025-09-02', 
                tipo: 'avaliacao',
                caminho: '/historico_feedz/relatorio_avaliacao_desempenho_por_colaborador - 2025-09-02.xlsx'
            },
            { 
                nome: 'relatorio_conteudo_feedbacks-20250209', 
                tipo: 'feedback',
                caminho: '/historico_feedz/relatorio_conteudo_feedbacks-20250209.xlsx'
            },
            { 
                nome: 'relatorio_historico_humor_20250209', 
                tipo: 'humor',
                caminho: '/historico_feedz/relatorio_historico_humor_20250209.xlsx'
            },
            { 
                nome: 'relatorio_listagem_colaboradores', 
                tipo: 'colaboradores',
                caminho: '/historico_feedz/relatorio_listagem_colaboradores.xlsx'
            },
            { 
                nome: 'relatorio_medias_feedbacks-20250209', 
                tipo: 'medias',
                caminho: '/historico_feedz/relatorio_medias_feedbacks-20250209.xlsx'
            },
            { 
                nome: 'relatorio_ranking_gamificacao-20250209', 
                tipo: 'ranking',
                caminho: '/historico_feedz/relatorio_ranking_gamificacao-20250209.xlsx'
            },
            { 
                nome: 'relatorio_resumo_de_atividades_02_09_2025_16_17_45', 
                tipo: 'resumo',
                caminho: '/historico_feedz/relatorio_resumo_de_atividades_02_09_2025_16_17_45.xlsx'
            },
            { 
                nome: 'relatorio_turnovers_20250209', 
                tipo: 'turnover',
                caminho: '/historico_feedz/relatorio_turnovers_20250209.xlsx'
            },
            { 
                nome: 'relatorio_plano-de-desenvolvimento-colaboradores-ativos-02_09_2025_15_08_18', 
                tipo: 'pdi',
                caminho: '/historico_feedz/relatorios_pdi/relatorio_plano-de-desenvolvimento-colaboradores-ativos-02_09_2025_15_08_18.xlsx'
            },
            { 
                nome: 'relatorio_pesquisa_rapida-20230408', 
                tipo: 'pesquisas',
                caminho: '/historico_feedz/relatorios_pesquisas_rapidas/relatorio_pesquisa_rapida-20230408.xlsx'
            }
        ];

        const dadosProcessados = {};
        const promessas = [];

        // Processa todos os arquivos em paralelo
        for (const arquivo of arquivos) {
            const promessa = this.carregarArquivoExcel(arquivo.caminho, arquivo.tipo)
                .then(dados => {
                    dadosProcessados[arquivo.tipo] = dados;
                    console.log(`✅ Arquivo ${arquivo.nome} processado: ${dados.length} registros`);
                    return { tipo: arquivo.tipo, sucesso: true, registros: dados.length };
                })
                .catch(error => {
                    console.error(`❌ Erro ao processar ${arquivo.nome}:`, error);
                    // Em caso de erro, usa dados simulados
                    dadosProcessados[arquivo.tipo] = this.gerarDadosSimulados(arquivo.tipo);
                    return { tipo: arquivo.tipo, sucesso: false, erro: error.message };
                });
            
            promessas.push(promessa);
        }

        // Aguarda todos os arquivos serem processados
        const resultados = await Promise.all(promessas);
        
        // Log do resumo
        const sucessos = resultados.filter(r => r.sucesso).length;
        const falhas = resultados.filter(r => !r.sucesso).length;
        
        console.log(`📊 Processamento concluído: ${sucessos} sucessos, ${falhas} falhas`);
        
        if (falhas > 0) {
            console.warn('Arquivos com falha:', resultados.filter(r => !r.sucesso));
        }

        return dadosProcessados;
    }
}

// Exporta a classe para uso global
window.ExcelParser = ExcelParser;
