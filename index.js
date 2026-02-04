// --- PARCHE CRÍTICO DE CRYPTO ---
const crypto = require('crypto');
if (!global.crypto) {
    global.crypto = {
        getRandomValues: (arr) => crypto.randomBytes(arr.length),
    };
}
// -------------------------------

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    Browsers, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
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
const KEYWORD_TURNO = 'turno'; // Minúsculas para normalizar
const AUTH_FOLDER = 'auth_info_baileys';

// Estado global
let sock;
let qrCodeUrl = null;
let isConnected = false;
let lastRun = "Aún no ejecutado";
let nextRun = "Mañana 07:00 AM";
let logs = [];

function log(msg) {
    const time = moment().tz(TIMEZONE).format('HH:mm:ss');
    logs.unshift({ time, msg });
    if (logs.length > 100) logs.pop();
    console.log(`[${time}] ${msg}`);
}

// --- LIMPIEZA INICIAL ---
if (fs.existsSync(AUTH_FOLDER)) {
    try {
        fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        console.log('🧹 Sesión limpiada.');
    } catch (e) {
        console.log('⚠️ Error limpiando: ' + e.message);
    }
}

// --- CONEXIÓN WHATSAPP ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`ℹ️ Versión WA: v${version.join('.')}`);

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'fatal' }), 
        browser: Browsers.macOS('Desktop'), 
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 250,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            log('⚠️ Escanea el código QR para vincular.');
            qrCodeUrl = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            log(`❌ Desconectado (Código: ${statusCode}). Reintentando: ${shouldReconnect}`);
            isConnected = false;
            qrCodeUrl = null;

            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            log('✅ Conexión establecida con WhatsApp.');
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

// --- FUNCIÓN PRINCIPAL DE BÚSQUEDA ---
async function revisarTurnosYEnviar() {
    lastRun = moment().tz(TIMEZONE).format('DD/MM HH:mm');
    if (!isConnected) {
        log('⛔ Error: Intento de envío sin conexión.');
        return;
    }

    // 1. CÁLCULO DE FECHAS PRECISO EN UTC-3
    const hoy = moment().tz(TIMEZONE);
    const manana = hoy.clone().add(1, 'days');
    
    // Forzamos el inicio y fin del día "Mañana"
    const timeMin = manana.clone().startOf('day').toISOString();
    const timeMax = manana.clone().endOf('day').toISOString();

    log(`📅 Buscando eventos para: ${manana.format('DD/MM/YYYY')}`);
    log(`🕒 Rango UTC: ${timeMin} -> ${timeMax}`);

    try {
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items;
        
        // Log para ver qué encontró Google en crudo
        if (!events || events.length === 0) {
            log('ℹ️ Google dice: 0 eventos encontrados en ese rango.');
            return;
        } else {
            log(`ℹ️ Google encontró ${events.length} eventos. Analizando...`);
        }

        let enviados = 0;
        
        for (const event of events) {
            const tituloOriginal = event.summary || '[Sin Título]';
            const descripcion = event.description || '';
            
            // 2. NORMALIZACIÓN DE TEXTO (Quitar acentos y minúsculas)
            // Ejemplo: "Túrno" -> "turno"
            const tituloNormalizado = tituloOriginal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            // Verificar palabra clave
            if (!tituloNormalizado.includes(KEYWORD_TURNO)) {
                log(`⏭️ Ignorado: "${tituloOriginal}" (No dice 'Turno')`);
                continue;
            }

            // 3. EXTRACCIÓN DE DATOS INTELIGENTE
            let nombreCliente = tituloOriginal.replace(/turno/ig, '').trim();
            if(nombreCliente.length < 2) nombreCliente = "Cliente"; // Si borró todo, poner default

            // Regex mejorado: Busca 11, 15, o números largos. Elimina espacios y guiones antes de chequear.
            const descLimpia = descripcion.replace(/[\s-]/g, '');
            const phoneRegex = /(?:11|15)\d{8}/g; 
            const match = descLimpia.match(phoneRegex);

            if (match) {
                let rawNumber = match[0];
                let formattedNumber = `549${rawNumber}`;
                const jid = `${formattedNumber}@s.whatsapp.net`;
                
                // Manejo de horas
                let horaInicio;
                if (event.start.dateTime) {
                    horaInicio = moment(event.start.dateTime).tz(TIMEZONE).format('HH:mm');
                } else if (event.start.date) {
                    horaInicio = "el transcurso del día"; // Evento de todo el día
                }

                const mensaje = `Hola ${nombreCliente}! 👋\n\nTe recuerdo tu turno para mañana a las *${horaInicio} hs*.\n\nPor favor, confirmame asistencia.\n¡Gracias!`;

                try {
                    const [result] = await sock.onWhatsApp(jid);
                    
                    if (result && result.exists) {
                        await sock.sendMessage(result.jid, { text: mensaje });
                        log(`📤 Enviado a ${nombreCliente} (${horaInicio}hs)`);
                        enviados++;
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        log(`⚠️ El número ${formattedNumber} no tiene WhatsApp.`);
                    }
                } catch (e) {
                    log(`❌ Error enviando a ${nombreCliente}: ${e.message}`);
                }
            } else {
                log(`⚠️ "${tituloOriginal}" es un Turno, pero NO tiene número en la descripción.`);
            }
        }
        log(`🏁 Proceso finalizado. Mensajes enviados: ${enviados}`);
    } catch (error) {
        log('❌ Error Calendar API: ' + error.message);
    }
}

