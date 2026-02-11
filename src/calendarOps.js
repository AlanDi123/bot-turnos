const moment = require('moment-timezone');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { analizarContextoAvanzado } = require('./nlp');

// Verifica si hay eventos superpuestos
async function verificarDisponibilidad(calendar, config, startStr, endStr) {
    try {
        const response = await calendar.events.list({
            calendarId: config.calendarId,
            timeMin: startStr,
            timeMax: endStr,
            singleEvents: true,
            timeZone: config.timezone
        });
        return (response.data.items || []).length > 0;
    } catch (error) {
        console.error('Error verificando disponibilidad:', error);
        return true; // Ante error, asumimos ocupado para prevenir doble turno
    }
}

async function agendarDesdeContexto(calendar, requireGoogleAuth, log, config, remoteJid, msg) {
    if (!requireGoogleAuth('Calendar')) return { status: 'error' };

    const textoMsg = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const pushName = msg.pushName || 'Paciente';

    log(`📝 Solicitud de agenda: "${textoMsg}"`);

    const datos = analizarContextoAvanzado(textoMsg, config.timezone);

    if (!datos.fecha || !datos.hora) {
        log(`⚠️ Faltan datos (fecha/hora) en: "${textoMsg}"`);
        return { status: 'ignore' };
    }

    if (!datos.fecha.isValid()) return { status: 'error' };

    const fechaInicio = datos.fecha.clone().hour(datos.hora.h).minute(datos.hora.m).second(0);
    const fechaFin = fechaInicio.clone().add(config.defaultDuration, 'minutes');

    // --- CHECK ANTI-OVERBOOKING ---
    const ocupado = await verificarDisponibilidad(
        calendar, 
        config, 
        fechaInicio.toISOString(), 
        fechaFin.toISOString()
    );

    if (ocupado) {
        log(`⛔ Horario ocupado: ${fechaInicio.format('DD/MM HH:mm')}`);
        return { status: 'occupied' };
    }
    // ------------------------------

    const telefono = jidNormalizedUser(remoteJid).split('@')[0];
    const nombreFinal = datos.nombre || pushName;

    const evento = {
        summary: `Turno ${nombreFinal}`,
        description: `Paciente: ${nombreFinal}\nTel: ${telefono}\n(Auto-Agendado)`,
        start: { dateTime: fechaInicio.toISOString() },
        end: { dateTime: fechaFin.toISOString() },
        colorId: '2'
    };

    try {
        await calendar.events.insert({ calendarId: config.calendarId, resource: evento });
        log(`📅 Agendado: ${fechaInicio.format('DD/MM HH:mm')} - ${nombreFinal}`);
        return { status: 'success' };
    } catch (error) {
        log(`❌ Error Google Calendar: ${error.message}`);
        return { status: 'error' };
    }
}

async function cancelarTurno(calendar, requireGoogleAuth, log, config, remoteJid) {
    if (!requireGoogleAuth('Calendar')) return false;

    const telefono = jidNormalizedUser(remoteJid).split('@')[0];
    const ahora = moment().tz(config.timezone).toISOString();

    log(`🧾 Solicitud de cancelacion para: ${telefono}`);

    try {
        const res = await calendar.events.list({
            calendarId: config.calendarId,
            timeMin: ahora,
            singleEvents: true,
            q: telefono
        });

        if (res.data.items.length > 0) {
            const eventoABorrar = res.data.items[0];
            await calendar.events.delete({
                calendarId: config.calendarId,
                eventId: eventoABorrar.id
            });
            log(`🗑️ Turno cancelado para: ${telefono}`);
            return true;
        }
        return false;
    } catch (error) {
        log(`❌ Error cancelando turno: ${error.message}`);
        return false;
    }
}

module.exports = { agendarDesdeContexto, cancelarTurno };
