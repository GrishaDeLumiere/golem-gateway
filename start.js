// start.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Импортируем наших провайдеров
const deepseekProvider = require('./providers/deepseek');
// const chatgptProvider = require('./providers/chatgpt');

const app = express();
const PORT = 7777;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. Инициализация специфичных роутов провайдеров (например, перехват токена)
deepseekProvider.setupRoutes(app, PORT);
// chatgptProvider.setupRoutes(app, PORT);

// ==========================================
// 2. УНИВЕРСАЛЬНЫЕ ЭНДПОИНТЫ API
// ==========================================
app.get(['/', '/v1', '/v1/models'], (req, res) => {
    const models = [
        ...deepseekProvider.MODELS,
        // ...chatgptProvider.MODELS
    ];
    res.json({ object: "list", data: models });
});

app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const requestedModel = req.body.model || "deepseek-fast";
    console.log(`\n[📥 РОУТЕР] Поступил запрос на модель: ${requestedModel}`);

    try {
        if (requestedModel.startsWith('deepseek')) {
            await deepseekProvider.handleChatCompletion(req, res);
        }
        else if (requestedModel.startsWith('gpt')) {
            res.status(501).json({ error: { message: "Провайдер ChatGPT еще в разработке." } });
        }
        else {
            res.status(404).json({ error: { message: `Модель ${requestedModel} не найдена в системных реестрах.` } });
        }
    } catch (err) {
        console.error('[❌ РОУТЕР] Ошибка перенаправления:', err.stack);
        if (!res.headersSent) res.status(500).json({ error: { message: err.message, type: "server_error" } });
    }
});

// ==========================================
// ЗАПУСК ЯДРА
// ==========================================
app.listen(PORT, async () => {
    console.log(`===============================================`);
    console.log(`[🚀] МОДУЛЬНОЕ ЯДРО СТАРТОВАЛО. Порт: ${PORT}`);
    console.log(`[⚙️] Поднимаю провайдеров из теней...`);

    // ПЕРЕДАЕМ ПОРТ ДЛЯ АВТОРИЗАЦИИ
    await deepseekProvider.initProvider(PORT);

    console.log(`[✨] Сцена окончательно готова. Жду указаний, госпожа.`);
    console.log(`===============================================`);
});
