param([string]$Uri = "vibaocode://start")
$ErrorActionPreference = "SilentlyContinue"
$VibaoDir = Join-Path $env:LOCALAPPDATA "Vibaocode\bridge"
$BridgeFile = Join-Path $VibaoDir "vibaocode-bridge.mjs"
$BridgeUrl = "https://raw.githubusercontent.com/techzoneadapter-droid/vibaocode/main/bridge/vibaocode-bridge.mjs"
if (-not (Test-Path $VibaoDir)) { New-Item -ItemType Directory -Force -Path $VibaoDir | Out-Null }
function Test-Bridge {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect("127.0.0.1", 43127, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne(500)
    if ($ok -and $client.Connected) { $client.EndConnect($async); $client.Close(); return $true }
    $client.Close()
  } catch {}
  return $false
}
if (Test-Bridge) { exit 0 }
try { Invoke-WebRequest -UseBasicParsing ($BridgeUrl + "?t=" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) -OutFile $BridgeFile } catch { if (-not (Test-Path $BridgeFile)) { exit 2 } }
$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $Node) { exit 3 }
Start-Process -FilePath $Node -ArgumentList @("`"$BridgeFile`"") -WindowStyle Hidden
exit 0
