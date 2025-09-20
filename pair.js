const { makeWASocket, makeInMemoryStore, fetchLatestBaileysVersion, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Custom auth state management (replaces useMultiFileAuthState)
const authState = {
  state: {
    creds: null,
    keys: null
  },
  saveCreds: () => {
    try {
      if (!fs.existsSync('./auth')) {
        fs.mkdirSync('./auth');
      }
      if (authState.state.creds) {
        fs.writeFileSync('./auth/creds.json', JSON.stringify(authState.state.creds));
      }
      if (authState.state.keys) {
        fs.writeFileSync('./auth/keys.json', JSON.stringify(authState.state.keys));
      }
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  },
  loadCreds: () => {
    try {
      if (fs.existsSync('./auth/creds.json')) {
        authState.state.creds = JSON.parse(fs.readFileSync('./auth/creds.json'));
      }
      if (fs.existsSync('./auth/keys.json')) {
        authState.state.keys = JSON.parse(fs.readFileSync('./auth/keys.json'));
      }
      return authState.state;
    } catch (error) {
      console.error('Error loading credentials:', error);
      return { creds: null, keys: null };
    }
  }
};

const clientstart = async() => {
  const store = makeInMemoryStore({
    logger: pino().child({
      level: "silent",
      stream: "store"
    })
  });
  
  const state = authState.loadCreds();
  
  const client = makeWASocket({
    logger: pino({ level: "silent" }),
    printQRInTerminal: !config.status.terminal,
    version: [2, 3000, 1023223821],
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  // Handle connection updates
  client.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    // Request pairing code at the right time
    if ((connection === "connecting" || qr) && !client.authState.creds.registered) {
      try {
        const phoneNumber = await question("/> please enter your WhatsApp number, starting with 62:\n> number: ");
        const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
        const code = await client.requestPairingCode(cleanNumber);
        console.log(`your pairing code: ${code}`);
      } catch (error) {
        console.error("Pairing code error:", error);
      }
    }
    
    if (connection === "open") {
      console.log("Successfully connected to WhatsApp!");
    }
    
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('Connection closed with status:', statusCode);
      
      // Reconnect if not logged out
      if (statusCode !== DisconnectReason.loggedOut && statusCode !== 401) {
        setTimeout(clientstart, 5000);
      } else {
        console.log("Connection closed permanently");
        // Clean up auth files
        if (fs.existsSync('./auth/creds.json')) fs.unlinkSync('./auth/creds.json');
        if (fs.existsSync('./auth/keys.json')) fs.unlinkSync('./auth/keys.json');
      }
    }
  });

  // Save credentials when updated
  client.ev.on('creds.update', authState.saveCreds);
  
  store.bind(client.ev);
}

clientstart();
