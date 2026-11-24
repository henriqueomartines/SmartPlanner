/**
 * @fileoverview Motor Determinístico de Gamificação, Cálculo de XP, Patentes (Elos)
 * e Ranking Acadêmico de Produtividade.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.Gamification = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Tabela de Patentes / Elos de Produtividade
     */
    const RANKS = [
        {
            level: 1,
            id: 'bronze',
            name: 'Bronze • Iniciante',
            shortTitle: 'Bronze',
            minXp: 0,
            maxXp: 250,
            icon: 'fa-seedling',
            gradient: 'from-amber-700 to-amber-500',
            badgeBg: 'bg-amber-500/15 text-amber-700 border-amber-300'
        },
        {
            level: 2,
            id: 'prata',
            name: 'Prata • Organizado',
            shortTitle: 'Prata',
            minXp: 250,
            maxXp: 550,
            icon: 'fa-shield-halved',
            gradient: 'from-slate-500 to-slate-400',
            badgeBg: 'bg-slate-200 text-slate-700 border-slate-300'
        },
        {
            level: 3,
            id: 'ouro',
            name: 'Ouro • Estrategista',
            shortTitle: 'Ouro',
            minXp: 550,
            maxXp: 950,
            icon: 'fa-crown',
            gradient: 'from-amber-500 to-yellow-400',
            badgeBg: 'bg-amber-100 text-amber-800 border-amber-300'
        },
        {
            level: 4,
            id: 'platina',
            name: 'Platina • Especialista',
            shortTitle: 'Platina',
            minXp: 950,
            maxXp: 1450,
            icon: 'fa-gem',
            gradient: 'from-cyan-500 to-teal-400',
            badgeBg: 'bg-cyan-100 text-cyan-800 border-cyan-300'
        },
        {
            level: 5,
            id: 'diamante',
            name: 'Diamante • Mestre do Tempo',
            shortTitle: 'Diamante',
            minXp: 1450,
            maxXp: 2100,
            icon: 'fa-bolt-lightning',
            gradient: 'from-indigo-600 to-purple-500',
            badgeBg: 'bg-indigo-100 text-indigo-800 border-indigo-300'
        },
        {
            level: 6,
            id: 'lenda',
            name: 'Lenda • Produtividade Máxima',
            shortTitle: 'Lenda',
            minXp: 2100,
            maxXp: 5000,
            icon: 'fa-trophy',
            gradient: 'from-rose-600 via-amber-500 to-indigo-600',
            badgeBg: 'bg-rose-100 text-rose-800 border-rose-300'
        }
    ];

    /**
     * Participantes de referência da Liga Acadêmica para o Ranking comparativo.
     */
    const BASE_COMPETITORS = [
        { id: 'peer_1', name: 'Mariana Costa', course: 'Eng. de Software', xp: 1520, avatar: 'MC', color: 'from-purple-500 to-indigo-600' },
        { id: 'peer_2', name: 'Rafael Mendes', course: 'Ciência da Computação', xp: 1040, avatar: 'RM', color: 'from-cyan-500 to-blue-600' },
        { id: 'peer_3', name: 'Beatriz Oliveira', course: 'Sistemas de Informação', xp: 680, avatar: 'BO', color: 'from-amber-500 to-orange-500' },
        { id: 'peer_4', name: 'Lucas Ferreira', course: 'Eng. de Computação', xp: 390, avatar: 'LF', color: 'from-emerald-500 to-teal-600' },
        { id: 'peer_5', name: 'Gabriel Santos', course: 'Análise de Sistemas', xp: 180, avatar: 'GS', color: 'from-slate-500 to-slate-600' }
    ];

    /**
     * Calcula a recompensa total de XP de uma tarefa com base em:
     * - Duração estimada (0.8 XP por minuto)
     * - Importância (15 XP por ponto)
     * - Urgência (10 XP por ponto)
     * - Subtarefas (+15 XP por subtarefa concluída ou total)
     * - Multiplicador de 1.2x para tarefas críticas do Quadrante Q1 (U >= 3.5 e I >= 3.5)
     *
     * @param {Object} task
     * @returns {{ totalPotentialXp: number, earnedXp: number, baseTaskXp: number, subtaskXp: number, focusBonusXp: number }}
     */
    function calculateTaskXp(task) {
        const duration = Math.max(5, Number(task.duration) || 60);
        const urgency = Math.min(5, Math.max(1, Number(task.urgency) || 3));
        const importance = Math.min(5, Math.max(1, Number(task.importance) || 3));
        const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
        const actualMinutes = Math.max(0, Number(task.actualMinutes) || 0);

        const isQ1 = urgency >= 3.5 && importance >= 3.5;
        const multiplier = isQ1 ? 1.2 : 1.0;

        const rawBase = 30 + (duration * 0.8) + (importance * 15) + (urgency * 10);
        const baseTaskXp = Math.round(rawBase * multiplier);

        const totalSubtasksXp = subtasks.length * 15;
        const completedSubtasksCount = subtasks.filter((s) => Boolean(s && s.done)).length;
        const earnedSubtaskXp = completedSubtasksCount * 15;

        const focusBonusXp = Math.round(actualMinutes * 1.5);
        const totalPotentialXp = baseTaskXp + totalSubtasksXp;

        let earnedXp = earnedSubtaskXp + focusBonusXp;
        if (task.completed) {
            earnedXp = baseTaskXp + totalSubtasksXp + focusBonusXp;
        }

        return {
            totalPotentialXp,
            earnedXp,
            baseTaskXp,
            subtaskXp: earnedSubtaskXp,
            focusBonusXp
        };
    }

    /**
     * Determina o Elo / Patente correspondente a uma quantidade de XP.
     * @param {number} xp
     * @returns {Object}
     */
    function getRankByXp(xp) {
        const totalXp = Math.max(0, Math.round(Number(xp) || 0));
        let currentRank = RANKS[0];

        for (const r of RANKS) {
            if (totalXp >= r.minXp) {
                currentRank = r;
            }
        }

        const nextRank = RANKS.find((r) => r.level === currentRank.level + 1) || null;
        const span = Math.max(1, currentRank.maxXp - currentRank.minXp);
        const intoLevel = Math.max(0, totalXp - currentRank.minXp);
        const progressPct = nextRank
            ? Math.min(100, Math.round((intoLevel / span) * 100))
            : 100;

        return {
            ...currentRank,
            totalXp,
            nextRank,
            xpIntoLevel: intoLevel,
            xpNeededForNext: nextRank ? Math.max(0, nextRank.minXp - totalXp) : 0,
            progressPct
        };
    }

    /**
     * Consolida o perfil gamificado completo do usuário, medalhas e posição no Ranking.
     * @param {Array<Object>} tasks
     * @returns {Object}
     */
    function computeGamificationProfile(tasks) {
        const list = Array.isArray(tasks) ? tasks : [];

        // Bônus base inicial de boas-vindas para que o estudante já veja progresso ativo
        let totalXp = 120;
        let completedCount = 0;
        let completedQ1Count = 0;
        let completedSubtasksTotal = 0;
        let totalFocusMinutes = 0;
        let pendingPotentialXp = 0;

        for (const task of list) {
            const xpData = calculateTaskXp(task);
            totalXp += xpData.earnedXp;

            if (task.completed) {
                completedCount += 1;
                if (Number(task.urgency) >= 3.5 && Number(task.importance) >= 3.5) {
                    completedQ1Count += 1;
                }
            } else {
                pendingPotentialXp += (xpData.totalPotentialXp - xpData.subtaskXp);
            }

            const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
            completedSubtasksTotal += subtasks.filter((s) => s && s.done).length;
            totalFocusMinutes += Number(task.actualMinutes) || 0;
        }

        // Conquistas (Achievements) que também concedem XP bônus quando desbloqueadas
        const achievements = [
            {
                id: 'ach_first_task',
                title: 'Primeira Entrega',
                description: 'Concluir pelo menos 1 atividade na agenda',
                xpReward: 50,
                icon: 'fa-flag-checkered',
                unlocked: completedCount >= 1
            },
            {
                id: 'ach_q1_slayer',
                title: 'Domador de Crises (Q1)',
                description: 'Concluir uma tarefa crítica do Quadrante Q1 (Fazer Agora)',
                xpReward: 100,
                icon: 'fa-fire',
                unlocked: completedQ1Count >= 1
            },
            {
                id: 'ach_subtask_master',
                title: 'Mestre do Checklist',
                description: 'Concluir 4 ou mais subtarefas em suas atividades',
                xpReward: 80,
                icon: 'fa-list-check',
                unlocked: completedSubtasksTotal >= 4
            },
            {
                id: 'ach_deep_focus',
                title: 'Imersão Profunda',
                description: 'Acumular 60+ minutos de foco registrado',
                xpReward: 120,
                icon: 'fa-brain',
                unlocked: totalFocusMinutes >= 60
            },
            {
                id: 'ach_streak_3',
                title: 'Combo de Produtividade',
                description: 'Concluir 3 ou mais tarefas no mesmo ciclo',
                xpReward: 150,
                icon: 'fa-bolt',
                unlocked: completedCount >= 3
            }
        ];

        for (const ach of achievements) {
            if (ach.unlocked) {
                totalXp += ach.xpReward;
            }
        }

        const rankInfo = getRankByXp(totalXp);

        // Constrói a tabela de classificação (Leaderboard) ordenando o usuário entre os colegas
        const userEntry = {
            id: 'current_user',
            name: 'Você (Estudante)',
            course: `${completedCount} concluída(s) hoje`,
            xp: totalXp,
            avatar: 'VC',
            color: 'from-brand-600 to-indigo-600',
            isCurrentUser: true,
            rank: rankInfo
        };

        const leaderboard = [
            ...BASE_COMPETITORS.map((c) => ({
                ...c,
                isCurrentUser: false,
                rank: getRankByXp(c.xp)
            })),
            userEntry
        ]
            .sort((a, b) => b.xp - a.xp)
            .map((entry, idx) => ({
                ...entry,
                position: idx + 1
            }));

        const userStanding = leaderboard.find((e) => e.isCurrentUser);

        return {
            totalXp,
            pendingPotentialXp,
            completedCount,
            completedSubtasksTotal,
            totalFocusMinutes,
            rankInfo,
            achievements,
            leaderboard,
            userPosition: userStanding ? userStanding.position : 1
        };
    }

    return {
        RANKS,
        calculateTaskXp,
        getRankByXp,
        computeGamificationProfile
    };
});
