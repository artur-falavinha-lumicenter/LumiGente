// Sistema de Chat para Feedbacks
if (typeof FeedbackChat === 'undefined') {
class FeedbackChat {
    constructor() {
        this.currentFeedbackId = null;
        this.currentReplyTo = null;
        this.messages = [];
        this.isOpen = false;
        this.emojiPicker = null;
        this.reactionPicker = null;
        this.init();
    }

    init() {
        this.createEmojiPicker();
        this.setupEventListeners();
    }

    // Abrir chat para um feedback específico
    async openChat(feedbackId) {
        try {
            console.log('🎯 FeedbackChat.openChat chamado com ID:', feedbackId);
            console.log('🎯 Estado atual - isOpen:', this.isOpen, 'currentFeedbackId:', this.currentFeedbackId);
            
            // Verificar se já existe um modal aberto
            const existingModal = document.querySelector('.feedback-chat-container');
            if (existingModal) {
                console.log('🎯 Modal existente encontrado, removendo...');
                existingModal.remove();
            }
            
            if (this.isOpen && this.currentFeedbackId === feedbackId) {
                console.log('🎯 Chat já está aberto para este feedback');
                return; // Chat já está aberto para este feedback
            }

            // Resetar estado
            this.currentFeedbackId = feedbackId;
            this.isOpen = true;
            this.currentReplyTo = null;
            
            console.log('🎯 Criando modal do chat...');
            await this.createChatModal();
            console.log('🎯 Carregando mensagens...');
            await this.loadMessages();
            console.log('🎯 Fazendo scroll para o final...');
            this.scrollToBottom();
            console.log('🎯 Chat aberto com sucesso');
        } catch (error) {
            console.error('❌ Erro ao abrir chat:', error);
            this.isOpen = false;
            this.currentFeedbackId = null;
        }
    }

    // Criar modal do chat
    async createChatModal() {
        try {
            console.log('🎯 Criando modal do chat...');
            
            // Remover modal existente se houver
            const existingModal = document.querySelector('.feedback-chat-container');
            if (existingModal) {
                console.log('🎯 Removendo modal existente');
                existingModal.remove();
            }

            // Buscar informações do feedback
            const feedbackInfo = await this.getFeedbackInfo(this.currentFeedbackId);
            this.feedbackInfo = feedbackInfo; // Armazenar para usar na renderização
            
            console.log('Criando elemento modal...');
            const modal = document.createElement('div');
            modal.className = 'feedback-chat-container';
            
            // Verificar se está em modo gestor (somente leitura)
            const isManagerMode = this.isManagerMode || false;
            const inputSection = isManagerMode ? `
                <div class="chat-input-container manager-mode">
                    <div class="manager-notice">
                        <i class="fas fa-eye"></i>
                        <span>Modo visualização - Você pode apenas visualizar as mensagens</span>
                    </div>
                </div>
            ` : `
                <div class="chat-input-container">
                    <div class="reply-preview" id="reply-preview">
                        <div class="reply-preview-text">Respondendo para:</div>
                        <div class="reply-preview-message" id="reply-preview-message"></div>
                        <button class="reply-cancel-btn" onclick="feedbackChat.cancelReply()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="chat-input-wrapper">
                        <textarea 
                            class="chat-input" 
                            id="chat-input" 
                            placeholder="Digite sua mensagem..."
                            rows="1"
                        ></textarea>
                        
                        <div class="chat-input-actions">
                            <button class="emoji-btn" onclick="feedbackChat.toggleEmojiPicker()">
                                <i class="fas fa-smile"></i>
                            </button>
                            <button class="send-btn" id="send-btn" disabled>
                                <i class="fas fa-paper-plane"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            
            modal.innerHTML = `
            <div class="feedback-chat-modal">
                <div class="chat-header">
                    <h3>
                        <i class="fas fa-comments"></i>
                        Chat - ${feedbackInfo.title}
                        ${isManagerMode ? '<span class="manager-badge">Modo Gestor</span>' : ''}
                    </h3>
                    <div class="chat-header-actions">
                        <button class="chat-close-btn" onclick="feedbackChat.closeChat()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                
                <div class="chat-messages" id="chat-messages">
                    <div class="chat-loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        Carregando mensagens...
                    </div>
                </div>
                
                ${inputSection}
            </div>
        `;

            console.log('🎯 Adicionando modal ao DOM...');
            document.body.appendChild(modal);
            console.log('🎯 Modal adicionado ao DOM');
            
            // Verificar se o modal foi realmente adicionado
            const addedModal = document.querySelector('.feedback-chat-container');
            if (addedModal) {
                console.log('🎯 Modal confirmado no DOM:', addedModal);
            } else {
                console.error('❌ Modal não foi encontrado no DOM após adicionar');
            }
            
            console.log('🎯 Configurando event listeners...');
            this.setupChatEventListeners();
            console.log('🎯 Modal do chat criado com sucesso');
        } catch (error) {
            console.error('Erro ao criar modal do chat:', error);
            throw error;
        }
    }

    // Buscar informações do feedback
    async getFeedbackInfo(feedbackId) {
        try {
            console.log('Buscando informações do feedback:', feedbackId);
            const response = await fetch(`/api/feedbacks/${feedbackId}/info`);
            if (response.ok) {
                const info = await response.json();
                console.log('Informações do feedback obtidas:', info);
                return info;
            } else {
                console.error('Erro na resposta da API:', response.status, response.statusText);
                const errorText = await response.text();
                console.error('Detalhes do erro:', errorText);
            }
        } catch (error) {
            console.error('Erro ao buscar info do feedback:', error);
        }
        
        console.log('Usando fallback para informações do feedback');
        return { title: `Feedback #${feedbackId}` }; // Fallback mais informativo
    }

    // Configurar event listeners do chat
    setupChatEventListeners() {
        try {
            console.log('Configurando event listeners do chat...');
            
            // Se estiver em modo gestor, não configurar eventos de envio
            if (this.isManagerMode) {
                console.log('Modo gestor ativado - eventos de envio desabilitados');
                return;
            }
            
            const chatInput = document.getElementById('chat-input');
            const sendBtn = document.getElementById('send-btn');
            
            if (!chatInput) {
                console.error('Elemento chat-input não encontrado');
                return;
            }
            
            if (!sendBtn) {
                console.error('Elemento send-btn não encontrado');
                return;
            }
            
            console.log('Event listeners configurados com sucesso');

        // Auto-resize do textarea
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
            
            // Habilitar/desabilitar botão enviar
            sendBtn.disabled = !chatInput.value.trim();
        });

        // Evento de clique no botão enviar
        sendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (chatInput.value.trim() && this.currentFeedbackId) {
                this.sendMessage();
            }
        });

        // Enviar com Enter (Shift+Enter para nova linha)
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (chatInput.value.trim() && this.currentFeedbackId) {
                    this.sendMessage();
                }
            }
        });

            // Fechar modal clicando fora
            document.querySelector('.feedback-chat-container').addEventListener('click', (e) => {
                if (e.target.classList.contains('feedback-chat-container')) {
                    this.closeChat();
                }
            });
        } catch (error) {
            console.error('Erro ao configurar event listeners:', error);
        }
    }

    // Carregar mensagens do chat
    async loadMessages() {
        try {
            // Primeiro, tentar criar as tabelas se necessário
            await fetch('/api/chat/setup-tables', {
                method: 'POST',
                credentials: 'include'
            });
            
            const response = await fetch(`/api/feedbacks/${this.currentFeedbackId}/messages`);
            if (response.ok) {
                this.messages = await response.json();
                this.renderMessages();
            } else {
                const errorData = await response.json();
                console.error('Erro na resposta:', errorData);
                this.showEmptyState();
            }
        } catch (error) {
            console.error('Erro ao carregar mensagens:', error);
            this.showEmptyState();
        }
    }

    // Renderizar mensagens
    renderMessages() {
        const container = document.getElementById('chat-messages');
        
        if (this.messages.length === 0) {
            this.showEmptyState();
            return;
        }

        container.innerHTML = this.messages.map(message => this.renderMessage(message)).join('');
        
        // Adicionar event listeners para botões de responder (apenas se não estiver no modo gestor)
        if (!this.isManagerMode) {
            container.querySelectorAll('.reply-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const messageId = parseInt(btn.dataset.messageId);
                    const userName = btn.dataset.userName;
                    const messageText = btn.dataset.messageText;
                    this.replyToMessage(messageId, userName, messageText);
                });
            });
        }
        
        this.scrollToBottom();
    }

    // Renderizar uma mensagem individual
    renderMessage(message) {
        // No modo gestor, usar informações do feedback para identificar o remetente
        let isOwn = false;
        let senderName = message.user_name || 'Usuário';
        
        if (this.isManagerMode && this.feedbackInfo) {
            // No modo gestor, comparar com os participantes do feedback
            isOwn = message.user_name === this.feedbackInfo.from;
            senderName = message.user_name;
        } else {
            // Modo normal - comparar com usuário atual
            isOwn = message.user_id === currentUser.userId;
        }
        
        // Ajustar fuso horário: adicionar 3 horas para GMT-3 (Brasil)
        const messageDate = new Date(message.created_at);
        messageDate.setHours(messageDate.getHours() + 3);
        
        const messageTime = messageDate.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let replyHtml = '';
        if (message.reply_to_message && message.reply_to_user) {
            console.log('🎯 Renderizando referência de resposta:', {
                reply_to_message: message.reply_to_message,
                reply_to_user: message.reply_to_user
            });
            
            const shortMessage = message.reply_to_message.length > 100 ? 
                message.reply_to_message.substring(0, 100) + '...' : 
                message.reply_to_message;
            replyHtml = `
                <div class="reply-indicator">
                    <i class="fas fa-reply"></i>
                    <strong>${message.reply_to_user}:</strong> ${shortMessage}
                </div>
            `;
        } else {
            console.log('🎯 Mensagem sem referência de resposta:', {
                reply_to_message: message.reply_to_message,
                reply_to_user: message.reply_to_user,
                message_id: message.Id
            });
        }



        return `
            <div class="chat-message ${isOwn ? 'own' : 'other'}" data-message-id="${message.Id}">
                ${replyHtml}
                <div class="message-bubble">
                    ${this.formatMessageText(message.message)}
                </div>
                <div class="message-info">
                    <div class="message-header">
                        <span class="message-sender">${senderName}</span>
                    <span class="message-time">${messageTime}</span>
                    </div>
                    ${!this.isManagerMode ? `
                        <div class="message-actions">
                            <button class="message-action-btn reply-btn" data-message-id="${message.Id}" data-user-name="${message.user_name}" data-message-text="${message.message}">
                                <i class="fas fa-reply"></i>
                                Responder
                            </button>
                        </div>
                    ` : ''}
                </div>

            </div>
        `;
    }

    // Agrupar reações por emoji
    groupReactions(reactions) {
        const groups = {};
        reactions.forEach(reaction => {
            if (!groups[reaction.emoji]) {
                groups[reaction.emoji] = [];
            }
            groups[reaction.emoji].push(reaction.user_id);
        });
        return groups;
    }

    // Formatar texto da mensagem (emojis, links, etc.)
    formatMessageText(text) {
        // Converter quebras de linha
        text = text.replace(/\n/g, '<br>');
        
        // Converter URLs em links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        text = text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener">$1</a>');
        
        return text;
    }

    // Mostrar estado vazio
    showEmptyState() {
        const container = document.getElementById('chat-messages');
        container.innerHTML = `
            <div class="chat-empty">
                <i class="fas fa-comments"></i>
                <p>Nenhuma mensagem ainda.</p>
                <p>Seja o primeiro a comentar!</p>
            </div>
        `;
    }

    // Enviar mensagem
    async sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        console.log('🚀 Iniciando envio - currentReplyTo:', this.currentReplyTo);
        
        if (!message || !this.currentFeedbackId) {
            console.error('Mensagem vazia ou feedbackId inválido:', { message, feedbackId: this.currentFeedbackId });
            return;
        }

        const sendBtn = document.querySelector('.send-btn');
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const payload = {
                message,
                reply_to: this.currentReplyTo
            };
            
            console.log('📤 Payload sendo enviado:', payload);
            console.log('📤 currentReplyTo:', this.currentReplyTo);
            console.log('📤 Tipo de reply_to:', typeof this.currentReplyTo);
            
            const response = await fetch(`/api/feedbacks/${this.currentFeedbackId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                
                input.value = '';
                input.style.height = 'auto';
                this.currentReplyTo = null; // Limpar apenas o estado, não chamar cancelReply()
                document.getElementById('reply-preview').classList.remove('show'); // Esconder preview
                await this.loadMessages();
                // Atualizar contagem de mensagens no feedback principal
                this.updateFeedbackMessageCount(result.pointsEarned);
                
                // Atualizar pontos do usuário se ganhou pontos com a resposta
                console.log('🎯 Resultado da resposta:', result);
                if (result.pointsEarned > 0) {
                    console.log(`🎉 Usuário ganhou ${result.pointsEarned} pontos!`);
                    // Atualizar dados de gamificação
                    await this.updateUserPoints(result.pointsEarned);
                    
                    // Mostrar notificação de pontos ganhos
                    this.showPointsNotification(result.pointsEarned);
                } else {
                    console.log('ℹ️ Nenhum ponto ganho com esta resposta');
                    // Não mostrar notificação quando não ganha pontos
                }
            } else {
                const error = await response.json();
                console.error('Erro na resposta:', error);
                alert(error.error || 'Erro ao enviar mensagem');
            }
        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);
            alert('Erro ao enviar mensagem');
        } finally {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }
    }

    // Responder a uma mensagem
    replyToMessage(messageId, userName, messageText) {
        console.log('🔄 Definindo reply_to:', messageId);
        this.currentReplyTo = messageId;
        
        const replyPreview = document.getElementById('reply-preview');
        const replyMessage = document.getElementById('reply-preview-message');
        
        replyMessage.innerHTML = `<strong>${userName}:</strong> ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`;
        replyPreview.classList.add('show');
        
        document.getElementById('chat-input').focus();
        
        console.log('✅ currentReplyTo definido como:', this.currentReplyTo);
    }

    // Cancelar resposta
    cancelReply() {
        console.log('🔄 Cancelando resposta, currentReplyTo era:', this.currentReplyTo);
        this.currentReplyTo = null;
        document.getElementById('reply-preview').classList.remove('show');
        console.log('✅ Resposta cancelada, currentReplyTo agora é:', this.currentReplyTo);
    }

    // Mostrar picker de reações
    showReactionPicker(event, messageId) {
        event.stopPropagation();
        
        // Remover picker existente
        const existingPicker = document.querySelector('.reaction-picker');
        if (existingPicker) {
            existingPicker.remove();
        }

        const picker = document.createElement('div');
        picker.className = 'reaction-picker show';
        picker.innerHTML = `
            <div class="reaction-option" onclick="feedbackChat.addReaction(${messageId}, '👍')">👍</div>
            <div class="reaction-option" onclick="feedbackChat.addReaction(${messageId}, '❤️')">❤️</div>
            <div class="reaction-option" onclick="feedbackChat.addReaction(${messageId}, '😊')">😊</div>
            <div class="reaction-option" onclick="feedbackChat.addReaction(${messageId}, '👏')">👏</div>
            <div class="reaction-option" onclick="feedbackChat.addReaction(${messageId}, '🎉')">🎉</div>
            <div class="reaction-option" onclick="feedbackChat.addReaction(${messageId}, '💡')">💡</div>
        `;

        // Posicionar picker
        const rect = event.target.getBoundingClientRect();
        picker.style.position = 'fixed';
        picker.style.top = (rect.top - 50) + 'px';
        picker.style.left = rect.left + 'px';

        document.body.appendChild(picker);

        // Remover picker ao clicar fora
        setTimeout(() => {
            document.addEventListener('click', function removePicker() {
                picker.remove();
                document.removeEventListener('click', removePicker);
            });
        }, 100);
    }

    // Adicionar reação
    async addReaction(messageId, emoji) {
        try {
            const response = await fetch(`/api/feedbacks/messages/${messageId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ emoji })
            });

            if (response.ok) {
                await this.loadMessages();
            }
        } catch (error) {
            console.error('Erro ao adicionar reação:', error);
        }

        // Remover picker
        const picker = document.querySelector('.reaction-picker');
        if (picker) picker.remove();
    }

    // Toggle reação existente
    async toggleReaction(messageId, emoji) {
        try {
            const response = await fetch(`/api/feedbacks/messages/${messageId}/react`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ emoji })
            });

            if (response.ok) {
                await this.loadMessages();
            }
        } catch (error) {
            console.error('Erro ao toggle reação:', error);
        }
    }

    // Criar picker de emojis
    createEmojiPicker() {
        const emojis = [
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
            '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
            '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜',
            '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏',
            '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙',
            '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️',
            '🖖', '👋', '🤏', '💪', '🦾', '🖕', '✍️', '🙏',
            '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
            '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
            '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️',
            '🎉', '🎊', '🎈', '🎁', '🎀', '🎂', '🍰', '🧁',
            '🔥', '💯', '💫', '⭐', '🌟', '✨', '⚡', '💥'
        ];

        this.emojiList = emojis;
    }

    // Toggle picker de emojis
    toggleEmojiPicker() {
        const existingPicker = document.querySelector('.emoji-picker');
        
        if (existingPicker) {
            existingPicker.remove();
            return;
        }

        const picker = document.createElement('div');
        picker.className = 'emoji-picker show';
        picker.innerHTML = `
            <div class="emoji-picker-header">Escolha um emoji</div>
            <div class="emoji-grid">
                ${this.emojiList.map(emoji => `
                    <div class="emoji-item" onclick="feedbackChat.insertEmoji('${emoji}')">${emoji}</div>
                `).join('')}
            </div>
        `;

        document.querySelector('.chat-input-container').appendChild(picker);

        // Fechar ao clicar fora
        setTimeout(() => {
            document.addEventListener('click', function closePicker(e) {
                if (!e.target.closest('.emoji-picker') && !e.target.closest('.emoji-btn')) {
                    picker.remove();
                    document.removeEventListener('click', closePicker);
                }
            });
        }, 100);
    }

    // Inserir emoji no input
    insertEmoji(emoji) {
        const input = document.getElementById('chat-input');
        const cursorPos = input.selectionStart;
        const textBefore = input.value.substring(0, cursorPos);
        const textAfter = input.value.substring(cursorPos);
        
        input.value = textBefore + emoji + textAfter;
        input.focus();
        input.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
        
        // Trigger input event para atualizar botão
        input.dispatchEvent(new Event('input'));
        
        // Fechar picker
        const picker = document.querySelector('.emoji-picker');
        if (picker) picker.remove();
    }

    // Scroll para o final
    scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    // Fechar chat
    closeChat() {
        console.log('🎯 Fechando chat...');
        
        const modal = document.querySelector('.feedback-chat-container');
        if (modal) {
            console.log('🎯 Removendo modal do DOM');
            modal.remove();
        }
        
        // Limpar estado completamente
        this.isOpen = false;
        this.currentFeedbackId = null;
        this.currentReplyTo = null;
        this.messages = [];
        this.isManagerMode = false; // Resetar modo gestor
        
        // Limpar emoji picker se existir
        if (this.emojiPicker) {
            this.emojiPicker.remove();
            this.emojiPicker = null;
        }
        
        // Limpar reaction picker se existir
        if (this.reactionPicker) {
            this.reactionPicker.remove();
            this.reactionPicker = null;
        }
        
        console.log('🎯 Chat fechado e estado limpo');
    }

    // Event listeners globais
    setupEventListeners() {
        // Fechar com ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeChat();
            }
        });
    }

    // Atualizar contagem de mensagens no feedback principal
    updateFeedbackMessageCount(pointsEarned = 0) {
        if (this.currentFeedbackId) {
            // Buscar o card do feedback atual
            const feedbackItem = document.querySelector(`[data-feedback-id="${this.currentFeedbackId}"]`);
            if (feedbackItem) {
                // Atualizar contador de respostas
                const replyButton = feedbackItem.querySelector('.status-respostas .counter');
                if (replyButton) {
                    // Incrementar contador
                    const currentCount = parseInt(replyButton.textContent) || 0;
                    replyButton.textContent = currentCount + 1;
                    
                    // Adicionar classe de atividade se não existir
                    const replyButtonContainer = feedbackItem.querySelector('.status-respostas');
                    if (replyButtonContainer) {
                        replyButtonContainer.classList.add('has-activity');
                    }
                }
                
                // Atualizar status dos pontos apenas se ganhou pontos
                if (pointsEarned > 0) {
                    console.log(`🎯 Ganhou ${pointsEarned} pontos - atualizando status do card`);
                    // Tentar atualização imediata
                    this.updateFeedbackPointsStatus(feedbackItem);
                    
                    // Múltiplos delays para garantir que o DOM foi atualizado
                    setTimeout(() => {
                        this.updateFeedbackPointsStatus(feedbackItem);
                    }, 100);
                    
                    // Backup com delay maior
                    setTimeout(() => {
                        this.updateFeedbackPointsStatusAlternative();
                    }, 500);
                    
                    // Último recurso com delay ainda maior
                    setTimeout(() => {
                        this.forceUpdateFeedbackPoints();
                    }, 1000);
                    
                    // Verificação final para garantir que foi atualizado
                    setTimeout(() => {
                        this.verifyPointsUpdate();
                    }, 1500);
                } else {
                    console.log('ℹ️ Nenhum ponto ganho - não atualizando status do card');
                }
            }
        }
    }

    // Atualizar status dos pontos no card do feedback
    updateFeedbackPointsStatus(feedbackItem) {
        // Verificar se estamos na aba de feedbacks recebidos
        // (onde o usuário pode ganhar pontos respondendo)
        const isReceivedTab = window.currentFeedbackTab === 'received';
        
        if (!isReceivedTab) {
            console.log('ℹ️ Não é uma aba de feedbacks recebidos, não atualizando status de pontos');
            return;
        }
        
        console.log('🎯 Iniciando atualização do status de pontos...');
        console.log('🎯 Feedback ID:', this.currentFeedbackId);
        console.log('🎯 feedbackItem recebido:', feedbackItem);
        
        // Buscar o elemento de pontos de diferentes formas para garantir que encontre
        let pointsElement = this.findPointsElement(feedbackItem);
        
        if (pointsElement) {
            console.log('🎯 Elemento de pontos encontrado:', pointsElement);
            console.log('🎯 Texto atual:', pointsElement.textContent);
            
            // Verificar se o elemento ainda mostra "Sem pontos"
            if (pointsElement.textContent.includes('Sem pontos')) {
                // Atualizar para mostrar que ganhou pontos
                pointsElement.textContent = '+10 pontos';
                pointsElement.classList.add('earned');
                
                // Adicionar animação de destaque
                pointsElement.style.animation = 'pointsUpdate 0.5s ease-in-out';
                setTimeout(() => {
                    pointsElement.style.animation = '';
                }, 500);
                
                console.log('✅ Status de pontos atualizado no card do feedback: Sem pontos → +10 pontos');
            } else {
                console.log('ℹ️ Status de pontos já estava correto no card do feedback');
            }
        } else {
            console.log('⚠️ Elemento de pontos não encontrado no card do feedback');
            // Tentar uma abordagem alternativa - buscar diretamente pelo ID
            this.updateFeedbackPointsStatusAlternative();
        }
    }

    // Método alternativo para atualizar status de pontos
    updateFeedbackPointsStatusAlternative() {
        console.log('🔄 Tentando método alternativo para atualizar pontos...');
        
        // Buscar diretamente pelo ID do feedback
        const feedbackElement = document.querySelector(`[data-feedback-id="${this.currentFeedbackId}"]`);
        if (feedbackElement) {
            console.log('🔄 Elemento do feedback encontrado:', feedbackElement);
            
            const pointsElement = feedbackElement.querySelector('.points-info');
            if (pointsElement) {
                console.log('🔄 Elemento de pontos encontrado (método alternativo):', pointsElement);
                console.log('🔄 Texto atual:', pointsElement.textContent);
                
                if (pointsElement.textContent.includes('Sem pontos')) {
                    pointsElement.textContent = '+10 pontos';
                    pointsElement.classList.add('earned');
                    
                    // Adicionar animação de destaque
                    pointsElement.style.animation = 'pointsUpdate 0.5s ease-in-out';
                    setTimeout(() => {
                        pointsElement.style.animation = '';
                    }, 500);
                    
                    console.log('✅ Status de pontos atualizado (método alternativo): Sem pontos → +10 pontos');
                } else {
                    console.log('ℹ️ Status de pontos já estava correto (método alternativo)');
                }
            } else {
                console.log('❌ Elemento de pontos não encontrado (método alternativo)');
            }
        } else {
            console.log('❌ Elemento do feedback não encontrado (método alternativo)');
        }
    }

    // Função auxiliar para encontrar o elemento de pontos
    findPointsElement(feedbackItem) {
        console.log('🔍 Buscando elemento de pontos para feedback:', this.currentFeedbackId);
        console.log('🔍 feedbackItem:', feedbackItem);
        
        // Tentar diferentes seletores para encontrar o elemento de pontos
        const selectors = [
            '.points-info',
            '.feedback-points .points-info',
            '.feedback-points span',
            '[class*="points"]'
        ];
        
        for (const selector of selectors) {
            console.log(`🔍 Tentando seletor: ${selector}`);
            let element = feedbackItem.querySelector(selector);
            
            // Se não encontrou, tentar buscar no elemento pai (feedback-item)
            if (!element) {
                const feedbackItemParent = feedbackItem.closest('.feedback-item');
                if (feedbackItemParent) {
                    console.log('🔍 Buscando no elemento pai:', feedbackItemParent);
                    element = feedbackItemParent.querySelector(selector);
                }
            }
            
            console.log(`🔍 Elemento encontrado com seletor ${selector}:`, element);
            
            // Se encontrou um elemento que contém texto relacionado a pontos
            if (element && (element.textContent.includes('pontos') || element.textContent.includes('Sem pontos'))) {
                console.log('✅ Elemento de pontos encontrado:', element, 'Texto:', element.textContent);
                return element;
            }
        }
        
        // Se não encontrou com os seletores, tentar buscar por ID do feedback
        console.log('🔍 Tentando busca por ID do feedback...');
        const feedbackElement = document.querySelector(`[data-feedback-id="${this.currentFeedbackId}"]`);
        if (feedbackElement) {
            console.log('🔍 Elemento do feedback encontrado por ID:', feedbackElement);
            const pointsElement = feedbackElement.querySelector('.points-info');
            if (pointsElement) {
                console.log('✅ Elemento de pontos encontrado por ID:', pointsElement, 'Texto:', pointsElement.textContent);
                return pointsElement;
            }
        }
        
        console.log('❌ Elemento de pontos não encontrado');
        return null;
    }

    // Último recurso para forçar atualização dos pontos
    forceUpdateFeedbackPoints() {
        console.log('🚀 Forçando atualização dos pontos (último recurso)...');
        
        // Buscar todos os elementos de pontos na página
        const allPointsElements = document.querySelectorAll('.points-info');
        console.log('🚀 Todos os elementos de pontos encontrados:', allPointsElements.length);
        
        // Procurar especificamente pelo feedback atual
        const feedbackElement = document.querySelector(`[data-feedback-id="${this.currentFeedbackId}"]`);
        if (feedbackElement) {
            console.log('🚀 Elemento do feedback encontrado (forçado):', feedbackElement);
            
            const pointsElement = feedbackElement.querySelector('.points-info');
            if (pointsElement) {
                console.log('🚀 Elemento de pontos encontrado (forçado):', pointsElement);
                console.log('🚀 Texto atual:', pointsElement.textContent);
                
                if (pointsElement.textContent.includes('Sem pontos')) {
                    pointsElement.textContent = '+10 pontos';
                    pointsElement.classList.add('earned');
                    
                    // Adicionar animação de destaque
                    pointsElement.style.animation = 'pointsUpdate 0.5s ease-in-out';
                    setTimeout(() => {
                        pointsElement.style.animation = '';
                    }, 500);
                    
                    console.log('✅ Status de pontos atualizado (forçado): Sem pontos → +10 pontos');
                } else {
                    console.log('ℹ️ Status de pontos já estava correto (forçado)');
                }
            } else {
                console.log('❌ Elemento de pontos não encontrado (forçado)');
            }
        } else {
            console.log('❌ Elemento do feedback não encontrado (forçado)');
        }
    }

    // Verificar se a atualização dos pontos foi bem-sucedida
    verifyPointsUpdate() {
        console.log('🔍 Verificando se a atualização dos pontos foi bem-sucedida...');
        
        const feedbackElement = document.querySelector(`[data-feedback-id="${this.currentFeedbackId}"]`);
        if (feedbackElement) {
            const pointsElement = feedbackElement.querySelector('.points-info');
            if (pointsElement) {
                console.log('🔍 Status atual dos pontos:', pointsElement.textContent);
                
                if (pointsElement.textContent.includes('Sem pontos')) {
                    console.log('⚠️ A atualização não foi bem-sucedida, tentando novamente...');
                    // Tentar uma última vez
                    pointsElement.textContent = '+10 pontos';
                    pointsElement.classList.add('earned');
                    pointsElement.style.animation = 'pointsUpdate 0.5s ease-in-out';
                    setTimeout(() => {
                        pointsElement.style.animation = '';
                    }, 500);
                    console.log('✅ Atualização forçada realizada');
                } else {
                    console.log('✅ Atualização dos pontos foi bem-sucedida');
                }
            }
        }
    }

    // Atualizar pontos do usuário após ganhar pontos
    async updateUserPoints(pointsEarned) {
        try {
            // Atualizar dados de gamificação
            if (typeof window.loadGamificationData === 'function') {
                await window.loadGamificationData();
            } else if (typeof loadGamificationData === 'function') {
                await loadGamificationData();
            }
            
            // Atualizar métricas do dashboard
            if (typeof window.loadMetrics === 'function') {
                await window.loadMetrics();
            } else if (typeof loadMetrics === 'function') {
                await loadMetrics();
            }
            
            // Atualizar contador de pontos no header se existir
            const pointsElement = document.getElementById('user-points');
            if (pointsElement) {
                const currentPoints = parseInt(pointsElement.textContent) || 0;
                pointsElement.textContent = currentPoints + pointsEarned;
                
                // Adicionar animação de destaque
                pointsElement.style.animation = 'pointsUpdate 0.5s ease-in-out';
                setTimeout(() => {
                    pointsElement.style.animation = '';
                }, 500);
            }
            
            console.log(`✅ Pontos atualizados: +${pointsEarned} pontos`);
        } catch (error) {
            console.error('Erro ao atualizar pontos:', error);
        }
    }

    // Mostrar notificação de pontos ganhos
    showPointsNotification(pointsEarned) {
        // Remover notificação existente se houver
        const existingNotification = document.querySelector('.points-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Criar notificação
        const notification = document.createElement('div');
        notification.className = 'points-notification show';
        notification.innerHTML = `
            <div class="points-notification-content">
                <div class="points-notification-icon">
                    <i class="fas fa-star"></i>
                </div>
                <div class="points-notification-text">
                    <div class="points-notification-title">Pontos Ganhos!</div>
                    <div class="points-notification-message">+${pointsEarned} pontos por responder ao feedback</div>
                </div>
                <button class="points-notification-close" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        // Adicionar ao body
        document.body.appendChild(notification);

        // Auto-remover após 5 segundos
        setTimeout(() => {
            if (notification && notification.parentElement) {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification && notification.parentElement) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 5000);
    }

    // Mostrar notificação informativa
    showInfoNotification(message) {
        // Remover notificação existente se houver
        const existingNotification = document.querySelector('.generic-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = 'generic-notification show';
        notification.innerHTML = `
            <div class="generic-notification-content">
                <i class="fas fa-info-circle"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(notification);

        // Remover após 4 segundos
        setTimeout(() => {
            if (notification.parentNode) {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.remove();
                    }
                }, 300);
            }
        }, 4000);
    }
}

    // Exportar para uso em outros arquivos
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FeedbackChat;
    }

    // Expor globalmente
    window.FeedbackChat = FeedbackChat;
} // Fechar o bloco if (typeof FeedbackChat === 'undefined')

// Instância global do chat
const feedbackChat = new FeedbackChat();
window.feedbackChat = feedbackChat;

// Função global para abrir chat (chamada pelos botões de responder)
window.toggleFeedbackChat = function(feedbackId) {
    console.log('🎯 toggleFeedbackChat chamado com ID:', feedbackId);
    console.log('🎯 window.feedbackChat existe?', !!window.feedbackChat);
    
    if (window.feedbackChat) {
        console.log('🎯 Chamando openChat...');
        window.feedbackChat.openChat(feedbackId);
    } else {
        console.error('❌ Sistema de chat não carregado');
        console.log('🎯 Tentando inicializar FeedbackChat...');
        
        if (typeof FeedbackChat !== 'undefined') {
            window.feedbackChat = new FeedbackChat();
            console.log('🎯 FeedbackChat inicializado:', window.feedbackChat);
            window.feedbackChat.openChat(feedbackId);
        } else {
            console.error('❌ Classe FeedbackChat não está disponível');
        }
    }
};