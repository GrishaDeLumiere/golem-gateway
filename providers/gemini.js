const fs = require('fs');
const path = require('path');
const { getSettings } = require('../settings');
const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GEMINI_CLIENT_ID || "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const CLIENT_SECRET = process.env.GEMINI_CLIENT_SECRET || "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";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CREDENTIAL_FILE = path.join(__dirname, '..', 'gemini_credentials.json');

const AUTH_SCOPES = [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
];
const SAVED_SCOPES = AUTH_SCOPES;

// ПОЛНЫЙ СПИСОК МОДЕЛЕЙ
const MODEL_NAMES = [
    "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-image-preview",
    "gemini-3-pro-preview", "gemini-3-pro-image-preview", "gemini-3-flash-preview",
    "gemini-3-pro-preview-search", "gemini-3-flash-preview-search",
    "gemini-2.5-pro", "gemini-2.5-pro-preview-06-05", "gemini-2.5-pro-preview-05-06", "gemini-2.5-pro-preview-03-25",
    "gemini-2.5-flash", "gemini-2.5-flash-preview-09-2025", "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-flash-lite", "gemini-2.5-flash-lite-preview-09-2025", "gemini-2.5-flash-lite-preview-06-17",
    "gemini-2.5-flash-image", "gemini-2.5-flash-image-preview",
    "gemini-2.5-flash-maxthinking", "gemini-2.5-flash-nothinking", "gemini-2.5-flash-preview-04-17",
    "gemini-2.5-flash-preview-04-17-maxthinking", "gemini-2.5-flash-preview-04-17-nothinking", "gemini-2.5-flash-preview-04-17-search",
    "gemini-2.5-flash-preview-05-20-maxthinking", "gemini-2.5-flash-preview-05-20-nothinking", "gemini-2.5-flash-preview-05-20-search",
    "gemini-2.5-flash-search", "gemini-2.5-pro-maxthinking", "gemini-2.5-pro-nothinking",
    "gemini-2.5-pro-preview-03-25-maxthinking", "gemini-2.5-pro-preview-03-25-nothinking", "gemini-2.5-pro-preview-03-25-search",
    "gemini-2.5-pro-preview-05-06-maxthinking", "gemini-2.5-pro-preview-05-06-nothinking", "gemini-2.5-pro-preview-05-06-search",
    "gemini-2.5-pro-preview-06-05-maxthinking", "gemini-2.5-pro-preview-06-05-nothinking", "gemini-2.5-pro-preview-06-05-search",
    "gemini-2.5-pro-search",
    "gemini-2.0-pro-exp-02-05", "gemini-2.0-pro-exp", "gemini-exp-1206",
    "gemini-2.0-flash-001", "gemini-2.0-flash-exp-image-generation", "gemini-2.0-flash-preview-image-generation",
    "gemini-2.0-flash-exp", "gemini-2.0-flash",
    "gemini-2.0-flash-thinking-exp-01-21", "gemini-2.0-flash-thinking-exp-1219", "gemini-2.0-flash-thinking-exp",
    "gemini-2.0-flash-lite-001", "gemini-2.0-flash-lite-preview-02-05", "gemini-2.0-flash-lite-preview", "gemini-2.0-flash-lite",
    "gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.5-flash-8b",
    "learnlm-2.0-flash-experimental", "gemini-robotics-er-1.5-preview"
];

const NATIVE_MODELS = MODEL_NAMES.map(id => ({ name: `models/${id}`, displayName: id }));
const OPENAI_MODELS = MODEL_NAMES.map(id => ({ id: id, object: "model", created: 1677610602, owned_by: "google" }));
const MODELS = OPENAI_MODELS;

let oauth2Client;
let onboardingComplete = {};

