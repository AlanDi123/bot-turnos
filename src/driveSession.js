const fs = require('fs');
const AdmZip = require('adm-zip');

async function findBotFolder(drive, config) {
    const res = await drive.files.list({
        q: `name = '${config.folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)'
    });

    return res.data.files[0] ? res.data.files[0].id : null;
}

async function restoreSessionFromDrive(drive, requireGoogleAuth, log, config) {
    log('☁️ Sincronizando Aura (Drive)...');
    try {
        if (!requireGoogleAuth('Drive')) return;
        const res = await drive.files.list({
            q: `name = '${config.zipName}' and trashed = false`,
            fields: 'files(id)'
        });

        if (res.data.files.length > 0) {
            const dest = fs.createWriteStream('./session.zip');
            const result = await drive.files.get(
                { fileId: res.data.files[0].id, alt: 'media' },
                { responseType: 'stream' }
            );

            await new Promise((resolve, reject) => {
                result.data.on('end', resolve).on('error', reject).pipe(dest);
            });

            const stats = fs.statSync('./session.zip');
            if (stats.size > 0) {
                const zip = new AdmZip('./session.zip');
                zip.extractAllTo('./', true);
                log('✅ Memoria Restaurada.');
            }
        }
    } catch (error) {
        log(`✨ Inicio limpio de energia. (${error.message})`);
    }
}

async function saveSessionToDrive(drive, requireGoogleAuth, log, config) {
    if (!fs.existsSync(config.authFolder)) return;
    try {
        if (!requireGoogleAuth('Drive')) return;
        const folderId = await findBotFolder(drive, config);
        if (!folderId) return log('❌ Falta carpeta BOT_DATA en Drive.');

        const zip = new AdmZip();
        zip.addLocalFolder(config.authFolder, config.authFolder);
        zip.writeZip('./session.zip');

        const search = await drive.files.list({
            q: `name = '${config.zipName}' and '${folderId}' in parents`,
            fields: 'files(id)'
        });

        const media = { mimeType: 'application/zip', body: fs.createReadStream('./session.zip') };

        if (search.data.files.length > 0) {
            await drive.files.update({ fileId: search.data.files[0].id, media });
        } else {
            await drive.files.create({
                requestBody: { name: config.zipName, parents: [folderId] },
                media
            });
        }
    } catch (error) {
        log(`❌ Error Backup: ${error.message}`);
    }
}

module.exports = {
    restoreSessionFromDrive,
    saveSessionToDrive
};
