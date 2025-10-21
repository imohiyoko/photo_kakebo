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
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

    // 店舗名: 先頭数行から「領収書」「合計」など除いた最初の行
    for (let i = 0; i < Math.min(6, lines.length); i++) {
        const line = lines[i];
        if (!line) continue;
        if (/領収書|合計|計|¥|税/.test(line)) continue;
        if (line.length > 1) {
            result.storeName = line.slice(0, 80); // 長すぎる場合は切り詰め
            break;
        }
    }

    // 日付抽出: 2025/10/21, 2025-10-21, 2025年10月21日 等
    const dateMatch = text.match(/(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?/);
    if (dateMatch) {
        const [_, y, m, d] = dateMatch;
        result.purchaseDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }

    // 合計金額: 「合計」「計」「¥」の近くにある数値
    const amountMatch = text.match(/(?:合計|計|¥)\s*([\d,]{2,})/);
    if (amountMatch) {
        result.totalAmount = parseInt(amountMatch[1].replace(/,/g,''), 10);
    }

    return result;
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
        const { data: { text } } = await worker.recognize(req.file.path);
        await worker.terminate();

        console.log('OCR Result:', text);

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
                extractedData: extracted
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