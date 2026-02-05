/**
 * 🤖 GRANDIOSO UNIVERSO - CÓDIGO CORREGIDO Y DEFINITIVO
 * Soluciona el error "app is not defined" y configura tus horarios exactos.
 */

// --- PARCHE CRÍTICO DE CRYPTO ---
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
    initAuthCreds,
    BufferJSON,
    delay
} = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const express = require('express'); // Importamos Express
const qrcode = require('qrcode');
const cron = require('node-cron');
const moment = require('moment-timezone');
require('moment/locale/es'); 
const fs = require('fs');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// ==========================================
// ⚠️ INICIALIZACIÓN GLOBAL (AQUÍ ESTABA EL ERROR)
// ==========================================
const app = express(); // ¡Esta línea es vital!
const port = process.env.PORT || 3000;

// ==========================================
// ⚙️ CONFIGURACIÓN DEL NEGOCIO
// ==========================================

const APP_CONFIG = {
    // Tu Email
    calendarId: 'andreaquinonez249@gmail.com', 
    
    // Frase de activación (flexible)
    triggerPhrase: 'tenes un turno para', 
    
    // Horarios (Formato 24hs)
    startHour: 8,    // Abre 08:00
    endHour: 18,     // Cierra 18:00
    breakStart: 12,  // Pausa inicia 12:00
    breakEnd: 13,    // Pausa termina 13:00
    
    defaultDuration: 60, // 1 hora por defecto
    bufferMinutes: 30,   // Tiempo entre turnos
    minNoticeHours: 3,   // Mínimo tiempo antes para reservar
    
    timezone: 'America/Argentina/Buenos_Aires',
    driveFileName: 'bot_whatsapp_session_v3.json', // Cambié el nombre para forzar sesión limpia nueva
    
    // Lunes(1) a Viernes(5)
    workDays: [1, 2, 3, 4, 5] 
};

moment.locale('es');
moment.tz.setDefault(APP_CONFIG.timezone);

// ==========================================
// 🧠 ESTADO DE CONVERSACIÓN
// ==========================================
const conversationState = {}; 

const FLOW = {
    IDLE: 'IDLE',
    ASK_NAME: 'ASK_NAME',
    ASK_DNI: 'ASK_DNI',
    ASK_DOB: 'ASK_DOB',
    ASK_REASON: 'ASK_REASON',
    SELECT_SLOT: 'SELECT_SLOT',
};

// ==========================================
// ☁️ PERSISTENCIA GOOGLE DRIVE
// ==========================================
let authClient;
try {
    const credentialsContent = process.env.GOOGLE_CREDENTIALS;
    if (credentialsContent) {
        const credentials = JSON.parse(credentialsContent);
        authClient = google.auth.fromJSON(credentials);
        authClient.scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/drive.file'
        ];
    }
} catch (error) {
    console.error('❌ Error Credenciales Google:', error.message);
}

const calendar = google.calendar({ version: 'v3', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });

const useGoogleDriveAuthState = async () => {
    const findFile = async () => {
        try {
            const res = await drive.files.list({
                q: `name = '${APP_CONFIG.driveFileName}' and trashed = false`,
                fields: 'files(id, name)',
            });
            return res.data.files[0] ? res.data.files[0].id : null;
        } catch (e) { return null; }
    };

    let fileId = await findFile();

    const readData = async () => {
        if (!fileId) return null;
        try {
            const res = await drive.files.get({ fileId, alt: 'media' });
            return res.data;
        } catch (e) { return null; }
    };

    const writeData = async (data) => {
        const media = {
            mimeType: 'application/json',
            body: JSON.stringify(data, BufferJSON.replacer)
        };
        try {
            if (fileId) {
                await drive.files.update({ fileId, media: { body: JSON.stringify(data, BufferJSON.replacer) } });
            } else {
                const res = await drive.files.create({
                    requestBody: { name: APP_CONFIG.driveFileName },
                    media: { mimeType: 'application/json', body: JSON.stringify(data, BufferJSON.replacer) }
                });
                fileId = res.data.id;
            }
        } catch (e) { console.error('Error Drive:', e.message); }
    };

    const existingData = await readData();
    const creds = existingData?.creds ? initAuthCreds(existingData.creds) : initAuthCreds();
    let keys = existingData?.keys || {};

    let saveTimeout;
    const saveState = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => writeData({ creds, keys }), 10000);
    };

    return {
        state: {
            creds,
            keys: {
                get: (type, ids) => {
                    const data = {};
                    ids.forEach(id => {
                        const key = `${type}-${id}`;
                        let value = keys[key];
                        if (type === 'app-state-sync-key' && value) value = BufferJSON.reviver(null, value);
                        if (value) data[id] = value;
                    });
                    return data;
                },
                set: (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const key = `${category}-${id}`;
                            const value = data[category][id];
                            if (value) keys[key] = value;
                            else delete keys[key];
                        }
                    }
                    saveState();
                },
            },
        },
        saveCreds: () => saveState(),
    };
};

