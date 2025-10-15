/**
 * Valida um número de CPF brasileiro.
 * @param {string} cpf - O CPF a ser validado, com ou sem formatação.
 * @returns {boolean} - Retorna true se o CPF for válido, false caso contrário.
 */
function validarCPF(cpf) {
    // Remove caracteres não numéricos
    cpf = String(cpf).replace(/[^\d]/g, '');

    // Verifica se tem 11 dígitos ou se todos os dígitos são iguais
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
        return false;
    }

    let soma = 0;
    let resto;

    // Validação do primeiro dígito verificador
    for (let i = 1; i <= 9; i++) {
        soma = soma + parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) {
        resto = 0;
    }
    if (resto !== parseInt(cpf.substring(9, 10))) {
        return false;
    }

    soma = 0;
    // Validação do segundo dígito verificador
    for (let i = 1; i <= 10; i++) {
        soma = soma + parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) {
        resto = 0;
    }
    if (resto !== parseInt(cpf.substring(10, 11))) {
        return false;
    }

    return true;
}

/**
 * Formata um CPF para o padrão XXX.XXX.XXX-XX.
 * @param {string} cpf - O CPF a ser formatado, com ou sem formatação.
 * @returns {string} - O CPF formatado.
 */
function formatarCPF(cpf) {
    // Remove qualquer formatação existente
    const cpfLimpo = String(cpf).replace(/[^\d]/g, '');

    // Aplica a máscara de formatação
    return cpfLimpo.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

module.exports = {
    validarCPF,
    formatarCPF
};