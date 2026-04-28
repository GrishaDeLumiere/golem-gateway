const fs = require('fs');
const path = require('path');

module.exports = function getProviders(port) {
    const geminiAuthFile = path.join(__dirname, 'gemini_credentials.json');
    const isGeminiAuth = fs.existsSync(geminiAuthFile);

    return [
        {
            id: 'deepseek',
            name: 'DeepSeek',
            logo: `<img src="/deepseek.svg" width="32" height="32" alt="DeepSeek">`,
            url: 'https://chat.deepseek.com',
            isAuth: !!(process.env.SESSION_TOKEN && process.env.COOKIES),
            payload: `fetch('http://127.0.0.1:${port}/receive-payload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: (()=>{ let t=localStorage.getItem('userToken'); try{return JSON.parse(t).value;}catch(e){return t;} })(), cookies: document.cookie }) }).then(r => r.text()).then(t => alert('✅ Данные DeepSeek успешно отправлены! Возвращайся в консоль.'));`
        },
        {
            id: 'qwen',
            name: 'Qwen Studio',
            logo: `<img src="/qwen.svg" width="32" height="32" style="filter: drop-shadow(0 0 10px rgba(66, 133, 244, 0.4));" alt="Qwen">`,
            url: 'https://chat.qwen.ai',
            isAuth: !!(process.env.QWEN_COOKIES && process.env.QWEN_TOKEN),
            payload: `const t = window.__prerendered_data?.user?.token || localStorage.getItem('token') || (document.cookie.match(/token=([^;]+)/)||[])[1]; fetch('http://127.0.0.1:${port}/receive-qwen-payload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t, cookies: document.cookie }) }).then(r => r.text()).then(t => alert('✅ Данные Qwen успешно отправлены! Возвращайся в консоль.'));`
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
        },
        {
            id: 'chatgpt',
            name: 'ChatGPT',
            logo: `<img src="/chatgpt.svg" width="32" height="32" alt="ChatGPT">`,
            url: 'https://chatgpt.com',
            isAuth: false,
            payload: `alert('Модуль ChatGPT находится в разработке!');`,
            disabled: true
        }
    ];
};