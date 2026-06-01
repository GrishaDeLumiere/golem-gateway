const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { PORT } = require('../config');
const { getSettings } = require('../settings');

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

const DB_FILE = path.join(__dirname, '../deepseek_accounts.json');

function getDb() {
    if (fs.existsSync(DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch (e) { }
    }
    // Миграция старых данных из .env
    const db = { active: 0, accounts: [] };
    if (process.env.SESSION_TOKEN && process.env.COOKIES) {
        db.accounts.push({
            name: "Основной профиль (.env)",
            token: process.env.SESSION_TOKEN.replace(/(^"|"$)/g, ''),
            cookies: process.env.COOKIES
        });
    }
    return db;
}

function saveDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function renewAuth() {
    console.log('\n[⚠️ DeepSeek] ВНИМАНИЕ: База профилей пуста или сессия мертва. Добавьте аккаунт.');
}

function openInDefaultBrowser(url) {
    const platform = process.platform;
    if (platform === 'win32') exec(`start "" "${url}"`);
    else if (platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
}

let initQueue = Promise.resolve();

async function initProviderCore(port = PORT) {
    currentPort = port;
    isInitializing = true;
    if (browser) {
        await browser.close().catch(() => { });
        browser = null;
        page = null;
    }

    const db = typeof getDb === 'function' ? getDb() : null;
    if (!db.accounts || db.accounts.length === 0) {
        renewAuth();
        isInitializing = false;
        return;
    }

    const activeAcc = db.accounts[db.active] || db.accounts[0];
    const accToken = activeAcc.token;
    const accCookies = activeAcc.cookies;

    if (!accToken || !accCookies) {
        renewAuth();
        isInitializing = false;
        return;
    }

    try {
        console.log('[⚙️ DeepSeek] Создаем голема в тенях...');
        browser = await puppeteer.launch({
            headless: false, // Измените 'new' на false для отладки глазами
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1280,800',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        await page.exposeFunction('emitChunkToNode', (text) => networkStreamEvents.emit('chunk', text));
        await page.exposeFunction('emitEndToNode', () => networkStreamEvents.emit('end'));

        // Вшиваем троян: патчим и XHR, и FETCH
        await page.evaluateOnNewDocument(() => {
            // 1. Старый хук на случай отката фронта
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

            // 2. АБСОЛЮТНО НОВЫЙ ХУК ДЛЯ FETCH (Именно он сейчас работает в DeepSeek)
            const originalFetch = window.fetch;
            window.fetch = async function (...args) {
                const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                const response = await originalFetch.apply(this, args);

                if (url.includes('/api/v0/chat/completion') && response.body) {
                    const clone = response.clone();

                    // Хак 228 левела: Если сервер лег (503) или ответил обычным JSON вместо стрима
                    if (!response.ok || (response.headers.get('content-type') || '').includes('application/json')) {
                        clone.text().then(text => {
                            if (window.emitChunkToNode) window.emitChunkToNode(`data: {"custom_error": ${JSON.stringify(text)}}\n\n`);
                            if (window.emitEndToNode) window.emitEndToNode();
                        }).catch(() => {
                            if (window.emitEndToNode) window.emitEndToNode();
                        });
                        return response;
                    }

                    // Нормальный стрим генерации
                    const reader = clone.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    (async () => {
                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) {
                                    if (window.emitEndToNode) window.emitEndToNode();
                                    break;
                                }
                                const chunk = decoder.decode(value, { stream: true });
                                if (chunk && window.emitChunkToNode) window.emitChunkToNode(chunk);
                            }
                        } catch (e) {
                            if (window.emitEndToNode) window.emitEndToNode();
                        }
                    })();
                }
                return response;
            };
        });

        const cookiesRaw = accCookies || '';
        if (cookiesRaw) {
            const cookies = cookiesRaw.split(';').map(pair => {
                const index = pair.indexOf('=');
                if (index === -1) return null;
                return { name: pair.substring(0, index).trim(), value: pair.substring(index + 1).trim(), domain: '.deepseek.com', path: '/' };
            }).filter(c => c !== null);
            await page.setCookie(...cookies);
        }

        if (accToken) {
            await page.evaluateOnNewDocument((tokenText) => {
                let t = tokenText.replace(/^['"]|['"]$/g, '');
                try { let parsed = JSON.parse(t); if (parsed.value) t = parsed.value; } catch (e) { }
                localStorage.setItem('userToken', JSON.stringify({ value: t, __version: "0" }));
            }, accToken);
        }

        console.log(`[⚙️ DeepSeek] Открываем основную сцену...`);
        await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2500));

        const captchaCleared = await checkAndHandleCaptcha(page);
        if (!captchaCleared) {
            console.log('[⚠️ DeepSeek] Внимание: Инициализация завершена, но капча не была пройдена.');
        }

        if (page.url().includes('sign_in')) {
            console.error('[❌ DeepSeek] Сессия протухла. Начинаю сброс...');
            await browser.close().catch(() => { });
            browser = null;
            renewAuth();
            isInitializing = false;
            return;
        }

        isInitializing = false;
        console.log('[✨ DeepSeek] Голем на позиции. Алгоритм активен. Fetch-перехват инжектирован.');
    } catch (err) {
        if (err.message.includes('TargetCloseError') || err.message.includes('Session closed')) {
            console.log('[⚙️ DeepSeek] Смена контекста прервана.');
        } else {
            console.error('[❌ DeepSeek] Ошибка инициализации:', err.message);
        }
        isInitializing = false;
    }
}

async function initProvider(port = PORT) {
    initQueue = initQueue.then(() => initProviderCore(port)).catch(err => {
        console.error('Ошибка очереди DeepSeek:', err.message);
    });
    await initQueue;
}

function setupRoutes(app, port) {
    app.get('/api/deepseek/accounts', (req, res) => res.json(getDb()));

    app.post('/api/deepseek/accounts', async (req, res) => {
        const oldDb = getDb();
        saveDb(req.body);
        res.json({ success: true });

        if (req.body.active !== oldDb.active) {
            console.log('[⚙️ DeepSeek] Смена активного профиля...');
            if (browser) await browser.close().catch(() => { });
            isBrowserBusy = false;
            await initProvider(currentPort);
        }
    });

    app.get('/receive-payload', async (req, res) => {
        const { token, cookies } = req.query;
        if (token && cookies) {
            const cleanToken = token.replace(/(^"|"$)/g, '');
            const db = getDb();

            const existingIdx = db.accounts.findIndex(a => a.token === cleanToken);
            if (existingIdx >= 0) {
                db.accounts[existingIdx].cookies = cookies;
                db.active = existingIdx;
            } else {
                db.accounts.push({
                    name: `Профиль #${db.accounts.length + 1}`,
                    token: cleanToken,
                    cookies: cookies
                });
                db.active = db.accounts.length - 1;
            }
            saveDb(db);

            console.log('[🔑 DeepSeek] ПЕЙЛОАД ПЕРЕХВАЧЕН! Профиль сохранен.');

            let html = fs.readFileSync(path.join(__dirname, '../views/success.html'), 'utf8');
            html = html.replace('{{TITLE}}', 'Сессия DeepSeek перехвачена!')
                .replace('{{MESSAGE}}', 'Аккаунт успешно добавлен в менеджер профилей.')
                .replace(/{{COLOR}}/g, '#3b82f6');
            res.send(html);

            isBrowserBusy = false;
            await initProvider(currentPort);
        } else {
            res.status(400).send('Ошибка данных. Не удалось извлечь куки.');
        }
    });
}

async function checkAndHandleCaptcha(page) {
    try {
        const isCaptchaPresent = await page.evaluate(() => {
            const hasCaptchaContainer = !!document.querySelector('#captcha-container');
            const hasWafScript = Array.from(document.querySelectorAll('script')).some(script =>
                script.src && (script.src.includes('awswaf.com') || script.src.includes('captcha.js'))
            );
            const isVerificationTitle = document.title && document.title.includes('Human Verification');

            return hasCaptchaContainer || hasWafScript || isVerificationTitle;
        });

        if (isCaptchaPresent) {
            console.log('[⚠️ DeepSeek] Обнаружена капча AWS WAF. Попытка перезагрузки страницы...');

            await page.reload({ waitUntil: 'networkidle2' });
            await new Promise(r => setTimeout(r, 2000));

            const stillHasCaptcha = await page.evaluate(() => {
                return !!document.querySelector('#captcha-container') ||
                    (document.title && document.title.includes('Human Verification'));
            });

            if (stillHasCaptcha) {
                console.log('[❌ DeepSeek] Перезагрузка страницы не помогла обойти капчу.');
                return false;
            } else {
                console.log('[✅ DeepSeek] Капча исчезла после перезагрузки страницы.');
                return true;
            }
        }
    } catch (err) {
        console.error('[❌ DeepSeek] Ошибка при проверке/обработке капчи:', err.message);
    }
    return true;
}

// === ОБРАБОТКА ГЕНЕРАЦИИ ===
async function handleChatCompletion(req, res) {
    if (isInitializing || !page || page.isClosed()) {
        return res.status(503).json({ error: { message: "Провайдер DeepSeek инициализируется.", type: "server_loading" } });
    }

    const isDebug = getSettings().debugMode;
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

    let queueWait = 0;
    while (isBrowserBusy) {
        const abortReason = checkAborted();
        if (abortReason) {
            console.log(`[⚠️ DeepSeek] Запрос [ID: ${myRequestId}] отменен в очереди. Причина: ${abortReason}`);
            if (isStream && !res.writableEnded) res.end();
            return;
        }
        await new Promise(r => setTimeout(r, 500));
        queueWait += 500;
        if (isStream && queueWait % 5000 === 0 && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ id: "ping", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {} }] })}\n\n`);
        }
    }

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

                // === ОБРАБОТКА ИСКЛЮЧЕНИЙ СЕРВЕРА ===
                if (data?.custom_error) {
                    let errStr = data.custom_error;
                    try {
                        const j = JSON.parse(errStr);
                        errStr = j.message || j.error?.message || errStr;
                    } catch (e) { }

                    chunkDelta += `\n❌ [СЕРВЕР DEEPSEEK УПАЛ]: ${errStr}\nСервера сейчас под шквалом запросов (Тех. работы).`;
                    isFinished = true; // Вырубаем ожидание
                }

                if (data?.p === 'response/status' && data?.v === 'FINISHED') isFinished = true;
                if (data?.quasi_status === 'FINISHED') isFinished = true;

                if (data?.v?.response?.fragments) {
                    for (const frag of data.v.response.fragments) {
                        if (frag.type === 'THINK') {
                            if (!isThinkingContext) { isThinkingContext = true; chunkDelta += `<think>\n`; }
                            chunkDelta += frag.content || '';
                        }
                        else if (frag.type === 'RESPONSE') {
                            if (isThinkingContext) { isThinkingContext = false; chunkDelta += `\n\n</think>\n\n`; }
                            chunkDelta += frag.content || '';
                        }
                    }
                }

                if (data?.p === 'response' && data?.o === 'BATCH' && Array.isArray(data?.v)) {
                    for (const item of data.v) {
                        if (item.p === 'quasi_status' && item.v === 'FINISHED') isFinished = true;
                        if (item.p === 'fragments' && item.o === 'APPEND' && Array.isArray(item.v)) {
                            for (const frag of item.v) {
                                if (frag.type === 'THINK') {
                                    if (!isThinkingContext) { isThinkingContext = true; chunkDelta += `<think>\n`; }
                                    chunkDelta += frag.content || '';
                                }
                                else if (frag.type === 'RESPONSE') {
                                    if (isThinkingContext) { isThinkingContext = false; chunkDelta += `\n\n</think>\n\n`; }
                                    chunkDelta += frag.content || '';
                                }
                            }
                        }
                    }
                }

                if (data?.p === 'response/fragments' && data?.o === 'APPEND' && Array.isArray(data?.v)) {
                    for (const frag of data.v) {
                        if (frag.type === 'THINK') {
                            if (!isThinkingContext) { isThinkingContext = true; chunkDelta += `<think>\n`; }
                            chunkDelta += frag.content || '';
                        }
                        else if (frag.type === 'RESPONSE') {
                            if (isThinkingContext) { isThinkingContext = false; chunkDelta += `\n\n</think>\n\n`; }
                            chunkDelta += frag.content || '';
                        }
                    }
                }

                if (typeof data?.v === 'string' && (!data?.p || data.p.endsWith('/content'))) chunkDelta += data.v;
                if (data?.p === 'response/fragments/-1/results' && Array.isArray(data?.v)) searchResults = data.v;

                if (chunkDelta) {
                    fullAnswer += chunkDelta;
                    if (isDebug) process.stdout.write(chunkDelta); // Печать только в debug
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

        console.log(`[🚀 DeepSeek] Старт генерации [ID: ${myRequestId}] -> Модель: ${requestedModel}`);
        if (isDebug) console.log(`[🐛 DEBUG DeepSeek] Промпт готовится к передаче в браузер.`);

        if (checkAborted()) throw new Error(checkAborted());

        const currentUrl = page.url();
        if (!currentUrl.endsWith('chat.deepseek.com/')) {
            await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 1000));
        } else {
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('span, div')).find(s => s.textContent === 'Новый чат' || s.textContent === 'New chat');
                if (btn && btn.closest('div[tabindex="0"]')) btn.closest('div[tabindex="0"]').click();
            });
            await new Promise(r => setTimeout(r, 1000));
        }

        if (checkAborted()) throw new Error(checkAborted());

        const captchaCleared = await checkAndHandleCaptcha(page);
        if (!captchaCleared) {
            throw new Error('Не удалось обойти капчу AWS WAF при помощи перезагрузки.');
        }

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

        // ТРОЙНАЯ СТРАХОВКА ВСТАВКИ
        const inserted = await page.evaluate(async (text) => {
            const textarea = document.querySelector('textarea');
            if (!textarea) return false;

            try {
                // Метод 1: Прямой сеттер (обходит React)
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype, 'value'
                ).set;
                nativeSetter.call(textarea, text);

                // Метод 2: Триггерим ВСЕ события которые слушает React
                textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

                // Метод 3: Имитация реального ввода (симуляция нажатий)
                textarea.click();

                return textarea.value.length > 0; // Проверяем реально ли вставилось
            } catch (e) {
                return false;
            }
        }, promptText);

        // Если не вставилось - пробуем через буфер обмена с разрешениями
        if (!inserted) {
            console.log('[⚠️ DeepSeek] Первый метод не сработал, пробую Clipboard API...');

            // Даем разрешение браузеру на clipboard
            const context = browser.defaultBrowserContext();
            await context.overridePermissions('https://chat.deepseek.com', ['clipboard-read', 'clipboard-write']);

            await page.evaluate(async (text) => {
                const textarea = document.querySelector('textarea');
                if (!textarea) return;

                textarea.focus();
                await navigator.clipboard.writeText(text);
                document.execCommand('paste');
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }, promptText);
        }

        // Жесткая проверка что текст реально в поле
        const textInField = await page.evaluate(() => {
            const ta = document.querySelector('textarea');
            return ta ? ta.value.length : 0;
        });

        if (textInField < 10) {
            throw new Error(`ТЕКСТ НЕ ВСТАВИЛСЯ! В поле ${textInField} символов из ${promptText.length}`);
        }

        console.log(`[✅ DeepSeek] Вставлено ${textInField} символов`);
        await new Promise(r => setTimeout(r, 500));

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
                if (isDebug) console.log('[🐛 DEBUG DeepSeek] Таймаут генерации.');
                break;
            }
        }

        if (checkAborted()) throw new Error(checkAborted());

        // АНТИДЕДИНСАЙД ПРОВЕРКА - Читаем всплывающие ошибки на странице!
        if (fullAnswer.trim() === '') {
            const pageError = await page.evaluate(() => {
                const err = document.querySelector('.arco-message-error, .arco-message-content, [class*="toast"]');
                return err ? err.innerText : null;
            });
            if (pageError) {
                throw new Error(`DeepSeek UI Заблочил: ${pageError}`);
            }
            throw new Error('СГЕНЕРИРОВАН ПУСТОЙ ОТВЕТ! Сервера лежат нахуй, ответ полностью пуст.');
        }

        if (isThinkingContext) {
            const closeThink = `\n\n</think>\n\n`;
            fullAnswer += closeThink;
            if (isDebug) process.stdout.write(closeThink);
            if (isStream && !res.writableEnded) res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: closeThink } }] })}\n\n`);
        }

        if (searchResults.length > 0) {
            const searchBlock = renderSearchBlock(searchResults, true);
            fullAnswer += searchBlock;
            if (isStream && !res.writableEnded) res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: searchBlock } }] })}\n\n`);
        }

        console.log(`[✅ DeepSeek] Успешно завершено [ID: ${myRequestId}]`);

        if (isStream && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } else if (!res.writableEnded) {
            res.json({ id: "ds-chat", object: "chat.completion", model: requestedModel, choices: [{ message: { role: "assistant", content: fullAnswer }, finish_reason: "stop" }] });
        }

    } catch (err) {
        if (err.message.includes('REROLL') || err.message.includes('STOP')) {
            console.log(`[⚠️ DeepSeek] Запрос [ID: ${myRequestId}] прерван. Причина: ${err.message}.`);
        } else {
            console.error(`[❌ DeepSeek] Ошибка генерации: ${err.message}`);
            if (isDebug) console.error(err.stack);

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
                if (isDebug) console.log(`[🧹 DeepSeek] Облачный чат ${sessionToKill} очищен.`);
            }
            await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
        } catch (e) {
            if (isDebug) console.error('[❌ DeepSeek] Ошибка при удалении чата:', e.message);
        }
        isBrowserBusy = false;
    }
}

async function unloadProvider() {
    if (browser) {
        console.log(`[⚙️ DeepSeek] Получен сигнал на отключение. Выгружаем браузер из памяти...`);
        await browser.close().catch(() => { });
        browser = null;
        page = null;
    }
    isInitializing = false;
    isBrowserBusy = false;
}

module.exports = {
    MODELS,
    initProvider,
    setupRoutes,
    handleChatCompletion,
    unloadProvider
};