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

if (!global.crypto) {
    global.crypto = {
        getRandomValues: (arr) => crypto.randomBytes(arr.length)
    };
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

    const sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            qrcode
                .toDataURL(qr)
                .then((url) => handlers.onQr(url))
                .catch(() => handlers.onQr(null));
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

module.exports = {
    connectToWhatsApp,
    createSendQueue
};
