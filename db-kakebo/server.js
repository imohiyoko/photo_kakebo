require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const sqlite3 = require('sqlite3').verbose();

const fetch = require('node-fetch');
const FormData = require('form-data');
const tmp = require('tmp');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const port = 3000;

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// Database setup
const db = new sqlite3.Database('./kakebo.db', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the kakebo database.');
});

// --- Schema setup (idempotent) ---
// entries テーブル（既存）。tokens_json, model_version列が無ければ追加。
db.run(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path TEXT NOT NULL,
    ocr_text TEXT,
    corrected_text TEXT,
    total_amount INTEGER,
    store_name TEXT,
    purchase_date DATE,
    tokens_json TEXT,
    model_version TEXT,
    ocr_candidates_json TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
// 既存DBに列が無い場合のALTER（失敗は握りつぶし）
db.run('ALTER TABLE entries ADD COLUMN ocr_candidates_json TEXT', ()=>{});

// モデルバージョン管理テーブル
db.run(`CREATE TABLE IF NOT EXISTS model_version (
    version_id INTEGER PRIMARY KEY AUTOINCREMENT,
    component TEXT NOT NULL,
    version TEXT NOT NULL,
    deployed_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

// ユーザー編集差分ログ
db.run(`CREATE TABLE IF NOT EXISTS receipt_edit_log (
    edit_id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    edit_type TEXT,
    ocr_confidence REAL,
    model_version TEXT,
    user_id TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
)`);

// インデックス（存在しない場合のみ作成）
db.run('CREATE INDEX IF NOT EXISTS idx_receipt_edit_entry ON receipt_edit_log(entry_id)');
db.run('CREATE INDEX IF NOT EXISTS idx_receipt_edit_field ON receipt_edit_log(field_name)');

// Set up storage for uploaded files
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir + '/')
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage });

// ========== 辞書自動補正ロード ==========
let autoDict = [];
function loadAutoDict() {
    try {
        const p = path.join(__dirname, 'ocr_autocorrect.json');
        if (fs.existsSync(p)) {
            autoDict = JSON.parse(fs.readFileSync(p, 'utf8'));
        } else {
            autoDict = [];
        }
    } catch (e) {
        console.warn('Failed to load ocr_autocorrect.json', e);
        autoDict = [];
    }
}
loadAutoDict();

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function applyAutoDict(text) {
    if (!text) return text;
    let out = text;
    autoDict.forEach(entry => {
        if (!entry.from || !entry.to) return;
        try {
            const pattern = new RegExp(escapeReg(entry.from), 'g');
            out = out.replace(pattern, entry.to);
        } catch {}
    });
    return out;
}

// ========== 複数OCR結果集約ユーティリティ ==========
function splitLines(t) {
    if (!t) return [];
    return t.replace(/\r/g,'').split(/\n+/).map(l=>l.trim()).filter(l=>l.length>0);
}
function majorityVote(strings) {
    const freq = {};
    strings.forEach(s => { freq[s] = (freq[s]||0)+1; });
    let best = null, bestCnt = 0;
    Object.entries(freq).forEach(([s,c])=>{ if(c>bestCnt){best=s;bestCnt=c;} });
    return { value: best, count: bestCnt, total: strings.length };
}
function aggregateOcr(results) {
    // results: [{engine,text}]
    const lineArrays = results.map(r => splitLines(r.text));
    const maxLen = Math.max(...lineArrays.map(a=>a.length));
    const mergedLines = [];
    const conflicts = [];
    for (let i=0;i<maxLen;i++) {
        const candidates = lineArrays.map(a => a[i] || '').filter(c=>c.length>0);
        if (candidates.length===0) continue;
        const vote = majorityVote(candidates);
        const isConflict = vote.count < 2 && candidates.length >= 2; // 全て不一致
        mergedLines.push(vote.value);
        if (isConflict) conflicts.push({ lineIndex: i, candidates });
    }
    const aggregatedText = mergedLines.join('\n');
    return { aggregatedText, mergedLines, conflicts, engines: results.map(r=>r.engine) };
}

// ====== LLM擬似解決（ヒューリスティック） ======
function llmResolveConflicts(agg) {
    const lines = agg.mergedLines.slice();
    const resolutions = [];
    for (const conflict of agg.conflicts) {
        // 最長候補 or 先頭 (簡易)
        let chosen = conflict.candidates.slice().sort((a,b)=>b.length - a.length)[0] || '';
        resolutions.push({ lineIndex: conflict.lineIndex, resolved: chosen, candidates: conflict.candidates });
        lines[conflict.lineIndex] = chosen;
    }
    return { resolutions, newText: lines.join('\n') };
}

// ========== ユーティリティ: ユーザーID匿名化 & 差分抽出 ==========
const crypto = require('crypto');
function anonymizeUser(rawId) {
    if (!rawId) return null;
    return crypto.createHash('sha256').update(String(rawId)).digest('hex').slice(0,16);
}

function diffEntryFields(original, edited) {
    const diffs = [];
    const fields = new Set([...Object.keys(original), ...Object.keys(edited)]);
    fields.forEach(f => {
        const oldVal = original[f];
        const newVal = edited[f];
        if (oldVal === newVal) return;
        let editType = 'replace';
        if ((oldVal == null || oldVal === '') && (newVal != null && newVal !== '')) editType = 'add';
        if ((oldVal != null && oldVal !== '') && (newVal == null || newVal === '')) editType = 'delete';
        diffs.push({ field_name: f, old_value: oldVal, new_value: newVal, edit_type: editType });
    });
    return diffs;
}

// ------ OCRテキスト解析ヘルパー関数 ------
// シンプルなヒューリスティックで店舗名/日付/合計金額を抽出
function parseOcrText(text) {
    const result = { storeName: null, purchaseDate: null, totalAmount: null };
    if (!text) return result;
    const norm = text.replace(/\r/g,'');
    const lines = norm.split(/\n+/).map(l => l.trim()).filter(l => l);

    // 店舗名候補: 先頭10行から除外語を取り除いた最初の行 (英字・カタカナ・漢字混在可)
    const skipPattern = /領収書|合計|計|¥|￥|税|小計|TEL|電話|〒|http|https|会員|ポイント|有効期限/;
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i];
        if (!line) continue;
        if (skipPattern.test(line)) continue;
        // 過度に数字のみ・記号のみは除外
        if (/^[0-9¥￥,.\-\s]+$/.test(line)) continue;
        result.storeName = line.slice(0,80);
        break;
    }

    // 日付抽出: 年月日の多様式 (半角/全角数字対応)
    const zen2han = s => s.replace(/[０-９]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFF10+0x30));
    const datePattern = /(20[0-9]{2})[\/\-年]\s*([0-9０-９]{1,2})[\/\-月]\s*([0-9０-９]{1,2})日?/;
    const dateMatch = norm.match(datePattern);
    if (dateMatch) {
        const y = dateMatch[1];
        const m = zen2han(dateMatch[2]).padStart(2,'0');
        const d = zen2han(dateMatch[3]).padStart(2,'0');
        result.purchaseDate = `${y}-${m}-${d}`;
    }

    // 金額候補抽出: 合計行優先。次に最大金額。全角数字を半角に変換。
    // パターン1: 合計/計/総計 の近く
    const amountCandidates = [];
    const amountLinePattern = /(?:合計|総計|計)[^\n]{0,20}?([0-9０-９¥￥,\. ]{2,})/g;
    let m1;
    while ((m1 = amountLinePattern.exec(norm)) !== null) {
        const raw = zen2han(m1[1]).replace(/[¥￥]/g,'').replace(/[, ]/g,'');
        if (/^[0-9]{2,}$/.test(raw)) amountCandidates.push(parseInt(raw,10));
    }
    // パターン2: 単独出現する通貨付き数値 (¥ 1234)
    const standalonePattern = /[¥￥]\s*([0-9０-９][0-9０-９, ]{1,})/g;
    let m2;
    while ((m2 = standalonePattern.exec(norm)) !== null) {
        const raw = zen2han(m2[1]).replace(/[, ]/g,'');
        if (/^[0-9]{2,}$/.test(raw)) amountCandidates.push(parseInt(raw,10));
    }
    // パターン3: "小計"行などからも参考に (後で重複排除)
    const subtotalPattern = /小計[^\n]{0,20}?([0-9０-９, ]{2,})/g;
    let m3;
    while ((m3 = subtotalPattern.exec(norm)) !== null) {
        const raw = zen2han(m3[1]).replace(/[, ]/g,'');
        if (/^[0-9]{2,}$/.test(raw)) amountCandidates.push(parseInt(raw,10));
    }
    // 過剰な異常値除外 (非常に大きい値 > 1,000,000 は除外)
    const filtered = amountCandidates.filter(v => v > 0 && v < 1000000);
    if (filtered.length > 0) {
        // 合計行があればそれ優先、なければ最大値
        result.totalAmount = filtered[0];
        // 合計らしき最大値を選択
        const max = Math.max(...filtered);
        if (max !== result.totalAmount) result.totalAmount = max;
    }

    return result;
}

// --- 行アイテム抽出: words配列から同一行クラスタリング ---
// words: [{text, bbox:[x0,y0,x1,y1]}...]
function extractItemLines(words) {
    if (!Array.isArray(words) || words.length === 0) return [];
    // y座標の中央値で近いものを同一行とみなす
    const lines = [];
    const sorted = words.slice().sort((a,b)=>((a.bbox[1]+a.bbox[3])/2)-((b.bbox[1]+b.bbox[3])/2));
    let currentLine = [], lastY = null;
    const yThreshold = 12; // ピクセル閾値（要調整）
    for (const w of sorted) {
        const cy = (w.bbox[1]+w.bbox[3])/2;
        if (lastY !== null && Math.abs(cy-lastY) > yThreshold && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = [];
        }
        currentLine.push(w);
        lastY = cy;
    }
    if (currentLine.length > 0) lines.push(currentLine);
    // 各行ごとにテキスト連結＋右端の価格候補抽出
    return lines.map(lineWords => {
        const sortedLine = lineWords.slice().sort((a,b)=>a.bbox[0]-b.bbox[0]);
        const text = sortedLine.map(w=>w.text).join(' ');
        // 右端の単語が金額っぽい場合のみ抽出
        const priceWord = sortedLine.slice(-1)[0];
        const priceMatch = priceWord.text.match(/[0-9０-９,]+/);
        return {
            text,
            price: priceMatch ? priceWord.text.replace(/[,]/g,'') : null,
            words: sortedLine
        };
    });
}

// API endpoint for uploading an image
app.post('/upload', upload.single('receipt'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('ファイルが選択されていません。');
    }

    console.log(`Image uploaded: ${req.file.path}`);
    console.log('Starting OCR process...');

    try {
        // 1. Python前処理APIへ画像送信
        let ocrInputPath = req.file.path;
        try {
            const form = new FormData();
            form.append('image', fs.createReadStream(req.file.path));
            const preprocessApiUrl = process.env.PREPROCESS_API_URL || 'http://localhost:5001/crop_receipt';
            const resp = await fetch(preprocessApiUrl, {
                method: 'POST',
                body: form
            });
            if (resp.ok) {
                // 一時ファイルに保存
                const tmpFile = tmp.fileSync({ postfix: '.jpg', keep: true });
                const dest = fs.createWriteStream(tmpFile.name);
                await new Promise((resolve, reject) => {
                    resp.body.pipe(dest);
                    resp.body.on('end', resolve);
                    resp.body.on('error', reject);
                });
                ocrInputPath = tmpFile.name;
                console.log('Preprocessed image saved:', ocrInputPath);
                // processedディレクトリにコピーして恒久保存
                const processedDir = path.join(__dirname, 'processed');
                if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);
                const processedPath = path.join(processedDir, path.basename(tmpFile.name));
                fs.copyFileSync(tmpFile.name, processedPath);
                console.log('Processed image copied to:', processedPath);
            } else {
                console.warn('Preprocess API error, fallback to original:', await resp.text());
            }
        } catch (e) {
            console.warn('Preprocess API failed, fallback to original:', e);
        }

        // 2. OCR
        const worker = await createWorker('jpn');
        const { data } = await worker.recognize(ocrInputPath);
        await worker.terminate();

    const textRaw = data.text;
    const text = applyAutoDict(textRaw);
        console.log('OCR Result:', text);

        // 単語ごとの座標情報抽出
        let words = [];
        if (Array.isArray(data.words)) {
            words = data.words.map(w => ({
                text: w.text,
                bbox: [w.bbox?.x0 ?? w.bbox?.x ?? 0, w.bbox?.y0 ?? w.bbox?.y ?? 0, w.bbox?.x1 ?? (w.bbox?.x0 ?? w.bbox?.x ?? 0) + (w.bbox?.w ?? 0), w.bbox?.y1 ?? (w.bbox?.y0 ?? w.bbox?.y ?? 0) + (w.bbox?.h ?? 0)]
            })).filter(w => w.text && w.text.length > 0);
        }

        // 行アイテム抽出（同一行クラスタリング＋右端価格推定）
        const itemLines = extractItemLines(words);

        // 追加: OCRテキストから抽出データ生成
        const extracted = parseOcrText(text);
        const imagePath = `/uploads/${req.file.filename}`;

        const tokens = Array.isArray(words) ? words.map(w => w.text).filter(Boolean) : [];
        const modelVersion = 'ocr_v1.0.0';

        // DB登録 (抽出された項目 + tokens)
        db.run(`INSERT INTO entries (image_path, ocr_text, store_name, purchase_date, total_amount, tokens_json, model_version) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [imagePath, text, extracted.storeName, extracted.purchaseDate, extracted.totalAmount, JSON.stringify(tokens), modelVersion], function(err) {
            if (err) {
                console.error(err.message);
                return res.status(500).json({ error: 'データベース登録に失敗しました' });
            }
            console.log(`A row has been inserted with rowid ${this.lastID}`);
            res.json({
                id: this.lastID,
                message: 'File uploaded & parsed successfully!',
                filePath: imagePath,
                ocrText: text,
                ocrTextRaw: textRaw,
                extractedData: extracted,
                words: words,
                itemLines: itemLines,
            });
        });

    } catch (error) {
        console.error('OCR処理中にエラーが発生しました:', error);
        res.status(500).json({
            message: 'OCR処理中にエラーが発生しました。',
            error: error.message
        });
    }
});

