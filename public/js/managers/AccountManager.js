export class AccountManager {
    constructor(modalManager) {
        this.modal = modalManager;
        this.geminiDb = { active: 0, accounts: [] };
        this.genericDb = { active: 0, accounts: [] };
        this.currentProviderId = null;
        this.geminiEditingIndex = -1;
        this.genericEditingIndex = -1;
        this.isLocked = false;
        this.draggedItem = null;
        this.draggedType = null;
    }

    // ==========================================
    // ЛОГИКА DRAG & DROP
    // ==========================================
    handleDragStart(e, index, type) {
        if (this.isLocked && type === 'generic') {
            e.preventDefault();
            return;
        }
        this.draggedItem = index;
        this.draggedType = type;

        setTimeout(() => e.target.classList.add('dragging'), 0);

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index);
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }

    handleDragEnter(e) {
        e.preventDefault();
        const item = e.target.closest('.setting-item');
        if (item && !item.classList.contains('dragging')) {
            item.classList.add('drag-over');
        }
    }

    handleDragLeave(e) {
        const item = e.target.closest('.setting-item');
        if (item && !item.contains(e.relatedTarget)) {
            item.classList.remove('drag-over');
        }
    }

    handleDragEnd(e) {
        const item = e.target.closest('.setting-item');
        if (item) item.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        this.draggedItem = null;
        this.draggedType = null;
    }

    async handleDrop(e, targetIndex, type) {
        e.preventDefault();
        const item = e.target.closest('.setting-item');
        if (item) item.classList.remove('drag-over');

        if (this.draggedItem === null || this.draggedItem === targetIndex || this.draggedType !== type) return;

        const db = type === 'gemini' ? this.geminiDb : this.genericDb;
        const activeAccount = db.accounts[db.active];

        const draggedElement = db.accounts.splice(this.draggedItem, 1)[0];
        db.accounts.splice(targetIndex, 0, draggedElement);
        db.active = db.accounts.indexOf(activeAccount);

        if (type === 'gemini') this.renderGeminiAccounts();
        else this.renderGenericAccounts();

        const endpoint = type === 'gemini' ? '/api/gemini/accounts' : `/api/${this.currentProviderId}/accounts`;
        try {
            await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(db) });
            window.app.refreshUI();
        } catch (err) {
            console.error("Ошибка при сохранении сортировки:", err);
            this.modal.showToast("Ошибка сохранения порядка");
        }
    }

    // ==========================================
    // УПРАВЛЕНИЕ GEMINI
    // ==========================================
    async openGeminiManager() {
        document.getElementById('geminiModal').classList.add('active');
        document.getElementById('geminiTabsContainer').style.display = 'flex';
        this.switchGeminiTab('accounts');
        await this.fetchGeminiAccounts();

        try {
            const res = await fetch('/api/settings');
            const settings = await res.json();
            const geminiConfig = settings.providerSettings?.gemini || { maxRetries: 1, retryDelay: 2000 };
            document.getElementById('geminiSetRetries').value = geminiConfig.maxRetries;
            document.getElementById('geminiSetDelay').value = geminiConfig.retryDelay;
        } catch (e) { console.error(e); }
    }

    switchGeminiTab(tabName) {
        document.getElementById('geminiTabsContainer').style.display = 'flex';
        const tabs = document.getElementById('geminiTabsContainer').querySelectorAll('.gemini-tab-btn');

        tabs[0].classList.toggle('active', tabName === 'accounts');
        tabs[1].classList.toggle('active', tabName === 'settings');

        if (tabName === 'accounts') {
            this.toggleView('geminiAccountsSection', ['geminiSettingsSection', 'geminiEditorSection']);
        } else if (tabName === 'settings') {
            this.toggleView('geminiSettingsSection', ['geminiAccountsSection', 'geminiEditorSection']);
        }
    }

    async fetchGeminiAccounts() {
        try {
            const res = await fetch('/api/gemini/accounts');
            this.geminiDb = res.ok ? await res.json() : { active: 0, accounts: [] };
        } catch { this.geminiDb = { active: 0, accounts: [] }; }
        this.renderGeminiAccounts();
    }

    renderGeminiAccounts() {
        const listEl = document.getElementById('geminiAccountsList');
        listEl.innerHTML = '';
        if (this.geminiDb.accounts.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; padding: 60px 20px; border: 1px dashed #27272a; border-radius: 12px; margin-top: 12px;"><p style="color: #a1a1aa;">База данных пуста.</p></div>`;
            return;
        }

        this.geminiDb.accounts.forEach((acc, index) => {
            const isActive = this.geminiDb.active === index;
            const profileName = acc.name || `Профиль #${index + 1}`;
            const projectStatus = acc.project_id ? `project_id: "${acc.project_id}"` : `<span style="color:#ef4444">⚠️ Требуется настройка Project ID</span>`;

            listEl.innerHTML += `
            <div class="setting-item ${isActive ? 'active-gemini-item' : ''}" style="margin-bottom: 12px; cursor: pointer;" 
                 draggable="true"
                 ondragstart="window.app.accounts.handleDragStart(event, ${index}, 'gemini')"
                 ondragover="window.app.accounts.handleDragOver(event)"
                 ondragenter="window.app.accounts.handleDragEnter(event)"
                 ondragleave="window.app.accounts.handleDragLeave(event)"
                 ondrop="window.app.accounts.handleDrop(event, ${index}, 'gemini')"
                 ondragend="window.app.accounts.handleDragEnd(event)"
                 onclick="window.app.accounts.setActiveGemini(${index})">
                
                <div class="drag-handle" onclick="event.stopPropagation()" title="Удерживайте для сортировки">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                        <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
                    </svg>
                </div>

                <label class="gemini-radio"><input type="radio" ${isActive ? 'checked' : ''} onclick="event.stopPropagation()"><span class="radio-mark"></span></label>
                <div class="setting-info" style="flex: 1; padding: 0 16px;">
                    <h4 style="margin: 0; font-size: 15px; color: var(--text);">${profileName}</h4>
                    <div style="font-size: 13px; font-family: monospace; color: var(--text-muted);">${projectStatus}</div>
                </div>
                <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
                    <button class="btn btn-icon" onclick="window.app.accounts.editGeminiAccount(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-danger-flat" onclick="window.app.accounts.deleteGeminiAccount(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>`;
        });
    }

    addGeminiAccount() {
        window.open('/api/gemini/auth', 'geminiAuthPopup', 'width=600,height=700');
        const onWindowFocus = () => {
            this.fetchGeminiAccounts();
            window.app.refreshUI();
            window.removeEventListener('focus', onWindowFocus);
        };
        window.addEventListener('focus', onWindowFocus);
    }

    async setActiveGemini(index) {
        this.geminiDb.active = index;
        await fetch('/api/gemini/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiDb) });
        this.renderGeminiAccounts();
        window.app.refreshUI();
        this.modal.showToast('Профиль изменен');
    }

    async deleteGeminiAccount(index) {
        if (!confirm("Удалить этот профиль безвозвратно?")) return;
        this.geminiDb.accounts.splice(index, 1);
        if (this.geminiDb.active >= this.geminiDb.accounts.length) this.geminiDb.active = 0;

        await fetch('/api/gemini/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiDb) });
        this.renderGeminiAccounts();
        window.app.refreshUI();
    }

    editGeminiAccount(index) {
        this.geminiEditingIndex = index;
        document.getElementById('geminiInputName').value = this.geminiDb.accounts[index].name || '';
        document.getElementById('geminiInputProjectId').value = this.geminiDb.accounts[index].project_id || '';

        document.getElementById('geminiTabsContainer').style.display = 'none';
        this.toggleView('geminiEditorSection', ['geminiAccountsSection', 'geminiSettingsSection']);
    }

    async saveGeminiEdit() {
        if (this.geminiEditingIndex === -1) return;
        this.geminiDb.accounts[this.geminiEditingIndex].name = document.getElementById('geminiInputName').value.trim();
        this.geminiDb.accounts[this.geminiEditingIndex].project_id = document.getElementById('geminiInputProjectId').value.trim();

        await fetch('/api/gemini/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiDb) });
        this.cancelGeminiEdit();
        this.renderGeminiAccounts();
        window.app.refreshUI();
        this.modal.showToast('Настройки профиля сохранены');
    }

    cancelGeminiEdit() {
        this.geminiEditingIndex = -1;
        document.getElementById('geminiTabsContainer').style.display = 'flex';
        this.switchGeminiTab('accounts');
    }

    async saveProviderSettings(providerId, event) {
        // Если event из параметров отсутствует, мы не упадем с ошибкой
        const btn = event ? event.currentTarget : null;
        const originalText = btn ? btn.innerText : '';

        if (btn) {
            btn.innerText = window.t ? window.t('settings_applying', 'Сохранение...') : 'Сохранение...';
            btn.disabled = true;
        }

        if (providerId === 'gemini') {
            const maxRetries = parseInt(document.getElementById('geminiSetRetries').value) || 0;
            const retryDelay = parseInt(document.getElementById('geminiSetDelay').value) || 2000;

            try {
                const res = await fetch('/api/settings');
                const settings = await res.json();
                if (!settings.providerSettings) settings.providerSettings = {};
                if (!settings.providerSettings.gemini) settings.providerSettings.gemini = {};
                settings.providerSettings.gemini.maxRetries = maxRetries;
                settings.providerSettings.gemini.retryDelay = retryDelay;

                await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });

                this.modal.showToast(window.t ? window.t('toast_saved', 'Конфигурация обновлена') : 'Конфигурация обновлена');
            } catch (e) {
                console.error('Ошибка сохранения:', e);
                this.modal.showToast(window.t ? window.t('settings_save_error', 'Ошибка при сохранении') : 'Ошибка при сохранении');
            } finally {
                if (btn) {
                    btn.innerText = originalText;
                    btn.disabled = false;
                }
            }
        }
    }

    // ==========================================
    // GENERIC (DeepSeek/Qwen)
    // ==========================================
    async openGenericManager(id) {
        this.currentProviderId = id;
        const data = window.__PROVIDERS__[id];
        document.getElementById('genericAccountsIcon').innerHTML = data.logo;
        document.getElementById('genericAccountsTitle').innerText = 'Аккаунты: ' + data.name;
        document.getElementById('genericAccountsModal').classList.add('active');
        this.toggleView('genericAccountsSection', 'genericEditorSection');
        await this.fetchGenericAccounts();
    }

    async fetchGenericAccounts() {
        try {
            const res = await fetch(`/api/${this.currentProviderId}/accounts`);
            this.genericDb = res.ok ? await res.json() : { active: 0, accounts: [] };
        } catch { this.genericDb = { active: 0, accounts: [] }; }
        this.renderGenericAccounts();
    }

    renderGenericAccounts() {
        const listEl = document.getElementById('genericAccountsList');
        listEl.innerHTML = '';
        if (this.genericDb.accounts.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; padding: 60px 20px; border: 1px dashed #27272a; border-radius: 12px; margin-top: 12px;"><p style="color: #a1a1aa;">База данных пуста.</p></div>`;
            return;
        }

        this.genericDb.accounts.forEach((acc, index) => {
            const isActive = this.genericDb.active === index;
            const profileName = acc.name || `Профиль #${index + 1}`;
            const tokenInfo = acc.token ? `token: ${acc.token.substring(0, 6)}...${acc.token.slice(-4)}` : "Нет токена";
            const loading = (this.isLocked && isActive) ? `<span class="pulse-dot auth" style="display:inline-block; margin-left: 8px; transform: scale(0.8);"></span>` : "";

            listEl.innerHTML += `
            <div class="setting-item ${isActive ? 'active-gemini-item' : ''}" style="margin-bottom: 12px; cursor: pointer; ${this.isLocked ? 'opacity: 0.5;' : ''}" 
                 draggable="${!this.isLocked}"
                 ondragstart="window.app.accounts.handleDragStart(event, ${index}, 'generic')"
                 ondragover="window.app.accounts.handleDragOver(event)"
                 ondragenter="window.app.accounts.handleDragEnter(event)"
                 ondragleave="window.app.accounts.handleDragLeave(event)"
                 ondrop="window.app.accounts.handleDrop(event, ${index}, 'generic')"
                 ondragend="window.app.accounts.handleDragEnd(event)"
                 onclick="window.app.accounts.setActiveGeneric(${index})">
                
                <div class="drag-handle" onclick="event.stopPropagation()" title="Удерживайте для сортировки">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                        <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
                    </svg>
                </div>

                <label class="gemini-radio"><input type="radio" ${isActive ? 'checked' : ''} disabled><span class="radio-mark"></span></label>
                <div class="setting-info" style="flex: 1; padding: 0 16px;">
                    <h4 style="margin: 0; font-size: 15px; display: flex; align-items: center;">${profileName} ${loading}</h4>
                    <div style="font-size: 13px; font-family: monospace; color: var(--text-muted);">${tokenInfo}</div>
                </div>
                <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
                    <button class="btn btn-icon" onclick="window.app.accounts.editGenericAccount(${index})" ${this.isLocked ? 'disabled' : ''}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-danger-flat" onclick="window.app.accounts.deleteGenericAccount(${index})" ${this.isLocked ? 'disabled' : ''}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>`;
        });
    }

    addGenericAccount() {
        if (this.isLocked) return;
        document.getElementById('genericAccountsModal').classList.remove('active');
        this.modal.openBaseAuthModal(this.currentProviderId, window.__PROVIDERS__[this.currentProviderId]);
    }

    async setActiveGeneric(index) {
        if (this.isLocked || this.genericDb.active === index) return;
        this.isLocked = true;
        this.genericDb.active = index;
        this.renderGenericAccounts();

        try {
            await fetch(`/api/${this.currentProviderId}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.genericDb) });
            await new Promise(r => setTimeout(r, 2000));
            window.app.refreshUI();
            this.modal.showToast('Профиль переключен');
        } finally {
            this.isLocked = false;
            this.renderGenericAccounts();
        }
    }

    async deleteGenericAccount(index) {
        if (this.isLocked || !confirm("Удалить этот профиль безвозвратно?")) return;
        this.isLocked = true;
        this.genericDb.accounts.splice(index, 1);
        if (this.genericDb.active >= this.genericDb.accounts.length) this.genericDb.active = 0;
        this.renderGenericAccounts();

        try {
            await fetch(`/api/${this.currentProviderId}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.genericDb) });
            await new Promise(r => setTimeout(r, 500));
            window.app.refreshUI();
        } finally {
            this.isLocked = false;
            this.renderGenericAccounts();
        }
    }

    editGenericAccount(index) {
        if (this.isLocked) return;
        this.genericEditingIndex = index;
        document.getElementById('genericInputName').value = this.genericDb.accounts[index].name || '';
        this.toggleView('genericEditorSection', 'genericAccountsSection');
    }

    async saveGenericEdit() {
        if (this.genericEditingIndex === -1) return;
        this.genericDb.accounts[this.genericEditingIndex].name = document.getElementById('genericInputName').value.trim();
        this.isLocked = true;
        this.cancelGenericEdit();
        this.renderGenericAccounts();

        try {
            await fetch(`/api/${this.currentProviderId}/accounts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.genericDb) });
            window.app.refreshUI();
            this.modal.showToast('Имя профиля сохранено');
        } finally {
            this.isLocked = false;
            this.renderGenericAccounts();
        }
    }

    cancelGenericEdit() {
        this.genericEditingIndex = -1;
        this.toggleView('genericAccountsSection', 'genericEditorSection');
    }

    toggleView(showId, hideIds) {
        if (!Array.isArray(hideIds)) hideIds = [hideIds];
        const showSec = document.getElementById(showId);
        hideIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        showSec.style.display = 'block';
        showSec.classList.remove('animated-view');
        void showSec.offsetWidth;
        showSec.classList.add('animated-view');
    }
}