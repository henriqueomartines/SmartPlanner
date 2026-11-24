/**
 * @fileoverview Motor Matemático de Priorização (RN-01), Matriz de Eisenhower (RN-03)
 * e Cálculo Determinístico de Progresso por Subtarefas (RN-04).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.Scoring = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Calcula a diferença em dias inteiros entre a data de referência (hoje) e o prazo da tarefa.
     * @param {string|Date} deadlineStr - Data limite (YYYY-MM-DD ou ISO)
     * @param {string|Date} [referenceDate] - Data base de cálculo (padrão: hoje)
     * @returns {number} Dias até o prazo (negativo se vencido, 0 se vence hoje)
     */
    function calculateDaysUntilDeadline(deadlineStr, referenceDate) {
        if (!deadlineStr) return 7; // Caso sem prazo explícito, assume 7 dias

        const parseLocalDay = (d) => {
            if (d instanceof Date) {
                return new Date(d.getFullYear(), d.getMonth(), d.getDate());
            }
            const str = String(d).trim();
            const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (match) {
                return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
            }
            const parsed = new Date(str);
            return isNaN(parsed.getTime())
                ? new Date()
                : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        };

        const targetDay = parseLocalDay(deadlineStr);
        const refDay = referenceDate ? parseLocalDay(referenceDate) : parseLocalDay(new Date());

        const diffMs = targetDay.getTime() - refDay.getTime();
        return Math.round(diffMs / (1000 * 60 * 60 * 24));
    }

    /**
     * RN-01: Cálculo Determinístico do Score de Prioridade
     * Fórmula Canônica:
     *   Score = (Urgência * 0.4) + (Importância * 0.4) + ([100 / (DiasParaOPrazo + 1)] * 0.2)
     *   Se o prazo estiver vencido (DiasParaOPrazo < 0), o fator prazo assume o valor máximo (100).
     *
     * Inclui também modificador adaptativo opcional de Energia Cognitiva (Foco do Usuário)
     * para desempate inteligente sem distorcer a fórmula acadêmica oficial.
     *
     * @param {Object} task - Objeto da tarefa
     * @param {Object} [options] - Opções de contexto (referenceDate, userEnergy, includeFocusBonus)
     * @returns {Object} Detalhamento matemático completo do Score
     */
    function calculatePriorityScore(task, options = {}) {
        const urgency = Math.min(5, Math.max(1, Number(task.urgency) || 3));
        const importance = Math.min(5, Math.max(1, Number(task.importance) || 3));
        const duration = Math.max(5, Number(task.duration) || 60);
        const userEnergy = options.userEnergy !== undefined ? Number(options.userEnergy) : 80;

        const daysUntilDeadline = calculateDaysUntilDeadline(task.deadline, options.referenceDate);
        const isOverdue = daysUntilDeadline < 0;

        // Se vencido (days < 0) ou vence hoje (days === 0), fator = 100
        const deadlineFactor = isOverdue ? 100 : (100 / (daysUntilDeadline + 1));

        const urgencyTerm = Number((urgency * 0.4).toFixed(4));
        const importanceTerm = Number((importance * 0.4).toFixed(4));
        const deadlineTerm = Number((deadlineFactor * 0.2).toFixed(4));

        const baseScore = Number((urgencyTerm + importanceTerm + deadlineTerm).toFixed(2));

        // Modificador fino de alinhamento bio-cognitivo (usado como diferencial / desempate técnico)
        // Se energia alta (>=70%), favorece tarefas densas/importantes; se energia baixa (<50%), favorece tarefas curtas (Quick Wins)
        let focusBonus = 0;
        if (options.includeFocusBonus !== false) {
            const normalizedEnergy = userEnergy / 100; // 0.2 a 1.0
            if (normalizedEnergy >= 0.7) {
                focusBonus = Number(((importance * 0.08) + Math.min(duration, 120) * 0.002).toFixed(2));
            } else if (normalizedEnergy < 0.5) {
                const shortTaskBoost = duration <= 45 ? 0.35 : 0.05;
                focusBonus = Number(shortTaskBoost.toFixed(2));
            } else {
                focusBonus = Number((importance * 0.04).toFixed(2));
            }
        }

        const total = Number((baseScore + focusBonus).toFixed(2));

        return {
            total,
            baseScore,
            urgency,
            importance,
            urgencyTerm: Number(urgencyTerm.toFixed(2)),
            importanceTerm: Number(importanceTerm.toFixed(2)),
            deadlineTerm: Number(deadlineTerm.toFixed(2)),
            deadlineFactor: Number(deadlineFactor.toFixed(2)),
            daysUntilDeadline,
            isOverdue,
            focusBonus
        };
    }

    /**
     * RN-03: Mapeamento Automatizado da Matriz de Eisenhower
     * Corte canônico em 3.5 para Urgência e Importância:
     * - Q1 (Fazer Agora): Urgência >= 3.5 e Importância >= 3.5
     * - Q2 (Agendar): Urgência < 3.5 e Importância >= 3.5
     * - Q3 (Delegar / Simplificar): Urgência >= 3.5 e Importância < 3.5
     * - Q4 (Eliminar / Reavaliar): Urgência < 3.5 e Importância < 3.5
     *
     * @param {Object} task - Tarefa com urgency e importance
     * @returns {Object} Metadados do quadrante
     */
    function classifyEisenhower(task) {
        const u = Number(task.urgency) || 1;
        const i = Number(task.importance) || 1;

        if (u >= 3.5 && i >= 3.5) {
            return {
                id: 'Q1',
                code: 'Q1',
                title: 'Fazer Agora',
                subtitle: 'Urgente e Importante',
                action: 'Execução imediata / Prioridade máxima',
                badgeClass: 'rose',
                cutoffRule: 'Urgência ≥ 3,5 e Importância ≥ 3,5'
            };
        }
        if (u < 3.5 && i >= 3.5) {
            return {
                id: 'Q2',
                code: 'Q2',
                title: 'Agendar',
                subtitle: 'Não Urgente, mas Importante',
                action: 'Alocar no time-blocking diário',
                badgeClass: 'indigo',
                cutoffRule: 'Urgência < 3,5 e Importância ≥ 3,5'
            };
        }
        if (u >= 3.5 && i < 3.5) {
            return {
                id: 'Q3',
                code: 'Q3',
                title: 'Delegar / Simplificar',
                subtitle: 'Urgente, mas Pouco Importante',
                action: 'Automatizar, agilizar ou delegar',
                badgeClass: 'amber',
                cutoffRule: 'Urgência ≥ 3,5 e Importância < 3,5'
            };
        }
        return {
            id: 'Q4',
            code: 'Q4',
            title: 'Eliminar / Reavaliar',
            subtitle: 'Não Urgente e Pouco Importante',
            action: 'Despriorizar ou descartar',
            badgeClass: 'slate',
            cutoffRule: 'Urgência < 3,5 e Importância < 3,5'
        };
    }

    /**
     * RN-04: Progresso e Conclusão de Tarefas Baseado em Subtarefas
     * Para tarefas com subtarefas, o progresso é (concluídas / total) * 100.
     * A tarefa principal só atinge status "Concluída" ao alcançar 100%.
     *
     * @param {Object} task
     * @returns {{ totalSubtasks: number, completedSubtasks: number, percentage: number, isCompleted: boolean }}
     */
    function calculateTaskProgress(task) {
        const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
        const totalSubtasks = subtasks.length;

        if (totalSubtasks === 0) {
            const isCompleted = Boolean(task.completed);
            return {
                totalSubtasks: 0,
                completedSubtasks: 0,
                percentage: isCompleted ? 100 : 0,
                isCompleted
            };
        }

        const completedSubtasks = subtasks.filter((st) => Boolean(st && st.done)).length;
        const percentage = Math.round((completedSubtasks / totalSubtasks) * 100);
        const isCompleted = completedSubtasks === totalSubtasks;

        return {
            totalSubtasks,
            completedSubtasks,
            percentage,
            isCompleted
        };
    }

    return {
        calculateDaysUntilDeadline,
        calculatePriorityScore,
        classifyEisenhower,
        calculateTaskProgress
    };
});
