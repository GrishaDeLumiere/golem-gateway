//public/dashboard.js

function openModal(id) {
    const data = window.__PROVIDERS__[id];
    if (!data) return;

    // Базовые данные
    document.getElementById('modalIcon').innerHTML = data.logo;
    document.getElementById('modalTitleText').innerText =
        data.isOAuth ? data.name : 'Авторизация: ' + data.name;

    const stepsDivs = document.querySelectorAll('.step');
    const codeBox = document.querySelector('.code-box');
    const codeEl = document.getElementById('modalCode');
    const actionBtn = document.getElementById('modalActionBtn');

    if (data.isOAuth) {
        // OAuth (например Google / Gemini)
        stepsDivs.forEach(div => div.style.display = 'none');
        codeBox.style.display = 'none';

        actionBtn.innerText = 'Авторизоваться через Google';
        actionBtn.onclick = () => {
            window.location.href = data.payload;
        };
    } else {
        // Обычные провайдеры
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
        document.getElementById('set-chatgpt').checked = settings.providers.chatgpt;
        document.getElementById('set-debug').checked = settings.debugMode;
        document.getElementById('set-gemini').checked = settings.providers.gemini

        document.getElementById('settingsModal').classList.add('active');
    } catch (err) {
        alert('Не удалось загрузить настройки с сервера.');
    }
}

async function saveSettings() {
    const btn = document.querySelector('#settingsModal .btn');
    const originalText = btn.innerText;
    btn.innerText = 'Применение...';
    btn.disabled = true;

    const payload = {
        providers: {
            deepseek: document.getElementById('set-deepseek').checked,
            qwen: document.getElementById('set-qwen').checked,
            chatgpt: document.getElementById('set-chatgpt').checked,
            gemini: document.getElementById('set-gemini').checked
        },
        debugMode: document.getElementById('set-debug').checked
    };

    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        location.reload();
    } catch (err) {
        alert('Ошибка при сохранении конфигурации.');
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

let currentGeminiDb = { active: 0, accounts: [] };
let editingAccountIndex = -1;

const originalOpenModal = openModal;
openModal = function (id) {
    if (id === 'gemini') {
        openGeminiManager();
    } else {
        originalOpenModal(id);
    }
};

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
        currentGeminiDb = await res.json();
        renderGeminiAccounts();
    } catch (e) {
        console.error("Ошибка загрузки аккаунтов Gemini", e);
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
    window.open('/api/gemini/auth', '_blank', 'width=600,height=700');
    setTimeout(fetchGeminiAccounts, 5000);
}

async function saveGeminiDb() {
    await fetch('/api/gemini/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentGeminiDb)
    });
    renderGeminiAccounts();
}

function setActiveGemini(index) {
    currentGeminiDb.active = index;
    saveGeminiDb();
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
