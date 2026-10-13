const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.API_BASE_URL = ${JSON.stringify(API_BASE_URL)};`);
});

app.listen(PORT, () => {
  console.log(`Frontend running on http://localhost:${PORT}`);
});
