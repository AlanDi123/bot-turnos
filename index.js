/**
 * 🤖 GRANDIOSO UNIVERSO - VERSIÓN 10.0
 * - Modularizacion, resiliencia y observabilidad.
 */

const fs = require('fs');
const cron = require('node-cron');
const moment = require('moment-timezone');
require('moment/locale/es');

const { DisconnectReason } = require('@whiskeysockets/baileys');

const { APP_CONFIG, validateConfig } = require('./src/config');
const { createLogger } = require('./src/logger');
const { initGoogleClients } = require('./src/google');
const { restoreSessionFromDrive, saveSessionToDrive } = require('./src/driveSession');
const { agendarDesdeContexto, cancelarTurno } = require('./src/calendarOps');
const { connectToWhatsApp, createSendQueue } = require('./src/whatsapp');
const { revisarTurnosYEnviar } = require('./src/reminders');
const { createWebServer } = require('./src/web');

moment.locale('es');
moment.tz.setDefault(APP_CONFIG.timezone);

if (!fs.existsSync(APP_CONFIG.authFolder)) {
    fs.mkdirSync(APP_CONFIG.authFolder, { recursive: true });
}

const { log, getLogs } = createLogger(APP_CONFIG.timezone, APP_CONFIG.logRetention);
const configErrors = validateConfig();
if (configErrors.length > 0) {
    configErrors.forEach((err) => log(`❌ Config: ${err}`));
    process.exit(1);
}

const state = {
    sock: null,
    isConnected: false,
    qrCodeUrl: null,
    reconnectAttempts: 0,
    didAutoReset: false,
    isResetting: false
};

const { calendar, drive, requireGoogleAuth, hasGoogleAuth } = initGoogleClients(log);
const sendQueue = createSendQueue(1200);

async function startWhatsApp() {
    const handlers = {
        onQr: (url) => {
            state.qrCodeUrl = url;
            log('📲 QR actualizado. Esperando escaneo.');
        },
        onConnected: () => {
            log('✅ Energia Conectada (WhatsApp Online).');
            state.isConnected = true;
            state.qrCodeUrl = null;
            state.reconnectAttempts = 0;
            setTimeout(() => saveSessionToDrive(drive, requireGoogleAuth, log, APP_CONFIG), 10000);
        },
        onDisconnected: (shouldReconnect, statusCode) => {
            state.isConnected = false;
            const codeInfo = typeof statusCode !== 'undefined' ? ` (${statusCode})` : '';
            log(`⚠️ Conexion cerrada${codeInfo}. Reintento: ${shouldReconnect ? 'si' : 'no'}`);
            if (statusCode === DisconnectReason.loggedOut) {
                log('🚪 Sesion cerrada desde el celular. Limpiando credenciales para nuevo inicio.');
                resetAuthSession();
                return;
            }
            if (shouldReconnect) scheduleReconnect();
        },
        onMessage: async (msg, sock) => {
            const remoteJid = msg.key.remoteJid;
            const fromMe = msg.key.fromMe;
            const texto = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

            log(`✉️ Mensaje recibido de ${remoteJid} (fromMe=${fromMe})`);

            if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('status') || remoteJid.includes('broadcast')) {
                log('ℹ️ Mensaje ignorado (grupo/status/broadcast).');
                return;
            }

            if (!fromMe) {
                log('ℹ️ Mensaje ignorado (no es fromMe).');
                return;
            }

            try {
                if (texto.includes(APP_CONFIG.EMOJI_AGENDAR)) {
                    const exito = await agendarDesdeContexto(calendar, requireGoogleAuth, log, APP_CONFIG, remoteJid, msg);
                    await sendQueue(() => sock.sendMessage(remoteJid, { react: { text: exito ? '👍' : '❓', key: msg.key } }));
                    log(`✅ Resultado agenda: ${exito ? 'ok' : 'fallo'}`);
                }

                if (texto.includes(APP_CONFIG.EMOJI_CANCELAR)) {
                    const cancelado = await cancelarTurno(calendar, requireGoogleAuth, log, APP_CONFIG, remoteJid);
                    await sendQueue(() => sock.sendMessage(remoteJid, { react: { text: cancelado ? '👍' : '🤷‍♂️', key: msg.key } }));
                    log(`✅ Resultado cancelacion: ${cancelado ? 'ok' : 'fallo'}`);
                }
            } catch (error) {
                log(`❌ Error procesando mensaje: ${error.message}`);
            }
        }
    };

    state.sock = await connectToWhatsApp(APP_CONFIG, log, handlers);
}

function scheduleReconnect() {
    if (!state.isConnected) {
        state.reconnectAttempts += 1;
        if (!state.didAutoReset && APP_CONFIG.maxReconnectBeforeReset > 0
            && state.reconnectAttempts >= APP_CONFIG.maxReconnectBeforeReset) {
            return resetAuthSession();
        }
    }
    const backoffMs = Math.min(30000, 3000 * state.reconnectAttempts);
    setTimeout(() => startWhatsApp().catch((error) => log(`❌ Error reconectando: ${error.message}`)), backoffMs);
}

async function resetAuthSession() {
    if (state.isResetting) return;
    state.isResetting = true;
    state.didAutoReset = true;
    state.reconnectAttempts = 0;
    state.qrCodeUrl = null;
    try {
        log('🧹 Reiniciando sesion local para vinculo limpio...');
        fs.rmSync(APP_CONFIG.authFolder, { recursive: true, force: true });
        fs.rmSync('./session.zip', { force: true });
        fs.rmSync('./session.tmp.zip', { force: true });
        fs.mkdirSync(APP_CONFIG.authFolder, { recursive: true });
    } catch (error) {
        log(`❌ Error limpiando sesion: ${error.message}`);
    }

    try {
        await startWhatsApp();
    } finally {
        state.isResetting = false;
    }
}

async function start() {
    if (!APP_CONFIG.disableDriveRestore) {
        await restoreSessionFromDrive(drive, requireGoogleAuth, log, APP_CONFIG);
    } else {
        log('⚠️ Restauracion desde Drive deshabilitada por config.');
    }
    await startWhatsApp();

    createWebServer(APP_CONFIG, log, getLogs, state, calendar, requireGoogleAuth, hasGoogleAuth, () => {
        revisarTurnosYEnviar(calendar, requireGoogleAuth, log, APP_CONFIG, state.sock, sendQueue);
    });

    cron.schedule('0 * * * *', () => saveSessionToDrive(drive, requireGoogleAuth, log, APP_CONFIG));

    const cronExpr = `${APP_CONFIG.reminderMinute} ${APP_CONFIG.reminderHour} * * *`;
    cron.schedule(cronExpr, () => {
        revisarTurnosYEnviar(calendar, requireGoogleAuth, log, APP_CONFIG, state.sock, sendQueue);
    }, { timezone: APP_CONFIG.timezone });
}

function shutdown(signal) {
    log(`🧘 Apagando (${signal})...`);
    saveSessionToDrive(drive, requireGoogleAuth, log, APP_CONFIG)
        .finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log(`❌ UnhandledRejection: ${reason}`));
process.on('uncaughtException', (error) => log(`❌ UncaughtException: ${error.message}`));

start().catch((error) => log(`❌ Error de inicio: ${error.message}`));
