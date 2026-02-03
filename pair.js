const express = require('express')
const fs = require('fs')
const path = require('path')
const pino = require('pino')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys')

const router = express.Router()
const logger = pino({ level: 'silent' })

const SESSION_DIR = './session'

function cleanSession() {
  if (fs.existsSync(SESSION_DIR)) {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true })
  }
}

router.get('/', async (req, res) => {
  let number = req.query.number
  if (!number) {
    return res.status(400).json({ error: 'Number is required' })
  }

  number = number.replace(/[^0-9]/g, '')

  let sock
  let replied = false

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      browser: Browsers.macOS('Safari'),
      printQRInTerminal: false,
      syncFullHistory: false
    })

    // REQUIRED FOR BAILEYS v7
    sock.ev.process(async (events) => {
      if (events['creds.update']) {
        await saveCreds()
      }
    })

    // Wait for socket to stabilize
    await delay(3000)

    // Generate pairing code
    if (!state.creds.registered) {
      const code = await sock.requestPairingCode(number)

      if (!replied) {
        replied = true
        res.json({
          code,
          message: 'Enter this code on WhatsApp → Linked Devices'
        })
      }
    }

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update

      if (connection === 'open') {
        console.log('✅ WhatsApp linked successfully')

        // IMPORTANT: keep socket alive so WhatsApp finalizes trust
        await delay(15000)

        // OPTIONAL: cleanup after successful pairing
        try {
          if (sock?.ws?.readyState === sock.ws.OPEN) {
            sock.ws.close()
          }
        } catch {}

        cleanSession()
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        console.log('❌ Connection closed:', statusCode)

        if (!replied) {
          replied = true
          res.status(500).json({
            error: 'Failed to link device. Try again.'
          })
        }

        cleanSession()
      }
    })
  } catch (err) {
    console.error('❌ Pairing error:', err)

    if (!replied) {
      replied = true
      res.status(500).json({ error: err.message })
    }

    try {
      if (sock?.ws?.readyState === sock.ws.OPEN) {
        sock.ws.close()
      }
    } catch {}

    cleanSession()
  }
})

module.exports = router
