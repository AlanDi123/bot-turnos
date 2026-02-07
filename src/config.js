const fs = require('fs');
const path = require('path');
require('dotenv').config();

const APP_CONFIG = {
    calendarId: process.env.CALENDAR_ID || 'andreaquinonez249@gmail.com',
    EMOJI_AGENDAR: process.env.EMOJI_AGENDAR || '🗓️',
    EMOJI_CANCELAR: process.env.EMOJI_CANCELAR || '🚫',
    timezone: process.env.TZ || 'America/Argentina/Buenos_Aires',
    zipName: process.env.SESSION_ZIP_NAME || 'backup_sesion_whatsapp_v2.zip',
    folderName: process.env.DRIVE_FOLDER_NAME || 'BOT_DATA',
    authFolder: process.env.AUTH_FOLDER || './auth_info_baileys',
    defaultDuration: Number(process.env.DEFAULT_DURATION || 60),
    port: Number(process.env.PORT || 3000),
    reminderHour: Number(process.env.REMINDER_HOUR || 7),
    reminderMinute: Number(process.env.REMINDER_MINUTE || 0),
    adminToken: process.env.ADMIN_TOKEN || '',
    logRetention: Number(process.env.LOG_RETENTION || 50),
    eventsCacheTtlMs: Number(process.env.EVENTS_CACHE_TTL_MS || 60000)
};

function validateConfig() {
    const errors = [];

    if (!APP_CONFIG.calendarId) errors.push('Falta CALENDAR_ID (o calendarId).');
    if (!Number.isFinite(APP_CONFIG.defaultDuration) || APP_CONFIG.defaultDuration <= 0) {
        errors.push('DEFAULT_DURATION debe ser un numero mayor a 0.');
    }

    if (APP_CONFIG.reminderHour < 0 || APP_CONFIG.reminderHour > 23) {
        errors.push('REMINDER_HOUR debe estar entre 0 y 23.');
    }

    if (APP_CONFIG.reminderMinute < 0 || APP_CONFIG.reminderMinute > 59) {
        errors.push('REMINDER_MINUTE debe estar entre 0 y 59.');
    }

    if (!Number.isFinite(APP_CONFIG.logRetention) || APP_CONFIG.logRetention <= 0) {
        errors.push('LOG_RETENTION debe ser un numero mayor a 0.');
    }

    if (!Number.isFinite(APP_CONFIG.eventsCacheTtlMs) || APP_CONFIG.eventsCacheTtlMs < 0) {
        errors.push('EVENTS_CACHE_TTL_MS debe ser un numero mayor o igual a 0.');
    }

    return errors;
}

function resolveCredentialsPath() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    const localPath = path.resolve(process.cwd(), 'credentials.json');
    if (fs.existsSync(localPath)) return localPath;

    return null;
}

module.exports = {
    APP_CONFIG,
    validateConfig,
    resolveCredentialsPath
};
