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
    'temp_update',
    '.git'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runUpdateStream(res) {
    const sendLog = (msg, type = 'info') => {
        res.write(`data: ${JSON.stringify({ message: msg, type })}\n\n`);
    };

    try {
        await sleep(600);
        sendLog('Соединение с серверами репозитория GitHub...', 'info');

        await sleep(800);
        sendLog('Запрос на получение архива release/main отправлен.', 'success');

        const response = await axios({
            url: REPO_ZIP_URL,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        const mb = (response.data.byteLength / 1024 / 1024).toFixed(2);
        await sleep(400);
        sendLog(`Ядро загружено в память (${mb} MB).`, 'success');

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
        const zipPath = path.join(TEMP_DIR, 'update.zip');
        fs.writeFileSync(zipPath, response.data);

        await sleep(800);
        sendLog('Распаковка файлов в буферную директорию...', 'warn');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(TEMP_DIR, true);

        await sleep(600);
        sendLog('Распаковка буфера завершена.', 'success');

        const newFilesDir = path.join(TEMP_DIR, EXTRACTED_FOLDER_NAME);

        await sleep(800);
        sendLog('Синхронизация файлов: удаление старых и запись новых блоков...', 'warn');
        syncDirectories(newFilesDir, __dirname);

        await sleep(1000);
        sendLog('Мутация файловой системы ядра прошла успешно.', 'success');

        await sleep(600);
        sendLog('Очистка временных файлов...', 'info');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });

        await sleep(400);
        sendLog('ОБНОВЛЕНИЕ СИСТЕМЫ ЗАВЕРШЕНО!', 'success');
        sendLog('Процесс шлюза будет принудительно остановлен через 3 сек. для применения изменений.', 'error');

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

        setTimeout(() => {
            process.exit(0);
        }, 3000);

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