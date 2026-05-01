const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { PORT } = require('../config');
const { getSettings } = require('../settings');

puppeteer.use(StealthPlugin());

let browser;
let page;
let isInitializing = false;
let currentPort = PORT;
let isBrowserBusy = false;
let currentRequestId = 0;
const networkStreamEvents = new EventEmitter();

const MODELS = [
    { id: "qwen3.6-plus", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.6-max-preview", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.6-27b", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-plus", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-omni-plus", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.6-35b-a3b", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-flash", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-max-2026-03-08", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.6-plus-preview", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-397b-a17b", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-122b-a10b", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-omni-flash", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-27b", object: "model", owned_by: "qwen-system" },
    { id: "qwen3.5-35b-a3b", object: "model", owned_by: "qwen-system" },
    { id: "qwen3-max-2026-01-23", object: "model", owned_by: "qwen-system" },
    { id: "qwen-plus-2025-07-28", object: "model", owned_by: "qwen-system" },
    { id: "qwen3-coder-plus", object: "model", owned_by: "qwen-system" },
    { id: "qwen3-vl-plus", object: "model", owned_by: "qwen-system" },
    { id: "qwen3-omni-flash-2025-12-01", object: "model", owned_by: "qwen-system" },
    { id: "qwen-max-latest", object: "model", owned_by: "qwen-system" }
];

const DB_FILE = path.join(__dirname, '../qwen_accounts.json');

function getDb() {
    if (fs.existsSync(DB_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } catch (e) { }
    }
    const db = { active: 0, accounts: [] };
    if (process.env.QWEN_TOKEN && process.env.QWEN_COOKIES) {
        db.accounts.push({
            name: "Основной профиль (.env)",
            token: process.env.QWEN_TOKEN.replace(/(^"|"$)/g, ''),
            cookies: process.env.QWEN_COOKIES
        });
    }
    return db;
}

function saveDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function renewAuth() {
    console.log('\n[⚠️ Qwen] ВНИМАНИЕ: База профилей пуста или сессия мертва. Добавьте аккаунт через интерфейс.');
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
        console.log('[⚙️ Qwen] Создаем голема в тенях...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
        });

        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.exposeFunction('emitChunkToNode', (text) => networkStreamEvents.emit('chunk', text));
        await page.exposeFunction('emitEndToNode', () => networkStreamEvents.emit('end'));

        await page.evaluateOnNewDocument(() => {
            const originalFetch = window.fetch;
            window.fetch = async function (...args) {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                const isChatAPI = typeof url === 'string' && (url.includes('/chat/completions') || url.includes('/message'));

                const response = await originalFetch.apply(this, args);

                if (isChatAPI && response.body) {
                    const clone = response.clone();
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
                                if (window.emitChunkToNode) window.emitChunkToNode(decoder.decode(value, { stream: true }));
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
                return { name: pair.substring(0, index).trim(), value: pair.substring(index + 1).trim(), domain: 'chat.qwen.ai', path: '/' };
            }).filter(c => c !== null);

            if (accToken && !cookies.find(c => c.name === 'token')) {
                cookies.push({ name: 'token', value: accToken, domain: 'chat.qwen.ai', path: '/' });
            }
            await page.setCookie(...cookies);
        }

        if (accToken) {
            await page.evaluateOnNewDocument((tokenText) => {
                localStorage.setItem('token', tokenText);
            }, accToken);
        }

        console.log(`[⚙️ Qwen] Открываем основную сцену...`);
        await page.goto('https://chat.qwen.ai/', { waitUntil: 'networkidle2' });

        const needsLogin = await page.evaluate(() => {
            const hasDataToken = !!(window.__prerendered_data && window.__prerendered_data.user && window.__prerendered_data.user.token);
            if (hasDataToken) return false;
            const loginBtn = document.querySelector('.auth-button-ui.login');
            if (!loginBtn) return false;
            const style = window.getComputedStyle(loginBtn);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && loginBtn.offsetWidth > 0;
        });

        if (needsLogin) {
            console.error('[❌ Qwen] Сессия протухла (Требуется вход). Начинаю сброс...');
            await browser.close().catch(() => { });
            browser = null;
            renewAuth();
            isInitializing = false;
            return;
        }

        isInitializing = false;
        console.log('[✨ Qwen] Голем на позиции. Алгоритм прямого API активен.');
    } catch (err) {
        if (err.message.includes('TargetCloseError') || err.message.includes('Session closed') || err.message.includes('Target closed')) {
            console.log('[⚙️ Qwen] Настройка старого профиля прервана (выполняется смена контекста).');
        } else {
            console.error('[❌ Qwen] Ошибка инициализации:', err.message);
        }
        isInitializing = false;
    }
}