// --- СИСТЕМА УПРАВЛЕНИЯ БАЗОЙ АККАУНТОВ ---
function readDb() {
    if (fs.existsSync(CREDENTIAL_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(CREDENTIAL_FILE, 'utf8'));
            if (!data.accounts && data.token) {
                return { active: 0, accounts: [data] };
            }
            if (data.accounts) return data;
        } catch (e) { console.error("[⚠️] Ошибка чтения БД Gemini"); }
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

function saveNewAccount(tokens, projectId = null) {
    const db = readDb();
    let expiryIso = null;
    if (tokens.expiry_date) expiryIso = new Date(tokens.expiry_date).toISOString();

    const newAcc = {
        name: projectId ? `Проект: ${projectId}` : "Новый профиль",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scopes: AUTH_SCOPES,
        token_uri: "https://oauth2.googleapis.com/token",
        expiry: expiryIso,
        project_id: projectId || ""
    };

    db.accounts.push(newAcc);
    db.active = db.accounts.length - 1;
    writeDb(db);
    return newAcc;
}

async function getValidToken() {
    const account = getActiveAccount();
    if (!account) throw new Error("Нет авторизованных аккаунтов Gemini");

    if (oauth2Client) {
        oauth2Client.setCredentials({
            access_token: account.token,
            refresh_token: account.refresh_token,
            scope: AUTH_SCOPES.join(' '),
            expiry_date: account.expiry ? new Date(account.expiry).getTime() : null,
            token_type: "Bearer"
        });
        try {
            const { token } = await oauth2Client.getAccessToken();
            return { token, projectId: account.project_id };
        } catch (e) { }
    }
    return { token: account.token, projectId: account.project_id };
}

async function initProvider(port) {
    oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, `http://127.0.0.1:${port}/api/gemini/callback`);
    const db = readDb();
    if (db.accounts.length > 0) console.log(`[🚀 Gemini] Загружено аккаунтов: ${db.accounts.length}`);
}

function unloadProvider() {
    oauth2Client = null;
}

function getClientMetadata(projectId = null) {
    return {
        ideType: "IDE_UNSPECIFIED",
        platform: process.platform === "win32" ? "WINDOWS_AMD64" : (process.platform === "darwin" ? "DARWIN_AMD64" : "LINUX_AMD64"),
        pluginType: "GEMINI",
        duetProject: projectId
    };
}

async function ensureProjectAndOnboard(token, projectIdFromCreds) {
    let projectId = projectIdFromCreds;
    const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "GeminiCLI/1.0.0" };

    if (!projectId) {
        try {
            let loadResp = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, { method: 'POST', headers, body: JSON.stringify({ metadata: getClientMetadata() }) });
            let loadData = await loadResp.json();
            projectId = loadData.cloudaicompanionProject || "";
        } catch (e) { }
    }

    if (projectId && !onboardingComplete[projectId]) {
        try {
            let loadResp = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, { method: 'POST', headers, body: JSON.stringify({ metadata: getClientMetadata(projectId) }) });
            let loadData = await loadResp.json();
            if (loadData.currentTier) { onboardingComplete[projectId] = true; return projectId; }

            const tier = loadData.allowedTiers?.find(t => t.isDefault) || { id: "legacy-tier" };
            await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, { method: 'POST', headers, body: JSON.stringify({ tierId: tier.id, cloudaicompanionProject: projectId, metadata: getClientMetadata(projectId) }) });
            onboardingComplete[projectId] = true;
        } catch (e) { }
    }
    return projectId;
}

