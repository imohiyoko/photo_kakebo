import express, { Request, Response } from 'express';
import { db } from '../infra/db';
import { diffEntryFields, anonymizeUser } from '../services/diff';

const router = express.Router();

router.post('/save', (req: Request, res: Response) => {
  const { id, correctedText, totalAmount, storeName, purchaseDate } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  db.run(
    `UPDATE entries SET corrected_text=?, total_amount=?, store_name=?, purchase_date=? WHERE id=?`,
    [correctedText, totalAmount, storeName, purchaseDate, id],
    function (err: Error | null) {
      if (err) return res.status(500).json({ error: 'db error' });
      if ((this as any).changes === 0) return res.status(404).json({ error: 'not found' });
      res.json({ message: 'Data saved successfully!' });
    }
  );
});

router.get('/', (req: Request, res: Response) => {
  db.all(
    'SELECT id, store_name, purchase_date, total_amount FROM entries ORDER BY purchase_date DESC',
    [],
    (err: Error | null, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'db error' });
      res.json(rows);
    }
  );
});

router.post('/:id/confirm', (req: Request, res: Response) => {
  const entryId = parseInt(req.params.id, 10);
  const { edited, userId } = req.body;
  if (!entryId || !edited) return res.status(400).json({ error: 'invalid parameters' });
  db.get('SELECT * FROM entries WHERE id=?', [entryId], (err: Error | null, row: any) => {
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row) return res.status(404).json({ error: 'not found' });
    const original = {
      store_name: row.store_name,
      purchase_date: row.purchase_date,
      total_amount: row.total_amount,
      corrected_text: row.corrected_text,
    };
    const diffs = diffEntryFields(original, edited);
    if (diffs.length) {
      const sets: string[] = [];
      const params: any[] = [];
      diffs.forEach((d) => {
        sets.push(`${d.field_name}=?`);
        params.push(d.new_value);
      });
      params.push(entryId);
      db.run(`UPDATE entries SET ${sets.join(', ')} WHERE id=?`, params, () => {});
    }
    const stmt = db.prepare(
      'INSERT INTO receipt_edit_log (entry_id, field_name, old_value, new_value, edit_type, ocr_confidence, model_version, user_id) VALUES (?,?,?,?,?,?,?,?)'
    );
    const version = row.model_version || 'ocr_v1.0.0';
    const anon = anonymizeUser(userId);
    diffs.forEach((d) =>
      stmt.run(entryId, d.field_name, d.old_value ?? null, d.new_value ?? null, d.edit_type, null, version, anon)
    );
    stmt.finalize();
    res.json({ status: 'ok', diff_count: diffs.length });
  });
});

router.get('/edit-stats', (req: Request, res: Response) => {
  db.all(
    `SELECT field_name, edit_type, COUNT(*) AS cnt FROM receipt_edit_log GROUP BY field_name, edit_type ORDER BY cnt DESC LIMIT 100`,
    [],
    (err: Error | null, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'db error' });
      res.json(rows);
    }
  );
});

router.get('/improvement-candidates', (req: Request, res: Response) => {
  db.all(
    `SELECT old_value, new_value, COUNT(*) AS cnt FROM receipt_edit_log WHERE edit_type='replace' AND old_value IS NOT NULL AND new_value IS NOT NULL GROUP BY old_value,new_value HAVING cnt>=3 ORDER BY cnt DESC LIMIT 200`,
    [],
    (err: Error | null, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'db error' });
      res.json(rows);
    }
  );
});

export = router;
