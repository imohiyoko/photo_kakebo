const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const tmp = require('tmp');
const FormData = require('form-data');
const fetch = require('node-fetch');
const { db } = require('../infra/db');
const { aggregateOcr, parseOcrText, extractItemLines, callLLMConflicts, runTesseract, applyAutoDict } = require('../services/ocrUtils');

const uploadDir = path.join(process.cwd(),'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, uploadDir),
  filename: (req,file,cb)=> cb(null, file.fieldname+'-'+Date.now()+path.extname(file.originalname))
});
const upload = multer({ storage });

// シングルOCR (Tesseract)
router.post('/upload', upload.single('receipt'), async (req,res)=>{
  if(!req.file) return res.status(400).send('ファイルが選択されていません。');
  let ocrInputPath = req.file.path;
  // 前処理
  try {
    const form = new FormData();
    form.append('image', fs.createReadStream(req.file.path));
    const preprocessApiUrl = process.env.PREPROCESS_API_URL || 'http://localhost:5001/crop_receipt';
    const resp = await fetch(preprocessApiUrl,{method:'POST', body: form});
    if(resp.ok){
      const tmpFile = tmp.fileSync({ postfix: '.jpg', keep:true });
      const dest = fs.createWriteStream(tmpFile.name);
      await new Promise((resolve,reject)=>{ resp.body.pipe(dest); resp.body.on('end',resolve); resp.body.on('error',reject); });
      ocrInputPath = tmpFile.name;
    }
  } catch{}
  try {
    const textRaw = await runTesseract(ocrInputPath);
    const text = applyAutoDict(textRaw);
    const extracted = parseOcrText(text);
    const imagePath = '/uploads/' + path.basename(req.file.path);
    db.run(`INSERT INTO entries (image_path, ocr_text, store_name, purchase_date, total_amount, tokens_json, model_version) VALUES (?,?,?,?,?,?,?)`,
      [imagePath, text, extracted.storeName, extracted.purchaseDate, extracted.totalAmount, JSON.stringify([]), 'ocr_v1.0.0'], function(err){
        if(err) return res.status(500).json({ error:'db insert failed'});
        res.json({ id: this.lastID, filePath: imagePath, ocrText: text, extractedData: extracted });
      });
  } catch(e){
    res.status(500).json({ error: 'OCR失敗', detail: e.message });
  }
});

// マルチOCR
router.post('/upload_multi', upload.single('receipt'), async (req,res)=>{
  if(!req.file) return res.status(400).send('ファイルが選択されていません。');
  let ocrInputPath = req.file.path;
  try {
    const form = new FormData(); form.append('image', fs.createReadStream(req.file.path));
    const preprocessApiUrl = process.env.PREPROCESS_API_URL || 'http://localhost:5001/crop_receipt';
    const resp = await fetch(preprocessApiUrl,{method:'POST', body: form});
    if(resp.ok){ const tmpFile= tmp.fileSync({ postfix: '.jpg', keep:true }); const dest=fs.createWriteStream(tmpFile.name); await new Promise((resolve,reject)=>{ resp.body.pipe(dest); resp.body.on('end',resolve); resp.body.on('error',reject); }); ocrInputPath=tmpFile.name; }
  } catch{}
  let engines=[]; try { if(req.body.engines) engines = JSON.parse(req.body.engines); } catch{}
  if(!Array.isArray(engines) || !engines.length) engines=['tesseract'];
  const useLLM = req.body.use_llm === '1';
  const results=[];
  if(engines.includes('tesseract')){ try { const t=await runTesseract(ocrInputPath); results.push({ engine:'tesseract', text:t }); } catch{ results.push({ engine:'tesseract', text:'' }); } }
  if(engines.includes('paddle')){ try { const url=process.env.PADDLE_OCR_API_URL || 'http://localhost:3000/stub/paddle_ocr'; const form2=new FormData(); form2.append('image', fs.createReadStream(ocrInputPath)); const r=await fetch(url,{method:'POST', body: form2}); const j= r.ok ? await r.json():{}; results.push({ engine:'paddle', text: applyAutoDict(j.text||'')}); } catch{ results.push({ engine:'paddle', text:''}); } }
  if(engines.includes('trocr')){ try { const url=process.env.TROCR_API_URL || 'http://localhost:3000/stub/trocr_ocr'; const form3=new FormData(); form3.append('image', fs.createReadStream(ocrInputPath)); const r=await fetch(url,{method:'POST', body: form3}); const j= r.ok ? await r.json():{}; results.push({ engine:'trocr', text: applyAutoDict(j.text||'')}); } catch{ results.push({ engine:'trocr', text:''}); } }
  const agg = aggregateOcr(results);
  let finalText = agg.aggregatedText;
  let llmResolutions = [];
  let llmLatency = null;
  if(useLLM && agg.conflicts.length>0){ const r = await callLLMConflicts(agg); finalText=r.text; llmResolutions=r.resolutions; llmLatency=r.latency; }
  const extracted = parseOcrText(finalText);
  const imagePath = '/uploads/' + path.basename(req.file.path);
  db.run(`INSERT INTO entries (image_path, ocr_text, store_name, purchase_date, total_amount, tokens_json, model_version, ocr_candidates_json) VALUES (?,?,?,?,?,?,?,?)`,
    [imagePath, finalText, extracted.storeName, extracted.purchaseDate, extracted.totalAmount, JSON.stringify([]), 'multi_ocr_v1.0.0', JSON.stringify(results)], function(err){
      if(err) return res.status(500).json({ error:'db insert failed'});
      if(useLLM && agg.conflicts.length>0){ const fallbackUsed = llmResolutions.some(r=>r.fallback)?1:0; db.run('INSERT INTO llm_logs (entry_id,line_count,latency_ms,fallback_used,model_version) VALUES (?,?,?,?,?)',[this.lastID, agg.conflicts.length, llmLatency||0, fallbackUsed, process.env.LLM_MODEL_VERSION||'stub_v0']); }
      res.json({ id:this.lastID, filePath:imagePath, aggregatedText:finalText, extractedData:extracted, engines:agg.engines, conflicts:agg.conflicts, rawResults:results, llmResolutions, llmLatency });
    });
});

// Stub endpoints
router.post('/stub/paddle_ocr', upload.single('image'), (req,res)=>{ const base='レシート サンプル 店舗A 合計 1234'; res.json({ text: base+' PADDLE'}); });
router.post('/stub/trocr_ocr', upload.single('image'), (req,res)=>{ const base='レシート サンプル 店舗A 合計 1234'; res.json({ text: base+' TROCR'}); });

module.exports = router;
