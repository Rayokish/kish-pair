const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8000;

console.log('🚀 Starting KISH-MD server...');

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Health check route (should always work)
app.get('/health', (req, res) => {
  console.log('✅ Health check passed');
  res.status(200).json({ 
    status: 'OK', 
    message: 'KISH-MD Server is running',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Main route
app.get('/', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'index.html'));
  } catch (error) {
    console.error('Error serving main page:', error);
    res.send('KISH-MD Server is running');
  }
});

// Other routes with error handling
app.get('/pair', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'pair.html'));
  } catch (error) {
    console.error('Error serving pair page:', error);
    res.status(500).send('Pair page temporarily unavailable');
  }
});

app.get('/qr', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'qr.html'));
  } catch (error) {
    console.error('Error serving QR page:', error);
    res.status(500).send('QR page temporarily unavailable');
  }
});

app.get('/fork-check', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'fork-check.html'));
  } catch (error) {
    console.error('Error serving fork-check page:', error);
    res.status(500).send('Fork check page temporarily unavailable');
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).send('Internal server error');
});

// 404 handler
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ KISH-MD Server started successfully on port ${PORT}`);
  console.log(`🌐 Main URL: https://pair.kishtechsite.online/`);
}).on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});
