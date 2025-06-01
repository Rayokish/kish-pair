const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;

// Import routers
const pairRouter = require('./routes/pair.js');
const qrRouter = require('./routes/qr.js');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Static files
app.use('/assets', express.static(path.join(__dirname, '../public/assets')));

// Routes
app.use('/code', pairRouter);
app.use('/qr-api', qrRouter);

// HTML Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/main.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/pair.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, '../views/qr.html'));
});

// Start server
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}
