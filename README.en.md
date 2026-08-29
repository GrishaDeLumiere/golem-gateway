<div align="right">
 <a href="README.md">🇷🇺 Русский</a> | <strong>🇬🇧 English</strong>
</div>

# <img src="./public/favicon.svg" alt="AI Core Logo" width="30" height="30" /> Golem Gateway (AI Core)

<p align="center">
 <img src="./public/favicon.svg" alt="AI Core Logo" width="100" height="100" />
</p>

<p align="center">
 <a href="https://github.com/GrishaDeLumiere/golem-gateway/releases">
 <img src="https://img.shields.io/badge/version-v0.3.0-615CED?style=for-the-badge&logo=semver&logoColor=white" alt="Version" />
 </a>
 <img src="https://img.shields.io/badge/Node.js-16%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
 <img src="https://img.shields.io/badge/License-AGPL%203.0-red?style=for-the-badge&logo=gnu&logoColor=white" alt="License" />
 <img src="https://img.shields.io/badge/OpenAI_API-Compatible-blue?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI Compatible" />
</p>

<p align="center">
 <strong>A modular stateless router for large language models</strong><br>
 <em>A unified gateway connecting web sessions, official APIs, and third-party AI clients</em>
</p>

---

## 🏆 Recommended UI: Cobalt Tavern

<p align="center">
  <a href="https://github.com/GrishaDeLumiere/cobalt-tavern" target="_blank">
    <img src="https://img.shields.io/badge/Recommended-Cobalt_Tavern-615CED?style=for-the-badge&logo=solid&logoColor=white" alt="Cobalt Tavern" />
  </a>
</p>

