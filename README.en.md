<div align="right">
 <a href="README.md">🇷🇺 Русский</a> | <strong>🇬🇧 English</strong>
</div>

# <img src="./public/favicon.svg" alt="AI Core Logo" width="30" height="30" /> Golem Gateway (AI Core)

<p align="center">
 <img src="./public/favicon.svg" alt="AI Core Logo" width="100" height="100" />
</p>

<p align="center">
 <a href="https://github.com/GrishaDeLumiere/golem-gateway/releases">
 <img src="https://img.shields.io/badge/version-v0.2.0-615CED?style=for-the-badge&logo=semver&logoColor=white" alt="Version" />
 </a>
 <img src="https://img.shields.io/badge/Node.js-16%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
 <img src="https://img.shields.io/badge/License-AGPL%203.0-red?style=for-the-badge&logo=gnu&logoColor=white" alt="License" />
 <img src="https://img.shields.io/badge/OpenAI_API-Compatible-blue?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI Compatible" />
</p>

<p align="center">
 <strong>A modular stateless router for large language models</strong><br>
 <em>The invisible bridge between AI web interfaces and standard API clients</em>
</p>

---

## 🎯 About the Project

**Golem Gateway** is a transparent proxy gateway that provides a unified REST interface fully compatible with the **OpenAI API** standard, utilizing headless browser automation (Puppeteer) and **XHR/Fetch** request interception.

> 💡 **The idea is simple:** you work with your favorite clients (SillyTavern, Cursor, Cline), while Golem seamlessly routes requests through web sessions, bypassing direct API restrictions.

---

## 🧩 Supported Providers

| Provider | Icon | Method | Features | Status |
|----------|------|--------|----------|--------|
| **DeepSeek** | <img src="./public/deepseek.svg" width="24" /> | `Puppeteer + XHR` | Session capture, auto-sterilization of history | ✅ Stable |
| **Qwen** | <img src="./public/qwen.svg" width="24" /> | `Puppeteer + Fetch` | Local sessions, account pool management | ✅ Stable |
| **Gemini** | <img src="./public/gemini.svg" width="24" /> | `OAuth2 + Google Cloud Code Assist` | Multi-accounts, thinking budget, web search | ✅ Stable |

---

## ✨ Key Features

```mermaid
graph LR
 A[Client: SillyTavern/Cursor] -->|OpenAI API | B(Golem Gateway)
 B -->|Puppeteer| C[DeepSeek Web]
 B -->|Puppeteer| D[Qwen Web]
 B -->|OAuth2| E[Gemini Cloud API]
 C & D & E -->|Response| B -->|OpenAI Format| A
```

- **🔌 Full OpenAI API Compatibility**
 Native support for `/v1/models` and `/v1/chat/completions` endpoints (including `stream: true`). Works "out of the box" with any client.

- **🎨 Dashboard Component**
 A modern web interface on `:7777` with an animated background, particle settings, token management, and a real-time core updater.

- **🧠 Dynamic Memory Management**
 Toggle neural network modules on the fly. Unused adapters are instantly unloaded from RAM without requiring a server restart.

- **🧹 Automatic Session Sterilization**
 Shadow sessions on target platforms (DeepSeek, Qwen) are deleted immediately after generating a response — keeping your account completely clean.

- **🧱 Modular Architecture**
 Router pattern + isolated providers (`providers/`). Adding a new neural network takes ~15 minutes.

---

## 🛠 Tech Stack

<p align="center">
 <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white&label=Runtime" alt="Node.js" />
 <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white&label=Framework" alt="Express" />
 <img src="https://img.shields.io/badge/Puppeteer-40B5A4?style=for-the-badge&logo=puppeteer&logoColor=white&label=Automation" alt="Puppeteer" />
 <img src="https://img.shields.io/badge/Google+OAuth-4285F4?style=for-the-badge&logo=google&logoColor=white&label=Auth" alt="OAuth2" />
 <br>
 <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
 <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
 <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
 <img src="https://img.shields.io/badge/Vanilla_JS-000000?style=for-the-badge&logo=javascript&logoColor=F7DF1E&label=No+Frameworks" alt="Vanilla" />
</p>

---

## 🚀 Quick Start

### ▶️ One-Click Launch (Windows)
```powershell
# 1. Download the repository
# 2. Run start.bat — the script will handle the rest:
# ✓ Node.js check
# ✓ npm install
# ✓ Auto-launch Dashboard in browser
```

### 🐧 Linux / macOS (Manual)
```bash
# 1. Clone the repository
git clone https://github.com/GrishaDeLumiere/golem-gateway.git
cd golem-gateway

# 2. Install dependencies
npm install

# 3. Start the core
node start.js

# 4. Open in browser:
# 👉 http://127.0.0.1:7777
```

---

## 🔌 Client Integration

### ⚙️ Connection Settings
| Parameter | Value |
|-----------|-------|
| **API Type** | `OpenAI Compatible` / `Custom Endpoint` |
| **Base URL** | `http://127.0.0.1:7777/v1` |
| **API Key** | *any text* (or the token from the "System" tab) |

### 🎭 Client-Specific Notes
- **SillyTavern**: For Gemini use `http://127.0.0.1:7777/` (without `/v1`) in *Google AI Studio* mode.
- **Cursor / Cline / Roo Code**: Work natively via the standard OpenAI format.
- **Regular Expressions**: Use your client's built-in tools to filter system tags (`<think>`, web search) out of the character's memory.

---

## 🧱 Architecture: How to add a new provider

```
📦 providers/
 ┣ 📜 index.js # Provider registry
 ┣ 📜 deepseek.js # Example: session interception
 ┣ 📜 qwen.js # Example: local sessions
 ┗ 📜 gemini.js # Example: OAuth2 + Cloud API
```

**Workflow:**
1. Create a file `providers/newprovider.js`
2. Implement 4 lifecycle functions:
 ```js
 initProvider(port) // Initialization
 setupRoutes(app, port) // Routes and logic
 handleChatCompletion() // Request processing
 unloadProvider() // Memory cleanup
 ```
3. Register the provider in `providers/index.js`
4. Add UI elements to `dashboard.html` and logic in `settings.js`

> 🎯 **Goal:** add a new provider in just 15-20 minutes.

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