async function initProvider(port = PORT) {
    initQueue = initQueue.then(() => initProviderCore(port)).catch(err => {
        console.error('Ошибка очереди Qwen:', err.message);
    });
    await initQueue;
}

function setupRoutes(app, port) {
    app.get('/api/qwen/accounts', (req, res) => res.json(getDb()));

    app.post('/api/qwen/accounts', async (req, res) => {
        const oldDb = getDb();
        saveDb(req.body);
        res.json({ success: true });

        if (req.body.active !== oldDb.active) {
            console.log('[⚙️ Qwen] Смена активного профиля...');
            if (browser) await browser.close().catch(() => { });
            isBrowserBusy = false;
            await initProvider(currentPort);
        }
    });

    app.get('/receive-qwen-payload', async (req, res) => {
        const { token, cookies } = req.query;
        if (cookies && token) {
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

            console.log('[🔑 Qwen] ПЕЙЛОАД ПЕРЕХВАЧЕН! Профиль сохранен.');

            let html = fs.readFileSync(path.join(__dirname, '../views/success.html'), 'utf8');
            html = html.replace('{{TITLE}}', 'Сессия Qwen захвачена!')
                .replace('{{MESSAGE}}', 'Модуль авторизован и добавлен в менеджер профилей.')
                .replace(/{{COLOR}}/g, '#8b5cf6');
            res.send(html);

            isBrowserBusy = false;
            await initProvider(currentPort);
        } else {
            res.status(400).send('Ошибка данных. Убедитесь, что вы авторизованы в Qwen.');
        }
    });
}

