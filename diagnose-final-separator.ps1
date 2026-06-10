param(
  [string]$SandboxRoot = ".codex-deepseek-sandbox",
  [int]$BridgePort = 43119,
  [int]$TraceTail = 5000,
  [switch]$ShowTimeline
)

$ErrorActionPreference = "Stop"

function Read-JsonLines {
  param([Parameter(Mandatory = $true)][string]$Path)
  $items = New-Object System.Collections.Generic.List[object]
  if (-not (Test-Path $Path)) { return @() }
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8 -ErrorAction SilentlyContinue) {
    if (-not $line.Trim()) { continue }
    try {
      [void]$items.Add(($line | ConvertFrom-Json))
    } catch {
      # Keep diagnostics robust when a log line is truncated or non-JSON.
    }
  }
  return $items.ToArray()
}

function Get-ShortText {
  param([string]$Text, [int]$Max = 100)
  if (-not $Text) { return "" }
  $s = ($Text -replace "\s+", " ").Trim()
  if ($s.Length -le $Max) { return $s }
  return $s.Substring(0, $Max) + "..."
}

function Count-Where {
  param([object[]]$Items, [scriptblock]$Predicate)
  return @($Items | Where-Object $Predicate).Count
}

function Get-HealthValue {
  param(
    [Parameter(Mandatory = $true)][object]$Health,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if ($Health.config -and ($Health.config.PSObject.Properties.Name -contains $Name)) {
    return $Health.config.$Name
  }
  if ($Health.PSObject.Properties.Name -contains $Name) {
    return $Health.$Name
  }
  return ""
}

if ([System.IO.Path]::IsPathRooted($SandboxRoot)) {
  $sandboxPath = [System.IO.Path]::GetFullPath($SandboxRoot)
} else {
  $sandboxPath = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $SandboxRoot))
}
if (-not (Test-Path $sandboxPath)) {
  throw "Sandbox root not found: $sandboxPath"
}

$codexHome = Join-Path $sandboxPath "codex-home"
$logsDir = Join-Path $sandboxPath "logs"

Write-Host "Codex DeepSeek final separator diagnostic" -ForegroundColor Cyan
Write-Host "  SandboxRoot: $sandboxPath"
Write-Host "  CodexHome:   $codexHome"
Write-Host "  LogsDir:     $logsDir"
Write-Host ""

try {
  $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $BridgePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $health = Invoke-RestMethod "http://127.0.0.1:$BridgePort/health" -TimeoutSec 1
    Write-Host "Bridge health: ok" -ForegroundColor Green
    Write-Host ("  pid:           " + $listener.OwningProcess)
    Write-Host ("  summary_mode:  " + (Get-HealthValue $health "reasoning_summary_mode"))
    Write-Host ("  summary_model: " + (Get-HealthValue $health "reasoning_summary_model"))
    Write-Host ("  summary_think: " + (Get-HealthValue $health "reasoning_summary_thinking"))
    Write-Host ("  summary_surface: " + (Get-HealthValue $health "tool_summary_surface"))
  } else {
    Write-Host "Bridge health: no listener on port $BridgePort" -ForegroundColor Yellow
  }
} catch {
  Write-Host "Bridge health: unavailable on port $BridgePort" -ForegroundColor Yellow
  Write-Host ("  " + $_.Exception.Message)
}
Write-Host ""

$sessionFile = Get-ChildItem -Path (Join-Path $codexHome "sessions") -Recurse -Filter "*.jsonl" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $sessionFile) {
  throw "No Codex session JSONL found under $codexHome\sessions"
}

$sessionEvents = @(Read-JsonLines -Path $sessionFile.FullName)
$lastTaskStartIndex = -1
for ($i = 0; $i -lt $sessionEvents.Count; $i++) {
  $e = $sessionEvents[$i]
  if ($e.type -eq "event_msg" -and $e.payload.type -eq "task_started") {
    $lastTaskStartIndex = $i
  }
}
if ($lastTaskStartIndex -ge 0) {
  $turnEvents = @($sessionEvents[$lastTaskStartIndex..($sessionEvents.Count - 1)])
} else {
  $turnEvents = $sessionEvents
}

$turnStart = if ($turnEvents.Count -gt 0) { $turnEvents[0].timestamp } else { $null }

