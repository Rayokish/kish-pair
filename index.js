const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Import routes
const qrRouter = require('./qr');
const pairRouter = require('./pair');

// Middleware
app.use('/qr-api', qrRouter);
app.use('/pair-api', pairRouter);

// Optional root route
app.get('/', (req, res) => {
  res.send('🟢 Server is running. Use /qr-api or /pair-api.');
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server is listening on port ${PORT}`);
});
