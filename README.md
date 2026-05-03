<div align="right">
 <strong>🇷🇺 Русский</strong> | <a href="README.en.md">🇬🇧 English</a>
</div>

# <img src="./public/favicon.svg" alt="AI Core Logo" width="30" height="30" /> Golem Gateway (AI Core)

<p align="center">
 <img src="./public/favicon.svg" alt="AI Core Logo" width="100" height="100" />
</p>

<p align="center">
 <a href="https://github.com/GrishaDeLumiere/golem-gateway/releases">
 <img src="https://img.shields.io/badge/версия-v0.2.0-615CED?style=for-the-badge&logo=semver&logoColor=white" alt="Version" />
 </a>
 <img src="https://img.shields.io/badge/Node.js-16%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
 <img src="https://img.shields.io/badge/License-AGPL%203.0-red?style=for-the-badge&logo=gnu&logoColor=white" alt="License" />
 <img src="https://img.shields.io/badge/OpenAI_API-Compatible-blue?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI Compatible" />
</p>

<p align="center">
 <strong>Модульный stateless-маршрутизатор для больших языковых моделей</strong><br>
 <em>Невидимый мост между веб-интерфейсами ИИ и стандартными API-клиентами</em>
</p>

---

## 🎯 О проекте

**Golem Gateway** — это прозрачный прокси-шлюз, который предоставляет единый REST-интерфейс, полностью совместимый со стандартом **OpenAI API**, используя автоматизацию headless-браузеров (Puppeteer) и перехват **XHR/Fetch** запросов.

> 💡 **Идея проста:** вы работаете с любимыми клиентами (SillyTavern, Cursor, Cline), а Golem незаметно маршрутизирует запросы через веб-сессии, обходя ограничения прямых API.

---

## 🧩 Поддерживаемые провайдеры

| Провайдер | Иконка | Метод | Особенности | Статус |
|-----------|--------|-------|-------------|--------|
| **DeepSeek** | <img src="./public/deepseek.svg" width="24" /> | `Puppeteer + XHR` | Захват сессии, авто-стерилизация истории | ✅ Стабильно |
| **Qwen** | <img src="./public/qwen.svg" width="24" /> | `Puppeteer + Fetch` | Локальные сессии, управление пулом аккаунтов | ✅ Стабильно |
| **Gemini** | <img src="./public/gemini.svg" width="24" /> | `OAuth2 + Google Cloud Code Assist` | Мульти-аккаунты, thinking budget, веб-поиск | ✅ Стабильно |

---

## ✨ Ключевые возможности

```mermaid
graph LR
 A[Клиент: SillyTavern/Cursor] -->|OpenAI API | B(Golem Gateway)
 B -->|Puppeteer| C[DeepSeek Web]
 B -->|Puppeteer| D[Qwen Web]
 B -->|OAuth2| E[Gemini Cloud API]
 C & D & E -->|Ответ| B -->|OpenAI Format| A
```

- **🔌 Полная совместимость с OpenAI API**
 Нативная поддержка эндпоинтов `/v1/models` и `/v1/chat/completions` (включая `stream: true`). Работает "из коробки" с любым клиентом.

- **🎨 Панель управления (Dashboard)**
 Современный веб-интерфейс на `:7777` с анимированным фоном, настройками частиц, управлением токенами и реал-тайм апдейтером ядра.

- **🧠 Динамическое управление памятью**
 Включайте/выключайте модули нейросетей на лету. Ненужные адаптеры мгновенно выгружаются из ОЗУ без перезагрузки сервера.

- **🧹 Автоматическая стерилизация сессий**
 Теневые сессии на целевых платформах (DeepSeek, Qwen) удаляются сразу после генерации ответа — ваш аккаунт остаётся чистым.

- **🧱 Модульная архитектура**
 Паттерн Router + изолированные провайдеры (`providers/`). Добавление новой нейросети занимает ~15 минут.

---

## 🛠 Технологический стек

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

## 🚀 Быстрый старт

### ▶️ Запуск в один клик (Windows)
```powershell
# 1. Скачайте репозиторий
# 2. Запустите start.bat — всё остальное сделает скрипт:
# ✓ Проверка Node.js
# ✓ npm install
# ✓ Авто-открытие дашборда в браузере
```

### 🐧 Linux / macOS (Вручную)
```bash
# 1. Клонируйте репозиторий
git clone https://github.com/GrishaDeLumiere/golem-gateway.git
cd golem-gateway

# 2. Установите зависимости
npm install

# 3. Запустите ядро
node start.js

# 4. Откройте в браузере:
# 👉 http://127.0.0.1:7777
```

---

## 🔌 Интеграция с клиентами

### ⚙️ Настройка подключения
| Параметр | Значение |
|----------|----------|
| **API Type** | `OpenAI Compatible` / `Custom Endpoint` |
| **Base URL** | `http://127.0.0.1:7777/v1` |
| **API Key** | *любой текст* (или токен из вкладки «Система») |

### 🎭 Особенности для разных клиентов
- **SillyTavern**: Для Gemini используйте `http://127.0.0.1:7777/` (без `/v1`) в режиме *Google AI Studio*.
- **Cursor / Cline / Roo Code**: Работают нативно через стандартный OpenAI-формат.
- **Регулярные выражения**: Используйте встроенные инструменты вашего клиента, чтобы фильтровать служебные теги (`<think>`, веб-поиск) из памяти персонажа.

---

## 🧱 Архитектура: Как добавить новый провайдер

```
📦 providers/
 ┣ 📜 index.js # Реестр провайдеров
 ┣ 📜 deepseek.js # Пример: перехват сессии
 ┣ 📜 qwen.js # Пример: локальные сессии
 ┗ 📜 gemini.js # Пример: OAuth2 + Cloud API
```

**Алгоритм добавления:**
1. Создайте файл `providers/newprovider.js`
2. Реализуйте 4 функции жизненного цикла:
 ```js
 initProvider(port) // Инициализация
 setupRoutes(app, port) // Роуты и логика
 handleChatCompletion() // Обработка запросов
 unloadProvider() // Очистка памяти
 ```
3. Зарегистрируйте провайдер в `providers/index.js`
4. Добавьте UI-элементы в `dashboard.html` и логику в `settings.js`

> 🎯 **Цель:** добавить нового провайдера за 15-20 минут.

---

## 📫 Связь и поддержка

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
 <sub>Разработано с 💜 <b>GrishaDeLumiere</b> • <a href="https://github.com/GrishaDeLumiere/golem-gateway/blob/main/LICENSE">AGPL-3.0 License</a> • 2026</sub>
</p>