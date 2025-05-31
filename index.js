const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require("body-parser");

const PORT = process.env.PORT || 8000;
const __path = process.cwd();

const pairRouter = require('./pair');
const qrRouter = require('./qr');

require('events').EventEmitter.defaultMaxListeners = 500;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/code', pairRouter); // Your pairing logic routes
app.use('/qr', qrRouter);     // QR code pairing display

// Serve HTML files
app.get('/pair', (req, res) => {
  res.sendFile(path.join(__path, 'pair.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__path, 'main.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(' Welcome to Kish Pairing Server! ');
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
