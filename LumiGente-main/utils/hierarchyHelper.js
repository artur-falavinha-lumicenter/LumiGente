/**
 * Funções Auxiliares para Hierarquia
 * 
 * Este módulo fornece funções para trabalhar com HierarchyPath,
 * eliminando a necessidade do campo redundante HierarchyLevel.
 * 
 * @module hierarchyHelper
 */

/**
 * Calcula o nível hierárquico baseado no HierarchyPath
 * 
 * A lógica considera se o usuário é RESPONSÁVEL por um departamento:
 * - Se é responsável = Nível alto (Diretor/Coordenador)
 * - Se não é responsável = Nível baixo (Funcionário)
 * 
 * @param {string} hierarchyPath - Caminho hierárquico (ex: "000000011 > 000000121 > 000001211")
 * @param {string} matricula - Matrícula do usuário (para verificar se é responsável)
 * @param {string} departamento - Departamento do usuário (da TAB_HIST_SRA)
 * @returns {number} Nível hierárquico (1 = funcionário comum, 4 = diretor)
 * 
 * @example
 * getHierarchyLevel("000000011 > 000000121 > 000122134 > 122134101", "123456", "000122134")  // retorna 3 (coordenador - é responsável)
 * getHierarchyLevel("000000011 > 000000121 > 000001211", "789012", "000001211")   // retorna 1 (funcionário - não é responsável)
 */
function getHierarchyLevel(hierarchyPath, matricula = null, departamento = null) {
    // Validar entrada
    if (!hierarchyPath || typeof hierarchyPath !== 'string') {
        return 1; // Funcionário comum (mais baixo)
    }
    
    const trimmedPath = hierarchyPath.trim();
    
    if (trimmedPath === '') {
        return 1; // Funcionário comum (mais baixo)
    }
    
    // Contar quantos códigos de departamento existem (separados por ">")
    const departments = trimmedPath.split('>').map(d => d.trim()).filter(d => d.length > 0);
    
    // LÓGICA CORRETA: Verificar se é responsável por departamento
    if (matricula && departamento) {
        // Se o departamento do usuário está no path, verificar posição
        const departamentoIndex = departments.indexOf(departamento);
        
        if (departamentoIndex !== -1) {
            // O usuário é responsável pelo departamento se:
            // 1. O departamento está no final do path (é o departamento atual)
            // 2. OU se é responsável por um departamento que tem subordinados
            
            if (departamentoIndex === departments.length - 1) {
                // É o departamento atual - verificar se tem subordinados
                // Se tem 4 códigos e é o último, provavelmente é coordenador
                if (departments.length === 4) {
                    return 3; // Coordenador
                } else if (departments.length === 3) {
                    return 2; // Supervisor
                } else if (departments.length === 2) {
                    return 4; // Diretor
                } else if (departments.length === 1) {
                    return 4; // Diretor
                }
            }
        }
    }
    
    // Lógica de fallback: quanto mais códigos, mais baixo na hierarquia
    // 4 códigos = funcionário (nível 1)
    // 3 códigos = supervisor (nível 2)
    // 2 códigos = coordenador (nível 3)
    // 1 código = diretor (nível 4)
    
    return 5 - departments.length;
}

/**
 * Calcula o nível hierárquico consultando a VIEW HIERARQUIA_CC
 * 
 * LÓGICA CORRETA:
 * 1. Verificar se é responsável por um departamento na HIERARQUIA_CC
 * 2. Se for responsável: contar quantas pessoas estão acima dele no HierarchyPath
 * 3. Nível = quantidade de superiores + 1
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @param {string} matricula - Matrícula do usuário
 * @param {string} departamento - Departamento do usuário (da TAB_HIST_SRA)
 * @param {Object} pool - Pool de conexão com o banco
 * @returns {Promise<number>} Nível hierárquico
 * 
 * @example
 * // Usuário responsável pelo departamento '000122134' na posição 2 do path
 * // Path: "000000011 > 000000121 > 000122134 > 122134101"
 * // Quantidade de superiores: 2 (000000011, 000000121)
 * // Nível: 2 + 1 = 3 (Coordenador)
 */
