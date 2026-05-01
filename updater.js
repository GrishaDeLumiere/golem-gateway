const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const crypto = require('crypto');

const REPO_ZIP_URL = 'https://github.com/GrishaDeLumiere/golem-gateway/archive/refs/heads/main.zip';
const TEMP_DIR = path.join(__dirname, 'temp_update');
const EXTRACTED_FOLDER_NAME = 'golem-gateway-main';

const IGNORE_LIST =[
    '.env',
    'settings.json',
    'gemini_credentials.json',
    'deepseek_accounts.json',
    'qwen_accounts.json',
    'node_modules',
    'temp_update',
    '.git',
    '.gitignore'
];

function getFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function safeCopyFile(source, target) {
    if (!fs.existsSync(target)) {
        fs.copyFileSync(source, target);
        return;
    }

    const [sourceHash, targetHash] = await Promise.all([
        getFileHash(source),
        getFileHash(target)
    ]);

    if (sourceHash === targetHash) {
        return;
    }
    fs.copyFileSync(source, target);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runUpdateStream(res) {
    const sendLog = (msgKey, fallback, type = 'info', suffix = '') => {
        res.write(`data: ${JSON.stringify({ msgKey, fallback, type, suffix })}\n\n`);
    };

    try {
        await sleep(600);
        sendLog('log_connect', 'Соединение с серверами репозитория GitHub...', 'info');

        await sleep(800);
        sendLog('log_req', 'Запрос на получение архива release/main отправлен.', 'success');

        const response = await axios({
            url: REPO_ZIP_URL,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        const mb = (response.data.byteLength / 1024 / 1024).toFixed(2);
        await sleep(400);
        sendLog('log_download', 'Ядро загружено в память', 'success', `(${mb} MB).`);

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
        const zipPath = path.join(TEMP_DIR, 'update.zip');
        fs.writeFileSync(zipPath, response.data);

        await sleep(800);
        sendLog('log_extract', 'Распаковка файлов в буферную директорию...', 'warn');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(TEMP_DIR, true);

        await sleep(600);
        sendLog('log_extract_done', 'Распаковка буфера завершена.', 'success');

        const newFilesDir = path.join(TEMP_DIR, EXTRACTED_FOLDER_NAME);

        await sleep(800);
        sendLog('log_sync', 'Синхронизация файлов (умное копирование по хэшу)...', 'warn');
        await syncDirectories(newFilesDir, __dirname);

        await sleep(1000);
        sendLog('log_mutate', 'Мутация файловой системы ядра прошла успешно.', 'success');

        await sleep(600);
        sendLog('log_clean', 'Очистка временных файлов...', 'info');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });

        await sleep(400);
        sendLog('log_finish', 'ОБНОВЛЕНИЕ СИСТЕМЫ ЗАВЕРШЕНО!', 'success');
        sendLog('log_restart', 'Процесс шлюза будет принудительно остановлен через 3 сек. для применения изменений.', 'error');

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

async function syncDirectories(source, target) {
    if (!fs.existsSync(target)) fs.mkdirSync(target);

    const targetItems = fs.readdirSync(target);
    for (const item of targetItems) {
        if (IGNORE_LIST.includes(item)) continue;

        const targetPath = path.join(target, item);
        const sourcePath = path.join(source, item);

        if (!fs.existsSync(sourcePath)) {
            fs.rmSync(targetPath, { recursive: true, force: true });
        }
    }
    const sourceItems = fs.readdirSync(source);
    for (const item of sourceItems) {
        if (IGNORE_LIST.includes(item)) continue;

        const sourcePath = path.join(source, item);
        const targetPath = path.join(target, item);

        if (fs.lstatSync(sourcePath).isDirectory()) {
            await syncDirectories(sourcePath, targetPath);
        } else {
            await safeCopyFile(sourcePath, targetPath);
        }
    }
}

module.exports = { runUpdateStream };