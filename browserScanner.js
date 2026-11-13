// browserScanner.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

let cachedBrowsers = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 1000;

function extractExecutableFromCommand(rawCmd) {
    if (!rawCmd || typeof rawCmd !== 'string') return '';
    let cmd = rawCmd.trim();
    cmd = cmd.replace(/%([^%]+)%/g, (_, varName) => process.env[varName] || `%${varName}%`);

    if (cmd.startsWith('"')) {
        const endQuote = cmd.indexOf('"', 1);
        if (endQuote !== -1) return cmd.substring(1, endQuote).trim();
    }

    const exeMatch = cmd.match(/^(.+?\.exe)(?:\s|$)/i);
    if (exeMatch) return exeMatch[1].trim();

    return cmd.split(/\s+/)[0].trim();
}

function hasAnyFile(dir, fileNames) {
    for (const f of fileNames) {
        if (fs.existsSync(path.join(dir, f))) return true;
    }
    return false;
}

function detectBrowserEngine(exePath) {
    if (!exePath || typeof exePath !== 'string') return 'chromium';
    const baseDir = path.dirname(exePath);
    const geckoMarkers = ['omni.ja', 'xul.dll', 'libxul.so', 'XUL'];
    const chromiumMarkers = ['resources.pak', 'chrome_100_percent.pak', 'icudtl.dat', 'chrome.dll', 'msedge.dll', 'vivaldi.dll', 'libcef.so'];

    try {
        if (hasAnyFile(baseDir, geckoMarkers)) return 'gecko';
        if (hasAnyFile(baseDir, chromiumMarkers)) return 'chromium';

        const dirsToCheck = [];
        if (process.platform === 'darwin') {
            dirsToCheck.push(path.resolve(baseDir, '..', 'Resources'));
            dirsToCheck.push(path.resolve(baseDir, '..', 'Frameworks'));
        }
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) dirsToCheck.push(path.join(baseDir, entry.name));
        }

        for (const subDir of dirsToCheck) {
            if (!fs.existsSync(subDir)) continue;
            if (hasAnyFile(subDir, geckoMarkers)) return 'gecko';
            if (hasAnyFile(subDir, chromiumMarkers)) return 'chromium';
        }
    } catch (e) { }

    const lower = path.basename(exePath).toLowerCase();
    if (/firefox|gecko|librewolf|waterfox|floorp|palemoon|zen/.test(lower)) {
        return 'gecko';
    }
    return 'chromium';
}

