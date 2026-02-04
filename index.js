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
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const express = require('express');
const qrcode = require('qrcode');
const cron = require('node-cron');
const moment = require('moment-timezone');
require('moment/locale/es'); 
const fs = require('fs');
const pino = require('pino');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const app = express();
const port = process.env.PORT || 3000;
const TIMEZONE = 'America/Argentina/Buenos_Aires';
moment.locale('es'); 

// ⚠️ VALIDACIÓN DE EMAIL ⚠️
const EMAIL_DEFAULT = 'andreaquinonez249@gmail.com';
const CALENDAR_ID = process.env.CALENDAR_EMAIL || EMAIL_DEFAULT;

const KEYWORD_TURNO = 'turno';
const AUTH_FOLDER = 'auth_info_baileys';

// Estado global
let sock;
let qrCodeUrl = null;
let isConnected = false;
let lastRun = "Aún no ejecutado";
let nextRun = "Mañana 07:00 AM";
let logs = [];

// Logger optimizado
function log(msg) {
    const time = moment().tz(TIMEZONE).format('HH:mm:ss');
    logs.unshift({ time, msg });
    if (logs.length > 150) logs.pop(); // Aumenté un poco el historial
    console.log(`[${time}] ${msg}`);
}

// --- MANEJO DE ERRORES GLOBALES (ANTI-CRASH) ---
process.on('uncaughtException', (err) => {
    console.error('🔥 Error Crítico no capturado:', err);
    log('⛔ Error Interno Crítico (El bot sigue vivo)');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 Promesa rechazada no manejada:', reason);
});

