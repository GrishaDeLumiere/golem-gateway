@echo off
chcp 65001 > nul
cd /d "%~dp0"

title Golem API Router
color 0B

REM фикс кодировки для node
set NODE_OPTIONS=--enable-source-maps

echo ===============================================
echo [!] Инициализация системы...
echo ===============================================

if not exist "node_modules\" (
 echo [*] Библиотеки не найдены. Устанавливаю...
 echo.

 npm install

 if errorlevel 1 (
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