// --- НАДЕЖНЫЙ КЛИЕНТ GOOGLE API ---
async function fetchGoogleAPI(apiModelName, requestPayload, isStreaming) {
    const { token, projectId: cachedProjectId } = await getValidToken();
    const projectId = await ensureProjectAndOnboard(token, cachedProjectId);

    if (!projectId) {
        throw new Error(JSON.stringify({ status: 403, body: { error: { message: "Project ID не указан. Откройте Дашборд и впишите project_id в настройки аккаунта." } } }));
    }

    const action = isStreaming ? "streamGenerateContent?alt=sse" : "generateContent";
    const url = `${CODE_ASSIST_ENDPOINT}/v1internal:${action}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "GeminiCLI/1.0.0" },
        body: JSON.stringify({ model: apiModelName, project: projectId, request: requestPayload })
    });

    if (!response.ok) {
        let errText = await response.text();
        let errObj = null;
        try { errObj = JSON.parse(errText); } catch (e) { }

        const isDebug = getSettings().debugMode;
        const shortMsg = errObj?.error?.message || "Неизвестная ошибка провайдера";
        const statusName = errObj?.error?.status || "ERROR";

        if (response.status === 429) {
            console.error(`[⚠️ Gemini] Ошибка 429: Превышен лимит запросов (Capacity Exhausted)`);
        } else {
            console.error(`[❌ Gemini] Ошибка ${response.status} (${statusName}): ${shortMsg}`);
        }

        if (isDebug) {
            console.error(`[🐛 DEBUG Gemini] Полная ошибка: ${errObj ? JSON.stringify(errObj, null, 2) : errText}`);
        }

        throw new Error(JSON.stringify({ status: response.status, body: errObj || errText }));
    }
    return response;
}

function handleError(e, res) {
    try {
        const errObj = JSON.parse(e.message);
        if (errObj.status) {
            let parsedBody = errObj.body;
            try { if (typeof parsedBody === 'string') parsedBody = JSON.parse(errObj.body); } catch (err) { }
            return res.status(errObj.status).json(parsedBody);
        }
    } catch (err) { }

    if (!e.message.includes('status=')) {
        console.error(`[❌ Gemini] Внутренняя ошибка провайдера.`);
        if (getSettings().debugMode) {
            console.error(`[🐛 DEBUG] ${e.message}`);
        }
    }
    if (!res.headersSent) {
        res.status(500).json({ error: { message: e.message } });
    }
}

// --- РОУТЫ И ЛОГИРОВАНИЕ ---
function setupRoutes(app, PORT) {

    // API для Дашборда
    app.get('/api/gemini/accounts', (req, res) => res.json(readDb()));

    app.post('/api/gemini/accounts', (req, res) => {
        const db = req.body;
        writeDb(db);
        res.json({ success: true, db: readDb() });
    });

    app.get('/api/gemini/auth', (req, res) => {
        if (!oauth2Client) initProvider(PORT);
        res.redirect(oauth2Client.generateAuthUrl({ access_type: 'offline', scope: AUTH_SCOPES, prompt: 'consent' }));
    });

    app.get('/api/gemini/callback', async (req, res) => {
        const { code } = req.query;
        if (!code) return res.send('Ошибка авторизации. Нет кода.');
        try {
            const { tokens } = await oauth2Client.getToken(code);
            let projectId = await ensureProjectAndOnboard(tokens.access_token).catch(() => "");
            saveNewAccount(tokens, projectId);

            let html = fs.readFileSync(path.join(__dirname, '../views/success.html'), 'utf8');
            html = html.replace('{{TITLE}}', 'Профиль Google добавлен!')
                .replace('{{MESSAGE}}', 'Доступ к API Gemini успешно разрешен.')
                .replace(/{{COLOR}}/g, '#10b981');
            res.send(html);

        } catch (e) {
            res.status(500).send(`Ошибка получения токена: ${e.message}`);
        }
    });

    app.get('/v1beta/models', (req, res) => res.json({ models: NATIVE_MODELS }));

    app.post(['/v1beta/models/*', '/models/*'], async (req, res) => {
        if (!fs.existsSync(CREDENTIAL_FILE)) return res.status(401).json({ error: { message: "Не авторизован." } });

        try {
            let fullPath = decodeURIComponent(req.params[0]);
            let rawModelName = fullPath.split(":")[0].split("/")[0];
            const isStreaming = req.originalUrl.includes("stream") || req.query.alt === "sse";

            let nativeReq = req.body;
            nativeReq.safetySettings = [
                { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
                { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
                { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
                { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" },
                { "category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "BLOCK_NONE" }
            ];

            let apiModelName = rawModelName.replace("-search", "").replace("-nothinking", "").replace("-maxthinking", "");

            if (!nativeReq.generationConfig) nativeReq.generationConfig = {};
            if (!nativeReq.generationConfig.thinkingConfig) nativeReq.generationConfig.thinkingConfig = {};

            const isPro = rawModelName.includes("-pro") || rawModelName.includes("pro");
            const isFlash = rawModelName.includes("-flash") || rawModelName.includes("flash");

            let thinkingBudget = isFlash ? 24576 : 32768;

            if (rawModelName.includes("-nothinking")) {
                thinkingBudget = 128;
            }

            if (!apiModelName.includes("image")) {
                nativeReq.generationConfig.thinkingConfig.includeThoughts = !rawModelName.includes("-nothinking") || isPro;
                nativeReq.generationConfig.thinkingConfig.thinkingBudget = thinkingBudget;
            }

            const isDebug = getSettings().debugMode;
            
            console.log(`[🚀 Gemini] Старт генерации (Native) -> Модель: ${apiModelName}`);
            if (isDebug) {
                console.log(`[🐛 DEBUG Gemini] Stream: ${isStreaming} | Payload Native`);
            }

            const googleRes = await fetchGoogleAPI(apiModelName, nativeReq, isStreaming);

            if (isStreaming) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                let buffer = "";
                const decoder = new TextDecoder("utf8");

                for await (const chunk of googleRes.body) {
                    buffer += decoder.decode(chunk, { stream: true });
                    let lines = buffer.split('\n');
                    buffer = lines.pop();

                    for (let line of lines) {
                        line = line.trim();
                        if (!line) continue;
                        if (line.startsWith('data:')) {
                            const jsonStr = line.substring(5).trim();
                            if (jsonStr === '[DONE]') {
                                res.write('data: [DONE]\n\n');
                                continue;
                            }
                            try {
                                const geminiChunk = JSON.parse(jsonStr);
                                const actualChunk = geminiChunk.response || geminiChunk;
                                res.write(`data: ${JSON.stringify(actualChunk)}\n\n`);
                            } catch (err) {
                                res.write(`data: ${jsonStr}\n\n`);
                            }
                        } else {
                            res.write(`${line}\n\n`);
                        }
                    }
                }
                res.write('data: [DONE]\n\n');
                res.end();
                
                console.log(`[✅ Gemini] Успешно завершено (${apiModelName})`);

            } else {
                const data = await googleRes.json();
                res.json(data.response || data);
                
                console.log(`[✅ Gemini] Успешно завершено (${apiModelName})`);
            }
        } catch (e) {
            handleError(e, res);
        }
    });
}

// --- ТРАНСФОРМЕРЫ (OpenAI -> Gemini) ---
function openaiRequestToGemini(openaiReq) {
    const contents = [];
    let systemInstructionText = "";

    for (const msg of openaiReq.messages) {
        if (msg.role === "system") {
            systemInstructionText += (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)) + "\n";
            continue;
        }

        let role = msg.role === "assistant" ? "model" : "user";
        let parts = [];

        if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === "text") parts.push({ text: part.text });
                if (part.type === "image_url") {
                    const url = part.image_url.url;
                    if (url.startsWith("data:")) {
                        const [header, base64Data] = url.split(",");
                        const mimeType = header.split(":")[1].split(";")[0];
                        parts.push({ inlineData: { mimeType, data: base64Data } });
                    }
                }
            }
        } else {
            const text = msg.content || "";
            const regex = /!\[.*?\]\((data:image\/[^;]+;base64,([^)]+))\)/g;
            let lastIdx = 0;
            let match;

            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIdx) parts.push({ text: text.substring(lastIdx, match.index) });
                const [header, base64Data] = match[1].split(",");
                const mimeType = header.split(":")[1].split(";")[0];
                parts.push({ inlineData: { mimeType, data: base64Data } });
                lastIdx = regex.lastIndex;
            }
            if (lastIdx < text.length) parts.push({ text: text.substring(lastIdx) });
        }
        contents.push({ role, parts: parts.length ? parts : [{ text: "" }] });
    }

    const generationConfig = {};
    if (openaiReq.temperature !== undefined) generationConfig.temperature = openaiReq.temperature;
    if (openaiReq.top_p !== undefined) generationConfig.topP = openaiReq.top_p;
    if (openaiReq.max_tokens !== undefined) generationConfig.maxOutputTokens = openaiReq.max_tokens;
    if (openaiReq.stop) generationConfig.stopSequences = Array.isArray(openaiReq.stop) ? openaiReq.stop : [openaiReq.stop];
    if (openaiReq.response_format?.type === "json_object") generationConfig.responseMimeType = "application/json";

    let modelName = openaiReq.model.replace("models/", "");
    const tools = [];
    if (modelName.includes("-search")) tools.push({ googleSearch: {} });

    const isPro = modelName.includes("-pro") || modelName.includes("pro");
    const isFlash = modelName.includes("-flash") || modelName.includes("flash");
    const isNothinking = modelName.includes("-nothinking");

    let thinkingBudget = isFlash ? 24576 : 32768;
    let includeThoughts = true;

    if (isNothinking) {
        thinkingBudget = 128;
        if (!isPro) includeThoughts = false;
    } else if (openaiReq.reasoning_effort) {
        switch (openaiReq.reasoning_effort) {
            case "minimal": thinkingBudget = 128; break;
            case "low": thinkingBudget = 1024; break;
            case "medium": thinkingBudget = 4096; break;
            case "high": break;
        }
    }

    if (!modelName.includes("image")) {
        generationConfig.thinkingConfig = {
            includeThoughts: includeThoughts,
            thinkingBudget: thinkingBudget
        };
    }

    let apiModelName = modelName.replace("-search", "").replace("-nothinking", "").replace("-maxthinking", "");

    const payload = {
        model: apiModelName,
        contents,
        generationConfig,
        safetySettings: [
            { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" },
            { "category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "BLOCK_NONE" }
        ]
    };

    if (systemInstructionText) payload.systemInstruction = { parts: [{ text: systemInstructionText.trim() }] };
    if (tools.length > 0) payload.tools = tools;

    return { apiModelName, payload };
}

async function handleChatCompletion(req, res) {
    if (!fs.existsSync(CREDENTIAL_FILE)) return res.status(401).json({ error: { message: "Gemini не авторизован." } });

    try {
        const { apiModelName, payload } = openaiRequestToGemini(req.body);
        const isStreaming = req.body.stream;

        const isDebug = getSettings().debugMode;
        
        console.log(`[🚀 Gemini] Старт генерации -> Модель: ${apiModelName}`);
        if (isDebug) {
            console.log(`[🐛 DEBUG Gemini] Stream: ${isStreaming} | Payload OpenAI`);
        }

        const googleRes = await fetchGoogleAPI(apiModelName, payload, isStreaming);

        if (isStreaming) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const responseId = `chatcmpl-${Date.now()}`;
            let buffer = "";
            const decoder = new TextDecoder("utf8");

            for await (const chunk of googleRes.body) {
                buffer += decoder.decode(chunk, { stream: true });
                let lines = buffer.split('\n');
                buffer = lines.pop();

                for (let line of lines) {
                    line = line.trim();
                    if (!line) continue;
                    if (line.startsWith('data:')) {
                        const jsonStr = line.substring(5).trim();
                        if (jsonStr === '[DONE]') continue;

                        try {
                            const geminiChunk = JSON.parse(jsonStr);
                            const actualChunk = geminiChunk.response || geminiChunk;
                            const openaiChunk = transformChunk(actualChunk, req.body.model, responseId);
                            res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
                        } catch (err) { }
                    }
                }
            }
            res.write('data: [DONE]\n\n');
            res.end();
            
            console.log(`[✅ Gemini] Успешно завершено (${apiModelName})`);

        } else {
            const geminiJson = await googleRes.json();
            const actualResponse = geminiJson.response || geminiJson;

            const openaiResp = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: req.body.model,
                choices: []
            };

            const candidates = actualResponse.candidates || [];
            if (candidates.length > 0) {
                const parts = candidates[0].content?.parts || [];
                let content = "", reasoning = "";

                parts.forEach(p => {
                    if (p.thought) reasoning += p.text;
                    else content += p.text;
                });

                const message = { role: "assistant", content };
                if (reasoning) message.reasoning_content = reasoning;

                openaiResp.choices.push({
                    index: 0,
                    message: message,
                    finish_reason: candidates[0].finishReason === "STOP" ? "stop" : (candidates[0].finishReason || "stop").toLowerCase()
                });
            }
            res.json(openaiResp);

            console.log(`[✅ Gemini] Успешно завершено (${apiModelName})`);
        }
    } catch (e) {
        handleError(e, res);
    }
}

function transformChunk(geminiChunk, model, responseId) {
    const choices = [];
    for (const candidate of (geminiChunk.candidates || [])) {
        let content = "", reasoning_content = "";
        for (const part of (candidate.content?.parts || [])) {
            if (part.text) {
                if (part.thought) reasoning_content += part.text;
                else content += part.text;
            }
        }
        const delta = {};
        if (content) delta.content = content;
        if (reasoning_content) delta.reasoning_content = reasoning_content;

        choices.push({
            index: candidate.index || 0,
            delta,
            finish_reason: candidate.finishReason === "STOP" ? "stop" : (candidate.finishReason ? candidate.finishReason.toLowerCase() : null)
        });
    }
    return { id: responseId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices };
}

module.exports = {
    MODELS,
    setupRoutes,
    initProvider,
    unloadProvider,
    handleChatCompletion
};