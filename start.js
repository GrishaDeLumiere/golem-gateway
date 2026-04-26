// start.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Подключаем конфиг
const { PORT } = require('./config');

// Импортируем наших провайдеров
const deepseekProvider = require('./providers/deepseek');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 1. Инициализация специфичных роутов провайдеров
deepseekProvider.setupRoutes(app, PORT);

// ==========================================
// 2. УНИВЕРСАЛЬНЫЕ ЭНДПОИНТЫ API
// ==========================================
app.get(['/', '/v1', '/v1/models'], (req, res) => {
    const models = [...deepseekProvider.MODELS];
    res.json({ object: "list", data: models });
});

app.post(['/v1/chat/completions', '/chat/completions'], async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const requestedModel = req.body.model || "deepseek-v4-flash";
    console.log(`\n[📥 РОУТЕР] Поступил запрос на модель: ${requestedModel}`);

    try {
        if (requestedModel.startsWith('deepseek')) {
            await deepseekProvider.handleChatCompletion(req, res);
        } else {
            res.status(404).json({ error: { message: `Модель ${requestedModel} не найдена.` } });
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

    await deepseekProvider.initProvider(PORT);

    console.log(`[✨] Сцена окончательно готова. Жду указаний, госпожа.`);
    console.log(`===============================================`);
});
