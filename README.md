# bot-turnos

## OAuth (Render)
1) Crea un OAuth Client en Google Cloud (tipo "Desktop app").
2) Descarga el JSON y guardalo como `credentials.json` (no lo subas al repo).
3) En tu PC local, ejecuta:

```bash
npm run auth
```

4) Esto genera `token.json`. Copia su contenido a la variable de entorno `GOOGLE_OAUTH_TOKEN` en Render.
5) Copia el contenido del JSON de OAuth a `GOOGLE_OAUTH_CLIENT` en Render.

Notas:
- Si no queres backup a Drive, setea `DISABLE_DRIVE_BACKUP=1`.
- El token debe incluir `refresh_token` (por eso se usa `prompt=consent`).