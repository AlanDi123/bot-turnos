/**
 * 🤖 GRANDIOSO UNIVERSO - VERSIÓN MONGO ATLAS
 * Persistencia Total + Anti-Overbooking
 */
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { DisconnectReason } = require('@whiskeysockets/baileys');

const { APP_CONFIG, validateConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { initGoogleClients } = require('./src/google');
const { agendarDesdeContexto, cancelarTurno } = require('./src/calendarOps');
const { connectToWhatsApp, createSendQueue } = require('./src/whatsapp');
const { revisarTurnosYEnviar } = require('./src/reminders');
const { createWebServer } = require('./src/web');

moment.locale('es');
moment.tz.setDefault(APP_CONFIG.timezone);
const { log, getLogs } = createLogger(APP_CONFIG.timezone, APP_CONFIG.logRetention);

const configErrors = validateConfig();
if (configErrors.length > 0) {
    configErrors.forEach(err => log(`❌ Config: ${err}`));
    process.exit(1);
}

const state = {
    sock: null,
    isConnected: false,
    qrCodeUrl: null,
    mongoClient: null,
    collection: null
};

const { calendar, requireGoogleAuth, hasGoogleAuth } = initGoogleClients(log);
const sendQueue = createSendQueue(1200);

// --- CONEXIÓN MONGO ---
async function connectToMongo() {
    try {
        log('🍃 Conectando a MongoDB Atlas...');
        const client = new MongoClient(APP_CONFIG.mongoUrl);
        await client.connect();
        const db = client.db('whatsapp_bot');
        state.collection = db.collection('auth_state');
        state.mongoClient = client;
        log('✅ MongoDB Conectado.');
    } catch (error) {
        log(`❌ Error MongoDB: ${error.message}`);
        process.exit(1);
    }
}

async function startWhatsApp() {
    const handlers = {
        onQr: (url) => {
            state.qrCodeUrl = url;
            log('📲 Escanea el QR (disponible en web).');
        },
        onConnected: () => {
            log('✅ WhatsApp Conectado y Sincronizado.');
            state.isConnected = true;
            state.qrCodeUrl = null;
        },
        onDisconnected: (shouldReconnect, statusCode) => {
            state.isConnected = false;
            log(`⚠️ Desconectado. Reconectar: ${shouldReconnect}`);
            if (shouldReconnect) startWhatsApp();
            if (statusCode === DisconnectReason.loggedOut) {
                log('🚪 Sesión cerrada. Limpiando DB.');
                state.collection.deleteMany({}); // Borrar sesión de Mongo
                startWhatsApp(); // Reiniciar para nuevo QR
            }
        },
        onMessage: async (msg, sock) => {
            const remoteJid = msg.key.remoteJid;
            const fromMe = msg.key.fromMe;
            if (!remoteJid?.endsWith('@s.whatsapp.net') || !fromMe) return;

            const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

            try {
                if (texto.includes(APP_CONFIG.EMOJI_AGENDAR)) {
                    const res = await agendarDesdeContexto(calendar, requireGoogleAuth, log, APP_CONFIG, remoteJid, msg);
                    
                    // REACCIONES INTELIGENTES
                    let emoji = '❓';
                    if (res.status === 'success') emoji = '👍';
                    else if (res.status === 'occupied') emoji = '⛔'; // Nuevo: Ocupado
                    else if (res.status === 'error') emoji = '⚠️';
                    
                    if (res.status !== 'ignore') {
                        await sendQueue(() => sock.sendMessage(remoteJid, { react: { text: emoji, key: msg.key } }));
                    }
                }

                if (texto.includes(APP_CONFIG.EMOJI_CANCELAR)) {
                    const exito = await cancelarTurno(calendar, requireGoogleAuth, log, APP_CONFIG, remoteJid);
                    await sendQueue(() => sock.sendMessage(remoteJid, { react: { text: exito ? '👍' : '🤷‍♂️', key: msg.key } }));
                }
            } catch (e) {
                log(`❌ Error msg: ${e.message}`);
            }
        }
    };

    state.sock = await connectToWhatsApp(APP_CONFIG, log, handlers, state.collection);
}

async function start() {
    await connectToMongo();
    await startWhatsApp();
    
    createWebServer(APP_CONFIG, log, getLogs, state, calendar, requireGoogleAuth, hasGoogleAuth, () => {});

    cron.schedule(`${APP_CONFIG.reminderMinute} ${APP_CONFIG.reminderHour} * * *`, () => {
        revisarTurnosYEnviar(calendar, requireGoogleAuth, log, APP_CONFIG, state.sock, sendQueue);
    }, { timezone: APP_CONFIG.timezone });
}

process.on('SIGINT', async () => {
    if (state.mongoClient) await state.mongoClient.close();
    process.exit(0);
});

start();
