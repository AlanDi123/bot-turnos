const fs = require('fs');
const { google } = require('googleapis');
const { resolveCredentialsPath } = require('./config');

function loadCredentials(log) {
    if (process.env.GOOGLE_CREDENTIALS) {
        try {
            return JSON.parse(process.env.GOOGLE_CREDENTIALS);
        } catch (error) {
            log(`❌ GOOGLE_CREDENTIALS invalido: ${error.message}`);
            return null;
        }
    }

    const credPath = resolveCredentialsPath();
    if (credPath) {
        try {
            return JSON.parse(fs.readFileSync(credPath, 'utf8'));
        } catch (error) {
            log(`❌ No se pudo leer credentials.json: ${error.message}`);
            return null;
        }
    }

    return null;
}

function initGoogleClients(log) {
    let authClient = null;
    const credentials = loadCredentials(log);

    if (credentials) {
        authClient = google.auth.fromJSON(credentials);
        authClient.scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/drive'
        ];
    }

    const calendar = google.calendar({ version: 'v3', auth: authClient });
    const drive = google.drive({ version: 'v3', auth: authClient });

    function hasGoogleAuth() {
        return Boolean(authClient);
    }

    function requireGoogleAuth(feature) {
        if (authClient) return true;
        log(`❌ Google auth no configurada (${feature}). Revisa GOOGLE_CREDENTIALS.`);
        return false;
    }

    return {
        authClient,
        calendar,
        drive,
        hasGoogleAuth,
        requireGoogleAuth
    };
}

module.exports = {
    initGoogleClients
};
