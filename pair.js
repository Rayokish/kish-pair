const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

// Configure logger
const logger = pino({ level: 'error' });

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).send({ error: "Number is required" });

    // Clean number
    num = num.replace(/[^0-9]/g, '');
    
    if (!num.match(/^\d{10,15}$/)) {
        return res.status(400).send({ error: "Invalid phone number format" });
    }

    let responseSent = false;
    let sock = null;

    async function XeonPair() {
        // Force cleanup of old session
        removeFile('./session');
        
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        
        try {
            sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger: logger,
                browser: Browsers.macOS("Safari"),
                syncFullHistory: false,
                connectTimeoutMs: 60000, // Increase connection timeout
                keepAliveIntervalMs: 10000, // Keep connection alive
                emitOwnEvents: true,
                defaultQueryTimeoutMs: 0, // No timeout for queries
                retryRequestDelayMs: 250 // Faster retry
            });

            // Save credentials when updated
            sock.ev.on('creds.update', saveCreds);

            // Handle connection updates
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                console.log("🔗 Connection update:", connection);
                
                if (connection === "open") {
                    console.log("✅ Connected to WhatsApp!");
                    
                    if (!responseSent) {
                        responseSent = true;
                        res.send({ 
                            code: "SUCCESS",
                            message: "Connected! Check your WhatsApp for credentials..."
                        });
                    }

                    // Wait for connection to stabilize
                    await delay(5000);
                    
                    try {
                        const userJid = sock.user?.id;
                        
                        if (userJid) {
                            console.log("📱 User JID:", userJid);
                            
                            // Read and send credentials file
                            const credsPath = path.join('./session', 'creds.json');
                            if (fs.existsSync(credsPath)) {
                                const credsData = fs.readFileSync(credsPath);
                                
                                console.log("📤 Sending credentials file...");
                                
                                // Send as document
                                await sock.sendMessage(userJid, {
                                    document: credsData,
                                    fileName: `creds_${Date.now()}.json`,
                                    mimetype: 'application/json'
                                });
                                
                                console.log("✅ Credentials file sent!");
                                
                                // Send security warning
                                await sock.sendMessage(userJid, { 
                                    text: `⚠️ *SECURITY WARNING* ⚠️\n\nThis file contains your WhatsApp session credentials for KISH-MD.\n\n*DO NOT SHARE THIS FILE WITH ANYONE!*\n\nKeep it secure and never expose it publicly.\n\nFile: creds_${Date.now()}.json` 
                                });
                                
                                console.log("✅ Security warning sent!");
                                
                                // Send success message
                                await sock.sendMessage(userJid, { 
                                    text: "✅ Session pairing completed successfully!\n\nYour credentials file has been sent. Use it with your KISH-MD bot." 
                                });
                                
                                console.log("✅ Success message sent!");
                                
                                // Wait for messages to be delivered
                                await delay(3000);
                                
                                console.log("🔄 Closing connection...");
                                
                                // Send completion notification
                                await sock.sendMessage(userJid, { 
                                    text: "🔒 Connection will now close for security." 
                                });
                                
                                await delay(2000);
                                
                                // Logout and cleanup
                                await sock.logout();
                                if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
                                    sock.ws.close();
                                }
                                removeFile('./session');
                                
                                console.log("✅ Cleanup completed!");
                            } else {
                                console.error("❌ Creds file not found!");
                                await sock.sendMessage(userJid, { 
                                    text: "❌ Error: Credentials file not generated. Please try again." 
                                });
                            }
                        } else {
                            console.error("❌ No user JID found!");
                        }
                        
                    } catch (sendError) {
                        console.error("❌ Error sending credentials:", sendError);
                        try {
                            const userJid = sock.user?.id;
                            if (userJid) {
                                await sock.sendMessage(userJid, { 
                                    text: `❌ Error: ${sendError.message}` 
                                });
                            }
                        } catch (e) {}
                        
                        // Cleanup on error
                        if (sock?.ws && sock.ws.readyState === sock.ws.OPEN) {
                            sock.ws.close();
                        }
                        removeFile('./session');
                    }
                }

                if (connection === "close") {
                    console.log("🔌 Connection closed");
                    
                    // Check if this was an intentional disconnect
                    const error = lastDisconnect?.error;
                    if (error) {
                        console.error("❌ Disconnect error:", error);
                        
                        // Only send error if not already responded
                        if (!responseSent) {
                            responseSent = true;
                            
                            // Check specific error types
                            if (error.message.includes("401") || error.message.includes("Not Authorized")) {
                                res.status(401).send({ 
                                    error: "Pairing failed. Please restart WhatsApp on your phone and try again." 
                                });
                            } else if (error.message.includes("timeout")) {
                                res.status(408).send({ 
                                    error: "Connection timeout. Please check your internet and try again." 
                                });
                            } else {
                                res.status(500).send({ 
                                    error: `Connection failed: ${error.message}` 
                                });
                            }
                        }
                    }
                    
                    // Cleanup
                    removeFile('./session');
                }

                // If QR is generated (for fallback)
                if (qr) {
                    console.log("📱 QR code generated");
                }
            });

            // Request pairing code
            console.log("🔐 Requesting pairing code for:", num);
            
            try {
                const code = await sock.requestPairingCode(num);
                console.log("✅ Pairing code:", code);
                
                if (!responseSent) {
                    responseSent = true;
                    res.send({ 
                        code: code,
                        message: "Enter this code in WhatsApp > Linked Devices"
                    });
                }
                
            } catch (pairError) {
                console.error("❌ Pairing code error:", pairError);
                
                if (!responseSent) {
                    responseSent = true;
                    
                    if (pairError.message.includes("already registered")) {
                        res.status(400).send({ 
                            error: "This number is already registered in session. Delete ./session folder and try again." 
                        });
                    } else if (pairError.message.includes("rate limit")) {
                        res.status(429).send({ 
                            error: "Rate limited. Please wait 5 minutes and try again." 
                        });
                    } else {
                        res.status(500).send({ 
                            error: `Failed to get pairing code: ${pairError.message}` 
                        });
                    }
                }
                
                // Cleanup on error
                if (sock?.ws && sock.ws.readyState === sock.ws.OPEN) {
                    sock.ws.close();
                }
                removeFile('./session');
            }

        } catch (initError) {
            console.error("❌ Initialization error:", initError);
            
            if (!responseSent) {
                responseSent = true;
                res.status(500).send({ 
                    error: `Setup failed: ${initError.message}` 
                });
            }
            
            // Cleanup
            if (sock?.ws && sock.ws.readyState === sock.ws.OPEN) {
                sock.ws.close();
            }
            removeFile('./session');
        }
    }

    // Set timeout
    const timeout = setTimeout(() => {
        if (!responseSent) {
            responseSent = true;
            res.status(408).send({ 
                error: "Request timeout. The pairing process is taking too long." 
            });
            
            if (sock?.ws && sock.ws.readyState === sock.ws.OPEN) {
                sock.ws.close();
            }
            removeFile('./session');
        }
    }, 180000); // 3 minutes

    // Clear timeout on response
    res.on('finish', () => {
        clearTimeout(timeout);
    });

    // Start pairing process
    XeonPair();
});

module.exports = router;
