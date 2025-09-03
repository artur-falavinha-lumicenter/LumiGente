-- ========================================
-- SCRIPT PARA RESETAR USUÁRIO
-- Sistema Feedz - Lumicenter
-- ========================================
-- Este script reseta um usuário como se nunca tivesse usado o sistema
-- SUBSTITUA 'NOME_DO_USUARIO' pelo nome real do usuário

USE LUMICENTER_FEEDBACKS;
GO

-- ========================================
-- CONFIGURAÇÃO - ALTERE AQUI
-- ========================================
DECLARE @NOME_USUARIO VARCHAR(100) = 'EDILSO'; -- ALTERE AQUI
DECLARE @USER_ID INT;

-- Buscar ID do usuário
SELECT @USER_ID = Id FROM Users WHERE nome = @NOME_USUARIO OR NomeCompleto LIKE '%' + @NOME_USUARIO + '%';

IF @USER_ID IS NULL
BEGIN
    PRINT '❌ USUÁRIO NÃO ENCONTRADO: ' + @NOME_USUARIO;
    PRINT 'Usuários disponíveis:';
    SELECT Id, nome, NomeCompleto FROM Users ORDER BY nome;
    RETURN;
END

PRINT '🔄 RESETANDO USUÁRIO: ' + @NOME_USUARIO + ' (ID: ' + CAST(@USER_ID AS VARCHAR) + ')';
PRINT '================================================';

-- ========================================
-- DELETAR DADOS DE ATIVIDADE
-- ========================================

-- Feedbacks enviados
DELETE FROM FeedbackReplies WHERE feedback_id IN (SELECT Id FROM Feedbacks WHERE from_user_id = @USER_ID);
DELETE FROM FeedbackReactions WHERE feedback_id IN (SELECT Id FROM Feedbacks WHERE from_user_id = @USER_ID);
DELETE FROM Feedbacks WHERE from_user_id = @USER_ID;
PRINT '✅ Feedbacks enviados removidos';

-- Feedbacks recebidos
DELETE FROM FeedbackReplies WHERE feedback_id IN (SELECT Id FROM Feedbacks WHERE to_user_id = @USER_ID);
DELETE FROM FeedbackReactions WHERE feedback_id IN (SELECT Id FROM Feedbacks WHERE to_user_id = @USER_ID);
DELETE FROM Feedbacks WHERE to_user_id = @USER_ID;
PRINT '✅ Feedbacks recebidos removidos';

-- Reconhecimentos enviados
DELETE FROM Recognitions WHERE from_user_id = @USER_ID;
PRINT '✅ Reconhecimentos enviados removidos';

-- Reconhecimentos recebidos
DELETE FROM Recognitions WHERE to_user_id = @USER_ID;
PRINT '✅ Reconhecimentos recebidos removidos';

-- Humor diário
DELETE FROM DailyMood WHERE user_id = @USER_ID;
PRINT '✅ Registros de humor removidos';

-- Avaliações
DELETE FROM AvaliacaoRespostas WHERE colaborador_id = @USER_ID;
DELETE FROM AvaliacaoColaboradores WHERE colaborador_id = @USER_ID;
PRINT '✅ Avaliações removidas';

-- Pesquisas
DELETE FROM PesquisaRespostas WHERE user_id = @USER_ID;
PRINT '✅ Respostas de pesquisas removidas';

-- Objetivos
DELETE FROM ObjetivoCheckins WHERE user_id = @USER_ID;
DELETE FROM Objetivos WHERE responsavel_id = @USER_ID;
PRINT '✅ Objetivos removidos';

-- Gamificação
DELETE FROM Gamification WHERE UserId = @USER_ID;
DELETE FROM UserPoints WHERE UserId = @USER_ID;
DELETE FROM UserRankings WHERE UserId = @USER_ID;
PRINT '✅ Dados de gamificação removidos';

-- Notificações
DELETE FROM Notifications WHERE UserId = @USER_ID;
PRINT '✅ Notificações removidas';

-- ========================================
-- RESETAR DADOS DO USUÁRIO
-- ========================================

UPDATE Users 
SET 
    PasswordTemporary = 1,
    LastLogin = NULL,
    updated_at = GETDATE()
WHERE Id = @USER_ID;

PRINT '✅ Usuário resetado - senha marcada como temporária';
PRINT '⚠️ IMPORTANTE: O usuário não conseguirá mais fazer login até fazer novo cadastro';

-- ========================================
-- VERIFICAR RESULTADO
-- ========================================
PRINT '';
PRINT '📋 RESULTADO FINAL:';
SELECT 
    Id,
    nome,
    NomeCompleto,
    CPF,
    IsActive,
    PasswordTemporary,
    LastLogin,
    created_at,
    updated_at
FROM Users 
WHERE Id = @USER_ID;

PRINT '';
PRINT '✅ RESET CONCLUÍDO!';
PRINT 'O usuário ' + @NOME_USUARIO + ' foi resetado como se nunca tivesse usado o sistema.';
PRINT 'O usuário não conseguirá mais fazer login e precisará fazer novo cadastro.';