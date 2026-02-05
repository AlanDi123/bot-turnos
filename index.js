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
    DisconnectReason, 
    Browsers, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    initAuthCreds,
    BufferJSON
} = require('@whiskeysockets/baileys');
const { google } = require('googleapis');
const express = require('express');
const qrcode = require('qrcode');
const cron = require('node-cron');
const moment = require('moment-timezone');
require('moment/locale/es'); 
const fs = require('fs');
const pino = require('pino');
const stream = require('stream');
require('dotenv').config();

// --- CONFIGURACIÓN ---
const app = express();
const port = process.env.PORT || 3000;
const TIMEZONE = 'America/Argentina/Buenos_Aires';
moment.locale('es'); 

// ⚠️ TU EMAIL
const CALENDAR_ID = 'andreaquinonez249@gmail.com'; 
const KEYWORD_TURNO = 'turno';

// Nombre del archivo en Drive donde se guardará la sesión
const DRIVE_FILE_NAME = 'bot_whatsapp_session_v2.json';

// Estado global
let sock;
let qrCodeUrl = null;
let isConnected = false;
let driveAuthReady = false;
let lastRun = "Aún no ejecutado";
let nextRun = "Mañana 07:00 AM";
let logs = [];

function log(msg) {
    const time = moment().tz(TIMEZONE).format('HH:mm:ss');
    logs.unshift({ time, msg });
    if (logs.length > 150) logs.pop();
    console.log(`[${time}] ${msg}`);
}

// --- AUTENTICACIÓN GOOGLE (CALENDARIO + DRIVE) ---
let authClient;
try {
    const credentialsContent = process.env.GOOGLE_CREDENTIALS;
    if (credentialsContent) {
        const credentials = JSON.parse(credentialsContent);
        authClient = google.auth.fromJSON(credentials);
        // Agregamos permiso de DRIVE
        authClient.scopes = [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/drive.file'
        ];
    }
} catch (error) {
    log('❌ Error Credenciales Google: ' + error.message);
}

const calendar = google.calendar({ version: 'v3', auth: authClient });
const drive = google.drive({ version: 'v3', auth: authClient });

// --- SISTEMA DE GUARDADO EN DRIVE (PERSISTENCIA) ---
const useGoogleDriveAuthState = async () => {
    // 1. Buscar si ya existe el archivo de sesión
    const findFile = async () => {
        try {
            const res = await drive.files.list({
                q: `name = '${DRIVE_FILE_NAME}' and trashed = false`,
                fields: 'files(id, name)',
            });
            return res.data.files[0] ? res.data.files[0].id : null;
        } catch (e) {
            log('⚠️ Error buscando archivo en Drive: ' + e.message);
            return null;
        }
    };

    let fileId = await findFile();

    // 2. Función para leer datos del Drive
    const readData = async () => {
        if (!fileId) return null;
        try {
            const res = await drive.files.get({ fileId, alt: 'media' });
            return res.data; // Devuelve el JSON
        } catch (e) {
            return null;
        }
    };

    // 3. Función para guardar (Actualizar o Crear)
    const writeData = async (data) => {
        const media = {
            mimeType: 'application/json',
            body: JSON.stringify(data, BufferJSON.replacer)
        };

        try {
            if (fileId) {
                // Actualizar existente
                await drive.files.update({
                    fileId,
                    media: { body: JSON.stringify(data, BufferJSON.replacer) }
                });
            } else {
                // Crear nuevo
                const res = await drive.files.create({
                    requestBody: { name: DRIVE_FILE_NAME },
                    media: {
                        mimeType: 'application/json',
                        body: JSON.stringify(data, BufferJSON.replacer)
                    }
                });
                fileId = res.data.id;
                log('📁 Nuevo archivo de sesión creado en Drive.');
            }
        } catch (e) {
            console.error('Error guardando en Drive:', e.message);
        }
    };

    // Cargar datos iniciales
    const existingData = await readData();
    const creds = existingData?.creds ? initAuthCreds(existingData.creds) : initAuthCreds();
    let keys = existingData?.keys || {};

    // Mecanismo de guardado con "Debounce" (Para no saturar Drive con cada click)
    let saveTimeout;
    const saveState = () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            writeData({ creds, keys });
        }, 10000); // Guardar cada 10 segundos si hubo cambios
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
                        if (type === 'app-state-sync-key' && value) {
                            value = BufferJSON.reviver(null, value);
                        }
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
        saveCreds: () => {
            saveState();
        },
    };
};

