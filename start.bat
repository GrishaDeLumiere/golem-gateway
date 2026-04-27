@echo off
chcp 65001 > nul
cd /d "%~dp0"

title Golem API Router
color 0B

echo ===============================================
echo [!] Инициализация системы...
echo ===============================================

if not exist "node_modules\" (
 echo [*] Библиотеки не найдены. Начинаю установку...
 echo.

 REM детальный вывод npm (без call — он тут не нужен)
 npm install --loglevel=info --progress=true

 if errorlevel 1 (
  echo.
  echo [!] Ошибка установки зависимостей!
  pause
  exit /b
 )

 echo.
 echo [+] Установка завершена!
)

echo.
echo [*] Запуск маршрутизатора...
echo.

node start.js

pause