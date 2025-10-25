// Extract conflict training data from entries and receipt_edit_log
// Usage: node extract_conflicts.js > conflict_train.jsonl
// Each JSONL line: {"task":"conflict","candidates":[...],"resolved":"...","context_before":[...],"context_after":[...]}

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(path.join(__dirname, 'kakebo.db'));

function zen2han(s){return s? s.replace(/[０-９]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFF10+0x30)):s;}

function main(){
  db.all(`SELECT id, ocr_text, ocr_candidates_json FROM entries WHERE ocr_candidates_json IS NOT NULL AND length(ocr_candidates_json) > 2`, [], (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    rows.forEach(row => {
      let candidatesRaw = [];
      try { candidatesRaw = JSON.parse(row.ocr_candidates_json); } catch {}
      if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) return;
      // Rebuild merged lines & detect conflicts similar to server logic
      const engineTexts = candidatesRaw.map(r => (r.text||''));
      const lineArrays = engineTexts.map(t => t.split(/\n+/).map(l=>l.trim()).filter(Boolean));
      const maxLen = Math.max(...lineArrays.map(a=>a.length));
      const merged = [];
      for (let i=0;i<maxLen;i++) {
        const linesAtI = lineArrays.map(a=>a[i]||'').filter(l=>l.length>0);
        if (!linesAtI.length) continue;
        // majority pick
        const freq = {};
        linesAtI.forEach(l=>freq[l]=(freq[l]||0)+1);
        let best=null,bestCnt=0; Object.entries(freq).forEach(([k,c])=>{if(c>bestCnt){best=k;bestCnt=c;}});
        merged.push(best);
        const uniqueCnt = Object.keys(freq).length;
        const conflict = bestCnt < 2 && uniqueCnt >= 2;
        if (conflict) {
          const before = i>0? [merged[i-1]]: [];
          const after = (i+1<maxLen)? lineArrays.map(a=>a[i+1]||'').filter(l=>l).slice(0,1): [];
          // resolved value may appear later in receipt_edit_log; naive: use majority best as label
          const resolved = best;
          const candidates = linesAtI;
          const record = {
            task: 'conflict',
            receipt_id: row.id,
            line_index: i,
            candidates: candidates,
            resolved: resolved,
            context_before: before,
            context_after: after
          };
          process.stdout.write(JSON.stringify(record)+"\n");
        }
      }
    });
  });
}

main();
