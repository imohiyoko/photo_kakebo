const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
app.post('/api/upload', upload.single('receiptImage'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('ファイルが選択されていません。');
    }

    // In a real application, you would now pass the file to the OCR system.
    // For now, we just confirm the upload.
    console.log(`Image uploaded: ${req.file.path}`);
    
    res.json({
        message: 'ファイルが正常にアップロードされました。',
        filePath: req.file.path,
        // As a placeholder, we return some dummy OCR text.
        ocrText: "領収書\n株式会社サンプル\n2025年10月19日\n\n品名: コーヒー, 金額: 450円\n品名: ケーキ, 金額: 600円\n\n合計: 1050円"
    });
});

app.listen(port, () => {
    console.log(`db-kakebo server listening at http://localhost:${port}`);
});
