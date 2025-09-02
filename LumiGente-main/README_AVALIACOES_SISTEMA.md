# Sistema de Avaliações Periódicas - Lumicenter

## Visão Geral

O sistema de avaliações periódicas foi implementado para permitir que gestores criem e gerenciem avaliações de 45 e 90 dias para colaboradores, incluindo autoavaliações e avaliações do gestor.

## Funcionalidades Principais

### 1. Template Padrão (45/90 dias)
- **10 perguntas organizadas em 4 categorias:**
  - **Integração (1 pergunta):** É acessível e acolhedor com todas as pessoas, tratando a todos com respeito e cordialidade.
  - **Adaptação (3 perguntas):** Pontualidade, identificação de oportunidades, e manutenção da calma em desafios
  - **Valores (3 perguntas):** Respeito, honestidade/integridade, e transparência nas atividades
  - **Orientação para Resultados (3 perguntas):** Produtividade sob pressão, engajamento, e capacidade de concretização

### 2. Avaliações Personalizadas
- Criação de perguntas customizadas
- Categorias personalizadas
- Diferentes tipos de resposta (escala 1-10, texto livre, sim/não, múltipla escolha)
- Título e descrição personalizados

### 3. Fluxo de Trabalho
1. **Gestor cria avaliação** (template padrão ou personalizado)
2. **Colaborador realiza autoavaliação**
3. **Gestor avalia o colaborador** (com comparação da autoavaliação)
4. **Sistema registra resultados**

## Arquivos do Sistema

### Frontend
- `avaliacoes-periodicas.html` - Página principal com abas para gestor e colaborador
- `autoavaliacao.html` - Interface para colaboradores realizarem autoavaliações
- `avaliacao-gestor.html` - Interface para gestores avaliarem colaboradores

### Backend
- `server.js` - Rotas da API e lógica de negócio
- Rotas implementadas:
  - `POST /api/avaliacoes` - Criar avaliação com template padrão
  - `POST /api/avaliacoes/personalizada` - Criar avaliação personalizada
  - `GET /api/avaliacoes/gestor` - Listar avaliações criadas pelo gestor
  - `GET /api/avaliacoes/colaborador` - Listar avaliações do colaborador
  - `GET /api/avaliacoes/:id` - Buscar avaliação específica

## Como Usar

### Para Gestores

#### 1. Acessar o Sistema
- No dashboard, clicar em "Criar Avaliação"
- Será redirecionado para a página de avaliações periódicas

#### 2. Escolher Template
- **Template Padrão:** Usar as 10 perguntas predefinidas
- **Avaliação Personalizada:** Criar perguntas customizadas

#### 3. Configurar Avaliação
- Selecionar colaborador
- Escolher tipo (45 ou 90 dias)
- Definir data limite
- Adicionar observações iniciais

#### 4. Para Avaliações Personalizadas
- Adicionar título e descrição
- Criar perguntas com categorias e tipos de resposta
- Definir ordem das perguntas

### Para Colaboradores

#### 1. Acessar Autoavaliação
- Na aba "Colaborador" da página de avaliações
- Clicar em "Autoavaliação" para avaliações pendentes

#### 2. Responder Perguntas
- Cada pergunta usa escala de 1-10
- Comentários opcionais para cada resposta
- Barra de progresso mostra conclusão

#### 3. Finalizar
- Todas as perguntas devem ser respondidas
- Sistema salva automaticamente

## Estrutura do Banco de Dados

### Tabelas Principais
- `AvaliacoesPeriodicas` - Dados da avaliação
- `AvaliacaoPerguntas` - Perguntas da avaliação
- `AvaliacaoRespostas` - Respostas dos usuários

### Campos Importantes
- `tipo_avaliacao`: '45_dias', '90_dias', 'personalizado'
- `status`: 'Pendente', 'Autoavaliação_Concluída', 'Concluída'
- `template`: 'padrao' ou 'personalizado'

## Integração com Sistema Existente

- Botão "Criar Avaliação" no dashboard aponta para o novo sistema
- Usa as mesmas tabelas de usuários e autenticação
- Mantém consistência visual com o design existente
- Sistema de permissões integrado (gestores vs colaboradores)

## Tecnologias Utilizadas

- **Frontend:** HTML5, CSS3, JavaScript (ES6+)
- **Backend:** Node.js, Express.js
- **Banco de Dados:** SQL Server
- **Estilização:** CSS customizado com gradientes e animações
- **Ícones:** Font Awesome 6.0

## Próximos Passos Sugeridos

1. **Notificações:** Sistema de lembretes por email
2. **Relatórios:** Dashboards analíticos de resultados
3. **Histórico:** Visualização de avaliações anteriores
4. **Exportação:** Relatórios em PDF/Excel
5. **Métricas:** Comparação de desempenho ao longo do tempo

## Suporte e Manutenção

O sistema foi desenvolvido seguindo as melhores práticas de desenvolvimento web, com código limpo, comentado e estruturado para fácil manutenção e expansão futura.
