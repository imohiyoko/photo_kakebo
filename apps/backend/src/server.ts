import 'dotenv/config';
import express, { Application } from 'express';
import path from 'path';
import { db } from './infra/db'; // ensure schema init side-effects

// Routers (JS files allowed via allowJs)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const entriesRouter = require('./routes/entries');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const flagsRouter = require('./routes/flags');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const trainingRouter = require('./routes/training');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const llmRouter = require('./routes/llm');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ocrRouter = require('./routes/ocr');

const app: Application = express();
app.use(express.json());

// Static legacy frontends (will migrate to apps/user-web & apps/admin)
app.use('/', express.static(path.join(process.cwd(),'frontend')));
app.use('/admin', express.static(path.join(process.cwd(),'admin')));

// Consolidated route mounts
app.use('/api', entriesRouter);          // entries endpoints
app.use('/api', flagsRouter);            // user flags & opt-in
app.use('/api', trainingRouter);         // training data mgmt
app.use('/api', llmRouter);              // llm meta/logs
app.use('/', ocrRouter);                 // upload endpoints

const port = process.env.PORT || 3001;
app.listen(port, () => {
  // Simple readiness log; could expand to health check pattern later
  console.log(`Modular backend (TS) running http://localhost:${port}`);
});

export { app, db };