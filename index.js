const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const moment = require('moment-timezone');
const zlib = require('zlib'); // Added compression from friend's code

// Configuration
const config = {
  TIME_ZONE: 'Africa/Nairobi',
  AUTO_STATUS_REACT: true,
  STATUS_REACT_EMOJIS: ['❤️', '💸', '😇', '🍂', '💥'],
  BIO_UPDATE_INTERVAL: 60000,
  PREFIX: '!'
};

const app = express();
const PORT = process.env.PORT || 8000;

// Improved session management from friend's code
function getSessionFolder() {
  const folder = path.join(__dirname, 'auth', Math.random().toString(36).substring(2, 10));
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return folder;
}

// Enhanced session handling with compression
async function handleSession(sessionFolder) {
  const credsPath = path.join(sessionFolder, 'creds.json');
  if (fs.existsSync(credsPath)) {
    try {
      const sessionData = fs.readFileSync(credsPath, 'utf8');
      const [header, b64data] = sessionData.split(';;;');
      
      if (header === 'DEMON-SLAYER' && b64data) {
        const compressedData = Buffer.from(b64data, 'base64');
        const decompressedData = zlib.gunzipSync(compressedData);
        fs.writeFileSync(credsPath, decompressedData, 'utf8');
      }
    } catch (e) {
      console.error('Session migration error:', e.message);
    }
  }
}

// More reliable bio updater combining both approaches
async function updateBio(sock) {
  try {
    const now = moment().tz(config.TIME_ZONE);
    const bioText = `⏰ ${now.format('HH:mm')} | ${now.format('dddd')} | 📅 ${now.format('D MMMM YYYY')} | Marisel`;
    await sock.updateProfileStatus(bioText);
    console.log(`Bio updated: ${bioText}`);
  } catch (error) {
    console.error('Bio update error:', error.message);
  }
}

// Enhanced status handling from friend's code
async function handleStatusView(sock) {
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
    if (statusMsg) {
      try {
        await sock.readMessages([statusMsg.key]);
        if (config.AUTO_STATUS_REACT) {
          const randomEmoji = config.STATUS_REACT_EMOJIS[
            Math.floor(Math.random() * config.STATUS_REACT_EMOJIS.length)
          ];
          await sock.sendMessage(statusMsg.key.remoteJid, {
            react: { text: randomEmoji, key: statusMsg.key }
          });
        }
      } catch (error) {
        console.error('Status handling error:', error.message);
      }
    }
  });
}

// Improved connection handling
function setupConnectionHandlers(sock, sessionFolder) {
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    
    if (connection === 'open') {
      console.log('Connected successfully!');
      await updateBio(sock);
      const bioInterval = setInterval(() => updateBio(sock), config.BIO_UPDATE_INTERVAL);
      
      await sock.sendMessage(sock.user.id, {
        text: `*Demon Slayer MiniBot Activated!*\n\n` +
              `• Auto-status viewing: ✅\n` +
              `• Bio updates: Every minute\n\n` +
              `_Bot is now running automatically_`
      });

      // Cleanup on close
      sock.ev.on('connection.update', (update) => {
        if (update.connection === 'close') {
          clearInterval(bioInterval);
          try {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
          } catch (e) {
            console.error('Cleanup error:', e.message);
          }
        }
      });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
      console.log(shouldReconnect ? 'Reconnecting...' : 'Logged out, please relink');
    }
  });
}

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

    const sessionFolder = getSessionFolder();
    await handleSession(sessionFolder); // Added session handling from friend's code
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Chrome (Linux)', '', ''] // From friend's working config
    });

    sock.ev.on('creds.update', async (creds) => {
      await saveCreds(creds);
      // Added compression from friend's code
      if (fs.existsSync(path.join(sessionFolder, 'creds.json'))) {
        const data = fs.readFileSync(path.join(sessionFolder, 'creds.json'), 'utf8');
        const compressed = zlib.gzipSync(data);
        fs.writeFileSync(
          path.join(sessionFolder, 'creds.json'),
          `DEMON-SLAYER;;;${compressed.toString('base64')}`
        );
      }
    });

    setupConnectionHandlers(sock, sessionFolder);
    handleStatusView(sock); // From friend's code

    const code = await sock.requestPairingCode(phone);
    res.json({ code });

  } catch (error) {
    console.error('Pairing error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
