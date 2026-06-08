param(
  [string]$WorkDir = "",
  [string]$LogsDir = "",
  [int]$Last = 20,
  [switch]$DowngradesOnly
)

$ErrorActionPreference = "Stop"

$logsDir = $LogsDir
if (-not $logsDir) {
  if (-not $WorkDir) {
    throw "Provide either -WorkDir or -LogsDir."
  }
  $logsDir = Join-Path $WorkDir ".codex-deepseek-sandbox\logs"
}
$auditLog = Join-Path $logsDir "reasoning-audit.jsonl"
$auditTextLog = Join-Path $logsDir "reasoning-audit.log"
$summaryFile = Join-Path $logsDir "reasoning-summary.json"

if (-not (Test-Path $auditLog)) {
  throw "Reasoning audit log not found: $auditLog"
}

Write-Host "Reasoning audit log: $auditLog"
if (Test-Path $auditTextLog) {
  Write-Host "Readable log:        $auditTextLog"
}
if (Test-Path $summaryFile) {
  $summary = Get-Content $summaryFile -Raw | ConvertFrom-Json
  Write-Host ""
  [pscustomobject]@{
    requests = $summary.requests
    thinking_enabled = $summary.thinking_enabled
    thinking_disabled = $summary.thinking_disabled
    downgraded = $summary.downgraded
    last_policy = $summary.last_request.policy
    last_thinking = $summary.last_request.thinking
    last_downgrade_time = $summary.last_downgrade.time
    last_downgrade_reason = $summary.last_downgrade.reason
  } | Format-List
}

$events = Get-Content $auditLog | ForEach-Object {
  try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $_ }

if ($DowngradesOnly) {
  $events = $events | Where-Object { $_.downgraded -eq $true }
}

Write-Host ""
Write-Host "Recent reasoning policy events:"
$events |
  Select-Object -Last $Last `
    time,
    traceId,
    policy,
    thinking,
    reasoningEffort,
    downgraded,
    downgradeReason,
    assistantToolCallMessages,
    missingReasoningMessages,
    missingReasoningToolCalls |
  Format-Table -AutoSize

if ($summary -and $summary.last_downgrade -and $summary.last_downgrade.samples) {
  Write-Host ""
  Write-Host "Last downgrade samples:"
  $summary.last_downgrade.samples |
    Select-Object messageIndex, previousRole, nextRole, callCount,
      @{Name = "toolNames"; Expression = { ($_.toolNames -join ",") }},
      @{Name = "callIds"; Expression = { ($_.callIds -join ",") }} |
    Format-Table -AutoSize
}
