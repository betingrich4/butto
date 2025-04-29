import { Boom } from '@hapi/boom'
import Baileys, {
  DisconnectReason,
  delay,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import path, { dirname } from 'path'
import pino from 'pino'
import { fileURLToPath } from 'url'

const app = express()

// Middleware
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})
app.use(cors())

const PORT = process.env.PORT || 8000
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Session Management
function createRandomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({length: 10}, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

let sessionFolder = `./auth/${createRandomId()}`

const clearState = () => {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true })
  }
}

// Status Viewing Functionality
function setupStatusViewing(sock) {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast')
    if (statusMsg) {
      try {
        await sock.readMessages([statusMsg.key])
        console.log('✅ Viewed status update')
      } catch (error) {
        console.error('Status view error:', error)
      }
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
    const code = await startWhatsAppConnection(phone)
    res.json({ code })
  } catch (error) {
    console.error('Connection error:', error)
    res.status(500).json({ error: error.message })
  }
})

// WhatsApp Connection Handler
async function startWhatsAppConnection(phone) {
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

      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(phone)
        console.log(`Pairing Code: ${code}`)
        resolve(code)
      }

      sock.ev.on('creds.update', saveCreds)
      setupStatusViewing(sock)

      sock.ev.on('connection.update', async update => {
        const { connection, lastDisconnect } = update

        if (connection === 'open') {
          console.log('✅ Successfully connected to WhatsApp')
          
          // Send welcome message
          await sock.sendMessage(sock.user.id, { 
            text: '🚀 Your Joel-XMD bot is now connected!\n\n' +
                  'It will automatically view status updates.'
          })
        }

        if (connection === 'close') {
          const reason = new Boom(lastDisconnect?.error)?.output.statusCode
          console.log(`Connection closed (${reason}), reconnecting...`)
          setTimeout(() => startWhatsAppConnection(phone), 5000)
        }
      })

    } catch (error) {
      console.error('Connection error:', error)
      reject(error)
    }
  })
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})
