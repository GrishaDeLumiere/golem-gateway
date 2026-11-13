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
            if (!activeAcc.profileDir) {
                activeAcc.profileDir = path.join(__dirname, '../deepseek_profiles', `acc_${db.active || 0}_${Date.now()}_${safeBrowserTag}`);
                saveDb(db);
            }
            const profileDir = activeAcc.profileDir;
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

            const profileSeed = profileDir.split('').reduce((acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0, 0);

            // 💉 СТЕЛС-ПЕРЕХВАТЧИК (МАСКИРОВКА [native code] + WEAKMAP + АНТИФРОД)
            await page.evaluateOnNewDocument((seed) => {
                const nativeSignatures = new WeakMap();
                const origToString = Function.prototype.toString;
                const markNative = (fn, name) => {
                    if (typeof fn === 'function') {
                        nativeSignatures.set(fn, `function ${name || fn.name || ''}() { [native code] }`);
                    }
                    return fn;
                };

                const stealthToString = function () {
                    if (nativeSignatures.has(this)) return nativeSignatures.get(this);
                    return origToString.apply(this, arguments);
                };
                markNative(stealthToString, 'toString');
                Function.prototype.toString = stealthToString;

                let currentReqId = 0;
                Object.defineProperty(window, '_nodeRequestId', {
                    get: markNative(() => currentReqId, 'get _nodeRequestId'),
                    set: markNative((v) => { currentReqId = v; }, 'set _nodeRequestId'),
                    enumerable: false,
                    configurable: true
                });

                for (const fnName of ['emitChunkToNode', 'emitEndToNode']) {
                    if (fnName in window) {
                        const boundFn = window[fnName];
                        markNative(boundFn, fnName);
                        try {
                            Object.defineProperty(window, fnName, {
                                value: boundFn,
                                enumerable: false,
                                configurable: true,
                                writable: true
                            });
                        } catch (e) { }
                    }
                }

                try {
                    const getVis = markNative(() => 'visible', 'get visibilityState');
                    const getHid = markNative(() => false, 'get hidden');
                    Object.defineProperty(Document.prototype, 'visibilityState', { get: getVis, configurable: true, enumerable: true });
                    Object.defineProperty(Document.prototype, 'hidden', { get: getHid, configurable: true, enumerable: true });
                    window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);

                    // Глушим детекторы pressF12 и showContextMenu из модуля 37869
                    window.addEventListener('keydown', (e) => {
                        if (e.keyCode === 123 || e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 67))) {
                            e.stopImmediatePropagation();
                        }
                    }, true);
                    window.addEventListener('contextmenu', (e) => {
                        e.stopImmediatePropagation();
                    }, true);
                } catch (e) { }

                try {
                    const shift = (Math.abs(seed) % 7) + 1;
                    const cores = [4, 6, 8, 12, 16][Math.abs(seed) % 5];
                    const mem = [4, 8, 16][Math.abs(seed >> 3) % 3];
                    const getCores = markNative(() => cores, 'get hardwareConcurrency');
                    const getMem = markNative(() => mem, 'get deviceMemory');
                    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: getCores, configurable: true, enumerable: true });
                    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: getMem, configurable: true, enumerable: true });

                    // Спуфинг WebGL (UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL) и высоты панели задач для Shumei (SMSdk)
                    const gpuPool = [
                        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)'],
                        ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)']
                    ];
                    const [spoofVendor, spoofRenderer] = gpuPool[Math.abs(seed >> 2) % gpuPool.length];

                    for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
                        if (Ctx && Ctx.prototype && Ctx.prototype.getParameter) {
                            const origGetParam = Ctx.prototype.getParameter;
                            Ctx.prototype.getParameter = markNative(function (param) {
                                if (param === 37445) return spoofVendor;
                                if (param === 37446) return spoofRenderer;
                                return origGetParam.apply(this, arguments);
                            }, 'getParameter');
                        }
                    }

                    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
                    CanvasRenderingContext2D.prototype.getImageData = markNative(function (...a) {
                        const img = origGetImageData.apply(this, a);
                        if (img && img.data && img.data.length > 16) {
                            img.data[0] = (img.data[0] + shift) & 0xff;
                            img.data[5] = (img.data[5] + shift) & 0xff;
                        }
                        return img;
                    }, 'getImageData');

                    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
                    HTMLCanvasElement.prototype.toDataURL = markNative(function (...a) {
                        try {
                            const ctx = this.getContext('2d');
                            if (ctx && this.width > 2 && this.height > 2) {
                                const px = origGetImageData.call(ctx, 0, 0, 1, 1);
                                px.data[0] = (px.data[0] + shift) & 0xff;
                                ctx.putImageData(px, 0, 0);
                            }
                        } catch (e) { }
                        return origToDataURL.apply(this, a);
                    }, 'toDataURL');

                    if (window.AudioBuffer && AudioBuffer.prototype.getChannelData) {
                        const origGetChannelData = AudioBuffer.prototype.getChannelData;
                        AudioBuffer.prototype.getChannelData = markNative(function (...a) {
                            const data = origGetChannelData.apply(this, a);
                            if (data && data.length > 10) {
                                data[0] = data[0] + (shift * 1e-7);
                            }
                            return data;
                        }, 'getChannelData');
                    }
                } catch (e) { }

                const xhrMeta = new WeakMap();
                const originalOpen = XMLHttpRequest.prototype.open;
                const originalSend = XMLHttpRequest.prototype.send;

                XMLHttpRequest.prototype.open = markNative(function (method, url) {
                    xhrMeta.set(this, { isTarget: (typeof url === 'string' && url.includes('completion')) });
                    return originalOpen.apply(this, arguments);
                }, 'open');

                XMLHttpRequest.prototype.send = markNative(function () {
                    const meta = xhrMeta.get(this);
                    if (meta && meta.isTarget) {
                        const myReqId = window._nodeRequestId;
                        let lastLength = 0;
                        this.addEventListener('readystatechange', function () {
                            if (myReqId !== window._nodeRequestId) { this.abort(); return; }
                            try {
                                if (this.readyState === 3 || this.readyState === 4) {
                                    const text = this.responseText || (typeof this.response === 'string' ? this.response : '');
                                    if (text) {
                                        const newDelta = text.substring(lastLength);
                                        lastLength = text.length;
                                        if (newDelta && window.emitChunkToNode) window.emitChunkToNode(myReqId, newDelta);
                                    }
                                }
                            } catch (e) { }
                            if (this.readyState === 4 && window.emitEndToNode) window.emitEndToNode(myReqId);
                        });
                    }
                    return originalSend.apply(this, arguments);
                }, 'send');

                const originalFetch = window.fetch;
                window.fetch = markNative(async function (...args) {
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
                }, 'fetch');
            }, profileSeed);

            const hasExistingProfile = fs.existsSync(path.join(profileDir, 'Default', 'Network', 'Cookies'))
                || fs.existsSync(path.join(profileDir, 'Default', 'Cookies'));

            if (!hasExistingProfile) {
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
            }

            console.log(`[⚙️ DeepSeek] Открываем основную сцену...`);
            await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
            await new Promise(r => setTimeout(r, 1500));

            // Если в профиле браузера еще нет userToken, однократно подставляем его из базы
            const currentBrowserToken = await page.evaluate(() => localStorage.getItem('userToken')).catch(() => null);
            if (!currentBrowserToken && accToken) {
                await page.evaluate((tokenText) => {
                    let t = tokenText.replace(/^['"]|['"]$/g, '');
                    try { let parsed = JSON.parse(t); if (parsed.value) t = parsed.value; } catch (e) { }
                    localStorage.setItem('userToken', JSON.stringify({ value: t, __version: "0" }));
                }, accToken).catch(() => { });
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await new Promise(r => setTimeout(r, 1500));
            }

            // Авто-синхронизация: если ты вошел в новый аккаунт прямо в окне браузера, сохраняем его токен и куки в базу
            page.on('framenavigated', async (frame) => {
                if (frame !== page.mainFrame()) return;
                const url = frame.url();
                if (!url.startsWith('https://chat.deepseek.com') || url.includes('/sign_in') || url.includes('/authorized')) return;
                try {
                    const rawToken = await page.evaluate(() => localStorage.getItem('userToken'));
                    if (!rawToken) return;
                    let cleanToken = rawToken;
                    try {
                        const parsed = JSON.parse(rawToken);
                        if (parsed && parsed.value) cleanToken = parsed.value;
                    } catch (e) { }
                    const currentDb = getDb();
                    const currAcc = currentDb.accounts[currentDb.active] || currentDb.accounts[0];
                    if (currAcc && cleanToken && currAcc.token !== cleanToken) {
                        const freshCookies = await getBrowserCookiesCompat(browser, page);
                        currAcc.token = cleanToken;
                        currAcc.cookiesJson = freshCookies;
                        currAcc.cookies = freshCookies.map(c => `${c.name}=${c.value}`).join('; ');
                        saveDb(currentDb);
                        console.log('[🔑 DeepSeek] Обнаружен вход в новый аккаунт в окне браузера — токен и куки автоматически сохранены!');
                    }
                } catch (e) { }
            });

            const captchaCleared = await checkAndHandleCaptcha(page);
            if (!captchaCleared) console.log('[⚠️ DeepSeek] Внимание: Капча AWS WAF не была пройдена.');

            const accountStatus = await page.evaluate(() => {
                const bodyText = document.body ? document.body.innerText : '';
                const alertEl = document.querySelector('.ds-alert--warning, .ds-alert__content');
                const banText = alertEl ? alertEl.innerText.trim() : '';
                const isBanned = banText.includes('заблокирована до')
                    || banText.includes('blocked until')
                    || banText.includes('violating')
                    || bodyText.includes('ваш аккаунт заблокирован')
                    || bodyText.includes('Ваш аккаунт проверяется');
                const isSignedOut = window.location.href.includes('sign_in')
                    || bodyText.includes('You have signed out of your account')
                    || bodyText.includes('please log in again')
                    || bodyText.includes('Вы вышли из своей учетной записи')
                    || bodyText.includes('Вы вышли из аккаунта')
                    || !localStorage.getItem('userToken');
                return { isBanned, banText: banText || 'Аккаунт заблокирован или на проверке', isSignedOut };
            });

            if (accountStatus.isBanned) {
                console.warn(`\n[⏳ DeepSeek] ВНИМАНИЕ: Аккаунт временно ограничен: "${accountStatus.banText}". Сессия и профиль сохранены до разбана!\n`);
            } else if (accountStatus.isSignedOut) {
                console.error('[❌ DeepSeek] На текущем профиле не выполнен вход в аккаунт.');
                renewAuth();
                if (!isVisible) {
                    await safeCloseBrowser(browser);
                    browser = null;
                    throw new Error("Session expired");
                }
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
// НАТИВНЫЕ ДЕЙСТВИЯ МЫШИ, ВВОДА И КАПЧИ
// ==========================================
async function nativeMouseClick(page, box) {
    if (!box) return false;
    const jitterX = (Math.random() - 0.5) * 6;
    const jitterY = (Math.random() - 0.5) * 6;
    const targetX = Math.max(2, Math.round(box.x + jitterX));
    const targetY = Math.max(2, Math.round(box.y + jitterY));

    const start = page._lastMousePos || {
        x: 400 + Math.floor(Math.random() * 240),
        y: 300 + Math.floor(Math.random() * 180)
    };

    // Строим дугу с боковым отклонением 10..22px, чтобы точки не удалялись фильтром ±2px
    const arcSide = Math.random() > 0.5 ? 1 : -1;
    const arcOffset = (10 + Math.random() * 12) * arcSide;
    const midX = (start.x + targetX) / 2 + arcOffset;
    const midY = (start.y + targetY) / 2 - arcOffset * 0.6;

    const steps = 4;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const inv = 1 - t;
        const curX = Math.round(inv * inv * start.x + 2 * inv * t * midX + t * t * targetX);
        const curY = Math.round(inv * inv * start.y + 2 * inv * t * midY + t * t * targetY);
        await page.mouse.move(curX, curY);
        if (i < steps) {
            await new Promise(r => setTimeout(r, 42 + Math.floor(Math.random() * 12)));
        }
    }

    page._lastMousePos = { x: targetX, y: targetY };
    await new Promise(r => setTimeout(r, 45 + Math.floor(Math.random() * 15)));
    await page.mouse.click(targetX, targetY);
    return true;
}

async function clickNewChatViaUI(page) {
    const box = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span, div'));
        for (const el of spans) {
            if (el.children.length === 0 && (el.textContent?.trim() === 'Новый чат' || el.textContent?.trim() === 'New chat')) {
                const clickable = el.closest('[tabindex="0"], [role="button"]') || el.parentElement;
                if (clickable) {
                    const r = clickable.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                    }
                }
            }
        }
        return null;
    });
    if (box) {
        await nativeMouseClick(page, box);
        return true;
    }
    return false;
}

async function deleteChatViaUI(page, sessionId) {
    try {
        const chatCoords = await page.evaluate((sid) => {
            const links = Array.from(document.querySelectorAll('a[href*="/chat/s/"]'));
            const targetLink = (sid ? links.find(a => a.getAttribute('href')?.includes(sid)) : null) || links[0];
            if (!targetLink) return null;
            const r = targetLink.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: targetLink.getAttribute('href') };
        }, sessionId);

        if (!chatCoords) return false;

        // Наводим мышь на чат в боковом меню, чтобы появились три точки
        await page.mouse.move(Math.round(chatCoords.x), Math.round(chatCoords.y), { steps: 2 });
        await new Promise(r => setTimeout(r, 90));

        const dotsBox = await page.evaluate((href) => {
            const link = document.querySelector(`a[href="${href}"]`) || document.querySelector('a[href*="/chat/s/"]');
            if (!link) return null;
            const btn = link.querySelector('[role="button"], .ds-button');
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return null;
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, chatCoords.href);

        if (!dotsBox) return false;
        await nativeMouseClick(page, dotsBox);

        // Ждем появления пункта «Удалить» в выпадающем меню
        let delOptionBox = null;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 70));
            delOptionBox = await page.evaluate(() => {
                const nodes = Array.from(document.querySelectorAll('.ds-floating-container *, [role="menu"] *, [role="menuitem"], div, span'));
                for (let j = nodes.length - 1; j >= 0; j--) {
                    const el = nodes[j];
                    if (el.children.length === 0 && (el.textContent?.trim() === 'Удалить' || el.textContent?.trim() === 'Delete')) {
                        const row = el.closest('[role="menuitem"], [role="button"], [tabindex], div') || el;
                        const r = row.getBoundingClientRect();
                        if (r.width > 10 && r.height > 10 && r.height < 60 && r.top > 0) {
                            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                        }
                    }
                }
                return null;
            });
            if (delOptionBox) break;
        }

        if (!delOptionBox) return false;
        await nativeMouseClick(page, delOptionBox);

        // Ждем появления красной кнопки «Удалить чат» в модалке .ds-modal
        let confirmBox = null;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 70));
            confirmBox = await page.evaluate(() => {
                const btn = document.querySelector('.ds-modal .ds-button--error, [role="dialog"] .ds-button--error');
                if (!btn) return null;
                const r = btn.getBoundingClientRect();
                if (r.width > 10 && r.height > 10) {
                    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                }
                return null;
            });
            if (confirmBox) break;
        }

        if (!confirmBox) return false;
        await nativeMouseClick(page, confirmBox);
        await new Promise(r => setTimeout(r, 250));
        return true;
    } catch (e) {
        return false;
    }
}

async function checkAndHandleCaptcha(page) {
    try {
        const state = await page.evaluate(() => {
            const aws = !!document.querySelector('#captcha-container') || (document.title && document.title.includes('Human Verification'));
            const cfOverlay = document.querySelector('#cf-overlay');
            const cfVisible = cfOverlay && window.getComputedStyle(cfOverlay).display !== 'none' && cfOverlay.offsetWidth > 0;
            return { aws, cfVisible };
        });

        if (state.cfVisible) {
            console.log('[⚠️ DeepSeek] Активно окно проверки Cloudflare Turnstile (#cf-overlay). Ждем прохождения...');
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const box = await page.evaluate(() => {
                    const cf = document.querySelector('#cf-turnstile');
                    if (!cf) return null;
                    const r = cf.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return { x: r.left + 28, y: r.top + r.height / 2 };
                    return null;
                });
                if (box && i === 2) await nativeMouseClick(page, box);

                const stillVisible = await page.evaluate(() => {
                    const cfOverlay = document.querySelector('#cf-overlay');
                    return Boolean(cfOverlay && window.getComputedStyle(cfOverlay).display !== 'none' && cfOverlay.offsetWidth > 0);
                });
                if (!stillVisible) return true;
            }
        }

        if (state.aws) {
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

        // 🧹 ПРОВЕРКА ЧИСТОГО ЧАТА (Кликаем «Новый чат» только если открыта старая сессия)
        const needsNewChat = await page.evaluate(() => {
            const inSession = window.location.pathname.includes('/chat/s/');
            const hasMessages = document.querySelectorAll('.ds-message').length > 0;
            return inSession || hasMessages;
        });

        if (needsNewChat) {
            const clickedNew = await clickNewChatViaUI(page);
            if (clickedNew) {
                try {
                    await page.waitForFunction(() => !window.location.pathname.includes('/chat/s/'), { timeout: 2500 });
                } catch (e) {
                    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
                }
                await new Promise(r => setTimeout(r, 300));
            } else {
                await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (checkAborted()) throw new Error(checkAborted());
        const captchaCleared = await checkAndHandleCaptcha(page);
        if (!captchaCleared) throw new Error('Не удалось обойти капчу.');

        const wantsSearch = requestedModel.includes('search');
        const wantsThink = requestedModel.includes('think') || requestedModel.includes('reasoner');

        // АППАРАТНОЕ ПЕРЕКЛЮЧЕНИЕ КНОПОК ПОИСКА И МЫШЛЕНИЯ (isTrusted: true)
        const togglesToClick = await page.evaluate((search, think) => {
            const boxes = [];
            const toggleButtons = Array.from(document.querySelectorAll('.ds-toggle-button, [role="switch"]'));

            const thinkBtn = toggleButtons.find(btn => btn.textContent && (btn.textContent.includes('Глубокое мышление') || btn.textContent.includes('DeepThink')));
            if (thinkBtn) {
                const isSelected = thinkBtn.classList.contains('ds-toggle-button--selected') || thinkBtn.getAttribute('aria-pressed') === 'true' || thinkBtn.getAttribute('aria-checked') === 'true';
                if (think !== isSelected) {
                    const r = thinkBtn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) boxes.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
                }
            }

            const searchBtn = toggleButtons.find(btn => btn.textContent && (btn.textContent.includes('Умный поиск') || btn.textContent.includes('Search')));
            if (searchBtn) {
                const isSelected = searchBtn.classList.contains('ds-toggle-button--selected') || searchBtn.getAttribute('aria-pressed') === 'true' || searchBtn.getAttribute('aria-checked') === 'true';
                if (search !== isSelected) {
                    const r = searchBtn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) boxes.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
                }
            }

            return boxes;
        }, wantsSearch, wantsThink);

        for (const box of togglesToClick) {
            await nativeMouseClick(page, box);
            await new Promise(r => setTimeout(r, 120));
        }

        if (checkAborted()) throw new Error(checkAborted());

        // ПРОВЕРКА НА ВРЕМЕННЫЙ БАН ИЛИ ПРОВЕРКУ АККАУНТА ПЕРЕД ПОИСКОМ ПОЛЯ ВВОДА
        const banMessage = await page.evaluate(() => {
            const alertEl = document.querySelector('.ds-alert--warning, .ds-alert__content');
            if (alertEl) {
                const txt = alertEl.innerText.trim();
                if (txt.includes('заблокирована до') || txt.includes('blocked until') || txt.includes('violating')) return txt;
            }
            const bodyText = document.body ? document.body.innerText : '';
            if (bodyText.includes('В результате нарушений ваш аккаунт заблокирован')) return 'В результате нарушений ваш аккаунт заблокирован.';
            if (bodyText.includes('Ваш аккаунт проверяется')) return 'Ваш аккаунт проверяется.';
            return null;
        });

        if (banMessage) {
            throw new Error(`Аккаунт временно ограничен DeepSeek: ${banMessage}`);
        }

        // 📝 ШАГ 1: АППАРАТНЫЙ ФОКУС И МГНОВЕННАЯ НАТИВНАЯ ВСТАВКА ТЕКСТА
        await page.waitForSelector('textarea', { timeout: 15000 });

        if (!promptText || promptText.trim() === '') {
            promptText = 'Опиши это изображение подробно.';
        }

        const taInfo = await page.evaluate(() => {
            const ta = document.querySelector('textarea');
            if (!ta) return null;
            ta.spellcheck = false;
            ta.setAttribute('spellcheck', 'false');
            const r = ta.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });

        if (taInfo) {
            await nativeMouseClick(page, taInfo);
        }

        const sendAsFile = Boolean(currentSettings.providerSettings?.deepseek?.sendAsFile);
        const useTxtFileAttachment = sendAsFile && promptText.length > 2000;

        if (useTxtFileAttachment) {
            // Режим .txt-вложения: отдаем полный промпт в нативный обработчик vw через ClipboardEvent('paste')
            await page.evaluate((fullText) => {
                const textarea = document.querySelector('textarea');
                if (!textarea) return;
                const dt = new DataTransfer();
                dt.setData('text/plain', fullText);
                const pasteEvt = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clipboardData: dt
                });
                textarea.dispatchEvent(pasteEvt);
            }, promptText);

            console.log(`[📄 DeepSeek] Промпт (${promptText.length} симв.) передан как .txt файл. Ждем загрузки вложения...`);
            await page.waitForFunction(() => {
                const sendBtn = document.querySelector('.ds-button--circle.ds-button--primary');
                return sendBtn && !sendBtn.classList.contains('ds-button--disabled');
            }, { timeout: 45000 });

            console.log(`[✅ DeepSeek] .txt вложение загружено (${promptText.length} симв.), кнопка отправки активна.`);
            await new Promise(r => setTimeout(r, 550 + Math.floor(Math.random() * 150)));
        } else {
            // Обычный текстовый режим: в paste передаем <= 1500 символов (чтобы vw не создавал .txt, а React записал input_text_paste)
            const headText = promptText.length > 1 ? promptText.slice(0, -1) : '';
            const tailChar = promptText.length > 1 ? promptText.slice(-1) : promptText;
            const safePasteSample = promptText.slice(0, 1500);

            if (headText) {
                await page.evaluate((text, pasteSample) => {
                    const textarea = document.querySelector('textarea');
                    if (!textarea) return;
                    try {
                        const dt = new DataTransfer();
                        dt.setData('text/plain', pasteSample);
                        const pasteEvt = new ClipboardEvent('paste', {
                            bubbles: true,
                            cancelable: true,
                            composed: true,
                            clipboardData: dt
                        });
                        textarea.dispatchEvent(pasteEvt);
                    } catch (e) { }
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    nativeSetter.call(textarea, text);
                    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    textarea.setSelectionRange(text.length, text.length);
                }, headText, safePasteSample);
            } else {
                await page.evaluate(() => {
                    const textarea = document.querySelector('textarea');
                    if (!textarea) return;
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    nativeSetter.call(textarea, '');
                    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                });
            }

            const cdp = await page.createCDPSession();
            await cdp.send('Input.insertText', { text: tailChar });
            await cdp.detach().catch(() => { });

            let textInField = await page.evaluate(() => {
                const ta = document.querySelector('textarea');
                return ta ? ta.value.length : 0;
            });

            if (textInField < 1) {
                await page.evaluate((text) => {
                    const textarea = document.querySelector('textarea');
                    if (!textarea) return;
                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    nativeSetter.call(textarea, text);
                    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                }, promptText);
                textInField = await page.evaluate(() => document.querySelector('textarea')?.value.length || 0);
            }

            if (textInField < 1) {
                throw new Error(`ТЕКСТ НЕ ВСТАВИЛСЯ! В поле ${textInField} символов из ${promptText.length}`);
            }
            console.log(`[✅ DeepSeek] Вставлено ${textInField} символов текста.`);
            // Пауза 550-700 мс после фокуса, чтобы preparePow() успел завершиться и записал retrievePowAnswer
            await new Promise(r => setTimeout(r, 550 + Math.floor(Math.random() * 150)));
        }

        // 📎 ШАГ 2: ЗАГРУЖАЕМ КАРТИНКИ/ФАЙЛЫ (ЕСЛИ ЕСТЬ)
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
                await new Promise(r => setTimeout(r, 400));
            } catch (uploadErr) {
                console.log(`[❌ DeepSeek] Ошибка при загрузке картинки: ${uploadErr.message}`);
            }
        }

        activeGenerationId = myRequestId;

        await page.evaluate((id) => { window._nodeRequestId = id; }, myRequestId);

        networkStreamEvents.on('chunk', handleChunk);
        networkStreamEvents.on('end', onEnd);

        if (useTxtFileAttachment) {
            const sendBtnBox = await page.evaluate(() => {
                const sendBtn = document.querySelector('.ds-button--circle.ds-button--primary:not(.ds-button--disabled)');
                if (!sendBtn) return null;
                const r = sendBtn.getBoundingClientRect();
                return (r.width > 0 && r.height > 0) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
            });
            if (sendBtnBox) {
                await nativeMouseClick(page, sendBtnBox);
            } else {
                await page.keyboard.press('Enter');
            }
        } else {
            await page.keyboard.press('Enter');
        }

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
                if (bodyText.includes('You have signed out of your account') || bodyText.includes('please log in again') || bodyText.includes('Вы вышли из своей учетной записи') || window.location.href.includes('sign_in')) {
                    return 'Вы вышли из своей учетной записи, пожалуйста, войдите снова.';
                }
                if (bodyText.includes('В результате нарушений ваш аккаунт заблокирован')) return 'В результате нарушений ваш аккаунт заблокирован.';
                if (bodyText.includes('Ваш аккаунт проверяется')) return 'Ваш аккаунт проверяется.';
                if (bodyText.includes('Слишком много запросов')) return 'Слишком много запросов. Попробуйте позже.';
                if (bodyText.includes('Проверка не пройдена')) return 'Проверка PoW не пройдена.';
                if (bodyText.includes('Сервер занят') || bodyText.includes('Сервер перегружен')) return 'Сервер перегружен.';
                const err = document.querySelector('.ds-notification-container, .arco-message-error, .arco-message-content, [class*="toast"]');
                return err && err.innerText.trim() ? err.innerText.trim() : null;
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

        // 💉 ШТАТНАЯ ОЧИСТКА ЧАТА ЧЕРЕЗ КНОПКУ «УДАЛИТЬ» В UI
        try {
            await new Promise(r => setTimeout(r, 350));
            const currentUrl = page.url();
            const match = currentUrl.match(/chat\/s\/([a-z0-9-]+)/i);
            const sessionToKill = match ? match[1] : null;
            const autoDeleteChats = getSettings().providerSettings?.deepseek?.autoDeleteChats !== false;

            if (sessionToKill && autoDeleteChats) {
                const deleted = await deleteChatViaUI(page, sessionToKill);
                if (deleted) {
                    if (getSettings().debugMode) console.log(`[🧹 DeepSeek] Чат ${sessionToKill} штатно удален через UI.`);
                } else {
                    await clickNewChatViaUI(page);
                }
            } else {
                await clickNewChatViaUI(page);
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