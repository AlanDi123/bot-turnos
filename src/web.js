const express = require('express');
const moment = require('moment-timezone');

function createWebServer(config, log, getLogs, state, calendar, requireGoogleAuth, hasGoogleAuth, onTest) {
    const app = express();
    app.disable('x-powered-by');

    app.get('/healthz', (req, res) => {
        res.json({ ok: true, connected: state.isConnected });
    });

    app.get('/readyz', (req, res) => {
        const ready = state.isConnected && hasGoogleAuth();
        res.status(ready ? 200 : 503).json({ ready });
    });

    app.get('/api/turnos', async (req, res) => {
        try {
            if (!requireGoogleAuth('Calendar')) {
                return res.status(503).json({ error: 'Google auth no configurada' });
            }

            const inicio = moment().tz(config.timezone).startOf('month').subtract(7, 'days');
            const fin = moment().tz(config.timezone).endOf('month').add(14, 'days');

            const response = await calendar.events.list({
                calendarId: config.calendarId,
                timeMin: inicio.toISOString(),
                timeMax: fin.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });

            const eventos = (response.data.items || []).map((ev) => ({
                title: ev.summary || 'Ocupado',
                start: ev.start.dateTime || ev.start.date,
                end: ev.end.dateTime || ev.end.date,
                color: '#9c27b0',
                description: ev.description || ''
            }));

            return res.json(eventos);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/', async (req, res) => {
        const qrData = state.qrCodeUrl || null;
        const statusClass = state.isConnected ? 'online' : 'offline';
        const statusText = state.isConnected ? 'Conectado y Armonizado' : 'Esperando Conexión';
        const logsHtml = getLogs()
            .map((l) => `<div class="log-item"><span class="log-time">${l.time}</span> ${l.msg}</div>`)
            .join('');

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
        .status-badge { background: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
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
            ${!state.isConnected && qrData ? `<div class="card"><h3>📲 Vincular</h3><div class="qr-box"><img src="${qrData}"></div><p style="text-align:center;font-size:0.9rem;">Escanea desde WhatsApp</p></div>` : ''}
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
                eventClick: function(info) { alert('Paciente: ' + info.event.title + '\n' + (info.event.extendedProps.description || '')); }
            });
            calendar.render();
        });
        setTimeout(() => location.reload(), 60000);
    </script>
</body>
</html>`);
    });

    app.get('/test', (req, res) => {
        onTest();
        res.redirect('/');
    });

    const server = app.listen(config.port, async () => {
        log('🌐 Portal Web Abierto.');
    });

    return server;
}

module.exports = { createWebServer };
