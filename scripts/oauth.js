const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const { resolveCredentialsPath, resolveOAuthTokenPath } = require('../src/config');

const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive'
];

function loadOAuthClient() {
    if (process.env.GOOGLE_OAUTH_CLIENT) {
        return JSON.parse(process.env.GOOGLE_OAUTH_CLIENT);
    }

    const credPath = resolveCredentialsPath();
    if (!credPath) return null;
    return JSON.parse(fs.readFileSync(credPath, 'utf8'));
}

async function main() {
    const credentials = loadOAuthClient();
    if (!credentials) {
        console.error('No se encontraron credenciales OAuth.');
        process.exit(1);
    }

    if (credentials.type === 'service_account') {
        console.error('Las credenciales son de service account. Usa un OAuth client (installed/web).');
        process.exit(1);
    }

    const clientInfo = credentials.installed || credentials.web || {};
    const clientId = clientInfo.client_id;
    const clientSecret = clientInfo.client_secret;
    const redirectUri = Array.isArray(clientInfo.redirect_uris) ? clientInfo.redirect_uris[0] : null;

    if (!clientId || !clientSecret || !redirectUri) {
        console.error('Credenciales OAuth incompletas (client_id/client_secret/redirect_uris).');
        process.exit(1);
    }

    const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    console.log('Autoriza esta app visitando este link:');
    console.log(authUrl);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = await new Promise((resolve) => rl.question('Pega el codigo aqui: ', resolve));
    rl.close();

    const { tokens } = await oAuth2Client.getToken(code.trim());
    const tokenPath = resolveOAuthTokenPath();

    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log(`Token guardado en ${tokenPath}`);
}

main().catch((error) => {
    console.error(`Error OAuth: ${error.message}`);
    process.exit(1);
});
