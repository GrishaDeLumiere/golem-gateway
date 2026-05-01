//start.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');

const { PORT } = require('./config');
const { getSettings } = require('./settings');
const { version: APP_VERSION } = require(path.join(__dirname, 'package.json'));

const AuthInstaller = require('./authInstaller');
const deepseekProvider = require('./providers/deepseek');
const qwenProvider = require('./providers/qwen');
const geminiProvider = require('./providers/gemini')

const app = express();
app.use(cors());
app.use(express.json({ limit: '200mb' }));

// --- ЗАЩИТА API (РУБИЛЬНИК + СОХРАНЕНИЕ КЛЮЧЕЙ) ---
app.use(['/v1', '/chat/completions', '/models'], (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    const currentSettings = getSettings();

    if (currentSettings.enableApiKeys) {
        const masterKey = currentSettings.masterApiKey || "";
        const apiKeys = currentSettings.apiKeys || [];

        const authHeader = req.headers.authorization || "";
        const providedKey = authHeader.replace(/^Bearer\s+/i, '').trim();

        let isValid = false;

        if (masterKey.trim() !== "" && providedKey === masterKey.trim()) {
            isValid = true;
        } else if (apiKeys.some(k => k.key === providedKey)) {
            isValid = true;
        }

        if (!isValid) {
            console.log(`[❌ ЗАЩИТА] Отказано в доступе (IP: ${req.ip}). Неверный API ключ.`);
            if (currentSettings.debugMode) {
                console.log(`[🐛 DEBUG] Указан ключ: "${providedKey}"`);
            }
            return res.status(401).json({
                error: { message: "Invalid API Key. Доступ запрещен. Укажите правильный ключ." }
            });
        }
    }
    next();
});
// -----------------------------------

const dashboard = new AuthInstaller(PORT);
dashboard.setup(app);

const settings = getSettings();
deepseekProvider.setupRoutes(app, PORT);
qwenProvider.setupRoutes(app, PORT);
geminiProvider.setupRoutes(app, PORT);

app.get(['/v1', '/v1/models'], (req, res) => {
    const currentSettings = getSettings();
    let models = [];
    if (currentSettings.providers.deepseek) models.push(...deepseekProvider.MODELS);
    if (currentSettings.providers.qwen) models.push(...qwenProvider.MODELS);
    if (currentSettings.providers.gemini) models.push(...geminiProvider.MODELS);
    res.json({ object: "list", data: models });
});

app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const currentSettings = getSettings();
    const requestedModel = req.body.model || currentSettings.defaultModel;

    console.log(`\n[📥 РОУТЕР] Поступил запрос на модель: ${requestedModel}`);
    if (currentSettings.debugMode) {
        console.log(`[🐛 DEBUG] Stream: ${!!req.body.stream} | Промпт передан провайдеру.`);
    }

    try {
        if (requestedModel.startsWith('deepseek') && currentSettings.providers.deepseek) {
            await deepseekProvider.handleChatCompletion(req, res);
        } else if (requestedModel.startsWith('qwen') && currentSettings.providers.qwen) {
            await qwenProvider.handleChatCompletion(req, res);
        } else if ((requestedModel.startsWith('gemini') || requestedModel.startsWith('learnlm')) && currentSettings.providers.gemini) {
            await geminiProvider.handleChatCompletion(req, res);
        } else {
            console.log(`[❌ РОУТЕР] Ошибка: Модель ${requestedModel} отключена или не существует.`);
            res.status(403).json({ error: { message: `Модель ${requestedModel} отключена в настройках или не найдена.` } });
        }
    } catch (err) {
        console.error('[❌ РОУТЕР] Ошибка перенаправления:', err.message);
        if (currentSettings.debugMode) console.error(err.stack);

        if (!res.headersSent) res.status(500).json({ error: { message: err.message, type: "server_error" } });
    }
});

// ЗАПУСК ЯДРА
app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`[🚀] МОДУЛЬНОЕ ЯДРО СТАРТОВАЛО (v${APP_VERSION}). Порт: ${PORT}`);
    console.log(`[🔗] Дашборд управления доступен по адресу: http://127.0.0.1:${PORT}`);
    openInDefaultBrowser(`http://127.0.0.1:${PORT}`);

    console.log(`[⚙️] Поднимаю активных провайдеров из теней...`);

    const initPromises = [];
    if (settings.providers.deepseek) initPromises.push(deepseekProvider.initProvider(PORT));
    if (settings.providers.qwen) initPromises.push(qwenProvider.initProvider(PORT));
    if (settings.providers.gemini) initPromises.push(geminiProvider.initProvider(PORT));

    if (initPromises.length > 0) {
        await Promise.all(initPromises);
    } else {
        console.log(`[⚠️] Все провайдеры отключены в настройках!`);
    }

    console.log(`[✨] Сцена окончательно готова. Жду указаний.`);
    console.log(`===============================================`);
});

function openInDefaultBrowser(url) {
    const platform = process.platform;
    if (platform === 'win32') exec(`start "" "${url}"`);
    else if (platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
}