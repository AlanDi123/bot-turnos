const moment = require('moment-timezone');

function normalizeText(texto) {
    return texto.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Sin tildes
        .replace(/[^a-z0-9\s:]/g, ''); // Solo alfanumérico
}

function detectarFecha(texto, timezone) {
    const hoy = moment().tz(timezone);
    const textoNorm = normalizeText(texto);
    let fechaDetectada = null;

    if (textoNorm.includes('pasado manana')) fechaDetectada = hoy.clone().add(2, 'days');
    else if (textoNorm.includes('manana')) fechaDetectada = hoy.clone().add(1, 'days');
    else if (textoNorm.includes('hoy')) fechaDetectada = hoy.clone();

    // Días de la semana inteligentes
    const diasSemana = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    diasSemana.forEach((dia, index) => {
        if (textoNorm.includes(dia)) {
            let diff = index - hoy.day();
            if (diff <= 0) diff += 7;
            if (textoNorm.includes('proximo') || textoNorm.includes('siguiente')) diff += 7;
            fechaDetectada = hoy.clone().add(diff, 'days');
        }
    });

    // Fechas textuales (10 de mayo)
    const regexTextual = /(\d{1,2})\s*(?:de)?\s*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/;
    const matchTextual = textoNorm.match(regexTextual);
    
    if (matchTextual) {
        const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        const mesIndex = meses.indexOf(matchTextual[2]);
        let candidata = hoy.clone().month(mesIndex).date(parseInt(matchTextual[1]));
        if (candidata.isBefore(hoy, 'day')) candidata.add(1, 'year');
        fechaDetectada = candidata;
    }

    // Fechas numéricas (10/05)
    if (!fechaDetectada) {
        const regexNum = /(\d{1,2})[\/\s-](\d{1,2})/;
        const matchNum = texto.match(regexNum);
        if (matchNum) {
            let candidata = hoy.clone().month(parseInt(matchNum[2]) - 1).date(parseInt(matchNum[1]));
            if (candidata.isBefore(hoy, 'day')) candidata.add(1, 'year');
            fechaDetectada = candidata;
        }
    }
    return fechaDetectada;
}

function detectarHora(texto) {
    const textoNorm = normalizeText(texto);
    // Regex flexible: 15:00, 15hs, 5pm, a las 5
    const matches = textoNorm.matchAll(/(\d{1,2})[:\.]?(\d{2})?\s*(hs|hrs|h|pm|am)?/g);

    for (const match of matches) {
        let h = parseInt(match[1]);
        let m = match[2] ? parseInt(match[2]) : 0;
        const mod = match[3];

        if (mod === 'pm' && h < 12) h += 12;
        if (mod === 'am' && h === 12) h = 0;
        
        // Inferencia: si dice "a las 2" es probable que sea 14hs
        if (!mod && h < 7 && h > 0) h += 12;

        if (h >= 0 && h < 24 && m >= 0 && m < 60) return { h, m };
    }
    return null;
}

function analizarContextoAvanzado(texto, timezone) {
    return {
        fecha: detectarFecha(texto, timezone),
        hora: detectarHora(texto),
        nombre: null // Por seguridad usamos nombre de WhatsApp
    };
}

module.exports = { analizarContextoAvanzado };
