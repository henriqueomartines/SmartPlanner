/**
 * @fileoverview Repositório Híbrido Dual-Mode (LocalStorage + SQLite REST API Sync)
 * e Portabilidade Padronizada JSON (RNF-03 e RNF-04).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.Repository = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const STORAGE_KEY_TASKS = 'smartplanner_v2_tasks';
    const STORAGE_KEY_SETTINGS = 'smartplanner_v2_settings';

    let backendConnected = false;
    let backendEngineInfo = 'LocalStorage (100% Client-Side)';

    function getTodayIso(offsetDays = 0) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function getDefaultSettings() {
        return {
            userEnergy: 80,
            workStart: '08:00',
            workEnd: '18:00',
            bufferMinutes: 10,
            includeLunchBreak: true,
            lunchStart: '12:00',
            lunchEnd: '13:00',
            includeFocusBonus: true
        };
    }

    function getDefaultDemoTasks() {
        return [
            {
                id: 'task_demo_1',
                title: 'Redigir Capítulo de Metodologia e Regras de Negócio (TCC)',
                description: 'Documentar o modelo matemático RN-01, corte 3,5 da Matriz de Eisenhower e algoritmo First-Fit Decreasing.',
                category: 'Acadêmico',
                deadline: getTodayIso(0),
                duration: 90,
                urgency: 5.0,
                importance: 5.0,
                isFixed: false,
                startTime: '08:00',
                endTime: '09:30',
                timeSlot: '08:00 - 09:30',
                completed: false,
                actualMinutes: 25,
                studyMethod: null,
                subtasks: [
                    { id: 'sub_1_1', title: 'Formalizar equação do Score de Prioridade (RN-01)', done: true },
                    { id: 'sub_1_2', title: 'Descrever tabela de corte da Matriz de Eisenhower (RN-03)', done: true },
                    { id: 'sub_1_3', title: 'Revisar requisitos funcionais e não-funcionais (RNF-01 < 100ms)', done: false }
                ]
            },
            {
                id: 'task_demo_2',
                title: 'Aula Presencial: Arquitetura e Engenharia de Software',
                description: 'Compromisso acadêmico com horário fixo (bloqueado contra sobreposição conforme RN-05).',
                category: 'Acadêmico',
                deadline: getTodayIso(0),
                duration: 90,
                urgency: 4.0,
                importance: 4.5,
                isFixed: true,
                startTime: '10:00',
                endTime: '11:30',
                timeSlot: '10:00 - 11:30',
                completed: false,
                actualMinutes: 0,
                studyMethod: null,
                subtasks: [
                    { id: 'sub_2_1', title: 'Apresentar protótipo funcional da Agenda Inteligente', done: false },
                    { id: 'sub_2_2', title: 'Anotar feedback do professor orientador', done: false }
                ]
            },
            {
                id: 'task_demo_3',
                title: 'Revisão de Banco de Dados Relacional e Normalização 3FN',
                description: 'Estudo dirigido com resolução de consultas SQL e verificação de chaves estrangeiras.',
                category: 'Acadêmico',
                deadline: getTodayIso(1),
                duration: 60,
                urgency: 3.0,
                importance: 4.5,
                isFixed: false,
                startTime: '13:00',
                endTime: '14:00',
                timeSlot: '13:00 - 14:00',
                completed: false,
                actualMinutes: 0,
                studyMethod: null,
                subtasks: [
                    { id: 'sub_3_1', title: 'Revisar formas normais 1FN, 2FN e 3FN', done: true },
                    { id: 'sub_3_2', title: 'Testar script DDL no SQLite', done: false }
                ]
            },
            {
                id: 'task_demo_4',
                title: 'Reunião de Alinhamento da Sprint e Relatório Técnico',
                description: 'Sincronização rápida de pendências do projeto e envio de status semanal.',
                category: 'Trabalho',
                deadline: getTodayIso(0),
                duration: 45,
                urgency: 4.0,
                importance: 2.5,
                isFixed: false,
                startTime: '14:15',
                endTime: '15:00',
                timeSlot: '14:15 - 15:00',
                completed: false,
                actualMinutes: 0,
                studyMethod: null,
                subtasks: [
                    { id: 'sub_4_1', title: 'Consolidar indicadores da semana', done: false }
                ]
            },
            {
                id: 'task_demo_5',
                title: 'Treino Funcional / Academia e Saúde Física',
                description: 'Pausa ativa para manutenção de foco cognitivo e redução de estresse.',
                category: 'Pessoal',
                deadline: getTodayIso(2),
                duration: 60,
                urgency: 2.0,
                importance: 4.0,
                isFixed: false,
                startTime: '16:30',
                endTime: '17:30',
                timeSlot: '16:30 - 17:30',
                completed: true,
                actualMinutes: 60,
                studyMethod: null,
                subtasks: [
                    { id: 'sub_5_1', title: 'Aquecimento e mobilidade (15 min)', done: true },
                    { id: 'sub_5_2', title: 'Treino principal (45 min)', done: true }
                ]
            },
            {
                id: 'task_demo_6',
                title: 'Limpar caixa de entrada de e-mails antigos e notificações',
                description: 'Atividade de baixa urgência e baixa importância (Quadrante Q4).',
                category: 'Geral',
                deadline: getTodayIso(5),
                duration: 30,
                urgency: 2.0,
                importance: 2.0,
                isFixed: false,
                startTime: null,
                endTime: null,
                timeSlot: null,
                completed: false,
                actualMinutes: 0,
                studyMethod: null,
                subtasks: []
            }
        ];
    }

    function loadFromLocalStorage() {
        let tasks = null;
        let settings = null;
        try {
            const rawTasks = localStorage.getItem(STORAGE_KEY_TASKS);
            if (rawTasks) tasks = JSON.parse(rawTasks);
            const rawSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
            if (rawSettings) settings = { ...getDefaultSettings(), ...JSON.parse(rawSettings) };
        } catch (err) {
            console.warn('[SmartPlanner Storage]: Falha ao ler LocalStorage', err);
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
            tasks = getDefaultDemoTasks();
        }
        if (!settings) {
            settings = getDefaultSettings();
        }
        return { tasks, settings };
    }

    function saveToLocalStorage({ tasks, settings }) {
        try {
            if (Array.isArray(tasks)) {
                localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(tasks));
            }
            if (settings) {
                localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
            }
        } catch (err) {
            console.warn('[SmartPlanner Storage]: Falha ao gravar no LocalStorage', err);
        }
    }

    /**
     * Inicializa o estado tentando sincronizar com o servidor SQLite local (se ativo)
     * ou operando de forma 100% autônoma no LocalStorage (RNF-03).
     */
    async function initializeState() {
        const localState = loadFromLocalStorage();

        if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 1200);
                const healthRes = await fetch('/api/health', { signal: controller.signal });
                clearTimeout(timer);

                if (healthRes.ok) {
                    const health = await healthRes.json();
                    backendConnected = true;
                    backendEngineInfo = `SQLite Ativo (${health.dbFile})`;

                    const stateRes = await fetch('/api/state');
                    if (stateRes.ok) {
                        const remoteState = await stateRes.json();
                        saveToLocalStorage(remoteState);
                        return {
                            ...remoteState,
                            backendConnected,
                            backendEngineInfo
                        };
                    }
                }
            } catch {
                backendConnected = false;
                backendEngineInfo = 'LocalStorage Offline (Standalone)';
            }
        }

        saveToLocalStorage(localState);
        return {
            ...localState,
            backendConnected,
            backendEngineInfo
        };
    }

    /**
     * Persiste estado tanto no LocalStorage quanto no SQLite (quando conectado).
     */
    async function saveState({ tasks, settings }) {
        saveToLocalStorage({ tasks, settings });

        if (backendConnected) {
            try {
                await fetch('/api/state', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tasks, settings })
                });
            } catch {
                backendConnected = false;
                backendEngineInfo = 'LocalStorage Offline (Standalone)';
            }
        }

        return { backendConnected, backendEngineInfo };
    }

    /**
     * Restaura a massa de dados acadêmica de demonstração.
     */
    async function resetToDemoData() {
        const demoState = {
            tasks: getDefaultDemoTasks(),
            settings: getDefaultSettings()
        };
        await saveState(demoState);
        return demoState;
    }

    /**
     * RNF-04 (Portabilidade): Gera string JSON padronizada para exportação de dados.
     */
    function exportToJson({ tasks, settings }) {
        const payload = {
            schema: 'SmartPlanner.Export.v2',
            exportedAt: new Date().toISOString(),
            settings,
            tasks
        };
        return JSON.stringify(payload, null, 2);
    }

    /**
     * RNF-04 (Portabilidade): Valida e importa arquivo JSON padronizado.
     */
    function parseImportedJson(rawJsonString) {
        const parsed = JSON.parse(rawJsonString);
        const tasksSource = Array.isArray(parsed) ? parsed : parsed.tasks;

        if (!Array.isArray(tasksSource)) {
            throw new Error('Formato JSON inválido: propriedade "tasks" não encontrada.');
        }

        const sanitizedTasks = tasksSource.map((t, i) => ({
            id: String(t.id || `imported_${Date.now()}_${i}`),
            title: String(t.title || 'Tarefa Importada').trim(),
            description: String(t.description || ''),
            category: ['Acadêmico', 'Trabalho', 'Pessoal', 'Geral'].includes(t.category) ? t.category : 'Geral',
            deadline: String(t.deadline || getTodayIso(0)),
            duration: Math.max(5, Math.min(720, Number(t.duration) || 60)),
            urgency: Math.max(1, Math.min(5, Number(t.urgency) || 3)),
            importance: Math.max(1, Math.min(5, Number(t.importance) || 3)),
            isFixed: Boolean(t.isFixed),
            startTime: t.startTime || null,
            endTime: t.endTime || null,
            timeSlot: t.startTime && t.endTime ? `${t.startTime} - ${t.endTime}` : (t.timeSlot || null),
            completed: Boolean(t.completed),
            actualMinutes: Math.max(0, Number(t.actualMinutes) || 0),
            studyMethod: t.studyMethod || null,
            subtasks: Array.isArray(t.subtasks)
                ? t.subtasks.map((st, sIdx) => ({
                    id: String(st.id || `sub_${i}_${sIdx}`),
                    title: String(typeof st === 'string' ? st : (st.title || '')),
                    done: Boolean(typeof st === 'object' && st.done)
                }))
                : []
        }));

        const settings = parsed.settings
            ? { ...getDefaultSettings(), ...parsed.settings }
            : null;

        return { tasks: sanitizedTasks, settings };
    }

    return {
        getDefaultSettings,
        getDefaultDemoTasks,
        initializeState,
        saveState,
        resetToDemoData,
        exportToJson,
        parseImportedJson,
        getStatus: () => ({ backendConnected, backendEngineInfo })
    };
});
