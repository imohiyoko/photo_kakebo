const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const sqlite3 = require('sqlite3').verbose();

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

// Create table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path TEXT NOT NULL,
    ocr_text TEXT,
    corrected_text TEXT,
    total_amount INTEGER,
    store_name TEXT,
    purchase_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);

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
        const worker = await createWorker('jpn');
            const { data } = await worker.recognize(req.file.path);
        await worker.terminate();

            const text = data.text;
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

        // DB登録 (抽出された項目も保存)
        db.run(`INSERT INTO entries (image_path, ocr_text, store_name, purchase_date, total_amount) VALUES (?, ?, ?, ?, ?)`,
            [imagePath, text, extracted.storeName, extracted.purchaseDate, extracted.totalAmount], function(err) {
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