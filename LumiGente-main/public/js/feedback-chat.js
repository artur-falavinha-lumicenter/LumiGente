// Sistema de Chat para Feedbacks
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
        if (this.isOpen && this.currentFeedbackId === feedbackId) {
            return; // Chat já está aberto para este feedback
        }

        this.currentFeedbackId = feedbackId;
        this.isOpen = true;
        
        await this.createChatModal();
        await this.loadMessages();
        this.scrollToBottom();
    }

    // Criar modal do chat
    async createChatModal() {
        // Remover modal existente se houver
        const existingModal = document.querySelector('.feedback-chat-container');
        if (existingModal) {
            existingModal.remove();
        }

        // Buscar informações do feedback
        const feedbackInfo = await this.getFeedbackInfo(this.currentFeedbackId);
        
        const modal = document.createElement('div');
        modal.className = 'feedback-chat-container';
        modal.innerHTML = `
            <div class="feedback-chat-modal">
                <div class="chat-header">
                    <h3>
                        <i class="fas fa-comments"></i>
                        Chat - ${feedbackInfo.title}
                    </h3>
                    <button class="chat-close-btn" onclick="feedbackChat.closeChat()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="chat-messages" id="chat-messages">
                    <div class="chat-loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        Carregando mensagens...
                    </div>
                </div>
                
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
            </div>
        `;

        document.body.appendChild(modal);
        this.setupChatEventListeners();
    }

    // Buscar informações do feedback
    async getFeedbackInfo(feedbackId) {
        try {
            const response = await fetch(`/api/feedbacks/${feedbackId}/info`);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Erro ao buscar info do feedback:', error);
        }
        
        return { title: 'Feedback' }; // Fallback
    }

    // Configurar event listeners do chat
    setupChatEventListeners() {
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');

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
        
        // Adicionar event listeners para botões de responder
        container.querySelectorAll('.reply-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const messageId = parseInt(btn.dataset.messageId);
                const userName = btn.dataset.userName;
                const messageText = btn.dataset.messageText;
                this.replyToMessage(messageId, userName, messageText);
            });
        });
        
        this.scrollToBottom();
    }

    // Renderizar uma mensagem individual
    renderMessage(message) {
        const isOwn = message.user_id === currentUser.userId;
        const messageTime = new Date(message.created_at).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let replyHtml = '';
        if (message.reply_to_message && message.reply_to_user) {
            const shortMessage = message.reply_to_message.length > 100 ? 
                message.reply_to_message.substring(0, 100) + '...' : 
                message.reply_to_message;
            replyHtml = `
                <div class="reply-indicator">
                    <i class="fas fa-reply"></i>
                    <strong>${message.reply_to_user}:</strong> ${shortMessage}
                </div>
            `;
        }



        return `
            <div class="chat-message ${isOwn ? 'own' : 'other'}" data-message-id="${message.Id}">
                ${replyHtml}
                <div class="message-bubble">
                    ${this.formatMessageText(message.message)}
                </div>
                <div class="message-info">
                    <span class="message-time">${messageTime}</span>
                    <div class="message-actions">
                        <button class="message-action-btn reply-btn" data-message-id="${message.Id}" data-user-name="${message.user_name}" data-message-text="${message.message}">
                            <i class="fas fa-reply"></i>
                            Responder
                        </button>
                    </div>
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
            
            const response = await fetch(`/api/feedbacks/${this.currentFeedbackId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                input.value = '';
                input.style.height = 'auto';
                this.cancelReply();
                await this.loadMessages();
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
        this.currentReplyTo = null;
        document.getElementById('reply-preview').classList.remove('show');
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
        const modal = document.querySelector('.feedback-chat-container');
        if (modal) {
            modal.remove();
        }
        
        this.isOpen = false;
        this.currentFeedbackId = null;
        this.currentReplyTo = null;
        this.messages = [];
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
}

// Instância global do chat
const feedbackChat = new FeedbackChat();

// Função global para abrir chat (chamada pelos botões de responder)
window.toggleFeedbackChat = function(feedbackId) {
    feedbackChat.openChat(feedbackId);
};

// Exportar para uso em outros arquivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FeedbackChat;
}