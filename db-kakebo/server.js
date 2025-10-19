const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');

const app = express();
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
            message: 'OCR処理が完了しました。',
            filePath: req.file.path,
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

app.listen(port, () => {
    console.log(`db-kakebo server listening at http://localhost:${port}`);
});