// ==========================================
// 📅 MOTOR DE AGENDA (CÁLCULO DE HUECOS)
// ==========================================

async function obtenerSlotsDisponibles() {
    const slots = [];
    const hoy = moment().tz(APP_CONFIG.timezone);
    
    // Buscar desde hoy + 3 horas hasta dentro de 7 días
    const inicioBusqueda = hoy.clone().add(APP_CONFIG.minNoticeHours, 'hours'); 
    const finBusqueda = hoy.clone().add(7, 'days').endOf('day'); 

    try {
        // 1. Obtener ocupados de Google Calendar
        const response = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: inicioBusqueda.toISOString(),
            timeMax: finBusqueda.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        const ocupados = response.data.items || [];

        // 2. Calcular libres
        let cursor = inicioBusqueda.clone();
        
        // Ajustar a la media hora más cercana (ej: 14:12 -> 14:30)
        const remainder = 30 - (cursor.minute() % 30);
        cursor.add(remainder, "minutes").startOf("minute");

        while (cursor.isBefore(finBusqueda)) {
            const hora = cursor.hour();

            // Regla: Días Laborales (Lunes a Viernes)
            if (!APP_CONFIG.workDays.includes(cursor.day())) {
                cursor.add(1, 'days').startOf('day').hour(APP_CONFIG.startHour);
                continue;
            }

            // Regla: Horario Laboral (8 a 18)
            if (hora < APP_CONFIG.startHour || hora >= APP_CONFIG.endHour) {
                cursor.add(1, 'days').startOf('day').hour(APP_CONFIG.startHour);
                continue;
            }

            // Regla: Almuerzo (12 a 13)
            if (hora >= APP_CONFIG.breakStart && hora < APP_CONFIG.breakEnd) {
                // Saltar al final del almuerzo
                cursor.hour(APP_CONFIG.breakEnd).minute(0);
                continue;
            }

            // Regla: Colisión con Eventos existentes
            const finSlot = cursor.clone().add(APP_CONFIG.defaultDuration, 'minutes');
            const inicioBuffer = cursor.clone().subtract(APP_CONFIG.bufferMinutes, 'minutes');
            const finBuffer = finSlot.clone().add(APP_CONFIG.bufferMinutes, 'minutes');

            const hayColision = ocupados.some(ev => {
                const evStart = moment(ev.start.dateTime || ev.start.date);
                const evEnd = moment(ev.end.dateTime || ev.end.date);
                if(!ev.start.dateTime) evEnd.endOf('day'); 
                
                return evStart.isBefore(finBuffer) && evEnd.isAfter(inicioBuffer);
            });

            if (!hayColision) {
                slots.push(cursor.clone());
            }

            // Avanzar 30 mins para buscar siguiente hueco
            cursor.add(30, 'minutes');
        }
    } catch (e) {
        console.error("Error buscando slots:", e);
    }
    
    return slots.slice(0, 10); // Máximo 10 opciones
}

async function crearEventoCalendario(datos) {
    const inicio = moment(datos.slot);
    const fin = inicio.clone().add(APP_CONFIG.defaultDuration, 'minutes');

    const evento = {
        summary: `Turno ${datos.nombre}`,
        description: `
Paciente: ${datos.nombre}
DNI: ${datos.dni}
Nacimiento: ${datos.dob}
Motivo: ${datos.motivo}
Tel: ${datos.telefono}
(Agendado por Bot)`,
        start: { dateTime: inicio.toISOString() },
        end: { dateTime: fin.toISOString() },
        colorId: '2'
    };

    try {
        await calendar.events.insert({
            calendarId: APP_CONFIG.calendarId,
            resource: evento
        });
        return true;
    } catch (e) {
        console.error("Error guardando evento:", e);
        return false;
    }
}

// ==========================================
// 📱 LÓGICA DE WHATSAPP
// ==========================================

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

