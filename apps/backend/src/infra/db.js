const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(process.cwd(),'kakebo.db'));

function initSchema() {
  // entries
  db.run(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path TEXT NOT NULL,
    ocr_text TEXT,
    corrected_text TEXT,
    total_amount INTEGER,
    store_name TEXT,
    purchase_date DATE,
    tokens_json TEXT,
    model_version TEXT,
    ocr_candidates_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run('ALTER TABLE entries ADD COLUMN ocr_candidates_json TEXT', ()=>{});

  // model_version
  db.run(`CREATE TABLE IF NOT EXISTS model_version (
    version_id INTEGER PRIMARY KEY AUTOINCREMENT,
    component TEXT NOT NULL,
    version TEXT NOT NULL,
    deployed_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // receipt_edit_log
  db.run(`CREATE TABLE IF NOT EXISTS receipt_edit_log (
    edit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    edit_type TEXT,
    ocr_confidence REAL,
    model_version TEXT,
    user_id TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // user_flags
  db.run(`CREATE TABLE IF NOT EXISTS user_flags (
    user_id TEXT PRIMARY KEY,
    provide_training_data INTEGER DEFAULT 0,
    local_training_enabled INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // training_data
  db.run(`CREATE TABLE IF NOT EXISTS training_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    entry_id INTEGER,
    image_path TEXT,
    corrected_text TEXT,
    store_name TEXT,
    purchase_date TEXT,
    total_amount INTEGER,
    image_hash TEXT,
    sync_status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // llm_logs
  db.run(`CREATE TABLE IF NOT EXISTS llm_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER,
    line_count INTEGER,
    latency_ms INTEGER,
    fallback_used INTEGER,
    model_version TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_receipt_edit_entry ON receipt_edit_log(entry_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_receipt_edit_field ON receipt_edit_log(field_name)');
}

initSchema();
module.exports = { db };
