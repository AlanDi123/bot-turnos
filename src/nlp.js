const moment = require('moment-timezone');

function normalizeText(texto) {
    return texto
        .toLowerCase()
        .replace(/á/g, 'a')
        .replace(/é/g, 'e')
        .replace(/í/g, 'i')
        .replace(/ó/g, 'o')
        .replace(/ú/g, 'u');
}

function detectarFecha(texto, timezone) {
    const hoy = moment().tz(timezone);
    let fechaDetectada = null;
    const textoLower = normalizeText(texto);

    if (textoLower.includes('pasado manana')) {
        fechaDetectada = hoy.clone().add(2, 'days');
    } else if (textoLower.includes('manana')) {
        fechaDetectada = hoy.clone().add(1, 'days');
    } else if (textoLower.includes('hoy')) {
        fechaDetectada = hoy.clone();
    } else if (textoLower.includes('un mes') || textoLower.includes('mes que viene')) {
        fechaDetectada = hoy.clone().add(1, 'month');
    } else if (textoLower.includes('proxima semana') || textoLower.includes('semana que viene')) {
        fechaDetectada = hoy.clone().add(1, 'week');
    }

    const diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    let diaMencionado = -1;

    for (let i = 0; i < diasSemana.length; i += 1) {
        if (textoLower.includes(diasSemana[i])) {
            diaMencionado = i;
            break;
        }
    }

    if (diaMencionado !== -1 && !fechaDetectada) {
        let diff = diaMencionado - hoy.day();
        if (diff <= 0) diff += 7;
        if (textoLower.includes('proximo') || textoLower.includes('siguiente')) {
            diff += 7;
        }
        fechaDetectada = hoy.clone().add(diff, 'days');
    }

    const regexFechaNum = /(\d{1,2})[\/.-](\d{1,2})/;
    const matchFechaNum = texto.match(regexFechaNum);
    if (matchFechaNum && !fechaDetectada) {
        const dia = parseInt(matchFechaNum[1]);
        const mes = parseInt(matchFechaNum[2]) - 1;
        const candidata = hoy.clone().month(mes).date(dia);

        if (candidata.month() === mes && candidata.date() === dia) {
            fechaDetectada = candidata;
        }

        if (fechaDetectada && fechaDetectada.isBefore(hoy, 'day')) {
            fechaDetectada.add(1, 'year');
        }
    }

    return fechaDetectada;
}

function detectarHora(texto) {
    const regexHora = /(\d{1,2})[:\.](\d{2})|(\d{1,2})\s*(?:hs|hrs|h)/i;
    const matchHora = texto.match(regexHora);
    if (matchHora) {
        let h;
        let m = 0;

        if (matchHora[3]) {
            h = parseInt(matchHora[3]);
        } else {
            h = parseInt(matchHora[1]);
            m = parseInt(matchHora[2]);
        }

        if (h >= 0 && h < 24 && m >= 0 && m < 60) {
            return { h, m };
        }
    }

    const regexHoraContexto = /(?:a\s*las?|para\s*las?|hora(?:rio)?\s*:?)\s*(\d{1,2})(?:[:\.](\d{2}))?/i;
    const matchHoraContexto = texto.match(regexHoraContexto);
    if (matchHoraContexto) {
        const h = parseInt(matchHoraContexto[1]);
        const m = matchHoraContexto[2] ? parseInt(matchHoraContexto[2]) : 0;
        if (h >= 0 && h < 24 && m >= 0 && m < 60) {
            return { h, m };
        }
    }

    return null;
}

function detectarNombre(texto) {
    const palabrasIgnoradas = [
        'Turno', 'Para', 'Hola', 'El', 'La', 'Los', 'Las', 'Agendar', 'Cancelar', 'Tenes',
        'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo',
        'Manana', 'Hoy', 'Este', 'Proximo', 'Mes', 'Semana', 'Hs', 'H'
    ];

    const palabras = texto
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/gu, '')
        .split(/\s+/);

    const posiblesNombres = palabras.filter((p) => {
        return /^[A-Z][a-zñáéíóú]+$/.test(p) && !palabrasIgnoradas.includes(p);
    });

    if (posiblesNombres.length > 0) {
        return posiblesNombres.join(' ');
    }

    return null;
}

function analizarContextoAvanzado(texto, timezone) {
    const fecha = detectarFecha(texto, timezone);
    const hora = detectarHora(texto);
    const nombre = detectarNombre(texto);

    return { fecha, hora, nombre };
}

module.exports = {
    analizarContextoAvanzado
};
