export class ModalManager {
    closeAll(e) {
        if (e && e.target !== e.currentTarget) return;
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
    }

    openProvider(id) {
        const data = window.__PROVIDERS__[id];
        if (id === 'gemini') {
            window.app.accounts.openGeminiManager();
        } else if (data && data.isAuth) {
            window.app.accounts.openGenericManager(id);
        } else {
            this.openBaseAuthModal(id, data);
        }
    }

    openBaseAuthModal(id, data) {
        if (!data) return;
        document.getElementById('modalIcon').innerHTML = data.logo;
        document.getElementById('modalTitleText').innerText = data.isOAuth ? data.name : 'Авторизация: ' + data.name;

        const stepsDivs = document.querySelectorAll('.step');
        const codeBox = document.querySelector('.code-box');
        const actionBtn = document.getElementById('modalActionBtn');

        if (data.isOAuth) {
            stepsDivs.forEach(div => div.style.display = 'none');
            codeBox.style.display = 'none';
            actionBtn.innerText = 'Авторизоваться через Google';
            actionBtn.onclick = () => { window.location.href = data.payload; };
        } else {
            stepsDivs.forEach(div => div.style.display = 'flex');
            codeBox.style.display = 'flex';
            document.getElementById('modalCode').innerText = data.payload;
            actionBtn.innerHTML = `Открыть ${data.name} <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
            actionBtn.onclick = () => { window.open(data.url, '_blank'); };
        }
        document.getElementById('authModal').classList.add('active');
    }

    copySnippet() {
        const code = document.getElementById('modalCode').innerText;
        navigator.clipboard.writeText(code).then(() => {
            this.showToast('Скопировано в буфер обмена');
        }).catch(err => alert('Не удалось скопировать код. Выделите его вручную.'));
    }

    showToast(message) {
        const toast = document.getElementById('toast');
        toast.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ${message}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}