function makeBrowserId(exePath) {
    const base = path.basename(exePath, path.extname(exePath)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const hash = crypto.createHash('md5').update(exePath.toLowerCase()).digest('hex').slice(0, 6);
    return `sys-${base}-${hash}`;
}

function cleanDisplayName(rawName, exePath) {
    let name = (rawName || '').trim();
    if (!name || name.startsWith('@') || /^[a-z0-9._-]+-\w{8,}$/i.test(name)) {
        name = path.basename(exePath, path.extname(exePath));
        name = name.charAt(0).toUpperCase() + name.slice(1);
    }
    return name;
}

function getKnownWindowsBrowserCandidates() {
    const roots = [
        process.env.PROGRAMFILES,
        process.env['PROGRAMFILES(X86)'],
        process.env.LOCALAPPDATA,
        process.env.APPDATA
    ].filter(Boolean);

    const knownDefs = [
        { name: 'Google Chrome', rel: 'Google\\Chrome\\Application\\chrome.exe' },
        { name: 'Google Chrome Beta', rel: 'Google\\Chrome Beta\\Application\\chrome.exe' },
        { name: 'Microsoft Edge', rel: 'Microsoft\\Edge\\Application\\msedge.exe' },
        { name: 'Brave Browser', rel: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
        { name: 'Yandex Browser', rel: 'Yandex\\YandexBrowser\\Application\\browser.exe' },
        { name: 'Vivaldi', rel: 'Vivaldi\\Application\\vivaldi.exe' },
        { name: 'Opera', rel: 'Programs\\Opera\\opera.exe' },
        { name: 'Opera', rel: 'Opera\\opera.exe' },
        { name: 'Opera GX', rel: 'Programs\\Opera GX\\opera.exe' },
        { name: 'Opera GX', rel: 'Opera GX\\opera.exe' },
        { name: 'CentBrowser', rel: 'CentBrowser\\Application\\chrome.exe' },
        { name: 'Thorium', rel: 'Thorium\\Application\\thorium.exe' },
        { name: 'Mozilla Firefox', rel: 'Mozilla Firefox\\firefox.exe' },
        { name: 'LibreWolf', rel: 'LibreWolf\\librewolf.exe' },
        { name: 'Waterfox', rel: 'Waterfox\\waterfox.exe' },
        { name: 'Zen Browser', rel: 'Zen Browser\\zen.exe' },
        { name: 'Floorp', rel: 'Floorp\\floorp.exe' }
    ];

    const list = [];
    for (const root of roots) {
        for (const def of knownDefs) {
            const fullPath = path.join(root, def.rel);
            if (fs.existsSync(fullPath)) {
                list.push({ name: def.name, rawCmd: `"${fullPath}"` });
            }
        }
    }
    return list;
}

function queryWindowsRegistryBrowsers() {
    try {
        const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$roots = @(
    'HKLM:\\SOFTWARE\\Clients\\StartMenuInternet',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet',
    'HKCU:\\SOFTWARE\\Clients\\StartMenuInternet'
)
$res = @()
foreach ($r in $roots) {
    if (Test-Path -LiteralPath $r) {
        Get-ChildItem -LiteralPath $r -ErrorAction SilentlyContinue | ForEach-Object {
            $cmdKey = Join-Path $_.PSPath 'shell\\open\\command'
            if (Test-Path -LiteralPath $cmdKey) {
                $cmdItem = Get-Item -LiteralPath $cmdKey -ErrorAction SilentlyContinue
                $cmdVal = if ($cmdItem) { $cmdItem.GetValue('') } else { $null }
                if ($cmdVal) {
                    $nameVal = $_.GetValue('')
                    $capKey = Join-Path $_.PSPath 'Capabilities'
                    if (Test-Path -LiteralPath $capKey) {
                        $capItem = Get-Item -LiteralPath $capKey -ErrorAction SilentlyContinue
                        $appName = if ($capItem) { $capItem.GetValue('ApplicationName') } else { $null }
                        if ($appName) { $nameVal = $appName }
                    }
                    if (-not $nameVal) { $nameVal = $_.PSChildName }
                    $res += [PSCustomObject]@{ name = [string]$nameVal; rawCmd = [string]$cmdVal }
                }
            }
        }
    }
}
$res | ConvertTo-Json -Compress
`;
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        const out = execFileSync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
        ], {
            encoding: 'utf8',
            timeout: 3500,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();

        if (!out) return [];
        const parsed = JSON.parse(out);
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        return [];
    }
}

function scanWindowsBrowsers() {
    const candidates = [
        ...getKnownWindowsBrowserCandidates(),
        ...queryWindowsRegistryBrowsers()
    ];

    const seenPaths = new Set();
    const result = [];
    const ignoredExes = new Set(['iexplore.exe', 'rundll32.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'mshta.exe']);

    for (const entry of candidates) {
        if (!entry || !entry.rawCmd) continue;
        const exePath = extractExecutableFromCommand(entry.rawCmd);
        if (!exePath || !fs.existsSync(exePath)) continue;
        try {
            if (!fs.statSync(exePath).isFile()) continue;
        } catch (e) { continue; }

        const baseLower = path.basename(exePath).toLowerCase();
        if (ignoredExes.has(baseLower)) continue;

        const normPath = exePath.toLowerCase();
        if (seenPaths.has(normPath)) continue;
        seenPaths.add(normPath);

        const engine = detectBrowserEngine(exePath);
        result.push({
            id: makeBrowserId(exePath),
            name: cleanDisplayName(entry.name, exePath),
            path: exePath,
            engine,
            noteKey: engine === 'gecko' ? 'gecko' : 'chromium',
            isBundled: false
        });
    }

    return result;
}

function scanMacOSBrowsers() {
    const appDirs = ['/Applications', path.join(os.homedir(), 'Applications')];
    const seenPaths = new Set();
    const result = [];

    for (const dir of appDirs) {
        if (!fs.existsSync(dir)) continue;
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }

        for (const entry of entries) {
            if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
            const plistPath = path.join(dir, entry.name, 'Contents', 'Info.plist');
            if (!fs.existsSync(plistPath)) continue;

            try {
                const jsonOut = execFileSync('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8', timeout: 2000 });
                const plist = JSON.parse(jsonOut);
                const urlTypes = Array.isArray(plist.CFBundleURLTypes) ? plist.CFBundleURLTypes : [];
                const handlesWeb = urlTypes.some(t => Array.isArray(t.CFBundleURLSchemes) && t.CFBundleURLSchemes.some(s => /^https?$/i.test(s)));
                if (!handlesWeb || !plist.CFBundleExecutable) continue;

                const binPath = path.join(dir, entry.name, 'Contents', 'MacOS', plist.CFBundleExecutable);
                if (!fs.existsSync(binPath)) continue;
                if (seenPaths.has(binPath)) continue;
                seenPaths.add(binPath);

                const engine = detectBrowserEngine(binPath);
                result.push({
                    id: makeBrowserId(binPath),
                    name: plist.CFBundleDisplayName || plist.CFBundleName || entry.name.replace(/\.app$/, ''),
                    path: binPath,
                    engine,
                    noteKey: engine === 'gecko' ? 'gecko' : 'chromium',
                    isBundled: false
                });
            } catch (e) { }
        }
    }
    return result;
}

function scanLinuxBrowsers() {
    const desktopDirs = [
        '/usr/share/applications',
        '/usr/local/share/applications',
        path.join(os.homedir(), '.local', 'share', 'applications'),
        '/var/lib/flatpak/exports/share/applications',
        '/var/lib/snapd/desktop/applications'
    ];
    const seenPaths = new Set();
    const result = [];

    for (const dir of desktopDirs) {
        if (!fs.existsSync(dir)) continue;
        let files = [];
        try { files = fs.readdirSync(dir); } catch (e) { continue; }

        for (const file of files) {
            if (!file.endsWith('.desktop')) continue;
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                const categoriesMatch = content.match(/^Categories=(.+)$/m);
                if (!categoriesMatch || !categoriesMatch[1].includes('WebBrowser')) continue;
                if (/^NoDisplay=true$/m.test(content)) continue;

                const nameMatch = content.match(/^Name=(.+)$/m);
                const execMatch = content.match(/^Exec=(.+)$/m);
                if (!execMatch) continue;

                let binToken = execMatch[1].trim().replace(/^"(.*?)"/, '$1').split(/\s+/)[0];
                if (!binToken || binToken === 'env') continue;

                let resolvedBin = binToken;
                if (!path.isAbsolute(resolvedBin)) {
                    try {
                        resolvedBin = execFileSync('which', [binToken], { encoding: 'utf8', timeout: 1000 }).trim();
                    } catch (e) { continue; }
                }
                if (!resolvedBin || !fs.existsSync(resolvedBin)) continue;
                if (seenPaths.has(resolvedBin)) continue;
                seenPaths.add(resolvedBin);

                const engine = detectBrowserEngine(resolvedBin);
                result.push({
                    id: makeBrowserId(resolvedBin),
                    name: (nameMatch ? nameMatch[1].trim() : path.basename(resolvedBin)),
                    path: resolvedBin,
                    engine,
                    noteKey: engine === 'gecko' ? 'gecko' : 'chromium',
                    isBundled: false
                });
            } catch (e) { }
        }
    }
    return result;
}

async function getBundledChromium(puppeteerLib) {
    const candidates = [puppeteerLib];
    try { candidates.push(require('puppeteer')); } catch (e) { }
    try { candidates.push(require('rebrowser-puppeteer')); } catch (e) { }

    for (const lib of candidates) {
        try {
            if (lib && typeof lib.executablePath === 'function') {
                const bundledPath = await Promise.resolve(lib.executablePath());
                if (typeof bundledPath === 'string' && bundledPath && fs.existsSync(bundledPath)) {
                    return {
                        id: 'bundled-chromium',
                        name: 'Встроенный Chromium (Puppeteer)',
                        path: bundledPath,
                        engine: 'chromium',
                        noteKey: 'bundled',
                        isBundled: true
                    };
                }
            }
        } catch (e) { }
    }
    return null;
}

async function scanBrowsers(forceRefresh = false, puppeteerLib = null) {
    const now = Date.now();
    if (!forceRefresh && cachedBrowsers && (now - cachedAt < CACHE_TTL_MS)) {
        return cachedBrowsers;
    }

    let systemBrowsers = [];
    if (process.platform === 'win32') systemBrowsers = scanWindowsBrowsers();
    else if (process.platform === 'darwin') systemBrowsers = scanMacOSBrowsers();
    else systemBrowsers = scanLinuxBrowsers();

    const bundled = await getBundledChromium(puppeteerLib);
    if (bundled) systemBrowsers.push(bundled);

    cachedBrowsers = systemBrowsers;
    cachedAt = now;
    return systemBrowsers;
}

async function resolveBrowserSelection(config = {}, puppeteerLib = null) {
    const browsers = await scanBrowsers(false, puppeteerLib);
    const requestedId = config.browserId || 'auto';
    const customPath = (config.executablePath || '').trim();

    if (requestedId === 'custom') {
        if (customPath && fs.existsSync(customPath)) {
            const engine = detectBrowserEngine(customPath);
            return {
                id: 'custom',
                name: path.basename(customPath),
                path: customPath,
                engine,
                noteKey: engine === 'gecko' ? 'gecko' : 'custom',
                isBundled: false
            };
        }
    }

    if (requestedId === 'bundled-chromium') {
        const bundled = browsers.find(b => b.isBundled);
        if (bundled) return bundled;
    }

    if (requestedId !== 'auto' && requestedId !== 'custom') {
        const exact = browsers.find(b => b.id === requestedId);
        if (exact) return exact;
    }

    const firstSystemChromium = browsers.find(b => !b.isBundled && b.engine === 'chromium');
    if (firstSystemChromium) return firstSystemChromium;

    const bundledFallback = browsers.find(b => b.isBundled);
    if (bundledFallback) return bundledFallback;

    const anySystem = browsers[0];
    if (anySystem) return anySystem;

    return {
        id: 'bundled-chromium',
        name: 'Встроенный Chromium',
        path: undefined,
        engine: 'chromium',
        noteKey: 'bundled',
        isBundled: true
    };
}

function buildFirefoxProxyPrefs(proxyServer) {
    if (!proxyServer) return {};
    try {
        const normalized = proxyServer.includes('://') ? proxyServer : `http://${proxyServer}`;
        const u = new URL(normalized);
        const port = parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80);
        if (u.protocol.startsWith('socks')) {
            return {
                'network.proxy.type': 1,
                'network.proxy.socks': u.hostname,
                'network.proxy.socks_port': port,
                'network.proxy.socks_version': u.protocol === 'socks4:' ? 4 : 5,
                'network.proxy.socks_remote_dns': true
            };
        }
        return {
            'network.proxy.type': 1,
            'network.proxy.http': u.hostname,
            'network.proxy.http_port': port,
            'network.proxy.ssl': u.hostname,
            'network.proxy.ssl_port': port
        };
    } catch (e) {
        return {};
    }
}

async function buildLaunchOptions({ config = {}, userDataDir, headless = true, width = 1280, height = 800, puppeteerLib = null }) {
    const browserInfo = await resolveBrowserSelection(config, puppeteerLib);
    const proxyServer = (config.proxyServer || '').trim();

    if (browserInfo.engine === 'gecko') {
        const launchOptions = {
            browser: 'firefox',
            headless: Boolean(headless),
            userDataDir,
            timeout: 25000,
            args: [],
            defaultViewport: null
        };
        if (browserInfo.path) launchOptions.executablePath = browserInfo.path;
        if (proxyServer) launchOptions.extraPrefsFirefox = buildFirefoxProxyPrefs(proxyServer);
        return { browserInfo, launchOptions };
    }

    const disableAutomationFlags = config.disableAutomationFlags !== false;
    const disableGpu = config.disableGpu !== false;

    // Старый проверенный набор аргументов запуска Chromium
    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--window-size=${width},${height}`,
        '--disable-dev-shm-usage',
        '--mute-audio',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update'
    ];

    if (disableGpu) {
        launchArgs.push(
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--disable-gl-drawing-for-tests'
        );
    }

    if (proxyServer) {
        launchArgs.push(`--proxy-server=${proxyServer}`);
    }

    const launchOptions = {
        headless: headless ? 'new' : false,
        userDataDir,
        args: launchArgs,
        defaultViewport: null
    };

    if (disableAutomationFlags) {
        launchOptions.ignoreDefaultArgs = ['--enable-automation'];
    }
    if (browserInfo.path) {
        launchOptions.executablePath = browserInfo.path;
    }

    return { browserInfo, launchOptions };
}

function openNativeFileDialog() {
    if (process.platform === 'win32') {
        const ps = `
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'Manual'
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.ShowInTaskbar = $false
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = 'Select Browser Executable (.exe)'
$dlg.Filter = 'Executable (*.exe)|*.exe|All files (*.*)|*.*'
$dlg.CheckFileExists = $true
$res = $dlg.ShowDialog($owner)
$owner.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Write-Output $dlg.FileName
}
`;
        const encoded = Buffer.from(ps, 'utf16le').toString('base64');
        return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 120000
        }).trim() || null;
    }

    if (process.platform === 'darwin') {
        try {
            return execFileSync('osascript', ['-e', 'POSIX path of (choose file with prompt "Select Browser Application")'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 120000
            }).trim() || null;
        } catch (e) { return null; }
    }

    for (const tool of [
        ['zenity', ['--file-selection', '--title=Select Browser Executable']],
        ['kdialog', ['--getopenfilename', os.homedir()]]
    ]) {
        try {
            return execFileSync(tool[0], tool[1], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                timeout: 120000
            }).trim() || null;
        } catch (e) { }
    }
    return null;
}

function setupRoutes(app) {
    app.get('/api/system/browsers', async (req, res) => {
        try {
            const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
            const browsers = await scanBrowsers(forceRefresh);
            const autoTarget = await resolveBrowserSelection({ browserId: 'auto' });
            res.json({
                success: true,
                browsers,
                autoTarget
            });
        } catch (err) {
            res.status(500).json({ success: false, browsers: [], error: err.message });
        }
    });

    app.post('/api/system/pick-browser', (req, res) => {
        try {
            const pickedPath = openNativeFileDialog();
            if (!pickedPath) {
                return res.json({ success: false, cancelled: true });
            }
            res.json({
                success: true,
                path: pickedPath,
                engine: detectBrowserEngine(pickedPath)
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });
}

async function ensureWindowVisible(browserInstance, pageInstance, width = 1280, height = 800) {
    if (!browserInstance || !pageInstance) return;
    try {
        const cdp = await pageInstance.createCDPSession();
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        await cdp.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal', left: 100, top: 80, width, height }
        }).catch(() => { });
        await cdp.detach().catch(() => { });
    } catch (e) { }
    try {
        await pageInstance.bringToFront();
    } catch (e) { }
}

module.exports = {
    scanBrowsers,
    detectBrowserEngine,
    resolveBrowserSelection,
    buildLaunchOptions,
    ensureWindowVisible,
    setupRoutes
};