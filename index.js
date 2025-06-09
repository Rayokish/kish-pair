const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;

// Import routers
const pairRouter = require('./pair');
const qrRouter = require('./qr');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fix CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Serve static assets
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// API Routes
app.use('/api/pair', pairRouter);  // WhatsApp pairing API endpoint
app.use('/qr-api', qrRouter);      // QR code API endpoint (assuming you have a `qr.js` router)

// HTML Pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/fork-check', (req, res) => {
  res.sendFile(path.join(__dirname, 'fork-check.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'pair.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
