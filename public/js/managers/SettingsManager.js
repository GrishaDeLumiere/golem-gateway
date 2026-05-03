export class SettingsManager {
    constructor(modalManager) {
        this.modalManager = modalManager;
        this.apiKeys = [];
    }

    async open() {
        try {
            const res = await fetch('/api/settings');
            const settings = await res.json();

            document.getElementById('set-deepseek').checked = settings.providers.deepseek;
            document.getElementById('set-qwen').checked = settings.providers.qwen;
            document.getElementById('set-debug').checked = settings.debugMode;
            document.getElementById('set-gemini').checked = settings.providers.gemini;
            document.getElementById('set-default-model').value = settings.defaultModel || 'deepseek-v4-flash';
            document.getElementById('set-api-key').value = settings.masterApiKey || '';
            document.getElementById('set-language').value = settings.language || 'ru_RU';

            if (settings.particles) {
                document.getElementById('set-particles-enabled').checked = settings.particles.enabled;
                document.getElementById('set-particles-count').value = settings.particles.count;
                document.getElementById('label-p-count').innerText = settings.particles.count;
                document.getElementById('set-particles-speed').value = settings.particles.speed;
                document.getElementById('label-p-speed').innerText = settings.particles.speed;
                document.getElementById('set-particles-size').value = settings.particles.maxSize;
                document.getElementById('label-p-size').innerText = settings.particles.maxSize;
                document.getElementById('set-particles-lines').checked = settings.particles.connectLines;
                document.getElementById('set-particles-dist').value = settings.particles.lineDistance;
                document.getElementById('label-p-dist').innerText = settings.particles.lineDistance;
                document.getElementById('set-particles-comets').checked = settings.particles.comets;
            }

            document.getElementById('set-enable-auth').checked = settings.enableApiKeys || false;
            this.toggleAuthFields();

            this.apiKeys = settings.apiKeys || [];
            this.renderApiKeys();
            this.hideNewKeyInput();

            document.getElementById('settingsModal').classList.add('active');
        } catch (err) {
            alert(window.t('settings_load_error', 'Не удалось загрузить настройки с сервера.'));
        }
    }

    async save() {
        const btn = document.getElementById('saveSetBtn');
        btn.innerText = window.t('settings_applying', 'Применение...');
        btn.disabled = true;

        const payload = {
            language: document.getElementById('set-language').value,
            providers: {
                deepseek: document.getElementById('set-deepseek').checked,
                qwen: document.getElementById('set-qwen').checked,
                gemini: document.getElementById('set-gemini').checked
            },
            debugMode: document.getElementById('set-debug').checked,
            defaultModel: document.getElementById('set-default-model').value,
            enableApiKeys: document.getElementById('set-enable-auth').checked,
            masterApiKey: document.getElementById('set-api-key').value.trim(),
            apiKeys: this.apiKeys,
            particles: {
                enabled: document.getElementById('set-particles-enabled').checked,
                count: parseInt(document.getElementById('set-particles-count').value),
                speed: parseFloat(document.getElementById('set-particles-speed').value),
                maxSize: parseFloat(document.getElementById('set-particles-size').value),
                connectLines: document.getElementById('set-particles-lines').checked,
                lineDistance: parseInt(document.getElementById('set-particles-dist').value),
                comets: document.getElementById('set-particles-comets').checked
            }
        };

        try {
            await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            await window.app.refreshUI();
            if (window.initLanguage) await window.initLanguage();

            this.modalManager.closeAll();
            this.modalManager.showToast(window.t('toast_saved', 'Конфигурация ядра обновлена'));
        } catch (err) {
            alert(window.t('settings_save_error', 'Ошибка при сохранении конфигурации.'));
        } finally {
            btn.innerText = window.t('btn_save', 'Применить изменения');
            btn.disabled = false;
        }
    }

    switchTab(tabId, event) {
        document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.remove('active'));
        event.currentTarget.classList.add('active');
        document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'));
        document.getElementById('tab-' + tabId).classList.add('active');
    }

    toggleAuthFields() {
        const isEnabled = document.getElementById('set-enable-auth').checked;
        const container = document.getElementById('auth-fields-container');
        container.style.opacity = isEnabled ? '1' : '0.4';
        container.style.pointerEvents = isEnabled ? 'auto' : 'none';
    }

    showNewKeyInput() {
        document.getElementById('new-key-container').style.display = 'flex';
        document.getElementById('new-key-name').focus();
    }

    hideNewKeyInput() {
        document.getElementById('new-key-container').style.display = 'none';
        document.getElementById('new-key-name').value = '';
    }

    generateApiKey() {
        const nameInput = document.getElementById('new-key-name');
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }

        const randomHex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
        const newKey = 'sk-core-' + randomHex;

        this.apiKeys.push({ id: Date.now().toString(), name: name, key: newKey, createdAt: Date.now() });
        this.renderApiKeys();
        this.hideNewKeyInput();

        const msg = window.t('token_pending', 'Токен "{name}" ожидает сохранения').replace('{name}', name);
        this.modalManager.showToast(msg);
    }

    deleteApiKey(id) {
        this.apiKeys = this.apiKeys.filter(k => k.id !== id);
        this.renderApiKeys();
    }

    renderApiKeys() {
        const listEl = document.getElementById('api-keys-list');
        listEl.innerHTML = '';
        if (this.apiKeys.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; padding: 16px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 10px; color: var(--text-muted); font-size: 13px;" data-i18n="no_tokens">${window.t('no_tokens', 'Нет сгенерированных токенов')}</div>`;
            return;
        }

        [...this.apiKeys].reverse().forEach((k) => {
            const dateStr = new Date(k.createdAt).toLocaleDateString();
            listEl.innerHTML += `
 <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); padding: 10px 14px; border-radius: 10px;">
 <div style="display: flex; flex-direction: column; gap: 4px;">
 <span style="font-size: 14px; font-weight: 500; color: var(--text);">${k.name}</span>
 <div style="display: flex; gap: 8px; align-items: center;">
 <code style="font-family: monospace; font-size: 12px; color: var(--success); background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px;">${k.key.substring(0, 10)}...${k.key.slice(-4)}</code>
 <span style="font-size: 12px; color: var(--text-muted);">${dateStr}</span>
 </div>
 </div>
 <div style="display: flex; gap: 6px;">
 <button class="btn-icon" onclick="window.app.settings.copyToClipboard('${k.key}')" title="${window.t('copy', 'Копировать')}">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
 </button>
 <button class="btn-icon btn-danger-flat" onclick="window.app.settings.deleteApiKey('${k.id}')" title="${window.t('delete', 'Удалить')}">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
 </button>
 </div>
 </div>`;
        });
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.modalManager.showToast(window.t('token_copied', 'Токен скопирован'));
        });
    }

    togglePasswordVisibility(inputId, btnEl) {
        const input = document.getElementById(inputId);
        if (input.type === "password") {
            input.type = "text";
            btnEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        } else {
            input.type = "password";
            btnEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        }
    }
}