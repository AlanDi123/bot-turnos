# 🚀 Guía de Despliegue en Render.com

Esta guía te ayudará a desplegar tu bot de WhatsApp en Render.com de forma **gratuita** y que esté **siempre en línea**.

## ✅ Ventajas de Render.com

- ✨ **Gratis**: Plan gratuito generoso
- 🔄 **Siempre activo**: El servicio se mantiene en línea 24/7
- 🔌 **Auto-reinicio**: Si el bot se cae, Render lo reinicia automáticamente
- 📦 **Fácil despliegue**: Conecta tu repositorio de GitHub y listo
- 🌐 **HTTPS incluido**: Certificado SSL automático

## 📋 Requisitos Previos

1. **Cuenta de GitHub** - Para subir tu código
2. **Cuenta de Render.com** - Crea una gratis en https://render.com
3. **Credenciales de Google** - Para acceder a Calendar API

## 🔧 Paso 1: Preparar Credenciales de Google

### Opción A: OAuth (Recomendado)

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un proyecto o selecciona uno existente
3. Activa la **Google Calendar API**
4. Crea credenciales OAuth 2.0
5. Descarga el archivo `credentials.json`
6. Ejecuta localmente: `npm run auth` para generar `token.json`
7. Copia el contenido de ambos archivos (los necesitarás después)

### Opción B: Service Account

1. En Google Cloud Console, crea una Service Account
2. Descarga el archivo JSON de credenciales
3. Comparte tu calendario con el email de la service account
4. Copia el contenido del archivo JSON

## 📤 Paso 2: Subir Código a GitHub

```bash
# Si aún no has inicializado git
git init
git add .
git commit -m "Preparando bot para Render"

# Crea un repositorio en GitHub y luego:
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git branch -M main
git push -u origin main
```

⚠️ **IMPORTANTE**: NO subas archivos sensibles (`credentials.json`, `token.json`, `.env`, `auth_info_baileys/`)

## 🌐 Paso 3: Desplegar en Render

### 3.1 Crear el Servicio

1. Inicia sesión en [Render.com](https://render.com)
2. Haz clic en **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Configura el servicio:
   - **Name**: `bot-turnos-whatsapp` (o el nombre que prefieras)
   - **Environment**: `Docker`
   - **Plan**: `Free`
   - **Region**: Elige la más cercana a ti

### 3.2 Configurar Variables de Entorno

En la sección **Environment**, agrega estas variables:

#### Variables Requeridas:

```
CALENDAR_ID=tu-email@gmail.com
TZ=America/Argentina/Buenos_Aires
```

#### Para OAuth (Opción A):

```
GOOGLE_OAUTH_CLIENT=<pega aquí el contenido de credentials.json>
GOOGLE_OAUTH_TOKEN=<pega aquí el contenido de token.json>
```

#### Para Service Account (Opción B):

```
GOOGLE_CREDENTIALS=<pega aquí el contenido del archivo de service account>
```

#### Variables Opcionales:

```
EMOJI_AGENDAR=🗓️
EMOJI_CANCELAR=🚫
DEFAULT_DURATION=60
REMINDER_HOUR=7
REMINDER_MINUTE=0
MAX_RECONNECT_BEFORE_RESET=10
```

### 3.3 Desplegar

Haz clic en **"Create Web Service"**. Render comenzará a construir y desplegar tu aplicación.

⏱️ El primer despliegue puede tomar 5-10 minutos.

## 📱 Paso 4: Conectar WhatsApp

1. Una vez desplegado, ve a la URL de tu servicio (ejemplo: `https://bot-turnos-whatsapp.onrender.com`)
2. Abre la interfaz web
3. Verás el código QR de WhatsApp
4. Escanea el QR con tu WhatsApp
5. ¡Listo! El bot está conectado

## 🔍 Verificar que Funciona

- **Health Check**: `https://tu-app.onrender.com/health`
- **Status**: `https://tu-app.onrender.com/api/status`
- **Ver QR**: `https://tu-app.onrender.com/api/qr`
- **Panel Web**: `https://tu-app.onrender.com/`

## ⚠️ Limitaciones del Plan Gratuito

- El servicio **se suspende después de 15 minutos de inactividad**
- Se reactiva automáticamente cuando recibe una solicitud
- **Solución**: Usar un servicio de "ping" como [UptimeRobot](https://uptimerobot.com) (gratis) para hacer ping cada 5 minutos a `/health`

### Configurar UptimeRobot (Opcional pero Recomendado)

1. Crea una cuenta en [UptimeRobot.com](https://uptimerobot.com)
2. Crea un nuevo monitor:
   - **Monitor Type**: HTTP(s)
   - **URL**: `https://tu-app.onrender.com/health`
   - **Monitoring Interval**: 5 minutos
3. ¡Listo! Ahora tu bot estará siempre activo

## 🔄 Actualizar el Bot

```bash
git add .
git commit -m "Actualización del bot"
git push
```

Render detectará el push y redesplegará automáticamente.

## 🐛 Solución de Problemas

### El bot se desconecta de WhatsApp

- Verifica que UptimeRobot esté activo
- Revisa los logs en Render Dashboard
- El bot se reconecta automáticamente

### No puedo ver el QR

- Ve a `https://tu-app.onrender.com/api/qr`
- O revisa los logs en Render

### "Google auth no configurada"

- Verifica que las variables `GOOGLE_OAUTH_CLIENT` y `GOOGLE_OAUTH_TOKEN` estén correctamente configuradas
- Asegúrate de que no haya espacios extra al pegar el JSON

### El servicio no arranca

- Revisa los logs en Render Dashboard
- Verifica que todas las variables de entorno requeridas estén configuradas

## 📊 Monitoreo

### Ver Logs en Tiempo Real

En el dashboard de Render:
1. Ve a tu servicio
2. Haz clic en la pestaña **"Logs"**
3. Verás todos los eventos del bot en tiempo real

### Endpoints Útiles

- `/health` - Estado del servidor
- `/api/status` - Estado de conexión de WhatsApp
- `/api/logs` - Últimos logs del bot
- `/api/turnos` - Ver turnos del calendario

## 🎉 ¡Todo Listo!

Tu bot ahora está:
- ✅ Desplegado en la nube
- ✅ Siempre en línea (con UptimeRobot)
- ✅ Con reconexión automática
- ✅ Sin backups corruptos
- ✅ Gratis

---

## 🆘 ¿Necesitas Ayuda?

Si tienes problemas:
1. Revisa los logs en Render
2. Verifica las variables de entorno
3. Asegúrate de que el calendario esté compartido correctamente

## 🚀 Alternativas a Render

Si prefieres otra plataforma:
- **Railway.app**: Similar a Render, muy fácil de usar
- **Fly.io**: Más técnico pero muy potente
- **Heroku**: De pago pero muy estable
- **Replit**: Para desarrollo rápido

Todas estas plataformas funcionarán con este código sin modificaciones.