// --- SERVIDOR WEB ---
app.get('/', (req, res) => {
    const statusClass = isConnected ? 'status-online' : 'status-offline';
    const statusText = isConnected ? 'SISTEMA ONLINE' : 'DESCONECTADO';
    
    // Mostramos la fecha que el servidor cree que es "hoy" para depurar
    const serverTime = moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss');

    const logsHtml = logs.map(l => {
        let color = '#a7f3d0';
        if (l.msg.includes('❌') || l.msg.includes('⛔')) color = '#fca5a5';
        if (l.msg.includes('⚠️') || l.msg.includes('⏭️')) color = '#fde047';
        if (l.msg.includes('🔍') || l.msg.includes('📅')) color = '#93c5fd';
        return `<div class="log-entry"><span class="log-time">[${l.time}]</span> <span style="color:${color}">${l.msg}</span></div>`;
    }).join('');

    let html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Panel - Bot Turnos</title>
        <meta http-equiv="refresh" content="5">
        <style>
            :root { --bg: #f3f4f6; --card: #fff; --text: #1f2937; --accent: #3b82f6; --success: #10b981; --error: #ef4444; }
            body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 20px; display: flex; flex-direction: column; align-items: center; }
            .container { width: 100%; max-width: 900px; }
            .header { display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 20px; }
            .status-badge { padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 0.9rem; display: flex; align-items: center; gap: 8px; }
            .status-online { background: #d1fae5; color: var(--success); }
            .status-offline { background: #fee2e2; color: var(--error); }
            .pulse { width: 10px; height: 10px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
            
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px; }
            .card { background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .card h3 { margin-top: 0; color: #6b7280; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; }
            
            .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid #f3f4f6; padding-bottom: 5px; }
            .info-label { color: #6b7280; font-size: 0.9rem; }
            .info-value { font-weight: 600; }

            .btn { display: block; width: 100%; text-align: center; padding: 12px; background: var(--accent); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 10px; transition: 0.2s; }
            .btn:hover { filter: brightness(1.1); }
            
            .terminal { background: #111827; color: #e5e7eb; padding: 20px; border-radius: 12px; height: 400px; overflow-y: auto; font-family: 'Monaco', monospace; font-size: 0.85rem; }
            .log-entry { margin-bottom: 4px; border-bottom: 1px solid #1f2937; padding-bottom: 2px; }
            
            .qr-box img { width: 200px; border-radius: 8px; border: 4px solid var(--text); display: block; margin: 10px auto; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div>
                    <h1 style="margin:0; font-size:1.5rem;">🤖 Control de Turnos</h1>
                    <p style="margin:5px 0 0; color:#6b7280;">Bot Automatizado WhatsApp</p>
                </div>
                <div class="status-badge ${statusClass}">
                    <span class="pulse"></span> ${statusText}
                </div>
            </div>

            <div class="grid">
                <!-- Info Sistema -->
                <div class="card">
                    <h3>Estado del Sistema</h3>
                    <div class="info-row">
                        <span class="info-label">Hora Servidor (Arg):</span>
                        <span class="info-value">${serverTime}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Próxima Ejecución:</span>
                        <span class="info-value">${nextRun}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Último Escaneo:</span>
                        <span class="info-value">${lastRun}</span>
                    </div>
                </div>

                <!-- Acciones -->
                <div class="card">
                    <h3>Panel de Control</h3>
                    ${!isConnected && qrCodeUrl ? `
                        <div class="qr-box">
                            <img src="${qrCodeUrl}">
                            <p style="text-align:center; font-size:0.9rem;">Escanea para vincular</p>
                        </div>
                    ` : ''}

                    ${isConnected ? `
                        <div style="text-align:center; padding:10px;">
                            <div style="font-size:2.5rem; margin-bottom:10px;">✅</div>
                            <p>WhatsApp Vinculado</p>
                            <a href="/test" class="btn">⚡ Ejecutar Búsqueda Ahora</a>
                        </div>
                    ` : ''}
                    
                    ${!isConnected && !qrCodeUrl ? `<p style="text-align:center;">⏳ Iniciando servicios...</p>` : ''}
                </div>
            </div>

            <div class="terminal">
                <div style="color:#9ca3af; margin-bottom:15px; border-bottom:1px solid #374151; padding-bottom:10px;">
                    >_ SYSTEM LOGS
                </div>
                ${logsHtml}
            </div>
        </div>
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
    nextRun = moment().tz(TIMEZONE).add(1, 'days').format('DD/MM 07:00 AM');
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });