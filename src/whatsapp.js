const crypto = require('crypto');
const pino = require('pino');
const qrcode = require('qrcode');
const {
    default: makeWASocket,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState
} = require('@whiskeysockets/baileys');

// Configurar WebCrypto para Baileys
if (!global.crypto) {
    global.crypto = crypto.webcrypto;
}

if (!global.crypto.subtle && crypto.webcrypto) {
    global.crypto.subtle = crypto.webcrypto.subtle;
}

function createSendQueue(delayMs) {
    let chain = Promise.resolve();

    return async (fn) => {
        chain = chain
            .then(() => fn())
            .then(() => new Promise((resolve) => setTimeout(resolve, delayMs)))
            .catch(() => new Promise((resolve) => setTimeout(resolve, delayMs)));
        return chain;
    };
}

async function connectToWhatsApp(config, log, handlers) {
    const { state, saveCreds } = await useMultiFileAuthState(config.authFolder);
    const { version } = await fetchLatestBaileysVersion();

    log(`📱 Conectando WhatsApp con versión ${version.join('.')}`);
    log(`📂 Usando carpeta de autenticación: ${config.authFolder}`);

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Bot Turnos', 'Chrome', '10.0'],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: config.keepAliveIntervalMs,
        retryRequestDelayMs: 2000,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async () => undefined,
        shouldIgnoreJid: () => false,
        emitOwnEvents: false,
        fireInitQueries: true,
        qrTimeout: 60000
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            log('📲 QR generado, convirtiendo a imagen...');
            qrcode
                .toDataURL(qr)
                .then((url) => {
                    log('✅ QR convertido exitosamente');
                    handlers.onQr(url);
                })
                .catch((err) => {
                    log(`❌ Error generando QR: ${err.message}`);
                    handlers.onQr(null);
                });
        }

        if (connection === 'open') {
            log('🔓 Conexión abierta');
            handlers.onConnected();
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            const errorMsg = lastDisconnect?.error?.message || 'sin mensaje';
            log(`🔒 Conexión cerrada - Status: ${statusCode || 'sin código'} - Error: ${errorMsg}`);
            
            // Log adicional para debug
            if (lastDisconnect?.error) {
                log(`📋 Error completo: ${JSON.stringify(lastDisconnect.error, null, 2).substring(0, 200)}`);
            }
            
            handlers.onDisconnected(shouldReconnect, statusCode);
        }
        
        if (connection === 'connecting') {
            log('🔄 Conectando a WhatsApp...');
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

module.exports = {
    connectToWhatsApp,
    createSendQueue
};
