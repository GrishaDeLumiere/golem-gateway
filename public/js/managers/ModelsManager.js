export class ModelsManager {
    constructor(modalManager) {
        this.modal = modalManager;
        this.models = [];
        this.currentCategory = 'all';
    }

    async open() {
        document.getElementById('modelsModal').classList.add('active');
        await this.load();
    }

    async load() {
        const listEl = document.getElementById('modelsModalList');
        if (!listEl) return;
        listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">Загрузка активных моделей...</div>`;

        try {
            const res = await fetch('/api/models-catalog');
            const data = await res.json();
            this.models = data.data || [];
            this.updateCounts();
            this.filter();
        } catch (e) {
            listEl.innerHTML = `<div style="color: var(--error); text-align: center; padding: 30px;">Ошибка загрузки моделей: ${e.message}</div>`;
        }
    }

    updateCounts() {
        const counts = {
            all: this.models.length,
            'Gemini Official API': this.models.filter(m => m.provider.includes('Official')).length,
            'Gemini CLI': this.models.filter(m => m.provider.includes('CLI')).length,
            'DeepSeek': this.models.filter(m => m.provider.includes('DeepSeek')).length,
            'Qwen Studio': this.models.filter(m => m.provider.includes('Qwen')).length,
        };

        const el = (id) => document.getElementById(id);
        if (el('count-all')) el('count-all').innerText = counts.all;
        if (el('count-gemini-api')) el('count-gemini-api').innerText = counts['Gemini Official API'];
        if (el('count-gemini-cli')) el('count-gemini-cli').innerText = counts['Gemini CLI'];
        if (el('count-deepseek')) el('count-deepseek').innerText = counts['DeepSeek'];
        if (el('count-qwen')) el('count-qwen').innerText = counts['Qwen Studio'];
    }

    setCategory(category, btnEl) {
        this.currentCategory = category;
        document.querySelectorAll('.cat-chip').forEach(el => el.classList.remove('active'));
        btnEl.classList.add('active');
        this.filter();
    }

    filter() {
        const query = (document.getElementById('modelsGlobalSearch')?.value || '').toLowerCase().trim();
        let filtered = this.models;

        if (this.currentCategory !== 'all') {
            filtered = filtered.filter(m => m.provider.toLowerCase().includes(this.currentCategory.toLowerCase()));
        }

        if (query) {
            filtered = filtered.filter(m => m.id.toLowerCase().includes(query) || m.prefixId.toLowerCase().includes(query) || m.provider.toLowerCase().includes(query));
        }

        this.render(filtered);
    }

    render(models) {
        const listEl = document.getElementById('modelsModalList');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (models.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 40px;">Моделей не найдено.</div>`;
            return;
        }

        models.forEach(m => {
            let badgeBg = 'rgba(255,255,255,0.08)';
            let badgeColor = 'var(--text)';

            if (m.provider.includes('Official')) {
                badgeBg = 'rgba(16, 185, 129, 0.15)';
                badgeColor = '#34d399';
            } else if (m.provider.includes('CLI')) {
                badgeBg = 'rgba(97, 92, 237, 0.15)';
                badgeColor = '#a78bfa';
            } else if (m.provider.includes('DeepSeek')) {
                badgeBg = 'rgba(59, 130, 246, 0.15)';
                badgeColor = '#60a5fa';
            } else if (m.provider.includes('Qwen')) {
                badgeBg = 'rgba(245, 158, 11, 0.15)';
                badgeColor = '#fbbf24';
            }

            listEl.innerHTML += `
            <div class="model-card-item">
              <div style="display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-family: monospace; font-size: 14px; font-weight: 600; color: var(--text);">${m.id}</span>
                  <span style="font-size: 11px; padding: 2px 8px; border-radius: 6px; background: ${badgeBg}; color: ${badgeColor}; font-weight: 600;">${m.provider}</span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted);">
                  Префикс для клиента: <code style="color: var(--success); font-family: monospace;">${m.prefixId}</code>
                </div>
              </div>
              <button class="btn btn-secondary" style="width: auto; padding: 8px 14px; font-size: 12px; min-height: unset; flex-shrink: 0;" onclick="window.app.models.copyPrefix('${m.prefixId}')">
                Копировать ID
              </button>
            </div>`;
        });
    }

    copyPrefix(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.modal.showToast(`Скопировано: ${text}`);
        });
    }
}