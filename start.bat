@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title Golem API Router
color 0B

echo ===============================================
echo [!] Инициализация системы...
echo ===============================================

REM Проверка наличия Node.js в системе
where node >nul 2>nul
if %errorlevel% neq 0 (
 echo [!] Ошибка: Node.js не установлен или не добавлен в PATH!
 pause
 exit /b
)

if exist "node_modules\" (
 echo [+] Зависимости найдены.
 goto :run_app
)

echo [*] Библиотеки не найдены. Начинаю установку...
echo.

REM CALL обязателен, иначе выполнение прервется
call npm install --loglevel=info --progress=true
if %errorlevel% neq 0 (
 echo.
 echo [!] Ошибка установки зависимостей!
 pause
 exit /b
)

echo.
echo [+] Установка завершена!

:run_app
echo.
echo [*] Запуск маршрутизатора...
echo.

node start.js

pause