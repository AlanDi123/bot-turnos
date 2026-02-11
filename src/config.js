const fs = require('fs');
const path = require('path');
require('dotenv').config();

const APP_CONFIG = {
    calendarId: process.env.CALENDAR_ID,
    // URL de Conexión a MongoDB Atlas
    mongoUrl: process.env.MONGO_URL, 
    
    EMOJI_AGENDAR: process.env.EMOJI_AGENDAR || '🗓️',
    EMOJI_CANCELAR: process.env.EMOJI_CANCELAR || '🚫',
    timezone: process.env.TZ || 'America/Argentina/Buenos_Aires',
    authFolder: './auth_info_baileys', // Solo fallback temporal
    defaultDuration: Number(process.env.DEFAULT_DURATION || 60),
    port: Number(process.env.PORT || 3000),
    reminderHour: Number(process.env.REMINDER_HOUR || 7),
    reminderMinute: Number(process.env.REMINDER_MINUTE || 0),
    logRetention: 50
};

function validateConfig() {
    const errors = [];
    if (!APP_CONFIG.calendarId) errors.push('Falta CALENDAR_ID');
    if (!APP_CONFIG.mongoUrl) errors.push('Falta MONGO_URL (Conexión a BD)');
    return errors;
}

function resolveCredentialsPath() {
    if (process.env.GOOGLE_CREDENTIALS) return null;
    const localPath = path.resolve(process.cwd(), 'credentials.json');
    if (fs.existsSync(localPath)) return localPath;
    return null;
}

function resolveOAuthTokenPath() {
    return path.resolve(process.cwd(), 'token.json');
}

module.exports = { APP_CONFIG, validateConfig, resolveCredentialsPath, resolveOAuthTokenPath };
