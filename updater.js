// updater.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');

const REPO_ZIP_URL = 'https://github.com/GrishaDeLumiere/golem-gateway/archive/refs/heads/main.zip';
const TEMP_DIR = path.join(__dirname, 'temp_update');
const EXTRACTED_FOLDER_NAME = 'golem-gateway-main';

const IGNORE_LIST = [
    '.env',
    'settings.json',
    'gemini_credentials.json',
    'node_modules'
];

async function runUpdateStream(res) {
    const sendLog = (msg) => res.write(`data: ${JSON.stringify({ message: msg })}\n\n`);

    try {
        sendLog('[🔄] Подключение к серверам GitHub...');
        
        const response = await axios({
            url: REPO_ZIP_URL,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        sendLog('[📥] Архив обновления успешно загружен (' + (response.data.byteLength / 1024 / 1024).toFixed(2) + ' MB)');

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
        const zipPath = path.join(TEMP_DIR, 'update.zip');
        fs.writeFileSync(zipPath, response.data);

        sendLog('[📦] Распаковка файлов в буферную зону...');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(TEMP_DIR, true);

        const newFilesDir = path.join(TEMP_DIR, EXTRACTED_FOLDER_NAME);

        sendLog('[⚙️] Перезапись файлов ядра...');
        copyFolderRecursiveSync(newFilesDir, __dirname);

        sendLog('[🧹] Зачистка временных файлов...');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });

        sendLog('[✅] ОБНОВЛЕНИЕ ЗАВЕРШЕНО! Поднимаем новое окно...');
        
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

        setTimeout(() => {
            if (process.platform === 'win32') {
                spawn('cmd.exe', ['/c', 'start', '""', 'start.bat'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            } else {
                spawn('npm', ['start'], { detached: true, stdio: 'ignore' }).unref();
            }
            process.exit(0);
        }, 2000);

    } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
}

function copyFolderRecursiveSync(source, target) {
    if (!fs.existsSync(target)) fs.mkdirSync(target);

    const files = fs.readdirSync(source);
    files.forEach(file => {
        if (IGNORE_LIST.includes(file)) return; 

        const currentSource = path.join(source, file);
        const currentTarget = path.join(target, file);

        if (fs.lstatSync(currentSource).isDirectory()) {
            copyFolderRecursiveSync(currentSource, currentTarget);
        } else {
            fs.copyFileSync(currentSource, currentTarget);
        }
    });
}

module.exports = { runUpdateStream };