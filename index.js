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
let isStarting = false; // Para saber si estamos intentando conectar
let logs = [];

function log(message) {
    const timestamp = moment().tz(TIMEZONE).format('HH:mm:ss'); // Hora más corta
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    logs.unshift(logMsg); 
    if (logs.length > 50) logs.pop(); 
}

// --- CONFIGURACIÓN WHATSAPP ---
// Inicializamos la variable pero NO el cliente todavía
let client;

function iniciarWhatsApp() {
    if (clientReady || isStarting) return; // Evitar doble arranque
    
    isStarting = true;
    log('🚀 INICIANDO MOTOR DE WHATSAPP...');

    client = new Client({
        authStrategy: new LocalAuth({ 
            clientId: "bot-wsp-v3",
            dataPath: './.wwebjs_auth' 
        }),
        authTimeoutMs: 0, 
        qrMaxRetries: 10,
        takeoverOnConflict: true,
        
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
                '--disable-gpu',
                '--disable-extensions',
                '--disable-software-rasterizer' 
                // Hemos quitado '--single-process' para mejorar estabilidad
            ]
        }
    });

    client.on('qr', (qr) => {
        if (!clientAuthenticated) {
            qrcode.toDataURL(qr, (err, url) => {
                qrCodeUrl = url;
                log('⚠️ QR LISTO. Escanéalo ahora.');
            });
        }
    });

    client.on('authenticated', () => {
        clientAuthenticated = true;
        qrCodeUrl = null;
        log('🔑 Autenticado. Esperando sincronización...');
    });

    client.on('loading_screen', (percent, message) => {
        clientAuthenticated = true;
        qrCodeUrl = null;
        log(`⏳ Cargando: ${percent}%`);
    });

    client.on('ready', () => {
        clientReady = true;
        clientAuthenticated = true;
        isStarting = false;
        log('✅ ¡CONECTADO Y OPERATIVO!');
    });

    client.on('auth_failure', (msg) => {
        log('❌ Fallo Auth: ' + msg);
        clientAuthenticated = false;
        isStarting = false;
    });

    client.on('disconnected', (reason) => {
        log('⚠️ Desconectado: ' + reason);
        clientReady = false;
        clientAuthenticated = false;
        isStarting = false;
    });

    // Iniciar
    client.initialize().catch(err => {
        log('❌ Error Fatal al iniciar: ' + err.message);
        isStarting = false;
    });
}

// --- CALENDARIO (Mismo código de siempre) ---
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
        log('⛔ Intento fallido: El bot no está encendido.');
        return;
    }

    log('🔍 Buscando turnos...');
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
                    await new Promise(r => setTimeout(r, 6000));
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
    let statusColor = '#e2e3e5'; // Gris
    let statusText = '💤 EN ESPERA';
    let actionButton = `<a href="/start" class="btn btn-green">🚀 ENCENDER MOTOR</a>`;

    if (isStarting) {
        statusColor = '#fff3cd'; // Amarillo
        statusText = '⚙️ INICIANDO...';
        actionButton = `<p>Por favor espera...</p>`;
    } else if (clientReady) {
        statusColor = '#d4edda'; // Verde
        statusText = '✅ ONLINE';
        actionButton = `<a href="/test" class="btn btn-blue">⚡ Probar Envío</a>`;
    } else if (clientAuthenticated) {
        statusColor = '#cce5ff'; // Azul
        statusText = '🔄 SINCRONIZANDO...';
        actionButton = `<p>Cargando chats...</p>`;
    }

    let html = `
    <html>
        <head>
            <title>Bot Turnos</title>
            <meta http-equiv="refresh" content="5">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body{font-family:sans-serif; text-align:center; padding:20px; max-width:600px; margin:0 auto;}
                .status{padding:15px; background:${statusColor}; border-radius:8px; margin-bottom:20px; font-weight:bold;}
                .log{text-align:left; background:#f0f0f0; padding:10px; height:300px; overflow-y:auto; font-family:monospace; font-size:12px; border-radius:8px;}
                img{max-width:100%; height:auto; border: 5px solid #333; margin: 10px 0;}
                .btn{display:inline-block; padding:12px 24px; color:white; text-decoration:none; border-radius:5px; margin:10px; font-weight:bold;}
                .btn-green{background:#28a745;}
                .btn-blue{background:#007bff;}
            </style>
        </head>
        <body>
            <h1>🤖 Bot de Turnos</h1>
            <div class="status">${statusText}</div>
            
            ${actionButton}

            ${(!clientReady && !isStarting && qrCodeUrl) ? `<div><h3>QR Disponible:</h3><img src="${qrCodeUrl}" /></div>` : ''}
            ${(!clientReady && isStarting && qrCodeUrl) ? `<div><img src="${qrCodeUrl}" /><p>Escanea ahora</p></div>` : ''}

            <h3>Registro:</h3><div class="log">${logs.join('<br>')}</div>
        </body>
    </html>`;
    res.send(html);
});

// Endpoint para iniciar manualmente
app.get('/start', (req, res) => {
    if (!clientReady && !isStarting) {
        iniciarWhatsApp();
    }
    res.redirect('/');
});

app.get('/test', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

cron.schedule('0 7 * * *', () => {
    // Solo ejecuta si el usuario lo encendió previamente
    if(clientReady) revisarTurnosYEnviar();
}, { timezone: TIMEZONE });

// Arrancar solo el servidor web primero (Súper rápido)
app.listen(port, () => {
    log(`🌐 Servidor Web Listo. Esperando orden de encendido...`);
});