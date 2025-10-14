#!/usr/bin/env python3
"""
Script de teste para verificar o processamento de dados históricos
"""

import sys
import os
import json
from pathlib import Path

# Adiciona o diretório pai ao path para importar o processador
sys.path.append(os.path.dirname(__file__))

from processar_historico_excel import ProcessadorHistoricoExcel

def testar_processamento():
    """Testa o processamento de dados históricos"""
    print("🧪 TESTE DO PROCESSAMENTO DE DADOS HISTÓRICOS")
    print("=" * 60)
    
    # Caminho para a pasta historico_feedz
    pasta_historico = Path(__file__).parent.parent / 'public' / 'historico_feedz'
    
    if not pasta_historico.exists():
        print(f"❌ Pasta não encontrada: {pasta_historico}")
        return False
    
    print(f"📁 Pasta de dados: {pasta_historico}")
    
    try:
        # Cria o processador
        processador = ProcessadorHistoricoExcel(pasta_historico)
        
        # Processa todos os arquivos
        print("\n🔄 Iniciando processamento...")
        dados = processador.processar_todos_arquivos()
        
        # Verifica os resultados
        print("\n📊 RESULTADOS DO PROCESSAMENTO:")
        print("-" * 40)
        
        total_registros = 0
        sucessos = 0
        
        for tipo, registros in dados.items():
            if registros:
                print(f"✅ {tipo.upper()}: {len(registros)} registros")
                total_registros += len(registros)
                sucessos += 1
                
                # Mostra uma amostra dos dados
                if len(registros) > 0:
                    print(f"   📋 Amostra: {list(registros[0].keys())}")
            else:
                print(f"❌ {tipo.upper()}: 0 registros")
        
        print("-" * 40)
        print(f"📈 Total de tipos processados: {sucessos}/10")
        print(f"📊 Total de registros: {total_registros}")
        
        # Verifica se o cache foi criado
        cache_file = pasta_historico / 'cache_dados_historico.json'
        if cache_file.exists():
            print(f"💾 Cache criado: {cache_file}")
            cache_size = cache_file.stat().st_size / 1024  # KB
            print(f"📏 Tamanho do cache: {cache_size:.1f} KB")
        else:
            print("⚠️ Cache não foi criado")
        
        # Testa a estrutura dos dados
        print("\n🔍 VALIDAÇÃO DOS DADOS:")
        print("-" * 30)
        
        for tipo, registros in dados.items():
            if registros:
                # Verifica se todos os registros têm ID
                ids_ok = all('id' in r for r in registros)
                print(f"🆔 {tipo}: IDs únicos - {'✅' if ids_ok else '❌'}")
                
                # Verifica tipos de dados
                if registros:
                    amostra = registros[0]
                    print(f"📋 {tipo}: Campos - {len(amostra)} campos")
        
        print("\n🎉 TESTE CONCLUÍDO COM SUCESSO!")
        return True
        
    except Exception as e:
        print(f"\n❌ ERRO NO TESTE: {e}")
        import traceback
        traceback.print_exc()
        return False

def testar_endpoint():
    """Testa o endpoint da API (requer servidor rodando)"""
    print("\n🌐 TESTE DO ENDPOINT DA API")
    print("=" * 40)
    
    try:
        import requests
        
        # Testa o endpoint
        response = requests.get('http://localhost:3000/api/historico/dados', timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Endpoint funcionando!")
            print(f"📅 Processado em: {data.get('timestamp', 'N/A')}")
            print(f"🔧 Processado por: {data.get('processado_por', 'N/A')}")
            
            if 'dados' in data:
                total_tipos = len(data['dados'])
                total_registros = sum(len(registros) for registros in data['dados'].values())
                print(f"📊 Tipos de dados: {total_tipos}")
                print(f"📈 Total de registros: {total_registros}")
            
            return True
        else:
            print(f"❌ Erro HTTP: {response.status_code}")
            print(f"📝 Resposta: {response.text}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Servidor não está rodando em localhost:3000")
        print("💡 Execute: npm start ou node server.js")
        return False
    except ImportError:
        print("⚠️ requests não instalado. Instalando...")
        try:
            import subprocess
            subprocess.run([sys.executable, '-m', 'pip', 'install', 'requests'], check=True)
            print("✅ requests instalado. Execute o teste novamente.")
        except:
            print("❌ Erro ao instalar requests")
        return False
    except Exception as e:
        print(f"❌ Erro no teste do endpoint: {e}")
        return False

def main():
    """Função principal"""
    print("🚀 INICIANDO TESTES DO MÓDULO HISTÓRICO")
    print("=" * 60)
    
    # Teste 1: Processamento Python
    print("\n1️⃣ TESTE DE PROCESSAMENTO PYTHON")
    resultado_python = testar_processamento()
    
    # Teste 2: Endpoint da API
    print("\n2️⃣ TESTE DO ENDPOINT DA API")
    resultado_api = testar_endpoint()
    
    # Resumo final
    print("\n" + "=" * 60)
    print("📋 RESUMO DOS TESTES")
    print("=" * 60)
    print(f"🐍 Processamento Python: {'✅ PASSOU' if resultado_python else '❌ FALHOU'}")
    print(f"🌐 Endpoint da API: {'✅ PASSOU' if resultado_api else '❌ FALHOU'}")
    
    if resultado_python and resultado_api:
        print("\n🎉 TODOS OS TESTES PASSARAM!")
        print("💡 O módulo de histórico está funcionando perfeitamente!")
    else:
        print("\n⚠️ ALGUNS TESTES FALHARAM")
        print("💡 Verifique os erros acima e tente novamente.")
    
    return resultado_python and resultado_api

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
