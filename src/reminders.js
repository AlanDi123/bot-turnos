const moment = require('moment-timezone');

function buildReminderMessage(fechaTexto, hora) {
    return `✨ Sesión a realizar\n\nTe comparto el registro del encuentro programado:\n📅 Día: ${fechaTexto}\n🕰️ Horario: ${hora}\n\n🔔 En caso de cancelación, se solicita avisar con 24 horas de anticipación.\nDe no cumplirse este plazo, se cobrará el valor total de la sesión.\n\n💧 Para la sesión presencial, traer una botellita de agua.\n\nGracias por tu compromiso con este espacio de trabajo personal.\nCada paso consciente suma claridad y orden al proceso.\nGrandioso Universo Terapias ✨`;
}

async function revisarTurnosYEnviar(calendar, requireGoogleAuth, log, config, sock, sendQueue) {
    if (!sock) return;
    if (!requireGoogleAuth('Calendar')) return;

    const hoy = moment().tz(config.timezone);
    const mananaObjetivo = hoy.clone().add(1, 'days');

    log('🔔 Iniciando envio de recordatorios...');

    try {
        const response = await calendar.events.list({
            calendarId: config.calendarId,
            timeMin: hoy.clone().startOf('day').toISOString(),
            timeMax: hoy.clone().add(2, 'days').endOf('day').toISOString(),
            singleEvents: true
        });

        const events = response.data.items || [];
        log(`🔔 Eventos encontrados: ${events.length}`);

        for (const event of events) {
            const start = event.start?.dateTime || event.start?.date;
            if (!start) continue;
            const fechaEvento = moment(start).tz(config.timezone);
            if (!fechaEvento.isSame(mananaObjetivo, 'day')) continue;

            const desc = event.description || '';
            const matchTel = desc.match(/(\d{10,13})/);
            if (!matchTel) {
                log('⚠️ Evento sin telefono en descripcion.');
                continue;
            }

            let telefono = matchTel[1];
            if (!telefono.startsWith('54')) telefono = `549${telefono}`;

            let fechaTexto = mananaObjetivo.format('dddd D [de] MMMM');
            fechaTexto = fechaTexto.charAt(0).toUpperCase() + fechaTexto.slice(1);
            const hora = `${fechaEvento.format('HH:mm')} hs`;

            const mensaje = buildReminderMessage(fechaTexto, hora);
            const jid = `${telefono}@s.whatsapp.net`;

            try {
                const [res] = await sock.onWhatsApp(jid);
                if (res?.exists) {
                    await sendQueue(() => sock.sendMessage(jid, { text: mensaje }));
                    log(`📤 Recordatorio enviado a ${telefono}`);
                } else {
                    log(`⚠️ Numero no existe en WhatsApp: ${telefono}`);
                }
            } catch (error) {
                log(`❌ Error enviando recordatorio a ${telefono}: ${error.message}`);
            }
        }
    } catch (error) {
        log(`❌ Error Cron: ${error.message}`);
    }
}

module.exports = {
    revisarTurnosYEnviar
};
