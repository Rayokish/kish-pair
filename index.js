const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const app = express();

const PORT = process.env.PORT || 8000;
const ROOT_DIR = path.resolve(__dirname);

require('events').EventEmitter.defaultMaxListeners = 500;

// Routers
const pairRouter = require('./pair');
const qrRouter = require('./qr');

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static assets (HTML, CSS, JS, MP3, etc.)
app.use(express.static(path.join(ROOT_DIR, 'public')));

// Optional: CORS headers for frontend access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// API Routes
app.use('/code', pairRouter); // Handles session pairing logic
app.use('/qr', qrRouter);     // Handles QR generation

// Serve HTML pages
app.get('/pair', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'pair.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'public', 'main.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('✅ Welcome to Kish Pairing Server!');
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
});

module.exports = app;
