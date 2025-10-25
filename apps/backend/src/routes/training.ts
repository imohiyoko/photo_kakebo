import express, { Request, Response } from 'express';
import { db } from '../infra/db';

const router = express.Router();

router.post('/training/upload', (req: Request, res: Response) => {
  const { user_id, entry_id, corrected_text, store_name, purchase_date, total_amount, image_path, image_hash } = req.body || {};
  if (!user_id || !corrected_text) return res.status(400).json({ error: 'user_id & corrected_text required' });
  db.get('SELECT provide_training_data, local_training_enabled FROM user_flags WHERE user_id=?', [user_id], (err: Error | null, row: any) => {
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row || !row.provide_training_data || row.local_training_enabled) return res.status(403).json({ error: 'not allowed' });
    db.run(
      `INSERT INTO training_data (user_id, entry_id, image_path, corrected_text, store_name, purchase_date, total_amount, image_hash) VALUES (?,?,?,?,?,?,?,?)`,
      [user_id, entry_id || null, image_path || null, corrected_text, store_name || null, purchase_date || null, total_amount || null, image_hash || null],
      (e: Error | null) => {
        if (e) return res.status(500).json({ error: 'insert failed' });
        res.json({ status: 'ok' });
      }
    );
  });
});

router.get('/training/pending', (req: Request, res: Response) => {
  db.all('SELECT id,user_id,entry_id,store_name,purchase_date,total_amount,created_at FROM training_data WHERE sync_status="pending" ORDER BY id DESC LIMIT 200', [], (err: Error | null, rows: any[]) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

router.post('/training/mark_synced', (req: Request, res: Response) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids required' });
  const placeholders = ids.map(() => '?').join(',');
  db.run(`UPDATE training_data SET sync_status='synced' WHERE id IN (${placeholders})`, ids, (err: Error | null) => {
    if (err) return res.status(500).json({ error: 'update failed' });
    res.json({ status: 'ok', count: ids.length });
  });
});

function rowsToCsv(rows: any[]): string {
  if (!Array.isArray(rows) || !rows.length) return 'id,user_id,entry_id,store_name,purchase_date,total_amount,created_at\n';
  const header = ['id', 'user_id', 'entry_id', 'store_name', 'purchase_date', 'total_amount', 'created_at'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    lines.push(header.map(h => {
      let v = r[h];
      if (v == null) v = '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? '"' + s + '"' : s;
    }).join(','));
  });
  return lines.join('\n');
}

router.get('/training/export.json', (req: Request, res: Response) => {
  const status = req.query.status || 'pending';
  db.all('SELECT id,user_id,entry_id,store_name,purchase_date,total_amount,created_at,corrected_text FROM training_data WHERE sync_status=? ORDER BY id DESC', [status], (err: Error | null, rows: any[]) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

router.get('/training/export.csv', (req: Request, res: Response) => {
  const status = req.query.status || 'pending';
  db.all('SELECT id,user_id,entry_id,store_name,purchase_date,total_amount,created_at FROM training_data WHERE sync_status=? ORDER BY id DESC', [status], (err: Error | null, rows: any[]) => {
    if (err) return res.status(500).send('db error');
    const csv = rowsToCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="training_${status}.csv"`);
    res.send(csv);
  });
});

export = router;
