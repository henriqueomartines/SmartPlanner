/**
 * @fileoverview Motor Determinístico de Agendamento (Time-Blocking — RN-02)
 * e Validador de Conflitos de Intervalo Horário (RN-05).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        const Scoring = require('./scoring.js');
        module.exports = factory(Scoring);
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.Scheduler = factory(root.SmartPlanner.Scoring);
    }
})(typeof self !== 'undefined' ? self : this, function (Scoring) {
    'use strict';

    /**
     * Converte horário "HH:MM" para minutos desde 00:00.
     * @param {string} timeStr
     * @returns {number|null}
     */
    function timeToMinutes(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const match = timeStr.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (!match) return null;
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }

    /**
     * Converte minutos desde 00:00 para string "HH:MM".
     * @param {number} totalMinutes
     * @returns {string}
     */
    function minutesToTime(totalMinutes) {
        const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
        const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
        const mm = String(clamped % 60).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    /**
     * Formata um intervalo em minutos para "HH:MM - HH:MM".
     * @param {number} startMin
     * @param {number} endMin
     * @returns {string}
     */
    function formatSlot(startMin, endMin) {
        return `${minutesToTime(startMin)} - ${minutesToTime(endMin)}`;
    }

    /**
     * RN-05: Prevenção de Conflitos de Horário
     * Verifica se um candidato [startMin, endMin) colide com tarefas/eventos já alocados.
     *
     * @param {string} startTime - "HH:MM"
     * @param {number} duration - duração em minutos
     * @param {Array<Object>} existingTasks - lista de tarefas existentes
     * @param {string|null} [ignoreTaskId] - ID da própria tarefa em caso de edição
     * @returns {{ hasConflict: boolean, conflicts: Array<Object>, startTime: string, endTime: string }}
     */
    function checkScheduleConflict(startTime, duration, existingTasks, ignoreTaskId = null) {
        const startMin = timeToMinutes(startTime);
        const dur = Math.max(5, Number(duration) || 60);

        if (startMin === null) {
            return { hasConflict: false, conflicts: [], startTime: null, endTime: null };
        }

        const endMin = startMin + dur;
        const conflicts = [];

        for (const t of existingTasks || []) {
            if (!t || (ignoreTaskId && String(t.id) === String(ignoreTaskId))) continue;
            if (t.completed) continue; // Tarefas já concluídas não bloqueiam novos agendamentos

            const tStart = timeToMinutes(t.startTime);
            if (tStart === null) continue;
            const tEnd = timeToMinutes(t.endTime) || (tStart + (Number(t.duration) || 60));

            // Condição matemática de interseção de intervalos abertos [startMin, endMin) e [tStart, tEnd)
            if (startMin < tEnd && endMin > tStart) {
                conflicts.push({
                    id: t.id,
                    title: t.title,
                    startTime: minutesToTime(tStart),
                    endTime: minutesToTime(tEnd),
                    isFixed: Boolean(t.isFixed)
                });
            }
        }

        return {
            hasConflict: conflicts.length > 0,
            conflicts,
            startTime: minutesToTime(startMin),
            endTime: minutesToTime(endMin)
        };
    }

    /**
     * Calcula as janelas contínuas livres dentro do expediente a partir de intervalos ocupados.
     * @param {number} dayStartMin
     * @param {number} dayEndMin
     * @param {Array<{startMin: number, endMin: number}>} occupiedIntervals
     * @returns {Array<{startMin: number, endMin: number, duration: number}>}
     */
    function computeFreeWindows(dayStartMin, dayEndMin, occupiedIntervals) {
        const sorted = [...occupiedIntervals]
            .filter((i) => i.endMin > dayStartMin && i.startMin < dayEndMin)
            .map((i) => ({
                startMin: Math.max(dayStartMin, i.startMin),
                endMin: Math.min(dayEndMin, i.endMin)
            }))
            .sort((a, b) => a.startMin - b.startMin);

        // Mescla intervalos sobrepostos ou adjacentes
        const merged = [];
        for (const interval of sorted) {
            if (merged.length === 0 || merged[merged.length - 1].endMin < interval.startMin) {
                merged.push({ ...interval });
            } else {
                merged[merged.length - 1].endMin = Math.max(merged[merged.length - 1].endMin, interval.endMin);
            }
        }

        const freeWindows = [];
        let cursor = dayStartMin;

        for (const block of merged) {
            if (block.startMin > cursor) {
                freeWindows.push({
                    startMin: cursor,
                    endMin: block.startMin,
                    duration: block.startMin - cursor
                });
            }
            cursor = Math.max(cursor, block.endMin);
        }

        if (cursor < dayEndMin) {
            freeWindows.push({
                startMin: cursor,
                endMin: dayEndMin,
                duration: dayEndMin - cursor
            });
        }

        return freeWindows;
    }

    /**
     * RN-02: Algoritmo Determinístico de Agendamento Automático em Blocos Livres (Time-Blocking)
     * - Busca intervalos livres dentro do horário operacional configurado (padrão: 08:00 às 18:00).
     * - Respeita compromissos com horário fixo (isFixed = true) e pausa opcional de almoço.
     * - Ordena tarefas flexíveis pendentes em ordem decrescente de Score de Prioridade (RN-01).
     * - Aloca cada tarefa na primeira janela contínua com duração suficiente (First-Fit Decreasing).
     * - Caso a duração estimada exceda uma janela contínua, salta para o próximo slot viável.
     *
     * @param {Array<Object>} tasks - Lista de tarefas
     * @param {Object} [config] - Parâmetros do expediente
     * @returns {Object} Resultado do agendamento + métricas de desempenho (RNF-01)
     */
    function autoScheduleTimeBlocks(tasks, config = {}) {
        const startPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();

        const workStartStr = config.workStart || '08:00';
        const workEndStr = config.workEnd || '18:00';
        const bufferMinutes = config.bufferMinutes !== undefined ? Number(config.bufferMinutes) : 0;
        const includeLunchBreak = config.includeLunchBreak !== undefined ? Boolean(config.includeLunchBreak) : false;
        const lunchStartStr = config.lunchStart || '12:00';
        const lunchEndStr = config.lunchEnd || '13:00';
        const userEnergy = config.userEnergy !== undefined ? Number(config.userEnergy) : 80;
        const referenceDate = config.referenceDate || new Date();

        const dayStartMin = timeToMinutes(workStartStr) ?? 480; // 08:00
        const dayEndMin = timeToMinutes(workEndStr) ?? 1080;    // 18:00

        const clonedTasks = (tasks || []).map((t) => ({
            ...t,
            subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => ({ ...s })) : []
        }));

        // 1. Coleta blocos já fixados na agenda (compromissos fixos ou tarefas concluídas com horário)
        const occupied = [];
        if (includeLunchBreak) {
            const lStart = timeToMinutes(lunchStartStr);
            const lEnd = timeToMinutes(lunchEndStr);
            if (lStart !== null && lEnd !== null && lEnd > lStart) {
                occupied.push({ startMin: lStart, endMin: lEnd, type: 'lunch', title: 'Intervalo de Almoço / Descanso' });
            }
        }

        const fixedTasks = [];
        const flexiblePendingTasks = [];
        const completedTasks = [];

        for (const task of clonedTasks) {
            const scoreData = Scoring.calculatePriorityScore(task, { userEnergy, referenceDate });
            task.score = scoreData.total;
            task.scoreBreakdown = scoreData;

            if (task.completed) {
                completedTasks.push(task);
                continue;
            }

            if (task.isFixed && timeToMinutes(task.startTime) !== null) {
                const sMin = timeToMinutes(task.startTime);
                const eMin = sMin + (Number(task.duration) || 60);
                task.startTime = minutesToTime(sMin);
                task.endTime = minutesToTime(eMin);
                task.timeSlot = formatSlot(sMin, eMin);
                task.unscheduledReason = null;
                fixedTasks.push(task);
                occupied.push({ startMin: sMin, endMin: eMin, type: 'fixed', taskId: task.id });
            } else {
                flexiblePendingTasks.push(task);
            }
        }

        // 2. Ordena tarefas flexíveis pendentes em ordem decrescente de Score (RN-01)
        // Desempate: menor prazo -> maior importância -> menor duração
        flexiblePendingTasks.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.scoreBreakdown.daysUntilDeadline !== b.scoreBreakdown.daysUntilDeadline) {
                return a.scoreBreakdown.daysUntilDeadline - b.scoreBreakdown.daysUntilDeadline;
            }
            if (b.importance !== a.importance) return b.importance - a.importance;
            return (a.duration || 60) - (b.duration || 60);
        });

        // 3. Calcula janelas livres iniciais
        let freeWindows = computeFreeWindows(dayStartMin, dayEndMin, occupied);

        const scheduledFlexible = [];
        const unscheduledTasks = [];

        // 4. Aloca cada tarefa no primeiro bloco contínuo viável (First-Fit Decreasing)
        for (const task of flexiblePendingTasks) {
            const dur = Math.max(5, Number(task.duration) || 60);
            let allocated = false;

            for (let i = 0; i < freeWindows.length; i++) {
                const win = freeWindows[i];
                if (win.duration >= dur) {
                    const allocStart = win.startMin;
                    const allocEnd = allocStart + dur;

                    task.startTime = minutesToTime(allocStart);
                    task.endTime = minutesToTime(allocEnd);
                    task.timeSlot = formatSlot(allocStart, allocEnd);
                    task.unscheduledReason = null;

                    scheduledFlexible.push(task);
                    occupied.push({ startMin: allocStart, endMin: allocEnd, type: 'scheduled', taskId: task.id });

                    // Atualiza a janela livre descontando a tarefa e o buffer opcional
                    const nextStart = Math.min(win.endMin, allocEnd + bufferMinutes);
                    win.startMin = nextStart;
                    win.duration = win.endMin - nextStart;
                    if (win.duration <= 0) {
                        freeWindows.splice(i, 1);
                    }
                    allocated = true;
                    break;
                }
            }

            if (!allocated) {
                task.startTime = null;
                task.endTime = null;
                task.timeSlot = null;
                task.unscheduledReason = 'Sem janela contínua suficiente no horário operacional';
                unscheduledTasks.push(task);
            }
        }

        // 5. Reconstrói lista completa mantendo scores atualizados e ordenação lógica
        const allUpdatedTasks = [
            ...fixedTasks,
            ...scheduledFlexible,
            ...unscheduledTasks,
            ...completedTasks
        ].sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return (b.score || 0) - (a.score || 0);
        });

        const finalFreeWindows = computeFreeWindows(dayStartMin, dayEndMin, occupied);
        const totalWorkMinutes = Math.max(1, dayEndMin - dayStartMin);
        const totalFreeMinutes = finalFreeWindows.reduce((acc, w) => acc + w.duration, 0);
        const totalOccupiedMinutes = Math.max(0, totalWorkMinutes - totalFreeMinutes);
        const occupancyRate = Math.min(100, Math.round((totalOccupiedMinutes / totalWorkMinutes) * 100));

        const endPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const executionTimeMs = Number(Math.max(0.05, endPerf - startPerf).toFixed(2));

        return {
            tasks: allUpdatedTasks,
            scheduledCount: fixedTasks.length + scheduledFlexible.length,
            unscheduledCount: unscheduledTasks.length,
            freeWindows: finalFreeWindows.map((w) => ({
                startTime: minutesToTime(w.startMin),
                endTime: minutesToTime(w.endMin),
                duration: w.duration,
                label: formatSlot(w.startMin, w.endMin)
            })),
            occupancyRate,
            totalWorkMinutes,
            totalOccupiedMinutes,
            totalFreeMinutes,
            executionTimeMs
        };
    }

    /**
     * Constrói a linha do tempo cronológica completa do dia (ocupados + janelas livres intercaladas)
     * para visualização rica do Time-Blocking.
     *
     * @param {Array<Object>} tasks
     * @param {Object} [config]
     * @returns {Array<Object>} Blocos cronológicos ordenados
     */
    function buildDayTimeline(tasks, config = {}) {
        const workStartStr = config.workStart || '08:00';
        const workEndStr = config.workEnd || '18:00';
        const includeLunchBreak = Boolean(config.includeLunchBreak);
        const lunchStartStr = config.lunchStart || '12:00';
        const lunchEndStr = config.lunchEnd || '13:00';

        const dayStartMin = timeToMinutes(workStartStr) ?? 480;
        const dayEndMin = timeToMinutes(workEndStr) ?? 1080;

        const scheduledItems = [];

        if (includeLunchBreak) {
            const lStart = timeToMinutes(lunchStartStr);
            const lEnd = timeToMinutes(lunchEndStr);
            if (lStart !== null && lEnd !== null && lEnd > lStart) {
                scheduledItems.push({
                    type: 'break',
                    id: 'lunch-break',
                    title: 'Pausa de Almoço / Recuperação Cognitiva',
                    startMin: lStart,
                    endMin: lEnd,
                    startTime: minutesToTime(lStart),
                    endTime: minutesToTime(lEnd),
                    duration: lEnd - lStart
                });
            }
        }

        for (const task of tasks || []) {
            const sMin = timeToMinutes(task.startTime);
            if (sMin === null) continue;
            const dur = Math.max(5, Number(task.duration) || 60);
            const eMin = timeToMinutes(task.endTime) ?? (sMin + dur);

            scheduledItems.push({
                type: 'task',
                id: task.id,
                task,
                title: task.title,
                category: task.category,
                isFixed: Boolean(task.isFixed),
                completed: Boolean(task.completed),
                score: task.score,
                startMin: sMin,
                endMin: eMin,
                startTime: minutesToTime(sMin),
                endTime: minutesToTime(eMin),
                duration: eMin - sMin
            });
        }

        scheduledItems.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

        const timeline = [];
        let cursor = dayStartMin;

        for (const item of scheduledItems) {
            if (item.startMin > cursor) {
                timeline.push({
                    type: 'free',
                    startMin: cursor,
                    endMin: item.startMin,
                    startTime: minutesToTime(cursor),
                    endTime: minutesToTime(item.startMin),
                    duration: item.startMin - cursor
                });
            }
            timeline.push(item);
            cursor = Math.max(cursor, item.endMin);
        }

        if (cursor < dayEndMin) {
            timeline.push({
                type: 'free',
                startMin: cursor,
                endMin: dayEndMin,
                startTime: minutesToTime(cursor),
                endTime: minutesToTime(dayEndMin),
                duration: dayEndMin - cursor
            });
        }

        return timeline;
    }

    return {
        timeToMinutes,
        minutesToTime,
        formatSlot,
        checkScheduleConflict,
        computeFreeWindows,
        autoScheduleTimeBlocks,
        buildDayTimeline
    };
});
