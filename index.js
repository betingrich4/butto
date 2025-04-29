import { Boom } from '@hapi/boom'
import Baileys, {
  DisconnectReason,
  delay,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import path from 'path'
import pino from 'pino'
import { fileURLToPath } from 'url'

const app = express()

// Enhanced configuration
const config = {
  MAX_RETRIES: 3,
  RETRY_DELAY: 5000, // 5 seconds
  CONNECTION_TIMEOUT: 30000 // 30 seconds
}

// Middleware
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 8000
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Improved session management
function createSessionId() {
  return Array.from({length: 10}, () => 
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)
    ]).join('')
}

let sessionFolder = `./auth/${createSessionId()}`

const clearState = () => {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true })
  }
}

// Status viewing with retry logic
async function setupStatusViewer(sock) {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast')
    if (statusMsg) {
      let retries = 0
      const viewStatus = async () => {
        try {
          await sock.readMessages([statusMsg.key])
          console.log('✅ Viewed status update')
        } catch (error) {
          if (retries < config.MAX_RETRIES) {
            retries++
            console.log(`Retrying status view (${retries}/${config.MAX_RETRIES})...`)
            await delay(config.RETRY_DELAY)
            await viewStatus()
          } else {
            console.error('Max retries reached for status view:', error)
          }
        }
      }
      await viewStatus()
    }
  })
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.get('/pair', async (req, res) => {
  const phone = req.query.phone?.replace(/[^0-9]/g, '')
  
  if (!phone || phone.length < 11) {
    return res.status(400).json({ error: 'Please provide valid phone number with country code' })
  }

  try {
    const code = await establishWhatsAppConnection(phone)
    res.json({ code })
  } catch (error) {
    console.error('Final connection error:', error)
    res.status(500).json({ 
      error: 'Failed to establish connection',
      details: error.message 
    })
  }
})

// Robust connection handler with retries
async function establishWhatsAppConnection(phone, attempt = 1) {
  return new Promise(async (resolve, reject) => {
    try {
      clearState()
      fs.mkdirSync(sessionFolder, { recursive: true })

      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder)

      const sock = Baileys.makeWASocket({
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        auth: state,
      })

      // Connection timeout handler
      const timeout = setTimeout(() => {
        clearState()
        reject(new Error('Connection timeout'))
      }, config.CONNECTION_TIMEOUT)

      sock.ev.on('creds.update', saveCreds)
      setupStatusViewer(sock)

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
          clearTimeout(timeout)
          console.log('✅ WhatsApp connection established')
          
          // Send simple confirmation
          await sock.sendMessage(sock.user.id, { 
            text: '🔗 Successfully connected!\n\n' +
                  'Your device is now linked and viewing status updates.'
          })
        }

        if (connection === 'close') {
          const reason = new Boom(lastDisconnect?.error)?.output.statusCode
          console.log(`Connection closed (${reason})`)
          
          if (attempt < config.MAX_RETRIES) {
            console.log(`Retrying connection (${attempt}/${config.MAX_RETRIES})...`)
            await delay(config.RETRY_DELAY)
            resolve(establishWhatsAppConnection(phone, attempt + 1))
          } else {
            reject(new Error(`Max connection retries reached (${reason})`))
          }
        }
      })

      if (!sock.authState.creds.registered) {
        try {
          const code = await sock.requestPairingCode(phone)
          console.log(`Generated pairing code: ${code}`)
          resolve(code)
        } catch (error) {
          if (attempt < config.MAX_RETRIES) {
            console.log(`Retrying pairing (${attempt}/${config.MAX_RETRIES})...`)
            await delay(config.RETRY_DELAY)
            resolve(establishWhatsAppConnection(phone, attempt + 1))
          } else {
            reject(error)
          }
        }
      }

    } catch (error) {
      clearState()
      if (attempt < config.MAX_RETRIES) {
        console.log(`Retrying after error (${attempt}/${config.MAX_RETRIES})...`)
        await delay(config.RETRY_DELAY)
        resolve(establishWhatsAppConnection(phone, attempt + 1))
      } else {
        reject(error)
      }
    }
  })
}

app.listen(PORT, () => {
  console.log(`🚀 Server ready on port ${PORT}`)
})
