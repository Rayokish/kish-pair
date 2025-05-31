const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8000;
const pairRouter = require('./pair');
const qrRouter = require('./qr');

// Increase event listeners limit
require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static files
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets'))); // For CSS/images

// Routes
app.use('/code', pairRouter);
app.use('/qr-api', qrRouter); // API endpoint for QR generation

// HTML Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'pair.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 Kish Pairing Server Running!');
  console.log(`🌐 Access at: http://localhost:${PORT}`);
});
