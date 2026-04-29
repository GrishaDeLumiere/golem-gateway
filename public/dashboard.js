//public/dashboard.js
// 1. Основная логика обычных провайдеров
function baseOpenModal(id) {
    const data = window.__PROVIDERS__[id];
    if (!data) return;

    document.getElementById('modalIcon').innerHTML = data.logo;
    document.getElementById('modalTitleText').innerText =
        data.isOAuth ? data.name : 'Авторизация: ' + data.name;

    const stepsDivs = document.querySelectorAll('.step');
    const codeBox = document.querySelector('.code-box');
    const codeEl = document.getElementById('modalCode');
    const actionBtn = document.getElementById('modalActionBtn');

    if (data.isOAuth) {
        stepsDivs.forEach(div => div.style.display = 'none');
        codeBox.style.display = 'none';

        actionBtn.innerText = 'Авторизоваться через Google';
        actionBtn.onclick = () => {
            window.location.href = data.payload;
        };
    } else {
        stepsDivs.forEach(div => div.style.display = 'flex');
        codeBox.style.display = 'flex';

        codeEl.innerText = data.payload;

        actionBtn.innerHTML = `
            Открыть ${data.name}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
        `;
        actionBtn.onclick = () => {
            window.open(data.url, '_blank');
        };
    }

    document.getElementById('authModal').classList.add('active');
}

// 2. ГЛАВНАЯ ФУНКЦИЯ-РАСПРЕДЕЛИТЕЛЬ
function openModal(id) {
    const data = window.__PROVIDERS__[id];
    if (id === 'gemini') {
        openGeminiManager();
    } else if (data && data.isAuth) {
        openGenericManager(id);
    } else {
        baseOpenModal(id);
    }
}

function closeModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
}

function copySnippet() {
    const code = document.getElementById('modalCode').innerText;
    navigator.clipboard.writeText(code).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }).catch(err => {
        alert('Не удалось скопировать код. Выделите его вручную.');
    });
}

async function openSettingsModal() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();

        document.getElementById('set-deepseek').checked = settings.providers.deepseek;
        document.getElementById('set-qwen').checked = settings.providers.qwen;
        document.getElementById('set-debug').checked = settings.debugMode;
        document.getElementById('set-gemini').checked = settings.providers.gemini;
        document.getElementById('set-default-model').value = settings.defaultModel || 'deepseek-v4-flash';
        document.getElementById('set-api-key').value = settings.masterApiKey || '';

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

        // Новые поля
        document.getElementById('set-enable-auth').checked = settings.enableApiKeys || false;
        toggleAuthFields();

        currentApiKeys = settings.apiKeys || [];
        renderApiKeys();
        hideNewKeyInput();

        document.getElementById('settingsModal').classList.add('active');
    } catch (err) {
        alert('Не удалось загрузить настройки с сервера.');
    }
}


