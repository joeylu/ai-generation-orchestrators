@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. See docs/local-studio.md.
  pause
  exit /b 1
)
echo UI Studio: http://127.0.0.1:4210/
echo Keep this window open while using Studio. Ctrl+C stops the local service.
node scripts/studio.mjs work/studio/project.json 4210
if errorlevel 1 pause
