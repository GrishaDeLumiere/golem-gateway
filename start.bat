@echo off
chcp 65001 > nul
cd /d "%~dp0"

title Golem API Router
color 0B

echo ===============================================
echo [!] Инициализация системы...
echo ===============================================

if not exist "node_modules\" (
 echo [*] Библиотеки не найдены. Начинаю автоматическую установку...
 echo.

 REM Показываем подробный прогресс
 call npm install --loglevel=info --progress=true

 echo.
 echo [+] Установка завершена!
)

echo [*] Запуск маршрутизатора...
echo.

node start.js

pause