#!/usr/bin/env python3
"""
Processador de Arquivos Excel para o Módulo de Histórico
Processa arquivos .xlsx da pasta historico_feedz e retorna dados formatados
"""

import os
import sys
import json
import pandas as pd
from datetime import datetime
from pathlib import Path
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ProcessadorHistoricoExcel:
    def __init__(self, pasta_historico):
        self.pasta_historico = Path(pasta_historico)
        self.dados_processados = {}
        
        # Mapeamentos de colunas para cada tipo de relatório
        self.mapeamentos = {
            'avaliacao': {
                'colaborador': ['colaborador', 'nome', 'funcionario'],
                'departamento': ['departamento', 'depto', 'setor'],
                'avaliador': ['avaliador', 'avaliado_por', 'responsavel'],
                'nota': ['nota', 'pontuacao', 'score', 'avaliacao'],
                'dataAvaliacao': ['data', 'data_avaliacao', 'periodo'],
                'status': ['status', 'situacao', 'estado'],
                'observacoes': ['observacoes', 'comentarios', 'notas']
            },
            'feedback': {
                'remetente': ['remetente', 'de', 'enviado_por'],
                'destinatario': ['destinatario', 'para', 'recebido_por'],
                'tipo': ['tipo', 'categoria_tipo', 'classificacao'],
                'categoria': ['categoria', 'area', 'topico'],
                'mensagem': ['mensagem', 'conteudo', 'texto', 'comentario'],
                'dataEnvio': ['data', 'data_envio', 'criado_em'],
                'visualizado': ['visualizado', 'lido', 'visto'],
                'util': ['util', 'utilidade', 'relevante']
            },
            'humor': {
                'colaborador': ['colaborador', 'nome', 'funcionario'],
                'humor': ['humor', 'sentimento', 'estado'],
                'pontuacao': ['pontuacao', 'nota', 'score', 'valor'],
                'dataRegistro': ['data', 'data_registro', 'criado_em'],
                'descricao': ['descricao', 'comentario', 'observacao']
            },
            'colaboradores': {
                'nome': ['nome', 'colaborador', 'funcionario'],
                'email': ['email', 'e_mail', 'correio'],
                'departamento': ['departamento', 'depto', 'setor'],
                'cargo': ['cargo', 'funcao', 'posicao'],
                'dataAdmissao': ['data_admissao', 'admissao', 'entrada'],
                'status': ['status', 'situacao', 'ativo'],
                'salario': ['salario', 'remuneracao', 'valor']
            },
            'medias': {
                'departamento': ['departamento', 'depto', 'setor'],
                'mediaGeral': ['media', 'media_geral', 'nota_media'],
                'totalFeedbacks': ['total', 'total_feedbacks', 'quantidade'],
                'periodo': ['periodo', 'mes', 'ano'],
                'tendencia': ['tendencia', 'direcao', 'variacao']
            },
            'ranking': {
                'posicao': ['posicao', 'pos', 'rank', 'posicao_ranking'],
                'colaborador': ['colaborador', 'nome', 'funcionario'],
                'departamento': ['departamento', 'depto', 'setor'],
                'pontos': ['pontos', 'score', 'total_pontos'],
                'lumicoins': ['lumicoins', 'moedas', 'coins'],
                'atividades': ['atividades', 'total_atividades', 'acoes']
            },
            'resumo': {
                'mes': ['mes', 'periodo', 'mês'],
                'totalFeedbacks': ['total_feedbacks', 'feedbacks', 'qtd_feedbacks'],
                'totalReconhecimentos': ['total_reconhecimentos', 'reconhecimentos', 'qtd_reconhecimentos'],
                'totalAvaliacoes': ['total_avaliacoes', 'avaliacoes', 'qtd_avaliacoes'],
                'engajamento': ['engajamento', 'participacao', 'taxa_engajamento']
            },
            'turnover': {
                'colaborador': ['colaborador', 'nome', 'funcionario'],
                'departamento': ['departamento', 'depto', 'setor'],
                'dataSaida': ['data_saida', 'saida', 'demissao'],
                'motivo': ['motivo', 'causa', 'razao'],
                'tempoEmpresa': ['tempo_empresa', 'duracao', 'periodo']
            },
            'pdi': {
                'colaborador': ['colaborador', 'nome', 'funcionario'],
                'objetivo': ['objetivo', 'meta', 'proposta'],
                'status': ['status', 'situacao', 'estado'],
                'dataInicio': ['data_inicio', 'inicio', 'criado_em'],
                'dataFim': ['data_fim', 'fim', 'prazo'],
                'progresso': ['progresso', 'percentual', 'completude'],
                'responsavel': ['responsavel', 'gestor', 'supervisor']
            },
            'pesquisas': {
                'titulo': ['titulo', 'nome', 'pergunta'],
                'tipo': ['tipo', 'categoria', 'classificacao'],
                'status': ['status', 'situacao', 'estado'],
                'dataInicio': ['data_inicio', 'inicio', 'criado_em'],
                'dataFim': ['data_fim', 'fim', 'prazo'],
                'totalRespostas': ['total_respostas', 'respostas', 'qtd_respostas'],
                'departamento': ['departamento', 'depto', 'setor']
            }
        }

    def encontrar_coluna(self, df, palavras_chave):
        """Encontra a coluna que melhor corresponde às palavras-chave"""
        colunas = df.columns.str.lower()
        
        for palavra in palavras_chave:
            for i, coluna in enumerate(colunas):
                if palavra.lower() in coluna:
                    return df.columns[i]
        
        return None

    def formatar_valor(self, valor, tipo):
        """Formata um valor baseado no tipo"""
        if pd.isna(valor) or valor is None:
            return '' if tipo != 'numero' else 0
        
        if tipo == 'numero':
            try:
                return float(valor)
            except (ValueError, TypeError):
                return 0
        elif tipo == 'data':
            try:
                if isinstance(valor, str):
                    # Tenta diferentes formatos de data
                    for fmt in ['%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y']:
                        try:
                            return pd.to_datetime(valor, format=fmt).strftime('%d/%m/%Y')
                        except:
                            continue
                    # Se não conseguir, tenta conversão automática
                    return pd.to_datetime(valor).strftime('%d/%m/%Y')
                else:
                    return pd.to_datetime(valor).strftime('%d/%m/%Y')
            except:
                return str(valor)
        elif tipo == 'boolean':
            if isinstance(valor, bool):
                return valor
            if isinstance(valor, str):
                return valor.lower() in ['true', 'sim', '1', 'yes', 's']
            return bool(valor)
        else:  # texto
            return str(valor).strip()

    def processar_arquivo(self, caminho_arquivo, tipo):
        """Processa um arquivo Excel específico preservando a estrutura original"""
        try:
            logger.info(f"Processando arquivo: {caminho_arquivo}")
            
            # Lê o arquivo Excel
            df = pd.read_excel(caminho_arquivo, engine='openpyxl')
            
            if df.empty:
                logger.warning(f"Arquivo vazio: {caminho_arquivo}")
                return []
            
            logger.info(f"Arquivo carregado: {len(df)} linhas, {len(df.columns)} colunas")
            logger.info(f"Colunas encontradas: {list(df.columns)}")
            
            # Remove linhas completamente vazias
            df = df.dropna(how='all')
            
            # Converte para dicionário preservando a estrutura original
            dados_processados = []
            for idx, row in df.iterrows():
                item = {}
                for col in df.columns:
                    # Preserva o nome original da coluna exatamente como está
                    valor = row[col]
                    if pd.isna(valor):
                        item[col] = ''
                    else:
                        # Tratamento especial para colunas de matrícula
                        if 'matrícula' in col.lower() or 'matricula' in col.lower():
                            # Para matrículas, remove decimais desnecessários
                            if isinstance(valor, float) and valor.is_integer():
                                item[col] = str(int(valor))
                            else:
                                item[col] = str(valor).replace('.0', '')
                        else:
                            # Para outras colunas, converte para string normalmente
                            item[col] = str(valor)
                dados_processados.append(item)
            
            # Adiciona metadados sobre as colunas para o frontend
            metadados = {
                'colunas': list(df.columns),
                'total_linhas': len(df),
                'total_colunas': len(df.columns)
            }
            
            logger.info(f"Processados {len(dados_processados)} registros para {tipo}")
            return {
                'dados': dados_processados,
                'metadados': metadados
            }
            
        except Exception as e:
            logger.error(f"Erro ao processar {caminho_arquivo}: {str(e)}")
            return []

    def processar_todos_arquivos(self):
        """Processa todos os arquivos da pasta historico_feedz"""
        logger.info("Iniciando processamento de todos os arquivos Excel...")
        
        # Lista de arquivos para processar
        arquivos = [
            {
                'arquivo': 'relatorio_avaliacao_desempenho_por_colaborador - 2025-09-02.xlsx',
                'tipo': 'avaliacao'
            },
            {
                'arquivo': 'relatorio_conteudo_feedbacks-20250209.xlsx',
                'tipo': 'feedback'
            },
            {
                'arquivo': 'relatorio_historico_humor_20250209.xlsx',
                'tipo': 'humor'
            },
            {
                'arquivo': 'relatorio_listagem_colaboradores.xlsx',
                'tipo': 'colaboradores'
            },
            {
                'arquivo': 'relatorio_medias_feedbacks-20250209.xlsx',
                'tipo': 'medias'
            },
            {
                'arquivo': 'relatorio_ranking_gamificacao-20250209.xlsx',
                'tipo': 'ranking'
            },
            {
                'arquivo': 'relatorio_resumo_de_atividades_02_09_2025_16_17_45.xlsx',
                'tipo': 'resumo'
            },
            {
                'arquivo': 'relatorio_turnovers_20250209.xlsx',
                'tipo': 'turnover'
            },
            {
                'arquivo': 'relatorios_pdi/relatorio_plano-de-desenvolvimento-colaboradores-ativos-02_09_2025_15_08_18.xlsx',
                'tipo': 'pdi'
            },
            {
                'arquivo': 'relatorios_pesquisas_rapidas/relatorio_pesquisa_rapida-20230408.xlsx',
                'tipo': 'pesquisas'
            }
        ]
        
        resultados = {}
        sucessos = 0
        falhas = 0
        
        for arquivo_info in arquivos:
            try:
                caminho_completo = self.pasta_historico / arquivo_info['arquivo']
                
                if not caminho_completo.exists():
                    logger.warning(f"Arquivo não encontrado: {caminho_completo}")
                    falhas += 1
                    continue
                
                resultado = self.processar_arquivo(caminho_completo, arquivo_info['tipo'])
                if isinstance(resultado, dict) and 'dados' in resultado:
                    resultados[arquivo_info['tipo']] = resultado
                    sucessos += 1
                    logger.info(f"✅ {arquivo_info['arquivo']}: {len(resultado['dados'])} registros, {resultado['metadados']['total_colunas']} colunas")
                else:
                    logger.warning(f"⚠️ {arquivo_info['arquivo']}: Formato de retorno inesperado")
                    falhas += 1
                
            except Exception as e:
                logger.error(f"❌ Erro ao processar {arquivo_info['arquivo']}: {str(e)}")
                falhas += 1
        
        logger.info(f"Processamento concluído: {sucessos} sucessos, {falhas} falhas")
        
        # Salva os resultados em um arquivo JSON para cache
        self.salvar_cache(resultados)
        
        return resultados

    def salvar_cache(self, dados):
        """Salva os dados processados em cache JSON"""
        try:
            cache_file = self.pasta_historico / 'cache_dados_historico.json'
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(dados, f, ensure_ascii=False, indent=2, default=str)
            logger.info(f"Cache salvo em: {cache_file}")
        except Exception as e:
            logger.error(f"Erro ao salvar cache: {str(e)}")

    def carregar_cache(self):
        """Carrega dados do cache se existir"""
        try:
            cache_file = self.pasta_historico / 'cache_dados_historico.json'
            if cache_file.exists():
                with open(cache_file, 'r', encoding='utf-8') as f:
                    dados = json.load(f)
                logger.info(f"Cache carregado de: {cache_file}")
                return dados
        except Exception as e:
            logger.error(f"Erro ao carregar cache: {str(e)}")
        
        return None

def main():
    """Função principal"""
    # Caminho para a pasta historico_feedz
    pasta_historico = Path(__file__).parent.parent / 'public' / 'historico_feedz'
    
    if not pasta_historico.exists():
        logger.error(f"Pasta não encontrada: {pasta_historico}")
        sys.exit(1)
    
    # Processa os arquivos
    processador = ProcessadorHistoricoExcel(pasta_historico)
    
    # Tenta carregar do cache primeiro
    dados = processador.carregar_cache()
    
    if dados is None:
        # Se não há cache, processa os arquivos
        dados = processador.processar_todos_arquivos()
    
    # Exibe estatísticas
    print("\n" + "="*50)
    print("RESUMO DO PROCESSAMENTO")
    print("="*50)
    
    total_registros = 0
    for tipo, registros in dados.items():
        print(f"{tipo.upper()}: {len(registros)} registros")
        total_registros += len(registros)
    
    print(f"\nTOTAL: {total_registros} registros processados")
    print("="*50)

if __name__ == "__main__":
    main()
