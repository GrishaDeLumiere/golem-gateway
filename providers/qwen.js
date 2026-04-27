// providers/qwen.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { PORT } = require('../config');

puppeteer.use(StealthPlugin());

let browser;
let page;
let isInitializing = false;
let currentPort = PORT;
let isBrowserBusy = false;
let currentRequestId = 0;
const networkStreamEvents = new EventEmitter();

// Все поддерживаемые модели
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
    console.log('\n[!] Qwen: ВНИМАНИЕ: Токен мертв или отсутствует.');
}

async function initProvider(port = PORT) {
    currentPort = port;
    isInitializing = true;

    if (!process.env.QWEN_COOKIES || !process.env.QWEN_TOKEN) {
        renewAuth();
        return;
    }

    console.log('\n[*] Qwen: Создаем голема в тенях...');
    browser = await puppeteer.launch({
        headless: 'new', // Можно поставить false для отладки
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
    });

    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.exposeFunction('emitChunkToNode', (text) => networkStreamEvents.emit('chunk', text));
    await page.exposeFunction('emitEndToNode', () => networkStreamEvents.emit('end'));

    // Перехватываем fetch для SSE
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

    // Устанавливаем куки
    const cookiesRaw = process.env.QWEN_COOKIES || '';
    if (cookiesRaw) {
        const cookies = cookiesRaw.split(';').map(pair => {
            const index = pair.indexOf('=');
            if (index === -1) return null;
            return { name: pair.substring(0, index).trim(), value: pair.substring(index + 1).trim(), domain: 'chat.qwen.ai', path: '/' };
        }).filter(c => c !== null);

        if (process.env.QWEN_TOKEN && !cookies.find(c => c.name === 'token')) {
            cookies.push({ name: 'token', value: process.env.QWEN_TOKEN, domain: 'chat.qwen.ai', path: '/' });
        }
        await page.setCookie(...cookies);
    }

    if (process.env.QWEN_TOKEN) {
        await page.evaluateOnNewDocument((tokenText) => {
            localStorage.setItem('token', tokenText);
        }, process.env.QWEN_TOKEN);
    }

    console.log(`[*] Qwen: Открываем сцену...`);
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'networkidle2' }).catch(e => { });

    // Проверяем авторизацию
    const needsLogin = await page.evaluate(() => {
        const hasDataToken = !!(window.__prerendered_data && window.__prerendered_data.user && window.__prerendered_data.user.token);
        if (hasDataToken) return false;
        const loginBtn = document.querySelector('.auth-button-ui.login');
        if (!loginBtn) return false;
        const style = window.getComputedStyle(loginBtn);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && loginBtn.offsetWidth > 0;
    });

    if (needsLogin) {
        console.error('[!] Qwen: Сессия протухла (Требуется вход). Начинаю сброс...');
        await browser.close();
        browser = null;
        renewAuth();
        return;
    }

    isInitializing = false;
    console.log('[+] Qwen: Голем на позиции. Алгоритм прямого API активен.');
}

function setupRoutes(app, port) {
    app.post('/receive-qwen-payload', async (req, res) => {
        const { token, cookies } = req.body;
        if (cookies && token) {
            updateEnv('QWEN_TOKEN', token.replace(/(^"|"$)/g, ''));
            updateEnv('QWEN_COOKIES', cookies);
            console.log('\n[+] Qwen: ПЕЙЛОАД ПЕРЕХВАЧЕН! Данные сохранены.');
            res.send('OK');
            if (browser) await browser.close().catch(() => { }).finally(() => browser = null);
            await initProvider(currentPort);
        } else {
            res.status(400).send('Ошибка данных. Убедитесь, что вы авторизованы в Qwen.');
        }
    });
}