// === ОБРАБОТКА ГЕНЕРАЦИИ ===
async function handleChatCompletion(req, res) {
    if (isInitializing || !page || page.isClosed()) {
        return res.status(503).json({ error: { message: "Провайдер Qwen инициализируется.", type: "server_loading" } });
    }

    const isDebug = getSettings().debugMode;
    const isStream = req.body.stream;
    let requestedModel = req.body.model || "qwen3.6-plus";

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
            console.log(`[⚠️ Qwen] Запрос [ID: ${myRequestId}] отменен в очереди. Причина: ${abortReason}`);
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
    let fullAnswer = '';
    let isThinking = false;
    let activeChatId = null;
    let lastThought = '';

    const handleChunk = (rawText) => {
        if (checkAborted()) return;
        sseBuffer += rawText;

        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();

        for (const line of lines) {
            let cleanLine = line.trim();
            if (!cleanLine) continue;

            if (cleanLine.startsWith('data:')) cleanLine = cleanLine.replace(/^data:\s*/, '');
            if (cleanLine === '[DONE]') { isFinished = true; continue; }

            try {
                const data = JSON.parse(cleanLine);
                let chunkDelta = '';

                if (data.error) {
                    const errorMessage = data.error.details || data.error.code || 'Неизвестная ошибка';
                    if (isDebug) console.log(`[🐛 DEBUG Qwen] API Ошибка: ${errorMessage}`);
                    chunkDelta += `\n\n[Системное предупреждение Qwen: ${errorMessage}]\n\n`;
                    isFinished = true;
                } else if (data.choices && data.choices[0]) {
                    const choice = data.choices[0];
                    const delta = choice.delta;

                    if (delta) {
                        const isThinkPhase = delta.phase === 'thinking_summary' || delta.phase === 'thinking_process' || delta.phase === 'think';

                        if (isThinkPhase && !isThinking) {
                            chunkDelta += '<think>\n';
                            isThinking = true;
                        }

                        if (isThinkPhase) {
                            let currentThought = '';

                            if (delta.extra && delta.extra.summary_thought && Array.isArray(delta.extra.summary_thought.content)) {
                                currentThought = delta.extra.summary_thought.content.join('');
                            }

                            if (currentThought && currentThought.length > lastThought.length) {
                                const diff = currentThought.substring(lastThought.length);
                                chunkDelta += diff;
                                lastThought = currentThought;
                            } else if (delta.content && !currentThought) {
                                chunkDelta += delta.content;
                            }
                        }

                        if (delta.phase === 'answer' && delta.content) {
                            chunkDelta += delta.content;
                        }

                        if (delta.status === 'finished') {
                            if (isThinkPhase) {
                                if (isThinking) {
                                    chunkDelta += '\n</think>\n\n';
                                    isThinking = false;
                                }
                            } else if (delta.phase === 'answer' || choice.finish_reason === 'stop') {
                                isFinished = true;
                            }
                        }
                    }
                }

                if (chunkDelta) {
                    fullAnswer += chunkDelta;
                    if (isDebug) process.stdout.write(chunkDelta); // Печать только в debug
                    if (isStream && !res.writableEnded) {
                        res.write(`data: ${JSON.stringify({ id: "qwen-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: chunkDelta } }] })}\n\n`);
                    }
                }
            } catch (e) {
            }
        }
    };

    const onEnd = () => { isFinished = true; };

    try {
        const messages = req.body.messages || [];
        const promptText = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n---\n\n');

        console.log(`[🚀 Qwen] Старт генерации [ID: ${myRequestId}] -> Модель: ${requestedModel}`);
        if (isDebug) console.log(`[🐛 DEBUG Qwen] Отправка Direct API payload.`);

        if (checkAborted()) throw new Error(checkAborted());

        networkStreamEvents.on('chunk', handleChunk);
        networkStreamEvents.on('end', onEnd);

        activeChatId = await page.evaluate(async (promptVal, modelKey) => {
            function uuidv4() {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            const token = window.__prerendered_data?.user?.token || localStorage.getItem('token') || '';
            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const createRes = await fetch('https://chat.qwen.ai/api/v2/chats/new', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    title: "Temporary API Chat",
                    models: [modelKey],
                    chat_mode: "local",
                    chat_type: "t2t",
                    timestamp: Date.now(),
                    project_id: ""
                })
            });

            if (!createRes.ok) throw new Error(`Create Chat Failed: ${createRes.status}`);
            const createData = await createRes.json();
            const chatId = createData.id || createData.chat_id || (createData.data && createData.data.id) || createData.data;
            if (!chatId) throw new Error('Missing Chat ID from API');

            const payload = {
                stream: true,
                version: "2.1",
                incremental_output: true,
                chat_id: chatId,
                chat_mode: "local",
                model: modelKey,
                parent_id: null,
                messages: [{
                    fid: uuidv4(),
                    parentId: null,
                    childrenIds: [uuidv4()],
                    role: "user",
                    content: promptVal,
                    user_action: "chat",
                    files: [],
                    timestamp: Math.floor(Date.now() / 1000),
                    models: [modelKey],
                    chat_type: "t2t",
                    feature_config: {
                        thinking_enabled: true,
                        output_schema: "phase",
                        research_mode: "normal",
                        auto_thinking: false,
                        thinking_mode: "Thinking",
                        thinking_format: "summary"
                    },
                    extra: { meta: { subChatType: "t2t" } },
                    sub_chat_type: "t2t",
                    parent_id: null
                }],
                timestamp: Math.floor(Date.now() / 1000)
            };

            fetch(`https://chat.qwen.ai/api/v2/chat/completions?chat_id=${chatId}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            }).catch(() => { });

            return chatId;
        }, promptText, requestedModel);

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
                if (isDebug) console.log('[🐛 DEBUG Qwen] Таймаут генерации.');
                break;
            }
        }

        if (checkAborted()) throw new Error(checkAborted());

        if (isThinking) {
            const closeThink = `\n</think>\n\n`;
            fullAnswer += closeThink;
            if (isDebug) process.stdout.write(closeThink);
            if (isStream && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ id: "qwen-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: closeThink } }] })}\n\n`);
            }
        }

        console.log(`[✅ Qwen] Успешно завершено [ID: ${myRequestId}]`);

        if (isStream && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ id: "qwen-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } else if (!res.writableEnded) {
            res.json({ id: "qwen-chat", object: "chat.completion", model: requestedModel, choices: [{ message: { role: "assistant", content: fullAnswer }, finish_reason: "stop" }] });
        }

    } catch (err) {
        if (err.message.includes('REROLL') || err.message.includes('STOP')) {
            console.log(`[⚠️ Qwen] Запрос [ID: ${myRequestId}] прерван. Причина: ${err.message}.`);
        } else {
            console.error(`[❌ Qwen] Ошибка генерации: ${err.message}`);
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

        await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded' }).catch(() => { });

        if (activeChatId) {
            try {
                await page.evaluate(async (id) => {
                    const token = window.__prerendered_data?.user?.token || localStorage.getItem('token') || '';
                    const headers = { 'Accept': 'application/json' };
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    await fetch(`https://chat.qwen.ai/api/v2/chats/${id}`, { method: 'DELETE', headers }).catch(() => { });
                }, activeChatId);
                if (isDebug) console.log(`[🧹 Qwen] Облачный чат ${activeChatId} очищен.`);
            } catch (e) { }
        }

        isBrowserBusy = false;
    }
}

async function unloadProvider() {
    if (browser) {
        console.log(`[⚙️ Qwen] Получен сигнал на отключение. Выгружаем браузер из памяти...`);
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