# 🤖 Grandioso Universo - Bot de Turnos

**Versión 9.5.0**

Bot de WhatsApp con integración a Google Calendar para gestión automática de turnos.

## ✨ Características

- 📱 Bot de WhatsApp usando Baileys 6.7.8
- 📅 Integración con Google Calendar
- 🧠 Procesamiento de lenguaje natural para fechas y horas
- ☁️ Backup automático en Google Drive
- 🔔 Recordatorios automáticos a las 7 AM
- 🌐 Dashboard web con FullCalendar
- 🔄 Reconexión automática con backoff exponencial

## 🛠️ Tecnologías

- **Node.js** >= 18.0.0
- **date-fns** & **date-fns-tz** para manejo de fechas/zonas horarias
- **@whiskeysockets/baileys** para WhatsApp
- **googleapis** para Calendar y Drive
- **Express** para servidor web
- **node-cron** para tareas programadas

## 📦 Instalación

```bash
npm install
```

## ⚙️ Configuración

Crear archivo `.env`:

```env
CALENDAR_ID=tu_calendar_id@group.calendar.google.com
GOOGLE_CREDENTIALS={"type":"service_account",...}
ADMIN_TOKEN=tu_token_secreto
PORT=3000
```

## 🚀 Uso

```bash
npm start
```

Dashboard disponible en `http://localhost:3000`

## 📝 Comandos

- **🗓️** + mensaje: Agenda turno (detecta fecha, hora y nombre)
- **🚫** + mensaje: Cancela turno

### Ejemplos:

- "🗓️ Turno para Juan mañana a las 15:00"
- "🗓️ María el viernes 14:30"
- "🗓️ Sesión el próximo lunes 10hs"
- "🚫 Cancelar turno"

## 🔧 Scripts

- `npm start` - Inicia el bot
- `npm run lint` - Ejecuta ESLint
- `npm run format` - Formatea código con Prettier

## 📄 Licencia

MIT
