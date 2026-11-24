/**
 * @fileoverview Controlador Principal da Aplicação SmartPlanner v2.0.
 * Combina layout clean (detalhes internos por atividade) com efeitos visuais modernos,
 * partículas flutuantes de +XP e Sistema de Patentes & Ranking Acadêmico.
 */
(function () {
    'use strict';

    const Scoring = window.SmartPlanner.Scoring;
    const Heuristics = window.SmartPlanner.Heuristics;
    const Scheduler = window.SmartPlanner.Scheduler;
    const StudyPlans = window.SmartPlanner.StudyPlans;
    const Gamification = window.SmartPlanner.Gamification;
    const Repository = window.SmartPlanner.Repository;
    const Charts = window.SmartPlanner.Charts;

    const MAX_UNDO_HISTORY = 15;

    const state = {
        tasks: [],
        settings: Repository.getDefaultSettings(),
        activeTab: 'dashboard',
        filterCategory: 'all',
        filterStatus: 'all',
        searchQuery: '',
        lastBenchmarkMs: 0.35,
        editingTaskId: null,
        modalSubtasks: [],
        expandedTaskIds: new Set(),
        expandedMatrixTaskIds: new Set(),
        undoStack: [],
        darkMode: false,
        previousRankLevel: null,
        gamificationProfile: null,
        focusTimer: {
            taskId: null,
            remainingSeconds: 25 * 60,
            totalSeconds: 25 * 60,
            running: false,
            intervalId: null
        }
    };

    window.addEventListener('DOMContentLoaded', async () => {
        setupGlobalKeyboardShortcuts();

        const initialized = await Repository.initializeState();
        state.tasks = initialized.tasks || [];
        state.settings = { ...Repository.getDefaultSettings(), ...(initialized.settings || {}) };

        if (localStorage.getItem('smartplanner_dark_mode') === '1') {
            toggleDarkMode(true);
        }

        syncSettingsInputs();
        recomputeAllScoresAndProgress();
        state.previousRankLevel = state.gamificationProfile?.rankInfo?.level || 1;
        renderAll();
        updatePersistenceBadge(initialized.backendConnected);
        updateStudyPlanPreview();
        updateSimulatorCalculation();
    });

    function formatHumanDeadline(daysUntilDeadline, deadlineStr) {
        if (daysUntilDeadline < 0) {
            const atraso = Math.abs(daysUntilDeadline);
            return `Atrasada há ${atraso}d (${deadlineStr})`;
        }
        if (daysUntilDeadline === 0) return `Hoje (${deadlineStr})`;
        if (daysUntilDeadline === 1) return `Amanhã (${deadlineStr})`;
        return `Em ${daysUntilDeadline} dias (${deadlineStr})`;
    }

    // =========================================================================
    // EFEITO VISUAL DE PARTÍCULA FLUTUANTE (+XP POP)
    // =========================================================================
    function spawnFloatingXpPop(xpAmount, clientX, clientY) {
        if (!xpAmount || xpAmount <= 0) return;
        const pop = document.createElement('div');
        pop.className = 'floating-xp-pop';
        pop.innerHTML = `<i class="fa-solid fa-bolt text-amber-300 mr-1"></i>+${xpAmount} XP`;

        const x = clientX ? Math.min(window.innerWidth - 110, Math.max(20, clientX - 30)) : (window.innerWidth / 2 - 40);
        const y = clientY ? Math.max(40, clientY - 15) : 120;

        pop.style.left = `${x}px`;
        pop.style.top = `${y}px`;

        document.body.appendChild(pop);
        setTimeout(() => pop.remove(), 1400);
    }

    // =========================================================================
    // PILHA DE DESFAZER (CTRL+Z)
    // =========================================================================
    function pushUndoSnapshot(actionDescription) {
        state.undoStack.push({
            description: actionDescription,
            tasks: JSON.parse(JSON.stringify(state.tasks)),
            settings: JSON.parse(JSON.stringify(state.settings))
        });
        if (state.undoStack.length > MAX_UNDO_HISTORY) {
            state.undoStack.shift();
        }
        updateUndoButtonUI();
    }

    async function undoLastAction() {
        if (state.undoStack.length === 0) return;
        const last = state.undoStack.pop();
        state.tasks = last.tasks;
        state.settings = last.settings;
        syncSettingsInputs();
        updateUndoButtonUI();
        await persistAndRender();
        showToast(`Desfeito: ${last.description}`, 'info');
    }

    function updateUndoButtonUI() {
        const btn = document.getElementById('undoActionBtn');
        if (!btn) return;
        if (state.undoStack.length > 0) {
            const top = state.undoStack[state.undoStack.length - 1];
            btn.disabled = false;
            btn.classList.remove('opacity-30', 'cursor-not-allowed');
            btn.title = `Desfazer: ${top.description} (Ctrl+Z)`;
        } else {
            btn.disabled = true;
            btn.classList.add('opacity-30', 'cursor-not-allowed');
            btn.title = 'Nada para desfazer (Ctrl+Z)';
        }
    }

    // =========================================================================
    // ATALHOS DE TECLADO GLOBAIS
    // =========================================================================
    function setupGlobalKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
            const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select';

            if (e.key === 'Escape') {
                closeTaskModal();
                closeHelpModal();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping) {
                e.preventDefault();
                undoLastAction();
                return;
            }

            if (isTyping) return;

            if (e.key.toLowerCase() === 'n') {
                e.preventDefault();
                openNewTaskModal();
            } else if (e.key.toLowerCase() === 'o') {
                e.preventDefault();
                runAutoSchedule();
            } else if (e.key === '/') {
                e.preventDefault();
                switchTab('dashboard');
                document.getElementById('naturalInput')?.focus();
            } else if (e.key === '?') {
                e.preventDefault();
                openHelpModal();
            }
        });
    }

    function toggleDarkMode(forceState) {
        state.darkMode = typeof forceState === 'boolean' ? forceState : !state.darkMode;
        document.body.classList.toggle('dark-theme', state.darkMode);
        localStorage.setItem('smartplanner_dark_mode', state.darkMode ? '1' : '0');

        const icon = document.getElementById('themeToggleIcon');
        if (icon) {
            icon.className = state.darkMode ? 'fa-solid fa-sun text-amber-400' : 'fa-solid fa-moon';
        }
    }

    // =========================================================================
    // MOTOR DE RECÁLCULO (SCORES, SUBTAREFAS E GAMIFICAÇÃO XP)
    // =========================================================================
    function recomputeAllScoresAndProgress() {
        const t0 = performance.now();

        for (const task of state.tasks) {
            const prog = Scoring.calculateTaskProgress(task);
            task.progressPercentage = prog.percentage;
            if (prog.totalSubtasks > 0) {
                task.completed = prog.isCompleted;
            }

            const scoreBreakdown = Scoring.calculatePriorityScore(task, {
                userEnergy: state.settings.userEnergy,
                includeFocusBonus: state.settings.includeFocusBonus
            });
            task.score = scoreBreakdown.total;
            task.scoreBreakdown = scoreBreakdown;
            task.quadrant = Scoring.classifyEisenhower(task);
            task.xpInfo = Gamification.calculateTaskXp(task);

            if (task.startTime && task.endTime) {
                task.timeSlot = `${task.startTime} - ${task.endTime}`;
            } else if (task.startTime && task.duration) {
                const sMin = Scheduler.timeToMinutes(task.startTime);
                if (sMin !== null) {
                    task.endTime = Scheduler.minutesToTime(sMin + Number(task.duration));
                    task.timeSlot = `${task.startTime} - ${task.endTime}`;
                }
            } else {
                task.timeSlot = null;
            }
        }

        state.tasks.sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return (b.score || 0) - (a.score || 0);
        });

        state.gamificationProfile = Gamification.computeGamificationProfile(state.tasks);

        const t1 = performance.now();
        state.lastBenchmarkMs = Number(Math.max(0.05, t1 - t0).toFixed(2));
    }

    async function persistAndRender() {
        const oldLevel = state.previousRankLevel;
        recomputeAllScoresAndProgress();
        const newRank = state.gamificationProfile?.rankInfo;

        renderAll();

        if (oldLevel && newRank && newRank.level > oldLevel) {
            showToast(`🎉 Subiu de Elo! Você alcançou ${newRank.name} (Nível ${newRank.level})!`, 'success');
        }
        state.previousRankLevel = newRank ? newRank.level : 1;

        const status = await Repository.saveState({
            tasks: state.tasks,
            settings: state.settings
        });
        updatePersistenceBadge(status.backendConnected);
    }

    function renderAll() {
        updateUndoButtonUI();
        renderGamificationWidgets();
        renderDashboardMetrics();
        renderDashboardTasks();
        renderTimelineView();
        renderEisenhowerMatrix();
        renderAnalyticsMetrics();
        Charts.updateAllCharts(state.tasks);
    }

    function updatePersistenceBadge(connected) {
        const badge = document.getElementById('persistenceBadge');
        if (!badge) return;
        badge.innerHTML = connected
            ? `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> SQLite`
            : `<span class="w-1.5 h-1.5 rounded-full bg-brand-500"></span> Local`;
    }

    function syncSettingsInputs() {
        const energyRange = document.getElementById('energyRange');
        if (energyRange) {
            energyRange.value = state.settings.userEnergy;
            updateEnergyUI(state.settings.userEnergy);
        }
        const workStartInput = document.getElementById('cfgWorkStart');
        const workEndInput = document.getElementById('cfgWorkEnd');
        const bufferInput = document.getElementById('cfgBufferMinutes');
        const lunchCheck = document.getElementById('cfgLunchBreak');

        if (workStartInput) workStartInput.value = state.settings.workStart || '08:00';
        if (workEndInput) workEndInput.value = state.settings.workEnd || '18:00';
        if (bufferInput) bufferInput.value = String(state.settings.bufferMinutes ?? 10);
        if (lunchCheck) lunchCheck.checked = Boolean(state.settings.includeLunchBreak);
    }

    function updateEnergyUI(val) {
        const label = document.getElementById('energyLabel');
        if (label) label.textContent = `${val}%`;
    }

    // =========================================================================
    // GAMIFICAÇÃO: SIDEBAR, HEADER E ABA DE RANKING & CONQUISTAS
    // =========================================================================
    function renderGamificationWidgets() {
        const prof = state.gamificationProfile;
        if (!prof) return;
        const r = prof.rankInfo;

        // Header Pill
        const headerRankTitle = document.getElementById('headerRankTitle');
        const headerXpValue = document.getElementById('headerXpValue');
        if (headerRankTitle) headerRankTitle.textContent = r.shortTitle;
        if (headerXpValue) headerXpValue.textContent = `${prof.totalXp} XP`;

        // Sidebar Card
        const sbIconBox = document.getElementById('sidebarRankIconBox');
        const sbIcon = document.getElementById('sidebarRankIcon');
        const sbLevel = document.getElementById('sidebarLevelBadge');
        const sbPos = document.getElementById('sidebarLeaderboardPos');
        const sbName = document.getElementById('sidebarRankName');
        const sbCurXp = document.getElementById('sidebarCurrentXp');
        const sbNextXp = document.getElementById('sidebarNextXp');
        const sbBar = document.getElementById('sidebarXpBar');
        const navPos = document.getElementById('navRankingPosBadge');

        if (sbIconBox) sbIconBox.className = `w-11 h-11 rounded-xl bg-gradient-to-tr ${r.gradient} flex items-center justify-center text-white text-lg font-bold shadow-md rank-badge-glow flex-shrink-0`;
        if (sbIcon) sbIcon.className = `fa-solid ${r.icon}`;
        if (sbLevel) sbLevel.textContent = `Nível ${r.level}`;
        if (sbPos) sbPos.textContent = `#${prof.userPosition} no Ranking`;
        if (sbName) sbName.textContent = r.name;
        if (sbCurXp) sbCurXp.textContent = `${prof.totalXp} XP`;
        if (sbNextXp) sbNextXp.textContent = r.nextRank ? `Meta: ${r.nextRank.minXp} XP` : 'Elo Máximo!';
        if (sbBar) sbBar.style.width = `${r.progressPct}%`;
        if (navPos) navPos.textContent = `#${prof.userPosition}`;

        // Hero da Aba Ranking
        const heroIconBox = document.getElementById('rankingHeroIconBox');
        const heroIcon = document.getElementById('rankingHeroIcon');
        const heroLevel = document.getElementById('rankingHeroLevel');
        const heroStanding = document.getElementById('rankingHeroStanding');
        const heroTitle = document.getElementById('rankingHeroTitle');
        const heroCurXp = document.getElementById('rankingHeroCurrentXp');
        const heroNextXp = document.getElementById('rankingHeroNextXp');
        const heroBar = document.getElementById('rankingHeroProgressBar');
        const heroNeeded = document.getElementById('rankingHeroNeededText');

        if (heroIconBox) heroIconBox.className = `w-16 h-16 rounded-2xl bg-gradient-to-tr ${r.gradient} flex items-center justify-center text-white text-3xl shadow-lg rank-badge-glow flex-shrink-0`;
        if (heroIcon) heroIcon.className = `fa-solid ${r.icon}`;
        if (heroLevel) heroLevel.textContent = `Nível ${r.level}`;
        if (heroStanding) heroStanding.textContent = `#${prof.userPosition} na Liga Acadêmica`;
        if (heroTitle) heroTitle.textContent = r.name;
        if (heroCurXp) heroCurXp.textContent = `${prof.totalXp} XP`;
        if (heroNextXp) heroNextXp.textContent = r.nextRank ? `${r.nextRank.minXp} XP` : 'MAX';
        if (heroBar) heroBar.style.width = `${r.progressPct}%`;
        if (heroNeeded) {
            heroNeeded.textContent = r.nextRank
                ? `Faltam ${r.xpNeededForNext} XP para subir para ${r.nextRank.name}`
                : 'Você atingiu a patente máxima da temporada!';
        }

        // Leaderboard Table
        const lbContainer = document.getElementById('leaderboardContainer');
        if (lbContainer) {
            lbContainer.innerHTML = prof.leaderboard.map((entry) => {
                const posMedal = entry.position === 1
                    ? '<i class="fa-solid fa-crown text-amber-500 text-sm"></i>'
                    : entry.position === 2
                        ? '<i class="fa-solid fa-medal text-slate-400 text-sm"></i>'
                        : entry.position === 3
                            ? '<i class="fa-solid fa-medal text-amber-700 text-sm"></i>'
                            : `<span class="font-mono-code text-xs text-slate-400 font-bold">#${entry.position}</span>`;

                return `
                    <div class="flex items-center justify-between p-3 rounded-xl border transition ${entry.isCurrentUser ? 'leaderboard-user-row' : 'bg-slate-50/70 border-slate-200/70'}">
                        <div class="flex items-center gap-3 min-w-0">
                            <div class="w-6 text-center flex-shrink-0">${posMedal}</div>
                            <div class="w-9 h-9 rounded-xl bg-gradient-to-tr ${entry.color} text-white text-xs font-bold flex items-center justify-center flex-shrink-0 shadow-xs">
                                ${escapeHtml(entry.avatar)}
                            </div>
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="text-xs font-bold ${entry.isCurrentUser ? 'text-brand-700' : 'text-slate-800'} truncate">
                                        ${escapeHtml(entry.name)}
                                    </span>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full font-semibold border ${entry.rank.badgeBg}">
                                        ${escapeHtml(entry.rank.shortTitle)}
                                    </span>
                                </div>
                                <p class="text-[11px] text-slate-400 truncate">${escapeHtml(entry.course)}</p>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <span class="font-mono-code text-xs font-extrabold ${entry.isCurrentUser ? 'text-indigo-600' : 'text-slate-700'}">
                                ${entry.xp} XP
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Conquistas (Achievements)
        const achContainer = document.getElementById('achievementsContainer');
        if (achContainer) {
            achContainer.innerHTML = prof.achievements.map((ach) => `
                <div class="p-3 rounded-xl border flex items-center justify-between gap-3 transition ${ach.unlocked ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50/60 border-slate-200/60 opacity-55'}">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-8 h-8 rounded-lg ${ach.unlocked ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-200 text-slate-400'} flex items-center justify-center text-xs flex-shrink-0">
                            <i class="fa-solid ${ach.icon}"></i>
                        </div>
                        <div class="min-w-0">
                            <h4 class="text-xs font-bold text-slate-800 truncate">${escapeHtml(ach.title)}</h4>
                            <p class="text-[10px] text-slate-500 truncate">${escapeHtml(ach.description)}</p>
                        </div>
                    </div>
                    <span class="font-mono-code text-[11px] font-bold ${ach.unlocked ? 'text-emerald-600' : 'text-slate-400'} flex-shrink-0">
                        ${ach.unlocked ? '<i class="fa-solid fa-check mr-0.5"></i>' : ''}+${ach.xpReward} XP
                    </span>
                </div>
            `).join('');
        }

        // Escada de Elos
        const tiersContainer = document.getElementById('ranksTierListContainer');
        if (tiersContainer) {
            tiersContainer.innerHTML = Gamification.RANKS.map((tier) => {
                const isCurrent = tier.level === r.level;
                const isReached = prof.totalXp >= tier.minXp;
                return `
                    <div class="flex items-center justify-between px-3 py-1.5 rounded-lg ${isCurrent ? 'bg-indigo-50 border border-indigo-200 font-bold text-indigo-900' : isReached ? 'text-slate-700' : 'text-slate-400'}">
                        <span class="flex items-center gap-2">
                            <i class="fa-solid ${tier.icon} ${isReached ? 'text-indigo-600' : 'text-slate-300'} w-4 text-center"></i>
                            <span>${escapeHtml(tier.name)}</span>
                        </span>
                        <span class="font-mono-code text-[11px]">${tier.minXp}+ XP</span>
                    </div>
                `;
            }).join('');
        }
    }

    // =========================================================================
    // NAVEGAÇÃO ENTRE ABAS
    // =========================================================================
    function switchTab(tabId) {
        state.activeTab = tabId;
        document.querySelectorAll('.tab-content').forEach((sec) => sec.classList.add('hidden'));
        const target = document.getElementById(`tab-${tabId}`);
        if (target) target.classList.remove('hidden');

        document.querySelectorAll('.nav-btn').forEach((btn) => {
            btn.classList.remove('bg-brand-50', 'text-brand-700', 'font-semibold');
            btn.classList.add('text-slate-600', 'font-medium');
        });

        const activeBtn = document.getElementById(`nav-${tabId}`);
        if (activeBtn) {
            activeBtn.classList.remove('text-slate-600', 'font-medium');
            activeBtn.classList.add('bg-brand-50', 'text-brand-700', 'font-semibold');
        }

        if (tabId === 'analytics' || tabId === 'matrix') {
            setTimeout(() => Charts.updateAllCharts(state.tasks), 50);
        }
    }

    // =========================================================================
    // FILTROS E EXPANSÃO INTERNA DAS ATIVIDADES
    // =========================================================================
    function setCategoryFilterPill(category) {
        state.filterCategory = category;
        const selectEl = document.getElementById('filterCategory');
        if (selectEl) selectEl.value = category;

        document.querySelectorAll('.cat-pill-btn').forEach((btn) => {
            const isMatch = btn.dataset.cat === category;
            btn.className = isMatch
                ? 'cat-pill-btn text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900 text-white transition'
                : 'cat-pill-btn text-xs font-medium px-3 py-1.5 rounded-xl text-slate-500 hover:bg-slate-100 transition';
        });

        renderDashboardTasks();
    }

    function clearAllFilters() {
        state.filterCategory = 'all';
        state.filterStatus = 'all';
        state.searchQuery = '';

        const statusEl = document.getElementById('filterStatus');
        const searchEl = document.getElementById('searchTaskInput');
        if (statusEl) statusEl.value = 'all';
        if (searchEl) searchEl.value = '';

        setCategoryFilterPill('all');
    }

    function toggleTaskExpand(taskId) {
        const key = String(taskId);
        if (state.expandedTaskIds.has(key)) {
            state.expandedTaskIds.delete(key);
        } else {
            state.expandedTaskIds.add(key);
        }
        renderDashboardTasks();
    }

    function toggleMatrixTaskExpand(taskId) {
        const key = String(taskId);
        if (state.expandedMatrixTaskIds.has(key)) {
            state.expandedMatrixTaskIds.delete(key);
        } else {
            state.expandedMatrixTaskIds.add(key);
        }
        renderEisenhowerMatrix();
    }

    // =========================================================================
    // DASHBOARD CLEAN + EFEITO DE XP E GAVETA INTERNA
    // =========================================================================
    function renderDashboardMetrics() {
        const total = state.tasks.length;
        const completed = state.tasks.filter((t) => t.completed).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        const totalPlannedMin = state.tasks.reduce((acc, t) => acc + (Number(t.duration) || 0), 0);
        const totalHours = (totalPlannedMin / 60).toFixed(1);

        const pendingTasks = state.tasks.filter((t) => !t.completed);
        const topTask = pendingTasks[0] || null;
        const pendingXp = state.gamificationProfile?.pendingPotentialXp || 0;

        const elCompleted = document.getElementById('metricCompleted');
        const elCompletedSub = document.getElementById('metricCompletedSub');
        const elPendingXp = document.getElementById('metricPendingXp');
        const elPlanned = document.getElementById('metricPlanned');
        const elTopPriority = document.getElementById('metricTopPriority');
        const elTopPrioritySub = document.getElementById('metricTopPrioritySub');

        if (elCompleted) elCompleted.textContent = `${completed} de ${total}`;
        if (elCompletedSub) elCompletedSub.textContent = `${pct}%`;
        if (elPendingXp) elPendingXp.textContent = `+${pendingXp} XP`;
        if (elPlanned) elPlanned.textContent = `${totalHours}h planejadas`;

        if (elTopPriority) {
            elTopPriority.textContent = topTask ? topTask.title : 'Dia concluído!';
        }
        if (elTopPrioritySub) {
            elTopPrioritySub.textContent = topTask ? `${topTask.quadrant.code} • +${topTask.xpInfo.totalPotentialXp} XP` : '100%';
        }
    }

    function renderDashboardTasks() {
        const container = document.getElementById('taskListContainer');
        const filterResetBanner = document.getElementById('activeFilterBanner');
        if (!container) return;

        const catFilter = state.filterCategory || 'all';
        const statusFilter = document.getElementById('filterStatus')?.value || 'all';
        const query = (document.getElementById('searchTaskInput')?.value || '').trim().toLowerCase();

        const hasActiveFilter = catFilter !== 'all' || statusFilter !== 'all' || query.length > 0;
        if (filterResetBanner) {
            filterResetBanner.classList.toggle('hidden', !hasActiveFilter);
        }

        const filtered = state.tasks.filter((t) => {
            if (catFilter !== 'all' && t.category !== catFilter) return false;
            if (statusFilter === 'pending' && t.completed) return false;
            if (statusFilter === 'completed' && !t.completed) return false;
            if (query) {
                const hay = `${t.title} ${t.description || ''} ${t.category}`.toLowerCase();
                if (!hay.includes(query)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="text-center py-10 text-xs text-slate-400">
                    Nenhuma atividade encontrada.
                </div>
            `;
            return;
        }

        container.innerHTML = filtered.map((task) => {
            const sb = task.scoreBreakdown || Scoring.calculatePriorityScore(task);
            const quad = task.quadrant || Scoring.classifyEisenhower(task);
            const prog = Scoring.calculateTaskProgress(task);
            const xp = task.xpInfo || Gamification.calculateTaskXp(task);
            const isExpanded = state.expandedTaskIds.has(String(task.id));
            const dotColor = getQuadrantDotColor(quad.id);

            return `
                <div class="task-row surface-card rounded-2xl border ${isExpanded ? 'border-brand-300 bg-white shadow-sm' : 'border-slate-200/80 bg-white/95'}">
                    <!-- LINHA PRINCIPAL CLEAN COM BADGE DE XP -->
                    <div class="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer select-none"
                         onclick="SmartPlannerApp.toggleTaskExpand('${task.id}')">

                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <input type="checkbox" ${task.completed ? 'checked' : ''}
                                onclick="event.stopPropagation()"
                                onchange="SmartPlannerApp.toggleTaskComplete('${task.id}', event)"
                                class="h-4 w-4 text-brand-600 rounded border-slate-300 cursor-pointer flex-shrink-0">

                            <span class="w-2.5 h-2.5 rounded-full ${dotColor} flex-shrink-0" title="${quad.code}: ${quad.title}"></span>

                            <span class="text-xs sm:text-sm font-semibold text-slate-800 truncate ${task.completed ? 'line-through text-slate-400' : ''}">
                                ${escapeHtml(task.title)}
                            </span>
                        </div>

                        <!-- Metadados Compactos + Recompensa de XP -->
                        <div class="flex items-center gap-2 flex-shrink-0 text-[11px]">
                            <span class="font-mono-code font-bold px-2 py-0.5 rounded-lg ${task.completed ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-indigo-50 text-indigo-700 border border-indigo-200/70'}">
                                <i class="fa-solid fa-bolt text-amber-500 mr-0.5"></i>+${xp.totalPotentialXp} XP
                            </span>

                            ${prog.totalSubtasks > 0 ? `
                                <span class="hidden sm:inline-block text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                    ${prog.completedSubtasks}/${prog.totalSubtasks}
                                </span>
                            ` : ''}

                            <span class="hidden md:inline text-slate-400">
                                ${task.timeSlot ? escapeHtml(task.timeSlot) : `${task.duration}m`}
                            </span>

                            <span class="hidden sm:inline-block text-[10px] px-2 py-0.5 rounded-md font-medium ${getCategoryBadgeClass(task.category)}">
                                ${escapeHtml(task.category)}
                            </span>

                            <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-[10px] text-slate-400 w-3 text-center"></i>
                        </div>
                    </div>

                    <!-- GAVETA INTERNA DA ATIVIDADE (Abre ao clicar) -->
                    ${isExpanded ? `
                        <div class="task-details-drawer px-4 pb-4 pt-2 border-t border-slate-100 space-y-3 text-xs bg-slate-50/50 rounded-b-2xl">

                            ${task.description ? `
                                <p class="text-slate-600 leading-relaxed">${escapeHtml(task.description)}</p>
                            ` : ''}

                            <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                                <span class="px-2.5 py-1 rounded-lg bg-white border border-slate-200/80">
                                    <strong>Quadrante:</strong> ${quad.code} — ${quad.title}
                                </span>
                                <span class="px-2.5 py-1 rounded-lg bg-white border border-slate-200/80">
                                    <strong>Prazo:</strong> ${escapeHtml(formatHumanDeadline(sb.daysUntilDeadline, task.deadline))}
                                </span>
                                <span class="px-2.5 py-1 rounded-lg bg-white border border-slate-200/80">
                                    <strong>Duração:</strong> ${task.duration} min ${task.isFixed ? '(Fixo)' : '(Flexível)'}
                                    ${task.actualMinutes > 0 ? `• ${task.actualMinutes}m focados (+${xp.focusBonusXp} XP)` : ''}
                                </span>
                                <span class="px-2.5 py-1 rounded-lg bg-white border border-slate-200/80 font-mono-code">
                                    <strong>Score RN-01:</strong> ${task.score.toFixed(2)} (U:${sb.urgency} | I:${sb.importance})
                                </span>
                            </div>

                            <!-- Checklist de Subtarefas Interno (+15 XP cada) -->
                            <div class="bg-white p-3 rounded-xl border border-slate-200/80 space-y-2">
                                <div class="flex items-center justify-between text-[11px] text-slate-500">
                                    <span class="font-semibold text-slate-700">Subtarefas (${prog.completedSubtasks}/${prog.totalSubtasks}) • <span class="text-indigo-600">+15 XP por etapa</span></span>
                                    <span class="font-mono-code font-bold text-brand-600">${prog.percentage}%</span>
                                </div>
                                ${prog.totalSubtasks > 0 ? `
                                    <div class="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div class="h-full bg-brand-600 transition-all duration-300" style="width: ${prog.percentage}%"></div>
                                    </div>
                                    <div class="space-y-1 pt-1">
                                        ${task.subtasks.map((st) => `
                                            <label class="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer py-0.5 hover:text-brand-700">
                                                <span class="flex items-center gap-2">
                                                    <input type="checkbox" ${st.done ? 'checked' : ''}
                                                        onchange="SmartPlannerApp.toggleSubtask('${task.id}', '${st.id}', event)"
                                                        class="h-3.5 w-3.5 rounded border-slate-300 text-brand-600">
                                                    <span class="${st.done ? 'line-through text-slate-400' : ''}">${escapeHtml(st.title)}</span>
                                                </span>
                                                <span class="text-[10px] font-mono-code ${st.done ? 'text-emerald-600 font-bold' : 'text-slate-400'}">+15 XP</span>
                                            </label>
                                        `).join('')}
                                    </div>
                                ` : ''}

                                <div class="flex items-center gap-1.5 pt-1">
                                    <input type="text" id="inlineSubtaskInput_${task.id}"
                                        onkeydown="if(event.key==='Enter'){event.preventDefault();SmartPlannerApp.addInlineSubtask('${task.id}');}"
                                        placeholder="Adicionar subtarefa (+15 XP)..."
                                        class="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none">
                                    <button type="button" onclick="SmartPlannerApp.addInlineSubtask('${task.id}')"
                                        class="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg transition">
                                        + Incluir
                                    </button>
                                </div>
                            </div>

                            <!-- Botões de Ação Internos -->
                            <div class="flex items-center justify-between pt-1">
                                <button type="button" onclick="SmartPlannerApp.startFocusOnTask('${task.id}')"
                                    class="bg-gradient-to-r from-brand-600 to-indigo-600 hover:from-brand-700 hover:to-indigo-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1.5">
                                    <i class="fa-solid fa-play text-[10px]"></i> Iniciar Foco (${task.duration}m)
                                </button>

                                <div class="flex items-center gap-2">
                                    <button type="button" onclick="SmartPlannerApp.openEditTaskModal('${task.id}')"
                                        class="text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-medium transition">
                                        <i class="fa-solid fa-pen mr-1"></i>Editar
                                    </button>
                                    <button type="button" onclick="SmartPlannerApp.deleteTask('${task.id}')"
                                        class="text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 px-2.5 py-1.5 rounded-xl text-xs font-medium transition">
                                        <i class="fa-solid fa-trash-can mr-1"></i>Excluir
                                    </button>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    async function addInlineSubtask(taskId) {
        const inputEl = document.getElementById(`inlineSubtaskInput_${taskId}`);
        if (!inputEl) return;
        const val = inputEl.value.trim();
        if (!val) return;

        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task) return;

        pushUndoSnapshot(`Adicionar subtarefa em "${task.title}"`);
        if (!Array.isArray(task.subtasks)) task.subtasks = [];
        task.subtasks.push({
            id: `sub_${Date.now()}`,
            title: val,
            done: false
        });
        inputEl.value = '';
        await persistAndRender();
    }

    // =========================================================================
    // CAPTURA RÁPIDA HEURÍSTICA (RN-06)
    // =========================================================================
    function handleQuickInputPreview(rawVal) {
        const previewEl = document.getElementById('quickAddPreview');
        if (!previewEl) return;

        const trimmed = String(rawVal || '').trim();
        if (!trimmed) {
            previewEl.classList.add('hidden');
            previewEl.innerHTML = '';
            return;
        }

        const parsed = Heuristics.parseQuickTaskInput(trimmed);
        const xpEst = Gamification.calculateTaskXp(parsed);
        previewEl.classList.remove('hidden');
        previewEl.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>Detectado:</span>
                <span class="font-semibold text-brand-600">${escapeHtml(parsed.category)}</span>
                <span>• ${parsed.duration} min</span>
                <span class="font-mono-code font-bold text-indigo-600">• +${xpEst.totalPotentialXp} XP</span>
                ${parsed.startTime ? `<span class="text-amber-600 font-semibold">• Fixo às ${parsed.startTime}</span>` : ''}
            </div>
        `;
    }

    async function submitQuickTask(e) {
        if (e) e.preventDefault();
        const inputEl = document.getElementById('naturalInput');
        if (!inputEl) return;
        const raw = inputEl.value.trim();
        if (!raw) return;

        const parsed = Heuristics.parseQuickTaskInput(raw);

        if (parsed.startTime) {
            const conflictCheck = Scheduler.checkScheduleConflict(parsed.startTime, parsed.duration, state.tasks);
            if (conflictCheck.hasConflict) {
                const c = conflictCheck.conflicts[0];
                showToast(`Horário ${parsed.startTime} ocupado por "${c.title}". Salva como flexível!`, 'warning');
                parsed.startTime = null;
                parsed.isFixed = false;
            }
        }

        pushUndoSnapshot(`Adicionar "${parsed.title}"`);

        state.tasks.push({
            id: `task_${Date.now()}`,
            title: parsed.title,
            description: '',
            category: parsed.category,
            deadline: parsed.deadline,
            duration: parsed.duration,
            urgency: parsed.urgency,
            importance: parsed.importance,
            isFixed: parsed.isFixed,
            startTime: parsed.startTime,
            endTime: parsed.startTime
                ? Scheduler.minutesToTime(Scheduler.timeToMinutes(parsed.startTime) + parsed.duration)
                : null,
            completed: false,
            actualMinutes: 0,
            studyMethod: null,
            subtasks: []
        });

        inputEl.value = '';
        handleQuickInputPreview('');
        await persistAndRender();
        showToast(`"${parsed.title}" adicionada!`, 'success', true);
    }

    // =========================================================================
    // HORÁRIOS DO DIA (TIME-BLOCKING RN-02 & RN-05)
    // =========================================================================
    async function runAutoSchedule() {
        pushUndoSnapshot('Organizar Horários do Dia');

        const ws = document.getElementById('cfgWorkStart')?.value || state.settings.workStart;
        const we = document.getElementById('cfgWorkEnd')?.value || state.settings.workEnd;
        const buf = Number(document.getElementById('cfgBufferMinutes')?.value ?? state.settings.bufferMinutes);
        const lunch = document.getElementById('cfgLunchBreak')
            ? document.getElementById('cfgLunchBreak').checked
            : state.settings.includeLunchBreak;

        state.settings.workStart = ws;
        state.settings.workEnd = we;
        state.settings.bufferMinutes = buf;
        state.settings.includeLunchBreak = lunch;

        const result = Scheduler.autoScheduleTimeBlocks(state.tasks, state.settings);
        state.tasks = result.tasks;
        state.lastBenchmarkMs = result.executionTimeMs;

        await persistAndRender();
        showToast(`Horários organizados (${result.scheduledCount} atividades alocadas)!`, 'success', true);
    }

    function renderTimelineView() {
        const container = document.getElementById('timelineContainer');
        if (!container) return;

        const timeline = Scheduler.buildDayTimeline(state.tasks, state.settings);
        const unscheduled = state.tasks.filter((t) => !t.completed && !t.startTime);

        const unscheduledBanner = document.getElementById('unscheduledTasksBanner');
        if (unscheduledBanner) {
            if (unscheduled.length > 0) {
                unscheduledBanner.classList.remove('hidden');
                unscheduledBanner.innerHTML = `
                    <div class="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs">
                        <span class="text-amber-900"><strong>${unscheduled.length} atividade(s)</strong> ainda sem horário definido.</span>
                        <button onclick="SmartPlannerApp.runAutoSchedule()" class="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded-xl transition">
                            Alocar Agora
                        </button>
                    </div>
                `;
            } else {
                unscheduledBanner.classList.add('hidden');
            }
        }

        container.innerHTML = timeline.map((block) => {
            if (block.type === 'free') {
                return `
                    <div class="flex items-center gap-3 py-1.5">
                        <div class="w-24 font-mono-code text-[11px] text-slate-400 text-right flex-shrink-0">
                            ${block.startTime} – ${block.endTime}
                        </div>
                        <div class="flex-1 border border-dashed border-slate-200 rounded-xl px-3.5 py-2 flex items-center justify-between text-xs text-slate-400">
                            <span>Livre (${block.duration} min)</span>
                            <button onclick="SmartPlannerApp.openNewTaskAtSlot('${block.startTime}', ${Math.min(120, block.duration)})"
                                class="text-brand-600 hover:underline font-medium">
                                + Agendar
                            </button>
                        </div>
                    </div>
                `;
            }

            if (block.type === 'break') {
                return `
                    <div class="flex items-center gap-3 py-1.5">
                        <div class="w-24 font-mono-code text-[11px] text-amber-600 text-right flex-shrink-0">
                            ${block.startTime} – ${block.endTime}
                        </div>
                        <div class="flex-1 bg-amber-50/60 border border-amber-200/80 rounded-xl px-3.5 py-2 text-xs text-amber-900 font-medium">
                            <i class="fa-solid fa-mug-saucer mr-1.5 text-amber-600"></i>${escapeHtml(block.title)}
                        </div>
                    </div>
                `;
            }

            const t = block.task;
            const xp = t.xpInfo || Gamification.calculateTaskXp(t);
            return `
                <div class="flex items-center gap-3 py-1.5">
                    <div class="w-24 font-mono-code text-[11px] font-semibold text-slate-700 text-right flex-shrink-0">
                        ${block.startTime} – ${block.endTime}
                    </div>
                    <div class="flex-1 bg-slate-50 border border-slate-200/90 border-l-4 ${block.isFixed ? 'border-l-slate-700' : 'border-l-brand-600'} rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2">
                        <div class="min-w-0">
                            <span class="text-xs font-semibold text-slate-900 ${block.completed ? 'line-through opacity-50' : ''}">${escapeHtml(block.title)}</span>
                            <span class="text-[11px] text-slate-400 ml-2">${block.duration}m • +${xp.totalPotentialXp} XP</span>
                        </div>
                        <button onclick="SmartPlannerApp.openEditTaskModal('${t.id}')" class="text-slate-400 hover:text-slate-700 text-xs px-1.5">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =========================================================================
    // MATRIZ DE EISENHOWER CLEAN
    // =========================================================================
    function renderEisenhowerMatrix() {
        const quadrants = { Q1: [], Q2: [], Q3: [], Q4: [] };

        for (const task of state.tasks) {
            const q = Scoring.classifyEisenhower(task);
            task.quadrant = q;
            quadrants[q.id].push(task);
        }

        ['Q1', 'Q2', 'Q3', 'Q4'].forEach((qId) => {
            const countEl = document.getElementById(`count${qId}`);
            const listEl = document.getElementById(`matrix${qId}`);
            if (countEl) countEl.textContent = String(quadrants[qId].length);
            if (!listEl) return;

            if (quadrants[qId].length === 0) {
                listEl.innerHTML = `<div class="text-center py-6 text-xs text-slate-300">Vazio</div>`;
                return;
            }

            listEl.innerHTML = quadrants[qId].map((t) => {
                const isOpen = state.expandedMatrixTaskIds.has(String(t.id));
                const xp = t.xpInfo || Gamification.calculateTaskXp(t);
                return `
                    <div class="bg-slate-50/70 rounded-xl border border-slate-200/80 p-2.5 text-xs">
                        <div class="flex items-center justify-between gap-2 cursor-pointer select-none"
                             onclick="SmartPlannerApp.toggleMatrixTaskExpand('${t.id}')">
                            <span class="font-medium text-slate-800 truncate ${t.completed ? 'line-through text-slate-400' : ''}">${escapeHtml(t.title)}</span>
                            <div class="flex items-center gap-2 flex-shrink-0 text-[11px] text-slate-400">
                                <span class="font-mono-code text-indigo-600 font-semibold">+${xp.totalPotentialXp} XP</span>
                                <i class="fa-solid fa-chevron-${isOpen ? 'up' : 'down'} text-[9px]"></i>
                            </div>
                        </div>

                        ${isOpen ? `
                            <div class="mt-2.5 pt-2.5 border-t border-slate-200/80 grid grid-cols-2 gap-3 text-[11px]">
                                <div>
                                    <div class="flex justify-between text-slate-600 mb-0.5">
                                        <span>Urgência</span>
                                        <strong class="font-mono-code">${Number(t.urgency).toFixed(1)}</strong>
                                    </div>
                                    <input type="range" min="1" max="5" step="0.5" value="${t.urgency}"
                                        onchange="SmartPlannerApp.updateTaskPriorityInline('${t.id}', 'urgency', this.value)"
                                        class="w-full h-1.5 cursor-pointer">
                                </div>
                                <div>
                                    <div class="flex justify-between text-slate-600 mb-0.5">
                                        <span>Importância</span>
                                        <strong class="font-mono-code">${Number(t.importance).toFixed(1)}</strong>
                                    </div>
                                    <input type="range" min="1" max="5" step="0.5" value="${t.importance}"
                                        onchange="SmartPlannerApp.updateTaskPriorityInline('${t.id}', 'importance', this.value)"
                                        class="w-full h-1.5 cursor-pointer">
                                </div>
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
        });
    }

    async function updateTaskPriorityInline(taskId, field, newVal) {
        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task) return;
        pushUndoSnapshot(`Ajustar prioridade de "${task.title}"`);
        task[field] = Math.max(1, Math.min(5, parseFloat(newVal)));
        await persistAndRender();
    }

    // =========================================================================
    // PLANOS DE ESTUDO (RN-07)
    // =========================================================================
    function updateStudyPlanPreview() {
        const method = document.getElementById('planMethod')?.value || 'pomodoro';
        const subjectA = document.getElementById('planSubjectA')?.value.trim() || 'Cálculo Diferencial';
        const subjectB = document.getElementById('planSubjectB')?.value.trim() || 'Estrutura de Dados';
        const secondSubjectWrap = document.getElementById('secondSubjectWrapper');
        const previewContainer = document.getElementById('studyPlanLivePreview');

        if (secondSubjectWrap) {
            secondSubjectWrap.classList.toggle('hidden', method !== 'intercalado');
        }
        if (!previewContainer) return;

        const previewTasks = StudyPlans.generateStudyPlanTasks({
            method,
            subjectA,
            subjectB,
            difficulty: document.getElementById('planDifficulty')?.value || 'medium'
        });

        previewContainer.innerHTML = `
            <div class="space-y-2">
                ${previewTasks.map((pt, i) => {
                    const xp = Gamification.calculateTaskXp(pt);
                    return `
                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-xs flex items-center justify-between">
                            <div>
                                <span class="font-semibold text-slate-800">${i + 1}. ${escapeHtml(pt.title)}</span>
                                <p class="text-[11px] text-slate-500 mt-0.5">${pt.subtasks.length} subtarefas incluídas • ${pt.duration} min</p>
                            </div>
                            <span class="font-mono-code text-indigo-600 font-bold bg-indigo-50 px-2.5 py-1 rounded-lg">+${xp.totalPotentialXp} XP</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    async function handleGenerateStudyPlan() {
        const method = document.getElementById('planMethod')?.value || 'pomodoro';
        const subjectA = document.getElementById('planSubjectA')?.value.trim() || 'Cálculo Diferencial';
        const subjectB = document.getElementById('planSubjectB')?.value.trim() || 'Estrutura de Dados';
        const difficulty = document.getElementById('planDifficulty')?.value || 'medium';
        const autoScheduleAfter = document.getElementById('planAutoSchedule')?.checked ?? true;

        pushUndoSnapshot('Gerar Plano de Estudo');

        const generated = StudyPlans.generateStudyPlanTasks({ method, subjectA, subjectB, difficulty });
        state.tasks.push(...generated);

        if (autoScheduleAfter) {
            const scheduled = Scheduler.autoScheduleTimeBlocks(state.tasks, state.settings);
            state.tasks = scheduled.tasks;
        }

        await persistAndRender();
        switchTab('dashboard');
        showToast(`${generated.length} blocos de estudo adicionados!`, 'success', true);
    }

    // =========================================================================
    // ESTATÍSTICAS E SIMULADOR
    // =========================================================================
    function renderAnalyticsMetrics() {
        const total = state.tasks.length;
        const completed = state.tasks.filter((t) => t.completed).length;
        const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

        const plannedMin = state.tasks.reduce((s, t) => s + (Number(t.duration) || 0), 0);
        const executedMin = state.tasks.reduce((s, t) => {
            if (t.completed) return s + Math.max(Number(t.duration) || 0, Number(t.actualMinutes) || 0);
            return s + (Number(t.actualMinutes) || 0);
        }, 0);

        const effortScore = Math.round(
            state.tasks.reduce((s, t) => s + ((Number(t.duration) || 0) * (Number(t.importance) || 3) * (Number(t.urgency) || 3)) / 25, 0)
        );

        const elRate = document.getElementById('statCompletionRate');
        const elExec = document.getElementById('statExecutedVsPlanned');
        const elEffort = document.getElementById('statEffortVolume');

        if (elRate) elRate.textContent = `${rate}% (${completed}/${total})`;
        if (elExec) elExec.textContent = `${executedMin}m / ${plannedMin}m`;
        if (elEffort) elEffort.textContent = `${effortScore} pts`;
    }

    function updateSimulatorCalculation() {
        const u = parseFloat(document.getElementById('simUrgency')?.value || '4');
        const i = parseFloat(document.getElementById('simImportance')?.value || '5');
        const days = parseInt(document.getElementById('simDays')?.value || '0', 10);

        const elUVal = document.getElementById('simUrgencyVal');
        const elIVal = document.getElementById('simImportanceVal');
        const elDVal = document.getElementById('simDaysVal');
        if (elUVal) elUVal.textContent = u.toFixed(1);
        if (elIVal) elIVal.textContent = i.toFixed(1);
        if (elDVal) elDVal.textContent = days < 0 ? `${days}d (Vencido)` : `${days}d`;

        const deadlineFactor = days < 0 ? 100 : (100 / (days + 1));
        const total = (u * 0.4) + (i * 0.4) + (deadlineFactor * 0.2);
        const quad = Scoring.classifyEisenhower({ urgency: u, importance: i });

        const outEl = document.getElementById('simFormulaOutput');
        if (outEl) {
            outEl.innerHTML = `Score = <strong>${total.toFixed(2)}</strong> • Quadrante: <strong>${quad.code} (${quad.title})</strong>`;
        }
    }

    // =========================================================================
    // CRONÔMETRO DE FOCO (+XP)
    // =========================================================================
    function startFocusOnTask(taskId) {
        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task) return;

        if (state.focusTimer.intervalId) clearInterval(state.focusTimer.intervalId);

        const focusMinutes = Math.min(60, Math.max(5, Number(task.duration) || 25));
        state.focusTimer.taskId = task.id;
        state.focusTimer.totalSeconds = focusMinutes * 60;
        state.focusTimer.remainingSeconds = focusMinutes * 60;
        state.focusTimer.running = true;

        updateFocusTimerUI();
        state.focusTimer.intervalId = setInterval(tickFocusTimer, 1000);
        showToast(`Foco iniciado: "${task.title}"`, 'info');
    }

    function toggleFocusTimer() {
        if (!state.focusTimer.taskId && state.tasks.length > 0) {
            const firstPending = state.tasks.find((t) => !t.completed) || state.tasks[0];
            return startFocusOnTask(firstPending.id);
        }

        state.focusTimer.running = !state.focusTimer.running;
        if (state.focusTimer.running) {
            state.focusTimer.intervalId = setInterval(tickFocusTimer, 1000);
        } else if (state.focusTimer.intervalId) {
            clearInterval(state.focusTimer.intervalId);
            state.focusTimer.intervalId = null;
        }
        updateFocusTimerUI();
    }

    function resetFocusTimer() {
        if (state.focusTimer.intervalId) {
            clearInterval(state.focusTimer.intervalId);
            state.focusTimer.intervalId = null;
        }
        state.focusTimer.running = false;
        state.focusTimer.remainingSeconds = state.focusTimer.totalSeconds || 25 * 60;
        updateFocusTimerUI();
    }

    async function completeFocusSessionEarly() {
        if (state.focusTimer.intervalId) {
            clearInterval(state.focusTimer.intervalId);
            state.focusTimer.intervalId = null;
        }
        const elapsedSec = Math.max(60, state.focusTimer.totalSeconds - state.focusTimer.remainingSeconds);
        const elapsedMin = Math.max(1, Math.round(elapsedSec / 60));

        const task = state.tasks.find((t) => String(t.id) === String(state.focusTimer.taskId));
        if (task) {
            pushUndoSnapshot(`Registrar foco em "${task.title}"`);
            task.actualMinutes = (Number(task.actualMinutes) || 0) + elapsedMin;
            const bonusXp = Math.round(elapsedMin * 1.5);
            spawnFloatingXpPop(bonusXp);
            showToast(`+${elapsedMin}m focados (+${bonusXp} XP) salvos em "${task.title}"!`, 'success', true);
        }

        state.focusTimer.running = false;
        state.focusTimer.remainingSeconds = 25 * 60;
        state.focusTimer.totalSeconds = 25 * 60;
        updateFocusTimerUI();
        await persistAndRender();
    }

    function tickFocusTimer() {
        if (!state.focusTimer.running) return;
        if (state.focusTimer.remainingSeconds > 0) {
            state.focusTimer.remainingSeconds -= 1;
            updateFocusTimerUI();
        } else {
            completeFocusSessionEarly();
        }
    }

    function updateFocusTimerUI() {
        const timeEl = document.getElementById('focusTimerDisplay');
        const titleEl = document.getElementById('focusTimerTaskTitle');
        const btnEl = document.getElementById('focusTimerToggleBtn');
        const progBar = document.getElementById('focusTimerProgressBar');

        const mins = String(Math.floor(state.focusTimer.remainingSeconds / 60)).padStart(2, '0');
        const secs = String(state.focusTimer.remainingSeconds % 60).padStart(2, '0');
        if (timeEl) timeEl.textContent = `${mins}:${secs}`;

        const total = Math.max(1, state.focusTimer.totalSeconds);
        const pct = Math.min(100, Math.round(((total - state.focusTimer.remainingSeconds) / total) * 100));
        if (progBar) progBar.style.width = `${pct}%`;

        const activeTask = state.tasks.find((t) => String(t.id) === String(state.focusTimer.taskId));
        if (titleEl) titleEl.textContent = activeTask ? activeTask.title : 'Sem tarefa ativa';
        if (btnEl) {
            btnEl.innerHTML = state.focusTimer.running
                ? '<i class="fa-solid fa-pause"></i>'
                : '<i class="fa-solid fa-play"></i>';
        }
    }

    // =========================================================================
    // MODAL DE CRIAR / EDITAR ATIVIDADE
    // =========================================================================
    function openNewTaskModal() {
        state.editingTaskId = null;
        state.modalSubtasks = [];
        document.getElementById('taskModalForm')?.reset();

        const today = new Date().toISOString().slice(0, 10);
        document.getElementById('modalTitleHeading').textContent = 'Nova Atividade';
        document.getElementById('taskDeadline').value = today;
        document.getElementById('taskUrgency').value = '3.5';
        document.getElementById('taskImportance').value = '4.0';
        document.getElementById('taskDuration').value = '60';
        document.getElementById('taskIsFixed').checked = false;
        document.getElementById('taskStartTime').value = '';

        toggleModalFixedTimeWrapper();
        updateModalLivePriorityPreview();
        renderModalSubtasks();
        validateModalConflictLive();

        document.getElementById('taskModal').classList.remove('hidden');
        setTimeout(() => document.getElementById('taskTitle')?.focus(), 50);
    }

    function openNewTaskAtSlot(startTime, suggestedDuration) {
        openNewTaskModal();
        document.getElementById('taskIsFixed').checked = true;
        document.getElementById('taskStartTime').value = startTime;
        document.getElementById('taskDuration').value = String(suggestedDuration || 60);
        toggleModalFixedTimeWrapper();
        validateModalConflictLive();
    }

    function openEditTaskModal(taskId) {
        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task) return;

        state.editingTaskId = task.id;
        state.modalSubtasks = Array.isArray(task.subtasks) ? task.subtasks.map((s) => ({ ...s })) : [];

        document.getElementById('modalTitleHeading').textContent = 'Editar Atividade';
        document.getElementById('taskTitle').value = task.title;
        document.getElementById('taskDescription').value = task.description || '';
        document.getElementById('taskCategory').value = task.category;
        document.getElementById('taskDeadline').value = task.deadline;
        document.getElementById('taskDuration').value = String(task.duration || 60);
        document.getElementById('taskUrgency').value = String(task.urgency ?? 3);
        document.getElementById('taskImportance').value = String(task.importance ?? 4);
        document.getElementById('taskIsFixed').checked = Boolean(task.isFixed);
        document.getElementById('taskStartTime').value = task.startTime || '';

        toggleModalFixedTimeWrapper();
        updateModalLivePriorityPreview();
        renderModalSubtasks();
        validateModalConflictLive();

        document.getElementById('taskModal').classList.remove('hidden');
    }

    function closeTaskModal() {
        document.getElementById('taskModal')?.classList.add('hidden');
        state.editingTaskId = null;
        state.modalSubtasks = [];
    }

    function setModalDurationPreset(mins) {
        const durEl = document.getElementById('taskDuration');
        if (durEl) {
            durEl.value = String(mins);
            validateModalConflictLive();
            updateModalLivePriorityPreview();
        }
    }

    function updateModalLivePriorityPreview() {
        const u = parseFloat(document.getElementById('taskUrgency')?.value || '3.5');
        const i = parseFloat(document.getElementById('taskImportance')?.value || '4.0');
        const deadline = document.getElementById('taskDeadline')?.value;
        const duration = parseInt(document.getElementById('taskDuration')?.value || '60', 10);

        const uLabel = document.getElementById('modalUrgencyLabel');
        const iLabel = document.getElementById('modalImportanceLabel');
        const previewBadge = document.getElementById('modalQuadrantPreviewBadge');

        if (uLabel) uLabel.textContent = u.toFixed(1);
        if (iLabel) iLabel.textContent = i.toFixed(1);

        if (previewBadge) {
            const quad = Scoring.classifyEisenhower({ urgency: u, importance: i });
            const scoreObj = Scoring.calculatePriorityScore(
                { urgency: u, importance: i, deadline, duration },
                { userEnergy: state.settings.userEnergy }
            );
            const xpObj = Gamification.calculateTaskXp({ urgency: u, importance: i, duration, subtasks: state.modalSubtasks });
            previewBadge.className = 'flex items-center justify-between text-[11px] text-slate-600 pt-1.5 border-t border-slate-200/80';
            previewBadge.innerHTML = `
                <span><strong>${quad.code} (${quad.title})</strong> • Score ${scoreObj.total.toFixed(1)}</span>
                <span class="font-mono-code font-bold text-indigo-600"><i class="fa-solid fa-bolt text-amber-500 mr-0.5"></i>+${xpObj.totalPotentialXp} XP</span>
            `;
        }
    }

    function toggleModalFixedTimeWrapper() {
        const isFixed = document.getElementById('taskIsFixed')?.checked;
        document.getElementById('fixedTimeInputWrapper')?.classList.toggle('hidden', !isFixed);
        validateModalConflictLive();
    }

    function findSuggestedFreeSlot(duration) {
        const workStartMin = Scheduler.timeToMinutes(state.settings.workStart) ?? 480;
        const workEndMin = Scheduler.timeToMinutes(state.settings.workEnd) ?? 1080;
        const occupied = [];

        if (state.settings.includeLunchBreak) {
            occupied.push({ startMin: 12 * 60, endMin: 13 * 60 });
        }

        for (const t of state.tasks) {
            if (t.completed || (state.editingTaskId && String(t.id) === String(state.editingTaskId))) continue;
            const sMin = Scheduler.timeToMinutes(t.startTime);
            if (sMin !== null) {
                occupied.push({ startMin: sMin, endMin: sMin + (Number(t.duration) || 60) });
            }
        }

        const freeWins = Scheduler.computeFreeWindows(workStartMin, workEndMin, occupied);
        const match = freeWins.find((w) => w.duration >= duration);
        return match ? Scheduler.minutesToTime(match.startMin) : null;
    }

    function applySuggestedSlotInModal(suggestedTime) {
        const timeInput = document.getElementById('taskStartTime');
        if (timeInput && suggestedTime) {
            timeInput.value = suggestedTime;
            validateModalConflictLive();
        }
    }

    function validateModalConflictLive() {
        const alertEl = document.getElementById('modalConflictAlert');
        const submitBtn = document.getElementById('modalSaveSubmitBtn');
        if (!alertEl) return { hasConflict: false };

        const isFixed = document.getElementById('taskIsFixed')?.checked;
        const startTime = document.getElementById('taskStartTime')?.value;
        const duration = Number(document.getElementById('taskDuration')?.value || 60);

        if (!isFixed || !startTime) {
            alertEl.classList.add('hidden');
            if (submitBtn) submitBtn.disabled = false;
            return { hasConflict: false };
        }

        const check = Scheduler.checkScheduleConflict(startTime, duration, state.tasks, state.editingTaskId);
        if (check.hasConflict) {
            const c = check.conflicts[0];
            const suggested = findSuggestedFreeSlot(duration);

            alertEl.classList.remove('hidden');
            alertEl.innerHTML = `
                <div>Conflito com <strong>"${escapeHtml(c.title)}"</strong> (${c.startTime}–${c.endTime}).</div>
                ${suggested ? `
                    <button type="button" onclick="SmartPlannerApp.applySuggestedSlotInModal('${suggested}')"
                        class="mt-1.5 bg-rose-700 text-white text-[10px] font-semibold px-2 py-1 rounded">
                        Usar próximo horário livre (${suggested})
                    </button>
                ` : ''}
            `;
            if (submitBtn) submitBtn.disabled = true;
        } else {
            alertEl.classList.add('hidden');
            if (submitBtn) submitBtn.disabled = false;
        }
        return check;
    }

    function addModalSubtask() {
        const input = document.getElementById('manualSubtaskInput');
        if (!input) return;
        const val = input.value.trim();
        if (!val) return;
        state.modalSubtasks.push({
            id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: val,
            done: false
        });
        input.value = '';
        renderModalSubtasks();
        updateModalLivePriorityPreview();
    }

    function removeModalSubtask(idx) {
        state.modalSubtasks.splice(idx, 1);
        renderModalSubtasks();
        updateModalLivePriorityPreview();
    }

    function toggleModalSubtaskDone(idx) {
        if (state.modalSubtasks[idx]) {
            state.modalSubtasks[idx].done = !state.modalSubtasks[idx].done;
            renderModalSubtasks();
        }
    }

    function renderModalSubtasks() {
        const ul = document.getElementById('manualSubtaskList');
        if (!ul) return;
        ul.innerHTML = state.modalSubtasks.map((st, idx) => `
            <li class="flex items-center justify-between bg-slate-50 px-2.5 py-1 rounded border border-slate-200">
                <span class="truncate text-slate-700">${escapeHtml(st.title)}</span>
                <button type="button" onclick="SmartPlannerApp.removeModalSubtask(${idx})" class="text-slate-400 hover:text-rose-600 ml-2">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </li>
        `).join('');
    }

    async function handleSaveTaskModal(e) {
        e.preventDefault();

        const title = document.getElementById('taskTitle').value.trim();
        const description = document.getElementById('taskDescription').value.trim();
        const category = document.getElementById('taskCategory').value;
        const deadline = document.getElementById('taskDeadline').value;
        const duration = Math.max(5, Math.min(720, parseInt(document.getElementById('taskDuration').value, 10) || 60));
        const urgency = Math.max(1, Math.min(5, parseFloat(document.getElementById('taskUrgency').value) || 3));
        const importance = Math.max(1, Math.min(5, parseFloat(document.getElementById('taskImportance').value) || 3));
        const isFixed = document.getElementById('taskIsFixed').checked;
        const startTime = isFixed ? (document.getElementById('taskStartTime').value || null) : null;

        if (startTime) {
            const check = Scheduler.checkScheduleConflict(startTime, duration, state.tasks, state.editingTaskId);
            if (check.hasConflict) return;
        }

        const endTime = startTime
            ? Scheduler.minutesToTime(Scheduler.timeToMinutes(startTime) + duration)
            : null;

        if (state.editingTaskId) {
            pushUndoSnapshot(`Editar "${title}"`);
            const existing = state.tasks.find((t) => String(t.id) === String(state.editingTaskId));
            if (existing) {
                existing.title = title;
                existing.description = description;
                existing.category = category;
                existing.deadline = deadline;
                existing.duration = duration;
                existing.urgency = urgency;
                existing.importance = importance;
                existing.isFixed = Boolean(startTime);
                existing.startTime = startTime;
                existing.endTime = endTime;
                existing.subtasks = [...state.modalSubtasks];
            }
        } else {
            pushUndoSnapshot(`Criar "${title}"`);
            state.tasks.push({
                id: `task_${Date.now()}`,
                title,
                description,
                category,
                deadline,
                duration,
                urgency,
                importance,
                isFixed: Boolean(startTime),
                startTime,
                endTime,
                completed: false,
                actualMinutes: 0,
                studyMethod: null,
                subtasks: [...state.modalSubtasks]
            });
        }

        closeTaskModal();
        await persistAndRender();
        showToast('Atividade salva!', 'success', true);
    }

    function openHelpModal() {
        document.getElementById('helpModal')?.classList.remove('hidden');
    }

    function closeHelpModal() {
        document.getElementById('helpModal')?.classList.add('hidden');
    }

    // =========================================================================
    // AÇÕES DE TAREFA COM EFEITO DE +XP AO CONCLUIR
    // =========================================================================
    async function toggleTaskComplete(taskId, evt) {
        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task) return;

        pushUndoSnapshot(`Alternar "${task.title}"`);
        const becomingCompleted = !task.completed;
        task.completed = becomingCompleted;
        if (Array.isArray(task.subtasks)) {
            task.subtasks.forEach((st) => { st.done = task.completed; });
        }

        if (becomingCompleted) {
            const xpData = Gamification.calculateTaskXp(task);
            spawnFloatingXpPop(xpData.totalPotentialXp, evt?.clientX, evt?.clientY);
        }

        await persistAndRender();
    }

    async function toggleSubtask(taskId, subtaskId, evt) {
        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task || !Array.isArray(task.subtasks)) return;

        const st = task.subtasks.find((s) => String(s.id) === String(subtaskId));
        if (!st) return;

        pushUndoSnapshot(`Etapa "${st.title}"`);
        const becomingDone = !st.done;
        st.done = becomingDone;

        const prog = Scoring.calculateTaskProgress(task);
        const becameFullyCompleted = !task.completed && prog.isCompleted;
        task.completed = prog.isCompleted;

        if (becomingDone) {
            const gained = becameFullyCompleted
                ? Gamification.calculateTaskXp(task).baseTaskXp + 15
                : 15;
            spawnFloatingXpPop(gained, evt?.clientX, evt?.clientY);
        }

        await persistAndRender();
    }

    async function deleteTask(taskId) {
        const task = state.tasks.find((t) => String(t.id) === String(taskId));
        if (!task) return;

        pushUndoSnapshot(`Excluir "${task.title}"`);
        state.tasks = state.tasks.filter((t) => String(t.id) !== String(taskId));
        state.expandedTaskIds.delete(String(taskId));
        await persistAndRender();
        showToast(`"${task.title}" excluída.`, 'info', true);
    }

    async function updateEnergyLevel(val) {
        state.settings.userEnergy = Number(val);
        updateEnergyUI(val);
        await persistAndRender();
    }

    function exportAgendaJson() {
        const jsonStr = Repository.exportToJson({ tasks: state.tasks, settings: state.settings });
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `smartplanner-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function triggerImportJson() {
        document.getElementById('importJsonInput')?.click();
    }

    async function handleImportJsonFile(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const imported = Repository.parseImportedJson(text);
            pushUndoSnapshot('Importar JSON');
            state.tasks = imported.tasks;
            if (imported.settings) {
                state.settings = { ...state.settings, ...imported.settings };
                syncSettingsInputs();
            }
            await persistAndRender();
            showToast(`${imported.tasks.length} atividades importadas!`, 'success', true);
        } catch (err) {
            showToast(`Erro no arquivo JSON: ${err.message}`, 'error');
        } finally {
            event.target.value = '';
        }
    }

    async function resetDemoData() {
        pushUndoSnapshot('Restaurar Demo');
        const fresh = await Repository.resetToDemoData();
        state.tasks = fresh.tasks;
        state.settings = fresh.settings;
        syncSettingsInputs();
        await persistAndRender();
        showToast('Dados de demonstração restaurados!', 'info', true);
    }

    function getCategoryBadgeClass(cat) {
        switch (cat) {
            case 'Acadêmico': return 'bg-brand-50 text-brand-700';
            case 'Trabalho': return 'bg-indigo-50 text-indigo-700';
            case 'Pessoal': return 'bg-emerald-50 text-emerald-700';
            default: return 'bg-slate-100 text-slate-600';
        }
    }

    function getQuadrantDotColor(qId) {
        switch (qId) {
            case 'Q1': return 'bg-rose-500';
            case 'Q2': return 'bg-indigo-500';
            case 'Q3': return 'bg-amber-500';
            default: return 'bg-slate-400';
        }
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function showToast(msg, type = 'success', allowUndo = false) {
        document.getElementById('activeSmartToast')?.remove();

        const toast = document.createElement('div');
        toast.id = 'activeSmartToast';
        toast.className = 'fixed bottom-4 right-4 bg-slate-900 text-white text-xs px-4 py-2.5 rounded-xl shadow-lg z-50 flex items-center gap-3 border border-slate-700';
        toast.innerHTML = `
            <span>${escapeHtml(msg)}</span>
            ${allowUndo && state.undoStack.length > 0 ? `
                <button onclick="SmartPlannerApp.undoLastAction();this.closest('#activeSmartToast')?.remove();"
                    class="text-amber-300 font-semibold hover:underline">
                    Desfazer
                </button>
            ` : ''}
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3600);
    }

    window.SmartPlannerApp = {
        switchTab,
        setCategoryFilterPill,
        clearAllFilters,
        toggleTaskExpand,
        toggleMatrixTaskExpand,
        addInlineSubtask,
        renderDashboardTasks,
        handleQuickInputPreview,
        submitQuickTask,
        runAutoSchedule,
        updateTaskPriorityInline,
        updateStudyPlanPreview,
        handleGenerateStudyPlan,
        updateSimulatorCalculation,
        startFocusOnTask,
        toggleFocusTimer,
        resetFocusTimer,
        completeFocusSessionEarly,
        openNewTaskModal,
        openNewTaskAtSlot,
        openEditTaskModal,
        closeTaskModal,
        setModalDurationPreset,
        updateModalLivePriorityPreview,
        toggleModalFixedTimeWrapper,
        applySuggestedSlotInModal,
        validateModalConflictLive,
        addModalSubtask,
        removeModalSubtask,
        toggleModalSubtaskDone,
        handleSaveTaskModal,
        openHelpModal,
        closeHelpModal,
        toggleTaskComplete,
        toggleSubtask,
        deleteTask,
        updateEnergyLevel,
        undoLastAction,
        toggleDarkMode,
        exportAgendaJson,
        triggerImportJson,
        handleImportJsonFile,
        resetDemoData
    };
})();
