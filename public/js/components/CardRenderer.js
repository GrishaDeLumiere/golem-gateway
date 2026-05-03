// public/js/components/CardRenderer.js
export class CardRenderer {
    static render(providersMap, settings) {
        const grid = document.querySelector('.grid');
        if (!grid) return;

        const providers = Object.values(providersMap);
        
        const html = providers.map(p => {
            const isDisabledByUser = settings.providers[p.id] === false;
            const isCompletelyDisabled = p.disabled || isDisabledByUser;
            const activeClass = (p.isAuth && !isCompletelyDisabled) ? 'active-card' : (isCompletelyDisabled ? '' : 'error-card');

            let btnText = isCompletelyDisabled ? 'Заблокировано' : (p.isAuth ? 'Управление' : 'Подключить аккаунт');
            let btnI18n = isCompletelyDisabled ? 'btn_blocked' : (p.isAuth ? 'btn_manage' : 'btn_connect');
            let statusText = isCompletelyDisabled ? 'Отключено' : (p.isAuth ? 'Доступ разрешен' : 'Ожидает авторизации');
            let statusI18n = isCompletelyDisabled ? 'status_disabled' : (p.isAuth ? 'status_allowed' : 'status_wait');

            return `
            <div class="card ${isCompletelyDisabled ? 'disabled' : ''} ${activeClass}">
                <div class="card-header">
                    <div class="card-icon">${p.logo}</div>
                    <h3 class="card-title">${p.name}</h3>
                </div>
                <div class="badge-container" style="--pulse-color: ${p.isAuth && !isCompletelyDisabled ? '16,185,129' : '239,68,68'}">
                    <div class="pulse-dot ${p.isAuth && !isCompletelyDisabled ? 'auth' : 'no-auth'}"></div>
                    <span class="status-text" data-i18n="${statusI18n}">${statusText}</span>
                </div>
                <button class="btn ${p.isAuth ? 'btn-secondary' : ''}" onclick="window.app.modal.openProvider('${p.id}')" ${isCompletelyDisabled ? 'disabled' : ''} data-i18n="${btnI18n}">
                    ${btnText}
                </button>
            </div>`;
        }).join('');

        grid.innerHTML = html;
        if (window.applyTranslations) window.applyTranslations(grid);
    }
}