// --- CONEXIÓN WHATSAPP ---
async function connectToWhatsApp() {
    log('☁️ Conectando a Google Drive...');
    const { state, saveCreds } = await useGoogleDriveAuthState();
    
    const { version } = await fetchLatestBaileysVersion();
    console.log(`ℹ️ Versión WA: v${version.join('.')}`);

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

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            log('⚠️ Escanea el QR (Se guardará en Drive).');
            qrCodeUrl = await qrcode.toDataURL(qr);
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const statusCode = error?.output?.statusCode;
            
            if (statusCode === DisconnectReason.loggedOut) {
                log('⛔ Sesión cerrada. Se requiere re-escanear.');
                // Aquí podríamos borrar el archivo de Drive si quisiéramos
                isConnected = false;
                connectToWhatsApp();
            } else {
                log(`❌ Desconectado (${statusCode}). Reconectando...`);
                if(sock) sock.end(undefined);
                sock = undefined;
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            log('✅ CONECTADO. Sesión sincronizada con Drive.');
            qrCodeUrl = null;
            isConnected = true;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// --- FUNCIONES AUXILIARES (Igual que antes) ---
function extraerDatos(descripcion, eventStart) {
    const regexHora = /(\d{1,2})[:\.\s]?(\d{2})?\s*(?:hs|hrs|h|:)?/i;
    const matchHora = descripcion ? descripcion.match(regexHora) : null;
    let horaFinal = "Horario a confirmar";

    if (matchHora) {
        let hora = matchHora[1];
        let minutos = matchHora[2] || "00";
        if (hora.length === 1) hora = '0' + hora;
        horaFinal = `${hora}:${minutos} hs`;
    } else if (eventStart.dateTime) {
        horaFinal = moment(eventStart.dateTime).tz(TIMEZONE).format('HH:mm') + ' hs';
    } else {
        horaFinal = "en el transcurso del día";
    }

    const regexTelefono = /(?:0?11|15|9011)[\s\.-]?(\d{3,4})[\s\.-]?(\d{4})/;
    const matchTel = descripcion ? descripcion.match(regexTelefono) : null;
    let telefonoFinal = null;

    if (matchTel) {
        const parte1 = matchTel[1];
        const parte2 = matchTel[2];
        const numeroPuro = parte1 + parte2;
        if (numeroPuro.length === 8) {
            telefonoFinal = `54911${numeroPuro}`;
        }
    }
    return { hora: horaFinal, telefono: telefonoFinal };
}

async function revisarTurnosYEnviar() {
    lastRun = moment().tz(TIMEZONE).format('DD/MM HH:mm');
    if (!isConnected) {
        log('⛔ WhatsApp desconectado. Intentando reconectar...');
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
            log('ℹ️ 0 eventos encontrados.');
            return;
        }

        let enviados = 0;
        for (const event of events) {
            const fechaEvento = moment(event.start.dateTime || event.start.date).tz(TIMEZONE);
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;

            const tituloNormalizado = (event.summary || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            if (!tituloNormalizado.includes(KEYWORD_TURNO)) continue;

            let nombreCliente = (event.summary || '').replace(/turno/ig, '').trim() || "Cliente";
            const datos = extraerDatos(event.description || '', event.start);
            
            if (datos.telefono) {
                const jid = `${datos.telefono}@s.whatsapp.net`;
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
                        log(`📤 Enviado a ${nombreCliente}`);
                        enviados++;
                        await new Promise(r => setTimeout(r, 4000));
                    }
                } catch (e) { log(`❌ Error envío: ${e.message}`); }
            }
        }
        log(`🏁 Fin barrido. Enviados: ${enviados}`);
    } catch (error) {
        log('❌ Error Calendar API: ' + error.message);
    }
}

// --- SERVIDOR WEB ---
app.get('/', (req, res) => {
    const statusClass = isConnected ? 'status-online' : 'status-offline';
    const serverTime = moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss');
    const logsHtml = logs.map(l => `<div style="border-bottom:1px solid #eee; padding:2px;">[${l.time}] ${l.msg}</div>`).join('');

    let html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Grandioso Universo - Bot</title>
        <meta http-equiv="refresh" content="5">
        <style>
            body { font-family: sans-serif; background: #f0f9ff; padding: 20px; text-align: center; }
            .card { background: white; padding: 20px; border-radius: 10px; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .btn { background: #0ea5e9; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px; }
            .terminal { background: #1e293b; color: #a5f3fc; padding: 15px; text-align: left; height: 300px; overflow-y: auto; border-radius: 8px; font-family: monospace; font-size: 12px; margin-top: 20px; }
            img { border: 4px solid #333; border-radius: 10px; margin: 10px; max-width: 250px; }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🤖 Bot Grandioso Universo</h1>
            <p style="background:${isConnected ? '#dcfce7' : '#fee2e2'}; padding:5px; border-radius:5px; display:inline-block;">
                Estado: ${isConnected ? '✅ CONECTADO (Drive)' : '❌ DESCONECTADO'}
            </p>
            
            ${!isConnected && qrCodeUrl ? `<div><h3>Escanea para guardar en Drive:</h3><img src="${qrCodeUrl}"></div>` : ''}
            
            ${isConnected ? `<div><a href="/test" class="btn">⚡ Ejecutar Barrido Manual</a></div>` : ''}
            
            <div class="terminal">${logsHtml}</div>
            <p style="font-size:0.8rem; color: #64748b;">${serverTime}</p>
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
    log(`🌐 Web iniciada.`);
    connectToWhatsApp();
});

cron.schedule('0 7 * * *', () => {
    nextRun = moment().tz(TIMEZONE).add(1, 'days').format('DD/MM 07:00 AM');
    revisarTurnosYEnviar();
}, { timezone: TIMEZONE });