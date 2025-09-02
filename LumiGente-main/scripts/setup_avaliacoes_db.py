#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para configurar o banco de dados do sistema de avaliações de 45 e 90 dias
Lumicenter Lighting - Sistema Feedz
"""

import pyodbc
import os
from datetime import datetime, timedelta

def conectar_banco():
    """Conecta ao banco de dados SQL Server"""
    try:
        # Configurações de conexão - ajuste conforme seu ambiente
        server = os.getenv('DB_SERVER', 'localhost\\SQLEXPRESS')
        database = os.getenv('DB_NAME', 'LUMICENTER_FEEDBACKS')
        username = os.getenv('DB_USER', 'sa')
        password = os.getenv('DB_PASSWORD', '')
        
        # String de conexão
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={server};DATABASE={database};UID={username};PWD={password}'
        
        # Conectar ao banco
        conn = pyodbc.connect(conn_str)
        print(f"✅ Conectado ao banco de dados: {database}")
        return conn
        
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco: {e}")
        return None

def criar_tabelas(conn):
    """Cria as tabelas necessárias para o sistema de avaliações"""
    try:
        cursor = conn.cursor()
        
        print("🔨 Criando tabelas do sistema de avaliações...")
        
        # Tabela principal de avaliações periódicas
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AvaliacoesPeriodicas' AND xtype='U')
        CREATE TABLE AvaliacoesPeriodicas (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            colaborador_id INT NOT NULL,
            tipo_avaliacao VARCHAR(20) NOT NULL,
            data_limite DATETIME,
            observacoes_gestor NTEXT,
            criado_por INT NOT NULL,
            status VARCHAR(50) DEFAULT 'Pendente',
            data_criacao DATETIME DEFAULT GETDATE(),
            data_autoavaliacao DATETIME,
            data_conclusao DATETIME,
            observacoes_finais NTEXT
        )
        """)
        print("✅ Tabela AvaliacoesPeriodicas criada/verificada")
        
        # Tabela de perguntas das avaliações
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AvaliacaoPerguntas' AND xtype='U')
        CREATE TABLE AvaliacaoPerguntas (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            avaliacao_id INT NOT NULL,
            categoria VARCHAR(100) NOT NULL,
            pergunta NTEXT NOT NULL,
            tipo VARCHAR(20) DEFAULT 'rating',
            ordem INT NOT NULL
        )
        """)
        print("✅ Tabela AvaliacaoPerguntas criada/verificada")
        
        # Tabela de respostas das avaliações
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AvaliacaoRespostas' AND xtype='U')
        CREATE TABLE AvaliacaoRespostas (
            Id INT IDENTITY(1,1) PRIMARY KEY,
            avaliacao_id INT NOT NULL,
            pergunta_id INT NOT NULL,
            colaborador_id INT,
            gestor_id INT,
            resposta NTEXT,
            score INT,
            tipo VARCHAR(20) NOT NULL,
            data_resposta DATETIME DEFAULT GETDATE()
        )
        """)
        print("✅ Tabela AvaliacaoRespostas criada/verificada")
        
        # Verificar se a tabela Users existe
        cursor.execute("""
        IF EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
        BEGIN
            -- Adicionar foreign keys se não existirem
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacoesPeriodicas_Colaborador')
            BEGIN
                ALTER TABLE AvaliacoesPeriodicas 
                ADD CONSTRAINT FK_AvaliacoesPeriodicas_Colaborador 
                FOREIGN KEY (colaborador_id) REFERENCES Users(Id)
            END
            
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacoesPeriodicas_CriadoPor')
            BEGIN
                ALTER TABLE AvaliacoesPeriodicas 
                ADD CONSTRAINT FK_AvaliacoesPeriodicas_CriadoPor 
                FOREIGN KEY (criado_por) REFERENCES Users(Id)
            END
            
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacaoPerguntas_Avaliacao')
            BEGIN
                ALTER TABLE AvaliacaoPerguntas 
                ADD CONSTRAINT FK_AvaliacaoPerguntas_Avaliacao 
                FOREIGN KEY (avaliacao_id) REFERENCES AvaliacoesPeriodicas(Id) ON DELETE CASCADE
            END
            
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacaoRespostas_Avaliacao')
            BEGIN
                ALTER TABLE AvaliacaoRespostas 
                ADD CONSTRAINT FK_AvaliacaoRespostas_Avaliacao 
                FOREIGN KEY (avaliacao_id) REFERENCES AvaliacoesPeriodicas(Id) ON DELETE CASCADE
            END
            
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacaoRespostas_Pergunta')
            BEGIN
                ALTER TABLE AvaliacaoRespostas 
                ADD CONSTRAINT FK_AvaliacaoRespostas_Pergunta 
                FOREIGN KEY (pergunta_id) REFERENCES AvaliacaoPerguntas(Id)
            END
            
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacaoRespostas_Colaborador')
            BEGIN
                ALTER TABLE AvaliacaoRespostas 
                ADD CONSTRAINT FK_AvaliacaoRespostas_Colaborador 
                FOREIGN KEY (colaborador_id) REFERENCES Users(Id)
            END
            
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_AvaliacaoRespostas_Gestor')
            BEGIN
                ALTER TABLE AvaliacaoRespostas 
                ADD CONSTRAINT FK_AvaliacaoRespostas_Gestor 
                FOREIGN KEY (gestor_id) REFERENCES Users(Id)
            END
        END
        """)
        print("✅ Foreign keys configuradas/verificadas")
        
        # Criar índices para melhor performance
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AvaliacoesPeriodicas_Colaborador')
        CREATE INDEX IX_AvaliacoesPeriodicas_Colaborador ON AvaliacoesPeriodicas(colaborador_id)
        """)
        
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AvaliacoesPeriodicas_Status')
        CREATE INDEX IX_AvaliacoesPeriodicas_Status ON AvaliacoesPeriodicas(status)
        """)
        
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AvaliacaoPerguntas_Avaliacao')
        CREATE INDEX IX_AvaliacaoPerguntas_Avaliacao ON AvaliacaoPerguntas(avaliacao_id)
        """)
        
        cursor.execute("""
        IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_AvaliacaoRespostas_Avaliacao')
        CREATE INDEX IX_AvaliacaoRespostas_Avaliacao ON AvaliacaoRespostas(avaliacao_id)
        """)
        
        print("✅ Índices criados/verificados")
        
        conn.commit()
        print("✅ Todas as tabelas foram criadas com sucesso!")
        
    except Exception as e:
        print(f"❌ Erro ao criar tabelas: {e}")
        conn.rollback()
        raise

def inserir_perguntas_padrao(conn):
    """Insere as perguntas padrão para avaliações de 45 e 90 dias"""
    try:
        cursor = conn.cursor()
        
        # Verificar se já existem perguntas
        cursor.execute("SELECT COUNT(*) FROM AvaliacaoPerguntas")
        count = cursor.fetchone()[0]
        
        if count > 0:
            print("ℹ️ Perguntas padrão já existem no banco")
            return
        
        print("📝 Inserindo perguntas padrão...")
        
        # Perguntas padrão baseadas no template fornecido
        perguntas = [
            ('Integração', 'É acessível e acolhedor com todas as pessoas, tratando a todos com respeito e cordialidade.', 'rating', 1),
            ('Adaptação', 'É pontual no cumprimento de sua jornada de trabalho (faltas, atrasos ou saídas antecipadas).', 'rating', 2),
            ('Adaptação', 'Identifica oportunidades que contribuam para o desenvolvimento do Setor.', 'rating', 3),
            ('Adaptação', 'Mantém a calma frente a diversidade do ambiente e à novos desafios, buscando interagir de forma adequada às mudanças.', 'rating', 4),
            ('Valores', 'É respeitoso com as pessoas contribuindo com um ambiente de trabalho saudável.', 'rating', 5),
            ('Valores', 'Tem caráter inquestionável, age com honestidade e integridade no relacionamento com gestores, colegas, prestadores de serviço, fornecedores e demais profissionais que venha a ter contato na empresa.', 'rating', 6),
            ('Valores', 'Exerce suas atividades com transparência e estrita observância às leis, aos princípios e as diretrizes da empresa.', 'rating', 7),
            ('Orientação para resultados', 'Mantém a produtividade e a motivação diante de situações sobre pressão.', 'rating', 8),
            ('Orientação para resultados', 'Age com engajamento para atingir os objetivos e metas.', 'rating', 9),
            ('Orientação para resultados', 'Capacidade para concretizar as tarefas que lhe são solicitadas, com o alcance de objetivos e de forma comprometida com o resultado de seu Setor.', 'rating', 10)
        ]
        
        # Criar uma avaliação temporária para inserir as perguntas
        cursor.execute("""
        INSERT INTO AvaliacoesPeriodicas (colaborador_id, tipo_avaliacao, criado_por, status)
        VALUES (1, '45_dias', 1, 'Pendente')
        """)
        
        avaliacao_id = cursor.execute("SELECT SCOPE_IDENTITY()").fetchone()[0]
        
        # Inserir as perguntas
        for categoria, pergunta, tipo, ordem in perguntas:
            cursor.execute("""
            INSERT INTO AvaliacaoPerguntas (avaliacao_id, categoria, pergunta, tipo, ordem)
            VALUES (?, ?, ?, ?, ?)
            """, (avaliacao_id, categoria, pergunta, tipo, ordem))
        
        # Remover a avaliação temporária
        cursor.execute("DELETE FROM AvaliacoesPeriodicas WHERE Id = ?", (avaliacao_id,))
        
        conn.commit()
        print("✅ Perguntas padrão inseridas com sucesso!")
        
    except Exception as e:
        print(f"❌ Erro ao inserir perguntas padrão: {e}")
        conn.rollback()
        raise

def criar_avaliacao_exemplo(conn):
    """Cria uma avaliação de exemplo para demonstração"""
    try:
        cursor = conn.cursor()
        
        # Verificar se existem usuários no sistema
        cursor.execute("SELECT TOP 2 Id, NomeCompleto FROM Users WHERE IsActive = 1")
        usuarios = cursor.fetchall()
        
        if len(usuarios) < 2:
            print("ℹ️ Não há usuários suficientes para criar avaliação de exemplo")
            return
        
        gestor_id, gestor_nome = usuarios[0]
        colaborador_id, colaborador_nome = usuarios[1]
        
        print(f"📋 Criando avaliação de exemplo: {gestor_nome} -> {colaborador_nome}")
        
        # Criar avaliação de 45 dias
        data_limite = datetime.now() + timedelta(days=7)
        
        cursor.execute("""
        INSERT INTO AvaliacoesPeriodicas (colaborador_id, tipo_avaliacao, data_limite, observacoes_gestor, criado_por, status)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (colaborador_id, '45_dias', data_limite, 'Avaliação de experiência de 45 dias', gestor_id, 'Pendente'))
        
        avaliacao_id = cursor.execute("SELECT SCOPE_IDENTITY()").fetchone()[0]
        
        # Inserir perguntas para esta avaliação
        perguntas = [
            ('Integração', 'É acessível e acolhedor com todas as pessoas, tratando a todos com respeito e cordialidade.', 'rating', 1),
            ('Adaptação', 'É pontual no cumprimento de sua jornada de trabalho (faltas, atrasos ou saídas antecipadas).', 'rating', 2),
            ('Adaptação', 'Identifica oportunidades que contribuam para o desenvolvimento do Setor.', 'rating', 3),
            ('Adaptação', 'Mantém a calma frente a diversidade do ambiente e à novos desafios, buscando interagir de forma adequada às mudanças.', 'rating', 4),
            ('Valores', 'É respeitoso com as pessoas contribuindo com um ambiente de trabalho saudável.', 'rating', 5),
            ('Valores', 'Tem caráter inquestionável, age com honestidade e integridade no relacionamento com gestores, colegas, prestadores de serviço, fornecedores e demais profissionais que venha a ter contato na empresa.', 'rating', 6),
            ('Valores', 'Exerce suas atividades com transparência e estrita observância às leis, aos princípios e as diretrizes da empresa.', 'rating', 7),
            ('Orientação para resultados', 'Mantém a produtividade e a motivação diante de situações sobre pressão.', 'rating', 8),
            ('Orientação para resultados', 'Age com engajamento para atingir os objetivos e metas.', 'rating', 9),
            ('Orientação para resultados', 'Capacidade para concretizar as tarefas que lhe são solicitadas, com o alcance de objetivos e de forma comprometida com o resultado de seu Setor.', 'rating', 10)
        ]
        
        for categoria, pergunta, tipo, ordem in perguntas:
            cursor.execute("""
            INSERT INTO AvaliacaoPerguntas (avaliacao_id, categoria, pergunta, tipo, ordem)
            VALUES (?, ?, ?, ?, ?)
            """, (avaliacao_id, categoria, pergunta, tipo, ordem))
        
        conn.commit()
        print(f"✅ Avaliação de exemplo criada com ID: {avaliacao_id}")
        
    except Exception as e:
        print(f"❌ Erro ao criar avaliação de exemplo: {e}")
        conn.rollback()
        raise

def main():
    """Função principal"""
    print("🚀 Configurando banco de dados para sistema de avaliações de 45 e 90 dias")
    print("=" * 70)
    
    # Conectar ao banco
    conn = conectar_banco()
    if not conn:
        return
    
    try:
        # Criar tabelas
        criar_tabelas(conn)
        
        # Inserir perguntas padrão
        inserir_perguntas_padrao(conn)
        
        # Criar avaliação de exemplo
        criar_avaliacao_exemplo(conn)
        
        print("\n🎉 Configuração concluída com sucesso!")
        print("\n📊 Tabelas criadas:")
        print("   - AvaliacoesPeriodicas")
        print("   - AvaliacaoPerguntas") 
        print("   - AvaliacaoRespostas")
        print("\n🔑 Funcionalidades disponíveis:")
        print("   - Criação de avaliações de 45 e 90 dias")
        print("   - Autoavaliação do colaborador")
        print("   - Avaliação do gestor")
        print("   - Sistema de perguntas padrão")
        
    except Exception as e:
        print(f"\n❌ Erro durante a configuração: {e}")
    
    finally:
        if conn:
            conn.close()
            print("\n🔌 Conexão com banco fechada")

if __name__ == "__main__":
    main()
