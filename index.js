const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const { google } = require('googleapis');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const app = express();
const port = process.env.PORT || 3000;
const CALENDAR_ID = 'primary';
const TIMEZONE = 'America/Argentina/Buenos_Aires';
const KEYWORD_TURNO = 'Turno';

// Variables de estado
let qrCodeUrl = null;
let clientReady = false;
let clientAuthenticated = false; // Nueva variable para saber si vamos bien
let logs = [];

function log(message) {
    const timestamp = moment().tz(TIMEZONE).format('DD/MM HH:mm:ss');
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    logs.unshift(logMsg); 
    if (logs.length > 50) logs.pop(); 
}

// --- CONFIGURACIÓN WHATSAPP ---
// NOTA: Hemos quitado el código que borraba la carpeta .wwebjs_auth
// Ahora el bot RECORDARÁ la sesión si se reinicia.

const client = new Client({
    authStrategy: new LocalAuth({ 
        dataPath: './.wwebjs_auth' 
    }),
    authTimeoutMs: 0, 
    qrMaxRetries: 10,
    takeoverOnConflict: true, // Si hay conflicto, toma el control
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/google-chrome-stable', 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    // Solo mostramos QR si no estamos autenticados
    if (!clientAuthenticated) {
        qrcode.toDataURL(qr, (err, url) => {
            qrCodeUrl = url;
            log('⚠️ NUEVO QR GENERADO. Escanéalo ahora.');
        });
    }
});

// Evento intermedio: Ya escaneaste, cargando datos...
client.on('authenticated', () => {
    clientAuthenticated = true;
    qrCodeUrl = null; // Quitar QR
    log('🔑 Autenticación exitosa. Cargando chats (esto puede tardar)...');
});

// Evento intermedio: Pantalla de carga de WhatsApp
client.on('loading_screen', (percent, message) => {
    clientAuthenticated = true;
    qrCodeUrl = null;
    log(`⏳ Cargando WhatsApp: ${percent}% - ${message}`);
});

client.on('ready', () => {
    clientReady = true;
    clientAuthenticated = true;
    qrCodeUrl = null;
    log('✅ WhatsApp TOTALMENTE CONECTADO y listo.');
});

client.on('auth_failure', (msg) => {
    log('❌ Fallo de autenticación: ' + msg);
    clientAuthenticated = false;
    clientReady = false;
});

client.on('disconnected', (reason) => {
    log('⚠️ WhatsApp desconectado: ' + reason);
    clientReady = false;
    clientAuthenticated = false;
    // Si se desconecta, intentamos reiniciar
    client.initialize(); 
});

// --- GOOGLE CALENDAR (Sin cambios) ---
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
    log('❌ Error cargando credenciales: ' + error.message);
}

const calendar = google.calendar({ version: 'v3', auth });

async function revisarTurnosYEnviar() {
    if (!clientReady) {
        log('❌ No se puede revisar: WhatsApp no está listo aún.');
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
            log('ℹ️ No hay eventos agendados para mañana.');
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
                const chatId = `${formattedNumber}@c.us`;
                const horaInicio = moment(event.start.dateTime || event.start.date).tz(TIMEZONE).format('HH:mm');
                
                const mensaje = `Hola ${nombreCliente}! 👋\n\nTe escribo para recordarte tu turno de mañana a las *${horaInicio} hs*.\n\nPor favor, confirmame asistencia.\n¡Gracias!`;

                if (await client.isRegisteredUser(chatId)) {
                    await client.sendMessage(chatId, mensaje);
                    log(`✅ Enviado a ${nombreCliente}`);
                    enviados++;
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
        log(`🏁 Fin revisión. Enviados: ${enviados}`);
    } catch (error) {
        log('❌ Error calendario: ' + error.message);
    }
}

// --- SERVIDOR WEB ---
app.get('/', (req, res) => {
    let statusColor = '#f8d7da'; // Rojo
    let statusText = '❌ DESCONECTADO';
    
    if (clientReady) {
        statusColor = '#d4edda'; // Verde
        statusText = '✅ TOTALMENTE CONECTADO';
    } else if (clientAuthenticated) {
        statusColor = '#fff3cd'; // Amarillo
        statusText = '⏳ AUTENTICADO (Cargando chats...)';
    }

    let html = `
    <html>
        <head>
            <title>Bot Turnos</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body{font-family:sans-serif; text-align:center; padding:20px; max-width:600px; margin:0 auto;}
                .status{padding:15px; background:${statusColor}; border-radius:8px; margin-bottom:20px;}
                .log{text-align:left; background:#f0f0f0; padding:10px; height:300px; overflow-y:auto; font-family:monospace; font-size:12px; border-radius:8px;}
                img{max-width:100%; height:auto; border: 5px solid #333;}
                .btn{display:inline-block; padding:10px 20px; background:#007bff; color:white; text-decoration:none; border-radius:5px; margin:10px;}
            </style>
        </head>
        <body>
            <h1>🤖 Bot de Turnos</h1>
            <div class="status"><h3>${statusText}</h3></div>
    `;

    if (!clientReady && !clientAuthenticated && qrCodeUrl) {
        html += `<div><h3>Escanea este QR:</h3><img src="${qrCodeUrl}" /></div>`;
    } else if (!clientReady && !clientAuthenticated) {
        html += `<div><p>🔄 Esperando QR...</p></div>`;
    }

    html += `<a href="/forzar" class="btn">⚡ Forzar Revisión</a>`;
    html += `<h3>Logs:</h3><div class="log">${logs.join('<br>')}</div></body></html>`;
    res.send(html);
});

app.get('/forzar', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

cron.schedule('0 7 * * *', () => {
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });

app.listen(port, () => {
    log(`🌐 Servidor iniciado en puerto ${port}`);
    client.initialize();
});