async function getHierarchyLevelFromDB(hierarchyPath, matricula, departamento, pool) {
    try {
        // Validar entrada
        if (!hierarchyPath || typeof hierarchyPath !== 'string') {
            return 1; // Funcionário comum (mais baixo)
        }
        
        const trimmedPath = hierarchyPath.trim();
        
        if (trimmedPath === '') {
            return 1; // Funcionário comum (mais baixo)
        }
        
        // Contar quantos códigos de departamento existem
        const departments = trimmedPath.split('>').map(d => d.trim()).filter(d => d.length > 0);
        
        // 1. Verificar se o usuário é responsável por algum departamento
        const queryResponsavel = `
            SELECT COUNT(*) as Total
            FROM HIERARQUIA_CC 
            WHERE RESPONSAVEL_ATUAL = @matricula
        `;
        
        const resultResponsavel = await pool.request()
            .input('matricula', sql.VarChar, matricula)
            .query(queryResponsavel);
        
        const isResponsavel = resultResponsavel.recordset[0].Total > 0;
        
        if (isResponsavel) {
            // 2. Se é responsável, encontrar a posição do departamento no path
            const departamentoIndex = departments.indexOf(departamento);
            
            if (departamentoIndex !== -1) {
                // 3. Contar quantas pessoas estão acima dele
                // O nível = quantidade de superiores + 1
                const quantidadeSuperiores = departamentoIndex;
                const nivel = quantidadeSuperiores + 1;
                
                // Garantir que o nível está entre 1 e 4
                return Math.max(1, Math.min(4, nivel));
            }
        }
        
        // Se não é responsável, usar lógica de fallback
        return 5 - departments.length;
        
    } catch (error) {
        console.error('Erro ao calcular nível hierárquico:', error.message);
        // Em caso de erro, usar lógica de fallback
        const departments = hierarchyPath.split('>').map(d => d.trim()).filter(d => d.length > 0);
        return 5 - departments.length;
    }
}

/**
 * Verifica se o usuário é um gestor (nível 2, 3 ou 4)
 * 
 * Gestores têm acesso a funcionalidades adicionais como visualizar
 * subordinados, criar avaliações, etc.
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {boolean} True se é gestor
 * 
 * @example
 * isManager("000000011")                           // true (nível 4 - diretor)
 * isManager("000000011 > 000000121")               // true (nível 3 - coordenador)
 * isManager("000000011 > 000000121 > 000001211")   // true (nível 2 - supervisor)
 * isManager("000000011 > 000000121 > 000001211 > 000012345")  // false (nível 1 - funcionário)
 */
function isManager(hierarchyPath) {
    const level = getHierarchyLevel(hierarchyPath);
    return level >= 2; // Supervisor, Coordenador, Diretor
}

/**
 * Verifica se o usuário é um diretor (nível 4)
 * 
 * Diretores têm acesso total a funcionalidades administrativas.
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {boolean} True se é diretor
 * 
 * @example
 * isDirector("000000011")                           // true (nível 4)
 * isDirector("000000011 > 000000121")               // false (nível 3)
 */
function isDirector(hierarchyPath) {
    return getHierarchyLevel(hierarchyPath) === 4;
}

/**
 * Verifica se o usuário é um coordenador (nível 3)
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {boolean} True se é coordenador
 */
function isCoordinator(hierarchyPath) {
    return getHierarchyLevel(hierarchyPath) === 3;
}

/**
 * Verifica se o usuário é um supervisor (nível 2)
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {boolean} True se é supervisor
 */
function isSupervisor(hierarchyPath) {
    return getHierarchyLevel(hierarchyPath) === 2;
}

/**
 * Obtém o role/cargo baseado no nível hierárquico
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {string} Nome do cargo ("Diretor", "Coordenador", "Supervisor", "Funcionário")
 * 
 * @example
 * getRole("000000011 > 000000121 > 000001211 > 000012345")  // "Funcionário" (nível 1)
 * getRole("000000011 > 000000121 > 000001211")   // "Supervisor" (nível 2)
 * getRole("000000011 > 000000121")               // "Coordenador" (nível 3)
 * getRole("000000011")                           // "Diretor" (nível 4)
 * getRole("")                                    // "Funcionário" (nível 1)
 */
function getRole(hierarchyPath) {
    const level = getHierarchyLevel(hierarchyPath);
    
    if (level === 1) return 'Funcionário';
    if (level === 2) return 'Supervisor';
    if (level === 3) return 'Coordenador';
    if (level === 4) return 'Diretor';
    return 'Funcionário'; // outros níveis
}

/**
 * Extrai o código do departamento atual (último código no path)
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {string} Código do departamento atual ou string vazia
 * 
 * @example
 * getCurrentDepartmentCode("000000011 > 000000121 > 000001211")  // "000001211"
 */
function getCurrentDepartmentCode(hierarchyPath) {
    if (!hierarchyPath || typeof hierarchyPath !== 'string') {
        return '';
    }
    
    const departments = hierarchyPath.split('>').map(d => d.trim()).filter(d => d.length > 0);
    
    if (departments.length === 0) {
        return '';
    }
    
    return departments[departments.length - 1];
}

/**
 * Extrai o código do superior direto (penúltimo código no path)
 * 
 * @param {string} hierarchyPath - Caminho hierárquico
 * @returns {string} Código do superior direto ou string vazia
 * 
 * @example
 * getDirectSuperiorCode("000000011 > 000000121 > 000001211")  // "000000121"
 * getDirectSuperiorCode("000000011")                           // ""
 */
function getDirectSuperiorCode(hierarchyPath) {
    if (!hierarchyPath || typeof hierarchyPath !== 'string') {
        return '';
    }
    
    const departments = hierarchyPath.split('>').map(d => d.trim()).filter(d => d.length > 0);
    
    if (departments.length < 2) {
        return '';
    }
    
    return departments[departments.length - 2];
}

/**
 * Verifica se um usuário está subordinado a outro baseado nos paths
 * 
 * @param {string} subordinatePath - Path do possível subordinado
 * @param {string} superiorPath - Path do possível superior
 * @returns {boolean} True se subordinado está sob o superior
 * 
 * @example
 * isSubordinate("000000011 > 000000121 > 000001211", "000000011 > 000000121")  // true
 * isSubordinate("000000011 > 000000121", "000000011 > 000000121 > 000001211")  // false
 */
function isSubordinate(subordinatePath, superiorPath) {
    if (!subordinatePath || !superiorPath) {
        return false;
    }
    
    // O subordinado deve ter o path do superior como prefixo
    return subordinatePath.trim().startsWith(superiorPath.trim()) && 
           subordinatePath.length > superiorPath.length;
}

/**
 * Verifica se um usuário pode ver outro baseado na hierarquia
 * 
 * LÓGICA: Um usuário pode ver outro se:
 * 1. O departamento do gestor está no HierarchyPath do subordinado
 * 2. E o departamento do gestor está em uma posição "acima" do departamento do subordinado
 * 
 * @param {string} gestorHierarchyPath - Path do gestor
 * @param {string} gestorDepartamento - Departamento do gestor
 * @param {string} subordinadoHierarchyPath - Path do subordinado
 * @param {string} subordinadoDepartamento - Departamento do subordinado
 * @returns {boolean} true se pode ver, false caso contrário
 */
function canUserSeeOther(gestorHierarchyPath, gestorDepartamento, subordinadoHierarchyPath, subordinadoDepartamento) {
    try {
        // Validar entradas
        if (!gestorHierarchyPath || !gestorDepartamento || !subordinadoHierarchyPath || !subordinadoDepartamento) {
            return false;
        }

        // Dividir os paths em departamentos
        const gestorDepartamentos = gestorHierarchyPath.split('>').map(d => d.trim()).filter(d => d.length > 0);
        const subordinadoDepartamentos = subordinadoHierarchyPath.split('>').map(d => d.trim()).filter(d => d.length > 0);

        // 1. Verificar se o departamento do gestor está no path do subordinado
        const gestorIndexNoSubordinado = subordinadoDepartamentos.indexOf(gestorDepartamento);
        if (gestorIndexNoSubordinado === -1) {
            return false; // Gestor não está no path do subordinado
        }

        // 2. Verificar se o departamento do subordinado está no path do gestor
        const subordinadoIndexNoGestor = gestorDepartamentos.indexOf(subordinadoDepartamento);
        if (subordinadoIndexNoGestor === -1) {
            return false; // Subordinado não está no path do gestor
        }

        // 3. Verificar se o gestor está "acima" do subordinado
        // O gestor deve estar em uma posição menor (mais à esquerda) no path do subordinado
        return gestorIndexNoSubordinado < subordinadoIndexNoGestor;
        
    } catch (error) {
        console.error('Erro ao verificar visibilidade hierárquica:', error.message);
        return false;
    }
}

/**
 * Compara dois níveis hierárquicos
 * 
 * @param {string} path1 - Primeiro path
 * @param {string} path2 - Segundo path
 * @returns {number} -1 se path1 < path2, 0 se iguais, 1 se path1 > path2
 */
function compareHierarchyLevels(path1, path2) {
    const level1 = getHierarchyLevel(path1);
    const level2 = getHierarchyLevel(path2);
    
    if (level1 < level2) return -1;
    if (level1 > level2) return 1;
    return 0;
}

module.exports = {
    getHierarchyLevel,
    getHierarchyLevelFromDB,
    isManager,
    isDirector,
    isCoordinator,
    isSupervisor,
    getRole,
    getCurrentDepartmentCode,
    getDirectSuperiorCode,
    isSubordinate,
    canUserSeeOther,
    compareHierarchyLevels
};