async function saveSettings() {
    const btn = document.getElementById('saveSetBtn');
    const originalText = btn.innerText;
    btn.innerText = 'Применение...';
    btn.disabled = true;

    const payload = {
        providers: {
            deepseek: document.getElementById('set-deepseek').checked,
            qwen: document.getElementById('set-qwen').checked,
            gemini: document.getElementById('set-gemini').checked
        },
        debugMode: document.getElementById('set-debug').checked,
        defaultModel: document.getElementById('set-default-model').value,
        enableApiKeys: document.getElementById('set-enable-auth').checked,
        masterApiKey: document.getElementById('set-api-key').value.trim(),
        apiKeys: currentApiKeys,
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
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const stateRes = await fetch('/api/ui-state');
        const state = await stateRes.json();

        document.querySelector('.grid').innerHTML = state.html;

        window.__PROVIDERS__ = state.providersMap;

        closeModal();
        const toast = document.getElementById('toast');
        toast.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Конфигурация ядра обновлена`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);

    } catch (err) {
        alert('Ошибка при сохранении конфигурации.');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function switchSettingsTab(tabId) {
    document.querySelectorAll('.settings-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
    document.querySelectorAll('.settings-section').forEach(sec => {
        sec.classList.remove('active');
    });
    document.getElementById('tab-' + tabId).classList.add('active');
}


// --- GEMINI ACCOUNTS MANAGER ---
async function openGeminiManager() {
    document.getElementById('geminiModal').classList.add('active');

    // Сбрасываем виды (показываем список, прячем редактор)
    const listSec = document.getElementById('geminiAccountsSection');
    const editSec = document.getElementById('geminiEditorSection');

    listSec.style.display = 'block';
    editSec.style.display = 'none';

    // Перезапуск анимации
    listSec.classList.remove('animated-view');
    void listSec.offsetWidth; // trigger reflow
    listSec.classList.add('animated-view');

    await fetchGeminiAccounts();
}

async function fetchGeminiAccounts() {
    try {
        const res = await fetch('/api/gemini/accounts');
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

        currentGeminiDb = await res.json();
        renderGeminiAccounts();
    } catch (e) {
        console.error("Ошибка загрузки аккаунтов Gemini:", e);
        currentGeminiDb = { active: 0, accounts: [] };
        renderGeminiAccounts();
    }
}

function renderGeminiAccounts() {
    const listEl = document.getElementById('geminiAccountsList');
    listEl.innerHTML = '';

    if (!currentGeminiDb.accounts || currentGeminiDb.accounts.length === 0) {
        listEl.innerHTML = `
 <div style="text-align: center; padding: 60px 20px; border: 1px dashed #27272a; border-radius: 12px; margin-top: 12px;">
 <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" stroke-width="1.5" style="margin-bottom: 16px;">
 <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
 <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
 </svg>
 <p style="color: #a1a1aa; margin: 0; font-size: 15px;">База данных пуста.<br>Добавьте первый профиль для работы с Gemini.</p>
 </div>`;
        return;
    }

    currentGeminiDb.accounts.forEach((acc, index) => {
        const isActive = currentGeminiDb.active === index;
        const hasProjectId = acc.project_id && acc.project_id.trim() !== "";

        // Берем имя из БД, если нет - ставим по умолчанию
        const profileName = acc.name || `Профиль #${index + 1}`;
        const activeClass = isActive ? 'active-gemini-item' : '';

        const projectStatus = hasProjectId
            ? `project_id: "${acc.project_id}"`
            : `<div style="color: #ef4444; background: rgba(239,68,68,0.1); padding: 8px 12px; border-radius: 8px; margin-top: 6px; font-family: -apple-system, sans-serif;">
 <strong style="display: block; margin-bottom: 4px;">⚠️ Требуется настройка Project ID</strong>
 <span style="color: #fca5a5; font-size: 12px;">1. Откройте Google Cloud Console<br>2. Скопируйте ID проекта (слева сверху)<br>3. Нажмите кнопку «Настроить» и вставьте его</span>
 </div>`;

        const html = `
 <div class="setting-item ${activeClass}" style="margin-bottom: 12px; cursor: pointer;" onclick="setActiveGemini(${index})">
 <label class="gemini-radio" title="Активировать профиль">
 <input type="radio" name="activeGemini" ${isActive ? 'checked' : ''} onclick="event.stopPropagation()">
 <span class="radio-mark"></span>
 </label>

 <div class="setting-info" style="flex: 1; padding: 0 16px;">
 <h4 style="margin: 0 0 4px 0; font-size: 15px; color: var(--text);">${profileName}</h4>
 <div style="font-size: 13px; font-family: monospace; color: var(--text-muted);">${projectStatus}</div>
 </div>

 <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
 <button class="btn btn-icon" onclick="editGeminiAccount(${index})" title="Настроить">
 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
 </button>
 <button class="btn btn-icon btn-danger-flat" onclick="deleteGeminiAccount(${index})" title="Удалить">
 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
 </button>
 </div>
 </div>`;
        listEl.insertAdjacentHTML('beforeend', html);
    });
}

