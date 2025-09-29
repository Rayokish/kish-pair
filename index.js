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

// Fix CORS manually
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Serve static files from root directory
app.use(express.static(path.join(__dirname)));

// Routes
app.use('/code', pairRouter);
app.use('/qr-api', qrRouter);

// HTML Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'KISH-MD Pairing Service is running',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 KISH-MD Server running on port ${PORT}`);
  console.log(`🌐 Main URL: https://pair.kishtechsite.online/`);
  console.log(`📱 Pair Code: https://pair.kishtechsite.online/pair`);
  console.log(`📷 QR Code: https://pair.kishtechsite.online/qr`);
  console.log(`🔍 Fork Check: https://pair.kishtechsite.online/fork-check`);
});
