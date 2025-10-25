const express = require('express');
const router = express.Router();
const { db } = require('../infra/db');

router.get('/llm/model/latest', (req,res)=>{
  const version = process.env.LLM_MODEL_VERSION || 'stub_v0';
  res.json({ version });
});

router.get('/llm/logs', (req,res)=>{
  const limit = parseInt(req.query.limit||'200',10);
  db.all('SELECT log_id,entry_id,line_count,latency_ms,fallback_used,model_version,created_at FROM llm_logs ORDER BY log_id DESC LIMIT ?', [limit], (err, rows)=>{
    if(err) return res.status(500).json({ error:'db error'});
    res.json(rows);
  });
});

module.exports = router;
