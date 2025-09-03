document.addEventListener('DOMContentLoaded', () => {
    // Limpar flags de logout se existirem
    sessionStorage.removeItem('logoutByButton');
    sessionStorage.removeItem('sessionInvalidated');
});



let isLoginForm = true;

// Função para alternar visibilidade da senha
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(inputId + 'Icon');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Função para formatar CPF
function formatarCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    cpf = cpf.replace(/(\d{3})(\d)/, '$1.$2');
    cpf = cpf.replace(/(\d{3})(\d)/, '$1.$2');
    cpf = cpf.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return cpf;
}

// Função para validar CPF
function validarCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');

    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let soma = 0;
    for (let i = 0; i < 9; i++) {
        soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let resto = soma % 11;
    let dv1 = resto < 2 ? 0 : 11 - resto;

    soma = 0;
    for (let i = 0; i < 10; i++) {
        soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    resto = soma % 11;
    let dv2 = resto < 2 ? 0 : 11 - resto;

    return parseInt(cpf.charAt(9)) === dv1 && parseInt(cpf.charAt(10)) === dv2;
}

// Aplicar formatação nos campos CPF
document.getElementById('loginCpf').addEventListener('input', function (e) {
    e.target.value = formatarCPF(e.target.value);
});

document.getElementById('registerCpf').addEventListener('input', function (e) {
    e.target.value = formatarCPF(e.target.value);
});

// Toggle entre formulários
document.getElementById('toggleForm').addEventListener('click', function () {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const toggleButton = document.getElementById('toggleForm');
    const toggleText = document.getElementById('toggleText');

    if (isLoginForm) {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        toggleButton.innerHTML = '<i class="fas fa-sign-in-alt"></i> Já tenho conta';
        toggleText.textContent = 'Já possui conta?';
        isLoginForm = false;
    } else {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        toggleButton.innerHTML = '<i class="fas fa-user-plus"></i> Criar conta';
        toggleText.textContent = 'Primeiro acesso?';
        isLoginForm = true;
    }

    hideMessages();
    document.getElementById('userInfo').style.display = 'none';
});

// Funções para mostrar/esconder mensagens
function showMessage(type, message) {
    hideMessages();
    const messageElement = document.getElementById(type + 'Message');
    messageElement.textContent = message;
    messageElement.style.display = 'block';
}

function hideMessages() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successMessage').style.display = 'none';
    document.getElementById('infoMessage').style.display = 'none';
}

function showLoading(text = 'Processando...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loading').style.display = 'block';
}

function hideLoading() {
    document.getElementById('loading').style.display = 'none';
}

// Login
document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const cpf = document.getElementById('loginCpf').value;
    const password = document.getElementById('loginPassword').value;

    if (!validarCPF(cpf)) {
        showMessage('error', 'CPF inválido');
        return;
    }

    showLoading('Entrando no sistema...');
    hideMessages();

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cpf, password })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('success', 'Login realizado com sucesso!');
            // Limpar flags de logout/sessão invalidada
            sessionStorage.removeItem('logoutByButton');
            sessionStorage.removeItem('sessionInvalidated');
            // Set flag to show welcome message on next page
            sessionStorage.setItem('justLoggedIn', 'true');
            setTimeout(() => {
                // Limpar histórico e redirecionar
                history.replaceState({ authenticated: true, page: 'app' }, null, '/index.html');
                window.location.replace('/index.html');
            }, 1000);
        } else {
            if (data.userNotFound) {
                showMessage('info', 'Usuário não encontrado. Faça seu cadastro primeiro.');
            } else {
                showMessage('error', data.error || 'Erro no login');
            }
        }
    } catch (error) {
        showMessage('error', 'Erro de conexão. Tente novamente.');
    } finally {
        hideLoading();
    }
});

// Cadastro
let isRegistering = false; // Proteção contra múltiplos cliques

document.getElementById('registerForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    // Prevenir múltiplas submissões
    if (isRegistering) {
        return;
    }

    isRegistering = true;
    const submitButton = this.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const cpf = document.getElementById('registerCpf').value;
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!validarCPF(cpf)) {
        showMessage('error', 'CPF inválido');
        return;
    }

    if (password.length < 6) {
        showMessage('error', 'A senha deve ter pelo menos 6 caracteres');
        return;
    }

    if (password !== confirmPassword) {
        showMessage('error', 'As senhas não coincidem');
        return;
    }

    showLoading('Verificando CPF...');
    hideMessages();

    try {
        // Verificar CPF primeiro
        const checkResponse = await fetch('/api/check-cpf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cpf })
        });

        const checkData = await checkResponse.json();

        if (checkData.exists) {
            showMessage('error', 'CPF já cadastrado no sistema');
            hideLoading();
            return;
        }

        if (!checkData.employee) {
            showMessage('error', checkData.message || 'CPF não encontrado na base de funcionários');
            hideLoading();
            return;
        }

        // Mostrar informações do funcionário
        document.getElementById('userName').textContent = checkData.employee.nome || 'Não informado';
        document.getElementById('userDepartment').textContent = checkData.employee.departamento || 'Não informado';
        document.getElementById('userMatricula').textContent = checkData.employee.matricula || 'Não informado';
        document.getElementById('userStatus').textContent = checkData.employee.status || 'Não informado';
        document.getElementById('userInfo').style.display = 'block';

        showLoading('Criando conta...');

        // Criar usuário
        const registerResponse = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cpf, password })
        });

        const registerData = await registerResponse.json();

        if (registerResponse.ok) {
            showMessage('success', 'Cadastro realizado com sucesso! Redirecionando para login...');
            // Limpar flags de logout/sessão invalidada
            sessionStorage.removeItem('logoutByButton');
            sessionStorage.removeItem('sessionInvalidated');
            setTimeout(() => {
                // Limpar formulário de cadastro
                document.getElementById('registerForm').reset();
                document.getElementById('userInfo').style.display = 'none';
                // Alternar para formulário de login
                document.getElementById('toggleForm').click();
                document.getElementById('loginCpf').value = cpf;
                document.getElementById('loginPassword').focus();
                hideMessages();
            }, 2000);
        } else {
            console.error('Erro no cadastro:', registerData);
            showMessage('error', registerData.error || 'Erro ao criar conta');
        }
    } catch (error) {
        showMessage('error', 'Erro de conexão. Tente novamente.');
    } finally {
        hideLoading();
        isRegistering = false;
        submitButton.disabled = false;
    }
});