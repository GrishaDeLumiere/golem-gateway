// providers/index.js
const fs = require('fs');
const path = require('path');

module.exports = function getProviders(port) {
    const geminiAuthFile = path.join(__dirname, '..', 'gemini_credentials.json');
    let isGeminiAuth = false;
    if (fs.existsSync(geminiAuthFile)) {
        try {
            const db = JSON.parse(fs.readFileSync(geminiAuthFile, 'utf8'));
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
            isAuth: !!(process.env.SESSION_TOKEN && process.env.COOKIES),
            payload: `let t = (()=>{ let val=localStorage.getItem('userToken'); try{return JSON.parse(val).value;}catch(e){return val;} })(); window.location.href = 'http://127.0.0.1:${port}/receive-payload?token=' + encodeURIComponent(t) + '&cookies=' + encodeURIComponent(document.cookie);`
        },
        {
            id: 'qwen',
            name: 'Qwen Studio',
            logo: `<img src="/qwen.svg" width="32" height="32" style="filter: drop-shadow(0 0 10px rgba(66, 133, 244, 0.4));" alt="Qwen">`,
            url: 'https://chat.qwen.ai',
            isAuth: !!(process.env.QWEN_COOKIES && process.env.QWEN_TOKEN),
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