param(
  [Parameter(Mandatory = $true)]
  [string]$SandboxRoot,
  [Parameter(Mandatory = $true)]
  [string]$DeepSeekBaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$DeepSeekApiKey,
  [int]$BridgePort = 43119,
  [string]$ProxyKey = "phase1-proxy-key",
  [string]$ProxyKeysFile = ""
)

$ErrorActionPreference = "Continue"

function Write-Step {
  param([string]$Message)
  Write-Host "[start-bridge] $Message"
}

Write-Step "SandboxRoot: $SandboxRoot"
Write-Step "Bridge port: $BridgePort"
Write-Step "Upstream URL: $DeepSeekBaseUrl"
if ($ProxyKeysFile) { Write-Step "Proxy key registry: $ProxyKeysFile" }

$logsDir = Join-Path $SandboxRoot "logs"
$pidFile = Join-Path $SandboxRoot "bridge.pid"
$stdoutLog = Join-Path $logsDir "bridge-stdout.log"
$stderrLog = Join-Path $logsDir "bridge-stderr.log"

# Locate bridge.mjs. Prefer the launcher bridge because it contains shared-client isolation.
$bridgeScript = Join-Path $PSScriptRoot "bridge\bridge.mjs"
if (-not (Test-Path $bridgeScript)) {
  $bridgeScript = Join-Path $PSScriptRoot "..\..\src\phase1\bridge.mjs"
}
if (-not (Test-Path $bridgeScript)) {
  throw "Cannot find bridge.mjs. Searched: $bridgeScript"
}
Write-Step "Bridge script: $bridgeScript"

# Check for existing bridge on the same port
Write-Step "Checking port $BridgePort..."
$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Step "Port $BridgePort already in use by PID $($listener.OwningProcess)"
  $ownedByUs = (Test-Path $pidFile)
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
    if ($health.status -eq "ok") {
      if ($ownedByUs) {
        [System.IO.File]::WriteAllText($pidFile, [string]$listener.OwningProcess, [System.Text.UTF8Encoding]::new($false))
        Write-Step "Reusing existing bridge (PID $($listener.OwningProcess))"
        return @{ Port = $BridgePort; Pid = $listener.OwningProcess }
      }
      throw "Port $BridgePort is in use by another bridge (PID $($listener.OwningProcess)). Stop it or pick a different port."
    }
    throw "Port $BridgePort occupied by non-bridge process (PID $($listener.OwningProcess))."
  } catch {
    if ($_.Exception.Message -match "already running|already in use|pick a different port") { throw }
    throw "Port $BridgePort in use by PID $($listener.OwningProcess). Stop it or choose another port."
  }
}
Write-Step "Port $BridgePort is free"

# Set environment for bridge
$env:DEEPSEEK_BASE_URL = $DeepSeekBaseUrl
$env:DEEPSEEK_API_KEY = $DeepSeekApiKey
$env:BRIDGE_PORT = [string]$BridgePort
$env:UPSTREAM_MODE = "deepseek"
$env:PHASE1_PROXY_KEY = $ProxyKey
$env:PHASE_LOG_DIR = $logsDir
if ($ProxyKeysFile) { $env:CODEX_BRIDGE_PROXY_KEYS_FILE = $ProxyKeysFile }

# Ensure logs dir
New-Item -ItemType Directory -Force $logsDir | Out-Null
Remove-Item -LiteralPath $stdoutLog, $stderrLog -ErrorAction SilentlyContinue

# Start bridge process
Write-Step "Starting Node.js bridge..."
$bridgeArgs = "`"$bridgeScript`" --port=$BridgePort --log-dir=`"$logsDir`" --proxy-key=$ProxyKey"
if ($ProxyKeysFile) {
  $bridgeArgs += " --proxy-keys-file=`"$ProxyKeysFile`""
}
Write-Step "  node $bridgeArgs"

$process = Start-Process -FilePath "node" `
  -ArgumentList $bridgeArgs `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog

if (-not $process) {
  throw "Failed to start Node.js process. Is Node.js installed and in PATH?"
}

[System.IO.File]::WriteAllText($pidFile, [string]$process.Id, [System.Text.UTF8Encoding]::new($false))
Write-Step "Node.js started with PID $($process.Id)"

# Wait for health
Write-Step "Waiting for bridge health check..."
$deadline = (Get-Date).AddSeconds(20)
$lastError = $null
while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
    if ($health.status -eq "ok") {
      Write-Step "Bridge healthy! Uptime: $($health.uptime_sec)s"
      return @{ Port = $BridgePort; Pid = $process.Id }
    }
    $lastError = "Unexpected health response: $($health | ConvertTo-Json -Compress)"
  } catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Milliseconds 500
}

# Health check timed out - show stderr for debugging
Write-Step "Health check FAILED after 20s"
Write-Step "Last error: $lastError"
if (Test-Path $stderrLog) {
  Write-Step "--- bridge stderr ---"
  Get-Content $stderrLog | ForEach-Object { Write-Host "  $_" }
  Write-Step "--- end stderr ---"
}
if (Test-Path $stdoutLog) {
  Write-Step "--- bridge stdout (last 20 lines) ---"
  Get-Content $stdoutLog -Tail 20 | ForEach-Object { Write-Host "  $_" }
  Write-Step "--- end stdout ---"
}
throw "Bridge health check failed on port $BridgePort. See logs at $logsDir"
