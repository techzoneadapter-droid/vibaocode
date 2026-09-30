@echo off
setlocal EnableExtensions
title Vibaocode Local Bridge Setup

set "VIBAO_DIR=%LOCALAPPDATA%\Vibaocode\bridge"
set "BRIDGE_FILE=%VIBAO_DIR%\vibaocode-bridge.mjs"
set "STARTUP_FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Vibaocode-Local-Bridge.cmd"

echo.
echo ==========================================
echo   Vibaocode Local Bridge - One-time Setup
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Chua co Node.js tren may.
  echo Vui long cai Node.js LTS roi chay lai file nay:
  echo https://nodejs.org/
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Chua co Git tren may.
  echo Vui long cai Git for Windows roi chay lai file nay:
  echo https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist "%VIBAO_DIR%" mkdir "%VIBAO_DIR%"

echo [1/4] Dang tai Local Bridge moi nhat...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/techzoneadapter-droid/vibaocode/main/bridge/vibaocode-bridge.mjs' -OutFile '%BRIDGE_FILE%'"
if errorlevel 1 (
  echo [ERROR] Khong tai duoc Local Bridge.
  pause
  exit /b 1
)

where codex >nul 2>nul
if errorlevel 1 (
  echo [2/4] Dang cai Codex CLI...
  call npm install -g @openai/codex@latest
  if errorlevel 1 (
    echo [ERROR] Khong cai duoc Codex CLI.
    pause
    exit /b 1
  )
) else (
  echo [2/4] Codex CLI da co.
)

echo [3/4] Dang tao khoi dong cung Windows...
> "%STARTUP_FILE%" echo @echo off
>> "%STARTUP_FILE%" echo powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/techzoneadapter-droid/vibaocode/main/bridge/vibaocode-bridge.mjs' -OutFile '%BRIDGE_FILE%' } catch {}"
>> "%STARTUP_FILE%" echo start "" /min node "%BRIDGE_FILE%"

echo [4/4] Dang khoi dong Local Bridge...
start "Vibaocode Local Bridge" /min node "%BRIDGE_FILE%"

echo.
echo XONG. Quay lai Vibaocode va bam "Kiem tra Local Bridge".
echo Neu Chrome hoi quyen truy cap mang cuc bo, chon Allow/Cho phep.
echo.
timeout /t 3 >nul
exit /b 0
