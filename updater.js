// updater.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');

const REPO_ZIP_URL = 'https://github.com/GrishaDeLumiere/golem-gateway/archive/refs/heads/main.zip';
const TEMP_DIR = path.join(__dirname, 'temp_update');
const EXTRACTED_FOLDER_NAME = 'golem-gateway-main';

const IGNORE_LIST = [
    '.env',
    'settings.json',
    'gemini_credentials.json',
    'deepseek_accounts.json',
    'qwen_accounts.json',
    'node_modules',
    'temp_update'
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

        sendLog('[📥] Архив загружен (' + (response.data.byteLength / 1024 / 1024).toFixed(2) + ' MB)');

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
        const zipPath = path.join(TEMP_DIR, 'update.zip');
        fs.writeFileSync(zipPath, response.data);

        sendLog('[📦] Распаковка файлов в буферную зону...');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(TEMP_DIR, true);

        const newFilesDir = path.join(TEMP_DIR, EXTRACTED_FOLDER_NAME);

        sendLog('[🧹] Синхронизация файлов (удаление старых и запись новых)...');
        syncDirectories(newFilesDir, __dirname);

        sendLog('[🗑️] Зачистка временных файлов...');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });

        sendLog('[✅] ОБНОВЛЕНИЕ ЗАВЕРШЕНО!');
        sendLog('[⚠️] Процесс шлюза будет остановлен. Пожалуйста, запустите его заново.');

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

        setTimeout(() => {
            process.exit(0);
        }, 2000);

    } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
}

function syncDirectories(source, target) {
    if (!fs.existsSync(target)) fs.mkdirSync(target);

    const targetItems = fs.readdirSync(target);
    targetItems.forEach(item => {
        if (IGNORE_LIST.includes(item)) return;

        const targetPath = path.join(target, item);
        const sourcePath = path.join(source, item);

        if (!fs.existsSync(sourcePath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
    });

    const sourceItems = fs.readdirSync(source);
    sourceItems.forEach(item => {
        if (IGNORE_LIST.includes(item)) return;

        const sourcePath = path.join(source, item);
        const targetPath = path.join(target, item);

        if (fs.lstatSync(sourcePath).isDirectory()) {
            syncDirectories(sourcePath, targetPath);
        } else {
            fs.copyFileSync(sourcePath, targetPath);
        }
    });
}

module.exports = { runUpdateStream };