const express = require('express');
const fs = require('fs');
const path = require('path');
let router = express.Router()
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys"); // Updated package name

// Configure logger
const logger = pino({ level: 'trace' }).child({ level: 'trace' })

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true })
};

router.get('/', async (req, res) => {
    let num = req.query.number;
    
    async function XeonPair() {
        const {
            state,
            saveCreds
        } = await useMultiFileAuthState(`./session`)
        
        try {
            let XeonBotInc = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger: logger,
                browser: ["Ubuntu", "Chrome", "114.0.0.0"], // Updated browser metadata
                getMessage: async () => ({}),
                syncFullHistory: false,
                fireInitQueries: false
            });

            // Phone number validation
            num = num.replace(/[^0-9]/g, '');
            if (!num.startsWith('')) {
                num = `91${num}`; // Add default country code (India)
            }

            if (!XeonBotInc.authState.creds.registered) {
                await delay(1500);
                
                const code = await retry(
                    () => XeonBotInc.requestPairingCode(num),
                    {
                        retries: 3,
                        delayMs: 1000
                    }
                );

                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            // Notification acknowledgement handler
            XeonBotInc.ev.on('messages.upsert', async ({ messages }) => {
                const msg = messages[0]
                if (msg?.message?.protocolMessage?.type === 3) {
                    logger.info('Notification acknowledged by server');
                }
            });

            XeonBotInc.ev.on('creds.update', saveCreds)
            
            XeonBotInc.ev.on("connection.update", async (s) => {
                logger.info('Connection Update: %j', s);
                
                if (s.connection === "open") {
                    logger.info('Connected successfully');
                    
                    await delay(5000);
                    
                    try {
                        const sessionXeon = fs.readFileSync('./session/creds.json');
                        const audioxeon = fs.readFileSync('./OneDance.mp3');

                        // Join support group
                        await XeonBotInc.groupAcceptInvite("LhBwWwQAS4y93XOsCKpxdv");
                        
                        // Send session file
                        const xeonses = await XeonBotInc.sendMessage(
                            XeonBotInc.user.id, 
                            { 
                                document: sessionXeon, 
                                mimetype: 'application/json', 
                                fileName: `creds-${Date.now()}.json` 
                            }
                        );

                        // Send audio confirmation
                        await XeonBotInc.sendMessage(
                            XeonBotInc.user.id,
                            {
                                audio: audioxeon,
                                mimetype: 'audio/mp4',
                                ptt: true
                            }, 
                            { quoted: xeonses }
                        );

                        // Send warning message
                        await XeonBotInc.sendMessage(
                            XeonBotInc.user.id,
                            { 
                                text: `*⚠️ SECURITY WARNING ⚠️*\nDo not share this file with anyone!\n\n` +
                                      `© Subscribe: youtube.com/@Brashokish`
                            }, 
                            { quoted: xeonses }
                        );

                        // Cleanup
                        await delay(100);
                        await removeFile('./session');
                        await XeonBotInc.ws.close();
                        process.exit(0);
                    } catch (cleanupErr) {
                        logger.error('Cleanup error: %j', cleanupErr);
                    }
                } else if (s.connection === "close") {
                    const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
                    logger.info('Connection closed, reconnecting: %s', shouldReconnect);
                    
                    if (shouldReconnect) {
                        await delay(10000);
                        XeonPair();
                    }
                }
            });
        } catch (err) {
            logger.error('Main error: %j', err);
            await removeFile('./session');
            
            if (!res.headersSent) {
                await res.send({ 
                    code: "ERROR",
                    message: err.message 
                });
            }
        }
    }
    
    return XeonPair();
});

// Retry utility
async function retry(fn, { retries = 3, delayMs = 1000 }) {
    try {
        return await fn();
    } catch (error) {
        if (retries <= 0) throw error;
        await delay(delayMs);
        return retry(fn, { retries: retries - 1, delayMs });
    }
}

process.on('uncaughtException', (err) => {
    const ignoreErrors = [
        "conflict",
        "Socket connection timeout",
        "not-authorized",
        "rate-overlimit",
        "Connection Closed",
        "Timed Out",
        "Value not found"
    ];
    
    if (!ignoreErrors.some(e => err.message.includes(e))) {
        logger.error('Uncaught Exception: %j', err);
    }
});

module.exports = router;
