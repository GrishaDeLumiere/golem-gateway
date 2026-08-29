const fs = require('fs');
const path = require('path');
const { getSettings } = require('../settings');

const CREDENTIAL_FILE = path.join(__dirname, '..', 'gemini_api_accounts.json');

// Глобальный кэш моделей
let cachedModels = [];
let lastModelFetch = 0;

// Экспортируемый геттер для Голема (маршрутизатор будет тянуть отсюда)
const MODELS = new Proxy([], {
    get(target, prop) {
        if (prop === 'length') return cachedModels.length;
        if (prop === Symbol.iterator) return cachedModels[Symbol.iterator].bind(cachedModels);
        return cachedModels[prop];
    }
});

// --- УПРАВЛЕНИЕ БАЗОЙ КЛЮЧЕЙ ---
function readDb() {
    if (fs.existsSync(CREDENTIAL_FILE)) {
        try { return JSON.parse(fs.readFileSync(CREDENTIAL_FILE, 'utf8')); } catch (e) { }
    }
    return { active: 0, accounts: [] };
}

function writeDb(db) {
    fs.writeFileSync(CREDENTIAL_FILE, JSON.stringify(db, null, 2));
}

function getActiveAccount() {
    const db = readDb();
    if (db.accounts.length === 0) return null;
    return db.accounts[db.active] || db.accounts[0];
}

async function fetchGoogleModels(apiKey) {
    if (!apiKey) return;
    if (Date.now() - lastModelFetch < 3600000 && cachedModels.length > 0) return; // Кэш 1 час

    try {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': apiKey }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.models) {
                cachedModels = data.models.map(m => ({
                    id: m.name.replace('models/', ''),
                    object: "model",
                    owned_by: "google"
                }));
                lastModelFetch = Date.now();
                console.log(`[🚀 Gemini API] Загружено ${cachedModels.length} моделей в кэш.`);
            }
        }
    } catch (e) {
        console.error(`[❌ Gemini API] Ошибка загрузки моделей:`, e.message);
    }
}

async function initProvider(port) {
    console.log(`[🚀 Gemini API] Официальный модуль загружен.`);
    const active = getActiveAccount();
    if (active && active.token) {
        await fetchGoogleModels(active.token);
    }
}

function unloadProvider() { }

function setupRoutes(app, PORT) {
    app.get('/api/gemini_api/accounts', (req, res) => res.json(readDb()));
    app.post('/api/gemini_api/accounts', (req, res) => {
        writeDb(req.body);
        const active = getActiveAccount();
        if (active && active.token) fetchGoogleModels(active.token);
        res.json({ success: true, db: readDb() });
    });
}

