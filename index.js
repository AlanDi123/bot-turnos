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
let clientAuthenticated = false;
let logs = [];

function log(message) {
    const timestamp = moment().tz(TIMEZONE).format('DD/MM HH:mm:ss');
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    logs.unshift(logMsg); 
    if (logs.length > 50) logs.pop(); 
}

// --- CONFIGURACIÓN WHATSAPP (MODO AHORRO EXTREMO) ---
const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: "bot-wsp",
        dataPath: './.wwebjs_auth' 
    }),
    // Tiempos extendidos para evitar desconexiones por lentitud
    authTimeoutMs: 0, 
    qrMaxRetries: 10,
    takeoverOnConflict: true,
    
    // Versión fija ligera
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    
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
            '--disable-gpu',
            '--disable-extensions',
            // NUEVOS FLAGS PARA AHORRAR RAM:
            '--disable-software-rasterizer',
            '--disable-gl-drawing-for-tests',
            '--mute-audio',
            '--disable-notifications',
            '--disable-default-apps',
            '--disable-features=site-per-process' // Importante para servidores pequeños
        ]
    }
});

// EVENTOS
client.on('qr', (qr) => {
    if (!clientAuthenticated) {
        qrcode.toDataURL(qr, (err, url) => {
            qrCodeUrl = url;
            log('⚠️ NUEVO QR. Escanea ahora.');
        });
    }
});

client.on('authenticated', () => {
    clientAuthenticated = true;
    qrCodeUrl = null;
    log('🔑 Autenticado. Cargando chats en segundo plano...');
});

client.on('loading_screen', (percent, message) => {
    clientAuthenticated = true;
    qrCodeUrl = null;
    // Solo logueamos cada 20% para no saturar
    if (percent === 0 || percent === 50 || percent === 100) {
        log(`⏳ Sincronizando: ${percent}%`);
    }
});

client.on('ready', () => {
    clientReady = true;
    clientAuthenticated = true;
    log('✅ ¡SISTEMA ONLINE! WhatsApp conectado.');
});

client.on('auth_failure', (msg) => {
    log('❌ Fallo Auth: ' + msg);
    clientAuthenticated = false;
});

client.on('disconnected', (reason) => {
    log('⚠️ Desconectado: ' + reason);
    clientReady = false;
    clientAuthenticated = false;
    // Pequeña pausa antes de reiniciar para liberar RAM
    setTimeout(() => client.initialize(), 3000);
});

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
    log('❌ Error Credenciales: ' + error.message);
}

const calendar = google.calendar({ version: 'v3', auth });

async function revisarTurnosYEnviar() {
    if (!clientReady) {
        log('❌ WhatsApp no está listo todavía.');
        return;
    }

    log('🔍 Iniciando búsqueda de turnos...');
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
            log('ℹ️ No hay turnos mañana.');
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
                    // Pausa más larga para proteger RAM
                    await new Promise(r => setTimeout(r, 8000));
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
    let statusColor = '#f8d7da'; 
    let statusText = '❌ OFFLINE';
    
    if (clientReady) {
        statusColor = '#d4edda';
        statusText = '✅ ONLINE (Conectado)';
    } else if (clientAuthenticated) {
        statusColor = '#fff3cd';
        statusText = '⏳ CARGANDO (No tocar nada)';
    }

    let html = `
    <html>
        <head>
            <title>Bot Turnos</title>
            <meta http-equiv="refresh" content="10">
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
        html += `<div><h3>Escanear QR:</h3><img src="${qrCodeUrl}" /></div>`;
    }

    if (clientReady) {
        html += `<a href="/forzar" class="btn">⚡ Probar Envío</a>`;
    }
    
    html += `<h3>Logs:</h3><div class="log">${logs.join('<br>')}</div></body></html>`;
    res.send(html);
});

app.get('/forzar', (req, res) => {
    if(!clientReady) return res.send("Espera a que esté conectado.");
    revisarTurnosYEnviar();
    res.redirect('/');
});

cron.schedule('0 7 * * *', () => {
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });

app.listen(port, () => {
    log(`🌐 Iniciando (Modo Ahorro RAM)...`);
    client.initialize();
});