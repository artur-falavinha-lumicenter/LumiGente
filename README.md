# LumiGente - Sistema de Feedback e Gestão de Pessoas

![LumiGente Logo](https://img.shields.io/badge/LumiGente-Feedback%20Hub-blue?style=for-the-badge)

## 📋 Visão Geral

O **LumiGente** é um sistema completo de gestão de feedback e pessoas desenvolvido para a Lumicenter. O sistema oferece uma plataforma integrada para gerenciamento de feedbacks, avaliações de desempenho, pesquisas organizacionais, reconhecimentos e análise de dados de RH.

### 🎯 Principais Funcionalidades

- **Dashboard Interativo**: Visão consolidada de métricas e indicadores
- **Sistema de Feedbacks**: Envio e recebimento de feedbacks entre colaboradores
- **Reconhecimentos**: Sistema de reconhecimento e gamificação
- **Gestão de Equipes**: Visualização hierárquica da organização
- **Relatórios e Analytics**: Análises detalhadas de desempenho e engajamento
- **Humor do Dia**: Monitoramento do clima organizacional
- **Gestão de Objetivos**: Acompanhamento de metas e resultados
- **Pesquisas Organizacionais**: Criação e gestão de pesquisas internas
- **Avaliações Periódicas**: Sistema de avaliações de 45 e 90 dias
- **Histórico Completo**: Rastreamento de todas as atividades

## 🏗️ Arquitetura do Sistema

### Stack Tecnológica

- **Backend**: Node.js + Express.js
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Banco de Dados**: Microsoft SQL Server
- **Autenticação**: Express Session + bcrypt
- **Processamento de Dados**: Python (scripts auxiliares)
- **Relatórios**: Excel.js para exportação

### Estrutura do Projeto

```
LumiGente-main/
├── 📁 public/                    # Frontend (arquivos estáticos)
│   ├── 📄 index.html            # Dashboard principal
│   ├── 📄 login.html            # Página de login
│   ├── 📄 autoavaliacao.html    # Sistema de autoavaliação
│   ├── 📄 avaliacao-gestor.html # Avaliação de gestores
│   ├── 📁 js/                   # Scripts JavaScript
│   ├── 📁 styles/               # Folhas de estilo CSS
│   └── 📁 historico_feedz/      # Dados históricos e relatórios
├── 📁 routes/                   # Rotas da API
├── 📁 utils/                    # Utilitários e managers
│   ├── 📄 hierarchyManager.js   # Gerenciamento de hierarquia
│   └── 📄 analyticsManager.js   # Análises e métricas
├── 📁 scripts/                  # Scripts Python auxiliares
├── 📄 server.js                 # Servidor principal
├── 📄 config.env               # Configurações do sistema
└── 📄 package.json             # Dependências Node.js
```

## 🚀 Instalação e Configuração

### Pré-requisitos

- **Node.js** (versão 16 ou superior)
- **Python** (versão 3.8 ou superior)
- **SQL Server** (2017 ou superior)
- **ODBC Driver 17 for SQL Server**

### Passo a Passo

1. **Clone o repositório**
   ```bash
   git clone https://github.com/lumicenter/feedz-hierarchy.git
   cd LumiGente-main
   ```

2. **Instale as dependências Node.js**
   ```bash
   npm install
   ```

3. **Configure o banco de dados**
   - Edite o arquivo `config.env` com suas credenciais
   - Execute o script de configuração:
   ```bash
   python scripts/setup_avaliacoes_db.py
   ```

4. **Configure as variáveis de ambiente**
   ```bash
   # Copie e edite o arquivo de configuração
   cp config.env .env
   ```

5. **Inicie o servidor**
   ```bash
   # Desenvolvimento
   npm run dev
   
   # Produção
   npm start
   ```

## ⚙️ Configuração

### Variáveis de Ambiente Principais

```env
# Servidor
PORT=3000
NODE_ENV=development

# Banco de Dados
DB_SERVER=seu_servidor\\instancia
DB_NAME=LUMICENTER_FEEDBACKS
DB_USER=seu_usuario
DB_PASSWORD=sua_senha

# Segurança
SESSION_SECRET=sua_chave_secreta
BCRYPT_SALT_ROUNDS=12

# Funcionalidades
SYNC_INTERVAL=300000
HIERARCHY_CACHE_TTL=3600000
```

## 📊 Funcionalidades Detalhadas

### 1. Dashboard
- Métricas em tempo real de feedbacks
- Indicadores de desempenho da equipe
- Gráficos de tendências e análises
- Notificações e alertas

### 2. Sistema de Feedbacks
- Envio de feedbacks estruturados
- Chat de feedback em tempo real
- Categorização por tipos (positivo, construtivo, reconhecimento)
- Histórico completo de interações

### 3. Avaliações Periódicas
- Avaliações de 45 e 90 dias automatizadas
- Autoavaliação e avaliação por gestores
- Acompanhamento de progresso
- Relatórios de desempenho

### 4. Gestão Hierárquica
- Visualização da estrutura organizacional
- Gerenciamento de subordinados
- Delegação de responsabilidades
- Controle de acesso por nível

### 5. Analytics e Relatórios
- Relatórios de desempenho individual e por equipe
- Análise de clima organizacional
- Métricas de engajamento
- Exportação para Excel

## 🔒 Segurança

O sistema implementa múltiplas camadas de segurança:

- **Autenticação**: Sistema de sessões seguras
- **Criptografia**: Senhas criptografadas com bcrypt
- **Validação**: Validação rigorosa de dados de entrada
- **CORS**: Configuração adequada para requisições cross-origin
- **Rate Limiting**: Proteção contra ataques de força bruta
- **Sanitização**: Prevenção contra XSS e SQL Injection

## 🧪 Testes

```bash
# Executar todos os testes
npm run test:all

# Testes específicos
npm run test:hierarchy
npm run test:cadastro
npm run test:csrf

# Testes com cobertura
npm run test:coverage
```

## 📚 Monitoramento de Documentação

O sistema inclui ferramentas automatizadas para manter a documentação sempre atualizada:

```bash
# Analisar mudanças no código
npm run analyze:doc-changes

# Verificar documentação da API
npm run check:api-docs

# Verificar documentação do banco
npm run check:db-docs

# Atualizar documentação completa
npm run update:docs
```

### Sistema de Monitoramento

O LumiGente implementa um sistema robusto de monitoramento de documentação que:

- **Detecta automaticamente** mudanças no código que afetam a documentação
- **Verifica consistência** entre código e documentação
- **Sugere atualizações** necessárias na documentação
- **Mantém qualidade** da documentação técnica

Para mais detalhes, consulte a [Documentação de Monitoramento](docs/DOCUMENTATION_MONITORING.md).

## 📈 Monitoramento

O sistema inclui:

- **Health Checks**: Verificação automática de saúde do sistema
- **Métricas**: Coleta de métricas de performance
- **Logs**: Sistema de logging estruturado
- **Backup**: Backup automático de dados críticos

## 🚀 Deploy

### Ambiente de Produção

1. **Configure as variáveis de produção**
   ```env
   NODE_ENV=production
   PORT=8080
   SESSION_COOKIE_SECURE=true
   CORS_ORIGIN=https://feedz.lumicenter.com.br
   ```

2. **Execute o build**
   ```bash
   npm run build
   ```

3. **Inicie o serviço**
   ```bash
   npm start
   ```

### Docker (Opcional)

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contribuição

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Changelog

### Versão 1.0.0
- Sistema completo de feedback implementado
- Dashboard interativo
- Sistema de avaliações periódicas
- Gestão hierárquica
- Relatórios e analytics

## 📞 Suporte

Para suporte técnico, entre em contato:

- **Email**: suporte@lumicenter.com.br
- **Documentação**: [Wiki do Projeto](https://github.com/lumicenter/feedz-hierarchy/wiki)
- **Issues**: [GitHub Issues](https://github.com/lumicenter/feedz-hierarchy/issues)

## 📄 Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

---

**Desenvolvido com ❤️ pela equipe Lumicenter**

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL%20Server-CC2927?style=flat&logo=microsoft-sql-server&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
