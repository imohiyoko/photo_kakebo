import express, { Request, Response } from 'express';
import { db } from '../infra/db';

const router = express.Router();

router.get('/user/flags/:uid', (req: Request, res: Response) => {
  const uid = req.params.uid;
  db.get('SELECT * FROM user_flags WHERE user_id=?', [uid], (err: Error | null, row: any) => {
    if (err) return res.status(500).json({ error: 'db error' });
    if (!row) return res.json({ user_id: uid, provide_training_data: 0, local_training_enabled: 0 });
    res.json(row);
  });
});

router.post('/user/flags', (req: Request, res: Response) => {
  const { user_id, provide_training_data, local_training_enabled } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const p = provide_training_data ? 1 : 0;
  const l = local_training_enabled ? 1 : 0;
  db.get('SELECT user_id FROM user_flags WHERE user_id=?', [user_id], (err: Error | null, row: any) => {
    if (err) return res.status(500).json({ error: 'db error' });
    if (row) {
      db.run(
        'UPDATE user_flags SET provide_training_data=?, local_training_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?',
        [p, l, user_id],
        (e: Error | null) => {
          if (e) return res.status(500).json({ error: 'update failed' });
          res.json({ status: 'ok' });
        }
      );
    } else {
      db.run(
        'INSERT INTO user_flags (user_id, provide_training_data, local_training_enabled) VALUES (?,?,?)',
        [user_id, p, l],
        (e: Error | null) => {
          if (e) return res.status(500).json({ error: 'insert failed' });
          res.json({ status: 'ok' });
        }
      );
    }
  });
});

router.get('/user/flags/all', (req: Request, res: Response) => {
  db.all('SELECT * FROM user_flags ORDER BY updated_at DESC LIMIT 500', [], (err: Error | null, rows: any[]) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json(rows);
  });
});

router.post('/llm/optin', (req: Request, res: Response) => {
  const { user_id, optin } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const val = optin ? 1 : 0;
  db.get('SELECT user_id FROM user_flags WHERE user_id=?', [user_id], (err: Error | null, row: any) => {
    if (err) return res.status(500).json({ error: 'db error' });
    if (row) {
      db.run('UPDATE user_flags SET provide_training_data=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?', [val, user_id]);
    } else {
      db.run('INSERT INTO user_flags (user_id, provide_training_data) VALUES (?,?)', [user_id, val]);
    }
    res.json({ status: 'ok', provide_training_data: val });
  });
});

export = router;
