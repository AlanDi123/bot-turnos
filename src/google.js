const fs = require('fs');
const { google } = require('googleapis');
const { resolveCredentialsPath, resolveOAuthTokenPath } = require('./config');

function loadCredentials(log) {
    if (process.env.GOOGLE_OAUTH_CLIENT) {
        try {
            return JSON.parse(process.env.GOOGLE_OAUTH_CLIENT);
        } catch (error) {
            log(`❌ GOOGLE_OAUTH_CLIENT invalido: ${error.message}`);
            return null;
        }
    }

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

function loadOAuthToken(log, tokenPath) {
    if (process.env.GOOGLE_OAUTH_TOKEN) {
        try {
            return JSON.parse(process.env.GOOGLE_OAUTH_TOKEN);
        } catch (error) {
            log(`❌ GOOGLE_OAUTH_TOKEN invalido: ${error.message}`);
            return null;
        }
    }

    if (tokenPath && fs.existsSync(tokenPath)) {
        try {
            return JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        } catch (error) {
            log(`❌ No se pudo leer token OAuth: ${error.message}`);
            return null;
        }
    }

    return null;
}

function initGoogleClients(log) {
    let authClient = null;
    let authType = null;
    const credentials = loadCredentials(log);
    const oauthTokenPath = resolveOAuthTokenPath();

    if (credentials) {
        if (credentials.type === 'service_account') {
            authType = 'service_account';
            authClient = google.auth.fromJSON(credentials);
            authClient.scopes = [
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/drive'
            ];
        } else {
            authType = 'oauth';
            const clientInfo = credentials.installed || credentials.web || {};
            const clientId = clientInfo.client_id;
            const clientSecret = clientInfo.client_secret;
            const redirectUri = Array.isArray(clientInfo.redirect_uris) ? clientInfo.redirect_uris[0] : null;

            if (!clientId || !clientSecret || !redirectUri) {
                log('❌ Credenciales OAuth incompletas (client_id/client_secret/redirect_uris).');
            } else {
                authClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
                const token = loadOAuthToken(log, oauthTokenPath);
                if (token) {
                    authClient.setCredentials(token);
                } else {
                    log('⚠️ Falta token OAuth. Ejecuta el flujo de autorizacion para generar token.json.');
                }
            }
        }
    }

    const calendar = google.calendar({ version: 'v3', auth: authClient });
    const drive = google.drive({ version: 'v3', auth: authClient });

    function hasGoogleAuth() {
        if (!authClient) return false;
        if (authType !== 'oauth') return true;
        const creds = authClient.credentials || {};
        return Boolean(creds.refresh_token || creds.access_token);
    }

    function requireGoogleAuth(feature) {
        if (hasGoogleAuth()) return true;
        if (authType === 'oauth') {
            log(`❌ Google auth no configurada (${feature}). Falta token OAuth.`);
            return false;
        }
        log(`❌ Google auth no configurada (${feature}). Revisa GOOGLE_OAUTH_CLIENT o GOOGLE_CREDENTIALS.`);
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
