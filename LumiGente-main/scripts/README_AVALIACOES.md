# 🚀 Sistema de Avaliações de 45 e 90 Dias - Configuração

Este diretório contém os scripts necessários para configurar o sistema de avaliações periódicas no banco de dados SQL Server.

## 📋 Arquivos Disponíveis

1. **`create_avaliacoes_final.sql`** - Script principal para criar as tabelas
2. **`insert_perguntas_padrao.sql`** - Script para inserir as perguntas padrão
3. **`setup_avaliacoes_db.py`** - Script Python alternativo (requer pyodbc)

## 🔧 Configuração do Banco de Dados

### Opção 1: Usando SQL Server Management Studio (Recomendado)

1. **Conectar ao banco de dados** `LUMICENTER_FEEDBACKS`
2. **Executar o primeiro script:**
   ```sql
   -- Abrir e executar: create_avaliacoes_final.sql
   ```
3. **Executar o segundo script:**
   ```sql
   -- Abrir e executar: insert_perguntas_padrao.sql
   ```

### Opção 2: Usando Python (Alternativo)

1. **Instalar dependências:**
   ```bash
   pip install pyodbc
   ```

2. **Configurar variáveis de ambiente:**
   ```bash
   # Criar arquivo .env ou config.env com:
   DB_SERVER=localhost\\SQLEXPRESS
   DB_NAME=LUMICENTER_FEEDBACKS
   DB_USER=sa
   DB_PASSWORD=sua_senha
   ```

3. **Executar o script Python:**
   ```bash
   python setup_avaliacoes_db.py
   ```

## 📊 Estrutura das Tabelas Criadas

### 1. AvaliacoesPeriodicas
- **Id**: Chave primária
- **colaborador_id**: ID do colaborador sendo avaliado
- **tipo_avaliacao**: '45_dias' ou '90_dias'
- **data_limite**: Data limite para conclusão
- **observacoes_gestor**: Observações iniciais do gestor
- **criado_por**: ID do gestor que criou a avaliação
- **status**: 'Pendente', 'Autoavaliacao_Concluida', 'Concluida'
- **data_criacao**: Data de criação da avaliação
- **data_autoavaliacao**: Data da autoavaliação
- **data_conclusao**: Data da conclusão final
- **observacoes_finais**: Observações finais do gestor

### 2. AvaliacaoPerguntas
- **Id**: Chave primária
- **avaliacao_id**: ID da avaliação (foreign key)
- **categoria**: Categoria da pergunta (Integração, Adaptação, Valores, etc.)
- **pergunta**: Texto da pergunta
- **tipo**: Tipo da pergunta ('rating', 'texto', 'multipla_escolha')
- **ordem**: Ordem de apresentação

### 3. AvaliacaoRespostas
- **Id**: Chave primária
- **avaliacao_id**: ID da avaliação (foreign key)
- **pergunta_id**: ID da pergunta (foreign key)
- **colaborador_id**: ID do colaborador (para autoavaliação)
- **gestor_id**: ID do gestor (para avaliação do gestor)
- **resposta**: Texto da resposta
- **score**: Pontuação de 1 a 10
- **tipo**: 'autoavaliacao' ou 'avaliacao_gestor'
- **data_resposta**: Data da resposta

## 🔑 Perguntas Padrão Incluídas

### Integração (1 pergunta)
1. É acessível e acolhedor com todas as pessoas, tratando a todos com respeito e cordialidade.

### Adaptação (3 perguntas)
2. É pontual no cumprimento de sua jornada de trabalho (faltas, atrasos ou saídas antecipadas).
3. Identifica oportunidades que contribuam para o desenvolvimento do Setor.
4. Mantém a calma frente a diversidade do ambiente e à novos desafios, buscando interagir de forma adequada às mudanças.

### Valores (3 perguntas)
5. É respeitoso com as pessoas contribuindo com um ambiente de trabalho saudável.
6. Tem caráter inquestionável, age com honestidade e integridade no relacionamento com gestores, colegas, prestadores de serviço, fornecedores e demais profissionais que venha a ter contato na empresa.
7. Exerce suas atividades com transparência e estrita observância às leis, aos princípios e as diretrizes da empresa.

### Orientação para resultados (3 perguntas)
8. Mantém a produtividade e a motivação diante de situações sobre pressão.
9. Age com engajamento para atingir os objetivos e metas.
10. Capacidade para concretizar as tarefas que lhe são solicitadas, com o alcance de objetivos e de forma comprometida com o resultado de seu Setor.

## 🚀 Funcionalidades Disponíveis

### Para Gestores
- ✅ Criar avaliações de 45 e 90 dias
- ✅ Selecionar colaboradores para avaliação
- ✅ Definir data limite
- ✅ Adicionar observações iniciais
- ✅ Realizar avaliação do colaborador
- ✅ Adicionar observações finais

### Para Colaboradores
- ✅ Visualizar avaliações pendentes
- ✅ Realizar autoavaliação
- ✅ Ver histórico de avaliações
- ✅ Acompanhar status das avaliações

### Sistema
- ✅ Perguntas padrão organizadas por categoria
- ✅ Sistema de pontuação de 1 a 10
- ✅ Controle de status das avaliações
- ✅ Histórico completo de respostas
- ✅ Índices para performance otimizada

## 🔍 Verificação da Instalação

Após executar os scripts, verifique se as tabelas foram criadas:

```sql
-- Verificar tabelas criadas
SELECT TABLE_NAME 
FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME IN ('AvaliacoesPeriodicas', 'AvaliacaoPerguntas', 'AvaliacaoRespostas');

-- Verificar perguntas padrão
SELECT categoria, COUNT(*) as total_perguntas
FROM AvaliacaoPerguntas 
GROUP BY categoria 
ORDER BY categoria;
```

## 📝 Próximos Passos

1. **Configurar o banco de dados** usando os scripts acima
2. **Testar as APIs** do servidor Node.js
3. **Implementar interface frontend** para gestores e colaboradores
4. **Configurar notificações** para avaliações pendentes
5. **Implementar relatórios** e analytics

## 🆘 Solução de Problemas

### Erro: "Invalid column name 'categoria'"
- **Causa**: Tabela não foi criada corretamente
- **Solução**: Execute primeiro o `create_avaliacoes_final.sql`

### Erro: "Foreign key constraint"
- **Causa**: Tabela Users não existe ou tem estrutura diferente
- **Solução**: Verifique se a tabela Users existe e tem a coluna Id

### Erro: "Cannot drop table"
- **Causa**: Tabela está sendo referenciada por outras tabelas
- **Solução**: Execute os scripts na ordem correta (DROP antes de CREATE)

## 📞 Suporte

Para dúvidas ou problemas, consulte:
- Documentação da API no arquivo `server.js`
- Logs do servidor Node.js
- Estrutura do banco de dados SQL Server
