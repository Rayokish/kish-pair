const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 8000;

// Import routers
const pairRouter = require('./pair');
const qrRouter = require('./qr');

// Increase event listeners limit
require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS for all routes

// Static files
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// API Routes
app.use('/code', pairRouter);
app.use('/qr-api', qrRouter); // QR generation endpoint

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 WhatsApp Pairing Server Running!');
  console.log(`🌐 Access at: http://localhost:${PORT}`);
  console.log(`🔗 QR Endpoint: http://localhost:${PORT}/qr-api`);
  console.log(`📱 Pairing Endpoint: http://localhost:${PORT}/code`);
});
