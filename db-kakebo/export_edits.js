// Weekly export of edit logs (past 7 days)
// Usage: node export_edits.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, 'kakebo.db'));

function esc(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return '"' + s + '"';
}

function main() {
  db.all(`SELECT entry_id, field_name, old_value, new_value, edit_type, model_version, timestamp
          FROM receipt_edit_log
          WHERE timestamp >= datetime('now', '-7 days')
          ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) {
      console.error('DB error', err);
      process.exit(1);
    }
    const header = 'entry_id,field_name,old_value,new_value,edit_type,model_version,timestamp';
    const lines = rows.map(r => [r.entry_id, r.field_name, esc(r.old_value), esc(r.new_value), r.edit_type, r.model_version, r.timestamp].join(','));
    const outPath = path.join(__dirname, 'export_last_week.csv');
    fs.writeFileSync(outPath, [header, ...lines].join('\n'), 'utf8');
    console.log('Export complete:', rows.length, 'rows ->', outPath);
    process.exit(0);
  });
}

main();