function addGeminiAccount() {
    window.open('/api/gemini/auth', 'geminiAuthPopup', 'width=600,height=700');
    const onWindowFocus = () => {
        fetchGeminiAccounts();
        window.removeEventListener('focus', onWindowFocus);
    };
    window.addEventListener('focus', onWindowFocus);
}

async function saveGeminiDb() {
    await fetch('/api/gemini/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentGeminiDb)
    });
    renderGeminiAccounts();
}

async function setActiveGemini(index) {
    currentGeminiDb.active = index;
    await saveGeminiDb();

    const toast = document.getElementById('toast');
    toast.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Профиль изменен';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function deleteGeminiAccount(index) {
    if (!confirm("Удалить этот профиль безвозвратно?")) return;
    currentGeminiDb.accounts.splice(index, 1);
    if (currentGeminiDb.active >= currentGeminiDb.accounts.length) currentGeminiDb.active = 0;
    saveGeminiDb();
}

function cancelGeminiEdit() {
    const listSec = document.getElementById('geminiAccountsSection');
    const editSec = document.getElementById('geminiEditorSection');

    editSec.style.display = 'none';
    listSec.style.display = 'block';

    // Анимация возврата к списку
    listSec.classList.remove('animated-view');
    void listSec.offsetWidth;
    listSec.classList.add('animated-view');

    editingAccountIndex = -1;
}

// Открытие редактора (заполнение инпутов)
function editGeminiAccount(index) {
    editingAccountIndex = index;
    let acc = currentGeminiDb.accounts[index];

    // Заполняем поля значениями из БД
    document.getElementById('geminiInputName').value = acc.name || `Профиль #${index + 1}`;
    document.getElementById('geminiInputProjectId').value = acc.project_id || "";

    const listSec = document.getElementById('geminiAccountsSection');
    const editSec = document.getElementById('geminiEditorSection');

    listSec.style.display = 'none';
    editSec.style.display = 'block';

    // Анимация
    editSec.classList.remove('animated-view');
    void editSec.offsetWidth;
    editSec.classList.add('animated-view');
}

// Сохранение изменений из инпутов
function saveGeminiEdit() {
    if (editingAccountIndex === -1) return;

    const newName = document.getElementById('geminiInputName').value.trim();
    const newProjectId = document.getElementById('geminiInputProjectId').value.trim();

    // Обновляем ТОЛЬКО нужные поля (токены не трогаются)
    currentGeminiDb.accounts[editingAccountIndex].name = newName || `Профиль #${editingAccountIndex + 1}`;
    currentGeminiDb.accounts[editingAccountIndex].project_id = newProjectId;

    saveGeminiDb();
    cancelGeminiEdit();

    const toast = document.getElementById('toast');
    toast.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Настройки профиля сохранены';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        btnEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    } else {
        input.type = "password";
        btnEl.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    }
}

// --- МЕНЕДЖЕР ПРОФИЛЕЙ DEEPSEEK / QWEN ---
let currentProviderId = null;
let currentProviderDb = { active: 0, accounts: [] };
let genericEditingIndex = -1;
let isGenericManagerLocked = false; // Флаг блокировки интерфейса

async function openGenericManager(id) {
    currentProviderId = id;
    const data = window.__PROVIDERS__[id];

    document.getElementById('genericAccountsIcon').innerHTML = data.logo;
    document.getElementById('genericAccountsTitle').innerText = 'Аккаунты: ' + data.name;
    document.getElementById('genericAccountsModal').classList.add('active');

    const listSec = document.getElementById('genericAccountsSection');
    const editSec = document.getElementById('genericEditorSection');

    listSec.style.display = 'block';
    editSec.style.display = 'none';
    listSec.classList.remove('animated-view');
    void listSec.offsetWidth;
    listSec.classList.add('animated-view');

    await fetchGenericAccounts();
}

