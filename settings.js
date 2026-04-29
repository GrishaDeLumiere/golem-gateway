const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const DEFAULT_SETTINGS = {
    providers: {
        deepseek: true,
        qwen: true,
        chatgpt: false,
        gemini: false
    },
    debugMode: true,
    defaultModel: "deepseek-v4-flash",
    masterApiKey: ""
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