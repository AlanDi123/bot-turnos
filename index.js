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
let logs = [];

// Función para logs
function log(message) {
    const timestamp = moment().tz(TIMEZONE).format('DD/MM HH:mm:ss');
    const logMsg = `[${timestamp}] ${message}`;
    console.log(logMsg);
    logs.unshift(logMsg); 
    if (logs.length > 50) logs.pop(); 
}

// --- 1. LIMPIEZA DE SESIÓN CORRUPTA ---
// En Render Free, esto ayuda a evitar el loop de "Iniciando sesión"
// borrando datos viejos que puedan estar trabados.
const SESSION_PATH = './.wwebjs_auth';
if (fs.existsSync(SESSION_PATH)) {
    try {
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        console.log('🧹 Sesión anterior limpiada para asegurar un inicio limpio.');
    } catch (e) {
        console.log('⚠️ No se pudo limpiar la sesión (puede que no exista o esté en uso).');
    }
}

// --- CONFIGURACIÓN WHATSAPP ---
const client = new Client({
    authStrategy: new LocalAuth({ 
        dataPath: SESSION_PATH 
    }),
    // 2. OPTIMIZACIONES PARA EVITAR "SIN CONEXIÓN" EN EL CELULAR
    authTimeoutMs: 0, // Paciencia infinita
    qrMaxRetries: 10, // Más intentos de QR
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
            // 3. EL DISFRAZ (User Agent)
            // Esto es VITAL para que WhatsApp no detecte el bot como "lento" y corte la conexión
            '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36' 
        ]
    },
    // Evita descargar versiones nuevas pesadas que saturan la memoria
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeUrl = url;
        log('⚠️ NUEVO QR GENERADO. Escanéalo ahora.');
    });
});

client.on('ready', () => {
    clientReady = true;
    qrCodeUrl = null;
    log('✅ WhatsApp Conectado y Sincronizado.');
});

client.on('auth_failure', (msg) => {
    log('❌ Fallo de autenticación: ' + msg);
    clientReady = false;
});

client.on('disconnected', (reason) => {
    log('⚠️ WhatsApp desconectado: ' + reason);
    clientReady = false;
    // Si se desconecta, reiniciamos el proceso (Render lo volverá a levantar)
    process.exit(1); 
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

                const isRegistered = await client.isRegisteredUser(chatId);
                if (isRegistered) {
                    await client.sendMessage(chatId, mensaje);
                    log(`✅ Enviado a ${nombreCliente} (${horaInicio}hs)`);
                    enviados++;
                    await new Promise(r => setTimeout(r, 5000));
                } else {
                    log(`⚠️ Número sin WhatsApp: ${formattedNumber}`);
                }
            }
        }
        log(`🏁 Revisión finalizada. Mensajes enviados: ${enviados}`);

    } catch (error) {
        log('❌ Error leyendo calendario: ' + error.message);
    }
}

// --- SERVIDOR WEB ---
app.get('/', (req, res) => {
    const statusColor = clientReady ? '#d4edda' : '#fff3cd';
    const statusText = clientReady ? '✅ CONECTADO' : '⏳ ESPERANDO VINCULACIÓN';
    
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

    if (!clientReady && qrCodeUrl) {
        html += `<div><h3>Escanea este QR:</h3><img src="${qrCodeUrl}" /></div>`;
    } else if (!clientReady) {
        html += `<div><p>🔄 Generando código QR... (Si tarda mucho, recarga la página)</p></div>`;
    }

    html += `<a href="/forzar" class="btn">⚡ Ejecutar Revisión Ahora</a>`;
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
    log(`🌐 Servidor web iniciado en puerto ${port}`);
    // Pequeño retardo para asegurar que el sistema esté listo
    setTimeout(() => {
        client.initialize().catch(err => log('Fatal: ' + err.message));
    }, 2000);
});