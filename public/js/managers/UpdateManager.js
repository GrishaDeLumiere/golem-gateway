export class UpdateManager {
    async check() {
        const modal = document.getElementById('updateModal');
        const msgEl = document.getElementById('updateMessageText');
        const loaderEl = document.getElementById('updateLoader');
        const statusDotEl = document.getElementById('updateStatusDot');
        const bannerEl = document.getElementById('updateStatusBanner');
        const versionsEl = document.getElementById('updateVersions');
        const changelogContainer = document.getElementById('changelogContainer');
        const startBtn = document.getElementById('startUpdateBtn');
        const forceBtn = document.getElementById('forceUpdateDiv');
        const actionsDiv = document.getElementById('updateActions');

        modal.classList.add('active');
        msgEl.innerText = window.t ? window.t('upd_loading', 'Связываемся с сервером...') : 'Связываемся с сервером...';
        loaderEl.style.display = 'flex';
        if (statusDotEl) statusDotEl.style.display = 'none';
        if (bannerEl) bannerEl.style.borderColor = 'var(--border)';

        versionsEl.style.display = 'none';
        changelogContainer.style.display = 'none';
        startBtn.style.display = 'none';
        forceBtn.style.display = 'none';

        actionsDiv.style.opacity = '0';
        actionsDiv.style.pointerEvents = 'none';

        try {
            const response = await fetch('/api/check-update');
            const data = await response.json();
            if (!response.ok || data.error) {
                throw new Error(data.error || 'Server error');
            }

            loaderEl.style.display = 'none';
            if (statusDotEl) {
                statusDotEl.style.display = 'block';
                statusDotEl.className = 'pulse-dot auth';
            }

            versionsEl.style.display = 'grid';
            document.getElementById('verCurrent').innerText = 'v' + data.currentVersion;
            document.getElementById('verLatest').innerText = 'v' + data.latestVersion;

            if (data.changelog) {
                changelogContainer.style.display = 'block';
                document.getElementById('changelogContent').innerHTML = data.changelog;
                if (data.releases) {
                    document.getElementById('releasesContent').innerHTML = data.releases;
                }
                this.switchLogTab('commits');
            }

            actionsDiv.style.opacity = '1';
            actionsDiv.style.pointerEvents = 'auto';

            if (data.updateAvailable) {
                msgEl.innerHTML = window.t ? window.t('upd_available', 'Доступна новая версия ядра AI Core Gateway.') : 'Доступна новая версия ядра AI Core Gateway.';
                startBtn.style.display = 'inline-flex';
                forceBtn.style.display = 'none';
                document.getElementById('verLatest').style.color = 'var(--success)';
                if (bannerEl) bannerEl.style.borderColor = 'rgba(16, 185, 129, 0.35)';
            } else {
                msgEl.innerHTML = window.t ? window.t('upd_actual', 'Вы используете самую актуальную версию.') : 'Вы используете самую актуальную версию.';
                startBtn.style.display = 'none';
                forceBtn.style.display = 'inline-flex';
                document.getElementById('verLatest').style.color = 'var(--text-muted)';
                if (bannerEl) bannerEl.style.borderColor = 'rgba(255, 255, 255, 0.08)';
            }
        } catch (err) {
            loaderEl.style.display = 'none';
            if (statusDotEl) {
                statusDotEl.style.display = 'block';
                statusDotEl.className = 'pulse-dot no-auth';
            }
            if (bannerEl) bannerEl.style.borderColor = 'rgba(239, 68, 68, 0.35)';
            msgEl.innerHTML = window.t ? window.t('upd_error', 'Ошибка связи. Сервер обновлений недоступен.') : 'Ошибка связи. Сервер обновлений недоступен.';
            actionsDiv.style.opacity = '1';
            actionsDiv.style.pointerEvents = 'auto';
        }
    }

    switchLogTab(tabName) {
        const btnCommits = document.getElementById('tabCommitsBtn');
        const btnReleases = document.getElementById('tabReleasesBtn');
        const contentCommits = document.getElementById('changelogContent');
        const contentReleases = document.getElementById('releasesContent');

        const isCommits = tabName === 'commits';
        btnCommits.classList.toggle('active', isCommits);
        btnReleases.classList.toggle('active', !isCommits);

        contentCommits.style.display = isCommits ? 'block' : 'none';
        contentReleases.style.display = isCommits ? 'none' : 'block';
    }

    openWindow() {
        window.app.modal.closeAll();
        window.location.href = '/updater';
    }
}