import express, { Request, Response } from 'express';
import { db } from '../infra/db';

const router = express.Router();

router.get('/llm/model/latest', (req: Request, res: Response) => {
  const version = process.env.LLM_MODEL_VERSION || 'stub_v0';
  res.json({ version });
});

router.get('/llm/logs', (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '200', 10);
  db.all(
    'SELECT log_id,entry_id,line_count,latency_ms,fallback_used,model_version,created_at FROM llm_logs ORDER BY log_id DESC LIMIT ?',
    [limit],
    (err: Error | null, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'db error' });
      res.json(rows);
    }
  );
});

export = router;
