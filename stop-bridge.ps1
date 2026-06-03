param(
  [Parameter(Mandatory = $true)]
  [string]$SandboxRoot,
  [int]$BridgePort = 43119
)

$ErrorActionPreference = "Stop"

$pidFile = Join-Path $SandboxRoot "bridge.pid"
$pids = @()
if (Test-Path $pidFile) {
  $raw = (Get-Content $pidFile -Raw).Trim()
  if ($raw -match "^\d+$") {
    $pids += [int]$raw
  }
}

$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $canStop = $false
  if ($pids -contains [int]$listener.OwningProcess) {
    $canStop = $true
  } else {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
      $canStop = ($health.status -eq "ok")
    } catch {
      $canStop = $false
    }
  }
  if ($canStop) {
    $pids += [int]$listener.OwningProcess
  } else {
    Write-Warning "Port $BridgePort is in use by PID $($listener.OwningProcess) but it is not a recognized Paseo bridge. Skipping."
  }
}

$pids = $pids | Select-Object -Unique
foreach ($processId in $pids) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process) {
    Write-Host "Stopping bridge PID $processId"
    Stop-Process -Id $processId -Force
  }
}

Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

$listenerAfter = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listenerAfter) {
  Write-Warning "Bridge port $BridgePort is still in use by PID $($listenerAfter.OwningProcess)."
}

Write-Host "Bridge stopped."
