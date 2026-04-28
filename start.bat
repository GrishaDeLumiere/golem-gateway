@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

title Golem API Router
color 0B

echo ===============================================
echo [!] Инициализация системы...
echo ===============================================

:: Проверка наличия Node.js в системе
where node >nul 2>nul
if %errorlevel% neq 0 (
 echo [!] Ошибка: Node.js не установлен или не добавлен в PATH!
 pause
 exit /b
)

if not exist "node_modules\" (
 echo [*] Библиотеки не найдены. Начинаю установку...
 echo.

 :: CALL обязателен, иначе выполнение прервется после npm.cmd
 call npm install --loglevel=info --progress=true

 if errorlevel 1 (
 echo.
 echo [!] Ошибка установки зависимостей!
 pause
 exit /b
 )

 echo.
 echo [+] Установка завершена!
) else (
 echo [+] Зависимости найдены.
)

echo.
echo [*] Запуск маршрутизатора...
echo.

node start.js

pause