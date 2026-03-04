const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In Docker the /app/data directory is a named volume (persistent).
// Locally it falls back to the project root.
const dataDir = fs.existsSync('/app/data') ? '/app/data' : __dirname;
const db = new Database(path.join(dataDir, 'assessment.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL UNIQUE,
    password_hash TEXT   NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS test_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id),
    module_id    TEXT    NOT NULL,
    module_name  TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    pct          REAL    NOT NULL,
    submitted_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS answers (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER NOT NULL REFERENCES test_sessions(id),
    question_index INTEGER NOT NULL,
    question_text  TEXT    NOT NULL,
    chosen_option  TEXT,
    correct_option TEXT    NOT NULL,
    is_correct     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS retake_grants (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id),
    module_id    TEXT    NOT NULL,
    granted_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(candidate_id, module_id)
  );

  CREATE TABLE IF NOT EXISTS modules (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    icon        TEXT    NOT NULL DEFAULT '📋',
    description TEXT    NOT NULL DEFAULT '',
    url         TEXT,
    module_type TEXT    NOT NULL DEFAULT 'quiz',
    is_active   INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id   TEXT    NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    question    TEXT    NOT NULL,
    opt0        TEXT,
    opt1        TEXT,
    opt2        TEXT,
    opt3        TEXT,
    correct_idx INTEGER,
    question_type TEXT  NOT NULL DEFAULT 'multiple_choice',
    model_answer TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS diagram_submissions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id  INTEGER NOT NULL REFERENCES candidates(id),
    module_id     TEXT    NOT NULL REFERENCES modules(id),
    module_name   TEXT    NOT NULL,
    scene_data    TEXT    NOT NULL,
    image_data    TEXT,
    submitted_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Migrations ──────────────────────────────────────────
// Safe to run on every boot — SQLite ignores duplicate column errors
try {
    db.exec(`ALTER TABLE modules ADD COLUMN module_type TEXT NOT NULL DEFAULT 'quiz'`);
    // Ensure the diagram-design module is flagged correctly
    db.prepare(`UPDATE modules SET module_type = 'diagram' WHERE id = 'diagram-design'`).run();
    console.log('🔧  Migration: added module_type column to modules table.');
} catch { /* column already exists — no-op */ }

// Migration: Add question_type and model_answer columns
try {
    db.exec(`ALTER TABLE questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'multiple_choice'`);
    console.log('🔧  Migration: added question_type column to questions table.');
} catch { /* column already exists — no-op */ }

try {
    db.exec(`ALTER TABLE questions ADD COLUMN model_answer TEXT`);
    console.log('🔧  Migration: added model_answer column to questions table.');
} catch { /* column already exists — no-op */ }

// Migration: Make opt columns nullable for open-ended questions
try {
    // SQLite doesn't support ALTER COLUMN, but we can add columns as nullable
    // For existing columns, we just need to ensure new questions handle nulls properly
    // The schema above already defines them as nullable for new tables
} catch { /* no-op */ }

module.exports = db;
