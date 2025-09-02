# 🔧 Configuração de Usuários Especiais

## 📋 Problema Resolvido

Usuários PJ ou com situações especiais que precisam permanecer ativos no sistema mesmo quando marcados como inativos na base de dados externa.

## 🛠️ Solução Implementada

Substituição do hard code por variável de ambiente `SPECIAL_USERS_CPF`.

## ⚙️ Como Configurar

### 1. Editar arquivo `.env`

Adicione a linha:
```env
SPECIAL_USERS_CPF=xxxxxxxxxxx
```

Para múltiplos usuários, separe por vírgula:
```env
SPECIAL_USERS_CPF=xxxxxxxxxxx,yyyyyyyyyyy,zzzzzzzzzzz
```

### 2. Reiniciar o servidor

```bash
npm start
```

## 🔒 Vantagens da Solução

- ✅ **Segurança**: CPFs não ficam expostos no código
- ✅ **Flexibilidade**: Pode adicionar/remover usuários sem alterar código
- ✅ **Ambiente**: Diferentes configurações por ambiente (dev/prod)
- ✅ **Auditoria**: Fácil de rastrear mudanças no .env

## 🎯 Funcionalidades

O sistema automaticamente:

1. **Na inicialização**: Ativa todos os usuários especiais
2. **No login**: Permite login mesmo se STATUS_GERAL ≠ 'ATIVO'
3. **No cadastro**: Permite cadastro mesmo se funcionário inativo
4. **Na sincronização**: Não desativa usuários especiais

## 📝 Exemplo de Configuração

```env
# Arquivo .env
SPECIAL_USERS_CPF=xxxxxxxxxxx
```

Agora o usuário PJ sempre terá acesso sem expor dados sensíveis no código.