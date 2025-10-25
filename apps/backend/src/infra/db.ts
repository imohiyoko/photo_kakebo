import path from 'path';
import sqlite3 from 'sqlite3';

const db = new sqlite3.Database(path.join(process.cwd(), 'kakebo.db'));

export function initSchema(): void {
  db.serialize(() => {
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
    )`, (err) => { if (err) console.error('entries table:', err); });

    db.run(`CREATE TABLE IF NOT EXISTS model_version (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      component TEXT NOT NULL,
      version TEXT NOT NULL,
      deployed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error('model_version table:', err); });

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
    )`, (err) => { if (err) console.error('receipt_edit_log table:', err); });

    db.run(`CREATE TABLE IF NOT EXISTS user_flags (
      user_id TEXT PRIMARY KEY,
      provide_training_data INTEGER DEFAULT 0,
      local_training_enabled INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error('user_flags table:', err); });

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
    )`, (err) => { if (err) console.error('training_data table:', err); });

    db.run(`CREATE TABLE IF NOT EXISTS llm_logs (
      log_id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER,
      line_count INTEGER,
      latency_ms INTEGER,
      fallback_used INTEGER,
      model_version TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`, (err) => { if (err) console.error('llm_logs table:', err); });

    db.run('CREATE INDEX IF NOT EXISTS idx_receipt_edit_entry ON receipt_edit_log(entry_id)', (err) => { if (err) console.error('idx_receipt_edit_entry:', err); });
    db.run('CREATE INDEX IF NOT EXISTS idx_receipt_edit_field ON receipt_edit_log(field_name)', (err) => { if (err) console.error('idx_receipt_edit_field:', err); });
  });
}

export { db };
