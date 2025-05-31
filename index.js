const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8000;
const pairRouter = require('./pair');
const qrRouter = require('./qr');

require('events').EventEmitter.defaultMaxListeners = 500;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Static serving for assets like JS and MP3
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/song.mp3', express.static(path.join(__dirname, 'song.mp3')));

// Routes
app.use('/code', pairRouter);
app.use('/qr-api', qrRouter); // to avoid collision with /qr html

// Serve HTML directly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'pair.html'));
});

app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'qr.html'));
});

app.listen(PORT, () => {
  console.log(' Welcome to Kish Pairing Server! ');
  console.log(`Server running on http://localhost:${PORT}`);
});
