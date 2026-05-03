import { ModalManager } from './core/ModalManager.js';
import { CardRenderer } from './components/CardRenderer.js';
import { SettingsManager } from './managers/SettingsManager.js';
import { AccountManager } from './managers/AccountManager.js';
import { UpdateManager } from './managers/UpdateManager.js';

class Application {
    constructor() {
        this.modal = new ModalManager();
        this.settings = new SettingsManager(this.modal);
        this.accounts = new AccountManager(this.modal);
        this.updater = new UpdateManager();

        this.initGlobals();
        this.setupEventListeners();
    }

    initGlobals() {
        window.app = this;
        
        // Модалки
        window.closeModal = (e) => this.modal.closeAll(e);
        window.copySnippet = () => this.modal.copySnippet();
        
        // Настройки
        window.openSettingsModal = () => this.settings.open();
        window.saveSettings = () => this.settings.save();
        window.switchSettingsTab = (tab, e) => this.settings.switchTab(tab, e || window.event);
        window.toggleAuthFields = () => this.settings.toggleAuthFields();
        window.showNewKeyInput = () => this.settings.showNewKeyInput();
        window.hideNewKeyInput = () => this.settings.hideNewKeyInput();
        window.generateApiKey = () => this.settings.generateApiKey();
        window.togglePasswordVisibility = (id, el) => this.settings.togglePasswordVisibility(id, el);
        
        // Апдейтер
        window.checkUpdateModal = () => this.updater.check();
        window.openUpdaterWindow = () => this.updater.openWindow();

        // Gemini
        window.addGeminiAccount = () => this.accounts.addGeminiAccount();
        window.cancelGeminiEdit = () => this.accounts.cancelGeminiEdit();
        window.saveGeminiEdit = () => this.accounts.saveGeminiEdit();
        window.switchGeminiTab = (tab) => this.accounts.switchGeminiTab(tab);

        // Generic
        window.addGenericAccount = () => this.accounts.addGenericAccount();
        window.cancelGenericEdit = () => this.accounts.cancelGenericEdit();
        window.saveGenericEdit = () => this.accounts.saveGenericEdit();
    }

    async refreshUI() {
        try {
            const res = await fetch('/api/ui-state');
            if (!res.ok) return;
            const state = await res.json();
            
            window.__PROVIDERS__ = state.providersMap;
            CardRenderer.render(state.providersMap, state.settings);

            // Инициализация частиц
            if (window.AmbientBG && state.settings.particles) {
                window.AmbientBG.updateConfig(state.settings.particles);
            }
        } catch (e) {
            console.error("Ошибка авто-обновления дашборда:", e);
        }
    }

    setupEventListeners() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.refreshUI();
                if (document.getElementById('geminiModal').classList.contains('active')) this.accounts.fetchGeminiAccounts();
                if (document.getElementById('genericAccountsModal').classList.contains('active')) this.accounts.fetchGenericAccounts();
            }
        });
    }
}

// Старт приложения при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const app = new Application();
    app.refreshUI();
});