/**
 * @fileoverview Módulo de Visualização Analítica e Gráficos Dinâmicos (Chart.js — RF-06).
 * Atualiza em tempo real com os dados reais da agenda (sem valores estáticos fixos).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.Charts = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    let categoryChartInstance = null;
    let executionChartInstance = null;
    let scatterChartInstance = null;

    const CATEGORIES = ['Acadêmico', 'Trabalho', 'Pessoal', 'Geral'];
    const CATEGORY_COLORS = {
        'Acadêmico': '#2563eb',
        'Trabalho': '#6366f1',
        'Pessoal': '#10b981',
        'Geral': '#64748b'
    };

    /**
     * Renderiza ou atualiza todos os gráficos analíticos com base nas tarefas atuais.
     * @param {Array<Object>} tasks
     */
    function updateAllCharts(tasks) {
        if (typeof Chart === 'undefined') return;
        const list = Array.isArray(tasks) ? tasks : [];

        renderCategoryDistributionChart(list);
        renderPlannedVsExecutedChart(list);
        renderEisenhowerScatterChart(list);
    }

    function renderCategoryDistributionChart(tasks) {
        const canvas = document.getElementById('categoryChart');
        if (!canvas) return;

        const minutesByCategory = CATEGORIES.map((cat) =>
            tasks
                .filter((t) => t.category === cat)
                .reduce((sum, t) => sum + (Number(t.duration) || 0), 0)
        );

        const totalSum = minutesByCategory.reduce((a, b) => a + b, 0);
        const dataValues = totalSum > 0 ? minutesByCategory : [1, 1, 1, 1];

        if (categoryChartInstance) {
            categoryChartInstance.data.datasets[0].data = dataValues;
            categoryChartInstance.update();
            return;
        }

        categoryChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: CATEGORIES.map((c) => `${c} (min)`),
                datasets: [{
                    data: dataValues,
                    backgroundColor: CATEGORIES.map((c) => CATEGORY_COLORS[c]),
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '66%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, font: { size: 11, family: 'Inter' } }
                    }
                }
            }
        });
    }

    function renderPlannedVsExecutedChart(tasks) {
        const canvas = document.getElementById('executionChart');
        if (!canvas) return;

        const plannedByCat = CATEGORIES.map((cat) =>
            tasks
                .filter((t) => t.category === cat)
                .reduce((sum, t) => sum + (Number(t.duration) || 0), 0)
        );

        const executedByCat = CATEGORIES.map((cat) =>
            tasks
                .filter((t) => t.category === cat)
                .reduce((sum, t) => {
                    if (t.completed) return sum + Math.max(Number(t.duration) || 0, Number(t.actualMinutes) || 0);
                    const subtasks = Array.isArray(t.subtasks) ? t.subtasks : [];
                    const ratio = subtasks.length > 0
                        ? subtasks.filter((s) => s.done).length / subtasks.length
                        : 0;
                    const estimatedDone = Math.round((Number(t.duration) || 0) * ratio);
                    return sum + Math.max(Number(t.actualMinutes) || 0, estimatedDone);
                }, 0)
        );

        if (executionChartInstance) {
            executionChartInstance.data.datasets[0].data = plannedByCat;
            executionChartInstance.data.datasets[1].data = executedByCat;
            executionChartInstance.update();
            return;
        }

        executionChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: CATEGORIES,
                datasets: [
                    {
                        label: 'Planejado (min)',
                        data: plannedByCat,
                        backgroundColor: '#93c5fd',
                        borderRadius: 6
                    },
                    {
                        label: 'Executado / Concluído (min)',
                        data: executedByCat,
                        backgroundColor: '#2563eb',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { font: { size: 11 } },
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        ticks: { font: { size: 11 } },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, font: { size: 11, family: 'Inter' } }
                    }
                }
            }
        });
    }

    function renderEisenhowerScatterChart(tasks) {
        const canvas = document.getElementById('eisenhowerScatterChart');
        if (!canvas) return;

        const points = tasks.map((t) => ({
            x: Number(t.urgency) || 3,
            y: Number(t.importance) || 3,
            r: Math.max(6, Math.min(16, Math.round((Number(t.score) || 10) * 0.6))),
            title: t.title,
            category: t.category
        }));

        if (scatterChartInstance) {
            scatterChartInstance.data.datasets[0].data = points;
            scatterChartInstance.update();
            return;
        }

        scatterChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bubble',
            data: {
                datasets: [{
                    label: 'Tarefas (Urgência × Importância)',
                    data: points,
                    backgroundColor: 'rgba(37, 99, 235, 0.65)',
                    borderColor: '#1d4ed8',
                    borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        min: 0.5,
                        max: 5.5,
                        title: { display: true, text: 'Urgência (Corte RN-03 = 3,5)', font: { size: 11, weight: 'bold' } },
                        grid: {
                            color: (ctx) => (ctx.tick && ctx.tick.value === 3.5 ? '#f43f5e' : '#f1f5f9')
                        }
                    },
                    y: {
                        min: 0.5,
                        max: 5.5,
                        title: { display: true, text: 'Importância (Corte RN-03 = 3,5)', font: { size: 11, weight: 'bold' } },
                        grid: {
                            color: (ctx) => (ctx.tick && ctx.tick.value === 3.5 ? '#f43f5e' : '#f1f5f9')
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const raw = ctx.raw || {};
                                return `${raw.title || 'Tarefa'} (U: ${raw.x}, I: ${raw.y})`;
                            }
                        }
                    },
                    legend: { display: false }
                }
            }
        });
    }

    return {
        updateAllCharts
    };
});
