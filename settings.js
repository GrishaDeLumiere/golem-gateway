const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const DEFAULT_SETTINGS = {
    language: "ru_RU",
    providers: {
        deepseek: true,
        qwen: true,
        gemini: true,       // CLI / OAuth
        gemini_api: true    // Official Gemini API (Key-pool)
    },
    providerSettings: {
        gemini: {
            maxRetries: 0,
            retryDelay: 2000
        },
        gemini_api: {
            useInteractions: false,
            sendSafety: true,
            safeHarassment: true,
            safeHate: true,
            safeSex: true,
            safeDanger: true,
            safeCivic: false,
            safeJailbreak: false
        },
        deepseek: {
            showBrowser: false,
            sendThink: true
        }
    },
    debugMode: false,
    defaultModel: "deepseek-v4-flash",
    enableApiKeys: false,
    masterApiKey: "",
    apiKeys: [],
    particles: {
        enabled: true,
        count: 80,
        speed: 0.2,
        maxSize: 1.2,
        connectLines: true,
        lineDistance: 150,
        comets: true
    },
    githubToken: ""
};

function getSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
            const saved = JSON.parse(raw);

            // Аккуратный мердж настроек, чтобы не терять вложенные объекты провайдеров
            return {
                ...DEFAULT_SETTINGS,
                ...saved,
                providers: {
                    ...DEFAULT_SETTINGS.providers,
                    ...(saved.providers || {})
                },
                providerSettings: {
                    ...DEFAULT_SETTINGS.providerSettings,
                    ...(saved.providerSettings || {}),
                    gemini: {
                        ...DEFAULT_SETTINGS.providerSettings.gemini,
                        ...(saved.providerSettings?.gemini || {})
                    },
                    gemini_api: {
                        ...DEFAULT_SETTINGS.providerSettings.gemini_api,
                        ...(saved.providerSettings?.gemini_api || {})
                    },
                    deepseek: {
                        ...DEFAULT_SETTINGS.providerSettings.deepseek,
                        ...(saved.providerSettings?.deepseek || {})
                    }
                },
                particles: {
                    ...DEFAULT_SETTINGS.particles,
                    ...(saved.particles || {})
                }
            };
        }
    } catch (e) {
        console.error('[⚠️ НАСТРОЙКИ] Ошибка чтения settings.json. Использую дефолтные.', e.message);
    }
    return DEFAULT_SETTINGS;
}

function saveSettings(newSettings) {
    const settings = {
        ...getSettings(),
        ...newSettings
    };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return settings;
}

module.exports = { getSettings, saveSettings };