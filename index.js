const express = require('express');
const path = require('path');
const fs = require('fs');
const { Boom } = require('@hapi/boom');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 8000;

// Configuration
const config = {
  TIME_ZONE: 'Africa/Nairobi',
  AUTO_STATUS_REACT: true,
  STATUS_REACT_EMOJIS: ['❤️', '💸', '😇', '🍂', '💥'],
  BIO_UPDATE_INTERVAL: 60000, // 1 minute
  PREFIX: '!'
};

// Create public directory if it doesn't exist
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir);
}

// Serve static files
app.use(express.static(publicDir));

// Session Management
const getSessionFolder = () => {
  const folder = path.join(__dirname, 'auth', Math.random().toString(36).substring(2, 10));
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
};

const clearState = (folder) => {
  if (folder && fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
};

// Bio Updater
const updateBio = async (sock) => {
  try {
    const now = moment().tz(config.TIME_ZONE);
    const newBio = `⏰ ${now.format('HH:mm')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Marisel`;
    await sock.updateProfileStatus(newBio);
    console.log(`Bio updated: ${newBio}`);
  } catch (error) {
    console.error('Bio update error:', error.message);
  }
};

// Status Auto-View and React
const setupStatusHandling = (sock) => {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
    if (statusMsg && config.AUTO_STATUS_REACT) {
      try {
        await sock.readMessages([statusMsg.key]);
        const randomEmoji = config.STATUS_REACT_EMOJIS[
          Math.floor(Math.random() * config.STATUS_REACT_EMOJIS.length)
        ];
        await sock.sendMessage(statusMsg.key.remoteJid, {
          react: { 
            text: randomEmoji, 
            key: statusMsg.key 
          }
        });
        console.log(`Reacted to status with ${randomEmoji}`);
      } catch (error) {
        console.error('Status react error:', error.message);
      }
    }
  });
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/pair', async (req, res) => {
  try {
    const phone = req.query.phone?.replace(/[^0-9]/g, '');
    if (!phone || phone.length < 11) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    const sessionFolder = getSessionFolder();
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Chrome (Linux)', '', '']
    });

    sock.ev.on('creds.update', saveCreds);

    // Setup bot features
    let bioInterval;
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      
      if (connection === 'open') {
        console.log('Connected successfully!');
        
        // Start bio updates
        await updateBio(sock);
        bioInterval = setInterval(() => updateBio(sock), config.BIO_UPDATE_INTERVAL);
        
        // Send welcome message
        await sock.sendMessage(sock.user.id, {
          text: `*Demon Slayer MiniBot Activated!*\n\n` +
                `• Auto-status viewing: ✅\n` +
                `• Auto-reactions: ✅\n` +
                `• Bio updates: Every minute\n\n` +
                `_Bot is now running automatically_`
        });

        // Setup status handling
        setupStatusHandling(sock);
      }

      if (connection === 'close') {
        clearInterval(bioInterval);
        const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
        console.log(shouldReconnect ? 'Connection closed, reconnecting...' : 'Logged out, please relink');
        if (shouldReconnect) {
          setTimeout(() => startPairing(phone, res, sessionFolder), 5000);
        }
      }
    });

    const code = await sock.requestPairingCode(phone);
    res.json({ code });

  } catch (error) {
    console.error('Pairing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit();
});
