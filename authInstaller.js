const fs = require('fs');
const path = require('path');
const express = require('express');
const getProviders = require('./providers/index');
const { getSettings, saveSettings } = require('./settings');
const deepseekProvider = require('./providers/deepseek');
const qwenProvider = require('./providers/qwen');
const geminiProvider = require('./providers/gemini');
const axios = require('axios');
const { runUpdateStream } = require('./updater');

const CURRENT_VERSION = require(path.join(__dirname, 'package.json')).version;

class AuthInstaller {
    constructor(port) {
        this.port = port;
        this.settingsQueue = Promise.resolve();
    }

    setup(app) {
        const publicPath = path.join(__dirname, 'public');
        const viewsPath = path.join(__dirname, 'views');
        const loadPartial = (filePath) => {
            try {
                return fs.readFileSync(path.join(viewsPath, 'partials', filePath), 'utf8');
            } catch (e) {
                console.error(`[Сборка HTML] Не найден файл: ${filePath}`);
                return '';
            }
        };

        app.use(express.static(publicPath));

        // API Настроек
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

        // API Состояния UI
        app.get('/api/ui-state', (req, res) => {
            const settings = getSettings();
            const ObjectProviders = getProviders(this.port);
            const providersMap = ObjectProviders.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
            res.json({ settings, providersMap });
        });

        // Главная страница
        app.get(['/', '/dashboard', '/install-auth', '/install-auth-qwen'], (req, res) => {
            const ObjectProviders = getProviders(this.port);
            const providersMap = ObjectProviders.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

            // 1. Читаем главный скелет
            let html = fs.readFileSync(path.join(viewsPath, 'dashboard.html'), 'utf8');

            // 2. Вклеиваем компоненты
            html = html.replace('<!-- INCLUDE_NAVBAR -->', loadPartial('navbar.html'));
            html = html.replace('<!-- INCLUDE_FOOTER -->', loadPartial('footer.html'));

            // 3. Вклеиваем модалки
            html = html.replace('<!-- INCLUDE_MODAL_AUTH -->', loadPartial('modals/auth.html'));
            html = html.replace('<!-- INCLUDE_MODAL_SETTINGS -->', loadPartial('modals/settings.html'));
            html = html.replace('<!-- INCLUDE_MODAL_GEMINI -->', loadPartial('modals/gemini.html'));
            html = html.replace('<!-- INCLUDE_MODAL_GENERIC -->', loadPartial('modals/generic.html'));
            html = html.replace('<!-- INCLUDE_MODAL_UPDATE -->', loadPartial('modals/update.html'));

            // 4. Подставляем переменные
            html = html.replace("'__PROVIDERS_JSON__'", JSON.stringify(providersMap));
            html = html.replace(/{{APP_VERSION}}/g, CURRENT_VERSION);

            res.type('text/html').send(html);
        });

        // Обновления (GitHub)
        let updateCache = null;
        let lastUpdateCheck = 0;
        const CACHE_TTL = 5 * 60 * 1000;

        // --- МИНИ-ПАРСЕР MARKDOWN ---
        function formatMarkdownToHtml(md) {
            if (!md) return "Без описания";
            let html = md.replace(/</g, '<').replace(/>/g, '>');
            html = html.replace(/^### (.*$)/gim, '<div style="font-weight: 600; color: var(--text); margin: 16px 0 8px; display: flex; align-items: center; gap: 8px;"><span style="width: 4px; height: 14px; background: var(--accent); border-radius: 2px;"></span>$1</div>');
            html = html.replace(/^## (.*$)/gim, '<div style="font-weight: 600; font-size: 14px; color: var(--text); margin: 18px 0 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">$1</div>');
            html = html.replace(/^# (.*$)/gim, '<div style="font-weight: bold; font-size: 16px; color: var(--accent); margin: 20px 0 12px;">$1</div>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--text); font-weight: 600;">$1</strong>');
            html = html.replace(/\*(.*?)\*/g, '<em style="color: var(--text-muted);">$1</em>');
            html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 6px; font-family: \'Consolas\', monospace; font-size: 12px; color: #a6e22e; box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);">$1</code>');
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #60a5fa; text-decoration: none; border-bottom: 1px dashed rgba(96, 165, 250, 0.4); padding-bottom: 1px; transition: all 0.2s;">$1</a>');
            html = html.replace(/^\s*[-*]\s+(.*)$/gim, '<div style="display: flex; gap: 8px; margin-bottom: 6px; padding-left: 4px;"><span style="color: var(--accent); font-size: 14px; line-height: 1.4;">•</span><span style="color: var(--text-muted); line-height: 1.5;">$1</span></div>');
            html = html.split('\n').filter(line => line.trim() !== '').map(line => {
                if (line.match(/^<div/)) return line;
                return `<div style="margin-bottom: 8px; color: var(--text-muted); line-height: 1.5;">${line}</div>`;
            }).join('');

            return html;
        }

        app.get('/api/check-update', async (req, res) => {
            const currentSettings = getSettings();
            const now = Date.now();
            if (updateCache && (now - lastUpdateCheck < CACHE_TTL)) {
                return res.json(updateCache);
            }

            try {

                const response = await axios.get('https://raw.githubusercontent.com/GrishaDeLumiere/golem-gateway/main/package.json', {
                    timeout: 5000
                });

                if (!response.data || typeof response.data !== 'object' || !response.data.version) {
                    throw new Error("GitHub вернул битый ответ или лимит запросов (не JSON).");
                }

                const latestVersion = response.data.version;
                let changelogHtml = "<div style='color: var(--text-muted); font-size: 13px;' data-i18n='upd_no_data'>Нет данных об изменениях.</div>";
                let releasesHtml = "<div style='color: var(--text-muted); font-size: 13px;' data-i18n='upd_no_data'>Нет данных о релизах.</div>";

                try {
                    const reqOpts = {
                        headers: { 'User-Agent': 'Golem-Gateway-App' },
                        timeout: 5000
                    };

                    if (currentSettings.githubToken && currentSettings.githubToken.trim() !== '') {
                        reqOpts.headers['Authorization'] = `token ${currentSettings.githubToken.trim()}`;
                    }

                    const [commitsRes, releasesRes] = await Promise.all([
                        axios.get('https://api.github.com/repos/GrishaDeLumiere/golem-gateway/commits?per_page=10', reqOpts).catch(err => {
                            console.warn(`[⚠️ Апдейтер] Не смог загрузить коммиты (лимит GitHub?): ${err.message}`);
                            return { data: [] };
                        }),
                        axios.get('https://api.github.com/repos/GrishaDeLumiere/golem-gateway/releases?per_page=5', reqOpts).catch(err => {
                            console.warn(`[⚠️ Апдейтер] Не смог загрузить релизы (лимит GitHub?): ${err.message}`);
                            return { data: [] };
                        })
                    ]);

                    // === КОММИТЫ (КАРТОЧКИ) ===
                    if (commitsRes.data && commitsRes.data.length > 0) {
                        changelogHtml = "";
                        commitsRes.data.forEach(item => {
                            const fullMsg = item.commit.message.trim();
                            if (!fullMsg.startsWith('Merge branch') && !fullMsg.startsWith('Merge pull request')) {
                                const parts = fullMsg.split('\n');
                                const escapeHtml = (text) => text.replace(/</g, '<').replace(/>/g, '>');
                                const title = escapeHtml(parts[0]);
                                const details = parts.slice(1).map(escapeHtml).join('<br>').trim();

                                changelogHtml += `<div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 14px; margin-bottom: 12px; transition: all 0.2s;">`;
                                changelogHtml += `<div style="color: var(--text); font-weight: 500; font-size: 14px; display: flex; align-items: flex-start; gap: 10px;">`;
                                changelogHtml += `<div style="display: flex; align-items: center; justify-content: center; background: rgba(97, 92, 237, 0.15); color: var(--accent); width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0;">⚡</div>`;
                                changelogHtml += `<div style="line-height: 1.4; padding-top: 2px;">${title}</div>`;
                                changelogHtml += `</div>`;

                                if (details) {
                                    changelogHtml += `<div style="color: var(--text-muted); font-size: 12px; margin-top: 12px; margin-left: 34px; padding: 10px 12px; background: rgba(0, 0, 0, 0.3); border-radius: 8px; font-family: 'Consolas', monospace; line-height: 1.5; border: 1px solid rgba(255, 255, 255, 0.03);">${details}</div>`;
                                }
                                changelogHtml += `</div>`;
                            }
                        });
                    }

                    // === РЕЛИЗЫ (АКЦЕНТНЫЕ КАРТОЧКИ) ===
                    if (releasesRes.data && releasesRes.data.length > 0) {
                        releasesHtml = "";
                        releasesRes.data.forEach(item => {
                            const title = item.name || item.tag_name;
                            const dateStr = new Date(item.published_at).toLocaleDateString();
                            const formattedBody = formatMarkdownToHtml(item.body);

                            releasesHtml += `<div style="background: rgba(16, 185, 129, 0.03); border: 1px solid rgba(16, 185, 129, 0.1); border-radius: 14px; padding: 18px; margin-bottom: 16px; position: relative;">`;

                            // Шапка релиза
                            releasesHtml += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 14px;">`;
                            releasesHtml += `<div style="color: var(--text); font-weight: 600; font-size: 15px; display: flex; gap: 10px; align-items: center;">`;
                            releasesHtml += `<div style="background: rgba(16, 185, 129, 0.15); color: var(--success); width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(16, 185, 129, 0.2);">📦</div>`;
                            releasesHtml += `<span>${title}</span>`;
                            releasesHtml += `</div>`;
                            releasesHtml += `<div style="color: var(--success); font-size: 12px; font-family: 'Consolas', monospace; background: rgba(16, 185, 129, 0.1); padding: 4px 10px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2);">${dateStr}</div>`;
                            releasesHtml += `</div>`;

                            // Тело релиза
                            releasesHtml += `<div style="font-size: 13px;">${formattedBody}</div>`;
                            releasesHtml += `</div>`;
                        });
                    }

                } catch (e) {
                    console.log(`[❌ Апдейтер] Сбой загрузки истории: ${e.message}`);
                }

                updateCache = {
                    updateAvailable: latestVersion !== CURRENT_VERSION,
                    currentVersion: CURRENT_VERSION,
                    latestVersion: latestVersion,
                    changelog: changelogHtml,
                    releases: releasesHtml
                };
                lastUpdateCheck = now;
                res.json(updateCache);
            } catch (err) {
                console.error('\n[❌ АПДЕЙТЕР] Полный отвал проверки версии:', err.message);
                res.status(500).json({ error: 'Не удалось проверить обновления', details: err.message });
            }
        });

        app.get('/updater', (req, res) => { res.type('text/html').sendFile(path.join(viewsPath, 'updater.html')); });
        app.get('/api/update-stream', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            runUpdateStream(res);
        });
    }
}
module.exports = AuthInstaller;