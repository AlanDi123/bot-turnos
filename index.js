/**
 * 🤖 GRANDIOSO UNIVERSO - VERSIÓN 11.0
 * - Bot estable sin backups, optimizado para Render.com
 * - Sesión persistente en disco del servidor
 */

const fs = require('fs');
const cron = require('node-cron');
const moment = require('moment-timezone');
require('moment/locale/es');

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

const { calendar, requireGoogleAuth, hasGoogleAuth } = initGoogleClients(log);
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
        },
        onDisconnected: (shouldReconnect, statusCode) => {
            state.isConnected = false;
            
            const disconnectReasons = {
                [DisconnectReason.badSession]: 'Sesión dañada',
                [DisconnectReason.connectionClosed]: 'Conexión cerrada',
                [DisconnectReason.connectionLost]: 'Conexión perdida',
                [DisconnectReason.connectionReplaced]: 'Conexión reemplazada',
                [DisconnectReason.loggedOut]: 'Sesión cerrada',
                [DisconnectReason.restartRequired]: 'Reinicio requerido',
                [DisconnectReason.timedOut]: 'Tiempo agotado'
            };
            
            const reason = disconnectReasons[statusCode] || `Código ${statusCode}`;
            log(`⚠️ Desconexión: ${reason}. Reconectar: ${shouldReconnect ? 'Sí' : 'No'}`);
            
            if (statusCode === DisconnectReason.loggedOut) {
                log('🚪 Sesión cerrada desde el celular. Limpiando credenciales.');
                resetAuthSession();
                return;
            }
            
            if (statusCode === DisconnectReason.badSession) {
                log('🗑️ Sesión corrupta detectada. Reiniciando...');
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

            if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) {
                log('ℹ️ Mensaje ignorado (no es chat individual).');
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
            log(`🔄 Demasiados intentos de reconexión (${state.reconnectAttempts}). Reiniciando sesión...`);
            return resetAuthSession();
        }
        
        // Backoff exponencial: 3s, 6s, 12s, 24s, hasta máximo 60s
        const backoffMs = Math.min(60000, 3000 * Math.pow(2, state.reconnectAttempts - 1));
        log(`🔄 Reintento #${state.reconnectAttempts} en ${backoffMs / 1000}s...`);
        
        setTimeout(() => {
            log('🔌 Intentando reconectar...');
            startWhatsApp().catch((error) => {
                log(`❌ Error reconectando: ${error.message}`);
                scheduleReconnect();
            });
        }, backoffMs);
    }
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
    log('🚀 Iniciando Bot sin backups en Drive (modo estable)...');
    await startWhatsApp();

    createWebServer(APP_CONFIG, log, getLogs, state, calendar, requireGoogleAuth, hasGoogleAuth, () => {
        revisarTurnosYEnviar(calendar, requireGoogleAuth, log, APP_CONFIG, state.sock, sendQueue);
    });

    const cronExpr = `${APP_CONFIG.reminderMinute} ${APP_CONFIG.reminderHour} * * *`;
    cron.schedule(cronExpr, () => {
        revisarTurnosYEnviar(calendar, requireGoogleAuth, log, APP_CONFIG, state.sock, sendQueue);
    }, { timezone: APP_CONFIG.timezone });
}

function shutdown(signal) {
    log(`🧘 Apagando (${signal})...`);
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log(`❌ UnhandledRejection: ${reason}`));
process.on('uncaughtException', (error) => log(`❌ UncaughtException: ${error.message}`));

start().catch((error) => log(`❌ Error de inicio: ${error.message}`));
