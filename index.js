// --- PARCHE CRÍTICO DE CRYPTO (ARREGLA EL ERROR 'crypto is not defined') ---
const crypto = require('crypto');
// Forzamos a que crypto sea global para que Baileys lo encuentre
if (!global.crypto) {
    global.crypto = {
        getRandomValues: (arr) => crypto.randomBytes(arr.length),
    };
}
// --------------------------------------------------------------------------

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const express = require('express');
const qrcode = require('qrcode');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const pino = require('pino');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const app = express();
const port = process.env.PORT || 3000;
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const CALENDAR_ID = 'primary';
const KEYWORD_TURNO = 'Turno';
const AUTH_FOLDER = 'auth_info_baileys';

// Estado global
let sock;
let qrCodeUrl = null;
let isConnected = false;
let logs = [];

function log(msg) {
    const time = moment().tz(TIMEZONE).format('HH:mm:ss');
    const text = `[${time}] ${msg}`;
    console.log(text);
    logs.unshift(text);
    if (logs.length > 50) logs.pop();
}

// --- LIMPIEZA INICIAL SEGURA ---
// Borramos la sesión solo si el archivo creds.json NO existe o está corrupto,
// pero intentamos mantener la sesión si es posible.
// Para Render Free, forzamos limpieza para evitar conflictos de IP/Mac
if (fs.existsSync(AUTH_FOLDER)) {
    try {
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        console.log('🧹 Limpieza de arranque realizada.');
    } catch (e) {
        console.log('⚠️ Error limpiando: ' + e.message);
    }
}

// --- CONEXIÓN WHATSAPP ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        // Aumentamos timeout para conexiones lentas
        connectTimeoutMs: 60000, 
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            log('⚠️ NUEVO QR. Escanéalo en la web.');
            qrCodeUrl = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            const errorReason = (lastDisconnect?.error)?.output?.statusCode;
            const errorMsg = (lastDisconnect?.error)?.message || "Desconocido";
            
            // Lógica de reconexión
            const shouldReconnect = errorReason !== DisconnectReason.loggedOut;
            
            log(`❌ Desconectado (${errorMsg}). Reconectar: ${shouldReconnect}`);
            
            isConnected = false;
            qrCodeUrl = null;

            if (shouldReconnect) {
                log('⏳ Esperando 5s para reintentar...');
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            log('✅ ¡CONECTADO! WhatsApp listo.');
            qrCodeUrl = null;
            isConnected = true;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// --- GOOGLE CALENDAR ---
let auth;
try {
    const credentialsContent = process.env.GOOGLE_CREDENTIALS;
    if (credentialsContent) {
        const credentials = JSON.parse(credentialsContent);
        auth = google.auth.fromJSON(credentials);
        auth.scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
    } else if (fs.existsSync('./credentials.json')) {
        auth = new google.auth.GoogleAuth({
            keyFile: 'credentials.json',
            scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        });
    }
} catch (error) {
    log('❌ Error Credenciales Google: ' + error.message);
}

const calendar = google.calendar({ version: 'v3', auth });

async function revisarTurnosYEnviar() {
    if (!isConnected) {
        log('⛔ No se puede enviar: WhatsApp desconectado.');
        return;
    }

    log('🔍 Buscando turnos para MAÑANA...');
    const tomorrowStart = moment().tz(TIMEZONE).add(1, 'days').startOf('day');
    const tomorrowEnd = moment().tz(TIMEZONE).add(1, 'days').endOf('day');

    try {
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: tomorrowStart.toISOString(),
            timeMax: tomorrowEnd.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items;
        if (!events || events.length === 0) {
            log('ℹ️ No hay turnos para mañana.');
            return;
        }

        let enviados = 0;
        for (const event of events) {
            const titulo = event.summary || '';
            const descripcion = event.description || '';
            
            if (!titulo.toLowerCase().includes(KEYWORD_TURNO.toLowerCase())) continue;

            let nombreCliente = titulo.replace(/turno/ig, '').trim() || "Cliente";
            const phoneRegex = /(?:11|15)\d{8}/g; 
            const match = descripcion.match(phoneRegex);

            if (match) {
                let rawNumber = match[0];
                let formattedNumber = `549${rawNumber}`;
                const jid = `${formattedNumber}@s.whatsapp.net`;
                
                const horaInicio = moment(event.start.dateTime || event.start.date).tz(TIMEZONE).format('HH:mm');
                const mensaje = `Hola ${nombreCliente}! 👋\n\nTe recuerdo tu turno para mañana a las *${horaInicio} hs*.\n\nPor favor, confirmame asistencia.\n¡Gracias!`;

                try {
                    const [result] = await sock.onWhatsApp(jid);
                    if (result && result.exists) {
                        await sock.sendMessage(result.jid, { text: mensaje });
                        log(`✅ Enviado a ${nombreCliente}`);
                        enviados++;
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        log(`⚠️ Número sin WA: ${formattedNumber}`);
                    }
                } catch (e) {
                    log(`❌ Error enviando a ${nombreCliente}: ${e.message}`);
                }
            }
        }
        log(`🏁 Fin. Enviados: ${enviados}`);
    } catch (error) {
        log('❌ Error Calendar: ' + error.message);
    }
}

// --- SERVIDOR WEB ---
app.get('/', (req, res) => {
    let statusColor = isConnected ? '#d4edda' : '#f8d7da';
    let statusText = isConnected ? '✅ CONECTADO' : '❌ DESCONECTADO';
    
    let html = `
    <html>
        <head>
            <title>Bot Baileys</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body{font-family:sans-serif; text-align:center; padding:20px; max-width:600px; margin:0 auto;}
                .status{padding:15px; background:${statusColor}; border-radius:8px; margin-bottom:20px; font-weight:bold;}
                .log{text-align:left; background:#f0f0f0; padding:10px; height:300px; overflow-y:auto; font-family:monospace; font-size:12px; border-radius:8px;}
                img{max-width:250px; height:auto; border: 5px solid #333; margin: 10px 0;}
                .btn{display:inline-block; padding:12px 24px; background:#007bff; color:white; text-decoration:none; border-radius:5px; margin:10px; font-weight:bold;}
            </style>
        </head>
        <body>
            <h1>🤖 Bot Ultra-Ligero</h1>
            <div class="status">${statusText}</div>
            
            ${(!isConnected && qrCodeUrl) ? `<div><h3>Escanea este QR:</h3><img src="${qrCodeUrl}" /></div>` : ''}
            ${(!isConnected && !qrCodeUrl) ? `<p>Generando QR...</p>` : ''}

            ${isConnected ? `<a href="/test" class="btn">⚡ Probar Envío</a>` : ''}
            
            <h3>Logs:</h3><div class="log">${logs.join('<br>')}</div>
        </body>
    </html>`;
    res.send(html);
});

app.get('/test', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

app.listen(port, () => {
    log(`🌐 Servidor iniciado.`);
    connectToWhatsApp();
});

cron.schedule('0 7 * * *', () => {
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });