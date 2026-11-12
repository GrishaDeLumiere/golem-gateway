// providers/deepseek.js
const childProcess = require('child_process');
if (!childProcess._golemSpawnPatched) {
    const origSpawn = childProcess.spawn;
    childProcess.spawn = function (command, args, options) {
        if (options && typeof options === 'object' && Array.isArray(args)) {
            const isBrowser = args.some(a => typeof a === 'string' && a.startsWith('--remote-debugging-'));
            const isHeadless = args.some(a => typeof a === 'string' && a.startsWith('--headless'));
            if (isBrowser && !isHeadless) {
                options = { ...options, windowsHide: false };
            }
        }
        return origSpawn.call(this, command, args, options);
    };
    childProcess._golemSpawnPatched = true;
}
const puppeteer = require('rebrowser-puppeteer');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { exec, execSync } = require('child_process');
const { PORT } = require('../config');
const { getSettings } = require('../settings');
const { renderSearchBlock } = require('../searchRenderer');
const browserScanner = require('../browserScanner');

// ==========================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ ПРОВАЙДЕРА
// ==========================================
let browser;
let page;
let isInitializing = false;
let currentPort = PORT;
let isBrowserBusy = false;
let taskQueue = [];
let currentRequestId = 0;
let activeGenerationId = null;
let isAuthInProgress = false;
const networkStreamEvents = new EventEmitter();
let initQueue = Promise.resolve();

const MODELS = [
    { id: "deepseek-chat", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-chat-search", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-chat-think", object: "model", owned_by: "deepseek-system" },
    { id: "deepseek-chat-search-think", object: "model", owned_by: "deepseek-system" }
];

const DB_FILE = path.join(__dirname, '../deepseek_accounts.json');

function getDb() {
    if (fs.existsSync(DB_FILE)) {
        try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { }
    }
    const db = { active: 0, accounts: [] };
    if (process.env.SESSION_TOKEN && process.env.COOKIES) {
        db.accounts.push({ name: "Основной профиль (.env)", token: process.env.SESSION_TOKEN.replace(/(^"|"$)/g, ''), cookies: process.env.COOKIES });
    }
    return db;
}

function saveDb(db) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) { }
}

function renewAuth() {
    console.log('\n[⚠️ DeepSeek] ВНИМАНИЕ: База пуста или сессия мертва. Добавьте аккаунт!');
}

async function safeCloseBrowser(br) {
    if (!br) return;
    try {
        br._isIntentionalClose = true;
        const proc = br.process();
        const pid = proc ? proc.pid : null;

        try {
            const openPages = await br.pages().catch(() => []);
            await Promise.all(openPages.map(p => p.close().catch(() => { })));
        } catch (e) { }

        await Promise.race([br.close().catch(() => { }), new Promise(r => setTimeout(r, 4000))]);

        if (pid) {
            let isAlive = false;
            try {
                process.kill(pid, 0);
                isAlive = true;
            } catch (e) {
                isAlive = false;
            }

            if (isAlive) {
                if (process.platform === 'win32') {
                    try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); } catch (e) { }
                } else {
                    try { process.kill(pid, 'SIGKILL'); } catch (e) { }
                }
            }
            await new Promise(r => setTimeout(r, 350));
        }
    } catch (err) { }
}

async function saveMediaToTempFile(dataOrUrl) {
    try {
        if (!dataOrUrl || typeof dataOrUrl !== 'string') return null;

        // Надежный парсинг Base64 (работает с любыми форматами, которые шлет OpenAI/SillyTavern)
        if (dataOrUrl.includes('base64,')) {
            const base64Data = dataOrUrl.split('base64,')[1];
            let ext = 'jpg';
            if (dataOrUrl.includes('image/png')) ext = 'png';
            else if (dataOrUrl.includes('image/webp')) ext = 'webp';
            else if (dataOrUrl.includes('image/gif')) ext = 'gif';

            const buffer = Buffer.from(base64Data, 'base64');
            const tempFilePath = path.join(os.tmpdir(), `ds_upload_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
            fs.writeFileSync(tempFilePath, buffer);
            return tempFilePath;
        }

        // Обработка прямых ссылок
        if (dataOrUrl.startsWith('http://') || dataOrUrl.startsWith('https://')) {
            return new Promise((resolve) => {
                const client = dataOrUrl.startsWith('https://') ? https : http;
                client.get(dataOrUrl, (res) => {
                    if (res.statusCode !== 200) return resolve(null);
                    const contentType = res.headers['content-type'] || 'image/jpeg';
                    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
                    const tempFilePath = path.join(os.tmpdir(), `ds_upload_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
                    const fileStream = fs.createWriteStream(tempFilePath);
                    res.pipe(fileStream);
                    fileStream.on('finish', () => resolve(tempFilePath));
                }).on('error', () => resolve(null));
            });
        }
    } catch (e) {
        console.error('[❌ DeepSeek] Ошибка сохранения файла на диск:', e.message);
    }
    return null;
}

async function applyHeadlessAntiDetect(browserInstance, pageInstance) {
    try {
        const rawUA = await browserInstance.userAgent();
        if (!rawUA || !rawUA.includes('Headless')) return;

        const cleanUA = rawUA.replace(/Headless/g, '');
        const isEdge = rawUA.includes('Edg/') || rawUA.includes('HeadlessEdg/');

        const realUAData = await pageInstance.evaluate(async () => {
            if (!navigator.userAgentData) return null;
            const hi = await navigator.userAgentData.getHighEntropyValues([
                'architecture', 'bitness', 'fullVersionList', 'model', 'platform', 'platformVersion'
            ]);
            return {
                brands: navigator.userAgentData.brands || [],
                mobile: Boolean(navigator.userAgentData.mobile),
                platform: hi.platform || navigator.userAgentData.platform || 'Windows',
                platformVersion: hi.platformVersion || '',
                architecture: hi.architecture || 'x86',
                bitness: hi.bitness || '64',
                model: hi.model || '',
                fullVersionList: hi.fullVersionList || []
            };
        }).catch(() => null);

        const cleanBrandList = (list) => {
            if (!Array.isArray(list) || list.length === 0) return undefined;
            const mapped = [];
            const seen = new Set();
            for (const item of list) {
                let brand = String(item.brand || '');
                if (brand === 'HeadlessEdg') brand = 'Microsoft Edge';
                else if (brand === 'HeadlessChrome') brand = isEdge ? 'Microsoft Edge' : 'Google Chrome';
                else brand = brand.replace(/Headless/g, '').trim();
                if (!brand || seen.has(brand)) continue;
                seen.add(brand);
                mapped.push({ brand, version: String(item.version || '') });
            }
            return mapped;
        };

        let userAgentMetadata;
        if (realUAData) {
            const brands = cleanBrandList(realUAData.brands);
            const fullVersionList = cleanBrandList(realUAData.fullVersionList);
            const mainEntry = (fullVersionList || []).find(
                b => b.brand === 'Microsoft Edge' || b.brand === 'Google Chrome' || b.brand === 'Chromium'
            );
            userAgentMetadata = {
                ...(brands ? { brands } : {}),
                ...(fullVersionList ? { fullVersionList } : {}),
                fullVersion: mainEntry ? mainEntry.version : '',
                platform: realUAData.platform,
                platformVersion: realUAData.platformVersion,
                architecture: realUAData.architecture,
                model: realUAData.model,
                mobile: realUAData.mobile,
                bitness: realUAData.bitness
            };
        }

        await pageInstance.setUserAgent(cleanUA, userAgentMetadata);
    } catch (e) { }
}

async function getBrowserCookiesCompat(browserInstance, pageInstance) {
    if (browserInstance && typeof browserInstance.cookies === 'function') {
        return await browserInstance.cookies();
    }
    return await pageInstance.cookies();
}

async function setCookiesCompat(browserInstance, pageInstance, cookies) {
    if (!Array.isArray(cookies) || cookies.length === 0) return;
    if (typeof pageInstance.setCookie === 'function') {
        await pageInstance.setCookie(...cookies);
    } else if (browserInstance && typeof browserInstance.setCookie === 'function') {
        await browserInstance.setCookie(...cookies);
    }
}

// ==========================================
// ЯДРО: ИНИЦИАЛИЗАЦИЯ И ANTI-DETECT
// ==========================================
async function initProviderCore(port = PORT) {
    return new Promise(async (resolve) => {
        const watchdog = setTimeout(async () => {
            console.error('\n[❌ DeepSeek] КРИТИЧЕСКИЙ ТАЙМАУТ ИНИЦИАЛИЗАЦИИ. Снимаю блокировки!');
            isInitializing = false;
            isBrowserBusy = false;
            await safeCloseBrowser(browser);
            browser = null;
            resolve();
        }, 60000);

        try {
            currentPort = port;
            isInitializing = true;

            if (browser) {
                console.log('\n[♻️ DeepSeek] Очищаю старую сессию (убиваю процесс)...');
                await safeCloseBrowser(browser);
                browser = null;
                page = null;
            }

            const db = getDb();
            if (!db.accounts || db.accounts.length === 0) { renewAuth(); throw new Error("No accounts"); }

            const activeAcc = db.accounts[db.active] || db.accounts[0];
            const accToken = activeAcc.token;
            const accCookies = activeAcc.cookies;

            if (!accToken || !accCookies) { renewAuth(); throw new Error("No tokens"); }

            console.log('[⚙️ DeepSeek] Создаем голема в тенях...');
            const currentSettings = typeof getSettings === 'function' ? getSettings() : { providerSettings: {} };
            const dsConfig = currentSettings.providerSettings?.deepseek || {};
            const isVisible = Boolean(dsConfig.showBrowser);

            const selectedBrowser = await browserScanner.resolveBrowserSelection(dsConfig, puppeteer);
            const safeBrowserTag = (selectedBrowser.id || 'default').replace(/[^a-z0-9_-]/gi, '_');
            const profileDir = path.join(__dirname, '../deepseek_profiles', `acc_${db.active || 0}_${safeBrowserTag}`);
            if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });
            for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'parent.lock']) {
                const lockPath = path.join(profileDir, lockFile);
                try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch (e) { }
            }

            const { browserInfo, launchOptions } = await browserScanner.buildLaunchOptions({
                config: dsConfig,
                userDataDir: profileDir,
                headless: !isVisible,
                width: 1280,
                height: 800,
                puppeteerLib: puppeteer
            });

            console.log(`[🌐 DeepSeek] Движок: ${browserInfo.name} [${browserInfo.engine}] | Режим: ${isVisible ? 'Видимое окно' : 'Скрытый (Headless)'} (${browserInfo.path || 'built-in'})`);
            const newBrowser = await puppeteer.launch(launchOptions);

            browser = newBrowser;

            newBrowser.on('disconnected', () => {
                if (browser === newBrowser && !newBrowser._isIntentionalClose) {
                    console.log('\n[⚠️ DeepSeek] ВНИМАНИЕ: Окно браузера было принудительно закрыто!');
                    isBrowserBusy = false;
                    isInitializing = false;
                    browser = null; page = null;
                }
            });

            const existingPages = await browser.pages();
            page = existingPages[0] || await browser.newPage();

            if (isVisible) {
                await browserScanner.ensureWindowVisible(browser, page, 1280, 800);
            } else if (browserInfo.engine === 'chromium') {
                await applyHeadlessAntiDetect(browser, page);
            }

            // 🛑 БЛОКИРОВКА РЕСУРСОВ (ТОЛЬКО ДЛЯ CHROMIUM И ТОЛЬКО ПРИ АКТИВАЦИИ В НАСТРОЙКАХ)
            if (dsConfig.blockResources && browserInfo.engine === 'chromium') {
                await page.setRequestInterception(true);
                page.on('request', (req) => {
                    const resourceType = req.resourceType();
                    const url = req.url();

                    if (['font', 'media', 'texttrack', 'eventsource', 'manifest'].includes(resourceType)) {
                        return req.abort();
                    }
                    if (url.includes('google-analytics') || url.includes('sentry') || url.includes('sensorsdata')) {
                        return req.abort();
                    }
                    req.continue();
                });
            }

            await page.exposeFunction('emitChunkToNode', (reqId, text) => networkStreamEvents.emit('chunk', { reqId, text }));
            await page.exposeFunction('emitEndToNode', (reqId) => networkStreamEvents.emit('end', { reqId }));

            // 💉 ОРИГИНАЛЬНЫЙ ВОССТАНОВЛЕННЫЙ ТРОЯН (XHR + FETCH) + ЖЕСТКИЙ KILL SWITCH
            await page.evaluateOnNewDocument(() => {
                window._nodeRequestId = 0;

                const originalOpen = XMLHttpRequest.prototype.open;
                const originalSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.open = function (method, url) {
                    this._isVampTarget = (typeof url === 'string' && url.includes('completion'));
                    return originalOpen.apply(this, arguments);
                };
                XMLHttpRequest.prototype.send = function () {
                    if (this._isVampTarget) {
                        this._myReqId = window._nodeRequestId;
                        let lastLength = 0;
                        this.addEventListener('readystatechange', function () {
                            if (this._myReqId !== window._nodeRequestId) { this.abort(); return; }
                            try {
                                if (this.readyState === 3 || this.readyState === 4) {
                                    const text = this.responseText || (typeof this.response === 'string' ? this.response : '');
                                    if (text) {
                                        const newDelta = text.substring(lastLength);
                                        lastLength = text.length;
                                        if (newDelta && window.emitChunkToNode) window.emitChunkToNode(this._myReqId, newDelta);
                                    }
                                }
                            } catch (e) { }
                            if (this.readyState === 4 && window.emitEndToNode) window.emitEndToNode(this._myReqId);
                        });
                    }
                    return originalSend.apply(this, arguments);
                };

                const originalFetch = window.fetch;
                window.fetch = async function (...args) {
                    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
                    const response = await originalFetch.apply(this, args);

                    if (url.includes('/api/v0/chat/completion') && response.body) {
                        const myReqId = window._nodeRequestId;
                        const clone = response.clone();
                        if (!response.ok || (response.headers.get('content-type') || '').includes('application/json')) {
                            clone.text().then(text => {
                                if (window._nodeRequestId === myReqId && window.emitChunkToNode) window.emitChunkToNode(myReqId, `data: {"custom_error": ${JSON.stringify(text)}}\n\n`);
                                if (window._nodeRequestId === myReqId && window.emitEndToNode) window.emitEndToNode(myReqId);
                            }).catch(() => { if (window._nodeRequestId === myReqId && window.emitEndToNode) window.emitEndToNode(myReqId); });
                            return response;
                        }

                        const reader = clone.body.getReader();
                        const decoder = new TextDecoder('utf-8');
                        (async () => {
                            try {
                                while (true) {
                                    if (window._nodeRequestId !== myReqId) { await reader.cancel().catch(() => { }); break; }
                                    const { done, value } = await reader.read();
                                    if (window._nodeRequestId !== myReqId) break;
                                    if (done) { if (window.emitEndToNode) window.emitEndToNode(myReqId); break; }
                                    const chunk = decoder.decode(value, { stream: true });
                                    if (chunk && window.emitChunkToNode) window.emitChunkToNode(myReqId, chunk);
                                }
                            } catch (e) { if (window._nodeRequestId === myReqId && window.emitEndToNode) window.emitEndToNode(myReqId); }
                        })();
                    }
                    return response;
                };
            });

            if (Array.isArray(activeAcc.cookiesJson) && activeAcc.cookiesJson.length > 0) {
                await setCookiesCompat(browser, page, activeAcc.cookiesJson).catch(() => { });
            } else if (accCookies) {
                const cookies = accCookies.split(';').map(pair => {
                    const index = pair.indexOf('=');
                    if (index === -1) return null;
                    const name = pair.substring(0, index).trim();
                    const value = pair.substring(index + 1).trim();
                    if (!name) return null;
                    if (name.startsWith('__Host-')) {
                        return { name, value, url: 'https://chat.deepseek.com', path: '/', secure: true };
                    }
                    return { name, value, domain: '.deepseek.com', path: '/' };
                }).filter(c => c !== null);
                await setCookiesCompat(browser, page, cookies).catch(() => { });
            }

            if (accToken) {
                await page.evaluateOnNewDocument((tokenText) => {
                    if (!location.hostname.endsWith('deepseek.com')) return;
                    let t = tokenText.replace(/^['"]|['"]$/g, '');
                    try { let parsed = JSON.parse(t); if (parsed.value) t = parsed.value; } catch (e) { }
                    localStorage.setItem('userToken', JSON.stringify({ value: t, __version: "0" }));
                }, accToken);
            }

            console.log(`[⚙️ DeepSeek] Открываем основную сцену...`);
            await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
            await new Promise(r => setTimeout(r, 2500));

            const captchaCleared = await checkAndHandleCaptcha(page);
            if (!captchaCleared) console.log('[⚠️ DeepSeek] Внимание: Капча AWS WAF не была пройдена.');

            const isSignedOut = await page.evaluate(() => {
                const bodyText = document.body ? document.body.innerText : '';
                return window.location.href.includes('sign_in')
                    || bodyText.includes('You have signed out of your account')
                    || bodyText.includes('please log in again')
                    || bodyText.includes('Вы вышли из аккаунта')
                    || !localStorage.getItem('userToken');
            });

            if (isSignedOut) {
                console.error('[❌ DeepSeek] Сессия протухла. Начинаю сброс...');
                await safeCloseBrowser(browser);
                browser = null;
                renewAuth();
                throw new Error("Session expired");
            }

            console.log(`[✨ DeepSeek] Голем на позиции (${browserInfo.name} / ${browserInfo.engine}). Fetch/XHR инжектирован.`);
        } catch (err) {
            if (err.message !== "No accounts" && err.message !== "No tokens" && err.message !== "Session expired") {
                console.error('[❌ DeepSeek] Ошибка инициализации:', err.message);
            }
        } finally {
            clearTimeout(watchdog);
            isInitializing = false;
            resolve();
        }
    });
}

