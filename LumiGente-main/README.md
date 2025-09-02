# 🚀 Sistema Feedz - Lumicenter Lighting

Sistema completo de gestão de feedbacks, reconhecimentos e avaliações para a Lumicenter Lighting.

## 📋 Visão Geral

O Sistema Feedz é uma plataforma moderna e intuitiva que permite:

- **Feedbacks construtivos** entre colaboradores
- **Reconhecimentos** com badges personalizados
- **Gestão de humor** diário da equipe
- **Acompanhamento de objetivos** com check-ins
- **Pesquisas rápidas** para engajamento
- **Gamificação** com sistema Lumicoin
- **Dashboard gerencial** para gestores
- **Analytics avançados** e relatórios

## 🎯 Funcionalidades Principais

### Para Usuários Comuns
- Dashboard personalizado com métricas
- Envio e recebimento de feedbacks
- Sistema de reconhecimentos
- Registro de humor diário
- Acompanhamento de objetivos
- Participação em pesquisas
- Gamificação com pontos e ranking

### Para Gestores
- Dashboard gerencial avançado
- Gestão de humor da equipe
- Analytics e relatórios
- Gestão de equipe
- Criação de pesquisas
- Acompanhamento de objetivos da equipe

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js + Express
- **Banco de Dados**: SQL Server
- **Frontend**: HTML5 + CSS3 + JavaScript
- **Autenticação**: Express Session
- **UI Framework**: Font Awesome + CSS Custom

## 📦 Instalação

### Pré-requisitos

1. **Node.js** (versão 14 ou superior)
2. **SQL Server** com acesso ao banco `LUMICENTER_FEEDBACKS`
3. **Python** (para executar scripts de banco)
4. **pyodbc** (para conexão com SQL Server)

### Passo a Passo

#### 1. Clone o repositório
```bash
git clone <url-do-repositorio>
cd Feedz
```

#### 2. Instale as dependências
```bash
npm install
```

#### 3. Configure o banco de dados

Execute o script Python para criar a estrutura do banco:

```bash
cd step-by-step
python executar_banco.py
```

#### 4. Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais reais:

```env
DB_USER=seu_usuario_db
DB_PASSWORD=sua_senha_db
DB_SERVER=seu_servidor\\instancia
DB_NAME=nome_do_banco
API_URL=http://seu-servidor:porta/api/Login
PORT=3000
```

#### 5. Inicie o servidor
```bash
npm start
```

O sistema estará disponível em: http://localhost:3000

## 🗄️ Estrutura do Banco de Dados

### Tabelas Principais
- **Users** - Usuários do sistema
- **Roles** - Perfis de acesso
- **Feedbacks** - Sistema de feedbacks
- **Recognitions** - Reconhecimentos
- **DailyMood** - Humor do dia
- **Objetivos** - Gestão de objetivos
- **PesquisasRapidas** - Pesquisas rápidas
- **Gamification** - Sistema de gamificação

### Tabelas de Suporte
- **FeedbackReactions** - Reações aos feedbacks
- **FeedbackReplies** - Respostas aos feedbacks
- **ObjetivoCheckins** - Check-ins de objetivos
- **UserPoints** - Pontos dos usuários
- **UserRankings** - Rankings mensais

## 🔧 APIs Disponíveis

### Autenticação
- `POST /api/login` - Login de usuário
- `GET /api/usuario` - Dados do usuário logado
- `POST /api/logout` - Logout

### Feedbacks
- `GET /api/feedbacks/received` - Feedbacks recebidos
- `GET /api/feedbacks/sent` - Feedbacks enviados
- `POST /api/feedbacks` - Criar feedback
- `POST /api/feedbacks/:id/react` - Reagir ao feedback

### Reconhecimentos
- `GET /api/recognitions` - Reconhecimentos recebidos
- `POST /api/recognitions` - Criar reconhecimento

### Humor
- `POST /api/humor` - Registrar humor
- `GET /api/humor` - Buscar humor do usuário
- `GET /api/humor/metrics` - Métricas de humor

### Objetivos
- `POST /api/objetivos` - Criar objetivo
- `GET /api/objetivos` - Listar objetivos
- `POST /api/objetivos/:id/checkin` - Registrar check-in

### Gamificação
- `GET /api/gamification/points` - Pontos do usuário
- `GET /api/gamification/ranking` - Ranking mensal

### Gerencial (apenas gestores)
- `GET /api/manager/dashboard` - Dashboard gerencial
- `GET /api/manager/analytics` - Analytics avançados

