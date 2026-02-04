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
const KEYWORD_TURNO = 'Turno'; // Filtro de búsqueda

// Variables de estado
let qrCodeUrl = null;
let clientReady = false;
let logs = [];

// Función para guardar logs visibles en la web
function log(message) {
    const timestamp = moment().tz(TIMEZONE).format('DD/MM HH:mm:ss');
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    logs.unshift(logMsg); 
    if (logs.length > 50) logs.pop(); 
}

// --- CONFIGURACIÓN WHATSAPP (MODO ULTRA LIGERO) ---
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        // Usamos el Chrome instalado en el sistema (Docker) en vez del interno
        executablePath: '/usr/bin/google-chrome-stable', 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Fundamental para ahorrar RAM
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
            '--autoplay-policy=user-gesture-required'
        ]
    }
});

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeUrl = url;
        log('⚠️ NUEVO QR GENERADO. Escanéalo arriba.');
    });
});

client.on('ready', () => {
    clientReady = true;
    qrCodeUrl = null;
    log('✅ WhatsApp Conectado y listo.');
});

client.on('auth_failure', () => {
    log('❌ Fallo de autenticación. Reinicia o re-escanea.');
    clientReady = false;
});

client.on('disconnected', () => {
    log('⚠️ WhatsApp desconectado. Reiniciando...');
    clientReady = false;
    client.initialize();
});

// --- GOOGLE CALENDAR ---
let auth;
try {
    // Intenta leer la variable de entorno de Render
    const credentialsContent = process.env.GOOGLE_CREDENTIALS;
    if (credentialsContent) {
        const credentials = JSON.parse(credentialsContent);
        auth = google.auth.fromJSON(credentials);
        auth.scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
    } 
    // Fallback para pruebas locales (si existe el archivo)
    else if (fs.existsSync('./credentials.json')) {
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
        log('❌ No se puede revisar: WhatsApp desconectado.');
        return;
    }
    if (!auth) {
        log('❌ No hay credenciales de Google configuradas.');
        return;
    }

    log('🔍 Buscando turnos para MAÑANA...');
    
    // Definir rango: Mañana desde 00:00 hasta 23:59
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
            
            // 1. Filtrar por palabra clave
            if (!titulo.toLowerCase().includes(KEYWORD_TURNO.toLowerCase())) continue;

            // 2. Extraer nombre
            let nombreCliente = titulo.replace(/turno/ig, '').trim() || "Cliente";

            // 3. Extraer teléfono (busca 11... o 15...)
            const phoneRegex = /(?:11|15)\d{8}/g; 
            const match = descripcion.match(phoneRegex);

            if (match) {
                let rawNumber = match[0];
                // Formatear a internacional (549 + area + numero)
                let formattedNumber = `549${rawNumber}`;
                const chatId = `${formattedNumber}@c.us`;
                
                const horaInicio = moment(event.start.dateTime || event.start.date).tz(TIMEZONE).format('HH:mm');
                
                // Mensaje
                const mensaje = `Hola ${nombreCliente}! 👋\n\nTe recuerdo tu turno de mañana a las *${horaInicio} hs*.\n\nPor favor, confirmame asistencia.\n¡Gracias!`;

                // Enviar
                const isRegistered = await client.isRegisteredUser(chatId);
                if (isRegistered) {
                    await client.sendMessage(chatId, mensaje);
                    log(`✅ Enviado a ${nombreCliente} (${horaInicio}hs)`);
                    enviados++;
                    await new Promise(r => setTimeout(r, 3000)); // Espera antispam
                } else {
                    log(`⚠️ El número ${formattedNumber} no tiene WhatsApp.`);
                }
            }
        }
        log(`🏁 Revisión finalizada. Mensajes enviados: ${enviados}`);

    } catch (error) {
        log('❌ Error leyendo calendario: ' + error.message);
    }
}

// --- SERVIDOR WEB (Para ver el QR en la nube) ---
app.get('/', (req, res) => {
    const statusColor = clientReady ? '#d4edda' : '#f8d7da';
    const statusText = clientReady ? '✅ CONECTADO' : '❌ DESCONECTADO (Escanea el QR)';
    
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
                img{max-width:100%; height:auto;}
                .btn{display:inline-block; padding:10px 20px; background:#007bff; color:white; text-decoration:none; border-radius:5px; margin:10px;}
            </style>
        </head>
        <body>
            <h1>🤖 Bot de Turnos</h1>
            <div class="status"><h3>${statusText}</h3></div>
    `;

    if (!clientReady && qrCodeUrl) {
        html += `<div><img src="${qrCodeUrl}" /><p>Escanea con WhatsApp > Dispositivos vinculados</p></div>`;
    }

    html += `<a href="/forzar" class="btn">⚡ Ejecutar Revisión Ahora</a>`;
    html += `<h3>Registro de Actividad (Logs)</h3><div class="log">${logs.join('<br>')}</div></body></html>`;
    res.send(html);
});

// Botón de pánico para ejecutar manualmente
app.get('/forzar', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

// Cron Job: 07:00 AM todos los días
cron.schedule('0 7 * * *', () => {
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });

// Inicio
app.listen(port, () => {
    log(`🌐 Servidor web iniciado en puerto ${port}`);
    client.initialize();
});