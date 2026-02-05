/**
 * 🤖 GRANDIOSO UNIVERSO - SECRETARIO SILENCIOSO (v7.0)
 * - No habla con nadie.
 * - Escucha tus comandos (Emojis) en chats privados.
 * - Lee el contexto de la charla para sacar fecha y hora.
 * - Agenda y Cancela en Google Calendar.
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
    
    // EMOJIS DE COMANDO (Tú los envías para activar)
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
    const time = moment().tz(APP_CONFIG.timezone).format('HH:mm:ss');
    logs.unshift({ time, msg });
    if (logs.length > 150) logs.pop();
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

// --- FUNCIONES DE RESPALDO (Mismas de antes) ---
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
    log('☁️ Buscando respaldo...');
    try {
        const res = await drive.files.list({ q: `name = '${APP_CONFIG.zipName}' and trashed = false`, fields: 'files(id)' });
        if (res.data.files.length > 0) {
            const dest = fs.createWriteStream('./session.zip');
            const result = await drive.files.get({ fileId: res.data.files[0].id, alt: 'media' }, { responseType: 'stream' });
            await new Promise((resolve, reject) => result.data.on('end', resolve).on('error', reject).pipe(dest));
            const zip = new AdmZip('./session.zip');
            zip.extractAllTo('./', true);
            log('✅ Sesión restaurada.');
        }
    } catch (e) { log('⚠️ Inicio limpio (sin backup).'); }
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
// 🧠 INTELIGENCIA DE CONTEXTO (NLP SIMPLE)
// ==========================================

function analizarContexto(mensajes) {
    // Unimos los últimos mensajes para buscar patrones
    const textoCompleto = mensajes.map(m => m.message?.conversation || m.message?.extendedTextMessage?.text || '').join('\n');
    
    const hoy = moment().tz(APP_CONFIG.timezone);
    let fechaDetectada = null;
    let horaDetectada = null;

    // 1. DETECTAR FECHAS
    // Patrones: "5/2", "05/02", "mañana", "lunes", "viernes"
    const regexFechaCorta = /(\d{1,2})[\/.-](\d{1,2})/g;
    const diasSemana = ['domingo','lunes','martes','miercoles','miércoles','jueves','viernes','sabado','sábado'];
    
    // Buscar dd/mm
    const matchFecha = [...textoCompleto.matchAll(regexFechaCorta)];
    if (matchFecha.length > 0) {
        const ultimo = matchFecha[matchFecha.length - 1]; // Tomamos la última fecha mencionada
        fechaDetectada = hoy.clone().date(parseInt(ultimo[1])).month(parseInt(ultimo[2]) - 1);
        if (fechaDetectada.isBefore(hoy, 'day')) fechaDetectada.add(1, 'year'); // Si ya pasó, es el año que viene
    } 
    // Buscar "mañana"
    else if (textoCompleto.toLowerCase().includes('mañana')) {
        fechaDetectada = hoy.clone().add(1, 'days');
    }
    // Buscar día de la semana (ej: "el viernes")
    else {
        for (let i = 0; i < diasSemana.length; i++) {
            if (textoCompleto.toLowerCase().includes(diasSemana[i])) {
                // Buscar el próximo día X
                fechaDetectada = hoy.clone().day(i);
                if (fechaDetectada.isBefore(hoy, 'day')) fechaDetectada.add(7, 'days');
                break;
            }
        }
    }

    // 2. DETECTAR HORA
    // Patrones: "14:00", "14.30", "14hs", "14 h"
    const regexHora = /(\d{1,2})[:\.\s]?(\d{2})?\s*(?:hs|hrs|h|:)?/i;
    // Buscamos todas las coincidencias y nos quedamos con la última
    const coincidenciasHora = [...textoCompleto.matchAll(new RegExp(regexHora, "gi"))];
    
    if (coincidenciasHora.length > 0) {
        const ultimoMatch = coincidenciasHora[coincidenciasHora.length - 1];
        let h = parseInt(ultimoMatch[1]);
        let m = parseInt(ultimoMatch[2] || "0");
        horaDetectada = { h, m };
    }

    return { fecha: fechaDetectada, hora: horaDetectada };
}

// ==========================================
// 📅 GESTIÓN DE CALENDARIO
// ==========================================

async function agendarDesdeContexto(remoteJid, mensajesAnteriores) {
    const datos = analizarContexto(mensajesAnteriores);
    
    if (!datos.fecha || !datos.hora) {
        log('⚠️ No pude detectar fecha u hora en los mensajes anteriores.');
        return false;
    }

    // Combinar fecha y hora
    const fechaFinal = datos.fecha.hour(datos.hora.h).minute(datos.hora.m).second(0);
    const telefono = remoteJid.split('@')[0];

    const evento = {
        summary: `Turno Paciente`, // Título genérico como pediste
        description: `Tel: ${telefono}\n(Agendado Automático)`,
        start: { dateTime: fechaFinal.toISOString() },
        end: { dateTime: fechaFinal.clone().add(APP_CONFIG.defaultDuration, 'minutes').toISOString() },
        colorId: '2'
    };

    try {
        await calendar.events.insert({ calendarId: APP_CONFIG.calendarId, resource: evento });
        log(`📅 Turno agendado: ${fechaFinal.format('DD/MM HH:mm')} - Tel: ${telefono}`);
        return true;
    } catch (e) {
        log('❌ Error guardando en GCal: ' + e.message);
        return false;
    }
}

async function cancelarTurno(remoteJid) {
    const telefono = remoteJid.split('@')[0];
    const ahora = moment().tz(APP_CONFIG.timezone).toISOString();

    try {
        // Buscar eventos futuros que contengan el teléfono en la descripción
        const res = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: ahora,
            singleEvents: true,
            q: telefono // Búsqueda por texto libre
        });

        const eventos = res.data.items;
        if (eventos.length > 0) {
            // Borrar el más próximo
            const eventoABorrar = eventos[0];
            await calendar.events.delete({
                calendarId: APP_CONFIG.calendarId,
                eventId: eventoABorrar.id
            });
            log(`🗑️ Turno cancelado para ${telefono} (${eventoABorrar.summary})`);
            return true;
        } else {
            log(`⚠️ No encontré turnos futuros para cancelar de: ${telefono}`);
            return false;
        }
    } catch (e) {
        log('❌ Error cancelando: ' + e.message);
        return false;
    }
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
            log("✅ SECRETARIO ACTIVO.");
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
        const fromMe = msg.key.fromMe; // ¿Lo enviaste tú?
        
        // Obtenemos el texto (sea mensaje normal o caption de imagen/sticker si tuviera)
        const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

        // SOLO ACTUAMOS SI LO ENVÍA EL USUARIO (TÚ)
        // Esto filtra automáticamente a todos los demás.
        if (fromMe) {
            
            // 1. DETECTAR AGENDAR (🗓️)
            if (texto.includes(APP_CONFIG.EMOJI_AGENDAR)) {
                log(`📝 Comando Agendar detectado en chat con ${remoteJid}`);
                
                // Buscar los últimos mensajes para entender fecha/hora
                // (Baileys no trae historial fácil, intentamos con el store o fetch si está disponible,
                // si no, confiamos en que escribiste la fecha EN EL MISMO mensaje del emoji o justo antes)
                
                // NOTA: Fetch de mensajes antiguos en Baileys es complejo en modo multi-device lite.
                // ESTRATEGIA ROBUSTA: Analizamos el PROPIO mensaje del emoji.
                // Si escribes: "Dale agendado el lunes 14hs 🗓️", lo captura.
                
                // Si el mensaje SOLO es el emoji, intentamos buscar el anterior (limitado)
                // Para asegurar éxito, te recomiendo escribir la fecha Y el emoji en el mismo mensaje.
                
                let exito = await agendarDesdeContexto(remoteJid, [msg]);
                
                if (exito) {
                    await sock.sendMessage(remoteJid, { react: { text: '👍', key: msg.key } });
                } else {
                    await sock.sendMessage(remoteJid, { react: { text: '❓', key: msg.key } }); // No entendí la fecha
                }
            }

            // 2. DETECTAR CANCELAR (🚫)
            if (texto.includes(APP_CONFIG.EMOJI_CANCELAR)) {
                log(`🚫 Comando Cancelar detectado.`);
                const cancelado = await cancelarTurno(remoteJid);
                if (cancelado) {
                    await sock.sendMessage(remoteJid, { react: { text: '👍', key: msg.key } });
                } else {
                    await sock.sendMessage(remoteJid, { react: { text: '🤷‍♂️', key: msg.key } }); // No encontré turno
                }
            }
        }
    });
}

// ==========================================
// 🔔 RECORDATORIOS 7 AM (Igual que antes)
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
            
            // Buscar teléfono en la descripción (formato: "Tel: 54911...")
            const desc = event.description || '';
            const matchTel = desc.match(/(?:Tel: )?(\d{10,13})/);
            
            if (matchTel) {
                let telefono = matchTel[1];
                // Asegurar formato internacional
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

// --- SERVIDOR ---
app.get('/', async (req, res) => {
    let qrData = qrCodeUrl ? await qrCodeUrl : null;
    const logsHtml = logs.map(l => `<div>[${l.time}] ${l.msg}</div>`).join('');
    res.send(`<html><head><meta http-equiv="refresh" content="5"></head><body><h1>🤖 Secretario Silencioso</h1><p>Estado: ${isConnected ? 'ONLINE' : 'OFFLINE'}</p>${!isConnected && qrData ? `<img src="${qrData}">` : ''}<div style="background:#eee;height:400px;overflow:auto;">${logsHtml}</div></body></html>`);
});

app.listen(port, async () => {
    log(`🌐 Iniciando...`);
    await restaurarSesionDesdeDrive();
    connectToWhatsApp();
});

cron.schedule('0 * * * *', () => guardarSesionEnDrive());
cron.schedule('0 7 * * *', () => revisarTurnosYEnviar(), { timezone: APP_CONFIG.timezone });