## 🎨 Design System

### Cores Principais
- **Primária**: #0d556d (Azul Lumicenter)
- **Secundária**: #f59e0b (Âmbar)
- **Sucesso**: #10b981 (Verde)
- **Erro**: #ef4444 (Vermelho)

### Componentes
- Cards com sombras suaves
- Botões com gradientes
- Modais responsivos
- Sidebar fixa
- Grid layouts flexíveis

## 🔐 Segurança

- Autenticação via API externa
- Sessões seguras com Express Session
- Validação de dados de entrada
- Controle de acesso por roles
- Sanitização de inputs

## 📱 Responsividade

- Design mobile-first
- Breakpoints: 768px, 1024px
- Sidebar colapsável em mobile
- Grids adaptativos
- Modais responsivos

## 🚀 Funcionalidades Avançadas

### Sistema de Gamificação
- **Lumicoin** como moeda virtual
- **Pontuação automática** por ações:
  - Enviar Feedback: 150 Lumicoin
  - Enviar Reconhecimento: 100-500 Lumicoin
  - Responder pesquisa: 500 Lumicoin
  - Acesso diário: 250 Lumicoin
- **Ranking mensal** dos usuários
- **Desafios mensais** com recompensas

### Analytics para Gestores
- **E-NPS** (Employee Net Promoter Score)
- **Volume de atividades** por período
- **Tendências** de humor e engajamento
- **Performance** individual e da equipe

## 📊 Métricas Disponíveis

### Para Usuários
- Feedbacks recebidos/enviados
- Reconhecimentos dados/recebidos
- Pontuação média dos feedbacks
- Progresso de objetivos
- Ranking de gamificação

### Para Gestores
- E-NPS da equipe
- Volume de atividades
- Humor médio da equipe
- Performance individual
- Engajamento geral

## 🛠️ Desenvolvimento

### Estrutura de Arquivos
```
Feedz/
├── server.js                 # Servidor principal
├── package.json             # Dependências
├── public/                  # Arquivos estáticos
│   ├── index.html          # Dashboard principal
│   └── login.html          # Página de login
└── step-by-step/           # Documentação
    ├── PLANO_IMPLEMENTACAO_COMPLETA.md
    ├── ESTRUTURA_BANCO_COMPLETA.sql
    ├── FUNCIONALIDADES_IMPLEMENTADAS.md
    └── executar_banco.py
```

### Comandos Úteis

```bash
# Iniciar servidor em modo desenvolvimento
npm run dev

# Iniciar servidor em produção
npm start

# Executar testes (futuro)
npm test

# Verificar sintaxe
npm run lint
```

## 🔧 Configuração de Ambiente

### Desenvolvimento
```bash
NODE_ENV=development
PORT=3000
DEBUG=true
```

### Produção
```bash
NODE_ENV=production
PORT=3000
DEBUG=false
```

## 📈 Performance

### Otimizações Implementadas
- Índices otimizados no banco de dados
- Queries otimizadas com JOINs
- Paginação de resultados
- Cache de consultas frequentes
- Compressão de respostas

### Monitoramento
- Logs de erro detalhados
- Métricas de performance
- Monitoramento de sessões
- Alertas de sistema

## 🚀 Deploy

### Requisitos de Produção
- Node.js 14+
- SQL Server 2016+
- 2GB RAM mínimo
- 10GB espaço em disco

### Passos para Deploy
1. Configurar variáveis de ambiente
2. Executar migrações do banco
3. Configurar proxy reverso (nginx/apache)
4. Configurar SSL/HTTPS
5. Configurar backup automático

## 🤝 Contribuição

### Como Contribuir
1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

### Padrões de Código
- Use ESLint para linting
- Siga o padrão de commits convencionais
- Documente novas funcionalidades
- Adicione testes para novas features

## 📞 Suporte

### Contato
- **Email**: suporte@lumicenter.com.br
- **Telefone**: (11) 1234-5678
- **Documentação**: [Link para documentação completa]

### Problemas Conhecidos
- [Lista de problemas conhecidos e soluções]

## 📄 Licença

Este projeto é propriedade da Lumicenter Lighting e está sob licença interna.

## 🎉 Agradecimentos

- Equipe de desenvolvimento
- Usuários beta testers
- Stakeholders do projeto

---

**Versão**: 1.0.0  
**Última atualização**: Janeiro 2025  
**Status**: Em produção
