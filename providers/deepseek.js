// providers/deepseek.js

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { PORT } = require('../config');

const AuthInstaller = require('../authInstaller');
const { renderSearchBlock } = require('../searchRenderer');

puppeteer.use(StealthPlugin());

let browser;
let page;
let isInitializing = false;
let currentPort = PORT;
let isBrowserBusy = false;
let currentRequestId = 0;
const networkStreamEvents = new EventEmitter();

const MODELS = [
    { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-flash-search", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-flash-think", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-flash-search-think", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-pro-search", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-pro-think", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-v4-pro-search-think", object: "model", owned_by: "deepseek-system" }
];

function openInDefaultBrowser(url) {
    const platform = process.platform;
    if (platform === 'win32') exec(`start "" "${url}"`);
    else if (platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
}

function updateEnv(key, value) {
    const envPath = path.resolve(__dirname, '../.env');
    if (!fs.existsSync(envPath)) fs.writeFileSync(envPath, '');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    const target = new RegExp(`^${key}=.*`, 'm');
    if (target.test(envContent)) envContent = envContent.replace(target, `${key}=${value}`);
    else envContent += `\n${key}=${value}`;
    fs.writeFileSync(envPath, envContent.trim());
    process.env[key] = value;
}

function renewAuth() {
    console.log('\n[!] DeepSeek: ВНИМАНИЕ: Токен мертв или отсутствует.');
    console.log(`[*] DeepSeek: Открываю локальную страницу авторизации...`);
    openInDefaultBrowser(`http://127.0.0.1:${currentPort}/install-auth`);
}

async function initProvider(port = PORT) {
    currentPort = port;
    isInitializing = true;

    if (!process.env.SESSION_TOKEN || !process.env.COOKIES) {
        renewAuth();
        return;
    }

    console.log('\n[*] DeepSeek: Создаем голема в тенях...');
    browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.exposeFunction('emitChunkToNode', (text) => networkStreamEvents.emit('chunk', text));
    await page.exposeFunction('emitEndToNode', () => networkStreamEvents.emit('end'));

    await page.evaluateOnNewDocument(() => {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._isVampTarget = (typeof url === 'string' && url.includes('completion'));
            return originalOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            if (this._isVampTarget) {
                let lastLength = 0;
                this.addEventListener('readystatechange', function () {
                    try {
                        if (this.readyState === 3 || this.readyState === 4) {
                            const text = this.responseText || (typeof this.response === 'string' ? this.response : '');
                            if (text) {
                                const newDelta = text.substring(lastLength);
                                lastLength = text.length;
                                if (newDelta && window.emitChunkToNode) window.emitChunkToNode(newDelta);
                            }
                        }
                    } catch (e) { }
                    if (this.readyState === 4 && window.emitEndToNode) window.emitEndToNode();
                });
            }
            return originalSend.apply(this, arguments);
        };
    });

    const cookiesRaw = process.env.COOKIES || '';
    if (cookiesRaw) {
        const cookies = cookiesRaw.split(';').map(pair => {
            const index = pair.indexOf('=');
            if (index === -1) return null;
            return { name: pair.substring(0, index).trim(), value: pair.substring(index + 1).trim(), domain: '.deepseek.com', path: '/' };
        }).filter(c => c !== null);
        await page.setCookie(...cookies);
    }

    if (process.env.SESSION_TOKEN) {
        await page.evaluateOnNewDocument((tokenText) => {
            let t = tokenText.replace(/^['"]|['"]$/g, '');
            try { let parsed = JSON.parse(t); if (parsed.value) t = parsed.value; } catch (e) { }
            localStorage.setItem('userToken', JSON.stringify({ value: t, __version: "0" }));
        }, process.env.SESSION_TOKEN);
    }

    console.log(`[*] DeepSeek: Открываем основную сцену...`);
    await page.goto('https://chat.deepseek.com', { waitUntil: 'networkidle2' });

    if (page.url().includes('sign_in')) {
        console.error('[!] DeepSeek: Сессия протухла. Начинаю сброс...');
        await browser.close();
        browser = null;
        renewAuth();
        return;
    }

    isInitializing = false;
    console.log('[+] DeepSeek: Голем на позиции. Стерильный алгоритм активен.');
}

function setupRoutes(app, port) {
    const authSetupInfoPage = new AuthInstaller(port);
    authSetupInfoPage.setup(app);

    app.post('/receive-payload', async (req, res) => {
        const { token, cookies } = req.body;
        if (token && cookies) {
            updateEnv('SESSION_TOKEN', token.replace(/(^"|"$)/g, ''));
            updateEnv('COOKIES', cookies);
            console.log('\n[+] DeepSeek: ПЕЙЛОАД ПЕРЕХВАЧЕН! Токен сохранен.');
            res.send('OK');
            if (browser) await browser.close().catch(() => { }).finally(() => browser = null);
            await initProvider(currentPort);
        } else {
            res.status(400).send('Ошибка данных');
        }
    });
}

async function handleChatCompletion(req, res) {
    if (isInitializing || !page || page.isClosed()) {
        return res.status(503).json({ error: { message: "Провайдер DeepSeek инициализируется.", type: "server_loading" } });
    }

    const isStream = req.body.stream;
    let requestedModel = req.body.model || "deepseek-v4-flash";
    if (isStream) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.flushHeaders();
    }

    currentRequestId++;
    const myRequestId = currentRequestId;

    let isClientDisconnected = false;
    let isFinished = false;

    res.on('close', () => {
        isClientDisconnected = true;
    });

    const checkAborted = () => {
        if (myRequestId !== currentRequestId) return 'REROLL (Пришел новый запрос)';
        if (isClientDisconnected && !isFinished) return 'STOP (Клиент разорвал соединение)';
        return false;
    };

    // --- 1. СИСТЕМА ОЧЕРЕДИ ---
    let queueWait = 0;
    while (isBrowserBusy) {
        const abortReason = checkAborted();
        if (abortReason) {
            console.log(`[!] Запрос [ID: ${myRequestId}] отменен в очереди. Причина: ${abortReason}`);
            if (isStream && !res.writableEnded) res.end();
            return;
        }
        await new Promise(r => setTimeout(r, 500));
        queueWait += 500;
        if (isStream && queueWait % 5000 === 0 && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ id: "ping", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {} }] })}\n\n`);
        }
    }

    // --- 2. ЗАНИМАЕМ БРАУЗЕР ---
    isBrowserBusy = true;

    let sseBuffer = '';
    let searchResults = [];
    let isThinkingContext = false;
    let fullAnswer = '';

    const handleChunk = (rawText) => {
        if (checkAborted()) return;
        sseBuffer += rawText;
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
            let cleanLine = line.trim();
            if (!cleanLine) continue;

            if (cleanLine.startsWith('event: close')) { isFinished = true; continue; }
            if (cleanLine.startsWith('data:')) cleanLine = cleanLine.replace(/^data:\s*/, '');
            else continue;

            if (cleanLine === '[DONE]') continue;

            try {
                const data = JSON.parse(cleanLine);
                let chunkDelta = '';

                if (data?.p === 'response/status' && data?.v === 'FINISHED') isFinished = true;
                if (data?.quasi_status === 'FINISHED') isFinished = true;

                if (data?.v?.response?.fragments) {
                    for (const frag of data.v.response.fragments) {
                        if (frag.type === 'THINK') { isThinkingContext = true; chunkDelta += `<think>\n${frag.content || ''}`; }
                        else if (frag.type === 'RESPONSE') { if (isThinkingContext) { isThinkingContext = false; chunkDelta += `\n</think>\n\n`; } chunkDelta += frag.content || ''; }
                    }
                }

                if (data?.p === 'response' && data?.o === 'BATCH' && Array.isArray(data?.v)) {
                    for (const item of data.v) {
                        if (item.p === 'quasi_status' && item.v === 'FINISHED') isFinished = true;
                        if (item.p === 'fragments' && item.o === 'APPEND' && Array.isArray(item.v)) {
                            for (const frag of item.v) {
                                if (frag.type === 'THINK') { if (!isThinkingContext) { isThinkingContext = true; chunkDelta += `<think>\n`; } chunkDelta += frag.content || ''; }
                                else if (frag.type === 'RESPONSE') { if (isThinkingContext) { isThinkingContext = false; chunkDelta += `\n</think>\n\n`; } chunkDelta += frag.content || ''; }
                            }
                        }
                    }
                }

                if (data?.p === 'response/fragments' && data?.o === 'APPEND' && Array.isArray(data?.v)) {
                    for (const frag of data.v) {
                        if (frag.type === 'THINK') { if (!isThinkingContext) { isThinkingContext = true; chunkDelta += `<think>\n`; } chunkDelta += frag.content || ''; }
                        else if (frag.type === 'RESPONSE') { if (isThinkingContext) { isThinkingContext = false; chunkDelta += `\n</think>\n\n`; } chunkDelta += frag.content || ''; }
                    }
                }

                if (typeof data?.v === 'string' && (!data?.p || data.p.endsWith('/content'))) chunkDelta += data.v;
                if (data?.p === 'response/fragments/-1/results' && Array.isArray(data?.v)) searchResults = data.v;

                if (chunkDelta) {
                    fullAnswer += chunkDelta;
                    process.stdout.write(chunkDelta);
                    if (isStream && !res.writableEnded) {
                        res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: chunkDelta } }] })}\n\n`);
                    }
                }
            } catch (e) { }
        }
    };

    const onEnd = () => { isFinished = true; };

    try {
        const messages = req.body.messages || [];
        const promptText = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n---\n\n');

        console.log(`\n[*] DeepSeek [ID: ${myRequestId}]: Запрос обрабатывается... Модель: ${requestedModel}`);

        if (checkAborted()) throw new Error(checkAborted());

        const currentUrl = page.url();
        if (!currentUrl.endsWith('chat.deepseek.com/')) {
            await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 1000));
        } else {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('span')).find(s => s.textContent === 'Новый чат' || s.textContent === 'New chat');
                if (btn && btn.closest('div[tabindex="0"]')) btn.closest('div[tabindex="0"]').click();
            });
            await new Promise(r => setTimeout(r, 1000));
        }

        if (checkAborted()) throw new Error(checkAborted());

        const wantsSearch = requestedModel.includes('search');
        const wantsThink = requestedModel.includes('think');
        const wantsExpert = requestedModel.includes('expert') || requestedModel.includes('pro');

        await page.evaluate((search, think, expert) => {
            const targetModelType = expert ? "expert" : "default";
            const modelRadio = document.querySelector(`div[data-model-type="${targetModelType}"]`);
            if (modelRadio && modelRadio.getAttribute('aria-checked') !== 'true') modelRadio.click();

            const toggleButtons = Array.from(document.querySelectorAll('.ds-toggle-button, [role="switch"]'));

            const searchBtn = toggleButtons.find(btn => btn.textContent && (btn.textContent.includes('Умный поиск') || btn.textContent.includes('Search')));
            if (searchBtn) {
                const isSelected = searchBtn.classList.contains('ds-toggle-button--selected') || searchBtn.getAttribute('aria-checked') === 'true';
                if (search !== isSelected) searchBtn.click();
            }

            const thinkBtn = toggleButtons.find(btn => btn.textContent && (btn.textContent.includes('Глубокое мышление') || btn.textContent.includes('DeepThink')));
            if (thinkBtn) {
                const isSelected = thinkBtn.classList.contains('ds-toggle-button--selected') || thinkBtn.getAttribute('aria-checked') === 'true';
                if (think !== isSelected) thinkBtn.click();
            }
        }, wantsSearch, wantsThink, wantsExpert);

        await new Promise(r => setTimeout(r, 500));
        if (checkAborted()) throw new Error(checkAborted());

        await page.waitForSelector('textarea');
        await page.focus('textarea');
        await page.evaluate((text) => document.execCommand('insertText', false, text), promptText);
        await new Promise(r => setTimeout(r, 300));

        networkStreamEvents.on('chunk', handleChunk);
        networkStreamEvents.on('end', onEnd);

        await page.keyboard.press('Enter');

        let failSafe = 0;
        while (!isFinished) {
            const abortReason = checkAborted();
            if (abortReason) throw new Error(abortReason);

            await new Promise(r => setTimeout(r, 500));
            failSafe++;
            if (isStream && !res.writableEnded && failSafe % 10 === 0) {
                res.write(`data: ${JSON.stringify({ id: "ping", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {} }] })}\n\n`);
            }
            if (failSafe > 1200) {
                console.log('[-] Таймаут генерации.');
                break;
            }
        }

        if (checkAborted()) throw new Error(checkAborted());
        if (isThinkingContext) {
            const closeThink = `\n</think>\n\n`;
            fullAnswer += closeThink;
            process.stdout.write(closeThink);
            if (isStream && !res.writableEnded) res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: closeThink } }] })}\n\n`);
        }

        if (searchResults.length > 0) {
            const searchBlock = renderSearchBlock(searchResults, true);
            fullAnswer += searchBlock;
            if (isStream && !res.writableEnded) res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: searchBlock } }] })}\n\n`);
        }

        console.log(`\n[+] DeepSeek [ID: ${myRequestId}]: Генерация успешна.`);

        if (isStream && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } else if (!res.writableEnded) {
            res.json({ id: "ds-chat", object: "chat.completion", model: requestedModel, choices: [{ message: { role: "assistant", content: fullAnswer }, finish_reason: "stop" }] });
        }

    } catch (err) {
        if (err.message.includes('REROLL') || err.message.includes('STOP')) {
            console.log(`\n[!] DeepSeek[ID: ${myRequestId}]: Запрос прерван. Причина: ${err.message}. Удаляем чат...`);
        } else {
            console.error(`\n[-] Ошибка генерации:`, err.message);
            if (!res.writableEnded) {
                if (isStream) res.end();
                else res.status(500).json({ error: { message: err.message } });
            }
        }
    } finally {
        isFinished = true;
        networkStreamEvents.off('chunk', handleChunk);
        networkStreamEvents.off('end', onEnd);

        try {
            const match = page.url().match(/chat\/s\/([a-z0-9-]+)/i);
            if (match && match[1]) {
                const sessionToKill = match[1];
                await page.evaluate(async (id) => {
                    const tokenRaw = localStorage.getItem('userToken');
                    if (!tokenRaw) return;
                    await fetch('/api/v0/chat_session/delete', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${JSON.parse(tokenRaw).value}` }, body: JSON.stringify({ chat_session_id: id }) });
                }, sessionToKill);
                console.log(`[+] DeepSeek: Сессия ${sessionToKill} очищена.`);
            }
            await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
        } catch (e) {
            console.error('[-] Ошибка при удалении чата:', e.message);
        }
        isBrowserBusy = false;
    }
}

module.exports = {
    MODELS,
    initProvider,
    setupRoutes,
    handleChatCompletion
};