To unlock the full potential of **Golem Gateway**, we strongly recommend using **[Cobalt Tavern](https://github.com/GrishaDeLumiere/cobalt-tavern)** — the ultimate, uncompromising, and ultra-fast SolidJS LLM interface designed for full control with zero lag.

- ⚡ **Ultra-Fast SolidJS Engine:** Lightning-fast responsiveness and smooth 60 FPS even on massive chats with 5,000+ messages.
- 🏗 **Prompt Builder & CST Syntax:** Byte-level context control, concrete syntax trees, `IF/ELSE` logical branches, and real-time visual assembly matrix.
- 🧠 **Advanced Lore Engine:** Lorebook scanner powered by boolean logic (`AND ALL`, `AND ANY`, `NOT ALL`, `NOT ANY`) with recursion control.
- 🛡 **3-Layer Regex Filtering:** Surgical cleanup for Incoming responses, Outgoing prompts, and Visual-only browser rendering.
- 💡 **Native `<think>` Streaming:** Real-time reasoning block streaming with live generation speed metrics (tokens/sec).
- 🔌 **Seamless Golem Integration:** Native support for Golem model prefixes (`gemini-api/`, `gemini-cli/`, `deepseek/`, `qwen/`).

---

## 🎯 About the Project

**Golem Gateway** is a high-performance local proxy gateway that provides a unified REST interface compatible with the standard **OpenAI API** (`/v1/chat/completions`, `/v1/models`). It bridges headless browser automation (Puppeteer), **XHR/Fetch** request interception, and official API key pools with granular censorship controls and prefix-based routing.

> 💡 **The concept:** connect your favorite clients ([Cobalt Tavern](https://github.com/GrishaDeLumiere/cobalt-tavern), SillyTavern, Cursor, Cline, Roo Code), and Golem manages routing, token pools, censorship bypass, and active sessions behind the scenes.

---

## 🧩 Supported Providers

| Provider | Icon | Method | Key Features | Status |
|----------|------|--------|--------------|--------|
| **Gemini (Official API)** | <img src="./public/gemini.svg" width="24" /> | `Google REST & Interactions API` | `AIzaSy...` key pool, Safety filter bypass (OFF), Gemini 3.7+ support | ✅ Stable |
| **DeepSeek** | <img src="./public/deepseek.svg" width="24" /> | `Puppeteer + XHR` | Session capture, Visible/Headless toggle, `<think>` reasoning tag control | ✅ Stable |
| **Qwen Studio** | <img src="./public/qwen.svg" width="24" /> | `Puppeteer + Fetch` | Local browser sessions, account pool management | ✅ Stable |
| **Gemini (CLI)** | <img src="./public/gemini.svg" width="24" /> | `OAuth2 + Google Code Assist` | 💀 **Restricted by Google for individuals.** Enterprise only | ⚠️ Restricted |

---

## ✨ Key Features

```mermaid
graph LR
 A[Client: Cobalt Tavern / SillyTavern / IDE] -->|OpenAI API Format| B(Golem Gateway Core)
 B -->|Interactions API + Safety OFF| C[Google Gemini API]
 B -->|Puppeteer + XHR| D[DeepSeek Web]
 B -->|Puppeteer + Fetch| E[Qwen Studio]
 B -.->|OAuth2 Code Assist| F[Gemini CLI]
 C & D & E -->|Stream / JSON Response| B -->|Unified OpenAI Format| A
```

- **🔌 Full OpenAI API Compatibility**
 Native support for `/v1/models` and `/v1/chat/completions` endpoints (including real-time Server-Sent Events `stream: true`).

- **🛡️ Granular Safety Settings Bypass**
 Automatically injects `OFF` threshold for *Harassment, Hate Speech, Sexually Explicit, Dangerous Content*, as well as advanced categories like *Civic Integrity* and *Jailbreak Filter*.

- **📦 Interactive Model Hub**
 Dedicated modal window listing all active models across providers, complete with category filters, model counters, and one-click ID copying.

- **🔀 Collision-Free Prefix Routing**
 Explicitly target any provider using model prefixes:
  - `gemini-api/gemini-2.5-flash` → routes strictly to the Official Google API.
  - `gemini-cli/gemini-2.5-flash` → routes strictly to the CLI / OAuth adapter.
  - `deepseek/deepseek-chat` → routes strictly to the DeepSeek adapter.
  - `qwen/qwen-max` → routes strictly to the Qwen adapter.

- **🧠 Dynamic Memory Management**
 Enable or disable neural network modules on the fly — unused adapters are immediately unloaded from system RAM.

---

## 🛠 Tech Stack

<p align="center">
 <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white&label=Runtime" alt="Node.js" />
 <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white&label=Framework" alt="Express" />
 <img src="https://img.shields.io/badge/Puppeteer-40B5A4?style=for-the-badge&logo=puppeteer&logoColor=white&label=Automation" alt="Puppeteer" />
 <img src="https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white&label=Official_API" alt="Google Cloud" />
 <br>
 <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
 <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
 <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
 <img src="https://img.shields.io/badge/Vanilla_JS-000000?style=for-the-badge&logo=javascript&logoColor=F7DF1E&label=Modular_ES6" alt="Vanilla" />
</p>

---

## 🚀 Quick Start

### ▶️ One-Click Launch (Windows)
```powershell
# 1. Download the repository
# 2. Run start.bat — the script will:
# ✓ Check Node.js environment
# ✓ Install dependencies (npm install)
# ✓ Launch the server and open the dashboard in your browser
```

### 🐧 Linux / macOS (Manual)
```bash
# 1. Clone repository
git clone https://github.com/GrishaDeLumiere/golem-gateway.git
cd golem-gateway

# 2. Install dependencies
npm install

# 3. Start core
node start.js

# 4. Open dashboard in browser:
# 👉 http://127.0.0.1:7777
```

---

## 🔌 Client Integration

### ⚙️ Connection Settings
| Parameter | Value |
|-----------|-------|
| **API Type** | `OpenAI Compatible` / `Chat Completion` |
| **Base URL** | `http://127.0.0.1:7777/v1` |
| **API Key** | *Any string* (or your Master Key from the "System" tab) |

### 🎭 Integration Examples
- **Cobalt Tavern / SillyTavern:** Select `Custom (OpenAI-compatible)` API, enter `http://127.0.0.1:7777/v1` as the reverse proxy URL.
- **Explicit Routing:** Specify the prefixed model name in your client:
  - `gemini-api/gemini-3.7-flash` (Google Interactions API)
  - `deepseek/deepseek-v4-flash` (DeepSeek Web session)

---

## 🧱 Architecture

```
📦 golem-gateway/
 ┣ 📂 providers/               # Isolated AI provider modules
 ┃ ┣ 📜 deepseek.js           # Puppeteer + XHR interception
 ┃ ┣ 📜 qwen.js               # Puppeteer + Fetch sessions
 ┃ ┣ 📜 gemini-interaction.js # Official Google API + Safety bypass
 ┃ ┗ 📜 gemini.js             # CLI OAuth adapter
 ┣ 📂 public/                 # Modular ES6 frontend
 ┃ ┣ 📂 js/managers/          # Modal, Model, and Account managers
 ┃ ┗ 📜 dashboard.css         # Cyberpunk Glassmorphism stylesheet
 ┣ 📂 views/                  # HTML templates & modal components
 ┣ 📜 settings.js             # Core configuration management
 ┗ 📜 start.js                # Express gateway server & routing
```

---

## 📫 Contact & Support

<p align="center">
 <a href="https://github.com/GrishaDeLumiere/golem-gateway/issues">
 <img src="https://img.shields.io/badge/GitHub-Issues-181717?style=for-the-badge&logo=github&logoColor=white" alt="Issues" />
 </a>
 <a href="https://t.me/GrishaDeLumiere">
 <img src="https://img.shields.io/badge/Telegram-@GrishaDeLumiere-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
 </a>
 <a href="https://discord.com/users/__grisha__">
 <img src="https://img.shields.io/badge/Discord-__grisha__-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
 </a>
 <a href="mailto:contact.wardencraft@gmail.com">
 <img src="https://img.shields.io/badge/Email-contact.wardencraft@gmail.com-D14836?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" />
 </a>
</p>

---

<p align="center">
 <sub>Developed with 💜 by <b>GrishaDeLumiere</b> • <a href="https://github.com/GrishaDeLumiere/golem-gateway/blob/main/LICENSE">AGPL-3.0 License</a> • 2026</sub>
</p>