async function fetchGenericAccounts() {
    try {
        const res = await fetch(`/api/${currentProviderId}/accounts`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        currentProviderDb = await res.json();
        renderGenericAccounts();
    } catch (e) {
        console.error(`Ошибка загрузки аккаунтов ${currentProviderId}:`, e);
        currentProviderDb = { active: 0, accounts: [] };
        renderGenericAccounts();
    }
}

function renderGenericAccounts() {
    const listEl = document.getElementById('genericAccountsList');
    listEl.innerHTML = '';

    const addBtn = document.querySelector('#genericAccountsSection .btn-primary-solid');
    if (addBtn) {
        addBtn.disabled = isGenericManagerLocked;
        addBtn.style.opacity = isGenericManagerLocked ? '0.5' : '1';
        addBtn.style.cursor = isGenericManagerLocked ? 'not-allowed' : 'pointer';
    }

    if (!currentProviderDb.accounts || currentProviderDb.accounts.length === 0) {
        listEl.innerHTML = `
 <div style="text-align: center; padding: 60px 20px; border: 1px dashed #27272a; border-radius: 12px; margin-top: 12px;">
 <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3f3f46" stroke-width="1.5" style="margin-bottom: 16px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
 <p style="color: #a1a1aa; margin: 0; font-size: 15px;">База данных пуста.<br>Добавьте сессию с помощью скрипта перехвата.</p>
 </div>`;
        return;
    }

    currentProviderDb.accounts.forEach((acc, index) => {
        const isActive = currentProviderDb.active === index;
        const profileName = acc.name || `Профиль #${index + 1}`;
        const activeClass = isActive ? 'active-gemini-item' : '';

        const tokenInfo = acc.token ? `token: ${acc.token.substring(0, 6)}...${acc.token.slice(-4)}` : "Нет токена (ошибка базы?)";

        const opacityStyle = isGenericManagerLocked ? 'opacity: 0.5; pointer-events: none;' : '';
        const cursorStyle = isGenericManagerLocked ? 'cursor: wait;' : 'cursor: pointer;';
        const disabledAttr = isGenericManagerLocked ? 'disabled' : '';

        const loadIndicator = (isGenericManagerLocked && isActive)
            ? `<span class="pulse-dot auth" style="display:inline-block; margin-left: 8px; transform: scale(0.8);"></span>`
            : '';

        const html = `
 <div class="setting-item ${activeClass}" style="margin-bottom: 12px; ${cursorStyle} ${opacityStyle}" onclick="${isGenericManagerLocked ? '' : `setActiveGeneric(${index})`}">
 <label class="gemini-radio" title="Активировать профиль">
 <input type="radio" name="activeGeneric" ${isActive ? 'checked' : ''} onclick="event.stopPropagation()" ${disabledAttr}>
 <span class="radio-mark"></span>
 </label>

 <div class="setting-info" style="flex: 1; padding: 0 16px;">
 <h4 style="margin: 0 0 4px 0; font-size: 15px; color: var(--text); display: flex; align-items: center;">
 ${profileName} ${loadIndicator}
 </h4>
 <div style="font-size: 13px; font-family: monospace; color: var(--text-muted);">${tokenInfo}</div>
 </div>

 <div style="display: flex; gap: 8px;" onclick="event.stopPropagation()">
 <button class="btn btn-icon" onclick="editGenericAccount(${index})" title="Переименовать" ${disabledAttr}>
 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
 </button>
 <button class="btn btn-icon btn-danger-flat" onclick="deleteGenericAccount(${index})" title="Удалить" ${disabledAttr}>
 <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
 </button>
 </div>
 </div>`;
        listEl.insertAdjacentHTML('beforeend', html);
    });
}

function addGenericAccount() {
    if (isGenericManagerLocked) return;
    document.getElementById('genericAccountsModal').classList.remove('active');
    baseOpenModal(currentProviderId);
}

async function saveGenericDb() {
    await fetch(`/api/${currentProviderId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentProviderDb)
    });
}

async function setActiveGeneric(index) {
    if (isGenericManagerLocked || currentProviderDb.active === index) return;

    isGenericManagerLocked = true;
    currentProviderDb.active = index;
    renderGenericAccounts();

    try {
        await saveGenericDb();

        await new Promise(r => setTimeout(r, 5000));

        const toast = document.getElementById('toast');
        toast.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Профиль успешно переключен';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 5000);

    } catch (e) {
        alert('Сбой сети при сохранении настроек!');
    } finally {
        isGenericManagerLocked = false;
        renderGenericAccounts();
    }
}

async function deleteGenericAccount(index) {
    if (isGenericManagerLocked) return;
    if (!confirm("Удалить этот профиль безвозвратно?")) return;

    isGenericManagerLocked = true;
    renderGenericAccounts();

    try {
        currentProviderDb.accounts.splice(index, 1);
        if (currentProviderDb.active >= currentProviderDb.accounts.length) currentProviderDb.active = 0;

        await saveGenericDb();
        await new Promise(r => setTimeout(r, 1500));
    } finally {
        isGenericManagerLocked = false;
        renderGenericAccounts();
    }
}

function cancelGenericEdit() {
    const listSec = document.getElementById('genericAccountsSection');
    const editSec = document.getElementById('genericEditorSection');

    editSec.style.display = 'none';
    listSec.style.display = 'block';

    listSec.classList.remove('animated-view');
    void listSec.offsetWidth;
    listSec.classList.add('animated-view');

    genericEditingIndex = -1;
}

function editGenericAccount(index) {
    if (isGenericManagerLocked) return;

    genericEditingIndex = index;
    let acc = currentProviderDb.accounts[index];

    document.getElementById('genericInputName').value = acc.name || `Профиль #${index + 1}`;

    const listSec = document.getElementById('genericAccountsSection');
    const editSec = document.getElementById('genericEditorSection');

    listSec.style.display = 'none';
    editSec.style.display = 'block';

    editSec.classList.remove('animated-view');
    void editSec.offsetWidth;
    editSec.classList.add('animated-view');
}

async function saveGenericEdit() {
    if (genericEditingIndex === -1) return;

    const newName = document.getElementById('genericInputName').value.trim();
    currentProviderDb.accounts[genericEditingIndex].name = newName || `Профиль #${genericEditingIndex + 1}`;

    isGenericManagerLocked = true;
    cancelGenericEdit();
    renderGenericAccounts();

    try {
        await saveGenericDb();
        const toast = document.getElementById('toast');
        toast.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Имя профиля сохранено';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    } finally {
        isGenericManagerLocked = false;
        renderGenericAccounts();
    }
}

// --- ЛОГИКА ОБНОВЛЕНИЯ (С ПРОВЕРКОЙ) ---
async function checkUpdateModal() {
    document.getElementById('updateModal').classList.add('active');

    document.getElementById('updateMessageText').innerText = 'Связываемся с репозиторием GitHub...';
    document.getElementById('updateLoader').style.display = 'flex';
    document.getElementById('updateVersions').style.display = 'none';
    document.getElementById('startUpdateBtn').style.display = 'none';
    document.getElementById('forceUpdateDiv').style.display = 'none';

    const actionsDiv = document.getElementById('updateActions');
    actionsDiv.style.opacity = '0';
    actionsDiv.style.pointerEvents = 'none';

    try {
        const response = await fetch('/api/check-update');
        const data = await response.json();
        document.getElementById('updateLoader').style.display = 'none';
        document.getElementById('updateVersions').style.display = 'flex';
        document.getElementById('verCurrent').innerText = 'v' + data.currentVersion;
        document.getElementById('verLatest').innerText = 'v' + data.latestVersion;

        actionsDiv.style.opacity = '1';
        actionsDiv.style.pointerEvents = 'auto';

        if (data.updateAvailable) {
            document.getElementById('updateMessageText').innerHTML = 'Доступна новая версия ядра <b>AI Core Gateway</b>.';
            document.getElementById('startUpdateBtn').style.display = 'inline-flex';
            document.getElementById('forceUpdateDiv').style.display = 'none';
            document.getElementById('verLatest').style.color = 'var(--success)';
        } else {
            document.getElementById('updateMessageText').innerHTML = 'Вы используете самую актуальную версию.';
            document.getElementById('startUpdateBtn').style.display = 'none';
            document.getElementById('forceUpdateDiv').style.display = 'block';
            document.getElementById('verLatest').style.color = 'var(--text-muted)';
        }
    } catch (err) {
        document.getElementById('updateLoader').style.display = 'none';
        document.getElementById('updateMessageText').innerHTML = '<span style="color:var(--error)">Ошибка связи. Сервер обновлений недоступен.</span>';
        actionsDiv.style.opacity = '1';
        actionsDiv.style.pointerEvents = 'auto';
    }
}

function openUpdaterWindow() {
    closeModal();
    window.location.href = '/updater';
}

// --- УПРАВЛЕНИЕ API КЛЮЧАМИ ---

let currentApiKeys = [];

function toggleAuthFields() {
    const isEnabled = document.getElementById('set-enable-auth').checked;
    const container = document.getElementById('auth-fields-container');
    if (isEnabled) {
        container.style.opacity = '1';
        container.style.pointerEvents = 'auto';
    } else {
        container.style.opacity = '0.4';
        container.style.pointerEvents = 'none';
    }
}

function showNewKeyInput() {
    document.getElementById('new-key-container').style.display = 'flex';
    document.getElementById('new-key-name').focus();
}

function hideNewKeyInput() {
    document.getElementById('new-key-container').style.display = 'none';
    document.getElementById('new-key-name').value = '';
}

function generateApiKey() {
    const nameInput = document.getElementById('new-key-name');
    const name = nameInput.value.trim();
    if (!name) {
        nameInput.focus();
        return;
    }

    const randomHex = [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    const newKey = 'sk-core-' + randomHex;

    currentApiKeys.push({
        id: Date.now().toString(),
        name: name,
        key: newKey,
        createdAt: Date.now()
    });

    renderApiKeys();
    hideNewKeyInput();

    const toast = document.getElementById('toast');
    toast.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Токен "${name}" ожидает сохранения`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

function deleteApiKey(id) {
    const index = currentApiKeys.findIndex(k => k.id === id);
    if (index === -1) return;
    currentApiKeys.splice(index, 1);
    renderApiKeys();
}

function renderApiKeys() {
    const listEl = document.getElementById('api-keys-list');
    listEl.innerHTML = '';

    if (currentApiKeys.length === 0) {
        listEl.innerHTML = `<div style="text-align: center; padding: 16px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 10px; color: var(--text-muted); font-size: 13px;">Нет сгенерированных токенов</div>`;
        return;
    }

    [...currentApiKeys].reverse().forEach((k) => {
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
 <button class="btn-icon" onclick="copyToClipboard('${k.key}')" title="Копировать">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
 </button>
 <button class="btn-icon btn-danger-flat" onclick="deleteApiKey('${k.id}')" title="Удалить">
 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
 </button>
 </div>
 </div>
 `;
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('toast');
        toast.innerHTML = ' Токен скопирован';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }).catch(err => alert('Сбой копирования'));
}

// Инициализация частиц при загрузке
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        if (window.AmbientBG && settings.particles) {
            window.AmbientBG.updateConfig(settings.particles);
        }
    } catch (e) { }
});