async function connectToWhatsApp() {
    log('☁️ Conectando a Drive...');
    const { state, saveCreds } = await useGoogleDriveAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        printQRInTerminal: true,
        logger: pino({ level: 'fatal' }), 
        browser: Browsers.ubuntu('Chrome'), 
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) {
            qrCodeUrl = qrcode.toDataURL(qr); 
            log("⚠️ Nuevo QR generado.");
        }
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            log(`❌ Desconectado. Reconectando: ${shouldReconnect}`);
            isConnected = false;
            if(shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        } else if(connection === 'open') {
            log("✅ WhatsApp Conectado y Listo.");
            isConnected = true;
            qrCodeUrl = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- MANEJO DE MENSAJES (EL CORAZÓN) ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const texto = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const textoLower = texto.toLowerCase();

        if (remoteJid.includes('@g.us') || remoteJid.includes('status')) return;

        let state = conversationState[remoteJid] || { step: FLOW.IDLE };

        // 1. DETECTOR DE PALABRA CLAVE
        if (state.step === FLOW.IDLE) {
            // Buscamos si contiene la frase "tenes un turno para"
            if (textoLower.includes(APP_CONFIG.triggerPhrase.toLowerCase())) {
                await sock.sendMessage(remoteJid, { text: `✨ *Bienvenido a Grandioso Universo* ✨\n\nSoy tu asistente virtual.\nPara reservar un turno, necesito algunos datos.\n\nPor favor, escribe tu *Nombre Completo*:` });
                conversationState[remoteJid] = { step: FLOW.ASK_NAME, data: {} };
            }
            return; 
        }

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
                await sock.sendMessage(remoteJid, { text: `🔎 Buscando horarios disponibles en mi agenda (Lun-Vie 8-18hs)...` });
                
                const slots = await obtenerSlotsDisponibles();
                
                if (slots.length === 0) {
                    await sock.sendMessage(remoteJid, { text: `😓 Lo siento, no encontré horarios libres próximos. Por favor intenta más tarde o contáctame directamente.` });
                    delete conversationState[remoteJid];
                    return;
                }

                datos.slotsPosibles = slots;
                
                let menu = `🗓️ *Horarios Disponibles:*\nResponde con el NÚMERO de opción:\n\n`;
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
                    await sock.sendMessage(remoteJid, { text: `⚠️ Opción no válida. Escribe solo el número.` });
                    return;
                }

                if (opcion === 0) {
                    await sock.sendMessage(remoteJid, { text: `Operación cancelada. ¡Saludos!` });
                    delete conversationState[remoteJid];
                    return;
                }

                const slotElegido = datos.slotsPosibles[opcion - 1];
                datos.slot = slotElegido;
                datos.telefono = remoteJid.split('@')[0];

                await sock.sendMessage(remoteJid, { text: `⏳ *Confirmando reserva...*` });
                
                const guardado = await crearEventoCalendario(datos);

                if (guardado) {
                    // Generar ICS
                    const icsContent = 
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Grandioso Universo//NONSGML v1.0//EN
BEGIN:VEVENT
UID:${uuidv4()}
DTSTAMP:${moment().utc().format('YYYYMMDDTHHmmss')}Z
DTSTART:${slotElegido.utc().format('YYYYMMDDTHHmmss')}Z
DTEND:${slotElegido.clone().add(APP_CONFIG.defaultDuration, 'minutes').utc().format('YYYYMMDDTHHmmss')}Z
SUMMARY:Turno Grandioso Universo
DESCRIPTION:Motivo: ${datos.motivo}
LOCATION:Consultorio / Online
END:VEVENT
END:VCALENDAR`;

                    const pathICS = `/tmp/turno_${datos.dni}.ics`;
                    fs.writeFileSync(pathICS, icsContent);

                    let fechaBonita = slotElegido.format('dddd D [de] MMMM [a las] HH:mm [hs]');
                    fechaBonita = fechaBonita.charAt(0).toUpperCase() + fechaBonita.slice(1);

                    const confirmacion = `✅ *Turno Confirmado*\n\n📅 ${fechaBonita}\n👤 ${datos.nombre}\n\nTe adjunto el recordatorio para tu calendario. ¡Te espero!`;

                    await sock.sendMessage(remoteJid, { 
                        document: fs.readFileSync(pathICS), 
                        mimetype: 'text/calendar', 
                        fileName: 'turno.ics',
                        caption: confirmacion
                    });

                } else {
                    await sock.sendMessage(remoteJid, { text: `❌ Error al guardar. Por favor intenta de nuevo.` });
                }

                delete conversationState[remoteJid];
                break;
        }
    });
}

// ==========================================
// 🔔 RECORDATORIOS 7 AM (TU LÓGICA ANTERIOR)
// ==========================================
async function revisarTurnosYEnviar() {
    if (!isConnected) { log('⛔ No se puede enviar recordatorios: Desconectado.'); return; }

    const hoy = moment().tz(APP_CONFIG.timezone);
    const mananaObjetivo = hoy.clone().add(1, 'days'); 
    
    const timeMin = hoy.clone().startOf('day').toISOString();
    const timeMax = hoy.clone().add(2, 'days').endOf('day').toISOString();

    log(`🔔 Cron: Revisando turnos para ${mananaObjetivo.format('DD/MM/YYYY')}`);

    try {
        const response = await calendar.events.list({
            calendarId: APP_CONFIG.calendarId,
            timeMin: timeMin,
            timeMax: timeMax,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items || [];
        let enviados = 0;
        
        for (const event of events) {
            const fechaEvento = moment(event.start.dateTime || event.start.date).tz(APP_CONFIG.timezone);
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;

            const titulo = (event.summary || '').toLowerCase();
            if (!titulo.includes('turno')) continue;

            const desc = event.description || '';
            let nombre = (event.summary || '').replace(/turno/ig, '').trim() || "Cliente";
            
            const matchTel = desc.replace(/\D/g, '').match(/(?:0?11|15|9011)(\d{8})$/);
            let telefono = matchTel ? `54911${matchTel[1]}` : null;

            // Regex Hora
            const matchHora = desc.match(/(\d{1,2})[:\.\s]?(\d{2})?/);
            let hora = "Horario a confirmar";
            if (matchHora) hora = `${matchHora[1]}:${matchHora[2] || '00'} hs`;
            else if (event.start.dateTime) hora = moment(event.start.dateTime).tz(APP_CONFIG.timezone).format('HH:mm') + ' hs';

            if (telefono) {
                let fechaTexto = mananaObjetivo.format('dddd D [de] MMMM');
                fechaTexto = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);

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

                try {
                    const jid = `${telefono}@s.whatsapp.net`;
                    const [res] = await sock.onWhatsApp(jid);
                    if (res?.exists) {
                        await sock.sendMessage(jid, { text: mensaje });
                        log(`📤 Recordatorio enviado a ${nombre}`);
                        enviados++;
                        await delay(3000);
                    }
                } catch (e) { log(`❌ Error envío a ${nombre}: ${e.message}`); }
            }
        }
        log(`🏁 Fin recordatorios. Total: ${enviados}`);
    } catch (error) {
        log('❌ Error en Cron Calendar: ' + error.message);
    }
}

// --- SERVIDOR WEB ---
app.get('/', async (req, res) => {
    let qrData = null;
    if(qrCodeUrl) qrData = await qrCodeUrl;
    
    const logsHtml = logs.map(l => {
        let color = '#a7f3d0';
        if (l.msg.includes('❌') || l.msg.includes('⛔')) color = '#fca5a5';
        if (l.msg.includes('⚠️')) color = '#fde047';
        if (l.msg.includes('📤')) color = '#c4b5fd'; 
        return `<div style="border-bottom:1px solid #333; padding:2px; color:${color}">[${l.time}] ${l.msg}</div>`;
    }).join('');

    res.send(`
    <html>
        <head><meta http-equiv="refresh" content="5"></head>
        <body style="background:#111; color:#eee; font-family:monospace; padding:20px;">
            <h1>🤖 Grandioso Universo Bot (v5.0)</h1>
            <p>Estado: ${isConnected ? '<span style="color:#4ade80">ONLINE</span>' : '<span style="color:#f87171">OFFLINE</span>'}</p>
            ${!isConnected && qrData ? `<img src="${qrData}" style="border:5px solid white; border-radius:10px;">` : ''}
            <div style="background:#000; padding:10px; height:400px; overflow-y:auto; margin-top:20px;">${logsHtml}</div>
        </body>
    </html>`);
});

app.get('/test', (req, res) => {
    revisarTurnosYEnviar();
    res.redirect('/');
});

// Iniciamos el servidor
app.listen(port, () => {
    log(`🌐 Servidor iniciado.`);
    connectToWhatsApp();
});

// Cron (7 AM)
cron.schedule('0 7 * * *', () => {
    revisarTurnosYEnviar();
}, { timezone: APP_CONFIG.timezone });