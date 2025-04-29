const { Boom } = require('@hapi/boom');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const moment = require('moment-timezone');
const chalk = require('chalk');

// Configuration
const config = {
  TIME_ZONE: 'Africa/Nairobi',
  AUTO_STATUS_REACT: true,
  AUTO_REACT: true,
  STATUS_REACT_EMOJIS: ['❤️', '💸', '😇', '🍂', '💥'],
  BIO_UPDATE_INTERVAL: 60000, // 1 minute
  PREFIX: '!'
};

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Session Management
let sessionFolder = path.join(__dirname, 'auth', Math.random().toString(36).substring(7));
const clearState = () => {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
  }
};

// Bio Updater
const updateBio = async (sock) => {
  try {
    const now = moment().tz(config.TIME_ZONE);
    const newBio = `⏰ ${now.format('HH:mm')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Marisel`;
    await sock.updateProfileStatus(newBio);
    console.log(chalk.blue(`Bio updated: ${newBio}`));
  } catch (error) {
    console.error(chalk.red('Bio update error:'), error);
  }
};

// Start Bot Features
const startBotFeatures = (sock) => {
  // Bio Updater
  const bioInterval = setInterval(() => updateBio(sock), config.BIO_UPDATE_INTERVAL);

  // Status Auto-View and React
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
      if (statusMsg && config.AUTO_STATUS_REACT) {
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
        console.log(chalk.green(`Reacted to status with ${randomEmoji}`));
      }
    } catch (error) {
      console.error(chalk.red('Status react error:'), error);
    }
  });

  // Connection Cleanup
  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'close') {
      clearInterval(bioInterval);
    }
  });
};

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pair', async (req, res) => {
  try {
    const phone = req.query.phone?.replace(/[^0-9]/g, '');
    if (!phone || phone.length < 11) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    clearState();
    if (!fs.existsSync(sessionFolder)) {
      fs.mkdirSync(sessionFolder, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    const code = await sock.requestPairingCode(phone);
    
    sock.ev.on('connection.update', async (update) => {
      if (update.connection === 'open') {
        // Send welcome message
        await sock.sendMessage(sock.user.id, {
          text: `*Demon Slayer MiniBot Activated!*\n\n` +
                `• Auto-status viewing: ✅\n` +
                `• Auto-reactions: ✅\n` +
                `• Bio updates: Every minute\n\n` +
                `_Bot will now run automatically_`
        });
        
        // Start bot features
        startBotFeatures(sock);
        await updateBio(sock);
      }
    });

    res.json({ code });
  } catch (error) {
    console.error(chalk.red('Pairing error:'), error);
    res.status(500).json({ error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(chalk.yellow(`Server running on port ${PORT}`));
});

process.on('SIGINT', () => {
  clearState();
  process.exit();
});
