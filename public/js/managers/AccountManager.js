export class AccountManager {
    constructor(modalManager) {
        this.modal = modalManager;
        this.geminiDb = { active: 0, accounts: [] };
        this.genericDb = { active: 0, accounts: [] };
        this.geminiApiDb = { active: 0, accounts: [] };
        this.geminiApiEditingIndex = -1;
        this.deepseekDb = { active: 0, accounts: [] };
        this.deepseekEditingIndex = -1;
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
        const btn = event ? event.currentTarget : null;
        const originalText = btn ? btn.innerText : '';

        if (btn) {
            btn.innerText = window.t ? window.t('settings_applying', 'Сохранение...') : 'Сохранение...';
            btn.disabled = true;
        }

        try {
            const res = await fetch('/api/settings');
            const settings = await res.json();
            if (!settings.providerSettings) settings.providerSettings = {};

            if (providerId === 'gemini') {
                if (!settings.providerSettings.gemini) settings.providerSettings.gemini = {};
                settings.providerSettings.gemini.maxRetries = parseInt(document.getElementById('geminiSetRetries').value) || 0;
                settings.providerSettings.gemini.retryDelay = parseInt(document.getElementById('geminiSetDelay').value) || 2000;
            } else if (providerId === 'deepseek') {
                if (!settings.providerSettings.deepseek) settings.providerSettings.deepseek = {};
                settings.providerSettings.deepseek.showBrowser = document.getElementById('dsSetShowBrowser').checked;
                settings.providerSettings.deepseek.sendThink = document.getElementById('dsSetSendThink').checked;
            } else if (providerId === 'gemini_api') {
                if (!settings.providerSettings.gemini_api) settings.providerSettings.gemini_api = {};

                settings.providerSettings.gemini_api.useInteractions = document.getElementById('geminiApiUseInteractions')?.checked || false;
                settings.providerSettings.gemini_api.singleTurn = document.getElementById('geminiApiSingleTurn')?.checked || false;
                settings.providerSettings.gemini_api.autoAgent = document.getElementById('geminiApiAutoAgent')?.checked ?? true;

                settings.providerSettings.gemini_api.sendSafety = document.getElementById('geminiApiSendSafety')?.checked ?? true;
                settings.providerSettings.gemini_api.safeHarassment = document.getElementById('geminiApiSafeHarassment')?.checked ?? true;
                settings.providerSettings.gemini_api.safeHate = document.getElementById('geminiApiSafeHate')?.checked ?? true;
                settings.providerSettings.gemini_api.safeSex = document.getElementById('geminiApiSafeSex')?.checked ?? true;
                settings.providerSettings.gemini_api.safeDanger = document.getElementById('geminiApiSafeDanger')?.checked ?? true;
                settings.providerSettings.gemini_api.safeCivic = document.getElementById('geminiApiSafeCivic')?.checked || false;
                settings.providerSettings.gemini_api.safeJailbreak = document.getElementById('geminiApiSafeJailbreak')?.checked || false;
                settings.providerSettings.gemini_api.safeImageHarassment = document.getElementById('geminiApiSafeImageHarassment')?.checked ?? true;
                settings.providerSettings.gemini_api.safeImageHate = document.getElementById('geminiApiSafeImageHate')?.checked ?? true;
                settings.providerSettings.gemini_api.safeImageSex = document.getElementById('geminiApiSafeImageSex')?.checked ?? true;
                settings.providerSettings.gemini_api.safeImageDanger = document.getElementById('geminiApiSafeImageDanger')?.checked ?? true;
            }

            await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });

            this.modal.showToast(window.t ? window.t('toast_saved', 'Настройки провайдера сохранены') : 'Настройки провайдера сохранены');
        } catch (e) {
            console.error('Ошибка сохранения:', e);
            this.modal.showToast(window.t ? window.t('settings_save_error', 'Ошибка при сохранении') : 'Ошибка при сохранении', 'error');
        } finally {
            if (btn) {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }

    // ==========================================
    // GENERIC (Qwen и др.)
    // ==========================================
    async openGenericManager(id) {
        this.currentProviderId = id;
        const data = window.__PROVIDERS__[id];

        const iconEl = document.getElementById('genericAccountsIcon');
        const titleEl = document.getElementById('genericAccountsTitle');
        if (iconEl && data) iconEl.innerHTML = data.logo;
        if (titleEl && data) titleEl.innerText = 'Аккаунты: ' + data.name;

        // Показываем секцию аккаунтов и скрываем редактор
        this.toggleView('genericAccountsSection', ['genericEditorSection']);

        document.getElementById('genericAccountsModal')?.classList.add('active');
        await this.fetchGenericAccounts();
    }

    switchGenericTab(tabName) {
        if (tabName === 'accounts') {
            this.toggleView('genericAccountsSection', ['genericEditorSection']);
        }
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
        document.getElementById('genericAccountsModal')?.classList.remove('active');

        if (this.currentProviderId === 'deepseek') {
            const authChoice = document.getElementById('authChoiceModal');
            if (authChoice) authChoice.classList.add('active');
            else this.startAutoAuth();
        } else {
            this.startManualAuth();
        }
    }

    startAutoAuth() {
        document.getElementById('authChoiceModal')?.classList.remove('active');
        this.modal.showToast(window.t ? window.t('ds_toast_auth_start', 'Открываю браузер... Пожалуйста, авторизуйтесь.') : 'Открываю браузер... Пожалуйста, авторизуйтесь.', 'info');

        fetch(`/api/${this.currentProviderId}/auto-auth`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    this.modal.showToast(window.t ? window.t('ds_toast_auth_success', 'Аккаунт успешно добавлен в ядро.') : 'Аккаунт успешно добавлен в ядро.', 'success');
                    window.app.refreshUI();
                    if (this.currentProviderId === 'deepseek') {
                        this.openDeepSeekManager();
                    } else {
                        this.openGenericManager(this.currentProviderId);
                    }
                } else {
                    let errorMsg = data.error || (window.t ? window.t('ds_auth_aborted', 'Авторизация прервана') : 'Авторизация прервана');
                    if (data.errorCode && window.t) {
                        errorMsg = window.t(data.errorCode, data.error);
                    }
                    this.modal.showToast((window.t ? window.t('ds_toast_auth_error', 'Ошибка: ') : 'Ошибка: ') + errorMsg, 'error');
                }
            })
            .catch(err => {
                this.modal.showToast(window.t ? window.t('ds_toast_server_error', 'Ошибка связи с сервером.') : 'Ошибка связи с сервером.', 'error');
            });
    }

    startManualAuth() {
        document.getElementById('authChoiceModal')?.classList.remove('active');
        if (this.currentProviderId && window.__PROVIDERS__[this.currentProviderId]) {
            this.modal.openBaseAuthModal(this.currentProviderId, window.__PROVIDERS__[this.currentProviderId]);
        }
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
        document.getElementById('genericTabsContainer').style.display = 'none';
        this.toggleView('genericEditorSection', ['genericAccountsSection', 'genericSettingsSection']);
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
        document.getElementById('genericTabsContainer').style.display = 'flex';
        this.switchGenericTab('accounts');
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

    // ==========================================
    // GEMINI OFFICIAL API (КЛЮЧИ И ТАБЫ)
    // ==========================================

    // Переключение табов
    switchGeminiApiTab(tab) {
        const tabs = document.querySelectorAll('#geminiApiTabsContainer .gemini-tab-btn');
        tabs.forEach(t => t.classList.remove('active'));

        if (tab === 'accounts') {
            tabs[0].classList.add('active');
            this.toggleView('geminiApiAccountsSection', ['geminiApiSettingsSection', 'geminiApiEditorSection', 'geminiApiRoutingSection']);
        } else if (tab === 'routing') {
            tabs[1].classList.add('active');
            this.toggleView('geminiApiRoutingSection', ['geminiApiAccountsSection', 'geminiApiSettingsSection', 'geminiApiEditorSection']);
            this.renderGeminiApiRouting();
        } else if (tab === 'settings') {
            tabs[2].classList.add('active');
            this.toggleView('geminiApiSettingsSection', ['geminiApiAccountsSection', 'geminiApiEditorSection', 'geminiApiRoutingSection']);
        }
    }

    // Открытие окна
    async openGeminiApiManager() {
        document.getElementById('geminiApiModal').classList.add('active');
        document.getElementById('geminiApiTabsContainer').style.display = 'flex'; // Показываем табы
        this.switchGeminiApiTab('accounts');

        // Загружаем настройки Голема
        try {
            const res = await fetch('/api/settings');
            const settings = await res.json();
            const geminiApiSet = settings.providerSettings?.gemini_api || {};

            document.getElementById('geminiApiUseInteractions').checked = geminiApiSet.useInteractions || false;

            // Загрузка Safety Settings
            const sendSafety = document.getElementById('geminiApiSendSafety');
            sendSafety.checked = geminiApiSet.sendSafety !== false; // По умолчанию включено

            document.getElementById('geminiApiSafeHarassment').checked = geminiApiSet.safeHarassment !== false;
            document.getElementById('geminiApiSafeHate').checked = geminiApiSet.safeHate !== false;
            document.getElementById('geminiApiSafeSex').checked = geminiApiSet.safeSex !== false;
            document.getElementById('geminiApiSafeDanger').checked = geminiApiSet.safeDanger !== false;
            document.getElementById('geminiApiSafeCivic').checked = geminiApiSet.safeCivic || false;
            document.getElementById('geminiApiSafeJailbreak').checked = geminiApiSet.safeJailbreak || false;
            document.getElementById('geminiApiUseInteractions').checked = geminiApiSet.useInteractions || false;
            document.getElementById('geminiApiSingleTurn').checked = geminiApiSet.singleTurn || false;
            document.getElementById('geminiApiAutoAgent').checked = geminiApiSet.autoAgent !== false;
            document.getElementById('geminiApiSafeImageHarassment').checked = geminiApiSet.safeImageHarassment !== false;
            document.getElementById('geminiApiSafeImageHate').checked = geminiApiSet.safeImageHate !== false;
            document.getElementById('geminiApiSafeImageSex').checked = geminiApiSet.safeImageSex !== false;
            document.getElementById('geminiApiSafeImageDanger').checked = geminiApiSet.safeImageDanger !== false;

            // Обновляем визуальное состояние сетки
            document.getElementById('geminiApiSafetyGrid').style.opacity = sendSafety.checked ? '1' : '0.4';
            document.getElementById('geminiApiSafetyGrid').style.pointerEvents = sendSafety.checked ? 'auto' : 'none';

        } catch (e) { }

        await this.fetchGeminiApiAccounts();
    }

    async fetchGeminiApiAccounts() {
        try {
            const res = await fetch('/api/gemini_api/accounts');
            this.geminiApiDb = res.ok ? await res.json() : { active: 0, accounts: [] };
        } catch { this.geminiApiDb = { active: 0, accounts: [] }; }
        this.renderGeminiApiAccounts();
    }

    renderGeminiApiAccounts() {
        const listEl = document.getElementById('geminiApiAccountsList');
        listEl.innerHTML = '';
        if (this.geminiApiDb.accounts.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; padding: 60px 20px; border: 1px dashed #27272a; border-radius: 12px; margin-top: 12px;"><p style="color: #a1a1aa;">Пул ключей пуст.</p></div>`;
            return;
        }

        this.geminiApiDb.accounts.forEach((acc, index) => {
            const isActive = this.geminiApiDb.active === index;
            const profileName = acc.name || `Ключ #${index + 1}`;
            const tokenInfo = acc.token ? `Ключ: ${acc.token.substring(0, 10)}...${acc.token.slice(-4)}` : "Нет ключа";

            listEl.innerHTML += `
            <div class="setting-item ${isActive ? 'active-gemini-item' : ''}" style="margin-bottom: 12px; cursor: pointer;" 
                 onclick="window.app.accounts.setActiveGeminiApi(${index})">
                <label class="gemini-radio"><input type="radio" ${isActive ? 'checked' : ''} disabled><span class="radio-mark"></span></label>
                <div class="setting-info" style="flex: 1; padding: 0 16px;">
                    <h4 style="margin: 0; font-size: 15px;">${profileName}</h4>
                    <div style="font-size: 13px; font-family: monospace; color: var(--text-muted);">${tokenInfo}</div>
                </div>
                <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
                    <button class="btn btn-icon" onclick="window.app.accounts.editGeminiApiAccount(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-danger-flat" onclick="window.app.accounts.deleteGeminiApiAccount(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>`;
        });
    }

    addGeminiApiAccount() {
        this.geminiApiEditingIndex = -1;
        document.getElementById('geminiApiInputName').value = '';
        document.getElementById('geminiApiInputToken').value = '';

        // Прячем табы при редактировании
        document.getElementById('geminiApiTabsContainer').style.display = 'none';
        this.toggleView('geminiApiEditorSection', ['geminiApiAccountsSection', 'geminiApiSettingsSection']);
    }

    editGeminiApiAccount(index) {
        this.geminiApiEditingIndex = index;
        document.getElementById('geminiApiInputName').value = this.geminiApiDb.accounts[index].name || '';
        document.getElementById('geminiApiInputToken').value = this.geminiApiDb.accounts[index].token || '';

        // Прячем табы при редактировании
        document.getElementById('geminiApiTabsContainer').style.display = 'none';
        this.toggleView('geminiApiEditorSection', ['geminiApiAccountsSection', 'geminiApiSettingsSection']);
    }

    async saveGeminiApiEdit() {
        const newName = document.getElementById('geminiApiInputName').value.trim();
        const newToken = document.getElementById('geminiApiInputToken').value.trim();

        if (!newName || !newToken) {
            this.modal.showToast("Имя и Ключ обязательны", "error");
            return;
        }

        if (this.geminiApiEditingIndex === -1) {
            this.geminiApiDb.accounts.push({ name: newName, token: newToken, createdAt: Date.now() });
            this.geminiApiDb.active = this.geminiApiDb.accounts.length - 1;
        } else {
            this.geminiApiDb.accounts[this.geminiApiEditingIndex].name = newName;
            this.geminiApiDb.accounts[this.geminiApiEditingIndex].token = newToken;
        }

        await fetch('/api/gemini_api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiApiDb) });
        this.cancelGeminiApiEdit();
        this.renderGeminiApiAccounts();
        window.app.refreshUI();
        this.modal.showToast('Ключ сохранен');
    }

    cancelGeminiApiEdit() {
        this.geminiApiEditingIndex = -1;
        document.getElementById('geminiApiTabsContainer').style.display = 'flex'; // Возвращаем табы
        this.switchGeminiApiTab('accounts');
    }

    async setActiveGeminiApi(index) {
        if (this.geminiApiDb.active === index) return;
        this.geminiApiDb.active = index;
        await fetch('/api/gemini_api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiApiDb) });
        this.renderGeminiApiAccounts();
        window.app.refreshUI();
        this.modal.showToast('Активный ключ изменен');
    }

    async deleteGeminiApiAccount(index) {
        if (!confirm("Удалить этот ключ безвозвратно?")) return;
        this.geminiApiDb.accounts.splice(index, 1);
        if (this.geminiApiDb.active >= this.geminiApiDb.accounts.length) this.geminiApiDb.active = 0;
        await fetch('/api/gemini_api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiApiDb) });
        this.renderGeminiApiAccounts();
        window.app.refreshUI();
    }

    // ==========================================
    // DEEPSEEK MANAGER
    // ==========================================
    async openDeepSeekManager() {
        document.getElementById('deepseekModal').classList.add('active');
        document.getElementById('deepseekTabsContainer').style.display = 'flex';
        this.switchDeepSeekTab('accounts');
        await this.fetchDeepSeekAccounts();

        try {
            const res = await fetch('/api/settings');
            const settings = await res.json();
            const dsConfig = settings.providerSettings?.deepseek || { showBrowser: false, sendThink: true };
            document.getElementById('dsSetShowBrowser').checked = dsConfig.showBrowser || false;
            document.getElementById('dsSetSendThink').checked = dsConfig.sendThink !== false;
        } catch (e) { }
    }

    switchDeepSeekTab(tabName) {
        const tabs = document.querySelectorAll('#deepseekTabsContainer .gemini-tab-btn');
        tabs.forEach(t => t.classList.remove('active'));

        if (tabName === 'accounts') {
            tabs[0].classList.add('active');
            this.toggleView('deepseekAccountsSection', ['deepseekSettingsSection', 'deepseekEditorSection']);
        } else if (tabName === 'settings') {
            tabs[1].classList.add('active');
            this.toggleView('deepseekSettingsSection', ['deepseekAccountsSection', 'deepseekEditorSection']);
        }
    }

    async fetchDeepSeekAccounts() {
        try {
            const res = await fetch('/api/deepseek/accounts');
            this.deepseekDb = res.ok ? await res.json() : { active: 0, accounts: [] };
        } catch { this.deepseekDb = { active: 0, accounts: [] }; }
        this.renderDeepSeekAccounts();
    }

    renderDeepSeekAccounts() {
        const listEl = document.getElementById('deepseekAccountsList');
        listEl.innerHTML = '';
        if (this.deepseekDb.accounts.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; padding: 60px 20px; border: 1px dashed #27272a; border-radius: 12px; margin-top: 12px;"><p style="color: #a1a1aa;">Пул сессий DeepSeek пуст.</p></div>`;
            return;
        }

        this.deepseekDb.accounts.forEach((acc, index) => {
            const isActive = this.deepseekDb.active === index;
            const profileName = acc.name || `Сессия #${index + 1}`;
            const tokenInfo = acc.token ? `token: ${acc.token.substring(0, 8)}...${acc.token.slice(-4)}` : "Авторизован";

            listEl.innerHTML += `
            <div class="setting-item ${isActive ? 'active-gemini-item' : ''}" style="margin-bottom: 12px; cursor: pointer;" 
                 onclick="window.app.accounts.setActiveDeepSeek(${index})">
                <label class="gemini-radio"><input type="radio" ${isActive ? 'checked' : ''} disabled><span class="radio-mark"></span></label>
                <div class="setting-info" style="flex: 1; padding: 0 16px;">
                    <h4 style="margin: 0; font-size: 15px;">${profileName}</h4>
                    <div style="font-size: 13px; font-family: monospace; color: var(--text-muted);">${tokenInfo}</div>
                </div>
                <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
                    <button class="btn btn-icon" onclick="window.app.accounts.editDeepSeekAccount(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-danger-flat" onclick="window.app.accounts.deleteDeepSeekAccount(${index})">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>`;
        });
    }

    addDeepSeekAccount() {
        this.currentProviderId = 'deepseek';
        document.getElementById('deepseekModal')?.classList.remove('active');

        const authChoice = document.getElementById('authChoiceModal');
        if (authChoice) {
            authChoice.classList.add('active');
        } else {
            this.startAutoAuth();
        }
    }

    editDeepSeekAccount(index) {
        this.deepseekEditingIndex = index;
        document.getElementById('deepseekInputName').value = this.deepseekDb.accounts[index].name || '';
        document.getElementById('deepseekTabsContainer').style.display = 'none';
        this.toggleView('deepseekEditorSection', ['deepseekAccountsSection', 'deepseekSettingsSection']);
    }

    async saveDeepSeekEdit() {
        if (this.deepseekEditingIndex === -1) return;
        this.deepseekDb.accounts[this.deepseekEditingIndex].name = document.getElementById('deepseekInputName').value.trim();
        await fetch('/api/deepseek/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.deepseekDb) });
        this.cancelDeepSeekEdit();
        this.renderDeepSeekAccounts();
        window.app.refreshUI();
        this.modal.showToast('Имя сессии сохранено');
    }

    cancelDeepSeekEdit() {
        this.deepseekEditingIndex = -1;
        document.getElementById('deepseekTabsContainer').style.display = 'flex';
        this.switchDeepSeekTab('accounts');
    }

    async setActiveDeepSeek(index) {
        if (this.deepseekDb.active === index) return;
        this.deepseekDb.active = index;
        await fetch('/api/deepseek/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.deepseekDb) });
        this.renderDeepSeekAccounts();
        window.app.refreshUI();
        this.modal.showToast('Сессия DeepSeek переключена');
    }

    async deleteDeepSeekAccount(index) {
        if (!confirm("Удалить эту сессию DeepSeek?")) return;
        this.deepseekDb.accounts.splice(index, 1);
        if (this.deepseekDb.active >= this.deepseekDb.accounts.length) this.deepseekDb.active = 0;
        await fetch('/api/deepseek/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.deepseekDb) });
        this.renderDeepSeekAccounts();
        window.app.refreshUI();
    }

    // --- ЛОГИКА УМНОЙ БАЛАНСИРОВКИ (GEMINI API) ---
    async saveGeminiApiDb() {
        await fetch('/api/gemini_api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.geminiApiDb) });
    }

    async toggleGeminiApiPoolKey(index) {
        if (!this.geminiApiDb.routing) this.geminiApiDb.routing = { enabledKeys: [], rules: {} };
        if (!this.geminiApiDb.routing.enabledKeys) this.geminiApiDb.routing.enabledKeys = [];

        const idx = this.geminiApiDb.routing.enabledKeys.indexOf(index);
        if (idx > -1) this.geminiApiDb.routing.enabledKeys.splice(idx, 1);
        else this.geminiApiDb.routing.enabledKeys.push(index);

        await this.saveGeminiApiDb();
        this.renderGeminiApiRouting();
    }

    async addGeminiApiRule() {
        const model = document.getElementById('newRuleModelName').value.trim();
        if (!model) return;

        if (!this.geminiApiDb.routing) this.geminiApiDb.routing = { enabledKeys: [], rules: {} };
        if (!this.geminiApiDb.routing.rules) this.geminiApiDb.routing.rules = {};

        if (!this.geminiApiDb.routing.rules[model]) {
            this.geminiApiDb.routing.rules[model] = [];
        }

        document.getElementById('newRuleModelName').value = '';
        await this.saveGeminiApiDb();
        this.renderGeminiApiRouting();
    }

    async toggleGeminiApiRuleKey(model, index) {
        const rule = this.geminiApiDb.routing.rules[model];
        const idx = rule.indexOf(index);
        if (idx > -1) rule.splice(idx, 1);
        else rule.push(index);

        await this.saveGeminiApiDb();
        this.renderGeminiApiRouting();
    }

    async deleteGeminiApiRule(model) {
        delete this.geminiApiDb.routing.rules[model];
        await this.saveGeminiApiDb();
        this.renderGeminiApiRouting();
    }

    renderGeminiApiRouting() {
        const db = this.geminiApiDb;
        if (!db.routing) db.routing = { enabledKeys: [], rules: {} };
        if (!db.routing.enabledKeys) db.routing.enabledKeys = [];
        if (!db.routing.rules) db.routing.rules = {};

        // 1. Отрисовка Глобального Пула
        const poolList = document.getElementById('geminiApiGlobalPoolList');
        poolList.innerHTML = db.accounts.map((acc, i) => {
            const orderIndex = db.routing.enabledKeys.indexOf(i);
            const isActive = orderIndex > -1;

            if (isActive) {
                return `
                <div class="cat-chip active" style="user-select: none; padding: 6px 14px 6px 8px; display: flex; align-items: center; gap: 8px; background: rgba(97, 92, 237, 0.2); border-color: var(--accent); color: #fff; cursor: pointer; transition: 0.2s;" onclick="window.app.accounts.toggleGeminiApiPoolKey(${i})">
                    <span style="background: var(--accent); color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold;">${orderIndex + 1}</span>
                    ${acc.name}
                </div>`;
            } else {
                return `
                <div class="cat-chip" style="user-select: none; padding: 6px 14px; border: 1px dashed rgba(255,255,255,0.2); opacity: 0.6; color: var(--text-muted); cursor: pointer; transition: 0.2s;" onclick="window.app.accounts.toggleGeminiApiPoolKey(${i})" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                    + ${acc.name}
                </div>`;
            }
        }).join('') || '<div style="color: var(--text-muted); font-size: 13px;">Ключи не найдены. Добавьте их во вкладке "Пул ключей".</div>';

        // 2. Отрисовка Спец. Правил для Моделей
        const rulesList = document.getElementById('geminiApiRulesList');
        const rulesHtml = Object.keys(db.routing.rules).map(model => {
            const keys = db.routing.rules[model];
            const keysHtml = db.accounts.map((acc, i) => {
                const orderIndex = keys.indexOf(i);
                const isSelected = orderIndex > -1;

                if (isSelected) {
                    return `
                    <div class="cat-chip active" style="user-select: none; padding: 4px 12px 4px 6px; font-size: 12px; display: flex; align-items: center; gap: 6px; background: rgba(97, 92, 237, 0.2); border-color: var(--accent); color: #fff; cursor: pointer;" onclick="window.app.accounts.toggleGeminiApiRuleKey('${model}', ${i})">
                        <span style="background: var(--accent); color: white; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">${orderIndex + 1}</span>
                        ${acc.name}
                    </div>`;
                } else {
                    return `
                    <div class="cat-chip" style="user-select: none; padding: 4px 12px; font-size: 12px; border: 1px dashed rgba(255,255,255,0.2); opacity: 0.5; color: var(--text-muted); cursor: pointer;" onclick="window.app.accounts.toggleGeminiApiRuleKey('${model}', ${i})" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
                        + ${acc.name}
                    </div>`;
                }
            }).join('');

            return `
            <div class="settings-card" style="align-items: flex-start; flex-direction: column; gap: 10px; background: rgba(0,0,0,0.25); border-color: rgba(255,255,255,0.05); padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <strong style="color: var(--text); font-family: monospace; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
                            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                            <polyline points="2 17 12 22 22 17"></polyline>
                            <polyline points="2 12 12 17 22 12"></polyline>
                        </svg>
                        ${model}
                    </strong>
                    <button class="btn-icon" style="width: 28px; height: 28px; padding: 0; color: var(--text-muted); background: rgba(255,255,255,0.03);" onclick="window.app.accounts.deleteGeminiApiRule('${model}')" title="Удалить правило">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                
                <!-- Подсказка для пользователя -->
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 2px;">
                    Кликайте по ключам ниже, чтобы задать порядок ротации (1 ➔ 2 ➔ 3):
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${keysHtml || '<span style="color: var(--text-muted); font-size: 12px;">Нет доступных ключей</span>'}
                </div>
            </div>`;
        }).join('');

        rulesList.innerHTML = rulesHtml || '<div style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 16px 0; border: 1px dashed var(--border); border-radius: 10px;">Специфичных правил пока нет. Введите название модели ниже.</div>';
    }

}