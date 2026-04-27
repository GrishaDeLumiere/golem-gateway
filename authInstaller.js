const fs = require('fs');
const path = require('path');
const express = require('express');
const getProviders = require('./providers');
const { getSettings, saveSettings } = require('./settings');
const deepseekProvider = require('./providers/deepseek');
const qwenProvider = require('./providers/qwen');

class AuthInstaller {
    constructor(port) {
        this.port = port;
    }

    getCardsHtml(providers, settings) {
        return providers.map(p => {
            const isDisabledByUser = settings.providers[p.id] === false;
            const isCompletelyDisabled = p.disabled || isDisabledByUser;
            const activeClass = (p.isAuth && !isCompletelyDisabled) ? 'active-card' : (isCompletelyDisabled ? '' : 'error-card');

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
 ${isCompletelyDisabled ? 'Заблокировано' : (p.isAuth ? 'Обновить сессию' : 'Подключить аккаунт')}
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

        app.post('/api/settings', (req, res) => {
            const oldSettings = getSettings();
            const updated = saveSettings(req.body);

            if (oldSettings.providers.deepseek !== updated.providers.deepseek) {
                if (updated.providers.deepseek) {
                    deepseekProvider.initProvider(this.port);
                } else {
                    deepseekProvider.unloadProvider();
                }
            }

            if (oldSettings.providers.qwen !== updated.providers.qwen) {
                if (updated.providers.qwen) {
                    qwenProvider.initProvider(this.port);
                } else {
                    qwenProvider.unloadProvider();
                }
            }

            res.json({ success: true, settings: updated });
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
    }
}

module.exports = AuthInstaller;