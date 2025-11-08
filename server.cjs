require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const apiRouter = require('./routes/api.cjs');
app.use('/api', apiRouter);

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`✅ Dashboard running on http://${HOST}:${PORT}`);
});
