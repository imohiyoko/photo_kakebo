const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json()); // Add this line to parse JSON bodies
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const port = 3000;

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

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
app.post('/api/upload', upload.single('receiptImage'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('ファイルが選択されていません。');
    }

    console.log(`Image uploaded: ${req.file.path}`);
    console.log('Starting OCR process...');

    try {
        const worker = await createWorker({
            logger: m => console.log(m), // OCRの進捗をログに出力
        });
        await worker.loadLanguage('jpn');
        await worker.initialize('jpn');
        const { data: { text } } = await worker.recognize(req.file.path);
        console.log('OCR Result:');
        console.log(text);
        await worker.terminate();

        res.json({
            message: 'File uploaded successfully!',
            filePath: `/uploads/${req.file.filename}`,
            ocrText: text
        });

        // Insert initial data into the database
        db.run(`INSERT INTO entries (image_path, ocr_text) VALUES (?, ?)`,
            [`/uploads/${req.file.filename}`, text], function(err) {
            if (err) {
                return console.error(err.message);
            }
            console.log(`A row has been inserted with rowid ${this.lastID}`);
            // We can optionally send this ID to the frontend if needed for subsequent updates.
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

    // Here, we find the entry by image_path and update it.
    // A more robust approach might use the ID returned upon creation.
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
