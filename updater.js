// updater.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');

// Ссылка на скачивание архива ветки main
const REPO_ZIP_URL = 'https://github.com/GrishaDeLumiere/golem-gateway/archive/refs/heads/main.zip';
const TEMP_DIR = path.join(__dirname, 'temp_update');
const EXTRACTED_FOLDER_NAME = 'golem-gateway-main';

// Файлы и папки, которые НЕЛЬЗЯ удалять или заменять
const IGNORE_LIST = [
    '.env',
    'settings.json',
    'gemini_credentials.json',
    'node_modules',
    'updater.js',
    'package-lock.json'
];

async function runUpdate() {
    console.log('[🔄 АПДЕЙТЕР] Ждем 5 секунд, чтобы сервер успел закрыться...');
    await new Promise(res => setTimeout(res, 5000));

    try {
        console.log('[🔄 АПДЕЙТЕР] Скачивание обновления с GitHub...');
        const response = await axios({
            url: REPO_ZIP_URL,
            method: 'GET',
            responseType: 'arraybuffer'
        });

        if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
        const zipPath = path.join(TEMP_DIR, 'update.zip');
        fs.writeFileSync(zipPath, response.data);

        console.log('[🔄 АПДЕЙТЕР] Распаковка архива...');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(TEMP_DIR, true);

        const newFilesDir = path.join(TEMP_DIR, EXTRACTED_FOLDER_NAME);

        console.log('[🔄 АПДЕЙТЕР] Замена файлов...');
        copyFolderRecursiveSync(newFilesDir, __dirname);

        console.log('[🔄 АПДЕЙТЕР] Удаление временных файлов...');
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });

        console.log('[🔄 АПДЕЙТЕР] Установка новых зависимостей (если есть)...');
        // Запускаем npm install на случай, если в package.json появились новые модули
        await runCommand('npm', ['install']);

        console.log('[✅ АПДЕЙТЕР] Обновление завершено! Запускаем ядро...');
        
        // Запускаем start.js в новом независимом окне/процессе
        const startCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const child = spawn(startCommand, ['start'], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();

        process.exit(0);
    } catch (err) {
        console.error('[❌ АПДЕЙТЕР] Ошибка при обновлении:', err);
        // В случае ошибки пытаемся поднять старый сервер
        spawn('node', ['start.js'], { detached: true, stdio: 'ignore' }).unref();
        process.exit(1);
    }
}

// Вспомогательная функция для копирования с заменой (и игнором)
function copyFolderRecursiveSync(source, target) {
    if (!fs.existsSync(target)) fs.mkdirSync(target);

    const files = fs.readdirSync(source);
    files.forEach(file => {
        if (IGNORE_LIST.includes(file)) return; // Пропускаем важные файлы

        const currentSource = path.join(source, file);
        const currentTarget = path.join(target, file);

        if (fs.lstatSync(currentSource).isDirectory()) {
            copyFolderRecursiveSync(currentSource, currentTarget);
        } else {
            fs.copyFileSync(currentSource, currentTarget);
        }
    });
}

function runCommand(command, args) {
    return new Promise((resolve) => {
        const cmd = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
        const processExec = spawn(cmd, args, { stdio: 'inherit' });
        processExec.on('close', resolve);
    });
}

runUpdate();