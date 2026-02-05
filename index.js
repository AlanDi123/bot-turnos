/**
 * 🤖 GRANDIOSO UNIVERSO - VERSIÓN HÍBRIDA (VELOCIDAD + RESPALDO)
 * - Usa disco local para velocidad máxima (cero lag).
 * - Hace copias de seguridad en Drive para no perder la sesión.
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
    triggerPhrase: 'tenes un turno para',
    startHour: 8,
    endHour: 18,
    breakStart: 12,
    breakEnd: 13,
    defaultDuration: 60,
    bufferMinutes: 30,
    minNoticeHours: 3,
    timezone: 'America/Argentina/Buenos_Aires',
    zipName: 'backup_sesion_whatsapp.zip', // Nombre del archivo en Drive
    authFolder: './auth_info_baileys',      // Carpeta local rápida
    workDays: [1, 2, 3, 4, 5]
};

moment.locale('es');
moment.tz.setDefault(APP_CONFIG.timezone);

// Estado
const conversationState = {};
const FLOW = { IDLE: 'IDLE', ASK_NAME: 'ASK_NAME', ASK_DNI: 'ASK_DNI', ASK_DOB: 'ASK_DOB', ASK_REASON: 'ASK_REASON', SELECT_SLOT: 'SELECT_SLOT' };
let sock;
let logs = [];
let isConnected = false;
let qrCodeUrl = null;

function log(msg) {
    const time = moment().tz(APP_CONFIG.timezone).format('HH:mm:ss');
    logs.unshift({ time, msg });
    if (logs.length > 150) logs.pop();
    console.log(`[${time}] ${msg}`);
}

// ==========================================
// ☁️ SISTEMA DE RESPALDO (DRIVE)
// ==========================================
let authClient;
try {
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        authClient = google.auth.fromJSON(credentials);
        authClient.scopes = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/drive.file'];
    }
} catch (error) { console.error('❌ Error Credenciales:', error.message); }

const calendar = google.calendar({ version: 'v3', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });

// 1. DESCARGAR SESIÓN AL INICIAR
async function restaurarSesionDesdeDrive() {
    log('☁️ Buscando copia de seguridad en Drive...');
    try {
        // Buscar el archivo ZIP
        const res = await drive.files.list({
            q: `name = '${APP_CONFIG.zipName}' and trashed = false`,
            fields: 'files(id, name)',
        });

        if (res.data.files.length > 0) {
            const fileId = res.data.files[0].id;
            log('📥 Descargando sesión encontrada...');
            
            const dest = fs.createWriteStream('./session.zip');
            const result = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
            
            await new Promise((resolve, reject) => {
                result.data
                    .on('end', () => resolve())
                    .on('error', err => reject(err))
                    .pipe(dest);
            });

            // Descomprimir
            const zip = new AdmZip('./session.zip');
            zip.extractAllTo('./', true); // Extrae en la raíz, creando la carpeta auth_info_baileys
            log('✅ Sesión restaurada correctamente.');
        } else {
            log('ℹ️ No hay copias previas. Se iniciará sesión nueva.');
        }
    } catch (e) {
        log('⚠️ Error restaurando sesión (Continuando limpio): ' + e.message);
    }
}

// 2. SUBIR SESIÓN (BACKUP)
async function guardarSesionEnDrive() {
    if (!fs.existsSync(APP_CONFIG.authFolder)) return;
    
    log('☁️ Creando copia de seguridad...');
    try {
        // Comprimir carpeta
        const zip = new AdmZip();
        zip.addLocalFolder(APP_CONFIG.authFolder, APP_CONFIG.authFolder);
        zip.writeZip('./session.zip');

        // Buscar si ya existe para reemplazarlo
        const search = await drive.files.list({
            q: `name = '${APP_CONFIG.zipName}' and trashed = false`,
            fields: 'files(id)',
        });

        const media = {
            mimeType: 'application/zip',
            body: fs.createReadStream('./session.zip')
        };

        if (search.data.files.length > 0) {
            // Actualizar
            await drive.files.update({
                fileId: search.data.files[0].id,
                media: media
            });
            log('✅ Copia de seguridad actualizada en Drive.');
        } else {
            // Crear nuevo
            await drive.files.create({
                requestBody: { name: APP_CONFIG.zipName },
                media: media
            });
            log('✅ Nueva copia de seguridad creada en Drive.');
        }
    } catch (e) {
        log('❌ Error subiendo backup: ' + e.message);
    }
}

// ==========================================
// 📱 CONEXIÓN WHATSAPP (LOCAL RÁPIDA)
// ==========================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(APP_CONFIG.authFolder);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }),
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false, // Vital para velocidad
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeUrl = await qrcode.toDataURL(qr);
            log("⚠️ Nuevo QR generado. Escanea ahora.");
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            log(`❌ Desconectado (${statusCode}). Reconectando...`);
            
            isConnected = false;
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 3000);
            } else {
                log("⛔ Sesión cerrada manualmente. Borrando datos locales.");
                if (fs.existsSync(APP_CONFIG.authFolder)) fs.rmSync(APP_CONFIG.authFolder, { recursive: true, force: true });
                connectToWhatsApp(); // Reiniciar para pedir QR nuevo
            }
        } else if (connection === 'open') {
            log("✅ CONECTADO EXITOSAMENTE.");
            isConnected = true;
            qrCodeUrl = null;
            // Al conectar, hacemos un backup inicial a los 10 segundos
            setTimeout(guardarSesionEnDrive, 10000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- CHATBOT ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        // Filtro de Grupos y Estados
        if (remoteJid.includes('@g.us') || remoteJid.includes('status')) return;

        const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const textoLower = texto.toLowerCase();

        let state = conversationState[remoteJid] || { step: FLOW.IDLE };

        // 1. INICIO
        if (state.step === FLOW.IDLE) {
            if (textoLower.includes(APP_CONFIG.triggerPhrase.toLowerCase())) {
                await sock.sendMessage(remoteJid, { text: `✨ *Bienvenido a Grandioso Universo* ✨\n\nSoy tu asistente virtual.\nPara reservar un turno, necesito algunos datos.\n\nPor favor, escribe tu *Nombre Completo*:` });
                conversationState[remoteJid] = { step: FLOW.ASK_NAME, data: {} };
            }
            return;
        }

        // 2. FLUJO DE AGENDA
        const datos = state.data;

        switch (state.step) {
            case FLOW.ASK_NAME:
                datos.nombre = texto;
                await sock.sendMessage(remoteJid, { text: `Gracias ${datos.nombre}. Por favor, escribe tu *DNI*:` });
                state.step = FLOW.ASK_DNI;
                break;

            case FLOW.ASK_DNI:
                datos.dni = texto;
                await sock.sendMessage(remoteJid, { text: `Perfecto. ¿Cuál es tu *Fecha de Nacimiento*? (Ej: 12/05/1985)` });
                state.step = FLOW.ASK_DOB;
                break;

            case FLOW.ASK_DOB:
                datos.dob = texto;
                await sock.sendMessage(remoteJid, { text: `Entendido. Brevemente, ¿cuál es el *Motivo de la consulta*?` });
                state.step = FLOW.ASK_REASON;
                break;

            case FLOW.ASK_REASON:
                datos.motivo = texto;
                await sock.sendMessage(remoteJid, { text: `🔎 Buscando horarios (Lun-Vie 8-18hs)...` });
                
                const slots = await obtenerSlotsDisponibles();
                
                if (slots.length === 0) {
                    await sock.sendMessage(remoteJid, { text: `😓 No encontré horarios libres próximos. Por favor intenta más tarde.` });
                    delete conversationState[remoteJid];
                    return;
                }

                datos.slotsPosibles = slots;
                let menu = `🗓️ *Horarios Disponibles:*\nResponde con el NÚMERO:\n\n`;
                slots.forEach((slot, idx) => {
                    let fechaStr = slot.format('dddd D/MM - HH:mm [hs]');
                    fechaStr = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
                    menu += `*${idx + 1}.* ${fechaStr}\n`;
                });
                menu += `\n*0.* Cancelar`;

                await sock.sendMessage(remoteJid, { text: menu });
                state.step = FLOW.SELECT_SLOT;
                break;

            case FLOW.SELECT_SLOT:
                const opcion = parseInt(texto);
                if (isNaN(opcion) || opcion < 0 || opcion > datos.slotsPosibles.length) {
                    await sock.sendMessage(remoteJid, { text: `⚠️ Opción no válida.` });
                    return;
                }

                if (opcion === 0) {
                    await sock.sendMessage(remoteJid, { text: `Cancelado.` });
                    delete conversationState[remoteJid];
                    return;
                }

                const slotElegido = datos.slotsPosibles[opcion - 1];
                datos.slot = slotElegido;
                datos.telefono = remoteJid.split('@')[0];

                await sock.sendMessage(remoteJid, { text: `⏳ *Agendando...*` });
                
                const guardado = await crearEventoCalendario(datos);

                if (guardado) {
                    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Grandioso Universo//NONSGML v1.0//EN
BEGIN:VEVENT
UID:${uuidv4()}
DTSTAMP:${moment().utc().format('YYYYMMDDTHHmmss')}Z
DTSTART:${slotElegido.utc().format('YYYYMMDDTHHmmss')}Z
DTEND:${slotElegido.clone().add(APP_CONFIG.defaultDuration, 'minutes').utc().format('YYYYMMDDTHHmmss')}Z
SUMMARY:Turno Grandioso Universo
DESCRIPTION:Motivo: ${datos.motivo}
END:VEVENT
END:VCALENDAR`;

                    const pathICS = `/tmp/turno.ics`;
                    fs.writeFileSync(pathICS, icsContent);

                    let fechaBonita = slotElegido.format('dddd D [de] MMMM [a las] HH:mm [hs]');
                    fechaBonita = fechaBonita.charAt(0).toUpperCase() + fechaBonita.slice(1);

                    await sock.sendMessage(remoteJid, { 
                        document: fs.readFileSync(pathICS), 
                        mimetype: 'text/calendar', 
                        fileName: 'turno.ics',
                        caption: `✅ *Turno Confirmado*\n📅 ${fechaBonita}`
                    });
                } else {
                    await sock.sendMessage(remoteJid, { text: `❌ Error al guardar.` });
                }
                delete conversationState[remoteJid];
                break;
        }
    });
}

// --- FUNCIONES AGENDA ---
async function obtenerSlotsDisponibles() {
    const slots = [];
    const hoy = moment().tz(APP_CONFIG.timezone);
    const inicioBusqueda = hoy.clone().add(APP_CONFIG.minNoticeHours, 'hours'); 
    const finBusqueda = hoy.clone().add(5, 'days').endOf('day'); // 5 días

    try {
        const response = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: inicioBusqueda.toISOString(),
            timeMax: finBusqueda.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        const ocupados = response.data.items || [];

        let cursor = inicioBusqueda.clone();
        const remainder = 30 - (cursor.minute() % 30);
        cursor.add(remainder, "minutes").startOf("minute");

        while (cursor.isBefore(finBusqueda)) {
            const hora = cursor.hour();
            if (!APP_CONFIG.workDays.includes(cursor.day())) {
                cursor.add(1, 'days').startOf('day').hour(APP_CONFIG.startHour); continue;
            }
            if (hora < APP_CONFIG.startHour || hora >= APP_CONFIG.endHour) {
                cursor.add(1, 'days').startOf('day').hour(APP_CONFIG.startHour); continue;
            }
            if (hora >= APP_CONFIG.breakStart && hora < APP_CONFIG.breakEnd) {
                cursor.hour(APP_CONFIG.breakEnd).minute(0); continue;
            }

            const finSlot = cursor.clone().add(APP_CONFIG.defaultDuration, 'minutes');
            const inicioBuffer = cursor.clone().subtract(APP_CONFIG.bufferMinutes, 'minutes');
            const finBuffer = finSlot.clone().add(APP_CONFIG.bufferMinutes, 'minutes');

            const hayColision = ocupados.some(ev => {
                const evStart = moment(ev.start.dateTime || ev.start.date);
                const evEnd = moment(ev.end.dateTime || ev.end.date);
                if(!ev.start.dateTime) evEnd.endOf('day'); 
                return evStart.isBefore(finBuffer) && evEnd.isAfter(inicioBuffer);
            });

            if (!hayColision) slots.push(cursor.clone());
            cursor.add(30, 'minutes');
        }
    } catch (e) { console.error("Error slots:", e); }
    return slots.slice(0, 8);
}

async function crearEventoCalendario(datos) {
    const inicio = moment(datos.slot);
    const fin = inicio.clone().add(APP_CONFIG.defaultDuration, 'minutes');
    const evento = {
        summary: `Turno ${datos.nombre}`,
        description: `Paciente: ${datos.nombre}\nDNI: ${datos.dni}\nNacimiento: ${datos.dob}\nMotivo: ${datos.motivo}\nTel: ${datos.telefono}\n(Bot)`,
        start: { dateTime: inicio.toISOString() },
        end: { dateTime: fin.toISOString() },
        colorId: '2'
    };
    try {
        await calendar.events.insert({ calendarId: APP_CONFIG.calendarId, resource: evento });
        return true;
    } catch (e) { return false; }
}

// --- RECORDATORIOS ---
async function revisarTurnosYEnviar() {
    if (!isConnected) { log('⛔ Cron: Desconectado.'); return; }
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
        let enviados = 0;
        
        for (const event of events) {
            const fechaEvento = moment(event.start.dateTime || event.start.date).tz(APP_CONFIG.timezone);
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;
            
            const titulo = (event.summary || '').toLowerCase();
            if (!titulo.includes('turno')) continue;

            const desc = event.description || '';
            const matchTel = desc.replace(/\D/g, '').match(/(?:0?11|15|9011)(\d{8})$/);
            let telefono = matchTel ? `54911${matchTel[1]}` : null;

            if (telefono) {
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
Grandioso Universo Terapias ✨`;

                const jid = `${telefono}@s.whatsapp.net`;
                const [res] = await sock.onWhatsApp(jid);
                if (res?.exists) {
                    await sock.sendMessage(jid, { text: mensaje });
                    log(`📤 Recordatorio enviado.`);
                    enviados++;
                    await delay(3000);
                }
            }
        }
    } catch (error) { log('❌ Error Cron: ' + error.message); }
}

// --- ARRANQUE ---
app.get('/', async (req, res) => {
    let qrData = null;
    if(qrCodeUrl) qrData = await qrCodeUrl;
    const logsHtml = logs.map(l => `<div>[${l.time}] ${l.msg}</div>`).join('');
    res.send(`
    <html><head><meta http-equiv="refresh" content="5"></head><body>
    <h1>🤖 Grandioso Universo Bot (v6.0)</h1>
    <p>Estado: ${isConnected ? 'ONLINE' : 'OFFLINE'}</p>
    ${!isConnected && qrData ? `<img src="${qrData}">` : ''}
    <div style="background:#eee; padding:10px; height:400px; overflow-y:auto;">${logsHtml}</div>
    </body></html>`);
});

app.get('/test', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

app.listen(port, async () => {
    log(`🌐 Iniciando sistema...`);
    await restaurarSesionDesdeDrive(); // 1. Descargar respaldo
    connectToWhatsApp();               // 2. Conectar rápido
});

// Guardar backup cada 1 hora
cron.schedule('0 * * * *', () => guardarSesionEnDrive());

// Recordatorios 7 AM
cron.schedule('0 7 * * *', () => revisarTurnosYEnviar(), { timezone: APP_CONFIG.timezone });