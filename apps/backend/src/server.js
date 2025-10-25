require('dotenv').config();
const express = require('express');
const path = require('path');
const { db } = require('./infra/db'); // ensure schema init

const entriesRouter = require('./routes/entries');
const flagsRouter = require('./routes/flags');
const trainingRouter = require('./routes/training');
const llmRouter = require('./routes/llm');
const ocrRouter = require('./routes/ocr');

const app = express();
app.use(express.json());

// Static frontends (legacy paths)
app.use('/', express.static(path.join(process.cwd(),'frontend')));
app.use('/admin', express.static(path.join(process.cwd(),'admin')));

// Mount routes (prefix grouping)
app.use('/api', entriesRouter);          // /api/save, /api/:id/confirm, /api/edit-stats, /api/improvement-candidates, /api (list entries)
app.use('/api', flagsRouter);            // /api/user/flags/*, /api/llm/optin
app.use('/api', trainingRouter);         // /api/training/*
app.use('/api', llmRouter);              // /api/llm/*
app.use('/', ocrRouter);                 // /upload, /upload_multi, /stub/*

const port = process.env.PORT || 3001; // new backend port (avoid clash with old server.js during migration)
app.listen(port, ()=>{
  console.log(`Modular backend running http://localhost:${port}`);
});

module.exports = app;
