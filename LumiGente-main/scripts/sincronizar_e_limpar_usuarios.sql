-- =====================================================
-- SCRIPT DE SINCRONIZAÇÃO E LIMPEZA DE USUÁRIOS
-- =====================================================
-- Este script faz o que o sincronizador faz, mas também
-- remove usuários que não têm registro ATIVO na TAB_HIST_SRA
-- 
-- ⚠️  ATENÇÃO: Este script irá EXCLUIR usuários da tabela Users!
-- Execute apenas quando necessário e faça backup antes!
-- =====================================================

BEGIN TRANSACTION;

DECLARE @UsuariosRemovidos INT = 0;
DECLARE @UsuariosAtualizados INT = 0;
DECLARE @UsuariosCriados INT = 0;

PRINT '🔄 Iniciando sincronização e limpeza de usuários...';
PRINT '📅 Data/Hora: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';

-- =====================================================
-- 1. IDENTIFICAR E MOSTRAR USUÁRIOS QUE SERÃO REMOVIDOS
-- =====================================================

PRINT '🔍 Identificando usuários sem registro ATIVO...';

WITH UsuariosSemRegistroAtivo AS (
    SELECT 
        u.Id,
        u.NomeCompleto,
        u.CPF,
        u.Matricula,
        u.Departamento,
        u.DescricaoDepartamento,
        u.created_at,
        u.LastLogin,
        CASE 
            WHEN u.LastLogin IS NULL THEN 'Nunca fez login'
            ELSE 'Último login: ' + CONVERT(VARCHAR, u.LastLogin, 103)
        END as StatusLogin
    FROM Users u
    WHERE NOT EXISTS (
        SELECT 1 
        FROM TAB_HIST_SRA s 
        WHERE s.CPF = u.CPF 
        AND s.STATUS_GERAL = 'ATIVO'
    )
)
SELECT 
    Id,
    NomeCompleto,
    CPF,
    Matricula,
    Departamento,
    DescricaoDepartamento,
    StatusLogin,
    created_at
FROM UsuariosSemRegistroAtivo
ORDER BY NomeCompleto;

-- Contar quantos usuários serão removidos
SELECT @UsuariosRemovidos = COUNT(*)
FROM Users u
WHERE NOT EXISTS (
    SELECT 1 
    FROM TAB_HIST_SRA s 
    WHERE s.CPF = u.CPF 
    AND s.STATUS_GERAL = 'ATIVO'
);

PRINT '❌ Usuários que serão REMOVIDOS: ' + CAST(@UsuariosRemovidos AS VARCHAR);
PRINT '';

-- =====================================================
-- 2. ATUALIZAR DADOS DOS USUÁRIOS ATIVOS (como o sincronizador)
-- =====================================================

PRINT '🔄 Atualizando dados dos usuários ativos...';

WITH FuncionariosAtivos AS (
    SELECT 
        s.MATRICULA,
        s.NOME,
        s.DEPARTAMENTO,
        s.FILIAL,
        s.CPF,
        s.STATUS_GERAL,
        ROW_NUMBER() OVER (
            PARTITION BY s.CPF 
            ORDER BY 
                CASE WHEN s.STATUS_GERAL = 'ATIVO' THEN 0 ELSE 1 END,
                s.MATRICULA DESC
        ) as rn
    FROM TAB_HIST_SRA s
    WHERE s.STATUS_GERAL = 'ATIVO'
)
UPDATE u SET
    Matricula = fa.MATRICULA,
    NomeCompleto = fa.NOME,
    Departamento = fa.DEPARTAMENTO,
    Filial = fa.FILIAL,
    DescricaoDepartamento = COALESCE(
        (SELECT TOP 1 DESCRICAO_ATUAL 
         FROM HIERARQUIA_CC h 
         WHERE TRIM(h.DEPTO_ATUAL) = TRIM(fa.DEPARTAMENTO)
         ORDER BY LEN(HIERARQUIA_COMPLETA) DESC),
        fa.DEPARTAMENTO
    ),
    IsActive = 1,
    updated_at = GETDATE()
FROM Users u
INNER JOIN FuncionariosAtivos fa ON u.CPF = fa.CPF
WHERE fa.rn = 1;

SET @UsuariosAtualizados = @@ROWCOUNT;
PRINT '✅ Usuários ATUALIZADOS: ' + CAST(@UsuariosAtualizados AS VARCHAR);

-- =====================================================
-- 3. CRIAR USUÁRIOS NOVOS (funcionários ativos sem cadastro)
-- =====================================================

PRINT '🆕 Criando novos usuários...';

