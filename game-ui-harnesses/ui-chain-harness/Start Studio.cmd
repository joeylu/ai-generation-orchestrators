@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. See docs/local-studio.md.
  pause
  exit /b 1
)
if not "%~2"=="" (
  echo Usage: Start Studio.cmd [port]
  exit /b 1
)
set "STUDIO_PORT=4310"
if not "%~1"=="" set "STUDIO_PORT=%~1"
node -e "const p=process.argv[1];if(!/^[0-9]+$/.test(p)||Number(p)<1024||Number(p)>65535){console.error('Port must be an integer from 1024 to 65535.');process.exit(1)}" "%STUDIO_PORT%"
if errorlevel 1 exit /b 1
echo UI Studio: http://127.0.0.1:%STUDIO_PORT%/
echo Keep this window open while using Studio. Ctrl+C stops the local service.
echo Startup does not authorize generation. Check the current adapter in Studio before confirming a plan.
node scripts/studio.mjs work/studio/project.json "%STUDIO_PORT%"
if errorlevel 1 pause
