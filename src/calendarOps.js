const moment = require('moment-timezone');
const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const { analizarContextoAvanzado } = require('./nlp');

async function agendarDesdeContexto(calendar, requireGoogleAuth, log, config, remoteJid, msg) {
    if (!requireGoogleAuth('Calendar')) return false;

    const textoMsg = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const pushName = msg.pushName || 'Paciente';

    log(`📝 Solicitud de agenda: "${textoMsg}"`);

    const datos = analizarContextoAvanzado(textoMsg, config.timezone);

    if (!datos.fecha || !datos.hora) {
        log(`⚠️ Faltan datos (fecha/hora) en: "${textoMsg}"`);
        return false;
    }

    if (!datos.fecha.isValid()) {
        log(`⚠️ Fecha invalida detectada en: "${textoMsg}"`);
        return false;
    }

    const fechaFinal = datos.fecha.hour(datos.hora.h).minute(datos.hora.m).second(0);
    const telefono = jidNormalizedUser(remoteJid).split('@')[0];
    const nombreFinal = datos.nombre || pushName;

    const evento = {
        summary: `Turno ${nombreFinal}`,
        description: `Paciente: ${nombreFinal}\nTel: ${telefono}\n(Auto-Agendado)`,
        start: { dateTime: fechaFinal.toISOString() },
        end: { dateTime: fechaFinal.clone().add(config.defaultDuration, 'minutes').toISOString() },
        colorId: '2'
    };

    try {
        await calendar.events.insert({ calendarId: config.calendarId, resource: evento });
        log(`📅 Agendado: ${fechaFinal.format('DD/MM HH:mm')} - ${nombreFinal} (${telefono})`);
        return true;
    } catch (error) {
        log(`❌ Error Google Calendar: ${error.message}`);
        return false;
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

        log(`ℹ️ No se encontraron turnos futuros para: ${telefono}`);

        return false;
    } catch (error) {
        log(`❌ Error cancelando turno: ${error.message}`);
        return false;
    }
}

module.exports = {
    agendarDesdeContexto,
    cancelarTurno
};
