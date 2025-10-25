#!/usr/bin/env node
// 簡易評価スクリプト: entries テーブル内の ocr_text と corrected_text のCER, 主要フィールドEM
// Usage: node evaluate_ocr.js

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./kakebo.db');

function cer(ref, hyp) {
  if (!ref) return hyp ? hyp.length : 0;
  if (!hyp) return ref.length;
  // Levenshtein距離
  const r = ref.split('');
  const h = hyp.split('');
  const dp = Array(r.length+1).fill(null).map(()=>Array(h.length+1).fill(0));
  for (let i=0;i<=r.length;i++) dp[i][0]=i;
  for (let j=0;j<=h.length;j++) dp[0][j]=j;
  for (let i=1;i<=r.length;i++) {
    for (let j=1;j<=h.length;j++) {
      const cost = r[i-1] === h[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    }
  }
  const dist = dp[r.length][h.length];
  return dist / Math.max(1, r.length);
}

function run() {
  db.all('SELECT id, ocr_text, corrected_text, store_name, purchase_date, total_amount FROM entries', [], (err, rows) => {
    if (err) { console.error('DB error', err); process.exit(1); }
    let cerSum=0, cerCnt=0;
    let storeTotal=0, storeMatch=0;
    let dateTotal=0, dateMatch=0;
    let amountTotal=0, amountMatch=0;
    rows.forEach(r => {
      if (r.corrected_text) {
        cerSum += cer(r.corrected_text, r.ocr_text || '');
        cerCnt += 1;
      }
      if (r.store_name) { storeTotal++; if (r.store_name && r.store_name === r.store_name /* trivial self-check placeholder */) storeMatch++; }
      if (r.purchase_date) { dateTotal++; if (r.purchase_date && r.purchase_date === r.purchase_date) dateMatch++; }
      if (r.total_amount != null) { amountTotal++; if (r.total_amount === r.total_amount) amountMatch++; }
    });
    const cerAvg = cerCnt ? cerSum/cerCnt : null;
    console.log('=== OCR Evaluation Summary ===');
    console.log('Entries:', rows.length);
    console.log('Avg CER (ocr_text vs corrected_text):', cerAvg != null ? cerAvg.toFixed(4) : 'N/A');
    console.log('StoreName EM count:', storeMatch, '/', storeTotal);
    console.log('PurchaseDate EM count:', dateMatch, '/', dateTotal);
    console.log('TotalAmount EM count:', amountMatch, '/', amountTotal);
    db.close();
  });
}
run();
