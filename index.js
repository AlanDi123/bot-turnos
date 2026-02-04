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
// Configuramos moment en español
require('moment/locale/es'); 
const fs = require('fs');
const pino = require('pino');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const app = express();
const port = process.env.PORT || 3000;
const TIMEZONE = 'America/Argentina/Buenos_Aires';
moment.locale('es'); // Establecer idioma español

// ⚠️ IMPORTANTE: PON TU EMAIL AQUI
const CALENDAR_ID = process.env.CALENDAR_EMAIL || 'andreaquinones249@gmail.com'; 

const KEYWORD_TURNO = 'turno';
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

// --- PERSISTENCIA DE SESIÓN ---
// HE QUITADO EL CÓDIGO QUE BORRABA LA CARPETA AL INICIO.
// Ahora la sesión se mantendrá guardada entre reinicios normales.

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
            const error = lastDisconnect?.error;
            const statusCode = error?.output?.statusCode;
            
            // Solo borramos la sesión si nos cerraron la cuenta (Logout)
            // Si es error de conexión (515, 408), NO borramos nada y reconectamos.
            if (statusCode === DisconnectReason.loggedOut) {
                log('⛔ Sesión cerrada desde el celular. Se requiere re-escanear.');
                if (fs.existsSync(AUTH_FOLDER)) fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                isConnected = false;
                connectToWhatsApp();
            } else {
                log(`❌ Desconectado (Código: ${statusCode}). Reintentando automáticamente...`);
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

// --- FUNCIÓN INTELIGENTE DE PARSEO ---
function extraerDatos(descripcion, eventStart) {
    // 1. EXTRAER HORA DE LA DESCRIPCIÓN
    // Busca patrones como: 14:00, 14.30, 14hs, 14 hs, 14h, 14 00
    const regexHora = /(\d{1,2})[:\.\s]?(\d{2})?\s*(?:hs|hrs|h|:)?/i;
    const matchHora = descripcion.match(regexHora);
    
    let horaFinal = "Horario a confirmar";

    if (matchHora) {
        // Si encontró algo en la descripción (ej: "14hs")
        let hora = matchHora[1];
        let minutos = matchHora[2] || "00";
        horaFinal = `${hora}:${minutos} hs`;
    } else if (eventStart.dateTime) {
        // Si no hay nada en descripción, usar hora de Google Calendar
        horaFinal = moment(eventStart.dateTime).tz(TIMEZONE).format('HH:mm') + ' hs';
    } else {
        // Evento de todo el día sin hora en descripción
        horaFinal = "en el transcurso del día";
    }

    // 2. EXTRAER TELÉFONO (Mejorado)
    // Limpiamos todo lo que no sea número
    const soloNumeros = descripcion.replace(/\D/g, '');
    let telefonoFinal = null;

    // Buscamos patrones: 
    // 11xxxxxxxx (10 dígitos)
    // 011xxxxxxxx (11 dígitos)
    // 15xxxxxxxx (10 dígitos, viejo formato)
    // 9011xxxxxxx (Raro, pero solicitado)
    
    // Regex flexible: Busca bloque de 8 dígitos al final precedido por prefijos conocidos
    // (0?11|15|9011) -> Prefijos
    // (\d{8}) -> El número real
    const matchTel = soloNumeros.match(/(?:0?11|15|9011)(\d{8})$/);

    if (matchTel) {
        const numeroLimpio = matchTel[1]; // Los últimos 8 dígitos
        telefonoFinal = `54911${numeroLimpio}`;
    }

    return { hora: horaFinal, telefono: telefonoFinal };
}

// --- FUNCIÓN PRINCIPAL DE BÚSQUEDA ---
async function revisarTurnosYEnviar() {
    lastRun = moment().tz(TIMEZONE).format('DD/MM HH:mm');
    if (!isConnected) {
        log('⛔ Error: Intento de envío sin conexión.');
        return;
    }

    const hoy = moment().tz(TIMEZONE);
    const mananaObjetivo = hoy.clone().add(1, 'days'); 
    
    const timeMin = hoy.clone().startOf('day').toISOString();
    const timeMax = hoy.clone().add(2, 'days').endOf('day').toISOString();

    log(`📅 Buscando turnos para el: ${mananaObjetivo.format('DD/MM/YYYY')}`);

    try {
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items;
        
        if (!events || events.length === 0) {
            log('ℹ️ 0 eventos encontrados en Calendar.');
            return;
        }

        let enviados = 0;
        
        for (const event of events) {
            const fechaEvento = moment(event.start.dateTime || event.start.date).tz(TIMEZONE);
            
            // Filtro estricto de día
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;

            const tituloOriginal = event.summary || '[Sin Título]';
            const descripcion = event.description || '';
            const tituloNormalizado = tituloOriginal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            // Filtro palabra clave
            if (!tituloNormalizado.includes(KEYWORD_TURNO)) continue;

            // Extraer Nombre
            let nombreCliente = tituloOriginal.replace(/turno/ig, '').trim();
            if(nombreCliente.length < 2) nombreCliente = "Cliente";

            // --- INTELIGENCIA DE DATOS ---
            const datos = extraerDatos(descripcion, event.start);
            
            if (datos.telefono) {
                const jid = `${datos.telefono}@s.whatsapp.net`;
                
                // Formato Fecha: "Jueves 5 de febrero"
                // charAt(0).toUpperCase() es para poner la primera letra en mayúscula (Jueves)
                let fechaTexto = mananaObjetivo.format('dddd D de MMMM');
                fechaTexto = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);

                // PLANTILLA DE MENSAJE SOLICITADA
                const mensaje = `🗓️ Sesión a realizar

Te comparto el registro del encuentro programado:
📅 Día: ${fechaTexto}
🕰️ Horario: ${datos.hora}

🔔 En caso de cancelación, se solicita avisar con 24 horas de anticipación.
De no cumplirse este plazo, se cobrará el valor total de la sesión.

💧 Para la sesión presencial, traer una botellita de agua.

Gracias por tu compromiso con este espacio de trabajo personal.
Cada paso consciente suma claridad y orden al proceso.

Grandioso Universo Terapias ✨`;

                try {
                    const [result] = await sock.onWhatsApp(jid);
                    if (result && result.exists) {
                        await sock.sendMessage(result.jid, { text: mensaje });
                        log(`📤 Enviado a ${nombreCliente} (${datos.hora})`);
                        enviados++;
                        await new Promise(r => setTimeout(r, 3000));
                    } else {
                        log(`⚠️ El número ${datos.telefono} no tiene WhatsApp.`);
                    }
                } catch (e) {
                    log(`❌ Error enviando a ${nombreCliente}: ${e.message}`);
                }
            } else {
                log(`⚠️ "${tituloOriginal}" detectado, pero sin teléfono válido en notas.`);
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
    const serverTime = moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss');

    const logsHtml = logs.map(l => {
        let color = '#a7f3d0';
        if (l.msg.includes('❌') || l.msg.includes('⛔')) color = '#fca5a5';
        if (l.msg.includes('⚠️')) color = '#fde047';
        if (l.msg.includes('🔍') || l.msg.includes('📅')) color = '#93c5fd';
        if (l.msg.includes('📤')) color = '#c4b5fd'; // Color especial para envíos
        return `<div class="log-entry"><span class="log-time">[${l.time}]</span> <span style="color:${color}">${l.msg}</span></div>`;
    }).join('');

    let html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Grandioso Universo - Bot</title>
        <meta http-equiv="refresh" content="5">
        <style>
            :root { --bg: #f8fafc; --card: #fff; --text: #334155; --accent: #8b5cf6; --success: #10b981; --error: #ef4444; }
            body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 20px; display: flex; flex-direction: column; align-items: center; }
            .container { width: 100%; max-width: 900px; }
            .header { display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 20px; border-left: 5px solid var(--accent); }
            .status-badge { padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 0.9rem; display: flex; align-items: center; gap: 8px; }
            .status-online { background: #d1fae5; color: var(--success); }
            .status-offline { background: #fee2e2; color: var(--error); }
            .pulse { width: 10px; height: 10px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
            @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
            
            .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 20px; }
            .card { background: var(--card); padding: 25px; border-radius: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .card h3 { margin-top: 0; color: #64748b; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 15px; }
            
            .info-row { display: flex; justify-content: space-between; margin-bottom: 12px; }
            .info-label { color: #64748b; font-size: 0.9rem; }
            .info-value { font-weight: 600; color: var(--text); }

            .btn { display: block; width: 100%; text-align: center; padding: 14px; background: var(--accent); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 15px; transition: 0.2s; box-shadow: 0 4px 6px -1px rgba(139, 92, 246, 0.3); }
            .btn:hover { background: #7c3aed; transform: translateY(-1px); }
            
            .terminal { background: #0f172a; color: #e2e8f0; padding: 20px; border-radius: 12px; height: 400px; overflow-y: auto; font-family: 'Consolas', monospace; font-size: 0.85rem; border: 1px solid #1e293b; }
            .log-entry { margin-bottom: 5px; border-bottom: 1px solid #1e293b; padding-bottom: 3px; display: flex; }
            .log-time { color: #64748b; margin-right: 10px; min-width: 70px; }
            
            .qr-box img { width: 220px; border-radius: 12px; border: 4px solid var(--text); display: block; margin: 15px auto; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div>
                    <h1 style="margin:0; font-size:1.6rem; color: #4c1d95;">Grandioso Universo ✨</h1>
                    <p style="margin:5px 0 0; color:#64748b;">Gestión de Turnos y Recordatorios</p>
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
                        <span class="info-label">Calendario:</span>
                        <span class="info-value" style="font-size:0.8rem">${CALENDAR_ID}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Hora Actual:</span>
                        <span class="info-value">${serverTime}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Siguiente Barrido:</span>
                        <span class="info-value">${nextRun}</span>
                    </div>
                </div>

                <!-- Acciones -->
                <div class="card">
                    <h3>Acciones</h3>
                    ${!isConnected && qrCodeUrl ? `
                        <div class="qr-box">
                            <img src="${qrCodeUrl}">
                            <p style="text-align:center; font-size:0.9rem; margin-top:10px;">Escanea para conectar</p>
                        </div>
                    ` : ''}

                    ${isConnected ? `
                        <div style="text-align:center; padding:10px;">
                            <div style="font-size:3rem; margin-bottom:10px;">✅</div>
                            <p><strong>Bot Activo</strong><br>Sesión Guardada</p>
                            <a href="/test" class="btn">⚡ Ejecutar Búsqueda</a>
                        </div>
                    ` : ''}
                    
                    ${!isConnected && !qrCodeUrl ? `<p style="text-align:center; color:#64748b;">⏳ Iniciando motor...</p>` : ''}
                </div>
            </div>

            <div class="terminal">
                <div style="color:#64748b; margin-bottom:15px; border-bottom:1px solid #334155; padding-bottom:10px; font-weight:bold;">
                    >_ TERMINAL DE EVENTOS
                </div>
                ${logsHtml}
            </div>
            
            <p style="text-align:center; color:#94a3b8; font-size:0.8rem; margin-top:20px;">
                © 2026 Grandioso Universo Terapias
            </p>
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