async function handleChatCompletion(req, res) {
    if (isInitializing || !page || page.isClosed()) {
        return res.status(503).json({ error: { message: "Провайдер Qwen инициализируется.", type: "server_loading" } });
    }

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

    // --- 1. СИСТЕМА ОЧЕРЕДИ ---
    let queueWait = 0;
    while (isBrowserBusy) {
        const abortReason = checkAborted();
        if (abortReason) {
            console.log(`[!] Qwen Запрос [ID: ${myRequestId}] отменен в очереди. Причина: ${abortReason}`);
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

                // Обработка ошибок безопасности
                if (data.error) {
                    const errorMessage = data.error.details || data.error.code || 'Неизвестная ошибка';
                    console.log(`\n[!] Qwen API Ошибка: ${errorMessage}`);
                    chunkDelta += `\n\n[Системное предупреждение Qwen: ${errorMessage}]\n\n`;
                    isFinished = true;
                } else if (data.choices && data.choices[0]) {
                    const choice = data.choices[0];
                    const delta = choice.delta;

                    if (delta) {
                        const isThinkPhase = delta.phase === 'thinking_summary' || delta.phase === 'thinking_process' || delta.phase === 'think';

                        // 1. Открытие тега <think>
                        if (isThinkPhase && !isThinking) {
                            chunkDelta += '<think>\n';
                            isThinking = true;
                        }

                        // 2. Извлечение мыслей
                        if (isThinkPhase) {
                            let currentThought = '';

                            if (delta.extra && delta.extra.summary_thought && Array.isArray(delta.extra.summary_thought.content)) {
                                currentThought = delta.extra.summary_thought.content.join('');
                            }

                            // Отправляем только новые токены мыслей, сравнивая длину строк
                            if (currentThought && currentThought.length > lastThought.length) {
                                const diff = currentThought.substring(lastThought.length);
                                chunkDelta += diff;
                                lastThought = currentThought;
                            } else if (delta.content && !currentThought) {
                                // Если мысли идут напрямую в content (как в phase: "think")
                                chunkDelta += delta.content;
                            }
                        }

                        // 3. Открытый текст ответа
                        if (delta.phase === 'answer' && delta.content) {
                            chunkDelta += delta.content;
                        }

                        // 4. Закрытие тега или остановка
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
                    process.stdout.write(chunkDelta);
                    if (isStream && !res.writableEnded) {
                        res.write(`data: ${JSON.stringify({ id: "qwen-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: chunkDelta } }] })}\n\n`);
                    }
                }
            } catch (e) {
                // Игнорируем ошибки парсинга
            }
        }
    };

    const onEnd = () => { isFinished = true; };

    try {
        const messages = req.body.messages || [];
        const promptText = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n---\n\n');

        console.log(`\n[*] Qwen [ID: ${myRequestId}]: Запрос обрабатывается (Direct API)... Модель: ${requestedModel}`);

        if (checkAborted()) throw new Error(checkAborted());

        // Прямой вызов API через Evaluate, минуя UI
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

            // 1. Создаем локальную сессию
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

            // 2. Отправляем промпт
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

        // Ожидание окончания генерации
        let failSafe = 0;
        while (!isFinished) {
            const abortReason = checkAborted();
            if (abortReason) throw new Error(abortReason);

            await new Promise(r => setTimeout(r, 500));
            failSafe++;
            if (isStream && !res.writableEnded && failSafe % 10 === 0) {
                res.write(`data: ${JSON.stringify({ id: "ping", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {} }] })}\n\n`);
            }
            if (failSafe > 1200) { // 10 минут
                console.log('[-] Таймаут генерации.');
                break;
            }
        }

        if (checkAborted()) throw new Error(checkAborted());

        // Если генерация прервалась/окончилась на мыслях, корректно закрываем тег
        if (isThinking) {
            const closeThink = `\n</think>\n\n`;
            fullAnswer += closeThink;
            process.stdout.write(closeThink);
            if (isStream && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({ id: "qwen-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: closeThink } }] })}\n\n`);
            }
        }

        console.log(`\n[+] Qwen [ID: ${myRequestId}]: Генерация завершена.`);

        if (isStream && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({ id: "qwen-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();
        } else if (!res.writableEnded) {
            res.json({ id: "qwen-chat", object: "chat.completion", model: requestedModel, choices: [{ message: { role: "assistant", content: fullAnswer }, finish_reason: "stop" }] });
        }

    } catch (err) {
        if (err.message.includes('REROLL') || err.message.includes('STOP')) {
            console.log(`\n[!] Qwen [ID: ${myRequestId}]: Запрос прерван. Причина: ${err.message}.`);
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

        // Рефреш страницы оборвет текущий недокачанный Fetch-запрос
        await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded' }).catch(() => { });

        // Удаляем чат через API
        if (activeChatId) {
            try {
                await page.evaluate(async (id) => {
                    const token = window.__prerendered_data?.user?.token || localStorage.getItem('token') || '';
                    const headers = { 'Accept': 'application/json' };
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    await fetch(`https://chat.qwen.ai/api/v2/chats/${id}`, { method: 'DELETE', headers }).catch(() => { });
                }, activeChatId);
                console.log(`[+] Qwen: Облачный чат ${activeChatId} очищен.`);
            } catch (e) { }
        }

        isBrowserBusy = false;
    }
}

async function unloadProvider() {
    if (browser) {
        console.log(`\n[-] Qwen: Получен сигнал на отключение. Выгружаем браузер из памяти...`);
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