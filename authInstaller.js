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

const CURRENT_VERSION = require(path.join(__dirname, 'package.json')).version;

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
            let btnI18n = 'btn_connect';

            if (isCompletelyDisabled) {
                btnText = 'Заблокировано';
                btnI18n = 'btn_blocked';
            } else if (p.isAuth) {
                btnText = 'Управление';
                btnI18n = 'btn_manage';
            }

            let statusText = 'Ожидает авторизации';
            let statusI18n = 'status_wait';

            if (isCompletelyDisabled) {
                statusText = 'Отключено';
                statusI18n = 'status_disabled';
            } else if (p.isAuth) {
                statusText = 'Доступ разрешен';
                statusI18n = 'status_allowed';
            }

            return `
 <div class="card ${isCompletelyDisabled ? 'disabled' : ''} ${activeClass}">
 <div class="card-header">
 <div class="card-icon">${p.logo}</div>
 <h3 class="card-title">${p.name}</h3>
 </div>
 <div class="badge-container" style="--pulse-color: ${p.isAuth && !isCompletelyDisabled ? '16,185,129' : '239,68,68'}">
 <div class="pulse-dot ${p.isAuth && !isCompletelyDisabled ? 'auth' : 'no-auth'}"></div>
 <span class="status-text" data-i18n="${statusI18n}">${statusText}</span>
 </div>
 <button class="btn ${p.isAuth ? 'btn-secondary' : ''}" onclick="openModal('${p.id}')" ${isCompletelyDisabled ? 'disabled' : ''} data-i18n="${btnI18n}">
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
            html = html.replace('{{APP_VERSION}}', CURRENT_VERSION);

            res.type('text/html').send(html);
        });

        // 1. Проверка наличия обновлений на GitHub
        let updateCache = null;
        let lastUpdateCheck = 0;
        const CACHE_TTL = 5 * 60 * 1000;

        app.get('/api/check-update', async (req, res) => {
            const now = Date.now();
            if (updateCache && (now - lastUpdateCheck < CACHE_TTL)) {
                return res.json(updateCache);
            }

            try {
                const response = await axios.get('https://raw.githubusercontent.com/GrishaDeLumiere/golem-gateway/main/package.json');
                const latestVersion = response.data.version;

                let changelogHtml = "<div style='color: var(--text-muted); font-size: 13px;' data-i18n='upd_no_data'>Нет данных об изменениях.</div>";

                try {
                    const commitsRes = await axios.get('https://api.github.com/repos/GrishaDeLumiere/golem-gateway/commits?per_page=10', {
                        headers: { 'User-Agent': 'Golem-Gateway-App' }
                    });

                    if (commitsRes.data && commitsRes.data.length > 0) {
                        changelogHtml = "";
                        commitsRes.data.forEach(item => {
                            const fullMsg = item.commit.message.trim();
                            if (!fullMsg.startsWith('Merge branch') && !fullMsg.startsWith('Merge pull request')) {
                                const parts = fullMsg.split('\n');
                                const escapeHtml = (text) => text.replace(/</g, '<').replace(/>/g, '>');

                                const title = escapeHtml(parts[0]);
                                const details = parts.slice(1).map(escapeHtml).join('<br>').trim();

                                changelogHtml += `<div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed rgba(255,255,255,0.05);">`;
                                changelogHtml += `<div style="color: #fff; font-weight: 500; font-size: 14px; margin-bottom: 4px; display: flex; gap: 8px;"><span style="color: var(--accent);">⚡</span> ${title}</div>`;

                                if (details) {
                                    changelogHtml += `<div style="color: #a1a1aa; font-size: 12px; padding-left: 10px; border-left: 2px solid rgba(255,255,255,0.1); margin-top: 6px; line-height: 1.5; font-family: monospace;">${details}</div>`;
                                }

                                changelogHtml += `</div>`;
                            }
                        });
                    }
                } catch (e) {
                    const errorMsg = e.response?.status === 403 ? 'Лимит запросов исчерпан (Rate Limit 60/час)' : e.message;
                    console.log(`[Апдейтер] Не удалось загрузить историю коммитов: ${errorMsg}`);
                }
                updateCache = {
                    updateAvailable: latestVersion !== CURRENT_VERSION,
                    currentVersion: CURRENT_VERSION,
                    latestVersion: latestVersion,
                    changelog: changelogHtml
                };
                lastUpdateCheck = now;

                res.json(updateCache);
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

            runUpdateStream(res);
        });

    }

}

module.exports = AuthInstaller;