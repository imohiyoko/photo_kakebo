// Generate auto-correction dictionary from frequent replacements
// Usage: node update_ocr_dict.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, 'kakebo.db'));

const MIN_FREQ = 3; // threshold for inclusion
const MAX_LEN = 40;

db.all(`SELECT old_value, new_value, COUNT(*) AS cnt
        FROM receipt_edit_log
        WHERE edit_type = 'replace'
          AND old_value IS NOT NULL AND new_value IS NOT NULL
          AND length(old_value) <= ${MAX_LEN} AND length(new_value) <= ${MAX_LEN}
        GROUP BY old_value, new_value
        HAVING cnt >= ${MIN_FREQ}
        ORDER BY cnt DESC
        LIMIT 500`, [], (err, rows) => {
  if (err) {
    console.error('DB error', err);
    process.exit(1);
  }
  const dict = rows.map(r => ({ from: r.old_value, to: r.new_value, freq: r.cnt }));
  const outPath = path.join(__dirname, 'ocr_autocorrect.json');
  fs.writeFileSync(outPath, JSON.stringify(dict, null, 2), 'utf8');
  console.log('Dictionary updated:', dict.length, 'entries ->', outPath);
  process.exit(0);
});
