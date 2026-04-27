function openModal(id) {
    const data = window.__PROVIDERS__[id];
    if (!data) return;

    document.getElementById('modalIcon').innerHTML = data.logo;
    document.getElementById('modalTitleText').innerText = 'Авторизация: ' + data.name;
    document.getElementById('modalCode').innerText = data.payload;

    const actionBtn = document.getElementById('modalActionBtn');
    actionBtn.onclick = () => window.open(data.url, '_blank');
    actionBtn.innerHTML = 'Открыть ' + data.name + ' <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';

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