$agentReasoningCount = Count-Where $turnEvents { $_.type -eq "event_msg" -and $_.payload.type -eq "agent_reasoning" }
$reasoningItemCount = Count-Where $turnEvents { $_.type -eq "response_item" -and $_.payload.type -eq "reasoning" }
$reasoningSummaryCount = Count-Where $turnEvents {
  $_.type -eq "response_item" -and
  $_.payload.type -eq "reasoning" -and
  $_.payload.summary -and
  @($_.payload.summary).Count -gt 0 -and
  [string]::Join("", @($_.payload.summary | ForEach-Object { $_.text })).Trim().Length -gt 0
}
$functionCallCount = Count-Where $turnEvents { $_.type -eq "response_item" -and ($_.payload.type -eq "function_call" -or $_.payload.type -eq "custom_tool_call") }
$functionOutputCount = Count-Where $turnEvents { $_.type -eq "response_item" -and ($_.payload.type -eq "function_call_output" -or $_.payload.type -eq "custom_tool_call_output") }
$agentMessageEventCount = Count-Where $turnEvents { $_.type -eq "event_msg" -and $_.payload.type -eq "agent_message" }
$assistantMessageItemCount = Count-Where $turnEvents { $_.type -eq "response_item" -and $_.payload.type -eq "message" -and $_.payload.role -eq "assistant" }
$toolCommentaryMessageCount = Count-Where $turnEvents {
  $_.type -eq "response_item" -and
  $_.payload.type -eq "message" -and
  $_.payload.role -eq "assistant" -and
  (
    ($_.payload.PSObject.Properties.Name -contains "phase" -and $_.payload.phase -eq "commentary") -or
    ($_.payload.metadata -and $_.payload.metadata.bridge_tool_summary_commentary -eq $true)
  )
}
$taskCompleteCount = Count-Where $turnEvents { $_.type -eq "event_msg" -and $_.payload.type -eq "task_complete" }
$firstToolIndex = -1
for ($i = 0; $i -lt $turnEvents.Count; $i++) {
  $p = $turnEvents[$i].payload
  if ($turnEvents[$i].type -eq "response_item" -and ($p.type -eq "function_call" -or $p.type -eq "custom_tool_call")) {
    $firstToolIndex = $i
    break
  }
}
if ($firstToolIndex -gt 0) {
  $eventsBeforeFirstTool = @($turnEvents[0..($firstToolIndex - 1)])
} else {
  $eventsBeforeFirstTool = @()
}
$assistantMessagesBeforeFirstTool = Count-Where $eventsBeforeFirstTool { $_.type -eq "response_item" -and $_.payload.type -eq "message" -and $_.payload.role -eq "assistant" }
$agentMessageEventsBeforeFirstTool = Count-Where $eventsBeforeFirstTool { $_.type -eq "event_msg" -and $_.payload.type -eq "agent_message" }
$assistantPhaseCounts = @{}
foreach ($msg in @($turnEvents | Where-Object { $_.type -eq "response_item" -and $_.payload.type -eq "message" -and $_.payload.role -eq "assistant" })) {
  $phase = if ($msg.payload.PSObject.Properties.Name -contains "phase" -and $msg.payload.phase) { [string]$msg.payload.phase } else { "<none>" }
  if (-not $assistantPhaseCounts.ContainsKey($phase)) { $assistantPhaseCounts[$phase] = 0 }
  $assistantPhaseCounts[$phase] += 1
}

Write-Host "Latest Codex session" -ForegroundColor Cyan
Write-Host ("  file:       " + $sessionFile.FullName)
Write-Host ("  modified:   " + $sessionFile.LastWriteTime)
Write-Host ("  turn_start: " + $turnStart)
Write-Host ""

