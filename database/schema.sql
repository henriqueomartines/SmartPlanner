-- =============================================================================
-- SmartPlanner (Agenda Inteligente Determinística) — Esquema Relacional SQLite
-- Compatível com Node.js v24+ (node:sqlite)
-- =============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Geral' CHECK (category IN ('Acadêmico', 'Trabalho', 'Pessoal', 'Geral')),
    deadline TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 60 CHECK (duration >= 5 AND duration <= 720),
    urgency REAL NOT NULL DEFAULT 3.0 CHECK (urgency >= 1.0 AND urgency <= 5.0),
    importance REAL NOT NULL DEFAULT 3.0 CHECK (importance >= 1.0 AND importance <= 5.0),
    is_fixed INTEGER NOT NULL DEFAULT 0 CHECK (is_fixed IN (0, 1)),
    start_time TEXT DEFAULT NULL,
    end_time TEXT DEFAULT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    actual_minutes INTEGER NOT NULL DEFAULT 0,
    study_method TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    position INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    minutes INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
