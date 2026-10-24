@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to start this workspace.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing dependencies in %CD% ...
  call pnpm install --frozen-lockfile --ignore-scripts
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

node scripts\build-chat-preview-css.mjs
if errorlevel 1 (
  echo Chat styles could not be prepared.
  pause
  exit /b 1
)

echo Starting this workspace from %CD%
echo Address: http://127.0.0.1:5183/
echo This address has its own browser data, separate from ports 5173 and 4173.
call "node_modules\.bin\vite.cmd" --host 127.0.0.1 --port 5183 --strictPort --open
if errorlevel 1 (
  echo Startup failed. If port 5183 is occupied, close its window and try again.
  pause
  exit /b 1
)
