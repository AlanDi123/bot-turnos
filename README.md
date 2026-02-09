# 🤖 Bot de Turnos WhatsApp + Google Calendar

Bot de WhatsApp que gestiona turnos automáticamente usando Google Calendar. Versión 11.0 optimizada para despliegue en la nube sin backups corruptos.

## ✨ Características

- 📅 **Agendar turnos** automáticamente desde WhatsApp
- 🚫 **Cancelar turnos** con un emoji
- ⏰ **Recordatorios automáticos** diarios
- 🌐 **Dashboard web** para ver turnos y QR de conexión
- 🔄 **Reconexión automática** robusta
- ☁️ **Optimizado para la nube** (Render, Railway, Fly.io)
- 🆓 **Sin backups** que se corrompen

## 🚀 Inicio Rápido

### Despliegue en Render.com (Recomendado)

La forma más fácil de tener el bot siempre en línea:

👉 **[Lee la guía completa de despliegue](./DESPLIEGUE.md)**

### Ejecución Local

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar credenciales de Google
# Crea credentials.json en la raíz del proyecto
npm run auth

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus valores

# 4. Iniciar el bot
npm start
```

## 🔧 Configuración

### Variables de Entorno Principales

```env
CALENDAR_ID=tu-email@gmail.com
TZ=America/Argentina/Buenos_Aires
EMOJI_AGENDAR=🗓️
EMOJI_CANCELAR=🚫
```

Ver [.env.example](./.env.example) para todas las opciones.

## 📱 Uso

1. Conecta WhatsApp escaneando el QR desde el dashboard web
2. Envía mensajes a ti mismo que incluyan:
   - 🗓️ para **agendar** un turno
   - 🚫 para **cancelar** el turno del día

El bot procesará automáticamente los mensajes y gestionará el calendario.

## 🌐 Endpoints de la API

- `GET /health` - Health check
- `GET /api/status` - Estado de conexión
- `GET /api/qr` - Código QR de WhatsApp
- `GET /api/turnos` - Lista de turnos
- `GET /api/logs` - Logs del sistema

## 📦 Docker

```bash
docker build -t bot-turnos .
docker run -p 3000:3000 --env-file .env bot-turnos
```

## 🔄 Migración desde Versión Anterior

Si vienes de la versión con backups a Drive:

1. Los archivos `auth_info_baileys/` se mantienen en el servidor
2. Ya no necesitas configurar Drive
3. Elimina `DISABLE_DRIVE_BACKUP` y `DISABLE_DRIVE_RESTORE` de tu `.env`

## 🛠️ Tecnologías

- **@whiskeysockets/baileys** - Cliente de WhatsApp
- **googleapis** - Integración con Google Calendar
- **express** - Servidor web
- **node-cron** - Tareas programadas
- **moment-timezone** - Manejo de fechas

## 📄 Licencia

MIT

## 🆘 Soporte

Para problemas o preguntas, revisa:
1. [Guía de Despliegue](./DESPLIEGUE.md)
2. Los logs en `/api/logs`
3. El estado en `/api/status`