// API endpoint to save corrected text and other details
app.post('/api/save', (req, res) => {
    const { id, correctedText, totalAmount, storeName, purchaseDate } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'id is required' });
    }

    db.run(`UPDATE entries SET corrected_text = ?, total_amount = ?, store_name = ?, purchase_date = ? WHERE id = ?`,
        [correctedText, totalAmount, storeName, purchaseDate, id], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Failed to save data' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Entry not found for the given id' });
        }
        res.json({ message: 'Data saved successfully!' });
    });
});

// ===== ユーザー確定差分ログ収集API =====
app.post('/api/entries/:id/confirm', (req, res) => {
    const entryId = parseInt(req.params.id, 10);
    const { edited, userId } = req.body;
    if (!entryId || !edited) return res.status(400).json({ error: 'invalid parameters' });
    db.get('SELECT * FROM entries WHERE id = ?', [entryId], (err, row) => {
        if (err) return res.status(500).json({ error: 'db error' });
        if (!row) return res.status(404).json({ error: 'not found' });
        const original = {
            store_name: row.store_name,
            purchase_date: row.purchase_date,
            total_amount: row.total_amount,
            corrected_text: row.corrected_text
        };
        const diffs = diffEntryFields(original, edited);
        // 変更適用
        if (diffs.length) {
            const sets = [];
            const params = [];
            diffs.forEach(d => {
                sets.push(`${d.field_name} = ?`);
                params.push(d.new_value);
            });
            params.push(entryId);
            db.run(`UPDATE entries SET ${sets.join(', ')} WHERE id = ?`, params, (uErr) => {
                if (uErr) console.error('Update error', uErr);
            });
        }
        const stmt = db.prepare(`INSERT INTO receipt_edit_log (entry_id, field_name, old_value, new_value, edit_type, ocr_confidence, model_version, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        const version = row.model_version || 'ocr_v1.0.0';
        const anon = anonymizeUser(userId);
        diffs.forEach(d => {
            stmt.run(entryId, d.field_name, d.old_value ?? null, d.new_value ?? null, d.edit_type, null, version, anon);
        });
        stmt.finalize();
        res.json({ status: 'ok', diff_count: diffs.length });
    });
});

// 編集統計取得
app.get('/api/edit-stats', (req, res) => {
    db.all(`SELECT field_name, edit_type, COUNT(*) AS cnt FROM receipt_edit_log GROUP BY field_name, edit_type ORDER BY cnt DESC LIMIT 100`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'db error' });
        res.json(rows);
    });
});

// 改善候補（頻出置換）
app.get('/api/improvement-candidates', (req, res) => {
    db.all(`SELECT old_value, new_value, COUNT(*) AS cnt FROM receipt_edit_log WHERE edit_type = 'replace' AND old_value IS NOT NULL AND new_value IS NOT NULL GROUP BY old_value, new_value HAVING cnt >= 3 ORDER BY cnt DESC LIMIT 200`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'db error' });
        res.json(rows);
    });
});

// API endpoint to get all entries
app.get('/api/entries', (req, res) => {
    db.all("SELECT id, store_name, purchase_date, total_amount FROM entries ORDER BY purchase_date DESC", [], (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).json({ error: 'Failed to retrieve entries' });
            return;
        }
        res.json(rows);
    });
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

// ====== 複数OCRエンドポイント ======
// 環境変数: PADDLE_OCR_API_URL, TROCR_API_URL （未設定ならスタブ）
app.post('/upload_multi', upload.single('receipt'), async (req, res) => {
    if (!req.file) return res.status(400).send('ファイルが選択されていません。');
    const startTs = Date.now();
    let ocrInputPath = req.file.path;
    try {
        const form = new FormData();
        form.append('image', fs.createReadStream(req.file.path));
        const preprocessApiUrl = process.env.PREPROCESS_API_URL || 'http://localhost:5001/crop_receipt';
        const resp = await fetch(preprocessApiUrl, { method: 'POST', body: form });
        if (resp.ok) {
            const tmpFile = tmp.fileSync({ postfix: '.jpg', keep: true });
            const dest = fs.createWriteStream(tmpFile.name);
            await new Promise((resolve, reject) => { resp.body.pipe(dest); resp.body.on('end', resolve); resp.body.on('error', reject); });
            ocrInputPath = tmpFile.name;
        }
    } catch (e) { /* 前処理失敗は元画像 */ }
    // 選択エンジン取得
    let engines = [];
    try { if (req.body.engines) engines = JSON.parse(req.body.engines); } catch {}
    if (!Array.isArray(engines) || engines.length === 0) engines = ['tesseract'];
    const useLLM = req.body.use_llm === '1';

    const results = [];
    // Tesseract
    if (engines.includes('tesseract')) {
        try {
            const worker = await createWorker('jpn');
            const { data } = await worker.recognize(ocrInputPath);
            await worker.terminate();
            const text = applyAutoDict(data.text);
            results.push({ engine: 'tesseract', text });
        } catch (e) {
            results.push({ engine: 'tesseract', text: '' });
        }
    }
    // PaddleOCR API
    if (engines.includes('paddle')) {
        try {
            const paddleUrl = process.env.PADDLE_OCR_API_URL;
            if (paddleUrl) {
                const form2 = new FormData();
                form2.append('image', fs.createReadStream(ocrInputPath));
                const pr = await fetch(paddleUrl, { method: 'POST', body: form2 });
                if (pr.ok) {
                    const j = await pr.json();
                    results.push({ engine: 'paddle', text: applyAutoDict(j.text || '') });
                } else results.push({ engine: 'paddle', text: '' });
            } else {
                results.push({ engine: 'paddle', text: '' });
            }
        } catch { results.push({ engine: 'paddle', text: '' }); }
    }
    // TrOCR API
    if (engines.includes('trocr')) {
        try {
            const trocrUrl = process.env.TROCR_API_URL;
            if (trocrUrl) {
                const form3 = new FormData();
                form3.append('image', fs.createReadStream(ocrInputPath));
                const tr = await fetch(trocrUrl, { method: 'POST', body: form3 });
                if (tr.ok) {
                    const j = await tr.json();
                    results.push({ engine: 'trocr', text: applyAutoDict(j.text || '') });
                } else results.push({ engine: 'trocr', text: '' });
            } else {
                results.push({ engine: 'trocr', text: '' });
            }
        } catch { results.push({ engine: 'trocr', text: '' }); }
    }

    const agg = aggregateOcr(results);
    let finalText = agg.aggregatedText;
    let llmResolutions = [];
    if (useLLM && agg.conflicts.length > 0) {
        const llmUrl = process.env.LLM_API_URL ? `${process.env.LLM_API_URL.replace(/\/$/, '')}/resolve_conflicts` : null;
        if (llmUrl) {
            // 衝突行に前後1行の文脈を付与
            const conflictsPayload = agg.conflicts.map(cf => {
                const before = [];
                const after = [];
                if (cf.lineIndex > 0) before.push(agg.mergedLines[cf.lineIndex - 1]);
                if (cf.lineIndex + 1 < agg.mergedLines.length) after.push(agg.mergedLines[cf.lineIndex + 1]);
                return {
                    lineIndex: cf.lineIndex,
                    candidates: cf.candidates,
                    contextBefore: before,
                    contextAfter: after
                };
            });
            try {
                const resp = await fetch(llmUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ conflicts: conflictsPayload, task: 'conflict', model_version: 'stub_v0' })
                });
                if (resp.ok) {
                    const j = await resp.json();
                    if (Array.isArray(j.resolutions)) {
                        llmResolutions = j.resolutions;
                        // 衝突行を置換
                        const lines = agg.mergedLines.slice();
                        llmResolutions.forEach(r => {
                            if (typeof r.lineIndex === 'number' && r.lineIndex >=0 && r.lineIndex < lines.length) {
                                if (r.resolved) lines[r.lineIndex] = r.resolved;
                            }
                        });
                        finalText = lines.join('\n');
                    }
                } else {
                    console.warn('LLM service error status', resp.status);
                    const resolved = llmResolveConflicts(agg);
                    finalText = resolved.newText;
                    llmResolutions = resolved.resolutions.map(r => ({ ...r, fallback: true }));
                }
            } catch (e) {
                console.warn('LLM service unreachable, fallback heuristic', e.message);
                const resolved = llmResolveConflicts(agg);
                finalText = resolved.newText;
                llmResolutions = resolved.resolutions.map(r => ({ ...r, fallback: true }));
            }
        } else {
            // LLM未設定: 既存ヒューリスティック
            const resolved = llmResolveConflicts(agg);
            finalText = resolved.newText;
            llmResolutions = resolved.resolutions.map(r => ({ ...r, fallback: true }));
        }
    }
    const extracted = parseOcrText(finalText);
    const imagePath = `/uploads/${req.file.filename}`;
    const modelVersion = 'multi_ocr_v1.0.0';
    db.run(`INSERT INTO entries (image_path, ocr_text, store_name, purchase_date, total_amount, tokens_json, model_version, ocr_candidates_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [imagePath, finalText, extracted.storeName, extracted.purchaseDate, extracted.totalAmount, JSON.stringify([]), modelVersion, JSON.stringify(results)], function(err) {
            if (err) return res.status(500).json({ error: 'DB登録失敗', detail: err.message });
            res.json({
                id: this.lastID,
                filePath: imagePath,
                aggregatedText: finalText,
                extractedData: extracted,
                engines: agg.engines,
                conflicts: agg.conflicts,
                rawResults: results,
                llmResolutions,
                elapsedMs: Date.now() - startTs
            });
        });
});