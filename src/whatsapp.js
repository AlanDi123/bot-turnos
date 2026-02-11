const pino = require('pino');
const qrcode = require('qrcode');
const { makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { useMongoDBAuthState } = require('./mongoAuthState');

// Queue de mensajes (anti-spam)
function createSendQueue(delayMs) {
    let chain = Promise.resolve();
    return async (fn) => {
        chain = chain.then(() => fn()).then(() => new Promise(r => setTimeout(r, delayMs))).catch(() => new Promise(r => setTimeout(r, delayMs)));
        return chain;
    };
}

async function connectToWhatsApp(config, log, handlers, mongoCollection) {
    // AQUI USAMOS MONGO EN LUGAR DE FILE SYSTEM
    const { state, saveCreds } = await useMongoDBAuthState(mongoCollection);
    const { version } = await fetchLatestBaileysVersion();

    log(`📱 Conectando WhatsApp v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state, // Estado desde Mongo
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Bot Turnos', 'Chrome', '12.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: config.keepAliveIntervalMs,
        markOnlineOnConnect: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            qrcode.toDataURL(qr).then(url => handlers.onQr(url));
        }

        if (connection === 'open') {
            handlers.onConnected();
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            handlers.onDisconnected(shouldReconnect, statusCode);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg?.message) return;
        await handlers.onMessage(msg, sock);
    });

    return sock;
}

module.exports = { connectToWhatsApp, createSendQueue };
