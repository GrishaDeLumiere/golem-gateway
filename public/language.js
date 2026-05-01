// public/language.js
window.currentI18n = {};

window.initLanguage = async function() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        const lang = settings.language || 'ru_RU';
        const langRes = await fetch(`/locales/${lang}.json`);
        window.currentI18n = await langRes.json();
        window.applyTranslations();
    } catch (e) {
        console.error('[i18n] Ошибка загрузки локализации:', e);
    }
};

window.applyTranslations = function(rootNode = document) {
    rootNode.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (window.currentI18n[key]) {
            if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                el.placeholder = window.currentI18n[key];
            } else {
                el.innerHTML = window.currentI18n[key];
            }
        }
    });
};

window.t = function(key, fallbackText) {
    return window.currentI18n[key] || fallbackText;
};

document.addEventListener('DOMContentLoaded', window.initLanguage);