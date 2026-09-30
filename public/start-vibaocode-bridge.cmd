@echo off
setlocal EnableExtensions
title Vibaocode Setup

set "VIBAO_DIR=%LOCALAPPDATA%\Vibaocode\bridge"
set "BRIDGE_FILE=%VIBAO_DIR%\vibaocode-bridge.mjs"
set "LAUNCHER_FILE=%VIBAO_DIR%\vibaocode-launcher.ps1"
set "OLD_STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Vibaocode-Local-Bridge.cmd"

where node >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Vibaocode can Node.js LTS. Hay cai Node.js roi chay lai file nay.','Vibaocode Setup')"
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Vibaocode can Git for Windows. Hay cai Git roi chay lai file nay.','Vibaocode Setup')"
  exit /b 1
)

if not exist "%VIBAO_DIR%" mkdir "%VIBAO_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/techzoneadapter-droid/vibaocode/main/bridge/vibaocode-bridge.mjs' -OutFile '%BRIDGE_FILE%'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/techzoneadapter-droid/vibaocode/main/public/vibaocode-launcher.ps1' -OutFile '%LAUNCHER_FILE%'"
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Khong tai duoc Vibaocode Local Bridge. Kiem tra Internet va thu lai.','Vibaocode Setup')"
  exit /b 1
)

set "CODEX_JS=%APPDATA%\npm\node_modules\@openai\codex\bin\codex.js"
if not exist "%CODEX_JS%" (
  call npm install -g @openai/codex@latest >nul 2>nul
)

if exist "%OLD_STARTUP%" del /f /q "%OLD_STARTUP%" >nul 2>nul

reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "VibaocodeLocalBridge" /t REG_SZ /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%LAUNCHER_FILE%\"" /f >nul 2>nul

reg add "HKCU\Software\Classes\vibaocode" /ve /d "URL:Vibaocode Local Bridge" /f >nul 2>nul
reg add "HKCU\Software\Classes\vibaocode" /v "URL Protocol" /d "" /f >nul 2>nul
reg add "HKCU\Software\Classes\vibaocode\shell\open\command" /ve /d "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%LAUNCHER_FILE%\" \"%%1\"" /f >nul 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*vibaocode-bridge.mjs*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }; Start-Sleep -Milliseconds 700; Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"\"%LAUNCHER_FILE%\"\"'"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Da xong. Tu bay gio Local Bridge se chay ngam, tu khoi dong va tu cap nhat. Ban chi can bam Ket noi ChatGPT.','Vibaocode')"
exit /b 0