WITH FuncionariosNovos AS (
    SELECT 
        s.MATRICULA,
        s.NOME,
        s.DEPARTAMENTO,
        s.FILIAL,
        s.CPF,
        s.STATUS_GERAL,
        ROW_NUMBER() OVER (
            PARTITION BY s.CPF 
            ORDER BY s.MATRICULA DESC
        ) as rn
    FROM TAB_HIST_SRA s
    WHERE s.STATUS_GERAL = 'ATIVO'
    AND NOT EXISTS (
        SELECT 1 FROM Users u WHERE u.CPF = s.CPF
    )
)
INSERT INTO Users (
    UserName,
    PasswordHash,
    RoleId,
    nome,
    NomeCompleto,
    Departamento,
    Filial,
    DescricaoDepartamento,
    is_admin,
    created_at,
    updated_at,
    CPF,
    IsActive,
    Matricula,
    FirstLogin,
    HierarchyPath
)
SELECT 
    fa.NOME as UserName,
    NULL as PasswordHash,
    2 as RoleId, -- Role padrão para usuários
    fa.NOME as nome,
    fa.NOME as NomeCompleto,
    fa.DEPARTAMENTO as Departamento,
    fa.FILIAL as Filial,
    COALESCE(
        (SELECT TOP 1 DESCRICAO_ATUAL 
         FROM HIERARQUIA_CC h 
         WHERE TRIM(h.DEPTO_ATUAL) = TRIM(fa.DEPARTAMENTO)
         ORDER BY LEN(HIERARQUIA_COMPLETA) DESC),
        fa.DEPARTAMENTO
    ) as DescricaoDepartamento,
    0 as is_admin,
    GETDATE() as created_at,
    GETDATE() as updated_at,
    fa.CPF,
    1 as IsActive,
    fa.MATRICULA as Matricula,
    1 as FirstLogin, -- Precisa fazer cadastro
    '' as HierarchyPath
FROM FuncionariosNovos fa
WHERE fa.rn = 1;

SET @UsuariosCriados = @@ROWCOUNT;
PRINT '🆕 Usuários CRIADOS: ' + CAST(@UsuariosCriados AS VARCHAR);

-- =====================================================
-- 4. REMOVER USUÁRIOS SEM REGISTRO ATIVO
-- =====================================================

PRINT '🗑️ Removendo usuários sem registro ATIVO...';

-- Primeiro, vamos fazer um backup dos dados antes de excluir
SELECT 
    'BACKUP - Usuário que será removido' as Status,
    u.Id,
    u.NomeCompleto,
    u.CPF,
    u.Matricula,
    u.Departamento,
    u.DescricaoDepartamento,
    u.created_at,
    u.LastLogin,
    u.FirstLogin,
    u.IsActive
INTO #UsuariosRemovidosBackup
FROM Users u
WHERE NOT EXISTS (
    SELECT 1 
    FROM TAB_HIST_SRA s 
    WHERE s.CPF = u.CPF 
    AND s.STATUS_GERAL = 'ATIVO'
);

-- Agora excluir os usuários
DELETE FROM Users
WHERE NOT EXISTS (
    SELECT 1 
    FROM TAB_HIST_SRA s 
    WHERE s.CPF = Users.CPF 
    AND s.STATUS_GERAL = 'ATIVO'
);

SET @UsuariosRemovidos = @@ROWCOUNT;

-- =====================================================
-- 5. RELATÓRIO FINAL
-- =====================================================

PRINT '';
PRINT '📊 ===== RELATÓRIO FINAL =====';
PRINT '📅 Data/Hora: ' + CONVERT(VARCHAR, GETDATE(), 120);
PRINT '';
PRINT '✅ Usuários ATUALIZADOS: ' + CAST(@UsuariosAtualizados AS VARCHAR);
PRINT '🆕 Usuários CRIADOS: ' + CAST(@UsuariosCriados AS VARCHAR);
PRINT '❌ Usuários REMOVIDOS: ' + CAST(@UsuariosRemovidos AS VARCHAR);
PRINT '';

-- Mostrar backup dos usuários removidos
PRINT '📋 BACKUP DOS USUÁRIOS REMOVIDOS:';
SELECT * FROM #UsuariosRemovidosBackup ORDER BY NomeCompleto;

-- Estatísticas finais
PRINT '';
PRINT '📈 ESTATÍSTICAS ATUAIS:';
SELECT 
    COUNT(*) as TotalUsuarios,
    COUNT(CASE WHEN IsActive = 1 THEN 1 END) as UsuariosAtivos,
    COUNT(CASE WHEN FirstLogin = 1 THEN 1 END) as UsuariosPrecisamCadastro,
    COUNT(CASE WHEN LastLogin IS NOT NULL THEN 1 END) as UsuariosJaFizeramLogin
FROM Users;

-- Limpar tabela temporária
DROP TABLE #UsuariosRemovidosBackup;

PRINT '';
PRINT '🎉 Sincronização e limpeza concluída com sucesso!';

-- =====================================================
-- INSTRUÇÕES PARA ROLLBACK (se necessário)
-- =====================================================

PRINT '';
PRINT '⚠️  IMPORTANTE:';
PRINT '   - Se algo deu errado, execute: ROLLBACK TRANSACTION;';
PRINT '   - Se tudo está OK, execute: COMMIT TRANSACTION;';
PRINT '   - Os dados dos usuários removidos estão no relatório acima';
PRINT '';

-- Descomente a linha abaixo para fazer COMMIT automático
-- COMMIT TRANSACTION;

-- Para fazer rollback manual, descomente a linha abaixo
-- ROLLBACK TRANSACTION;
