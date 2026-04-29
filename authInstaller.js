const fs = require('fs');
const path = require('path');
const express = require('express');
const getProviders = require('./providers/index');
const { getSettings, saveSettings } = require('./settings');
const deepseekProvider = require('./providers/deepseek');
const qwenProvider = require('./providers/qwen');
const geminiProvider = require('./providers/gemini');
const axios = require('axios');
const { spawn } = require('child_process');
const { runUpdateStream } = require('./updater');

class AuthInstaller {
    constructor(port) {
        this.port = port;
        this.settingsQueue = Promise.resolve();
    }

    getCardsHtml(providers, settings) {
        return providers.map(p => {
            const isDisabledByUser = settings.providers[p.id] === false;
            const isCompletelyDisabled = p.disabled || isDisabledByUser;
            const activeClass = (p.isAuth && !isCompletelyDisabled) ? 'active-card' : (isCompletelyDisabled ? '' : 'error-card');

            let btnText = 'Подключить аккаунт';
            if (isCompletelyDisabled) {
                btnText = 'Заблокировано';
            } else if (p.isAuth) {
                btnText = p.id === 'gemini' ? 'Управление' : 'Обновить сессию';
            }

            return `
 <div class="card ${isCompletelyDisabled ? 'disabled' : ''} ${activeClass}">
 <div class="card-header">
 <div class="card-icon">${p.logo}</div>
 <h3 class="card-title">${p.name}</h3>
 </div>
 <div class="badge-container" style="--pulse-color: ${p.isAuth && !isCompletelyDisabled ? '16,185,129' : '239,68,68'}">
 <div class="pulse-dot ${p.isAuth && !isCompletelyDisabled ? 'auth' : 'no-auth'}"></div>
 <span class="status-text">${isCompletelyDisabled ? 'Отключено' : (p.isAuth ? 'Доступ разрешен' : 'Ожидает авторизации')}</span>
 </div>
 <button class="btn ${p.isAuth ? 'btn-secondary' : ''}" onclick="openModal('${p.id}')" ${isCompletelyDisabled ? 'disabled' : ''}>
 ${btnText}
 </button>
 </div>
 `;
        }).join('');
    }

    setup(app) {
        const publicPath = path.join(__dirname, 'public');
        const viewsPath = path.join(__dirname, 'views');

        app.use(express.static(publicPath));

        app.get('/api/settings', (req, res) => res.json(getSettings()));

        app.post('/api/settings', async (req, res) => {
            this.settingsQueue = this.settingsQueue.then(async () => {
                const oldSettings = getSettings();
                const updated = saveSettings(req.body);

                try {
                    // Динамическая выгрузка/загрузка провайдеров из памяти
                    if (oldSettings.providers.deepseek !== updated.providers.deepseek) {
                        if (updated.providers.deepseek) await deepseekProvider.initProvider(this.port);
                        else await deepseekProvider.unloadProvider();
                    }

                    if (oldSettings.providers.qwen !== updated.providers.qwen) {
                        if (updated.providers.qwen) await qwenProvider.initProvider(this.port);
                        else await qwenProvider.unloadProvider();
                    }

                    if (oldSettings.providers.gemini !== updated.providers.gemini) {
                        if (updated.providers.gemini) await geminiProvider.initProvider(this.port);
                        else await geminiProvider.unloadProvider();
                    }
                } catch (err) {
                    console.error('[❌ Дашборд] Ошибка при переключении провайдеров:', err);
                }

                return updated;
            }).catch(err => {
                console.error('[❌ Дашборд] Сбой выполнения очереди настроек:', err);
                return getSettings();
            });

            const finalSettings = await this.settingsQueue;
            res.json({ success: true, settings: finalSettings });
        });

        // <-- НОВЫЙ ЭНДПОИНТ ДЛЯ REAL-TIME ОБНОВЛЕНИЯ ИНТЕРФЕЙСА
        app.get('/api/ui-state', (req, res) => {
            const settings = getSettings();
            const ObjectProviders = getProviders(this.port);
            const providersMap = ObjectProviders.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

            res.json({
                html: this.getCardsHtml(ObjectProviders, settings),
                providersMap: providersMap
            });
        });

        app.get('/dashboard.css', (req, res) => { res.type('text/css').sendFile(path.join(publicPath, 'dashboard.css')); });
        app.get('/dashboard.js', (req, res) => { res.type('application/javascript').sendFile(path.join(publicPath, 'dashboard.js')); });

        // --- РЕНДЕР HTML ---
        app.get(['/', '/dashboard', '/install-auth', '/install-auth-qwen'], (req, res) => {
            const settings = getSettings();
            const ObjectProviders = getProviders(this.port);
            const providersMap = ObjectProviders.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

            let html = fs.readFileSync(path.join(viewsPath, 'dashboard.html'), 'utf8');
            html = html.replace("'__PROVIDERS_JSON__'", JSON.stringify(providersMap));
            html = html.replace('<!-- __PROVIDERS_CARDS__ -->', this.getCardsHtml(ObjectProviders, settings));

            res.type('text/html').send(html);
        });


        const CURRENT_VERSION = require(path.join(__dirname, 'package.json')).version;

        // 1. Проверка наличия обновлений на GitHub
        app.get('/api/check-update', async (req, res) => {
            try {
                const response = await axios.get('https://raw.githubusercontent.com/GrishaDeLumiere/golem-gateway/main/package.json');
                const latestVersion = response.data.version;

                res.json({
                    updateAvailable: latestVersion !== CURRENT_VERSION,
                    currentVersion: CURRENT_VERSION,
                    latestVersion: latestVersion
                });
            } catch (err) {
                console.error('[Апдейтер] Ошибка проверки версии:', err.message);
                res.status(500).json({ error: 'Не удалось проверить обновления' });
            }
        });

        // 2. Отдача красивой HTML-страницы апдейтера
        app.get('/updater', (req, res) => {
            res.type('text/html').sendFile(path.join(viewsPath, 'updater.html'));
        });

        // 3. Стрим для логов обновления (SSE) и запуск процесса
        app.get('/api/update-stream', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Запускаем переписанный апдейтер
            runUpdateStream(res);
        });

    }
}

module.exports = AuthInstaller;