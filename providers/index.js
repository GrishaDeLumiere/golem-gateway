const fs = require('fs');
const path = require('path');

function hasAccounts(file) {
    if (fs.existsSync(file)) {
        try {
            const db = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (db.accounts && db.accounts.length > 0) return true;
        } catch (e) { }
    }
    return false;
}

module.exports = function getProviders(port) {
    const deepseekFile = path.join(__dirname, '..', 'deepseek_accounts.json');
    const qwenFile = path.join(__dirname, '..', 'qwen_accounts.json');
    const geminiFile = path.join(__dirname, '..', 'gemini_credentials.json');

    const isDeepSeekAuth = hasAccounts(deepseekFile) || !!(process.env.SESSION_TOKEN && process.env.COOKIES);
    const isQwenAuth = hasAccounts(qwenFile) || !!(process.env.QWEN_TOKEN && process.env.QWEN_COOKIES);

    let isGeminiAuth = false;
    if (fs.existsSync(geminiFile)) {
        try {
            const db = JSON.parse(fs.readFileSync(geminiFile, 'utf8'));
            if (db.accounts && db.accounts.length > 0) isGeminiAuth = true;
            else if (db.token) isGeminiAuth = true;
        } catch (e) { }
    }

    return [
        {
            id: 'deepseek',
            name: 'DeepSeek',
            logo: `<img src="/deepseek.svg" width="32" height="32" alt="DeepSeek">`,
            url: 'https://chat.deepseek.com',
            isAuth: isDeepSeekAuth,
            payload: `let t = (()=>{ let val=localStorage.getItem('userToken'); try{return JSON.parse(val).value;}catch(e){return val;} })(); window.location.href = 'http://127.0.0.1:${port}/receive-payload?token=' + encodeURIComponent(t) + '&cookies=' + encodeURIComponent(document.cookie);`
        },
        {
            id: 'qwen',
            name: 'Qwen Studio',
            logo: `<img src="/qwen.svg" width="32" height="32" style="filter: drop-shadow(0 0 10px rgba(66, 133, 244, 0.4));" alt="Qwen">`,
            url: 'https://chat.qwen.ai',
            isAuth: isQwenAuth,
            payload: `let t = window.__prerendered_data?.user?.token || localStorage.getItem('token') || (document.cookie.match(/token=([^;]+)/)||[])[1] || ''; window.location.href = 'http://127.0.0.1:${port}/receive-qwen-payload?token=' + encodeURIComponent(t) + '&cookies=' + encodeURIComponent(document.cookie);`
        },
        {
            id: 'gemini',
            name: 'Google Gemini',
            logo: `<img src="/gemini.svg" width="32" height="32" style="filter: drop-shadow(0 0 10px rgba(66, 133, 244, 0.4));" alt="Gemini">`,
            url: 'https://gemini.google.com',
            isAuth: isGeminiAuth,
            isOAuth: true,
            payload: `/api/gemini/auth`,
            disabled: false
        }
    ];
};