async function initProvider(port = PORT) {
    initQueue = initQueue.then(() => initProviderCore(port)).catch(err => {
        console.error('Ошибка очереди DeepSeek:', err.message);
    });
    await initQueue;
}

// ==========================================
// МАРШРУТЫ И АВТО-АВТОРИЗАЦИЯ
// ==========================================
function setupRoutes(app, port) {
    app.get('/api/deepseek/accounts', (req, res) => res.json(getDb()));

    app.post('/api/deepseek/accounts', async (req, res) => {
        const oldDb = getDb();
        saveDb(req.body);
        res.json({ success: true });
        if (req.body.active !== oldDb.active) {
            console.log('[⚙️ DeepSeek] Смена активного профиля...');
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
                db.accounts.push({ name: `Профиль #${db.accounts.length + 1}`, token: cleanToken, cookies: cookies });
                db.active = db.accounts.length - 1;
            }
            saveDb(db);
            console.log('[🔑 DeepSeek] ПЕЙЛОАД ПЕРЕХВАЧЕН! Профиль сохранен.');
            let html = fs.readFileSync(path.join(__dirname, '../views/success.html'), 'utf8');
            html = html.replace('{{TITLE}}', 'Сессия перехвачена!').replace('{{MESSAGE}}', 'Аккаунт успешно добавлен.').replace(/{{COLOR}}/g, '#3b82f6');
            res.send(html);
            isBrowserBusy = false;
            await initProvider(currentPort);
        } else {
            res.status(400).send('Ошибка данных.');
        }
    });

    app.post('/api/deepseek/reload', async (req, res) => {
        try {
            const db = getDb();
            if (!db.accounts || db.accounts.length === 0) {
                return res.json({ success: true, skipped: true });
            }
            isBrowserBusy = false;
            await initProvider(currentPort);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.get('/api/deepseek/auto-auth', async (req, res) => {
        if (isAuthInProgress) {
            console.log('[⚠️ DeepSeek] Заблокирована попытка двойного открытия окна авторизации.');
            if (!res.headersSent) return res.status(429).json({ errorCode: 'ds_auth_in_progress', error: 'Процесс авторизации уже запущен!' });
            return;
        }

        isAuthInProgress = true;
        let authBrowser = null;
        let checkLogin = null;

        try {
            if (browser) {
                console.log('[⚙️ DeepSeek] Останавливаю фоновый процесс перед входом...');
                await safeCloseBrowser(browser);
                browser = null;
                page = null;
                isBrowserBusy = false;
            }

            console.log('[🔑 DeepSeek] Запуск видимого браузера для авторизации...');
            const dsConfig = (typeof getSettings === 'function' ? getSettings() : {}).providerSettings?.deepseek || {};
            const authProfileDir = path.join(__dirname, '../deepseek_profiles', `profile_${Date.now()}`);
            if (!fs.existsSync(authProfileDir)) fs.mkdirSync(authProfileDir, { recursive: true });

            const { browserInfo, launchOptions: authLaunchOptions } = await browserScanner.buildLaunchOptions({
                config: dsConfig,
                userDataDir: authProfileDir,
                headless: false,
                width: 1200,
                height: 800,
                puppeteerLib: puppeteer
            });

            console.log(`[🔑 DeepSeek] Авторизация в: ${browserInfo.name} [${browserInfo.engine}]`);
            authBrowser = await puppeteer.launch(authLaunchOptions);
            console.log('[🔑 DeepSeek] Процесс браузера запущен, открываю страницу входа...');

            let isAuthSuccess = false;
            let isChecking = false;

            authBrowser.on('disconnected', () => {
                if (!isAuthSuccess && !authBrowser._isIntentionalClose) {
                    if (checkLogin) clearInterval(checkLogin);
                    isAuthInProgress = false;
                    console.log('[⚠️ DeepSeek] Окно авторизации было закрыто или завершило работу.');
                    if (!res.headersSent) {
                        res.status(400).json({ errorCode: 'ds_auth_closed', error: 'Окно закрыто' });
                    }
                    if (getDb().accounts.length > 0) {
                        initProvider(currentPort).catch(() => { });
                    }
                }
            });

            const authPages = await authBrowser.pages();
            const authPage = authPages[0] || await authBrowser.newPage();
            await browserScanner.ensureWindowVisible(authBrowser, authPage, 1200, 800);
            await authPage.goto('https://chat.deepseek.com/sign_in', { waitUntil: 'domcontentloaded', timeout: 25000 });
            await browserScanner.ensureWindowVisible(authBrowser, authPage, 1200, 800);
            console.log('[🔑 DeepSeek] Страница входа открыта. Жду авторизацию...');

            checkLogin = setInterval(async () => {
                if (isAuthSuccess || isChecking) return;
                isChecking = true;
                try {
                    if (!authBrowser.connected) {
                        clearInterval(checkLogin);
                        isAuthInProgress = false;
                        if (!res.headersSent) return res.status(400).json({ errorCode: 'ds_auth_closed', error: 'Окно закрыто' });
                        return;
                    }
                    const authState = await authPage.evaluate(() => {
                        const val = localStorage.getItem('userToken');
                        if (!val) return null;
                        let token = val;
                        try { token = JSON.parse(val).value; } catch (e) { }
                        return { token, url: window.location.href };
                    });
                    if (authState && authState.token && !authState.url.includes('sign_in') && !isAuthSuccess) {
                        isAuthSuccess = true;
                        clearInterval(checkLogin);
                        await new Promise(r => setTimeout(r, 3000));
                        const cookiesArray = await getBrowserCookiesCompat(authBrowser, authPage);
                        const cookiesStr = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');
                        const db = getDb();
                        db.accounts.push({
                            name: `Профиль #${db.accounts.length + 1}`,
                            token: authState.token.replace(/(^"|"$)/g, ''),
                            cookies: cookiesStr,
                            cookiesJson: cookiesArray,
                            profileDir: authProfileDir
                        });
                        db.active = db.accounts.length - 1;
                        saveDb(db);
                        console.log(`[✅ DeepSeek] Аккаунт и профиль сохранены! Закрываю окно.`);
                        await safeCloseBrowser(authBrowser);
                        isAuthInProgress = false;
                        isBrowserBusy = false;
                        await initProvider(currentPort);
                        if (!res.headersSent) res.json({ success: true });
                    }
                } catch (e) { } finally { isChecking = false; }
            }, 2000);

            setTimeout(async () => {
                if (!isAuthSuccess) {
                    if (checkLogin) clearInterval(checkLogin);
                    if (authBrowser) await safeCloseBrowser(authBrowser);
                    isAuthInProgress = false;
                    if (!res.headersSent) res.status(408).json({ errorCode: 'ds_auth_timeout', error: 'Таймаут авторизации' });
                }
            }, 5 * 60 * 1000);

        } catch (err) {
            console.error('[❌ DeepSeek] Ошибка запуска окна авторизации:', err.message);
            if (checkLogin) clearInterval(checkLogin);
            if (authBrowser) await safeCloseBrowser(authBrowser);
            isAuthInProgress = false;
            if (!res.headersSent) res.status(500).json({ error: err.message });
            if (getDb().accounts.length > 0) {
                initProvider(currentPort).catch(() => { });
            }
        }
    });
}

// ==========================================
// ОБРАБОТКА КАПЧИ AWS WAF
// ==========================================
async function checkAndHandleCaptcha(page) {
    try {
        const isCaptchaPresent = await page.evaluate(() => {
            return !!document.querySelector('#captcha-container') || (document.title && document.title.includes('Human Verification'));
        });
        if (isCaptchaPresent) {
            console.log('[⚠️ DeepSeek] Обнаружена капча AWS WAF. Перезагружаем страницу...');
            await page.reload({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { });
            await new Promise(r => setTimeout(r, 3000));
            return !(await page.evaluate(() => { return !!document.querySelector('#captcha-container') || (document.title && document.title.includes('Human Verification')); }));
        }
    } catch (err) { return false; }
    return true;
}

async function handleChatCompletion(req, res) {
    if (isInitializing || !page || page.isClosed()) {
        return res.status(503).json({ error: { message: "Провайдер DeepSeek инициализируется.", type: "server_loading" } });
    }

    const currentSettings = getSettings();
    const isDebug = currentSettings.debugMode;
    const isStream = req.body.stream;
    const sendThink = currentSettings.providerSettings?.deepseek?.sendThink ?? true;
    let requestedModel = req.body.model || currentSettings.defaultModel || "deepseek-chat";

    if (isStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.flushHeaders();
    }

    currentRequestId++;
    const myRequestId = currentRequestId;
    let isClientDisconnected = false;
    let isFinished = false;

    res.on('close', () => { isClientDisconnected = true; });

    const checkAborted = () => {
        if (isClientDisconnected && !isFinished) return 'STOP (Клиент разорвал соединение)';
        return false;
    };

    // 🛡️ СТРОГАЯ FIFO-ОЧЕРЕДЬ С ЗАЩИТОЙ ОТ RACE CONDITIONS
    let pingInterval;
    if (isStream) {
        pingInterval = setInterval(() => {
            if (!res.writableEnded) res.write(`data: ${JSON.stringify({ id: "ping", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {} }] })}\n\n`);
        }, 5000);
    }

    const proceed = await new Promise(resolve => {
        let abortCheckInterval;

        const originalResolve = (val) => {
            if (abortCheckInterval) clearInterval(abortCheckInterval);
            resolve(val);
        };

        const attemptStart = () => {
            if (!isBrowserBusy) {
                isBrowserBusy = true; // Сразу захватываем контроль
                originalResolve(true);
            } else {
                taskQueue.push({ resolve: originalResolve, myRequestId });
            }
        };

        attemptStart();

        // Проверяем отмену соединения, пока висим в очереди
        abortCheckInterval = setInterval(() => {
            if (checkAborted()) {
                const idx = taskQueue.findIndex(t => t.myRequestId === myRequestId);
                if (idx !== -1) taskQueue.splice(idx, 1);
                originalResolve(false);
            }
        }, 500);
    });

    if (pingInterval) clearInterval(pingInterval);

    if (!proceed) {
        console.log(`[⚠️ DeepSeek] Запрос [ID: ${myRequestId}] отменен в очереди. Причина: ${checkAborted()}`);
        if (isStream && !res.writableEnded) res.end();
        return;
    }

    let sseBuffer = '';
    let searchResults = [];
    let isThinkingContext = false;
    let fullAnswer = '';

    const tempUploadedFiles = [];

    // 💉 ОРИГИНАЛЬНЫЙ ПАРСЕР ЧАНКОВ (С ФИЛЬТРОМ ID)
    const handleChunk = (payload) => {
        if (!payload || payload.reqId !== myRequestId) return;
        const rawText = payload.text;
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
                const shouldSendThink = typeof sendThink !== 'undefined' ? sendThink : true;

                // 1. Ошибки сервера
                if (data?.custom_error) {
                    let errStr = data.custom_error;
                    try { const j = JSON.parse(errStr); errStr = j.message || j.error?.message || errStr; } catch (e) { }
                    chunkDelta += `\n❌ [СЕРВЕР DEEPSEEK УПАЛ]: ${errStr}\nСервера сейчас под шквалом запросов.`;
                    isFinished = true;
                }

                if (data?.p === 'response/status' && data?.v === 'FINISHED') isFinished = true;
                if (data?.quasi_status === 'FINISHED') isFinished = true;

                if (data?.o === 'SET' && typeof data?.p === 'string' && data.p.includes('/content')) {
                    continue;
                }

                if (data?.v?.response?.fragments) {
                    if (fullAnswer.length === 0) {
                        for (const frag of data.v.response.fragments) {
                            if (frag.type === 'THINK') {
                                if (!isThinkingContext) { isThinkingContext = true; if (shouldSendThink) chunkDelta += `<think>\n`; }
                                if (shouldSendThink) chunkDelta += frag.content || '';
                            }
                            else if (frag.type === 'RESPONSE') {
                                if (isThinkingContext) { isThinkingContext = false; if (shouldSendThink) chunkDelta += `\n\n</think>\n\n`; }
                                chunkDelta += frag.content || '';
                            }
                        }
                    }
                }

                if (data?.p === 'response' && data?.o === 'BATCH' && Array.isArray(data?.v)) {
                    for (const item of data.v) {
                        if (item.p === 'quasi_status' && item.v === 'FINISHED') isFinished = true;
                        if (item.p === 'fragments' && item.o === 'APPEND' && Array.isArray(item.v)) {
                            for (const frag of item.v) {
                                if (frag.type === 'THINK') {
                                    if (!isThinkingContext) { isThinkingContext = true; if (shouldSendThink) chunkDelta += `<think>\n`; }
                                    if (shouldSendThink) chunkDelta += frag.content || '';
                                }
                                else if (frag.type === 'RESPONSE') {
                                    if (isThinkingContext) { isThinkingContext = false; if (shouldSendThink) chunkDelta += `\n\n</think>\n\n`; }
                                    chunkDelta += frag.content || '';
                                }
                            }
                        }
                    }
                }

                if (data?.p === 'response/fragments' && data?.o === 'APPEND' && Array.isArray(data?.v)) {
                    for (const frag of data.v) {
                        if (frag.type === 'THINK') {
                            if (!isThinkingContext) { isThinkingContext = true; if (shouldSendThink) chunkDelta += `<think>\n`; }
                            if (shouldSendThink) chunkDelta += frag.content || '';
                        }
                        else if (frag.type === 'RESPONSE') {
                            if (isThinkingContext) { isThinkingContext = false; if (shouldSendThink) chunkDelta += `\n\n</think>\n\n`; }
                            chunkDelta += frag.content || '';
                        }
                    }
                }

                // Прямое добавление слов (работает как часы)
                if (typeof data?.v === 'string' && (!data?.p || data.p.endsWith('/content'))) {
                    if (!isThinkingContext || shouldSendThink) {
                        chunkDelta += data.v;
                    }
                }

                if (data?.p === 'response/fragments/-1/results' && Array.isArray(data?.v)) searchResults = data.v;

                // Отправка клиенту
                if (chunkDelta) {
                    fullAnswer += chunkDelta;
                    if (isDebug) process.stdout.write(chunkDelta);
                    if (isStream && !res.writableEnded) {
                        res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: chunkDelta } }] })}\n\n`);
                    }
                }
            } catch (e) { }
        }
    };

    const onEnd = (payload) => { if (payload && payload.reqId === myRequestId) isFinished = true; };

    try {
        const messages = req.body.messages || [];

        // 📷 ИЗВЛЕЧЕНИЕ ТЕКСТА И ИЗОБРАЖЕНИЙ
        let promptText = '';
        for (const m of messages) {
            const role = (m.role || 'user').toUpperCase();
            if (typeof m.content === 'string') {
                promptText += `${role}:\n${m.content}\n\n`;
            } else if (Array.isArray(m.content)) {
                const textParts = [];
                for (const part of m.content) {
                    if (part.type === 'text' && part.text) {
                        textParts.push(part.text);
                    } else if (part.type === 'image_url' && part.image_url) {
                        const imgUrl = typeof part.image_url === 'string' ? part.image_url : (part.image_url.url || '');
                        const tempPath = await saveMediaToTempFile(imgUrl);
                        if (tempPath) tempUploadedFiles.push(tempPath);
                    }
                }
                if (textParts.length > 0) {
                    promptText += `${role}:\n${textParts.join('\n')}\n\n`;
                }
            }
        }
        promptText = promptText.trim();

        console.log(`[🚀 DeepSeek] Старт генерации [ID: ${myRequestId}] -> Модель: ${requestedModel}`);
        console.log(`[🐛 DEBUG] Промпт готовится. Найдено файлов для загрузки: ${tempUploadedFiles.length}`);

        if (checkAborted()) throw new Error(checkAborted());

        // 🧹 НАДЁЖНЫЙ СБРОС СОСТОЯНИЯ ПЕРЕД НАЧАЛОМ (Защита от залипания UI)
        let isClean = await page.evaluate(() => window.location.href.endsWith('chat.deepseek.com/'));
        if (!isClean) {
            await page.evaluate(() => {
                const elements = document.querySelectorAll('div, span');
                for (let el of elements) {
                    if (el.textContent === 'New chat' || el.textContent === 'Новый чат') {
                        const clickable = el.closest('div[tabindex="0"]');
                        if (clickable) { clickable.click(); break; }
                    }
                }
            });
            try {
                // Строго ждем, пока UI не перейдет на корень
                await page.waitForFunction(() => window.location.href.endsWith('chat.deepseek.com/'), { timeout: 2500 });
            } catch (e) {
                await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
            }
            await new Promise(r => setTimeout(r, 1000));
        } else {
            // Даже если в корне, жмем New Chat на случай застрявших состояний
            await page.evaluate(() => {
                const elements = document.querySelectorAll('div, span');
                for (let el of elements) {
                    if (el.textContent === 'New chat' || el.textContent === 'Новый чат') {
                        const clickable = el.closest('div[tabindex="0"]');
                        if (clickable) { clickable.click(); break; }
                    }
                }
            });
            await new Promise(r => setTimeout(r, 500));
        }

        if (checkAborted()) throw new Error(checkAborted());
        const captchaCleared = await checkAndHandleCaptcha(page);
        if (!captchaCleared) throw new Error('Не удалось обойти капчу AWS WAF.');

        const wantsSearch = requestedModel.includes('search');
        const wantsThink = requestedModel.includes('think') || requestedModel.includes('reasoner');

        // ПЕРЕКЛЮЧЕНИЕ ТОЛЬКО КНОПОК ПОИСКА И МЫШЛЕНИЯ (Модель теперь единая)
        await page.evaluate((search, think) => {
            const toggleButtons = Array.from(document.querySelectorAll('.ds-toggle-button, [role="switch"]'));
            
            const searchBtn = toggleButtons.find(btn => btn.textContent && (btn.textContent.includes('Умный поиск') || btn.textContent.includes('Search')));
            if (searchBtn) {
                const isSelected = searchBtn.classList.contains('ds-toggle-button--selected') || searchBtn.getAttribute('aria-pressed') === 'true' || searchBtn.getAttribute('aria-checked') === 'true';
                if (search !== isSelected) searchBtn.click();
            }

            const thinkBtn = toggleButtons.find(btn => btn.textContent && (btn.textContent.includes('Глубокое мышление') || btn.textContent.includes('DeepThink')));
            if (thinkBtn) {
                const isSelected = thinkBtn.classList.contains('ds-toggle-button--selected') || thinkBtn.getAttribute('aria-pressed') === 'true' || thinkBtn.getAttribute('aria-checked') === 'true';
                if (think !== isSelected) thinkBtn.click();
            }
        }, wantsSearch, wantsThink);

        // Небольшая пауза для применения состояния кнопок
        await new Promise(r => setTimeout(r, 500));
        if (checkAborted()) throw new Error(checkAborted());

        // 📝 ШАГ 1: ВСТАВЛЯЕМ ТЕКСТ ДО ЗАГРУЗКИ КАРТИНКИ!
        // Это решает баг: во время загрузки React жестко блокирует поле ввода.
        // Поэтому мы вводим текст ДО того, как начнется загрузка файла.
        await page.waitForSelector('textarea');

        // Если текст пустой (отправили только картинку), задаем дефолтный, 
        // иначе кнопка отправки может не разблокироваться.
        if (!promptText || promptText.trim() === '') {
            promptText = 'Опиши это изображение подробно.';
        }

        const inserted = await page.evaluate(async (text) => {
            const textarea = document.querySelector('textarea');
            if (!textarea) return false;
            try {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                nativeSetter.call(textarea, text);
                textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                textarea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
                textarea.click();
                return textarea.value.length > 0;
            } catch (e) { return false; }
        }, promptText);

        if (!inserted) {
            console.log('[⚠️ DeepSeek] Первый метод вставки не сработал, пробую Clipboard API...');
            try {
                const context = browser.defaultBrowserContext();
                await context.overridePermissions('https://chat.deepseek.com', ['clipboard-read', 'clipboard-write']);
            } catch (e) { }
            await page.evaluate(async (text) => {
                const textarea = document.querySelector('textarea');
                if (!textarea) return;
                textarea.focus();
                await navigator.clipboard.writeText(text);
                document.execCommand('paste');
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }, promptText);
        }

        const textInField = await page.evaluate(() => {
            const ta = document.querySelector('textarea');
            return ta ? ta.value.length : 0;
        });

        if (textInField < 1) {
            throw new Error(`ТЕКСТ НЕ ВСТАВИЛСЯ! В поле ${textInField} символов из ${promptText.length}`);
        }
        console.log(`[✅ DeepSeek] Вставлено ${textInField} символов текста.`);
        await new Promise(r => setTimeout(r, 500));

        // 📎 ШАГ 2: ЗАГРУЖАЕМ ФАЙЛЫ
        if (tempUploadedFiles.length > 0) {
            console.log(`[📎 DeepSeek] Инициирую загрузку ${tempUploadedFiles.length} файла(ов)...`);
            try {
                const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 5000 });
                await fileInput.uploadFile(...tempUploadedFiles);
                console.log(`[📎 DeepSeek] Файлы переданы браузеру. Ждем окончания обработки на серверах...`);

                await page.waitForFunction(() => {
                    const sendBtn = document.querySelector('.ds-button--circle.ds-button--primary');
                    if (!sendBtn) return false;
                    return !sendBtn.classList.contains('ds-button--disabled');
                }, { timeout: 60000 });

                console.log('[✅ DeepSeek] Файлы загружены, кнопка отправки АКТИВНА!');
                await new Promise(r => setTimeout(r, 1000));
            } catch (uploadErr) {
                console.log(`[❌ DeepSeek] Ошибка при загрузке картинки: ${uploadErr.message}`);
            }
        }

        activeGenerationId = myRequestId;

        await page.evaluate((id) => { window._nodeRequestId = id; }, myRequestId);

        networkStreamEvents.on('chunk', handleChunk);
        networkStreamEvents.on('end', onEnd);

        await page.evaluate(() => {
            const sendBtn = document.querySelector('.ds-button--circle.ds-button--primary');
            if (sendBtn && !sendBtn.classList.contains('ds-button--disabled')) {
                sendBtn.click();
            }
        });

        await page.keyboard.press('Enter');

        const timeoutSec = Math.max(30, parseInt(currentSettings.providerSettings?.deepseek?.requestTimeoutSec) || 600);
        let failSafe = 0;
        while (!isFinished) {
            if (checkAborted()) throw new Error(checkAborted());
            await new Promise(r => setTimeout(r, 500));
            failSafe++;
            if (isStream && !res.writableEnded && failSafe % 10 === 0) res.write(`data: ${JSON.stringify({ id: "ping", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: {} }] })}\n\n`);
            if (failSafe > timeoutSec * 2) {
                if (isDebug) console.log('[🐛 DEBUG] Таймаут генерации.');
                break;
            }
        }

        if (checkAborted()) throw new Error(checkAborted());

        if (fullAnswer.trim() === '') {
            const pageError = await page.evaluate(() => {
                const bodyText = document.body ? document.body.innerText : '';
                if (bodyText.includes('You have signed out of your account') || bodyText.includes('please log in again') || window.location.href.includes('sign_in')) {
                    return 'Сессия разлогинена (You have signed out). Авторизуйся заново через Авто-вход!';
                }
                const err = document.querySelector('.arco-message-error, .arco-message-content, [class*="toast"]');
                return err ? err.innerText : null;
            });
            if (pageError) throw new Error(`DeepSeek UI Заблочил: ${pageError}`);
            throw new Error('СГЕНЕРИРОВАН ПУСТОЙ ОТВЕТ! Сервера лежат, ответ полностью пуст.');
        }

        if (isThinkingContext) {
            isThinkingContext = false;
            if (typeof sendThink === 'undefined' || sendThink) {
                const closeThink = `\n\n</think>\n\n`;
                fullAnswer += closeThink;
                if (isDebug) process.stdout.write(closeThink);
                if (isStream && !res.writableEnded) res.write(`data: ${JSON.stringify({ id: "ds-chat", object: "chat.completion.chunk", model: requestedModel, choices: [{ delta: { content: closeThink } }] })}\n\n`);
            }
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
            if (!res.writableEnded) isStream ? res.end() : res.status(500).json({ error: { message: err.message } });
        }
    } finally {
        isFinished = true;

        activeGenerationId = null;

        networkStreamEvents.off('chunk', handleChunk);
        networkStreamEvents.off('end', onEnd);

        // Очистка созданных временных файлов картинок
        for (const f of tempUploadedFiles) {
            try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { }
        }

        // 💉 ОЧИСТКА ЧАТОВ
        try {
            await new Promise(r => setTimeout(r, 1500));
            const currentUrl = page.url();
            const match = currentUrl.match(/chat\/s\/([a-z0-9-]+)/i);
            const sessionToKill = match ? match[1] : null;

            await page.evaluate(() => {
                const elements = document.querySelectorAll('div, span');
                for (let el of elements) {
                    if (el.textContent === 'New chat' || el.textContent === 'Новый чат') {
                        const clickable = el.closest('div[tabindex="0"]');
                        if (clickable) { clickable.click(); break; }
                    }
                }
            });

            await new Promise(r => setTimeout(r, 1000));

            const autoDeleteChats = getSettings().providerSettings?.deepseek?.autoDeleteChats !== false;
            if (sessionToKill && autoDeleteChats) {
                // ДОЖИДАЕМСЯ УХОДА С ЧАТА ПЕРЕД УДАЛЕНИЕМ API (Фиксит ошибку "This chat has been deleted")
                try {
                    await page.waitForFunction(() => window.location.href.endsWith('chat.deepseek.com/'), { timeout: 2000 });
                } catch (e) { }

                await page.evaluate(async (id) => {
                    const tokenRaw = localStorage.getItem('userToken');
                    if (!tokenRaw) return;
                    try {
                        await fetch('/api/v0/chat_session/delete', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json', 'authorization': `Bearer ${JSON.parse(tokenRaw).value}` },
                            body: JSON.stringify({ chat_session_id: id })
                        });
                    } catch (e) { }
                }, sessionToKill);
                if (getSettings().debugMode) console.log(`[🧹 DeepSeek] Облачный чат ${sessionToKill} очищен.`);
            }
        } catch (e) {
            if (getSettings().debugMode) console.error('[❌ DeepSeek] Ошибка при удалении чата:', e.message);
        }

        // 🛡️ ПЕРЕДАЧА ЭСТАФЕТЫ СЛЕДУЮЩЕМУ В ОЧЕРЕДИ
        if (taskQueue.length > 0) {
            const nextTask = taskQueue.shift();
            nextTask.resolve(true); // Запускаем следующий. isBrowserBusy остается true!
        } else {
            isBrowserBusy = false; // Очередь пуста, освобождаем браузер
        }
    }
}

async function unloadProvider() {
    console.log(`[⚙️ DeepSeek] Выгрузка...`);
    await safeCloseBrowser(browser);
    browser = null; page = null;
    isInitializing = false; isBrowserBusy = false;
}

module.exports = { MODELS, initProvider, setupRoutes, handleChatCompletion, unloadProvider };