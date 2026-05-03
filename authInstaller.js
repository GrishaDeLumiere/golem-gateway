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
            let html = md.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html = html.replace(/^### (.*$)/gim, '<div style="font-weight: 600; color: #fff; margin: 12px 0 6px;">$1</div>');
            html = html.replace(/^## (.*$)/gim, '<div style="font-weight: 600; font-size: 14px; color: #fff; margin: 14px 0 8px;">$1</div>');
            html = html.replace(/^# (.*$)/gim, '<div style="font-weight: bold; font-size: 15px; color: var(--accent); margin: 16px 0 10px;">$1</div>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #fff;">$1</strong>');
            html = html.replace(/\*(.*?)\*/g, '<em style="color: var(--text-muted);">$1</em>');
            html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px; color: #a6e22e;">$1</code>');
            html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #60a5fa; text-decoration: none;">$1</a>');
            html = html.replace(/^\s*[-*]\s+(.*)$/gim, '<div style="display: flex; gap: 6px; margin-bottom: 4px; padding-left: 8px;"><span style="color: var(--accent);">•</span><span>$1</span></div>');
            html = html.split('\n').filter(line => line.trim() !== '').map(line => {
                if (line.match(/^<div/)) return line; 
                return `<div style="margin-bottom: 6px;">${line}</div>`;
            }).join('');

            return html;
        }

        app.get('/api/check-update', async (req, res) => {
            const now = Date.now();
            if (updateCache && (now - lastUpdateCheck < CACHE_TTL)) {
                return res.json(updateCache);
            }

            try {
                const response = await axios.get('https://raw.githubusercontent.com/GrishaDeLumiere/golem-gateway/main/package.json');
                const latestVersion = response.data.version;
                let changelogHtml = "<div style='color: var(--text-muted); font-size: 13px;' data-i18n='upd_no_data'>Нет данных об изменениях.</div>";
                let releasesHtml = "<div style='color: var(--text-muted); font-size: 13px;' data-i18n='upd_no_data'>Нет данных о релизах.</div>";

                try {
                    const [commitsRes, releasesRes] = await Promise.all([
                        axios.get('https://api.github.com/repos/GrishaDeLumiere/golem-gateway/commits?per_page=10', { headers: { 'User-Agent': 'Golem-Gateway-App' } }).catch(() => ({ data: [] })),
                        axios.get('https://api.github.com/repos/GrishaDeLumiere/golem-gateway/releases?per_page=5', { headers: { 'User-Agent': 'Golem-Gateway-App' } }).catch(() => ({ data: [] }))
                    ]);

                    // Рендер коммитов
                    if (commitsRes.data && commitsRes.data.length > 0) {
                        changelogHtml = "";
                        commitsRes.data.forEach(item => {
                            const fullMsg = item.commit.message.trim();
                            if (!fullMsg.startsWith('Merge branch') && !fullMsg.startsWith('Merge pull request')) {
                                const parts = fullMsg.split('\n');
                                const escapeHtml = (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                const title = escapeHtml(parts[0]);
                                const details = parts.slice(1).map(escapeHtml).join('<br>').trim();

                                changelogHtml += `<div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed rgba(255,255,255,0.05);">`;
                                changelogHtml += `<div style="color: #fff; font-weight: 500; font-size: 14px; margin-bottom: 4px; display: flex; gap: 8px;"><span style="color: var(--accent);">⚡</span> ${title}</div>`;
                                if (details) changelogHtml += `<div style="color: #a1a1aa; font-size: 12px; padding-left: 10px; border-left: 2px solid rgba(255,255,255,0.1); margin-top: 6px; line-height: 1.5; font-family: monospace;">${details}</div>`;
                                changelogHtml += `</div>`;
                            }
                        });
                    }

                    // Рендер красивых Markdown релизов
                    if (releasesRes.data && releasesRes.data.length > 0) {
                        releasesHtml = "";
                        releasesRes.data.forEach(item => {
                            const title = item.name || item.tag_name;
                            const dateStr = new Date(item.published_at).toLocaleDateString();
                            const formattedBody = formatMarkdownToHtml(item.body);

                            releasesHtml += `<div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px dashed rgba(255,255,255,0.05);">`;
                            releasesHtml += `
 <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
 <div style="color: #fff; font-weight: 600; font-size: 14px; display: flex; gap: 8px; align-items: center;">
 <span style="color: #10b981;">📦</span> ${title}
 </div>
 <div style="color: var(--text-muted); font-size: 12px; font-family: monospace; background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 6px;">${dateStr}</div>
 </div>`;
                            releasesHtml += `<div style="color: #a1a1aa; font-size: 13px; line-height: 1.5;">${formattedBody}</div>`;
                            releasesHtml += `</div>`;
                        });
                    }

                } catch (e) {
                    console.log(`[Апдейтер] Сбой загрузки истории: ${e.message}`);
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
                res.status(500).json({ error: 'Не удалось проверить обновления' });
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