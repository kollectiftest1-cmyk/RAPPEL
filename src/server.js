require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json({ limit: '20kb' }));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const API_TOKEN = process.env.API_TOKEN;
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'state.json');
const TZ = process.env.TZ || 'Africa/Kinshasa';

if (!API_TOKEN || API_TOKEN === 'REMPLACER_PAR_UN_JETON_LONG_ALEATOIRE') {
  console.error('ERREUR : configure un API_TOKEN fort dans .env');
  process.exit(1);
}

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { sent: {} }; }
}
function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}
function dateKey(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function authorized(req, res, next) {
  if (req.get('authorization') !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: 'Non autorisé.' });
  }
  next();
}
function normalizeRecipient(type, recipient) {
  if (type === 'group') {
    if (!/^[0-9]+@g\.us$/.test(recipient)) throw new Error('Identifiant de groupe invalide.');
    return recipient;
  }
  if (type === 'individual') {
    const number = recipient.replace(/[\s()+.-]/g, '');
    if (!/^[0-9]{8,15}$/.test(number)) throw new Error('Numéro invalide : format international sans +.');
    return `${number}@c.us`;
  }
  throw new Error('type doit être group ou individual.');
}

let whatsappReady = false;
let sending = false;
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '..', '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    timeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-extensions', '--disable-background-networking', '--no-first-run']
  }
});

client.on('qr', qr => {
  console.log('\nScanne ce QR code depuis WhatsApp > Appareils connectés :');
  qrcode.generate(qr, { small: true });
});
client.on('authenticated', () => console.log('Authentification WhatsApp réussie.'));
client.on('ready', () => {
  whatsappReady = true;
  console.log('WhatsApp est connecté et prêt.');
});
client.on('auth_failure', msg => {
  whatsappReady = false;
  console.error('Échec authentification WhatsApp :', msg);
});
client.on('disconnected', reason => {
  whatsappReady = false;
  console.error('WhatsApp déconnecté :', reason);
});

async function sendMessage(type, recipient, message) {
  if (!whatsappReady) throw new Error('WhatsApp n’est pas connecté.');
  if (typeof message !== 'string' || !message.trim() || message.length > 5000) {
    throw new Error('Message vide ou trop long.');
  }
  const chatId = normalizeRecipient(type, recipient);
  const result = await client.sendMessage(chatId, message.trim());
  return { success: true, messageId: result?.id?._serialized || result?.id?.$1 || null };
}

async function runSchedule(schedule) {
  const config = readConfig();
  const timezone = config.timezone || TZ;
  const today = dateKey(timezone);
  const key = `${today}:${schedule.id}`;
  const state = readState();

  if (!schedule.enabled) return;
  if (state.sent[key]) {
    console.log(`[SKIP] ${schedule.label} déjà envoyé aujourd’hui.`);
    return;
  }
  if (sending) {
    console.warn(`[SKIP] ${schedule.label} ignoré : un autre envoi est en cours.`);
    return;
  }

  sending = true;
  try {
    const result = await sendMessage(schedule.targetType, schedule.recipient, schedule.message);
    state.sent[key] = { at: new Date().toISOString(), messageId: result.messageId };
    writeState(state);
    console.log(`[OK] ${schedule.label} envoyé (${schedule.recipient}).`);
  } catch (err) {
    console.error(`[ERREUR] ${schedule.label} : ${err.message}`);
  } finally {
    sending = false;
  }
}

function startSchedules() {
  const config = readConfig();
  const timezone = config.timezone || TZ;
  for (const schedule of config.schedules || []) {
    if (!cron.validate(schedule.cron)) {
      console.error(`[CONFIG] Expression cron invalide pour ${schedule.id}: ${schedule.cron}`);
      continue;
    }
    cron.schedule(schedule.cron, () => runSchedule(schedule), { timezone });
    console.log(`[PLANIFIÉ] ${schedule.label} | ${schedule.cron} | actif=${schedule.enabled}`);
  }
}

app.get('/health', (req, res) => res.json({
  service: 'rappel-whatsapp-vps',
  whatsappReady,
  timezone: TZ
}));

app.get('/groups', authorized, async (req, res) => {
  if (!whatsappReady) return res.status(503).json({ error: 'WhatsApp non connecté.' });
  try {
    const chats = await client.getChats();
    res.json({ groups: chats.filter(c => c.isGroup).map(c => ({ name: c.name, id: c.id._serialized || c.id.$1 })) });
  } catch (err) {
    console.error('Erreur récupération groupes :', err.message);
    res.status(500).json({ error: 'Impossible de lire les groupes.' });
  }
});

app.post('/send', authorized, async (req, res) => {
  const { type, recipient, message } = req.body || {};
  try {
    const result = await sendMessage(type, recipient, message);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('invalide') || err.message.includes('vide') || err.message.includes('trop long') ? 400 : 503;
    res.status(status).json({ error: err.message });
  }
});

app.listen(PORT, HOST, () => console.log(`Service démarré sur http://${HOST}:${PORT}`));
startSchedules();
client.initialize().catch(err => console.error('Impossible de démarrer WhatsApp :', err));
