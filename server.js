/**
 * API kecil untuk dashboard pemantauan.
 * Baca logs.json yang ditulis oleh bot.js, sajikan sebagai JSON.
 *
 * npm install express cors
 * node server.js
 * -> dashboard fetch ke http://localhost:3001/api/logs
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const LOG_PATH = path.join(__dirname, 'logs.json');

app.get('/api/logs', (req, res) => {
  if (!fs.existsSync(LOG_PATH)) return res.json([]);
  const logs = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
  res.json(logs);
});

app.listen(3001, () => console.log('Dashboard API jalan di http://localhost:3001'));
