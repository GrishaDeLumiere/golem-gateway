export class UpdateManager {
    async check() {
        document.getElementById('updateModal').classList.add('active');
        document.getElementById('updateMessageText').innerText = window.t ? window.t('upd_loading', 'Связываемся с сервером...') : 'Связываемся с сервером...';
        document.getElementById('updateLoader').style.display = 'flex';
        document.getElementById('updateVersions').style.display = 'none';
        document.getElementById('changelogContainer').style.display = 'none';
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

            if (data.changelog) {
                document.getElementById('changelogContainer').style.display = 'block';
                document.getElementById('changelogContent').innerHTML = data.changelog;
                if (data.releases) {
                    document.getElementById('releasesContent').innerHTML = data.releases;
                }
                this.switchLogTab('commits');
            }

            actionsDiv.style.opacity = '1';
            actionsDiv.style.pointerEvents = 'auto';

            if (data.updateAvailable) {
                document.getElementById('updateMessageText').innerHTML = window.t('upd_available', 'Доступна новая версия ядра AI Core Gateway.');
                document.getElementById('startUpdateBtn').style.display = 'inline-flex';
                document.getElementById('forceUpdateDiv').style.display = 'none';
                document.getElementById('verLatest').style.color = 'var(--success)';
            } else {
                document.getElementById('updateMessageText').innerHTML = window.t('upd_actual', 'Вы используете самую актуальную версию.');
                document.getElementById('startUpdateBtn').style.display = 'none';
                document.getElementById('forceUpdateDiv').style.display = 'block';
                document.getElementById('verLatest').style.color = 'var(--text-muted)';
            }
        } catch (err) {
            document.getElementById('updateLoader').style.display = 'none';
            document.getElementById('updateMessageText').innerHTML = window.t('upd_error', 'Ошибка связи. Сервер обновлений недоступен.');
            actionsDiv.style.opacity = '1';
            actionsDiv.style.pointerEvents = 'auto';
        }
    }

    switchLogTab(tabName) {
        const btnCommits = document.getElementById('tabCommitsBtn');
        const btnReleases = document.getElementById('tabReleasesBtn');
        const contentCommits = document.getElementById('changelogContent');
        const contentReleases = document.getElementById('releasesContent');

        if (tabName === 'commits') {
            btnCommits.style.color = 'var(--accent)';
            btnCommits.style.fontWeight = '600';
            btnReleases.style.color = 'var(--text-muted)';
            btnReleases.style.fontWeight = 'normal';
            contentCommits.style.display = 'block';
            contentReleases.style.display = 'none';
        } else {
            btnReleases.style.color = 'var(--accent)';
            btnReleases.style.fontWeight = '600';
            btnCommits.style.color = 'var(--text-muted)';
            btnCommits.style.fontWeight = 'normal';
            contentReleases.style.display = 'block';
            contentCommits.style.display = 'none';
        }
    }

    openWindow() {
        window.app.modal.closeAll();
        window.location.href = '/updater';
    }
}