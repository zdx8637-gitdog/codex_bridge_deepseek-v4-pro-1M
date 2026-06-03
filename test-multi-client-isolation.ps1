param(
  [int]$BridgePort = 43129,
  [int]$MockUpstreamPort = 43130
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$testRoot = Join-Path $root "sandbox\launcher-multi-test"
$logs = Join-Path $testRoot "logs"
$traces = Join-Path $logs "traces"
$registry = Join-Path $testRoot "clients.json"
$bridgeScript = Join-Path $PSScriptRoot "bridge\bridge.mjs"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Stop-PortListener {
  param([int]$Port)
  $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-PaseoResponse {
  param(
    [string]$ProxyKey,
    [string]$CaseId,
    [string]$InputText,
    [string]$PreviousResponseId
  )

  $body = [ordered]@{
    model = "deepseek-v4-pro"
    stream = $false
    input = $InputText
    metadata = @{ paseo_case_id = $CaseId }
  }
  if ($PreviousResponseId) {
    $body.previous_response_id = $PreviousResponseId
  }

  $json = $body | ConvertTo-Json -Depth 20 -Compress
  $response = Invoke-WebRequest `
    -Uri "http://127.0.0.1:$BridgePort/v1/responses" `
    -Method Post `
    -Headers @{ Authorization = "Bearer $ProxyKey" } `
    -ContentType "application/json" `
    -Body $json `
    -TimeoutSec 60

  return ($response.Content | ConvertFrom-Json)
}

Remove-Item -LiteralPath $logs -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $logs, $traces | Out-Null
Stop-PortListener -Port $BridgePort
Stop-PortListener -Port $MockUpstreamPort

$registryPayload = [ordered]@{
  clients = @(
    [ordered]@{ id = "client_a"; key = "paseo_proxy_a" },
    [ordered]@{ id = "client_b"; key = "paseo_proxy_b" }
  )
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($registry, $registryPayload, $utf8NoBom)

$env:UPSTREAM_MODE = "mock"
$env:BRIDGE_PORT = [string]$BridgePort
$env:MOCK_UPSTREAM_PORT = [string]$MockUpstreamPort
$env:PHASE_LOG_DIR = $logs
$env:PHASE_TRACE_DIR = $traces
$env:PASEO_PROXY_KEYS_FILE = $registry
$env:MOCK_FINAL_TEXT = "PASEO_MULTI_OK"

$stdout = Join-Path $logs "stdout.log"
$stderr = Join-Path $logs "stderr.log"
$bridge = Start-Process -FilePath "node" `
  -ArgumentList @(
    $bridgeScript,
    "--port=$BridgePort",
    "--log-dir=$logs",
    "--proxy-key=paseo_proxy_a",
    "--proxy-keys-file=$registry"
  ) `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr

try {
  $deadline = (Get-Date).AddSeconds(20)
  do {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 2
    } catch {
      $health = $null
    }
    if ($health -and $health.status -eq "ok") { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  if (-not $health -or $health.status -ne "ok") {
    throw "Bridge health failed."
  }
  if ($health.auth_clients -lt 2) {
    throw "Expected at least 2 auth clients, got $($health.auth_clients)."
  }

  $a1 = Invoke-PaseoResponse -ProxyKey "paseo_proxy_a" -CaseId "A1" -InputText "client A first turn"
  Invoke-PaseoResponse -ProxyKey "paseo_proxy_b" -CaseId "B-cross" -InputText "client B tries A previous id" -PreviousResponseId $a1.id | Out-Null
  Invoke-PaseoResponse -ProxyKey "paseo_proxy_a" -CaseId "A2" -InputText "client A continues own previous id" -PreviousResponseId $a1.id | Out-Null

  $tracePath = Join-Path $traces "bridge-trace.jsonl"
  $events = Get-Content $tracePath | ForEach-Object { $_ | ConvertFrom-Json }
  $bEvent = $events | Where-Object { $_.traceId -eq "B-cross" -and $_.event -eq "responses_request" } | Select-Object -Last 1
  $aEvent = $events | Where-Object { $_.traceId -eq "A2" -and $_.event -eq "responses_request" } | Select-Object -Last 1

  if (-not $bEvent -or -not $aEvent) {
    throw "Missing trace events."
  }
  if ($bEvent.clientId -ne "client_b") {
    throw "B event client mismatch: $($bEvent.clientId)."
  }
  if ($aEvent.clientId -ne "client_a") {
    throw "A event client mismatch: $($aEvent.clientId)."
  }
  if (@($bEvent.messages).Count -ne 1) {
    throw "Cross-client history leaked. B message count: $(@($bEvent.messages).Count)."
  }
  if (@($aEvent.messages).Count -le 1) {
    throw "Same-client history did not replay. A message count: $(@($aEvent.messages).Count)."
  }

  [pscustomobject]@{
    result = "PASEO_MULTI_CLIENT_ISOLATION_OK"
    bridgePort = $BridgePort
    authClients = $health.auth_clients
    clientBMessagesWithClientAPreviousId = @($bEvent.messages).Count
    clientAMessagesWithOwnPreviousId = @($aEvent.messages).Count
    trace = $tracePath
  } | ConvertTo-Json -Compress
} finally {
  Stop-Process -Id $bridge.Id -Force -ErrorAction SilentlyContinue
}
