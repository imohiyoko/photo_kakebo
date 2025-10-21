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

// API endpoint for uploading an image
app.post('/upload', upload.single('receipt'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('ファイルが選択されていません。');
    }

    console.log(`Image uploaded: ${req.file.path}`);
    console.log('Starting OCR process...');

    try {
        const worker = await createWorker();
        await worker.loadLanguage('jpn');
        await worker.initialize('jpn');
        const { data: { text } } = await worker.recognize(req.file.path);
        await worker.terminate();

        console.log('OCR Result:', text);

        // Insert initial data into the database
        db.run(`INSERT INTO entries (image_path, ocr_text) VALUES (?, ?)`,
            [`/uploads/${req.file.filename}`, text], function(err) {
            if (err) {
                return console.error(err.message);
            }
            console.log(`A row has been inserted with rowid ${this.lastID}`);
        });

        res.json({
            message: 'File uploaded successfully!',
            filePath: `/uploads/${req.file.filename}`,
            ocrText: text
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
    const { imagePath, correctedText, totalAmount, storeName, purchaseDate } = req.body;

    if (!imagePath) {
        return res.status(400).json({ error: 'imagePath is required' });
    }

    db.run(`UPDATE entries SET corrected_text = ?, total_amount = ?, store_name = ?, purchase_date = ? WHERE image_path = ?`,
        [correctedText, totalAmount, storeName, purchaseDate, imagePath], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Failed to save data' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Entry not found for the given imagePath' });
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