Write-Host "Codex session evidence" -ForegroundColor Cyan
Write-Host ("  agent_reasoning events:       " + $agentReasoningCount)
Write-Host ("  reasoning items:              " + $reasoningItemCount)
Write-Host ("  reasoning items with summary: " + $reasoningSummaryCount)
Write-Host ("  function/custom tool calls:   " + $functionCallCount)
Write-Host ("  function/custom tool outputs: " + $functionOutputCount)
Write-Host ("  agent_message events:         " + $agentMessageEventCount)
Write-Host ("  assistant message items:      " + $assistantMessageItemCount)
Write-Host ("  tool commentary msg items:    " + $toolCommentaryMessageCount)
Write-Host ("  agent messages before tool:   " + $agentMessageEventsBeforeFirstTool)
Write-Host ("  msg items before first tool:  " + $assistantMessagesBeforeFirstTool)
if ($assistantPhaseCounts.Count -gt 0) {
  $phaseText = ($assistantPhaseCounts.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ", "
  Write-Host ("  assistant message phases:     " + $phaseText)
}
Write-Host ("  task_complete events:         " + $taskCompleteCount)
Write-Host ""

$traceFile = Get-ChildItem -Path (Join-Path $logsDir "traces") -Filter "*.jsonl" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($traceFile) {
  $traceLines = Get-Content -LiteralPath $traceFile.FullName -Encoding UTF8 -Tail $TraceTail -ErrorAction SilentlyContinue |
    Where-Object {
      $_ -match '"event":"responses_completed"' -or
      $_ -match '"event":"reasoning_display_summary_' -or
      $_ -match '"event":"tool_summary_commentary_emitted"' -or
      $_ -match '"event":"DEBUG_SSE_emit_summary_'
    }
  $tmp = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllLines($tmp.FullName, $traceLines)
    $traceEvents = @(Read-JsonLines -Path $tmp.FullName)
  } finally {
    Remove-Item -LiteralPath $tmp.FullName -Force -ErrorAction SilentlyContinue
  }
  if ($turnStart) {
    $traceEvents = @($traceEvents | Where-Object { -not $_.time -or $_.time -ge $turnStart })
  }

  $toolCompletions = @($traceEvents | Where-Object { $_.event -eq "responses_completed" -and $_.terminalKind -eq "tool_call" })
  $messageCompletions = @($traceEvents | Where-Object { $_.event -eq "responses_completed" -and $_.terminalKind -eq "message" })
  $summaryCreated = @($traceEvents | Where-Object { $_.event -eq "reasoning_display_summary_created" })
  $summarySkippedNoTool = @($traceEvents | Where-Object { $_.event -eq "reasoning_display_summary_skipped_no_tool_call" })
  $summaryForNoTool = @($summaryCreated | Where-Object { [int]($_.toolCalls) -eq 0 })
  $summaryForTool = @($summaryCreated | Where-Object { [int]($_.toolCalls) -gt 0 })
  $toolSummaryCommentary = @($traceEvents | Where-Object { $_.event -eq "tool_summary_commentary_emitted" })
  $debugSummaryDelta = @($traceEvents | Where-Object { $_.event -eq "DEBUG_SSE_emit_summary_delta" })

  Write-Host "Bridge trace evidence" -ForegroundColor Cyan
  Write-Host ("  file:                         " + $traceFile.FullName)
  Write-Host ("  responses_completed tool_call: " + $toolCompletions.Count)
  Write-Host ("  responses_completed message:   " + $messageCompletions.Count)
  Write-Host ("  summary created for tools:     " + $summaryForTool.Count)
  Write-Host ("  summary skipped no-tool:       " + $summarySkippedNoTool.Count)
  Write-Host ("  tool summary commentaries:     " + $toolSummaryCommentary.Count)
  Write-Host ("  WARNING summary for no-tool:   " + $summaryForNoTool.Count)
  Write-Host ("  debug summary deltas:          " + $debugSummaryDelta.Count)
  Write-Host ""
} else {
  Write-Host "Bridge trace evidence" -ForegroundColor Cyan
  Write-Host "  No trace JSONL found."
  Write-Host ""
}

$hasWorkActivityEvidence = $functionOutputCount -gt 0
$hasFinalMessageEvidence = ($agentMessageEventCount -gt 0 -or $assistantMessageItemCount -gt 0)
$hasSummaryPipelineEvidence = ($agentReasoningCount -gt 0 -and $reasoningSummaryCount -gt 0)
$hasCommentaryPipelineEvidence = ($toolCommentaryMessageCount -gt 0 -and $agentMessageEventsBeforeFirstTool -gt 0)

Write-Host "Separator prerequisite inference" -ForegroundColor Cyan
if ($hasSummaryPipelineEvidence) {
  Write-Host "  [ok] Codex accepted reasoning summary events." -ForegroundColor Green
} elseif ($hasCommentaryPipelineEvidence) {
  Write-Host "  [ok] Codex accepted tool-prep commentary as agent messages before tool calls." -ForegroundColor Green
} else {
  Write-Host "  [missing] No accepted reasoning summary or tool-prep commentary evidence in latest turn." -ForegroundColor Yellow
}
if ($hasWorkActivityEvidence) {
  Write-Host "  [ok] Codex recorded completed tool output; this is the strongest JSONL proxy for work activity." -ForegroundColor Green
} else {
  Write-Host "  [missing] No completed tool output in latest turn; native separator is not expected." -ForegroundColor Yellow
}
if ($hasFinalMessageEvidence) {
  Write-Host "  [ok] Codex recorded final assistant message." -ForegroundColor Green
} else {
  Write-Host "  [missing] No final assistant message in latest turn." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Manual TUI check" -ForegroundColor Cyan
Write-Host "  The native full-width line is a TUI-only FinalMessageSeparator."
Write-Host "  JSONL can prove prerequisites, but the actual line must be confirmed visually in the open Codex terminal."
Write-Host "  Expected visual position: after the last tool output block and immediately before the final assistant answer."

if ($ShowTimeline) {
  Write-Host ""
  Write-Host "Latest turn timeline" -ForegroundColor Cyan
  foreach ($e in $turnEvents) {
    $kind = ""
    $detail = ""
    if ($e.type -eq "event_msg") {
      $kind = "event:" + $e.payload.type
      if ($e.payload.message) { $detail = Get-ShortText $e.payload.message }
      elseif ($e.payload.text) { $detail = Get-ShortText $e.payload.text }
    } elseif ($e.type -eq "response_item") {
      $kind = "item:" + $e.payload.type
      if ($e.payload.name) { $detail = $e.payload.name }
      elseif ($e.payload.role) { $detail = $e.payload.role }
    } else {
      $kind = $e.type
    }
    Write-Host ("  {0}  {1,-28} {2}" -f $e.timestamp, $kind, $detail)
  }
}
