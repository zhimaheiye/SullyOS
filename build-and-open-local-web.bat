@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to build this workspace.
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

call "node_modules\.bin\vite.cmd" build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

set "HOST=127.0.0.1"
set "PORT=4183"
echo Serving this workspace from %CD%
echo Address: http://127.0.0.1:4183/
echo This address has its own browser data, separate from ports 5173 and 4173.
node scripts\local-static-server.cjs dist --open
if errorlevel 1 (
  echo Preview failed. If port 4183 is occupied, close its window and try again.
  pause
  exit /b 1
)
