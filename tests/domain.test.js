/**
 * @fileoverview Suíte Automatizada de Testes de Unidade e Desempenho (Node.js Test Runner)
 * Valida matematicamente as Regras de Negócio RN-01 a RN-07 e o Requisito RNF-01 (<100ms).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const Scoring = require('../src/domain/scoring.js');
const Heuristics = require('../src/domain/heuristics.js');
const Scheduler = require('../src/domain/scheduler.js');
const StudyPlans = require('../src/domain/studyPlans.js');
const Gamification = require('../src/domain/gamification.js');
const dbLayer = require('../server/db.js');

test('RN-01: Cálculo determinístico do Score de Prioridade (Fórmula Canônica)', () => {
    const refDate = '2026-11-09';

    // Caso 1: Prazo hoje (DiasParaOPrazo = 0) -> FatorPrazo = 100 / (0 + 1) = 100 -> 100 * 0.2 = 20
    // Urgência = 5 (5*0.4 = 2.0), Importância = 5 (5*0.4 = 2.0) -> BaseScore = 24.00
    const scoreToday = Scoring.calculatePriorityScore(
        { urgency: 5, importance: 5, deadline: '2026-11-09', duration: 60 },
        { referenceDate: refDate, includeFocusBonus: false }
    );
    assert.equal(scoreToday.daysUntilDeadline, 0);
    assert.equal(scoreToday.urgencyTerm, 2.0);
    assert.equal(scoreToday.importanceTerm, 2.0);
    assert.equal(scoreToday.deadlineTerm, 20.0);
    assert.equal(scoreToday.baseScore, 24.0);

    // Caso 2: Prazo vencido (DiasParaOPrazo < 0) -> FatorPrazo assume valor máximo (100)
    const scoreOverdue = Scoring.calculatePriorityScore(
        { urgency: 4, importance: 3, deadline: '2026-11-05', duration: 60 },
        { referenceDate: refDate, includeFocusBonus: false }
    );
    assert.equal(scoreOverdue.isOverdue, true);
    assert.equal(scoreOverdue.deadlineFactor, 100);
    assert.equal(scoreOverdue.baseScore, Number((4 * 0.4 + 3 * 0.4 + 20).toFixed(2)));

    // Caso 3: Prazo para amanhã (DiasParaOPrazo = 1) -> FatorPrazo = 100 / 2 = 50 -> 50 * 0.2 = 10
    const scoreTomorrow = Scoring.calculatePriorityScore(
        { urgency: 3, importance: 4, deadline: '2026-11-10', duration: 60 },
        { referenceDate: refDate, includeFocusBonus: false }
    );
    assert.equal(scoreTomorrow.daysUntilDeadline, 1);
    assert.equal(scoreTomorrow.deadlineTerm, 10.0);
    assert.equal(scoreTomorrow.baseScore, Number((1.2 + 1.6 + 10.0).toFixed(2)));
});

test('RN-03: Mapeamento da Matriz de Eisenhower com corte em 3.5', () => {
    assert.equal(Scoring.classifyEisenhower({ urgency: 3.5, importance: 3.5 }).id, 'Q1');
    assert.equal(Scoring.classifyEisenhower({ urgency: 5, importance: 4 }).id, 'Q1');
    assert.equal(Scoring.classifyEisenhower({ urgency: 3.4, importance: 3.5 }).id, 'Q2');
    assert.equal(Scoring.classifyEisenhower({ urgency: 2, importance: 5 }).id, 'Q2');
    assert.equal(Scoring.classifyEisenhower({ urgency: 4, importance: 3.0 }).id, 'Q3');
    assert.equal(Scoring.classifyEisenhower({ urgency: 2, importance: 2 }).id, 'Q4');
});

test('RN-04: Progresso percentual derivado de subtarefas e conclusão em 100%', () => {
    const partialTask = {
        completed: false,
        subtasks: [
            { id: '1', title: 'Passo 1', done: true },
            { id: '2', title: 'Passo 2', done: false },
            { id: '3', title: 'Passo 3', done: true },
            { id: '4', title: 'Passo 4', done: false }
        ]
    };
    const p1 = Scoring.calculateTaskProgress(partialTask);
    assert.equal(p1.percentage, 50);
    assert.equal(p1.isCompleted, false);

    const fullTask = {
        completed: false,
        subtasks: [
            { id: '1', title: 'Passo 1', done: true },
            { id: '2', title: 'Passo 2', done: true }
        ]
    };
    const p2 = Scoring.calculateTaskProgress(fullTask);
    assert.equal(p2.percentage, 100);
    assert.equal(p2.isCompleted, true);
});

test('RN-02 e RN-05: Time-Blocking respeita blocos fixos, previne conflitos e ordena por Score', () => {
    const sampleTasks = [
        {
            id: 'fixed-1',
            title: 'Aula Fixa de Engenharia de Software',
            category: 'Acadêmico',
            deadline: '2026-11-09',
            duration: 60,
            urgency: 3,
            importance: 4,
            isFixed: true,
            startTime: '09:00',
            completed: false
        },
        {
            id: 'flex-low',
            title: 'Organizar arquivos antigos',
            category: 'Geral',
            deadline: '2026-11-20',
            duration: 60,
            urgency: 1,
            importance: 2,
            isFixed: false,
            completed: false
        },
        {
            id: 'flex-high',
            title: 'Entregar Capítulo Final do TCC',
            category: 'Acadêmico',
            deadline: '2026-11-09',
            duration: 120,
            urgency: 5,
            importance: 5,
            isFixed: false,
            completed: false
        }
    ];

    // Verifica detecção de conflito (RN-05) com a aula fixa das 09:00 às 10:00
    const conflictCheck = Scheduler.checkScheduleConflict('09:30', 60, sampleTasks);
    assert.equal(conflictCheck.hasConflict, true);
    assert.equal(conflictCheck.conflicts[0].id, 'fixed-1');

    // Executa agendamento automático (RN-02):
    // Janela 08:00-09:00 tem 60 min (não cabe 'flex-high' de 120 min, então 'flex-high' vai para 10:00-12:00!)
    // E 'flex-low' de 60 min encaixa na janela 08:00-09:00!
    const scheduled = Scheduler.autoScheduleTimeBlocks(sampleTasks, {
        workStart: '08:00',
        workEnd: '18:00',
        referenceDate: '2026-11-09'
    });

    const highTask = scheduled.tasks.find((t) => t.id === 'flex-high');
    const lowTask = scheduled.tasks.find((t) => t.id === 'flex-low');
    assert.equal(highTask.startTime, '10:00');
    assert.equal(highTask.endTime, '12:00');
    assert.equal(lowTask.startTime, '08:00');
    assert.equal(lowTask.endTime, '09:00');
});

test('RN-06: Categorização heurística rápida e extração de tempo/duração sem IA externa', () => {
    assert.equal(Heuristics.detectCategoryByKeywords('Estudar para prova de Cálculo').category, 'Acadêmico');
    assert.equal(Heuristics.detectCategoryByKeywords('Preparar relatório da reunião do projeto').category, 'Trabalho');
    assert.equal(Heuristics.detectCategoryByKeywords('Ir ao treino e passar no médico').category, 'Pessoal');
    assert.equal(Heuristics.detectCategoryByKeywords('Ver novidade aleatória').category, 'Geral');

    const parsed = Heuristics.parseQuickTaskInput('Reunião de projeto às 14:30 por 45min urgente');
    assert.equal(parsed.category, 'Trabalho');
    assert.equal(parsed.startTime, '14:30');
    assert.equal(parsed.duration, 45);
    assert.equal(parsed.isFixed, true);
    assert.ok(parsed.urgency >= 4.5);
});

test('RN-07: Gerador de Planos de Estudo segue estruturas estritas para Pomodoro, Feynman e Intercalado', () => {
    const pomodoroTasks = StudyPlans.generateStudyPlanTasks({ method: 'pomodoro', subjectA: 'Estrutura de Dados' });
    assert.equal(pomodoroTasks.length, 4); // 4 blocos de estudo
    assert.equal(pomodoroTasks[0].duration, 30); // 25m estudo + 5m pausa curta
    assert.equal(pomodoroTasks[3].duration, 40); // 25m estudo + 15m pausa longa

    const feynmanTasks = StudyPlans.generateStudyPlanTasks({ method: 'feynman', subjectA: 'Física Quântica' });
    assert.equal(feynmanTasks.length, 3); // 3 etapas Feynman
    assert.deepEqual(feynmanTasks.map((t) => t.duration), [45, 30, 30]);

    const intercaladoTasks = StudyPlans.generateStudyPlanTasks({
        method: 'intercalado',
        subjectA: 'Cálculo II',
        subjectB: 'Álgebra Linear'
    });
    assert.equal(intercaladoTasks.length, 4);
    assert.ok(intercaladoTasks[0].title.includes('Cálculo II'));
    assert.ok(intercaladoTasks[1].title.includes('Álgebra Linear'));
    assert.equal(intercaladoTasks[0].duration, 50); // 40m estudo + 10m intervalo
});

test('RNF-01: Desempenho do cálculo de Score e Time-Blocking < 100ms para lote de 100 tarefas', () => {
    const bulkTasks = Array.from({ length: 100 }, (_, i) => ({
        id: `bulk_${i}`,
        title: `Tarefa de Teste #${i}`,
        category: i % 2 === 0 ? 'Acadêmico' : 'Trabalho',
        deadline: '2026-11-12',
        duration: 30,
        urgency: (i % 5) + 1,
        importance: ((i + 2) % 5) + 1,
        isFixed: false,
        completed: false,
        subtasks: []
    }));

    const result = Scheduler.autoScheduleTimeBlocks(bulkTasks, {
        workStart: '06:00',
        workEnd: '23:00'
    });

    assert.ok(
        result.executionTimeMs < 100,
        `Tempo de execução (${result.executionTimeMs}ms) excedeu o limite RNF-01 de 100ms`
    );
});

test('Persistência SQLite Nativa (node:sqlite): Seed, Leitura e Escrita Transacional ACID', () => {
    const initial = dbLayer.getAllState();
    assert.ok(Array.isArray(initial.tasks));
    assert.ok(initial.tasks.length >= 6);
    assert.equal(typeof initial.settings.userEnergy, 'number');

    // Simula atualização de estado e verifica integridade das subtarefas
    const modifiedTasks = initial.tasks.map((t, idx) =>
        idx === 0 ? { ...t, actualMinutes: 45 } : t
    );
    const saved = dbLayer.saveAllState({ tasks: modifiedTasks, settings: initial.settings });
    assert.equal(saved.tasks[0].actualMinutes, 45);
    assert.ok(saved.tasks[0].subtasks.length > 0);

    // Restaura estado original de demonstração
    dbLayer.seedDatabase();
});

test('Sistema de Gamificação, Cálculo de XP, Patentes e Ranking Acadêmico', () => {
    const sampleTask = {
        id: 'xp_test_1',
        title: 'Entregar Projeto Final',
        duration: 90,
        urgency: 5,
        importance: 5,
        completed: true,
        actualMinutes: 60,
        subtasks: [
            { id: 's1', title: 'Código', done: true },
            { id: 's2', title: 'Testes', done: true }
        ]
    };

    const xpData = Gamification.calculateTaskXp(sampleTask);
    assert.ok(xpData.totalPotentialXp > 200);
    assert.ok(xpData.earnedXp >= xpData.totalPotentialXp);

    const profile = Gamification.computeGamificationProfile([sampleTask]);
    assert.ok(profile.totalXp > 400);
    assert.ok(profile.rankInfo.level >= 2);
    assert.equal(profile.leaderboard.length, 6);
    assert.ok(profile.userPosition >= 1 && profile.userPosition <= 6);
});


