# 🤖 Grandioso Universo - Bot de Turnos

**Versión 9.5.0**

Bot de WhatsApp con integración a Google Calendar para gestión automática de turnos mediante comandos emoji. Sistema híbrido con backup en la nube y procesamiento de lenguaje natural para fechas en español.

## ✨ Características

- 📱 Bot de WhatsApp usando Baileys 6.7.8
- 📅 Integración con Google Calendar para agendar/cancelar turnos
- 🧠 Procesamiento de lenguaje natural para fechas y horas en español
- ☁️ Backup automático de sesión en Google Drive
- 🔔 Recordatorios automáticos a las 7 AM (Argentina)
- 🌐 Dashboard web con FullCalendar para visualizar turnos
- 🔄 Reconexión automática con backoff exponencial
- 🔐 Endpoint protegido para pruebas manuales

## 🛠️ Tecnologías

- **Node.js** >= 18.0.0 (soporte nativo de crypto)
- **date-fns** & **date-fns-tz** para manejo de fechas/zonas horarias
- **@whiskeysockets/baileys** 6.7.8 para WhatsApp
- **googleapis** para Calendar y Drive
- **Express** para servidor web
- **node-cron** para tareas programadas
- **Pino** para logging estructurado
- **ESLint** & **Prettier** para calidad de código

## 📦 Instalación

```bash
# Clonar repositorio
git clone https://github.com/AlanDi123/bot-turnos.git
cd bot-turnos

# Instalar dependencias
npm install
```

## ⚙️ Configuración

### 1. Variables de Entorno

Crear archivo `.env` en la raíz del proyecto:

```env
# ID del calendario de Google (requerido para funcionalidad de turnos)
CALENDAR_ID=tu_calendar_id@group.calendar.google.com

# Credenciales de Google Service Account (JSON completo)
GOOGLE_CREDENTIALS={"type":"service_account","project_id":"...","private_key":"..."}

# Token de administrador para endpoint /test (opcional)
ADMIN_TOKEN=tu_token_secreto_aqui

# Puerto del servidor web (opcional, default: 3000)
PORT=3000

# Nivel de logging (opcional, default: info)
LOG_LEVEL=info
```

### 2. Credenciales de Google

**Opción A: Variable de entorno (recomendado para producción)**
- Crear Service Account en Google Cloud Console
- Habilitar Calendar API y Drive API
- Descargar JSON de credenciales
- Copiar contenido completo a `GOOGLE_CREDENTIALS`

**Opción B: Archivo local (desarrollo)**
- Guardar credenciales en `credentials.json` en la raíz
- El bot detectará automáticamente este archivo

### 3. Google Drive

- Crear una carpeta llamada `BOT_DATA` en Google Drive
- Compartir la carpeta con el email del Service Account
- El bot guardará backups automáticamente en esta carpeta

## 🚀 Uso

```bash
# Iniciar bot
npm start
```

Al iniciar:
1. El bot intentará restaurar la sesión desde Drive
2. Si no hay sesión, generará un código QR
3. Escanear el QR con WhatsApp (Dispositivos vinculados)
4. Dashboard disponible en `http://localhost:3000`

## 📝 Comandos del Bot

### Agendar Turno

Enviar mensaje en WhatsApp que contenga **🗓️** seguido de información del turno:

**Ejemplos:**
- `🗓️ Turno para Juan mañana a las 15:00`
- `🗓️ María el viernes 14:30`
- `🗓️ Sesión el próximo lunes 10hs`
- `🗓️ Pedro pasado mañana 16:00`
- `🗓️ Ana 10/5 a las 9hs`

**Detección inteligente:**
- **Fechas:** hoy, mañana, pasado mañana, lunes, martes, próximo lunes, 10/5
- **Horas:** 14:30, 14.30, 14hs, 14h, a las 15, 3pm
- **Nombres:** Detecta palabras con mayúscula inicial

### Cancelar Turno

Enviar mensaje con **🚫** desde el chat del paciente:

**Ejemplos:**
- `🚫 Cancelar turno`
- `🚫`

**Nota:** Cancela el próximo turno agendado para ese número de teléfono.

## 🌐 Dashboard Web

Acceder a `http://localhost:3000` para ver:

- **Calendario visual** con todos los turnos del mes
- **Estado de conexión** de WhatsApp (online/offline)
- **Código QR** para vincular (si no está conectado)
- **Logs en tiempo real** de actividad del bot
- **Actualización automática** cada minuto

### Endpoint de Prueba

```bash
# Enviar recordatorios manualmente (requiere ADMIN_TOKEN)
curl -H "x-admin-token: tu_token_secreto" http://localhost:3000/test
```

## 🔧 Scripts de Desarrollo

```bash
# Iniciar bot en producción
npm start

# Verificar código con ESLint
npm run lint

# Formatear código con Prettier
npm run format
```

## 📋 Características Técnicas

### Backup Automático
- Cada 15 minutos (incremental)
- Cada hora (completo)
- Al abrir/cerrar conexión WhatsApp
- Al actualizar credenciales

### Recordatorios
- Ejecuta a las 7 AM (zona horaria Argentina)
- Envía mensajes a turnos del día siguiente
- Incluye instrucciones de cancelación

### Reconexión
- Backoff exponencial (2s, 4s, 8s, ..., max 30s)
- Recuperación automática de sesión
- Logs detallados de desconexión

### Logging
- Formato estructurado con Pino
- Niveles: debug, info, warn, error
- Almacena últimos 50 eventos en dashboard

## 🐳 Docker

```bash
# Construir imagen
docker build -t bot-turnos .

# Ejecutar contenedor
docker run -d \
  -p 3000:3000 \
  -e CALENDAR_ID="..." \
  -e GOOGLE_CREDENTIALS="..." \
  --name bot-turnos \
  bot-turnos
```

## 🔒 Seguridad

- ✅ Sin vulnerabilidades (CodeQL verificado)
- ✅ Dependencias actualizadas
- ✅ Credenciales en variables de entorno
- ✅ Token de admin para endpoints protegidos
- ✅ Validación de inputs de usuario

## 🤝 Contribuir

1. Fork el repositorio
2. Crear rama feature (`git checkout -b feature/mejora`)
3. Commit cambios (`git commit -m 'Agregar mejora'`)
4. Push a la rama (`git push origin feature/mejora`)
5. Abrir Pull Request

## 📄 Licencia

MIT

## 📞 Soporte

Para problemas o preguntas, abrir un issue en GitHub.
