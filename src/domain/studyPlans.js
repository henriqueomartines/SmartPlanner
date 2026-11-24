/**
 * @fileoverview Gerador de Planos de Estudo por Regras Pedagógicas (RN-07).
 * Desdobra metas de estudo em lotes de tarefas e checklists determinísticos:
 * - Pomodoro: 4 blocos de estudo de 25 min, 3 pausas curtas de 5 min e 1 pausa longa de 15 min.
 * - Técnica Feynman: 3 etapas (Estudo focado - 45 min; Explicação simplificada - 30 min; Revisão de lacunas - 30 min).
 * - Estudo Intercalado: Alternância de 2 disciplinas em blocos de 40 min com 10 min de intervalo.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.StudyPlans = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const STUDY_METHODS = {
        pomodoro: {
            id: 'pomodoro',
            name: 'Ciclo Pomodoro Completo',
            badge: '4×25 min + Pausas (RN-07)',
            totalMinutes: 130,
            summary: '4 blocos de estudo focado de 25 min, intercalados por 3 pausas curtas de 5 min e 1 pausa longa final de 15 min.',
            stepsPreview: [
                'Pomodoro #1 (25 min foco) + Pausa Curta (5 min)',
                'Pomodoro #2 (25 min foco) + Pausa Curta (5 min)',
                'Pomodoro #3 (25 min foco) + Pausa Curta (5 min)',
                'Pomodoro #4 (25 min foco) + Pausa Longa (15 min)'
            ]
        },
        feynman: {
            id: 'feynman',
            name: 'Técnica Feynman (3 Etapas)',
            badge: '45m + 30m + 30m (RN-07)',
            totalMinutes: 105,
            summary: 'Desdobramento cognitivo em 3 etapas: Estudo focado (45 min), Explicação simplificada (30 min) e Revisão de lacunas (30 min).',
            stepsPreview: [
                'Etapa 1: Estudo Focado e Mapeamento Conceitual (45 min)',
                'Etapa 2: Explicação Simplificada / Ensino Simulado (30 min)',
                'Etapa 3: Revisão de Lacunas e Refinamento (30 min)'
            ]
        },
        intercalado: {
            id: 'intercalado',
            name: 'Estudo Intercalado (2 Disciplinas)',
            badge: 'Alternância 40m + 10m pausa (RN-07)',
            totalMinutes: 200,
            summary: 'Alternância ativa entre 2 disciplinas complementares em blocos de 40 min com 10 min de intervalo de transição.',
            stepsPreview: [
                'Bloco 1 — Disciplina A: Teoria e Fundamentos (40 min + 10 min intervalo)',
                'Bloco 2 — Disciplina B: Teoria e Fundamentos (40 min + 10 min intervalo)',
                'Bloco 3 — Disciplina A: Resolução de Problemas (40 min + 10 min intervalo)',
                'Bloco 4 — Disciplina B: Resolução de Problemas (40 min + 10 min intervalo)'
            ]
        }
    };

    /**
     * Gera ID único determinístico/sequencial para novas tarefas e subtarefas.
     * @param {string} prefix
     * @returns {string}
     */
    function uid(prefix = 'id') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    /**
     * RN-07: Gera tarefas estruturadas a partir do método pedagógico selecionado.
     * @param {Object} params
     * @param {string} params.method - 'pomodoro' | 'feynman' | 'intercalado'
     * @param {string} params.subjectA - Disciplina principal
     * @param {string} [params.subjectB] - Segunda disciplina (usada no Estudo Intercalado)
     * @param {string} [params.difficulty] - 'easy' | 'medium' | 'hard'
     * @param {string} [params.deadline] - Data limite YYYY-MM-DD
     * @returns {Array<Object>} Lista de tarefas prontas para inserção na agenda
     */
    function generateStudyPlanTasks(params = {}) {
        const method = STUDY_METHODS[params.method] ? params.method : 'pomodoro';
        const subjectA = String(params.subjectA || 'Disciplina Principal').trim() || 'Disciplina Principal';
        const subjectB = String(params.subjectB || 'Disciplina Complementar').trim() || 'Disciplina Complementar';
        const difficulty = params.difficulty || 'medium';

        const now = new Date();
        const defaultDeadline = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const deadline = params.deadline || defaultDeadline;

        const urgencyMap = { easy: 2.5, medium: 3.5, hard: 5.0 };
        const importanceMap = { easy: 3.5, medium: 4.5, hard: 5.0 };
        const baseUrgency = urgencyMap[difficulty] || 3.5;
        const baseImportance = importanceMap[difficulty] || 4.5;

        const rawTemplates = [];

        if (method === 'pomodoro') {
            // RN-07: 4 blocos de estudo de 25 min, 3 pausas curtas de 5 min e 1 pausa longa de 15 min
            for (let i = 1; i <= 4; i++) {
                const isLast = i === 4;
                const breakDuration = isLast ? 15 : 5;
                const breakLabel = isLast ? 'Pausa longa regenerativa (15 min)' : 'Pausa curta de descompressão (5 min)';
                rawTemplates.push({
                    title: `[Pomodoro ${i}/4] ${subjectA}`,
                    description: `Sessão Pomodoro #${i}: 25 min de foco absoluto seguidos de ${breakDuration} min de pausa (${breakLabel}).`,
                    duration: 25 + breakDuration, // 30 min nos 3 primeiros (25+5) e 40 min no 4º (25+15)
                    urgency: baseUrgency,
                    importance: baseImportance,
                    studyMethod: 'pomodoro',
                    subtasks: [
                        `Executar 25 min de estudo focado em ${subjectA} (sem distrações)`,
                        `Anotar palavras-chave ou dúvidas rápidas do bloco #${i}`,
                        `Cumprir ${breakLabel}`
                    ]
                });
            }
        } else if (method === 'feynman') {
            // RN-07: 3 etapas (Estudo focado - 45 min; Explicação simplificada - 30 min; Revisão de lacunas - 30 min)
            rawTemplates.push(
                {
                    title: `[Feynman 1/3] ${subjectA} — Estudo Focado`,
                    description: 'Etapa 1 da Técnica Feynman (45 min): assimilação profunda dos conceitos fundamentais.',
                    duration: 45,
                    urgency: baseUrgency,
                    importance: baseImportance,
                    studyMethod: 'feynman',
                    subtasks: [
                        `Ler o material base de ${subjectA} por 45 min`,
                        'Mapear definições, fórmulas e conceitos centrais',
                        'Destacar os pontos de maior complexidade'
                    ]
                },
                {
                    title: `[Feynman 2/3] ${subjectA} — Explicação Simplificada`,
                    description: 'Etapa 2 da Técnica Feynman (30 min): explicar o conteúdo com palavras simples, como se ensinasse a um iniciante.',
                    duration: 30,
                    urgency: baseUrgency,
                    importance: baseImportance,
                    studyMethod: 'feynman',
                    subtasks: [
                        'Redigir ou verbalizar a explicação sem consultar o material',
                        'Substituir jargões técnicos por analogias claras e diretas',
                        'Marcar os pontos onde houve hesitação ou travamento'
                    ]
                },
                {
                    title: `[Feynman 3/3] ${subjectA} — Revisão de Lacunas`,
                    description: 'Etapa 3 da Técnica Feynman (30 min): retorno direcionado às fontes para eliminar lacunas de compreensão.',
                    duration: 30,
                    urgency: Math.max(2.0, baseUrgency - 0.5),
                    importance: baseImportance,
                    studyMethod: 'feynman',
                    subtasks: [
                        'Revisar no material original cada lacuna detectada na Etapa 2',
                        'Refazer a explicação simplificada dos pontos corrigidos',
                        'Consolidar resumo final em ficha de revisão rápida'
                    ]
                }
            );
        } else if (method === 'intercalado') {
            // RN-07: Alternância de 2 disciplinas em blocos de 40 min com 10 min de intervalo
            const pairs = [
                { subj: subjectA, focus: 'Fundamentos e Conceitos', cycle: 1 },
                { subj: subjectB, focus: 'Fundamentos e Conceitos', cycle: 2 },
                { subj: subjectA, focus: 'Exercícios Práticos e Aplicação', cycle: 3 },
                { subj: subjectB, focus: 'Exercícios Práticos e Aplicação', cycle: 4 }
            ];

            for (const item of pairs) {
                rawTemplates.push({
                    title: `[Intercalado ${item.cycle}/4] ${item.subj} — ${item.focus}`,
                    description: `Estudo Intercalado (RN-07): 40 min dedicados a ${item.subj} (${item.focus}) + 10 min de intervalo de transição cognitiva.`,
                    duration: 50, // 40 min de bloco + 10 min de intervalo conforme RN-07
                    urgency: baseUrgency,
                    importance: baseImportance,
                    studyMethod: 'intercalado',
                    subtasks: [
                        `Dedicar 40 min de foco ativo em ${item.subj} (${item.focus})`,
                        'Registrar conexões e contrastes em relação à outra disciplina',
                        'Realizar 10 min de intervalo antes de alternar de matéria'
                    ]
                });
            }
        }

        return rawTemplates.map((tpl, idx) => ({
            id: uid(`plan_${idx}`),
            title: tpl.title,
            description: tpl.description,
            category: 'Acadêmico',
            deadline,
            duration: tpl.duration,
            urgency: tpl.urgency,
            importance: tpl.importance,
            isFixed: false,
            startTime: null,
            endTime: null,
            timeSlot: null,
            completed: false,
            actualMinutes: 0,
            studyMethod: tpl.studyMethod,
            subtasks: tpl.subtasks.map((stTitle, sIdx) => ({
                id: uid(`sub_${idx}_${sIdx}`),
                title: stTitle,
                done: false
            }))
        }));
    }

    return {
        STUDY_METHODS,
        generateStudyPlanTasks
    };
});
