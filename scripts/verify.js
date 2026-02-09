#!/usr/bin/env node

/**
 * Script de verificación pre-despliegue
 * Verifica que todas las dependencias y configuraciones estén correctas
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verificando configuración del bot...\n');

let hasErrors = false;

// 1. Verificar package.json
console.log('📦 Verificando package.json...');
try {
    const pkg = require('../package.json');
    console.log(`✅ Versión: ${pkg.version}`);
    console.log(`✅ Node requerido: ${pkg.engines.node}`);
} catch (error) {
    console.error('❌ Error leyendo package.json:', error.message);
    hasErrors = true;
}

// 2. Verificar node_modules
console.log('\n📚 Verificando dependencias...');
if (fs.existsSync(path.join(__dirname, '../node_modules'))) {
    console.log('✅ node_modules encontrado');
} else {
    console.warn('⚠️ node_modules no encontrado. Ejecuta: npm install');
    hasErrors = true;
}

// 3. Verificar archivos necesarios
console.log('\n📄 Verificando archivos del proyecto...');
const requiredFiles = [
    'index.js',
    'Dockerfile',
    'render.yaml',
    '.env.example',
    'DESPLIEGUE.md',
    'README.md'
];

const rootDir = path.join(__dirname, '..');
requiredFiles.forEach(file => {
    if (fs.existsSync(path.join(rootDir, file))) {
        console.log(`✅ ${file}`);
    } else {
        console.error(`❌ Falta: ${file}`);
        hasErrors = true;
    }
});

// 4. Verificar módulos src/
console.log('\n🗂️ Verificando módulos en src/...');
const srcModules = [
    'src/config.js',
    'src/whatsapp.js',
    'src/google.js',
    'src/web.js',
    'src/logger.js',
    'src/calendarOps.js',
    'src/reminders.js'
];

srcModules.forEach(file => {
    if (fs.existsSync(path.join(rootDir, file))) {
        console.log(`✅ ${file}`);
    } else {
        console.error(`❌ Falta: ${file}`);
        hasErrors = true;
    }
});

// 5. Verificar credenciales (opcionales localmente)
console.log('\n🔐 Verificando credenciales (opcional para local)...');
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
    console.log('✅ Archivo .env encontrado');
    
    const dotenv = require('dotenv');
    const config = dotenv.config({ path: envPath }).parsed || {};
    
    if (config.CALENDAR_ID) {
        console.log(`✅ CALENDAR_ID configurado: ${config.CALENDAR_ID}`);
    } else {
        console.warn('⚠️ CALENDAR_ID no configurado en .env');
    }
    
    if (config.GOOGLE_OAUTH_CLIENT || config.GOOGLE_CREDENTIALS) {
        console.log('✅ Credenciales de Google configuradas');
    } else if (fs.existsSync(path.join(rootDir, 'credentials.json'))) {
        console.log('✅ credentials.json encontrado');
    } else {
        console.warn('⚠️ No se encontraron credenciales de Google');
        console.warn('   Para despliegue, configura GOOGLE_OAUTH_CLIENT o GOOGLE_CREDENTIALS');
    }
} else {
    console.warn('⚠️ Archivo .env no encontrado (opcional para local)');
    console.warn('   Copia .env.example a .env y configura tus valores');
}

// 6. Verificar que no hay archivos sensibles que se subirían a git
console.log('\n🔒 Verificando .gitignore...');
const gitignorePath = path.join(rootDir, '.gitignore');
if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    const sensitiveFiles = ['credentials.json', 'token.json', '.env', 'auth_info_baileys'];
    
    sensitiveFiles.forEach(file => {
        if (gitignore.includes(file)) {
            console.log(`✅ ${file} está en .gitignore`);
        } else {
            console.warn(`⚠️ ${file} NO está en .gitignore`);
        }
    });
} else {
    console.error('❌ .gitignore no encontrado');
    hasErrors = true;
}

// Resultado final
console.log('\n' + '='.repeat(50));
if (hasErrors) {
    console.log('❌ Hay errores que deben corregirse antes del despliegue');
    process.exit(1);
} else {
    console.log('✅ ¡Todo listo para desplegar!');
    console.log('\n📖 Lee DESPLIEGUE.md para instrucciones completas');
    console.log('🚀 Para desplegar en Render: sube el código a GitHub y sigue la guía');
    process.exit(0);
}
