param(
  [Parameter(Mandatory = $true)]
  [string]$WorkDir,
  [Parameter(Mandatory = $true)]
  [string]$CodexHome,
  [int]$BridgePort = 43119,
  [string]$ProxyKey = "phase1-proxy-key",
  [string]$ClientConfigPath = ""
)

$ErrorActionPreference = "Stop"

# Detect initial codex command: codex.cmd or codex
$codexBin = "codex.cmd"
if (-not (Get-Command $codexBin -ErrorAction SilentlyContinue)) {
  if (Get-Command "codex" -ErrorAction SilentlyContinue) {
    $codexBin = "codex"
  } else {
    throw "Codex CLI not found. Please install Codex CLI first."
  }
}

# Build the command text that will run in the new terminal
$cmdLines = @(
  "`$env:CODEX_HOME = '$CodexHome'"
)

if ($ClientConfigPath) {
  $cmdLines += "`$bridgeClient = Get-Content '$ClientConfigPath' -Raw | ConvertFrom-Json"
  $cmdLines += "`$env:OPENAI_API_KEY = `$bridgeClient.proxyKey"
  $cmdLines += "`$env:PHASE1_PROXY_KEY = `$bridgeClient.proxyKey"
} else {
  $cmdLines += "`$env:OPENAI_API_KEY = '$ProxyKey'"
  $cmdLines += "`$env:PHASE1_PROXY_KEY = '$ProxyKey'"
}

$cmdLines += @(
  "`$env:NO_PROXY = '127.0.0.1,localhost'",
  "`$env:no_proxy = '127.0.0.1,localhost'",
  "`$env:HTTP_PROXY = ''",
  "`$env:HTTPS_PROXY = ''",
  "`$env:ALL_PROXY = ''",
  "Write-Host 'Codex DeepSeek Bridge' -ForegroundColor Cyan",
  "Write-Host '  CODEX_HOME: $CodexHome' -ForegroundColor DarkGray",
  "Write-Host '  Workspace:  $WorkDir' -ForegroundColor DarkGray",
  "Write-Host '  Bridge:     http://127.0.0.1:${BridgePort}/v1' -ForegroundColor DarkGray",
  "Write-Host ''",
  "& $codexBin --cd '$WorkDir'"
)
$cmdText = $cmdLines -join "; "

# Start new PowerShell terminal
Start-Process powershell.exe `
  -ArgumentList "-NoExit", "-NoProfile", "-Command", $cmdText `
  -WindowStyle Normal

Write-Host "Codex terminal launched."
