/**
 * 🤖 GRANDIOSO UNIVERSO - VERSIÓN 9.0 (INTELIGENCIA NATURAL)
 * - Extracción automática de datos del perfil (Nombre/Tel).
 * - Comprensión de fechas relativas ("próximo viernes", "en un mes").
 * - Sin necesidad de escribir teléfonos manualmente.
 */

const crypto = require('crypto');
if (!global.crypto) {
    global.crypto = {
        getRandomValues: (arr) => crypto.randomBytes(arr.length),
    };
}

const { 
    default: makeWASocket, 
    DisconnectReason, 
    Browsers, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    useMultiFileAuthState,
    delay
} = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const express = require('express');
const qrcode = require('qrcode');
const cron = require('node-cron');
const moment = require('moment-timezone');
const fs = require('fs');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
require('dotenv').config();
require('moment/locale/es');

// ==========================================
// ⚙️ CONFIGURACIÓN
// ==========================================
const app = express();
const port = process.env.PORT || 3000;

const APP_CONFIG = {
    calendarId: 'andreaquinonez249@gmail.com',
    
    // EMOJIS DE COMANDO
    EMOJI_AGENDAR: '🗓️', 
    EMOJI_CANCELAR: '🚫',
    
    timezone: 'America/Argentina/Buenos_Aires',
    zipName: 'backup_sesion_whatsapp.zip',
    folderName: 'BOT_DATA',
    authFolder: './auth_info_baileys',
    defaultDuration: 60
};

moment.locale('es');
moment.tz.setDefault(APP_CONFIG.timezone);

let sock;
let logs = [];
let isConnected = false;
let qrCodeUrl = null;

function log(msg) {
    const time = moment().tz(APP_CONFIG.timezone).format('HH:mm');
    logs.unshift({ time, msg });
    if (logs.length > 50) logs.pop();
    console.log(`[${time}] ${msg}`);
}

// ==========================================
// ☁️ DRIVE & CALENDAR
// ==========================================
let authClient;
try {
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        authClient = google.auth.fromJSON(credentials);
        authClient.scopes = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive'];
    }
} catch (error) { console.error('❌ Error Credenciales:', error.message); }

const calendar = google.calendar({ version: 'v3', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });

async function encontrarCarpetaBot() {
    try {
        const res = await drive.files.list({
            q: `name = '${APP_CONFIG.folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id)',
        });
        return res.data.files[0] ? res.data.files[0].id : null;
    } catch (e) { return null; }
}

async function restaurarSesionDesdeDrive() {
    log('☁️ Sincronizando Aura (Drive)...');
    try {
        const res = await drive.files.list({ q: `name = '${APP_CONFIG.zipName}' and trashed = false`, fields: 'files(id)' });
        if (res.data.files.length > 0) {
            const dest = fs.createWriteStream('./session.zip');
            const result = await drive.files.get({ fileId: res.data.files[0].id, alt: 'media' }, { responseType: 'stream' });
            await new Promise((resolve, reject) => result.data.on('end', resolve).on('error', reject).pipe(dest));
            
            const stats = fs.statSync('./session.zip');
            if (stats.size > 0) {
                const zip = new AdmZip('./session.zip');
                zip.extractAllTo('./', true);
                log('✅ Memoria Restaurada.');
            }
        }
    } catch (e) { log('✨ Inicio limpio de energía.'); }
}

async function guardarSesionEnDrive() {
    if (!fs.existsSync(APP_CONFIG.authFolder)) return;
    try {
        const folderId = await encontrarCarpetaBot();
        if (!folderId) return log('❌ Falta carpeta BOT_DATA en Drive.');
        
        const zip = new AdmZip();
        zip.addLocalFolder(APP_CONFIG.authFolder, APP_CONFIG.authFolder);
        zip.writeZip('./session.zip');
        
        const search = await drive.files.list({ q: `name = '${APP_CONFIG.zipName}' and '${folderId}' in parents`, fields: 'files(id)' });
        const media = { mimeType: 'application/zip', body: fs.createReadStream('./session.zip') };
        
        if (search.data.files.length > 0) {
            await drive.files.update({ fileId: search.data.files[0].id, media });
        } else {
            await drive.files.create({ requestBody: { name: APP_CONFIG.zipName, parents: [folderId] }, media });
        }
    } catch (e) { log('❌ Error Backup: ' + e.message); }
}

// ==========================================
// 🧠 INTELIGENCIA NATURAL (NLP AVANZADO)
// ==========================================

function analizarContextoAvanzado(texto) {
    const hoy = moment().tz(APP_CONFIG.timezone);
    let fechaDetectada = null;
    let horaDetectada = null;
    let nombreDetectado = null;

    const textoLower = texto.toLowerCase()
        .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u'); // Normalizar acentos

    // --- 1. DETECCIÓN DE FECHA ---
    
    // A. Fechas relativas simples
    if (textoLower.includes('pasado mañana')) {
        fechaDetectada = hoy.clone().add(2, 'days');
    } else if (textoLower.includes('mañana')) {
        fechaDetectada = hoy.clone().add(1, 'days');
    } else if (textoLower.includes('hoy')) {
        fechaDetectada = hoy.clone();
    }
    // B. "En un mes" / "El mes que viene"
    else if (textoLower.includes('un mes') || textoLower.includes('mes que viene')) {
        fechaDetectada = hoy.clone().add(1, 'month');
    }
    // C. "La próxima semana" (Asumimos lunes o mantiene día actual + 7)
    else if (textoLower.includes('proxima semana') || textoLower.includes('semana que viene')) {
        fechaDetectada = hoy.clone().add(1, 'week');
    }
    
    // D. Días de la semana ("Lunes", "Este viernes", "El próximo martes")
    const diasSemana = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
    let diaMencionado = -1;
    
    for (let i = 0; i < diasSemana.length; i++) {
        if (textoLower.includes(diasSemana[i])) {
            diaMencionado = i;
            break;
        }
    }

    if (diaMencionado !== -1 && !fechaDetectada) {
        // Calcular la diferencia de días
        let diff = diaMencionado - hoy.day();
        if (diff <= 0) diff += 7; // Si es hoy o ya pasó, es el de la próxima semana
        
        // Si dice "próximo [dia]", sumamos 7 días extra
        if (textoLower.includes('proximo') || textoLower.includes('siguiente')) {
            diff += 7;
        }
        
        fechaDetectada = hoy.clone().add(diff, 'days');
    }

    // E. Fechas cortas numéricas (5/2, 10-8)
    const regexFechaNum = /(\d{1,2})[\/.-](\d{1,2})/;
    const matchFechaNum = texto.match(regexFechaNum);
    if (matchFechaNum && !fechaDetectada) {
        const dia = parseInt(matchFechaNum[1]);
        const mes = parseInt(matchFechaNum[2]) - 1; // Meses en JS son 0-11
        fechaDetectada = hoy.clone().month(mes).date(dia);
        
        // Si la fecha ya pasó este año, asumir año siguiente
        if (fechaDetectada.isBefore(hoy, 'day')) {
            fechaDetectada.add(1, 'year');
        }
    }

    // --- 2. DETECCIÓN DE HORA ---
    // Soporta: 14:00, 14.30, 14hs, 14h, 14
    // Evitamos confundir días (ej: "dia 10") con horas. Buscamos contexto horario.
    const regexHora = /(\d{1,2})[:\.](\d{2})|(\d{1,2})\s*(?:hs|hrs|h)/i;
    const matchHora = texto.match(regexHora);
    
    if (matchHora) {
        let h, m = 0;
        if (matchHora[3]) { // Formato "14hs"
            h = parseInt(matchHora[3]);
        } else { // Formato "14:30"
            h = parseInt(matchHora[1]);
            m = parseInt(matchHora[2]);
        }
        
        // Validación lógica (0-23hs)
        if (h >= 0 && h < 24 && m >= 0 && m < 60) {
            horaDetectada = { h, m };
        }
    }

    // --- 3. DETECCIÓN DE NOMBRE ---
    // Estrategia: Buscar palabras Capitalizadas que NO sean comandos ni fechas
    const palabrasIgnoradas = [
        'Turno', 'Para', 'Hola', 'El', 'La', 'Los', 'Las', 'Agendar', 'Cancelar', 'Tenes', 
        'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo',
        'Mañana', 'Hoy', 'Este', 'Proximo', 'Mes', 'Semana', 'Hs', 'H'
    ];
    
    // Limpiamos emojis y símbolos
    const palabras = texto.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
                          .split(/\s+/);
    
    const posiblesNombres = palabras.filter(p => {
        // Debe empezar con Mayúscula, tener más de 2 letras y no estar en ignoradas
        return /^[A-Z][a-zñáéíóú]+$/.test(p) && !palabrasIgnoradas.includes(p);
    });

    if (posiblesNombres.length > 0) {
        nombreDetectado = posiblesNombres.join(' ');
    }

    return { fecha: fechaDetectada, hora: horaDetectada, nombre: nombreDetectado };
}

// ==========================================
// 📅 GESTIÓN DE CALENDARIO
// ==========================================

async function agendarDesdeContexto(remoteJid, msg) {
    const textoMsg = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const pushName = msg.pushName || "Paciente"; // Nombre del perfil de WhatsApp
    
    const datos = analizarContextoAvanzado(textoMsg);
    
    if (!datos.fecha || !datos.hora) {
        log(`⚠️ Faltan datos (fecha/hora) en: "${textoMsg}"`);
        return false;
    }

    // Construir fecha final
    const fechaFinal = datos.fecha.hour(datos.hora.h).minute(datos.hora.m).second(0);
    
    // Obtener Teléfono del JID (Chat ID)
    let telefono = remoteJid.split('@')[0].split(':')[0]; // Elimina @s.whatsapp.net y sufijos
    
    // Decidir Nombre: Texto > PushName > Genérico
    let nombreFinal = datos.nombre || pushName;

    const evento = {
        summary: `Turno ${nombreFinal}`, 
        description: `Paciente: ${nombreFinal}\nTel: ${telefono}\n(Auto-Agendado)`,
        start: { dateTime: fechaFinal.toISOString() },
        end: { dateTime: fechaFinal.clone().add(APP_CONFIG.defaultDuration, 'minutes').toISOString() },
        colorId: '2' // Sage
    };

    try {
        await calendar.events.insert({ calendarId: APP_CONFIG.calendarId, resource: evento });
        log(`📅 Agendado: ${fechaFinal.format('DD/MM HH:mm')} - ${nombreFinal} (${telefono})`);
        return true;
    } catch (e) {
        log('❌ Error Google Calendar: ' + e.message);
        return false;
    }
}

async function cancelarTurno(remoteJid) {
    // Busca por el teléfono del chat (JID)
    const telefono = remoteJid.split('@')[0].split(':')[0];
    const ahora = moment().tz(APP_CONFIG.timezone).toISOString();

    try {
        const res = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: ahora,
            singleEvents: true,
            q: telefono // Google busca este número en título o descripción
        });

        if (res.data.items.length > 0) {
            // Cancelamos el más próximo
            const eventoABorrar = res.data.items[0];
            await calendar.events.delete({ calendarId: APP_CONFIG.calendarId, eventId: eventoABorrar.id });
            log(`🗑️ Turno cancelado para: ${telefono}`);
            return true;
        } else {
            return false;
        }
    } catch (e) { return false; }
}

// ==========================================
// 📱 CONEXIÓN WHATSAPP
// ==========================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(APP_CONFIG.authFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })) },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 2000,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if(qr) qrCodeUrl = qrcode.toDataURL(qr);
        if(connection === 'open') {
            log("✅ Energía Conectada (WhatsApp Online).");
            isConnected = true;
            qrCodeUrl = null;
            setTimeout(guardarSesionEnDrive, 10000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- ESCUCHA DE MENSAJES (SECRETARIO) ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid;
        const fromMe = msg.key.fromMe; 
        const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        // 🚫 IGNORAR GRUPOS
        if (remoteJid.includes('@g.us') || remoteJid.includes('status') || remoteJid.includes('broadcast')) return;

        // SOLO ACTUAR SI LO ENVÍA EL USUARIO
        if (fromMe) {
            // AGENDAR
            if (texto.includes(APP_CONFIG.EMOJI_AGENDAR)) {
                // Pasamos el mensaje completo para sacar el pushName si hace falta
                let exito = await agendarDesdeContexto(remoteJid, msg);
                await sock.sendMessage(remoteJid, { react: { text: exito ? '👍' : '❓', key: msg.key } });
            }
            // CANCELAR
            if (texto.includes(APP_CONFIG.EMOJI_CANCELAR)) {
                const cancelado = await cancelarTurno(remoteJid);
                await sock.sendMessage(remoteJid, { react: { text: cancelado ? '👍' : '🤷‍♂️', key: msg.key } });
            }
        }
    });
}

// ==========================================
// 🔔 RECORDATORIOS 7 AM
// ==========================================
async function revisarTurnosYEnviar() {
    if (!isConnected) return;
    const hoy = moment().tz(APP_CONFIG.timezone);
    const mananaObjetivo = hoy.clone().add(1, 'days'); 
    
    try {
        const response = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: hoy.clone().startOf('day').toISOString(),
            timeMax: hoy.clone().add(2, 'days').endOf('day').toISOString(),
            singleEvents: true,
        });

        const events = response.data.items || [];
        
        for (const event of events) {
            const fechaEvento = moment(event.start.dateTime).tz(APP_CONFIG.timezone);
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;
            
            // Buscar teléfono en la descripción (generada por nosotros o manual)
            // Buscamos 10 a 13 dígitos
            const desc = event.description || '';
            const matchTel = desc.match(/(\d{10,13})/); 
            
            if (matchTel) {
                let telefono = matchTel[1];
                if (!telefono.startsWith('54')) telefono = '549' + telefono; 

                let fechaTexto = mananaObjetivo.format('dddd D [de] MMMM');
                fechaTexto = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);
                let hora = fechaEvento.format('HH:mm') + ' hs';

                const mensaje = `🗓️ Sesión a realizar

Te comparto el registro del encuentro programado:
📅 Día: ${fechaTexto}
🕰️ Horario: ${hora}

🔔 En caso de cancelación, se solicita avisar con 24 horas de anticipación.
De no cumplirse este plazo, se cobrará el valor total de la sesión.

💧 Para la sesión presencial, traer una botellita de agua.

Gracias por tu compromiso con este espacio de trabajo personal.
Cada paso consciente suma claridad y orden al proceso.
Grandioso Universo Terapias ✨`;

                const jid = `${telefono}@s.whatsapp.net`;
                const [res] = await sock.onWhatsApp(jid);
                if (res?.exists) {
                    await sock.sendMessage(jid, { text: mensaje });
                    log(`📤 Recordatorio enviado a ${telefono}`);
                    await delay(3000);
                }
            }
        }
    } catch (error) { log('❌ Error Cron: ' + error.message); }
}

// ==========================================
// 🌐 DASHBOARD VISUAL
// ==========================================
app.get('/api/turnos', async (req, res) => {
    try {
        const inicio = moment().tz(APP_CONFIG.timezone).startOf('month').subtract(7, 'days');
        const fin = moment().tz(APP_CONFIG.timezone).endOf('month').add(14, 'days');

        const response = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: inicio.toISOString(),
            timeMax: fin.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });

        const eventos = (response.data.items || []).map(ev => ({
            title: ev.summary || 'Ocupado',
            start: ev.start.dateTime || ev.start.date,
            end: ev.end.dateTime || ev.end.date,
            color: '#9c27b0',
            description: ev.description || ''
        }));

        res.json(eventos);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', async (req, res) => {
    let qrData = qrCodeUrl ? await qrCodeUrl : null;
    const statusClass = isConnected ? 'online' : 'offline';
    const statusText = isConnected ? 'Conectado y Armonizado' : 'Esperando Conexión';
    const logsHtml = logs.map(l => `<div class="log-item"><span class="log-time">${l.time}</span> ${l.msg}</div>`).join('');

    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grandioso Universo</title>
    <script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js'></script>
    <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #7b1fa2; --secondary: #e1bee7; --bg: #fdfbf7; --text: #4a148c; }
        body { font-family: 'Quicksand', sans-serif; background-color: var(--bg); color: var(--text); margin: 0; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, var(--primary), #4a148c); color: white; padding: 20px; border-radius: 15px; box-shadow: 0 4px 15px rgba(123, 31, 162, 0.3); margin-bottom: 20px; }
        .header h1 { margin: 0; font-size: 1.5rem; }
        .status-badge { background: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px;}
        .dot { width: 10px; height: 10px; border-radius: 50%; background: #eee; }
        .online .dot { background: #00e676; box-shadow: 0 0 10px #00e676; }
        .offline .dot { background: #ff1744; }
        .container { display: grid; grid-template-columns: 1fr 300px; gap: 20px; height: calc(100vh - 120px); }
        .calendar-card { background: white; border-radius: 15px; padding: 20px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); overflow: hidden; }
        #calendar { height: 100%; }
        .sidebar { display: flex; flex-direction: column; gap: 20px; }
        .card { background: white; border-radius: 15px; padding: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        .card h3 { margin-top: 0; color: var(--primary); border-bottom: 2px solid var(--secondary); padding-bottom: 5px; }
        .qr-box img { width: 100%; border-radius: 10px; border: 2px solid var(--secondary); }
        .logs-container { height: 300px; overflow-y: auto; font-size: 0.85rem; }
        .log-item { padding: 5px 0; border-bottom: 1px solid #f3e5f5; }
        .log-time { color: #999; font-size: 0.75rem; margin-right: 5px; }
        @media (max-width: 900px) { .container { grid-template-columns: 1fr; height: auto; } #calendar { height: 500px; } }
    </style>
</head>
<body>
    <div class="header">
        <div><h1>✨ Grandioso Universo</h1><small>Gestión Energética</small></div>
        <div class="status-badge ${statusClass}"><div class="dot"></div> ${statusText}</div>
    </div>
    <div class="container">
        <div class="calendar-card"><div id="calendar"></div></div>
        <div class="sidebar">
            ${!isConnected && qrData ? `<div class="card"><h3>📲 Vincular</h3><div class="qr-box"><img src="${qrData}"></div><p style="text-align:center;font-size:0.9rem;">Escanea desde WhatsApp</p></div>` : ''}
            <div class="card"><h3>📜 Registro</h3><div class="logs-container">${logsHtml}</div></div>
            <div class="card"><h3>💎 Acciones</h3><a href="/test" style="display:block;text-align:center;background:var(--secondary);color:var(--primary);padding:10px;text-decoration:none;border-radius:8px;font-weight:bold;">⚡ Forzar Recordatorios</a></div>
        </div>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var calendarEl = document.getElementById('calendar');
            var calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth', locale: 'es',
                headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
                events: '/api/turnos', eventColor: '#9c27b0', height: '100%',
                eventClick: function(info) { alert('Paciente: ' + info.event.title + '\\n' + (info.event.extendedProps.description || '')); }
            });
            calendar.render();
        });
        setTimeout(() => location.reload(), 60000);
    </script>
</body>
</html>`);
});

app.get('/test', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

app.listen(port, async () => {
    log(`🌐 Portal Web Abierto.`);
    await restaurarSesionDesdeDrive();
    connectToWhatsApp();
});

cron.schedule('0 * * * *', () => guardarSesionEnDrive());
cron.schedule('0 7 * * *', () => revisarTurnosYEnviar(), { timezone: APP_CONFIG.timezone });