// --- ЛОГИКА ИНФЕРЕНСА ---
async function handleChatCompletion(req, res) {
    const settings = getSettings();
    let apiKey = null;

    const authHeader = req.headers.authorization || "";
    const clientKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (clientKey.startsWith("AIzaSy")) {
        apiKey = clientKey;
    } else {
        const activeAcc = getActiveAccount();
        if (activeAcc && activeAcc.token) apiKey = activeAcc.token;
    }

    if (!apiKey) {
        return res.status(401).json({ error: { message: "API ключ Google не найден. Добавьте AIzaSy... ключ в пуле аккаунтов." } });
    }

    try {
        const openaiReq = req.body;
        const rawModel = openaiReq.model || "gemini-3.7-flash";
        const modelName = rawModel.replace(/^(models\/|gemini-api\/|api\/)/, '');
        const isStreaming = !!openaiReq.stream;
        const isDebug = settings.debugMode;

        const geminiApiSet = settings.providerSettings?.gemini_api || {};

        // Авто-детекция агентных моделей (Deep Research, Antigravity)
        const isAgentModel = modelName.includes('deep-research') || modelName.includes('antigravity');

        // Режим слияния (Flatten): включен пользователем или для агентов
        const isSingleTurn = geminiApiSet.singleTurn === true || (geminiApiSet.autoAgent !== false && isAgentModel);

        // Использовать Interactions API
        const useInteractions = geminiApiSet.useInteractions === true || isAgentModel;

        let systemText = "";
        const geminiContents = [];
        let combinedFlattenText = "";
        const combinedFlattenImages = [];
        let hasImages = false;

        // 1. СБОРКА ИСТОРИИ (FLATTEN ИЛИ MULTITURN) + ПОДДЕРЖКА VISION
        for (const msg of openaiReq.messages || []) {
            const role = (msg.role || '').toLowerCase();
            let textOnly = "";
            let currentParts = [];

            if (typeof msg.content === 'string') {
                textOnly = msg.content;
                currentParts.push({ text: textOnly });
            } else if (Array.isArray(msg.content)) {
                for (const item of msg.content) {
                    if (item.type === 'text') {
                        textOnly += item.text + "\n";
                        currentParts.push({ text: item.text });
                    } else if (item.type === 'image_url' && item.image_url?.url) {
                        const match = item.image_url.url.match(/^data:(.*?);base64,(.*)$/);
                        if (match) {
                            hasImages = true;
                            currentParts.push({
                                inlineData: { mimeType: match[1], data: match[2] }
                            });
                        }
                    }
                }
            } else {
                textOnly = JSON.stringify(msg.content);
                currentParts.push({ text: textOnly });
            }

            if (role === "system") {
                systemText += textOnly + "\n\n";
            } else {
                const isModel = role === 'assistant';

                if (isSingleTurn) {
                    // В режиме Flatten текст сливаем в один, а картинки откладываем
                    combinedFlattenText += `\n\n--- ${isModel ? 'ASSISTANT' : 'USER'} ---\n${textOnly.trim()}`;
                    const imagesOnly = currentParts.filter(p => p.inlineData);
                    combinedFlattenImages.push(...imagesOnly);
                } else {
                    geminiContents.push({
                        role: isModel ? 'model' : 'user',
                        parts: currentParts
                    });
                }
            }
        }

        if (isSingleTurn) {
            // Собираем Flatten: текст + все картинки, что были в истории
            const flattenParts = [{ text: combinedFlattenText.trim() }, ...combinedFlattenImages];
            geminiContents.push({
                role: 'user',
                parts: flattenParts
            });
        }

        // 2. СБОРКА SAFETY SETTINGS
        const sendSafety = geminiApiSet.sendSafety !== false;
        const safetySettingsArr = [];

        if (sendSafety) {
            const isGemma = modelName.toLowerCase().includes('gemma');

            // Текстовые фильтры (едят все модели без исключения)
            if (geminiApiSet.safeHarassment !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" });
            if (geminiApiSet.safeHate !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" });
            if (geminiApiSet.safeSex !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" });
            if (geminiApiSet.safeDanger !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" });
            if (geminiApiSet.safeCivic) safetySettingsArr.push({ category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" });
            if (geminiApiSet.safeJailbreak) safetySettingsArr.push({ category: "HARM_CATEGORY_JAILBREAK", threshold: "OFF" });

            // Фильтры для КАРТИНОК шлём ТОЛЬКО если:
            if (hasImages && !isGemma) {
                if (geminiApiSet.safeImageHarassment !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_IMAGE_HARASSMENT", threshold: "OFF" });
                if (geminiApiSet.safeImageHate !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_IMAGE_HATE", threshold: "OFF" });
                if (geminiApiSet.safeImageSex !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT", threshold: "OFF" });
                if (geminiApiSet.safeImageDanger !== false) safetySettingsArr.push({ category: "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT", threshold: "OFF" });
            }
        }

        const payload = {};
        let endpoint = "";

        // 3. МАРШРУТИЗАЦИЯ И PAYLOAD
        if (useInteractions) {
            endpoint = `https://generativelanguage.googleapis.com/v1beta/interactions${isStreaming ? '?alt=sse' : ''}`;

            if (isAgentModel && geminiApiSet.autoAgent !== false) {
                payload.agent = modelName;
                payload.background = true; // Требование Google для агентов
                payload.store = true;
            } else {
                payload.model = modelName;
                payload.store = false;
            }

            payload.input = combinedFlattenText.trim();
            if (systemText.trim()) payload.system_instruction = systemText.trim();

            if (safetySettingsArr.length > 0) payload.safety_settings = safetySettingsArr;

            // generation_config передаем ТОЛЬКО для обычных моделей (для агентов запрещен)
            if (!isAgentModel) {
                const genConfig = {};
                if (openaiReq.temperature !== undefined) genConfig.temperature = openaiReq.temperature;
                if (openaiReq.max_tokens !== undefined) genConfig.max_output_tokens = openaiReq.max_tokens;
                if (openaiReq.top_p !== undefined) genConfig.top_p = openaiReq.top_p;
                genConfig.thinking_summaries = 'auto';

                if (Object.keys(genConfig).length > 0) {
                    payload.generation_config = genConfig;
                }
            }
        } else {
            const action = isStreaming ? "streamGenerateContent?alt=sse" : "generateContent";
            endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:${action}`;
            payload.contents = geminiContents;
            if (systemText.trim()) payload.systemInstruction = { parts: [{ text: systemText.trim() }] };

            if (safetySettingsArr.length > 0) payload.safetySettings = safetySettingsArr;

            payload.generationConfig = {};
            if (openaiReq.temperature !== undefined) payload.generationConfig.temperature = openaiReq.temperature;
            if (openaiReq.max_tokens !== undefined) payload.generationConfig.maxOutputTokens = openaiReq.max_tokens;
            if (openaiReq.top_p !== undefined) payload.generationConfig.topP = openaiReq.top_p;
        }

        if (isDebug) console.log(`[🚀 Gemini API] ${isAgentModel ? 'Agent' : 'Model'}: ${modelName} | Mode: ${useInteractions ? 'Interactions' : 'Standard'} | Flatten: ${isSingleTurn}`);

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Google API Error ${response.status}: ${await response.text()}`);

        if (isStreaming) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const responseId = `chatcmpl-${Date.now()}`;
            const decoder = new TextDecoder("utf8");
            let buffer = "";
            let previousTextLength = 0;

            for await (const chunk of response.body) {
                buffer += decoder.decode(chunk, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();

                for (let line of lines) {
                    line = line.trim();
                    if (!line || !line.startsWith('data:')) continue;

                    const jsonStr = line.substring(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const data = JSON.parse(jsonStr);
                        let deltaText = "";

                        if (useInteractions) {
                            // Interactions API парсер (steps / output_text / delta)
                            if (data.delta?.type === 'text' && data.delta.text) {
                                deltaText = data.delta.text;
                            } else if (data.delta?.type === 'thought_summary' && data.delta.text) {
                                deltaText = data.delta.text;
                            } else if (data.output_text) {
                                let acc = data.output_text;
                                if (acc.length > previousTextLength) {
                                    deltaText = acc.substring(previousTextLength);
                                    previousTextLength = acc.length;
                                }
                            }
                        } else {
                            // Standard API парсер
                            deltaText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                        }

                        if (deltaText) {
                            res.write(`data: ${JSON.stringify({
                                id: responseId,
                                object: "chat.completion.chunk",
                                created: Math.floor(Date.now() / 1000),
                                model: rawModel,
                                choices: [{ index: 0, delta: { content: deltaText }, finish_reason: null }]
                            })}\n\n`);
                        }
                    } catch (e) { }
                }
            }
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            const data = await response.json();
            let contentText = "";

            if (useInteractions) {
                const outStep = data.steps?.find(s => s.type === 'model_output');
                contentText = outStep?.content?.map(c => c.text || '').join('') || data.output_text || '';
            } else {
                contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            }

            res.json({
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: rawModel,
                choices: [{ index: 0, message: { role: "assistant", content: contentText }, finish_reason: "stop" }]
            });
        }
    } catch (e) {
        console.error(`[❌ Gemini API] Ошибка:`, e.message);
        if (!res.headersSent) res.status(500).json({ error: { message: e.message } });
    }
}

module.exports = { MODELS, setupRoutes, initProvider, unloadProvider, handleChatCompletion };