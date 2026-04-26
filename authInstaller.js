// authInstaller.js

class AuthInstaller {
    constructor(port) {
        this.port = port;
    }

    getHtml() {
        return `
 <!DOCTYPE html>
 <html lang="ru">
 <head>
 <meta charset="utf-8">
 <title>Авторизация | DeepSeek Захват</title>
 <style>
 :root { --bg-dark: #0f172a; --bg-card: #1e293b; --text-main: #f8fafc; --text-muted: #94a3b8; --border: #334155; --accent: #3b82f6; --accent-hover: #2563eb; --success: #10b981; }
 body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg-dark); color: var(--text-main); margin: 0; padding: 40px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
 .box { background: var(--bg-card); padding: 32px 40px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); border: 1px solid var(--border); max-width: 700px; width: 100%; box-sizing: border-box; }
 h2 { color: var(--text-main); font-size: 24px; margin-top: 0; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); text-align: center; }
 .step { font-size: 16px; margin: 20px 0 12px; font-weight: 500; }

 .code-container { display: flex; background: #000; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
 .code-container code { flex-grow: 1; padding: 16px; color: var(--success); font-family: 'Consolas', monospace; font-size: 13px; line-height: 1.5; word-break: break-all; margin: 0; }

 .ds-icon-button { background: #0f172a; width: 52px; border-left: 1px solid var(--border); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; position: relative; }
 .ds-icon-button:hover { background: #1e293b; color: white; }
 .ds-icon-button svg { color: var(--text-muted); transition: color 0.2s; }
 .ds-icon-button:hover svg { color: var(--text-main); }

 button.main-btn { background: var(--accent); color: white; border: none; padding: 16px 24px; font-size: 16px; font-weight: 600; cursor: pointer; border-radius: 8px; transition: 0.2s; width: 100%; letter-spacing: 0.5px; }
 button.main-btn:hover { background: var(--accent-hover); transform: translateY(-1px); }

 /* Toast */
 .toast { position: fixed; top: 24px; right: 24px; background: var(--success); color: white; padding: 12px 24px; border-radius: 8px; font-weight: bold; transform: translateX(150%); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 1000; }
 .toast.show { transform: translateX(0); }
 </style>
 </head>
 <body>
 <div id="toast" class="toast">✅ Код успешно скопирован!</div>
 <div class="box">
 <h2>🚨 Требуется обновление сессии 🚨</h2>

 <div class="step">1. Скопируй этот скрипт-пейлоад:</div>
 <div class="code-container">
 <code id="script-content">fetch('http://127.0.0.1:${this.port}/receive-payload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: (()=>{ let t=localStorage.getItem('userToken'); try{return JSON.parse(t).value;}catch(e){return t;} })(), cookies: document.cookie }) }).then(r => r.text()).then(t => alert('✅ Данные успешно отправлены на сервер!\\n\\nМожешь возвращаться в консоль NodeJS!'));</code>

 <div class="ds-icon-button ds-icon-button--m" tabindex="0" role="button" aria-label="Копировать код" onclick="copySnippet()">
 <div class="ds-icon">
 <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M6.14929 4.02032C7.11197 4.02032 7.87983 4.02016 8.49597 4.07598C9.12128 4.13269 9.65792 4.25188 10.1415 4.53106C10.7202 4.8653 11.2008 5.3459 11.535 5.92462C11.8142 6.40818 11.9334 6.94481 11.9901 7.57012C12.0459 8.18625 12.0458 8.95419 12.0458 9.9168C12.0458 10.8795 12.0459 11.6473 11.9901 12.2635C11.9334 12.8888 11.8142 13.4254 11.535 13.909C11.2008 14.4877 10.7202 14.9683 10.1415 15.3025C9.65792 15.5817 9.12128 15.7009 8.49597 15.7576C7.87984 15.8134 7.11196 15.8133 6.14929 15.8133C5.18667 15.8133 4.41874 15.8134 3.80261 15.7576C3.1773 15.7009 2.64067 15.5817 2.1571 15.3025C1.5784 14.9683 1.09778 14.4877 0.76355 13.909C0.484366 13.4254 0.365184 12.8888 0.308472 12.2635C0.252649 11.6473 0.252808 10.8795 0.252808 9.9168C0.252808 8.95418 0.252664 8.18625 0.308472 7.57012C0.365184 6.94481 0.484366 6.40818 0.76355 5.92462C1.09777 5.34589 1.57839 4.86529 2.1571 4.53106C2.64067 4.25188 3.1773 4.13269 3.80261 4.07598C4.41874 4.02017 5.18666 4.02032 6.14929 4.02032ZM6.14929 5.37774C5.16181 5.37774 4.46634 5.37761 3.92566 5.42657C3.39434 5.47472 3.07859 5.56574 2.83582 5.70587C2.4632 5.92106 2.15354 6.2307 1.93835 6.60333C1.79823 6.8461 1.70721 7.16185 1.65906 7.69317C1.6101 8.23385 1.61023 8.92933 1.61023 9.9168C1.61023 10.9043 1.61009 11.5998 1.65906 12.1404C1.70721 12.6717 1.79823 12.9875 1.93835 13.2303C2.15356 13.6029 2.46321 13.9126 2.83582 14.1277C3.07859 14.2679 3.39434 14.3589 3.92566 14.407C4.46634 14.456 5.16182 14.4559 6.14929 14.4559C7.13682 14.4559 7.83224 14.456 8.37292 14.407C8.90425 14.3589 9.21999 14.2679 9.46277 14.1277C9.83535 13.9126 10.145 13.6029 10.3602 13.2303C10.5004 12.9875 10.5914 12.6717 10.6395 12.1404C10.6885 11.5998 10.6884 10.9043 10.6884 9.9168C10.6884 8.92934 10.6885 8.23384 10.6395 7.69317C10.5914 7.16185 10.5004 6.8461 10.3602 6.60333C10.1451 6.23071 9.83536 5.92107 9.46277 5.70587C9.21999 5.56574 8.90424 5.47472 8.37292 5.42657C7.83224 5.3776 7.13682 5.37774 6.14929 5.37774ZM9.80164 0.367975C10.7638 0.367975 11.5314 0.36788 12.1473 0.423639C12.7726 0.480307 13.3093 0.598759 13.7928 0.877741C14.3717 1.21192 14.8521 1.69355 15.1864 2.27227C15.4655 2.75574 15.5857 3.29164 15.6425 3.9168C15.6983 4.53301 15.6971 5.3016 15.6971 6.26446V7.82989C15.6971 8.29264 15.6989 8.58993 15.6649 8.84844C15.4668 10.3525 14.401 11.5738 12.9833 11.9988V10.5467C13.6973 10.1903 14.2105 9.49662 14.3192 8.67169C14.3387 8.52347 14.3407 8.3358 14.3407 7.82989V6.26446C14.3407 5.27706 14.3398 4.58149 14.2909 4.04083C14.2428 3.50968 14.1526 3.19372 14.0126 2.95098C13.7974 2.57849 13.4876 2.26869 13.1151 2.05352C12.8724 1.91347 12.5564 1.82237 12.0253 1.77423C11.4847 1.72528 10.7888 1.7254 9.80164 1.7254H7.71472C6.7562 1.72558 5.92665 2.27697 5.52332 3.07891H4.07019C4.54221 1.51132 5.9932 0.368186 7.71472 0.367975H9.80164Z" fill="currentColor"></path>
 </svg>
 </div>
 </div>
 </div>

 <div class="step">2. Нажми на кнопку ниже, чтобы открыть официальный чат DeepSeek.</div>
 <div class="step">3. Нажми <b>F12</b>, открой <b>Консоль (Console)</b>, вставь скопированный скрипт нажатием <i>Ctrl+V</i> и нажми <b>Enter</b>.</div>
 <br>
 <button class="main-btn" onclick="window.open('https://chat.deepseek.com', '_blank')">Открыть чат DeepSeek</button>
 </div>

 <script>
 function copySnippet() {
 const code = document.getElementById('script-content').innerText;
 navigator.clipboard.writeText(code).then(() => {
 const toast = document.getElementById('toast');
 toast.classList.add('show');
 setTimeout(() => toast.classList.remove('show'), 3000);
 }).catch(err => {
 console.error('Ошибка копирования: ', err);
 alert('Не удалось скопировать код. Выделите его вручную.');
 });
 }
 </script>
 </body>
 </html>
 `;
    }

    setup(app) {
        app.get('/install-auth', (req, res) => {
            res.send(this.getHtml());
        });
    }
}

module.exports = AuthInstaller;