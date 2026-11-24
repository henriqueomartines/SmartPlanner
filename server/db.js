/**
 * @fileoverview Camada de Persistência Relacional SQLite Nativa (Node.js v24 `node:sqlite`).
 * Zero dependências externas de compilação C++.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'smartplanner.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');

let dbInstance = null;

function getTodayIso(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
            completed: false,
            actualMinutes: 0,
            studyMethod: null,
            subtasks: []
        }
    ];
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

function getDb() {
    if (dbInstance) return dbInstance;

    dbInstance = new DatabaseSync(DB_PATH);
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    dbInstance.exec(schemaSql);

    // Verifica se já há dados; se vazio, popula com massa de demonstração acadêmica
    const countRow = dbInstance.prepare('SELECT COUNT(*) as total FROM tasks').get();
    if (!countRow || countRow.total === 0) {
        seedDatabase();
    }

    return dbInstance;
}

function seedDatabase() {
    const db = getDb();
    saveAllState({
        tasks: getDefaultDemoTasks(),
        settings: getDefaultSettings()
    });
}

function getAllState() {
    const db = getDb();
    const taskRows = db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all();
    const subtaskRows = db.prepare('SELECT * FROM subtasks ORDER BY position ASC').all();
    const settingRows = db.prepare('SELECT key, value FROM settings').all();

    const subtasksByTask = new Map();
    for (const st of subtaskRows) {
        if (!subtasksByTask.has(st.task_id)) {
            subtasksByTask.set(st.task_id, []);
        }
        subtasksByTask.get(st.task_id).push({
            id: st.id,
            title: st.title,
            done: Boolean(st.done)
        });
    }

    const tasks = taskRows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        category: row.category,
        deadline: row.deadline,
        duration: Number(row.duration),
        urgency: Number(row.urgency),
        importance: Number(row.importance),
        isFixed: Boolean(row.is_fixed),
        startTime: row.start_time || null,
        endTime: row.end_time || null,
        timeSlot: row.start_time && row.end_time ? `${row.start_time} - ${row.end_time}` : null,
        completed: Boolean(row.completed),
        actualMinutes: Number(row.actual_minutes || 0),
        studyMethod: row.study_method || null,
        subtasks: subtasksByTask.get(row.id) || []
    }));

    const settings = { ...getDefaultSettings() };
    for (const s of settingRows) {
        try {
            settings[s.key] = JSON.parse(s.value);
        } catch {
            settings[s.key] = s.value;
        }
    }

    return { tasks, settings };
}

function saveAllState({ tasks, settings }) {
    const db = getDb();
    db.exec('BEGIN TRANSACTION');
    try {
        if (Array.isArray(tasks)) {
            db.prepare('DELETE FROM subtasks').run();
            db.prepare('DELETE FROM tasks').run();

            const insertTask = db.prepare(`
                INSERT INTO tasks (
                    id, title, description, category, deadline, duration,
                    urgency, importance, is_fixed, start_time, end_time,
                    completed, actual_minutes, study_method
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const insertSubtask = db.prepare(`
                INSERT INTO subtasks (id, task_id, title, done, position)
                VALUES (?, ?, ?, ?, ?)
            `);

            for (const t of tasks) {
                const validCategory = ['Acadêmico', 'Trabalho', 'Pessoal', 'Geral'].includes(t.category)
                    ? t.category
                    : 'Geral';

                insertTask.run(
                    String(t.id),
                    String(t.title || 'Sem título'),
                    String(t.description || ''),
                    validCategory,
                    String(t.deadline || getTodayIso(0)),
                    Math.max(5, Math.min(720, Number(t.duration) || 60)),
                    Math.max(1, Math.min(5, Number(t.urgency) || 3)),
                    Math.max(1, Math.min(5, Number(t.importance) || 3)),
                    t.isFixed ? 1 : 0,
                    t.startTime || null,
                    t.endTime || null,
                    t.completed ? 1 : 0,
                    Math.max(0, Number(t.actualMinutes) || 0),
                    t.studyMethod || null
                );

                const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
                subtasks.forEach((st, idx) => {
                    insertSubtask.run(
                        String(st.id || `sub_${t.id}_${idx}`),
                        String(t.id),
                        String(st.title || ''),
                        st.done ? 1 : 0,
                        idx
                    );
                });
            }
        }

        if (settings && typeof settings === 'object') {
            const upsertSetting = db.prepare(`
                INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `);
            for (const [k, v] of Object.entries(settings)) {
                upsertSetting.run(String(k), JSON.stringify(v));
            }
        }

        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }

    return getAllState();
}

module.exports = {
    DB_PATH,
    getDb,
    getDefaultDemoTasks,
    getDefaultSettings,
    getAllState,
    saveAllState,
    seedDatabase
};
