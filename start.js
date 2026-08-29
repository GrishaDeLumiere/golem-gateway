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
const geminiProvider = require('./providers/gemini');
const geminiApiProvider = require('./providers/gemini-interaction');

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
geminiApiProvider.setupRoutes(app, PORT);

// Вспомогательная функция: формирует честный OpenAI-список с префиксами в поле "id"
function extractModels(providerInstance, providerName, prefix) {
    if (!providerInstance || !providerInstance.MODELS) return [];
    try {
        const rawList = Array.from(providerInstance.MODELS || []);
        return rawList.map(m => {
            const rawModelId = typeof m === 'string' ? m : (m.id || m.name || '');
            const cleanId = rawModelId.replace(/^models\//, '');
            const fullPrefixedId = `${prefix}/${cleanId}`;

            return {
                id: fullPrefixedId,
                raw_id: cleanId,
                object: "model",
                owned_by: prefix,
                provider: providerName,
                prefixId: fullPrefixedId
            };
        }).filter(m => m.raw_id !== '');
    } catch (e) {
        console.error(`[⚠️ Каталог моделей] Ошибка провайдера ${providerName}:`, e.message);
        return [];
    }
}

app.get(['/v1', '/v1/models', '/api/models-catalog'], (req, res) => {
    const currentSettings = getSettings();
    let models = [];

    try {
        if (currentSettings.providers.deepseek) {
            models.push(...extractModels(deepseekProvider, 'DeepSeek', 'deepseek'));
        }
        if (currentSettings.providers.qwen) {
            models.push(...extractModels(qwenProvider, 'Qwen Studio', 'qwen'));
        }
        if (currentSettings.providers.gemini) {
            models.push(...extractModels(geminiProvider, 'Gemini CLI', 'gemini-cli'));
        }
        if (currentSettings.providers.gemini_api) {
            models.push(...extractModels(geminiApiProvider, 'Gemini Official API', 'gemini-api'));
        }

        res.json({ object: "list", data: models });
    } catch (err) {
        console.error('[❌ Каталог моделей] Критический сбой:', err.message);
        res.status(500).json({ error: { message: err.message }, data: [] });
    }
});

app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const currentSettings = getSettings();
    let rawModel = req.body.model || currentSettings.defaultModel;
    let targetModel = rawModel;
    let forceProvider = null;

    // === СИСТЕМА ПРЕФИКСОВ МАРШРУТИЗАЦИИ ===
    if (rawModel.startsWith('gemini-cli/') || rawModel.startsWith('cli/')) {
        forceProvider = 'gemini';
        targetModel = rawModel.replace(/^(gemini-cli|cli)\//, '');
    } else if (rawModel.startsWith('gemini-api/') || rawModel.startsWith('api/') || rawModel.startsWith('official/')) {
        forceProvider = 'gemini_api';
        targetModel = rawModel.replace(/^(gemini-api|api|official)\//, '');
    } else if (rawModel.startsWith('deepseek/')) {
        forceProvider = 'deepseek';
        targetModel = rawModel.replace(/^deepseek\//, '');
    } else if (rawModel.startsWith('qwen/')) {
        forceProvider = 'qwen';
        targetModel = rawModel.replace(/^qwen\//, '');
    }

    req.body.model = targetModel;

    console.log(`\n[📥 РОУТЕР] Запрос: "${rawModel}" → [Модель: ${targetModel} | Провайдер: ${forceProvider || 'Авто-детект'}]`);
    if (currentSettings.debugMode) {
        console.log(`[🐛 DEBUG] Stream: ${!!req.body.stream} | Промпт передан провайдеру.`);
    }

    try {
        // 1. Если был указан явный префикс
        if (forceProvider === 'gemini_api' && currentSettings.providers.gemini_api) {
            await geminiApiProvider.handleChatCompletion(req, res);
        } else if (forceProvider === 'gemini' && currentSettings.providers.gemini) {
            await geminiProvider.handleChatCompletion(req, res);
        } else if (forceProvider === 'deepseek' && currentSettings.providers.deepseek) {
            await deepseekProvider.handleChatCompletion(req, res);
        } else if (forceProvider === 'qwen' && currentSettings.providers.qwen) {
            await qwenProvider.handleChatCompletion(req, res);
        }
        // 2. Дефолтный авто-роутинг (без префикса)
        else if (targetModel.startsWith('deepseek') && currentSettings.providers.deepseek) {
            await deepseekProvider.handleChatCompletion(req, res);
        } else if (targetModel.startsWith('qwen') && currentSettings.providers.qwen) {
            await qwenProvider.handleChatCompletion(req, res);
        } else if (targetModel.startsWith('gemini-3') && currentSettings.providers.gemini_api) {
            await geminiApiProvider.handleChatCompletion(req, res);
        } else if ((targetModel.startsWith('gemini') || targetModel.startsWith('learnlm')) && currentSettings.providers.gemini) {
            await geminiProvider.handleChatCompletion(req, res);
        } else {
            console.log(`[❌ РОУТЕР] Ошибка: Модель ${rawModel} отключена или не существует.`);
            res.status(403).json({ error: { message: `Модель ${rawModel} отключена в настройках или не найдена.` } });
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
    if (settings.providers.gemini_api) initPromises.push(geminiApiProvider.initProvider(PORT));

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