// --- CONEXIÓN WHATSAPP ROBUSTA ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version } = await fetchLatestBaileysVersion();
    console.log(`ℹ️ Versión WA: v${version.join('.')}`);

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            // Optimización de cache para evitar errores de desencriptación
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: true,
        logger: pino({ level: 'fatal' }), 
        browser: Browsers.macOS('Desktop'), 
        syncFullHistory: false,
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000, // Aumenté el delay de reintento interno
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
            
            // Lógica de reconexión mejorada
            if (statusCode === DisconnectReason.loggedOut) {
                log('⛔ Sesión cerrada (Logout). Borrando credenciales...');
                if (fs.existsSync(AUTH_FOLDER)) fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                isConnected = false;
                connectToWhatsApp();
            } else {
                log(`❌ Desconectado (${statusCode}). Reconectando en 5s...`);
                // Limpieza de socket anterior para liberar memoria
                if(sock) sock.end(undefined);
                sock = undefined;
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            log('✅ Conexión establecida y estable.');
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

// --- PARSEO INTELIGENTE V2 (REGEX QUIRÚRGICO) ---
function extraerDatos(descripcion, eventStart) {
    // 1. HORA: Busca patrones de hora
    const regexHora = /(\d{1,2})[:\.\s]?(\d{2})?\s*(?:hs|hrs|h|:)?/i;
    const matchHora = descripcion ? descripcion.match(regexHora) : null;
    
    let horaFinal = "Horario a confirmar";

    if (matchHora) {
        let hora = matchHora[1];
        let minutos = matchHora[2] || "00";
        // Normalizar hora (ej: 9 -> 09)
        if (hora.length === 1) hora = '0' + hora;
        horaFinal = `${hora}:${minutos} hs`;
    } else if (eventStart.dateTime) {
        horaFinal = moment(eventStart.dateTime).tz(TIMEZONE).format('HH:mm') + ' hs';
    } else {
        horaFinal = "en el transcurso del día";
    }

    // 2. TELÉFONO (MEJORADO)
    // Busca específicamente patrones de celular argentino en CUALQUIER PARTE del texto
    // Soporta: 11-5555-4444, 11 5555 4444, 1555554444, 01155554444
    // No se confunde con precios ($2000) o DNI
    const regexTelefono = /(?:0?11|15|9011)[\s\.-]?(\d{3,4})[\s\.-]?(\d{4})/;
    const matchTel = descripcion ? descripcion.match(regexTelefono) : null;
    
    let telefonoFinal = null;

    if (matchTel) {
        // Unimos las partes encontradas (quita espacios o guiones intermedios)
        const parte1 = matchTel[1];
        const parte2 = matchTel[2];
        const numeroPuro = parte1 + parte2;
        
        // Validamos longitud (debe tener 8 dígitos útiles: 4+4 o 3+5)
        if (numeroPuro.length === 8) {
            telefonoFinal = `54911${numeroPuro}`;
        }
    }

    return { hora: horaFinal, telefono: telefonoFinal };
}

// --- FUNCIÓN PRINCIPAL DE BÚSQUEDA ---
async function revisarTurnosYEnviar() {
    lastRun = moment().tz(TIMEZONE).format('DD/MM HH:mm');
    
    // Validación de seguridad de Email
    if (CALENDAR_ID === EMAIL_DEFAULT) {
        log('⛔ ERROR CRÍTICO: No has configurado tu email en el código.');
        log('👉 Edita index.js línea 40 y pon tu Gmail.');
        return;
    }

    if (!isConnected) {
        log('⛔ Error: WhatsApp desconectado. Intentando reconectar...');
        // Intento forzoso de reconexión si está caído
        if(!sock) connectToWhatsApp();
        return;
    }

    const hoy = moment().tz(TIMEZONE);
    const mananaObjetivo = hoy.clone().add(1, 'days'); 
    
    const timeMin = hoy.clone().startOf('day').toISOString();
    const timeMax = hoy.clone().add(2, 'days').endOf('day').toISOString();

    log(`📅 Buscando turnos para: ${mananaObjetivo.format('DD/MM/YYYY')}`);

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
            
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;

            const tituloOriginal = event.summary || '[Sin Título]';
            const descripcion = event.description || '';
            const tituloNormalizado = tituloOriginal.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (!tituloNormalizado.includes(KEYWORD_TURNO)) continue;

            let nombreCliente = tituloOriginal.replace(/turno/ig, '').trim();
            if(nombreCliente.length < 2) nombreCliente = "Cliente";

            const datos = extraerDatos(descripcion, event.start);
            
            if (datos.telefono) {
                const jid = `${datos.telefono}@s.whatsapp.net`;
                
                // Formato Fecha: "Jueves 5 de febrero" (Corregido el error de 'de')
                let fechaTexto = mananaObjetivo.format('dddd D [de] MMMM');
                fechaTexto = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);

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
                log(`⚠️ "${tituloOriginal}" sin teléfono válido en descripción.`);
            }
        }
        
        log(`🏁 Proceso finalizado. Mensajes enviados: ${enviados}`);

    } catch (error) {
        log('❌ Error Calendar API: ' + error.message);
        if (error.code === 404 || error.message.includes('Not Found')) {
            log('💡 PISTA: Email de calendario incorrecto o no compartido.');
        }
    }
}

// --- SERVIDOR WEB ---
app.get('/', (req, res) => {
    const statusClass = isConnected ? 'status-online' : 'status-offline';
    const statusText = isConnected ? 'SISTEMA ONLINE' : 'DESCONECTADO';
    const serverTime = moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss');
    
    // Alerta visual si el email no está configurado
    let emailAlert = '';
    if (CALENDAR_ID === EMAIL_DEFAULT) {
        emailAlert = `<div style="background:#ef4444; color:white; padding:10px; border-radius:8px; margin-bottom:15px; font-weight:bold; animation: pulse 1s infinite;">
            ⚠️ ATENCIÓN: No has configurado tu Email en el código. El bot no funcionará.
        </div>`;
    }

    const logsHtml = logs.map(l => {
        let color = '#a7f3d0';
        if (l.msg.includes('❌') || l.msg.includes('⛔')) color = '#fca5a5';
        if (l.msg.includes('⚠️')) color = '#fde047';
        if (l.msg.includes('🔍') || l.msg.includes('📅')) color = '#93c5fd';
        if (l.msg.includes('📤')) color = '#c4b5fd'; 
        if (l.msg.includes('💡') || l.msg.includes('👉')) color = '#ffffff; font-weight:bold; background: #ef4444; padding: 2px 5px; border-radius: 3px;';
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
            ${emailAlert}
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