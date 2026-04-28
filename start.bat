@echo off
pushd %~dp0
set NODE_ENV=production
call npm install --no-save --no-audit --no-fund --loglevel=error --no-progress --omit=dev --ignore-scripts
node start.js %*
pause
popd