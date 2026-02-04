const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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

// --- CONEXIÓN WHATSAPP (BAILEYS) ---
async function connectToWhatsApp() {
    // Sistema de auth en archivos locales
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Se verá en los logs de Render también
        logger: pino({ level: 'silent' }), // Log limpio
        browser: ["Bot Turnos", "Chrome", "1.0.0"], // Disfraz
        connectTimeoutMs: 60000,
    });

    // Manejo de eventos de conexión
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            log('⚠️ NUEVO QR GENERADO. Escanéalo en la web.');
            // Convertir el código QR de texto a imagen para la web
            qrCodeUrl = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            log(`❌ Desconectado. ¿Reconectar?: ${shouldReconnect}`);
            isConnected = false;
            // Si no fue un logout manual, reconectar automáticamente
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            log('✅ ¡CONECTADO EXITOSAMENTE A WHATSAPP!');
            qrCodeUrl = null;
            isConnected = true;
        }
    });

    // Guardar credenciales cuando cambian
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
                // Baileys usa el formato 54911xxxx@s.whatsapp.net
                let formattedNumber = `549${rawNumber}`;
                const jid = `${formattedNumber}@s.whatsapp.net`;
                
                const horaInicio = moment(event.start.dateTime || event.start.date).tz(TIMEZONE).format('HH:mm');
                
                const mensaje = `Hola ${nombreCliente}! 👋\n\nTe recuerdo tu turno para mañana a las *${horaInicio} hs*.\n\nPor favor, confirmame asistencia.\n¡Gracias!`;

                try {
                    // Verificar si el número existe en WA
                    const [result] = await sock.onWhatsApp(jid);
                    if (result && result.exists) {
                        await sock.sendMessage(result.jid, { text: mensaje });
                        log(`✅ Enviado a ${nombreCliente}`);
                        enviados++;
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        log(`⚠️ El número ${formattedNumber} no tiene WhatsApp.`);
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

// Iniciar
app.listen(port, () => {
    log(`🌐 Servidor iniciado. Arrancando WhatsApp...`);
    connectToWhatsApp();
});

// Cron 7 AM
cron.schedule('0 7 * * *', () => {
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });