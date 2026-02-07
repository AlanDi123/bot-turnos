const express = require('express');
const moment = require('moment-timezone');

function createWebServer(config, log, getLogs, state, calendar, requireGoogleAuth, hasGoogleAuth, onTest) {
    const app = express();
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });

    function rateLimit(windowMs, max) {
        const hits = new Map();
        return (req, res, next) => {
            const now = Date.now();
            const key = req.ip || 'unknown';
            const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };

            if (now > entry.resetAt) {
                entry.count = 0;
                entry.resetAt = now + windowMs;
            }

            entry.count += 1;
            hits.set(key, entry);

            if (entry.count > max) {
                return res.status(429).json({ error: 'Demasiadas solicitudes' });
            }

            return next();
        };
    }

    const apiLimiter = rateLimit(60 * 1000, 120);

    let cachedEvents = null;
    let cacheExpiresAt = 0;

    app.get('/healthz', (req, res) => {
        log('🩺 API /healthz solicitado.');
        res.json({ ok: true, connected: state.isConnected });
    });

    app.get('/readyz', (req, res) => {
        log('🟢 API /readyz solicitado.');
        const ready = state.isConnected && hasGoogleAuth();
        res.status(ready ? 200 : 503).json({ ready });
    });

    app.get('/api/status', apiLimiter, (req, res) => {
        log('📊 API /api/status solicitado.');
        return res.json({
            connected: state.isConnected,
            hasAuth: hasGoogleAuth(),
            serverTime: moment().tz(config.timezone).format('YYYY-MM-DD HH:mm:ss')
        });
    });

    app.get('/api/qr', apiLimiter, (req, res) => {
        log('📲 API /api/qr solicitado.');
        if (!state.qrCodeUrl) return res.json({ qr: null });
        return res.json({ qr: state.qrCodeUrl });
    });

    app.get('/api/logs', apiLimiter, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        return res.json(getLogs());
    });

    app.get('/api/turnos', apiLimiter, async (req, res) => {
        log('📅 API /api/turnos solicitado.');
        try {
            if (!requireGoogleAuth('Calendar')) {
                return res.status(503).json({ error: 'Google auth no configurada' });
            }

            if (!cachedEvents || Date.now() > cacheExpiresAt) {
                const inicio = moment().tz(config.timezone).startOf('month').subtract(7, 'days');
                const fin = moment().tz(config.timezone).endOf('month').add(14, 'days');

                const response = await calendar.events.list({
                    calendarId: config.calendarId,
                    timeMin: inicio.toISOString(),
                    timeMax: fin.toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime'
                });

                cachedEvents = (response.data.items || []).map((ev) => ({
                    title: ev.summary || 'Ocupado',
                    start: ev.start.dateTime || ev.start.date,
                    end: ev.end.dateTime || ev.end.date,
                    color: '#9c27b0',
                    description: ev.description || ''
                }));

                const ttl = Math.max(0, config.eventsCacheTtlMs || 0);
                cacheExpiresAt = Date.now() + ttl;
            }

            const query = (req.query.q || '').toString().trim().toLowerCase();
            const eventos = query
                ? cachedEvents.filter((ev) => {
                    return ev.title.toLowerCase().includes(query)
                        || (ev.description || '').toLowerCase().includes(query);
                })
                : cachedEvents;

            return res.json(eventos);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/turnos/summary', apiLimiter, async (req, res) => {
        log('📈 API /api/turnos/summary solicitado.');
        try {
            if (!requireGoogleAuth('Calendar')) {
                return res.status(503).json({ error: 'Google auth no configurada' });
            }

            const now = moment().tz(config.timezone);
            const start = now.clone().startOf('month');
            const end = now.clone().endOf('month');

            const response = await calendar.events.list({
                calendarId: config.calendarId,
                timeMin: start.toISOString(),
                timeMax: end.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
            });

            const items = response.data.items || [];
            const total = items.length;
            const today = items.filter((ev) => {
                const startAt = ev.start?.dateTime || ev.start?.date;
                return startAt && moment(startAt).tz(config.timezone).isSame(now, 'day');
            }).length;

            return res.json({ total, today });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/turnos/raw', apiLimiter, async (req, res) => {
        log('🗂️ API /api/turnos/raw solicitado.');
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

            return res.json(response.data.items || []);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/cache/clear', apiLimiter, (req, res) => {
        log('🧹 API /api/cache/clear solicitado.');
        if (config.adminToken) {
            const token = req.headers['x-admin-token'] || req.query.token;
            if (token !== config.adminToken) {
                return res.status(403).json({ error: 'No autorizado' });
            }
        }
        cachedEvents = null;
        cacheExpiresAt = 0;
        return res.json({ ok: true });
    });

    app.get('/', async (req, res) => {
        log('🧭 Render de dashboard solicitado.');
        const qrData = state.qrCodeUrl || null;
        const statusClass = state.isConnected ? 'online' : 'offline';
        const statusText = state.isConnected ? 'Conectado y Armonizado' : 'Esperando Conexión';
        const logsHtml = getLogs()
            .map((l) => `<div class="log-item"><span class="log-time">${l.time}</span> ${l.msg}</div>`)
            .join('');

        const adminActions = config.adminToken
            ? `<a href="/test" data-token="${config.adminToken}" class="btn">⚡ Forzar Recordatorios</a>
               <button type="button" class="btn" id="clear-cache">🧹 Limpiar Cache</button>`
            : '<p style="font-size:0.85rem;margin:0;">Configura <code>ADMIN_TOKEN</code> para habilitar acciones.</p>';

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
        .btn { display: block; text-align: center; background: var(--secondary); color: var(--primary); padding: 10px; text-decoration: none; border-radius: 8px; font-weight: bold; border: 0; cursor: pointer; }
        .filters { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .filters input { flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid #e0d7ef; }
        .summary { display: flex; gap: 10px; font-size: 0.85rem; color: #6b5b80; }
        .error-banner { display: none; padding: 10px; border-radius: 8px; background: #ffebee; color: #b71c1c; font-size: 0.85rem; margin-bottom: 10px; }
        .status-pill { display: inline-flex; gap: 6px; align-items: center; font-size: 0.85rem; color: #6b5b80; }
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
        <div class="status-badge ${statusClass}" id="status-badge"><div class="dot"></div> <span id="status-text">${statusText}</span></div>
    </div>
    <div class="container">
        <div class="calendar-card">
            <div class="error-banner" id="calendar-error"></div>
            <div class="filters">
                <input id="filter" type="text" placeholder="Buscar por nombre o descripcion" />
                <span class="summary" id="summary"></span>
            </div>
            <div id="calendar"></div>
        </div>
        <div class="sidebar">
            <div class="card" id="qr-card" style="display:${!state.isConnected && qrData ? 'block' : 'none'};">
                <h3>📲 Vincular</h3>
                <div class="qr-box"><img id="qr-img" src="${qrData || ''}" alt="QR"></div>
                <p style="text-align:center;font-size:0.9rem;">Escanea desde WhatsApp</p>
            </div>
            <div class="card"><h3>📜 Registro</h3><div class="logs-container">${logsHtml}</div></div>
            <div class="card"><h3>Estado</h3><div class="status-pill" id="auth-status">Google: -- | WhatsApp: --</div></div>
            <div class="card"><h3>💎 Acciones</h3>${adminActions}</div>
        </div>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            var calendarEl = document.getElementById('calendar');
            var filterEl = document.getElementById('filter');
            var summaryEl = document.getElementById('summary');
            var statusTextEl = document.getElementById('status-text');
            var statusBadgeEl = document.getElementById('status-badge');
            var qrCardEl = document.getElementById('qr-card');
            var qrImgEl = document.getElementById('qr-img');
            var errorEl = document.getElementById('calendar-error');
            var authStatusEl = document.getElementById('auth-status');
            var filterValue = '';
            var calendar = new FullCalendar.Calendar(calendarEl, {
                initialView: 'dayGridMonth', locale: 'es',
                headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
                events: function(info, success, failure) {
                    var url = '/api/turnos';
                    if (filterValue) url += '?q=' + encodeURIComponent(filterValue);
                    fetch(url)
                        .then(function(res) { return res.json(); })
                        .then(function(data) {
                            if (data && data.error) {
                                errorEl.textContent = 'Error calendario: ' + data.error;
                                errorEl.style.display = 'block';
                                return success([]);
                            }
                            errorEl.style.display = 'none';
                            return success(data);
                        })
                        .catch(function(err) {
                            errorEl.textContent = 'Error calendario: ' + (err && err.message ? err.message : 'desconocido');
                            errorEl.style.display = 'block';
                            return failure(err);
                        });
                },
                eventColor: '#9c27b0', height: '100%',
                eventClick: function(info) { alert('Paciente: ' + info.event.title + '\n' + (info.event.extendedProps.description || '')); }
            });
            calendar.render();

            function updateSummary() {
                fetch('/api/turnos/summary')
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        if (data && typeof data.total !== 'undefined') {
                            summaryEl.textContent = 'Total mes: ' + data.total + ' | Hoy: ' + data.today;
                        }
                    })
                    .catch(function() {});
            }

            filterEl.addEventListener('input', function() {
                filterValue = filterEl.value.trim();
                calendar.refetchEvents();
            });

            setInterval(function() { calendar.refetchEvents(); }, 60000);
            setInterval(updateSummary, 60000);
            updateSummary();

            function refreshStatus() {
                fetch('/api/status')
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        if (!data) return;
                        if (data.connected) {
                            statusTextEl.textContent = 'Conectado y Armonizado';
                            statusBadgeEl.classList.add('online');
                            statusBadgeEl.classList.remove('offline');
                            qrCardEl.style.display = 'none';
                        } else {
                            statusTextEl.textContent = 'Esperando Conexión';
                            statusBadgeEl.classList.add('offline');
                            statusBadgeEl.classList.remove('online');
                        }
                        authStatusEl.textContent = 'Google: ' + (data.hasAuth ? 'OK' : 'NO') + ' | WhatsApp: ' + (data.connected ? 'OK' : 'NO');
                    })
                    .catch(function() {});
            }

            function refreshQr() {
                fetch('/api/qr')
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        if (!data) return;
                        if (data.qr) {
                            qrCardEl.style.display = 'block';
                            qrImgEl.src = data.qr;
                        }
                    })
                    .catch(function() {});
            }

            var clearCacheBtn = document.getElementById('clear-cache');
            if (clearCacheBtn) {
                clearCacheBtn.addEventListener('click', function() {
                    fetch('/api/cache/clear', {
                        method: 'POST',
                        headers: { 'x-admin-token': clearCacheBtn.getAttribute('data-token') || '' }
                    }).then(function() { calendar.refetchEvents(); });
                });
            }

            setInterval(refreshStatus, 15000);
            setInterval(refreshQr, 10000);
            refreshStatus();
            refreshQr();
        });

        function refreshLogs() {
            fetch('/api/logs')
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    var container = document.querySelector('.logs-container');
                    if (!container) return;
                    container.innerHTML = data.map(function(l) {
                        return '<div class="log-item"><span class="log-time">' + l.time + '</span> ' + l.msg + '</div>';
                    }).join('');
                })
                .catch(function() {});
        }

        setInterval(refreshLogs, 20000);
    </script>
</body>
</html>`);
    });

    app.get('/test', (req, res) => {
        log('⚡ Accion /test solicitada.');
        if (config.adminToken) {
            const token = req.query.token || req.headers['x-admin-token'];
            if (token !== config.adminToken) {
                return res.status(403).send('No autorizado');
            }
        }
        onTest();
        return res.redirect('/');
    });

    const server = app.listen(config.port, async () => {
        log('🌐 Portal Web Abierto.');
    });

    return server;
}

module.exports = { createWebServer };
