const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const DEFAULT_SETTINGS = {
    providers: {
        deepseek: true,
        qwen: true,
        gemini: true
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
    }
};

function getSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        }
    } catch (e) {
        console.error('[⚠️ НАСТРОЙКИ] Ошибка чтения. Использую дефолтные.');
    }
    return DEFAULT_SETTINGS;
}

function saveSettings(newSettings) {
    const settings = { ...getSettings(), ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return settings;
}

module.exports = { getSettings, saveSettings };