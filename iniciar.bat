@echo off
chcp 65001 >nul
title SmartPlanner v2.0 - Agenda Inteligente Deterministica
echo ============================================================================
echo   SmartPlanner v2.0 - Agenda Inteligente de Produtividade
echo   Motor: Node.js v24 + SQLite Nativo (node:sqlite) + LocalStorage Sync
echo ============================================================================
echo.
echo Iniciando servidor na porta 3000 e abrindo o navegador...
start "" http://localhost:3000
node server/server.js
pause
